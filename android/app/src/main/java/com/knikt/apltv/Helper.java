package com.knikt.apltv;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.PushbackInputStream;
import java.io.Reader;
import java.io.BufferedOutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/* APL TV's helper on Android: the same service as on Samsung and LG (app/service/service.js), in Java,
   on port 8765 while the app is open.
   1. The phone setup page behind the QR code (the same page, generated from service.js at build time):
      http://<screen>:8765/?k=<code>, only with the code shown on the screen, only while it is shown.
   2. For the app only (requests from the screen itself): /fetch (a provider's answer, gzip opened),
      /epg and /epg/match (XMLTV guides read here and cut to what the app needs), /imdb (IMDb's daily
      ratings file), /log. */
final class Helper {
    private static final int PORT = 8765;
    private static final long SESSION_MS = 20 * 60 * 1000L, EPG_KEEP_MS = 10 * 60 * 1000L, IMDB_DAY = 24 * 3600 * 1000L;
    private static final String UA = "APL TV (Android)";
    private final Context ctx;
    private ServerSocket server;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private volatile boolean running = false;

    private final Object lock = new Object();
    private String sessionToken = null; private long sessionAt = 0; private int wrong = 0;
    // the phone editor (1.0.11): what the app sent, what the phone sends back
    private String editToken = null, editData = null, editSaved = null; private long editAt = 0; private int editWrong = 0;
    private static final long EDIT_MS = 30 * 60 * 1000L;
    private final List<JSONObject> pending = new ArrayList<>();
    private final LinkedList<String> logs = new LinkedList<>();
    private volatile boolean devLog = false;

    Helper(Context ctx) { this.ctx = ctx.getApplicationContext(); }

    /* ---------- the server ---------- */
    synchronized void start() {
        if (running) return;
        running = true;
        pool.execute(() -> {
            try {
                server = new ServerSocket();
                server.setReuseAddress(true);
                server.bind(new InetSocketAddress(PORT));
                log("listening on " + PORT);
                while (running) {
                    Socket s = server.accept();
                    pool.execute(() -> serve(s));
                }
            } catch (IOException e) {
                log("server: " + e.getMessage());
            } finally {
                running = false;
            }
        });
        pool.execute(() -> {           // guides are kept 10 minutes after their last use
            while (true) {
                try { Thread.sleep(60000); } catch (InterruptedException e) { return; }
                long now = System.currentTimeMillis();
                for (Iterator<Map.Entry<String, Epg>> it = epgCache.entrySet().iterator(); it.hasNext(); ) {
                    Epg e = it.next().getValue();
                    if (e.ready && now - Math.max(e.used, e.at) > EPG_KEEP_MS) it.remove();
                }
            }
        });
    }
    synchronized void stop() {
        running = false;
        try { if (server != null) server.close(); } catch (IOException ignored) {}
        pool.shutdownNow();
    }

    private void log(String line) {
        synchronized (logs) {
            logs.add(new java.text.SimpleDateFormat("HH:mm:ss", Locale.US).format(new java.util.Date()) + " [svc] " + line);
            while (logs.size() > 500) logs.removeFirst();
        }
    }
    private static String redact(String s) {
        return String.valueOf(s).replaceAll("(?i)(username|password)=([^&\\s\"]+)", "$1=***")
            .replaceAll("(?i)/(live|movie|series|timeshift)/[^/\\s\"]+/[^/\\s\"]+/", "/$1/***/***/");
    }

    private static final class Req {
        String method, path, query = "", origin = null, lang = "", remote = "";
        Map<String, String> q = new HashMap<>();
        byte[] body = new byte[0];
    }

    private void serve(Socket s) {
        try {
            s.setSoTimeout(30000);
            InputStream in = new BufferedInputStream(s.getInputStream());
            OutputStream out = s.getOutputStream();
            Req r = new Req();
            r.remote = s.getInetAddress() != null ? s.getInetAddress().getHostAddress() : "";
            String line = readLine(in);
            if (line == null || line.isEmpty()) { s.close(); return; }
            String[] parts = line.split(" ");
            if (parts.length < 2) { s.close(); return; }
            r.method = parts[0];
            String target = parts[1];
            int qi = target.indexOf('?');
            r.path = qi >= 0 ? target.substring(0, qi) : target;
            r.query = qi >= 0 ? target.substring(qi + 1) : "";
            for (String kv : r.query.split("&")) {
                if (kv.isEmpty()) continue;
                int e = kv.indexOf('=');
                try { r.q.put(URLDecoder.decode(e >= 0 ? kv.substring(0, e) : kv, "UTF-8"), URLDecoder.decode(e >= 0 ? kv.substring(e + 1) : "", "UTF-8")); } catch (Exception ignored) {}
            }
            int length = 0;
            String h;
            while ((h = readLine(in)) != null && !h.isEmpty()) {
                int c = h.indexOf(':');
                if (c < 0) continue;
                String k = h.substring(0, c).trim().toLowerCase(Locale.US), v = h.substring(c + 1).trim();
                if (k.equals("content-length")) { try { length = Integer.parseInt(v); } catch (Exception ignored) {} }
                else if (k.equals("origin")) r.origin = v;
                else if (k.equals("accept-language")) r.lang = v;
            }
            if (length > 0 && length <= 5000000) {
                byte[] b = new byte[length]; int got = 0;
                while (got < length) { int n = in.read(b, got, length - got); if (n < 0) break; got += n; }
                r.body = got == length ? b : Arrays.copyOf(b, got);
            }
            handle(r, out);
        } catch (Exception e) {
            log("request: " + e.getMessage());
        } finally {
            try { s.close(); } catch (IOException ignored) {}
        }
    }
    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) >= 0) {
            if (c == '\n') break;
            if (c != '\r') b.write(c);
            if (b.size() > 16384) break;
        }
        if (c < 0 && b.size() == 0) return null;
        return b.toString("UTF-8");
    }

    private void send(OutputStream out, Req r, int status, String type, byte[] body) throws IOException {
        StringBuilder hd = new StringBuilder("HTTP/1.1 ").append(status).append(" ").append(status == 200 ? "OK" : status == 204 ? "No Content" : "Status").append("\r\n");
        String o = allowOrigin(r);
        if (o != null) hd.append("Access-Control-Allow-Origin: ").append(o).append("\r\nVary: Origin\r\n");
        hd.append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\n");
        hd.append("Content-Type: ").append(type).append("\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: ").append(body.length).append("\r\n\r\n");
        out.write(hd.toString().getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }
    private void json(OutputStream out, Req r, int status, String js) throws IOException { send(out, r, status, "application/json; charset=utf-8", js.getBytes(StandardCharsets.UTF_8)); }
    private static String err(String m) { return "{\"error\":" + JSONObject.quote(m == null ? "error" : m) + "}"; }

    /* ---------- who may ask ---------- */
    private static List<String> lanAddresses() {
        List<String> out = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> ns = NetworkInterface.getNetworkInterfaces();
            while (ns != null && ns.hasMoreElements()) {
                NetworkInterface n = ns.nextElement();
                if (!n.isUp() || n.isLoopback()) continue;
                Enumeration<InetAddress> as = n.getInetAddresses();
                while (as.hasMoreElements()) { InetAddress a = as.nextElement(); if (a instanceof Inet4Address && !a.isLoopbackAddress()) out.add(a.getHostAddress()); }
            }
        } catch (Exception ignored) {}
        return out;
    }
    private static boolean isLocal(Req r) {
        String a = r.remote.replace("::ffff:", "");
        return a.equals("127.0.0.1") || a.equals("::1") || a.startsWith("0:0:0:0:0:0:0:1") || lanAddresses().contains(a);
    }
    /* A website opened on the device must not use this service: the app's own page (file://, "null")
       and the phone page served here are let in; requests without an Origin are not from a page. */
    private static boolean originOk(Req r) {
        String o = r.origin;
        if (o == null || o.isEmpty() || o.equals("null") || o.matches("(?i)^(file|app|wgt):.*")) return true;
        Matcher m = Pattern.compile("(?i)^https?://([^/:]+)(?::(\\d+))?$").matcher(o);
        if (!m.find()) return false;
        String port = m.group(2) == null ? "80" : m.group(2), host = m.group(1);
        return port.equals(String.valueOf(PORT)) && (host.equals("127.0.0.1") || host.equals("localhost") || lanAddresses().contains(host));
    }
    private static String allowOrigin(Req r) { return r.origin == null || r.origin.isEmpty() ? null : r.origin; }

    /* ---------- the requests ---------- */
    private void handle(Req r, OutputStream out) throws Exception {
        if (!originOk(r)) { log("refused a request from a website: " + r.origin); send(out, r, 403, "text/plain", new byte[0]); return; }
        if ("OPTIONS".equals(r.method)) { send(out, r, 204, "text/plain", new byte[0]); return; }
        boolean post = "POST".equals(r.method);
        String p = r.path;

        if (p.equals("/ping")) { json(out, r, 200, "{\"ok\":1,\"v\":\"android\",\"session\":" + (sessionToken != null) + "}"); return; }
        if (p.equals("/dev/log") && devLog) {
            StringBuilder b = new StringBuilder();
            synchronized (logs) { for (String l : logs) b.append(redact(l)).append("\n"); }
            send(out, r, 200, "text/plain; charset=utf-8", b.toString().getBytes(StandardCharsets.UTF_8)); return;
        }
        if (p.equals("/") || p.equals("/s")) {
            String k = r.q.get("k");
            boolean good = sessionOk(k);
            if (k != null && !good) wrongCode();
            send(out, r, 200, "text/html; charset=utf-8", phonePage(r.lang, good ? k : null).getBytes(StandardCharsets.UTF_8));
            return;
        }
        if (p.equals("/submit") && post) {
            JSONObject b = parse(r.body);
            if (b == null || !sessionOk(b.optString("k", null))) { wrongCode(); json(out, r, 403, "{\"ok\":0}"); return; }
            JSONObject item = new JSONObject();
            String ty = b.optString("type");
            boolean m3u = "m3u".equals(ty), stalker = "stalker".equals(ty);
            item.put("type", m3u ? "m3u" : stalker ? "stalker" : "jellyfin".equals(ty) ? "jellyfin" : "plex".equals(ty) ? "plex" : "xtream");   // Jellyfin and Emby: server, user, password like Xtream
            item.put("name", cut(b.optString("name"), 80));
            item.put("epg", cut(b.optString("epg"), 2000));
            if (m3u) item.put("url", cut(b.optString("url"), 4000));
            else if (stalker) { item.put("portal", cut(b.optString("portal"), 400)); item.put("mac", cut(b.optString("mac"), 40)); }
            else { item.put("server", cut(b.optString("server"), 400)); item.put("user", cut(b.optString("user"), 200)); item.put("pass", cut(b.optString("pass"), 200)); }
            synchronized (lock) { pending.add(item); while (pending.size() > 5) pending.remove(0); }
            log("phone sent a " + item.getString("type") + " source");
            json(out, r, 200, "{\"ok\":1}");
            return;
        }

        // the phone editor: its page, the playlist it edits, what it sends back
        if (p.equals("/edit")) {
            String k = r.q.get("k");
            boolean good = editOk(k);
            if (k != null && !good) editWrongCode();
            send(out, r, 200, "text/html; charset=utf-8", editPage(r.lang, good ? k : null).getBytes(StandardCharsets.UTF_8));
            return;
        }
        if (p.equals("/edit/data")) {
            if (!editOk(r.q.get("k"))) { editWrongCode(); json(out, r, 403, err("expired")); return; }
            String d; synchronized (lock) { d = editData; }
            send(out, r, 200, "application/json; charset=utf-8", (d != null ? d : "{}").getBytes(StandardCharsets.UTF_8));
            return;
        }
        if (p.equals("/edit/save") && post) {
            JSONObject b = parse(r.body);
            if (b == null || !editOk(b.optString("k", null)) || b.optJSONObject("data") == null) { editWrongCode(); json(out, r, 403, "{\"ok\":0}"); return; }
            synchronized (lock) { editSaved = b.getJSONObject("data").toString(); }
            log("phone sent playlist changes");
            json(out, r, 200, "{\"ok\":1}");
            return;
        }

        // Everything below is for the app on this device only
        if (!isLocal(r)) { json(out, r, 403, err("local only")); return; }

        if (p.equals("/edit/start") && post) {
            if (r.body == null || r.body.length == 0) { json(out, r, 400, err("too big")); return; }
            JSONArray urls = new JSONArray();
            synchronized (lock) {
                editToken = newToken(); editAt = System.currentTimeMillis(); editData = new String(r.body, StandardCharsets.UTF_8); editSaved = null; editWrong = 0;
                for (String a : lanAddresses()) urls.put("http://" + a + ":" + PORT + "/edit?k=" + editToken);
                json(out, r, 200, "{\"token\":" + JSONObject.quote(editToken) + ",\"urls\":" + urls + "}");
            }
            return;
        }
        if (p.equals("/edit/pending")) {
            if (!editOk(r.q.get("k"))) { json(out, r, 200, "{\"data\":null,\"expired\":true}"); return; }
            String sv;
            synchronized (lock) { sv = editSaved; editSaved = null; editAt = System.currentTimeMillis(); }
            json(out, r, 200, "{\"data\":" + (sv != null ? sv : "null") + "}");
            return;
        }
        // timeshift (1.0.11)
        if (p.equals("/ts/start") && post) {
            JSONObject b = parse(r.body);
            String u = b == null ? "" : b.optString("url", "");
            if (!u.matches("(?i)^https?://.+")) { json(out, r, 400, err("no url")); return; }
            String e = tsStart(u);
            if (e != null) { json(out, r, 502, err(e)); return; }
            json(out, r, 200, tsInfo());
            return;
        }
        if (p.equals("/ts/info")) {
            TsRec t = tsRec;
            if (t == null || (r.q.get("id") != null && !r.q.get("id").equals(t.id))) { json(out, r, 404, err("none")); return; }
            json(out, r, 200, tsInfo());
            return;
        }
        if (p.equals("/ts/stream.ts")) {
            TsRec t = tsRec;
            if (t == null || (r.q.get("id") != null && !r.q.get("id").equals(t.id))) { json(out, r, 404, err("none")); return; }
            long at = System.currentTimeMillis();
            try { at = Long.parseLong(r.q.get("t")); } catch (Exception ignored) {}
            tsStream(t, out, at);
            return;
        }
        if (p.equals("/ts/stop")) { tsStop(); json(out, r, 200, "{\"ok\":1}"); return; }
        if (p.equals("/edit/close")) { synchronized (lock) { editToken = null; editData = null; editSaved = null; } json(out, r, 200, "{\"ok\":1}"); return; }

        if (p.equals("/session") && post) {
            JSONArray urls = new JSONArray();
            synchronized (lock) {
                sessionToken = newToken(); sessionAt = System.currentTimeMillis(); wrong = 0; pending.clear();
                for (String a : lanAddresses()) urls.put("http://" + a + ":" + PORT + "/?k=" + sessionToken);
                json(out, r, 200, "{\"token\":" + JSONObject.quote(sessionToken) + ",\"urls\":" + urls + "}");
            }
            return;
        }
        if (p.equals("/session/close")) { synchronized (lock) { sessionToken = null; pending.clear(); } json(out, r, 200, "{\"ok\":1}"); return; }
        if (p.equals("/pending")) {
            if (!sessionOk(r.q.get("k"))) { json(out, r, 200, "{\"items\":[],\"expired\":true}"); return; }
            JSONArray a = new JSONArray();
            synchronized (lock) { for (JSONObject o : pending) a.put(o); pending.clear(); }
            json(out, r, 200, "{\"items\":" + a + "}");
            return;
        }
        if (p.equals("/log") && post) {
            JSONObject b = parse(r.body);
            if (b != null) {
                devLog = b.optBoolean("dev", false);
                JSONArray lines = b.optJSONArray("lines");
                synchronized (logs) {
                    for (int i = 0; lines != null && i < lines.length(); i++) logs.add(lines.optString(i));
                    while (logs.size() > 500) logs.removeFirst();
                }
            }
            json(out, r, 200, "{\"ok\":1}");
            return;
        }
        if (p.equals("/dev/keys")) { json(out, r, 200, "{\"keys\":[]}"); return; }
        /* A request with the headers a Stalker (MAG) portal wants (a WebView cannot send a Cookie or a
           User-Agent of its own). Body: { url, headers }. */
        if (p.equals("/sget") && post) {
            JSONObject b = parse(r.body);
            if (b == null || !b.optString("url").matches("(?i)^https?://.*")) { json(out, r, 400, err("bad request")); return; }
            java.util.Map<String, String> hd = new java.util.HashMap<>();
            JSONObject h = b.optJSONObject("headers");
            if (h != null) for (java.util.Iterator<String> it = h.keys(); it.hasNext(); ) {
                String k = it.next();
                if (k.matches("(?i)^(cookie|user-agent|x-user-agent|authorization|referer|accept-language)$")) { String v = h.optString(k); hd.put(k, v.length() > 2000 ? v.substring(0, 2000) : v); }
            }
            String u = b.getString("url");
            try (Got g = get(u, b.optInt("t", 60000), 0, false, hd)) {
                byte[] body = readAll(g.in);
                send(out, r, g.status, "text/plain; charset=utf-8", body);
            } catch (Exception e) { log("stalker request failed " + redact(u) + ": " + e.getMessage()); json(out, r, 502, err(e.getMessage())); }
            return;
        }
        if (p.equals("/fetch")) {
            String u = r.q.get("u");
            if (u == null || !u.matches("(?i)^https?://.*")) { json(out, r, 400, err("bad url")); return; }
            int t = 120000; try { t = Integer.parseInt(r.q.get("t")); } catch (Exception ignored) {}
            try (Got g = get(u, t)) {
                byte[] body = readAll(g.in);
                send(out, r, g.status, g.type.toLowerCase(Locale.US).contains("json") ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", body);
            } catch (Exception e) { log("fetch failed " + redact(u) + ": " + e.getMessage()); json(out, r, 502, err(e.getMessage())); }
            return;
        }
        if (p.equals("/epg") && post) {
            JSONObject b = parse(r.body);
            if (b == null || !b.optString("url").matches("(?i)^https?://.*")) { json(out, r, 400, err("bad request")); return; }
            Epg e;
            try { e = loadXmltv(b.getString("url")); } catch (Exception x) { json(out, r, 502, err(x.getMessage())); return; }
            long now = System.currentTimeMillis();
            long from = b.optLong("from", now - 3 * 3600 * 1000L), to = b.optLong("to", now + 24 * 3600 * 1000L);
            StringBuilder sb = new StringBuilder("{\"chans\":{");
            JSONArray want = b.optJSONArray("ids");
            List<String> ids = new ArrayList<>();
            if (want != null) for (int i = 0; i < want.length(); i++) ids.add(want.optString(i)); else ids.addAll(e.chans.keySet());
            boolean first = true;
            for (String id : ids) {
                List<Prog> list = e.chans.get(id);
                if (list == null) continue;
                if (!first) sb.append(','); first = false;
                sb.append(JSONObject.quote(id)).append(':');
                progs(sb, list, from, to);
            }
            sb.append("},\"names\":");
            if (b.optBoolean("names")) sb.append(new JSONObject(e.names)); else sb.append("{}");
            sb.append(",\"total\":").append(e.count).append('}');
            json(out, r, 200, sb.toString());
            return;
        }
        if (p.equals("/epg/match") && post) {
            JSONObject b = parse(r.body);
            if (b == null || !b.optString("url").matches("(?i)^https?://.*") || b.optJSONArray("names") == null) { json(out, r, 400, err("bad request")); return; }
            long now = System.currentTimeMillis();
            try {
                String res = matchXmltv(b.getString("url"), b.getJSONArray("names"), b.optLong("from", now - 4 * 3600 * 1000L), b.optLong("to", now + 26 * 3600 * 1000L));
                json(out, r, 200, "{\"chans\":" + res + "}");
            } catch (Exception x) { json(out, r, 502, err(x.getMessage())); }
            return;
        }
        if (p.equals("/imdb") && post) {
            JSONObject b = parse(r.body);
            JSONArray ids = b == null ? null : b.optJSONArray("ids");
            if (ids == null || ids.length() == 0) { json(out, r, 400, err("bad request")); return; }
            Imdb tab;
            try { tab = loadImdb(); } catch (Exception x) { json(out, r, 502, err(x.getMessage())); return; }
            StringBuilder sb = new StringBuilder("{\"ratings\":{");
            boolean first = true;
            for (int i = 0; i < Math.min(2000, ids.length()); i++) {
                String id = ids.optString(i);
                double v = tab.find(id);
                if (v <= 0) continue;
                if (!first) sb.append(','); first = false;
                sb.append(JSONObject.quote(id)).append(':').append(v);
            }
            sb.append("},\"at\":").append(tab.at).append('}');
            json(out, r, 200, sb.toString());
            return;
        }
        json(out, r, 404, err("not found"));
    }

    private static JSONObject parse(byte[] body) { try { return new JSONObject(new String(body, StandardCharsets.UTF_8)); } catch (Exception e) { return null; } }
    private static String cut(String s, int n) { s = s == null ? "" : s; return s.length() > n ? s.substring(0, n) : s; }

    /* ---------- the phone page (assets/helper, made from service.js by tools/make-android.py) ---------- */
    private boolean sessionOk(String k) {
        synchronized (lock) { return sessionToken != null && k != null && k.equals(sessionToken) && System.currentTimeMillis() - sessionAt < SESSION_MS; }
    }
    private void wrongCode() {
        synchronized (lock) { if (sessionToken != null && ++wrong >= 20) { log("too many wrong phone codes: session closed"); sessionToken = null; pending.clear(); } }
    }
    /* ---------- timeshift: the live channel kept in pieces of about 4 s (60 min or 800 MB at most, in the app's
       cache), read back by the player from /ts/stream.ts?t=<time>, then followed as it comes. One channel at a time:
       the provider sees one connection, this one. ---------- */
    private static final long TS_SEG_MS = 4000, TS_MAX_MS = 60 * 60 * 1000L, TS_MAX_BYTES = 800L * 1024 * 1024;
    private static final class Seg { int n; long t, bytes; File file; boolean done; }
    private static final class TsRec {
        String id, url, err = ""; final ArrayList<Seg> segs = new ArrayList<>(); int next = 0, retries = 0; long total = 0, max = TS_MAX_BYTES, started = System.currentTimeMillis();
        volatile boolean stopped = false, live = false; volatile Got got;
    }
    private volatile TsRec tsRec = null;
    private final Object tsLock = new Object();
    private File tsDir() { File d = new File(ctx.getCacheDir(), "timeshift"); if (!d.exists()) d.mkdirs(); return d; }
    private void tsStop() {
        TsRec t;
        synchronized (tsLock) { t = tsRec; tsRec = null; if (t != null) { t.stopped = true; for (Seg sg : t.segs) sg.file.delete(); } tsLock.notifyAll(); }
        if (t != null && t.got != null) t.got.close();
    }
    private String tsInfo() {
        TsRec t = tsRec;
        if (t == null) return err("none");
        try {
            JSONObject o = new JSONObject();
            JSONArray a = new JSONArray();
            synchronized (tsLock) { for (Seg sg : t.segs) a.put(sg.t); o.put("from", t.segs.isEmpty() ? 0 : t.segs.get(0).t); o.put("bytes", t.total); }
            o.put("id", t.id); o.put("live", t.live); o.put("err", t.err); o.put("to", System.currentTimeMillis()); o.put("segs", a);
            return o.toString();
        } catch (Exception e) { return err(e.getMessage()); }
    }
    /* Starts reading the channel; null when its first bytes came, or why it could not */
    private String tsStart(String url) {
        tsStop();
        File[] old = tsDir().listFiles();
        if (old != null) for (File f : old) f.delete();
        final TsRec t = new TsRec();
        t.id = newToken(); t.url = url;
        synchronized (tsLock) { tsRec = t; }
        final java.util.concurrent.CountDownLatch first = new java.util.concurrent.CountDownLatch(1);
        final String[] why = { null };
        log("timeshift: recording " + redact(url).replaceAll("^(https?://[^/]+).*$", "$1/..."));
        pool.execute(() -> tsRun(t, first, why));
        try { if (!first.await(20, java.util.concurrent.TimeUnit.SECONDS)) why[0] = "timeout"; } catch (InterruptedException e) { why[0] = "stopped"; }
        if (why[0] != null) { if (tsRec == t) tsStop(); return why[0]; }
        return null;
    }
    private void tsRun(TsRec t, java.util.concurrent.CountDownLatch first, String[] why) {
        byte[] buf = new byte[65536], rest = new byte[0];
        while (!t.stopped) {
            Got g = null;
            try {
                g = get(t.url, 20000);
                t.got = g;
                if (g.status != 200) throw new IOException("HTTP " + g.status);
                t.live = true; t.err = "";
                if (first.getCount() > 0) first.countDown();
                boolean synced = false;
                rest = new byte[0];
                int n;
                while (!t.stopped && (n = g.in.read(buf)) > 0) {
                    byte[] c = new byte[rest.length + n];
                    System.arraycopy(rest, 0, c, 0, rest.length);
                    System.arraycopy(buf, 0, c, rest.length, n);
                    int off = 0;
                    if (!synced) {                                         // start on a packet (0x47 every 188 bytes)
                        while (off + 376 < c.length && !(c[off] == 0x47 && c[off + 188] == 0x47 && c[off + 376] == 0x47)) off++;
                        if (off + 376 >= c.length) { rest = c; continue; }
                        synced = true;
                    }
                    int whole = (c.length - off) - ((c.length - off) % 188);
                    rest = java.util.Arrays.copyOfRange(c, off + whole, c.length);
                    if (whole > 0) tsWrite(t, c, off, whole);
                }
                if (t.stopped) break;
                throw new IOException("the channel stopped");
            } catch (Exception e) {
                t.live = false;
                if (t.stopped) break;
                if (first.getCount() > 0) { why[0] = String.valueOf(e.getMessage()); first.countDown(); return; }
                if (++t.retries > 5) { t.err = String.valueOf(e.getMessage()); log("timeshift: gave up (" + t.err + ")"); synchronized (tsLock) { tsLock.notifyAll(); } return; }
                log("timeshift: " + e.getMessage() + ", reconnecting");
                try { Thread.sleep(2000); } catch (InterruptedException x) { return; }
            } finally { if (g != null) g.close(); }
        }
    }
    private void tsWrite(TsRec t, byte[] c, int off, int len) throws IOException {
        long now = System.currentTimeMillis();
        Seg cur;
        synchronized (tsLock) {
            cur = t.segs.isEmpty() ? null : t.segs.get(t.segs.size() - 1);
            if (cur == null || cur.done || now - cur.t >= TS_SEG_MS) {
                if (cur != null) cur.done = true;
                cur = new Seg(); cur.n = t.next++; cur.t = now; cur.file = new File(tsDir(), "s" + cur.n + ".ts");
                t.segs.add(cur);
            }
        }
        try (java.io.FileOutputStream f = new java.io.FileOutputStream(cur.file, true)) { f.write(c, off, len); }
        synchronized (tsLock) {
            cur.bytes += len; t.total += len;
            if (t.retries > 0 && now - t.started > 60000) t.retries = 0;
            while (t.segs.size() > 2 && (t.total > t.max || now - t.segs.get(0).t > TS_MAX_MS)) { Seg o = t.segs.remove(0); t.total -= o.bytes; o.file.delete(); }
            tsLock.notifyAll();
        }
    }
    /* The buffer from the piece of that moment, then the channel as it comes, until the player closes */
    private void tsStream(TsRec t, OutputStream out, long at) throws IOException {
        int n;
        synchronized (tsLock) {
            int i = 0;
            while (i + 1 < t.segs.size() && t.segs.get(i + 1).t <= at) i++;
            n = t.segs.isEmpty() ? 0 : t.segs.get(i).n;
        }
        out.write(("HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        long pos = 0;
        byte[] buf = new byte[65536];
        java.io.RandomAccessFile f = null;
        try {
            while (tsRec == t && !t.stopped) {
                Seg cur = null;
                synchronized (tsLock) {
                    for (Seg sg : t.segs) if (sg.n == n) { cur = sg; break; }
                    if (cur == null) {
                        if (!t.segs.isEmpty() && t.segs.get(0).n > n) { n = t.segs.get(0).n; pos = 0; if (f != null) { f.close(); f = null; } continue; }
                        if (!t.err.isEmpty()) return;
                        try { tsLock.wait(1000); } catch (InterruptedException e) { return; }
                        continue;
                    }
                }
                if (f == null) f = new java.io.RandomAccessFile(cur.file, "r");
                f.seek(pos);
                int got = f.read(buf);
                if (got > 0) { out.write(buf, 0, got); pos += got; continue; }
                boolean done; long size;
                synchronized (tsLock) { done = cur.done; size = cur.bytes; }
                if (done && pos >= size) { f.close(); f = null; n++; pos = 0; continue; }
                if (!t.err.isEmpty()) return;
                synchronized (tsLock) { try { tsLock.wait(500); } catch (InterruptedException e) { return; } }
            }
        } finally { if (f != null) try { f.close(); } catch (IOException ignored) {} }
    }

    private boolean editOk(String k) {
        synchronized (lock) { return editToken != null && k != null && k.equals(editToken) && System.currentTimeMillis() - editAt < EDIT_MS; }
    }
    private void editWrongCode() {
        synchronized (lock) { if (editToken != null && ++editWrong >= 20) { log("too many wrong editor codes: closed"); editToken = null; editData = null; editSaved = null; } }
    }
    private String editPage(String lang, String token) {
        boolean fr = lang != null && lang.toLowerCase(Locale.US).startsWith("fr");
        String name = (token != null ? "edit-" : "edit-expired-") + (fr ? "fr" : "en") + ".html";
        try (InputStream in = ctx.getAssets().open("helper/" + name)) {
            String html = new String(readAll(in), StandardCharsets.UTF_8);
            return token != null ? html.replace("\"__APLTV_TOKEN__\"", JSONObject.quote(token)) : html;
        } catch (IOException e) {
            return "<!doctype html><meta charset=utf-8><p>APL TV</p>";
        }
    }
    private static String newToken() {
        String A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        SecureRandom r = new SecureRandom();
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < 8; i++) s.append(A.charAt(r.nextInt(A.length())));
        return s.toString();
    }
    private String phonePage(String lang, String token) {
        boolean fr = lang != null && lang.toLowerCase(Locale.US).startsWith("fr");
        String name = (token != null ? "phone-" : "expired-") + (fr ? "fr" : "en") + ".html";
        try (InputStream in = ctx.getAssets().open("helper/" + name)) {
            String html = new String(readAll(in), StandardCharsets.UTF_8);
            return token != null ? html.replace("\"__APLTV_TOKEN__\"", JSONObject.quote(token)) : html;
        } catch (IOException e) {
            return "<!doctype html><meta charset=utf-8><p>APL TV</p>";
        }
    }

    /* ---------- outgoing requests (redirects, gzip, providers with a broken certificate) ---------- */
    private static final class Got implements AutoCloseable {
        int status; String type = ""; InputStream in; HttpURLConnection conn;
        @Override public void close() { try { if (in != null) in.close(); } catch (IOException ignored) {} if (conn != null) conn.disconnect(); }
    }
    private Got get(String target, int timeoutMs) throws IOException { return get(target, timeoutMs, 0, false, null); }
    private Got get(String target, int timeoutMs, int hops, boolean insecure) throws IOException { return get(target, timeoutMs, hops, insecure, null); }
    private Got get(String target, int timeoutMs, int hops, boolean insecure, java.util.Map<String, String> extra) throws IOException {
        URL url = new URL(target);
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        if (insecure && c instanceof HttpsURLConnection) {
            HttpsURLConnection hc = (HttpsURLConnection) c;
            hc.setSSLSocketFactory(trustAll().getSocketFactory());
            hc.setHostnameVerifier((h, s) -> true);
        }
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(Math.min(timeoutMs, 20000));
        c.setReadTimeout(Math.min(timeoutMs, 60000));
        c.setRequestProperty("User-Agent", UA);
        c.setRequestProperty("Accept-Encoding", "gzip");
        c.setRequestProperty("Accept", "*/*");
        if (extra != null) for (java.util.Map.Entry<String, String> h : extra.entrySet()) c.setRequestProperty(h.getKey(), h.getValue());   // a Stalker portal's own headers
        int status;
        try { status = c.getResponseCode(); }
        catch (javax.net.ssl.SSLException e) {
            c.disconnect();
            if (!insecure && target.toLowerCase(Locale.US).startsWith("https:")) {
                log("certificate not valid (" + e.getMessage() + "), retried without the check");
                return get(target, timeoutMs, hops, true, extra);
            }
            throw e;
        }
        if (status >= 300 && status < 400 && c.getHeaderField("Location") != null && hops < 6) {
            String next = new URL(url, c.getHeaderField("Location")).toString();
            c.disconnect();
            return get(next, timeoutMs, hops + 1, insecure, extra);
        }
        Got g = new Got();
        g.conn = c; g.status = status; g.type = c.getContentType() == null ? "" : c.getContentType();
        InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
        if (in == null) in = new java.io.ByteArrayInputStream(new byte[0]);
        String enc = c.getContentEncoding() == null ? "" : c.getContentEncoding().toLowerCase(Locale.US);
        if (enc.contains("gzip")) in = new GZIPInputStream(in, 65536);
        // A .gz file served as is: opened when its first bytes say gzip
        PushbackInputStream pb = new PushbackInputStream(new BufferedInputStream(in, 65536), 2);
        int b0 = pb.read(), b1 = b0 < 0 ? -1 : pb.read();
        if (b1 >= 0) pb.unread(b1);
        if (b0 >= 0) pb.unread(b0);
        g.in = b0 == 0x1f && b1 == 0x8b ? new GZIPInputStream(pb, 65536) : pb;
        return g;
    }
    private static SSLContext trustAll() {
        try {
            SSLContext s = SSLContext.getInstance("TLS");
            s.init(null, new TrustManager[]{new X509TrustManager() {
                public void checkClientTrusted(X509Certificate[] c, String a) {}
                public void checkServerTrusted(X509Certificate[] c, String a) {}
                public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            }}, new SecureRandom());
            return s;
        } catch (Exception e) { throw new RuntimeException(e); }
    }
    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[65536]; int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        return b.toByteArray();
    }

    /* ---------- XMLTV, read as it arrives ---------- */
    private static final class Prog { long st, sp; String title, desc; }
    private static final class Epg {
        long at, used; int count; volatile boolean ready = false; Exception error;
        final Map<String, List<Prog>> chans = new HashMap<>();
        final Map<String, String> names = new HashMap<>();
    }
    private final ConcurrentHashMap<String, Epg> epgCache = new ConcurrentHashMap<>();
    private static final Pattern BLOCK = Pattern.compile("<(programme|channel)\\b([^>]*)>(.*?)</\\1>", Pattern.DOTALL);
    private static final Pattern ID = Pattern.compile("id=\"([^\"]*)\""), CH = Pattern.compile("channel=\"([^\"]*)\""),
        START = Pattern.compile("start=\"([^\"]*)\""), STOP = Pattern.compile("stop=\"([^\"]*)\""),
        TITLE = Pattern.compile("<title[^>]*>(.*?)</title>", Pattern.DOTALL), DESC = Pattern.compile("<desc[^>]*>(.*?)</desc>", Pattern.DOTALL),
        NAME = Pattern.compile("<display-name[^>]*>(.*?)</display-name>", Pattern.DOTALL),
        TIME = Pattern.compile("^(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})?\\s*([+-]\\d{4})?"),
        CDATA = Pattern.compile("<!\\[CDATA\\[(.*?)\\]\\]>", Pattern.DOTALL), ENT = Pattern.compile("&(amp|lt|gt|quot|apos|#(\\d+)|#x([0-9a-fA-F]+));");

    private static String grab(Pattern p, String s) { Matcher m = p.matcher(s); return m.find() ? m.group(1) : null; }
    static String decodeXml(String s) {
        if (s == null) return "";
        s = CDATA.matcher(s).replaceAll("$1");
        if (s.indexOf('&') < 0) return s.trim();
        Matcher m = ENT.matcher(s);
        StringBuffer b = new StringBuffer();
        while (m.find()) {
            String r;
            if (m.group(2) != null) r = new String(Character.toChars(Integer.parseInt(m.group(2))));
            else if (m.group(3) != null) r = new String(Character.toChars(Integer.parseInt(m.group(3), 16)));
            else switch (m.group(1).toLowerCase(Locale.US)) { case "amp": r = "&"; break; case "lt": r = "<"; break; case "gt": r = ">"; break; case "quot": r = "\""; break; default: r = "'"; }
            m.appendReplacement(b, Matcher.quoteReplacement(r));
        }
        m.appendTail(b);
        return b.toString().trim();
    }
    static long xmltvTime(String s) {
        if (s == null) return 0;
        Matcher m = TIME.matcher(s.trim());
        if (!m.find()) return 0;
        java.util.Calendar c = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"));
        c.clear();
        c.set(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)) - 1, Integer.parseInt(m.group(3)), Integer.parseInt(m.group(4)), Integer.parseInt(m.group(5)), m.group(6) != null ? Integer.parseInt(m.group(6)) : 0);
        long t = c.getTimeInMillis();
        if (m.group(7) != null) {
            String z = m.group(7);
            int sign = z.charAt(0) == '-' ? -1 : 1;
            t -= sign * (Integer.parseInt(z.substring(1, 3)) * 60L + Integer.parseInt(z.substring(3, 5))) * 60000L;
        }
        return t;
    }
    /* Reads a guide block by block; each <channel> or <programme> goes to "each" */
    private interface Blocks { void each(boolean programme, String attrs, String inner); }
    private void readXmltv(String target, int timeoutMs, Blocks each) throws IOException {
        try (Got g = get(target, timeoutMs)) {
            if (g.status != 200) throw new IOException("HTTP " + g.status);
            Reader rd = new InputStreamReader(g.in, StandardCharsets.UTF_8);
            StringBuilder buf = new StringBuilder();
            char[] cb = new char[131072];
            int n;
            while ((n = rd.read(cb)) > 0) {
                buf.append(cb, 0, n);
                if (buf.length() < 262144) continue;
                int last = scan(buf, each);
                buf.delete(0, last);
                if (buf.length() > 4000000) buf.delete(0, buf.length() - 200000);   // a broken file: never grow without end
            }
            scan(buf, each);
        }
    }
    private static int scan(CharSequence buf, Blocks each) {
        Matcher m = BLOCK.matcher(buf);
        int last = 0;
        while (m.find()) { last = m.end(); each.each(m.group(1).equals("programme"), m.group(2), m.group(3)); }
        return last;
    }
    private Epg loadXmltv(String target) throws Exception {
        Epg mine = new Epg(), e = epgCache.putIfAbsent(target, mine);
        if (e != null) {
            synchronized (e) { while (!e.ready) e.wait(1000); }
            if (e.error == null && System.currentTimeMillis() - e.at < 3 * 3600 * 1000L) { e.used = System.currentTimeMillis(); return e; }
            epgCache.remove(target, e);
            return loadXmltv(target);
        }
        final long from = System.currentTimeMillis() - 6 * 3600 * 1000L, to = System.currentTimeMillis() + 3 * 86400 * 1000L;
        log("epg: loading " + redact(target));
        try {
            readXmltv(target, 240000, (programme, attrs, inner) -> {
                if (!programme) {
                    String id = grab(ID, attrs);
                    if (id != null) mine.names.put(decodeXml(id), decodeXml(grab(NAME, inner)));
                    return;
                }
                String ch = decodeXml(grab(CH, attrs));
                long st = xmltvTime(grab(START, attrs)), sp = xmltvTime(grab(STOP, attrs));
                if (ch.isEmpty() || st == 0 || sp < from || st > to) return;
                Prog p = new Prog();
                p.st = st; p.sp = sp; p.title = decodeXml(grab(TITLE, inner));
                String d = decodeXml(grab(DESC, inner)); p.desc = d.length() > 320 ? d.substring(0, 320) : d;
                List<Prog> l = mine.chans.get(ch);
                if (l == null) { l = new ArrayList<>(); mine.chans.put(ch, l); }
                l.add(p); mine.count++;
            });
            for (List<Prog> l : mine.chans.values()) Collections.sort(l, (a, b) -> Long.compare(a.st, b.st));
            mine.at = mine.used = System.currentTimeMillis();
            log("epg: " + mine.count + " programmes, " + mine.chans.size() + " channels");
        } catch (Exception x) {
            mine.error = x; epgCache.remove(target, mine);
            log("epg failed: " + x.getMessage());
            throw x;
        } finally {
            synchronized (mine) { mine.ready = true; mine.notifyAll(); }
        }
        return mine;
    }
    private static void progs(StringBuilder sb, List<Prog> list, long from, long to) {
        sb.append('[');
        boolean first = true;
        for (Prog p : list) {
            if (p.sp <= from || p.st >= to) continue;
            if (!first) sb.append(','); first = false;
            sb.append('[').append(p.st).append(',').append(p.sp).append(',').append(JSONObject.quote(p.title)).append(',').append(JSONObject.quote(p.desc)).append(']');
        }
        sb.append(']');
    }

    /* A channel name reduced to letters and digits, without accents or quality ("France 2 HD" -> "france2").
       js/epg.js and service.js have the same function: all must agree. */
    static String compact(String s) {
        s = s == null ? "" : s.toLowerCase(Locale.ROOT);
        s = Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("[\\u0300-\\u036f]", "");
        s = s.replaceFirst("^\\s*[a-z]{2,3}\\s*[-|:]\\s+", "");
        return s.replaceAll("\\b(uhd|fhd|hd|sd|4k|hevc|h265|raw|backup|\\d{3,4}p)\\b", " ").replace("+", "plus").replaceAll("[^a-z0-9]+", "");
    }
    private String matchXmltv(String target, JSONArray names, long from, long to) throws Exception {
        final Map<String, Boolean> want = new HashMap<>();
        for (int i = 0; i < names.length(); i++) want.put(names.optString(i), true);
        final Map<String, List<String>> idTo = new HashMap<>();
        final Map<String, List<Prog>> out = new HashMap<>();
        final int[] count = {0};
        log("epg match: " + redact(target) + " for " + names.length() + " names");
        readXmltv(target, 180000, (programme, attrs, inner) -> {
            if (!programme) {
                String id = decodeXml(grab(ID, attrs));
                if (id.isEmpty()) return;
                Matcher dn = NAME.matcher(inner);
                while (dn.find()) {
                    String c = compact(decodeXml(dn.group(1)));
                    if (!c.isEmpty() && want.remove(c) != null) {
                        List<String> l = idTo.get(id);
                        if (l == null) { l = new ArrayList<>(); idTo.put(id, l); }
                        l.add(c);
                    }
                }
                return;
            }
            List<String> who = idTo.get(decodeXml(grab(CH, attrs)));
            if (who == null) return;
            long st = xmltvTime(grab(START, attrs)), sp = xmltvTime(grab(STOP, attrs));
            if (st == 0 || sp < from || st > to) return;
            Prog p = new Prog();
            p.st = st; p.sp = sp; p.title = decodeXml(grab(TITLE, inner));
            String d = decodeXml(grab(DESC, inner)); p.desc = d.length() > 320 ? d.substring(0, 320) : d;
            for (String n : who) { List<Prog> l = out.get(n); if (l == null) { l = new ArrayList<>(); out.put(n, l); } l.add(p); }
            count[0]++;
        });
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, List<Prog>> e : out.entrySet()) {
            Collections.sort(e.getValue(), (a, b) -> Long.compare(a.st, b.st));
            if (!first) sb.append(','); first = false;
            sb.append(JSONObject.quote(e.getKey())).append(':');
            progs(sb, e.getValue(), Long.MIN_VALUE, Long.MAX_VALUE);
        }
        log("epg match: " + out.size() + " channels, " + count[0] + " programmes");
        return sb.append('}').toString();
    }

    /* ---------- IMDb ratings: IMDb's daily file (personal and non-commercial use), as in service.js ---------- */
    private static final class Imdb {
        long at; int n; int[] ids; byte[] r;
        double find(String id) {
            int k;
            try { k = Integer.parseInt(id.startsWith("tt") ? id.substring(2) : id); } catch (Exception e) { return 0; }
            int i = Arrays.binarySearch(ids, 0, n, k);
            return i >= 0 ? (r[i] & 0xff) / 10.0 : 0;
        }
    }
    private volatile Imdb imdb = null;
    private final Object imdbLock = new Object();
    private Imdb loadImdb() throws Exception {
        synchronized (imdbLock) {
            if (imdb != null && System.currentTimeMillis() - imdb.at < IMDB_DAY) return imdb;
            File f = new File(ctx.getCacheDir(), "imdb.bin");
            if (f.exists()) {
                try (DataInputStream in = new DataInputStream(new BufferedInputStream(new FileInputStream(f), 65536))) {
                    Imdb t = new Imdb();
                    t.at = in.readLong(); t.n = in.readInt();
                    if (System.currentTimeMillis() - t.at < IMDB_DAY && t.n > 0 && t.n < 10000000) {
                        t.ids = new int[t.n]; t.r = new byte[t.n];
                        for (int i = 0; i < t.n; i++) t.ids[i] = in.readInt();
                        in.readFully(t.r);
                        log("imdb ratings: " + t.n + " titles from the cache");
                        return imdb = t;
                    }
                } catch (Exception ignored) {}
            }
            log("imdb ratings: downloading");
            long[] keys = new long[1 << 21];
            int n = 0;
            try (Got g = get("https://datasets.imdbws.com/title.ratings.tsv.gz", 180000)) {
                if (g.status != 200) throw new IOException("HTTP " + g.status);
                BufferedReader rd = new BufferedReader(new InputStreamReader(g.in, StandardCharsets.UTF_8), 1 << 16);
                String line;
                while ((line = rd.readLine()) != null) {
                    int t1 = line.indexOf('\t'), t2 = t1 < 0 ? -1 : line.indexOf('\t', t1 + 1);
                    if (t1 < 3 || t2 < 0 || !line.startsWith("tt")) continue;
                    try {
                        if (Integer.parseInt(line.substring(t2 + 1).trim()) < 5) continue;     // a handful of votes is not a rating
                        int id = Integer.parseInt(line.substring(2, t1));
                        int rate = (int) Math.round(Double.parseDouble(line.substring(t1 + 1, t2)) * 10);
                        if (id <= 0 || rate <= 0) continue;
                        if (n == keys.length) keys = Arrays.copyOf(keys, keys.length * 2);
                        keys[n++] = (long) id * 256 + rate;
                    } catch (NumberFormatException ignored) {}
                }
            }
            if (n < 1000) throw new IOException("only " + n + " ratings");
            Arrays.sort(keys, 0, n);
            Imdb t = new Imdb();
            t.at = System.currentTimeMillis(); t.n = n; t.ids = new int[n]; t.r = new byte[n];
            for (int i = 0; i < n; i++) { t.r[i] = (byte) (keys[i] % 256); t.ids[i] = (int) (keys[i] / 256); }
            log("imdb ratings: " + n + " titles");
            try (DataOutputStream o = new DataOutputStream(new BufferedOutputStream(new FileOutputStream(f), 65536))) {
                o.writeLong(t.at); o.writeInt(n);
                for (int i = 0; i < n; i++) o.writeInt(t.ids[i]);
                o.write(t.r);
            } catch (Exception ignored) {}
            return imdb = t;
        }
    }
}

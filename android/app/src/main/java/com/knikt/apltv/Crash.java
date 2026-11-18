package com.knikt.apltv;

import android.app.ActivityManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.util.List;

/* What APL TV knows after it stopped without warning, for the page's "Oops" box (js/crash.js):
   - an error no part of the app caught: written to crash.json as it happens (the error and where, the helper's last
     lines, the memory), then Android closes the app as it always did;
   - its page stopped by Android or crashed while on screen (MainActivity.pageGone): the app went on with a new page;
   - Android 11 and later: why Android ended the app last time (memory, a crash in a system part, no answer…).
   The page reads it once at start-up (crashReport) and clears it when the person answered (crashDone). */
final class Crash {
    private Crash() {}
    private static final String FILE = "crash.json";
    private static volatile Helper helper;
    private static volatile JSONObject page;           // the page stopped while on screen, in this run

    /* At start-up, before anything else (MainActivity.onCreate); the helper once it exists (use) */
    static void use(Helper h) { helper = h; }
    static void install(Context ctx) {
        final Context app = ctx.getApplicationContext();
        final Thread.UncaughtExceptionHandler before = Thread.getDefaultUncaughtExceptionHandler();
        if (before instanceof Writer) return;
        Thread.setDefaultUncaughtExceptionHandler(new Writer(app, before));
    }
    private static final class Writer implements Thread.UncaughtExceptionHandler {
        private final Context app; private final Thread.UncaughtExceptionHandler before;
        Writer(Context app, Thread.UncaughtExceptionHandler before) { this.app = app; this.before = before; }
        @Override public void uncaughtException(Thread t, Throwable e) {
            try {
                Helper h = helper;
                if (h != null) h.dropAll();                  // the memory it held: a lack of memory leaves room to write
                StringWriter sw = new StringWriter();
                e.printStackTrace(new PrintWriter(sw));
                String stack = sw.toString();
                JSONObject o = new JSONObject();
                o.put("at", System.currentTimeMillis());
                o.put("thread", t.getName());
                o.put("error", stack.length() > 5000 ? stack.substring(0, 5000) : stack);
                o.put("memory", memory(app));
                if (h != null) o.put("service", h.recent(80));
                try (FileOutputStream f = new FileOutputStream(new File(app.getFilesDir(), FILE))) { f.write(o.toString().getBytes(StandardCharsets.UTF_8)); f.getFD().sync(); }
            } catch (Throwable ignored) {}
            if (before != null) before.uncaughtException(t, e);
            else { android.os.Process.killProcess(android.os.Process.myPid()); System.exit(10); }
        }
    }

    /* MainActivity.pageGone, when the app was on screen */
    static void pageStopped(boolean crashed) {
        try { JSONObject o = new JSONObject(); o.put("crashed", crashed); o.put("at", System.currentTimeMillis()); page = o; } catch (Exception ignored) {}
    }

    /* For the page: { crash, page, exit, memory, service } (each one only when there is one) */
    static String report(Context c) {
        JSONObject o = new JSONObject();
        try {
            File f = new File(c.getFilesDir(), FILE);
            if (f.exists() && f.length() < 200000) {
                byte[] b = new byte[(int) f.length()];
                try (FileInputStream in = new FileInputStream(f)) { int got = 0; while (got < b.length) { int n = in.read(b, got, b.length - got); if (n < 0) break; got += n; } }
                o.put("crash", new JSONObject(new String(b, StandardCharsets.UTF_8)));
            }
            if (page != null) o.put("page", page);
            JSONObject x = lastExit(c);
            if (x != null) o.put("exit", x);
            o.put("memory", memory(c));
            Helper h = helper;
            if (h != null) o.put("service", h.recent(60));
        } catch (Exception ignored) {}
        return o.toString();
    }
    /* The person answered: the same stop is not offered again */
    static void done(Context c) {
        new File(c.getFilesDir(), FILE).delete();
        page = null;
        c.getSharedPreferences("crash", Context.MODE_PRIVATE).edit().putLong("exitSeen", System.currentTimeMillis()).apply();
    }

    /* Android 11 and later: why the app's last process ended, when it was not a normal end */
    private static JSONObject lastExit(Context c) {
        if (Build.VERSION.SDK_INT < 30) return null;
        try {
            ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
            SharedPreferences sp = c.getSharedPreferences("crash", Context.MODE_PRIVATE);
            List<android.app.ApplicationExitInfo> list = am.getHistoricalProcessExitReasons(null, 0, 8);
            for (android.app.ApplicationExitInfo x : list) {
                if (!c.getPackageName().equals(x.getProcessName())) continue;     // the app itself, not its page's processes
                if (x.getTimestamp() <= sp.getLong("exitSeen", 0)) return null;
                String r = reason(x.getReason());
                if (r == null) return null;                                       // its last end was a normal one
                JSONObject o = new JSONObject();
                o.put("reason", r);
                o.put("at", x.getTimestamp());
                if (x.getDescription() != null) o.put("desc", x.getDescription());
                o.put("importance", x.getImportance());                           // 100: on screen
                o.put("pss", x.getPss());
                return o;
            }
        } catch (Exception ignored) {}
        return null;
    }
    private static String reason(int r) {
        switch (r) {
            case 3: return "low memory";                  // REASON_LOW_MEMORY
            case 4: return "crash";                       // REASON_CRASH
            case 5: return "native crash";                // REASON_CRASH_NATIVE
            case 6: return "not responding";              // REASON_ANR
            case 7: return "failed to start";             // REASON_INITIALIZATION_FAILURE
            case 9: return "too much memory or processor"; // REASON_EXCESSIVE_RESOURCE_USAGE
            case 2: return "signaled";                    // REASON_SIGNALED
            case 0: return "unknown";                     // REASON_UNKNOWN
            default: return null;                         // quit, stopped by the person, updated, …
        }
    }

    /* A device with little memory (a Fire TV Stick: 1 GB): the app keeps less (Helper's guides, the video's buffer),
       and the page waits for nothing to play before its heavy work (js/core.js TV.SMALL) */
    /* Settings > Display > Light Mode, from the page (js/core.js TV.SMALL): it wins over the memory figure */
    static volatile Boolean forced = null;
    static boolean small(Context c) { Boolean f = forced; return f != null ? f : lowRam(c); }
    static boolean lowRam(Context c) {
        try {
            ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            return am.isLowRamDevice() || (mi.totalMem > 0 && mi.totalMem < 1600L * 1024 * 1024);
        } catch (Throwable e) { return false; }
    }
    static String memoryJson(Context c) {
        try {
            ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            JSONObject o = new JSONObject();
            o.put("total", mi.totalMem >> 20); o.put("free", mi.availMem >> 20); o.put("small", lowRam(c)); o.put("heap", Runtime.getRuntime().maxMemory() >> 20);
            return o.toString();
        } catch (Exception e) { return "{}"; }
    }

    /* "Java heap 41 of 256 MB · RAM 1.4 of 1.9 GB free · low-RAM device · Android 9" */
    static String memory(Context c) {
        StringBuilder b = new StringBuilder();
        try {
            Runtime rt = Runtime.getRuntime();
            b.append("Java heap ").append((rt.totalMemory() - rt.freeMemory()) >> 20).append(" of ").append(rt.maxMemory() >> 20).append(" MB");
            ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            b.append(" · RAM ").append(String.format(java.util.Locale.US, "%.1f of %.1f GB free", mi.availMem / 1073741824.0, mi.totalMem / 1073741824.0));
            if (am.isLowRamDevice()) b.append(" · low-RAM device");
        } catch (Throwable ignored) {}
        b.append(" · Android ").append(Build.VERSION.RELEASE).append(" (").append(Build.VERSION.SDK_INT).append(")");
        return b.toString();
    }
}

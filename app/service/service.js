/* ============================================================
   service/service.js: APL TV's helper, a Tizen web service (Node).

   1. The phone setup page. The app shows a QR code with
      http://<screen>:8765/?k=<code>. The phone opens it on the home Wi-Fi,
      you type or paste your playlist there, and it goes straight to the
      screen. No outside website: your logins never leave your home.
      The page only accepts a submission with the code shown on the screen,
      and only while the "Add from your phone" page is open on it.
   2. Network work the page cannot do itself, for the app only (requests
      from the screen itself, never from the network):
      /fetch  a provider's answer without CORS headers, gzip opened
      /epg    a TV guide (XMLTV, often .gz, often huge) read here and
              sent back already cut to the channels and hours needed.
   Stops on its own after 15 minutes without a request.
   ============================================================ */
"use strict";

var http = require("http");
var https = require("https");
var zlib = require("zlib");
var os = require("os");
var crypto = require("crypto");

var PORT = 8765, VERSION = "1.0.11";
var IDLE_MS = 15 * 60 * 1000, SESSION_MS = 20 * 60 * 1000;
var UA = "APL TV/" + VERSION + " (" + (global.APLTV_PLATFORM || "Tizen") + ")";

var session = null;           // { token, at }
var pending = [];             // what the phone sent, waiting for the app
var logs = [], devLog = false;
var seenOrigins = {};
var epgCache = {};            // url -> { at, chans: { id: [[start, stop, title, desc]] }, names: { id: name } , icons }
var server = null, idle = null;
var shelf = null;             // what APL Launcher shows from APL TV (Continue Watching, channels), sent by the app

function stopLater() {
    clearTimeout(idle);
    idle = setTimeout(function () {
        try { server.close(); } catch (e) {}
        server = null;                  // on LG the process can stay: the next "start" opens the port again
        try { tizen.application.getCurrentApplication().exit(); } catch (e) {}
    }, IDLE_MS);
}

function lanAddresses() {
    var out = [];
    try {
        var nets = os.networkInterfaces();
        Object.keys(nets).forEach(function (n) { nets[n].forEach(function (a) { if (a.family === "IPv4" && !a.internal) out.push(a.address); }); });
    } catch (e) {}
    return out;
}
function isLocal(req) {
    var a = String(req.socket && req.socket.remoteAddress || "").replace(/^::ffff:/, "");
    return a === "127.0.0.1" || a === "::1" || lanAddresses().indexOf(a) !== -1;
}

/* Security: a website opened in the screen's browser runs on the screen too (127.0.0.1), and must not use
   this service (to reach the home network through /fetch, or read the app's data). Browsers always say
   where a page comes from (Origin): the app's own pages (file://, shown as "null") and the phone page
   served here are let in; any other website is refused. Requests without an Origin are not from a page. */
function originOk(req) {
    var o = String(req.headers.origin || "");
    if (!o || o === "null" || /^(file|app|wgt):/i.test(o)) return true;
    var m = /^https?:\/\/([^\/:]+)(?::(\d+))?$/i.exec(o);
    return !!m && String(m[2] || "80") === String(PORT) && (m[1] === "127.0.0.1" || m[1] === "localhost" || lanAddresses().indexOf(m[1]) !== -1);
}
function cors(res) {
    var o = res._origin;
    if (o) { res.setHeader("Access-Control-Allow-Origin", o); res.setHeader("Vary", "Origin"); }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function send(res, status, body, type) {
    cors(res);
    res.writeHead(status, { "Content-Type": type || "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, max, cb) {
    var chunks = [], size = 0, done = false;
    req.on("data", function (c) { size += c.length; if (size > max) { done = true; req.destroy(); cb(null); return; } chunks.push(c); });
    req.on("end", function () { if (!done) cb(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", function () { if (!done) { done = true; cb(null); } });
}
function query(u) {
    var q = {}, i = u.indexOf("?");
    if (i < 0) return q;
    u.slice(i + 1).split("&").forEach(function (kv) {
        var p = kv.split("=");
        try { q[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || "").replace(/\+/g, " ")); } catch (e) {}
    });
    return q;
}
function log(line) {
    logs.push(new Date().toISOString().slice(11, 19) + " [svc] " + line);
    if (logs.length > 500) logs.shift();
}
function redact(s) {
    return String(s).replace(/(username|password)=([^&\s"]+)/gi, "$1=***").replace(/\/(live|movie|series|timeshift)\/[^\/\s"]+\/[^\/\s"]+\//gi, "/$1/***/***/");
}

/* ---------- outgoing requests (redirects, gzip) ---------- */
var TLS_RETRY = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|DEPTH_ZERO/i;
function get(target, timeoutMs, cb, hops, insecure, extra) {
    hops = hops || 0;
    var lib = /^https:/i.test(target) ? https : http, finished = false;
    function finish(err, res) { if (finished) return; finished = true; clearTimeout(timer); cb(err, res); }
    var timer = setTimeout(function () { try { rq.destroy(); } catch (e) {} finish(new Error("timeout")); }, timeoutMs || 60000);
    var rq;
    try {
        var hd = { "User-Agent": UA, "Accept-Encoding": "gzip", "Accept": "*/*" };
        if (extra) Object.keys(extra).forEach(function (k) { hd[k] = extra[k]; });         // a Stalker portal's own headers
        rq = lib.get(target, { headers: hd, rejectUnauthorized: !insecure }, function (res) {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 6) {
                res.resume();
                clearTimeout(timer); finished = true;
                var next = res.headers.location;
                if (!/^https?:/i.test(next)) next = new URL(next, target).toString();
                get(next, timeoutMs, cb, hops + 1, insecure, extra);
                return;
            }
            var stream = res, enc = String(res.headers["content-encoding"] || "");
            if (/gzip|deflate/i.test(enc)) stream = res.pipe(/gzip/i.test(enc) ? zlib.createGunzip() : zlib.createInflate());
            // A .gz file served as is: open it when its first bytes say gzip
            var first = true, out = new (require("stream").PassThrough)(), gun = null;
            stream.on("data", function (c) {
                if (first) { first = false; if (c[0] === 0x1f && c[1] === 0x8b) { gun = zlib.createGunzip(); gun.on("data", function (d) { out.write(d); }); gun.on("end", function () { out.end(); }); gun.on("error", function (e) { out.destroy(e); }); } }
                if (gun) gun.write(c); else out.write(c);
            });
            stream.on("end", function () { if (gun) gun.end(); else out.end(); });
            stream.on("error", function (e) { out.destroy(e); });
            finish(null, { status: res.statusCode, type: res.headers["content-type"] || "", body: out });
        });
        rq.on("error", function (e) {
            // IPTV providers often have expired or self-made certificates: once more without the check
            if (!insecure && /^https:/i.test(target) && TLS_RETRY.test(String(e.code || e.message))) {
                if (finished) return;
                finished = true; clearTimeout(timer);
                log("certificate not valid (" + (e.code || e.message) + "), retried without the check: " + redact(target).replace(/^(https?:\/\/[^\/]+).*$/, "$1"));
                get(target, timeoutMs, cb, hops, true, extra);
                return;
            }
            finish(e);
        });
    } catch (e) { finish(e); }
}

/* ---------- timeshift: the live channel kept in a buffer, to pause it and go back in it ----------
   The app asks for it (POST /ts/start, local only): the service then reads the channel (MPEG-TS) itself, in pieces
   of about 4 s kept in files (60 min or 400 MB at most, the oldest go first), and the player reads it back from
   here: /ts/stream.ts?t=<time> starts at the piece of that moment and follows the channel as it comes. One channel
   at a time: the provider sees one connection, the service's. */
var TS_DIR = (global.APLTV_TMP || "/tmp") + "/apltv-ts", TS_SEG_MS = 4000, TS_MAX_MS = 60 * 60 * 1000, TS_MAX_BYTES = global.APLTV_TS_MAX || 400 * 1024 * 1024;
var tsRec = null;             // { id, url, segs: [{ n, t, bytes, file, done }], total, rq, res, err, waiters, retries, started }
function tsFile(n) { return TS_DIR + "/s" + n + ".ts"; }
function tsStop() {
    var r = tsRec;
    tsRec = null;
    if (!r) return;
    r.stopped = true;
    try { if (r.rq) r.rq.destroy(); } catch (e) {}
    r.segs.forEach(function (sg) { try { require("fs").unlinkSync(sg.file); } catch (e) {} });
    tsWake(r);
}
function tsWake(r) { var w = r.waiters; r.waiters = []; w.forEach(function (f) { try { f(); } catch (e) {} }); }
function tsOpen(r, target, hops, insecure) {
    var lib = /^https:/i.test(target) ? https : http;
    var rq;
    try {
        rq = lib.get(target, { headers: { "User-Agent": UA, "Accept": "*/*", "Connection": "keep-alive" }, rejectUnauthorized: !insecure }, function (res) {
            if (r.stopped) { res.destroy(); return; }
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 6) {
                res.resume();
                var next = res.headers.location;
                if (!/^https?:/i.test(next)) next = new URL(next, target).toString();
                tsOpen(r, next, hops + 1, insecure);
                return;
            }
            if (res.statusCode !== 200) { res.resume(); tsFail(r, "HTTP " + res.statusCode); return; }
            r.err = ""; r.live = true;
            var rest = null, synced = false;
            res.on("data", function (c) {
                if (r.stopped) return;
                if (rest) { c = Buffer.concat([rest, c]); rest = null; }
                if (!synced) {                                     // start on a packet (0x47 every 188 bytes)
                    var k = 0;
                    while (k + 376 < c.length && !(c[k] === 0x47 && c[k + 188] === 0x47 && c[k + 376] === 0x47)) k++;
                    if (k + 376 >= c.length) { rest = c; return; }
                    c = c.slice(k); synced = true;
                }
                var whole = c.length - (c.length % 188);
                if (whole < c.length) rest = c.slice(whole);
                if (whole) tsWrite(r, c.slice(0, whole));
            });
            res.on("end", function () { if (!r.stopped) tsFail(r, "the channel stopped"); });
            res.on("error", function (e) { if (!r.stopped) tsFail(r, e.message); });
            if (r.onFirst) { var f = r.onFirst; r.onFirst = null; f(null); }
        });
        rq.on("error", function (e) {
            if (r.stopped) return;
            if (!insecure && /^https:/i.test(target) && TLS_RETRY.test(String(e.code || e.message))) { tsOpen(r, target, hops, true); return; }
            tsFail(r, e.message);
        });
        rq.setTimeout(20000, function () { try { rq.destroy(new Error("timeout")); } catch (e) {} });
        r.rq = rq;
    } catch (e) { tsFail(r, e.message); }
}
function tsFail(r, why) {
    r.live = false;
    if (r.onFirst) { var f = r.onFirst; r.onFirst = null; f(new Error(why)); return; }
    // cut while it played: opened again (5 times at most, 2 s apart); what was kept stays
    if (++r.retries > 5) { r.err = why; log("timeshift: gave up (" + why + ")"); tsWake(r); return; }
    log("timeshift: " + why + ", reconnecting");
    setTimeout(function () { if (tsRec === r) tsOpen(r, r.url, 0, false); }, 2000);
}
function tsWrite(r, buf) {
    var fs = require("fs"), now = Date.now(), cur = r.segs[r.segs.length - 1];
    if (!cur || cur.done || now - cur.t >= TS_SEG_MS) {
        if (cur) cur.done = true;
        cur = { n: r.next++, t: now, bytes: 0, done: false };
        cur.file = tsFile(cur.n);
        r.segs.push(cur);
    }
    try { fs.appendFileSync(cur.file, buf); } catch (e) {
        // the screen's memory is full: the buffer gets smaller (the oldest half goes), and goes on
        if (r.segs.length < 6) { tsFail(r, "disk: " + e.message); return; }
        r.max = Math.max(20 * 1024 * 1024, Math.floor(r.total / 2));
        log("timeshift: memory full at " + Math.round(r.total / 1048576) + " MB, buffer now " + Math.round(r.max / 1048576) + " MB");
        while (r.segs.length > 2 && r.total > r.max) { var o = r.segs.shift(); r.total -= o.bytes; try { fs.unlinkSync(o.file); } catch (x) {} }
        try { fs.appendFileSync(cur.file, buf); } catch (e2) { tsFail(r, "disk: " + e2.message); return; }
    }
    cur.bytes += buf.length; r.total += buf.length;
    if (r.retries && now - r.started > 60000) r.retries = 0;
    // the oldest pieces go: 60 min, or 400 MB
    while (r.segs.length > 2 && (r.total > r.max || now - r.segs[0].t > TS_MAX_MS)) {
        var old = r.segs.shift();
        r.total -= old.bytes;
        try { fs.unlinkSync(old.file); } catch (e) {}
    }
    tsWake(r);
}
function tsStart(url, cb) {
    tsStop();
    var fs = require("fs");
    try { fs.mkdirSync(TS_DIR, { recursive: true }); } catch (e) {}
    try { fs.readdirSync(TS_DIR).forEach(function (f) { try { fs.unlinkSync(TS_DIR + "/" + f); } catch (e) {} }); } catch (e) {}
    var r = tsRec = { id: newToken(), url: url, segs: [], next: 0, total: 0, max: TS_MAX_BYTES, waiters: [], retries: 0, started: Date.now(), err: "", live: false };
    var done = false;
    r.onFirst = function (err) { if (done) return; done = true; clearTimeout(t); if (err) { if (tsRec === r) tsStop(); cb(err); } else cb(null, r); };
    var t = setTimeout(function () { if (r.onFirst) r.onFirst(new Error("timeout")); }, 20000);
    log("timeshift: recording " + redact(url).replace(/^(https?:\/\/[^\/]+).*$/, "$1/…"));
    tsOpen(r, url, 0, false);
}
function tsInfo(r) {
    return { id: r.id, live: r.live, err: r.err, from: r.segs.length ? r.segs[0].t : 0, to: Date.now(), bytes: r.total, segs: r.segs.map(function (sg) { return sg.t; }) };
}
/* The buffer from the piece of that moment, then the channel as it comes, until the player closes */
function tsStream(req, res, t) {
    var r = tsRec, fs = require("fs");
    var i = 0;
    while (i + 1 < r.segs.length && r.segs[i + 1].t <= t) i++;
    var sg = r.segs[i], n = sg ? sg.n : 0, pos = 0, fd = null, closed = false, buf = Buffer.alloc(65536);
    cors(res);
    res.writeHead(200, { "Content-Type": "video/mp2t", "Cache-Control": "no-store", "X-Start": String(sg ? sg.t : Date.now()) });
    req.on("close", function () { closed = true; if (fd !== null) { try { fs.closeSync(fd); } catch (e) {} fd = null; } });
    function segOf(k) { for (var j = 0; j < r.segs.length; j++) if (r.segs[j].n === k) return r.segs[j]; return null; }
    function pump() {
        if (closed || tsRec !== r) { try { res.end(); } catch (e) {} return; }
        var cur = segOf(n);
        if (!cur) {                                            // gone (too old), or not there yet
            if (r.segs.length && r.segs[0].n > n) { n = r.segs[0].n; pos = 0; if (fd !== null) { try { fs.closeSync(fd); } catch (e) {} fd = null; } return pump(); }
            if (r.err) { try { res.end(); } catch (e) {} return; }
            r.waiters.push(pump); return;
        }
        if (fd === null) { try { fd = fs.openSync(cur.file, "r"); } catch (e) { r.waiters.push(pump); return; } }
        var got = 0;
        try { got = fs.readSync(fd, buf, 0, buf.length, pos); } catch (e) { got = 0; }
        if (got > 0) {
            pos += got;
            if (res.write(Buffer.from(buf.slice(0, got)))) setImmediate(pump); else res.once("drain", pump);
            return;
        }
        if (cur.done && pos >= cur.bytes) { try { fs.closeSync(fd); } catch (e) {} fd = null; n++; pos = 0; return setImmediate(pump); }
        if (r.err) { try { res.end(); } catch (e) {} return; }
        r.waiters.push(pump);                                  // the newest piece: wait for more
    }
    pump();
}

/* ---------- IMDb ratings ----------
   The app first asks a free per-title source (Cinemeta), which has no rating yet for many new titles.
   IMDb publishes all its ratings once a day (title.ratings.tsv.gz, ~9 MB, for personal and
   non-commercial use): read here once a day, kept compact (title number and rating, ~5 MB, sorted for
   a quick search), and saved in /tmp so a restarted service does not download it again. */
var IMDB_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz", IMDB_FILE = "/tmp/apltv-imdb.bin", IMDB_DAY = 24 * 3600 * 1000;
var imdbTab = null, imdbWaiting = null;
function imdbFind(tab, id) {
    var n = parseInt(String(id).replace(/^tt/, ""), 10);
    if (!(n > 0)) return 0;
    var lo = 0, hi = tab.n - 1;
    while (lo <= hi) {
        var mid = (lo + hi) >> 1, v = tab.ids[mid];
        if (v === n) return tab.r[mid] / 10;
        if (v < n) lo = mid + 1; else hi = mid - 1;
    }
    return 0;
}
function loadImdb(cb) {
    if (imdbTab && Date.now() - imdbTab.at < IMDB_DAY) { cb(null, imdbTab); return; }
    if (imdbWaiting) { imdbWaiting.push(cb); return; }
    imdbWaiting = [cb];
    var fs = require("fs");
    function done(err, tab) {
        if (tab) imdbTab = tab;
        if (err) log("imdb ratings: " + err.message);
        var w = imdbWaiting; imdbWaiting = null;
        w.forEach(function (fn) { fn(imdbTab ? null : err, imdbTab); });
    }
    fs.readFile(IMDB_FILE, function (e, buf) {
        try {
            if (!e && buf.length > 12) {
                var at = buf.readDoubleLE(0), n = buf.readUInt32LE(8);
                if (Date.now() - at < IMDB_DAY && buf.length === 12 + n * 5) {
                    var ids = new Uint32Array(n), r = new Uint8Array(n);
                    new Uint8Array(ids.buffer).set(buf.slice(12, 12 + n * 4));
                    r.set(buf.slice(12 + n * 4));
                    log("imdb ratings: " + n + " titles from /tmp");
                    done(null, { at: at, n: n, ids: ids, r: r });
                    return;
                }
            }
        } catch (x) {}
        download();
    });
    function download() {
        log("imdb ratings: downloading");
        get(IMDB_URL, 180000, function (err, res) {
            if (err) { done(err); return; }
            if (res.status !== 200) { res.body.resume(); done(new Error("HTTP " + res.status)); return; }
            // id * 256 + rating*10 in one number: one native sort puts them in order
            var cap = 1 << 21, keys = new Float64Array(cap), n = 0, rest = "", header = true;
            function line(s) {
                if (header) { header = false; if (s.indexOf("tconst") === 0) return; }
                var t1 = s.indexOf("\t"), t2 = s.indexOf("\t", t1 + 1);
                if (t1 < 3 || t2 < 0) return;
                if (parseInt(s.slice(t2 + 1), 10) < 5) return;               // a handful of votes is not a rating
                var id = parseInt(s.slice(2, t1), 10), rate = Math.round(parseFloat(s.slice(t1 + 1, t2)) * 10);
                if (!(id > 0) || !(rate > 0)) return;
                if (n === cap) { var bigger = new Float64Array(cap * 2); bigger.set(keys); keys = bigger; cap *= 2; }
                keys[n++] = id * 256 + rate;
            }
            res.body.setEncoding("utf8");
            res.body.on("data", function (chunk) {
                var parts = (rest + chunk).split("\n");
                rest = parts.pop();
                for (var i = 0; i < parts.length; i++) line(parts[i]);
            });
            res.body.on("error", function (e) { done(e); });
            res.body.on("end", function () {
                try {
                    if (rest) line(rest);
                    if (n < 1000) { done(new Error("only " + n + " ratings")); return; }
                    var sorted = keys.subarray(0, n);
                    if (sorted.sort) sorted.sort(); else Array.prototype.sort.call(sorted, function (a, b) { return a - b; });
                    var ids = new Uint32Array(n), r = new Uint8Array(n);
                    for (var i = 0; i < n; i++) { var k = sorted[i]; r[i] = k % 256; ids[i] = (k - r[i]) / 256; }
                    keys = null;
                    var tab = { at: Date.now(), n: n, ids: ids, r: r };
                    log("imdb ratings: " + n + " titles");
                    done(null, tab);
                    var out = Buffer.alloc ? Buffer.alloc(12 + n * 5) : new Buffer(12 + n * 5);
                    out.writeDoubleLE(tab.at, 0); out.writeUInt32LE(n, 8);
                    var view = new Uint8Array(out.buffer, out.byteOffset || 0, out.length);
                    view.set(new Uint8Array(ids.buffer, 0, n * 4), 12);
                    view.set(r, 12 + n * 4);
                    fs.writeFile(IMDB_FILE, out, function () {});
                } catch (x) { done(x); }
            });
        });
    }
}

/* ---------- XMLTV, read as it arrives ---------- */
function decodeXml(s) {
    return String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&(amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-f]+));/gi, function (m, n, d, h) {
        if (d) return String.fromCharCode(parseInt(d, 10));
        if (h) return String.fromCharCode(parseInt(h, 16));
        return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[n.toLowerCase()];
    }).trim();
}
function xmltvTime(s) {
    var m = String(s || "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/);
    if (!m) return 0;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    if (m[7]) { var sign = m[7][0] === "-" ? -1 : 1; t -= sign * ((+m[7].slice(1, 3)) * 60 + (+m[7].slice(3, 5))) * 60000; }
    return t;
}
/* Memory: a provider's guide is a few hundred MB once read; the app takes what it needs at once and keeps
   it itself. So a guide is only kept here 10 minutes after its last use (it was 3 h: the service held
   ~200 MB on the M8, and the screen then had to swap). */
var EPG_KEEP_MS = 10 * 60 * 1000;
setInterval(function () {
    Object.keys(epgCache).forEach(function (k) { var c = epgCache[k]; if (c && !c.waiting && Date.now() - (c.used || c.at) > EPG_KEEP_MS) delete epgCache[k]; });
}, 60 * 1000);
function loadXmltv(target, cb) {
    var c = epgCache[target];
    if (c && !c.waiting && Date.now() - c.at < 3 * 3600 * 1000) { c.used = Date.now(); cb(null, c); return; }
    if (c && c.waiting) { c.waiting.push(cb); return; }
    var entry = { at: 0, chans: {}, names: {}, icons: {}, waiting: [cb], count: 0 };
    epgCache[target] = entry;
    var from = Date.now() - 6 * 3600 * 1000, to = Date.now() + 3 * 86400 * 1000;
    log("epg: loading " + redact(target));
    get(target, 240000, function (err, res) {
        function done(e) {
            var w = entry.waiting; entry.waiting = null;
            if (e) { delete epgCache[target]; log("epg failed: " + e.message); }
            else { entry.at = Date.now(); log("epg: " + entry.count + " programmes, " + Object.keys(entry.chans).length + " channels"); }
            w.forEach(function (fn) { fn(e, entry); });
        }
        if (err) { done(err); return; }
        if (res.status !== 200) { res.body.resume(); done(new Error("HTTP " + res.status)); return; }
        var buf = "";
        res.body.setEncoding("utf8");
        res.body.on("data", function (chunk) {
            buf += chunk;
            var re = /<(programme|channel)\b([^>]*)>([\s\S]*?)<\/\1>/g, m, last = 0;
            while ((m = re.exec(buf))) {
                last = re.lastIndex;
                var attrs = m[2], inner = m[3];
                if (m[1] === "channel") {
                    var id = (attrs.match(/id="([^"]*)"/) || [])[1];
                    if (!id) continue;
                    var dn = (inner.match(/<display-name[^>]*>([\s\S]*?)<\/display-name>/) || [])[1];
                    var ic = (inner.match(/<icon[^>]*src="([^"]*)"/) || [])[1];
                    entry.names[decodeXml(id)] = decodeXml(dn);
                    if (ic) entry.icons[decodeXml(id)] = decodeXml(ic);
                    continue;
                }
                var ch = decodeXml((attrs.match(/channel="([^"]*)"/) || [])[1]);
                var st = xmltvTime((attrs.match(/start="([^"]*)"/) || [])[1]), sp = xmltvTime((attrs.match(/stop="([^"]*)"/) || [])[1]);
                if (!ch || !st || sp < from || st > to) continue;
                var title = (inner.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1];
                var desc = (inner.match(/<desc[^>]*>([\s\S]*?)<\/desc>/) || [])[1];
                (entry.chans[ch] = entry.chans[ch] || []).push([st, sp, decodeXml(title), decodeXml(desc).slice(0, 320)]);
                entry.count++;
            }
            buf = buf.slice(last);
            if (buf.length > 4000000) buf = buf.slice(-200000);   // a broken file: never grow without end
        });
        res.body.on("end", function () {
            Object.keys(entry.chans).forEach(function (k) { entry.chans[k].sort(function (a, b) { return a[0] - b[0]; }); });
            done(null);
        });
        res.body.on("error", function (e) { done(e); });
    });
}

/* A channel name reduced to letters and digits, without accents or quality ("France 2 HD" -> "france2").
   epg.js has the same function: both sides must agree. */
function compact(s) {
    s = String(s || "").toLowerCase();
    try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    s = s.replace(/^\s*[a-z]{2,3}\s*[-|:]\s+/, "");          // "IT - Rai 1": the country written before the name
    return s.replace(/\b(uhd|fhd|hd|sd|4k|hevc|h265|raw|backup|\d{3,4}p)\b/g, " ").replace(/\+/g, "plus").replace(/[^a-z0-9]+/g, "");
}
/* A public guide read as it arrives: only the channels whose names the app asked for are kept */
function matchXmltv(target, names, from, to, cb) {
    var want = {}, idTo = {}, out = {}, count = 0;
    names.forEach(function (n) { want[n] = 1; });
    log("epg match: " + redact(target) + " for " + names.length + " names");
    get(target, 180000, function (err, res) {
        if (err) { cb(err); return; }
        if (res.status !== 200) { res.body.resume(); cb(new Error("HTTP " + res.status)); return; }
        var buf = "", done = false;
        res.body.setEncoding("utf8");
        res.body.on("data", function (chunk) {
            buf += chunk;
            var re = /<(programme|channel)\b([^>]*)>([\s\S]*?)<\/\1>/g, m, last = 0;
            while ((m = re.exec(buf))) {
                last = re.lastIndex;
                if (m[1] === "channel") {
                    var id = decodeXml((m[2].match(/id="([^"]*)"/) || [])[1]);
                    if (!id) continue;
                    var dn, dre = /<display-name[^>]*>([\s\S]*?)<\/display-name>/g;
                    while ((dn = dre.exec(m[3]))) {
                        var c = compact(decodeXml(dn[1]));
                        if (c && want[c]) { (idTo[id] = idTo[id] || []).push(c); delete want[c]; }
                    }
                    continue;
                }
                var ch = decodeXml((m[2].match(/channel="([^"]*)"/) || [])[1]), who = idTo[ch];
                if (!who) continue;
                var st = xmltvTime((m[2].match(/start="([^"]*)"/) || [])[1]), sp = xmltvTime((m[2].match(/stop="([^"]*)"/) || [])[1]);
                if (!st || sp < from || st > to) continue;
                var p = [st, sp, decodeXml((m[3].match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]), decodeXml((m[3].match(/<desc[^>]*>([\s\S]*?)<\/desc>/) || [])[1]).slice(0, 320)];
                who.forEach(function (n) { (out[n] = out[n] || []).push(p); });
                count++;
            }
            buf = buf.slice(last);
            if (buf.length > 4000000) buf = buf.slice(-200000);
        });
        res.body.on("end", function () {
            if (done) return; done = true;
            Object.keys(out).forEach(function (k) { out[k].sort(function (a, b) { return a[0] - b[0]; }); });
            log("epg match: " + Object.keys(out).length + " channels, " + count + " programmes");
            cb(null, out);
        });
        res.body.on("error", function (e) { if (!done) { done = true; cb(e); } });
    });
}

/* ---------- the phone page ---------- */
function phoneCss() {
    return "*{box-sizing:border-box;margin:0;padding:0}body{font:17px -apple-system,BlinkMacSystemFont,'SF Pro Text',Roboto,sans-serif;background:#000;color:#fff;" +
        "min-height:100vh;background:radial-gradient(120% 70% at 20% 0%,#1d2639 0%,#0b0d13 55%,#000 100%);padding:28px 20px 60px}" +
        "h1{font-size:34px;font-weight:700;letter-spacing:-.5px;margin:18px 0 6px}h1 span{color:rgba(255,255,255,.6);font-weight:400}p.sub{color:rgba(255,255,255,.62);margin-bottom:26px;line-height:1.4}" +
        ".seg{display:flex;background:rgba(118,118,128,.24);border-radius:12px;padding:3px;margin-bottom:22px}.seg button{flex:1;border:0;background:none;color:#fff;font:600 15px inherit;padding:10px 2px;border-radius:9px}" +
        ".seg button.on{background:rgba(255,255,255,.9);color:#000}.card{background:rgba(255,255,255,.08);border-radius:16px;overflow:hidden;margin-bottom:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.12)}" +
        "label{display:block;padding:12px 16px 0;font-size:13px;color:rgba(255,255,255,.55);text-transform:uppercase;letter-spacing:.6px}" +
        "input{width:100%;border:0;background:none;color:#fff;font:17px inherit;padding:6px 16px 14px;outline:none}.card+.card{margin-top:0}.row{border-top:1px solid rgba(255,255,255,.08)}" +
        ".hint{font-size:14px;color:rgba(255,255,255,.5);margin:2px 4px 22px;line-height:1.4}button.go{width:100%;border:0;border-radius:14px;background:#fff;color:#000;font:600 18px inherit;padding:16px;margin-top:8px}" +
        "button.go:disabled{opacity:.5}.msg{margin-top:16px;text-align:center;color:#ff6961}.done{text-align:center;padding-top:60px}.done .big{font-size:80px}.done h2{font-size:28px;margin:16px 0 8px}" +
        ".done p{color:rgba(255,255,255,.65)}.hide{display:none}";
}
function phonePage(lang, token, ok) {
    var fr = /^fr/i.test(lang || "");
    function t(en, f) { return fr ? f : en; }
    var css = phoneCss();
    if (!ok) {
        return "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>APL TV</title><style>" + css + "</style></head><body>" +
            "<div class=done><div class=big>⌛</div><h2>" + t("This code has expired", "Ce code a expiré") + "</h2><p>" +
            t("On the screen, open APL TV › Settings › Add a playlist › From your phone, then scan the new code.", "Sur l'écran, ouvre APL TV › Réglages › Ajouter une playlist › Depuis le téléphone, puis scanne le nouveau code.") + "</p></div></body></html>";
    }
    return "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>APL TV</title><style>" + css + "</style></head><body>" +
        "<div id=form><h1>APL <span>TV</span></h1><p class=sub>" + t("Send your playlist to the screen. It goes straight to it on your Wi-Fi, through no other website.", "Envoie ta playlist à l'écran. Elle y va directement par ton Wi-Fi, sans passer par aucun site.") + "</p>" +
        "<div class=seg><button id=bx class=on type=button>Xtream</button><button id=bm type=button>M3U</button><button id=bs type=button>Stalker</button><button id=bj type=button>Jellyfin</button><button id=bp type=button>Plex</button></div>" +
        "<div id=fx><div class=card><label>" + t("Server", "Serveur") + "</label><input id=server inputmode=url autocapitalize=off autocorrect=off placeholder='http://exemple.com:8080'>" +
        "<div class=row><label>" + t("Username", "Identifiant") + "</label><input id=user autocapitalize=off autocorrect=off></div>" +
        "<div class=row><label>" + t("Password", "Mot de passe") + "</label><input id=pass type=password autocapitalize=off autocorrect=off></div></div>" +
        "<p class=hint>" + t("The three details your provider gave you. A get.php link pasted in Server works too.", "Les trois infos données par ton fournisseur. Un lien get.php collé dans Serveur marche aussi.") + "</p></div>" +
        "<div id=fm class=hide><div class=card><label>" + t("Playlist address (M3U)", "Adresse de la playlist (M3U)") + "</label><input id=url inputmode=url autocapitalize=off autocorrect=off placeholder='http://…/playlist.m3u'></div>" +
        "<p class=hint>" + t("Paste the link of your M3U playlist.", "Colle le lien de ta playlist M3U.") + "</p></div>" +
        "<div id=fs class=hide><div class=card><label>" + t("Portal address", "Adresse du portail") + "</label><input id=portal inputmode=url autocapitalize=off autocorrect=off placeholder='http://exemple.com:8080/c/'>" +
        "<div class=row><label>" + t("MAC address", "Adresse MAC") + "</label><input id=mac autocapitalize=characters autocorrect=off placeholder='00:1A:79:12:34:56'></div></div>" +
        "<p class=hint>" + t("The portal (MAG, Ministra) and the MAC address your provider registered.", "Le portail (MAG, Ministra) et l'adresse MAC enregistrée par ton fournisseur.") + "</p></div>" +
        "<div id=fj class=hide><div class=card><label>" + t("Server", "Serveur") + "</label><input id=jserver inputmode=url autocapitalize=off autocorrect=off placeholder='http://192.168.1.20:8096'>" +
        "<div class=row><label>" + t("Username", "Nom d'utilisateur") + "</label><input id=juser autocapitalize=off autocorrect=off></div>" +
        "<div class=row><label>" + t("Password", "Mot de passe") + "</label><input id=jpass type=password autocapitalize=off autocorrect=off></div></div>" +
        "<p class=hint>" + t("Your Jellyfin or Emby server: its address, your user name and your password.", "Ton serveur Jellyfin ou Emby : son adresse, ton nom d'utilisateur et ton mot de passe.") + "</p></div>" +
        "<div id=fp class=hide><p class=hint>" + t("Plex links with a code: tap the button below, a code appears on the TV, then type it on plex.tv/link with this phone.", "Plex se relie avec un code : touche le bouton ci-dessous, un code s'affiche sur la TV, puis tape-le sur plex.tv/link avec ce t\u00E9l\u00E9phone.") + "</p></div>" +
        "<div class=card id=fe><label>" + t("Name (optional)", "Nom (facultatif)") + "</label><input id=name placeholder='" + t("My TV", "Ma TV") + "'>" +
        "<div class=row id=fepg><label>" + t("TV guide address, XMLTV (optional)", "Adresse du guide TV, XMLTV (facultatif)") + "</label><input id=epg inputmode=url autocapitalize=off autocorrect=off></div></div>" +
        "<button class=go id=go type=button>" + t("Send to the screen", "Envoyer à l'écran") + "</button><div class=msg id=msg></div></div>" +
        "<div id=done class='done hide'><div class=big>✓</div><h2>" + t("Sent!", "C'est envoyé !") + "</h2><p id=donep>" + t("Look at your screen: APL TV is loading your playlist.", "Regarde ton écran : APL TV charge ta playlist.") + "</p></div>" +
        "<script>var K=" + JSON.stringify(token).replace(/</g, "\\u003c") + ",mode='xtream';function $(i){return document.getElementById(i)}" +
        "var M={xtream:['bx','fx'],m3u:['bm','fm'],stalker:['bs','fs'],jellyfin:['bj','fj'],plex:['bp','fp']};" +
        "function sw(m){mode=m;for(var k in M){$(M[k][0]).className=k==m?'on':'';$(M[k][1]).className=k==m?'':'hide'}$('fe').className=m=='plex'?'card hide':'card';$('fepg').className=m=='jellyfin'?'row hide':'row';" +
        "$('go').textContent=m=='plex'?" + JSON.stringify(t("Show the Plex code on the TV", "Afficher le code Plex sur la TV")) + ":" + JSON.stringify(t("Send to the screen", "Envoyer \u00E0 l'\u00E9cran")) + "}" +
        "$('bx').onclick=function(){sw('xtream')};$('bm').onclick=function(){sw('m3u')};$('bs').onclick=function(){sw('stalker')};$('bj').onclick=function(){sw('jellyfin')};$('bp').onclick=function(){sw('plex')};" +
        "$('go').onclick=function(){var b={k:K,type:mode,name:$('name').value,epg:$('epg').value};" +
        "if(mode=='xtream'){b.server=$('server').value;b.user=$('user').value;b.pass=$('pass').value;if(!b.server||(!/get\\.php/i.test(b.server)&&(!b.user||!b.pass))){$('msg').textContent=" + JSON.stringify(t("Fill in the server, the username and the password.", "Remplis le serveur, l'identifiant et le mot de passe.")) + ";return}}" +
        "else if(mode=='stalker'){b.portal=$('portal').value;b.mac=$('mac').value;if(!b.portal||b.mac.replace(/[^0-9a-f]/gi,'').length!=12){$('msg').textContent=" + JSON.stringify(t("Fill in the portal and a MAC address like 00:1A:79:12:34:56.", "Remplis le portail et une adresse MAC comme 00:1A:79:12:34:56.")) + ";return}}" +
        "else if(mode=='jellyfin'){b.server=$('jserver').value;b.user=$('juser').value;b.pass=$('jpass').value;b.epg='';if(!b.server||!b.user){$('msg').textContent=" + JSON.stringify(t("Fill in the server's address and your user name.", "Remplis l'adresse du serveur et ton nom d'utilisateur.")) + ";return}}" +
        "else if(mode=='plex'){b.name='';b.epg=''}" +
        "else{b.url=$('url').value;if(!b.url){$('msg').textContent=" + JSON.stringify(t("Paste the playlist's link.", "Colle le lien de la playlist.")) + ";return}}" +
        "$('go').disabled=true;$('msg').textContent='';var x=new XMLHttpRequest();x.open('POST','/submit');x.setRequestHeader('Content-Type','application/json');" +
        "x.onload=function(){if(x.status==200){$('form').className='hide';$('done').className='done';if(mode=='plex')$('donep').textContent=" + JSON.stringify(t("Look at your TV: the Plex code is there. Type it on plex.tv/link.", "Regarde ta TV : le code Plex y est. Tape-le sur plex.tv/link.")) + "}else{$('go').disabled=false;$('msg').textContent=x.status==403?" + JSON.stringify(t("This code has expired: scan the new one on the screen.", "Ce code a expiré : scanne le nouveau sur l'écran.")) + ":" + JSON.stringify(t("The screen did not answer. Is the phone on the same Wi-Fi?", "L'écran n'a pas répondu. Le téléphone est-il sur le même Wi-Fi ?")) + "}};" +
        "x.onerror=function(){$('go').disabled=false;$('msg').textContent=" + JSON.stringify(t("The screen did not answer. Is the phone on the same Wi-Fi?", "L'écran n'a pas répondu. Le téléphone est-il sur le même Wi-Fi ?")) + "};x.send(JSON.stringify(b))};" +
        "</script></body></html>";
}

/* ---------- the phone editor: your categories (hidden, order), your groups of channels, your favorites ----------
   The app sends what it has (POST /edit/start, local only) and gets a code; the phone opens /edit?k=CODE, changes
   things and sends them back (POST /edit/save); the app takes them (GET /edit/pending, local only). The page's
   script (editScript) runs on the phone: it is sent as text. */
var edit = null;              // { token, at, data, saved, wrong }
var EDIT_MS = 30 * 60 * 1000;
function editOk(k) { return !!(edit && k && k === edit.token && Date.now() - edit.at < EDIT_MS); }
function editWrong() { if (edit && ++edit.wrong >= 20) { log("too many wrong editor codes: closed"); edit = null; } }
var EDIT_TEXT = {
    en: { sub: "Hide or move your categories, make your groups of channels, order your favorites. Then send it all to the TV.", cats: "Categories", groups: "Groups", favs: "Favorites",
          live: "TV", movies: "Movies", series: "Series", catsHint: "The switch hides or shows a category everywhere on the TV. \u25B2 \u25BC move it.", none: "Nothing here.",
          groupsHint: "Your own lists of channels, shown in Live TV and the Guide after Favorites.", rename: "Rename", del: "Delete", addChans: "Add channels", newGroup: "New group",
          favsHint: "Your favorite channels, in the order the TV shows them.", noChans: "No channels yet.", search: "Search a channel", done: "Done", noMatch: "No channel with this name.",
          groupName: "Name of the group", delGroup: "Delete the group \u201C{name}\u201D?", send: "Send to the TV", sent: "Sent!", sentHow: "Look at your TV: your changes are there.",
          again: "Keep editing", expired: "This code has expired", expiredHow: "On the TV, open APL TV \u203A Settings \u203A Edit on Your Phone, then scan the new code.",
          noAnswer: "The TV did not answer. Is the phone on the same Wi-Fi?", error: "Something went wrong. Scan the code again.", loading: "Loading your playlist\u2026" },
    fr: { sub: "Masque ou d\u00E9place tes cat\u00E9gories, fais tes groupes de cha\u00EEnes, range tes favoris. Puis envoie tout \u00E0 la TV.", cats: "Cat\u00E9gories", groups: "Groupes", favs: "Favoris",
          live: "TV", movies: "Films", series: "S\u00E9ries", catsHint: "L'interrupteur masque ou affiche une cat\u00E9gorie partout sur la TV. \u25B2 \u25BC la d\u00E9placent.", none: "Rien ici.",
          groupsHint: "Tes propres listes de cha\u00EEnes, dans la TV en direct et le Guide apr\u00E8s les Favoris.", rename: "Renommer", del: "Supprimer", addChans: "Ajouter des cha\u00EEnes", newGroup: "Nouveau groupe",
          favsHint: "Tes cha\u00EEnes favorites, dans l'ordre o\u00F9 la TV les montre.", noChans: "Pas encore de cha\u00EEne.", search: "Chercher une cha\u00EEne", done: "OK", noMatch: "Aucune cha\u00EEne avec ce nom.",
          groupName: "Nom du groupe", delGroup: "Supprimer le groupe \u00AB {name} \u00BB ?", send: "Envoyer \u00E0 la TV", sent: "C'est envoy\u00E9 !", sentHow: "Regarde ta TV : tes changements y sont.",
          again: "Continuer \u00E0 modifier", expired: "Ce code a expir\u00E9", expiredHow: "Sur la TV, ouvre APL TV \u203A R\u00E9glages \u203A Modifier sur ton t\u00E9l\u00E9phone, puis scanne le nouveau code.",
          noAnswer: "La TV n'a pas r\u00E9pondu. Le t\u00E9l\u00E9phone est-il sur le m\u00EAme Wi-Fi ?", error: "Un probl\u00E8me est survenu. Scanne \u00E0 nouveau le code.", loading: "Chargement de ta playlist\u2026" }
};
var EDIT_CSS = ".r{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid rgba(255,255,255,.08)}.card>.r:first-child{border-top:0}" +
    ".r .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.r small{color:rgba(255,255,255,.5);font-size:13px;margin-left:4px}.r.off .n{opacity:.45}" +
    "button.mv{border:0;background:rgba(255,255,255,.1);color:#fff;width:38px;height:34px;border-radius:9px;font-size:14px;flex:none}button.red{color:#ff6961}" +
    "button.sw{border:0;width:51px;height:31px;border-radius:16px;background:rgba(120,120,128,.4);position:relative;flex:none}button.sw i{position:absolute;left:2px;top:2px;width:27px;height:27px;border-radius:14px;background:#fff;transition:left .15s}" +
    "button.sw.on{background:#34c759}button.sw.on i{left:22px}button.sm{border:0;background:rgba(255,255,255,.12);color:#fff;font:600 14px inherit;padding:7px 10px;border-radius:9px;flex:none}" +
    "button.add{display:block;width:100%;border:0;border-top:1px solid rgba(255,255,255,.08);background:none;color:#0a84ff;font:600 16px inherit;padding:13px 14px;text-align:left}" +
    "button.go2{width:100%;border:0;border-radius:14px;background:rgba(255,255,255,.12);color:#fff;font:600 17px inherit;padding:14px;margin:6px 0 14px}.r.head{background:rgba(255,255,255,.05)}" +
    ".bar{position:sticky;bottom:0;padding:16px 0 6px;background:linear-gradient(rgba(0,0,0,0),#000 35%)}.empty{padding:16px;color:rgba(255,255,255,.5);text-align:center}#kinds{margin-top:-8px}" +
    ".ov{position:fixed;left:0;top:0;right:0;bottom:0;background:#0b0d13;overflow:auto;padding:16px 16px 40px;z-index:5}.ovh{display:flex;gap:8px;position:sticky;top:0;background:#0b0d13;padding-bottom:10px;z-index:1}" +
    ".ovh input{flex:1;background:rgba(255,255,255,.1);border-radius:12px;padding:12px 14px}.r.pick .ck{color:#0a84ff;font-size:20px;width:28px;text-align:center;flex:none}.r.pick.on .ck{color:#34c759}";
function editScript() {
    var D = null, tab = "cats", kind = "live", picker = null, byId = {};
    var app = document.getElementById("app");
    function $(id) { return document.getElementById(id); }
    function h(v) { return String(v === null || v === undefined ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; }); }
    function fold(v) { v = String(v || "").toLowerCase(); return v.normalize ? v.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : v; }
    function move(list, i, d) { var j = i + d; if (j < 0 || j >= list.length) return; var t = list[i]; list[i] = list[j]; list[j] = t; }
    function seg(id, items, cur) { return "<div class=seg id=" + id + ">" + items.map(function (it) { return "<button type=button data-v='" + it[0] + "' class='" + (it[0] === cur ? "on" : "") + "'>" + h(it[1]) + "</button>"; }).join("") + "</div>"; }
    function listOf(l) { return l === "f" ? D.favs : D.groups[+l.slice(1)].ids; }
    function chanRows(ids, l) {
        if (!ids.length) return "<div class=empty>" + h(L.noChans) + "</div>";
        return ids.map(function (id, i) {
            var c = byId[id];
            return "<div class=r><span class=n>" + h(c ? c[1] : id) + (c && c[2] ? " <small>" + h(c[2]) + "</small>" : "") + "</span>" +
                "<button class=mv data-a=cup data-l=" + l + " data-i=" + i + ">\u25B2</button><button class=mv data-a=cdown data-l=" + l + " data-i=" + i + ">\u25BC</button>" +
                "<button class='mv red' data-a=cdel data-l=" + l + " data-i=" + i + ">\u2715</button></div>";
        }).join("");
    }
    function draw() {
        var html = "<h1>APL <span>TV</span></h1><p class=sub>" + h(L.sub) + "</p>" + seg("tabs", [["cats", L.cats], ["groups", L.groups], ["favs", L.favs]], tab);
        if (tab === "cats") {
            html += seg("kinds", [["live", L.live], ["movies", L.movies], ["series", L.series]], kind);
            var list = D.kinds[kind] || [];
            html += "<p class=hint>" + h(L.catsHint) + "</p><div class=card>";
            if (!list.length) html += "<div class=empty>" + h(L.none) + "</div>";
            list.forEach(function (c, i) {
                html += "<div class='r" + (c.off ? " off" : "") + "'><span class=n>" + h(c.name) + " <small>" + h(c.count) + "</small></span>" +
                    "<button class=mv data-a=up data-i=" + i + ">\u25B2</button><button class=mv data-a=down data-i=" + i + ">\u25BC</button>" +
                    "<button class='sw" + (c.off ? "" : " on") + "' data-a=sw data-i=" + i + "><i></i></button></div>";
            });
            html += "</div>";
        } else if (tab === "groups") {
            html += "<p class=hint>" + h(L.groupsHint) + "</p>";
            D.groups.forEach(function (g, gi) {
                html += "<div class=card><div class='r head'><span class=n>" + h(g.name) + " <small>" + g.ids.length + "</small></span>" +
                    "<button class=sm data-a=gren data-g=" + gi + ">" + h(L.rename) + "</button><button class='sm red' data-a=gdel data-g=" + gi + ">" + h(L.del) + "</button></div>" +
                    chanRows(g.ids, "g" + gi) + "<button class=add data-a=gadd data-g=" + gi + ">+ " + h(L.addChans) + "</button></div>";
            });
            html += "<button class=go2 data-a=gnew>+ " + h(L.newGroup) + "</button>";
        } else {
            html += "<p class=hint>" + h(L.favsHint) + "</p><div class=card>" + chanRows(D.favs, "f") + "<button class=add data-a=fadd>+ " + h(L.addChans) + "</button></div>";
        }
        html += "<div class=bar><button class=go id=send data-a=send>" + h(L.send) + "</button><div class=msg id=msg></div></div>";
        app.innerHTML = html;
    }
    function drawPicker() {
        var q = fold(picker.q).trim(), list = listOf(picker.target), out = [], all = D.chans || [];
        for (var i = 0; i < all.length && out.length < 150; i++) if (!q || fold(all[i][1]).indexOf(q) >= 0) out.push(all[i]);
        $("res").innerHTML = (out.length ? "" : "<div class=empty>" + h(L.noMatch) + "</div>") + "<div class=card>" + out.map(function (c) {
            var on = list.indexOf(c[0]) >= 0;
            return "<div class='r pick" + (on ? " on" : "") + "' data-id='" + h(c[0]) + "'><span class=n>" + h(c[1]) + " <small>" + h(c[2]) + "</small></span><span class=ck>" + (on ? "\u2713" : "+") + "</span></div>";
        }).join("") + "</div>";
    }
    function openPicker(target) {
        picker = { target: target, q: "" };
        var ov = document.createElement("div");
        ov.className = "ov"; ov.id = "ov";
        ov.innerHTML = "<div class=ovh><input id=q placeholder='" + h(L.search) + "' autocomplete=off autocorrect=off><button class=sm id=ovx data-a=pdone>" + h(L.done) + "</button></div><div id=res></div>";
        document.body.appendChild(ov);
        $("q").oninput = function () { picker.q = this.value; drawPicker(); };
        drawPicker();
        $("q").focus();
    }
    function closePicker() { var ov = $("ov"); if (ov) ov.parentNode.removeChild(ov); picker = null; draw(); }
    function send() {
        var b = { k: K, data: { kinds: {}, groups: D.groups, favs: D.favs } };
        Object.keys(D.kinds).forEach(function (k) { b.data.kinds[k] = D.kinds[k].map(function (c) { return { key: c.key, off: !!c.off }; }); });
        $("send").disabled = true; $("msg").textContent = "";
        var x = new XMLHttpRequest();
        x.open("POST", "/edit/save");
        x.setRequestHeader("Content-Type", "application/json");
        x.onload = function () {
            if (x.status === 200) app.innerHTML = "<div class=done><div class=big>\u2713</div><h2>" + h(L.sent) + "</h2><p>" + h(L.sentHow) + "</p><br><button class=go2 data-a=again>" + h(L.again) + "</button></div>";
            else { $("send").disabled = false; $("msg").textContent = x.status === 403 ? L.expired : L.noAnswer; }
        };
        x.onerror = function () { $("send").disabled = false; $("msg").textContent = L.noAnswer; };
        x.send(JSON.stringify(b));
    }
    document.addEventListener("click", function (e) {
        var t = e.target;
        while (t && t.nodeType === 1 && !(t.getAttribute("data-a") || t.getAttribute("data-v") || t.getAttribute("data-id"))) t = t.parentNode;
        if (!t || t.nodeType !== 1) return;
        var a = t.getAttribute("data-a"), v = t.getAttribute("data-v"), id = t.getAttribute("data-id"), i = +t.getAttribute("data-i"), g = +t.getAttribute("data-g"), l = t.getAttribute("data-l");
        if (picker) {
            if (a === "pdone") { closePicker(); return; }
            if (id !== null) { var pl = listOf(picker.target), k = pl.indexOf(id); if (k >= 0) pl.splice(k, 1); else pl.push(id); drawPicker(); }
            return;
        }
        if (v) { if (t.parentNode.id === "tabs") tab = v; else kind = v; draw(); return; }
        var cats = D.kinds[kind];
        if (a === "up" || a === "down") move(cats, i, a === "up" ? -1 : 1);
        else if (a === "sw") cats[i].off = !cats[i].off;
        else if (a === "cup" || a === "cdown") move(listOf(l), i, a === "cup" ? -1 : 1);
        else if (a === "cdel") listOf(l).splice(i, 1);
        else if (a === "gnew") { var nm = prompt(L.groupName, ""); if (nm && nm.trim()) D.groups.push({ id: "", name: nm.trim().slice(0, 40), ids: [] }); }
        else if (a === "gren") { var nn = prompt(L.groupName, D.groups[g].name); if (nn && nn.trim()) D.groups[g].name = nn.trim().slice(0, 40); }
        else if (a === "gdel") { if (confirm(L.delGroup.replace("{name}", D.groups[g].name))) D.groups.splice(g, 1); }
        else if (a === "gadd") { openPicker("g" + g); return; }
        else if (a === "fadd") { openPicker("f"); return; }
        else if (a === "send") { send(); return; }
        else if (a !== "again") return;
        draw();
    });
    app.innerHTML = "<div class=done><p>" + h(L.loading) + "</p></div>";
    var x = new XMLHttpRequest();
    x.open("GET", "/edit/data?k=" + encodeURIComponent(K));
    x.onload = function () {
        if (x.status !== 200) { app.innerHTML = "<div class=done><div class=big>\u231B</div><h2>" + h(L.expired) + "</h2><p>" + h(L.expiredHow) + "</p></div>"; return; }
        try { D = JSON.parse(x.responseText); } catch (er) { D = null; }
        if (!D || !D.kinds) { app.textContent = L.error; return; }
        D.groups = D.groups || []; D.favs = D.favs || [];
        (D.chans || []).forEach(function (c) { byId[c[0]] = c; });
        draw();
    };
    x.onerror = function () { app.textContent = L.noAnswer; };
    x.send();
}
function editPage(lang, token, ok) {
    var L = EDIT_TEXT[/^fr/i.test(lang || "") ? "fr" : "en"];
    var head = "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>APL TV</title><style>" + phoneCss() + EDIT_CSS + "</style></head><body>";
    if (!ok) return head + "<div class=done><div class=big>\u231B</div><h2>" + L.expired + "</h2><p>" + L.expiredHow + "</p></div></body></html>";
    return head + "<div id=app></div><script>var K=" + JSON.stringify(token).replace(/</g, "\\u003c") + ",L=" + JSON.stringify(L).replace(/</g, "\\u003c") + ";(" + editScript.toString() + ")();</" + "script></body></html>";
}

function newToken() {
    var A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", s = "", b = crypto.randomBytes(8);
    for (var i = 0; i < 8; i++) s += A[b[i] % A.length];
    return s;
}
function sessionOk(k) { return !!(session && k && k === session.token && Date.now() - session.at < SESSION_MS); }
/* A wrong code counts: after 20 the session is closed (the TV shows a new code) */
function wrongCode() { if (session && ++session.wrong >= 20) { log("too many wrong phone codes: session closed"); session = null; pending = []; } }

function handler(req, res) {
    stopLater();
    var u = req.url || "/", path = u.split("?")[0], q = query(u), local = isLocal(req);
    if (!originOk(req)) { log("refused a request from a website: " + String(req.headers.origin).slice(0, 80)); res.writeHead(403); res.end(); return; }
    if (devLog && req.headers.origin && !seenOrigins[req.headers.origin] && Object.keys(seenOrigins).length < 6) { seenOrigins[req.headers.origin] = 1; log("origin seen: " + req.headers.origin); }
    res._origin = req.headers.origin && req.headers.origin !== "null" ? req.headers.origin : (req.headers.origin === "null" ? "null" : "");
    if (req.method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }

    if (path === "/ping") { send(res, 200, { ok: 1, v: VERSION, session: !!session }); return; }

    if (path === "/" || path === "/s") {
        var good = sessionOk(q.k);
        if (q.k && !good) wrongCode();
        send(res, 200, phonePage(req.headers["accept-language"], good ? q.k : "", good), "text/html; charset=utf-8");
        return;
    }
    if (path === "/submit" && req.method === "POST") {
        readBody(req, 20000, function (body) {
            var b = null;
            try { b = JSON.parse(body); } catch (e) {}
            if (!b || !sessionOk(b.k)) { wrongCode(); send(res, 403, { ok: 0 }); return; }
            var item = { type: b.type === "m3u" ? "m3u" : b.type === "stalker" ? "stalker" : b.type === "jellyfin" ? "jellyfin" : b.type === "plex" ? "plex" : "xtream", name: String(b.name || "").slice(0, 80), epg: String(b.epg || "").slice(0, 2000) };
            if (item.type === "m3u") item.url = String(b.url || "").slice(0, 4000);
            else if (item.type === "stalker") { item.portal = String(b.portal || "").slice(0, 400); item.mac = String(b.mac || "").slice(0, 40); }
            else { item.server = String(b.server || "").slice(0, 400); item.user = String(b.user || "").slice(0, 200); item.pass = String(b.pass || "").slice(0, 200); }
            pending.push(item);
            if (pending.length > 5) pending.shift();
            log("phone sent a " + item.type + " source");
            send(res, 200, { ok: 1 });
        });
        return;
    }

    // the phone editor (its page, the playlist it edits, what it sends back)
    if (path === "/edit") {
        var eok = editOk(q.k);
        if (q.k && !eok) editWrong();
        send(res, 200, editPage(req.headers["accept-language"], eok ? q.k : "", eok), "text/html; charset=utf-8");
        return;
    }
    if (path === "/edit/data") {
        if (!editOk(q.k)) { editWrong(); send(res, 403, { error: "expired" }); return; }
        send(res, 200, edit.data, "application/json; charset=utf-8");
        return;
    }
    if (path === "/edit/save" && req.method === "POST") {
        readBody(req, 6000000, function (body) {
            var b = null;
            try { b = JSON.parse(body); } catch (e) {}
            if (!b || !editOk(b.k) || !b.data) { editWrong(); send(res, 403, { ok: 0 }); return; }
            edit.saved = JSON.stringify(b.data);
            log("phone sent playlist changes");
            send(res, 200, { ok: 1 });
        });
        return;
    }

    // Everything below is for the app on this screen only
    if (!local) { send(res, 403, { error: "local only" }); return; }

    if (path === "/edit/start" && req.method === "POST") {
        readBody(req, 8000000, function (body) {
            if (!body) { send(res, 400, { error: "too big" }); return; }
            edit = { token: newToken(), at: Date.now(), data: body, saved: null, wrong: 0 };
            send(res, 200, { token: edit.token, urls: lanAddresses().map(function (a) { return "http://" + a + ":" + PORT + "/edit?k=" + edit.token; }) });
        });
        return;
    }
    if (path === "/edit/pending") {
        if (!editOk(q.k)) { send(res, 200, { data: null, expired: true }); return; }
        var sv = edit.saved; edit.saved = null;
        edit.at = Date.now();                      // the TV still shows the code: it stays valid
        send(res, 200, "{\"data\":" + (sv || "null") + "}", "application/json; charset=utf-8");
        return;
    }
    if (path === "/edit/close") { edit = null; send(res, 200, { ok: 1 }); return; }
    // timeshift (1.0.11)
    if (path === "/ts/start" && req.method === "POST") {
        readBody(req, 20000, function (body) {
            var b = null;
            try { b = JSON.parse(body); } catch (e) {}
            if (!b || !/^https?:\/\//i.test(String(b.url || ""))) { send(res, 400, { error: "no url" }); return; }
            tsStart(String(b.url), function (err, r) { if (err) send(res, 502, { error: err.message }); else send(res, 200, tsInfo(r)); });
        });
        return;
    }
    if (path === "/ts/info") { if (!tsRec || (q.id && q.id !== tsRec.id)) { send(res, 404, { error: "none" }); return; } send(res, 200, tsInfo(tsRec)); return; }
    if (path === "/ts/stream.ts") {
        if (!tsRec || (q.id && q.id !== tsRec.id)) { send(res, 404, { error: "none" }); return; }
        tsStream(req, res, +q.t || Date.now());
        return;
    }
    if (path === "/ts/stop") { tsStop(); send(res, 200, { ok: 1 }); return; }

    if (path === "/session" && req.method === "POST") {
        session = { token: newToken(), at: Date.now(), wrong: 0 };
        pending = [];
        send(res, 200, { token: session.token, urls: lanAddresses().map(function (a) { return "http://" + a + ":" + PORT + "/?k=" + session.token; }) });
        return;
    }
    if (path === "/session/close") { session = null; pending = []; send(res, 200, { ok: 1 }); return; }
    if (path === "/pending") {
        if (!sessionOk(q.k)) { send(res, 200, { items: [], expired: true }); return; }
        var items = pending; pending = [];
        send(res, 200, { items: items });
        return;
    }
    /* A request with the headers a Stalker (MAG) portal wants: the TV's browser refuses to send a Cookie or
       a User-Agent of its own. Body: { url, headers }. Local only, like everything here. */
    if (path === "/sget" && req.method === "POST") {
        readBody(req, 20000, function (body) {
            var b = null;
            try { b = JSON.parse(body); } catch (e) {}
            if (!b || !/^https?:\/\//i.test(b.url || "")) { send(res, 400, { error: "bad request" }); return; }
            var hd = {};
            Object.keys(b.headers || {}).forEach(function (k) { if (/^(cookie|user-agent|x-user-agent|authorization|referer|accept-language)$/i.test(k)) hd[k] = String(b.headers[k]).slice(0, 2000); });
            get(b.url, parseInt(b.t, 10) || 60000, function (err, r) {
                if (err) { log("stalker request failed " + redact(b.url) + ": " + err.message); send(res, 502, { error: err.message }); return; }
                cors(res);
                res.writeHead(r.status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
                r.body.pipe(res);
                r.body.on("error", function () { try { res.end(); } catch (e) {} });
            }, 0, false, hd);
        });
        return;
    }
    if (path === "/fetch") {
        if (!/^https?:\/\//i.test(q.u || "")) { send(res, 400, { error: "bad url" }); return; }
        get(q.u, parseInt(q.t, 10) || 120000, function (err, r) {
            if (err) { log("fetch failed " + redact(q.u) + ": " + err.message); send(res, 502, { error: err.message }); return; }
            cors(res);
            res.writeHead(r.status, { "Content-Type": /json/i.test(r.type) ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "Cache-Control": "no-store" });
            r.body.pipe(res);
            r.body.on("error", function () { try { res.end(); } catch (e) {} });
        });
        return;
    }
    if (path === "/epg" && req.method === "POST") {
        readBody(req, 4000000, function (body) {
            var b = null;
            try { b = JSON.parse(body); } catch (e) {}
            if (!b || !/^https?:\/\//i.test(b.url || "")) { send(res, 400, { error: "bad request" }); return; }
            loadXmltv(b.url, function (err, e) {
                if (err) { send(res, 502, { error: err.message }); return; }
                var from = b.from || Date.now() - 3 * 3600 * 1000, to = b.to || Date.now() + 24 * 3600 * 1000;
                var want = b.ids || Object.keys(e.chans), out = {}, names = {};
                want.forEach(function (id) {
                    var list = e.chans[id];
                    if (list) out[id] = list.filter(function (p) { return p[1] > from && p[0] < to; });
                });
                if (b.names) names = e.names;
                send(res, 200, { chans: out, names: names, total: e.count });
            });
        });
        return;
    }
    if (path === "/imdb" && req.method === "POST") {
        readBody(req, 200000, function (body) {
            var b = null;
            try { b = JSON.parse(body); } catch (e) {}
            if (!b || !b.ids || !b.ids.length) { send(res, 400, { error: "bad request" }); return; }
            loadImdb(function (err, tab) {
                if (err || !tab) { send(res, 502, { error: (err && err.message) || "no ratings" }); return; }
                var out = {};
                b.ids.slice(0, 2000).forEach(function (id) { var r = imdbFind(tab, id); if (r) out[id] = r; });
                send(res, 200, { ratings: out, at: tab.at });
            });
        });
        return;
    }
    if (path === "/epg/match" && req.method === "POST") {
        readBody(req, 2000000, function (body) {
            var b = null;
            try { b = JSON.parse(body); } catch (e) {}
            if (!b || !/^https?:\/\//i.test(b.url || "") || !b.names) { send(res, 400, { error: "bad request" }); return; }
            matchXmltv(b.url, b.names, b.from || Date.now() - 4 * 3600 * 1000, b.to || Date.now() + 26 * 3600 * 1000, function (err, out) {
                if (err) { send(res, 502, { error: err.message }); return; }
                send(res, 200, { chans: out });
            });
        });
        return;
    }
    /* APL Launcher's Top Shelf: the app sends it (local only); the launcher on the same screen reads it.
       Kept in /tmp too, so it can be read while the service is asleep. No addresses or credentials in it. */
    if (path === "/shelf" && req.method === "POST") {
        if (!local) { send(res, 403, { error: "local only" }); return; }
        readBody(req, 200000, function (body) {
            try { shelf = JSON.parse(body); require("fs").writeFile("/tmp/apltv-shelf.json", JSON.stringify(shelf), function () {}); send(res, 200, { ok: 1 }); }
            catch (e) { send(res, 400, { error: "bad shelf" }); }
        });
        return;
    }
    if (path === "/shelf") {
        if (!local) { send(res, 403, { error: "local only" }); return; }
        if (shelf) { send(res, 200, shelf); return; }
        require("fs").readFile("/tmp/apltv-shelf.json", "utf8", function (err, txt) {
            if (err) { send(res, 404, { error: "no shelf yet" }); return; }
            try { shelf = JSON.parse(txt); send(res, 200, shelf); } catch (e) { send(res, 404, { error: "no shelf yet" }); }
        });
        return;
    }
    if (path === "/log" && req.method === "POST") {
        readBody(req, 200000, function (body) {
            try { var b = JSON.parse(body); devLog = !!b.dev; (b.lines || []).forEach(function (l) { logs.push(String(l)); }); while (logs.length > 500) logs.shift(); } catch (e) {}
            send(res, 200, { ok: 1 });
        });
        return;
    }
    send(res, 404, { error: "not found" });
}

/* While testing, the PC reads the app's log here (only when the app turned it on) */
function devHandler(req, res) {
    var path = (req.url || "/").split("?")[0];
    if (path === "/dev/log" && devLog) { send(res, 200, logs.map(redact).join("\n"), "text/plain; charset=utf-8"); return true; }
    // Test remote (development builds only): keys go to the app itself, not through the screen's input devices
    if (path === "/dev/key" && devLog && req.method === "POST") {
        readBody(req, 4000, function (body) {
            try { var b = JSON.parse(body); (b.keys || []).forEach(function (k) { devKeys.push(k); }); } catch (e) {}
            send(res, 200, { ok: 1, queued: devKeys.length });
        });
        return true;
    }
    if (path === "/dev/keys" && isLocal(req)) { var k = devKeys; devKeys = []; send(res, 200, { keys: k }); return true; }
    // Test of the automatic updates (development builds only): a version put in /tmp/apltv-update from the PC
    var um = /^\/dev\/update\/((?:js|css)\/[\w.-]+\.(?:js|css)|version\.json)$/.exec(path);
    if (um && devLog && req.method === "GET" && isLocal(req)) {
        require("fs").readFile("/tmp/apltv-update/" + um[1], "utf8", function (err, txt) {
            if (err) send(res, 404, { error: "not found" }); else send(res, 200, txt, "text/plain; charset=utf-8");
        });
        return true;
    }
    return false;
}
var devKeys = [];

function start() {
    if (server) return;
    server = http.createServer(function (req, res) {
        try { if (devHandler(req, res)) return; handler(req, res); }
        catch (e) { log("error " + e.message); try { send(res, 500, { error: e.message }); } catch (e2) {} }
    });
    server.on("error", function (e) { log("server: " + e.message); });
    server.listen(PORT, "0.0.0.0", function () { log("listening on " + PORT); });
    stopLater();
}

module.exports.start = function () { start(); stopLater(); };
module.exports.phonePage = phonePage;      // tools/make-android.py: the same phone page for the Android helper
module.exports.editPage = editPage;        // and the phone editor
module.exports.onStart = function () { start(); };
module.exports.onRequest = function () { start(); };
module.exports.onExit = function () { clearTimeout(idle); try { server.close(); } catch (e) {} server = null; };
if (!global.APLTV_NO_START) { try { start(); } catch (e) {} }

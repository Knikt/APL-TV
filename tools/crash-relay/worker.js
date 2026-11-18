/* APL TV's crash reports: the relay between the app and a private GitHub repository (Cloudflare Workers, free plan).

   The app never holds a GitHub key: its code is public, anyone could read it and use it. It sends its report here,
   and this Worker, which keeps the key as a secret, opens an issue in the private repository. The same crash again
   (same error, same version, same kind of TV) becomes a comment on its first issue instead of a new one.

   Settings of the Worker (Settings › Variables and Secrets), see README.md:
     GITHUB_TOKEN  secret  a fine-grained token: only the private repository, "Issues: Read and write"
     REPO          text    owner/name of the private repository, e.g. Knikt/apl-tv-crashes
   Binding (optional but advised): CRASH_KV, a KV namespace. With it, the limits below hold for every copy of the
   Worker and the same crash is recognised for 30 days; without it, only within one copy, for a while.

   The app only sends after the person said yes (or chose "Always Send"), without passwords or playlist
   addresses (js/core.js TV.redact); they are cut out here again, in case. */

const MAX_BYTES = 48 * 1024;         // a report is about 15 KB
const PER_SCREEN_HOUR = 6;           // reports per address (IP) and per hour
const PER_DAY = 300;                 // reports per day in all: past that, the next day
const SAME_DAYS = 30;                // how long the same crash keeps adding to its issue
const PLATFORMS = ["android", "tizen", "webos", "preview"];

export default {
    async fetch(req, env) {
        const url = new URL(req.url);
        if (req.method === "OPTIONS") return answer(null, 204);
        if (req.method === "GET" && url.pathname === "/") return answer("APL TV crash reports: ready" + (env.GITHUB_TOKEN && env.REPO ? "" : " (GITHUB_TOKEN or REPO missing)"), 200, "text/plain");
        if (req.method !== "POST" || url.pathname !== "/report") return answer({ error: "not found" }, 404);
        if (!env.GITHUB_TOKEN || !env.REPO) return answer({ error: "the relay is not set up" }, 503);

        const length = Number(req.headers.get("Content-Length") || 0);
        if (length > MAX_BYTES) return answer({ error: "too big" }, 413);
        const text = await req.text();
        if (text.length > MAX_BYTES) return answer({ error: "too big" }, 413);
        let r;
        try { r = JSON.parse(text); } catch (e) { return answer({ error: "not a report" }, 400); }
        const rep = clean(r);
        if (!rep) return answer({ error: "not a report" }, 400);

        const kv = env.CRASH_KV || null;
        const ip = req.headers.get("CF-Connecting-IP") || "?";
        const now = new Date(), hour = now.toISOString().slice(0, 13), day = now.toISOString().slice(0, 10);
        if (await seen(kv, "id:" + rep.id)) return answer({ ok: 1, again: 1 }, 200);        // sent twice (a retry)
        if (await count(kv, "ip:" + ip + ":" + hour, 3600) > PER_SCREEN_HOUR) return answer({ error: "too many reports, later" }, 429);
        if (await count(kv, "day:" + day, 86400) > PER_DAY) return answer({ error: "too many reports today" }, 429);

        // a report sent from Settings is about one person's problem: always its own issue
        const sig = await hash([rep.platform, rep.version, rep.kind, rep.kind === "report" ? rep.id : signature(rep.reason)].join("|"));
        const first = await get(kv, "sig:" + sig);
        let res;
        if (first) res = await github(env, "POST", "/issues/" + first + "/comments", { body: commentBody(rep) });
        if (!first || (res && res.status === 404 || res && res.status === 410)) {
            res = await github(env, "POST", "/issues", { title: title(rep), body: issueBody(rep) });
            if (res.ok) { const made = await res.json(); await put(kv, "sig:" + sig, String(made.number), SAME_DAYS * 86400); }
        }
        if (!res.ok) return answer({ error: "GitHub said " + res.status }, 502);
        await put(kv, "id:" + rep.id, "1", 7 * 86400);
        return answer({ ok: 1 }, 200);
    }
};

/* ---------- what is accepted ---------- */
function str(v, max) { return typeof v === "string" ? redact(v).slice(0, max) : typeof v === "number" && isFinite(v) ? String(v).slice(0, max) : ""; }
function clean(r) {
    if (!r || typeof r !== "object" || r.app !== "APL TV") return null;
    if (!/^[a-z0-9]{6,40}$/i.test(String(r.id || ""))) return null;
    if (!/^\d+(\.\d+){0,3}$/.test(String(r.version || ""))) return null;
    const platform = PLATFORMS.indexOf(r.platform) >= 0 ? r.platform : null;
    if (!platform) return null;
    const lines = Array.isArray(r.lines) ? r.lines.slice(-200).map((l) => str(l, 400)) : [];
    const javaLines = Array.isArray(r.serviceLines) ? r.serviceLines.slice(-100).map((l) => str(l, 400)) : [];
    return {
        id: String(r.id), version: String(r.version), platform,
        installed: str(r.installed, 20), apk: str(r.apk, 20), model: str(r.model, 80), os: str(r.os, 160), lang: str(r.lang, 8),
        kind: ["crash", "closed", "page", "memory", "test", "report"].indexOf(r.kind) >= 0 ? r.kind : "closed",
        reason: str(r.reason, 6000), why: str(r.why, 200), memory: str(r.memory, 300), upFor: Math.max(0, Math.min(1e7, Number(r.upFor) || 0)),
        when: str(r.when, 30), screen: str(r.screen, 40), playing: str(r.playing, 20),
        lines, javaLines
    };
}
/* Never a password or a provider's address, even if a line slipped through: the same as the app's TV.redact */
function redact(s) {
    return String(s)
        .replace(/(username|password|user|pass|token|key|api_key|mac)=([^&\s"]+)/gi, "$1=***")
        .replace(/\/(live|movie|series|timeshift)\/[^\/\s"]+\/[^\/\s"]+\//gi, "/$1/***/***/")
        .replace(/\/\/[^\/\s"@]+:[^\/\s"@]+@/g, "//***@")
        .replace(/\b([0-9A-F]{2}:){5}[0-9A-F]{2}\b/gi, "**:**:**:**:**:**");      // a MAG box's MAC address
}
/* The error without what changes each time (numbers, addresses): the same crash has the same signature */
function signature(reason) {
    const first = String(reason || "").split("\n").filter((l) => l.trim())[0] || "";
    return first.replace(/0x[0-9a-f]+/gi, "#").replace(/\d+/g, "#").slice(0, 200);
}

/* ---------- the issue ---------- */
const KIND = { crash: "Crash", closed: "Closed unexpectedly", page: "Page stopped", memory: "Closed: low memory", test: "Test", report: "Report" };
function title(r) {
    const first = (String(r.reason || "").split("\n").filter((l) => l.trim())[0] || r.why || "").slice(0, 90);
    return safe("[" + r.platform + " " + r.version + "] " + KIND[r.kind] + (first ? ": " + first : "") + (r.model ? " · " + r.model : "")).slice(0, 180);
}
function issueBody(r) {
    return [
        "| | |", "|---|---|",
        "| What | " + cell(KIND[r.kind] + (r.why ? " (" + r.why + ")" : "")) + " |",
        "| APL TV | " + cell(r.version + (r.installed && r.installed !== r.version ? " (installed " + r.installed + ")" : "") + (r.apk ? ", package " + r.apk : "")) + " |",
        "| Screen | " + cell(r.platform + (r.model ? ", " + r.model : "") + (r.os ? ", " + r.os : "")) + " |",
        "| Memory | " + cell(r.memory || "?") + " |",
        "| Language | " + cell(r.lang || "?") + " |",
        "| When | " + cell((r.when || "?") + ", " + Math.round(r.upFor / 60) + " min after APL TV started") + " |",
        "| On screen | " + cell((r.screen || "?") + (r.playing ? ", playing " + r.playing : "")) + " |",
        "", r.reason ? "### What the screen said\n\n" + block(r.reason) : "",
        r.javaLines.length ? "### The app's helper (last lines)\n\n" + block(r.javaLines.join("\n")) : "",
        "### APL TV's log (last lines)\n\n" + block(r.lines.join("\n") || "(empty)"),
        "", "_Report " + r.id + ", sent by the person from the app._"
    ].join("\n");
}
function commentBody(r) {
    return "Again: " + r.version + " on " + r.platform + (r.model ? ", " + r.model : "") + (r.memory ? " (" + r.memory + ")" : "") + ", " + Math.round(r.upFor / 60) + " min after start.\n\n" +
        "<details><summary>Log</summary>\n\n" + block(r.lines.slice(-60).join("\n")) + (r.reason ? "\n\n" + block(r.reason) : "") + "\n</details>";
}
/* Markdown that can't break out of its block nor call anyone (@name) */
function safe(s) { return String(s).replace(/@/g, "@​").replace(/[\r\n]+/g, " "); }
function cell(s) { return safe(s).replace(/\|/g, "\\|"); }
function block(s) { return "```\n" + String(s).replace(/```/g, "ʼʼʼ").replace(/@/g, "@​") + "\n```"; }

/* ---------- GitHub ---------- */
function github(env, method, path, body) {
    return fetch("https://api.github.com/repos/" + env.REPO + path, {
        method,
        headers: { "Authorization": "Bearer " + env.GITHUB_TOKEN, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
                   "User-Agent": "apl-tv-crash-relay", "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
}

/* ---------- limits (KV when bound, else this copy's memory) ---------- */
const mem = new Map();
async function get(kv, k) {
    if (kv) return kv.get(k);
    const e = mem.get(k);
    return e && e.until > Date.now() ? e.v : null;
}
async function put(kv, k, v, ttl) {
    if (kv) return kv.put(k, v, { expirationTtl: Math.max(60, ttl) });
    if (mem.size > 5000) mem.clear();
    mem.set(k, { v, until: Date.now() + ttl * 1000 });
}
async function seen(kv, k) { return !!(await get(kv, k)); }
async function count(kv, k, ttl) {
    const n = Number(await get(kv, k) || 0) + 1;
    await put(kv, k, String(n), ttl);
    return n;
}
async function hash(s) {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(d).slice(0, 12)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function answer(body, status, type) {
    const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Cache-Control": "no-store" };
    if (body === null) return new Response(null, { status, headers: h });
    h["Content-Type"] = type || "application/json; charset=utf-8";
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: h });
}

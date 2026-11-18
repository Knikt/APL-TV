// APL TV's crash relay (worker.js) on this PC, GitHub replaced by a fake that writes the issues to a file.
//   node local.mjs --test      the checks (no network)
//   node local.mjs [port]      a test relay on http://127.0.0.1:8788 for a development build of APL TV
//                              (localStorage apltv.crashRelay); the issues it would open go to crash-relay-issues.md
//                              in the system's temporary folder
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const test = process.argv[2] === "--test", port = Number(process.argv[2]) || 8788;
const copy = path.join(os.tmpdir(), "apl-tv-crash-worker.mjs");
fs.copyFileSync(path.join(here, "worker.js"), copy);
const worker = (await import(pathToFileURL(copy).href + "?" + Date.now())).default;
const out = path.join(os.tmpdir(), "crash-relay-issues.md");
let next = 1;
const calls = [];
globalThis.fetch = async (url, o) => {
    const b = JSON.parse(o.body);
    calls.push({ url, auth: o.headers.Authorization, b });
    fs.appendFileSync(out, "\n\n=============== " + o.method + " " + url + "\n" + (b.title ? "TITLE: " + b.title + "\n\n" : "") + b.body + "\n");
    if (/\/comments$/.test(url)) return new Response(JSON.stringify({ id: 1 }), { status: 201 });
    return new Response(JSON.stringify({ number: next++ }), { status: 201 });
};
const env = { GITHUB_TOKEN: "fake-token", REPO: "Knikt/apl-tv-crashes" };

if (test) {
    let ok = true;
    const expect = (c, what) => { console.log((c ? "OK   " : "FAIL ") + what); if (!c) ok = false; };
    const send = (body, ip) => worker.fetch(new Request("https://relay/report", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "CF-Connecting-IP": ip || "1.2.3.4" } }), env);
    const rep = (id, extra) => Object.assign({ app: "APL TV", id, version: "1.3.0", platform: "android", model: "Amazon AFTSS", kind: "crash",
        reason: "java.lang.OutOfMemoryError: Failed to allocate a 96 byte allocation with 101168 free bytes\n\tat com.knikt.apltv.Helper.scan(Helper.java:857)",
        lines: ["17:00:01 play http://prov.example:8080/live/john/secret123/42.ts?token=abc", "17:00:02 hello @someone ``` break out", "x | y"] }, extra || {});
    let r = await send(rep("aaaaaa1"));
    expect(r.status === 200 && calls.length === 1 && /\/issues$/.test(calls[0].url), "a report opens an issue (" + r.status + ")");
    expect(calls[0].auth === "Bearer fake-token", "the key stays in the relay");
    const body = calls[0].b.body;
    expect(!/john|secret123|token=abc/.test(body), "credentials cut out again");
    expect(!/@someone/.test(body) && !/``` break/.test(body), "no mention, no way out of the code block");
    expect(/OutOfMemoryError/.test(calls[0].b.title) && /android 1\.3\.0/.test(calls[0].b.title), "title: " + calls[0].b.title);
    r = await send(rep("aaaaaa1"));
    expect(r.status === 200 && calls.length === 1, "the same report twice: once");
    r = await send(rep("bbbbbb2", { reason: "java.lang.OutOfMemoryError: Failed to allocate a 2048 byte allocation with 999 free bytes\n\tat x" }));
    expect(r.status === 200 && calls.length === 2 && /\/issues\/1\/comments$/.test(calls[1].url), "the same crash again: a comment on its issue");
    r = await send(rep("cccccc3", { version: "1.3.1" }));
    expect(calls.length === 3 && /\/issues$/.test(calls[2].url), "another version: a new issue");
    r = await send({ app: "APL TV", id: "dddddd4", version: "1.3.0", platform: "android", lines: [] });
    expect(r.status === 200, "a report without a reason (closed without warning)");
    r = await send("not json"); expect(r.status === 400, "not a report: 400");
    r = await send({ app: "Other", id: "eeeeee5", version: "1", platform: "android" }); expect(r.status === 400, "another app: 400");
    r = await send("x".repeat(60000)); expect(r.status === 413, "too big: 413");
    let last = 0;
    for (let i = 0; i < 8; i++) last = (await send(rep("ffff" + i + "xx", { version: "2.0." + i }), "9.9.9.9")).status;
    expect(last === 429, "too many from one screen in an hour: 429");
    const g = await worker.fetch(new Request("https://relay/"), env);
    expect(g.status === 200, "GET /: " + (await g.text()));
    const o = await worker.fetch(new Request("https://relay/report", { method: "OPTIONS" }), env);
    expect(o.status === 204 && o.headers.get("Access-Control-Allow-Origin") === "*", "OPTIONS: CORS");
    const none = await worker.fetch(new Request("https://relay/report", { method: "POST", body: JSON.stringify(rep("gggggg7")) }), {});
    expect(none.status === 503, "no key set: 503");
    console.log(ok ? "\nall good" : "\nSOME FAILED");
    process.exit(ok ? 0 : 1);
}

http.createServer(async (q, s) => {
    const chunks = [];
    for await (const c of q) chunks.push(c);
    const body = Buffer.concat(chunks);
    const req = new Request("http://relay" + q.url, { method: q.method, headers: Object.assign({}, q.headers, { "CF-Connecting-IP": q.socket.remoteAddress }), body: q.method === "GET" || q.method === "HEAD" ? undefined : body });
    const res = await worker.fetch(req, env);
    const h = {};
    res.headers.forEach((v, k) => { h[k] = v; });
    s.writeHead(res.status, h);
    s.end(Buffer.from(await res.arrayBuffer()));
    console.log(new Date().toTimeString().slice(0, 8), q.method, q.url, "->", res.status, "(" + body.length + " bytes)");
}).listen(port, () => console.log("relay on http://127.0.0.1:" + port + ", issues in " + out));

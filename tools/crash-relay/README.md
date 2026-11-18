# APL TV crash relay

When APL TV stopped unexpectedly, the next start asks the person whether to send a report (js/crash.js). The report
comes here, to a small Cloudflare Worker ([worker.js](worker.js)), which opens an issue in a **private** GitHub
repository. The app never holds a GitHub key: its code is public, so a key in it could be read and used by anyone.
The key stays in the Worker, as a secret.

What the Worker does:

- accepts only APL TV's reports (48 KB at most), 6 per address and per hour, 300 per day in all;
- cuts out passwords, tokens, MAC addresses and providers' addresses again, in case one slipped through;
- the same crash again (same error, same version, same kind of TV) becomes a comment on its first issue, for 30 days;
- a report sent twice (a retry) is only counted once;
- no `@mention` and no way out of the code blocks in what it writes.

## Set it up (once, about 10 minutes)

1. **The private repository.** On GitHub: New repository, for example `apl-tv-crashes`, **Private**.
2. **The key.** GitHub › Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new
   token. Repository access: *Only select repositories* › the private repository. Permissions › Repository
   permissions › **Issues: Read and write** (nothing else). Copy the token: it is shown once.
3. **The Worker.** On [Cloudflare](https://dash.cloudflare.com) (free account): Workers & Pages › Create › Create
   Worker › name it `apl-tv-crash` › Deploy. Then Edit code: replace everything with [worker.js](worker.js) › Deploy.
4. **Its settings.** The Worker › Settings › Variables and Secrets:
   - `GITHUB_TOKEN`, type **Secret**: the token of step 2;
   - `REPO`, type Text: `owner/apl-tv-crashes`.
5. **The memory of the limits (advised).** Storage & Databases › KV › Create a namespace `apl-tv-crash`. Then the
   Worker › Settings › Bindings › Add › KV namespace: variable name `CRASH_KV`, the namespace you made.
6. **Check.** Open `https://apl-tv-crash.<your account>.workers.dev/` in a browser: it says
   `APL TV crash reports: ready`.
7. **In the app.** Put that address in `RELAY` at the top of [app/js/crash.js](../../app/js/crash.js).

The free plan allows 100,000 requests a day, far more than needed.

## Try it on a PC

`node local.mjs --test` runs the Worker's checks with a fake GitHub; `node local.mjs` runs a test relay on port 8788. Development
builds of APL TV can send to a test relay: `localStorage.setItem("apltv.crashRelay", "http://127.0.0.1:8788")`.

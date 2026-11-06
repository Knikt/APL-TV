/* ============================================================
   settings.js: Settings, in APL Launcher's split view (a large icon and
   what the row does on the left, pill rows on the right).
   - Playlists: yours (channels, movies, series counted, Xtream end date),
     add one from your phone (QR code) or with the remote, rename, guide
     address, refresh, delete.
   - Playback, Display, TV guide, About.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, el = TV.el, esc = TV.esc, T = TV.t, D = TV.data;
    var root, heroIcon, heroDesc, listWrap, listEl, nav, pages = [], visible = false, pollTimer = null;

    function build() {
        root = TV.$("v-settings");
        root.innerHTML = "";
        var hero = el("div", "sheet__hero");
        heroIcon = el("div", "sheet__icon");
        heroDesc = el("div", "sheet__desc");
        hero.appendChild(heroIcon); hero.appendChild(heroDesc);
        listWrap = el("div", "sheet__listwrap");
        listEl = el("div", "sheet__list");
        listWrap.appendChild(listEl);
        root.appendChild(hero); root.appendChild(listWrap);
    }

    /* ---------- pages ---------- */
    function fmtCount(src) {
        if (src.error) return T("Error");
        var c = src.counts;
        if (!c) return T("Not loaded");
        var bits = [];
        if (c.live) bits.push(c.live === 1 ? T("1 channel") : T("{n} channels", { n: c.live.toLocaleString(TV.locale) }));
        if (c.movies) bits.push(c.movies === 1 ? T("1 movie") : T("{n} movies", { n: c.movies.toLocaleString(TV.locale) }));
        if (c.series) bits.push(c.series === 1 ? T("1 series") : T("{n} series", { n: c.series.toLocaleString(TV.locale) }));
        return bits.join(" · ") || T("Empty");
    }
    function toggleRow(label, key, desc, after) {
        return { label: label, value: TV.pref(key) ? T("On") : T("Off"), desc: desc, run: function () { TV.setPref(key, !TV.pref(key)); if (after) after(); redraw(); } };
    }
    function mainPage() {
        var rows = [{ section: T("Playlists") }];
        D.sources().forEach(function (s) {
            rows.push({ label: s.name, value: fmtCount(s), acc: "chevron", icon: s.type === "xtream" ? "link" : "list",
                desc: (s.type === "xtream" ? T("Xtream account") : T("M3U playlist")) + (s.error ? "\n" + s.error : "") + (s.at ? "\n" + T("Updated {d}", { d: new Date(s.at).toLocaleString(TV.locale) }) : ""),
                run: function () { push(sourcePage(s.id)); } });
        });
        rows.push({ label: T("Add a Playlist"), acc: "chevron", icon: "plus", desc: T("Your M3U playlist or your Xtream account (server, username, password)."), run: function () { push(addPage()); } });
        rows.push({ section: T("Playback") });
        rows.push(toggleRow(T("Automatic Preview"), "autoPreview", T("In Live TV, staying on a channel plays it behind the list. Off: a channel only plays when you press OK.")));
        rows.push(toggleRow(T("Group HD, FHD and 4K"), "mergeQuality", T("One line per channel, the best quality first. Hold OK on it to choose another."), function () { D.rebuild(); }));
        rows.push({ label: T("Audio Language"), value: langLabel(TV.pref("audioLang")), acc: "chevron", desc: T("The language movies and series start in, when the video has it."),
            run: function () { choose(T("Audio Language"), "audioLang", [["auto", T("Screen Language")], ["orig", T("Original Version")]].concat(langChoices())); } });
        rows.push({ label: T("Second Audio Language"), value: langLabel(TV.pref("audioLang2")), acc: "chevron", desc: T("Used when the first language is not in the video."),
            run: function () { choose(T("Second Audio Language"), "audioLang2", [["none", T("None")], ["orig", T("Original Version")]].concat(langChoices())); } });
        rows.push({ label: T("Subtitles"), value: langLabel(TV.pref("subLang"), true), acc: "chevron", desc: T("Automatic: subtitles in your language only when the sound is in another language."),
            run: function () { choose(T("Subtitles"), "subLang", [["auto", T("Automatic")], ["off", T("Off")]].concat(langChoices())); } });
        rows.push({ label: T("Second Subtitle Language"), value: langLabel(TV.pref("subLang2"), true), acc: "chevron", desc: T("Used when the first subtitle language is not in the video."),
            run: function () { choose(T("Second Subtitle Language"), "subLang2", [["off", T("None")]].concat(langChoices())); } });
        rows.push({ label: T("Subtitle Style"), acc: "chevron", icon: "cc", desc: T("Size, colour, background and position of the subtitles."), run: function () { push(subStylePage()); } });
        rows.push(toggleRow(T("Pick Up Where You Left Off"), "resumePrompt", T("When APL TV opens, it offers the movie or episode you were watching at the minute you stopped, or the last channel.")));
        rows.push(toggleRow(T("Autoplay Next Episode"), "autoNext", T("Off: near the end of an episode, the next one is only offered (with the series' picture, never a spoiler).")));
        rows.push({ label: T("Live Stream Format"), value: TV.pref("liveFormat") === "m3u8" ? "HLS (m3u8)" : "MPEG-TS", desc: T("For Xtream accounts. Try HLS if channels stutter or do not start."),
            run: function () { TV.setPref("liveFormat", TV.pref("liveFormat") === "m3u8" ? "ts" : "m3u8"); redraw(); } });
        rows.push({ section: T("Display") });
        rows.push({ label: T("Adult Content"), value: TV.pref("showAdult") ? T("Shown") : T("Hidden"), desc: T("Categories and channels for adults are hidden everywhere."),
            run: function () {
                if (TV.pref("showAdult")) { TV.setPref("showAdult", false); D.rebuild(); redraw(); return; }
                TV.alert({ title: T("Show adult content?"), message: T("Adult categories will appear in Live TV, Movies, Series and search."), buttons: [
                    { label: T("Cancel") }, { label: T("Show"), run: function () { TV.setPref("showAdult", true); D.rebuild(); redraw(); } }] });
            } });
        rows.push({ label: T("Age Ratings"), value: TV.pref("ageRegion") && TV.pref("ageRegion") !== "auto" ? countryName(TV.pref("ageRegion")) : T("Automatic") + " (" + countryName(TV.meta.ageCountry()) + ")", acc: "chevron",
            desc: T("Each country has its own ratings (France: -12, -16; United States: PG-13, R…). Automatic: the screen's country."),
            run: function () { choose(T("Age Ratings"), "ageRegion", [["auto", T("Automatic")]].concat(TV.meta.ageCountries.map(function (c) { return [c, countryName(c)]; }))); } });
        rows.push({ label: T("Hidden Themes"), value: String(D.themesOn().length), acc: "chevron", icon: "eyeOff",
            desc: T("Choose themes you never want to see: the movies and series TMDB tags with them disappear everywhere."), run: function () { push(themesPage()); } });
        rows.push({ label: T("Hidden Titles"), value: String(D.hiddenList().length), acc: "chevron", icon: "eyeOff", desc: T("Movies and series you chose to hide. OK to see them and bring one back."),
            run: function () { push(hiddenPage()); } });
        rows.push(toggleRow(T("Interface Sounds"), "sounds", T("The sounds of APL Launcher when you move and press OK.")));
        rows.push(toggleRow(T("Animations"), "motion", T("Off: everything appears at once."), applyMotion));
        rows.push({ label: T("Time Format"), value: TV.pref("timeFormat") === "12" ? "12 h" : "24 h", run: function () { TV.setPref("timeFormat", TV.pref("timeFormat") === "12" ? "24" : "12"); redraw(); } });
        rows.push({ label: T("Language"), value: { auto: T("Automatic"), fr: "Français", en: "English" }[TV.pref("language")] || T("Automatic"), desc: T("APL TV restarts in the new language."),
            run: function () {
                var order = ["auto", "fr", "en"], next = order[(order.indexOf(TV.pref("language")) + 1) % 3];
                TV.setPref("language", next);
                setTimeout(function () { global.location.reload(); }, 300);
            } });
        rows.push({ section: T("TV Guide") });
        rows.push({ label: T("Update the TV Guide"), icon: "refresh", desc: T("Downloads the programmes of the next 24 hours again."), run: function () {
            TV.toast(T("Updating the TV guide…"));
            TV.epg.loadAll(true).then(function () { TV.toast(T("TV guide updated")); });
        } });
        rows.push({ section: T("Movie and Series Information") });
        var src = TV.meta.keySource();
        rows.push({ label: T("TMDB Key"), value: src === "setup" ? T("From APL Launcher Setup") : (src ? "••••••••" : T("Not set")), acc: src === "setup" ? undefined : "chevron",
            desc: T("Plots, pictures, ratings, genres and More Like This come from TMDB. Get a free key at themoviedb.org › Settings › API, then type it here."),
            run: function (row) {
                if (src === "setup") return;
                edit(row, { value: TV.load("tmdbKey", ""), onDone: function (v) {
                    v = String(v || "").replace(/\s+/g, "");
                    if (!v) { TV.save("tmdbKey", ""); TV.meta.setKey(""); redraw(); return; }
                    TV.meta.testKey(v).then(function (ok) {
                        if (!ok) { TV.toast(T("TMDB did not accept this key.")); redraw(); return; }
                        TV.save("tmdbKey", v); TV.meta.setKey(v);
                        TV.toast(T("TMDB key saved"));
                        redraw();
                    });
                } });
            } });
        rows.push({ section: T("Voice") });
        var code = TV.voice ? TV.voice.relayCode() : "";
        rows.push({ label: T("Alexa Skill"), value: code ? T("On") : T("Off"), acc: "chevron",
            desc: code ? T("Say: “Alexa, ask APL TV to search Dragon Ball”. The code to put in your APL TV skill:") + "\n" + code
                       : T("With your own APL TV skill for Alexa (see the README): “Alexa, ask APL TV to search Dragon Ball”. Pause, play and next episode work without it."),
            run: function () {
                var items = [{ label: code ? T("New Code") : T("Turn On"), run: function () { TV.voice.newRelayCode(); redraw(); } }];
                if (code) items.push({ label: T("Turn Off"), danger: true, run: function () { TV.voice.setRelayCode(""); redraw(); } });
                TV.menu(T("Alexa Skill"), items);
            } });
        rows.push({ section: T("Updates") });
        rows.push(toggleRow(T("Automatic Updates"), "autoUpdate", T("APL TV checks GitHub every 6 hours and updates itself, then restarts when nothing is playing. Your playlists and settings stay.")));
        rows.push({ label: T("Check for Updates"), icon: "refresh", run: function () { if (TV.updater) TV.updater.check(true); } });
        if (TV.updater && TV.updater.fromBundle()) rows.push({ label: T("Back to the Installed Version"), value: TV.updater.installed(), acc: "chevron",
            desc: T("Runs the version installed with APL Launcher Setup again, until the next update."), run: function () { TV.updater.reset(); } });
        rows.push({ section: T("About") });
        rows.push({ label: T("Refresh All Playlists"), icon: "refresh", run: function () { refreshAll(); } });
        rows.push({ label: "APL TV", value: T("Version {v}", { v: TV.VERSION }), desc: T("Created by Knikt (Gero Corp.)") + "\n" + T("A player for your own playlists. APL TV comes with no channels.") });
        rows.push({ label: T("Credits"), desc: T("Film and series data and pictures: TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.") + "\n" + T("IMDb ratings: Stremio's Cinemeta. Subtitles: OpenSubtitles. TV guides: your provider, epg.pw and iptv-epg.org.") });
        return { title: T("Settings"), icon: "gear", desc: T("Your playlists and how APL TV works."), rows: rows };
    }

    /* ---------- languages, subtitles, hidden titles ---------- */
    function countryName(c) {
        var n = { FR: "France", BE: "Belgique / België", CH: "Suisse / Schweiz", CA: "Canada", US: "United States", GB: "United Kingdom", DE: "Deutschland", ES: "España", IT: "Italia", NL: "Nederland", PT: "Portugal", BR: "Brasil" };
        return n[c] || c;
    }
    function langChoices() { return TV.langs.list.map(function (c) { return [c, TV.langs.name(c)]; }); }
    function langLabel(v, subs) {
        if (v === "auto") return subs ? T("Automatic") : T("Screen Language");
        if (v === "orig") return T("Original Version");
        if (v === "off" || v === "none") return subs ? T("Off") : T("None");
        return TV.langs.name(v);
    }
    function choose(title, key, list, after) {
        TV.menu(title, list.map(function (o) {
            return { label: o[1], check: TV.pref(key) === o[0], run: function () { TV.setPref(key, o[0]); if (after) after(); redraw(); } };
        }));
    }
    function subStylePage() {
        var O = TV.subtitles.options;
        function row(label, key, list) {
            var v = ""; list.forEach(function (o) { if (o[0] === TV.pref(key)) v = T(o[1]); });
            return { label: label, value: v, acc: "chevron", run: function () { choose(label, key, list.map(function (o) { return [o[0], T(o[1])]; }), TV.subtitles.apply); } };
        }
        return { title: T("Subtitle Style"), icon: "cc", desc: T("What subtitles look like in movies and series."), preview: subPreview, rebuild: subStylePage, rows: [
            row(T("Size"), "subSize", O.size), row(T("Colour"), "subColor", O.color), row(T("Background"), "subBg", O.bg), row(T("Position"), "subPos", O.pos)
        ] };
    }
    function subPreview() {
        return "<div class='subprev subSize-" + TV.pref("subSize") + " subColor-" + TV.pref("subColor") + " subBg-" + TV.pref("subBg") + " subPos-" + TV.pref("subPos") + "'>" +
            "<div class='osd__subs'><span>" + esc(T("This is how subtitles look.")) + "</span></div></div>";
    }
    function themesPage() {
        var on = D.themesOn();
        var rows = TV.meta.themes().map(function (t) {
            var hid = on.indexOf(t.id) >= 0;
            return { label: t.name, value: hid ? T("Theme Hidden") : T("Visible"), desc: T("Titles TMDB tags with this theme disappear from Home, the grids, search and More Like This. A title that is not tagged can still appear: hide it with OK held."),
                run: function () {
                    var l = D.themesOn().slice(), i = l.indexOf(t.id);
                    if (i >= 0) l.splice(i, 1); else l.push(t.id);
                    TV.setPref("hiddenThemes", l);
                    TV.toast(i >= 0 ? T("“{name}” shown again", { name: t.name }) : T("“{name}” hidden", { name: t.name }));
                    D.buildThemes();
                    replaceTop(themesPage());
                } };
        });
        return { title: T("Hidden Themes"), icon: "eyeOff", desc: T("Themes you hide disappear from APL TV."), rows: rows, rebuild: themesPage };
    }
    function hiddenPage() {
        var rows = D.hiddenList().map(function (h) {
            return { label: h.t, value: h.kind === "series" ? T("Series") : T("Movie"), desc: T("OK: show this title again."),
                run: function () { D.unhide(h.key); TV.toast(T("“{name}” is back", { name: h.t })); replaceTop(hiddenPage()); } };
        });
        if (!rows.length) rows.push({ label: T("No hidden titles"), desc: T("Hold OK on a movie or a series, then choose Hide This Title.") });
        return { title: T("Hidden Titles"), icon: "eyeOff", desc: T("Hidden titles appear nowhere in APL TV. OK on one brings it back."), rows: rows, rebuild: hiddenPage };
    }

    function sourcePage(id) {
        var s = D.sources().filter(function (x) { return x.id === id; })[0];
        if (!s) return mainPage();
        var rows = [];
        rows.push({ label: T("Name"), value: s.name, acc: "chevron", run: function (row) {
            edit(row, { value: s.name, onDone: function (v) { if (v) { D.updateSource(id, { name: v }); D.rebuild(); } redraw(); } });
        } });
        if (s.type === "xtream") {
            rows.push({ label: T("Server"), value: s.server });
            rows.push({ label: T("Username"), value: s.user });
            rows.push({ label: T("Password"), value: "••••••••", secret: true });
            if (s.account) {
                if (s.account.exp) rows.push({ label: T("Subscription Ends"), value: new Date(s.account.exp).toLocaleDateString(TV.locale) });
                if (s.account.max) rows.push({ label: T("Screens at Once"), value: String(s.account.max) });
            }
        } else rows.push({ label: T("Address"), value: s.url.replace(/^(https?:\/\/[^\/]+).*$/, "$1/…") });
        rows.push({ label: T("TV Guide Address"), value: s.epg ? s.epg.replace(/^(https?:\/\/[^\/]+).*$/, "$1/…") : (s.type === "xtream" ? T("From the server") : T("From the playlist")), acc: "chevron",
            desc: T("An XMLTV address (.xml or .xml.gz), if your provider gives you one."),
            run: function (row) { edit(row, { value: s.epg || "", url: true, onDone: function (v) { D.updateSource(id, { epg: v }); D.rebuild(); TV.epg.loadAll(true); redraw(); } }); } });
        rows.push({ label: fmtCount(s), desc: s.error || "" });
        rows.push({ label: T("Refresh Now"), icon: "refresh", run: function () { loadWithProgress(s, function () { redraw(); }); } });
        rows.push({ label: T("Delete This Playlist"), danger: true, run: function () {
            TV.alert({ title: T("Delete “{name}”?", { name: s.name }), message: T("Its channels, favorites and guide will be removed from APL TV."), buttons: [
                { label: T("Cancel") }, { label: T("Delete"), danger: true, run: function () { D.removeSource(id); pop(); } }] });
        } });
        return { title: s.name, icon: s.type === "xtream" ? "link" : "list", desc: s.type === "xtream" ? T("Xtream account") : T("M3U playlist"), rows: rows };
    }

    function addPage() {
        return { title: T("Add a Playlist"), icon: "plus", desc: T("Scan the code with your phone to type or paste your playlist there, or use the remote."), rows: [
            { label: T("From Your Phone"), icon: "phone", acc: "chevron", desc: T("Recommended: scan a QR code, then type or paste your playlist on your phone."), run: function () { push(phonePage()); } },
            { label: T("With the Remote"), icon: "keyboard", acc: "chevron", desc: T("Type the address or your Xtream details with the screen's keyboard."), run: function () { push(formPage({ type: "xtream" })); } }
        ] };
    }

    /* ---------- typing with the remote ---------- */
    function formPage(f) {
        var rows = [];
        rows.push({ label: T("Type"), value: f.type === "xtream" ? "Xtream" : "M3U", acc: "chevron", desc: T("Xtream: server, username and password. M3U: one address."),
            run: function () { f.type = f.type === "xtream" ? "m3u" : "xtream"; replaceTop(formPage(f)); } });
        function field(label, key, opts) {
            opts = opts || {};
            var shown = f[key] ? (opts.secret ? new Array(Math.min(f[key].length, 12) + 1).join("•") : f[key]) : T("Not set");
            rows.push({ label: label, value: shown, acc: "chevron", desc: opts.desc, run: function (row) {
                edit(row, { value: f[key] || "", secret: opts.secret, url: opts.url, onDone: function (v) { f[key] = v; replaceTop(formPage(f)); } });
            } });
        }
        if (f.type === "xtream") {
            field(T("Server"), "server", { url: true, desc: T("For example http://example.com:8080") });
            field(T("Username"), "user");
            field(T("Password"), "pass", { secret: true });
        } else field(T("Playlist Address"), "url", { url: true, desc: T("The address of your M3U playlist (http://…).") });
        field(T("Name (optional)"), "name");
        field(T("TV Guide Address (optional)"), "epg", { url: true, desc: T("An XMLTV address (.xml or .xml.gz), if your provider gives you one.") });
        rows.push({ label: T("Add"), action: true, run: function () { submit(f); } });
        return { title: T("With the Remote"), icon: "keyboard", desc: T("OK on a line opens the keyboard. Done to keep the text."), rows: rows, keep: true };
    }
    function submit(f) {
        var src = { type: f.type, name: f.name || "", epg: f.epg || "" };
        if (f.type === "xtream") {
            var fromUrl = D.xtreamFromUrl(f.server);
            if (fromUrl) { src.server = fromUrl.server; src.user = fromUrl.user; src.pass = fromUrl.pass; }
            else { src.server = f.server; src.user = f.user; src.pass = f.pass; }
            if (!src.server || !src.user || !src.pass) { TV.toast(T("Fill in the server, the username and the password.")); return; }
        } else {
            src.url = f.url;
            if (!/^https?:\/\//i.test(src.url || "")) { TV.toast(T("The address must start with http:// or https://")); return; }
        }
        addAndLoad(src);
    }
    function addAndLoad(src) {
        var added = D.addSource(src);
        loadWithProgress(added, function (ok) {
            if (!ok) { pages = [mainPage(), sourcePage(added.id)]; redraw(); return; }
            pages = [mainPage()];
            redraw();
            TV.toast(T("“{name}” is ready", { name: added.name }), true);
            TV.epg.loadAll(true);
            TV.shell.go("home");
        });
    }

    /* ---------- from the phone (QR code) ---------- */
    function phonePage() {
        return { title: T("From Your Phone"), custom: drawPhone, onLeave: stopPhone, rows: [] };
    }
    function drawPhone() {
        root.innerHTML = "";
        var qr = el("div", "qr");
        var box = el("div", "qr__box", "<div style='width:400px;height:400px;display:flex;align-items:center;justify-content:center;color:#888;font-size:24px'>" + esc(T("Starting…")) + "</div>");
        var url = el("div", "qr__url"), pin = el("div", "qr__pin"), state = el("div", "qr__state");
        qr.appendChild(box); qr.appendChild(url); qr.appendChild(pin); qr.appendChild(state);
        var steps = el("div", "steps");
        steps.innerHTML =
            "<div class='step'><b>1</b><span>" + esc(T("Connect your phone to the same Wi-Fi as the screen.")) + "</span></div>" +
            "<div class='step'><b>2</b><span>" + esc(T("Open the camera and point it at the code. Tap the link that appears.")) + "</span></div>" +
            "<div class='step'><b>3</b><span>" + esc(T("Type or paste your Xtream details or your M3U link, then tap Send to the screen.")) + "</span></div>";
        var back = el("div", "btn", esc(T("Use the Remote Instead")));
        steps.appendChild(back);
        root.appendChild(qr); root.appendChild(steps);
        nav = new TV.Nav({ onSelect: function () { stopPhone(); replaceTop(formPage({ type: "xtream" })); } });
        nav.setTiles([back]);
        if (TV.shell.focusOn() !== "view") nav.blur();
        TV.helper.session().then(function (s) {
            var link = s.urls && s.urls[0];
            if (!link) throw new Error(T("The screen is not on a network."));
            box.innerHTML = "";
            box.appendChild(TV.qr.canvas(link, 400));
            url.textContent = link.replace(/\?.*$/, "");
            pin.textContent = T("Code: {code}", { code: s.token });
            state.innerHTML = "<i></i>" + esc(T("Waiting for your phone…"));
            clearInterval(pollTimer);
            pollTimer = setInterval(function () {
                TV.helper.pending(s.token).then(function (r) {
                    if (r.expired) { stopPhone(); drawPhone(); return; }
                    if (!r.items || !r.items.length) return;
                    stopPhone();
                    var it = r.items[r.items.length - 1];
                    state.innerHTML = "<i></i>" + esc(T("Received! Loading…"));
                    if (it.type === "xtream") {
                        var x = D.xtreamFromUrl(it.server);
                        if (x) { it.server = x.server; it.user = x.user; it.pass = x.pass; }
                    }
                    addAndLoad(it);
                }).catch(function () {});
            }, 1500);
        }).catch(function (e) {
            box.innerHTML = "<div style='width:400px;height:400px;display:flex;align-items:center;justify-content:center;text-align:center;color:#555;font-size:24px;padding:20px'>" +
                esc(T("The phone page could not start ({e}). Use the remote instead.", { e: e.message })) + "</div>";
        });
    }
    function stopPhone() { clearInterval(pollTimer); pollTimer = null; TV.helper.close(); }

    /* ---------- loading, with progress ---------- */
    function loadWithProgress(src, done) {
        var rootA = TV.$("alert");
        rootA.innerHTML = "";
        var box = el("div", "alert__box");
        box.innerHTML = "<div class='osd__spin' style='margin:0 auto 40px'></div><h2 class='alert__title'>" + esc(src.name) + "</h2><p class='alert__msg'></p>";
        rootA.appendChild(box);
        rootA.classList.add("is-open");
        var blocker = { key: function () {} };
        TV.pushNav(blocker);
        var msg = box.querySelector(".alert__msg");
        D.loadSource(src, function (m) { msg.textContent = m; }).then(function () {
            rootA.classList.remove("is-open"); TV.popNav(blocker);
            D.rebuild();
            done(true);
        }, function (e) {
            rootA.classList.remove("is-open"); TV.popNav(blocker);
            TV.alert({ title: T("Could not load “{name}”", { name: src.name }), message: e.message + "\n\n" + T("Check the address and your details, then try again.") });
            done(false);
        });
    }
    function refreshAll() {
        var list = D.sources();
        if (!list.length) return;
        var i = 0;
        (function next() {
            if (i >= list.length) { TV.epg.loadAll(true); redraw(); return; }
            loadWithProgress(list[i++], next);
        })();
    }

    /* ---------- drawing ---------- */
    function edit(row, o) {
        var r = row._el;
        r.classList.add("is-editing");
        var v = r.querySelector(".srow__value");
        TV.editText({ value: o.value, secret: o.secret, url: o.url,
            onInput: function (t) { if (v) v.textContent = o.secret ? new Array(Math.min(t.length, 12) + 1).join("•") : t; },
            onDone: function (t) { r.classList.remove("is-editing"); o.onDone(t); },
            onCancel: function () { r.classList.remove("is-editing"); } });
    }
    function push(p) { var cur = pages[pages.length - 1]; if (cur && cur.onLeave) cur.onLeave(); pages.push(p); redraw(0); }
    function pop() {
        var cur = pages.pop(); if (cur && cur.onLeave) cur.onLeave();
        if (!pages.length) pages = [mainPage()];
        // pages below are rebuilt (counts, names may have changed)
        pages = pages.map(function (pg) { return pg.rebuild ? pg.rebuild() : pg; });
        pages[0] = mainPage();
        redraw(pages[pages.length - 1]._index || 0);
    }
    function replaceTop(p) { var idx = nav ? nav.index : 0; pages[pages.length - 1] = p; redraw(idx); }
    function redraw(index) {
        if (!root) build();
        var p = pages[pages.length - 1];
        if (p.title === T("Settings")) { p = pages[pages.length - 1] = mainPage(); }
        else if (p.rebuild && !p.custom) { var idx0 = p._index; p = pages[pages.length - 1] = p.rebuild(); p._index = idx0; }
        if (p.custom) { p.custom(); return; }
        if (!heroIcon.parentNode || !listWrap.parentNode) build();
        var keep = typeof index === "number" ? index : (nav ? nav.index : 0);
        heroIcon.innerHTML = p.preview ? p.preview() : TV.icon(p.icon || "gear", 190);
        listEl.innerHTML = "";
        var tiles = [], rows = [];
        p.rows.forEach(function (r) {
            if (r.section) { listEl.appendChild(el("div", "srow__section", esc(r.section))); return; }
            var e = el("div", "srow" + (r.danger ? " srow--danger" : "") + (r.action ? " srow--action" : ""));
            e.innerHTML = "<span class='srow__label'>" + (r.icon ? TV.icon(r.icon, 28) : "") + "<span>" + esc(r.label) + "</span></span>" +
                (r.value !== undefined ? "<span class='srow__value" + (r.secret ? " is-secret" : "") + "'>" + esc(r.value) + "</span>" : "") +
                (r.acc === "chevron" ? "<span class='srow__acc'>" + TV.icon("chevron", 24) + "</span>" : "");
            r._el = e;
            listEl.appendChild(e);
            tiles.push(e); rows.push(r);
        });
        nav = new TV.Nav({
            onFocus: function (i, t) {
                var r = rows[i];
                heroDesc.textContent = (r && r.desc) || p.desc || "";
                p._index = i;
                var y = t.offsetTop - 300;
                listEl.style.transform = "translateY(" + (-Math.max(0, y)) + "px)";
            },
            onSelect: function (i) { var r = rows[i]; if (r.run) r.run(r); }
        });
        nav.setTiles(tiles, Math.min(keep, tiles.length - 1));
        if (TV.shell.focusOn() !== "view" || !visible) nav.blur();
        if (!tiles.length) heroDesc.textContent = p.desc || "";
    }
    function applyMotion() { document.body.classList.toggle("reduce-motion", !TV.pref("motion")); }
    applyMotion();

    var view = {
        show: function () {
            if (!root) build();
            visible = true;
            TV.bg("", "dark");
            if (!pages.length) pages = [mainPage()];
            redraw();
        },
        hide: function () { visible = false; var p = pages[pages.length - 1]; if (p && p.onLeave) p.onLeave(); if (p && p.custom) pages.pop(); TV.$("bg").classList.remove("is-dark"); },
        enter: function () { if (nav) nav.refocus(); },
        blur: function () { if (nav) nav.blur(); },
        key: function (code) {
            if (!nav) return false;
            var K = TV.KEY;
            if (code === K.UP && nav.neighbour("up") === -1) return false;
            if (code === K.LEFT || code === K.RIGHT) { TV.sound.edge(); return true; }
            nav.key(code);
            return true;
        },
        ok: function () { if (nav) nav.ok(); },
        backHandled: function () { if (pages.length > 1) { pop(); return true; } return false; },
        openPage: function (name) {
            pages = [mainPage(), addPage()];
            if (name === "phone") pages.push(phonePage());
            if (name === "remote") pages.push(formPage({ type: "xtream" }));
        }
    };

    TV.views = TV.views || {};
    TV.views.settings = view;
    TV.setup = {
        phone: function () { view.openPage("phone"); TV.shell.go("settings", true); },
        remote: function () { view.openPage("remote"); TV.shell.go("settings", true); }
    };
})(window);

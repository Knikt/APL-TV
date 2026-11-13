/* ============================================================
   search.js: search across channels, movies and series, tvOS style.
   An on-screen keyboard (no need for the Samsung one), results as you
   type: channels first, then movies, then series. Accents and case do
   not matter ("cine" finds "Ciné+").
   The keyboard is laid out like a computer's (AZERTY in French, QWERTY
   otherwise) or in alphabetical order (Settings > Display, or its own
   key). Its last key opens the TV's own keyboard (Gboard on Android TV,
   Samsung's or LG's), with the results as you type there too.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV, el = TV.el, esc = TV.esc, T = TV.t, D = TV.data;
    var root, field, kbEl, results, resIn, kbNav, strips = [], zone = "kb", query = "", visible = false, first = "";
    var ROWS = { qwerty: ["1234567890", "qwertyuiop", "asdfghjkl'", "zxcvbnm-"], azerty: ["1234567890", "azertyuiop", "qsdfghjklm", "wxcvbn'-"],
                 abc: ["1234567890", "abcdefghij", "klmnopqrst", "uvwxyz'-"],
                 /* Arabic, in the alphabet's order read from the right (alif next to Delete): the 28 letters; their
                    other forms (hamza and madda alef, taa marbuta, alef maqsura) are found by the plain ones (S.fold) */
                 arabic: ["1234567890", "\u0631\u0630\u062F\u062E\u062D\u062C\u062B\u062A\u0628\u0627", "\u0641\u063A\u0639\u0638\u0637\u0636\u0635\u0634\u0633\u0632", "\u064A\u0648\u0647\u0646\u0645\u0644\u0643\u0642"] };
    // the layout key's turn: your computer's layout, then ABC, then Arabic
    function computer() { return TV.lang === "fr" ? "azerty" : "qwerty"; }
    function nextLayout(l) { return l === "abc" ? "arabic" : l === "arabic" ? computer() : "abc"; }
    function layoutName(l) { return l === "abc" ? "ABC" : l === "arabic" ? "\u0639\u0631\u0628\u064A" : l.toUpperCase(); }
    function layout() { var l = TV.pref("kbLayout"); return ROWS[l] ? l : (TV.lang === "fr" ? "azerty" : "qwerty"); }

    function build() {
        root = TV.$("v-search");
        root.innerHTML = "";
        field = el("div", "search__field");
        kbEl = el("div", "kb");
        results = el("div", "search__results");
        resIn = el("div", "search__in");
        results.appendChild(resIn);
        root.appendChild(field); root.appendChild(kbEl); root.appendChild(results);
        // cross 20: Right and Left stay on the row (Right on Space went up to X instead of Delete)
        kbNav = new TV.Nav({ cross: 20, onSelect: function (i, t) { type(t._k); } });
        drawKeys();
        kbNav.blur();
        drawField();
    }
    /* The keys, in four rows (figures, then the letters as on a computer's keyboard, or in alphabetical order);
       on the right Delete, Clear, Space and the TV's own keyboard; bottom left, the other layout */
    function drawKeys(keepOn) {
        var lay = layout(), tiles = [], focusAt = 0, sw = null, cur = kbNav.current(), was = cur && cur._k;
        var acts = [["del", "⌫ " + esc(T("Delete"))], ["clear", esc(T("Clear"))], ["space", esc(T("Space"))], ["tvkb", TV.icon("keyboard", 30) + "<span>" + esc(T("TV Keyboard")) + "</span>"]];
        kbEl.innerHTML = "";
        kbEl.className = "kb kb--" + lay;
        function key(k, label, cls, parent) { var t = el("div", "kb__key" + (cls ? " " + cls : ""), label); t._k = k; parent.appendChild(t); tiles.push(t); return t; }
        ROWS[lay].forEach(function (r, i) {
            var row = el("div", "kb__row");
            kbEl.appendChild(row);
            if (i === 3) sw = key("layout", esc(layoutName(nextLayout(lay))), "kb__key--alt", row);
            r.split("").forEach(function (k) { key(k, k.toUpperCase(), lay === "arabic" && i > 0 ? "kb__key--ar" : "", row); });
            key(acts[i][0], acts[i][1], "kb__key--act" + (acts[i][0] === "tvkb" ? " kb__key--tv" : ""), row);
        });
        if (keepOn === "layout") focusAt = tiles.indexOf(sw);
        else if (was) tiles.forEach(function (t, i) { if (t._k === was) focusAt = i; });
        kbNav.setTiles(tiles, focusAt);
    }
    /* The TV's own keyboard (Gboard, Samsung's, LG's): what you type there searches as you type */
    function tvKeyboard() {
        var before = query;
        TV.editText({ value: query,
            onInput: function (v) { query = String(v || "").slice(0, 60); drawField(); runSoon(); },
            onDone: function (v) { query = String(v || "").slice(0, 60); drawField(); run(); paint(); },
            onCancel: function () { query = before; drawField(); run(); paint(); } });
    }
    function drawField() {
        field.innerHTML = TV.icon("search", 36) + "<span>" + (query ? "<bdi>" + esc(query) + "</bdi>" : "<span class='search__ph'>" + esc(T("Channels, movies, series")) + "</span>") + "<i class='caret'></i></span>";
    }
    function type(k) {
        if (k === "tvkb") { tvKeyboard(); return; }
        if (k === "layout") {
            // your computer's layout, ABC, Arabic, in turn; remembered (also in Settings > Display)
            TV.setPref("kbLayout", nextLayout(layout()));
            drawKeys("layout"); paint();
            return;
        }
        if (k === "del") query = query.slice(0, -1);
        else if (k === "clear") query = "";
        else if (k === "space") { if (query && query.slice(-1) !== " ") query += " "; }
        else query += k;
        drawField();
        runSoon();
    }
    var runSoon = TV.debounce(run, 280);
    function run() {
        resIn.innerHTML = ""; strips = [];
        if (query.trim().length < 2) {
            if (!query) resIn.innerHTML = "<div class='empty' style='top:110px'><div class='empty__text'>" + esc(T("Type at least two letters.")) + "</div></div>";
            return;
        }
        var r = D.search(query, 40);
        function add(title, items, kind, what) {
            if (!items.length) return;
            var s = new TV.Strip({ title: title, items: items, kind: kind, height: kind === "channel" ? 290 : 440,
                make: function (it) { return kind === "channel" ? TV.card.channel(it) : TV.card.poster(it); } });
            s.kindOf = kind; s.what = what;
            strips.push(s); resIn.appendChild(s.root);
        }
        // Asked by voice for movies (or series, or channels): that row comes first
        var rows = [[T("Channels"), r.live, "channel", "live"], [T("Movies"), r.movies, "poster", "movies"], [T("Series"), r.series, "poster", "series"]];
        if (first) rows = rows.filter(function (x) { return x[3] === first; }).concat(rows.filter(function (x) { return x[3] !== first; }));
        rows.forEach(function (x) { add(x[0], x[1], x[2], x[3]); });
        if (!strips.length) resIn.innerHTML = "<div class='empty' style='top:110px'><div class='empty__text'>" + esc(T("No results for “{q}”", { q: query })) + "</div></div>";
        TV.epg.ensure(r.live.slice(0, 12));
    }
    /* The results fill the whole screen under the field: the list inside moves, never the frame, so nothing
       is cut at the bottom. In the results the keyboard steps aside, the field goes up, the tab bar hides. */
    function paint() {
        var active = TV.shell.focusOn() === "view";
        var si = typeof zone === "number" ? zone : -1;
        strips.forEach(function (s, i) { s.setActive(active && i === si); s.root.classList.toggle("is-above", si >= 0 && i < si); });
        if (zone === "kb" && active) kbNav.refocus(); else kbNav.blur();
        root.classList.toggle("is-results", si >= 0);
        document.body.classList.toggle("in-results", si >= 0 && visible);
        var y = 0;
        if (si >= 0) y = 170 - 610 - (strips[si].root.offsetTop - strips[0].root.offsetTop);
        resIn.style.transform = "translateY(" + y + "px)";
    }

    var view = {
        show: function () { if (!root) build(); else if (kbEl.className !== "kb kb--" + layout()) drawKeys(); visible = true; TV.bg("", "dark"); paint(); },
        hide: function () { visible = false; TV.$("bg").classList.remove("is-dark"); document.body.classList.remove("in-results"); },
        enter: function () { zone = "kb"; paint(); },
        blur: function () { paint(); },
        key: function (code) {
            var K = TV.KEY;
            if (code >= 65 && code <= 90) { type(String.fromCharCode(code + 32)); return true; }          // a real keyboard (PC, Bluetooth)
            if (code >= 48 && code <= 57) { type(String.fromCharCode(code)); return true; }
            if (code === 32) { type("space"); return true; }
            if (zone === "kb") {
                if (code === K.UP) { if (kbNav.neighbour("up") === -1) return false; kbNav.move("up"); return true; }
                if (code === K.DOWN) {
                    if (kbNav.neighbour("down") !== -1) { kbNav.move("down"); return true; }
                    if (strips.length) { zone = 0; TV.sound.tick(); paint(); } else TV.sound.edge();
                    return true;
                }
                kbNav.key(code);
                return true;
            }
            var s = strips[zone];
            if (code === K.LEFT || code === K.RIGHT) { if (!s.move(code === K.LEFT ? -1 : 1)) TV.sound.edge(); return true; }
            if (code === K.UP) { if (zone === 0) zone = "kb"; else zone--; TV.sound.tick(); paint(); return true; }
            if (code === K.DOWN) { if (zone < strips.length - 1) { zone++; TV.sound.tick(); paint(); } else TV.sound.edge(); return true; }
            if (TV.isBack(code)) { zone = "kb"; paint(); return true; }
            return false;
        },
        ok: function () {
            if (zone === "kb") { kbNav.ok(); return; }
            var s = strips[zone], it = s.current();
            if (!it) return;
            if (s.kindOf === "channel") TV.live.play(it, s.items); else TV.detail.open(it);
        },
        backHandled: function () { if (zone !== "kb") { zone = "kb"; paint(); return true; } return false; },
        canHold: function () { return typeof zone === "number" && strips[zone] && !!strips[zone].current(); },
        longOk: function () {
            var s = strips[zone], it = s && s.current();
            if (!it) return;
            if (s.kindOf === "channel") {
                var fav = D.isFav(it.id);
                TV.menu(it.name, [{ label: fav ? T("Remove from Favorites") : T("Add to Favorites"), icon: fav ? "starLine" : "star", run: function () { D.toggleFav(it.id); } }]);
            } else TV.titleMenu(it, function () { run(); paint(); });
        }
    };

    /* A search asked by voice ("search Dragon Ball movies"): the words typed in, the results shown at once
       with the asked kind first, the focus on the first result, ready to choose */
    function ask(q, kind) {
        if (!root) build();
        query = String(q || "").toLowerCase().slice(0, 60);
        first = kind || "";
        drawField();
        run();
        first = "";
        zone = strips.length ? 0 : "kb";
        paint();
    }

    TV.views = TV.views || {};
    TV.views.search = view;
    TV.search = { ask: ask };
})(window);

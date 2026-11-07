/* ============================================================
   player.js: the main picture, with Samsung's AVPlay (HLS, MPEG-TS,
   MP4, MKV…), in a window (preview) or full screen.
   - One request at a time: zapping fast never leaves two streams open.
   - A stream that does not start within 25 s is an error.
   - Audio tracks and subtitles of the stream can be chosen.
   On the PC preview, an HTML <video> stands in for AVPlay.
   ============================================================ */
(function (global) {
    "use strict";

    var TV = global.TV;
    var av = global.webapis && global.webapis.avplay;
    var useAv = !!av && !TV.PREVIEW;
    var video = null;
    var cur = null;            // { url, opts, token }
    var token = 0, rect = null, watchdog = null, lastTime = 0, buffering = false;
    var FULL = [0, 0, 1920, 1080];

    function emit(name, a) { if (cur && cur.opts && cur.opts[name]) { try { cur.opts[name](a); } catch (e) { TV.log("player cb " + name + ": " + e.message); } } }
    function setVideoState() { document.body.classList.toggle("has-video", !!cur); }

    function ensureVideo() {
        if (video) return video;
        video = document.createElement("video");
        video.className = "pvideo";
        video.autoplay = true;
        document.body.insertBefore(video, document.body.firstChild.nextSibling);
        video.addEventListener("waiting", function () { buffering = true; emit("onBuffering", true); });
        video.addEventListener("playing", function () { buffering = false; emit("onBuffering", false); emit("onPlaying"); });
        video.addEventListener("timeupdate", function () { lastTime = video.currentTime * 1000; emit("onTime", lastTime); });
        video.addEventListener("ended", function () { emit("onEnded"); });
        video.addEventListener("error", function () { emit("onError", "video error " + (video.error && video.error.code)); });
        return video;
    }
    function place(r) {
        rect = r || FULL;
        if (useAv) {
            try { av.setDisplayRect(rect[0], rect[1], rect[2], rect[3]); } catch (e) { TV.log("setDisplayRect: " + e.message); }
        } else if (video) {
            video.style.left = rect[0] + "px"; video.style.top = rect[1] + "px";
            video.style.width = rect[2] + "px"; video.style.height = rect[3] + "px";
        }
    }

    /* Picture Size (Settings > Playback, or the player's third button) */
    var METHODS = { fit: "PLAYER_DISPLAY_MODE_LETTER_BOX", fill: "PLAYER_DISPLAY_MODE_FULL_SCREEN", auto: "PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO" };
    function applyPicture() {
        var mode = METHODS[TV.pref("pictureMode")] ? TV.pref("pictureMode") : "fit";
        if (useAv) {
            try { av.setDisplayMethod(METHODS[mode]); } catch (e) {
                TV.log("picture " + mode + ": " + e.message);
                try { av.setDisplayMethod(METHODS.fit); } catch (e2) {}
            }
        } else if (video) video.style.objectFit = mode === "fill" ? "fill" : "contain";
    }
    function setPicture(mode) { TV.setPref("pictureMode", mode); if (cur) applyPicture(); }

    function closeAv() {
        if (!useAv) return;
        var t0 = Date.now(), t1 = t0;
        try { var st = av.getState(); if (st !== "NONE" && st !== "IDLE") av.stop(); } catch (e) {}
        t1 = Date.now();
        try { av.close(); } catch (e) {}
        if (TV.DEV && Date.now() - t0 > 50) TV.log("player: stop " + (t1 - t0) + " ms, close " + (Date.now() - t1) + " ms");
        if (TV.mark) TV.mark("player stop");
    }

    /* ---------- staying on air ----------
       A live stream that stops moving for 10 s (a movie for 20 s), or that breaks, is opened again by itself,
       up to 5 times in a row (0.8, 2, 4, 6, 8 s apart), a movie at the place it had reached. After a minute
       of good playback the count starts again. Nothing is reopened while the picture moves. */
    var tickAt = 0, started = false, attempts = 0, goodSince = 0, stallTimer = null, retryTimer = null;
    var DELAYS = [800, 2000, 4000, 6000, 8000];
    function reconnect(why) {
        if (!cur) return;
        var c = cur;
        if (attempts >= DELAYS.length) { TV.log("giving up after " + attempts + " reconnections (" + why + ")"); emit("onError", why); return; }
        var wait = DELAYS[attempts++];
        TV.log("reconnecting (" + why + "), attempt " + attempts + " in " + wait + " ms");
        emit("onReconnect", attempts);
        closeAv();
        clearTimeout(retryTimer);
        retryTimer = setTimeout(function () {
            if (cur !== c) return;
            var o = c.opts;
            if (!o.live && lastTime > 0) o.start = lastTime / 1000;
            open(c.url, o, true);
        }, wait);
    }
    function watchStall() {
        clearInterval(stallTimer);
        stallTimer = setInterval(function () {
            if (!cur || !useAv || !started) return;
            var st = "NONE"; try { st = av.getState(); } catch (e) {}
            if (st !== "PLAYING") return;
            var limit = cur.opts.live ? 10000 : 20000;
            if (Date.now() - tickAt > limit) reconnect("no picture for " + Math.round((Date.now() - tickAt) / 1000) + " s");
            if (goodSince && Date.now() - goodSince > 60000) attempts = 0;
        }, 2000);
    }
    /* 4K: Samsung's player wants to be told before it prepares a UHD stream */
    var uhdPanel = null;
    function canUhd() {
        if (uhdPanel === null) { try { uhdPanel = !!global.webapis.productinfo.isUdPanelSupported(); } catch (e) { uhdPanel = true; } }
        return uhdPanel;
    }
    function streamInfo() {
        try {
            var info = av.getCurrentStreamInfo() || [];
            for (var i = 0; i < info.length; i++) if (info[i].type === "VIDEO") {
                var x = JSON.parse(info[i].extra_info || "{}");
                return { w: +x.Width || 0, h: +x.Height || 0, fps: x.FrameRate || "", codec: x.fourCC || "", bitrate: x.Bit_rate || "" };
            }
        } catch (e) {}
        return null;
    }

    /* Streams found to be 4K once are opened in 4K mode next time (a short fingerprint, never the address) */
    function fp(url) { var h = 0, s = String(url); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); }
    function knownUhd(url) { return !!(TV.load("uhd", {}) || {})[fp(url)]; }
    function rememberUhd(url) { var m = TV.load("uhd", {}) || {}, k = Object.keys(m); if (k.length > 400) delete m[k[0]]; m[fp(url)] = 1; TV.save("uhd", m); }
    function play(url, opts) {
        opts = opts || {};
        attempts = 0;
        if (!opts.uhd && knownUhd(url)) opts.uhd = true;
        open(url, opts, false);
    }
    function open(url, opts, again) {
        if (TV.mark) TV.mark("player");
        var my = ++token;
        clearTimeout(watchdog); clearTimeout(retryTimer);
        closeAv();
        cur = { url: url, opts: opts, token: my };
        if (!again) lastTime = 0;
        buffering = true; started = false; tickAt = Date.now(); goodSince = 0;
        setVideoState();
        emit("onBuffering", true);
        TV.log((again ? "reopen " : "play ") + (opts.live ? "live " : "") + (opts.uhd ? "4K " : "") + url.replace(/^(https?:\/\/[^\/]+).*?([^\/]*)$/, "$1/…/$2"));
        watchStall();
        watchdog = setTimeout(function () {
            if (cur && cur.token === my && !started) {
                TV.log("start timeout");
                if (again || opts.live) reconnect("start timeout"); else emit("onError", "timeout");
            }
        }, 25000);
        if (!useAv) {
            var v = ensureVideo();
            place(opts.rect);
            applyPicture();
            v.src = url;
            if (opts.start) v.addEventListener("loadedmetadata", function once() { v.removeEventListener("loadedmetadata", once); v.currentTime = opts.start; });
            var pr = v.play(); if (pr && pr.catch) pr.catch(function (e) { emit("onError", e.message); });
            return;
        }
        try {
            av.open(url);
            av.setListener({
                onbufferingstart: function () { if (cur && cur.token === my) { buffering = true; emit("onBuffering", true); } },
                onbufferingprogress: function () {},
                onbufferingcomplete: function () { if (cur && cur.token === my) { buffering = false; emit("onBuffering", false); } },
                oncurrentplaytime: function (ms) {
                    if (!cur || cur.token !== my) return;
                    if (TV.DEV && Math.floor(ms / 5000) !== Math.floor(lastTime / 5000)) TV.log("playing " + (ms / 1000).toFixed(1) + " s, " + av.getState());
                    if (!started) {
                        started = true; goodSince = Date.now();
                        var si = streamInfo();
                        if (si) TV.log("picture " + si.w + "x" + si.h + " " + si.codec + " " + si.fps + "fps");
                        if (si && si.w >= 3000 && !opts.uhd && canUhd()) {
                            // a 4K picture without Samsung's 4K mode: opened again in 4K mode, where it was
                            TV.log("4K stream without the 4K mode: opened again in 4K mode");
                            opts.uhd = true; rememberUhd(url);
                            if (!opts.live) opts.start = ms / 1000;
                            setTimeout(function () { if (cur && cur.token === my) open(url, opts, true); }, 0);
                            return;
                        }
                        if (si && si.w >= 3000) rememberUhd(url);
                    }
                    if (ms !== lastTime) tickAt = Date.now();
                    lastTime = ms; emit("onTime", ms);
                },
                onstreamcompleted: function () { if (cur && cur.token === my) { if (opts.live) reconnect("stream ended"); else emit("onEnded"); } },
                onerror: function (type) {
                    if (!cur || cur.token !== my) return;
                    TV.log("avplay error " + type);
                    if (started || opts.live) reconnect(String(type)); else emit("onError", String(type));
                },
                onevent: function (type, data) { if (type !== "PLAYER_MSG_RESOLUTION_CHANGED") TV.log("avplay event " + type + " " + (data || "")); },
                onsubtitlechange: function (dur, text) { if (cur && cur.token === my) emit("onSubtitle", { text: text, dur: +dur || 0 }); },
                ondrmevent: function () {}
            });
            place(opts.rect);
            applyPicture();
            if (opts.uhd && canUhd()) { try { av.setStreamingProperty("SET_MODE_4K", "TRUE"); } catch (e) { TV.log("4K mode: " + e.message); } }
            // A stream with several qualities (HLS, DASH): the best one from the start, never the lowest
            // (by default the TV starts low and can stay there: the picture looked compressed)
            if (/\.(m3u8|mpd)(\?|$)|\/hls\/|format=m3u8/i.test(url)) {
                try { av.setStreamingProperty("ADAPTIVE_INFO", "STARTBITRATE=HIGHEST|SKIPBITRATE=LOWEST"); } catch (e) { TV.log("adaptive: " + e.message); }
            }
            // A cushion against small network hiccups: 3 s before starting, 8 s after a pause in the stream
            try {
                av.setBufferingParam("PLAYER_BUFFER_FOR_PLAY", "PLAYER_BUFFER_SIZE_IN_SECOND", opts.live ? 3 : 4);
                av.setBufferingParam("PLAYER_BUFFER_FOR_RESUME", "PLAYER_BUFFER_SIZE_IN_SECOND", opts.live ? 8 : 10);
            } catch (e) {}
            if (opts.live) { try { av.setTimeoutForBuffering(15); } catch (e) {} }
            av.prepareAsync(function () {
                if (!cur || cur.token !== my) return;
                if (opts.start && !opts.live) { try { av.seekTo(Math.floor(opts.start * 1000)); } catch (e) {} }
                emit("onReady");                                   // audio tracks and subtitles are known now
                try { av.play(); emit("onPlaying"); } catch (e) { emit("onError", "play: " + e.message); }
            }, function (err) {
                if (!cur || cur.token !== my) return;
                var why = String(err && (err.name || err.message) || err);
                TV.log("prepare failed " + why);
                if (again || opts.live) reconnect("prepare " + why); else emit("onError", why);
            });
        } catch (e) {
            TV.log("open failed " + e.message);
            emit("onError", e.message);
        }
    }

    function stop() {
        token++;
        clearTimeout(watchdog); clearTimeout(retryTimer); clearInterval(stallTimer);
        closeAv();
        if (video) { try { video.pause(); video.removeAttribute("src"); video.load(); } catch (e) {} }
        cur = null;
        setVideoState();
    }

    function state() {
        if (!cur) return "NONE";
        if (useAv) { try { return av.getState(); } catch (e) { return "NONE"; } }
        return video && !video.paused ? "PLAYING" : "PAUSED";
    }
    function pause() { try { if (useAv) av.pause(); else video.pause(); } catch (e) {} }
    function resume() { try { if (useAv) av.play(); else video.play(); } catch (e) {} }
    function toggle() { if (state() === "PLAYING") { pause(); return false; } resume(); return true; }
    function position() { return lastTime / 1000; }
    function duration() {
        try { return useAv ? (av.getDuration() || 0) / 1000 : (video && isFinite(video.duration) ? video.duration : 0); } catch (e) { return 0; }
    }
    function seekTo(sec, ok, fail) {
        sec = Math.max(0, sec);
        var before = lastTime;
        try {
            if (useAv) av.seekTo(Math.floor(sec * 1000), function () { tickAt = Date.now(); if (ok) ok(); }, function (e) { TV.log("seek failed " + e); lastTime = before; if (fail) fail(e); });
            else { video.currentTime = sec; if (ok) setTimeout(ok, 300); }
            lastTime = sec * 1000;
            tickAt = Date.now();
        } catch (e) { TV.log("seek: " + e.message); lastTime = before; if (fail) fail(e); }
    }
    /* Audio tracks and subtitles: [{ index, type: "AUDIO"|"TEXT", lang }] */
    function tracks() {
        if (!useAv || !cur) return [];
        try {
            return (av.getTotalTrackInfo() || []).filter(function (t) { return t.type === "AUDIO" || t.type === "TEXT"; }).map(function (t) {
                var x = {}; try { x = JSON.parse(t.extra_info || "{}"); } catch (e) {}
                return { index: t.index, type: t.type, lang: x.language || x.track_lang || "", codec: x.fourCC || "", channels: x.channels || "" };
            });
        } catch (e) { return []; }
    }
    function currentTrack(type) {
        if (!useAv) return -1;
        try { var c = av.getCurrentStreamInfo() || []; for (var i = 0; i < c.length; i++) if (c[i].type === type) return c[i].index; } catch (e) {}
        return -1;
    }
    function selectTrack(type, index) { try { av.setSelectTrack(type, index); return true; } catch (e) { TV.log("track: " + e.message); return false; } }
    function subtitlesOff(off) { try { av.setSilentSubtitle(!!off); } catch (e) {} }
    /* The video's own subtitles earlier or later (ms; positive = later) */
    function subtitleDelay(ms) { if (!useAv || !cur) return; try { av.setSubtitlePosition(Math.round(ms)); } catch (e) { TV.log("subtitle delay: " + e.message); } }

    /* The video plane under the page: setting the window does not restart the stream */
    function setRect(r) { if (cur) cur.opts.rect = r; place(r); }

    document.addEventListener("visibilitychange", function () {
        if (document.hidden && cur) {
            if (cur.opts.onHide) emit("onHide");
            else if (useAv) { try { av.suspend(); } catch (e) {} }
        } else if (!document.hidden && cur && useAv) {
            try { av.restore(); } catch (e) {}
        }
    });

    TV.player = {
        play: play, stop: stop, state: state, pause: pause, resume: resume, toggle: toggle, position: position, duration: duration, seekTo: seekTo,
        tracks: tracks, currentTrack: currentTrack, selectTrack: selectTrack, subtitlesOff: subtitlesOff, subtitleDelay: subtitleDelay, setRect: setRect, setPicture: setPicture,
        current: function () { return cur; }, isBuffering: function () { return buffering; }, FULL: FULL, native: useAv,
        streamInfo: function () { return useAv && cur ? streamInfo() : null; }
    };
})(window);

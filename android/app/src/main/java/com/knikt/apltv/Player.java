package com.knikt.apltv;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Tracks;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.text.Cue;
import androidx.media3.common.text.CueGroup;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DecoderCounters;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector;
import androidx.media3.exoplayer.upstream.DefaultBandwidthMeter;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/* The video, under the page: ExoPlayer (HLS, DASH, MPEG-TS, MP4, MKV…), driven by the page with the
   same calls as Samsung's AVPlay (js/android.js turns them into these). Events go back to the page as
   __aplEvent(name, …): prepared, buffering, time, ended, error, subtitle, seeked. */
@UnstableApi
final class Player {
    private final Activity act;
    private final FrameLayout root;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private PlayerView view;
    private ExoPlayer exo;
    private DefaultTrackSelector selector;
    private WebView web;
    private String url = null;
    private boolean prepared = false, wantPlay = false, suspended = false, wasPlaying = false;
    private volatile double durationMs = 0, positionMs = 0;
    private volatile String tracksJson = "[]", currentJson = "[]", statsJson = "{}", videoJson = "{}";
    private volatile long statsWanted = 0;
    private volatile int videoOverride = -1;
    private DefaultBandwidthMeter meter;
    private final List<int[]> audio = new ArrayList<>(), text = new ArrayList<>(), video = new ArrayList<>();
    private double[] lastRect = {0, 0, 1920, 1080};
    private static final String UA = "APL TV (Android)";
    /* AV Sync (Settings > Playback): the picture follows the sound's clock; that clock is shifted by this much.
       + = the sound later than the picture, - = earlier. Changed while playing, the picture catches up at once. */
    static volatile long audioOffsetUs = 0;
    private static final class SyncedRenderers extends DefaultRenderersFactory {
        SyncedRenderers(android.content.Context c) { super(c); }
        @Override protected androidx.media3.exoplayer.audio.AudioSink buildAudioSink(android.content.Context c, boolean floatOut, boolean params) {
            androidx.media3.exoplayer.audio.AudioSink sink = super.buildAudioSink(c, floatOut, params);
            if (sink == null) return null;
            return new androidx.media3.exoplayer.audio.ForwardingAudioSink(sink) {
                @Override public long getCurrentPositionUs(boolean sourceEnded) {
                    long p = super.getCurrentPositionUs(sourceEnded);
                    return p == androidx.media3.exoplayer.audio.AudioSink.CURRENT_POSITION_NOT_SET ? p : Math.max(0, p + audioOffsetUs);
                }
            };
        }
    }

    Player(Activity act, FrameLayout root) { this.act = act; this.root = root; }

    void attach(WebView web) {
        this.web = web;
        view = new PlayerView(act);
        view.setUseController(false);
        view.setShutterBackgroundColor(Color.BLACK);
        view.setKeepContentOnPlayerReset(false);
        view.setFocusable(false);
        if (view.getSubtitleView() != null) view.getSubtitleView().setVisibility(View.GONE);   // the app draws them
        view.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        view.setVisibility(View.GONE);
        root.addView(view, 0, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    }

    private void ensure() {
        if (exo != null) return;
        selector = new DefaultTrackSelector(act);
        // IPTV MPEG-TS streams: keyframes not always marked, access units to be found
        DefaultExtractorsFactory ex = new DefaultExtractorsFactory()
            .setTsExtractorFlags(DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES | DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS);
        http = new DefaultHttpDataSource.Factory()
            .setUserAgent(UA).setAllowCrossProtocolRedirects(true).setConnectTimeoutMs(15000).setReadTimeoutMs(20000);
        DefaultLoadControl load = new DefaultLoadControl.Builder().setBufferDurationsMs(15000, 50000, 2500, 5000).build();
        meter = new DefaultBandwidthMeter.Builder(act).build();
        exo = new ExoPlayer.Builder(act, new SyncedRenderers(act).setEnableDecoderFallback(true))
            .setTrackSelector(selector)
            .setBandwidthMeter(meter)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(http, ex))
            .setLoadControl(load)
            .build();
        view.setPlayer(exo);
        exo.addListener(new androidx.media3.common.Player.Listener() {
            @Override public void onPlaybackStateChanged(int s) {
                if (s == androidx.media3.common.Player.STATE_BUFFERING) event("buffering", "true");
                else if (s == androidx.media3.common.Player.STATE_READY) {
                    durationMs = exo.isCurrentMediaItemLive() || exo.getDuration() == C.TIME_UNSET ? 0 : exo.getDuration();
                    readTracks();
                    if (!prepared) { prepared = true; exo.setPlayWhenReady(wantPlay); event("prepared", null); }
                    event("buffering", "false");
                } else if (s == androidx.media3.common.Player.STATE_ENDED) event("ended", null);
            }
            @Override public void onPlayerError(PlaybackException e) {
                event("error", JSONObject.quote(e.getErrorCodeName() + (e.getCause() != null ? " " + e.getCause().getClass().getSimpleName() : "")));
            }
            @Override public void onTracksChanged(Tracks t) { readTracks(); }
            @Override public void onCues(CueGroup g) {
                StringBuilder b = new StringBuilder();
                for (Cue c : g.cues) if (c.text != null) { if (b.length() > 0) b.append("\n"); b.append(c.text); }
                event("subtitle", JSONObject.quote(b.toString()));
            }
            @Override public void onPositionDiscontinuity(androidx.media3.common.Player.PositionInfo a, androidx.media3.common.Player.PositionInfo b, int reason) {
                if (reason == androidx.media3.common.Player.DISCONTINUITY_REASON_SEEK && pendingSeek != 0) { event("seeked", String.valueOf(pendingSeek)); pendingSeek = 0; }
            }
        });
        ui.post(ticker);
    }

    /* The page hears the time twice a second while it plays */
    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            if (exo != null) {
                positionMs = exo.getCurrentPosition();
                if (exo.isPlaying()) event("time", String.valueOf((long) positionMs));
                if (System.currentTimeMillis() - statsWanted < 4000) readStats();
            }
            ui.postDelayed(this, 500);
        }
    };
    private int pendingSeek = 0;

    private void event(String name, String arg) {
        if (web == null) return;
        final String js = "window.__aplEvent&&__aplEvent('" + name + "'" + (arg != null ? "," + arg : "") + ")";
        ui.post(() -> web.evaluateJavascript(js, null));
    }

    /* ---------- AVPlay's calls ---------- */
    void open(String u) {
        ui.post(() -> {
            ensure();
            url = u; prepared = false; wantPlay = false; durationMs = 0; positionMs = 0; lastSummary = "";
            videoOverride = -1; video.clear(); videoJson = "{}"; statsJson = "{}";
            selector.setParameters(selector.buildUponParameters().setForceHighestSupportedBitrate(false).clearOverrides().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false));
            exo.stop();
            exo.clearMediaItems();
            view.setVisibility(View.VISIBLE);
        });
    }
    void prepare() {
        ui.post(() -> {
            if (exo == null || url == null) return;
            MediaItem.Builder b = new MediaItem.Builder().setUri(Uri.parse(url));
            String l = url.toLowerCase();
            if (l.contains(".m3u8") || l.contains("/hls/") || l.contains("format=m3u8")) b.setMimeType(MimeTypes.APPLICATION_M3U8);
            else if (l.contains(".mpd")) b.setMimeType(MimeTypes.APPLICATION_MPD);
            exo.setMediaItem(b.build());
            exo.setPlayWhenReady(false);
            exo.prepare();
        });
    }
    void play() { ui.post(() -> { wantPlay = true; if (exo != null) exo.setPlayWhenReady(true); }); }
    void pause() { ui.post(() -> { wantPlay = false; if (exo != null) exo.setPlayWhenReady(false); }); }
    void stop() { ui.post(() -> { wantPlay = false; if (exo != null) exo.stop(); }); }
    void close() {
        ui.post(() -> {
            wantPlay = false; url = null; prepared = false;
            if (exo != null) { exo.stop(); exo.clearMediaItems(); }
            view.setVisibility(View.GONE);
            tracksJson = "[]"; currentJson = "[]"; audio.clear(); text.clear(); video.clear(); videoJson = "{}"; statsJson = "{}";
        });
    }
    void seek(long ms, int id) { ui.post(() -> { if (exo == null) return; pendingSeek = id; exo.seekTo(Math.max(0, ms)); positionMs = ms; }); }
    double duration() { return durationMs; }
    double position() { return positionMs; }

    /* Where the picture goes, in the page's 1920 x 1080 coordinates */
    void rect(double x, double y, double w, double h) {
        lastRect = new double[]{x, y, w, h};
        ui.post(this::placeView);
    }
    private void placeView() {
        if (view == null || web == null) return;
        float k = web.getWidth() > 0 ? web.getWidth() / 1920f : act.getResources().getDisplayMetrics().widthPixels / 1920f;
        FrameLayout.LayoutParams p = new FrameLayout.LayoutParams(Math.round((float) lastRect[2] * k), Math.round((float) lastRect[3] * k));
        p.leftMargin = Math.round((float) lastRect[0] * k);
        p.topMargin = Math.round((float) lastRect[1] * k);
        view.setLayoutParams(p);
    }
    void method(String m) {
        ui.post(() -> view.setResizeMode(m != null && m.contains("FULL_SCREEN") ? AspectRatioFrameLayout.RESIZE_MODE_FILL : AspectRatioFrameLayout.RESIZE_MODE_FIT));
    }
    private DefaultHttpDataSource.Factory http;
    void property(String key, String value) {
        // a server that only lets some players in (the app remembered which): its streams under the same name
        if ("USER_AGENT".equals(key)) { String ua = value == null || value.isEmpty() ? UA : value; ui.post(() -> { if (http != null) http.setUserAgent(ua); }); return; }
        // "the best quality from the start" (Samsung's ADAPTIVE_INFO STARTBITRATE=HIGHEST)
        if ("ADAPTIVE_INFO".equals(key) && value != null && value.contains("HIGHEST"))
            ui.post(() -> { if (selector != null) selector.setParameters(selector.buildUponParameters().setForceHighestSupportedBitrate(true)); });
    }

    /* ---------- tracks, in AVPlay's shape ---------- */
    private void readTracks() {
        if (exo == null) return;
        audio.clear(); text.clear(); video.clear();
        JSONArray all = new JSONArray(), cur = new JSONArray(), vids = new JSONArray();
        StringBuilder sum = new StringBuilder();
        boolean anyAudio = false, audioOk = false;
        String badAudio = "";
        try {
            List<Tracks.Group> groups = exo.getCurrentTracks().getGroups();
            for (int g = 0; g < groups.size(); g++) {
                Tracks.Group grp = groups.get(g);
                int type = grp.getType();
                if (type != C.TRACK_TYPE_AUDIO && type != C.TRACK_TYPE_TEXT && type != C.TRACK_TYPE_VIDEO) continue;
                // the log line: every track, with what this device can play
                for (int i = 0; i < grp.length; i++) {
                    Format f = grp.getTrackFormat(i);
                    boolean ok = grp.isTrackSupported(i, true);
                    if (sum.length() > 0) sum.append(", ");
                    sum.append(type == C.TRACK_TYPE_VIDEO ? "video " : type == C.TRACK_TYPE_AUDIO ? "audio " : "text ").append(describe(f));
                    if (!ok && type != C.TRACK_TYPE_TEXT) sum.append(" (not supported here)");
                    if (type == C.TRACK_TYPE_AUDIO) { anyAudio = true; if (ok) audioOk = true; else if (badAudio.isEmpty()) badAudio = shortName(f.sampleMimeType); }
                }
                // the qualities of the picture (a stream with several): for the Quality button
                if (type == C.TRACK_TYPE_VIDEO) for (int i = 0; i < grp.length; i++) {
                    if (!grp.isTrackSupported(i, true)) continue;
                    Format f = grp.getTrackFormat(i);
                    JSONObject q = new JSONObject();
                    q.put("index", video.size()); q.put("w", f.width); q.put("h", f.height); q.put("bitrate", f.bitrate > 0 ? f.bitrate : 0);
                    video.add(new int[]{g, i});
                    vids.put(q);
                }
                for (int i = 0; i < grp.length; i++) {
                    // A track beyond what the decoder announces (4K HEVC on a small device) can still be the
                    // one that plays: keep it when it is selected
                    if (!grp.isTrackSupported(i, true) && !grp.isTrackSelected(i) && type != C.TRACK_TYPE_TEXT) continue;
                    Format f = grp.getTrackFormat(i);
                    JSONObject extra = new JSONObject();
                    String kind; int index;
                    if (type == C.TRACK_TYPE_AUDIO) { kind = "AUDIO"; index = audio.size(); audio.add(new int[]{g, i}); }
                    else if (type == C.TRACK_TYPE_TEXT) { kind = "TEXT"; index = text.size(); text.add(new int[]{g, i}); }
                    else { kind = "VIDEO"; index = 0; }
                    extra.put("language", f.language != null ? f.language : "");
                    extra.put("fourCC", f.codecs != null ? f.codecs : (f.sampleMimeType != null ? f.sampleMimeType : ""));
                    if (type == C.TRACK_TYPE_AUDIO) extra.put("channels", f.channelCount > 0 ? String.valueOf(f.channelCount) : "");
                    if (type == C.TRACK_TYPE_VIDEO) {
                        extra.put("Width", f.width); extra.put("Height", f.height);
                        extra.put("FrameRate", f.frameRate > 0 ? String.valueOf(Math.round(f.frameRate)) : "");
                        extra.put("Bit_rate", f.bitrate > 0 ? String.valueOf(f.bitrate) : "");
                    }
                    if (f.label != null) extra.put("label", f.label);
                    JSONObject t = new JSONObject();
                    t.put("index", index); t.put("type", kind); t.put("extra_info", extra.toString());
                    if (type != C.TRACK_TYPE_VIDEO) all.put(t);
                    if (grp.isTrackSelected(i)) cur.put(t);
                }
            }
        } catch (Exception ignored) {}
        tracksJson = all.toString();
        currentJson = cur.toString();
        try { JSONObject v = new JSONObject(); v.put("override", videoOverride); v.put("list", vids); videoJson = v.toString(); } catch (Exception ignored) {}
        String s = sum.toString();
        if (s.length() > 0 && !s.equals(lastSummary)) {
            lastSummary = s;
            try {
                JSONObject o = new JSONObject();
                o.put("tracks", s.length() > 600 ? s.substring(0, 600) + "…" : s);
                o.put("noAudio", anyAudio && !audioOk ? badAudio : "");
                event("info", o.toString());
            } catch (Exception ignored) {}
        }
    }
    private String lastSummary = "";
    private static String describe(Format f) {
        StringBuilder b = new StringBuilder(shortName(f.sampleMimeType));
        if (f.codecs != null) b.append(" ").append(f.codecs);
        if (f.width > 0) b.append(" ").append(f.width).append("x").append(f.height);
        if (f.channelCount > 0) b.append(" ").append(f.channelCount).append("ch");
        if (f.language != null) b.append(" ").append(f.language);
        return b.toString();
    }
    /* "audio/vnd.dts.hd" → "DTS-HD": the name people know */
    private static String shortName(String mime) {
        if (mime == null) return "?";
        switch (mime) {
            case MimeTypes.AUDIO_AC3: return "AC3";
            case MimeTypes.AUDIO_E_AC3: case MimeTypes.AUDIO_E_AC3_JOC: return "E-AC3";
            case MimeTypes.AUDIO_AC4: return "AC4";
            case MimeTypes.AUDIO_DTS: return "DTS";
            case MimeTypes.AUDIO_DTS_HD: return "DTS-HD";
            case MimeTypes.AUDIO_DTS_EXPRESS: return "DTS Express";
            case MimeTypes.AUDIO_TRUEHD: return "TrueHD";
            case MimeTypes.AUDIO_AAC: return "AAC";
            case MimeTypes.AUDIO_MPEG: return "MP3";
            case MimeTypes.AUDIO_OPUS: return "Opus";
            case MimeTypes.AUDIO_FLAC: return "FLAC";
            case MimeTypes.VIDEO_H265: return "HEVC";
            case MimeTypes.VIDEO_H264: return "H.264";
            case MimeTypes.VIDEO_AV1: return "AV1";
            case MimeTypes.VIDEO_VP9: return "VP9";
            case MimeTypes.VIDEO_MPEG2: return "MPEG-2";
            default: return mime.replaceFirst("^[a-z]+/", "");
        }
    }
    /* Stream Info (the page asks once a second while it shows it): the picture, the sound, the connection */
    private void readStats() {
        if (exo == null) return;
        try {
            JSONObject o = new JSONObject();
            Format v = exo.getVideoFormat(), a = exo.getAudioFormat();
            if (v != null) {
                o.put("w", v.width); o.put("h", v.height);
                if (v.frameRate > 0) o.put("fps", v.frameRate);
                o.put("vcodec", v.codecs != null ? v.codecs : (v.sampleMimeType != null ? v.sampleMimeType : ""));
                if (v.bitrate > 0) o.put("vbitrate", v.bitrate);
                if (v.colorInfo != null) {
                    if (v.colorInfo.colorTransfer == C.COLOR_TRANSFER_ST2084) o.put("hdr", MimeTypes.VIDEO_DOLBY_VISION.equals(v.sampleMimeType) ? "Dolby Vision" : "HDR10");
                    else if (v.colorInfo.colorTransfer == C.COLOR_TRANSFER_HLG) o.put("hdr", "HLG");
                }
            }
            if (a != null) {
                o.put("acodec", a.sampleMimeType != null ? a.sampleMimeType : (a.codecs != null ? a.codecs : ""));
                if (a.channelCount > 0) o.put("channels", a.channelCount);
                if (a.sampleRate > 0) o.put("rate", a.sampleRate);
                if (a.bitrate > 0) o.put("abitrate", a.bitrate);
            }
            if (meter != null) o.put("bandwidth", meter.getBitrateEstimate());
            o.put("buffered", exo.getTotalBufferedDuration() / 1000.0);
            DecoderCounters dc = exo.getVideoDecoderCounters();
            if (dc != null) { dc.ensureUpdated(); o.put("dropped", dc.droppedBufferCount); o.put("frames", dc.renderedOutputBufferCount); }
            statsJson = o.toString();
        } catch (Exception ignored) {}
    }
    String stats() {
        if (System.currentTimeMillis() - statsWanted > 4000) ui.post(this::readStats);
        statsWanted = System.currentTimeMillis();
        return statsJson;
    }
    String videoJson() { return videoJson; }
    /* One quality of the picture (index in the list), or -1: automatic again */
    void selectVideo(int index) {
        ui.post(() -> {
            if (exo == null) return;
            if (index < 0 || index >= video.size()) {
                videoOverride = -1;
                exo.setTrackSelectionParameters(exo.getTrackSelectionParameters().buildUpon().clearOverridesOfType(C.TRACK_TYPE_VIDEO).build());
            } else {
                int[] gi = video.get(index);
                Tracks.Group grp = exo.getCurrentTracks().getGroups().get(gi[0]);
                videoOverride = index;
                exo.setTrackSelectionParameters(exo.getTrackSelectionParameters().buildUpon()
                    .setOverrideForType(new TrackSelectionOverride(grp.getMediaTrackGroup(), gi[1])).build());
            }
        });
    }
    String tracksJson() { return tracksJson; }
    String currentJson() { return currentJson; }
    void select(String type, int index) {
        ui.post(() -> {
            if (exo == null) return;
            List<int[]> list = "AUDIO".equals(type) ? audio : text;
            if (index < 0 || index >= list.size()) return;
            int[] gi = list.get(index);
            Tracks.Group grp = exo.getCurrentTracks().getGroups().get(gi[0]);
            exo.setTrackSelectionParameters(exo.getTrackSelectionParameters().buildUpon()
                .setTrackTypeDisabled(grp.getType(), false)
                .setOverrideForType(new TrackSelectionOverride(grp.getMediaTrackGroup(), gi[1])).build());
        });
    }
    void subtitles(boolean on) {
        ui.post(() -> { if (exo != null) exo.setTrackSelectionParameters(exo.getTrackSelectionParameters().buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, !on).build()); });
    }

    /* The app in the background: the picture waits (a channel starts again live when it comes back) */
    void suspend() { ui.post(() -> { if (exo == null || suspended) return; suspended = true; wasPlaying = exo.getPlayWhenReady(); exo.setPlayWhenReady(false); }); }
    void restore() { ui.post(() -> { if (exo == null || !suspended) return; suspended = false; if (wasPlaying) exo.setPlayWhenReady(true); }); }
    void release() { ui.removeCallbacks(ticker); if (exo != null) { exo.release(); exo = null; } }
}

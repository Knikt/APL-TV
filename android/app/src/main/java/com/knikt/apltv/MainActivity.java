package com.knikt.apltv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.util.SparseIntArray;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

/* APL TV on Android: the same web app as on Samsung and LG, in a WebView, over the video.
   - The page (assets/app) is drawn transparent over the video plane (Player.java, ExoPlayer), as on
     Samsung where AVPlay is under the page.
   - The remote: the arrows, OK, Back, the media, channel, colour and number keys are sent to the page
     with Samsung's key codes, so the app's code is the same everywhere (while text is typed, the
     keys go to the keyboard instead).
   - window.APLAndroid: what the page asks of Android (the player, quitting, the helper service). */
public class MainActivity extends Activity {
    private WebView web;
    private Player player;
    private Helper helper;
    private volatile boolean editing = false;
    // What APL TV was opened for (APL Launcher's Top Shelf: resume=<title>, channel=<channel>…), read once by the page
    private volatile String request = "";

    private static final SparseIntArray KEYS = new SparseIntArray();
    static {
        KEYS.put(KeyEvent.KEYCODE_DPAD_UP, 38);
        KEYS.put(KeyEvent.KEYCODE_DPAD_DOWN, 40);
        KEYS.put(KeyEvent.KEYCODE_DPAD_LEFT, 37);
        KEYS.put(KeyEvent.KEYCODE_DPAD_RIGHT, 39);
        KEYS.put(KeyEvent.KEYCODE_DPAD_CENTER, 13);
        KEYS.put(KeyEvent.KEYCODE_ENTER, 13);
        KEYS.put(KeyEvent.KEYCODE_NUMPAD_ENTER, 13);
        KEYS.put(KeyEvent.KEYCODE_BUTTON_A, 13);
        KEYS.put(KeyEvent.KEYCODE_BACK, 10009);
        KEYS.put(KeyEvent.KEYCODE_BUTTON_B, 10009);
        KEYS.put(KeyEvent.KEYCODE_ESCAPE, 10009);
        KEYS.put(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, 10252);
        KEYS.put(KeyEvent.KEYCODE_HEADSETHOOK, 10252);
        KEYS.put(KeyEvent.KEYCODE_MEDIA_PLAY, 415);
        KEYS.put(KeyEvent.KEYCODE_MEDIA_PAUSE, 19);
        KEYS.put(KeyEvent.KEYCODE_MEDIA_STOP, 413);
        KEYS.put(KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, 417);
        KEYS.put(KeyEvent.KEYCODE_MEDIA_REWIND, 412);
        KEYS.put(KeyEvent.KEYCODE_MEDIA_NEXT, 10233);
        KEYS.put(KeyEvent.KEYCODE_MEDIA_PREVIOUS, 10232);
        KEYS.put(KeyEvent.KEYCODE_CHANNEL_UP, 427);
        KEYS.put(KeyEvent.KEYCODE_CHANNEL_DOWN, 428);
        KEYS.put(KeyEvent.KEYCODE_PAGE_UP, 427);
        KEYS.put(KeyEvent.KEYCODE_PAGE_DOWN, 428);
        KEYS.put(KeyEvent.KEYCODE_LAST_CHANNEL, 10190);
        KEYS.put(KeyEvent.KEYCODE_INFO, 457);
        KEYS.put(KeyEvent.KEYCODE_GUIDE, 458);
        KEYS.put(KeyEvent.KEYCODE_TV_INPUT, 10073);
        KEYS.put(KeyEvent.KEYCODE_PROG_RED, 403);
        KEYS.put(KeyEvent.KEYCODE_PROG_GREEN, 404);
        KEYS.put(KeyEvent.KEYCODE_PROG_YELLOW, 405);
        KEYS.put(KeyEvent.KEYCODE_PROG_BLUE, 406);
        for (int i = 0; i <= 9; i++) KEYS.put(KeyEvent.KEYCODE_0 + i, 48 + i);
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Crash.install(this);              // an error no code catches: written down for the next start (js/crash.js)
        takeRequest(getIntent());
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        // The page and the video are 16:9 (1920 x 1080): they go on a stage of that shape, as large as the
        // screen allows and centred. A screen of another shape (a phone, a tablet, MEmu's window) gets
        // black bars instead of a page cut on one side.
        final FrameLayout stage = new FrameLayout(this);
        root.addView(stage, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT, Gravity.CENTER));
        root.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> {
            int w = r - l, h = b - t;
            if (w <= 0 || h <= 0) return;
            int sw = Math.min(w, Math.round(h * 16f / 9f)), sh = Math.min(h, Math.round(sw * 9f / 16f));
            FrameLayout.LayoutParams p = (FrameLayout.LayoutParams) stage.getLayoutParams();
            if (p.width == sw && p.height == sh) return;
            p.width = sw; p.height = sh; p.gravity = Gravity.CENTER;
            stage.post(() -> stage.setLayoutParams(p));
        });

        this.stage = stage;
        player = new Player(this, stage);
        web = makePage();
        stage.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        player.attach(web);

        helper = new Helper(this);
        helper.start();
        Crash.use(helper);

        web.loadUrl(PAGE);
        web.requestFocus();
    }

    private static final String PAGE = "file:///android_asset/app/index.html";
    private FrameLayout stage;
    /* The page: the WebView and its settings (made again when Android stopped the old one, pageGone) */
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private WebView makePage() {
        WebView web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        // The page comes from the app (file://) and talks to IPTV providers that send no CORS headers,
        // as Samsung and LG apps may.
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);          // the page is 1920 x 1080 (its viewport): scaled to the screen
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " APLTV-Android");
        s.setTextZoom(100);
        web.setInitialScale(0);
        web.setWebViewClient(new WebViewClient() {
            /* The page runs in a process of its own, which Android stops when memory is short (a Fire TV Stick), or
               which can crash. Without this, Android then closed the whole app: the page is made again instead. */
            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail d) {
                pageGone(view, d != null && d.didCrash());
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        if (BuildConfigDebug.on(this)) WebView.setWebContentsDebuggingEnabled(true);
        web.addJavascriptInterface(new Bridge(), "APLAndroid");
        return web;
    }

    /* ---------- the page stopped by Android ----------
       The old WebView can't be used again: it goes, the video stops (the new page starts from Home), and a new one
       opens; at once when the app is on screen, otherwise when it comes back. A fourth time with less than two minutes
       between each: closed, as before, rather than starting again without end. */
    private boolean visible = false, pageWanted = false;
    private int pageRestarts = 0;
    private long pageRestartAt = 0;
    private void pageGone(WebView dead, boolean crashed) {
        String why = crashed ? "crashed" : "was stopped by Android (memory)";
        android.util.Log.w("APLTV", "the page " + why);
        if (stage != null) stage.removeView(dead);
        if (dead != web) { dead.destroy(); return; }
        web = null;
        editing = false;
        if (player != null) { player.page(null); player.close(); }
        dead.destroy();
        if (helper != null) helper.pageGone(why);
        if (visible) Crash.pageStopped(crashed);           // the new page offers to send a report (js/crash.js)
        long now = android.os.SystemClock.elapsedRealtime();
        pageRestarts = now - pageRestartAt < 120000 ? pageRestarts + 1 : 1;
        pageRestartAt = now;
        if (pageRestarts > 3) { android.util.Log.w("APLTV", "the page keeps stopping: APL TV closes"); finishAndRemoveTask(); return; }
        if (visible) newPage(); else pageWanted = true;
    }
    private void newPage() {
        pageWanted = false;
        if (isFinishing() || isDestroyed()) return;
        web = makePage();
        stage.addView(web, Math.min(1, stage.getChildCount()), new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));   // over the video
        player.page(web);
        web.loadUrl(PAGE);
        web.requestFocus();
    }

    /* ---------- what APL TV is opened for ----------
       Samsung's app control data and LG's launch parameters are Intent extras here: APL Launcher's Top Shelf
       opens APL TV with resume=<title> or channel=<channel> (js/app.js readRequest). Opened again while
       running: the page hears "appcontrol", as on Samsung. */
    private static final String[] REQUEST_KEYS = { "resume", "title", "channel", "tab", "search", "play" };
    private boolean takeRequest(Intent i) {
        if (i == null || i.getExtras() == null) return false;
        JSONObject o = new JSONObject();
        try {
            for (String k : REQUEST_KEYS) {
                String v = i.getStringExtra(k);
                if (v != null && v.length() > 0 && v.length() <= 120) o.put(k, v);
            }
        } catch (Exception e) { return false; }
        if (o.length() == 0) return false;
        request = o.toString();
        return true;
    }
    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        if (takeRequest(i) && web != null)
            web.evaluateJavascript("(function(){var e=document.createEvent('Event');e.initEvent('appcontrol',false,false);window.dispatchEvent(e);})()", null);
    }

    /* ---------- the remote ---------- */
    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = KEYS.get(e.getKeyCode(), 0);
        if (code == 0 || web == null) return super.dispatchKeyEvent(e);
        // Typing: the keyboard and the text field have the keys (Back closes the keyboard)
        if (editing && code != 10009) {
            /* An open keyboard takes the arrows before the app does (Android hands keys to the keyboard first). An
               arrow that reaches the app means no keyboard is on screen any more (Back closed it, or it never opened,
               as on some Fire TV): the typing ends there, like Done, instead of the remote doing nothing (#17) */
            int k = e.getKeyCode();
            if (e.getAction() == KeyEvent.ACTION_DOWN && (k == KeyEvent.KEYCODE_DPAD_UP || k == KeyEvent.KEYCODE_DPAD_DOWN || k == KeyEvent.KEYCODE_DPAD_LEFT || k == KeyEvent.KEYCODE_DPAD_RIGHT)) {
                editing = false; sendKey("keydown", 10009, false); sendKey("keyup", 10009, false);
                return true;
            }
            return super.dispatchKeyEvent(e);
        }
        if (e.getAction() == KeyEvent.ACTION_DOWN) sendKey("keydown", code, e.getRepeatCount() > 0);
        else if (e.getAction() == KeyEvent.ACTION_UP) sendKey("keyup", code, false);
        return true;
    }
    private void sendKey(String type, int code, boolean repeat) {
        web.evaluateJavascript("window.__aplKey&&__aplKey('" + type + "'," + code + "," + repeat + ")", null);
    }

    /* ---------- the page's link to Android ---------- */
    public class Bridge {
        @JavascriptInterface public String platform() { return "android"; }
        /* "Sony BRAVIA XR A80L": for js/saver.js, which recognises OLED TV sets by their name */
        @JavascriptInterface public String model() { return android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL; }
        /* Whether 4K versions of a channel go first (js/player.js) */
        @JavascriptInterface public boolean canUhd() { return Player.canUhd(MainActivity.this); }
        /* The version of the package itself (.apk): the app's pages update themselves, the package doesn't */
        @JavascriptInterface public String version() { try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return ""; } }
        @JavascriptInterface public void exit() { runOnUiThread(() -> { player.close(); finishAndRemoveTask(); }); }
        @JavascriptInterface public void background() { runOnUiThread(() -> moveTaskToBack(true)); }
        @JavascriptInterface public void startHelper() { helper.start(); }
        /* Sports (js/sports.js): a match's video summary, opened in the YouTube app (or SmartTube, whichever the
           screen chooses). YouTube's own addresses only. */
        @JavascriptInterface public boolean openLink(String url) {
            if (url == null || !url.startsWith("https://www.youtube.com/watch?v=")) return false;
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                return true;
            } catch (Exception e) {
                return false;
            }
        }
        // What APL TV was opened for, once ("" when nothing)
        @JavascriptInterface public String request() { String r = request; request = ""; return r; }
        // APL Launcher's Top Shelf (ShelfProvider.java)
        @JavascriptInterface public void shelf(String json) { ShelfProvider.write(MainActivity.this, json); }
        @JavascriptInterface public void editing(boolean on) {
            editing = on;
            runOnUiThread(() -> {
                InputMethodManager im = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                WebView w = web;
                if (im == null || w == null) return;
                if (on) { w.requestFocus(); im.showSoftInput(w, InputMethodManager.SHOW_IMPLICIT); }
                else im.hideSoftInputFromWindow(w.getWindowToken(), 0);
            });
        }
        // The player (Player.java): the same calls as Samsung's AVPlay, through js/android.js
        @JavascriptInterface public void open(String url) { player.open(url); }
        @JavascriptInterface public void prepare() { player.prepare(); }
        @JavascriptInterface public void play() { player.play(); }
        @JavascriptInterface public void pause() { player.pause(); }
        @JavascriptInterface public void stop() { player.stop(); }
        @JavascriptInterface public void close() { player.close(); }
        @JavascriptInterface public void seek(double ms, int id) { player.seek((long) ms, id); }
        @JavascriptInterface public double duration() { return player.duration(); }
        @JavascriptInterface public double position() { return player.position(); }
        @JavascriptInterface public void rect(double x, double y, double w, double h) { player.rect(x, y, w, h); }
        @JavascriptInterface public void method(String m) { player.method(m); }
        @JavascriptInterface public String tracks() { return player.tracksJson(); }
        @JavascriptInterface public String current() { return player.currentJson(); }
        @JavascriptInterface public void select(String type, int index) { player.select(type, index); }
        @JavascriptInterface public void subtitles(boolean on) { player.subtitles(on); }
        @JavascriptInterface public void property(String key, String value) { player.property(key, value); }
        /* 1.0.11: Stream Info and the Quality button */
        @JavascriptInterface public String stats() { return player.stats(); }
        @JavascriptInterface public String videoTracks() { return player.videoJson(); }
        @JavascriptInterface public void selectVideo(int index) { player.selectVideo(index); }
        /* AV Sync, in milliseconds: + the sound later, - earlier (Settings > Playback) */
        @JavascriptInterface public void audioDelay(int ms) { Player.audioOffsetUs = Math.max(-2000, Math.min(2000, ms)) * 1000L; }
        @JavascriptInterface public void suspend() { player.suspend(); }
        /* js/crash.js: what Android knows about the last stop without warning, then "answered" */
        /* js/core.js TV.SMALL: { total, free (MB), small, heap } */
        @JavascriptInterface public String memory() { return Crash.memoryJson(MainActivity.this); }
        /* Light Mode as the page decided it (Automatic, On or Off in Settings) */
        @JavascriptInterface public void light(boolean on) { Crash.forced = on; }
        @JavascriptInterface public String crashReport() { return Crash.report(MainActivity.this); }
        @JavascriptInterface public void crashDone() { Crash.done(MainActivity.this); }
        /* Development builds only: an error on purpose, to try the "Oops" box ("java": in a thread, "page": the page's process) */
        @JavascriptInterface public void crashTest(String kind) {
            if (!BuildConfigDebug.on(MainActivity.this)) return;
            if ("page".equals(kind)) runOnUiThread(() -> { WebView w = web; if (w != null) w.loadUrl("chrome://crash"); });
            else new Thread(() -> { throw new IllegalStateException("APL TV crash test (development build)"); }, "crash-test").start();
        }
        @JavascriptInterface public void restore() { player.restore(); }
    }

    @Override protected void onPause() {
        super.onPause();
        if (web == null) return;
        // APL Launcher's Top Shelf gets what you were just watching (js/app.js pushShelf)
        web.evaluateJavascript("window.TV&&TV.shelfNow&&TV.shelfNow()", null);
        web.onPause();
    }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onStop() { super.onStop(); visible = false; if (player != null) player.suspend(); }
    @Override protected void onStart() { super.onStart(); visible = true; if (pageWanted) newPage(); if (player != null) player.restore(); }
    /* Android says memory is short: the guides the helper keeps go first (the page already has what it asked) */
    @Override public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (helper != null && (level == TRIM_MEMORY_RUNNING_LOW || level == TRIM_MEMORY_RUNNING_CRITICAL || level >= TRIM_MEMORY_MODERATE))
            helper.trim("Android asked to free memory (" + level + ")");
    }
    @Override
    protected void onDestroy() {
        if (helper != null) helper.stop();
        if (player != null) player.release();
        if (web != null) { web.removeJavascriptInterface("APLAndroid"); web.destroy(); }
        super.onDestroy();
    }

    /* Inspecting the page from a PC (chrome://inspect) only in debuggable builds */
    static final class BuildConfigDebug {
        static boolean on(Context c) { return (c.getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0; }
    }
}

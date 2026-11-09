package com.knikt.apltv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
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

        player = new Player(this, stage);
        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        stage.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

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
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());
        if (BuildConfigDebug.on(this)) WebView.setWebContentsDebuggingEnabled(true);

        player.attach(web);
        web.addJavascriptInterface(new Bridge(), "APLAndroid");

        helper = new Helper(this);
        helper.start();

        web.loadUrl("file:///android_asset/app/index.html");
        web.requestFocus();
    }

    /* ---------- the remote ---------- */
    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = KEYS.get(e.getKeyCode(), 0);
        if (code == 0 || web == null) return super.dispatchKeyEvent(e);
        // Typing: the keyboard and the text field have the keys (Back closes the keyboard)
        if (editing && code != 10009) return super.dispatchKeyEvent(e);
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
        @JavascriptInterface public void exit() { runOnUiThread(() -> { player.close(); finishAndRemoveTask(); }); }
        @JavascriptInterface public void background() { runOnUiThread(() -> moveTaskToBack(true)); }
        @JavascriptInterface public void startHelper() { helper.start(); }
        @JavascriptInterface public void editing(boolean on) {
            editing = on;
            runOnUiThread(() -> {
                InputMethodManager im = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                if (im == null) return;
                if (on) { web.requestFocus(); im.showSoftInput(web, InputMethodManager.SHOW_IMPLICIT); }
                else im.hideSoftInputFromWindow(web.getWindowToken(), 0);
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
        @JavascriptInterface public void suspend() { player.suspend(); }
        @JavascriptInterface public void restore() { player.restore(); }
    }

    @Override protected void onPause() { super.onPause(); if (web != null) web.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onStop() { super.onStop(); if (player != null) player.suspend(); }
    @Override protected void onStart() { super.onStart(); if (player != null) player.restore(); }
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

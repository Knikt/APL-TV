package com.knikt.apltv;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/* APL Launcher's Top Shelf on Android: what you were watching and your last channel.
   On Samsung and LG, APL TV writes this list in /tmp/apltv-shelf.json for APL Launcher. Android apps share no
   such folder: APL TV keeps it in its own files (js/app.js pushShelf, through MainActivity's Bridge.shelf) and
   hands it over here, to APL Launcher only (its package name AND its signing certificate). Titles, pictures,
   progress and the ids to open them in APL TV: no address, no account, as on Samsung.
   content://com.knikt.apltv.shelf/shelf, one row, one column "json". */
public class ShelfProvider extends ContentProvider {
    static final String FILE = "apltv-shelf.json";
    static final int MAX = 60000;
    private static final String LAUNCHER = "com.knikt.apllauncher";
    // APL Launcher's own key (docs/android.md of APL Launcher): CN=APL Launcher, O=Gero Corp., C=FR
    private static final String LAUNCHER_CERT = "d93ce36b3cd7011e01817ff319c1ae386a8c48489de006ef0f6153876bd686a6";

    @Override public boolean onCreate() { return true; }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        if (!fromLauncher()) return null;
        MatrixCursor c = new MatrixCursor(new String[] { "json" });
        String json = read(getContext());
        if (json != null) c.addRow(new Object[] { json });
        return c;
    }

    @Override public String getType(Uri uri) { return "application/json"; }
    @Override public Uri insert(Uri uri, ContentValues v) { return null; }
    @Override public int delete(Uri uri, String s, String[] a) { return 0; }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { return 0; }

    /* Written by APL TV's page; read only here */
    static void write(Context ctx, String json) {
        if (json == null || json.length() > MAX || !json.startsWith("{")) return;
        File f = new File(ctx.getFilesDir(), FILE), tmp = new File(ctx.getFilesDir(), FILE + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(json.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) { Log.w("APLTV", "shelf: " + e); return; }
        if (!tmp.renameTo(f)) Log.w("APLTV", "shelf: not saved");
    }

    static String read(Context ctx) {
        File f = new File(ctx.getFilesDir(), FILE);
        if (!f.isFile() || f.length() > MAX) return null;
        byte[] b = new byte[(int) f.length()];
        try (FileInputStream in = new FileInputStream(f)) {
            int n = 0, r;
            while (n < b.length && (r = in.read(b, n, b.length - n)) > 0) n += r;
            return new String(b, 0, n, StandardCharsets.UTF_8);
        } catch (Exception e) { return null; }
    }

    private boolean fromLauncher() {
        Context ctx = getContext();
        String pkg = Build.VERSION.SDK_INT >= 19 ? getCallingPackage() : null;
        if (ctx == null || !LAUNCHER.equals(pkg)) return false;
        try {
            PackageManager pm = ctx.getPackageManager();
            Signature[] sigs;
            if (Build.VERSION.SDK_INT >= 28) {
                PackageInfo pi = pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES);
                if (pi.signingInfo == null || pi.signingInfo.hasMultipleSigners()) return false;
                sigs = pi.signingInfo.getSigningCertificateHistory();
            } else {
                @SuppressWarnings("deprecation")
                PackageInfo pi = pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES);
                sigs = pi.signatures;
            }
            if (sigs == null) return false;
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            for (Signature s : sigs) {
                StringBuilder hex = new StringBuilder();
                for (byte x : md.digest(s.toByteArray())) hex.append(String.format("%02x", x));
                if (LAUNCHER_CERT.equals(hex.toString())) return true;
            }
        } catch (Exception e) { Log.w("APLTV", "shelf: " + e); }
        Log.w("APLTV", "shelf: refused to " + pkg);
        return false;
    }
}

"""Builds APL TV for Android TV, Google TV and Fire TV: an .apk.

    python tools/make-android.py              your own devices: your keys, fonts and sounds (never publish it)
    python tools/make-android.py --release    the package for GitHub Releases: no personal file
    python tools/make-android.py --dev        your own devices, with the development log (js/dev.local.js)

Needs a JDK 17+, the Android SDK (platforms/android-35, build-tools/35.0.0) and Gradle 8.10:
    ANDROID_HOME (default E:/Android/Sdk), GRADLE (default E:/Android/gradle-8.10.2/bin/gradle.bat),
    JAVA_HOME (default: the Temurin JDK 21 of this PC), GRADLE_USER_HOME (default E:/Android/gradle-home).

The app is the same code as on Samsung and LG (app/), copied into the Android app's assets: it finds
out it runs on Android (js/android.js) and uses the app's player (ExoPlayer) and helper (Helper.java).

Signing: an Android app must always be signed with the SAME key, or it cannot be updated (the old one
has to be uninstalled first, which loses the playlists). The key is kept outside the repository, as
android-release.jks with its password file android-release.txt next to it, in the first of these
folders that has it: APL_KEYSTORE_DIR (only that one when it is set), E:/Android/keys-backup (this
PC), %APPDATA%/APL-TV. On GitHub it comes from the repository's secrets (APL_KEYSTORE_FILE and
APL_KEYSTORE_PASS). No key found: the build stops; --new-key makes a new one (a brand new app
only), --unsigned only checks that it builds. Keep a copy of the key safe.
"""
import json, os, re, secrets, shutil, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
A = os.path.join(ROOT, "app")
AND = os.path.join(ROOT, "android")
MAIN = os.path.join(AND, "app", "src", "main")

release = "--release" in sys.argv
dev = "--dev" in sys.argv and not release
out = os.path.join(ROOT, "dist")

config = open(os.path.join(A, "config.xml"), encoding="utf-8").read()
version = re.search(r'<widget[^>]*\sversion="([^"]+)"', config).group(1)

# ---- the web app in the assets
assets = os.path.join(MAIN, "assets")
shutil.rmtree(assets, ignore_errors=True)
app_dir = os.path.join(assets, "app")
os.makedirs(app_dir)
SKIP_TOP = {"config.xml", "service", "version.json", ".manifest.tmp", "author-signature.xml", "signature1.xml"}
def skip(rel):
    rel = rel.replace("\\", "/")
    if rel.split("/")[0] in SKIP_TOP or rel.endswith(".wgt"):
        return True
    if rel in ("js/keys.local.js", "js/dev.local.js", "js/keys.example.js"):
        return True
    if release and (rel.startswith("fonts/") or rel.startswith("sounds/")) and not rel.endswith((".css", ".md", ".txt")):
        return True
    return False
for base, dirs, files in os.walk(A):
    for f in files:
        src = os.path.join(base, f)
        rel = os.path.relpath(src, A)
        if skip(rel):
            continue
        dst = os.path.join(app_dir, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
html = open(os.path.join(A, "index.html"), encoding="utf-8").read()
html = re.sub(r'\s*<!-- Samsung API[^>]*-->\s*<script src="\$WEBAPIS/webapis/webapis\.js"></script>', "", html)
if "$WEBAPIS" in html:
    sys.exit("index.html: Samsung's script line was not found, update tools/make-android.py")
open(os.path.join(app_dir, "index.html"), "w", encoding="utf-8", newline="\n").write(html)
keys_src = os.path.join(A, "js", "keys.example.js" if release else "keys.local.js")
if not os.path.exists(keys_src):
    keys_src = os.path.join(A, "js", "keys.example.js")
shutil.copy2(keys_src, os.path.join(app_dir, "js", "keys.local.js"))
dev_src = os.path.join(A, "js", "dev.local.js")
if dev and os.path.exists(dev_src):
    shutil.copy2(dev_src, os.path.join(app_dir, "js", "dev.local.js"))
else:
    open(os.path.join(app_dir, "js", "dev.local.js"), "w", encoding="utf-8", newline="\n").write("/* release build */\n")

# ---- the phone setup page: the very one of service.js (Samsung, LG), for Helper.java
helper_dir = os.path.join(assets, "helper")
os.makedirs(helper_dir)
js = (
    "global.APLTV_NO_START = true; var s = require(process.argv[1]); var fs = require('fs'), path = require('path'), out = process.argv[2];"
    "[['en', 'en-US'], ['fr', 'fr-FR'], ['pl', 'pl-PL']].forEach(function (l) {"
    " fs.writeFileSync(path.join(out, 'phone-' + l[0] + '.html'), s.phonePage(l[1], '__APLTV_TOKEN__', true));"
    " fs.writeFileSync(path.join(out, 'expired-' + l[0] + '.html'), s.phonePage(l[1], '', false));"
    " fs.writeFileSync(path.join(out, 'edit-' + l[0] + '.html'), s.editPage(l[1], '__APLTV_TOKEN__', true));"
    " fs.writeFileSync(path.join(out, 'edit-expired-' + l[0] + '.html'), s.editPage(l[1], '', false)); });"
    " fs.writeFileSync(path.join(out, 'yt.html'), s.ytPage());"
    "process.exit(0);"          # service.js keeps a timer running: leave right away
)
subprocess.check_call(["node", "-e", js, os.path.join(A, "service", "service.js"), helper_dir])
for name in ("phone-en.html", "phone-fr.html", "phone-pl.html", "edit-en.html", "edit-fr.html", "edit-pl.html"):
    if '"__APLTV_TOKEN__"' not in open(os.path.join(helper_dir, name), encoding="utf-8").read():
        sys.exit(name + ": the code placeholder is missing, update tools/make-android.py")

# ---- icons and the Android TV banner (320 x 180), from the 512 x 512 icon
from PIL import Image, ImageDraw, ImageFont
icon = Image.open(os.path.join(A, "icon.png")).convert("RGBA")
for folder, size in (("mipmap-mdpi", 48), ("mipmap-hdpi", 72), ("mipmap-xhdpi", 96), ("mipmap-xxhdpi", 144), ("mipmap-xxxhdpi", 192)):
    d = os.path.join(MAIN, "res", folder)
    os.makedirs(d, exist_ok=True)
    icon.resize((size, size), Image.LANCZOS).save(os.path.join(d, "ic_launcher.png"))
banner = Image.new("RGB", (320, 180), (0, 0, 0))
px = banner.load()
for y in range(180):
    for x in range(320):
        t = (x / 320.0) * 0.6 + (y / 180.0) * 0.4
        px[x, y] = (int(28 - 20 * t), int(38 - 28 * t), int(57 - 42 * t))
logo = icon.resize((112, 112), Image.LANCZOS)
banner.paste(logo, (26, 34), logo)
draw = ImageDraw.Draw(banner)
font = None
for f in (os.path.join(A, "fonts", "SFPRODISPLAYBOLD.OTF"), "C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
    if os.path.exists(f):
        font = ImageFont.truetype(f, 46); break
draw.text((156, 62), "APL TV", fill=(255, 255, 255), font=font or ImageFont.load_default())
os.makedirs(os.path.join(MAIN, "res", "drawable"), exist_ok=True)
banner.save(os.path.join(MAIN, "res", "drawable", "banner.png"))

# ---- the tools (on this PC: E:, where there is room; on GitHub: what the runner provides)
win = os.name == "nt"
sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or ("E:/Android/Sdk" if win else "")
gradle = os.environ.get("GRADLE") or ("E:/Android/gradle-8.10.2/bin/gradle.bat" if win else "gradle")
java = os.environ.get("JAVA_HOME") or ("C:/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot" if win else "")
if not sdk:
    sys.exit("ANDROID_HOME is not set")
open(os.path.join(AND, "local.properties"), "w", encoding="utf-8").write("sdk.dir=" + sdk.replace("\\", "/").replace(":", "\\:") + "\n")
env = dict(os.environ, ANDROID_HOME=sdk, ANDROID_SDK_ROOT=sdk)
if java: env["JAVA_HOME"] = java
if win:
    env.setdefault("GRADLE_USER_HOME", "E:/Android/gradle-home")
    env.setdefault("ANDROID_USER_HOME", "E:/Android/user")
keytool = os.path.join(java, "bin", "keytool") if java else "keytool"

# ---- the signing key: always the same one (see the top of this file). A key made by mistake would
# sign packages that cannot update the installed app, so a new key is only made with --new-key.
unsigned = "--unsigned" in sys.argv
args = [gradle, "-p", AND, "--no-daemon", "-q", "assembleRelease", "-PaplVersion=" + version] + (["-PaplDebuggable=1"] if dev else [])
if not unsigned:
    jks, pw = os.environ.get("APL_KEYSTORE_FILE"), os.environ.get("APL_KEYSTORE_PASS")
    if not jks:
        if os.environ.get("APL_KEYSTORE_DIR"):
            dirs = [os.environ["APL_KEYSTORE_DIR"]]
        else:
            dirs = (["E:/Android/keys-backup"] if win and os.path.isdir("E:/Android") else []) + \
                   [os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), "APL-TV")]
        keydir = next((d for d in dirs if os.path.exists(os.path.join(d, "android-release.jks"))), None)
        if not keydir and "--new-key" not in sys.argv:
            sys.exit("No signing key found (android-release.jks in " + " or ".join(dirs) + ").\n"
                     "APL TV must always be signed with the same key, or it cannot update the installed app:\n"
                     "put android-release.jks and android-release.txt in one of these folders, or set APL_KEYSTORE_DIR.\n"
                     "--unsigned only checks that it builds; --new-key makes a new key, for a brand new app only.")
        keydir = keydir or dirs[0]
        jks, pwfile = os.path.join(keydir, "android-release.jks"), os.path.join(keydir, "android-release.txt")
        if not os.path.exists(jks):
            os.makedirs(keydir, exist_ok=True)
            new_pw = secrets.token_urlsafe(24)
            # the password goes through the environment: never on a command line, never in an error message
            subprocess.check_call([keytool, "-genkeypair", "-keystore", jks, "-storetype", "PKCS12", "-alias", "apltv",
                                   "-keyalg", "RSA", "-keysize", "4096", "-validity", "10000", "-storepass:env", "APL_KEYSTORE_PASS",
                                   "-keypass:env", "APL_KEYSTORE_PASS", "-dname", "CN=APL TV, O=Gero Corp., C=FR"],
                                  env=dict(os.environ, APL_KEYSTORE_PASS=new_pw))
            open(pwfile, "w", encoding="utf-8").write(new_pw)
            print("new signing key:", jks, "(keep a copy of it and of", os.path.basename(pwfile) + ")")
        if not os.path.exists(pwfile):
            sys.exit("android-release.txt (the key's password) is missing next to " + jks)
        pw = open(pwfile, encoding="utf-8").read().strip()
        print("signing key:", os.path.normpath(jks))
    if not pw:
        sys.exit("APL_KEYSTORE_PASS is not set")
    env["APL_KEYSTORE_PASS"] = pw
    args += ["-PaplKeystore=" + jks, "-PaplKeyAlias=apltv"]

print("APL TV", version, "for Android:", "release" if release else ("dev" if dev else "personal"), "(unsigned)" if unsigned else "")
if subprocess.call(args, env=env, shell=False) != 0:
    sys.exit("the Android build failed (see above)")
apk = os.path.join(AND, "app", "build", "outputs", "apk", "release", "app-release-unsigned.apk" if unsigned else "app-release.apk")
os.makedirs(out, exist_ok=True)
final = os.path.join(out, "apl-tv-v%s%s.apk" % (version, ("-android" if release else ("-dev" if dev else "-personal")) + ("-unsigned" if unsigned else "")))
shutil.copy2(apk, final)
print("package:", final, os.path.getsize(final), "bytes")
if release and not unsigned:
    import hashlib
    h = hashlib.sha256(open(final, "rb").read()).hexdigest()
    open(os.path.join(out, "SHA256SUMS-apk.txt"), "w", encoding="utf-8", newline="\n").write("%s  %s\n" % (h, os.path.basename(final)))

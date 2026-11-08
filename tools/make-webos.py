"""Builds APL TV for LG TVs (webOS): an .ipk with the app and its helper service.

    python tools/make-webos.py              your own TV: your keys, fonts and sounds (never publish it)
    python tools/make-webos.py --release    the package for GitHub Releases: no personal file
                                            (apl-tv-vX.Y.Z-lg-webos.ipk, SHA256SUMS-ipk.txt and
                                            apl-tv.manifest.json for the webOS Homebrew Channel)
    python tools/make-webos.py --dev        your own TV, with the development log (js/dev.local.js)

Then, with LG's webOS CLI (npm install -g @webos-tools/cli) and the TV in Developer Mode:
    ares-install -d <tv> dist/com.knikt.apltv_<version>_all.ipk
    ares-launch -d <tv> com.knikt.apltv

The app is the same code as on Samsung (app/): js/core.js finds out it runs on webOS and uses LG's
remote keys, the HTML <video> (LG's media pipeline) and the JS service below instead of Samsung's.
  app id      com.knikt.apltv
  service id  com.knikt.apltv.service (webos/service/index.js + app/service/service.js)
The version comes from app/config.xml.
"""
import json, os, re, shutil, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
A = os.path.join(ROOT, "app")
APP_ID = "com.knikt.apltv"
SERVICE_ID = APP_ID + ".service"

release = "--release" in sys.argv
dev = "--dev" in sys.argv and not release
out = os.path.join(ROOT, "dist")
if "--out" in sys.argv:
    out = os.path.abspath(sys.argv[sys.argv.index("--out") + 1])

config = open(os.path.join(A, "config.xml"), encoding="utf-8").read()
version = re.search(r'<widget[^>]*\sversion="([^"]+)"', config).group(1)
work = os.path.join(out, "webos")
app_dir, svc_dir = os.path.join(work, "app"), os.path.join(work, "service")
shutil.rmtree(work, ignore_errors=True)
os.makedirs(app_dir); os.makedirs(svc_dir)

# ---- the app: everything in app/ but Samsung's files
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

# index.html without Samsung's API script (it does not exist on LG)
html = open(os.path.join(A, "index.html"), encoding="utf-8").read()
html = re.sub(r'\s*<!-- Samsung API[^>]*-->\s*<script src="\$WEBAPIS/webapis/webapis\.js"></script>', "", html)
if "$WEBAPIS" in html:
    sys.exit("index.html: Samsung's script line was not found, update tools/make-webos.py")
open(os.path.join(app_dir, "index.html"), "w", encoding="utf-8", newline="\n").write(html)

# Keys: yours for your own TV, an empty TMDB key in the published package (the app then asks for one)
keys_src = os.path.join(A, "js", "keys.example.js" if release else "keys.local.js")
if not os.path.exists(keys_src):
    keys_src = os.path.join(A, "js", "keys.example.js")
shutil.copy2(keys_src, os.path.join(app_dir, "js", "keys.local.js"))
dev_src = os.path.join(A, "js", "dev.local.js")
if dev and os.path.exists(dev_src):
    shutil.copy2(dev_src, os.path.join(app_dir, "js", "dev.local.js"))
else:
    open(os.path.join(app_dir, "js", "dev.local.js"), "w", encoding="utf-8", newline="\n").write("/* release build */\n")

# Icons: 80 x 80 and 130 x 130 (LG's sizes), from the 512 x 512 one
from PIL import Image
icon = Image.open(os.path.join(A, "icon.png")).convert("RGBA")
icon.resize((80, 80), Image.LANCZOS).save(os.path.join(app_dir, "icon.png"))
icon.resize((130, 130), Image.LANCZOS).save(os.path.join(app_dir, "largeIcon.png"))
# Splash: the logo on black, as the app's own start screen
splash = Image.new("RGB", (1920, 1080), (0, 0, 0))
logo = icon.resize((300, 300), Image.LANCZOS)
splash.paste(logo, ((1920 - 300) // 2, (1080 - 300) // 2), logo)
splash.save(os.path.join(app_dir, "splash.png"))

appinfo = {
    "id": APP_ID,
    "version": version,
    "vendor": "Knikt (Gero Corp.)",
    "type": "web",
    "main": "index.html",
    "title": "APL TV",
    "icon": "icon.png",
    "largeIcon": "largeIcon.png",
    "splashBackground": "splash.png",
    "bgColor": "#000000",
    "resolution": "1920x1080",
    "disableBackHistoryAPI": True,
    "handlesRelaunch": True,
    "transparent": False,
}
json.dump(appinfo, open(os.path.join(app_dir, "appinfo.json"), "w", encoding="utf-8", newline="\n"), indent=2)

# ---- the helper service
shutil.copy2(os.path.join(ROOT, "webos", "service", "index.js"), os.path.join(svc_dir, "index.js"))
shutil.copy2(os.path.join(A, "service", "service.js"), os.path.join(svc_dir, "service.js"))
json.dump({"name": SERVICE_ID, "version": version, "main": "index.js", "description": "APL TV helper"},
          open(os.path.join(svc_dir, "package.json"), "w", encoding="utf-8", newline="\n"), indent=2)
json.dump({"id": SERVICE_ID, "description": "Phone setup page, TV guides and network helper for APL TV",
           "services": [{"name": SERVICE_ID, "description": "APL TV helper"}]},
          open(os.path.join(svc_dir, "services.json"), "w", encoding="utf-8", newline="\n"), indent=2)

print("APL TV", version, "for webOS:", "release" if release else ("dev" if dev else "personal"), "->", work)

if "--no-package" in sys.argv:
    sys.exit(0)
ares = shutil.which("ares-package") or shutil.which("ares-package.cmd")
if not ares:
    sys.exit("ares-package not found: npm install -g @webos-tools/cli")
subprocess.check_call([ares, "--no-minify", "-o", out, app_dir, svc_dir])
ipk = os.path.join(out, "%s_%s_all.ipk" % (APP_ID, version))
if release:
    # The published names, its SHA256, and the manifest the webOS Homebrew Channel reads to install it
    import hashlib
    final = os.path.join(out, "apl-tv-v%s-lg-webos.ipk" % version)
    shutil.move(ipk, final)
    ipk = final
    data = open(ipk, "rb").read()
    h = hashlib.sha256(data).hexdigest()
    open(os.path.join(out, "SHA256SUMS-ipk.txt"), "w", encoding="utf-8", newline="\n").write("%s  %s\n" % (h, os.path.basename(ipk)))
    repo = os.environ.get("GITHUB_REPOSITORY") or "Knikt/APL-TV"
    manifest = {
        "id": APP_ID, "version": version, "type": "web", "title": "APL TV",
        "appDescription": "Live TV, movies and series from your own playlists, in the style of Apple TV",
        "iconUri": "https://raw.githubusercontent.com/%s/main/app/icon.png" % repo,
        "sourceUrl": "https://github.com/%s" % repo, "rootRequired": False,
        "ipkUrl": "https://github.com/%s/releases/download/v%s/%s" % (repo, version, os.path.basename(ipk)),
        "ipkHash": {"sha256": h}, "ipkSize": len(data),
    }
    json.dump(manifest, open(os.path.join(out, "apl-tv.manifest.json"), "w", encoding="utf-8", newline="\n"), indent=2)
print("package:", ipk, os.path.getsize(ipk), "bytes")

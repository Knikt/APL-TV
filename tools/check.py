#!/usr/bin/env python3
"""Checks run before every package and on every push (GitHub Actions).

- every script parses (node --check), the app's and the helper service's;
- every text shown in the interface (TV.t("...")) has its French translation in app/js/lang-fr.js;
- the version is the same in app/config.xml, app/js/app.js and app/service/service.js;
- no personal file is tracked by git (keys, development log, fonts, sounds, certificates).
"""
import glob
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app")
errors = []


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


# ---- scripts ----
scripts = sorted(glob.glob(os.path.join(APP, "js", "*.js"))) + [os.path.join(APP, "service", "service.js"), os.path.join(ROOT, "alexa-skill", "lambda", "index.js")]
scripts = [s for s in scripts if not s.endswith(".local.js")]
for s in scripts:
    r = subprocess.run(["node", "--check", s], capture_output=True, text=True)
    if r.returncode != 0:
        errors.append("syntax: %s\n%s" % (os.path.relpath(s, ROOT), r.stderr.strip()))

# ---- translations ----
keys = []
for s in scripts:
    if s.endswith(("lang-fr.js", "qr.js")) or "service" in s or "alexa-skill" in s:
        continue
    for m in re.finditer(r'\bT\(\s*"((?:[^"\\]|\\.)*)"', read(s)):
        if m.group(1) not in keys:
            keys.append(m.group(1))
fr = set(re.findall(r'^\s*"((?:[^"\\]|\\.)*)"\s*:', read(os.path.join(APP, "js", "lang-fr.js")), re.M))
missing = [k for k in keys if k not in fr]
if missing:
    errors.append("French translation missing for %d texts:\n  %s" % (len(missing), "\n  ".join(missing)))

# ---- version ----
v_config = re.search(r'<widget[^>]*\sversion="([^"]+)"', read(os.path.join(APP, "config.xml"))).group(1)
v_app = re.search(r'TV\.VERSION = "([^"]+)"', read(os.path.join(APP, "js", "app.js"))).group(1)
v_svc = re.search(r'VERSION = "([^"]+)"', read(os.path.join(APP, "service", "service.js"))).group(1)
if not (v_config == v_app == v_svc):
    errors.append("versions differ: config.xml %s, app.js %s, service.js %s" % (v_config, v_app, v_svc))

# ---- personal files ----
try:
    tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True).stdout.split()
except OSError:
    tracked = []
personal = re.compile(r"(\.local\.js$|\.p12$|\.pwd$|\.wgt$|^app/fonts/.+\.(otf|ttf)$|^app/sounds/.+\.wav$)", re.I)
leaks = [f for f in tracked if personal.search(f)]
if leaks:
    errors.append("personal files tracked by git: " + ", ".join(leaks))
if not re.search(r'^\s*tmdb: "",$', read(os.path.join(APP, "js", "keys.example.js")), re.M):
    errors.append('app/js/keys.example.js must keep its line \'    tmdb: "",\' (APL Launcher Setup and Apps2Samsung fill it in)')

if errors:
    print("\n\n".join(errors))
    sys.exit(1)
print("all checks passed (version %s, %d scripts, %d texts translated)" % (v_config, len(scripts), len(keys)))

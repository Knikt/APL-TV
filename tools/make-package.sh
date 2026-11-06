#!/usr/bin/env bash
# Builds the package attached to GitHub Releases, version from app/config.xml:
#
#   apl-tv-v<version>.wgt   the app and its helper service (APLTVMedia.TV, APLTVMedia.Helper)
#   SHA256SUMS-wgt.txt      its SHA256, checked by APL Launcher Setup before it installs it
#
# The package is signed with the Tizen SDK's default certificate. A retail screen only accepts a
# package signed with a certificate that embeds its own DUID, so it does NOT install as is:
# APL Launcher Setup (or Apps2Samsung) signs it again for the user's screen.
#
# What differs from a build made on your own PC (tools/build.ps1):
#   - js/keys.local.js is keys.example.js with an empty TMDB key. APL Launcher Setup writes the
#     user's key in; without one, the app asks for it in Settings.
#   - js/dev.local.js is empty: no development log, no test remote.
#   - no SF Pro fonts and no sounds (never published): the app falls back to the screen's own
#     font and to short synthesized clicks. APL Launcher Setup copies them from APL Launcher.
#
# Used by CI (.github/workflows/release.yml). Needs the Tizen-Core CLI
# ($TIZEN_SDK/tools/tizen-core/tz, default ~/tizen-sdk) with the certificate generator, rsync,
# zip, unzip, python3, node.
#
# Usage: tools/make-package.sh [output-dir]   (default: dist)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/dist}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

SDK="${TIZEN_SDK:-$HOME/tizen-sdk}"
TZ="$SDK/tools/tizen-core/tz"
[ -x "$TZ" ] || { echo "$TZ not found (set TIZEN_SDK)" >&2; exit 1; }
command -v zip >/dev/null || { echo "zip is required" >&2; exit 1; }

VERSION="$(python3 -c 'import re,sys; print(re.search(r"<widget[^>]*\sversion=\"([^\"]+)\"", open(sys.argv[1], encoding="utf-8").read()).group(1))' "$ROOT/app/config.xml")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Scripts parse, French complete, one version everywhere, nothing personal tracked.
python3 "$ROOT/tools/check.py"

echo "== APL TV $VERSION"
rsync -a \
    --exclude '*.wgt' --exclude '.manifest.tmp' --exclude 'author-signature.xml' --exclude 'signature1.xml' \
    --exclude '*.local.js' --exclude 'keys.example.js' \
    --exclude 'fonts/' --exclude 'sounds/' --exclude '.DS_Store' \
    "$ROOT/app/" "$WORK/app/"

# The keys file APL Launcher Setup fills in: its `tmdb: ""` line is the find string. Keep it.
cp "$ROOT/app/js/keys.example.js" "$WORK/app/js/keys.local.js"
grep -q '^    tmdb: "",$' "$WORK/app/js/keys.local.js" \
    || { echo "keys.example.js has no 'tmdb: \"\",' line, update APL Launcher Setup" >&2; exit 1; }
printf '/* release build */\n' > "$WORK/app/js/dev.local.js"

# Runs a CLI command; on failure prints the Tizen CLI logs.
run_cli() {
    if ! "$@"; then
        find "$SDK" "$SDK-data" "$HOME" -path '*tizen*' -name '*.log' 2>/dev/null | while read -r log; do
            echo "--- $log"; tail -n 60 "$log"
        done
        return 1
    fi
}

echo "== Package"
# Without -s, tz pack signs with the SDK's default certificate: every screen needs its own
# signature anyway, and APL Launcher Setup replaces this one.
(cd "$WORK/app" && zip -qr "$WORK/web.wgt" .)
WGT="$WORK/signed.wgt"
run_cli "$TZ" pack -t wgt -b "$WORK/web.wgt" -o "$WGT"
[ -f "$WGT" ] || { echo "tz pack produced no $WGT" >&2; exit 1; }

NAME="apl-tv-v$VERSION.wgt"
cp "$WGT" "$OUT/$NAME"
# One listing, then a here-string: grep -q on a pipe would kill unzip with SIGPIPE (pipefail).
LIST="$(unzip -l "$OUT/$NAME")"
echo "$LIST" | grep -v -E " images/"
for f in config.xml index.html icon.png version.json service/service.js js/boot.js js/build.js js/updater.js js/app.js js/keys.local.js js/dev.local.js \
         js/lang-fr.js css/tv.css css/tv2.css author-signature.xml signature1.xml; do
    grep -q " $f\$" <<<"$LIST" || { echo "$f is missing from $NAME" >&2; exit 1; }
done
if grep -q -E " (fonts|sounds)/.+" <<<"$LIST"; then echo "fonts or sounds ended up in $NAME" >&2; exit 1; fi
(cd "$OUT" && sha256sum apl-tv-v*.wgt > SHA256SUMS-wgt.txt)
ls -l "$OUT"

# Apps2Samsung catalog entry

`Knikt__APL-TV.json` is the entry for [Apps2Samsung/tizen-community-packages](https://github.com/Apps2Samsung/tizen-community-packages) (copy it to `packages/` there in a PR; schema: `packages.schema.json` in that repo). Apps2Samsung installs in the screen's Developer Mode: no root, no Tizen Studio.

It points at the `apl-tv-v<version>.wgt` asset that `.github/workflows/release.yml` attaches to every `v*` release (built by `tools/make-package.sh`). If you rename that file, update `match` here and in the catalog.

`user_settings` writes the optional TMDB key into `js/keys.local.js` before Apps2Samsung signs the package for the screen. The `find` string is the `tmdb: "",` line of `app/js/keys.example.js`, which the package ships as `keys.local.js`: if you change that line, change the entry too (`make-package.sh` and `tools/check.py` fail when it is missing).

`cert_level` is `partner`: APL TV has only been tested signed with a partner certificate (it has a helper service, `APLTVMedia.Helper`).

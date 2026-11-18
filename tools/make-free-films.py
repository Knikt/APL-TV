"""Builds app/data/free-films.json: the public domain movies APL TV can play (Settings > Add a Playlist >
Public Domain Movies). Run it again from time to time; the screens read the copy on GitHub main.

    python tools/make-free-films.py

Where it comes from, all without a key:
  - Wikidata: every film, short or cartoon marked public domain (P6216 = Q19652) that has a video on the
    Internet Archive (P724) or on Wikimedia Commons (P10). Its titles in English, French, Spanish and Polish, its year,
    its TMDB and IMDb ids, its poster on Commons, and how well known it is (its number of Wikipedia articles).
    The country where it is public domain is kept too (mostly the United States).
  - The Internet Archive's metadata: the video file to play (H.264 MP4 first), and its length.
  - Wikimedia Commons: the WebM made for TVs (720p VP9) when the film is only there.
A film with no file that plays is left out, and so is a trailer or an extract (a file far shorter than the
film, or named so), and a scene of a few seconds that only historians know.
"""
import concurrent.futures, hashlib, json, os, re, sys, time, urllib.parse, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "app", "data", "free-films.json")
UA = "APL-TV-free-films/1.0 (https://github.com/Knikt/APL-TV)"
TYPES = {"Q11424": "film", "Q24869": "film", "Q506240": "film", "Q226730": "film", "Q24862": "short", "Q20667187": "short",
         "Q202866": "animation", "Q17517379": "animation", "Q93204": "doc"}
ANIMATION_GENRES = {"Q581714", "Q202866", "Q17517379"}
DOC_GENRES = {"Q93204"}

QUERY = """
SELECT ?f (SAMPLE(?ia0) AS ?ia) (SAMPLE(?v0) AS ?video) (MIN(?d0) AS ?date) (SAMPLE(?tm0) AS ?tmdb) (SAMPLE(?im0) AS ?imdb)
       (SAMPLE(?po0) AS ?poster) (SAMPLE(?pic0) AS ?image) (MAX(?du0) AS ?dur) (MAX(?sl0) AS ?links)
       (GROUP_CONCAT(DISTINCT STRAFTER(STR(?ty), "entity/"); separator="|") AS ?types)
       (GROUP_CONCAT(DISTINCT STRAFTER(STR(?g0), "entity/"); separator="|") AS ?genres)
       (GROUP_CONCAT(DISTINCT STRAFTER(STR(?ju0), "entity/"); separator="|") AS ?where)
       (SAMPLE(?en0) AS ?en) (SAMPLE(?fr0) AS ?fr) (SAMPLE(?es0) AS ?es) (SAMPLE(?pl0) AS ?pl) (SAMPLE(?ot0) AS ?orig)
WHERE {
  VALUES ?ty { %s }
  ?f wdt:P31 ?ty ; p:P6216 ?st . ?st ps:P6216 wd:Q19652 .
  OPTIONAL { ?st pq:P1001 ?ju0 }
  { ?f wdt:P724 ?ia0 } UNION { ?f wdt:P10 ?v0 }
  OPTIONAL { ?f wdt:P577 ?d0 }
  OPTIONAL { ?f wdt:P4947 ?tm0 }
  OPTIONAL { ?f wdt:P345 ?im0 }
  OPTIONAL { ?f wdt:P3383 ?po0 }
  OPTIONAL { ?f wdt:P18 ?pic0 }
  OPTIONAL { ?f p:P2047/psv:P2047 ?dv . ?dv wikibase:quantityAmount ?du0 }
  OPTIONAL { ?f wikibase:sitelinks ?sl0 }
  OPTIONAL { ?f wdt:P136 ?g0 }
  OPTIONAL { ?f rdfs:label ?en0 FILTER(LANG(?en0) = "en") }
  OPTIONAL { ?f rdfs:label ?fr0 FILTER(LANG(?fr0) = "fr") }
  OPTIONAL { ?f rdfs:label ?es0 FILTER(LANG(?es0) = "es") }
  OPTIONAL { ?f rdfs:label ?pl0 FILTER(LANG(?pl0) = "pl") }
  OPTIONAL { ?f wdt:P1476 ?ot0 }
} GROUP BY ?f
""" % " ".join("wd:" + t for t in TYPES)


def get(url, data=None, tries=4, timeout=120):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))


def wikidata():
    body = urllib.parse.urlencode({"query": QUERY, "format": "json"}).encode()
    j = get("https://query.wikidata.org/sparql", data=body, timeout=300)
    out = []
    for b in j["results"]["bindings"]:
        v = {k: x["value"] for k, x in b.items()}
        v["id"] = v["f"].rsplit("/", 1)[-1]
        out.append(v)
    return out


def seconds(v):
    """"5432.1", "01:30:32" or "90:32": in seconds"""
    s = str(v or "").strip()
    try:
        return int(float(s))
    except ValueError:
        parts = [p for p in s.split(":") if p.isdigit()]
        n = 0
        for p in parts:
            n = n * 60 + int(p)
        return n


def ia_file(ident):
    """The best file of an Internet Archive item: [name, seconds] or None"""
    try:
        j = get("https://archive.org/metadata/" + urllib.parse.quote(ident), timeout=60, tries=3)
    except Exception:
        return None
    if not j or j.get("is_dark") or not j.get("files"):
        return None
    best = None
    for f in j["files"]:
        name, fmt = f.get("name", ""), f.get("format", "")
        if not name.lower().endswith((".mp4", ".m4v")):
            continue
        size = int(f.get("size") or 0)
        secs = seconds(f.get("length"))
        # H.264 first ("h.264", "MPEG4", "512Kb MPEG4"): the biggest of them, but not over 4 GB
        score = (2 if "h.264" in fmt.lower() or "mpeg4" in fmt.lower() else 1, size if size < 4e9 else 0)
        if best is None or score > best[0]:
            best = (score, name, secs)
    return [best[1], best[2]] if best else None


def commons_file(name):
    """A Commons video: [the TV friendly WebM or the file itself, seconds] or None"""
    title = "File:" + name
    try:
        j = get("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(
            {"action": "query", "prop": "videoinfo", "viprop": "derivatives|url|size", "titles": title, "format": "json"}), timeout=60, tries=3)
    except Exception:
        return None
    pages = (j.get("query") or {}).get("pages") or {}
    for p in pages.values():
        vi = (p.get("videoinfo") or [None])[0]
        if not vi:
            return None
        secs = int(float(vi.get("duration") or 0))
        ders = vi.get("derivatives") or []
        pick = None
        for want in ("720p.vp9.webm", "480p.vp9.webm", "1080p.vp9.webm", "360p.vp9.webm"):
            pick = next((d["src"] for d in ders if d.get("src", "").endswith(want)), None)
            if pick:
                break
        url = (pick or vi.get("url") or "").split("?")[0]
        if not url or url.lower().endswith((".ogv", ".ogg")):
            return None                                     # Theora: no TV plays it
        return [url.replace("https://upload.wikimedia.org/wikipedia/commons/", ""), secs]
    return None


NOT_THE_FILM = re.compile(r"trailer|teaser|bande[ _-]?annonce|excerpt|extrait|preview|clip[ _.]", re.I)


def is_the_film(f):
    """False for a trailer or an extract: named so, or far shorter than the film Wikidata knows"""
    name, secs = f["file"][0], f["file"][1]
    if NOT_THE_FILM.search(urllib.parse.unquote(name)):
        return False
    mins = float(f.get("dur") or 0)
    return not (mins >= 20 and secs and secs < mins * 60 * 0.5)


def commons_name(url):
    return urllib.parse.unquote(url.rsplit("/", 1)[-1]) if url else ""


def main():
    films = wikidata()
    print(len(films), "public domain films with a video on Wikidata")
    jobs = {}
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        for f in films:
            if f.get("ia"):
                jobs[pool.submit(ia_file, f["ia"])] = (f, "ia")
            elif f.get("video"):
                jobs[pool.submit(commons_file, commons_name(f["video"]))] = (f, "c")
        done = 0
        for fut in concurrent.futures.as_completed(jobs):
            f, kind = jobs[fut]
            f["file"] = fut.result()
            f["host"] = kind
            done += 1
            if done % 100 == 0:
                print(done, "/", len(jobs))
    # Internet Archive items with no MP4 (or only a trailer): their Commons video, if they have one
    for f in films:
        if f.get("file") and not is_the_film(f):
            f["file"] = None
        if f.get("host") == "ia" and not f.get("file") and f.get("video"):
            f["file"] = commons_file(commons_name(f["video"]))
            f["host"] = "c"
            if f["file"] and not is_the_film(f):
                f["file"] = None
    rows, seen = [], set()
    for f in sorted(films, key=lambda f: -int(f.get("links") or 0)):
        if not f.get("file") or f["id"] in seen:
            continue
        seen.add(f["id"])
        year = int(f["date"][:4]) if f.get("date") and re.match(r"^\d{4}", f["date"]) else 0
        types, genres = set(f.get("types", "").split("|")), set(f.get("genres", "").split("|"))
        mins = float(f.get("dur") or 0) or (f["file"][1] / 60 if f["file"][1] else 0)
        kind = "animation" if types & ANIMATION_GENRES or genres & ANIMATION_GENRES else \
               "doc" if "Q93204" in types or genres & DOC_GENRES else \
               "short" if {"Q24862", "Q20667187"} & types or (0 < mins < 40) else "film"
        secs = int(round(mins * 60)) or f["file"][1]
        if secs and secs < 60 and int(f.get("links") or 0) < 25:
            continue                                        # a few seconds of film, known only to historians
        en = f.get("en") or f.get("orig") or ""
        if not en or re.match(r"^Q\d+$", en):
            continue
        where = sorted(w for w in f.get("where", "").split("|") if w)
        poster = commons_name(f.get("poster") or f.get("image") or "")
        if poster and not poster.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff")):
            poster = ""
        rows.append([f["id"], f["host"], f["file"][0] if f["host"] == "c" else f["ia"] + "/" + f["file"][0], year, int(f.get("tmdb") or 0) if str(f.get("tmdb") or "").isdigit() else 0,
                     f.get("imdb") or "", poster, int(round(mins * 60)) or f["file"][1], int(f.get("links") or 0), kind, en,
                     f.get("fr") if f.get("fr") != en else "", f.get("pl") if f.get("pl") != en else "", "|".join(where),
                     f.get("es") if f.get("es") != en else ""])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    data = {"v": 1, "at": time.strftime("%Y-%m-%d"),
            "fields": ["wikidata", "host", "file", "year", "tmdb", "imdb", "poster", "secs", "fame", "kind", "en", "fr", "pl", "publicDomainIn", "es"],
            "films": rows}
    with open(OUT, "w", encoding="utf-8", newline="\n") as o:
        json.dump(data, o, ensure_ascii=False, separators=(",", ":"))
    kinds = {}
    for r in rows:
        kinds[r[9]] = kinds.get(r[9], 0) + 1
    print(len(rows), "films written to", os.path.relpath(OUT, ROOT), kinds, os.path.getsize(OUT) // 1024, "KB")


if __name__ == "__main__":
    main()

"""Nightly: free-licence player photos for the player cards.

Finds players with a Wikimedia Commons image (via their ESPNcricinfo id on Wikidata), keeps those who have
played for a top team since 2015, cuts each photo out of its background and writes
  <out>/photos/<player id>.webp   and   <out>/photos/index.json  {id: credit line}
Photos already in the cache folder are reused, so only new players are downloaded.
Usage: python photos.py <people.csv> <work dir with cricforgeek.duckdb> <out data dir> <cache dir>
"""
import csv, io, json, os, sys, time, urllib.parse, urllib.request
import duckdb

UA = {"User-Agent": "cricforgeek-photos/1.0 (https://cricforgeek.site)"}
people_csv, work, out, cache = sys.argv[1:5]
os.makedirs(f"{out}/photos", exist_ok=True); os.makedirs(cache, exist_ok=True)
LIMIT = int(os.environ.get("PHOTO_LIMIT", "900"))  # new downloads per night, to stay polite to Commons

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
        return r.read()

def strip_tags(s):
    import re
    return re.sub(r"<[^>]+>", "", s or "").strip()

credits_path = f"{cache}/credits.json"
credits = json.load(open(credits_path)) if os.path.exists(credits_path) else {}


def publish(ids):
    """Copy cached cut-outs for these players into the site and write the index."""
    index = {}
    for pid in ids:
        src = f"{cache}/{pid}.webp"
        if pid in credits and os.path.exists(src):
            with open(src, "rb") as f, open(f"{out}/photos/{pid}.webp", "wb") as g:
                g.write(f.read())
            index[pid] = credits[pid]
    json.dump(index, open(f"{out}/photos/index.json", "w"), separators=(",", ":"))
    return index


# The site keeps last night's photos even if anything below fails (Wikidata down, the cut-out package broken).
kept = publish(list(credits))
print(f"{len(kept)} cached photos published")

def main():
    global new_session, remove
    ci = {}
    for p in csv.DictReader(open(people_csv, encoding="utf-8")):
        for k in ("key_cricinfo", "key_cricinfo_2", "key_cricinfo_3"):
            if p.get(k):
                ci[p[k]] = p["identifier"]
    con = duckdb.connect(f"{work}/cricforgeek.duckdb", read_only=True)
    # top-team players since 2015, best known first (most top-level matches), so famous players get cards first
    top = {r[0]: r[1] for r in con.execute("""
        select a.player, count(*) n from appearances a join matches m using (match_id)
        where m.lvl_top and m.year >= 2015 group by a.player""").fetchall()}
    con.close()
    q = "SELECT ?ci ?img WHERE { ?p wdt:P2697 ?ci . ?p wdt:P18 ?img . }"
    rows = json.loads(get("https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(q)))["results"]["bindings"]
    want = {}
    for b in rows:
        pid = ci.get(b["ci"]["value"])
        if pid in top and pid not in want:
            want[pid] = b["img"]["value"]
    print(f"{len(want)} top-team players have a free photo")

    from PIL import Image
    try:
        from rembg import new_session, remove
    except Exception as e:  # without the cut-out package, keep the cached photos and add none
        print(f"cut-out package unavailable ({type(e).__name__}: {e}); no new photos tonight")
        new_session = None
    session = None
    new = 0
    for pid, url in sorted(want.items(), key=lambda kv: -top[kv[0]]):
        dst = f"{cache}/{pid}.webp"
        if not os.path.exists(dst) and new < LIMIT and new_session:
            try:
                file = urllib.parse.unquote(url.rsplit("/", 1)[1])
                meta = json.loads(get("https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo"
                                      "&iiprop=extmetadata|url&iiurlwidth=600&titles=File:" + urllib.parse.quote(file)))
                ii = next(iter(meta["query"]["pages"].values()))["imageinfo"][0]
                em = ii.get("extmetadata", {})
                lic = strip_tags(em.get("LicenseShortName", {}).get("value"))
                if not lic or "fair use" in lic.lower():
                    continue
                artist = strip_tags(em.get("Artist", {}).get("value"))[:60] or "Unknown"
                session = session or new_session("u2net_human_seg")
                img = remove(Image.open(io.BytesIO(get(ii["thumburl"]))).convert("RGB"), session=session)
                bbox = img.getbbox()
                if bbox: img = img.crop(bbox)
                img.thumbnail((440, 540)); img.save(dst, "WEBP", quality=80)
                credits[pid] = f"Photo: {artist} · {lic} · Wikimedia Commons"
                new += 1
                time.sleep(0.5)
            except Exception as e:  # one bad file should not stop the build
                print("skip", pid, type(e).__name__)
    json.dump(credits, open(credits_path, "w"))
    index = publish([pid for pid in want])
    print(f"{new} new photos, {len(index)} on the site")


try:
    main()
except Exception as e:  # anything else: keep last night's photos, say why, and let the build carry on
    import traceback
    traceback.print_exc()
    print(f"kept {len(kept)} cached photos; new photos failed: {type(e).__name__}: {str(e)[:120]}")

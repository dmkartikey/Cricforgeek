"""Photo review: for named players, show the photo on the site now and every candidate image on Wikimedia
(Commons file search, Wikipedia lead image, Wikidata photo) with licence and description, as a contact sheet
and JSON, so the right photo can be chosen by hand. Usage: python photo_pick.py <site> <out dir> <names file>"""
import io, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from PIL import Image, ImageDraw, ImageFont

site, out, names_file = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
UA = {"User-Agent": "cricforgeek-photo-review/1.0 (https://cricforgeek.site)"}


def get(url, timeout=60):
    for k in range(5):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or k == 4:
                raise
            time.sleep(2 ** k * 3)


def api(host, **q):
    time.sleep(0.7)
    return json.loads(get(f"https://{host}/w/api.php?" + urllib.parse.urlencode({"action": "query", "format": "json", **q})))


strip = lambda s: re.sub(r"<[^>]+>", "", s or "").strip()
search = json.loads(get(f"{site}/data/search.json"))
index = json.loads(get(f"{site}/data/photos/index.json"))
font = ImageFont.load_default(size=11)
report = []
for want in [l.strip() for l in open(names_file) if l.strip()]:
    w = want.lower()
    rows = [r for r in search["players"] if r[1].lower() == w or w in (str(r[9]).lower().split("|") if len(r) > 9 and r[9] else [])]
    if not rows:  # surname + first initial ("A Sharma" style register names)
        first, last = w.split()[0], w.split()[-1]
        rows = [r for r in search["players"] if r[1].lower().endswith(" " + last) and r[1].lower().startswith(first[0])]
    rows = rows[:3]
    cands = []
    # Wikipedia lead image (any licence; marked) and Commons file searches
    try:
        res = api("en.wikipedia.org", generator="search", gsrlimit=3, prop="pageimages|description|pageprops", piprop="name",
                  gsrsearch=f'"{want}" cricketer')
        for pg in sorted(res.get("query", {}).get("pages", {}).values(), key=lambda x: x.get("index", 9)):
            if "cricket" in (pg.get("description") or "").lower():
                cands.append(("wikipedia " + pg["title"], pg.get("pageimage")))
                wd = pg.get("pageprops", {}).get("wikibase_item")
                if wd:
                    ent = json.loads(get(f"https://www.wikidata.org/wiki/Special:EntityData/{wd}.json"))
                    for c in ent["entities"][wd]["claims"].get("P18", []):
                        cands.append(("wikidata " + wd, c["mainsnak"]["datavalue"]["value"]))
                break
    except Exception as e:
        print("wikipedia failed", want, e)
    for q in (f'"{want}"', f'{want} cricket', f'{want} cricketer'):
        try:
            res = api("commons.wikimedia.org", generator="search", gsrnamespace=6, gsrlimit=12, gsrsearch=q)
            for pg in sorted(res.get("query", {}).get("pages", {}).values(), key=lambda x: x.get("index", 99)):
                cands.append(("commons", pg["title"][5:]))
        except Exception as e:
            print("commons failed", want, e)
    # Openverse: Creative Commons photos from Flickr and elsewhere (only licences that allow edits and commercial use)
    try:
        time.sleep(3)
        ov = json.loads(get("https://api.openverse.org/v1/images/?" + urllib.parse.urlencode(
            {"q": f"{want} cricket", "license": "by,by-sa,cc0,pdm", "page_size": 12})))
        for x in ov.get("results", []):
            cands.append(("openverse", {"file": (x.get("title") or "")[:80], "thumb": x.get("thumbnail") or x.get("url"), "url": x.get("url"),
                                         "licence": f"{(x.get('license') or '').upper()} {x.get('license_version') or ''} ({x.get('source')})",
                                         "desc": f"by {x.get('creator')}; tags: {', '.join(t['name'] for t in (x.get('tags') or [])[:12])}",
                                         "landing": x.get("foreign_landing_url"), "size": f"{x.get('width')}x{x.get('height')}"}))
    except Exception as e:
        print("openverse failed", want, e)
    seen, info = set(), []
    for src, f in [c for c in cands if c[0] == "openverse"][:6]:
        info.append({"src": src, **f})
    for src, f in [c for c in cands if c[0] != "openverse"]:
        if not f or f.replace("_", " ") in seen or not f.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
            continue
        f = f.replace("_", " "); seen.add(f)
        try:
            pg = next(iter(api("commons.wikimedia.org", prop="imageinfo|categories", iiprop="extmetadata|url|size", iiurlwidth=320, cllimit=30,
                               titles="File:" + f)["query"]["pages"].values()))
            ii = pg.get("imageinfo", [{}])[0]
            em = ii.get("extmetadata", {})
            info.append({"src": src, "file": f, "licence": strip(em.get("LicenseShortName", {}).get("value")) or ("not on Commons (likely non-free)" if not ii else "?"),
                         "desc": strip(em.get("ImageDescription", {}).get("value"))[:200], "date": strip(em.get("DateTimeOriginal", {}).get("value"))[:20],
                         "size": f"{ii.get('width')}x{ii.get('height')}", "thumb": ii.get("thumburl"),
                         "cats": [c["title"][9:] for c in pg.get("categories", [])][:12]})
        except Exception as e:
            info.append({"src": src, "file": f, "licence": "lookup failed " + type(e).__name__})
        if len(info) >= 12:
            break
    report.append({"name": want, "players": [{"id": r[0], "name": r[1], "team": r[4], "years": f"{r[5]}-{r[6]}", "photo": index.get(r[0])} for r in rows], "candidates": info})
    print(want, [r[0] for r in rows], len(info), "candidates")

json.dump(report, open(f"{out}/photo-pick.json", "w"), indent=1, ensure_ascii=False)
# sheet: one row per player: the photo on the site now, then numbered candidates
TW, TH = 150, 190
for s in range(0, len(report), 8):
    part = report[s:s + 8]
    sheet = Image.new("RGB", (TW * 13, len(part) * (TH + 44)), (235, 232, 224))
    d = ImageDraw.Draw(sheet)
    for k, r in enumerate(part):
        y = k * (TH + 44)
        d.text((4, y + 2), r["name"], fill=(0, 0, 0), font=font)
        pid = r["players"][0]["id"] if r["players"] else None
        if pid and r["players"][0]["photo"]:
            try:
                im = Image.open(io.BytesIO(get(f"{site}/data/photos/{pid}.webp"))).convert("RGBA"); im.thumbnail((TW - 8, TH - 20))
                bg = Image.new("RGBA", im.size, (40, 70, 55, 255)); bg.alpha_composite(im); sheet.paste(bg.convert("RGB"), (4, y + 16))
            except Exception:
                pass
            d.text((4, y + TH + 2), "ON SITE NOW", fill=(160, 0, 0), font=font)
        else:
            d.text((4, y + 40), "no photo on site", fill=(160, 0, 0), font=font)
        for j, c in enumerate(r["candidates"]):
            x = (j + 1) * TW
            if c.get("thumb"):
                try:
                    im = Image.open(io.BytesIO(get(c["thumb"]))).convert("RGB"); im.thumbnail((TW - 8, TH - 20)); sheet.paste(im, (x + 4, y + 16))
                except Exception:
                    pass
            d.text((x + 4, y + TH - 2), f"#{j} {c['licence'][:20]}", fill=(0, 0, 120), font=font)
            d.text((x + 4, y + TH + 10), c["file"][:24], fill=(0, 0, 0), font=font)
            d.text((x + 4, y + TH + 22), c["file"][24:48], fill=(0, 0, 0), font=font)
    sheet.save(f"{out}/pick-{s // 8:02d}.jpg", quality=72)

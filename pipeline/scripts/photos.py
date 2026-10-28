"""Nightly: free-licence player photos for the player cards.

Who: everyone who has played an official Test, ODI or T20I for a full-member country since 2024 (men and women) comes
first, then other players from top teams since 2015, best known first.
Where from (in order, all free-licence Wikimedia images):
  1. Wikidata: the photo on the player's entry, found by ESPNcricinfo or CricketArchive id
  2. the lead photo of their English Wikipedia article
  3. a Wikipedia search by full name, kept only if the page is about a cricketer of that name
  4. a Wikimedia Commons file search by full name, kept only if the file is clearly a cricket photo of one person
  plus hand-checked fixes in pipeline/cricforgeek/seeds/photo_fixes.json:
    "file": {player id: Commons file name}, "drop": [player ids], and
    "own": {player id: {"path": file in the seeds folder, or "url": a free-licence image link, "credit": credit line}}
Quality: each photo is framed the same way (head and shoulders, found from the face), cut out of its background and
kept only if it has one clear, sharp face of a usable size; otherwise the next candidate is tried.
Writes <out>/photos/<player id>.webp and <out>/photos/index.json {id: credit line} (+ 16 shards).
Cut-outs are cached between runs, so each photo is processed once.
Usage: python photos.py <people.csv> <work dir with cricforgeek.duckdb> <out data dir> <cache dir>
"""
import csv, io, json, os, re, sys, time, unicodedata, urllib.error, urllib.parse, urllib.request
import duckdb

UA = {"User-Agent": "cricforgeek-photos/2.0 (https://cricforgeek.site)"}
people_csv, work, out, cache = sys.argv[1:5]
os.makedirs(f"{out}/photos", exist_ok=True); os.makedirs(cache, exist_ok=True)
BUDGET = float(os.environ.get("PHOTO_MINUTES", "38")) * 60  # processing time per night; the rest carries over
FIXES = os.path.join(os.path.dirname(__file__), "..", "cricforgeek", "seeds", "photo_fixes.json")
FULL = ["India", "Australia", "England", "South Africa", "New Zealand", "Pakistan", "Sri Lanka", "West Indies",
        "Bangladesh", "Afghanistan", "Zimbabwe", "Ireland"]
OFFICIAL = "('men-test', 'women-test', 'men-odi', 'women-odi', 'men-t20i', 'women-t20i')"
V = "v4"  # framing version: bump to re-process every photo
R = "r3"  # quality-rules version: bump to give rejected photos one more try under new rules


def get(url, timeout=90):
    """Fetch with polite retries: Wikimedia answers 429 or 503 when asked too fast, so wait and try again."""
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or attempt == 4:
                raise
            wait = e.headers.get("Retry-After")
            time.sleep(min(float(wait) if wait and wait.isdigit() else 2 ** attempt * 3, 60))


def api(host, **q):
    return json.loads(get(f"https://{host}/w/api.php?" + urllib.parse.urlencode({"action": "query", "format": "json", **q})))


def strip_tags(s):
    return re.sub(r"<[^>]+>", "", s or "").strip()


def norm(s):
    return re.sub(r"[^a-z ]", "", unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()).strip()


credits_path = f"{cache}/credits.json"
credits = json.load(open(credits_path)) if os.path.exists(credits_path) else {}
state_path = f"{cache}/photo-state.json"  # {pid: {"v": version, "src": file used, "fail": {file: reason}}}
state = json.load(open(state_path)) if os.path.exists(state_path) else {}
fixes = json.load(open(FIXES)) if os.path.exists(FIXES) else {"file": {}, "drop": []}


def cached(pid):
    """The best cut-out on disk for a player: the current framing if done, else last version's."""
    for p in (f"{cache}/{pid}.{V}.webp", f"{cache}/{pid}.v3.webp", f"{cache}/{pid}.v2.webp", f"{cache}/{pid}.webp"):
        if os.path.exists(p):
            return p
    return None


def publish(ids):
    """Copy cached cut-outs for these players into the site and write the index."""
    index = {}
    for pid in ids:
        src = cached(pid)
        if pid in credits and src and pid not in fixes.get("drop", []) and not state.get(pid, {}).get("drop"):
            with open(src, "rb") as f, open(f"{out}/photos/{pid}.webp", "wb") as g:
                g.write(f.read())
            index[pid] = credits[pid]
    json.dump(index, open(f"{out}/photos/index.json", "w"), separators=(",", ":"))
    # 16 small shards by the first character of the id, so a player page loads ~5 KB instead of the whole list
    for h in "0123456789abcdef":
        json.dump({k: v for k, v in index.items() if k[0] == h}, open(f"{out}/photos/index-{h}.json", "w"), separators=(",", ":"))
    return index


# The site keeps last night's photos even if anything below fails (Wikidata down, the cut-out package broken).
kept = publish(list(credits))
print(f"{len(kept)} cached photos published")


# ---------------------------------------------------------------- framing and quality
class Framer:
    def __init__(self):
        import cv2, numpy as np
        from PIL import Image
        from rembg import new_session, remove
        self.cv2, self.np, self.Image, self.remove = cv2, np, Image, remove
        self.session = new_session("u2net_human_seg")
        d = cv2.data.haarcascades
        self.front = [cv2.CascadeClassifier(d + f) for f in ("haarcascade_frontalface_default.xml", "haarcascade_frontalface_alt2.xml")]
        self.side = cv2.CascadeClassifier(d + "haarcascade_profileface.xml")
        # YuNet (OpenCV Zoo, MIT licence) finds faces under caps, helmets and sunglasses far better than the old
        # cascades, which stay as a fallback
        model = os.path.join(os.path.dirname(FIXES), "face_detection_yunet_2023mar.onnx")
        self.yunet = cv2.FaceDetectorYN.create(model, "", (320, 320), 0.8) if os.path.exists(model) else None

    def faces(self, gray, min_px, rgb=None):
        cv2 = self.cv2
        if self.yunet is not None and rgb is not None:
            H, W = gray.shape
            self.yunet.setInputSize((W, H))
            _, res = self.yunet.detect(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
            found = [tuple(int(v) for v in f[:4]) for f in (res if res is not None else []) if f[2] >= min_px]
            if found:
                return found
        found = []
        for cc in self.front:
            found += [tuple(int(v) for v in f) for f in cc.detectMultiScale(gray, 1.08, 6, minSize=(min_px, min_px))]
            if found:
                break
        if not found:
            found = [tuple(int(v) for v in f) for f in self.side.detectMultiScale(gray, 1.08, 6, minSize=(min_px, min_px))]
            if not found:  # profile cascade only finds left-facing heads: try the mirror image too
                W = gray.shape[1]
                found = [(W - x - w, y, w, h) for x, y, w, h in self.side.detectMultiScale(cv2.flip(gray, 1), 1.08, 6, minSize=(min_px, min_px))]
        return found

    def frame(self, raw):
        """Raw image bytes -> (440x550 RGBA head-and-shoulders cut-out, None) or (None, reason)."""
        cv2, np, Image = self.cv2, self.np, self.Image
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        if max(im.size) > 1400:
            im.thumbnail((1400, 1400))
        W, H = im.size
        gray = cv2.cvtColor(np.array(im), cv2.COLOR_RGB2GRAY)
        fs = self.faces(gray, max(40, W // 25), np.array(im))
        if not fs:
            return None, "no face found"
        fs.sort(key=lambda f: -f[2])
        if len(fs) > 1 and fs[1][2] > 0.75 * fs[0][2]:
            # two people of similar size: the one nearer the middle is who the photo is of; the other is cut away below
            big = [f for f in fs if f[2] > 0.75 * fs[0][2]]
            main = min(big, key=lambda f: abs(f[0] + f[2] / 2 - W / 2))
            fs = [main] + [f for f in fs if f is not main]
        x, y, w, h = fs[0]
        if w < 48:
            return None, f"face too small ({w}px)"
        sharp = cv2.Laplacian(cv2.resize(gray[y:y + h, x:x + w], (128, 128)), cv2.CV_64F).var()
        if sharp < 10:  # only clearly blurry faces; slightly soft ones look fine at card size
            return None, f"blurry face ({sharp:.0f})"
        # Same placement for every player on a 440x550 card: the face centred left to right, its centre 36% of the
        # way down, 30% of the card wide. Spare space at the sides or top stays transparent (it's a cut-out), and the
        # photo is zoomed in if needed so the shoulders always reach the bottom edge.
        CW, CH, FX, FY = 440, 550, 220, 0.36 * 550
        fcx, fcy = x + w / 2, y + h / 2
        sc = 0.30 * CW / w
        sc = max(sc, (CH - FY) / max(H - fcy, 1))
        if sc > 2.6:
            return None, f"too low resolution (face {w}px)"
        sx0, sy0 = fcx - FX / sc, fcy - FY / sc  # where the card's top-left corner falls on the photo
        ix0, iy0 = max(0, int(sx0)), max(0, int(sy0))
        ix1, iy1 = min(W, int(fcx + (CW - FX) / sc) + 1), min(H, int(fcy + (CH - FY) / sc) + 1)
        crop = im.crop((ix0, iy0, ix1, iy1))
        cut = self.remove(crop, session=self.session)
        a = np.array(cut)
        # someone standing beside the player (a handshake, a presentation): blank everything on their side of the
        # halfway line between the two faces, so no part of them is left on the card
        for x2, y2, w2, h2 in fs[1:]:
            c2 = x2 + w2 / 2
            if abs(c2 - fcx) > 0.8 * w:
                mx = int((fcx + c2) / 2 - ix0)
                if c2 > fcx:
                    a[:, max(mx, 0):, 3] = 0
                else:
                    a[:, :max(mx, 0), 3] = 0
        mask = (a[:, :, 3] > 100).astype(np.uint8)
        n, lab, st, _ = cv2.connectedComponentsWithStats(mask, 8)
        if n < 2:
            return None, "cut-out empty"
        # keep the piece that holds the face, drop stray bits of other people and background
        fx, fy = int(fcx - ix0), int(fcy - iy0)
        keep = lab[min(max(fy, 0), lab.shape[0] - 1), min(max(fx, 0), lab.shape[1] - 1)]
        if keep == 0:
            keep = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
        a[:, :, 3] = np.where(lab == keep, a[:, :, 3], 0)
        fy0, fx0 = max(y - iy0, 0), max(x - ix0, 0)
        face_cov = (a[fy0:fy0 + h, fx0:fx0 + w, 3] > 100).mean() if h and w else 0
        if face_cov < 0.5:
            return None, "cut-out lost the face"
        piece = Image.fromarray(a).resize((max(1, round((ix1 - ix0) * sc)), max(1, round((iy1 - iy0) * sc))), Image.LANCZOS)
        canvas = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
        canvas.alpha_composite(piece, (max(0, round((ix0 - sx0) * sc)), max(0, round((iy0 - sy0) * sc))))
        out = canvas
        why = self.check(out)
        return (None, why) if why else (out, None)

    def check(self, img):
        """Final check on a finished 440x550 cut-out: a clear face of a fair size near the top, a figure that fills
        the frame sensibly, and shoulders that reach the bottom edge (not a floating head or a stray blob)."""
        cv2, np, Image = self.cv2, self.np, self.Image
        a = np.array(img)
        al = a[:, :, 3] > 100
        fill, bottom = al.mean(), al[-3:].mean()
        if fill < 0.22:
            return f"figure too small in frame ({fill:.0%})"
        if fill > 0.93:
            return "background not removed"
        if bottom < 0.25:
            return "figure does not reach the bottom (floating)"
        if self.yunet is None:
            return None
        rgb = np.array(Image.alpha_composite(Image.new("RGBA", img.size, (128, 128, 128, 255)), img).convert("RGB"))
        self.yunet.setInputSize(img.size)
        _, res = self.yunet.detect(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
        faces = [f for f in (res if res is not None else []) if f[14] >= 0.8]
        if not faces:
            return "no clear face after cut-out"
        f = max(faces, key=lambda f: f[2])
        if f[2] < 0.16 * img.size[0]:
            return "face too small after framing"
        if f[1] + f[3] / 2 > 0.6 * img.size[1]:
            return "face too low in frame"
        return None


# ---------------------------------------------------------------- candidates
def main():
    ci, ca, names = {}, {}, {}
    for p in csv.DictReader(open(people_csv, encoding="utf-8")):
        names[p["identifier"]] = p.get("name") or p["identifier"]
        for k in ("key_cricinfo", "key_cricinfo_2", "key_cricinfo_3"):
            if p.get(k):
                ci[p[k]] = p["identifier"]
        if p.get("key_cricketarchive"):
            ca[p["key_cricketarchive"]] = p["identifier"]
    full_names = json.load(open(f"{cache}/names.json")) if os.path.exists(f"{cache}/names.json") else {}
    con = duckdb.connect(f"{work}/cricforgeek.duckdb", read_only=True)
    FULL_SQL = ", ".join(f"'{t}'" for t in FULL)
    national = {r[0]: (r[1], r[2]) for r in con.execute(f"""
        select a.player, mode(a.team), count(*) n from appearances a join matches m using (match_id)
        where m.comp in {OFFICIAL} and m.year >= 2024 and a.team in ({FULL_SQL}) group by a.player""").fetchall()}
    top = {r[0]: r[1] for r in con.execute("""
        select a.player, count(*) n from appearances a join matches m using (match_id)
        where m.lvl_top and m.year >= 2015 group by a.player""").fetchall()}
    con.close()
    for pid, (_, n) in national.items():
        top[pid] = max(top.get(pid, 0), n) + 10000  # current internationals first
    order = sorted(top, key=lambda k: -top[k])

    def full(pid):
        """The best searchable name: Wikidata's full name, else the register name if it isn't initials."""
        for nm in full_names.get(pid, []):
            if " " in nm and not re.match(r"^[A-Z]{1,4} ", nm):
                return nm
        nm = names.get(pid, "")
        return nm if " " in nm and not re.match(r"^[A-Z]{1,4} ", nm) else None

    def sparql(q):
        return json.loads(get("https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(q), 180))["results"]["bindings"]

    cand = {pid: [] for pid in top}
    src_n = {"wikidata": 0, "article": 0, "search": 0, "commons": 0, "fix": 0}

    def add(pid, file, kind):
        file = urllib.parse.unquote(file.rsplit("/", 1)[-1]).replace("_", " ")
        if pid in cand and file not in cand[pid]:
            if not cand[pid]:
                src_n[kind] += 1
            cand[pid].append(file)

    def fix_name(f):
        return (f["name"] if isinstance(f, dict) else f).replace("File:", "")
    for pid, f in fixes.get("file", {}).items():
        if pid in cand:
            cand[pid].insert(0, fix_name(f)); src_n["fix"] += 1
    for pid, o in fixes.get("own", {}).items():  # photos supplied by the site owner, with permission
        cand.setdefault(pid, [])
        if pid not in order:
            order.insert(0, pid); top[pid] = 20000
        cand[pid].insert(0, "own:" + (o.get("path") or o["url"])); src_n["fix"] += 1
    # 1. Wikidata photos by ESPNcricinfo / CricketArchive id
    for prop, ids in (("P2697", ci), ("P2698", ca)):
        try:
            for b in sparql(f"SELECT ?k ?img WHERE {{ ?p wdt:{prop} ?k . ?p wdt:P18 ?img . }}"):
                pid = ids.get(b["k"]["value"])
                if pid:
                    add(pid, b["img"]["value"], "wikidata")
        except Exception as e:
            print(f"Wikidata {prop} lookup failed ({type(e).__name__})")
    # 2. the free lead photo of their Wikipedia article (Wikidata entry found by ESPNcricinfo id)
    try:
        arts = {}
        for b in sparql("SELECT ?k ?article WHERE { ?p wdt:P2697 ?k . ?article schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> . }"):
            pid = ci.get(b["k"]["value"])
            if pid in cand:
                arts[urllib.parse.unquote(b["article"]["value"].rsplit("/wiki/", 1)[1]).replace("_", " ")] = pid
        titles = sorted(arts, key=lambda t: -top[arts[t]])[:2500]
        for i in range(0, len(titles), 50):
            res = api("en.wikipedia.org", prop="pageimages", piprop="name", pilicense="free", redirects=1, titles="|".join(titles[i:i + 50]))
            back = {r["to"]: r["from"] for r in res["query"].get("redirects", [])}
            for pg in res["query"].get("pages", {}).values():
                t = back.get(pg.get("title"), pg.get("title"))
                if pg.get("pageimage") and t in arts:
                    add(arts[t], pg["pageimage"], "article")
            time.sleep(0.2)
    except Exception as e:
        print(f"Wikipedia article photos failed ({type(e).__name__})")
    # 3 and 4. still nothing for a current international: search Wikipedia, then Commons, by full name
    def all_failed(k):
        st = state.get(k, {})
        return bool(cand[k]) and not (cached(k) or "").endswith(V + ".webp") and all(st.get("fail", {}).get(f) == R for f in cand[k])

    def search(pid, nm):
        """Wikipedia by name (page must be about a cricketer of that name), then Commons files named for them."""
        found = []
        res = api("en.wikipedia.org", generator="search", gsrlimit=3, prop="pageimages|description", piprop="name", pilicense="free",
                  gsrsearch=f'"{nm}" cricketer')
        for pg in sorted(res.get("query", {}).get("pages", {}).values(), key=lambda x: x.get("index", 9)):
            if pg.get("pageimage") and "cricket" in (pg.get("description") or "").lower() and norm(re.sub(r" \(.*\)$", "", pg["title"])) == norm(nm):
                found.append(("search", pg["pageimage"])); break
        time.sleep(1.0)  # stay well inside Wikimedia's rate limits
        team = national[pid][0]
        res = api("commons.wikimedia.org", generator="search", gsrnamespace=6, gsrlimit=10, gsrsearch=f'"{nm}" cricket',
                  prop="categories", cllimit=50)
        toks = norm(nm).split()
        for pg in sorted(res.get("query", {}).get("pages", {}).values(), key=lambda x: x.get("index", 99)):
            t = pg["title"][5:]
            tl = norm(t.rsplit(".", 1)[0])
            cats = " ".join(c["title"].lower() for c in pg.get("categories", []))
            if not all(k in tl.split() or k in tl for k in toks):
                continue  # the file name must carry the full name
            if re.search(r"\b(and|with|team|squad|group|vs|v)\b", tl):
                continue  # likely more than one person
            if "cricket" not in cats + " " + tl and team.lower() not in cats:
                continue
            if not t.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                continue
            found.append(("commons", t))
        time.sleep(1.0)
        return found

    looked, search_err = 0, 0
    today = time.strftime("%Y-%m-%d")
    recent = time.strftime("%Y-%m-%d", time.gmtime(time.time() - 14 * 86400))
    for pid in [k for k in order if k in national and (not cand[k] or all_failed(k))]:
        nm = full(pid)
        if not nm:
            continue
        sst = state.setdefault(pid, {"fail": {}})
        if sst.get("searched", "") >= recent:  # searched lately: reuse what it found rather than ask again
            for kind, f in sst.get("found", []):
                add(pid, f, kind)
            continue
        if looked >= 250:  # the rest are searched on later nights
            continue
        looked += 1
        try:
            found = search(pid, nm)
        except Exception as e:
            search_err += 1
            print(f"name search failed for {pid} ({type(e).__name__} {getattr(e, 'code', '')} {str(getattr(e, 'reason', ''))[:60]})")
            continue
        sst["searched"], sst["found"] = today, found
        for kind, f in found:
            add(pid, f, kind)
    print(f"name search: {looked} players searched tonight, {search_err} errors")
    print(f"photo sources: {src_n['wikidata']} via Wikidata, {src_n['article']} via Wikipedia articles, {src_n['search']} via "
          f"Wikipedia name search, {src_n['commons']} via Commons search, {src_n['fix']} hand-picked (searched {looked} names)")

    nat = [k for k in order if k in national]
    have = [k for k in nat if cand[k] or cached(k)]
    print(f"current full-member internationals: {len(have)} of {len(nat)} have a photo source")
    miss = [f"{names.get(k, k)} ({national[k][0]})" for k in nat if k not in have]
    print(f"current internationals still without a free photo ({len(miss)}): {', '.join(miss[:60])}")
    for nm in ("Abhishek Sharma",):  # spot check for players people have asked about
        ids = [k for k, v in names.items() if v == nm]
        print(f"photo check {nm}: " + ", ".join(f"{k} {'current intl' if k in national else 'not current intl'}, candidates {cand.get(k, [])[:3]}, "
                                                 f"{'cached ' + V if cached(k) and cached(k).endswith(V + '.webp') else ('cached old' if cached(k) else 'not cached')}" for k in ids))

    # ---------------------------------------------------------------- process: new players first, then re-frame old ones
    try:
        fr = Framer()
    except Exception as e:  # without the cut-out package, keep the cached photos and add none
        print(f"cut-out package unavailable ({type(e).__name__}: {e}); no new photos tonight")
        fr = None
    t0, made, reframed, fails = time.time(), 0, 0, {}
    # hand-picked photos first, even for players who already have one
    picked = {**{k: fix_name(f) for k, f in fixes.get("file", {}).items()},
              **{k: "own:" + (o.get("path") or o["url"]) for k, o in fixes.get("own", {}).items()}}
    # a pick is tried once each time it changes (file or crop), whatever happened to that file before
    pick_key = {k: json.dumps(fixes.get("file", {}).get(k) or fixes.get("own", {}).get(k), sort_keys=True) for k in picked}
    redo = [k for k in picked if k in cand and state.get(k, {}).get("pick") != pick_key[k]]
    for k in redo:
        state.setdefault(k, {"fail": {}})["fail"].pop(picked[k], None)
    todo = redo + [k for k in order if cand[k] and not cached(k) and k not in redo] + [k for k in order if cand[k] and cached(k) and not cached(k).endswith(V + ".webp")]
    todo = list(dict.fromkeys(todo))  # each player once
    for pid in todo if fr else []:
        if time.time() - t0 > BUDGET:
            break
        st = state.setdefault(pid, {"fail": {}})
        if st.get("v") == V and all(st["fail"].get(f) == R for f in cand[pid]):
            continue  # every candidate already failed on this version
        was_new = not cached(pid)
        for file in cand[pid]:
            if st["fail"].get(file) == R:
                continue  # this file already failed on this version
            try:
                if file.startswith("own:"):
                    o = fixes["own"][pid]
                    raw = get(o["url"]) if o.get("url") else open(os.path.join(os.path.dirname(FIXES), o["path"]), "rb").read()
                    img, why = fr.frame(raw)
                    if why:
                        st["fail"][file] = R; st["why"] = why; print("skip", pid, names.get(pid, pid), file, why); continue
                    img.save(f"{cache}/{pid}.{V}.webp", "WEBP", quality=82, method=6)
                    credits[pid] = o["credit"]
                    st.update(v=V, src=file, drop=False); made += was_new; reframed += not was_new
                    break
                meta = api("commons.wikimedia.org", prop="imageinfo", iiprop="extmetadata|url", iiurlwidth=1400, titles="File:" + file)
                pg = next(iter(meta["query"]["pages"].values()))
                ii = pg["imageinfo"][0]
                em = ii.get("extmetadata", {})
                lic = strip_tags(em.get("LicenseShortName", {}).get("value"))
                if not lic or "fair use" in lic.lower() or "non-free" in lic.lower():
                    st["fail"][file] = R; fails["no free licence"] = fails.get("no free licence", 0) + 1; continue
                raw = get(ii.get("thumburl") or ii["url"])
                fx = fixes.get("file", {}).get(pid)
                if isinstance(fx, dict) and fx.get("crop") and fix_name(fx) == file:  # hand-set crop, e.g. to leave out someone beside them
                    from PIL import Image as _I
                    im0 = _I.open(io.BytesIO(raw)).convert("RGB"); W0, H0 = im0.size
                    c = fx["crop"]; buf = io.BytesIO()
                    im0.crop((int(c[0] * W0), int(c[1] * H0), int(c[2] * W0), int(c[3] * H0))).save(buf, "JPEG", quality=95); raw = buf.getvalue()
                img, why = fr.frame(raw)
                if why:
                    st["fail"][file] = R; st["why"] = why; fails[why.split(" (")[0]] = fails.get(why.split(" (")[0], 0) + 1
                    print("skip", pid, names.get(pid, pid), file[:60], why)
                    continue
                img.save(f"{cache}/{pid}.{V}.webp", "WEBP", quality=82, method=6)
                artist = strip_tags(em.get("Artist", {}).get("value"))[:60] or "Unknown"
                credits[pid] = f"Photo: {artist} · {lic} · Wikimedia Commons"
                st.update(v=V, src=file, drop=False)
                made += was_new; reframed += not was_new
                break
            except Exception as e:  # one bad file should not stop the build
                print("skip", pid, names.get(pid, pid), type(e).__name__, str(e)[:100])
            time.sleep(0.3)
        else:
            if all(st["fail"].get(f) == R for f in cand[pid]):  # every candidate judged unusable (not a network error)
                st["v"] = V
                st["drop"] = True  # take the old photo down too, rather than show a poor one
        if pid in redo:
            st["pick"] = pick_key[pid]
            ok = st.get("src") == picked[pid] and not st["fail"].get(picked[pid])
            print(f"photo pick {names.get(pid, pid)}: " + ("used" if ok else f"not usable ({st.get('why', 'error')}), kept {st.get('src') or 'no photo'}"))
    json.dump(credits, open(credits_path, "w"))
    json.dump(state, open(state_path, "w"))
    for pid in credits:  # once re-framed, older cut-outs are no longer needed in the cache
        for old in (f"{cache}/{pid}.webp", f"{cache}/{pid}.v2.webp", f"{cache}/{pid}.v3.webp"):
            if os.path.exists(f"{cache}/{pid}.{V}.webp") and os.path.exists(old):
                os.remove(old)
    left = sum(1 for k in todo if not (cached(k) or "").endswith(V + ".webp") and any(state.get(k, {}).get("fail", {}).get(f) != R for f in cand[k]))
    print(f"photo quality: rejected {sum(fails.values())} candidates ({', '.join(f'{k} {v}' for k, v in sorted(fails.items(), key=lambda kv: -kv[1]))}); "
          f"{left} still to process next run")
    index = publish([k for k in credits if k in cand or k in kept])
    dropped = sum(1 for k in credits if state.get(k, {}).get("drop"))
    print(f"{made} new photos, {reframed} re-framed, {dropped} taken down for quality, {len(index)} on the site")


try:
    main()
except Exception as e:  # anything else: keep last night's photos, say why, and let the build carry on
    import traceback
    traceback.print_exc()
    print(f"kept {len(kept)} cached photos; new photos failed: {type(e).__name__}: {str(e)[:120]}")

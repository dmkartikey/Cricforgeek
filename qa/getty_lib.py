"""Nightly: Getty Images embeds for current internationals who have no free-licence photo.

Getty lets non-commercial sites show its editorial photos for free through its official embed (Getty's own viewer
and credit line, unmodified). For each current full-member international without a photo on the site, this searches
Getty's editorial photos by name, prefers official portrait sessions ("... poses for a portrait"), and asks Getty's
oEmbed service for the embed code, trying photos until one that Getty allows to be embedded is found.
Writes <out>/photos/getty.json  {player id: [embed id, signature, image id, width, height, credit]}.
Results are cached for 30 days, and at most LIMIT players are searched per night.
Usage: python getty.py <work dir with cricforgeek.duckdb> <out data dir> <cache dir>
"""
import json, os, re, sys, time, unicodedata, urllib.error, urllib.parse, urllib.request
import duckdb

work, out, cache = sys.argv[1:4]
LIMIT = int(os.environ.get("GETTY_LIMIT", "70"))
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36", "Accept-Language": "en"}
FULL = ["India", "Australia", "England", "South Africa", "New Zealand", "Pakistan", "Sri Lanka", "West Indies",
        "Bangladesh", "Afghanistan", "Zimbabwe", "Ireland"]
OFFICIAL = "('men-test', 'women-test', 'men-odi', 'women-odi', 'men-t20i', 'women-t20i')"
cache_file = f"{cache}/getty.json"
store = json.load(open(cache_file)) if os.path.exists(cache_file) else {}  # {pid: {"t": date, "e": entry or None}}


def get(url):
    for k in range(4):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and k < 3:
                time.sleep(5 * (k + 1)); continue
            raise


def norm(s):
    return re.sub(r"[^a-z ]", " ", unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()).split()


def find(name, team):
    """Best embeddable Getty photo for this player, or None."""
    toks = norm(name)
    seen, cands = set(), []
    for q in (f"{name} cricket portrait", f"{name} cricket"):
        html = get("https://www.gettyimages.com/search/2/image?" + urllib.parse.urlencode({"phrase": q, "family": "editorial", "sort": "best"})).decode("utf-8", "ignore")
        for slug, gid in re.findall(r'/detail/news-photo/([a-z0-9-]+)/(\d{6,})', html):
            words = slug.split("-")
            if gid in seen or not all(t in words for t in toks):
                continue  # the caption must name the player
            if any(w in words for w in ("and", "with", "celebrate", "celebrates", "team", "squad", "group", "trophy")):
                continue  # likely more than one person
            seen.add(gid)
            score = (3 if "portrait" in words or "poses" in words or "headshot" in words else 0) + (1 if set(norm(team)) <= set(words) else 0)
            cands.append((score, int(gid)))
        time.sleep(2)
        if sum(1 for s, _ in cands) >= 30:
            break
    # Some collections (ICC and BCCI portrait sessions among them) can't be embedded, so try up to 25 photos:
    # portraits first, but mixed with others, newest first within each kind
    ranked = sorted(cands, reverse=True)
    port, other = [c for c in ranked if c[0] >= 3], [c for c in ranked if c[0] < 3]
    mixed = [x for pair in zip(port, other) for x in pair] + port[len(other):] + other[len(port):]
    for _, gid in mixed[:25]:
        try:
            oe = json.loads(get("https://embed.gettyimages.com/oembed?" + urllib.parse.urlencode({"url": f"http://gty.im/{gid}", "caption": "false"})))
        except urllib.error.HTTPError:
            time.sleep(0.4); continue  # this photo can't be embedded; try the next
        m_id, m_sig = re.search(r"id:'([^']+)'", oe.get("html", "")), re.search(r"sig:'([^']+)'", oe.get("html", ""))
        if not (m_id and m_sig):
            continue
        credit = f"Photo: {oe.get('photographer') or 'Getty Images'} · Getty Images"
        return [m_id.group(1), m_sig.group(1), str(gid), int(oe.get("width") or 594), int(oe.get("height") or 396), credit[:120]]
    return None


con = duckdb.connect(f"{work}/cricforgeek.duckdb", read_only=True)
FULL_SQL = ", ".join(f"'{t}'" for t in FULL)
national = con.execute(f"""
    select a.player, mode(a.team), count(*) n from appearances a join matches m using (match_id)
    where m.comp in {OFFICIAL} and m.year >= 2024 and a.team in ({FULL_SQL}) group by a.player order by n desc""").fetchall()
con.close()
have = json.load(open(f"{out}/photos/index.json")) if os.path.exists(f"{out}/photos/index.json") else {}
search = json.load(open(f"{out}/search.json"))
names = {r[0]: r for r in search["players"]}
full_names = json.load(open(f"{cache}/names.json")) if os.path.exists(f"{cache}/names.json") else {}


def full(pid):
    for nm in full_names.get(pid, []) + [names.get(pid, [None, ""])[1]]:
        if nm and " " in nm and not re.match(r"^[A-Z]{1,4} ", nm):
            return nm
    return None


recent = time.strftime("%Y-%m-%d", time.gmtime(time.time() - 30 * 86400))
looked = errors = 0
for pid, team, _ in national:
    st = store.get(pid, {})
    if pid in have or (st.get("t", "") >= recent and (st.get("e") or st.get("v") == 2)):
        continue  # found already, or searched lately with this version
    nm = full(pid)
    if not nm or looked >= LIMIT:
        continue
    looked += 1
    try:
        store[pid] = {"t": time.strftime("%Y-%m-%d"), "e": find(nm, team.replace(" Women", "")), "v": 2}
    except Exception as e:
        errors += 1
        print(f"getty search failed for {nm} ({type(e).__name__} {getattr(e, 'code', '')})")
        if errors >= 10:
            break  # Getty is refusing us tonight; try again tomorrow
json.dump(store, open(cache_file, "w"))
emb = {pid: v["e"] for pid, v in store.items() if v.get("e") and pid not in have}
os.makedirs(f"{out}/photos", exist_ok=True)
json.dump(emb, open(f"{out}/photos/getty.json", "w"), separators=(",", ":"))
nat_missing = [p for p, _, _ in national if p not in have]
print(f"getty: {looked} searched tonight ({errors} errors); {len(emb)} players shown with a Getty photo; "
      f"{sum(1 for p in nat_missing if p in emb)} of {len(nat_missing)} current internationals without a free photo now covered")

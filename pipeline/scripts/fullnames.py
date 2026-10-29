"""Nightly: full names for search.

Cricsheet's register only has short names ("V Kohli"). Wikidata links each ESPNcricinfo player id (P2697) to the
player's full name and common aliases ("Virat Kohli"). This adds them to search.json as a 10th field per player:
"Virat Kohli|<alias>|...". Names are cached, so a Wikidata outage keeps the last good set.
Usage: python fullnames.py <people.csv> <out data dir> <cache dir>
"""
import csv, json, os, sys, urllib.parse, urllib.request

people_csv, out, cache = sys.argv[1:4]
os.makedirs(cache, exist_ok=True)
cache_file = f"{cache}/names.json"
UA = {"User-Agent": "cricforgeek-names/1.0 (https://cricforgeek.site)"}

ci = {}
for p in csv.DictReader(open(people_csv, encoding="utf-8")):
    for k in ("key_cricinfo", "key_cricinfo_2", "key_cricinfo_3"):
        if p.get(k):
            ci[p[k]] = p["identifier"]

names = json.load(open(cache_file)) if os.path.exists(cache_file) else {}
try:
    q = """SELECT ?ci ?label ?alt WHERE { ?p wdt:P2697 ?ci . ?p rdfs:label ?label . FILTER(lang(?label) = "en")
           OPTIONAL { ?p skos:altLabel ?alt . FILTER(lang(?alt) = "en") } }"""
    req = urllib.request.Request("https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(q), headers=UA)
    rows = json.loads(urllib.request.urlopen(req, timeout=180).read())["results"]["bindings"]
    fresh = {}
    for b in rows:
        pid = ci.get(b["ci"]["value"])
        if not pid:
            continue
        lst = fresh.setdefault(pid, [])
        for k in ("label", "alt"):
            v = b.get(k, {}).get("value", "").strip()
            if v and v not in lst and len(v) <= 60 and not v.startswith("Q"):
                lst.append(v)
    if len(fresh) > 1000:  # sanity check before replacing the cache
        names = {k: v[:6] for k, v in fresh.items()}
        json.dump(names, open(cache_file, "w"))
    print(f"wikidata: {len(fresh)} players with names")
except Exception as e:
    print(f"wikidata unavailable ({type(e).__name__}); using {len(names)} cached names")

path = f"{out}/search.json"
idx = json.load(open(path))
n = 0
for p in idx["players"]:
    extra = [x for x in names.get(p[0], []) if x.lower() not in (p[1].lower(), str(p[2]).lower())]
    while len(p) < 9:
        p.append(None)
    p[9:] = ["|".join(extra)]
    n += bool(extra)
json.dump(idx, open(path, "w"), separators=(",", ":"), ensure_ascii=False)
print(f"full names added for {n} of {len(idx['players'])} players")

# Display names for the site ("Virat Kohli" for "V Kohli"): the Wikidata name, kept only when it is clearly the same
# person's everyday name: same surname as the register, no brackets, and not a very long formal name.
disp = {}
for p in idx["players"]:
    reg = p[1]
    for cand in names.get(p[0], [])[:1]:
        c = cand.strip()
        if "(" in c or len(c) > 26 or c.lower() == reg.lower() or " " not in c:
            continue
        if c.split()[-1].lower() != reg.split()[-1].lower():
            continue  # surname differs: likely a formal or different name, keep the register name
        disp[p[0]] = c
json.dump(disp, open(f"{out}/names.json", "w"), separators=(",", ":"), ensure_ascii=False)
print(f"display names: {len(disp)} players shown by full name")

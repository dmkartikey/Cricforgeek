"""Nightly: full names for search.

Cricsheet's register only has short names ("V Kohli"). Wikidata links each ESPNcricinfo player id (P2697) to the
player's full name and common aliases ("Virat Kohli"). This adds them to search.json as a 10th field per player:
"Virat Kohli|<alias>|...". Names are cached, so a Wikidata outage keeps the last good set.
Usage: python fullnames.py <people.csv> <out data dir> <cache dir>
"""
import csv, json, os, sys, time, urllib.parse, urllib.request

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
# Ask Wikidata in batches of 300 ESPNcricinfo ids. One query for every cricketer is too big: Wikidata cuts it off and
# thousands of players (Tendulkar and Dhoni among them) came back with no name. Names found on earlier nights are kept.
want = sorted(ci)
fresh, failed = {}, 0
for i in range(0, len(want), 300):
    vals = " ".join('"' + k.replace('"', "") + '"' for k in want[i:i + 300])
    # English names, or Wikidata's newer "mul" (all languages) names, which have replaced English ones on many
    # famous players (Tendulkar, Dhoni); English first when both exist
    q = f"""SELECT ?ci ?label ?alt WHERE {{ VALUES ?ci {{ {vals} }} ?p wdt:P2697 ?ci .
           OPTIONAL {{ ?p rdfs:label ?en . FILTER(lang(?en) = "en") }} OPTIONAL {{ ?p rdfs:label ?mul . FILTER(lang(?mul) = "mul") }}
           BIND(COALESCE(?en, ?mul) AS ?label) FILTER(BOUND(?label))
           OPTIONAL {{ ?p skos:altLabel ?alt . FILTER(lang(?alt) IN ("en", "mul")) }} }}"""
    try:
        req = urllib.request.Request("https://query.wikidata.org/sparql", data=urllib.parse.urlencode({"query": q, "format": "json"}).encode(),
                                     headers={**UA, "Content-Type": "application/x-www-form-urlencoded"})
        rows = json.loads(urllib.request.urlopen(req, timeout=90).read())["results"]["bindings"]
    except Exception as e:
        failed += 1
        if failed >= 8:
            print(f"wikidata keeps failing ({type(e).__name__}); stopping early, keeping cached names")
            break
        continue
    for bnd in rows:
        pid = ci.get(bnd["ci"]["value"])
        if not pid:
            continue
        lst = fresh.setdefault(pid, [])
        for k in ("label", "alt"):  # the label comes first in each row, so it leads the list
            v = bnd.get(k, {}).get("value", "").strip()
            if v and v not in lst and len(v) <= 60 and not v.startswith("Q"):
                lst.append(v)
    time.sleep(0.5)
names.update({k: v[:6] for k, v in fresh.items()})
json.dump(names, open(cache_file, "w"))
print(f"wikidata: {len(fresh)} players with names tonight ({failed} batches failed); {len(names)} with names in all")

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
    for cand in names.get(p[0], []):  # the Wikidata label first, then its aliases: the first that passes is used
        c = cand.strip()
        if "(" in c or len(c) > 26 or c.lower() == reg.lower() or " " not in c:
            continue
        if c.split()[-1].lower() != reg.split()[-1].lower():
            continue  # surname differs: likely a formal or different name, keep the register name
        disp[p[0]] = c
        break
json.dump(disp, open(f"{out}/names.json", "w"), separators=(",", ":"), ensure_ascii=False)
print(f"display names: {len(disp)} players shown by full name")

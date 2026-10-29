import json, urllib.request
get = lambda p: json.loads(urllib.request.urlopen(f"https://cricforgeek.site/data/{p}", timeout=60).read())
g, s = get("photos/getty.json"), get("search.json")
names = {r[0]: r[1] for r in s["players"]}
print(f"ON SITE {len(g)}:", ", ".join(names.get(k, k) for k in g))
for k in ("f29185a1", "3241e3fd", "235c2bb6", "0a509d6b", "e4a0deae", "50c6bc2b"):
    print(names.get(k), "->", "yes" if k in g else "no")

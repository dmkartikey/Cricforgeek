import json, urllib.request
s = json.loads(urllib.request.urlopen("https://cricforgeek.site/data/search.json", timeout=60).read())
for r in s["players"]:
    if r[0] in ("d2c2b2d5", "4a8a2e3b", "740742ef", "dbe50b21"):
        print(r[0], r[1], "->", r[9] if len(r) > 9 else None)

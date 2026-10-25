"""One-off check: Wikimedia photo coverage for Cricsheet players, plus three sample cut-outs."""
import csv, io, json, os, sys, time, urllib.parse, urllib.request
UA = {"User-Agent": "cricforgeek-photo-check/1.0 (https://cricforgeek.site)"}
out = sys.argv[1]; os.makedirs(out, exist_ok=True)

def get(url, data=None):
    req = urllib.request.Request(url, data=data, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()

people = list(csv.DictReader(io.StringIO(get("https://cricsheet.org/register/people.csv").decode())))
ci = {}
for p in people:
    for k in ("key_cricinfo", "key_cricinfo_2", "key_cricinfo_3"):
        if p.get(k):
            ci[p[k]] = p["identifier"]
q = "SELECT ?ci ?img ?lic WHERE { ?p wdt:P2697 ?ci . ?p wdt:P18 ?img . }"
res = json.loads(get("https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(q)))
imgs = {}
for b in res["results"]["bindings"]:
    if b["ci"]["value"] in ci:
        imgs.setdefault(ci[b["ci"]["value"]], b["img"]["value"])
report = {"players_in_register": len(people), "with_cricinfo_id": len(set(ci.values())), "with_photo": len(imgs)}

# coverage among players who appeared in a recent senior international or major league is checked by the site build later;
# here we sample three named players
sample = {"ba607b88": "kohli", "462411b3": "bumrah", "5d2eda89": "mandhana", "dbe50b21": "pandya", "fe93fd9d": "jadeja"}
from rembg import remove
from PIL import Image
for pid, name in sample.items():
    url = imgs.get(pid)
    report[name] = url
    if not url:
        continue
    file = urllib.parse.unquote(url.rsplit("/", 1)[1])
    meta = json.loads(get("https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=extmetadata|url&iiurlwidth=600&titles=File:" + urllib.parse.quote(file)))
    page = next(iter(meta["query"]["pages"].values()))
    ii = page["imageinfo"][0]; em = ii.get("extmetadata", {})
    report[name + "_credit"] = {k: em.get(k, {}).get("value") for k in ("Artist", "LicenseShortName", "LicenseUrl")}
    raw = get(ii["thumburl"])
    open(f"{out}/{name}.jpg", "wb").write(raw)
    cut = remove(Image.open(io.BytesIO(raw)).convert("RGB"))
    cut.thumbnail((480, 640)); cut.save(f"{out}/{name}-cut.png", optimize=True)
    time.sleep(1)
json.dump(report, open(f"{out}/report.json", "w"), indent=1)
print(json.dumps(report, indent=1))

import json, urllib.parse, urllib.request
UA = {"User-Agent": "cricforgeek-names/1.0 (https://cricforgeek.site)"}
def sp(q):
    req = urllib.request.Request("https://query.wikidata.org/sparql", data=urllib.parse.urlencode({"query": q, "format": "json"}).encode(), headers={**UA, "Content-Type": "application/x-www-form-urlencoded"})
    return json.loads(urllib.request.urlopen(req, timeout=90).read())["results"]["bindings"]
for qid in ("Q9488", "Q470774"):
    rows = sp(f"SELECT ?prop ?v WHERE {{ wd:{qid} ?p ?v . ?prop wikibase:directClaim ?p . FILTER(?prop IN (wd:P2697, wd:P2698, wd:P4556, wd:P8180)) }}")
    print(qid, [(r["prop"]["value"].rsplit("/", 1)[1], r["v"]["value"]) for r in rows])

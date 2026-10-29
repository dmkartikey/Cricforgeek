import json, urllib.parse, urllib.request
UA = {"User-Agent": "cricforgeek-names/1.0 (https://cricforgeek.site)"}
def sp(q):
    req = urllib.request.Request("https://query.wikidata.org/sparql", data=urllib.parse.urlencode({"query": q, "format": "json"}).encode(), headers={**UA, "Content-Type": "application/x-www-form-urlencoded"})
    return json.loads(urllib.request.urlopen(req, timeout=90).read())["results"]["bindings"]
print("A", [(r["ci"]["value"], r["p"]["value"]) for r in sp('SELECT ?ci ?p WHERE { VALUES ?ci { "35320" "28081" "253802" } ?p wdt:P2697 ?ci . }')])
print("B", [(r["ci"]["value"], r.get("label", {}).get("value")) for r in sp('SELECT ?ci ?label WHERE { VALUES ?ci { "35320" "28081" "253802" } ?p wdt:P2697 ?ci . ?p rdfs:label ?label . FILTER(lang(?label) = "en") }')])
print("C", sp('SELECT ?v (DATATYPE(?v) AS ?dt) WHERE { wd:Q9488 wdt:P2697 ?v . }'))

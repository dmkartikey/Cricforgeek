import json, urllib.parse, urllib.request
UA = {"User-Agent": "cricforgeek-names/1.0 (https://cricforgeek.site)"}
q = """SELECT ?ci ?label ?alt WHERE { VALUES ?ci { "35320" "28081" "253802" } ?p wdt:P2697 ?ci .
           OPTIONAL { ?p rdfs:label ?en . FILTER(lang(?en) = "en") } OPTIONAL { ?p rdfs:label ?mul . FILTER(lang(?mul) = "mul") }
           BIND(COALESCE(?en, ?mul) AS ?label) FILTER(BOUND(?label))
           OPTIONAL { ?p skos:altLabel ?alt . FILTER(lang(?alt) IN ("en", "mul")) } }"""
req = urllib.request.Request("https://query.wikidata.org/sparql", data=urllib.parse.urlencode({"query": q, "format": "json"}).encode(), headers={**UA, "Content-Type": "application/x-www-form-urlencoded"})
rows = json.loads(urllib.request.urlopen(req, timeout=90).read())["results"]["bindings"]
print(sorted({(b["ci"]["value"], b["label"]["value"]) for b in rows}))

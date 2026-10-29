import json, urllib.parse, urllib.request
UA = {"User-Agent": "cricforgeek-names/1.0 (https://cricforgeek.site)"}
vals = '"35320" "28081" "34102" "253802"'
q = f"""SELECT ?ci ?label ?alt WHERE {{ VALUES ?ci {{ {vals} }} ?p wdt:P2697 ?ci . ?p rdfs:label ?label . FILTER(lang(?label) = "en")
       OPTIONAL {{ ?p skos:altLabel ?alt . FILTER(lang(?alt) = "en") }} }}"""
req = urllib.request.Request("https://query.wikidata.org/sparql", data=urllib.parse.urlencode({"query": q, "format": "json"}).encode(), headers={**UA, "Content-Type": "application/x-www-form-urlencoded"})
rows = json.loads(urllib.request.urlopen(req, timeout=90).read())["results"]["bindings"]
print(sorted({(b["ci"]["value"], b["label"]["value"]) for b in rows}))

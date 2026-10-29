import os, time, re, urllib.parse
os.environ["GETTY_DEBUG"] = "1"
src = open("qa/getty_lib.py").read().split("\ncon = duckdb.connect")[0]
src = src.replace("work, out, cache = sys.argv[1:4]", "work, out, cache = '.', 'out', 'out'").replace("import duckdb", "")
g = {}; exec(src, g)
html = g["get"]("https://www.gettyimages.com/search/2/image?" + urllib.parse.urlencode({"phrase": "Nicholas Pooran cricket", "family": "editorial", "sort": "best"})).decode("utf-8", "ignore")
print("SEARCH", len(html), html.count("/detail/"), re.sub(r"\s+", " ", html[:400]))
print("TITLE", re.findall(r"<title>([^<]*)", html)[:1])
for nm, team in (("Nicholas Pooran", "West Indies"), ("Heinrich Klaasen", "South Africa"), ("Abhishek Sharma", "India"), ("Glenn Phillips", "New Zealand"), ("Mitchell Santner", "New Zealand"), ("Liam Livingstone", "England")):
    try:
        e = g["find"](nm, team); print("RESULT", nm, e)
    except Exception as x:
        print("ERROR", nm, x)

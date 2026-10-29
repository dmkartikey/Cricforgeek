import sys, time, json, re, urllib.parse, urllib.error
src = open("qa/getty_lib.py").read().split("\ncon = duckdb.connect")[0]
src = src.replace("work, out, cache = sys.argv[1:4]", "work, out, cache = '.', 'out', 'out'").replace("import duckdb", "")
g = {}; exec(src, g)
for nm in ("Nicholas Pooran", "Heinrich Klaasen"):
    toks = g["norm"](nm); res = []
    for q in (f"{nm} cricket portrait", f"{nm} cricket"):
        html = g["get"]("https://www.gettyimages.com/search/2/image?" + urllib.parse.urlencode({"phrase": q, "family": "editorial", "sort": "best"})).decode("utf-8", "ignore")
        allp = re.findall(r'/detail/news-photo/([a-z0-9-]+)/(\d{6,})', html)
        print(f"::notice::getty dbg {q}: {len(allp)} links; first slugs: {[s[:50] for s, _ in allp[:4]]}"[:600])
        for slug, gid in allp[:12]:
            try:
                g["get"]("https://embed.gettyimages.com/oembed?" + urllib.parse.urlencode({"url": f"http://gty.im/{gid}", "caption": "false"})); r = "ok"
            except urllib.error.HTTPError as e:
                r = e.code
            res.append(f"{gid}:{r}:{'name' if all(t in slug.split('-') for t in toks) else 'noname'}")
            time.sleep(0.4)
    print(f"::notice::getty dbg {nm}: {' '.join(res)}"[:1500])

"""Probe: can the build find Getty editorial photos for a player and get Getty's official embed code (oEmbed)?"""
import json, re, sys, time, urllib.parse, urllib.request
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36", "Accept-Language": "en"}
out = {}
for name in ["Abhishek Sharma", "Nicholas Pooran", "Heinrich Klaasen", "Rinku Singh"]:
    r = {"search": None, "ids": [], "oembed": None}
    for q in (f"{name} cricket portrait", f"{name} cricket"):
        url = "https://www.gettyimages.com/search/2/image?" + urllib.parse.urlencode({"phrase": q, "family": "editorial", "sort": "best"})
        try:
            html = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read().decode("utf-8", "ignore")
            r["search"] = f"{len(html)} bytes"
            for slug, gid in re.findall(r'/detail/news-photo/([a-z0-9-]+)/(\d{6,})', html):
                if gid not in [x[1] for x in r["ids"]]:
                    r["ids"].append((slug[:120], gid))
        except Exception as e:
            r["search"] = f"failed {type(e).__name__} {getattr(e, 'code', '')}"
        if r["ids"]:
            break
        time.sleep(2)
    if r["ids"]:
        gid = r["ids"][0][1]
        try:
            oe = json.loads(urllib.request.urlopen(urllib.request.Request(
                "https://embed.gettyimages.com/oembed?" + urllib.parse.urlencode({"url": f"http://gty.im/{gid}", "caption": "false"}), headers=UA), timeout=40).read())
            r["oembed"] = {k: (v[:600] if isinstance(v, str) else v) for k, v in oe.items()}
        except Exception as e:
            r["oembed"] = f"failed {type(e).__name__} {getattr(e, 'code', '')}"
    r["ids"] = r["ids"][:12]
    out[name] = r
    print(f"::notice::getty {name}: search {r['search']}, {len(r['ids'])} ids, oembed {'ok' if isinstance(r['oembed'], dict) else r['oembed']}")
    time.sleep(3)
import os; os.makedirs("out", exist_ok=True)
json.dump(out, open("out/getty-probe.json", "w"), indent=1)

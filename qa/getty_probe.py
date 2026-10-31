import json, urllib.request
def get(u): return json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "cricforgeek-research"}), timeout=60).read())
seen = set()
for q in ("cricket ball", "cricket", "ball tracking", "cricket bowling", "ball detection"):
    for d in get(f"https://huggingface.co/api/datasets?search={q.replace(' ', '%20')}&limit=60&full=true"):
        if d["id"] in seen: continue
        seen.add(d["id"])
        tags = d.get("tags", [])
        lic = [t for t in tags if t.startswith("license:")]
        size = [t for t in tags if t.startswith("size_categories:")]
        print(d["id"], lic, size, d.get("downloads"), [t for t in tags if t.startswith("task_categories:")][:2])
for q in ("cricket",):
    for m in get(f"https://huggingface.co/api/models?search={q}&limit=40"):
        print("MODEL", m["id"], m.get("downloads"), m.get("pipeline_tag"))

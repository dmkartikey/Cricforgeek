"""Photo QC: download every published player photo, score it, flag problems and draw contact sheets.
Usage: python photo_qc.py <site> <out dir>"""
import io, json, os, sys, urllib.request
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

site, out = sys.argv[1:3]
os.makedirs(f"{out}/photos", exist_ok=True)
get = lambda p: urllib.request.urlopen(urllib.request.Request(f"{site}/data/{p}", headers={"User-Agent": "cricforgeek-qa"}), timeout=60).read()
index = json.loads(get("photos/index.json"))
search = json.loads(get("search.json"))
names = {r[0]: r[1] for r in search["players"]}
FULL = {"India", "Australia", "England", "South Africa", "New Zealand", "Pakistan", "Sri Lanka", "West Indies", "Bangladesh",
        "Afghanistan", "Zimbabwe", "Ireland"}
face_cc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
prof_cc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")

rows = []
for pid in sorted(index):
    try:
        raw = get(f"photos/{pid}.webp")
        im = Image.open(io.BytesIO(raw)).convert("RGBA")
    except Exception as e:
        rows.append({"id": pid, "name": names.get(pid, pid), "flags": ["missing file"], "err": str(e)[:80]}); continue
    im.save(f"{out}/photos/{pid}.png")
    a = np.array(im)
    H, W = a.shape[:2]
    al = a[:, :, 3] > 128
    fill = al.mean()
    n, lab, st, _ = cv2.connectedComponentsWithStats(al.astype(np.uint8), 8)
    areas = sorted((st[i, cv2.CC_STAT_AREA] for i in range(1, n)), reverse=True)
    big = areas[0] if areas else 0
    frags = sum(1 for x in areas[1:] if x > 0.01 * H * W)
    rgb = np.array(Image.alpha_composite(Image.new("RGBA", im.size, (128, 128, 128, 255)), im).convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    faces = list(face_cc.detectMultiScale(gray, 1.1, 5, minSize=(max(16, W // 12), max(16, W // 12))))
    prof = [] if faces else list(prof_cc.detectMultiScale(gray, 1.1, 5, minSize=(max(16, W // 12), max(16, W // 12))))
    f = max(faces or prof, key=lambda r: r[2], default=None)
    sharp = None
    if f is not None:
        x, y, w, h = f
        sharp = float(cv2.Laplacian(gray[y:y + h, x:x + w], cv2.CV_64F).var())
    top_touch = al[0].mean()
    side_touch = max(al[:, 0].mean(), al[:, -1].mean())
    flags = []
    if W < 200 or H < 240: flags.append("low res")
    if f is None: flags.append("no face found")
    if len(faces) > 1: flags.append(f"{len(faces)} faces")
    if f is not None and f[2] / W < 0.16: flags.append("player far away")
    if f is not None and f[1] / H > 0.45: flags.append("face low in frame")
    if top_touch > 0.12: flags.append("head cut at top")
    if frags: flags.append(f"{frags} stray pieces")
    if big < 0.9 * al.sum(): flags.append("cut-out in pieces")
    if fill < 0.18: flags.append("mostly empty")
    if sharp is not None and sharp < 40: flags.append("blurry face")
    if side_touch > 0.35: flags.append("cut at side")
    rows.append({"id": pid, "name": names.get(pid, pid), "w": W, "h": H, "kb": round(len(raw) / 1024, 1), "fill": round(float(fill), 2),
                 "faces": len(faces), "profile": bool(prof), "face": [int(v) for v in f] if f is not None else None, "sharp": round(sharp, 1) if sharp else None,
                 "top": round(float(top_touch), 2), "side": round(float(side_touch), 2), "frags": frags, "flags": flags})

# coverage of current full-member national players (seen since 2025, main team a full member)
cur = [r for r in search["players"] if r[4] in FULL and (r[6] or 0) >= 2025 and any(k in (r[8] or "") for k in ("TEST", "ODI", "T20"))]
missing = [f"{r[1]} ({r[4]}, {r[3][0]})" for r in cur if r[0] not in index]
cov = {"current_full_member_players": len(cur), "with_photo": len(cur) - len(missing), "missing": missing}

flagged = [r for r in rows if r["flags"]]
summary = {"photos": len(rows), "flagged": len(flagged), "by_flag": {}}
for r in flagged:
    for fl in r["flags"]:
        k = fl.split(" ", 1)[1] if fl[0].isdigit() else fl
        summary["by_flag"][k] = summary["by_flag"].get(k, 0) + 1
json.dump({"summary": summary, "coverage": cov, "rows": rows}, open(f"{out}/photo-qc.json", "w"), indent=1)
print(f"::notice::photo qc: {json.dumps(summary)}")
print(f"::notice::photo coverage: {cov['with_photo']}/{cov['current_full_member_players']} current full-member players have a photo; missing e.g. {', '.join(missing[:40])}"[:1800])

# contact sheets: famous players first (search order), then the rest; flags written under each photo
order = {r[0]: i for i, r in enumerate(search["players"])}
rows.sort(key=lambda r: order.get(r["id"], 10 ** 6))
TW, TH, C, R = 120, 150, 12, 8
font = ImageFont.load_default(size=10)
for s in range(0, len(rows), C * R):
    sheet = Image.new("RGB", (C * TW, R * (TH + 26)), (225, 222, 214))
    d = ImageDraw.Draw(sheet)
    for k, r in enumerate(rows[s:s + C * R]):
        x, y = (k % C) * TW, (k // C) * (TH + 26)
        p = f"{out}/photos/{r['id']}.png"
        if os.path.exists(p):
            t = Image.open(p); t.thumbnail((TW - 6, TH - 4))
            bg = Image.new("RGBA", t.size, (40, 70, 55, 255)); bg.alpha_composite(t)
            sheet.paste(bg.convert("RGB"), (x + (TW - t.width) // 2, y + 2))
        d.text((x + 3, y + TH), f"{s + k} {r['name'][:19]}", fill=(0, 0, 0), font=font)
        if r["flags"]:
            d.text((x + 3, y + TH + 12), ", ".join(r["flags"])[:24], fill=(190, 20, 20), font=font)
    sheet.save(f"{out}/sheet-{s // (C * R):02d}.jpg", quality=70)

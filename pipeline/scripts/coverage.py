"""Nightly: how complete Cricsheet is for each international format and year.

Tests, ODIs and T20Is carry official sequence numbers (match_type_number). Any number missing between two recorded
matches is a match Cricsheet doesn't have. Missing numbers are given the year of the recorded matches around them.
A number that breaks the date order (one 2026 file is numbered 4931 among numbers in the 4200s) is ignored.
Also lists the teams that never appear at all (Cricsheet has no Afghanistan matches, for one).
Usage: python coverage.py <all_json.zip> <out data dir>
"""
import collections
import json
import sys
import zipfile

FAM = {"Test": "TEST", "ODI": "ODI", "T20": "T20"}
FULL = ["India", "Australia", "England", "South Africa", "New Zealand", "Pakistan", "Sri Lanka", "West Indies",
        "Bangladesh", "Afghanistan", "Zimbabwe", "Ireland"]

zf, out = sys.argv[1:3]
seen = collections.defaultdict(list)
teams = collections.defaultdict(set)
z = zipfile.ZipFile(zf)
for n in z.namelist():
    if not n.endswith(".json"):
        continue
    i = json.loads(z.read(n))["info"]
    if i.get("team_type") != "international" or i.get("match_type") not in FAM:
        continue
    key = f"{FAM[i['match_type']]}-{i.get('gender')}"
    for t in i.get("teams", []):
        teams[key].add(t)
    if i.get("match_type_number"):
        seen[key].append((int(i["match_type_number"]), i["dates"][0]))

cov = {}
for key, rows in seen.items():
    rows.sort()
    # drop numbers that break the date order: almost always a typo in the file
    clean = [r for k, r in enumerate(rows) if not (0 < k < len(rows) - 1 and (r[1] > rows[k + 1][1] and r[1] > rows[k - 1][1] or r[1] < rows[k - 1][1] and r[1] < rows[k + 1][1]))]
    if clean and len(clean) > 1 and clean[-1][1] < clean[-2][1]:
        clean = clean[:-1]
    have = collections.Counter(d[:4] for _, d in clean)
    miss = collections.Counter()
    for (a, da), (b, db) in zip(clean, clean[1:]):
        gap = b - a - 1
        if gap <= 0:
            continue
        if da[:4] == db[:4]:
            miss[da[:4]] += gap
        else:  # split a gap that crosses a new year evenly
            miss[da[:4]] += gap // 2
            miss[db[:4]] += gap - gap // 2
    cov[key] = {y: [have[y], have[y] + miss[y]] for y in sorted(have)}

absent = sorted(t for t in FULL if t not in teams.get("TEST-male", set()) | teams.get("ODI-male", set()) | teams.get("T20-male", set()))
json.dump({"years": cov, "absent_teams": absent}, open(f"{out}/coverage.json", "w"), separators=(",", ":"))
tot = {k: (sum(v[0] for v in c.values()), sum(v[1] for v in c.values())) for k, c in cov.items()}
print("coverage: " + ", ".join(f"{k} {h}/{t}" for k, (h, t) in sorted(tot.items())) + (f"; no matches at all for {', '.join(absent)}" if absent else ""))

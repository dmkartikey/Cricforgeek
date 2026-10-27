"""Nightly data audit: recount every innings straight from the raw Cricsheet files with a separate, simple parser and
check it against what the pipeline built, then check the published files agree with themselves.

Writes <out>/audit.json (shown on the Methodology page) and prints one summary line. Exits 0 either way: a failed
check is reported, not fatal, so one odd file can't stop the nightly update.
Usage: python audit.py <all_json.zip> <work dir with cricforgeek.duckdb> <out data dir>
"""
import datetime as dt
import glob
import json
import sys
import zipfile

import duckdb

BOWLER = {"caught", "bowled", "lbw", "caught and bowled", "stumped", "hit wicket"}
NOTOUT = {"retired hurt", "retired not out"}
zf, work, out = sys.argv[1:4]
checks = []


def check(name, desc, checked, bad):
    checks.append({"name": name, "desc": desc, "checked": checked, "failed": len(bad), "examples": [str(x)[:160] for x in bad[:5]]})


# ---------- 1. independent recount from the raw files
bat, bowl, tot = {}, {}, {}
z = zipfile.ZipFile(zf)
for n in z.namelist():
    if not n.endswith(".json"):
        continue
    mid = n.rsplit("/", 1)[-1][:-5]
    d = json.loads(z.read(n))
    reg = d["info"].get("registry", {}).get("people", {})
    k = 0
    for inn in d.get("innings", []):
        if inn.get("super_over"):
            continue
        k += 1
        pen = inn.get("penalty_runs") or {}
        t, balls = int(pen.get("pre", 0) or 0) + int(pen.get("post", 0) or 0), 0
        for o in inn.get("overs", []):
            for v in o["deliveries"]:
                balls += 1
                ex, r = v.get("extras", {}), v["runs"]
                t += r["total"]
                b, bw, ns = (reg.get(v[x], v[x]) for x in ("batter", "bowler", "non_striker"))
                for p in (b, ns):
                    bat.setdefault((mid, k, p), [0, 0, 0])
                e = bat[(mid, k, b)]
                e[0] += r["batter"]
                e[1] += "wides" not in ex
                q = bowl.setdefault((mid, k, bw), [0, 0, 0])
                q[0] += "wides" not in ex and "noballs" not in ex
                q[1] += r["total"] - ex.get("byes", 0) - ex.get("legbyes", 0) - ex.get("penalty", 0)
                for w in v.get("wickets", []):
                    if w["kind"] not in NOTOUT:
                        bat.setdefault((mid, k, reg.get(w["player_out"], w["player_out"])), [0, 0, 0])[2] += 1
                    q[2] += w["kind"] in BOWLER
        if balls:  # forfeited innings have no balls and no row in the pipeline
            tot[(mid, k)] = t

con = duckdb.connect(f"{work}/cricforgeek.duckdb", read_only=True)
ours_b = {(m, i, p): [r or 0, b or 0, int(o)] for m, i, p, r, b, o in con.execute("select match_id, inn, player, runs, balls, is_out from BI").fetchall()}
ours_w = {(m, i, p): [b, r, w] for m, i, p, b, r, w in con.execute("select match_id, inn, player, balls, runs, wkts from BW").fetchall()}
ours_t = {(m, i): r for m, i, r in con.execute("select match_id, inn, runs from IT").fetchall()}


def compare(raw, ours):
    bad = [("missing", k, raw[k]) for k in raw if k not in ours] + [("extra", k, ours[k]) for k in ours if k not in raw]
    return bad + [("different", k, raw[k], ours[k]) for k in raw if k in ours and list(raw[k]) != list(ours[k])]


check("batting", "Every batting innings (runs, balls faced, out or not) recounted from the raw ball-by-ball files", len(bat), compare(bat, ours_b))
check("bowling", "Every bowling spell (legal balls, runs conceded, wickets) recounted from the raw files", len(bowl), compare(bowl, ours_w))
check("totals", "Every team innings total, including penalty runs", len(tot), compare({k: [v] for k, v in tot.items()}, {k: [v] for k, v in ours_t.items()}))

# ---------- 2. official career figures for players whose whole careers are in Cricsheet (ESPNcricinfo), as a regression check
REF = [("AN Cook", "men-test", 161, 12472, None), ("SCJ Broad", "men-test", 167, None, 604), ("MG Johnson", "men-test", 73, None, 313),
       ("GP Swann", "men-test", 60, None, 255), ("V Kohli", "men-test", 123, 9230, None)]
bad = []
for name, comp, m, r, w in REF:
    pid = con.execute("select player from P where name = ? order by player limit 1", [name]).fetchone()
    if not pid:
        continue
    got_m = con.execute("select count(distinct a.match_id) from appearances a join matches x using (match_id) where a.player = ? and x.comp = ?", [pid[0], comp]).fetchone()[0]
    got_r = con.execute("select sum(runs) from BI b join matches x using (match_id) where b.player = ? and x.comp = ?", [pid[0], comp]).fetchone()[0]
    got_w = con.execute("select sum(wkts) from BW b join matches x using (match_id) where b.player = ? and x.comp = ?", [pid[0], comp]).fetchone()[0]
    for label, ref, got in (("matches", m, got_m), ("runs", r, got_r), ("wickets", w, got_w)):
        if ref is not None and ref != got:
            bad.append((name, comp, label, "official", ref, "here", got))
check("official", "Careers fully covered by Cricsheet match the official record (Cook's Test runs, Broad's and Johnson's Test wickets and others)",
      len(REF), bad)

# ---------- 2. the published files agree with themselves
bad, n = [], 0
for f in glob.glob(f"{out}/players/*.json"):
    p = json.load(open(f))
    n += 1
    for fk, s in p.get("summary", {}).items():
        fam, g = fk.split("-")
        for kind, key in (("bat", "r"), ("bowl", "w")):
            if kind not in s:
                continue
            comps = sum(c.get(kind, {}).get(key, 0) for c in p.get("comps", []) if c["fam"] == fam and c["g"] == g)
            if comps != s[kind].get(key, 0):
                bad.append((p["id"], fk, kind, s[kind].get(key), comps))
            inns = p.get("inns", {}).get(fk, {}).get(kind)
            if inns is not None and len(inns) != s[kind].get("i"):
                bad.append((p["id"], fk, kind, "innings", s[kind].get("i"), len(inns)))
        for kind, pc in (p.get("pct", {}).get(fk) or {}).items():
            if isinstance(pc, dict) and any(v is not None and not 0 <= v <= 100 for v in pc.values()):
                bad.append((p["id"], fk, kind, "percentile out of range"))
check("players", "Each player's format totals equal the sum of their competitions and of their innings list; percentiles lie between 0 and 100", n, bad)

bad, n = [], 0
for f in glob.glob(f"{out}/matches/*.json"):
    if "/index-" in f:
        continue
    m = json.load(open(f))
    n += 1
    for k, e in (m.get("extras") or {}).items():
        runs = sum(b[2] or 0 for b in m["bat"] if str(b[0]) == k)
        ext = e[0] + e[1] + e[2] + e[3] + (e[7] if len(e) > 7 else 0)
        if runs + ext != e[4]:
            bad.append((m["info"]["match_id"], k, "batters + extras", runs + ext, "total", e[4]))
        outs = sum(1 for b in m["bat"] if str(b[0]) == k and b[6])
        if outs != e[6]:
            bad.append((m["info"]["match_id"], k, "dismissals", outs, "wickets", e[6]))
check("scorecards", "On every scorecard, batters' runs plus extras equal the total, and dismissals equal wickets", n, bad)

res = {"run": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"), "ok": all(c["failed"] == 0 for c in checks), "checks": checks}
json.dump(res, open(f"{out}/audit.json", "w"), separators=(",", ":"))
print("audit: " + "; ".join(f"{c['name']} {c['checked'] - c['failed']}/{c['checked']} ok" for c in checks))
for c in checks:
    for ex in c["examples"]:
        print(f"  {c['name']}: {ex}")

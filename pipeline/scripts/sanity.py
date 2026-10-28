"""Nightly metric sanity checks over the published data files: every number agrees with the numbers it is built from,
and stays inside what cricket allows. Adds its checks to <out>/audit.json (written by audit.py) and prints a summary.

Checks: batting and bowling figures within bounds, season rows summing to career totals, ball-by-ball splits summing
to the totals, cards in the card game matching player pages, records consistent with player pages, scorecards where
bowlers' runs and wickets add up, team and venue counts that add up, and every search entry having a player page.
Usage: python sanity.py <out data dir>
"""
import collections
import glob
import json
import os
import sys

out = sys.argv[1]
checks = []


def check(name, desc, checked, bad):
    checks.append({"name": name, "desc": desc, "checked": checked, "failed": len(bad), "examples": [str(x)[:200] for x in bad[:5]]})


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


INTL = {"men-test", "men-odi", "men-t20i", "women-test", "women-odi", "women-t20i"}
players, bad_bat, bad_bowl, bad_season, bad_split, bad_mu, n_blocks, n_split = {}, [], [], [], [], [], 0, 0
for f in glob.glob(f"{out}/players/*.json"):
    p = load(f)
    pid = p["id"]
    players[pid] = p
    blocks = [(c["comp"], c) for c in p.get("comps", [])] + [(k, s) for k, s in p.get("summary", {}).items()]
    for where, c in blocks:
        n_blocks += 1
        b = c.get("bat")
        if b:
            i, r, bl, o = b.get("i", 0), b.get("r", 0), b.get("b", 0), b.get("o", 0)
            why = [w for w, bad in (
                ("negative", min(i, r, bl, o, b.get("f4", 0), b.get("s6", 0), b.get("d", 0)) < 0),
                ("outs > innings", o > i), ("high score > runs", b.get("hs", 0) > r),
                ("high score below average", o and b.get("hs", 0) < r / max(i, 1) - 0.5),
                ("50s + 100s > innings", b.get("c50", 0) + b.get("c100", 0) > i),
                ("boundary runs > runs", 4 * b.get("f4", 0) + 6 * b.get("s6", 0) > r),
                ("dots > balls", b.get("d", 0) > bl),
                ("100s but high score < 100", b.get("c100", 0) > 0 and b.get("hs", 0) < 100),
                ("strike rate over 400", bl >= 30 and r / bl > 4)) if bad]
            if why:
                bad_bat.append((pid, p["name"], where, why, b))
        w = c.get("bowl")
        if w:
            i, bl, r, wk = w.get("i", 0), w.get("b", 0), w.get("r", 0), w.get("w", 0)
            best = w.get("best") or "0/0"
            try:
                bw, br = (int(x) for x in best.split("/"))
            except ValueError:
                bw, br = 0, 0
            why = [x for x, bad in (
                ("negative", min(i, bl, r, wk, w.get("d", 0)) < 0), ("wickets > balls", wk > bl),
                ("best wickets > wickets", bw > wk), ("best over 10 wickets in an innings", bw > 10),
                ("5-fors > innings", w.get("w5", 0) > i), ("3-4 and 5-wicket hauls > innings", w.get("w3", 0) + w.get("w5", 0) > i),
                ("dots > balls", w.get("d", 0) > bl), ("boundary runs > runs", 4 * w.get("f4", 0) + 6 * w.get("s6", 0) > r),
                ("economy over 36", bl >= 60 and r / bl * 6 > 36)) if bad]
            if why:
                bad_bowl.append((pid, p["name"], where, why, w))
    # seasons add up to the competition totals
    comps = {c["comp"]: c for c in p.get("comps", [])}
    for comp, rows in p.get("seasons", {}).items():
        c = comps.get(comp)
        if not c:
            continue
        tot = [sum(x[k] or 0 for x in rows) for k in (1, 2, 3, 6, 7, 8)]
        want = [c.get("bat", {}).get("r", 0), c.get("bat", {}).get("b", 0), c.get("bat", {}).get("o", 0),
                c.get("bowl", {}).get("w", 0), c.get("bowl", {}).get("b", 0), c.get("bowl", {}).get("r", 0)]
        if tot != want:
            bad_season.append((pid, p["name"], comp, "seasons", tot, "career", want))
    # ball-by-ball splits add up to the totals (phase covers every ball; position covers every innings)
    for fk, sp in p.get("splits", {}).items():
        s = p.get("summary", {}).get(fk, {})
        if "bat" in s and sp.get("bat", {}).get("phase"):
            n_split += 1
            ph = sp["bat"]["phase"]
            got = [round(sum(x[2] for x in ph)), round(sum(x[1] for x in ph))]
            if got != [s["bat"]["r"], s["bat"]["b"]]:
                bad_split.append((pid, p["name"], fk, "bat phase runs/balls", got, "total", [s["bat"]["r"], s["bat"]["b"]]))
        if "bat" in s and sp.get("bat", {}).get("pos"):
            got = sum(x[1] for x in sp["bat"]["pos"])
            if got != s["bat"]["i"]:
                bad_split.append((pid, p["name"], fk, "position innings", got, "total", s["bat"]["i"]))
        if "bowl" in s and sp.get("bowl", {}).get("phase"):
            n_split += 1
            ph = sp["bowl"]["phase"]
            got = [round(sum(x[1] for x in ph)), round(sum(x[3] for x in ph))]
            if got != [s["bowl"]["b"], s["bowl"]["w"]]:
                bad_split.append((pid, p["name"], fk, "bowl phase balls/wkts", got, "total", [s["bowl"]["b"], s["bowl"]["w"]]))
    # a matchup can't have more balls than the career
    for fk, mu in p.get("matchups", {}).items():
        s = p.get("summary", {}).get(fk, {})
        for kind in ("bat",):  # a bowler's matchup balls include no-balls, which their legal-ball total leaves out
            if kind in s:
                for m in mu.get(kind, []):
                    if m[2] > s[kind].get("b", 0):
                        bad_mu.append((pid, p["name"], fk, kind, m[1], m[2], "balls >", s[kind].get("b")))

check("bat-bounds", "Batting figures stay within what cricket allows (outs ≤ innings, high score ≤ runs, 4s and 6s ≤ runs, and so on)", n_blocks, bad_bat)
check("bowl-bounds", "Bowling figures stay within what cricket allows (wickets ≤ balls, best figures ≤ wickets, 5-fors ≤ innings, and so on)", n_blocks, bad_bowl)
check("seasons", "Season-by-season rows add up to each player's totals in that competition", sum(len(p.get("seasons", {})) for p in players.values()), bad_season)
check("splits", "Ball-by-ball breakdowns (by phase, by batting position) add up to the player's totals", n_split, bad_split)
check("matchups", "No batter-bowler matchup has more balls than the player's whole career", len(players), bad_mu)

# card game decks match the player pages (internationals only)
bad, n = [], 0
for f in glob.glob(f"{out}/deck/*.json"):
    fam, g = os.path.basename(f)[:-5].split("-")
    for c in load(f):
        n += 1
        p = players.get(c[0])
        if not p:
            bad.append((c[0], c[1], "no player page")); continue
        cs = [x for x in p["comps"] if x["comp"] in INTL and x["fam"] == fam and x["g"] == g]
        r = sum(x.get("bat", {}).get("r", 0) for x in cs); o = sum(x.get("bat", {}).get("o", 0) for x in cs)
        w = sum(x.get("bowl", {}).get("w", 0) for x in cs)
        if c[6] != r or c[13] != w:
            bad.append((c[0], c[1], fam, g, "card runs/wkts", c[6], c[13], "page", r, w))
        elif o and c[7] is not None and abs(c[7] - r / o) > 0.06:
            bad.append((c[0], c[1], fam, g, "card average", c[7], "page", round(r / o, 2)))
check("cards", "Every card in the card battle shows the same runs, wickets and average as the player's page", n, bad)

# records agree with the player pages
bad, n = [], 0
for f in glob.glob(f"{out}/records/*.json"):
    fk = os.path.basename(f)[:-5].replace("-fm", "")
    rec = load(f)
    for row in rec.get("top_scores", []):
        n += 1
        p = players.get(row[2])
        hs = p and p.get("summary", {}).get(fk, {}).get("bat", {}).get("hs")
        if hs is not None and hs < row[5]:
            bad.append((fk, "top score", row[2], row[5], "player high score", hs))
    for row in rec.get("best_bowling", []):
        n += 1
        p = players.get(row[2])
        bw = p and p.get("summary", {}).get(fk, {}).get("bowl", {}).get("w")
        if bw is not None and bw < row[5]:
            bad.append((fk, "best bowling", row[2], row[5], "player wickets", bw))
    for row in rec.get("ducks", []):
        n += 1
        p = players.get(row[0])
        i = p and p.get("summary", {}).get(fk, {}).get("bat", {}).get("i")
        if i is not None and row[1] > i:
            bad.append((fk, "ducks", row[0], row[1], "innings", i))
check("records", "Record lists agree with player pages (a top score never beats the player's own best, ducks ≤ innings)", n, bad)

# scorecards: bowlers' figures add up to the innings
bad, n = [], 0
for f in glob.glob(f"{out}/matches/*.json"):
    if "/index-" in f:
        continue
    m = load(f)
    n += 1
    info = m["info"]
    for k, e in (m.get("extras") or {}).items():
        wd, nb, b, lb, tot, balls, wk = e[:7]
        pen = e[7] if len(e) > 7 else 0
        bw = [x for x in m.get("bowl", []) if str(x[0]) == k]
        if not bw:
            continue
        runs = sum(x[3] or 0 for x in bw)
        if runs != tot - b - lb - pen:
            bad.append((info["match_id"], k, "bowlers' runs", runs, "total less byes, leg byes, penalty", tot - b - lb - pen))
        bwk = sum(x[4] or 0 for x in bw)
        if bwk > wk:
            bad.append((info["match_id"], k, "bowlers' wickets", bwk, "> wickets", wk))
        legal = sum(x[2] or 0 for x in bw)
        if legal != balls:
            bad.append((info["match_id"], k, "bowlers' balls", legal, "innings balls", balls))
    teams = info.get("teams") or []
    if info.get("winner") and teams and info["winner"] not in teams:
        bad.append((info["match_id"], "winner not a team", info["winner"], teams))
check("bowling-cards", "On every scorecard, bowlers' runs equal the total less byes, leg byes and penalties; their balls equal the innings balls", n, bad)

# teams: wins and losses never exceed matches, and competitions add up to formats
bad, n = [], 0
for f in glob.glob(f"{out}/teams/*.json"):
    t = load(f)
    if not isinstance(t, dict):  # the teams index
        continue
    n += 1
    for c in t.get("comps", []):
        if c[3] + c[4] > c[2]:
            bad.append((t["key"], c[0], "won + lost > played", c[2:5]))
    for h in t.get("h2h", []):
        if h[2] + h[3] > h[1]:
            bad.append((t["key"], "v " + h[0], "won + lost > played", h[1:4]))
    for s in t.get("seasons", []):
        if s[3] + s[4] > s[2]:
            bad.append((t["key"], s[0], s[1], "won + lost > played", s[2:5]))
    for fam, x in (t.get("fams") or {}).items():
        if x.get("w", 0) > x.get("p", 0) or x.get("bf_w", 0) > x.get("bf_p", 0) or x.get("ch_w", 0) > x.get("ch_p", 0):
            bad.append((t["key"], fam, "wins > played", x))
check("teams", "Team records add up: wins plus losses never exceed matches, overall and against each opponent", n, bad)

idx = load(f"{out}/venues/index.json") if os.path.exists(f"{out}/venues/index.json") else []
bad = [(v[0], "matches", v[4], "sum of formats", sum(v[8].values())) for v in idx if v[4] != sum(v[8].values())]
bad += [(v[0], "internationals", v[7], "> matches", v[4]) for v in idx if v[7] > v[4]]
check("venues", "Each ground's match count equals the sum of its formats", len(idx), bad)

srch = load(f"{out}/search.json")
bad = [(r[0], r[1], "in search but no player page") for r in srch["players"] if r[0] not in players]
check("search", "Every player in search has a player page", len(srch["players"]), bad)

ap = f"{out}/audit.json"
res = load(ap) if os.path.exists(ap) else {"checks": []}
res["checks"] = [c for c in res["checks"] if c["name"] not in {x["name"] for x in checks}] + checks
res["ok"] = all(c["failed"] == 0 for c in res["checks"])
json.dump(res, open(ap, "w"), separators=(",", ":"))
print("sanity: " + "; ".join(f"{c['name']} {c['checked'] - c['failed']}/{c['checked']} ok" for c in checks))
for c in checks:
    for ex in c["examples"][:3]:
        print(f"  {c['name']}: {ex}")

"""Situation predictor: the tables the browser needs to simulate the rest of a match.

Limited overs (T20, Hundred, one-day):
  * per-ball outcome rates by innings, balls left (in 6-ball blocks), wickets down and,
    when chasing, the required run rate. Sparse cells are shrunk toward broader cells.
  * run and wicket factors for era (year), competition level, batting team, bowling team
    and venue, all measured against what the base table expects for the same balls.
  * "similar situations": what really happened from each state at the start of an over.
Multi-day (Tests, first-class):
  * a multinomial logistic model for win / draw / loss from lead, wickets, overs left
    and run rate, one per innings number, plus per-ball rates to project the innings.
"""
from __future__ import annotations

import math
from collections import defaultdict

import numpy as np

LIMITED = {"T20": 120, "HUN": 100, "ODI": 300}
PR_EDGES = {"T20": [6, 7.5, 9, 10.5, 12, 14, 17], "HUN": [6, 7.5, 9, 10.5, 12, 14, 17], "ODI": [4, 5, 5.75, 6.5, 7.5, 9, 11]}
NEED_STEP = {"T20": 5, "HUN": 5, "ODI": 10}
SCORE_STEP = {"T20": 10, "HUN": 10, "ODI": 15}
MD_CAP = {"TEST-male": 450, "TEST-female": 400, "FC-male": 384, "FC-female": 300}
K_CELL = 80  # pseudo-balls when shrinking a cell toward its parent


def _rows(con, sql):
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, t)) for t in cur.fetchall()]


def _pr_case(fam):
    e = PR_EDGES[fam]
    parts = " ".join(f"when rrr < {x} then {i}" for i, x in enumerate(e))
    return f"case {parts} else {len(e)} end"


# outcome vector: n, p_wide, wide_runs, p_noball, nb_runs, then legal: W, 0, 1, 2, 3, 4, 6
def _vec(c):
    n = c["n"]
    legal = max(c["nl"], 1e-9)
    return [n, c["nwd"] / n, (c["rwd"] / c["nwd"]) if c["nwd"] else 1.0, c["nnb"] / n, (c["rnb"] / c["nnb"]) if c["nnb"] else 1.0,
            c["w"] / legal, c["c0"] / legal, c["c1"] / legal, c["c2"] / legal, c["c3"] / legal, c["c4"] / legal, c["c6"] / legal]


def _shrink(v, parent, k=K_CELL):
    n = v[0]
    a = n / (n + k)
    return [n] + [a * x + (1 - a) * y for x, y in zip(v[1:], parent[1:])]


def _er(v):
    pl = 1 - v[1] - v[3]
    legal_runs = v[6] * 0 + v[7] * 1 + v[8] * 2 + v[9] * 3 + v[10] * 4 + v[11] * 6
    return v[1] * v[2] + v[3] * v[4] + pl * legal_runs, pl * v[5]


OUT_SQL = """count(*) n, count(*) filter (where is_legal) nl, count(*) filter (where wides > 0) nwd, sum(r_tot) filter (where wides > 0) rwd,
  count(*) filter (where noballs > 0) nnb, sum(r_tot) filter (where noballs > 0) rnb,
  count(*) filter (where is_legal and n_wkts > 0) w,
  count(*) filter (where is_legal and n_wkts = 0 and r_tot = 0) c0, count(*) filter (where is_legal and n_wkts = 0 and r_tot = 1) c1,
  count(*) filter (where is_legal and n_wkts = 0 and r_tot = 2) c2, count(*) filter (where is_legal and n_wkts = 0 and r_tot = 3) c3,
  count(*) filter (where is_legal and n_wkts = 0 and r_tot in (4, 5)) c4, count(*) filter (where is_legal and n_wkts = 0 and r_tot >= 6) c6"""


def _factor_rows(con, group, where, k_balls=900):
    """Run and wicket factors vs the base expectation, shrunk toward 1."""
    res = _rows(con, f"""select {group} g, count(*) n, sum(r_tot) r, sum(er * era_r) e, count(*) filter (where n_wkts > 0) w, sum(ew * era_w) ew,
                         avg(er) mer, avg(ew) mew
                         from PSF where {where} group by 1 having count(*) >= 60""")
    out = {}
    for x in res:
        kr, kw = k_balls * x["mer"], k_balls * x["mew"]
        out[x["g"]] = [round((x["r"] + kr) / (x["e"] + kr), 3), round((x["w"] + kw) / (x["ew"] + kw), 3), x["n"]]
    return out


def _limited(con, w, mfam, gender, names, venue_names):
    fk = f"{mfam}-{gender}"
    full = LIMITED[mfam]
    con.execute(f"""create or replace temp table PS as
      select inn, least((inn_balls - legal_before + 5) // 6, 50)::int br, wkts_before::int wk,
             case when inn = 2 and target is not null and target - score_before > 0
                  then (with_rrr.rrr_b) else -1 end pr,
             is_legal, wides, noballs, r_tot, n_wkts, year, comp, lvl_top, lvl_intl, bat_team, bowl_team, venue_key, match_id,
             legal_before, score_before, target, inn_balls, full_balls, winner, result, method, seq, date
      from (select *, {_pr_case(mfam)} rrr_b from (select *, 6.0 * (target - score_before) / greatest(inn_balls - legal_before, 1) rrr from BXE
            where mfam = '{mfam}' and gender = '{gender}' and inn in (1, 2) and not coalesce(super_over, false)
              and wkts_before < 10 and inn_balls > legal_before and result <> 'no result')) with_rrr""")
    cells = {}
    for keycols in (("inn", "br", "wk", "pr"), ("inn", "br", "wk"), ("br", "wk"), ("br",)):
        for x in _rows(con, f"select {', '.join(keycols)}, {OUT_SQL} from PS group by all"):
            k = tuple(x[c] for c in keycols)
            cells[(keycols, k)] = _vec(x)
    glob = _vec(_rows(con, f"select {OUT_SQL} from PS")[0])
    table = {}
    for (keycols, k), v in cells.items():
        if keycols != ("inn", "br", "wk", "pr"):
            continue
        inn, br, wk, pr = k
        g1 = cells.get((("br",), (br,)), glob)
        g2 = _shrink(cells.get((("br", "wk"), (br, wk)), g1), g1)
        g3 = _shrink(cells.get((("inn", "br", "wk"), (inn, br, wk)), g2), g2)
        table[f"{inn}|{br}|{wk}|-1"] = g3
        table[f"{inn}|{br}|{wk}|{pr}"] = _shrink(v, g3) if pr != -1 else g3
    # fill every (inn, br, wk) parent even where the exact pressure cell never happened
    for inn in (1, 2):
        for br in range(1, (full + 5) // 6 + 1):
            for wk in range(10):
                key = f"{inn}|{br}|{wk}|-1"
                if key not in table:
                    g1 = cells.get((("br",), (br,)), glob)
                    table[key] = _shrink(cells.get((("br", "wk"), (br, wk)), g1), g1)
    # base expectation per ball, then factors
    con.execute("create or replace temp table CE (inn int, br int, wk int, pr int, er double, ew double)")
    con.executemany("insert into CE values (?, ?, ?, ?, ?, ?)",
                    [[int(a) for a in k.split("|")] + list(_er(v)) for k, v in table.items()])
    con.execute("""create or replace temp table PSE as select PS.*, coalesce(c.er, p.er) er, coalesce(c.ew, p.ew) ew from PS
                   left join CE c on c.inn = PS.inn and c.br = PS.br and c.wk = PS.wk and c.pr = PS.pr
                   left join CE p on p.inn = PS.inn and p.br = PS.br and p.wk = PS.wk and p.pr = -1""")
    era = {x["year"]: [round(x["r"] / x["e"], 3), round(x["w"] / max(x["ew"], 1e-9), 3), x["n"]]
           for x in _rows(con, "select year, count(*) n, sum(r_tot) r, sum(er) e, count(*) filter (where n_wkts > 0) w, sum(ew) ew from PSE group by 1 having count(*) >= 1500")}
    # competition x year x phase scoring level (start / middle / end of the innings), shrunk toward the year as a whole
    third = (full + 5) // 6 / 3.0
    ph_sql = f"case when br > {2 * third} then 0 when br > {third} then 1 else 2 end"
    eph = {(x["year"], x["ph"]): (x["r"] / x["e"], x["w"] / max(x["ew"], 1e-9))
           for x in _rows(con, f"select year, {ph_sql} ph, sum(r_tot) r, sum(er) e, count(*) filter (where n_wkts > 0) w, sum(ew) ew from PSE group by 1, 2")}
    cy = defaultdict(lambda: defaultdict(lambda: [[1, 1, 0], [1, 1, 0], [1, 1, 0]]))
    for x in _rows(con, f"select comp, year, {ph_sql} ph, count(*) n, sum(r_tot) r, sum(er) e, count(*) filter (where n_wkts > 0) w, sum(ew) ew from PSE group by 1, 2, 3"):
        ey = eph.get((x["year"], x["ph"]), (1, 1))
        k = 1500
        mr, mw = x["e"] / x["n"], x["ew"] / x["n"]
        cy[x["comp"]][x["year"]][x["ph"]] = [round((x["r"] + k * mr * ey[0]) / (x["e"] + k * mr), 3), round((x["w"] + k * mw * ey[1]) / (x["ew"] + k * mw), 3), x["n"]]
    con.execute("create or replace temp table ERA_T (comp varchar, year int, ph int, era_r double, era_w double)")
    con.executemany("insert into ERA_T values (?, ?, ?, ?, ?)", [[c, y, i, v[0], v[1]] for c, ys in cy.items() for y, vs in ys.items() for i, v in enumerate(vs)])
    con.execute(f"""create or replace temp table PSF as select PSE.*, coalesce(e.era_r, 1) era_r, coalesce(e.era_w, 1) era_w from PSE
                    left join ERA_T e on e.comp = PSE.comp and e.year = PSE.year and e.ph = {ph_sql.replace('br', 'PSE.br')}""")
    era_ph = {y: [[round(eph.get((y, i), (1, 1))[0], 3), round(eph.get((y, i), (1, 1))[1], 3)] for i in range(3)] for y in era}
    comp_label = {x["comp"]: x["l"] for x in _rows(con, "select comp, any_value(comp_label) l from matches group by 1")}
    comps_out = {c: {"label": comp_label.get(c, c), "years": {y: v for y, v in ys.items()}} for c, ys in cy.items()
                 if sum(p[2] for v in ys.values() for p in v) >= 4000}
    level = {k: v for k, v in (("top", _factor_rows(con, "1", "lvl_top", 0).get(1)), ("intl", _factor_rows(con, "1", "lvl_intl", 0).get(1)),
                               ("other", _factor_rows(con, "1", "not lvl_top and not lvl_intl", 0).get(1))) if v}
    maxd = con.execute("select max(date) from PS").fetchone()[0]
    recent = f"date::date >= date '{maxd}' - interval 3 year"
    team_bat = {**_factor_rows(con, "bat_team", "true"), **_factor_rows(con, "bat_team", recent)}
    team_bowl = {**_factor_rows(con, "bowl_team", "true"), **_factor_rows(con, "bowl_team", recent)}
    venues = _factor_rows(con, "venue_key", "true", 1500)
    vmeta = {x["venue_key"]: x for x in _rows(con, f"""
        with t as (select match_id, inn, any_value(venue_key) venue_key, any_value(bat_team) bat_team, any_value(winner) winner,
                          max(score_before + r_tot) total, bool_and(inn_balls = full_balls and method is null) is_full
                   from PS group by 1, 2)
        select venue_key, count(*) filter (where inn = 1) m, round(avg(total) filter (where inn = 1 and is_full), 1) avg1,
               round(100.0 * count(*) filter (where inn = 1 and winner = bat_team) / nullif(count(*) filter (where inn = 1 and winner is not null), 0), 1) bfw
        from t group by 1""")}
    # similar situations, at the first ball of each over
    st = NEED_STEP[mfam]
    sc = SCORE_STEP[mfam]
    con.execute("""create or replace temp table OV as select * from (
        select *, row_number() over (partition by match_id, inn, legal_before order by seq) rn from PS where legal_before % 6 = 0) where rn = 1""")
    fin = {(x["match_id"], x["inn"]): x["t"] for x in _rows(con, "select match_id, inn, max(score_before + r_tot) t from PS group by all")}
    chase, first = defaultdict(lambda: [0, 0, 0, []]), defaultdict(lambda: [[], 0, []])
    for x in _rows(con, f"""select match_id, inn, br, wk, score_before s, target, bat_team, bowl_team, winner, result, date,
                                inn_balls = full_balls and method is null is_full from OV order by lvl_top desc, date desc"""):
        if x["inn"] == 2 and x["target"]:
            need = x["target"] - x["s"]
            if need <= 0:
                continue
            c = chase[(x["br"], x["wk"], need // st)]
            o = 0 if x["winner"] == x["bat_team"] else 2 if x["result"] == "tie" else 1
            c[o] += 1
            if len(c[3]) < 2:
                c[3].append([x["match_id"], str(x["date"]), x["bat_team"], x["bowl_team"], "WLT"[o], fin.get((x["match_id"], 2))])
        elif x["inn"] == 1 and x["is_full"]:
            c = first[(x["br"], x["wk"], x["s"] // sc)]
            c[0].append(fin.get((x["match_id"], 1)) or 0)
            c[1] += 1 if x["winner"] == x["bat_team"] else 0
            if len(c[2]) < 2:
                c[2].append([x["match_id"], str(x["date"]), x["bat_team"], x["bowl_team"], "W" if x["winner"] == x["bat_team"] else "L", fin.get((x["match_id"], 1))])
    chase_out = [[k[0], k[1], k[2], v[0], v[1], v[2], v[3]] for k, v in chase.items()]
    first_out = []
    for k, v in first.items():
        a = np.array(v[0])
        first_out.append([k[0], k[1], k[2], len(a)] + [int(np.percentile(a, q)) for q in (10, 25, 50, 75, 90)] + [round(v[1] / len(a), 3), v[2]])
    rd = lambda v: [v[0]] + [round(x, 4) for x in v[1:]]
    w.write(f"predict/{fk}.json", {
        "kind": "limited", "fam": mfam, "gender": gender, "full": full, "pr_edges": PR_EDGES[mfam], "need_step": st, "score_step": sc,
        "cells": {k: rd(v) for k, v in table.items()},
        "era": era, "era_ph": era_ph, "level": level, "comps": comps_out, "team_bat": team_bat, "team_bowl": team_bowl,
        "venues": {k: v + [venue_names.get(k, (k, None))[0], venue_names.get(k, (k, None))[1], vmeta.get(k, {}).get("m"), vmeta.get(k, {}).get("avg1"), vmeta.get(k, {}).get("bfw")]
                   for k, v in venues.items()},
        "chase": chase_out, "first": first_out,
        "balls": int(con.execute("select count(*) from PS").fetchone()[0]),
        "matches": int(con.execute("select count(distinct match_id) from PS").fetchone()[0]),
        "data_to": str(maxd),
    })
    return {"fk": fk, "cells": len(table), "chase": len(chase_out), "first": len(first_out)}


def _softmax_fit(X, y, l2=1e-3, iters=600, lr=0.05):
    n, d = X.shape
    W = np.zeros((d, 3))
    m, v = np.zeros_like(W), np.zeros_like(W)
    Y = np.eye(3)[y]
    for t in range(1, iters + 1):
        Z = X @ W
        Z -= Z.max(1, keepdims=True)
        P = np.exp(Z)
        P /= P.sum(1, keepdims=True)
        g = X.T @ (P - Y) / n + l2 * W
        m = 0.9 * m + 0.1 * g
        v = 0.999 * v + 0.001 * g * g
        W -= lr * (m / (1 - 0.9 ** t)) / (np.sqrt(v / (1 - 0.999 ** t)) + 1e-8)
    Z = X @ W
    Z -= Z.max(1, keepdims=True)
    P = np.exp(Z)
    P /= P.sum(1, keepdims=True)
    return W, P


def md_features(lead, wih, ol, rr):
    L = np.clip(lead / 100.0, -6, 6)
    k = np.clip(wih / 10.0, 0, 1)
    o = np.clip(ol / 90.0, 0, 6)
    r = np.clip(rr / 4.0, 0, 3)
    return np.stack([np.ones_like(L), L, np.sign(L) * L * L / 6, k, o, L * o, k * o, L * k, r, np.exp(-o)], 1)


FEATURES = ["1", "lead", "lead2", "wkts_in_hand", "overs_left", "lead_x_overs", "wkts_x_overs", "lead_x_wkts", "run_rate", "exp_overs"]


def _multiday(con, w, fmt, gender, venue_names):
    fk = f"{fmt}-{gender}"
    cap = MD_CAP[fk]
    con.execute(f"""create or replace temp table MS as
      select *, total_before - bat_before as opp_before from (
        select match_id, inn, seq, bat_team, bowl_team, wkts_before, score_before, legal_before, r_tot, n_wkts, is_legal, wides, noballs,
               winner, result, year, date, venue_key, lvl_top, lvl_intl,
               coalesce(sum(is_legal::int) over (partition by match_id order by inn, seq rows between unbounded preceding and 1 preceding), 0) used,
               coalesce(sum(r_tot) over (partition by match_id order by inn, seq rows between unbounded preceding and 1 preceding), 0) total_before,
               coalesce(sum(r_tot) over (partition by match_id, bat_team order by inn, seq rows between unbounded preceding and 1 preceding), 0) bat_before
        from BXE where fam = '{fmt}' and gender = '{gender}' and inn between 1 and 4 and wkts_before < 10)""")
    states = _rows(con, f"""select * from (select *, row_number() over (partition by match_id, inn, legal_before order by seq) rn
                              from MS where legal_before % 6 = 0) where rn = 1 and result <> 'no result'""")
    if len(states) < 2000:
        return None
    lead = np.array([s["bat_before"] - s["opp_before"] for s in states], float)
    wih = np.array([10 - s["wkts_before"] for s in states], float)
    ol = np.array([max(cap - s["used"] / 6, 0) for s in states], float)
    rr = np.array([6 * s["score_before"] / max(s["legal_before"], 6) for s in states], float)
    y = np.array([0 if s["winner"] == s["bat_team"] else 1 if not s["winner"] else 2 for s in states])
    inns = np.array([s["inn"] for s in states])
    X = md_features(lead, wih, ol, rr)
    models, calib = {}, []
    for k in (1, 2, 3, 4):
        idx = inns == k
        if idx.sum() < 500:
            continue
        Wk, P = _softmax_fit(X[idx], y[idx])
        models[k] = Wk.round(4).tolist()
        ll = float(-np.log(P[np.arange(idx.sum()), y[idx]] + 1e-9).mean())
        acc = float((P.argmax(1) == y[idx]).mean())
        calib.append({"inn": k, "n": int(idx.sum()), "log_loss": round(ll, 3), "accuracy": round(acc, 3)})
    # per-ball rates for projecting the innings: ball-age block (10 overs, new ball at 80) x wickets
    con.execute("create or replace temp table MB as select *, ((legal_before / 6)::int % 80) // 10 age from MS")
    cells, glob = {}, _vec(_rows(con, f"select {OUT_SQL} from MB")[0])
    par = {x["wk"]: _vec(x) for x in _rows(con, f"select wkts_before wk, {OUT_SQL} from MB group by 1")}
    for x in _rows(con, f"select age, wkts_before wk, {OUT_SQL} from MB group by all"):
        cells[f"{x['age']}|{x['wk']}"] = _shrink(_vec(x), _shrink(par.get(x["wk"], glob), glob))
    con.execute("create or replace temp table CE (age int, wk int, er double, ew double)")
    con.executemany("insert into CE values (?, ?, ?, ?)", [[int(a) for a in k.split("|")] + list(_er(v)) for k, v in cells.items()])
    con.execute("create or replace temp table PSE as select MB.*, c.er, c.ew from MB join CE c on c.age = MB.age and c.wk = MB.wkts_before")
    era = {x["year"]: [round(x["r"] / x["e"], 3), round(x["w"] / max(x["ew"], 1e-9), 3), x["n"]]
           for x in _rows(con, "select year, count(*) n, sum(r_tot) r, sum(er) e, count(*) filter (where n_wkts > 0) w, sum(ew) ew from PSE group by 1 having count(*) >= 3000")}
    con.execute("create or replace temp table ERA_T (year int, era_r double, era_w double)")
    con.executemany("insert into ERA_T values (?, ?, ?)", [[y_, v[0], v[1]] for y_, v in era.items()])
    con.execute("create or replace temp table PSF as select PSE.*, coalesce(e.era_r, 1) era_r, coalesce(e.era_w, 1) era_w from PSE left join ERA_T e using (year)")
    maxd = con.execute("select max(date) from MS").fetchone()[0]
    recent = f"date::date >= date '{maxd}' - interval 4 year"
    team_bat = {**_factor_rows(con, "bat_team", "true", 3000), **_factor_rows(con, "bat_team", recent, 3000)}
    team_bowl = {**_factor_rows(con, "bowl_team", "true", 3000), **_factor_rows(con, "bowl_team", recent, 3000)}
    venues = _factor_rows(con, "venue_key", "true", 4000)
    # similar situations: 4th-innings chases, and a coarser table for innings 1-3
    hist4, hist = defaultdict(lambda: [0, 0, 0, []]), defaultdict(lambda: [0, 0, 0])
    order = sorted(range(len(states)), key=lambda i: (bool(states[i]["lvl_top"]), str(states[i]["date"])), reverse=True)
    for i in order:
        s = states[i]
        o = int(y[i])
        if s["inn"] == 4:
            need = -lead[i] + 1
            if need <= 0:
                continue
            c = hist4[(int(need // 25), int(wih[i]), int(ol[i] // 30))]
            c[o] += 1
            if len(c[3]) < 2:
                c[3].append([s["match_id"], str(s["date"]), s["bat_team"], s["bowl_team"], "WDL"[o]])
        else:
            c = hist[(s["inn"], int(lead[i] // 50), int(wih[i]), int(ol[i] // 45))]
            c[o] += 1
    rd = lambda v: [v[0]] + [round(x, 4) for x in v[1:]]
    w.write(f"predict/{fk}.json", {
        "kind": "multi", "fmt": fmt, "gender": gender, "cap": cap, "features": FEATURES, "models": models, "calib": calib,
        "cells": {k: rd(v) for k, v in cells.items()}, "era": era, "team_bat": team_bat, "team_bowl": team_bowl,
        "venues": {k: v + [venue_names.get(k, (k, None))[0], venue_names.get(k, (k, None))[1]] for k, v in venues.items()},
        "hist4": [[*k, *v[:3], v[3]] for k, v in hist4.items()], "hist": [[*k, *v] for k, v in hist.items()],
        "states": len(states), "matches": len({s["match_id"] for s in states}), "data_to": str(maxd),
    })
    return {"fk": fk, "states": len(states), "calib": calib}


def export_predict(con, w, names=None):
    venue_names = {x["venue_key"]: (x["venue"], x["city"]) for x in _rows(con, "select venue_key, any_value(venue) venue, any_value(city) city from matches group by 1")}
    report = []
    for mfam in LIMITED:
        for gender in ("male", "female"):
            n = con.execute(f"select count(*) from BXE where mfam = '{mfam}' and gender = '{gender}'").fetchone()[0]
            if n > 20000:
                report.append(_limited(con, w, mfam, gender, names, venue_names))
    for fmt, gender in (("TEST", "male"), ("TEST", "female"), ("FC", "male"), ("FC", "female")):
        res = _multiday(con, w, fmt, gender, venue_names)
        if res:
            report.append(res)
    # how wickets fall, by format and phase (start / middle / end of the innings), for the "next dismissal" market
    dism = {}
    for x in _rows(con, """select fam, gender, case when phase = 0 then 0 when phase = 1 then 1 else 2 end ph, coalesce(dcat, 'other') d, count(*) n
                         from BXE where n_wkts > 0 and inn <= 4 group by all"""):
        dism.setdefault(f"{x['fam']}-{x['gender']}", {}).setdefault(str(x["ph"]), {})[x["d"]] = x["n"]
    for fk, phs in dism.items():
        for ph, cnt in phs.items():
            tot = sum(cnt.values())
            phs[ph] = {k: round(v / tot, 4) for k, v in sorted(cnt.items(), key=lambda kv: -kv[1]) if v / tot >= 0.002}
    teams = {}
    for x in _rows(con, """select t, gender, count(*) n, max(date) last from (
                             select team1 t, gender, date from matches where team_type = 'international'
                             union all select team2, gender, date from matches where team_type = 'international') group by 1, 2"""):
        teams.setdefault(x["gender"], {})[x["t"]] = [x["n"], str(x["last"])]
    w.write("predict/index.json", {"keys": [r["fk"] for r in report], "dismissals": dism, "intl_teams": teams})
    return report

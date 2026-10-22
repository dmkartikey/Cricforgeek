"""Write the static JSON files the website reads."""
from __future__ import annotations

import datetime as dt
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np

from .prep import zones_config

FAMS = ("T20", "HUN", "ODI", "MD")
QB = {"T20": 500, "HUN": 300, "ODI": 1000, "MD": 2000}   # balls faced to qualify
QW = {"T20": 480, "HUN": 300, "ODI": 900, "MD": 2000}    # balls bowled to qualify
Z_CATS = ("bowled", "lbw", "keeper", "stumped", "cab", "field", "hitwicket")


def r(x, n=2):
    if x is None:
        return None
    if isinstance(x, float):
        if math.isnan(x) or math.isinf(x):
            return None
        return round(x, n)
    return x


def rows(con, sql, params=None):
    cur = con.execute(sql, params or [])
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, t)) for t in cur.fetchall()]


class Writer:
    def __init__(self, out: Path):
        self.out = out
        self.count = 0
        self.bytes = 0

    def write(self, rel: str, obj):
        p = self.out / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        s = json.dumps(obj, separators=(",", ":"), ensure_ascii=False, default=_default)
        p.write_text(s, encoding="utf-8")
        self.count += 1
        self.bytes += len(s)


def _default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return r(float(o), 3)
    if isinstance(o, (dt.date, dt.datetime)):
        return o.isoformat()
    try:
        from decimal import Decimal
        if isinstance(o, Decimal):
            return float(o)
    except Exception:
        pass
    raise TypeError(type(o))


# ---------------------------------------------------------------- stat blocks
BAT_SQL = """count(*) i, sum(runs) r, sum(balls) b, count(*) filter (where is_out) o,
  sum(f4) f4, sum(s6) s6, sum(dots) d, round(sum(xr),1) xr, round(sum(xo),2) xo,
  round(sum(imp),1) imp, round(sum(wpa),3) wpa,
  count(*) filter (where runs >= 50 and runs < 100) c50, count(*) filter (where runs >= 100) c100,
  max(runs) hs"""
BOWL_SQL = """count(*) i, sum(balls) b, sum(runs) r, sum(wkts) w, sum(dots) d, sum(f4) f4, sum(s6) s6,
  round(sum(xr),1) xr, round(sum(xw),2) xw, round(sum(imp),1) imp, round(sum(wpa),3) wpa,
  count(*) filter (where wkts >= 3 and wkts < 5) w3, count(*) filter (where wkts >= 5) w5,
  max(wkts*1000 - runs) best_code"""
BALL_BAT = """count(*) filter (where faced) b, sum(r_bat) r, count(*) filter (where striker_out) o,
  count(*) filter (where four) f4, count(*) filter (where six) s6,
  count(*) filter (where faced and r_bat = 0) d, round(sum(xbat_r) filter (where faced),1) xr,
  round(sum(xbat_out) filter (where faced),2) xo, round(sum(bat_val),1) imp, round(sum(bat_wpa),3) wpa"""
BALL_BOWL = """count(*) filter (where is_legal) b, sum(bowl_runs) r, count(*) filter (where bowler_wkt) w,
  count(*) filter (where is_legal and bowl_runs = 0) d, count(*) filter (where four) f4,
  count(*) filter (where six) s6, round(sum(xbowl_r),1) xr, round(sum(xbowl_w),2) xw,
  round(sum(bowl_val),1) imp, round(sum(bowl_wpa),3) wpa"""


def _clean(d: dict, drop=()):
    return {k: r(v, 3) for k, v in d.items() if k not in drop and v is not None}


def _best(code):
    """Decode wkts*1000 - runs back to 'w/r'."""
    if code is None:
        return None
    wk = -(-int(code) // 1000)
    return f"{wk}/{wk * 1000 - int(code)}"


# ---------------------------------------------------------------- metrics from sums
def bat_metrics(s):
    b, rr, o = s.get("b") or 0, s.get("r") or 0, s.get("o") or 0
    xr, xo = s.get("xr") or 0, s.get("xo") or 0
    return {
        "sr_plus": 100 * rr / xr if xr else None,
        "avg_plus": 100 * (rr / o) / (xr / xo) if o and xr and xo else None,
        "imp100": 100 * (s.get("imp") or 0) / b if b else None,
        "wpa100": 100 * (s.get("wpa") or 0) / b if b else None,
        "bnd": ((s.get("f4") or 0) + (s.get("s6") or 0)) / b if b else None,
        "dotp": (s.get("d") or 0) / b if b else None,
    }


def bowl_metrics(s):
    b, rr, w = s.get("b") or 0, s.get("r") or 0, s.get("w") or 0
    xr, xw = s.get("xr") or 0, s.get("xw") or 0
    return {
        "econ_plus": 100 * xr / rr if rr else None,
        "wkt_plus": 100 * w / xw if xw else None,
        "imp100": 100 * (s.get("imp") or 0) / b if b else None,
        "wpa100": 100 * (s.get("wpa") or 0) / b if b else None,
        "dotp": (s.get("d") or 0) / b if b else None,
    }


LOWER_BETTER = {("bat", "dotp")}


def percentiles(groups: dict[str, list[tuple[str, dict]]], kind: str):
    """groups: fam-gender -> [(player, metrics)] -> {player: {fam-gender: {metric: pct}}}"""
    out = defaultdict(dict)
    for g, items in groups.items():
        if len(items) < 10:
            continue
        keys = items[0][1].keys()
        res = {p: {} for p, _ in items}
        for k in keys:
            vals = np.array([m[k] if m[k] is not None else np.nan for _, m in items], dtype=float)
            ok = ~np.isnan(vals)
            if ok.sum() < 10:
                continue
            v = vals[ok]
            sv = np.sort(v)
            for (p, m), x in zip(items, vals):
                if np.isnan(x):
                    continue
                pct = np.searchsorted(sv, x, side="right") / len(sv)
                if (kind, k) in LOWER_BETTER:
                    pct = 1 - np.searchsorted(sv, x, side="left") / len(sv)
                res[p][k] = int(round(pct * 100))
        for p, d in res.items():
            out[p][g] = d
    return out


# ---------------------------------------------------------------- zones
def zone_profile(obs: dict, balls: int, base: dict, cfg: dict):
    """obs: cat -> count for this batter; base: cat -> rate per ball for peers."""
    cats = cfg["categories"]
    out_cats = {}
    for c in Z_CATS:
        o = obs.get(c, 0)
        e = base.get(c, 0) * balls
        out_cats[c] = [o, r((o + 2) / (e + 2), 2), r(e, 1)]
    L, N = len(cfg["lengths"]), len(cfg["lines"])
    og = np.zeros((L, N))
    eg = np.zeros((L, N))
    for c in Z_CATS:
        w = np.outer(cats[c]["length"], cats[c]["line"]) * cats[c]["confidence"]
        og += obs.get(c, 0) * w
        eg += base.get(c, 0) * balls * w
    idx = (og + 1) / (eg + 1)
    share = og / og.sum() if og.sum() else og
    evidence = float(sum(obs.get(c, 0) * cats[c]["confidence"] for c in Z_CATS))
    return {
        "balls": balls, "outs": int(sum(obs.get(c, 0) for c in Z_CATS)), "cats": out_cats,
        "grid": [[r(float(x), 2) for x in row] for row in idx],
        "share": [[r(float(x), 3) for x in row] for row in share],
        "conf": r(min(1.0, evidence / 25), 2),
    }


# ---------------------------------------------------------------- exporters
def export_all(con, out: Path, report: dict):
    out.mkdir(parents=True, exist_ok=True)
    w = Writer(out)
    cfg = zones_config()
    max_date = con.execute("select max(date) from matches").fetchone()[0]
    cut365 = (dt.date.fromisoformat(max_date) - dt.timedelta(days=365)).isoformat()

    comps = rows(con, """
      select comp key, any_value(comp_label) label, any_value(country) country, any_value(tier) tier,
             any_value("group") grp, any_value(gender) gender, any_value(family) fam, count(*) matches,
             min(date) "from", max(date) "to", count(distinct season) seasons,
             count(*) filter (where match_id in (select distinct match_id from balls)) ball_by_ball
      from matches group by comp order by matches desc""")
    comp_label = {c["key"]: c["label"] for c in comps}
    names = {p: (n, u) for p, n, u in con.execute("select player, name, unique_name from P").fetchall()}

    _export_players(con, w, cfg, comp_label, names)
    _export_teams(con, w, comp_label, names)
    _export_comps(con, w, comps, names)
    _export_matches(con, w, comp_label, names)
    home = _export_home(con, w, cfg, cut365, max_date, names, comp_label)
    _export_explorer(con, w)
    _export_search(con, w, comps)

    meta = {
        "built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
        "data_to": max_date, "comps": comps,
        "counts": rows(con, "select count(*) matches, (select count(*) from balls) balls, "
                            "(select count(*) from P) players from matches")[0],
        "style_coverage": r(con.execute("select count(*) filter (where bgrp is not null)/count(*) from BXE").fetchone()[0], 3),
        "zones": {k: v for k, v in cfg.items() if not k.startswith("_")},
        "zones_about": cfg["_about"],
        "models": report,
    }
    w.write("meta.json", meta)
    return {"files": w.count, "mb": round(w.bytes / 1e6, 1), "home_boards": len(home["boards"])}


def _export_players(con, w, cfg, comp_label, names):
    prof = defaultdict(lambda: {"comps": [], "summary": {}, "seasons": defaultdict(list), "splits": {},
                                "zones": {}, "matchups": {}, "recent": {}, "pct": {}, "entry": {}})
    # styles + teams
    for p in rows(con, "select player, bat_style, bowl_style, bgrp, btype from P"):
        d = prof[p["player"]]
        d.update({"bat": p["bat_style"], "bowl": p["bowl_style"], "bgrp": p["bgrp"], "btype": p["btype"]})
    for t in rows(con, """select a.player, a.team, m.gender, min(m.date) f, max(m.date) t, count(*) n
                          from appearances a join matches m using (match_id) group by all order by n desc"""):
        prof[t["player"]].setdefault("teams", []).append([t["team"], t["gender"], t["f"][:4], t["t"][:4], t["n"]])

    # per competition and per family totals
    for kind, tab, sql in (("bat", "BI", BAT_SQL), ("bowl", "BW", BOWL_SQL)):
        for x in rows(con, f"select player, comp, fam, gender, {sql} from {tab} group by all"):
            d = prof[x["player"]]
            ent = next((c for c in d["comps"] if c["comp"] == x["comp"]), None)
            if not ent:
                ent = {"comp": x["comp"], "label": comp_label.get(x["comp"]), "fam": x["fam"], "g": x["gender"]}
                d["comps"].append(ent)
            blk = _clean(x, ("player", "comp", "fam", "gender", "best_code"))
            if kind == "bowl":
                blk["best"] = _best(x["best_code"])
            ent[kind] = blk
        for x in rows(con, f"select player, fam, gender, {sql} from {tab} group by all"):
            blk = _clean(x, ("player", "fam", "gender", "best_code"))
            if kind == "bowl":
                blk["best"] = _best(x["best_code"])
            prof[x["player"]]["summary"].setdefault(f"{x['fam']}-{x['gender']}", {})[kind] = blk

    # seasons per competition (compact arrays)
    for x in rows(con, """
      with a as (select player, comp, season, sum(runs) r, sum(balls) b, count(*) filter (where is_out) o,
                        round(sum(imp),1) imp, round(sum(wpa),2) wpa from BI group by all),
           c as (select player, comp, season, sum(wkts) w, sum(balls) b, sum(runs) r, round(sum(imp),1) imp,
                        round(sum(wpa),2) wpa from BW group by all)
      select coalesce(a.player, c.player) player, coalesce(a.comp, c.comp) comp, coalesce(a.season, c.season) season,
             a.r, a.b, a.o, a.imp, a.wpa, c.w, c.b bb, c.r br, c.imp bimp, c.wpa bwpa
      from a full outer join c on a.player = c.player and a.comp = c.comp and a.season = c.season
      order by season"""):
        prof[x["player"]]["seasons"][x["comp"]].append(
            [x["season"], x["r"], x["b"], x["o"], x["imp"], x["wpa"], x["w"], x["bb"], x["br"], x["bimp"], x["bwpa"]])

    # splits per family (batting)
    bat_dims = {
        "phase": "phase::varchar", "vs": "coalesce(bgrp, 'unknown')", "type": "coalesce(btype, 'unknown')",
        "inn": "inn_grp::varchar", "lev": "lev", "year": "year::varchar",
    }
    for dim, expr in bat_dims.items():
        for x in rows(con, f"""select batter player, fam, gender, {expr} k, {BALL_BAT}
                              from BXE where batter is not null {"and lev is not null" if dim == "lev" else ""}
                              group by all having count(*) filter (where faced) > 0"""):
            sp = prof[x["player"]]["splits"].setdefault(f"{x['fam']}-{x['gender']}", {"bat": {}, "bowl": {}})
            sp["bat"].setdefault(dim, []).append([x["k"]] + [r(x[c], 3) for c in ("b", "r", "o", "f4", "s6", "d", "xr", "xo", "imp", "wpa")])
    bowl_dims = {"phase": "phase::varchar", "hand": "coalesce(bat_hand, 'unknown')", "inn": "inn_grp::varchar",
                 "lev": "lev", "year": "year::varchar"}
    for dim, expr in bowl_dims.items():
        for x in rows(con, f"""select bowler player, fam, gender, {expr} k, {BALL_BOWL}
                              from BXE {"where lev is not null" if dim == "lev" else ""} group by all"""):
            sp = prof[x["player"]]["splits"].setdefault(f"{x['fam']}-{x['gender']}", {"bat": {}, "bowl": {}})
            sp["bowl"].setdefault(dim, []).append([x["k"]] + [r(x[c], 3) for c in ("b", "r", "w", "d", "f4", "s6", "xr", "xw", "imp", "wpa")])
    # batting position and opponents / venues from innings tables
    for x in rows(con, f"""select player, fam, gender, least(pos, 9)::varchar k, {BAT_SQL} from BI group by all"""):
        sp = prof[x["player"]]["splits"].setdefault(f"{x['fam']}-{x['gender']}", {"bat": {}, "bowl": {}})
        sp["bat"].setdefault("pos", []).append([x["k"], x["i"], x["r"], x["b"], x["o"], x["xr"], x["xo"], x["imp"]])
    for kind, tab, sql in (("bat", "BI", "sum(runs) r, sum(balls) b, count(*) filter (where is_out) o, round(sum(imp),1) imp"),
                           ("bowl", "BW", "sum(wkts) w, sum(balls) b, sum(runs) r, round(sum(imp),1) imp")):
        for dim, col in (("opp", "opp"), ("venue", "venue_key")):
            for x in rows(con, f"""select * from (
                  select player, fam, gender, {col} k, count(*) i, {sql},
                         row_number() over (partition by player, fam, gender order by sum(balls) desc) rn
                  from {tab} group by player, fam, gender, {col}) where rn <= 12"""):
                sp = prof[x["player"]]["splits"].setdefault(f"{x['fam']}-{x['gender']}", {"bat": {}, "bowl": {}})
                vals = [x["k"], x["i"]] + [x[c] for c in (("r", "b", "o", "imp") if kind == "bat" else ("w", "b", "r", "imp"))]
                sp[kind].setdefault(dim, []).append(vals)

    # entry points
    for x in rows(con, """select player, fam, gender, round(avg(e_balls)/6,1) over_in, round(avg(e_wkts),2) wk_in,
                                 round(avg(e_score),1) score_in, count(*) n
                          from BI where e_balls is not null group by all"""):
        prof[x["player"]]["entry"][f"{x['fam']}-{x['gender']}"] = _clean(x, ("player", "fam", "gender"))

    # matchups
    for kind, me, them, sql in (("bat", "batter", "bowler", BALL_BAT), ("bowl", "bowler", "batter", BALL_BAT)):
        lim = 15
        for x in rows(con, f"""select * from (
              select {me} player, {them} opp, fam, gender, {sql},
                     row_number() over (partition by {me}, fam, gender order by count(*) filter (where faced) desc) rn
              from BXE group by {me}, {them}, fam, gender) where rn <= {lim} and b >= 6"""):
            mu = prof[x["player"]]["matchups"].setdefault(f"{x['fam']}-{x['gender']}", {"bat": [], "bowl": []})
            mu[kind].append([x["opp"], names.get(x["opp"], (x["opp"],))[0]] +
                            [r(x[c], 2) for c in ("b", "r", "o", "d", "f4", "s6", "xr", "imp")])

    # zones (batting): vs all, pace, spin
    base = defaultdict(dict)
    for x in rows(con, """select fam, gender, case when grouping(btype) = 1 then 'all' else coalesce(btype, 'unknown') end t, dcat, count(*) n from BXE
                          where striker_out and dcat in ('bowled','lbw','keeper','stumped','cab','field','hitwicket')
                          group by grouping sets ((fam, gender, dcat), (fam, gender, btype, dcat))"""):
        base[(x["fam"], x["gender"], x["t"])][x["dcat"]] = x["n"]
    balls_base = {(x["fam"], x["gender"], x["t"]): x["b"] for x in rows(con, """
        select fam, gender, case when grouping(btype) = 1 then 'all' else coalesce(btype, 'unknown') end t, count(*) filter (where faced) b from BXE
        group by grouping sets ((fam, gender), (fam, gender, btype))""")}
    rate = {k: {c: n / balls_base[k] for c, n in v.items()} for k, v in base.items() if balls_base.get(k)}
    obs = defaultdict(lambda: defaultdict(dict))
    bf = defaultdict(dict)
    for x in rows(con, """select batter, fam, gender, case when grouping(btype) = 1 then 'all' else coalesce(btype, 'unknown') end t, dcat, count(*) n from BXE
                          where striker_out and dcat is not null group by grouping sets ((batter, fam, gender, dcat), (batter, fam, gender, btype, dcat))"""):
        obs[x["batter"]][(x["fam"], x["gender"], x["t"])][x["dcat"]] = x["n"]
    for x in rows(con, """select batter, fam, gender, case when grouping(btype) = 1 then 'all' else coalesce(btype, 'unknown') end t, count(*) filter (where faced) b from BXE
                          group by grouping sets ((batter, fam, gender), (batter, fam, gender, btype))"""):
        if x["b"] >= 60:
            bf[x["batter"]][(x["fam"], x["gender"], x["t"])] = x["b"]
    for p, keys in bf.items():
        for (fam, g, t), b in keys.items():
            if t == "unknown" or (fam, g, t) not in rate:
                continue
            z = zone_profile(obs[p].get((fam, g, t), {}), b, rate[(fam, g, t)], cfg)
            prof[p]["zones"].setdefault(f"{fam}-{g}", {})[t] = z

    # recent innings
    for x in rows(con, """select * from (select BI.*, row_number() over (partition by player order by date desc, match_id desc) rn
                          from BI) where rn <= 25 order by date"""):
        prof[x["player"]]["recent"].setdefault("bat", []).append(
            [x["date"], x["comp"], x["opp"], x["runs"], x["balls"], x["is_out"], r(x["imp"], 1), r(x["wpa"], 3), x["match_id"], x["pos"]])
    for x in rows(con, """select * from (select BW.*, row_number() over (partition by player order by date desc, match_id desc) rn
                          from BW) where rn <= 25 order by date"""):
        prof[x["player"]]["recent"].setdefault("bowl", []).append(
            [x["date"], x["comp"], x["opp"], x["balls"], x["runs"], x["wkts"], r(x["imp"], 1), r(x["wpa"], 3), x["match_id"]])

    # percentiles within format & gender among qualified players
    gb, gw = defaultdict(list), defaultdict(list)
    for p, d in prof.items():
        for k, s in d["summary"].items():
            fam = k.split("-")[0]
            if s.get("bat", {}).get("b", 0) >= QB[fam]:
                gb[k].append((p, bat_metrics(s["bat"])))
            if s.get("bowl", {}).get("b", 0) >= QW[fam]:
                gw[k].append((p, bowl_metrics(s["bowl"])))
    pb, pw = percentiles(gb, "bat"), percentiles(gw, "bowl")
    for p, d in prof.items():
        for k in set(pb.get(p, {})) | set(pw.get(p, {})):
            d["pct"][k] = {"bat": pb.get(p, {}).get(k), "bowl": pw.get(p, {}).get(k),
                           "n_bat": len(gb.get(k, [])), "n_bowl": len(gw.get(k, []))}

    for p, d in prof.items():
        if p.startswith("~") or p not in names:
            continue
        n, u = names[p]
        d["id"], d["name"], d["full"] = p, n, u
        d["seasons"] = dict(d["seasons"])
        w.write(f"players/{p}.json", d)


def _innings_totals(con):
    con.execute("""
    create or replace table IT as
    select match_id, inn, any_value(bat_team) bat, any_value(bowl_team) bowl, any_value(fam) fam,
           any_value(gender) gender, any_value(comp) comp, any_value(season) season,
           sum(r_tot) runs, sum(n_wkts) wkts, count(*) filter (where is_legal) balls,
           any_value(inn_balls) quota
    from BXE group by all
    """)


def _export_teams(con, w, comp_label, names):
    _innings_totals(con)
    teams = defaultdict(lambda: {"comps": [], "seasons": [], "phase": {}, "top_bat": {}, "top_bowl": {},
                                 "recent": [], "h2h": [], "fams": {}})
    tm = """with t as (
      select team1_key key, team1 team, team2 opp, * exclude (team1, team2) from matches
      union all select team2_key, team2, team1, * exclude (team1, team2) from matches)"""
    for x in rows(con, tm + """
      select key, any_value(team) team, any_value(gender) gender, comp, count(*) p,
        count(*) filter (where winner = team) w, count(*) filter (where winner is not null and winner <> team and result = 'win') l,
        count(*) filter (where result = 'tie') t, count(*) filter (where result in ('no result','draw')) nr,
        min(date) f, max(date) l_date
      from t group by key, comp order by p desc"""):
        d = teams[x["key"]]
        d["key"], d["name"], d["gender"] = x["key"], x["team"], x["gender"]
        d["comps"].append([x["comp"], comp_label.get(x["comp"]), x["p"], x["w"], x["l"], x["t"], x["nr"], x["f"], x["l_date"]])
    for x in rows(con, tm + """, it as (select * from IT)
      select t.key, t.comp, t.season, count(distinct t.match_id) p,
        count(distinct t.match_id) filter (where t.winner = t.team) w,
        count(distinct t.match_id) filter (where t.result = 'win' and t.winner <> t.team) l
      from t group by all order by t.season"""):
        teams[x["key"]]["seasons"].append([x["comp"], x["season"], x["p"], x["w"], x["l"]])
    # batting first vs chasing, toss
    for x in rows(con, tm + """, first as (select match_id, bat from IT where inn = 1)
      select key, family fam,
        count(*) filter (where f.bat = team and result in ('win','tie')) bf_p,
        count(*) filter (where f.bat = team and winner = team) bf_w,
        count(*) filter (where f.bat <> team and result in ('win','tie')) ch_p,
        count(*) filter (where f.bat <> team and winner = team) ch_w,
        count(*) filter (where toss_winner = team) toss_w,
        count(*) filter (where toss_winner = team and winner = team) toss_won_match,
        count(*) filter (where toss_winner = team and toss_decision = 'bat') toss_bat,
        count(*) p, count(*) filter (where winner = team) w
      from t left join first f using (match_id) group by all"""):
        teams[x["key"]]["fams"][x["fam"]] = _clean(x, ("key", "fam"))
    # phase run rates batting / bowling vs competition
    for x in rows(con, """
      with b as (select bat_team team, gender, fam, phase, sum(r_tot) r, count(*) filter (where is_legal) bl,
                        sum(n_wkts) wk from BXE group by all),
           o as (select bowl_team team, gender, fam, phase, sum(r_tot) r, count(*) filter (where is_legal) bl,
                        sum(n_wkts) wk from BXE group by all)
      select b.team, b.gender, b.fam, b.phase, b.r, b.bl, b.wk, o.r cr, o.bl cbl, o.wk cwk
      from b join o using (team, gender, fam, phase)"""):
        key = _tkey(x["team"], x["gender"])
        if key in teams:
            teams[key]["phase"].setdefault(x["fam"], []).append([x["phase"], x["r"], x["bl"], x["wk"], x["cr"], x["cbl"], x["cwk"]])
    for kind, tab, sql in (("top_bat", "BI", "sum(runs) r, sum(balls) b, round(sum(imp),1) imp, count(*) i"),
                           ("top_bowl", "BW", "sum(wkts) w, sum(balls) b, round(sum(imp),1) imp, count(*) i")):
        for x in rows(con, f"""select * from (select team, gender, fam, player, {sql},
                                 row_number() over (partition by team, gender, fam order by sum(imp) desc) rn
                               from {tab} group by team, gender, fam, player) where rn <= 10"""):
            key = _tkey(x["team"], x["gender"])
            if key in teams:
                vals = [x["player"], names.get(x["player"], (x["player"],))[0]] + \
                       [x[c] for c in (("r", "b", "imp", "i") if kind == "top_bat" else ("w", "b", "imp", "i"))]
                teams[key][kind].setdefault(x["fam"], []).append(vals)
    for x in rows(con, tm + """
      select * from (select key, date, comp, opp, winner, result, by_runs, by_wkts, method, match_id, team,
        row_number() over (partition by key order by date desc) rn from t) where rn <= 40 order by date desc"""):
        res = "W" if x["winner"] == x["team"] else ("L" if x["result"] == "win" else
                                                   {"tie": "T", "draw": "D"}.get(x["result"], "NR"))
        margin = f"{x['by_runs']} runs" if x["by_runs"] else (f"{x['by_wkts']} wkts" if x["by_wkts"] else "")
        teams[x["key"]]["recent"].append([x["date"], x["comp"], x["opp"], res, margin, x["match_id"]])
    for x in rows(con, tm + """
      select key, opp, count(*) p, count(*) filter (where winner = team) w,
             count(*) filter (where result = 'win' and winner <> team) l
      from t group by all having count(*) >= 2 order by p desc"""):
        teams[x["key"]]["h2h"].append([x["opp"], x["p"], x["w"], x["l"]])
    for k, d in teams.items():
        w.write(f"teams/{k}.json", d)


def _tkey(team, gender):
    from .competitions import slug
    return slug(team) + ("-women" if gender == "female" else "")


def _export_comps(con, w, comps, names):
    w.write("comps/index.json", comps)
    trends = defaultdict(list)
    for x in rows(con, """
      with s as (select comp, season, count(distinct match_id) m, sum(r_tot) r, count(*) filter (where is_legal) b,
                   sum(n_wkts) wk, count(*) filter (where six) s6, count(*) filter (where four) f4,
                   sum(r_tot) filter (where phase=0) r0, count(*) filter (where is_legal and phase=0) b0,
                   sum(r_tot) filter (where phase=1) r1, count(*) filter (where is_legal and phase=1) b1,
                   sum(r_tot) filter (where phase=2) r2, count(*) filter (where is_legal and phase=2) b2,
                   count(*) filter (where faced and r_bat = 0) dots, count(*) filter (where faced) faced
                 from BXE group by all),
           f as (select comp, season, avg(runs) filter (where inn = 1) avg1 from IT group by all),
           c as (select m.comp, m.season, count(*) filter (where i.bat = m.winner and i.inn = 2) cw,
                        count(*) filter (where m.result = 'win' and i.inn = 2) dec
                 from matches m join IT i using (match_id) where m.family <> 'MD' group by all)
      select s.*, f.avg1, c.cw, c.dec from s left join f using (comp, season) left join c using (comp, season)
      order by season"""):
        trends[x["comp"]].append({k: r(v, 2) for k, v in x.items() if k != "comp"})
    # leaders per comp and season (and all-time)
    leaders = defaultdict(lambda: defaultdict(dict))
    for kind, tab, metric, sql in (
        ("bat_runs", "BI", "sum(runs)", "sum(runs) r, sum(balls) b, round(sum(imp),1) imp"),
        ("bat_imp", "BI", "sum(imp)", "sum(runs) r, sum(balls) b, round(sum(imp),1) imp"),
        ("bat_wpa", "BI", "sum(wpa)", "sum(runs) r, sum(balls) b, round(sum(wpa),2) wpa"),
        ("bowl_wkts", "BW", "sum(wkts)", "sum(wkts) w, sum(balls) b, sum(runs) r"),
        ("bowl_imp", "BW", "sum(imp)", "sum(wkts) w, sum(balls) b, round(sum(imp),1) imp"),
        ("bowl_wpa", "BW", "sum(wpa)", "sum(wkts) w, sum(balls) b, round(sum(wpa),2) wpa"),
    ):
        for x in rows(con, f"""select * from (
              select comp, coalesce(season, 'all') season, player, {sql}, {metric} v,
                     row_number() over (partition by comp, coalesce(season,'all') order by {metric} desc) rn
              from {tab} group by grouping sets ((comp, season, player), (comp, player))) where rn <= 10"""):
            vals = {k: r(v, 2) for k, v in x.items() if k not in ("comp", "season", "player", "rn", "v")}
            leaders[x["comp"]][x["season"]].setdefault(kind, []).append(
                [x["player"], names.get(x["player"], (x["player"],))[0], vals])
    # standings per season with net run rate
    stand = defaultdict(lambda: defaultdict(list))
    for x in rows(con, """
      with t as (select match_id, bat team, runs, case when wkts >= 10 then quota else balls end bl from IT
                 where fam <> 'MD'),
           c as (select match_id, bowl team, runs, case when wkts >= 10 then quota else balls end bl from IT where fam <> 'MD'),
           tm as (select match_id, comp, season, winner, result, unnest([team1, team2]) team from matches)
      select tm.comp, tm.season, tm.team,
        count(*) p, count(*) filter (where tm.winner = tm.team) w,
        count(*) filter (where tm.result = 'win' and tm.winner <> tm.team) l,
        count(*) filter (where tm.result <> 'win') nr,
        sum(s.runs) rf, sum(s.bl) bf, sum(cc.runs) ra, sum(cc.bl) ba
      from tm
      left join t s on s.match_id = tm.match_id and s.team = tm.team
      left join c cc on cc.match_id = tm.match_id and cc.team = tm.team
      group by all"""):
        nrr = None
        if x["bf"] and x["ba"]:
            nrr = 6 * x["rf"] / x["bf"] - 6 * x["ra"] / x["ba"]
        stand[x["comp"]][x["season"]].append([x["team"], x["p"], x["w"], x["l"], x["nr"], r(nrr, 3)])
    venues = defaultdict(list)
    for x in rows(con, """
      select m.comp, m.venue, any_value(m.city) city, count(*) n,
        avg(i1.runs) avg1,
        count(*) filter (where m.result = 'win' and m.winner = i2.bat) chase_w,
        count(*) filter (where m.result = 'win') dec
      from matches m
      left join IT i1 on i1.match_id = m.match_id and i1.inn = 1
      left join IT i2 on i2.match_id = m.match_id and i2.inn = 2
      group by m.comp, m.venue having count(*) >= 3
      order by n desc"""):
        venues[x["comp"]].append([x["venue"], x["city"], x["n"], r(x["avg1"], 1), x["chase_w"], x["dec"]])
    pace = {(x["comp"], x["venue"]): x["ps"] for x in rows(con, """
      select comp, m.venue, count(*) filter (where btype='pace' and bowler_wkt) / greatest(count(*) filter (where btype is not null and bowler_wkt),1) ps
      from BXE join matches m using (match_id, comp) group by all""")}
    records = defaultdict(dict)
    for name, sql in (
        ("high_totals", "select comp, match_id, inn, bat, bowl, runs, wkts, balls, season from IT qualify row_number() over (partition by comp order by runs desc) <= 10"),
        ("low_totals", "select comp, match_id, inn, bat, bowl, runs, wkts, balls, season from IT where wkts >= 10 qualify row_number() over (partition by comp order by runs) <= 10"),
        ("high_scores", "select comp, match_id, player, team, opp, runs, balls, is_out, season from BI qualify row_number() over (partition by comp order by runs desc, balls) <= 10"),
        ("best_bowling", "select comp, match_id, player, team, opp, wkts, runs, balls, season from BW qualify row_number() over (partition by comp order by wkts desc, runs) <= 10"),
        ("top_impact_inns", "select comp, match_id, player, team, opp, runs, balls, round(imp,1) imp, season from BI qualify row_number() over (partition by comp order by imp desc) <= 10"),
    ):
        for x in rows(con, sql):
            if "player" in x:
                x["name"] = names.get(x["player"], (x["player"],))[0]
            records[x["comp"]].setdefault(name, []).append({k: r(v, 2) for k, v in x.items() if k != "comp"})
    mlist = defaultdict(list)
    for x in rows(con, "select comp, match_id, date, season, team1, team2, winner, result, by_runs, by_wkts, venue from matches order by date desc"):
        mlist[x["comp"]].append([x["match_id"], x["date"], x["season"], x["team1"], x["team2"], x["winner"], x["result"],
                                 x["by_runs"], x["by_wkts"], x["venue"]])
    for c in comps:
        k = c["key"]
        vs = [v + [r(pace.get((k, v[0])), 3)] for v in venues.get(k, [])]
        w.write(f"comps/{k}.json", {"meta": c, "trends": trends.get(k, []), "leaders": leaders.get(k, {}),
                                    "standings": stand.get(k, {}), "venues": vs, "records": records.get(k, {}),
                                    "matches": mlist.get(k, [])})


def _export_matches(con, w, comp_label, names):
    info = {x["match_id"]: x for x in rows(con, "select * from matches")}
    overs = defaultdict(list)
    for x in rows(con, """select match_id, inn, over, any_value(bat_team) team, sum(r_tot) r, sum(n_wkts) wk,
                                 max(score_before + r_tot) score, arg_max(wp_after, seq) wp
                          from BXE group by all order by match_id, inn, over"""):
        overs[x["match_id"]].append([x["inn"], x["over"], x["r"], x["wk"], x["score"], r(x["wp"], 3)])
    bat = defaultdict(list)
    for x in rows(con, "select * from BI order by match_id, inn, pos"):
        bat[x["match_id"]].append([x["inn"], x["player"], x["runs"], x["balls"], x["f4"], x["s6"], x["kind"],
                                   x["by_bowler"], r(x["imp"], 1), r(x["wpa"], 3), x["team"]])
    bowl = defaultdict(list)
    for x in rows(con, "select BW.*, min_seq from BW join (select match_id, inn, bowler player, min(seq) min_seq from BX group by all) s using (match_id, inn, player) order by match_id, inn, min_seq"):
        bowl[x["match_id"]].append([x["inn"], x["player"], x["balls"], x["runs"], x["wkts"], x["dots"], x["wides"],
                                    x["noballs"], r(x["imp"], 1), r(x["wpa"], 3)])
    moments = defaultdict(list)
    for x in rows(con, """select * from (select match_id, inn, over, legal_no, batter, bowler, r_tot, wkt_kind, out_id,
                                 dwp, wp_before, row_number() over (partition by match_id order by abs(dwp) desc) rn
                          from BXE where dwp is not null) where rn <= 8 order by match_id, inn, over, legal_no"""):
        moments[x["match_id"]].append([x["inn"], x["over"], x["legal_no"], x["batter"], x["bowler"], x["r_tot"],
                                       x["wkt_kind"], x["out_id"], r(x["dwp"], 3), r(x["wp_before"], 3)])
    for mid, m in info.items():
        ids = {p for row in bat.get(mid, []) for p in (row[1], row[7]) if p} | {row[1] for row in bowl.get(mid, [])}
        ids |= {p for row in moments.get(mid, []) for p in (row[3], row[4]) if p}
        w.write(f"matches/{mid}.json", {
            "info": {k: v for k, v in m.items() if v is not None}, "comp_label": comp_label.get(m["comp"]),
            "overs": overs.get(mid, []), "bat": bat.get(mid, []), "bowl": bowl.get(mid, []),
            "moments": moments.get(mid, []),
            "names": {p: names.get(p, (p.lstrip("~"),))[0] for p in ids},
        })


SCOPES = [
    ("t20-men", "Men's T20 (all)", "fam = 'T20' and gender = 'male'", "T20"),
    ("t20i-men", "Men's T20Is", "comp = 'men-t20i'", "T20"),
    ("ipl", "IPL", "comp = 'ipl'", "T20"),
    ("odi-men", "Men's ODIs", "comp = 'men-odi'", "ODI"),
    ("test-men", "Men's Tests", "comp = 'men-test'", "MD"),
    ("fc-men", "First-class (domestic)", "fam = 'MD' and comp <> 'men-test' and gender = 'male'", "MD"),
    ("t20-women", "Women's T20 (all)", "fam = 'T20' and gender = 'female'", "T20"),
    ("odi-women", "Women's ODIs", "comp = 'women-odi'", "ODI"),
]


def _export_home(con, w, cfg, cut365, max_date, names, comp_label):
    boards = []

    def board(key, title, desc, scope, window, kind, sql_metric, order="desc", min_b=0, extra_where="", unit="", src="ball"):
        skey, slabel, swhere, fam = scope
        where = swhere + (f" and date >= '{cut365}'" if window == "365" else "") + (f" and {extra_where}" if extra_where else "")
        agg = BALL_BAT if kind == "bat" else BALL_BOWL
        who = "batter" if kind == "bat" else "bowler"
        res = rows(con, f"""select {who} player, {agg}, {sql_metric} v from BXE where {where} group by 1
                            having count(*) filter (where {'faced' if kind == 'bat' else 'is_legal'}) >= {min_b}
                            order by v {order} nulls last limit 15""")
        boards.append({"key": f"{key}:{skey}:{window}", "metric": key, "title": title, "desc": desc, "scope": skey,
                       "scope_label": slabel, "window": window, "kind": kind, "unit": unit, "min_balls": min_b,
                       "rows": [[x["player"], names.get(x["player"], (x["player"],))[0], r(x["v"], 3),
                                 {k: r(x[k], 2) for k in ("b", "r", "o", "w", "imp", "wpa", "xr") if k in x}] for x in res]})

    for scope in SCOPES:
        fam = scope[3]
        for window in ("365", "all"):
            mb = QB[fam] // (2 if window == "365" else 1)
            mw = QW[fam] // (2 if window == "365" else 1)
            board("bat_imp", "Batting impact", "Runs added above an average batter in the same situation, counting the run cost of getting out.",
                  scope, window, "bat", "sum(bat_val)", unit="runs")
            board("bat_srplus", "SR+", "Strike rate compared with what an average batter scores in the same over, wickets and era. 100 = average.",
                  scope, window, "bat", "100*sum(r_bat)/nullif(sum(xbat_r) filter (where faced),0)", min_b=mb)
            board("bat_avgplus", "Average+", "Runs per dismissal compared with expected for the same situations. 100 = average.",
                  scope, window, "bat", "100*((sum(r_bat) + 3*sum(xbat_r) filter (where faced)/nullif(sum(xbat_out) filter (where faced),0))/(count(*) filter (where striker_out) + 3))/nullif(sum(xbat_r) filter (where faced)/nullif(sum(xbat_out) filter (where faced),0),0)", min_b=mb)
            board("bowl_imp", "Bowling impact", "Runs saved against an average bowler in the same situation, plus the run value of wickets taken.",
                  scope, window, "bowl", "sum(bowl_val)", unit="runs")
            board("bowl_econplus", "Economy+", "Expected runs conceded divided by actual. 100 = average, higher is tighter.",
                  scope, window, "bowl", "100*sum(xbowl_r)/nullif(sum(bowl_runs),0)", min_b=mw)
            if fam != "MD":
                board("bat_wpa", "Win probability added (bat)", "Total swing in the team's chance of winning credited to the batter's balls.",
                      scope, window, "bat", "sum(bat_wpa)", unit="wins")
                board("bowl_wpa", "Win probability added (bowl)", "Total swing in win chance credited to the bowler.",
                      scope, window, "bowl", "sum(bowl_wpa)", unit="wins")
                board("clutch", "Clutch impact", "Batting impact on high-leverage balls only (where the result was most on the line).",
                      scope, window, "bat", "sum(bat_val)", extra_where="lev = 'high'", unit="runs")
                board("death_srplus", "Death-overs SR+", "SR+ in the final phase of the innings.",
                      scope, window, "bat", "100*sum(r_bat)/nullif(sum(xbat_r) filter (where faced),0)", min_b=mb // 4, extra_where="phase = 2")
                board("pp_econplus", "Powerplay Economy+", "Economy+ in the first phase.",
                      scope, window, "bowl", "100*sum(xbowl_r)/nullif(sum(bowl_runs),0)", min_b=mw // 4, extra_where="phase = 0")
                board("death_econplus", "Death-overs Economy+", "Economy+ at the death.",
                      scope, window, "bowl", "100*sum(xbowl_r)/nullif(sum(bowl_runs),0)", min_b=mw // 4, extra_where="phase = 2")
            board("spin_srplus", "SR+ vs spin", "Scoring against spin compared with expected.",
                  scope, window, "bat", "100*sum(r_bat)/nullif(sum(xbat_r) filter (where faced),0)", min_b=mb // 3, extra_where="btype = 'spin'")
            board("pace_srplus", "SR+ vs pace", "Scoring against pace compared with expected.",
                  scope, window, "bat", "100*sum(r_bat)/nullif(sum(xbat_r) filter (where faced),0)", min_b=mb // 3, extra_where="btype = 'pace'")
            board("full_straight", "Most vulnerable: full & straight", "Bowled + LBW dismissals per 1,000 balls faced. Inferred from how they get out, not ball-tracking.",
                  scope, window, "bat", "1000.0*count(*) filter (where dcat in ('bowled','lbw'))/nullif(count(*) filter (where faced),0)", min_b=mb)
            board("corridor", "Most vulnerable: the corridor", "Caught behind per 1,000 balls faced (edges to the keeper). Inferred.",
                  scope, window, "bat", "1000.0*count(*) filter (where dcat = 'keeper')/nullif(count(*) filter (where faced),0)", min_b=mb)
            board("hardest_out", "Hardest to dismiss", "Balls per dismissal compared with expected. 100 = average.",
                  scope, window, "bat", "100*(sum(xbat_out) filter (where faced) + 3)/(count(*) filter (where striker_out) + 3)", min_b=mb)

    # biggest moments in the last year
    moments = rows(con, f"""select match_id, comp, date, inn, over, legal_no, batter, bowler, r_tot, wkt_kind, dwp, wp_before,
                                   bat_team, bowl_team
                            from BXE where dwp is not null and date >= '{cut365}' order by abs(dwp) desc limit 20""")
    for m in moments:
        m["batter_name"] = names.get(m["batter"], (m["batter"],))[0]
        m["bowler_name"] = names.get(m["bowler"], (m["bowler"],))[0]
        m["comp_label"] = comp_label.get(m["comp"])
    # scoring trend per big league
    trend = rows(con, """select comp, year, round(6.0*sum(r_tot)/count(*) filter (where is_legal), 3) rpo,
                                round(count(*) filter (where six)*1.0/count(distinct match_id), 2) six_pm
                         from BXE where comp in ('ipl','bbl','psl','t20-blast','cpl','men-t20i','sa20','hundred-men')
                         group by all order by comp, year""")
    chase = rows(con, """select m.comp, count(*) filter (where i.bat = m.winner) * 1.0 / count(*) chase_win, count(*) n
                         from matches m join IT i on i.match_id = m.match_id and i.inn = 2
                         where m.result = 'win' and m.family <> 'MD' group by 1 having count(*) >= 80 order by chase_win desc""")
    home = {"boards": boards, "moments": moments, "trend": trend, "chase": chase, "cut365": cut365, "data_to": max_date,
            "scopes": [[s[0], s[1], s[3]] for s in SCOPES]}
    w.write("home.json", home)
    return home


def _export_explorer(con, w):
    for fam in FAMS:
        for gender in ("male", "female"):
            res = con.execute("""
              with a as (select player, comp, season, count(*) i, sum(runs) r, sum(balls) b, count(*) filter (where is_out) o,
                                sum(f4) f4, sum(s6) s6, sum(dots) d, round(sum(xr),1) xr, round(sum(xo),2) xo,
                                round(sum(imp),1) imp, round(sum(wpa),3) wpa
                         from BI where fam = ? and gender = ? group by all),
                   c as (select player, comp, season, count(*) i, sum(balls) b, sum(runs) r, sum(wkts) w, sum(dots) d,
                                round(sum(xr),1) xr, round(sum(xw),2) xw, round(sum(imp),1) imp, round(sum(wpa),3) wpa
                         from BW where fam = ? and gender = ? group by all)
              select coalesce(a.player, c.player), coalesce(a.comp, c.comp), coalesce(a.season, c.season),
                     a.i, a.r, a.b, a.o, a.f4, a.s6, a.d, a.xr, a.xo, a.imp, a.wpa,
                     c.i, c.b, c.r, c.w, c.d, c.xr, c.xw, c.imp, c.wpa
              from a full outer join c on a.player = c.player and a.comp = c.comp and a.season = c.season
            """, [fam, gender, fam, gender]).fetchall()
            if not res:
                continue
            w.write(f"explorer/{fam}-{gender}.json", {
                "cols": ["player", "comp", "season", "bi", "br", "bb", "bo", "f4", "s6", "bd", "bxr", "bxo", "bimp", "bwpa",
                         "wi", "wb", "wr", "ww", "wd", "wxr", "wxw", "wimp", "wwpa"],
                "rows": [[r(v, 3) for v in t] for t in res]})


def _export_search(con, w, comps):
    players = con.execute("""
      select a.player, p.name, p.unique_name, any_value(m.gender), mode(a.team), min(m.year), max(m.year), count(*) n,
             string_agg(distinct m.family, ',')
      from appearances a join matches m using (match_id) join P p on p.player = a.player
      group by a.player, p.name, p.unique_name order by n desc""").fetchall()
    teams = con.execute("""
      select key, team, gender, count(*) n from (
        select team1_key key, team1 team, gender from matches union all select team2_key, team2, gender from matches)
      group by all order by n desc""").fetchall()
    w.write("search.json", {"players": players, "teams": teams,
                            "comps": [[c["key"], c["label"], c["country"], c["matches"]] for c in comps]})

"""Write the static JSON files the website reads."""
from __future__ import annotations

import datetime as dt
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np

from .prep import zones_config

FAMS = ("TEST", "FC", "ODI", "LA", "T20", "HUN")
QB = {"T20": 500, "HUN": 300, "ODI": 1000, "LA": 1000, "TEST": 2000, "FC": 2000}   # balls faced to qualify
QW = {"T20": 480, "HUN": 300, "ODI": 900, "LA": 900, "TEST": 2000, "FC": 2000}    # balls bowled to qualify
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

ZONE_COLS = ["b", "z_bowled", "z_lbw", "z_keeper", "z_stumped", "z_cab", "z_field", "z_hitwicket", "z_dot", "z_r13", "z_four", "z_six", "z_runs"]
ZONE_VEC = """count(*) b,
  count(*) filter (where striker_out and dcat = 'bowled') z_bowled, count(*) filter (where striker_out and dcat = 'lbw') z_lbw,
  count(*) filter (where striker_out and dcat = 'keeper') z_keeper, count(*) filter (where striker_out and dcat = 'stumped') z_stumped,
  count(*) filter (where striker_out and dcat = 'cab') z_cab, count(*) filter (where striker_out and dcat = 'field') z_field,
  count(*) filter (where striker_out and dcat = 'hitwicket') z_hitwicket,
  count(*) filter (where r_bat = 0) z_dot, count(*) filter (where r_bat in (1, 2, 3, 5)) z_r13,
  count(*) filter (where r_bat = 4) z_four, count(*) filter (where r_bat = 6) z_six, sum(r_bat) z_runs"""


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
        "sr": 100 * rr / b if b else None,
        "avg": rr / max(o, 1) if b else None,
        "imp100": 100 * (s.get("imp") or 0) / b if b else None,
        "wpa100": 100 * (s.get("wpa") or 0) / b if b else None,
        "bnd": ((s.get("f4") or 0) + (s.get("s6") or 0)) / b if b else None,
        "dotp": (s.get("d") or 0) / b if b else None,
    }


def bowl_metrics(s):
    b, rr, w = s.get("b") or 0, s.get("r") or 0, s.get("w") or 0
    xr, xw = s.get("xr") or 0, s.get("xw") or 0
    return {
        "econ": 6 * rr / b if b else None,
        "bavg": rr / w if w else None,
        "bsr": b / w if w else None,
        "imp100": 100 * (s.get("imp") or 0) / b if b else None,
        "wpa100": 100 * (s.get("wpa") or 0) / b if b else None,
        "dotp": (s.get("d") or 0) / b if b else None,
    }


LOWER_BETTER = {("bat", "dotp"), ("bowl", "econ"), ("bowl", "bavg"), ("bowl", "bsr")}


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
             any_value("group") grp, any_value(gender) gender, any_value(fmt) fam, any_value(family) mfam, count(*) matches,
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

    # baselines: batting keyed "btype|phase", bowling keyed "bowler btype|batter hand|phase" ("all" = any)
    zbase = {}
    for x in rows(con, f"""select fam, gender, grouping(btype) gb, btype, grouping(bat_hand) gh, bat_hand,
          case when grouping(phase) = 1 then 'all' else phase::varchar end ph, {ZONE_VEC}
        from BXE where faced group by fam, gender, cube(btype, bat_hand, phase)"""):
        if (x["gb"] == 0 and x["btype"] is None) or (x["gh"] == 0 and x["bat_hand"] is None):
            continue
        bt = "all" if x["gb"] else x["btype"]
        hd = "all" if x["gh"] else x["bat_hand"]
        d = zbase.setdefault(f"{x['fam']}-{x['gender']}", {"bat": {}, "bowl": {}})
        vec = [x[c] for c in ZONE_COLS]
        if hd == "all":
            d["bat"][f"{bt}|{x['ph']}"] = vec
        d["bowl"][f"{bt}|{hd}|{x['ph']}"] = vec
    w.write("zbase.json", zbase)
    _export_tests(con, w, names)
    from .predict import export_predict
    report["predict"] = export_predict(con, w, names)

    meta = {
        "built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
        "data_to": max_date, "comps": comps,
        "counts": rows(con, "select count(*) matches, (select count(*) from balls) balls, "
                            "(select count(*) from P) players from matches")[0],
        "style_coverage": r(con.execute("select count(*) filter (where bgrp is not null)/count(*) from BXE").fetchone()[0], 3),
        "zones": {k: v for k, v in cfg.items() if not k.startswith("_")},
        "zones_about": cfg["_about"], "zones_about_runs": cfg.get("_about_runs"),
        "models": report,
    }
    w.write("meta.json", meta)
    return {"files": w.count, "mb": round(w.bytes / 1e6, 1), "home_boards": len(home["boards"])}


def _export_players(con, w, cfg, comp_label, names):
    prof = defaultdict(lambda: {"comps": [], "summary": {}, "seasons": defaultdict(list), "splits": {},
                                "zc": {}, "matchups": {}, "recent": {}, "pct": {}, "entry": {}})
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
                        round(sum(imp),1) imp, round(sum(wpa),2) wpa, round(sum(xr),1) xr, round(sum(xo),2) xo from BI group by all),
           c as (select player, comp, season, sum(wkts) w, sum(balls) b, sum(runs) r, round(sum(imp),1) imp,
                        round(sum(wpa),2) wpa, round(sum(xr),1) xr, round(sum(xw),2) xw from BW group by all)
      select coalesce(a.player, c.player) player, coalesce(a.comp, c.comp) comp, coalesce(a.season, c.season) season,
             a.r, a.b, a.o, a.imp, a.wpa, c.w, c.b bb, c.r br, c.imp bimp, c.wpa bwpa, a.xr, a.xo, c.xr bxr, c.xw bxw
      from a full outer join c on a.player = c.player and a.comp = c.comp and a.season = c.season
      order by season"""):
        prof[x["player"]]["seasons"][x["comp"]].append(
            [x["season"], x["r"], x["b"], x["o"], x["imp"], x["wpa"], x["w"], x["bb"], x["br"], x["bimp"], x["bwpa"],
             x["xr"], x["xo"], x["bxr"], x["bxw"]])

    # splits per family (batting)
    bat_dims = {
        "phase": "phase::varchar", "vs": "coalesce(bgrp, 'unknown')", "type": "coalesce(btype, 'unknown')",
        "inn": "inn_grp::varchar", "lev": "lev", "year": "year::varchar",
        "pt": "phase::varchar || '|' || coalesce(btype, 'unknown')",
        "pv": "phase::varchar || '|' || coalesce(bgrp, 'unknown')",
    }
    for dim, expr in bat_dims.items():
        for x in rows(con, f"""select batter player, fam, gender, {expr} k, {BALL_BAT}
                              from BXE where batter is not null {"and lev is not null" if dim == "lev" else ""}
                              group by all having count(*) filter (where faced) > 0"""):
            sp = prof[x["player"]]["splits"].setdefault(f"{x['fam']}-{x['gender']}", {"bat": {}, "bowl": {}})
            sp["bat"].setdefault(dim, []).append([x["k"]] + [r(x[c], 3) for c in ("b", "r", "o", "f4", "s6", "d", "xr", "xo", "imp", "wpa")])
    bowl_dims = {"phase": "phase::varchar", "hand": "coalesce(bat_hand, 'unknown')", "inn": "inn_grp::varchar",
                 "lev": "lev", "year": "year::varchar", "ph": "phase::varchar || '|' || coalesce(bat_hand, 'unknown')"}
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

    # zone counts (batting by bowler type x phase, bowling by batter hand x phase); maps are built in the browser
    for kind, who, dim in (("bat", "batter", "btype"), ("bowl", "bowler", "bat_hand")):
        for x in rows(con, f"""select {who} player, fam, gender,
              case when grouping({dim}) = 1 then 'all' else {dim} end t,
              case when grouping(phase) = 1 then 'all' else phase::varchar end ph, {ZONE_VEC}
            from BXE where faced and {who} is not null
            group by grouping sets (({who}, fam, gender), ({who}, fam, gender, {dim}), ({who}, fam, gender, phase),
                                    ({who}, fam, gender, {dim}, phase))
            having count(*) >= 30"""):
            if x["t"] is None:
                continue
            zc = prof[x["player"]]["zc"].setdefault(f"{x['fam']}-{x['gender']}", {"bat": {}, "bowl": {}})
            zc[kind][f"{x['t']}|{x['ph']}"] = [x[c] for c in ZONE_COLS]

    # recent innings
    for x in rows(con, """select * from (select BI.*, row_number() over (partition by player, fam, gender order by date desc, match_id desc) rn
                          from BI) where rn <= 25 order by date"""):
        prof[x["player"]]["recent"].setdefault("bat", []).append(
            [x["date"], x["comp"], x["opp"], x["runs"], x["balls"], x["is_out"], r(x["imp"], 1), r(x["wpa"], 3), x["match_id"], x["pos"]])
    for x in rows(con, """select * from (select BW.*, row_number() over (partition by player, fam, gender order by date desc, match_id desc) rn
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
      select key, fmt fam,
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
    for kind, tab, sql in (("top_bat", "BI", "sum(runs) r, sum(balls) b, round(sum(imp),1) imp, count(*) i, count(*) filter (where is_out) o"),
                           ("top_bowl", "BW", "sum(wkts) w, sum(balls) b, round(sum(imp),1) imp, count(*) i, sum(runs) rr")):
        for x in rows(con, f"""select * from (select team, gender, fam, player, {sql},
                                 row_number() over (partition by team, gender, fam order by sum(imp) desc) rn
                               from {tab} group by team, gender, fam, player) where rn <= 15"""):
            key = _tkey(x["team"], x["gender"])
            if key in teams:
                vals = [x["player"], names.get(x["player"], (x["player"],))[0]] + \
                       [x[c] for c in (("r", "b", "imp", "i", "o") if kind == "top_bat" else ("w", "b", "imp", "i", "rr"))]
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
    def tk(team, gender):
        return _tkey(team, gender)
    for x in rows(con, """
      with b as (select bat team, gender, fam, comp, season, sum(runs) rf, sum(balls) bf, sum(wkts) wl, count(*) n from IT group by all),
           c as (select bowl team, gender, fam, comp, season, sum(runs) ra, sum(balls) ba, sum(wkts) wt from IT group by all)
      select b.*, c.ra, c.ba, c.wt from b join c using (team, gender, fam, comp, season) order by season"""):
        k = tk(x["team"], x["gender"])
        if k in teams:
            teams[k].setdefault("season_rr", []).append([x["fam"], x["comp"], x["season"], x["rf"], x["bf"], x["wl"], x["ra"], x["ba"], x["wt"]])
    for name, sql in (
        ("high", "select * from (select *, row_number() over (partition by bat, gender, fam order by runs desc) rn from IT) where rn <= 8"),
        ("low", "select * from (select *, row_number() over (partition by bat, gender, fam order by runs) rn from IT where wkts >= 10) where rn <= 8"),
    ):
        for x in rows(con, sql + " order by fam, rn"):
            k = tk(x["bat"], x["gender"])
            if k in teams:
                teams[k].setdefault("totals", {}).setdefault(x["fam"], {}).setdefault(name, []).append(
                    [x["match_id"], x["bowl"], x["runs"], x["wkts"], x["balls"], x["season"], x["inn"]])
    for x in rows(con, tm + """
      select * from (select key, fmt fam, match_id, opp, date, by_runs, by_wkts,
        row_number() over (partition by key, fmt, by_runs is not null order by coalesce(by_runs, 0) + coalesce(by_wkts, 0) desc) rn
        from t where winner = team and result = 'win') where rn <= 6"""):
        if x["key"] in teams:
            kind = "runs" if x["by_runs"] is not None else "wkts"
            teams[x["key"]].setdefault("big_wins", {}).setdefault(x["fam"], {}).setdefault(kind, []).append(
                [x["match_id"], x["opp"], x["date"], x["by_runs"] or x["by_wkts"]])
    for x in rows(con, tm + """
      select * from (select key, fmt fam, venue, any_value(city) city, count(*) p, count(*) filter (where winner = team) w,
             count(*) filter (where result = 'win' and winner <> team) l,
             row_number() over (partition by key, fmt order by count(*) desc) rn
      from t group by key, fmt, venue) where rn <= 15"""):
        if x["key"] in teams:
            teams[x["key"]].setdefault("venues", {}).setdefault(x["fam"], []).append([x["venue"], x["city"], x["p"], x["w"], x["l"]])
    for x in rows(con, """select team, gender, fam, least(pos, 11) pos, sum(runs) r, sum(balls) b, count(*) filter (where is_out) o, count(*) i
                          from BI group by all"""):
        k = tk(x["team"], x["gender"])
        if k in teams:
            teams[k].setdefault("positions", {}).setdefault(x["fam"], []).append([x["pos"], x["r"], x["b"], x["o"], x["i"]])
    for x in rows(con, """select bat_team team, gender, fam, coalesce(btype, 'unknown') t, sum(r_bat) r, count(*) filter (where faced) b,
                                 count(*) filter (where striker_out) o, round(sum(xbat_r) filter (where faced), 1) xr
                          from BXE group by all"""):
        k = tk(x["team"], x["gender"])
        if k in teams:
            teams[k].setdefault("vs_type", {}).setdefault(x["fam"], []).append([x["t"], x["r"], x["b"], x["o"], x["xr"]])
    for x in rows(con, """select bowl_team team, gender, fam, coalesce(btype, 'unknown') t, count(*) filter (where bowler_wkt) w,
                                 count(*) filter (where is_legal) b, sum(bowl_runs) r from BXE group by all"""):
        k = tk(x["team"], x["gender"])
        if k in teams:
            teams[k].setdefault("attack", {}).setdefault(x["fam"], []).append([x["t"], x["w"], x["b"], x["r"]])
    for x in rows(con, """select team, gender, fam, dcat, count(*) n from BI where is_out and dcat is not null group by all"""):
        k = tk(x["team"], x["gender"])
        if k in teams:
            teams[k].setdefault("how_out", {}).setdefault(x["fam"], []).append([x["dcat"], x["n"]])
    for x in rows(con, """select * from (select a.team, m.gender, m.fmt fam, a.player, count(*) n, min(m.date) f, max(m.date) l,
                                 row_number() over (partition by a.team, m.gender, m.fmt order by count(*) desc) rn
                          from appearances a join matches m using (match_id) group by a.team, m.gender, m.fmt, a.player) where rn <= 15"""):
        k = tk(x["team"], x["gender"])
        if k in teams:
            teams[k].setdefault("caps", {}).setdefault(x["fam"], []).append([x["player"], names.get(x["player"], (x["player"],))[0], x["n"], x["f"][:4], x["l"][:4]])
    index = []
    for k, d in teams.items():
        index.append([k, d.get("name"), d.get("gender"), {f: [v.get("p"), v.get("w")] for f, v in d["fams"].items()}])
        w.write(f"teams/{k}.json", d)
    w.write("teams/index.json", index)


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
                   sum(n_wkts) filter (where phase=0) w0, sum(n_wkts) filter (where phase=1) w1, sum(n_wkts) filter (where phase=2) w2,
                   count(*) filter (where faced and r_bat in (4, 6)) bnd,
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
                 where fam not in ('TEST', 'FC')),
           c as (select match_id, bowl team, runs, case when wkts >= 10 then quota else balls end bl from IT where fam not in ('TEST', 'FC')),
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
                                   x["by_bowler"], r(x["imp"], 1), r(x["wpa"], 3), x["team"],
                                   (x["fielders"] or "").split(",")[0] or None, x["pos"]])
    maid = {(x["match_id"], x["inn"], x["bowler"]): x["m"] for x in rows(con, """
        select match_id, inn, bowler, count(*) m from (
          select match_id, inn, bowler, over, sum(bowl_runs) r, count(*) filter (where is_legal) lg, any_value(bpo) bpo
          from BXE group by all) where r = 0 and lg >= bpo group by all""")}
    bowl = defaultdict(list)
    for x in rows(con, "select BW.*, min_seq from BW join (select match_id, inn, bowler player, min(seq) min_seq from BX group by all) s using (match_id, inn, player) order by match_id, inn, min_seq"):
        bowl[x["match_id"]].append([x["inn"], x["player"], x["balls"], x["runs"], x["wkts"], x["dots"], x["wides"],
                                    x["noballs"], r(x["imp"], 1), r(x["wpa"], 3), maid.get((x["match_id"], x["inn"], x["player"]), 0)])
    moments = defaultdict(list)
    for x in rows(con, """select * from (select match_id, inn, over, legal_no, batter, bowler, r_tot, wkt_kind, out_id,
                                 dwp, wp_before, row_number() over (partition by match_id order by abs(dwp) desc) rn
                          from BXE where dwp is not null) where rn <= 8 order by match_id, inn, over, legal_no"""):
        moments[x["match_id"]].append([x["inn"], x["over"], x["legal_no"], x["batter"], x["bowler"], x["r_tot"],
                                       x["wkt_kind"], x["out_id"], r(x["dwp"], 3), r(x["wp_before"], 3)])
    extras = defaultdict(dict)
    for x in rows(con, """select match_id, inn, sum(wides) wd, sum(noballs) nb, sum(byes) b, sum(legbyes) lb, sum(r_tot) total,
                                 count(*) filter (where is_legal) balls, sum(n_wkts) wkts from BXE group by all"""):
        extras[x["match_id"]][x["inn"]] = [x["wd"], x["nb"], x["b"], x["lb"], x["total"], x["balls"], x["wkts"]]
    fow = defaultdict(list)
    for x in rows(con, """select match_id, inn, wkts_before + 1 k, score_before + r_tot score, legal_before + is_legal::int balls, out_id
                          from BXE where n_wkts > 0 order by match_id, inn, seq"""):
        fow[x["match_id"]].append([x["inn"], x["k"], x["score"], x["balls"], x["out_id"]])
    pships = defaultdict(list)
    pb = defaultdict(dict)
    for x in rows(con, """select match_id, inn, wkts_before k, batter, sum(r_bat) r, count(*) filter (where faced) b
                          from BXE group by all"""):
        pb[(x["match_id"], x["inn"], x["k"])][x["batter"]] = [x["r"], x["b"]]
    for x in rows(con, """select match_id, inn, wkts_before k, sum(r_tot) runs, count(*) filter (where is_legal) balls,
                                 any_value(non_striker) ns
                          from BXE group by all order by match_id, inn, k"""):
        who = pb.get((x["match_id"], x["inn"], x["k"]), {})
        pair = sorted(who.items(), key=lambda kv: -kv[1][0])[:2]
        if len(pair) == 1 and x["ns"] and x["ns"] not in who:
            pair.append((x["ns"], [0, 0]))
        pships[x["match_id"]].append([x["inn"], x["k"] + 1, x["runs"], x["balls"]] + [v for kv in pair for v in (kv[0], kv[1][0], kv[1][1])])
    squads = defaultdict(lambda: defaultdict(list))
    for x in rows(con, "select match_id, team, player from appearances"):
        squads[x["match_id"]][x["team"]].append(x["player"])
    for mid, m in info.items():
        batted = defaultdict(set)
        for row in bat.get(mid, []):
            batted[row[0]].add(row[1])
        dnb = []
        for k, e in extras.get(mid, {}).items():
            team = next((row[10] for row in bat.get(mid, []) if row[0] == k), None)
            if team:
                dnb.append([k, [p for p in squads[mid].get(team, []) if p not in batted[k]]])
        ids = {p for row in bat.get(mid, []) for p in (row[1], row[7], row[11]) if p} | {row[1] for row in bowl.get(mid, [])}
        ids |= {p for _, lst in dnb for p in lst} | {row[4] for row in fow.get(mid, []) if row[4]}
        ids |= {p for row in pships.get(mid, []) for p in row[4::3] if p}
        ids |= {p for row in moments.get(mid, []) for p in (row[3], row[4]) if p}
        w.write(f"matches/{mid}.json", {
            "info": {k: v for k, v in m.items() if v is not None}, "comp_label": comp_label.get(m["comp"]),
            "overs": overs.get(mid, []), "bat": bat.get(mid, []), "bowl": bowl.get(mid, []),
            "moments": moments.get(mid, []), "extras": extras.get(mid, {}), "fow": fow.get(mid, []),
            "partnerships": pships.get(mid, []), "dnb": dnb,
            "names": {p: names.get(p, (p.lstrip("~"),))[0] for p in ids},
        })
    # recent-match lists per format and gender, for the Matches page
    lists = defaultdict(list)
    for x in rows(con, """select * from (select *, row_number() over (partition by fmt, gender order by date desc, match_id desc) rn
                          from matches) where rn <= 600 order by date desc"""):
        sc = []
        for k, e in sorted(extras.get(x["match_id"], {}).items()):
            team = next((row[10] for row in bat.get(x["match_id"], []) if row[0] == k), None)
            sc.append([team, e[4], e[6], e[5]])
        lists[f"{x['fmt']}-{x['gender']}"].append([x["match_id"], x["date"], x["comp"], comp_label.get(x["comp"]), x["team1"], x["team2"],
                                                   x["winner"], x["result"], x["by_runs"], x["by_wkts"], x["venue"], bool(x["lvl_top"]),
                                                   bool(x["lvl_intl"]), sc])
    for k, v in lists.items():
        w.write(f"matches/index-{k}.json", v)


FMT_LABEL = {"TEST": "Tests", "FC": "First-class", "ODI": "ODIs", "LA": "List A", "T20": "T20", "HUN": "The Hundred"}
LIMITED = ("ODI", "LA", "T20", "HUN")
LEVELS = [("top", "Full members + major leagues", "lvl_top"), ("intl", "Internationals", "lvl_intl"), ("all", "Everything", "true")]


def _export_home(con, w, cfg, cut365, max_date, names, comp_label):
    cut730 = (dt.date.fromisoformat(cut365) - dt.timedelta(days=365)).isoformat()
    cut1095 = (dt.date.fromisoformat(cut365) - dt.timedelta(days=730)).isoformat()
    index = []
    for fmt in FAMS:
        for gender in ("male", "female"):
            for lkey, llabel, lcond in LEVELS:
                n = con.execute(f"select count(distinct match_id) from BXE where fam = ? and gender = ? and {lcond}", [fmt, gender]).fetchone()[0]
                if n < 20:
                    continue
                con.execute(f"create or replace temp table S as select * from BXE where fam = '{fmt}' and gender = '{gender}' and {lcond}")
                scope = f"{fmt}-{gender}-{lkey}"
                index.append({"key": scope, "fmt": fmt, "gender": gender, "level": lkey, "level_label": llabel, "matches": n})
                w.write(f"home/{scope}.json", _scope_home(con, fmt, cut365, cut730, cut1095, names))
    # cross-format extras kept from v2
    trend = rows(con, """select comp, year, round(6.0*sum(r_tot)/count(*) filter (where is_legal), 3) rpo,
                                round(count(*) filter (where six)*1.0/count(distinct match_id), 2) six_pm,
                                round(count(*) filter (where four)*1.0/count(distinct match_id), 2) four_pm,
                                round(100.0*count(*) filter (where faced and r_bat = 0)/count(*) filter (where faced), 2) dot_pct,
                                round(count(*) filter (where is_legal)*1.0/greatest(sum(n_wkts), 1), 2) bpw
                         from BXE group by all order by comp, year""")
    home = {"scopes": index, "cut365": cut365, "data_to": max_date, "trend": trend}
    w.write("home.json", home)
    return {"boards": index}


def _scope_home(con, fmt, cut365, cut730, cut1095, names):
    """Leaderboards, breakouts, pulse and trends for one format x gender x level (rows are in temp table S)."""
    boards = []
    limited = fmt in LIMITED

    def board(key, title, desc, window, kind, sql_metric, order="desc", min_b=0, extra_where="", unit=""):
        where = ("date >= '%s'" % cut365 if window == "365" else "true") + (f" and {extra_where}" if extra_where else "")
        agg = BALL_BAT if kind == "bat" else BALL_BOWL
        who = "batter" if kind == "bat" else "bowler"
        team = "bat_team" if kind == "bat" else "bowl_team"
        res = rows(con, f"""select {who} player, {agg}, {sql_metric} v, mode({team}) team from S where {where} group by 1
                            having count(*) filter (where {'faced' if kind == 'bat' else 'is_legal'}) >= {min_b}
                            order by v {order} nulls last limit 50""")
        boards.append({"key": f"{key}:{window}", "metric": key, "title": title, "desc": desc, "window": window, "kind": kind,
                       "unit": unit, "min_balls": min_b, "order": order,
                       "rows": [[x["player"], names.get(x["player"], (x["player"],))[0], r(x["v"], 3),
                                 {**{k: r(x[k], 2) for k in ("b", "r", "o", "w", "imp", "wpa", "xr") if k in x}, "t": x["team"]}] for x in res]})

    SR = "100.0*sum(r_bat)/nullif(count(*) filter (where faced),0)"
    AVG = "sum(r_bat)*1.0/greatest(count(*) filter (where striker_out),1)"
    ECO = "6.0*sum(bowl_runs)/nullif(count(*) filter (where is_legal),0)"
    BAVG = "sum(bowl_runs)*1.0/nullif(count(*) filter (where bowler_wkt),0)"
    BSR = "count(*) filter (where is_legal)*1.0/nullif(count(*) filter (where bowler_wkt),0)"
    WK = "count(*) filter (where bowler_wkt)"
    for window in ("365", "all"):
        mb = QB[fmt] // (2 if window == "365" else 1)
        mw = QW[fmt] // (2 if window == "365" else 1)
        board("bat_imp", "Batting impact", "Runs added above an average batter in the same situation, counting the run cost of getting out.", window, "bat", "sum(bat_val)", unit="runs")
        board("bat_runs", "Most runs", "Total runs scored.", window, "bat", "sum(r_bat)", unit="count")
        board("bat_avg", "Batting average", "Runs per dismissal.", window, "bat", AVG, min_b=mb, unit="avg")
        board("bat_sr", "Strike rate", "Runs per 100 balls faced.", window, "bat", SR, min_b=mb, unit="sr")
        board("hardest_out", "Hardest to dismiss", "Balls faced per dismissal.", window, "bat",
              "count(*) filter (where faced)*1.0/greatest(count(*) filter (where striker_out),1)", min_b=mb, unit="bpd")
        board("bowl_imp", "Bowling impact", "Runs saved against an average bowler in the same situation, plus the value of wickets.", window, "bowl", "sum(bowl_val)", unit="runs")
        board("bowl_wkts", "Most wickets", "Total wickets taken.", window, "bowl", WK, unit="count")
        board("bowl_avg", "Bowling average", "Runs conceded per wicket. Lower is better.", window, "bowl", BAVG, order="asc", min_b=mw, unit="avg")
        board("bowl_econ", "Economy", "Runs conceded per over. Lower is better.", window, "bowl", ECO, order="asc", min_b=mw, unit="econ")
        board("bowl_sr", "Bowling strike rate", "Balls per wicket. Lower is better.", window, "bowl", BSR, order="asc", min_b=mw, unit="bpd")
        board("spin_sr", "Strike rate v spin", "Runs per 100 balls against spin.", window, "bat", SR, min_b=mb // 3, extra_where="btype = 'spin'", unit="sr")
        board("pace_sr", "Strike rate v pace", "Runs per 100 balls against pace.", window, "bat", SR, min_b=mb // 3, extra_where="btype = 'pace'", unit="sr")
        board("full_straight", "Bowled + LBW rate", "Bowled and LBW dismissals per 1,000 balls faced. Inferred weakness to full, straight balls.", window, "bat",
              "1000.0*count(*) filter (where dcat in ('bowled','lbw'))/nullif(count(*) filter (where faced),0)", min_b=mb)
        board("corridor", "Caught-behind rate", "Edges to the keeper per 1,000 balls faced. Inferred weakness in the off-stump corridor.", window, "bat",
              "1000.0*count(*) filter (where dcat = 'keeper')/nullif(count(*) filter (where faced),0)", min_b=mb)
        if limited:
            board("bat_wpa", "Win probability added", "Swing in the team's chance of winning credited to the batter.", window, "bat", "sum(bat_wpa)", unit="wins")
            board("bowl_wpa", "Win probability added", "Swing in win chance credited to the bowler.", window, "bowl", "sum(bowl_wpa)", unit="wins")
            board("clutch", "Clutch batting", "Batting impact on high-pressure balls only, where the result was most on the line.", window, "bat", "sum(bat_val)", extra_where="lev = 'high'", unit="runs")
            board("clutch_bowl", "Clutch bowling", "Bowling impact on high-pressure balls only.", window, "bowl", "sum(bowl_val)", extra_where="lev = 'high'", unit="runs")
            board("pp_sr", "Powerplay strike rate", "Runs per 100 balls in the opening phase.", window, "bat", SR, min_b=mb // 4, extra_where="phase = 0", unit="sr")
            board("death_sr", "Death-overs strike rate", "Runs per 100 balls in the final phase.", window, "bat", SR, min_b=mb // 4, extra_where="phase = 2", unit="sr")
            board("pp_econ", "Powerplay economy", "Runs per over in the opening phase. Lower is better.", window, "bowl", ECO, order="asc", min_b=mw // 4, extra_where="phase = 0", unit="econ")
            board("death_econ", "Death-overs economy", "Runs per over at the death. Lower is better.", window, "bowl", ECO, order="asc", min_b=mw // 4, extra_where="phase = 2", unit="econ")
        else:
            board("newball_avg", "Average v the new ball", "Runs per dismissal in the first 20 overs of an innings.", window, "bat", AVG, min_b=mb // 4, extra_where="phase = 0", unit="avg")
            board("newball_wkts", "New-ball wickets", "Wickets in the first 20 overs of an innings.", window, "bowl", WK, extra_where="phase = 0", unit="count")
            board("inn4_bat", "Fourth-innings batting impact", "Impact batting last, when pitches are worn and the result is on the line.", window, "bat", "sum(bat_val)", extra_where="inn = 4", unit="runs")
            board("inn4_bowl", "Fourth-innings bowling impact", "Impact bowling at the side batting last.", window, "bowl", "sum(bowl_val)", extra_where="inn = 4", unit="runs")

    breakouts = {}
    for kind, who, val, balls, team in (("bat", "batter", "bat_val", "faced", "bat_team"), ("bowl", "bowler", "bowl_val", "is_legal", "bowl_team")):
        q = (QB if kind == "bat" else QW)[fmt] // 2
        res = rows(con, f"""
          with x as (select {who} player, date >= '{cut365}' as now, {val} v, {balls} as bl, {team} team from S where date >= '{cut1095}')
          select player, mode(team) filter (where now) team,
                 100 * sum(v) filter (where now) / count(*) filter (where now and bl) a,
                 100 * sum(v) filter (where not now) / count(*) filter (where not now and bl) bb,
                 count(*) filter (where now and bl) na, count(*) filter (where not now and bl) nb
          from x group by 1
          having count(*) filter (where now and bl) >= {q} and count(*) filter (where not now and bl) >= {q}
          order by a - bb desc limit 20""")
        breakouts[kind] = [[x["player"], names.get(x["player"], (x["player"],))[0], r(x["a"], 2), r(x["bb"], 2),
                            r(x["a"] - x["bb"], 2), x["na"], x["nb"], x["team"]] for x in res]

    def pulse(cond):
        return rows(con, f"""select count(distinct match_id) m, round(6.0*sum(r_tot)/nullif(count(*) filter (where is_legal),0), 3) rpo,
              round(sum(r_tot)*1.0/nullif(sum(n_wkts),0), 2) rpw, round(100.0*count(*) filter (where faced and r_bat=0)/nullif(count(*) filter (where faced),0), 2) dot,
              round(count(*) filter (where six)*1.0/nullif(count(distinct match_id),0), 2) six_pm, round(count(*) filter (where four)*1.0/nullif(count(distinct match_id),0), 2) four_pm,
              round(count(*) filter (where is_legal)*1.0/nullif(sum(n_wkts),0), 2) bpw,
              round(100.0*count(*) filter (where bowler_wkt and btype='pace')/nullif(count(*) filter (where bowler_wkt and btype is not null),0), 1) pace_share,
              count(*) filter (where faced and r_bat=0) n_dot, count(*) filter (where faced and r_bat in (1,2,3,5)) n_r13,
              count(*) filter (where four) n_four, count(*) filter (where six) n_six, count(*) filter (where faced) n_faced
            from S where {cond}""")[0]
    years = rows(con, """select year, count(distinct match_id) m, round(6.0*sum(r_tot)/nullif(count(*) filter (where is_legal),0), 3) rpo,
          round(sum(r_tot)*1.0/nullif(sum(n_wkts),0), 2) rpw, round(100.0*count(*) filter (where faced and r_bat=0)/nullif(count(*) filter (where faced),0), 2) dot,
          round(count(*) filter (where six)*1.0/nullif(count(distinct match_id),0), 2) six_pm
        from S group by 1 order by 1""")
    phases = rows(con, """select year, phase, round(6.0*sum(r_tot)/nullif(count(*) filter (where is_legal),0), 3) rpo,
          round(count(*) filter (where is_legal)*1.0/nullif(sum(n_wkts),0), 2) bpw from S group by all order by 1, 2""")
    chase = rows(con, f"""select m.comp, any_value(m.comp_label) label, count(*) filter (where i.bat = m.winner) * 1.0 / count(*) chase_win, count(*) n
        from matches m join IT i on i.match_id = m.match_id and i.inn = 2
        where m.result = 'win' and m.match_id in (select distinct match_id from S) and m.family <> 'MD'
        group by 1 having count(*) >= 30 order by chase_win desc""") if limited else []
    comps = rows(con, """select comp, count(distinct match_id) m, max(date) last from S group by 1 order by m desc""")
    return {"fmt": fmt, "boards": boards, "breakouts": breakouts, "pulse": {"now": pulse(f"date >= '{cut365}'"),
            "prev": pulse(f"date >= '{cut730}' and date < '{cut365}'"), "all": pulse("true")},
            "years": years, "phases": phases, "chase": chase, "comps": comps}


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
             string_agg(distinct m.fmt, ',')
      from appearances a join matches m using (match_id) join P p on p.player = a.player
      group by a.player, p.name, p.unique_name order by n desc""").fetchall()
    teams = con.execute("""
      select key, team, gender, count(*) n from (
        select team1_key key, team1 team, gender from matches union all select team2_key, team2, gender from matches)
      group by all order by n desc""").fetchall()
    w.write("search.json", {"players": players, "teams": teams,
                            "comps": [[c["key"], c["label"], c["country"], c["matches"]] for c in comps]})


def _export_tests(con, w, names):
    """Test-match hub: results, innings by innings, 4th-innings chases, follow-ons, declarations, toss, home and away,
    ball age and conditions by host country. Host = the team that plays most international cricket at the venue."""
    con.execute("""
    create or replace table VHOST as
    select venue_key, arg_max(team, n) host from (
      select venue_key, team, count(*) n from (
        select venue_key, team1 team from matches where team_type = 'international'
        union all select venue_key, team2 from matches where team_type = 'international') group by all)
    group by 1""")
    for gender, comp in (("male", "men-test"), ("female", "women-test")):
        if not con.execute("select count(*) from matches where comp = ?", [comp]).fetchone()[0]:
            continue
        p = [comp]
        M = """(select m.*, h.host, (m.winner = h.host) home_win, (m.winner is not null and m.winner <> h.host) away_win
                from matches m left join VHOST h using (venue_key) where m.comp = ?)"""
        yearly = rows(con, f"""
          select year, count(*) p, count(*) filter (where result = 'win') dec, count(*) filter (where result = 'draw') d,
                 count(*) filter (where result = 'tie') t, count(*) filter (where home_win) hw, count(*) filter (where away_win) aw
          from {M} group by 1 order by 1""", p)
        ball_year = {x["year"]: x for x in rows(con, """
          select year, round(sum(r_tot)::double / greatest(sum(n_wkts), 1), 2) rpw, round(6.0 * sum(r_tot) / count(*) filter (where is_legal), 3) rpo,
                 round(count(*) filter (where bowler_wkt and btype = 'pace') * 1.0 / greatest(count(*) filter (where bowler_wkt and btype is not null), 1), 3) pace_share,
                 round(100.0 * count(*) filter (where faced and r_bat = 0) / count(*) filter (where faced), 2) dot_pct
          from BXE where comp = ? group by 1""", p)}
        for y in yearly:
            y.update({k: v for k, v in ball_year.get(y["year"], {}).items() if k != "year"})
        inns = rows(con, """
          select m.year, i.inn, count(*) n, round(avg(i.runs), 1) runs, round(avg(i.balls) / 6, 1) overs,
                 count(*) filter (where i.wkts >= 10) allout, count(*) filter (where n.declared) decl
          from IT i join matches m using (match_id) left join innings n on n.match_id = i.match_id and n.inn = i.inn
          where m.comp = ? and i.inn <= 4 group by all order by 1, 2""", p)
        chases = rows(con, """
          with t as (select i4.match_id, i4.bat team, i4.bowl opp, i4.runs scored, i4.wkts,
                       (select sum(runs) from IT x where x.match_id = i4.match_id and x.bat <> i4.bat)
                     - (select coalesce(sum(runs), 0) from IT x where x.match_id = i4.match_id and x.bat = i4.bat and x.inn < 4) + 1 target
                     from IT i4 where i4.inn = 4)
          select t.*, m.year, m.date, m.venue, case when m.winner = t.team then 'won' when m.result = 'win' then 'lost'
                 else m.result end res
          from t join matches m using (match_id) where m.comp = ? and t.target > 0 order by m.date""", p)
        follow = rows(con, """
          select m.year, m.match_id, i1.bat enforcer, i2.bat followed, m.winner, m.result
          from matches m join IT i1 on i1.match_id = m.match_id and i1.inn = 1
          join IT i2 on i2.match_id = m.match_id and i2.inn = 2
          join IT i3 on i3.match_id = m.match_id and i3.inn = 3
          where m.comp = ? and i3.bat = i2.bat""", p)
        toss = rows(con, f"""
          select year, count(*) filter (where toss_decision = 'bat') bat, count(*) filter (where toss_decision = 'field') field,
                 count(*) filter (where winner = toss_winner) tw, count(*) filter (where result = 'win' and winner <> toss_winner) tl,
                 count(*) p from {M} group by 1 order by 1""", p)
        home = rows(con, f"""
          with t as (select team1 team, * from {M} union all select team2 team, * from {M})
          select team, count(*) filter (where team = host) hp, count(*) filter (where team = host and winner = team) hw,
                 count(*) filter (where team = host and result = 'win' and winner <> team) hl,
                 count(*) filter (where team <> host) ap, count(*) filter (where team <> host and winner = team) aw,
                 count(*) filter (where team <> host and result = 'win' and winner <> team) al
          from t group by 1 having count(*) >= 10 order by hp + ap desc""", p + p)
        age = rows(con, """
          select least(over // 10, 13) bucket, round(6.0 * sum(r_tot) / count(*) filter (where is_legal), 3) rpo,
                 round(count(*) filter (where is_legal) * 1.0 / greatest(sum(n_wkts), 1), 1) bpw,
                 round(count(*) filter (where bowler_wkt and btype = 'pace') * 1.0 / greatest(count(*) filter (where bowler_wkt and btype is not null), 1), 3) pace_share,
                 count(*) filter (where is_legal) balls
          from BXE where comp = ? group by 1 order by 1""", p)
        hosts = rows(con, """
          select h.host, count(distinct b.match_id) m, round(sum(b.r_tot)::double / greatest(sum(b.n_wkts), 1), 2) rpw,
                 round(count(*) filter (where b.bowler_wkt and b.btype = 'pace') * 1.0 / greatest(count(*) filter (where b.bowler_wkt and b.btype is not null), 1), 3) pace_share,
                 round(6.0 * sum(b.r_tot) / count(*) filter (where b.is_legal), 3) rpo
          from BXE b join VHOST h using (venue_key) where b.comp = ? group by 1 having count(distinct b.match_id) >= 5 order by m desc""", p)
        res_host = {x["host"]: x for x in rows(con, f"""
          select host, count(*) filter (where result = 'draw') d, count(*) filter (where home_win) hw, count(*) filter (where away_win) aw,
                 round(avg(i.runs), 1) avg1 from {M} m left join IT i on i.match_id = m.match_id and i.inn = 1 group by 1""", p)}
        for h in hosts:
            h.update({k: v for k, v in res_host.get(h["host"], {}).items() if k != "host"})
        leaders = {}
        for kind, tab, sql in (("bat", "BI", "sum(runs) r, sum(balls) b, count(*) filter (where is_out) o, round(sum(imp), 1) imp, count(*) i"),
                               ("bowl", "BW", "sum(wkts) w, sum(balls) b, sum(runs) r, round(sum(imp), 1) imp, count(*) i")):
            for x in rows(con, f"""select * from (select least(inn, 4) inn, player, {sql},
                                     row_number() over (partition by least(inn, 4) order by sum(imp) desc) rn
                                   from {tab} where comp = ? group by least(inn, 4), player) where rn <= 12 order by inn, rn""", p):
                vals = {k: x[k] for k in ("r", "b", "o", "w", "imp", "i") if k in x}
                leaders.setdefault(kind, {}).setdefault(str(x["inn"]), []).append(
                    [x["player"], names.get(x["player"], (x["player"],))[0], vals])
        w.write(f"tests/{gender}.json", {
            "comp": comp, "yearly": yearly, "innings": inns, "toss": toss, "home": home, "age": age, "hosts": hosts,
            "leaders": leaders,
            "chases": [[c["match_id"], c["year"], c["team"], c["opp"], c["target"], c["scored"], c["wkts"], c["res"], c["venue"]] for c in chases],
            "follow": [[f["match_id"], f["year"], f["enforcer"], f["followed"], f["winner"], f["result"]] for f in follow],
        })

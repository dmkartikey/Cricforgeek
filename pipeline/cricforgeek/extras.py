"""Exports for the geek features: venue pages, records and oddities, on this day, the card-game deck, era
baselines and the par table, plus extra player fields (dismissal patterns, home and away, every innings,
context-adjusted averages, how each bowler got each batter) and extra match fields (pressure before each wicket,
estimated Test sessions)."""
from __future__ import annotations

from collections import defaultdict

FULL = ("India", "Australia", "England", "South Africa", "New Zealand", "Pakistan", "Sri Lanka", "West Indies",
        "Bangladesh", "Afghanistan", "Zimbabwe", "Ireland")
FULL_SQL = ", ".join(f"'{t}'" for t in FULL)
# Venue names Cricsheet uses for many different grounds: these are split by city.
GENERIC_VENUES = ("county-ground", "gymkhana-club-ground")
# Cricsheet has no day or session marks, so Test days are estimated: 90 overs a day, 30 a session.
DAY_BALLS, SESSION_BALLS = 540, 180
DCAT_SHORT = {"bowled": "b", "lbw": "l", "keeper": "k", "field": "c", "cab": "cb", "stumped": "s", "hitwicket": "h"}


def _h():
    from .export import r, rows  # late import: export imports this module
    return r, rows


def prep(con):
    """Tables the extra exports share. Host country = the international side that plays most at the venue."""
    con.execute("""
    create or replace table VHOST as
    select venue_key, arg_max(team, n) host from (
      select venue_key, team, count(*) n from (
        select venue_key, team1 team from matches where team_type = 'international'
        union all select venue_key, team2 from matches where team_type = 'international') group by all)
    group by 1""")
    generic = ", ".join(f"'{v}'" for v in GENERIC_VENUES)
    con.execute(f"""
    create or replace table MV as
    select match_id, venue_key, venue, city,
           case when venue_key in ({generic}) then venue_key || '-' || trim(regexp_replace(lower(coalesce(city, 'unknown')), '[^a-z0-9]+', '-', 'g'), '-')
                else venue_key end vkey
    from matches""")
    # balls before each delivery across the whole match, for estimated days and sessions in multi-day cricket
    con.execute("""
    create or replace table BCUM as
    select match_id, inn, seq,
           coalesce(sum(is_legal::int) over (partition by match_id order by inn, seq rows between unbounded preceding and 1 preceding), 0) cum
    from BXE where fam in ('TEST', 'FC') and not coalesce(super_over, false)""")
    # Context factors for adjusted averages: how hard the opposition was to score against (or how well they
    # batted) that year, and how easy the venue is, both shrunk towards the average so small samples stay near 1.
    con.execute("""create or replace temp table ITX as
                   select i.*, m.year, m.venue_key from IT i join matches m using (match_id) where i.inn <= 4""")
    con.execute("""create or replace temp table M_Y as
                   select fam, gender, year, sum(runs) / greatest(sum(wkts), 1) m from ITX group by all""")
    con.execute("""create or replace temp table M_0 as
                   select fam, gender, sum(runs) / greatest(sum(wkts), 1) m from ITX group by all""")
    for name, side in (("OPP_BOWL", "bowl"), ("OPP_BAT", "bat")):
        con.execute(f"""create or replace temp table {name} as
          select x.{side} team, x.fam, x.gender, x.year, (sum(x.runs) + 30 * any_value(y.m)) / (sum(x.wkts) + 30) rpw
          from ITX x join M_Y y using (fam, gender, year) group by all""")
    con.execute("""create or replace temp table VEN as
      select x.venue_key, x.fam, x.gender, (sum(x.runs) + 60 * any_value(z.m)) / (sum(x.wkts) + 60) rpw
      from ITX x join M_0 z using (fam, gender) group by all""")
    con.execute("""create or replace table ADJ_BAT as
      select b.match_id, b.inn, b.player, b.fam, b.gender,
             b.runs * least(1.6, greatest(0.6, coalesce((y.m / o.rpw) * sqrt(z.m / v.rpw), 1))) adj
      from BI b left join OPP_BOWL o on o.team = b.opp and o.fam = b.fam and o.gender = b.gender and o.year = b.year
      left join M_Y y on y.fam = b.fam and y.gender = b.gender and y.year = b.year
      left join M_0 z on z.fam = b.fam and z.gender = b.gender
      left join VEN v on v.venue_key = b.venue_key and v.fam = b.fam and v.gender = b.gender""")
    con.execute("""create or replace table ADJ_BOWL as
      select b.match_id, b.inn, b.player, b.fam, b.gender,
             b.runs / least(1.6, greatest(0.6, coalesce((o.rpw / y.m) * sqrt(v.rpw / z.m), 1))) adj
      from BW b left join OPP_BAT o on o.team = b.opp and o.fam = b.fam and o.gender = b.gender and o.year = b.year
      left join M_Y y on y.fam = b.fam and y.gender = b.gender and y.year = b.year
      left join M_0 z on z.fam = b.fam and z.gender = b.gender
      left join VEN v on v.venue_key = b.venue_key and v.fam = b.fam and v.gender = b.gender""")


# ---------------------------------------------------------------- player fields
def player_extras(con, prof, names):
    r, rows = _h()

    def sp(p, fk):
        return prof[p]["splits"].setdefault(fk, {"bat": {}, "bowl": {}})

    # context-adjusted runs (sum) for adjusted averages
    for kind, tab in (("bat", "ADJ_BAT"), ("bowl", "ADJ_BOWL")):
        for x in rows(con, f"select player, fam, gender, round(sum(adj), 1) a from {tab} group by all"):
            s = prof[x["player"]]["summary"].get(f"{x['fam']}-{x['gender']}", {}).get(kind)
            if s is not None:
                s["adj_r"] = r(x["a"], 1)

    # how they get out, and the type of bowler who got them
    for x in rows(con, """select b.player, b.fam, b.gender, b.dcat, case when b.dcat = 'runout' then '-' else coalesce(p.btype, 'unknown') end t, count(*) n
                          from BI b left join P p on p.player = b.by_bowler where b.is_out and b.dcat is not null group by all"""):
        sp(x["player"], f"{x['fam']}-{x['gender']}")["bat"].setdefault("how", []).append([x["dcat"], x["t"], x["n"]])
    # how the bowler takes wickets, by batting hand
    for x in rows(con, """select b.by_bowler player, b.fam, b.gender, b.dcat, coalesce(p.hand, 'unknown') h, count(*) n
                          from BI b left join P p on p.player = b.player
                          where b.is_out and b.by_bowler is not null and b.dcat not in ('runout', 'other') group by all"""):
        if x["player"] in prof:
            sp(x["player"], f"{x['fam']}-{x['gender']}")["bowl"].setdefault("how", []).append([x["dcat"], x["h"], x["n"]])

    # how each bowler dismissed each batter, attached to the head-to-head rows
    kinds = defaultdict(dict)
    for x in rows(con, """select batter, bowler, fam, gender, dcat, count(*) n from BXE
                          where striker_out and bowler_wkt and dcat is not null group by all"""):
        kinds[(x["batter"], x["bowler"], x["fam"], x["gender"])][DCAT_SHORT.get(x["dcat"], x["dcat"])] = x["n"]
    for p, d in prof.items():
        for fk, mu in d["matchups"].items():
            fam, g = fk.split("-")
            for row in mu.get("bat", []):
                row.append(kinds.get((p, row[0], fam, g), {}))
            for row in mu.get("bowl", []):
                row.append(kinds.get((row[0], p, fam, g), {}))

    # home, away and neutral (internationals only), and by host country
    ha = """case when h.host is null then 'unknown' when b.team = h.host then 'home' when b.opp = h.host then 'away' else 'neutral' end"""
    for kind, tab, sql, cols in (
        ("bat", "BI", "sum(b.runs) r, sum(b.balls) bb, count(*) filter (where b.is_out) o, round(sum(b.imp), 1) imp, "
                      "count(*) filter (where b.runs >= 50 and b.runs < 100) c50, count(*) filter (where b.runs >= 100) c100",
         ("r", "bb", "o", "imp", "c50", "c100")),
        ("bowl", "BW", "sum(b.wkts) w, sum(b.balls) bb, sum(b.runs) r, round(sum(b.imp), 1) imp", ("w", "bb", "r", "imp")),
    ):
        for dim, expr in (("ha", ha), ("host", "coalesce(h.host, 'unknown')")):
            for x in rows(con, f"""select b.player, b.fam, b.gender, {expr} k, count(*) i, {sql}
                                  from {tab} b join matches m using (match_id) left join VHOST h on h.venue_key = b.venue_key
                                  where m.team_type = 'international' group by all"""):
                if x["player"] in prof:
                    sp(x["player"], f"{x['fam']}-{x['gender']}")[kind].setdefault(dim, []).append([x["k"], x["i"]] + [r(x[c], 1) for c in cols])

    # every innings, oldest first, for rolling form and milestones: bat [yyyymmdd, runs, balls, out], bowl [yyyymmdd, balls, runs, wkts]
    for kind, tab, cols in (("bat", "BI", "runs, balls, is_out::int"), ("bowl", "BW", "balls, runs, wkts")):
        for x in con.execute(f"""select player, fam, gender, replace(date, '-', '')::int d, {cols}
                                 from {tab} order by player, date, match_id, inn""").fetchall():
            p = x[0]
            if p in prof:
                prof[p].setdefault("inns", {}).setdefault(f"{x[1]}-{x[2]}", {}).setdefault(kind, []).append(list(x[3:]))


# ---------------------------------------------------------------- match fields
def match_extras(con):
    """Pressure before each wicket: dot balls in the previous 12 deliveries and legal balls since the last boundary.
    Estimated sessions for multi-day matches."""
    _, rows = _h()
    press = {}
    for x in con.execute("""
      with b as (select match_id, inn, seq, n_wkts, wkts_before, legal_before,
                   sum(case when is_legal and r_tot = 0 then 1 else 0 end) over (partition by match_id, inn order by seq rows between 12 preceding and 1 preceding) d12,
                   max(case when four or six then legal_before end) over (partition by match_id, inn order by seq rows between unbounded preceding and 1 preceding) lb
                 from BXE)
      select match_id, inn, wkts_before + 1, coalesce(d12, 0), legal_before - coalesce(lb + 1, 0) from b where n_wkts > 0""").fetchall():
        press[(x[0], x[1], x[2])] = [int(x[3]), max(0, int(x[4]))]
    sessions = defaultdict(list)
    for x in con.execute(f"""
      select b.match_id, least(c.cum // {SESSION_BALLS}, 14) s, b.bat_team, sum(b.r_tot) r, sum(b.n_wkts) w, count(*) filter (where b.is_legal) bl, min(b.inn) inn
      from BXE b join BCUM c using (match_id, inn, seq) group by all order by 1, 2, 7""").fetchall():
        sessions[x[0]].append([x[1] // 3 + 1, x[1] % 3 + 1, x[2], int(x[3]), int(x[4]), int(x[5]), x[6]])
    return press, sessions


# ---------------------------------------------------------------- venues
def export_venues(con, w, names):
    r, rows = _h()
    idx = rows(con, """
      select mv.vkey, mode(mv.venue) name, mode(mv.city) city, any_value(h.host) host, count(*) n, min(m.date) f, max(m.date) l,
             count(*) filter (where m.team_type = 'international') intl
      from matches m join MV mv using (match_id) left join VHOST h on h.venue_key = m.venue_key
      group by mv.vkey having count(*) >= 5 order by n desc""")
    keep = {x["vkey"] for x in idx}
    V = defaultdict(lambda: {"fmts": {}, "recent": []})

    def fk_of(x):
        return f"{x['fam']}-{x['gender']}"

    def slot(x):
        d = V[x["vkey"]]["fmts"].setdefault(fk_of(x), {})
        return d

    for x in rows(con, """
      select mv.vkey, m.fmt fam, m.gender, count(*) n, round(avg(i1.runs), 1) avg1, median(i1.runs) med1, round(avg(i2.runs), 1) avg2,
             count(*) filter (where m.result = 'win' and m.winner = i1.bat) bf_w, count(*) filter (where m.result = 'win' and m.winner <> i1.bat) ch_w,
             count(*) filter (where m.result = 'draw') d, count(*) filter (where m.result = 'tie') t, count(*) filter (where m.result = 'no result') nr,
             count(*) filter (where m.toss_decision = 'bat') toss_bat, count(*) filter (where m.toss_decision = 'field') toss_field,
             count(*) filter (where m.winner = m.toss_winner) toss_won, count(*) filter (where m.result = 'win') dec,
             count(*) filter (where m.toss_decision = 'bat' and m.winner = m.toss_winner) toss_bat_won,
             count(*) filter (where m.toss_decision = 'field' and m.winner = m.toss_winner) toss_field_won,
             min(m.date) f, max(m.date) l
      from matches m join MV mv using (match_id)
      left join IT i1 on i1.match_id = m.match_id and i1.inn = 1 left join IT i2 on i2.match_id = m.match_id and i2.inn = 2
      group by all"""):
        if x["vkey"] in keep:
            slot(x)["sum"] = {k: r(v, 1) for k, v in x.items() if k not in ("vkey", "fam", "gender")}
    for x in rows(con, """select mv.vkey, i.fam, i.gender, i.inn, count(*) n, round(avg(i.runs), 1) runs, round(sum(i.runs) / greatest(sum(i.wkts), 1), 1) rpw
                          from IT i join MV mv using (match_id) where i.inn <= 4 group by all order by i.inn"""):
        if x["vkey"] in keep:
            slot(x).setdefault("inns", []).append([x["inn"], x["n"], x["runs"], x["rpw"]])
    for x in rows(con, """select mv.vkey, b.fam, b.gender, coalesce(b.btype, 'unknown') t, count(*) filter (where b.bowler_wkt) w,
                                 count(*) filter (where b.is_legal) bl, sum(b.bowl_runs) r
                          from BXE b join MV mv using (match_id) group by all"""):
        if x["vkey"] in keep:
            slot(x).setdefault("type", []).append([x["t"], x["w"], x["bl"], x["r"]])
    for x in rows(con, """select mv.vkey, b.fam, b.gender, b.phase, count(distinct b.match_id) m, sum(b.r_tot) r, count(*) filter (where b.is_legal) bl, sum(b.n_wkts) w
                          from BXE b join MV mv using (match_id) where b.fam not in ('TEST', 'FC') and b.inn <= 2 group by all order by b.phase"""):
        if x["vkey"] in keep:
            slot(x).setdefault("phase", []).append([x["phase"], x["m"], x["r"], x["bl"], x["w"]])
    for x in rows(con, f"""select mv.vkey, b.fam, b.gender, least(c.cum // {DAY_BALLS}, 4) + 1 dy, sum(b.r_tot) r, count(*) filter (where b.is_legal) bl,
                                 sum(b.n_wkts) w, count(*) filter (where b.bowler_wkt and b.btype = 'pace') wp, count(*) filter (where b.bowler_wkt and b.btype is not null) wt
                          from BXE b join BCUM c using (match_id, inn, seq) join MV mv on mv.match_id = b.match_id group by all order by dy"""):
        if x["vkey"] in keep:
            slot(x).setdefault("days", []).append([x["dy"], x["r"], x["bl"], x["w"], x["wp"], x["wt"]])
    for kind, tab, sql, order in (("bat", "BI", "count(*) i, sum(runs) r, sum(balls) b, count(*) filter (where is_out) o, max(runs) hs", "sum(runs)"),
                                  ("bowl", "BW", "count(*) i, sum(wkts) w, sum(balls) b, sum(runs) r", "sum(wkts)")):
        for x in rows(con, f"""select * from (select mv.vkey, t.fam, t.gender, t.player, {sql},
                                 row_number() over (partition by mv.vkey, t.fam, t.gender order by {order} desc) rn
                               from {tab} t join MV mv using (match_id) group by mv.vkey, t.fam, t.gender, t.player) where rn <= 8 order by rn"""):
            if x["vkey"] in keep:
                vals = [x["player"], names.get(x["player"], (x["player"],))[0]] + [x[c] for c in (("i", "r", "b", "o", "hs") if kind == "bat" else ("i", "w", "b", "r"))]
                slot(x).setdefault(kind, []).append(vals)
    for x in rows(con, """select * from (select mv.vkey, i.fam, i.gender, i.match_id, i.inn, i.bat, i.bowl, i.runs, i.wkts, i.balls, m.date,
                                 row_number() over (partition by mv.vkey, i.fam, i.gender order by i.runs desc) rn
                               from IT i join MV mv using (match_id) join matches m using (match_id)) where rn <= 5 order by rn"""):
        if x["vkey"] in keep:
            slot(x).setdefault("high", []).append([x["match_id"], x["inn"], x["bat"], x["bowl"], x["runs"], x["wkts"], x["balls"], x["date"]])
    for x in rows(con, """select * from (select mv.vkey, i.fam, i.gender, i.match_id, i.bat, i.bowl, i.runs, i.wkts, m.date,
                                 row_number() over (partition by mv.vkey, i.fam, i.gender order by i.runs desc) rn
                               from IT i join MV mv using (match_id) join matches m using (match_id)
                               where m.result = 'win' and m.winner = i.bat and i.inn = case when i.fam in ('TEST', 'FC') then 4 else 2 end) where rn <= 3 order by rn"""):
        if x["vkey"] in keep:
            slot(x).setdefault("chase", []).append([x["match_id"], x["bat"], x["bowl"], x["runs"], x["wkts"], x["date"]])
    for x in rows(con, """select * from (select mv.vkey, m.match_id, m.date, m.fmt, m.gender, m.team1, m.team2, m.winner, m.result, m.by_runs, m.by_wkts,
                                 row_number() over (partition by mv.vkey order by m.date desc) rn
                               from matches m join MV mv using (match_id)) where rn <= 12 order by rn"""):
        if x["vkey"] in keep:
            V[x["vkey"]]["recent"].append([x["match_id"], x["date"], x["fmt"], x["gender"], x["team1"], x["team2"], x["winner"], x["result"], x["by_runs"], x["by_wkts"]])
    for x in idx:
        d = V[x["vkey"]]
        d.update({"key": x["vkey"], "name": x["name"], "city": x["city"], "host": x["host"], "n": x["n"], "from": x["f"], "to": x["l"]})
        w.write(f"venues/{x['vkey']}.json", d)
    w.write("venues/index.json", [[x["vkey"], x["name"], x["city"], x["host"], x["n"], x["f"], x["l"], x["intl"],
                                   {fk: f["sum"]["n"] for fk, f in V[x["vkey"]]["fmts"].items() if "sum" in f}] for x in idx])
    return len(idx)


# ---------------------------------------------------------------- records and oddities
def export_records(con, w, names):
    r, rows = _h()
    out_n = 0
    for fam, g, fm in ((f, g, fm) for f in ("TEST", "ODI", "T20") for g in ("male", "female") for fm in (True, False)):
        if True:
            p = [fam, g]
            # fm: both sides full members; otherwise every international
            C = f"m.lvl_intl and m.team1 in ({FULL_SQL}) and m.team2 in ({FULL_SQL})" if fm else "m.lvl_intl"
            if not con.execute(f"select count(*) from matches m where {C} and m.fmt = ? and m.gender = ?", p).fetchone()[0]:
                continue
            multi = fam == "TEST"
            last_inn = 4 if multi else 2
            R, ids = {}, set()
            M = f"matches m where {C} and m.fmt = ? and m.gender = ?"

            def q(key, sql, params=p, cols=None):
                res = rows(con, sql, params)
                R[key] = [[r(x[c], 3) for c in (cols or x.keys())] for x in res]
                for x in res:
                    for c in ("player", "p1", "p2"):
                        if x.get(c):
                            ids.add(x[c])

            q("chases", f"""select i.match_id, m.date, i.bat, i.bowl, i.runs, i.wkts, m.venue from IT i join matches m using (match_id)
                            where {C} and m.fmt = ? and m.gender = ? and m.result = 'win' and m.winner = i.bat and i.inn = {last_inn}
                            order by i.runs desc limit 15""")
            if not multi:
                q("defended", f"""select i.match_id, m.date, i.bat, i.bowl, i.runs, i.wkts, m.venue from IT i join matches m using (match_id) where {C} and m.fmt = ? and m.gender = ?
                                 and i.inn = 1 and m.result = 'win' and m.winner = i.bat and m.method is null
                                 and (i.wkts >= 10 or i.balls >= i.quota) order by i.runs limit 15""")
            q("narrow_runs", f"""select m.match_id, m.date, m.winner, case when m.winner = m.team1 then m.team2 else m.team1 end loser, m.by_runs, m.venue
                                from {M} and m.by_runs is not null and m.method is null order by m.by_runs, m.date desc limit 15""")
            if multi:
                q("narrow_wkts", f"""select m.match_id, m.date, m.winner, case when m.winner = m.team1 then m.team2 else m.team1 end loser, m.by_wkts, m.venue
                                    from {M} and m.by_wkts is not null order by m.by_wkts, m.date desc limit 15""")
            else:
                q("narrow_wkts", f"""select m.match_id, m.date, m.winner, case when m.winner = m.team1 then m.team2 else m.team1 end loser, m.by_wkts,
                                           greatest(i.quota - i.balls, 0) left_b, m.venue
                                    from {M.replace('matches m', 'matches m join IT i on i.match_id = m.match_id and i.inn = 2')}
                                    and m.by_wkts is not null and m.method is null order by m.by_wkts + greatest(i.quota - i.balls, 0) / 1000.0, m.date desc limit 15""")
            q("ties", f"""select m.match_id, m.date, m.team1, m.team2, m.venue from {M} and m.result = 'tie' order by m.date desc limit 15""")
            q("ducks", f"""select player, count(*) filter (where runs = 0 and is_out) ducks, count(*) filter (where runs = 0 and is_out and balls <= 1) golden, count(*) inns
                          from BI join matches m using (match_id) where {C} and BI.fam = ? and BI.gender = ? group by 1 order by 2 desc, 4 limit 15""")
            q("longest", f"""select BI.match_id, m.date, player, team, opp, runs, balls, is_out from BI join matches m using (match_id)
                            where {C} and BI.fam = ? and BI.gender = ? order by balls desc limit 15""")
            q("sixes", f"""select BI.match_id, m.date, player, team, opp, s6, runs, balls from BI join matches m using (match_id)
                          where {C} and BI.fam = ? and BI.gender = ? order by s6 desc, runs desc limit 15""")
            fast = rows(con, f"""
              with b as (select match_id, inn, batter, sum(r_bat) over w cr, sum(faced::int) over w cb from BXE
                         where match_id in (select match_id from matches m where {C}) and fam = ? and gender = ? window w as (partition by match_id, inn, batter order by seq))
              select match_id, batter player, min(cb) filter (where cr >= 50) b50, min(cb) filter (where cr >= 100) b100 from b group by all""", p)
            dates = {x[0]: (x[1], x[2], x[3]) for x in con.execute(f"select match_id, date, team1, team2 from matches m where {C} and m.fmt = ? and m.gender = ?", p).fetchall()}
            for key, col in (("fast50", "b50"), ("fast100", "b100")):
                lst = sorted((x for x in fast if x[col]), key=lambda x: (x[col], dates.get(x["match_id"], ("",))[0]))[:15]
                R[key] = [[x["match_id"], dates.get(x["match_id"], ("",))[0], x["player"], x[col]] for x in lst]
                ids |= {x["player"] for x in lst}
            q("best_bowling", f"""select BW.match_id, m.date, player, team, opp, wkts, runs, balls from BW join matches m using (match_id)
                                 where {C} and BW.fam = ? and BW.gender = ? order by wkts desc, runs limit 15""")
            if not multi:
                mn = 24 if fam == "T20" else 60
                q("econ", f"""select BW.match_id, m.date, player, team, opp, balls, runs, wkts from BW join matches m using (match_id)
                              where {C} and BW.fam = ? and BW.gender = ? and balls >= {mn} order by 1.0 * runs / balls, wkts desc limit 15""")
            q("expensive", f"""select BW.match_id, m.date, player, team, opp, balls, runs, wkts from BW join matches m using (match_id)
                              where {C} and BW.fam = ? and BW.gender = ? order by runs desc limit 15""")
            q("partnerships", f"""select b.match_id, any_value(m.date) date, b.inn, b.wkts_before + 1 wkt, any_value(b.bat_team) team, sum(b.r_tot) runs,
                                        count(*) filter (where b.is_legal) balls, min(b.batter) p1, max(b.batter) p2
                                 from BXE b join matches m using (match_id) where {C} and b.fam = ? and b.gender = ? and not coalesce(b.super_over, false)
                                 group by b.match_id, b.inn, b.wkts_before order by runs desc limit 15""")
            if not multi:
                q("comebacks", f"""select b.match_id, any_value(m.date) date, any_value(m.winner) winner,
                                         any_value(case when m.winner = m.team1 then m.team2 else m.team1 end) loser,
                                         min(case when b.bat_team = m.winner then b.wp_before else 1 - b.wp_before end) low,
                                         arg_min(b.inn, case when b.bat_team = m.winner then b.wp_before else 1 - b.wp_before end) inn,
                                         arg_min(b.over, case when b.bat_team = m.winner then b.wp_before else 1 - b.wp_before end) ov
                                  from BXE b join matches m using (match_id) where {C} and b.fam = ? and b.gender = ? and m.result = 'win'
                                    and b.wp_before is not null and b.inn <= 2 group by b.match_id order by low limit 15""")
            q("top_scores", f"""select BI.match_id, m.date, player, team, opp, runs, balls, is_out from BI join matches m using (match_id)
                               where {C} and BI.fam = ? and BI.gender = ? order by runs desc, balls limit 15""")
            R["names"] = {i: names.get(i, (i,))[0] for i in ids}
            R["matches"] = con.execute(f"select count(*) from matches m where {C} and m.fmt = ? and m.gender = ?", p).fetchone()[0]
            w.write(f"records/{fam}-{g}{'-fm' if fm else ''}.json", R)
            out_n += 1
    return out_n


# ---------------------------------------------------------------- on this day
def export_onthisday(con, w, names):
    r, rows = _h()
    days = defaultdict(lambda: defaultdict(list))
    ids = defaultdict(set)
    I = "m.lvl_intl and m.fmt in ('TEST', 'ODI', 'T20')"
    for x in rows(con, f"""select substr(m.date, 6, 5) md, m.year, b.player, b.runs, b.balls, b.is_out, b.team, b.opp, m.fmt, m.gender, m.match_id
                          from BI b join matches m using (match_id) where {I} and b.runs >= 100
                          order by (m.team1 in ({FULL_SQL}) and m.team2 in ({FULL_SQL})) desc, b.runs desc"""):
        days[x["md"][:2]][x["md"]].append(["bat", x["year"], x["player"], x["runs"], x["balls"], x["is_out"], x["team"], x["opp"], x["fmt"], x["gender"], x["match_id"]])
        ids[x["md"][:2]].add(x["player"])
    for x in rows(con, f"""select substr(m.date, 6, 5) md, m.year, b.player, b.wkts, b.runs, b.balls, b.team, b.opp, m.fmt, m.gender, m.match_id
                          from BW b join matches m using (match_id) where {I} and b.wkts >= 5
                          order by (m.team1 in ({FULL_SQL}) and m.team2 in ({FULL_SQL})) desc, b.wkts desc, b.runs"""):
        days[x["md"][:2]][x["md"]].append(["bowl", x["year"], x["player"], x["wkts"], x["runs"], x["balls"], x["team"], x["opp"], x["fmt"], x["gender"], x["match_id"]])
        ids[x["md"][:2]].add(x["player"])
    for x in rows(con, f"""select substr(m.date, 6, 5) md, m.year, m.team1, m.team2, m.winner, m.result, m.by_runs, m.by_wkts, m.fmt, m.gender, m.match_id
                          from matches m where {I} and (m.result = 'tie' or m.by_runs <= 2 or m.by_wkts = 1)
                          order by (m.team1 in ({FULL_SQL}) and m.team2 in ({FULL_SQL})), m.date"""):
        days[x["md"][:2]][x["md"]].append(["close", x["year"], x["team1"], x["team2"], x["winner"], x["result"], x["by_runs"], x["by_wkts"], x["fmt"], x["gender"], x["match_id"]])
    for mm, dd in days.items():
        out = {}
        for md, items in dd.items():
            # keep the best few of each kind per day: men's internationals are rarer per day than they look
            bat = [i for i in items if i[0] == "bat"][:8]
            bowl = [i for i in items if i[0] == "bowl"][:6]
            close = [i for i in items if i[0] == "close"][-4:]
            out[md] = bat + bowl + close
        w.write(f"onthisday/{mm}.json", {"days": out, "names": {i: names.get(i, (i,))[0] for i in ids[mm]}})


# ---------------------------------------------------------------- card game deck
def export_deck(con, w, names):
    r, rows = _h()
    n = 0
    for fam in ("TEST", "ODI", "T20"):
        for g in ("male", "female"):
            p = [fam, g]
            res = rows(con, f"""
              with ap as (select a.player, mode(a.team) team, count(distinct a.match_id) mt, max(m.year) last, min(m.year) first
                          from appearances a join matches m using (match_id) where m.lvl_intl and m.fmt = ? and m.gender = ? group by 1),
                   bt as (select player, sum(runs) r, sum(balls) b, count(*) filter (where is_out) o, count(*) filter (where runs >= 100) c100,
                                 count(*) filter (where runs >= 50 and runs < 100) c50, sum(s6) s6, max(runs) hs, round(sum(imp), 0) imp
                          from BI join matches m using (match_id) where m.lvl_intl and BI.fam = ? and BI.gender = ? group by 1),
                   bw as (select player, sum(wkts) w, sum(balls) b, sum(runs) r, count(*) filter (where wkts >= 5) w5, max(wkts * 1000 - runs) best, round(sum(imp), 0) imp
                          from BW join matches m using (match_id) where m.lvl_intl and BW.fam = ? and BW.gender = ? group by 1)
              select ap.*, bt.r, bt.b, bt.o, bt.c100, bt.c50, bt.s6, bt.hs, bt.imp bimp, bw.w, bw.b wb, bw.r wr, bw.w5, bw.best, bw.imp wimp
              from ap left join bt using (player) left join bw using (player)
              where ap.team in ({FULL_SQL}) and ap.mt >= {8 if fam == 'TEST' else 12}
              order by ap.mt desc""", p + p + p)
            deck = []
            for x in res:
                rb, wb = x["b"] or 0, x["wb"] or 0
                if rb < 120 and wb < 240:
                    continue
                best = x["best"]
                bf = None
                if best is not None and (x["w"] or 0) > 0:
                    wk = -(-int(best) // 1000)
                    bf = f"{wk}/{wk * 1000 - int(best)}"
                deck.append([x["player"], names.get(x["player"], (x["player"],))[0], x["team"], x["mt"], x["first"], x["last"],
                             x["r"] or 0, r((x["r"] or 0) / max(x["o"] or 0, 1), 1) if rb >= 120 else None,
                             r(100 * (x["r"] or 0) / rb, 1) if rb >= 120 else None, x["c100"] or 0, x["c50"] or 0, x["s6"] or 0, x["hs"] or 0,
                             x["w"] or 0, r(6 * (x["wr"] or 0) / wb, 2) if wb >= 240 else None,
                             r((x["wr"] or 0) / x["w"], 1) if wb >= 240 and x["w"] else None, bf, x["w5"] or 0,
                             int((x["bimp"] or 0) + (x["wimp"] or 0))])
            w.write(f"deck/{fam}-{g}.json", deck)
            n += len(deck)
    return n


# ---------------------------------------------------------------- era baselines and par
def _dl_fit(raw, n, step):
    """Smooth the expected-runs-to-come table into the Duckworth-Lewis shape Z(u, w) = Z0 F(w) (1 - exp(-u / (c F(w)))).
    The raw table goes flat where states are rare (say 48 overs left with 5 down), which would make par wrong early in
    a chase. Z0 and c come from the no-wicket curve before it flattens; F(w) is fitted per wicket on the overs that
    are common with that many wickets down, and never rises as wickets fall."""
    import math
    row = raw[0]
    cut = next((u for u in range(1, n + 1) if row[u] >= 0.985 * row[n]), n)
    pts = [(u, row[u]) for u in range(1, max(cut, 3) + 1)]
    best = None
    for ci in range(20, 3000):
        c = ci / 10
        g = [1 - math.exp(-u / c) for u, _ in pts]
        a = sum(y * gi for (_, y), gi in zip(pts, g)) / sum(gi * gi for gi in g)
        sse = sum((y - a * gi) ** 2 for (_, y), gi in zip(pts, g))
        if best is None or sse < best[0]:
            best = (sse, a, c)
    _, z0, c = best
    out, prev = [], 1.0
    for wk in range(10):
        pts = [(u, raw[wk][u]) for u in range(1, max(3, n - step * wk) + 1)]
        bf = None
        for fi in range(1, int(prev * 1000) + 1):
            f = fi / 1000
            sse = sum((y - z0 * f * (1 - math.exp(-u / (c * f)))) ** 2 for u, y in pts)
            if bf is None or sse < bf[0]:
                bf = (sse, f)
        prev = bf[1]
        out.append([round(z0 * prev * (1 - math.exp(-u / (c * prev))), 1) for u in range(n + 1)])
    return out


def export_baselines(con, w):
    r, rows = _h()
    # era baselines per format and year: batting from the top seven (so tail-enders don't drag the average down),
    # bowling from everyone. Rows: [year, bat SR, bat avg, economy, balls per wicket]
    bowl_y = {(x["fam"], x["gender"], x["year"]): x for x in rows(con, """
        select fam, gender, year, sum(bowl_runs) br, count(*) filter (where is_legal) lb, count(*) filter (where bowler_wkt) bw
        from BXE group by all""")}
    eras = defaultdict(list)
    for x in rows(con, """select fam, gender, year, sum(runs) rb, sum(balls) fb, count(*) filter (where is_out) o
                          from BI where pos <= 7 group by all having sum(balls) >= 3000 order by year"""):
        b = bowl_y.get((x["fam"], x["gender"], x["year"]), {})
        eras[f"{x['fam']}-{x['gender']}"].append([x["year"], r(100 * x["rb"] / x["fb"], 2), r(x["rb"] / max(x["o"], 1), 2),
                                                  r(6 * (b.get("br") or 0) / max(b.get("lb") or 0, 1), 3), r((b.get("lb") or 0) / max(b.get("bw") or 0, 1), 2)])
    w.write("eras.json", eras)
    par = {}
    for fam, n in (("ODI", 50), ("T20", 20)):
        for g in ("male", "female"):
            tab = con.execute("select w, blb, re from RE where fam = ? and gender = ? and blb <= ? order by w, blb", [fam, g, n]).fetchall()
            if not tab:
                continue
            raw = [[0.0] * (n + 1) for _ in range(10)]
            for wk, blb, re in tab:
                if 0 <= wk < 10:
                    raw[wk][blb] = float(re)
            par[f"{fam}-{g}"] = {"overs": n, "re": _dl_fit(raw, n, 5 if fam == "ODI" else 2)}
    w.write("par.json", par)

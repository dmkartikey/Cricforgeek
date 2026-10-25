"""Derived tables used by the exporters: enriched balls, batting and bowling innings."""
from __future__ import annotations

import json
from pathlib import Path

SEEDS = Path(__file__).parent / "seeds"


def zones_config() -> dict:
    return json.loads((SEEDS / "zones.json").read_text())


FULL_MEMBERS = ("Afghanistan", "Australia", "Bangladesh", "England", "India", "Ireland", "New Zealand", "Pakistan",
                "South Africa", "Sri Lanka", "West Indies", "Zimbabwe")
TOP_DOMESTIC = ("Australia", "Bangladesh", "England", "India", "Ireland", "New Zealand", "Pakistan", "South Africa",
                "Sri Lanka", "West Indies", "UAE", "USA")
# Presentation formats, as cricket records them: Tests, first-class, ODIs, List A, T20 (T20Is + leagues), The Hundred
FMT_SQL = """case when {c} in ('men-test', 'women-test') then 'TEST' when {f} = 'MD' then 'FC'
                  when {c} in ('men-odi', 'women-odi') then 'ODI' when {f} = 'ODI' then 'LA' else {f} end"""


def prepare(con):
    cfg = zones_config()
    full = ", ".join(f"'{t}'" for t in FULL_MEMBERS)
    dom = ", ".join(f"'{t}'" for t in TOP_DOMESTIC)
    con.execute(f"""
    create or replace table MATCHES_T as
    select m.*, {FMT_SQL.format(c='m.comp', f='m.family')} as fmt,
           m.team_type = 'international' as lvl_intl,
           case when m.team_type = 'international' then m.team1 in ({full}) and m.team2 in ({full})
                else m.country in ({dom}) end as lvl_top
    from matches m""")
    con.execute("create or replace view matches as select * from MATCHES_T")
    style_rows = [(s, g, v["type"]) for g, v in cfg["bowler_groups"].items() for s in v["styles"]]
    con.execute("create or replace table STYLEMAP (style varchar, grp varchar, btype varchar)")
    con.executemany("insert into STYLEMAP values (?,?,?)", style_rows)
    con.execute("""
    create or replace table P as
    select p.*, s.grp as bgrp, s.btype,
           case p.bat_style when 'lhb' then 'L' when 'rhb' then 'R' end as hand
    from players p left join STYLEMAP s on s.style = p.bowl_style
    """)

    # Wicketkeeper per match and fielding side: whoever made a stumping in the match,
    # otherwise the side's leading stumper that season who played in this match.
    con.execute("""
    create or replace table KEEPER as
    with st as (
      select match_id, bowl_team as team, season, unnest(string_split(fielders, ',')) as k
      from BX where wkt_kind = 'stumped' and fielders is not null),
    mk as (select match_id, team, mode(k) k from st group by all),
    sk as (select season, team, k, count(*) n from st group by all),
    cand as (
      select a.match_id, a.team, arg_max(sk.k, sk.n) k
      from appearances a join matches m using (match_id)
      join sk on sk.season = m.season and sk.team = a.team and sk.k = a.player
      group by all)
    select coalesce(mk.match_id, cand.match_id) match_id, coalesce(mk.team, cand.team) team,
           coalesce(mk.k, cand.k) keeper, mk.k is not null as sure
    from mk full outer join cand using (match_id, team)
    """)

    fmt_b = FMT_SQL.format(c="b.comp", f="b.fam")
    con.execute(f"""
    create or replace table BXE as
    select b.* replace ({fmt_b} as fam), b.fam as mfam, mt.lvl_intl, mt.lvl_top, mt.team_type,
      pb.bgrp, pb.btype, pk.hand as bat_hand,
      case when b.wkt_kind is null or not b.striker_out then null
           when b.wkt_kind = 'bowled' then 'bowled'
           when b.wkt_kind = 'lbw' then 'lbw'
           when b.wkt_kind = 'stumped' then 'stumped'
           when b.wkt_kind = 'caught and bowled' then 'cab'
           when b.wkt_kind = 'hit wicket' then 'hitwicket'
           when b.wkt_kind = 'caught' and k.keeper is not null and b.fielders = k.keeper then 'keeper'
           when b.wkt_kind = 'caught' then 'field'
           when b.wkt_kind = 'run out' then 'runout'
           else 'other' end as dcat,
      case when b.faced and b.byes + b.legbyes = 0 then coalesce(b.dwp, 0) else 0 end as bat_wpa,
      case when b.byes + b.legbyes = 0 and coalesce(b.wkt_kind, '') <> 'run out' then -coalesce(b.dwp, 0) else 0 end as bowl_wpa,
      (b.r_bat = 4) as four, (b.r_bat = 6) as six,
      case when b.li is null then null when b.li >= 1.5 then 'high' when b.li >= 0.75 then 'mid' else 'low' end as lev
    from BX b
    left join P pb on pb.player = b.bowler
    left join P pk on pk.player = b.batter
    left join KEEPER k on k.match_id = b.match_id and k.team = b.bowl_team
    left join MATCHES_T mt on mt.match_id = b.match_id
    """)

    # Batting innings
    con.execute("""
    create or replace table BI as
    with app as (
      select match_id, inn, batter as player, min(seq) s from BX group by all
      union all
      select match_id, inn, non_striker, min(seq) from BX group by all),
    pos as (
      select match_id, inn, player, row_number() over (partition by match_id, inn order by s) pos
      from (select match_id, inn, player, min(s) s from app group by all)),
    outs as (
      select match_id, inn, out_id as player, any_value(wkt_kind) kind, any_value(bowler) by_bowler,
             any_value(dcat) dcat, any_value(fielders) fielders
      from BXE where out_id is not null and wkt_kind not in ('retired hurt', 'retired not out')
      group by all),
    entry as (
      select b.match_id, b.inn, p.player, min_by(b.legal_before, b.seq) e_balls,
             min_by(b.score_before, b.seq) e_score, min_by(b.wkts_before, b.seq) e_wkts
      from BXE b join (select match_id, inn, player, min(s) s from app group by all) p
        on p.match_id = b.match_id and p.inn = b.inn and p.s = b.seq group by all),
    agg as (
      select match_id, inn, batter as player, any_value(bat_team) team, any_value(bowl_team) opp,
        any_value(fam) fam, any_value(gender) gender, any_value(comp) comp, any_value(season) season,
        any_value(year) as year, any_value(date) as date, any_value(venue_key) venue_key,
        sum(r_bat) runs, count(*) filter (where faced) balls, count(*) filter (where four) f4,
        count(*) filter (where six) s6, count(*) filter (where faced and r_bat = 0) dots,
        sum(xbat_r) filter (where faced) xr, sum(xbat_out) filter (where faced) xo,
        sum(bat_val) imp, sum(bat_wpa) wpa
      from BXE group by all)
    select pos.match_id, pos.inn, pos.player, a.* exclude (match_id, inn, player),
           pos.pos, o.kind, o.by_bowler, o.dcat, o.fielders, o.player is not null as is_out,
           e.e_balls, e.e_score, e.e_wkts
    from pos
    left join agg a on a.match_id = pos.match_id and a.inn = pos.inn and a.player = pos.player
    left join outs o on o.match_id = pos.match_id and o.inn = pos.inn and o.player = pos.player
    left join entry e on e.match_id = pos.match_id and e.inn = pos.inn and e.player = pos.player
    """)
    # Fill context for non-strikers who never faced
    con.execute("""
    update BI set team = m.bat_team, opp = m.bowl_team, fam = m.fam, gender = m.gender, comp = m.comp,
      season = m.season, year = m.year, date = m.date, venue_key = m.venue_key, runs = 0, balls = 0,
      f4 = 0, s6 = 0, dots = 0, xr = 0, xo = 0, imp = 0, wpa = 0
    from (select match_id, inn, any_value(bat_team) bat_team, any_value(bowl_team) bowl_team, any_value(fam) fam,
                 any_value(gender) gender, any_value(comp) comp, any_value(season) season, any_value(year) as year,
                 any_value(date) as date, any_value(venue_key) venue_key from BXE group by all) m
    where BI.team is null and m.match_id = BI.match_id and m.inn = BI.inn
    """)

    # Bowling innings
    con.execute("""
    create or replace table BW as
    select match_id, inn, bowler as player, any_value(bowl_team) team, any_value(bat_team) opp,
      any_value(fam) fam, any_value(gender) gender, any_value(comp) comp, any_value(season) season,
      any_value(year) as year, any_value(date) as date, any_value(venue_key) venue_key,
      count(*) filter (where is_legal) balls, sum(bowl_runs) runs, count(*) filter (where bowler_wkt) wkts,
      count(*) filter (where is_legal and bowl_runs = 0) dots, count(*) filter (where four) f4,
      count(*) filter (where six) s6, sum(wides) wides, sum(noballs) noballs,
      sum(xbowl_r) xr, sum(xbowl_w) xw, sum(bowl_val) imp, sum(bowl_wpa) wpa
    from BXE group by all
    """)

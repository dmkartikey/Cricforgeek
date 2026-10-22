"""Context models built from the ball-by-ball table.

1. Expected outcome per ball: average batter runs, dismissal chance, bowler runs
   and bowler wicket chance for the same format, gender, innings, over and
   wickets down, scaled to the competition-season's scoring level ("era").
2. Run expectancy (limited overs): expected runs still to come given balls
   left and wickets down. Gives the run value of a wicket.
3. Win probability (limited overs): logistic models for the first innings
   (projected total vs par) and the chase (runs needed vs resources left).
4. Leverage index: how much a ball in this state typically moves win probability.

Everything is stored in the DuckDB connection as table BX (one row per ball).
"""
from __future__ import annotations

import numpy as np

LIMITED = ("T20", "HUN", "ODI")


def _base(con):
    con.execute("""
    create or replace table B as
    select b.*, m.family as fam, m.gender, m.comp, m.season, m.year, m.date, m.tier, m.method,
           m.result, m.winner, m.balls_per_over as bpo, m.venue_key,
           case m.family when 'T20' then 120 when 'HUN' then 100 when 'ODI' then 300 end as full_balls,
           case when m.family in ('T20','HUN','ODI') then
                coalesce(case when b.inn = 2 then b.target_balls end,
                         cast(m.overs * m.balls_per_over as integer),
                         case m.family when 'T20' then 120 when 'HUN' then 100 else 300 end)
           end as inn_balls,
           (b.wides = 0) as faced,
           (b.out_id = b.batter and b.n_wkts > 0) as striker_out,
           b.r_tot - b.byes - b.legbyes as bowl_runs,
           case m.family
             when 'T20' then case when b.over < 6 then 0 when b.over < 15 then 1 else 2 end
             when 'HUN' then case when b.legal_before < 25 then 0 when b.legal_before < 75 then 1 else 2 end
             when 'ODI' then case when b.over < 10 then 0 when b.over < 40 then 1 else 2 end
             else case when b.over < 20 then 0 when b.over < 80 then 1 else 2 end
           end as phase,
           case m.family
             when 'T20' then least(b.over, 19)
             when 'HUN' then least(b.legal_before // 5, 19)
             when 'ODI' then least(b.over, 49)
             else least(b.over // 10, 15)
           end as ctx_over,
           case when m.family = 'MD' then least(b.inn, 4) else least(b.inn, 2) end as inn_grp
    from balls b join matches m using (match_id)
    where not b.super_over
    """)


def _expected(con):
    con.execute("""
    create or replace table CTX as
    with cell as (
      select fam, gender, inn_grp, ctx_over, least(wkts_before, 9) as w,
             count(*) n_del, avg(bowl_runs) e_bowl_r, avg(bowler_wkt::int) e_bowl_w,
             count(*) filter (where faced) n_faced,
             avg(r_bat) filter (where faced) e_bat_r,
             avg(striker_out::int) filter (where faced) e_bat_out
      from B group by all),
    parent as (
      select fam, gender, inn_grp, ctx_over,
             sum(n_del*e_bowl_r)/sum(n_del) p_bowl_r, sum(n_del*e_bowl_w)/sum(n_del) p_bowl_w,
             sum(n_faced*e_bat_r)/sum(n_faced) p_bat_r, sum(n_faced*e_bat_out)/sum(n_faced) p_bat_out
      from cell group by all)
    select c.fam, c.gender, c.inn_grp, c.ctx_over, c.w,
           (n_del*e_bowl_r + 200*p_bowl_r)/(n_del+200) e_bowl_r,
           (n_del*e_bowl_w + 200*p_bowl_w)/(n_del+200) e_bowl_w,
           (n_faced*coalesce(e_bat_r,0) + 200*p_bat_r)/(n_faced+200) e_bat_r,
           (n_faced*coalesce(e_bat_out,0) + 200*p_bat_out)/(n_faced+200) e_bat_out
    from cell c join parent p using (fam, gender, inn_grp, ctx_over)
    """)
    # Era factors per competition-season, shrunk towards 1
    con.execute("""
    create or replace table ERA as
    select comp, season,
      (sum(r_bat) filter (where faced) + 2000) / (sum(e_bat_r) filter (where faced) + 2000) f_bat_r,
      (sum(striker_out::int) filter (where faced) + 60) / (sum(e_bat_out) filter (where faced) + 60) f_bat_out,
      (sum(bowl_runs) + 2000) / (sum(e_bowl_r) + 2000) f_bowl_r,
      (sum(bowler_wkt::int) + 60) / (sum(e_bowl_w) + 60) f_bowl_w,
      sum(r_tot) / greatest(sum(n_wkts), 1) runs_per_wkt
    from B join CTX on B.fam=CTX.fam and B.gender=CTX.gender and B.inn_grp=CTX.inn_grp
                    and B.ctx_over=CTX.ctx_over and least(B.wkts_before,9)=CTX.w
    group by all
    """)


def _run_expectancy(con):
    """Expected runs still to come by balls-left bucket (ceil(balls/6)) and wickets down."""
    rows = con.execute("""
    with inn as (
      select match_id, inn, max(score_before + r_tot) final
      from B where inn = 1 and fam in ('T20','HUN','ODI') and method is null
        and inn_balls = full_balls and result <> 'no result'
      group by all)
    select B.fam, B.gender, (B.full_balls - B.legal_before + 5) // 6 as blb, B.wkts_before as w,
           avg(i.final - B.score_before) re, count(*) n
    from B join inn i using (match_id, inn)
    where B.wkts_before < 10 group by all
    """).fetchall()
    cells = {}
    for fam, g, blb, w, re_, n in rows:
        cells.setdefault((fam, g), {})[(blb, w)] = (re_, n)
    out = []
    for (fam, g), d in cells.items():
        grid = np.zeros((51, 10))
        for w in range(10):
            for blb in range(1, 51):
                re_, n = d.get((blb, w), (None, 0))
                prior = grid[blb, w - 1] * 0.8 if w > 0 else (grid[blb - 1, w] + 7 if blb > 1 else 7)
                grid[blb, w] = prior if not n else (re_ * n + prior * 20) / (n + 20)
        # runs to come rise with balls left and fall with wickets down
        grid = np.maximum.accumulate(grid, axis=0)
        grid = np.minimum.accumulate(grid, axis=1)
        out += [(fam, g, blb, w, float(grid[blb, w])) for blb in range(51) for w in range(10)]
    con.execute("create or replace table RE (fam varchar, gender varchar, blb integer, w integer, re double)")
    con.executemany("insert into RE values (?,?,?,?,?)", out)


def _fit_logit(X, y, l2=1e-3, iters=30):
    X = np.column_stack([np.ones(len(X)), X])
    w = np.zeros(X.shape[1])
    for _ in range(iters):
        p = 1 / (1 + np.exp(-X @ w))
        g = X.T @ (p - y) + l2 * w
        H = (X * (p * (1 - p))[:, None]).T @ X + l2 * np.eye(len(w))
        step = np.linalg.solve(H, g)
        w -= step
        if np.abs(step).max() < 1e-8:
            break
    return w


def _wp(con, report: dict):
    # Par first-innings score per competition-season
    con.execute("""
    create or replace table PAR as
    with f as (
      select match_id, comp, season, fam, gender, max(score_before + r_tot) total
      from B where inn = 1 and fam in ('T20','HUN','ODI') and method is null and inn_balls = full_balls
        and result <> 'no result' group by all),
    fg as (select fam, gender, avg(total) fg from f group by all)
    select comp, season, (sum(total) + 10*any_value(fg)) / (count(*) + 10) par
    from f join fg using (fam, gender) group by all
    """)
    con.execute("""
    create or replace table WPF as
    select B.match_id, B.inn, B.seq, B.fam, B.gender, B.bat_team,
      B.inn_balls - B.legal_before as bl, B.wkts_before, B.score_before, B.target,
      coalesce(r.re, 0) as re, p.par, B.legal_before::double / B.inn_balls as prog,
      B.method is null and B.result in ('win','tie') as train,
      case when B.result = 'tie' then 0.5 when B.winner = B.bat_team then 1.0 else 0.0 end as y
    from B
    left join RE r on r.fam=B.fam and r.gender=B.gender and r.w=B.wkts_before
                  and r.blb = least((greatest(B.inn_balls - B.legal_before, 0) + 5) // 6, 50)
    left join PAR p on p.comp=B.comp and p.season=B.season
    where B.fam in ('T20','HUN','ODI') and B.inn in (1,2) and B.wkts_before < 10 and B.inn_balls > B.legal_before
      and B.result in ('win','tie')
    """)
    coefs = {}
    for fam in LIMITED:
        for gender in ("male", "female"):
            # first innings: z = (projected - par)/par
            a = con.execute("""
              select (score_before + re - par)/par z, prog, y from WPF
              where fam=? and gender=? and inn=1 and train and par is not null
              using sample reservoir(1500000 rows) repeatable (42)""", [fam, gender]).fetchnumpy()
            if len(a["y"]) < 1000:
                continue
            z, pr, y = a["z"], a["prog"], a["y"]
            w1 = _fit_logit(np.column_stack([z, z * pr, pr]), y)
            # chase: q = runs needed / expected runs left
            c = con.execute("""
              select ln(greatest((target - score_before)/(re + 1), 0.02)) lq, (10 - wkts_before)/10.0 wl,
                     bl::double / ? frac, y from WPF
              where fam=? and gender=? and inn=2 and train and target is not null and target - score_before > 0
              using sample reservoir(1500000 rows) repeatable (42)""", [{"T20": 120, "HUN": 100, "ODI": 300}[fam], fam, gender]).fetchnumpy()
            lq, wl, fr, y2 = c["lq"], c["wl"], c["frac"], c["y"]
            w2 = _fit_logit(np.column_stack([lq, wl, fr, lq * fr, lq * wl]), y2)
            coefs[(fam, gender)] = (w1, w2)
            # calibration: predicted vs actual in deciles (chase model)
            X2 = np.column_stack([np.ones(len(lq)), lq, wl, fr, lq * fr, lq * wl])
            p2 = 1 / (1 + np.exp(-X2 @ w2))
            bins = np.clip((p2 * 10).astype(int), 0, 9)
            report.setdefault("wp_calibration", {})[f"{fam}-{gender}"] = [
                {"pred": round(float(p2[bins == k].mean()), 3), "actual": round(float(y2[bins == k].mean()), 3),
                 "n": int((bins == k).sum())} for k in range(10) if (bins == k).any()]
            ll = -np.mean(y2 * np.log(p2 + 1e-9) + (1 - y2) * np.log(1 - p2 + 1e-9))
            report.setdefault("wp_logloss", {})[f"{fam}-{gender}"] = round(float(ll), 4)
    rows = []
    for (fam, gender), (w1, w2) in coefs.items():
        rows.append((fam, gender, *map(float, w1), *map(float, w2)))
    con.execute("create or replace table WPC (fam varchar, gender varchar, a0 double, a1 double, a2 double, a3 double,"
                " c0 double, c1 double, c2 double, c3 double, c4 double, c5 double)")
    con.executemany("insert into WPC values (?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    report["wp_coefficients"] = {f"{r[0]}-{r[1]}": [round(x, 4) for x in r[2:]] for r in rows}

    # Win probability before each ball, batting side's view
    con.execute("""
    create or replace table WP as
    select f.match_id, f.inn, f.seq,
      case
        when f.inn = 1 then 1/(1+exp(-(c.a0 + c.a1*((score_before+re-par)/par) + c.a2*((score_before+re-par)/par)*prog + c.a3*prog)))
        when target - score_before <= 0 then 1.0
        else 1/(1+exp(-(c.c0 + c.c1*ln(greatest((target-score_before)/(re+1),0.02)) + c.c2*((10-wkts_before)/10.0)
             + c.c3*(bl::double/fb) + c.c4*ln(greatest((target-score_before)/(re+1),0.02))*(bl::double/fb)
             + c.c5*ln(greatest((target-score_before)/(re+1),0.02))*((10-wkts_before)/10.0))))
      end as wp_before
    from (select *, case fam when 'T20' then 120 when 'HUN' then 100 else 300 end as fb from WPF) f
    join WPC c using (fam, gender)
    where f.inn = 1 or f.target is not null
    """)


def build_models(con, report: dict):
    _base(con)
    _expected(con)
    _run_expectancy(con)
    _wp(con, report)
    con.execute("""
    create or replace table BX as
    with x as (
      select B.*,
        ctx.e_bat_r * e.f_bat_r as xbat_r, ctx.e_bat_out * e.f_bat_out as xbat_out,
        ctx.e_bowl_r * e.f_bowl_r as xbowl_r, ctx.e_bowl_w * e.f_bowl_w as xbowl_w,
        case when B.fam = 'MD' then e.runs_per_wkt
             else coalesce(r1.re, 0) - coalesce(r2.re, 0) end as wv,
        wp.wp_before
      from B
      join CTX ctx on ctx.fam=B.fam and ctx.gender=B.gender and ctx.inn_grp=B.inn_grp
                  and ctx.ctx_over=B.ctx_over and ctx.w=least(B.wkts_before,9)
      join ERA e on e.comp=B.comp and e.season=B.season
      left join RE r1 on r1.fam=B.fam and r1.gender=B.gender and r1.w=B.wkts_before
           and r1.blb = least((greatest(B.inn_balls - B.legal_before - B.is_legal::int, 0) + 5)//6, 50)
      left join RE r2 on r2.fam=B.fam and r2.gender=B.gender and r2.w=B.wkts_before+1
           and r2.blb = least((greatest(B.inn_balls - B.legal_before - B.is_legal::int, 0) + 5)//6, 50)
      left join WP wp on wp.match_id=B.match_id and wp.inn=B.inn and wp.seq=B.seq),
    fin as (  -- result from the first-innings batting side's view, and chase start WP
      select match_id,
        any_value(case when result='tie' then 0.5 when winner = bat_team then 1.0 else 0.0 end) filter (where inn=2) as y2,
        min_by(wp_before, seq) filter (where inn=2) as chase_start
      from x where fam <> 'MD' group by 1)
    select x.*,
      case when x.wp_before is null then null
           when lead(x.wp_before) over w is not null then lead(x.wp_before) over w
           when x.inn = 1 then 1 - fin.chase_start
           when x.inn = 2 then fin.y2 end as wp_after
    from x left join fin using (match_id)
    window w as (partition by x.match_id, x.inn order by x.seq)
    """)
    con.execute("""
    alter table BX add column dwp double;
    update BX set dwp = wp_after - wp_before;
    alter table BX add column bat_val double;
    alter table BX add column bowl_val double;
    update BX set bat_val = case when faced then (r_bat - xbat_r) - (striker_out::int - xbat_out) * wv end,
                  bowl_val = (xbowl_r - bowl_runs) + (bowler_wkt::int - xbowl_w) * wv;
    """)
    # Leverage index
    con.execute("""
    create or replace table LI as
    select fam, inn, (inn_balls - legal_before)//12 blb, least(wkts_before,9) w, round(wp_before*10) wpb,
           avg(abs(dwp)) m, count(*) n
    from BX where dwp is not null group by all
    """)
    con.execute("""
    create or replace table BX as
    select BX.*, case when BX.dwp is null then null else
      (li.m*li.n + fm.m*50)/(li.n+50) / fm.m end as li
    from BX
    left join LI li on li.fam=BX.fam and li.inn=BX.inn and li.blb=(BX.inn_balls-BX.legal_before)//12
       and li.w=least(BX.wkts_before,9) and li.wpb=round(BX.wp_before*10)
    left join (select fam, avg(abs(dwp)) m from BX where dwp is not null group by 1) fm on fm.fam=BX.fam
    """)
    re_tab = con.execute("select fam, gender, blb, w, round(re,1) from RE where gender='male' order by all").fetchall()
    report["run_expectancy"] = {}
    for fam, g, blb, w, re in re_tab:
        report["run_expectancy"].setdefault(fam, {}).setdefault(str(w), []).append(re)

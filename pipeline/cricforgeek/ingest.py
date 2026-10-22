"""Parse the Cricsheet JSON archive into flat Parquet tables.

Tables written to <work>/:
  balls.parquet        one row per delivery
  matches.parquet      one row per match
  appearances.parquet  one row per player per match
  players.parquet      one row per player (id, name, styles)
  innings.parquet      one row per innings (declared, forfeited, follow-on order, target)
"""
from __future__ import annotations

import csv
import json
import re
import zipfile
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from .competitions import classify, family, slug

TEAM_ALIASES = {
    "Delhi Daredevils": "Delhi Capitals",
    "Kings XI Punjab": "Punjab Kings",
    "Royal Challengers Bangalore": "Royal Challengers Bengaluru",
    "Rising Pune Supergiants": "Rising Pune Supergiant",
}

BALL_COLS = [
    ("match_id", pa.string()), ("inn", pa.int8()), ("super_over", pa.bool_()),
    ("bat_team", pa.string()), ("bowl_team", pa.string()),
    ("over", pa.int16()), ("seq", pa.int32()), ("legal_no", pa.int32()),
    ("batter", pa.string()), ("bowler", pa.string()), ("non_striker", pa.string()),
    ("r_bat", pa.int8()), ("r_ext", pa.int8()), ("r_tot", pa.int8()),
    ("wides", pa.int8()), ("noballs", pa.int8()), ("byes", pa.int8()), ("legbyes", pa.int8()),
    ("is_legal", pa.bool_()),
    ("wkt_kind", pa.string()), ("out_id", pa.string()), ("n_wkts", pa.int8()),
    ("bowler_wkt", pa.bool_()), ("fielders", pa.string()),
    ("score_before", pa.int16()), ("wkts_before", pa.int8()), ("legal_before", pa.int32()),
    ("target", pa.int16()), ("target_balls", pa.int16()),
]
BOWLER_KINDS = {"caught", "bowled", "lbw", "caught and bowled", "stumped", "hit wicket"}
NOT_DISMISSAL = {"retired hurt", "retired not out"}


def _venue_base(venue: str, city: str | None) -> str:
    v = venue.strip()
    if city and v.lower().endswith(", " + city.lower()):
        v = v[: -(len(city) + 2)]
    v = re.sub(r"\s+", " ", v)
    return v


def team_key(team: str, gender: str) -> str:
    return slug(team) + ("-women" if gender == "female" else "")


def _new_cols():
    return {c: [] for c, _ in BALL_COLS}


def ingest(zip_path: Path, work: Path, people_csv: Path | None, styles_csv: Path | None, limit: int | None = None) -> dict:
    work.mkdir(parents=True, exist_ok=True)
    schema = pa.schema(BALL_COLS)
    writer = pq.ParquetWriter(work / "balls.parquet", schema, compression="zstd")
    cols = _new_cols()
    matches, apps, inns = [], [], []
    names: dict[str, str] = {}
    n = 0

    def flush():
        nonlocal cols
        if cols["match_id"]:
            writer.write_table(pa.table(cols, schema=schema))
            cols = _new_cols()

    with zipfile.ZipFile(zip_path) as z:
        members = sorted(m for m in z.namelist() if m.endswith(".json"))
        for m in members:
            if limit and n >= limit:
                break
            j = json.loads(z.read(m))
            info = j["info"]
            mid = Path(m).stem
            gender = info.get("gender", "male")
            bpo = info.get("balls_per_over", 6)
            fam = family(info["match_type"], bpo)
            reg = info.get("registry", {}).get("people", {})
            for nm, pid in reg.items():
                names.setdefault(pid, nm)
            pid = lambda nm: reg.get(nm, "~" + nm)  # noqa: E731
            comp = classify(info)
            teams = [TEAM_ALIASES.get(t, t) for t in info["teams"]]
            tmap = dict(zip(info["teams"], teams))
            out = info.get("outcome", {})
            winner = tmap.get(out.get("winner"), out.get("winner"))
            result = "win" if winner else (out.get("result") or "unknown")
            if out.get("eliminator") or out.get("bowl_out"):
                winner = tmap.get(out.get("eliminator") or out.get("bowl_out"))
                result = "tie"  # decided by super over / bowl-out
            toss = info.get("toss", {})
            city = info.get("city")
            venue = _venue_base(info.get("venue", "Unknown"), city)
            matches.append({
                "match_id": mid, "date": info["dates"][0], "year": int(info["dates"][0][:4]),
                "season": str(info.get("season")), "match_type": info["match_type"], "family": fam,
                "gender": gender, "team_type": info.get("team_type"), **comp,
                "team1": teams[0], "team2": teams[1],
                "team1_key": team_key(teams[0], gender), "team2_key": team_key(teams[1], gender),
                "venue": venue, "venue_key": slug(venue), "city": city,
                "toss_winner": tmap.get(toss.get("winner")), "toss_decision": toss.get("decision"),
                "winner": winner, "result": result,
                "by_runs": (out.get("by") or {}).get("runs"), "by_wkts": (out.get("by") or {}).get("wickets"),
                "method": out.get("method"), "balls_per_over": bpo, "overs": info.get("overs"),
                "pom": ",".join(pid(p) for p in info.get("player_of_match", [])),
            })
            for t, plist in info.get("players", {}).items():
                for p in plist:
                    apps.append({"match_id": mid, "team": tmap.get(t, t), "player": pid(p)})

            for ii, inn in enumerate(j.get("innings", []), start=1):
                bat = tmap.get(inn["team"], inn["team"])
                bowl = teams[1] if bat == teams[0] else teams[0]
                sup = bool(inn.get("super_over"))
                tgt = inn.get("target") or {}
                t_runs = tgt.get("runs")
                t_balls = int(round(float(tgt["overs"]) * bpo)) if tgt.get("overs") else None
                inns.append({"match_id": mid, "inn": ii, "team": bat, "super_over": sup,
                             "declared": bool(inn.get("declared")), "forfeited": bool(inn.get("forfeited")),
                             "target": t_runs})
                score = wk = legal = seq = 0
                for ov in inn.get("overs", []):
                    for d in ov["deliveries"]:
                        seq += 1
                        ex = d.get("extras", {})
                        wd, nb = ex.get("wides", 0), ex.get("noballs", 0)
                        is_legal = not wd and not nb
                        r = d["runs"]
                        ws = d.get("wickets", [])
                        real = [w for w in ws if w["kind"] not in NOT_DISMISSAL]
                        w0 = ws[0] if ws else None
                        cols["match_id"].append(mid); cols["inn"].append(ii); cols["super_over"].append(sup)
                        cols["bat_team"].append(bat); cols["bowl_team"].append(bowl)
                        cols["over"].append(ov["over"]); cols["seq"].append(seq)
                        cols["legal_no"].append(legal + (1 if is_legal else 0))
                        cols["batter"].append(pid(d["batter"])); cols["bowler"].append(pid(d["bowler"]))
                        cols["non_striker"].append(pid(d["non_striker"]))
                        cols["r_bat"].append(r["batter"]); cols["r_ext"].append(r["extras"]); cols["r_tot"].append(r["total"])
                        cols["wides"].append(wd); cols["noballs"].append(nb)
                        cols["byes"].append(ex.get("byes", 0)); cols["legbyes"].append(ex.get("legbyes", 0))
                        cols["is_legal"].append(is_legal)
                        cols["wkt_kind"].append(w0["kind"] if w0 else None)
                        cols["out_id"].append(pid(w0["player_out"]) if w0 else None)
                        cols["n_wkts"].append(len(real))
                        cols["bowler_wkt"].append(any(w["kind"] in BOWLER_KINDS for w in ws))
                        fl = [f.get("name") for w in ws for f in w.get("fielders", []) if f.get("name") and not f.get("substitute")]
                        cols["fielders"].append(",".join(pid(f) for f in fl) if fl else None)
                        cols["score_before"].append(score); cols["wkts_before"].append(wk)
                        cols["legal_before"].append(legal)
                        cols["target"].append(t_runs); cols["target_balls"].append(t_balls)
                        score += r["total"]; wk += len(real); legal += 1 if is_legal else 0
            n += 1
            if len(cols["match_id"]) > 400_000:
                flush()
    flush()
    writer.close()

    pq.write_table(pa.Table.from_pylist(matches), work / "matches.parquet", compression="zstd")
    pq.write_table(pa.Table.from_pylist(apps), work / "appearances.parquet", compression="zstd")
    pq.write_table(pa.Table.from_pylist(inns), work / "innings.parquet", compression="zstd")

    # Players: Cricsheet register name + optional style seed
    full = {}
    if people_csv and people_csv.exists():
        with open(people_csv, newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                full[row["identifier"]] = row.get("unique_name") or row["name"]
    styles = {}
    if styles_csv and styles_csv.exists():
        with open(styles_csv, newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                styles[row["identifier"]] = (row["bat_style"], row["bowl_style"])
    prow = [{"player": k, "name": v, "unique_name": full.get(k, v),
             "bat_style": styles.get(k, ("", ""))[0] or None, "bowl_style": styles.get(k, ("", ""))[1] or None}
            for k, v in names.items()]
    pq.write_table(pa.Table.from_pylist(prow), work / "players.parquet", compression="zstd")
    return {"matches": n, "players": len(prow)}

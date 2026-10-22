"""Quick checks that run without the Cricsheet archive: python -m pytest pipeline/tests"""
import io
import json
import zipfile

import duckdb

from cricforgeek.competitions import classify, family
from cricforgeek.export import _best, zone_profile
from cricforgeek.ingest import ingest
from cricforgeek.prep import zones_config


def test_family():
    assert family("T20", 6) == "T20"
    assert family("T20", 5) == "HUN"
    assert family("ODM", 6) == "ODI"
    assert family("MDM", 6) == "MD"


def test_sponsor_names_merge():
    a = classify({"match_type": "MDM", "team_type": "club", "event": {"name": "LV= County Championship"}})
    b = classify({"match_type": "MDM", "team_type": "club", "event": {"name": "Specsavers County Championship"}})
    assert a["comp"] == b["comp"] == "county-championship"
    assert a["tier"] == "first-class"
    intl = classify({"match_type": "Test", "team_type": "international", "gender": "male"})
    assert intl["comp"] == "men-test"


def test_best_figures_decode():
    assert _best(5 * 1000 - 23) == "5/23"
    assert _best(0 * 1000 - 40) == "0/40"
    assert _best(3 * 1000 - 0) == "3/0"


def test_zone_profile_shapes():
    cfg = zones_config()
    base = {"bowled": 0.01, "lbw": 0.01, "keeper": 0.01}
    z = zone_profile({"lbw": 10}, 400, base, cfg)
    assert len(z["grid"]) == 5 and len(z["grid"][0]) == 4
    # all the evidence is LBW, so the stumps line must be the hottest line for full balls
    assert max(range(4), key=lambda j: z["grid"][1][j]) == 2


def _match(mid, winner="A"):
    deliveries = [{"batter": "a1", "bowler": "b1", "non_striker": "a2", "runs": {"batter": 4, "extras": 0, "total": 4}},
                  {"batter": "a1", "bowler": "b1", "non_striker": "a2", "runs": {"batter": 0, "extras": 1, "total": 1},
                   "extras": {"wides": 1}},
                  {"batter": "a1", "bowler": "b1", "non_striker": "a2", "runs": {"batter": 0, "extras": 0, "total": 0},
                   "wickets": [{"kind": "bowled", "player_out": "a1"}]}]
    return {"info": {"dates": ["2024-04-01"], "season": "2024", "match_type": "T20", "gender": "male", "team_type": "club",
                     "event": {"name": "Indian Premier League"}, "teams": ["A", "B"], "venue": "Ground, City", "city": "City",
                     "balls_per_over": 6, "overs": 20, "toss": {"winner": "A", "decision": "bat"},
                     "outcome": {"winner": winner, "by": {"runs": 5}},
                     "players": {"A": ["a1", "a2"], "B": ["b1"]},
                     "registry": {"people": {"a1": "id_a1", "a2": "id_a2", "b1": "id_b1"}}},
            "innings": [{"team": "A", "overs": [{"over": 0, "deliveries": deliveries}]}]}


def test_ingest_counts(tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("1.json", json.dumps(_match("1")))
    zp = tmp_path / "all.zip"
    zp.write_bytes(buf.getvalue())
    res = ingest(zp, tmp_path / "work", None, None)
    assert res["matches"] == 1
    con = duckdb.connect()
    row = con.execute(f"select count(*), sum(r_tot), count(*) filter (where is_legal), max(n_wkts), "
                      f"max(venue_key) from '{tmp_path}/work/balls.parquet', '{tmp_path}/work/matches.parquet'").fetchone()
    assert row[:4] == (3, 5, 2, 1)
    assert row[4] == "ground"

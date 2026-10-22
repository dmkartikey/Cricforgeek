"""Command line entry point: python -m cricforgeek.build --zip all_json.zip --out ../web/public/data"""
from __future__ import annotations

import argparse
import os
import json
import time
from pathlib import Path

import duckdb

from .export import export_all
from .ingest import ingest
from .models import build_models
from .prep import SEEDS, prepare


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", required=True, type=Path, help="Cricsheet all_json.zip")
    ap.add_argument("--people", type=Path, help="Cricsheet register people.csv")
    ap.add_argument("--work", type=Path, default=Path("work"))
    ap.add_argument("--out", type=Path, default=Path("../web/public/data"))
    ap.add_argument("--limit", type=int, help="only the first N matches (for quick tests)")
    ap.add_argument("--skip-ingest", action="store_true")
    ap.add_argument("--skip-models", action="store_true", help="reuse the DuckDB file from the last run")
    a = ap.parse_args()

    t0 = time.time()
    log = lambda m: print(f"[{time.time() - t0:6.1f}s] {m}", flush=True)  # noqa: E731
    if not a.skip_ingest:
        log(f"ingest {ingest(a.zip, a.work, a.people, SEEDS / 'player_styles.csv', a.limit)}")
    db = a.work / "cricforgeek.duckdb"
    if not a.skip_models:
        db.unlink(missing_ok=True)
    con = duckdb.connect(str(db))
    con.execute("set enable_progress_bar = false")
    con.execute(f"set memory_limit = '{os.environ.get('CFG_MEMORY', '6GB')}'")
    con.execute("set preserve_insertion_order = false")
    con.execute(f"set temp_directory = '{a.work / 'tmp'}'")
    for t in ("balls", "matches", "appearances", "players"):
        con.execute(f"create or replace view {t} as select * from '{a.work / (t + '.parquet')}'")
    rep_file = a.work / "report.json"
    if a.skip_models:
        report = json.loads(rep_file.read_text())
    else:
        report = {}
        build_models(con, report)
        log("models built")
        prepare(con)
        log("derived tables built")
        rep_file.write_text(json.dumps(report))
    res = export_all(con, a.out, report)
    log(f"export {json.dumps(res)}")


if __name__ == "__main__":
    main()

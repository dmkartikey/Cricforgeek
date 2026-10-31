"""Large accuracy benchmark: many phone set-ups, each with a session of deliveries fitted together, in parallel.
Usage: python -m nets.bench_sessions SESSIONS BALLS [workers] [out.json]
"""
import sys, json, time
import numpy as np
from multiprocessing import Pool

from .bench_fit import run_sessions, summary


def _one(args):
    s, balls = args
    try:
        return run_sessions(1, balls=balls, seed0=s)
    except Exception as e:  # keep going; report the failure
        return [{"fail": 1, "session": s, "error": repr(e)}]


def main():
    n = int(sys.argv[1]); balls = int(sys.argv[2])
    workers = int(sys.argv[3]) if len(sys.argv) > 3 else 4
    out = sys.argv[4] if len(sys.argv) > 4 else None
    t = time.time()
    with Pool(workers) as p:
        rows = [r for rr in p.imap_unordered(_one, [(s, balls) for s in range(20000, 20000 + n)]) for r in rr]
    print(f"{n} sessions x {balls} balls in {time.time() - t:.0f}s")
    summary(rows, "all")
    for f in (30, 60, 120, 240):
        summary([r for r in rows if r.get("fps") == f], f"  {f} fps:")
    if out:
        json.dump(rows, open(out, "w"))


if __name__ == "__main__":
    main()

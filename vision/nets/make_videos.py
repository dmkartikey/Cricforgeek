"""Render a batch of synthetic net videos in parallel. Usage: python -m nets.make_videos OUT START COUNT [workers]"""
import sys, os
from multiprocessing import Pool

from .render import render_delivery

OUT = None


def _one(seed):
    if os.path.exists(os.path.join(OUT, f"{seed}.json")):
        return seed
    try:
        render_delivery(seed, OUT)
    except Exception as e:
        print("seed", seed, "failed:", repr(e), flush=True)
    return seed


if __name__ == "__main__":
    OUT = sys.argv[1]
    start, count = int(sys.argv[2]), int(sys.argv[3])
    workers = int(sys.argv[4]) if len(sys.argv) > 4 else 4
    os.makedirs(OUT, exist_ok=True)
    with Pool(workers) as p:
        for i, s in enumerate(p.imap_unordered(_one, range(start, start + count))):
            if i % 25 == 0:
                print(i, "done", flush=True)

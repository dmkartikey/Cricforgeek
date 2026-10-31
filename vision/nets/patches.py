"""Training examples for the ball network, cut from rendered videos.

For each sampled frame: the motion candidates (labelled ball / not ball by distance to the true centre), plus a
positive cut a few pixels off the true ball (so the network learns to point at the centre from anywhere in the patch,
which also lets the tracker ask "is the ball near here?" at a predicted spot).
Usage: python -m nets.patches VIDEO_DIR OUT.npz [from:to (video index range)] [workers]
"""
import sys, os, glob, json
import numpy as np
import cv2
from multiprocessing import Pool

from .detect import gray, candidates, patch, gap_for, PATCH


def frames_of(mp4):
    cap = cv2.VideoCapture(mp4)
    out = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        out.append(gray(f))
    return out


def from_video(js, neg_per_frame=int(os.environ.get("NEG_PER_FRAME", 6)), frame_budget=int(os.environ.get("FRAME_BUDGET", 60)), seed=0):
    meta = json.load(open(js))
    fr = frames_of(js[:-5] + ".mp4")
    rng = np.random.default_rng(meta["seed"] + seed)
    k = gap_for(meta["camera"]["fps"])
    labs = meta["frames"]
    idx = list(range(k, len(fr) - k))
    if len(idx) > frame_budget:
        idx = sorted(rng.choice(idx, frame_budget, replace=False))
    X, Y = [], []  # Y: is_ball, dx, dy, radius
    for i in idx:
        L = labs[i]
        ball = L.get("released") and "u" in L and L.get("inframe") and L.get("vis", 0) >= 0.3
        in_hand = (not L.get("released")) and "u" in L
        cands, _ = candidates(fr[i - k], fr[i], fr[i + k], max_n=60)
        negs = []
        for (u, v, s, snr) in cands:
            dist = np.hypot(u - L["u"], v - L["v"]) if "u" in L else 1e9
            if ball and dist < max(3.0, L["r"] + 2.0):
                p, (cu, cv_) = patch(fr[i - k], fr[i], fr[i + k], u, v)
                X.append(p); Y.append((1, L["u"] - cu, L["v"] - cv_, L["r"]))
            elif dist < max(6.0, L.get("r", 0) * 2 + 4):
                continue  # too close to call (ball partly hidden, or still in the hand): leave out
            else:
                negs.append((u, v))
        for j in rng.permutation(len(negs))[:neg_per_frame]:
            u, v = negs[j]
            p, _ = patch(fr[i - k], fr[i], fr[i + k], u, v)
            X.append(p); Y.append((0, 0.0, 0.0, 0.0))
        if ball:
            for _ in range(2):
                u, v = L["u"] + rng.uniform(-7, 7), L["v"] + rng.uniform(-7, 7)
                p, (cu, cv_) = patch(fr[i - k], fr[i], fr[i + k], u, v)
                X.append(p); Y.append((1, L["u"] - cu, L["v"] - cv_, L["r"]))
        # hard negatives: random spots on the busiest parts of the picture (people, stumps, net)
        for _ in range(2):
            u, v = rng.uniform(0, fr[i].shape[1]), rng.uniform(0, fr[i].shape[0])
            if "u" in L and np.hypot(u - L["u"], v - L["v"]) < 20:
                continue
            p, _ = patch(fr[i - k], fr[i], fr[i + k], u, v)
            X.append(p); Y.append((0, 0.0, 0.0, 0.0))
    if not X:
        return None
    return np.stack(X).astype(np.float16), np.array(Y, np.float32)


def _job(js):
    try:
        return from_video(js)
    except Exception as e:
        print("failed", js, repr(e), flush=True)
        return None


if __name__ == "__main__":
    vdir, out = sys.argv[1], sys.argv[2]
    a, b = (sys.argv[3] if len(sys.argv) > 3 else "0:100000").split(":")
    workers = int(sys.argv[4]) if len(sys.argv) > 4 else 4
    files = sorted(glob.glob(os.path.join(vdir, "*.json")))[int(a):int(b)]
    Xs, Ys = [], []
    with Pool(workers) as p:
        for r in p.imap_unordered(_job, files):
            if r is not None:
                Xs.append(r[0]); Ys.append(r[1])
    X, Y = np.concatenate(Xs), np.concatenate(Ys)
    np.savez(out, X=X, Y=Y)
    print(len(files), "videos", X.shape, "positives", int(Y[:, 0].sum()))

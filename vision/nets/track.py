"""Chain per-frame detections into ball flights.

A flight in the image is smooth: between frames the ball moves by roughly the same step, changing slowly, except at
the bounce where its vertical motion turns round. The tracker grows chains from confident seeds, predicting the next
position from the last steps and accepting the best detection inside a gate. The best-scoring chains that do not
overlap in time are the deliveries.
"""
import numpy as np


def _logit(p):
    p = min(max(p, 1e-4), 1 - 1e-4)
    return np.log(p / (1 - p))


def find_tracks(dets, fps, min_len=6, max_tracks=50, min_score=0.25):
    """dets: list per frame of lists of (u, v, p, r). Returns tracks: list of dicts with 'frames' [(i, u, v, p, r)]
    and 'score', best first, not overlapping in time."""
    n = len(dets)
    step_frames = max(1, int(round(fps / 60)))  # how far apart to pair seeds
    max_gap = max(2, int(round(fps / 20)))      # frames the ball may go undetected inside a track
    pool = [[d for d in fr if d[2] >= min_score] for fr in dets]
    seeds = sorted(((d[2], i, j) for i, fr in enumerate(pool) for j, d in enumerate(fr) if d[2] >= 0.6), reverse=True)
    tracks = []
    used = set()
    for _, i, j in seeds[:400]:
        if (i, j) in used:
            continue
        a = pool[i][j]
        # partner: the best detection a few frames later at a plausible distance
        best = None
        for gap in range(1, 3 * step_frames + 1):
            k = i + gap
            if k >= n:
                break
            for jj, b in enumerate(pool[k]):
                dist = np.hypot(b[0] - a[0], b[1] - a[1])
                if 0.3 * gap < dist < 120 * gap * 60 / fps and (best is None or b[2] > best[0]):
                    best = (b[2], k, jj)
            if best:
                break
        if not best:
            continue
        chain = [(i, j), (best[1], best[2])]
        chain = _grow(pool, chain, +1, max_gap)
        chain = _grow(pool, chain[::-1], -1, max_gap)[::-1]
        if len(chain) < min_len:
            continue
        sc = sum(_logit(pool[f][q][2]) + 2.0 for f, q in chain)
        tracks.append((sc, chain))
    tracks.sort(key=lambda t: -t[0])
    tracks = _merge(pool, tracks, max_gap)
    out, taken = [], []
    for sc, chain in tracks:
        f0, f1 = chain[0][0], chain[-1][0]
        if any(not (f1 < a or f0 > b) for a, b in taken):
            continue
        taken.append((f0, f1))
        out.append({"score": float(sc), "frames": [(f,) + tuple(pool[f][q]) for f, q in chain]})
        if len(out) >= max_tracks:
            break
    return out


def _grow(pool, chain, direction, max_gap):
    n = len(pool)
    while True:
        (f1, q1), (f2, q2) = chain[-2], chain[-1]
        p1, p2 = np.array(pool[f1][q1][:2]), np.array(pool[f2][q2][:2])
        vel = (p2 - p1) / abs(f2 - f1)  # per frame, in the direction of growth
        if len(chain) >= 3:
            f0, q0 = chain[-3]
            p0 = np.array(pool[f0][q0][:2])
            v0 = (p1 - p0) / abs(f1 - f0)
            acc = (vel - v0) / max(abs(f2 - f0) / 2, 1)
        else:
            acc = np.zeros(2)
        best = None
        for gap in range(1, max_gap + 1):
            f = f2 + direction * gap
            if f < 0 or f >= n:
                break
            pred = p2 + vel * gap + 0.5 * acc * gap * gap
            sp = np.hypot(*vel)
            gate_u = 3.0 + 0.3 * sp * gap
            gate_v = 3.0 + 0.3 * sp * gap + 2.2 * abs(vel[1]) * gap  # the bounce turns the vertical motion round
            for q, d in enumerate(pool[f]):
                du, dv = (d[0] - pred[0]) / gate_u, (d[1] - pred[1]) / gate_v
                e = du * du + dv * dv
                if e < 1 and (best is None or e - 0.3 * d[2] < best[0]):
                    best = (e - 0.3 * d[2], f, q)
            if best:
                break
        if not best:
            return chain
        chain.append((best[1], best[2]))


def _merge(pool, tracks, max_gap):
    """Join a chain with a later one that carries on from it (typically the halves either side of the bounce):
    a short time gap, and the later start close to where the earlier one was heading sideways."""
    tracks = [list(t) for t in tracks]
    changed = True
    while changed:
        changed = False
        for a in tracks:
            fa = a[1][-1][0]
            for b in tracks:
                if a is b:
                    continue
                fb = b[1][0][0]
                gap = fb - fa
                if not (0 < gap <= 3 * max_gap):
                    continue
                (f1, q1), (f2, q2) = a[1][-2], a[1][-1]
                p1, p2 = np.array(pool[f1][q1][:2]), np.array(pool[f2][q2][:2])
                vel = (p2 - p1) / (f2 - f1)
                pb = np.array(pool[fb][b[1][0][1]][:2])
                pred = p2 + vel * gap
                sp = np.hypot(*vel)
                if abs(pb[0] - pred[0]) < 4 + 0.4 * sp * gap and abs(pb[1] - pred[1]) < 4 + 2.5 * abs(vel[1]) * gap + 0.4 * sp * gap:
                    a[1] = a[1] + b[1]
                    a[0] += b[0]
                    tracks.remove(b)
                    changed = True
                    break
            if changed:
                break
    tracks.sort(key=lambda t: -t[0])
    return [tuple(t) for t in tracks]

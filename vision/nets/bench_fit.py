"""Accuracy of calibration + physics fit, without drawing video (fast, so thousands of deliveries).

Each test case: a random delivery and phone camera; the user's stump taps get pixel error; the ball's image positions
come from the exact rolling-shutter projection plus detector-like noise, with frames lost behind the bowler and at
random. Compares the fitted speed, length, line, height and swing with the truth.
Usage: python -m nets.bench_fit N [tap_px] [det_px] [miss_rate]
"""
import sys
import numpy as np

from .deliveries import random_delivery, simulate, truth, PITCH, CREASE, STUMP_W, STUMP_H, BALL_R
from .camera import random_camera
from .render import ball_samples
from .fit import calibrate, fit_delivery, fit_session

RETURN_Y = 1.32
MARK_X = (0.0, CREASE, PITCH - CREASE, PITCH)


def view(seed, tap_px=1.5, det_px=0.8, miss=0.08, fps=None, marks=True):
    rng = np.random.default_rng(seed)
    d = random_delivery(rng)
    cam, cinfo = random_camera(rng, 1280, 720, fps)
    taps = taps_for(cam, rng, tap_px, marks)
    obs, tr = ball_view(cam, d, rng, det_px, miss)
    return cam, taps, obs, tr, cinfo


def taps_for(cam, rng, tap_px=1.5, marks=True):
    # taps on the stumps that are in frame
    taps = []
    for x in (PITCH, 0.0):
        for y in (-STUMP_W / 2, STUMP_W / 2):
            for z in (0.0, STUMP_H):
                uv, zc = cam.project(np.array([[x, y, z]]))
                if zc[0] > 0 and 0 <= uv[0, 0] < cam.W and 0 <= uv[0, 1] < cam.H:
                    taps.append((uv[0, 0] + rng.normal(0, tap_px), uv[0, 1] + rng.normal(0, tap_px), (x, y, z)))
    # crease corners painted on the pitch (return crease meets the bowling and popping creases), when marked
    if marks:
        for x in MARK_X:
            for y in (-RETURN_Y, RETURN_Y):
                uv, zc = cam.project(np.array([[x, y, 0.0]]))
                if zc[0] > 0 and 0 <= uv[0, 0] < cam.W and 0 <= uv[0, 1] < cam.H:
                    taps.append((uv[0, 0] + rng.normal(0, tap_px * 1.5), uv[0, 1] + rng.normal(0, tap_px * 1.5), (x, y, 0.0)))
    return taps


def ball_view(cam, d, rng, det_px=0.8, miss=0.08, radius=True):
    ts, ps, info = simulate(d)
    tr = truth(d, info)
    vel = np.gradient(ps, ts, axis=0)
    ic = np.argmin(np.abs(ps[:, 0] - CREASE))
    tr["speed_crease_kmh"] = float(np.linalg.norm(vel[ic]) * 3.6)
    # ball observations from the frame the ball leaves the bowler's hand area until it reaches the stumps
    t0 = -rng.uniform(0.0, 1.0) / cam.fps
    t_end = info.get("t_stumps", 0.8)
    hidden = rng.uniform(0.04, 0.12)  # the first part of the flight is often behind the bowler
    obs = []
    n_sub = 5
    k = 0
    while True:
        tf = t0 + k / cam.fps
        k += 1
        if tf > t_end:
            break
        if tf < hidden or rng.random() < miss:
            continue
        samp = ball_samples(cam, ts, ps, tf, n_sub)
        u = np.mean([s[0] for s in samp]); v = np.mean([s[1] for s in samp])
        if not (0 <= u < cam.W and 0 <= v < cam.H):
            continue
        r = BALL_R * cam.f / np.mean([s[2] for s in samp])
        r_obs = max(0.5, r * (1 + rng.normal(0, 0.12)) + rng.normal(0, 0.3)) if radius else None
        obs.append((tf, u + rng.normal(0, det_px), v + rng.normal(0, det_px), r_obs))
    return obs, tr


def row_for(res, tr, fps, extra=None):
    if res is None:
        return {"fail": 1, "fps": fps}
    row = {"fail": 0, "fps": fps, "kind": tr["kind"],
           "speed": res["speed_kmh"] - tr["speed_crease_kmh"], "speed_rel": res["speed_kmh"] / tr["speed_crease_kmh"] - 1}
    for key, name in (("length_m", "length"), ("line_y", "line"), ("height_z", "height"), ("swing_m", "swing"), ("bounce_y", "bounce_line")):
        if key in res and key in tr:
            row[name] = res[key] - tr[key]
    row.update(extra or {})
    return row


def run_sessions(n_sessions, balls=6, tap_px=1.5, det_px=0.8, miss=0.08, fps=None, seed0=5000, marks=True):
    """Each session: one phone set-up, several deliveries, fitted together."""
    rows = []
    for s in range(seed0, seed0 + n_sessions):
        rng = np.random.default_rng(s)
        cam_true, cinfo = random_camera(rng, 1280, 720, fps)
        taps = taps_for(cam_true, rng, tap_px, marks)
        if len(taps) < 4:
            continue
        ds = [random_delivery(rng) for _ in range(balls)]
        views = [ball_view(cam_true, d, rng, det_px, miss) for d in ds]
        cam, res = fit_session(taps, [o for o, _ in views], 1280, 720, readout=cam_true.readout)
        dC = float(np.linalg.norm(cam.C - cam_true.C))
        for r, (_, tr) in zip(res, views):
            rows.append(row_for(r, tr, cam_true.fps, {"session": s, "dC": dC, "ntap": len(taps)}))
    return rows


def run(n, tap_px=1.5, det_px=0.8, miss=0.08, fps=None, seed0=1000):
    rows = []
    for s in range(seed0, seed0 + n):
        cam_true, taps, obs, tr, cinfo = view(s, tap_px, det_px, miss, fps)
        if len(taps) < 4:
            continue
        cam, rms = calibrate(taps, 1280, 720)
        res = fit_delivery(cam, obs, readout=cam_true.readout)
        if res is None:
            rows.append({"fail": 1, "fps": cam_true.fps})
            continue
        row = {"fail": 0, "fps": cam_true.fps, "kind": tr["kind"], "calib_rms": rms,
               "speed": res["speed_kmh"] - tr["speed_crease_kmh"], "speed_rel": res["speed_kmh"] / tr["speed_crease_kmh"] - 1}
        for key, name in (("length_m", "length"), ("line_y", "line"), ("height_z", "height"), ("swing_m", "swing"), ("bounce_y", "bounce_line")):
            if key in res and key in tr:
                row[name] = res[key] - tr[key]
        rows.append(row)
    return rows


def summary(rows, label=""):
    ok = [r for r in rows if not r["fail"]]
    print(f"{label} {len(ok)}/{len(rows)} fitted")
    for k, unit, scale in (("speed", "km/h", 1), ("length", "cm", 100), ("bounce_line", "cm", 100), ("line", "cm", 100), ("height", "cm", 100), ("swing", "cm", 100)):
        e = np.array([abs(r[k]) * scale for r in ok if k in r])
        if len(e):
            print(f"  {k:12s} median {np.median(e):6.2f} {unit:5s} 90% {np.percentile(e, 90):7.2f}   (n={len(e)})")


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 50
    tap = float(sys.argv[2]) if len(sys.argv) > 2 else 1.5
    det = float(sys.argv[3]) if len(sys.argv) > 3 else 0.8
    miss = float(sys.argv[4]) if len(sys.argv) > 4 else 0.08
    rows = run(n, tap, det, miss)
    summary(rows, f"taps ±{tap}px, detections ±{det}px, {miss:.0%} missed")
    for f in (30, 60, 120, 240):
        summary([r for r in rows if r.get("fps") == f], f"  at {f} fps:")

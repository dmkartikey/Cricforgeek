"""End to end on rendered videos: pixels -> candidates -> network -> tracks -> calibration from taps -> physics fit,
scored against the exact truth. Nothing from the renderer is used except what a user would provide (their taps, with
error) and the video file itself.
Usage: python -m nets.e2e VIDEO_DIR WEIGHTS.json [from:to] [workers] [out.json]
"""
import sys, os, glob, json
import numpy as np
import torch
from multiprocessing import Pool

from .detect import candidates, patch, gap_for
from .patches import frames_of
from .track import find_tracks
from .train_det import BallNet
from .camera import Camera
from .deliveries import Delivery, simulate, truth, PITCH, CREASE, STUMP_W, STUMP_H
from .fit import calibrate, fit_delivery, fit_session

RETURN_Y = 1.32
NET = None


def load_net(path):
    w = json.load(open(path))["weights"]
    net = BallNet()
    net.load_state_dict({k: torch.tensor(v) for k, v in w.items()})
    net.eval()
    return net


def detect_video(frames, fps, net, max_n=60):
    k = gap_for(fps)
    dets = [[] for _ in frames]
    for i in range(k, len(frames) - k):
        cands, _ = candidates(frames[i - k], frames[i], frames[i + k], max_n=max_n)
        if not cands:
            continue
        P, C = [], []
        for (u, v, s, snr) in cands:
            p, c = patch(frames[i - k], frames[i], frames[i + k], u, v)
            P.append(p); C.append(c)
        with torch.no_grad():
            out = net(torch.from_numpy(np.stack(P))).numpy()
        found = []
        for (cu, cv_), o in zip(C, out):
            p = 1 / (1 + np.exp(-o[0]))
            u, v = cu + o[1], cv_ + o[2]
            if any(np.hypot(u - f[0], v - f[1]) < 3 for f in found):
                continue
            found.append((float(u), float(v), float(p), float(max(o[3], 0.5))))
        dets[i] = found
    return dets


def _query(frames, k, i, u, v, net):
    """Ask the network about one spot in frame i: (u, v, p, r) of the ball it sees there."""
    if i - k < 0 or i + k >= len(frames):
        return None
    p, (cu, cv_) = patch(frames[i - k], frames[i], frames[i + k], u, v)
    with torch.no_grad():
        o = net(torch.from_numpy(p[None]))[0].numpy()
    return (float(cu + o[1]), float(cv_ + o[2]), float(1 / (1 + np.exp(-o[0]))), float(max(o[3], 0.5)))


def extend_track(frames, fps, track, net, p_min=0.35):
    """Fill the frames the first pass missed: inside the track by interpolation, and beyond both ends by
    extrapolating the last few points, each time asking the network to look exactly there."""
    k = gap_for(fps)
    pts = {f: (u, v, p, r) for f, u, v, p, r in track["frames"]}
    fs = sorted(pts)
    # gaps inside
    for a, b in zip(fs[:-1], fs[1:]):
        for f in range(a + 1, b):
            w = (f - a) / (b - a)
            u = pts[a][0] * (1 - w) + pts[b][0] * w
            v = pts[a][1] * (1 - w) + pts[b][1] * w
            q = _query(frames, k, f, u, v, net)
            if q and q[2] >= p_min and np.hypot(q[0] - u, q[1] - v) < 6:
                pts[f] = q
    # beyond each end
    for direction in (+1, -1):
        misses = 0
        while misses < max(3, int(fps / 30)):
            fs = sorted(pts)
            end = fs[-1] if direction > 0 else fs[0]
            near = fs[-3:] if direction > 0 else fs[:3][::-1]
            if len(near) < 3:
                break
            f = end + direction * (misses + 1)
            if f < k or f >= len(frames) - k:
                break
            P = np.array([pts[x][:2] for x in near]); T = np.array(near, float)
            c = [np.polyfit(T, P[:, j], 2 if len(set(T)) > 2 else 1) for j in range(2)]
            u, v = np.polyval(c[0], f), np.polyval(c[1], f)
            if not (0 <= u < frames[0].shape[1] and 0 <= v < frames[0].shape[0]):
                break
            step = np.hypot(*(P[-1] - P[-2])) / max(abs(T[-1] - T[-2]), 1)
            q = _query(frames, k, f, u, v, net)
            if q and q[2] >= p_min and np.hypot(q[0] - u, q[1] - v) < 3 + 0.5 * step * (misses + 1):
                pts[f] = q
                misses = 0
            else:
                misses += 1
    track = dict(track)
    track["frames"] = [(f,) + tuple(pts[f]) for f in sorted(pts)]
    return track


def user_taps(meta, rng, tap_px=1.5):
    c = meta["camera"]
    cam = Camera(W=c["W"], H=c["H"], f=c["f"], C=np.array(c["C"]), R=np.array(c["R"]), k1=c["k1"])
    pts = []
    for x in (PITCH, 0.0):
        for y in (-STUMP_W / 2, STUMP_W / 2):
            for z in (0.0, STUMP_H):
                pts.append((x, y, z, tap_px))
    for x in (0.0, CREASE, PITCH - CREASE, PITCH):
        for y in (-RETURN_Y, RETURN_Y):
            pts.append((x, y, 0.0, tap_px * 1.5))
    taps = []
    for x, y, z, s in pts:
        uv, zc = cam.project(np.array([[x, y, z]]))
        if zc[0] > 0 and 0 <= uv[0, 0] < cam.W and 0 <= uv[0, 1] < cam.H:
            taps.append((uv[0, 0] + rng.normal(0, s), uv[0, 1] + rng.normal(0, s), (x, y, z)))
    return taps


def true_numbers(meta):
    dd = meta["delivery"]
    d = Delivery(p0=np.array(dd["p0"]), v0=np.array(dd["v0"]), mass=dd["mass"], cd=dd["cd"], cs=dd["cs"],
                 e_bounce=dd["e_bounce"], k_bounce=dd["k_bounce"], dev_deg=dd["dev_deg"], kind=dd["kind"])
    ts, ps, info = simulate(d)
    tr = truth(d, info)
    vel = np.gradient(ps, ts, axis=0)
    ic = np.argmin(np.abs(ps[:, 0] - CREASE))
    tr["speed_crease_kmh"] = float(np.linalg.norm(vel[ic]) * 3.6)
    return tr


def run_one(js):
    meta = json.load(open(js))
    fps = meta["camera"]["fps"]
    frames = frames_of(js[:-5] + ".mp4")
    dets = detect_video(frames, fps, NET)
    tracks = find_tracks(dets, fps)
    tr = true_numbers(meta)
    row = {"seed": meta["seed"], "fps": fps, "outdoor": meta["camera"]["outdoor"], "kind": tr["kind"], "crf": meta["crf"]}
    # how many true ball frames the best track got right
    labs = meta["frames"]
    if not tracks:
        row["fail"] = "no track"
        return row
    best = extend_track(frames, fps, tracks[0], NET)
    good = sum(1 for f, u, v, p, r in best["frames"] if "u" in labs[f] and np.hypot(u - labs[f]["u"], v - labs[f]["v"]) < 4)
    row.update(track_len=len(best["frames"]), track_good=good,
               ball_frames=sum(1 for L in labs if L.get("released") and L.get("inframe") and L.get("vis", 0) >= 0.3))
    rng = np.random.default_rng(meta["seed"])
    taps = user_taps(meta, rng)
    readout_guess = 0.65 / fps
    obs = [(meta["t0"] + f / fps, u, v, r) for f, u, v, p, r in best["frames"]]
    # the camera is refined together with the flight (gravity and the frame clock give the scale)
    cam, res_s = fit_session(taps, [obs], meta["camera"]["W"], meta["camera"]["H"], readout=readout_guess)
    res = res_s[0]
    if res is not None and res["rms_px"] > 2.0:
        # drop the frames the flight can't explain (a wrong pick by the tracker) and fit again
        res0 = res
        from .fit import _prep, _fit_ball
        d = _prep(cam, obs, readout_guess)
        sol = _fit_ball(cam, d)
        rr = np.hypot(sol.fun[0:2 * d["n"]:2], sol.fun[1:2 * d["n"]:2])
        keep = rr < max(4.0, 3 * np.median(rr))
        order = np.argsort([o[0] for o in obs])
        obs2 = [obs[j] for j, k in zip(order, keep) if k]
        res = fit_delivery(cam, obs2, readout=readout_guess) or res0
    if res is None:
        row["fail"] = "fit"
        return row
    row["fail"] = ""
    row.update(speed=res["speed_kmh"] - tr["speed_crease_kmh"], true_speed=tr["speed_crease_kmh"], rms_px=res["rms_px"],
               speed_sd=res.get("speed_kmh_sd"))
    for key, name in (("length_m", "length"), ("line_y", "line"), ("height_z", "height"), ("swing_m", "swing"), ("bounce_y", "bounce_line")):
        if key in res and key in tr:
            row[name] = res[key] - tr[key]
    return row


def _init(path):
    global NET
    torch.set_num_threads(1)
    NET = load_net(path)


def main():
    vdir, wpath = sys.argv[1], sys.argv[2]
    a, b = (sys.argv[3] if len(sys.argv) > 3 else "0:100000").split(":")
    workers = int(sys.argv[4]) if len(sys.argv) > 4 else 4
    out = sys.argv[5] if len(sys.argv) > 5 else None
    files = sorted(glob.glob(os.path.join(vdir, "*.json")))[int(a):int(b)]
    with Pool(workers, initializer=_init, initargs=(wpath,)) as p:
        rows = list(p.imap_unordered(run_one, files))
    report(rows)
    if out:
        json.dump(rows, open(out, "w"), default=float)


def report(rows, label="all"):
    ok = [r for r in rows if not r.get("fail")]
    print(f"{label}: {len(ok)}/{len(rows)} deliveries measured", {f: sum(1 for r in rows if r.get('fail') == f) for f in ('no track', 'fit')})
    if not ok:
        return
    tg = [r["track_good"] / max(r["ball_frames"], 1) for r in rows if "track_good" in r]
    print(f"  ball frames found by the tracker: median {np.median(tg):.0%}")
    for k, unit, sc in (("speed", "km/h", 1), ("length", "cm", 100), ("line", "cm", 100), ("height", "cm", 100), ("swing", "cm", 100)):
        e = np.array([abs(r[k]) * sc for r in ok if k in r])
        if len(e):
            print(f"  {k:8s} median {np.median(e):6.2f} {unit:5s} 80% {np.percentile(e, 80):7.2f}  90% {np.percentile(e, 90):7.2f}  (n={len(e)})")
    if label == "all":
        for f in (30, 60, 120, 240):
            sub = [r for r in rows if r.get("fps") == f]
            if sub:
                report(sub, f"{f} fps")


if __name__ == "__main__":
    main()

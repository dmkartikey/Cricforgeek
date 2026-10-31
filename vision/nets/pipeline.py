"""The whole analysis of one uploaded clip, as run on the server.

video file + the user's taps -> every delivery's speed, length, line, swing, bounce (+- uncertainty) and the fitted
flight, in the same JSON shape the website draws. Frames are decoded with ffmpeg (any phone format, rotation applied)
and scaled to at most 1280 px wide, exactly like the in-browser version, so the user's taps line up.
"""
import json, os, subprocess
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import torch

from .detect import candidates, patch, gap_for, prep
from .track import find_tracks
from .train_det import BallNet
from .fit import fit_session, _results
from .deliveries import PITCH

MAX_FRAMES = 2400
_NET = None


def probe(path):
    """Width, height (after rotation), frame times in seconds."""
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height:stream_side_data=rotation:stream_tags=rotate:frame=pts_time,best_effort_timestamp_time",
                          "-of", "json", path], capture_output=True, text=True, check=True)
    info = json.loads(out.stdout)
    st = info["streams"][0]
    rot = 0
    for sd in st.get("side_data_list", []) or []:
        if "rotation" in sd:
            rot = int(sd["rotation"])
    rot = rot or int(st.get("tags", {}).get("rotate", 0) or 0)
    w, h = st["width"], st["height"]
    if abs(rot) % 180 == 90:
        w, h = h, w
    times = []
    for f in info.get("frames", []):
        t = f.get("best_effort_timestamp_time") or f.get("pts_time")
        if t is not None:
            times.append(float(t))
    return w, h, sorted(times)


def proc_size(w, h):
    s = min(1.0, 1280 / max(w, 1))
    return int(round(w * s)), int(round(h * s))


def decode(path, W, H, max_frames=MAX_FRAMES):
    """All frames as uint8 BGR arrays at W x H (ffmpeg applies the rotation flag itself)."""
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", path, "-vf", f"scale={W}:{H}", "-vsync", "passthrough",
                          "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
    n = W * H * 3
    frames = []
    while len(frames) < max_frames:
        buf = p.stdout.read(n)
        if len(buf) < n:
            break
        frames.append(np.frombuffer(buf, np.uint8).reshape(H, W, 3))
    p.stdout.close(); p.kill(); p.wait()
    return frames


def _load_net(path):
    global _NET
    if _NET is None:
        w = json.load(open(path))["weights"]
        _NET = BallNet()
        _NET.load_state_dict({k: torch.tensor(v) for k, v in w.items()})
        _NET.eval()
        torch.set_num_threads(1)
    return _NET


def _detect_range(args):
    """Runs in a worker process: detections for frames lo..hi (needs frames lo-k .. hi+k)."""
    shm_path, shape, lo, hi, k, weights = args
    frames = np.load(shm_path, mmap_mode="r")
    net = _load_net(weights)
    out = []
    cache = {}

    def get(j):
        if j not in cache:
            f = frames[j].astype(np.float32)
            cache[j] = (f, prep(f))
            for key in [x for x in cache if x < j - 2 * k - 1 and x != j]:
                del cache[key]
        return cache[j]
    for i in range(lo, hi):
        (a, pa), (b, pb), (c, pc) = get(i - k), get(i), get(i + k)
        cands, _ = candidates(a, b, c, max_n=60, preps=(pa, pb, pc))
        if not cands:
            out.append((i, [])); continue
        P, C = [], []
        for (u, v, s, snr) in cands:
            pp, cc = patch(a, b, c, u, v)
            P.append(pp); C.append(cc)
        with torch.no_grad():
            o = net(torch.from_numpy(np.stack(P))).numpy()
        found = []
        for (cu, cv_), r in zip(C, o):
            pr = 1 / (1 + np.exp(-r[0])); u, v = cu + r[1], cv_ + r[2]
            if any(np.hypot(u - f[0], v - f[1]) < 3 for f in found):
                continue
            found.append((float(u), float(v), float(pr), float(max(r[3], 0.5))))
        out.append((i, found))
    return out


def _query(frames, k, i, u, v, net):
    if i - k < 0 or i + k >= len(frames):
        return None
    a, b, c = (frames[j].astype(np.float32) for j in (i - k, i, i + k))
    p, (cu, cv_) = patch(a, b, c, u, v)
    with torch.no_grad():
        o = net(torch.from_numpy(p[None]))[0].numpy()
    return (float(cu + o[1]), float(cv_ + o[2]), float(1 / (1 + np.exp(-o[0]))), float(max(o[3], 0.5)))


def extend_track(frames, fps, track, net, p_min=0.35):
    """Fill missed frames inside the track and beyond both ends by asking the network exactly where the ball should be."""
    k = gap_for(fps)
    pts = {f: (u, v, p, r) for f, u, v, p, r in track["frames"]}
    fs = sorted(pts)
    for a, b in zip(fs[:-1], fs[1:]):
        for f in range(a + 1, b):
            w = (f - a) / (b - a)
            u = pts[a][0] * (1 - w) + pts[b][0] * w; v = pts[a][1] * (1 - w) + pts[b][1] * w
            q = _query(frames, k, f, u, v, net)
            if q and q[2] >= p_min and np.hypot(q[0] - u, q[1] - v) < 6:
                pts[f] = q
    H, W = frames[0].shape[:2]
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
            cu = [np.polyfit(T, P[:, j], 2) for j in range(2)]
            u, v = np.polyval(cu[0], f), np.polyval(cu[1], f)
            if not (0 <= u < W and 0 <= v < H):
                break
            step = np.hypot(*(P[-1] - P[-2])) / max(abs(T[-1] - T[-2]), 1)
            q = _query(frames, k, f, u, v, net)
            if q and q[2] >= p_min and np.hypot(q[0] - u, q[1] - v) < 3 + 0.5 * step * (misses + 1):
                pts[f] = q; misses = 0
            else:
                misses += 1
    return {"score": track["score"], "frames": [(f,) + tuple(pts[f]) for f in sorted(pts)]}


def is_delivery(r):
    """Keep what moves like a bowled ball (people walking about make chains too, but not ones like this)."""
    if not r:
        return False
    if not (40 <= r["speed_kmh"] <= 170) or r["rms_px"] > 4 or r.get("speed_kmh_sd", 0) > 15:
        return False
    if "height_z" not in r or not (0 <= r["height_z"] <= 3) or abs(r.get("line_y", 9)) > 2.5:
        return False
    if "length_m" in r and not (-1.5 <= r["length_m"] <= 15):
        return False
    return True


def lens_prior(lens, W, H):
    if lens not in ("normal", "wide"):
        return {}
    land = 105.0 if lens == "wide" else 69.0
    if W >= H:
        return {"hfov_deg": land, "sig_f": 0.12}
    t = (W / H) * np.tan(np.radians(land) / 2)
    return {"hfov_deg": float(np.degrees(2 * np.arctan(t))), "sig_f": 0.15}


def _camel(r):
    """Result keys as the website expects them."""
    m = {"speed_kmh": "speedKmh", "rms_px": "rmsPx", "n_obs": "nObs", "dev_deg": "devDeg", "bounce_x": "bounceX",
         "bounce_y": "bounceY", "length_m": "lengthM", "speed_bounce_kmh": "speedBounceKmh", "swing_m": "swingM",
         "line_y": "lineY", "height_z": "heightZ", "speed_kmh_sd": "speedSd", "length_m_sd": "lengthSd"}
    return {m.get(k, k): v for k, v in r.items() if k in m or k in ("cd", "cs", "e", "k", "path")}


def analyse(path, taps, W, H, weights, slow=1.0, lens="normal", workers=None, progress=lambda stage, done, total: None):
    """taps: list of {u, v, X: [x, y, z]} in W x H processing pixels. Returns the website's Analysis JSON."""
    w0, h0, times = probe(path)
    pw, ph = proc_size(w0, h0)
    if (pw, ph) != (W, H):
        # the page measured the taps on a picture of another size: scale them
        sx, sy = pw / W, ph / H
        taps = [{**t, "u": t["u"] * sx, "v": t["v"] * sy} for t in taps]
        W, H = pw, ph
    progress("decoding", 0, 1)
    frames = decode(path, W, H)
    n = len(frames)
    if n < 10:
        raise ValueError("The video is too short or could not be read.")
    times = np.array(times[:n] if len(times) >= n else np.arange(n) / 30.0) / float(slow)
    times = times - times[0]
    fps = (n - 1) / max(times[-1] - times[0], 1e-6)
    k = gap_for(fps)
    # 1. the ball in every frame, the clip split across processor cores
    stack_path = path + ".frames.npy"
    np.save(stack_path, np.stack(frames))
    workers = workers or max(1, min(8, os.cpu_count() or 1))
    idx = list(range(k, n - k))
    step = max(8, len(idx) // (workers * 4) + 1)
    jobs = [(stack_path, None, idx[i], min(idx[i] + step, n - k), k, weights) for i in range(0, len(idx), step)]
    dets = [[] for _ in range(n)]
    done = 0
    progress("finding", 0, len(idx))
    with ProcessPoolExecutor(workers) as ex:
        for res in ex.map(_detect_range, jobs):
            for i, d in res:
                dets[i] = d
            done += len(res)
            progress("finding", done, len(idx))
    os.remove(stack_path)
    # 2. flights: chains of sightings, filled in where the first pass missed the ball
    progress("tracking", 0, 1)
    net = _load_net(weights)
    min_len = max(6, int(round(fps * 0.12)))
    tracks = [t for t in find_tracks(dets, fps, min_len=min_len) if _plausible(t, fps)]
    tracks.sort(key=lambda t: t["frames"][0][0])
    tracks = [extend_track(frames, fps, t, net) for t in tracks]
    # 3. calibrate and measure every delivery together
    progress("measuring", 0, max(1, len(tracks)))
    tap_list = [(t["u"], t["v"], tuple(t["X"])) for t in taps]
    readout = 0.65 / fps
    balls = [[(float(times[f]), u, v, r) for f, u, v, p, r in t["frames"]] for t in tracks]
    if balls:
        cam, results = fit_session(tap_list, balls, W, H, readout=readout, **lens_prior(lens, W, H))
    else:
        from .fit import calibrate
        cam, _ = calibrate(tap_list, W, H, **lens_prior(lens, W, H))
        results = []
    uv = np.array([t[:2] for t in tap_list]); X = np.array([t[2] for t in tap_list], float)
    pr, _ = cam.project(X)
    calib_rms = float(np.sqrt(np.mean((pr - uv) ** 2)))
    deliveries = []
    for t, obs, r in zip(tracks, balls, results):
        if not is_delivery(r):
            continue
        deliveries.append({"track": {"score": t["score"], "frames": [list(f) for f in t["frames"]]},
                           "obs": [{"t": o[0], "u": o[1], "v": o[2], "r": o[3]} for o in obs],
                           "result": _camel(r), "tStart": obs[0][0]})
    deliveries = dedupe(deliveries)
    return {"cam": {"W": W, "H": H, "f": float(cam.f), "C": [float(x) for x in cam.C], "R": [float(x) for x in cam.R.ravel()]},
            "calibRms": calib_rms, "deliveries": deliveries, "fps": float(fps), "framesSeen": n}


def _plausible(t, fps):
    f = t["frames"]
    span = (f[-1][0] - f[0][0]) / fps
    return span >= 0.1 and np.hypot(f[-1][1] - f[0][1], f[-1][2] - f[0][2]) >= 15


def dedupe(deliveries):
    """Only one ball is in the air at a time in a net: when two found flights overlap in time they are two pieces of
    the same delivery (or a person crossing it), so keep the one measured more tightly."""
    out = []
    for d in sorted(deliveries, key=lambda d: d["tStart"]):
        t0, t1 = d["obs"][0]["t"], d["obs"][-1]["t"]
        clash = [o for o in out if not (t1 < o["obs"][0]["t"] or t0 > o["obs"][-1]["t"])]
        if not clash:
            out.append(d); continue
        o = clash[0]
        q = lambda x: (x["result"].get("speedSd", 99) or 99) / max(len(x["obs"]), 1) ** 0.5
        if q(d) < q(o):
            out[out.index(o)] = d
    return out

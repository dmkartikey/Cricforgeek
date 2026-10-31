"""Synthetic phone video of a nets delivery, with the true ball position in every frame.

The scene is ray-cast once per video (pitch, creases, side nets, back wall, sky or roof), then each frame adds the
people (a bowler running in and releasing, a batter at the far end), the stumps and the ball. The ball is drawn with
motion blur over the exposure and with the rolling-shutter skew of a phone sensor. Frames then get lighting changes,
sensor noise and real H.264 compression through ffmpeg, like a phone video.

`render_delivery(seed)` writes <out>/<seed>.mp4 and <out>/<seed>.json (camera, delivery, truth, per-frame labels).
"""
import json
import os
import subprocess
import numpy as np
import cv2

from .deliveries import PITCH, CREASE, STUMP_H, STUMP_W, BALL_R, random_delivery, simulate, position_at, truth
from .camera import random_camera

BALL_COLOURS = {"red": (0.62, 0.10, 0.08), "worn red": (0.42, 0.13, 0.10), "white": (0.92, 0.91, 0.88),
                "pink": (0.95, 0.42, 0.58)}


# ---------------------------------------------------------------- the static scene
def _noise(shape, rng, scale):
    n = rng.random((shape[0] // scale + 2, shape[1] // scale + 2)).astype(np.float32)
    return cv2.resize(n, (shape[1], shape[0]), interpolation=cv2.INTER_CUBIC)


def scene(cam, rng, outdoor):
    H, W = cam.H, cam.W
    d = cam.rays().astype(np.float32)
    C = cam.C
    img = np.zeros((H, W, 3), np.float32)
    # sky (outdoor) or roof/back wall (indoor)
    if outdoor:
        top = np.array(rng.choice([[0.55, 0.72, 0.92], [0.78, 0.82, 0.86], [0.62, 0.75, 0.88]]), np.float32)
        img[:] = top * (0.9 + 0.2 * d[..., 2:3].clip(0, 1))
    else:
        img[:] = np.array([0.30, 0.30, 0.32], np.float32) * rng.uniform(0.6, 1.2)
    t_best = np.full((H, W), np.inf, np.float32)

    # back wall / screen behind the batter
    xb = rng.uniform(23.5, 32.0)
    with np.errstate(divide="ignore", invalid="ignore"):
        tb = (xb - C[0]) / d[..., 0]
    hb = C[2] + tb * d[..., 2]
    mb = (tb > 0) & (hb < rng.uniform(3.5, 7.0)) & (hb > -0.1)
    wall = np.array(rng.choice([[0.2, 0.35, 0.22], [0.15, 0.17, 0.2], [0.55, 0.52, 0.48], [0.82, 0.82, 0.8]]), np.float32)
    nz = _noise((H, W), rng, 9)[..., None]
    img[mb] = (wall * (0.85 + 0.3 * nz))[mb]
    t_best[mb] = tb[mb]

    # ground
    with np.errstate(divide="ignore", invalid="ignore"):
        tg = -C[2] / d[..., 2]
    mg = (tg > 0) & (tg < t_best)
    gx, gy = C[0] + tg * d[..., 0], C[1] + tg * d[..., 1]
    strip = (np.abs(gy) < 1.52) & (gx > -3) & (gx < PITCH + 3)
    pitch_col = np.array(rng.choice([[0.30, 0.52, 0.28], [0.18, 0.42, 0.25], [0.62, 0.55, 0.45], [0.55, 0.50, 0.42], [0.36, 0.42, 0.50]]), np.float32)
    out_col = np.array(rng.choice([[0.32, 0.50, 0.25], [0.58, 0.57, 0.55], [0.45, 0.40, 0.33]]), np.float32)
    tex = (0.82 + 0.36 * _noise((H, W), rng, 3))[..., None]
    col = np.where(strip[..., None], pitch_col, out_col) * tex
    # creases: bowling creases through the stumps, popping creases 1.22 m in front, return creases
    lw = 0.05
    line = np.zeros((H, W), bool)
    for x0 in (0.0, CREASE, PITCH, PITCH - CREASE):
        line |= (np.abs(gx - x0) < lw / 2) & (np.abs(gy) < 1.4)
    for ys in (-1.32, 1.32):
        line |= (np.abs(gy - ys) < lw / 2) & (((gx > -1.22) & (gx < CREASE)) | ((gx > PITCH - CREASE) & (gx < PITCH + 1.22)))
    col = np.where(line[..., None], np.array([0.93, 0.93, 0.9], np.float32), col)
    # distance haze and light falloff
    col *= (1.0 - 0.15 * np.clip(tg / 40, 0, 1))[..., None]
    img[mg] = col[mg]
    t_best[mg] = tg[mg]

    # side nets: a mesh in front of whatever is behind
    yn = rng.uniform(1.6, 3.2)
    mesh = rng.uniform(0.035, 0.06)
    netcol = np.array(rng.choice([[0.08, 0.08, 0.08], [0.15, 0.2, 0.15], [0.85, 0.85, 0.85]]), np.float32)
    for s in (-1, 1):
        with np.errstate(divide="ignore", invalid="ignore"):
            tn = (s * yn - C[1]) / d[..., 1]
        px, pz = C[0] + tn * d[..., 0], C[2] + tn * d[..., 2]
        mn = (tn > 0) & (tn < t_best) & (pz > 0) & (pz < rng.uniform(3.0, 4.5)) & (px > -6) & (px < xb)
        cell = 0.05
        gridl = (np.abs(((px / cell) % 1) - 0.5) > 0.5 - mesh) | (np.abs(((pz / cell) % 1) - 0.5) > 0.5 - mesh)
        a = np.where(gridl, rng.uniform(0.5, 0.85), rng.uniform(0.05, 0.25)).astype(np.float32)
        # fine mesh aliases in the distance: blur it into a haze there
        a = cv2.GaussianBlur(a, (0, 0), 0.8)
        img[mn] = (img * (1 - a[..., None]) + netcol * a[..., None])[mn]
    return img


# ---------------------------------------------------------------- stumps and people
def _cyl(img, cam, base, top, radius, colour, mask=None):
    (u0, v0), z0 = cam.project(np.array([base]))[0][0], cam.project(np.array([base]))[1][0]
    (u1, v1), z1 = cam.project(np.array([top]))[0][0], cam.project(np.array([top]))[1][0]
    if min(z0, z1) <= 0.2:
        return
    th = max(1, int(round(2 * radius * cam.f / ((z0 + z1) / 2))))
    p0, p1 = (int(round(u0 * 4)), int(round(v0 * 4))), (int(round(u1 * 4)), int(round(v1 * 4)))
    cv2.line(img, p0, p1, colour, th, lineType=cv2.LINE_AA, shift=2)
    if mask is not None:
        cv2.line(mask, p0, p1, 1, th, lineType=cv2.LINE_8, shift=2)


def stumps(img, cam, x, mask=None, colour=(0.88, 0.85, 0.75)):
    pts = []
    for y in (-STUMP_W / 2 + 0.018, 0.0, STUMP_W / 2 - 0.018):
        _cyl(img, cam, (x, y, 0.0), (x, y, STUMP_H), 0.018, colour, mask)
        pts.append(((x, y, 0.0), (x, y, STUMP_H)))
    return pts


def person(img, cam, feet, height, lean, colour, arm=None, mask=None, skin=(0.55, 0.40, 0.30)):
    """A simple 3D figure: legs, body, head and (optionally) a bowling arm given as (shoulder, hand) points."""
    fx, fy = feet
    hip = np.array([fx + lean * 0.3, fy, height * 0.52])
    sh = np.array([fx + lean * 0.6, fy, height * 0.82])
    head = np.array([fx + lean * 0.7, fy, height * 0.93])
    parts = [((fx - 0.15, fy - 0.12, 0.0), hip, 0.08, colour), ((fx + 0.2, fy + 0.12, 0.0), hip, 0.08, colour),
             (hip, sh, 0.17, colour), (sh, head, 0.06, skin)]
    if arm is not None:
        parts.append((arm[0], arm[1], 0.05, colour))
    for a, b, r, c in parts:
        _cyl(img, cam, a, b, r, c, mask)
    (hu, hv), hz = cam.project(np.array([head]))[0][0], cam.project(np.array([head]))[1][0]
    if hz > 0.2:
        rad = max(1, int(0.11 * cam.f / hz))
        cv2.circle(img, (int(hu), int(hv)), rad, skin, -1, lineType=cv2.LINE_AA)
        if mask is not None:
            cv2.circle(mask, (int(hu), int(hv)), rad, 1, -1)


# ---------------------------------------------------------------- the ball, with blur and rolling shutter
def ball_samples(cam, ts, ps, t_frame, n_sub, hand_path=None):
    """Positions of the ball at sub-moments of the exposure, each at the time its sensor row was read."""
    out = []
    for s in range((n_sub)):
        te = t_frame + (s + 0.5) / n_sub * cam.exposure
        t = te
        for _ in range(3):  # rolling shutter: the row the ball is on decides when it is captured
            X = _ball_at(ts, ps, t, hand_path)
            (u, v), z = cam.project(X[None])[0][0], cam.project(X[None])[1][0]
            t = te + cam.readout * np.clip(v / cam.H, 0, 1)
        X = _ball_at(ts, ps, t, hand_path)
        uv, z = cam.project(X[None])
        out.append((uv[0, 0], uv[0, 1], z[0], t, X))
    return out


def _ball_at(ts, ps, t, hand_path):
    if t >= 0 or hand_path is None:
        return position_at(ts, ps, max(t, 0.0))[0]
    return hand_path(t)


def draw_ball(img, samples, cam, colour, occ_mask=None):
    """Composite the blurred ball; returns (centre u, v, radius px, visible fraction)."""
    H, W = img.shape[:2]
    us = np.array([s[0] for s in samples]); vs = np.array([s[1] for s in samples]); zs = np.array([s[2] for s in samples])
    if np.any(zs <= 0.3):
        return None
    rad = BALL_R * cam.f / zs
    u0, u1 = int(np.floor((us - rad).min())) - 2, int(np.ceil((us + rad).max())) + 3
    v0, v1 = int(np.floor((vs - rad).min())) - 2, int(np.ceil((vs + rad).max())) + 3
    if u1 < 0 or v1 < 0 or u0 >= W or v0 >= H:
        return dict(u=float(us.mean()), v=float(vs.mean()), r=float(rad.mean()), vis=0.0, inframe=False)
    cu0, cv0, cu1, cv1 = max(u0, 0), max(v0, 0), min(u1, W), min(v1, H)
    yy, xx = np.mgrid[cv0:cv1, cu0:cu1].astype(np.float32) + 0.5
    cov = np.zeros(xx.shape, np.float32)
    for u, v, r in zip(us, vs, rad):
        dist = np.sqrt((xx - u) ** 2 + (yy - v) ** 2)
        cov += np.clip(r + 0.5 - dist, 0, 1)
    cov /= len(us)
    vis = 1.0
    if occ_mask is not None:
        occ = occ_mask[cv0:cv1, cu0:cu1].astype(np.float32)
        tot = cov.sum()
        vis = float((cov * (1 - occ)).sum() / tot) if tot > 0 else 0.0
        cov = cov * (1 - occ)
    # a little shading: lighter on top
    shade = 1.0 + 0.25 * np.clip((vs.mean() - yy) / max(rad.mean(), 0.5), -1, 1)
    patch = img[cv0:cv1, cu0:cu1]
    ball = np.array(colour, np.float32)[None, None, :] * shade[..., None]
    img[cv0:cv1, cu0:cu1] = patch * (1 - cov[..., None]) + ball * cov[..., None]
    return dict(u=float(us.mean()), v=float(vs.mean()), r=float(rad.mean()), vis=vis,
                inframe=bool(0 <= us.mean() < W and 0 <= vs.mean() < H))


# ---------------------------------------------------------------- one delivery to video
def render_delivery(seed, out_dir, W=1280, H=720, fps=None, crf=None, write=True):
    rng = np.random.default_rng(seed)
    d = random_delivery(rng)
    ts, ps, info = simulate(d)
    cam, cinfo = random_camera(rng, W, H, fps)
    outdoor = cinfo["outdoor"]
    bg = scene(cam, rng, outdoor)
    gain = rng.uniform(0.75, 1.25) * (1.0 if outdoor else rng.uniform(0.55, 0.9))
    wb = np.array([rng.uniform(0.92, 1.08), 1.0, rng.uniform(0.9, 1.1)], np.float32)
    noise_sd = (rng.uniform(0.004, 0.012) if outdoor else rng.uniform(0.01, 0.03))
    ball_col = BALL_COLOURS[rng.choice(list(BALL_COLOURS), p=[0.45, 0.3, 0.17, 0.08])]
    kit = tuple(np.array(rng.choice([[0.92, 0.92, 0.9], [0.15, 0.25, 0.55], [0.1, 0.1, 0.1], [0.75, 0.2, 0.2], [0.2, 0.5, 0.3]])) * 1.0)
    bat_kit = tuple(np.array(rng.choice([[0.92, 0.92, 0.9], [0.2, 0.3, 0.6], [0.1, 0.1, 0.12]])) * 1.0)

    # bowler: runs in, gathers, releases at t = 0 with the hand at the release point
    side = np.sign(d.p0[1]) or 1.0
    body_y = d.p0[1] - side * rng.uniform(0.18, 0.32)
    run_speed = rng.uniform(3.5, 7.5) if d.kind == "pace" else rng.uniform(1.5, 3.5)
    shoulder_h = rng.uniform(1.35, 1.55)
    away = -side if rng.random() < 0.8 else side  # follow through off the line of the ball, usually to the far side
    def bowler_x(t):
        return d.p0[0] - 0.35 + (run_speed * t if t < 0 else rng_ft * (1 - np.exp(-t / 0.5)))
    def bowler_y(t):
        return body_y if t < 0 else body_y + away * rng_side * (1 - np.exp(-t / 0.35))
    rng_ft, rng_side = rng.uniform(2.0, 4.0), rng.uniform(0.9, 1.8)
    def hand_path(t):  # the bowling arm sweeps up and over in the last ~0.3 s
        bx = bowler_x(t)
        shoulder = np.array([bx + 0.1, bowler_y(t) + side * 0.18, shoulder_h])
        ang = np.clip(t / 0.3, -1.5, 0) * np.pi  # 0 at release (arm up), -pi half a turn earlier
        arm = np.linalg.norm(d.p0 - np.array([d.p0[0] - 0.1, body_y + side * 0.18, shoulder_h]))
        return shoulder + arm * np.array([np.sin(ang) * 0.9 + 0.1, (d.p0[1] - shoulder[1]) / max(arm, 0.1), np.cos(ang)])
    bat_y = rng.choice([-1, 1]) * rng.uniform(0.25, 0.45)
    bat_x = PITCH - rng.uniform(0.3, 1.2)
    t_arrive = info.get("t_stumps", 0.6)

    t0 = -rng.uniform(0.25, 0.7)
    t1 = t_arrive + rng.uniform(0.15, 0.4)
    n = int(np.ceil((t1 - t0) * cam.fps))
    n_sub = int(np.clip(np.ceil(cam.exposure * 2000), 3, 24))
    frames, labels = [], []
    jitter = rng.uniform(0.0, 0.6)  # tripod wobble in pixels: a slow drift (wind, a nudge), not frame-to-frame shake
    wob = np.zeros(2)
    wob_v = np.zeros(2)
    for i in range(n):
        tf = t0 + i / cam.fps
        img = bg.copy()
        occ = np.zeros((H, W), np.uint8)
        far = np.zeros((H, W), np.uint8)
        # far end: stumps and batter (the ball passes in front of them)
        stumps(img, cam, PITCH, far)
        swing = np.clip((tf - (t_arrive - 0.25)) / 0.3, 0, 1)
        person(img, cam, (bat_x + 0.15, bat_y), rng.uniform(1.65, 1.9) if i == 0 else 1.78, -0.15, bat_kit,
               arm=(np.array([bat_x, bat_y, 1.0]), np.array([bat_x - 0.3 - 0.5 * swing, bat_y * (1 - swing), 0.25 + 0.7 * (1 - swing)])))
        # the ball
        samp = ball_samples(cam, ts, ps, tf, n_sub, hand_path)
        # near end: stumps and the bowler (in front of the ball)
        stumps(img, cam, 0.0, occ)
        bx, by_ = bowler_x(tf), bowler_y(tf)
        arm = (np.array([bx - 0.1, by_ + side * 0.18, shoulder_h]), hand_path(min(tf, 0.0)) if tf < 0.08 else np.array([bx + 0.4, by_, 0.9]))
        person(img, cam, (bx - 0.2, by_), 1.8, 0.25 if tf < 0.1 else 0.45, kit, arm=arm, mask=occ)
        info_b = draw_ball(img, samp, cam, ball_col, occ) if tf <= ts[-1] else None
        # the near objects were drawn after the ball's mask was taken, so redraw them on top
        stumps(img, cam, 0.0)
        person(img, cam, (bx - 0.2, by_), 1.8, 0.25 if tf < 0.1 else 0.45, kit, arm=arm)
        # camera: exposure, white balance, noise, a little wobble
        img = img * gain * wb
        img = img + rng.normal(0, noise_sd, img.shape).astype(np.float32)
        if jitter > 0:
            wob_v = 0.9 * wob_v + rng.normal(0, jitter * 0.15, 2)
            wob = 0.97 * wob + wob_v * (30.0 / cam.fps)
            M = np.float32([[1, 0, wob[0]], [0, 1, wob[1]]])
            img = cv2.warpAffine(img, M, (W, H), borderMode=cv2.BORDER_REFLECT)
        frames.append(np.clip(img * 255, 0, 255).astype(np.uint8)[..., ::-1])
        lab = {"t": tf, "released": tf >= 0}
        if info_b:
            lab.update(info_b)
        labels.append(lab)

    tr = truth(d, info)
    # what the user would tap: tops and bases of the outer stumps at both ends
    calib = {}
    for name, x in (("far", PITCH), ("near", 0.0)):
        for k, y in (("off", -STUMP_W / 2), ("leg", STUMP_W / 2)):
            for hk, z in (("base", 0.0), ("top", STUMP_H)):
                uv, z_ = cam.project(np.array([[x, y, z]]))
                calib[f"{name}_{k}_{hk}"] = [float(uv[0, 0]), float(uv[0, 1]), [x, y, z]]
    meta = {"seed": int(seed), "camera": {"W": W, "H": H, "f": float(cam.f), "C": cam.C.tolist(), "R": cam.R.tolist(),
                                           "fps": cam.fps, "exposure": cam.exposure, "readout": cam.readout, "k1": cam.k1, **cinfo},
            "delivery": d.as_dict(), "truth": tr, "t0": t0, "calib": calib, "frames": labels,
            "crf": None}
    if write:
        os.makedirs(out_dir, exist_ok=True)
        crf = crf or int(rng.integers(19, 31))
        meta["crf"] = crf
        p = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}",
                              "-r", str(cam.fps), "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf),
                              "-pix_fmt", "yuv420p", os.path.join(out_dir, f"{seed}.mp4")], stdin=subprocess.PIPE)
        for f in frames:
            p.stdin.write(f.tobytes())
        p.stdin.close(); p.wait()
        with open(os.path.join(out_dir, f"{seed}.json"), "w") as fh:
            json.dump(meta, fh, default=float)
    return meta, frames


if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/nets-sample"
    for s in range(int(sys.argv[2]) if len(sys.argv) > 2 else 3):
        meta, frames = render_delivery(s, out)
        tr = meta["truth"]
        print(s, f"{meta['camera']['fps']:.0f} fps, {len(frames)} frames, speed {tr['speed_kmh']:.1f} km/h, length {tr.get('length_m', float('nan')):.2f} m")

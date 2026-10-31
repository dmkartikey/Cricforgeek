"""From pixels to a delivery: calibrate the phone from the stumps, then fit the ball's flight with physics.

1. calibrate(points): the user taps the tops and bases of the outer stumps at both ends (any 4+ of the 8). Their 3D
   positions are known exactly, so the camera's position, angle and focal length follow (7 unknowns).
2. fit_delivery(cam, obs, fps): obs are the ball's detected image positions per frame. The bounce (the lowest point
   of the path in the image, on the ground) fixes the depth; gravity and the frame times fix the scale; a full physics
   model (drag, swing, bounce with deviation) is then adjusted to match every observation.
Outputs the same numbers as deliveries.truth(): speed, length, line, swing, deviation, height at the stumps.
"""
import numpy as np
from scipy.optimize import least_squares

from .camera import Camera, look_at
from .deliveries import PITCH, CREASE, BALL_R, G, RHO

AREA = np.pi * BALL_R ** 2


# ---------------------------------------------------------------- calibration
def _rodrigues(w):
    th = np.linalg.norm(w)
    if th < 1e-12:
        return np.eye(3)
    k = w / th
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(th) * K + (1 - np.cos(th)) * K @ K


def calibrate(points, W, H, hfov_deg=None):
    """points: list of (u, v, (x, y, z)) taps on known pitch features (stump tops/bases, crease corners).
    Returns (Camera, rms px). Weak priors describe a phone on a tripod behind the bowler (a typical lens width, a
    level horizon, a sensible height), so a handful of taps is enough; hfov_deg (from the phone's lens) tightens it."""
    uv = np.array([p[:2] for p in points], float)
    X = np.array([p[2] for p in points], float)
    fov_c = hfov_deg or 62.0
    f_c = (W / 2) / np.tan(np.radians(fov_c) / 2)
    sig_f = 0.08 if hfov_deg else 0.6        # in log focal length
    best = None
    for cx in (-2.0, -3.5, -5.5, -8.0):
        for fov in ((fov_c,) if hfov_deg else (34, 50, 68)):
            for cy in (-0.6, 0.6):
                C0 = np.array([cx, cy, 1.5])
                R0 = look_at(C0, np.array([PITCH, 0.0, 0.4]))
                f0 = (W / 2) / np.tan(np.radians(fov) / 2)

                def res(p, R0=R0, f0=f0):
                    R = _rodrigues(p[3:6]) @ R0
                    f = np.exp(p[6]) * f0
                    cam = Camera(W=W, H=H, f=f, C=p[:3], R=R)
                    pr, z = cam.project(X)
                    r = np.where(np.repeat(z, 2) > 0, (pr - uv).ravel(), 1e3)
                    roll = np.degrees(np.arctan2(R[0, 2], np.hypot(R[0, 0], R[0, 1])))  # right axis tilt from level
                    pri = [np.log(f / f_c) / sig_f, roll / 4.0, (p[2] - 1.5) / 0.8, (p[0] + 4) / 6.0]
                    return np.r_[r, pri]

                sol = least_squares(res, np.r_[C0, 0, 0, 0, 0.0], loss="soft_l1", f_scale=3.0, max_nfev=600)
                if best is None or sol.cost < best[0].cost:
                    best = (sol, R0, f0)
    sol, R0, f0 = best
    p = sol.x
    cam = Camera(W=W, H=H, f=np.exp(p[6]) * f0, C=p[:3], R=_rodrigues(p[3:6]) @ R0)
    rms = float(np.sqrt(np.mean(sol.fun[:-4] ** 2)))
    return cam, rms


# ---------------------------------------------------------------- flight model
def flight(P, V, times, cd, cs, e, k, dev, dt=0.002):
    """Positions at `times` (sorted, seconds relative to the state P, V at t=0; negative times run backwards
    without bounce). Returns positions (N, 3) and bounce info."""
    times = np.asarray(times, float)
    out = np.zeros((len(times), 3))
    # backwards part (before the reference time): plain integration in reverse, no bounce allowed
    neg = times < 0
    if neg.any():
        p, v = P.copy(), V.copy()
        t = 0.0
        order = np.argsort(-times[neg])
        idx = np.where(neg)[0][order]
        for j in idx:
            while t > times[j] + 1e-12:
                h = min(dt, t - times[j])
                a = _acc(v, cd, cs)
                v = v - a * h
                p = p - v * h
                t -= h
            out[j] = p
    p, v = P.copy(), V.copy()
    t, bounced, binfo = 0.0, False, None
    for j in np.where(~neg)[0]:
        while t < times[j] - 1e-12:
            h = min(dt, times[j] - t)
            a = _acc(v, cd, cs)
            nv = v + a * h
            np_ = p + 0.5 * (v + nv) * h
            if not bounced and np_[2] <= BALL_R and v[2] < 0:
                f = (p[2] - BALL_R) / max(p[2] - np_[2], 1e-9)
                pb, vb = p + f * (np_ - p), v + f * (nv - v)
                pb[2] = BALL_R
                binfo = {"t": t + f * h, "p": pb.copy(), "v": vb.copy()}
                hz = vb[:2] * k
                c, s_ = np.cos(dev), np.sin(dev)
                vb = np.array([c * hz[0] - s_ * hz[1], s_ * hz[0] + c * hz[1], -vb[2] * e])
                rest = h * (1 - f)
                p, v = pb + vb * rest, vb
                bounced = True
            else:
                p, v = np_, nv
            t += h
        out[j] = p
    return out, binfo


def _acc(v, cd, cs):
    sp = np.sqrt(v @ v)
    a = -0.5 * RHO * cd * AREA * sp * v / 0.16
    side = np.array([-v[1], v[0], 0.0])
    sn = np.sqrt(side @ side)
    if sn > 0:
        a = a + (0.5 * RHO * cs * AREA * sp * sp / 0.16) * side / sn
    a[2] -= G
    return a


# ---------------------------------------------------------------- fitting
def _ray(cam, u, v):
    d = np.array([(u - cam.W / 2) / cam.f, (v - cam.H / 2) / cam.f, 1.0]) @ cam.R
    return d / np.linalg.norm(d)


def _ground_hit(cam, u, v, z=BALL_R):
    d = _ray(cam, u, v)
    if d[2] >= -1e-6:
        return None
    t = (z - cam.C[2]) / d[2]
    return cam.C + t * d


LO = np.array([-10, -5, 0, 5, -15, -15, 0.3, -0.4, 0.2, 0.6, -0.4])
HI = np.array([25, 5, 4, 70, 15, 15, 0.6, 0.4, 0.95, 1.0, 0.4])
N_PRI = 5


def _prep(cam, obs, readout):
    """Sorted observation arrays (times relative to the first sighting, rolling shutter applied) and a first guess."""
    obs = sorted(obs)
    if len(obs) < 5:
        return None
    t = np.array([o[0] for o in obs]); u = np.array([o[1] for o in obs]); v = np.array([o[2] for o in obs])
    # optional 4th value: the ball's radius in pixels (its size tells the distance; blur and pixels make it rough)
    r = np.array([o[3] if len(o) > 3 and o[3] else np.nan for o in obs])
    t = t + readout * v / cam.H  # rolling shutter: the row's own capture time
    tt = t - t[0]
    p0 = _initial(cam, tt, u, v)
    if p0 is None:
        return None
    return {"tt": tt, "u": u, "v": v, "r": r, "t0": float(t[0]), "p0": p0, "n": len(obs)}


def _ray_plane_x(cam, u, v, x):
    d = _ray(cam, u, v)
    if abs(d[0]) < 1e-6:
        return None
    t = (x - cam.C[0]) / d[0]
    return cam.C + t * d if t > 0 else None


def _initial(cam, tt, u, v, keep=3):
    """A few distinct starting flights. Hypotheses for an anchor point the ball passes at a known moment: the bounce
    (the lowest point of the path in the image) if there is one, otherwise the batter's end (a full toss)."""
    vs = np.convolve(v, np.ones(3) / 3, mode="same") if len(v) > 4 else v
    ib = int(np.argmax(vs[1:-1]) + 1) if len(v) > 4 else len(v) - 1
    anchors = []
    if 1 <= ib < len(v) - 2 and v[ib] > v[0] + 3:
        for j in {max(1, ib - 1), ib, min(len(v) - 2, ib + 1)}:
            pb = _ground_hit(cam, u[j], v[j])
            if pb is not None:
                anchors.append((pb, tt[j]))
    for x in (PITCH - 1.0, PITCH):
        pb = _ray_plane_x(cam, u[-1], v[-1], x)
        if pb is not None and 0.0 < pb[2] < 2.5:
            anchors.append((pb, tt[-1]))
    d0 = _ray(cam, u[0], v[0])
    cands = []
    for pb, tb in anchors:
        if tb <= 0:
            continue
        for lam in np.linspace(1.0, 16.0, 46):
            P0 = cam.C + lam * d0
            if P0[2] < 0.3 or P0[2] > 3.2:
                continue
            Vh = (pb[:2] - P0[:2]) / tb
            vz = (pb[2] - P0[2] + 0.5 * G * tb * tb) / tb
            V0 = np.array([Vh[0], Vh[1], vz])
            if V0[0] < 5 or V0[0] > 60:
                continue
            pos, _ = flight(P0, V0, tt, 0.45, 0.0, 0.58, 0.88, 0.0, dt=0.004)
            pr, z = cam.project(pos)
            if np.any(z <= 0):
                continue
            cands.append((float(np.mean(np.abs(pr - np.c_[u, v]))), P0, V0))
    cands.sort(key=lambda c: c[0])
    out = []
    for err, P0, V0 in cands:
        if all(np.linalg.norm(P0 - q[:3]) > 0.5 for q in out):
            out.append(np.clip(np.r_[P0, V0, 0.45, 0.0, 0.58, 0.88, 0.0], LO + 1e-6, HI - 1e-6))
        if len(out) >= keep:
            break
    return out or None


def _ball_res(cam, d, p):
    P, V, cd, cs, e, k, dev = p[:3], p[3:6], p[6], p[7], p[8], p[9], p[10]
    pos, _ = flight(P, V, d["tt"], cd, cs, e, k, dev)
    pr, z = cam.project(pos)
    r = (pr - np.c_[d["u"], d["v"]]).ravel()
    ro = d["r"]
    rr = np.where(np.isnan(ro), 0.0, (BALL_R * cam.f / np.maximum(z, 0.3) - np.nan_to_num(ro)) / (0.15 * np.nan_to_num(ro) + 0.4))
    r = np.r_[r, rr]
    # gentle priors keep the less-observed parameters realistic
    pri = np.array([(cd - 0.45) / 0.05, cs / 0.2, (e - 0.58) / 0.12, (k - 0.88) / 0.06, dev / np.radians(6)])
    return np.r_[r, pri]


def _fit_ball(cam, d, starts=None):
    best = None
    for p0 in (starts if starts is not None else d["p0"]):
        sol = least_squares(lambda p: _ball_res(cam, d, p), p0, bounds=(LO, HI), loss="soft_l1", f_scale=1.5,
                            x_scale="jac", max_nfev=300)
        if best is None or sol.cost < best.cost:
            best = sol
    return best


def _results(p, rms, n):
    P, V, cd, cs, e, k, dev = p[:3], p[3:6], p[6], p[7], p[8], p[9], p[10]
    # run the fitted flight from well before the first sighting to past the stumps
    ts = np.linspace(-0.6, 1.4, 2001)
    pos, binfo = flight(P, V, ts, cd, cs, e, k, dev)
    # speed at the bowler's popping crease (essentially the release speed a speed gun reports)
    ic = np.argmin(np.abs(pos[:, 0] - CREASE))
    vel = np.gradient(pos, ts, axis=0)
    out = {"speed_kmh": float(np.linalg.norm(vel[ic]) * 3.6), "rms_px": rms, "n_obs": n,
           "cd": float(cd), "cs": float(cs), "e": float(e), "k": float(k), "dev_deg": float(np.degrees(dev))}
    if binfo is not None and binfo["p"][0] < PITCH + 0.5:
        pb = binfo["p"]
        out.update(bounce_x=float(pb[0]), bounce_y=float(pb[1]), length_m=float(PITCH - pb[0]),
                   speed_bounce_kmh=float(np.linalg.norm(binfo["v"]) * 3.6), deviation_deg=float(np.degrees(dev)))
        # swing: sideways movement before the bounce compared with the straight line from the popping crease
        pc, vc = pos[ic], vel[ic]
        out["swing_m"] = float(pb[1] - (pc[1] + vc[1] / vc[0] * (pb[0] - pc[0])))
    js = np.searchsorted(pos[:, 0], PITCH)
    if 0 < js < len(pos):
        out.update(line_y=float(pos[js, 1]), height_z=float(pos[js, 2]))
    return out


def _spread(cam, d, sol, det_px=0.8):
    """1-sigma uncertainty of the headline numbers from the fit's curvature (how well the pixels pin them down)."""
    J = sol.jac
    try:
        cov = np.linalg.pinv(J.T @ J) * det_px ** 2
    except np.linalg.LinAlgError:
        return {}
    base = _results(sol.x, 0.0, 0)
    keys = ("speed_kmh", "length_m", "line_y", "swing_m")
    grads = {k: np.zeros(len(sol.x)) for k in keys}
    for j in range(len(sol.x)):
        h = 1e-4 * max(1.0, abs(sol.x[j]))
        q = sol.x.copy(); q[j] += h
        rj = _results(q, 0.0, 0)
        for k in keys:
            if k in base and k in rj:
                grads[k][j] = (rj[k] - base[k]) / h
    return {k + "_sd": float(np.sqrt(max(grads[k] @ cov @ grads[k], 0.0))) for k in keys if k in base}


def fit_delivery(cam, obs, readout=0.0):
    """obs: list of (t, u, v) for frames where the ball was detected (t = frame start time, seconds).
    Returns a dict of results, or None when it can't be fitted."""
    d = _prep(cam, obs, readout)
    if d is None:
        return None
    sol = _fit_ball(cam, d)
    out = _results(sol.x, float(np.sqrt(np.mean(sol.fun[:2 * d["n"]] ** 2))), d["n"])
    out.update(_spread(cam, d, sol))
    return out


def _cam_from(p, base):
    return Camera(W=base.W, H=base.H, f=base.f * np.exp(p[6]), C=base.C + p[:3], R=_rodrigues(p[3:6]) @ base.R)


def fit_session(points, balls, W, H, readout=0.0, hfov_deg=None, tap_px=2.0, det_px=1.0):
    """Calibrate from the taps, then refine the camera together with every delivery of the session: gravity and the
    frame clock give each flight an absolute scale, and the flights cross the whole pitch, so together they pin down
    the camera far better than taps on distant stumps alone. balls: list of obs lists. Returns (camera, results)."""
    cam0, rms = calibrate(points, W, H, hfov_deg)
    uv = np.array([p[:2] for p in points], float)
    X = np.array([p[2] for p in points], float)
    preps = [_prep(cam0, o, readout) for o in balls]
    idx = [i for i, d in enumerate(preps) if d is not None]
    if not idx:
        return cam0, [None] * len(balls)
    # each ball on its own first, then jointly (block structure keeps the finite-difference Jacobian cheap)
    pb = []
    for i in idx:
        pb.append(_fit_ball(cam0, preps[i]).x)
    nb = len(idx)
    fc = (W / 2) / np.tan(np.radians(hfov_deg or 62.0) / 2)
    sig_f = 0.08 if hfov_deg else 0.6

    def res(q):
        cam = _cam_from(q[:7], cam0)
        pr, z = cam.project(X)
        rt = (pr - uv).ravel() / tap_px
        roll = np.degrees(np.arctan2(cam.R[0, 2], np.hypot(cam.R[0, 0], cam.R[0, 1])))
        out = [rt, [np.log(cam.f / fc) / sig_f, roll / 4.0]]
        for j, i in enumerate(idx):
            r = _ball_res(cam, preps[i], q[7 + 11 * j: 18 + 11 * j])
            n2 = 2 * preps[i]["n"]
            out.append(np.r_[r[:n2] / det_px, r[n2:]])
        return np.concatenate(out)

    q0 = np.r_[np.zeros(7), np.concatenate(pb)]
    lo = np.r_[[-8, -4, -2, -0.5, -0.5, -0.5, -1.5], np.tile(LO, nb)]
    hi = np.r_[[8, 4, 2, 0.5, 0.5, 0.5, 1.5], np.tile(HI, nb)]
    q0 = np.clip(q0, lo + 1e-6, hi - 1e-6)
    # sparsity: tap rows depend on the camera only; each ball's rows on the camera and its own 11 parameters
    nrow = [2 * len(X) + 2] + [3 * preps[i]["n"] + N_PRI for i in idx]
    S = np.zeros((sum(nrow), len(q0)), dtype=np.int8)
    S[:, :7] = 1
    r0 = nrow[0]
    for j in range(nb):
        S[r0:r0 + nrow[j + 1], 7 + 11 * j: 18 + 11 * j] = 1
        r0 += nrow[j + 1]
    sol = least_squares(res, q0, bounds=(lo, hi), loss="soft_l1", f_scale=2.0, x_scale="jac", jac_sparsity=S,
                        max_nfev=60)
    cam = _cam_from(sol.x[:7], cam0)
    out = [None] * len(balls)
    for j, i in enumerate(idx):
        p = sol.x[7 + 11 * j: 18 + 11 * j]
        r = _ball_res(cam, preps[i], p)[:2 * preps[i]["n"]]
        out[i] = _results(p, float(np.sqrt(np.mean(r ** 2))), preps[i]["n"])
    return cam, out

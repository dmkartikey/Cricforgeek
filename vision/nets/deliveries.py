"""Physics of a cricket delivery, with exact ground truth.

A delivery is released, flies under gravity, air drag and (for seam bowling) a sideways swing force, bounces off the
pitch (losing height and some speed, and deviating off the seam or with spin), then carries on to the batter's end.
`simulate` integrates it with a 4th-order Runge-Kutta step of 1 ms and returns positions at any requested times.

Coordinates in metres: x along the pitch from the bowler's middle stump (0) to the batter's (20.12), y across
(positive to the bowler's right), z up. Time in seconds from release.
"""
from dataclasses import dataclass, field, asdict
import numpy as np

PITCH = 20.12          # stump to stump
CREASE = 1.22          # popping crease in front of each set of stumps
STUMP_H = 0.711
STUMP_W = 0.2286       # outside edge to outside edge
BALL_R = 0.036         # radius (diameter 71-72.9 mm)
G = 9.81
RHO = 1.2              # air density


@dataclass
class Delivery:
    """Everything that defines one ball. Units: m, m/s, s."""
    p0: np.ndarray                  # release point
    v0: np.ndarray                  # release velocity
    mass: float = 0.160
    cd: float = 0.45                # drag coefficient
    cs: float = 0.0                 # swing (side force) coefficient, + moves to +y
    e_bounce: float = 0.52          # vertical speed kept at the bounce
    k_bounce: float = 0.88          # along-the-ground speed kept at the bounce
    dev_deg: float = 0.0            # sideways deviation off the pitch (seam or spin), degrees, + to +y
    kind: str = "pace"              # pace or spin (for reporting)
    meta: dict = field(default_factory=dict)

    def as_dict(self):
        d = asdict(self)
        d["p0"], d["v0"] = list(map(float, self.p0)), list(map(float, self.v0))
        return d


def _accel(p, v, d: Delivery):
    sp = np.linalg.norm(v)
    area = np.pi * BALL_R ** 2
    drag = -0.5 * RHO * d.cd * area * sp * v / d.mass
    # swing acts sideways (perpendicular to the flight, in the horizontal plane)
    side = np.array([-v[1], v[0], 0.0])
    sn = np.linalg.norm(side)
    swing = (0.5 * RHO * d.cs * area * sp * sp / d.mass) * (side / sn if sn > 0 else side)
    # the side vector for flight along +x points to +y, so a positive cs swings to +y
    return drag + swing + np.array([0.0, 0.0, -G])


def simulate(d: Delivery, t_end: float = 1.6, dt: float = 0.001, x_stop: float = PITCH + 1.5):
    """Returns (times, positions, info). Stops a little past the batter's stumps or at t_end."""
    p, v = d.p0.astype(float).copy(), d.v0.astype(float).copy()
    ts, ps = [0.0], [p.copy()]
    t, bounced, info = 0.0, False, {}
    while t < t_end and p[0] < x_stop:
        # RK4
        k1v = _accel(p, v, d); k1p = v
        k2v = _accel(p + 0.5 * dt * k1p, v + 0.5 * dt * k1v, d); k2p = v + 0.5 * dt * k1v
        k3v = _accel(p + 0.5 * dt * k2p, v + 0.5 * dt * k2v, d); k3p = v + 0.5 * dt * k2v
        k4v = _accel(p + dt * k3p, v + dt * k3v, d); k4p = v + dt * k3v
        np_ = p + dt / 6 * (k1p + 2 * k2p + 2 * k3p + k4p)
        nv = v + dt / 6 * (k1v + 2 * k2v + 2 * k3v + k4v)
        if not bounced and np_[2] <= BALL_R:
            # find the moment of contact inside the step and bounce there
            f = (p[2] - BALL_R) / max(p[2] - np_[2], 1e-9)
            tb, pb, vb = t + f * dt, p + f * (np_ - p), v + f * (nv - v)
            pb[2] = BALL_R
            info.update(t_bounce=tb, p_bounce=pb.copy(), v_before=vb.copy())
            horiz = vb[:2] * d.k_bounce
            ang = np.radians(d.dev_deg)
            c, s = np.cos(ang), np.sin(ang)
            horiz = np.array([c * horiz[0] - s * horiz[1], s * horiz[0] + c * horiz[1]])
            vb = np.array([horiz[0], horiz[1], -vb[2] * d.e_bounce])
            info["v_after"] = vb.copy()
            bounced = True
            # finish the step from the bounce
            rest = dt - f * dt
            p, v, t = pb + vb * rest, vb + _accel(pb, vb, d) * rest, t + dt
        else:
            p, v, t = np_, nv, t + dt
        ts.append(t); ps.append(p.copy())
    ts, ps = np.array(ts), np.array(ps)
    # at the batter's stumps
    i = np.searchsorted(ps[:, 0], PITCH)
    if 0 < i < len(ps):
        f = (PITCH - ps[i - 1, 0]) / (ps[i, 0] - ps[i - 1, 0])
        at = ps[i - 1] + f * (ps[i] - ps[i - 1])
        info.update(t_stumps=ts[i - 1] + f * (ts[i] - ts[i - 1]), y_stumps=at[1], z_stumps=at[2])
    return ts, ps, info


def position_at(ts, ps, t):
    """Ball centre at time(s) t (linear between 1 ms samples)."""
    t = np.atleast_1d(t)
    out = np.stack([np.interp(t, ts, ps[:, k]) for k in range(3)], axis=1)
    return out


def truth(d: Delivery, info):
    """The numbers the analyser has to recover."""
    sp0 = float(np.linalg.norm(d.v0)) * 3.6
    pb = info.get("p_bounce")
    out = {"speed_kmh": sp0, "kind": d.kind}
    if pb is not None:
        out.update(bounce_x=float(pb[0]), bounce_y=float(pb[1]), length_m=float(PITCH - pb[0]),
                   speed_bounce_kmh=float(np.linalg.norm(info["v_before"]) * 3.6))
        # swing: how far sideways the ball moved before the bounce compared with a straight line from release
        out["swing_m"] = float(pb[1] - (d.p0[1] + d.v0[1] / d.v0[0] * (pb[0] - d.p0[0])))
        out["deviation_deg"] = float(d.dev_deg)
    if "y_stumps" in info:
        out.update(line_y=float(info["y_stumps"]), height_z=float(info["z_stumps"]))
    return out


# ---------------------------------------------------------------- random realistic deliveries
def _aim(d: Delivery, bx: float, by: float, iters: int = 12):
    """Adjust the release direction so the ball pitches at (bx, by), keeping the release speed."""
    speed = np.linalg.norm(d.v0)
    elev, azim = 0.0, 0.0
    for _ in range(iters):
        ce = np.cos(elev)
        d.v0 = speed * np.array([ce * np.cos(azim), ce * np.sin(azim), np.sin(elev)])
        _, _, info = simulate(d, t_end=2.5, x_stop=PITCH + 3)
        if "p_bounce" not in info:  # never came down before the stumps: aim lower
            elev -= 0.05
            continue
        pb = info["p_bounce"]
        dx, dy = bx - pb[0], by - pb[1]
        dist = max(pb[0] - d.p0[0], 1.0)
        elev += 0.9 * dx / dist * (0.5 if elev > -0.3 else 0.2) * 0.6
        azim += dy / dist
        if abs(dx) < 0.005 and abs(dy) < 0.005:
            break
    return d


def random_delivery(rng: np.random.Generator) -> Delivery:
    """A plausible net delivery: pace (seam and swing) or spin, over or around the wicket."""
    spin = rng.random() < 0.3
    kind = "spin" if spin else "pace"
    speed = rng.uniform(65, 98) if spin else rng.uniform(100, 152)
    if rng.random() < 0.1:
        speed = rng.uniform(55, 155)  # occasional outliers (juniors, very quick)
    side = rng.choice([-1, 1])  # over or around the wicket (or left-armers)
    p0 = np.array([rng.uniform(0.9, 1.7), side * rng.uniform(0.25, 0.95), rng.uniform(1.75, 2.45) if not spin else rng.uniform(1.6, 2.2)])
    # where it pitches: length measured from the batter's stumps; line near the stumps
    length = rng.uniform(1.0, 11.0) if not spin else rng.uniform(2.0, 8.0)
    if rng.random() < 0.07:
        length = rng.uniform(-0.6, 1.0)  # yorkers and full tosses landing near the crease
    bx = PITCH - length
    by = rng.normal(0.0, 0.35)
    d = Delivery(p0=p0, v0=np.array([speed / 3.6, 0, 0]), kind=kind,
                 mass=rng.uniform(0.156, 0.163), cd=rng.uniform(0.38, 0.52),
                 cs=0.0 if spin else float(np.clip(rng.normal(0, 0.12), -0.32, 0.32)),
                 e_bounce=rng.uniform(0.45, 0.72), k_bounce=rng.uniform(0.80, 0.95),
                 dev_deg=float(rng.normal(0, 4.5) if spin else rng.normal(0, 1.2)))
    if bx > PITCH + 0.2:  # full toss: no bounce before the stumps
        bx = PITCH + 1.0
    _aim(d, bx, by)
    d.meta["target"] = [bx, by]
    return d


if __name__ == "__main__":
    rng = np.random.default_rng(1)
    for _ in range(6):
        d = random_delivery(rng)
        ts, ps, info = simulate(d)
        tr = truth(d, info)
        print({k: round(v, 3) if isinstance(v, float) else v for k, v in tr.items()}, "time to stumps", round(info.get("t_stumps", -1), 3))

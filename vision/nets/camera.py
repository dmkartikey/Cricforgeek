"""A phone camera: where it is, which way it points, its lens, and how it captures time.

Image coordinates: u to the right, v down, in pixels; the principal point is the image centre.
Rolling shutter: phones read the sensor row by row, so row v is captured `readout * v / H` seconds after row 0.
"""
from dataclasses import dataclass
import numpy as np


def look_at(cam, target, roll_deg=0.0):
    """Rotation (world -> camera) for a camera at `cam` looking at `target`, z-up world."""
    fwd = target - cam
    fwd = fwd / np.linalg.norm(fwd)
    right = np.cross(fwd, np.array([0.0, 0.0, 1.0]))
    right /= np.linalg.norm(right)
    down = np.cross(fwd, right)
    R = np.stack([right, down, fwd])  # rows: camera x (right), y (down), z (forward) in world coordinates
    if roll_deg:
        a = np.radians(roll_deg)
        Rz = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
        R = Rz @ R
    return R


@dataclass
class Camera:
    W: int
    H: int
    f: float              # focal length in pixels
    C: np.ndarray         # camera centre (world)
    R: np.ndarray         # world -> camera rotation
    fps: float = 60.0
    exposure: float = 1 / 500
    readout: float = 0.0  # rolling shutter: time to read the whole frame, top to bottom
    k1: float = 0.0       # radial lens distortion

    def to_cam(self, X):
        return (np.atleast_2d(X) - self.C) @ self.R.T

    def project(self, X):
        """World points (N, 3) -> pixels (N, 2) and depth (N,)."""
        Xc = self.to_cam(X)
        z = Xc[:, 2]
        x, y = Xc[:, 0] / z, Xc[:, 1] / z
        if self.k1:
            r2 = x * x + y * y
            s = 1 + self.k1 * r2
            x, y = x * s, y * s
        return np.stack([self.f * x + self.W / 2, self.f * y + self.H / 2], axis=1), z

    def rays(self):
        """Unit ray directions (H, W, 3) in world coordinates for every pixel (ignores distortion; fine for the scene)."""
        u, v = np.meshgrid(np.arange(self.W) + 0.5, np.arange(self.H) + 0.5)
        d = np.stack([(u - self.W / 2) / self.f, (v - self.H / 2) / self.f, np.ones_like(u)], axis=-1)
        d = d @ self.R  # camera -> world
        return d / np.linalg.norm(d, axis=-1, keepdims=True)


def random_camera(rng, W=1280, H=720, fps=None):
    """A phone on a tripod behind the bowler's arm, aimed down the pitch, with realistic settings."""
    fps = fps or float(rng.choice([30, 60, 120, 240], p=[0.3, 0.35, 0.2, 0.15]))
    C = np.array([rng.uniform(-6.0, -1.8), rng.uniform(-1.0, 1.0), rng.uniform(1.1, 2.0)])
    target = np.array([rng.uniform(17.5, 21.5), rng.uniform(-0.4, 0.4), rng.uniform(0.0, 1.0)])
    zoom = float(rng.choice([1.0, 1.0, 1.0, 1.5, 2.0]))
    hfov = np.radians(rng.uniform(62, 76)) / zoom  # 1x main camera is about 62-76 degrees wide
    f = (W / 2) / np.tan(hfov / 2)
    R = look_at(C, target, roll_deg=rng.normal(0, 1.2))
    outdoor = rng.random() < 0.55
    # shutter: bright days allow short exposures; indoor nets force long ones (more blur)
    exp = 1 / float(rng.uniform(800, 4000)) if outdoor else 1 / float(rng.uniform(fps * 1.05, max(fps * 1.1, 300)))
    exp = min(exp, 1 / fps)
    readout = float(rng.uniform(0.35, 0.95)) / fps if fps <= 60 else float(rng.uniform(0.3, 0.9)) / fps
    return Camera(W=W, H=H, f=f, C=C, R=R, fps=fps, exposure=exp, readout=readout,
                  k1=float(rng.normal(0, 0.02))), {"outdoor": outdoor, "zoom": zoom}

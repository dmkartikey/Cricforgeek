"""A demo clip for the website: one phone set-up, several deliveries back to back, plus the pitch marks a user would
tap. Usage: python -m nets.sample_session OUT_DIR SEED [balls] [fps] [pace|spin]"""
import sys, os, json, subprocess
import numpy as np

from .render import setup, render_delivery
from .deliveries import PITCH, CREASE, STUMP_W, STUMP_H

RETURN_Y = 1.32
HALF = STUMP_W / 2
MARKS = {"fLt": (PITCH, -HALF, STUMP_H), "fLb": (PITCH, -HALF, 0), "fRt": (PITCH, HALF, STUMP_H), "fRb": (PITCH, HALF, 0),
         "fPL": (PITCH - CREASE, -RETURN_Y, 0), "fPR": (PITCH - CREASE, RETURN_Y, 0), "nPL": (CREASE, -RETURN_Y, 0),
         "nPR": (CREASE, RETURN_Y, 0), "nBL": (0, -RETURN_Y, 0), "nBR": (0, RETURN_Y, 0),
         "nLt": (0, -HALF, STUMP_H), "nLb": (0, -HALF, 0), "nRt": (0, HALF, STUMP_H), "nRb": (0, HALF, 0)}


def main():
    out, seed = sys.argv[1], int(sys.argv[2])
    balls = int(sys.argv[3]) if len(sys.argv) > 3 else 4
    fps = float(sys.argv[4]) if len(sys.argv) > 4 else 60.0
    rng = np.random.default_rng(seed)
    st = setup(rng, 1280, 720, fps)
    cam = st["cam"]
    frames, truths = [], []
    t = 0.0
    kind = sys.argv[5] if len(sys.argv) > 5 else "pace"
    b = 0
    for _ in range(balls):
        # one bowler: keep only deliveries of the chosen kind
        while True:
            from .deliveries import random_delivery
            if random_delivery(np.random.default_rng(seed * 100 + b)).kind == kind:
                break
            b += 1
        meta, fr = render_delivery(seed * 100 + b, out, write=False, st=st)
        b += 1
        truths.append({"start_s": t, **meta["truth"]})
        frames += fr
        t += len(fr) / cam.fps
    os.makedirs(out, exist_ok=True)
    p = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", "1280x720",
                          "-r", str(cam.fps), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p",
                          "-movflags", "+faststart", os.path.join(out, "sample.mp4")], stdin=subprocess.PIPE)
    for f in frames:
        p.stdin.write(f.tobytes())
    p.stdin.close(); p.wait()
    taps = {}
    trng = np.random.default_rng(seed + 1)
    for k, X in MARKS.items():
        uv, z = cam.project(np.array([X], float))
        if z[0] > 0 and 0 <= uv[0, 0] < 1280 and 0 <= uv[0, 1] < 720:
            taps[k] = [round(float(uv[0, 0] + trng.normal(0, 1.0)), 1), round(float(uv[0, 1] + trng.normal(0, 1.0)), 1)]
    json.dump({"taps": taps, "fps": cam.fps, "truth": truths}, open(os.path.join(out, "sample.json"), "w"), indent=1)
    print("camera", np.round(cam.C, 2), "fps", cam.fps, "outdoor", st["outdoor"], "frames", len(frames), "taps", len(taps))
    for tr in truths:
        print({k: round(v, 2) if isinstance(v, float) else v for k, v in tr.items()})


if __name__ == "__main__":
    main()

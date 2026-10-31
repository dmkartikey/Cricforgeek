"""Finding the ball in phone video.

Stage 1 (cheap, every frame): things that moved. Each frame is compared with the one before and after; the ball is
present only in the middle frame at that spot, so min(|cur - prev|, |cur - next|) lights up the ball and suppresses
the background and slow movers. Blobs of that map are candidates.
Stage 2 (a tiny neural network, candidates only): is this candidate the ball? Where exactly is its centre, and how
big is it? Inputs are a 32x32 patch of the frame and its two differences.
Stage 3 (tracking): chain candidates over frames into the one path that moves like a cricket ball.

Everything here is written so it can be repeated line for line in the browser (plain arrays, no exotic operations).
"""
import numpy as np
import cv2

PATCH = 32


def gap_for(fps, seconds=0.1):
    """Frames apart to compare: long enough that even a far-away ball has moved more than its own width."""
    return max(1, int(round(fps * seconds)))


def gray(frame_bgr):
    """Frames are kept in colour (float, H x W x 3): a red ball on a green pitch has about the same brightness, so a
    black-and-white difference would miss it."""
    return frame_bgr.astype(np.float32)


_K3 = np.ones((3, 3), np.uint8)


def _chmax(d):
    """Largest of the colour channels (cv2 is much faster than numpy's max over an axis)."""
    if d.ndim == 2:
        return d
    a, b, c = cv2.split(d)
    return cv2.max(cv2.max(a, b), c)


def prep(frame):
    """Per-frame work, done once and reused: the 2x2 blur and its 3x3 max and min."""
    c = cv2.blur(frame, (2, 2))
    return c, cv2.dilate(c, _K3), cv2.erode(c, _K3)


def _shift_tolerant_diff_p(c, other_p):
    """How far cur lies outside the range of `other` in a 3x3 neighbourhood: a small camera shake moves edges by
    under a pixel, which this ignores, while a ball that is not there in `other` still stands out."""
    _, hi, lo = other_p
    d = cv2.max(cv2.subtract(c, hi), cv2.subtract(lo, c))
    return cv2.max(_chmax(d), 0.0)


def _shift_tolerant_diff(cur, other):
    return _shift_tolerant_diff_p(cur, prep_blurred(other))


def prep_blurred(c):
    return c, cv2.dilate(c, _K3), cv2.erode(c, _K3)


def motion_map(prev, cur, nxt, preps=None):
    pp, pc, pn = preps if preps is not None else (prep(prev), prep(cur), prep(nxt))
    return cv2.min(_shift_tolerant_diff_p(pc[0], pp), _shift_tolerant_diff_p(pc[0], pn))


def candidates(prev, cur, nxt, max_n=40, min_sep=6, preps=None):
    """The strongest local peaks of the motion map in `cur`: list of (u, v, strength, noise ratio). Deliberately
    permissive (a faint far-away ball must not be lost here); the network and the tracker throw out the rest."""
    m = motion_map(prev, cur, nxt, preps)
    noise = 1.4826 * float(np.median(_chmax(np.ascontiguousarray(np.abs(cur[::4, ::4] - prev[::4, ::4]))))) + 1.0
    ms = cv2.blur(m, (3, 3))
    peak = (ms >= cv2.dilate(ms, np.ones((2 * min_sep + 1, 2 * min_sep + 1), np.uint8))) & (ms > 0.8 * noise)
    vs, us = np.nonzero(peak)
    if len(us) == 0:
        return [], m
    s = ms[vs, us]
    order = np.argsort(-s)[:max_n]
    out = []
    H, W = m.shape
    for j in order:
        u, v = int(us[j]), int(vs[j])
        # sub-pixel centre: weighted mean of the motion map in a 5x5 window
        y0, y1, x0, x1 = max(v - 2, 0), min(v + 3, H), max(u - 2, 0), min(u + 3, W)
        w = m[y0:y1, x0:x1]
        tot = float(w.sum()) or 1.0
        yy, xx = np.mgrid[y0:y1, x0:x1]
        out.append((float((w * xx).sum() / tot) + 0.5, float((w * yy).sum() / tot) + 0.5, float(s[j]), float(s[j] / noise)))
    return out, m


def patch(prev, cur, nxt, u, v, size=PATCH):
    """3 x size x size input for the network: the frame and its differences with the neighbours, centred on (u, v)."""
    h = size // 2
    x0, y0 = int(round(u)) - h, int(round(v)) - h
    H, W = cur.shape[:2]

    def crop(img):
        out = np.zeros((size, size) + img.shape[2:], np.float32)
        xa, ya = max(x0, 0), max(y0, 0)
        xb, yb = min(x0 + size, W), min(y0 + size, H)
        if xb > xa and yb > ya:
            out[ya - y0:yb - y0, xa - x0:xb - x0] = img[ya:yb, xa:xb]
        return out

    c, p, n = crop(cur), crop(prev), crop(nxt)
    mu = c.reshape(-1, 3).mean(0)
    # 5 channels: the frame in colour (centred), and how it differs from the frames before and after
    dp = np.abs(c - p).max(axis=2); dn = np.abs(c - n).max(axis=2)
    return np.concatenate([((c - mu) / 64.0).transpose(2, 0, 1), (dp / 32.0)[None], (dn / 32.0)[None]]), (x0 + h, y0 + h)

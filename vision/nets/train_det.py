"""Train the ball network: a tiny convolutional net small enough to run in a phone's browser without libraries.

Input: 5 x 32 x 32 patch (colour frame, difference with the frame before, difference with the frame after).
Output: ball score (logit), centre offset dx, dy (pixels from the patch centre) and ball radius (pixels).
Usage: python -m nets.train_det TRAIN.npz TEST.npz OUT.json [epochs]
The weights are written as JSON so the browser can load them directly.
"""
import sys, json, time
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F


class BallNet(nn.Module):
    def __init__(self, c1=12, c2=20, c3=28, hid=48):
        super().__init__()
        self.c1 = nn.Conv2d(5, c1, 3, padding=1)
        self.c2 = nn.Conv2d(c1, c2, 3, padding=1)
        self.c3 = nn.Conv2d(c2, c3, 3, padding=1)
        self.f1 = nn.Linear(c3 * 4 * 4, hid)
        self.f2 = nn.Linear(hid, 4)

    def forward(self, x):
        x = F.max_pool2d(F.relu(self.c1(x)), 2)   # 16x16
        x = F.max_pool2d(F.relu(self.c2(x)), 2)   # 8x8
        x = F.max_pool2d(F.relu(self.c3(x)), 2)   # 4x4
        x = F.relu(self.f1(x.flatten(1)))
        return self.f2(x)


def augment(x, y, g):
    """Random flips (with matching offsets), brightness/contrast, extra noise: the real world is messier than renders."""
    B = x.shape[0]
    flip = torch.rand(B, generator=g) < 0.5
    x = torch.where(flip[:, None, None, None], x.flip(3), x)
    y = y.clone()
    y[flip, 1] = -y[flip, 1]
    x = x.clone()
    x[:, :3] = x[:, :3] * (0.7 + 0.6 * torch.rand(B, 1, 1, 1, generator=g)) + 0.15 * torch.randn(B, 3, 1, 1, generator=g)
    x[:, 3:] = x[:, 3:] * (0.7 + 0.6 * torch.rand(B, 1, 1, 1, generator=g))
    x = x + 0.04 * torch.rand(B, 1, 1, 1, generator=g) * torch.randn(x.shape, generator=g)
    return x, y


def loss_fn(out, y):
    cls = F.binary_cross_entropy_with_logits(out[:, 0], y[:, 0])
    pos = y[:, 0] > 0.5
    if pos.any():
        reg = F.smooth_l1_loss(out[pos, 1:3], y[pos, 1:3]) + 0.5 * F.smooth_l1_loss(out[pos, 3], y[pos, 3])
    else:
        reg = torch.zeros(())
    return cls + 0.3 * reg, cls, reg


def evaluate(net, X, Y):
    net.eval()
    with torch.no_grad():
        outs = [net(X[i:i + 4096]) for i in range(0, len(X), 4096)]
    out = torch.cat(outs)
    p = torch.sigmoid(out[:, 0]).numpy()
    y = Y[:, 0].numpy() > 0.5
    res = {}
    for th in (0.3, 0.5, 0.7):
        tp = (p > th) & y
        res[f"recall@{th}"] = float(tp.sum() / max(y.sum(), 1))
        res[f"precision@{th}"] = float(tp.sum() / max((p > th).sum(), 1))
    pos = y
    err = (out[pos, 1:3] - Y[pos, 1:3]).norm(dim=1).numpy()
    res["centre_err_median_px"] = float(np.median(err))
    res["centre_err_90_px"] = float(np.percentile(err, 90))
    res["radius_err_median_px"] = float(np.median(np.abs(out[pos, 3].numpy() - Y[pos, 3].numpy())))
    net.train()
    return res


def export(net, path, meta):
    sd = {k: v.detach().numpy().round(5).tolist() for k, v in net.state_dict().items()}
    json.dump({"arch": "ballnet-v1", "meta": meta, "weights": sd}, open(path, "w"))


def main():
    tr, te, out = sys.argv[1], sys.argv[2], sys.argv[3]
    epochs = int(sys.argv[4]) if len(sys.argv) > 4 else 12
    torch.set_num_threads(4)
    d = np.load(tr); X = torch.from_numpy(d["X"].astype(np.float32)); Y = torch.from_numpy(d["Y"])
    d = np.load(te); Xt = torch.from_numpy(d["X"].astype(np.float32)); Yt = torch.from_numpy(d["Y"])
    print("train", tuple(X.shape), "pos", int(Y[:, 0].sum()), "| test", tuple(Xt.shape), "pos", int(Yt[:, 0].sum()))
    net = BallNet()
    print("parameters", sum(p.numel() for p in net.parameters()))
    opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-4)
    steps = epochs * (len(X) // 256)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=steps)
    g = torch.Generator().manual_seed(0)
    t = time.time()
    for ep in range(epochs):
        perm = torch.randperm(len(X), generator=g)
        tot = 0.0
        for i in range(0, len(X) - 255, 256):
            b = perm[i:i + 256]
            xb, yb = augment(X[b], Y[b], g)
            loss, _, _ = loss_fn(net(xb), yb)
            opt.zero_grad(); loss.backward(); opt.step(); sched.step()
            tot += float(loss)
        print(f"epoch {ep + 1}/{epochs} loss {tot / (len(X) // 256):.4f} {time.time() - t:.0f}s", evaluate(net, Xt, Yt), flush=True)
    res = evaluate(net, Xt, Yt)
    export(net, out, res)
    print("saved", out, res)


if __name__ == "__main__":
    main()

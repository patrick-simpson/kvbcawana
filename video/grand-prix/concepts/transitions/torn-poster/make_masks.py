"""Torn-poster masks: the lobby sheet torn along the Grand Prix brand's distressed
diagonal (the red/black edge of the film at rest, ~4.0 s).

Writes (1920x1080, non-colour data):
  mask_A.png  upper-left half  (R = alpha, G = white paper-core rim weight)
  mask_B.png  lower-right half (same)
  tear.json   the straight line fitted through the tear (pixel coords)
"""
import json, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FILM = r"C:\Users\User\scratch-intro\gp\gp-brand\frames1080\frame_0240.png"
W, H = 1920, 1080
rng = np.random.default_rng(7)

a = np.asarray(Image.open(FILM).convert("RGB")).astype(int)
red = (a[:, :, 0] > 180) & (a[:, :, 1] < 120)
edge = np.zeros(W)
for x in range(W):
    col = red[:, x]
    # first row from which the next 8 rows are all red (skips the distress flecks)
    run = np.convolve(col.astype(int), np.ones(8, int), "valid")
    ys = np.where(run == 8)[0]
    edge[x] = ys[0] if len(ys) else np.nan
# fill / smooth lightly (keep the brand's distressed wiggle)
xs = np.arange(W)
ok = ~np.isnan(edge)
edge = np.interp(xs, xs[ok], edge[ok])
from numpy.lib.stride_tricks import sliding_window_view
pad = np.pad(edge, 4, mode="edge")
edge = np.median(sliding_window_view(pad, 9), axis=1)
pad = np.pad(edge, 20, mode="edge")
smooth = np.median(sliding_window_view(pad, 41), axis=1)
edge = smooth + np.clip(edge - smooth, -7, 7)
k = np.exp(-np.linspace(-2, 2, 7) ** 2); k /= k.sum()
edge = np.convolve(np.pad(edge, 3, mode="edge"), k, "valid")


def noise1d(n, scale, amp):
    pts = np.arange(0, n + scale, scale)
    v = rng.normal(0, 1, len(pts))
    return np.interp(np.arange(n), pts, v) * amp


# fibrous jitter shared by both halves (the tear itself), plus each half's own fibres
base = edge + noise1d(W, 23, 2.0) + noise1d(W, 5, 0.9)
fib_hi = np.abs(rng.normal(0, 1, W)) * 1.2  # per-column fibre tufts
yA_print = base - 1.0                         # A's printed skin ends here
yA_core = base + 2.5 + np.clip(noise1d(W, 31, 4.0) + 5.0, 1.0, 13) + fib_hi  # A's white core sticks out
yB_print = base + 1.5 + np.clip(noise1d(W, 17, 1.2) + 1.0, 0.3, 3)
# B's paper tucks under A by a few px (no gap at rest, even on steep steps)
yB_core = np.min(sliding_window_view(np.pad(yA_print, 4, mode="edge"), 9), axis=1) - 3.0

Y = np.arange(H)[:, None].astype(float)


def soft(v):  # 1 px antialiased step
    return np.clip(v + 0.5, 0, 1)


alphaA = soft(yA_core[None, :] - Y)
rimA = soft(Y - yA_print[None, :]) * alphaA
alphaB = soft(Y - yB_core[None, :])
rimB = soft(yB_print[None, :] - Y) * alphaB
# fibre texture in the rim (a little grey variation)
fib = 0.75 + 0.25 * rng.random((H, W))
rimA = rimA * fib
rimB = rimB * fib


def save(name, alpha, rim):
    img = np.zeros((H, W, 3), np.uint8)
    img[:, :, 0] = np.round(alpha * 255)
    img[:, :, 1] = np.round(np.clip(rim, 0, 1) * 255)
    Image.fromarray(img).save(os.path.join(HERE, name))


save("mask_A.png", alphaA, rimA)
save("mask_B.png", alphaB, rimB)
# straight line through the tear for the deformation frame
p = np.polyfit(xs, edge, 1)
json.dump({"slope": p[0], "icept": p[1], "x0": 0, "y0": float(np.polyval(p, 0)),
           "x1": W - 1, "y1": float(np.polyval(p, W - 1))},
          open(os.path.join(HERE, "tear.json"), "w"), indent=1)
print("line", p)

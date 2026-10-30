"""Final torn-edge masks at 3840x2160 (2x the plate) with real-looking fibres.

The tear follows the Grand Prix brand's torn diagonal (the film's red/black edge at
rest, frame 240), with small-scale irregularity on top. Each half gets:
  R = alpha (paper present), G = white-core weight (where the printed skin has
  peeled off and the fibrous paper core shows), B = fibre streak brightness.
Half A (upper-left) keeps a wide, fuzzy core with fibres sticking out; half B a thin one.
Writes maskF_A.png, maskF_B.png, tear.json (line in 1920-space pixels).
"""
import json, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from numpy.lib.stride_tricks import sliding_window_view as swv

HERE = os.path.dirname(os.path.abspath(__file__))
FILM = r"C:\Users\User\scratch-intro\gp\gp-brand\frames1080\frame_0240.png"
S = 2
W, H = 1920 * S, 1080 * S
rng = np.random.default_rng(11)

a = np.asarray(Image.open(FILM).convert("RGB")).astype(int)
red = (a[:, :, 0] > 180) & (a[:, :, 1] < 120)
edge = np.full(1920, np.nan)
for x in range(1920):
    run = np.convolve(red[:, x].astype(int), np.ones(8, int), "valid")
    ys = np.where(run == 8)[0]
    if len(ys):
        edge[x] = ys[0]
xs = np.arange(1920)
ok = ~np.isnan(edge)
edge = np.interp(xs, xs[ok], edge[ok])
edge = np.median(swv(np.pad(edge, 4, mode="edge"), 9), axis=1)
smooth = np.median(swv(np.pad(edge, 20, mode="edge"), 41), axis=1)
edge = smooth + np.clip(edge - smooth, -7, 7)
k = np.exp(-np.linspace(-2, 2, 7) ** 2); k /= k.sum()
edge = np.convolve(np.pad(edge, 3, mode="edge"), k, "valid")
p = np.polyfit(xs, edge, 1)
json.dump({"x0": 0, "y0": float(np.polyval(p, 0)), "x1": 1919, "y1": float(np.polyval(p, 1919))},
          open(os.path.join(HERE, "tear.json"), "w"), indent=1)

# to 4K columns
X = np.arange(W) / S
e4 = np.interp(X, xs, edge) * S


def noise1d(n, scale, amp):
    pts = np.arange(0, n + scale, scale)
    return np.interp(np.arange(n), pts, rng.normal(0, 1, len(pts))) * amp


base = e4 + noise1d(W, 60, 4.0) + noise1d(W, 14, 2.0) + noise1d(W, 4, 0.9)
yA_print = base - 2.0
coreA = np.clip(noise1d(W, 70, 4.0) + 6.5, 2.5, 14.0) + np.abs(noise1d(W, 9, 1.5))
yA_core = base + 3.0 + coreA
yB_print = base + 3.0 + np.clip(noise1d(W, 40, 2.0) + 3.0, 1.0, 7.0)
yB_core = np.min(swv(np.pad(yA_print, 8, mode="edge"), 17), axis=1) - 6.0

Y = np.arange(H, dtype=np.float32)[:, None]


def soft(v, w=1.0):
    return np.clip(v / w + 0.5, 0, 1)


def fibres(alpha, rim, streak, y_edge, sign, count, lmin, lmax):
    """Thin fibre strands growing out of the core edge (sign +1 = downward)."""
    im_a = Image.new("L", (W, H), 0)
    im_s = Image.new("L", (W, H), 0)
    da = ImageDraw.Draw(im_a); ds = ImageDraw.Draw(im_s)
    for _ in range(count):
        x = rng.uniform(0, W)
        y = np.interp(x, np.arange(W), y_edge) - sign * rng.uniform(0, 3)
        L = rng.uniform(lmin, lmax) * (rng.random() ** 0.6)
        ang = rng.normal(0, 0.55)
        pts = [(x, y)]
        cx, cy = x, y
        for step in range(4):
            ang += rng.normal(0, 0.3)
            cx += np.sin(ang) * L / 4
            cy += sign * np.cos(ang) * L / 4
            pts.append((cx, cy))
        v = int(rng.uniform(120, 255))
        wdt = 2 if rng.random() < 0.45 else 1
        da.line(pts, fill=v, width=wdt)
        ds.line(pts, fill=int(rng.uniform(190, 255)), width=wdt)
    fa = np.asarray(im_a.filter(ImageFilter.GaussianBlur(0.25))).astype(np.float32) / 255
    fs = np.asarray(im_s).astype(np.float32) / 255
    alpha = np.maximum(alpha, fa)
    rim = np.maximum(rim, fa)
    streak = np.maximum(streak, fs * (fa > 0.05))
    return alpha, rim, streak


# A: printed skin down to yA_print, fuzzy white core to yA_core, fibres beyond
alphaA = soft(yA_core[None, :] - Y, 1.6)
# fuzz: a translucent band of loose fibres just past the core edge
fuzz = np.clip(1 - (Y - yA_core[None, :]) / 5.0, 0, 1) * (Y > yA_core[None, :])
fuzz *= (rng.random((H, W)) ** 6) * 0.5
alphaA = np.maximum(alphaA, fuzz)
rimA = soft(Y - yA_print[None, :], 1.2) * (alphaA > 0)
streakA = (rng.random((H, W)) ** 4).astype(np.float32) * rimA
alphaA, rimA, streakA = fibres(alphaA, rimA, streakA, yA_core, +1, 9000, 4, 26)

alphaB = soft(Y - yB_core[None, :], 1.2)
rimB = soft(yB_print[None, :] - Y, 1.0) * alphaB
streakB = (rng.random((H, W)) ** 4).astype(np.float32) * rimB
alphaB, rimB, streakB = fibres(alphaB, rimB, streakB, yB_core, -1, 4000, 2, 10)


def save(name, al, ri, st):
    img = np.stack([al, np.clip(ri, 0, 1), np.clip(st, 0, 1)], 2)
    Image.fromarray(np.round(img * 255).astype(np.uint8)).save(os.path.join(HERE, name))


save("maskF_A.png", alphaA, rimA, streakA)
save("maskF_B.png", alphaB, rimB, streakB)
# coarse per-pixel keep map at 1920 for mesh trimming
np.save(os.path.join(HERE, "edges1920.npy"), np.stack([yA_core[::S] / S, yB_core[::S] / S]))
print("ok")

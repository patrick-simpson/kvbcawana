"""Render the 2.5D photo background frames (960x540) for a concept.

    python render_bg.py photo-parallax|combo

Reads the layers made by layers.py, moves a virtual camera through them
(each layer has its own depth: a smooth inverse-depth field for the room
shell and the track, a constant one for each standing object), and writes
    C:/Users/User/scratch-intro/gp/<concept>/bg/bg_0000.png ...
    C:/Users/User/scratch-intro/gp/<concept>/cam.json   (camera per frame, for the cars)

Camera model (photo px, 2000x1506 photo; w = inverse depth, back wall = 1):
    q = C + (p - C) / (1 - d*w) + pan*w          (dolly d, parallax pan)
    screen = (q - F) * 0.48 * Z + (480, 270)     (frame centre F, zoom Z)
The same formula is in ../shared/common.js (project()).
"""
import json, os, sys
import numpy as np
from PIL import Image

LAY = r"C:\Users\User\scratch-intro\gp\layers"
OUTROOT = r"C:\Users\User\scratch-intro\gp"
FPS, OW, OH, SS = 30, 960, 540, 2
HD = os.environ.get("GP_HD") == "1"       # finals: 1920x1080, 60 fps, 4000 px layers, mip levels
BGDIR = "bg"
if HD:
    LAY, FPS, OW, OH, SS, BGDIR = LAY + "_hd", 60, 1920, 1080, 1, "bg1080"
LEVELS = [2.0, 1.414, 1.0] if HD else [1.0]   # layer px per photo unit, per mip level
C = np.array([1000.0, 753.0])

CEIL = [(0, 595), (210, 635), (770, 478), (1240, 462), (1750, 535), (2000, 568)]
TW = [(748, 1.0), (1000, 1.3), (1150, 1.5), (1506, 2.6), (1800, 3.6)]


def w_track(x, y):
    return np.interp(y, [a for a, _ in TW], [b for _, b in TW])


def w_base(x, y):
    L = np.interp(x, [a for a, _ in CEIL], [b for _, b in CEIL])
    w = np.ones_like(y)
    ceil = 1 + 0.6 * np.clip((L - y) / 450.0, 0, 1)
    E = 1125 + 0.062 * (x - 80)                       # stage front edge (tilted)
    v = np.clip((y - 920) / (E - 920), 0, 1)
    floor = 1 + 0.5 * v
    steps = 1.5 + 1.1 * np.clip((y - E) / np.maximum(1506 - E, 50), 0, 2)
    w = np.where(y < L, ceil, np.where(y <= E, floor, steps))
    return w


LAYERS = [("base", w_base), ("table", 1.47), ("trophy", 1.37), ("us_flag", 1.43), ("red_flag", 1.46), ("track", w_track)]

ease = lambda u: u * u * (3 - 2 * u)


def lerp(a, b, u):
    return [a[i] + (b[i] - a[i]) * u for i in range(len(a))] if isinstance(a, (list, tuple)) else a + (b - a) * u


# shots: (t0, t1, F0, F1, Z0, Z1, d0, d1, pan0, pan1)
SHOTS = {
    "photo-parallax": [
        (0.0, 6.6, (1000, 800), (905, 772), 1.12, 1.42, 0.0, 0.07, (0, 0), (-10, -6)),
        (6.6, 8.6, (960, 975), (972, 968), 1.06, 1.10, 0.0, 0.03, (0, 4), (-12, 6)),
        (8.6, 10.4, (700, 1125), (692, 1119), 1.62, 1.70, 0.02, 0.06, (0, 0), (-10, 0)),
        (10.4, 15.0, (1250, 842), (1330, 832), 1.45, 1.52, 0.03, 0.06, (-10, 0), (10, -4)),
    ],
    "combo": [
        # one long push toward the gate; it is still moving when the transition takes over
        (0.0, 9.6, (820, 742), (888, 800), 1.30, 1.86, 0.0, 0.10, (0, 0), (-8, -8)),
    ],
}


def cam_at(concept, t):
    for s in SHOTS[concept]:
        if s[0] <= t < s[1]:
            u = ease((t - s[0]) / (s[1] - s[0]))
            return dict(F=lerp(s[2], s[3], u), Z=lerp(s[4], s[5], u), d=lerp(s[6], s[7], u), pan=lerp(s[8], s[9], u))
    return None


def load():
    """Each layer as premultiplied uint8 RGBA, at every mip level."""
    out = []
    for name, w in LAYERS:
        src = Image.open(os.path.join(LAY, name + ".png")).convert("RGBA")
        lv = {}
        for L in LEVELS:
            im = src if L == LEVELS[0] else src.resize((round(src.width * L / LEVELS[0]), round(src.height * L / LEVELS[0])), Image.LANCZOS)
            a = np.asarray(im).astype(np.float32)
            if name == "base":
                a[..., 3] = 255
            a[..., :3] *= a[..., 3:4] / 255.0
            lv[L] = np.ascontiguousarray(np.clip(a + 0.5, 0, 255).astype(np.uint8))
        out.append((name, w, lv))
    return out


def sample(img, x, y):
    h, w = img.shape[:2]
    x = np.clip(x, 0, w - 1.001); y = np.clip(y, 0, h - 1.001)
    x0 = x.astype(np.int32); y0 = y.astype(np.int32)
    fx = (x - x0)[..., None]; fy = (y - y0)[..., None]
    f = lambda yy, xx: img[yy, xx].astype(np.float32) * (1 / 255.0)
    a = f(y0, x0); b = f(y0, x0 + 1); c = f(y0 + 1, x0); d = f(y0 + 1, x0 + 1)
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def render(layers, cam):
    W, H = OW * SS, OH * SS
    sx, sy = np.meshgrid(np.arange(W) + 0.5, np.arange(H) + 0.5)
    k = 0.48 * cam["Z"] * SS * OW / 960
    qx = cam["F"][0] + (sx - W / 2) / k
    qy = cam["F"][1] + (sy - H / 2) / k
    d, (px, py) = cam["d"], cam["pan"]
    acc = np.zeros((H, W, 3), np.float32)
    for name, wf, lv in layers:
        # mip level: the smallest whose resolution still covers the output (never upscaled)
        need = k / SS * (1 / (1 - d * (1.5 if callable(wf) else wf)))
        L = min([l for l in LEVELS if l >= need] or [LEVELS[0]])
        img = lv[L]
        if callable(wf):
            w = np.ones_like(qx)
            for _ in range(4):
                x = C[0] + (qx - px * w - C[0]) * (1 - d * w)
                y = C[1] + (qy - py * w - C[1]) * (1 - d * w)
                w = wf(x, y)
        else:
            w = wf
            x = C[0] + (qx - px * w - C[0]) * (1 - d * w)
            y = C[1] + (qy - py * w - C[1]) * (1 - d * w)
        s = sample(img, x * L, y * L)
        acc = acc * (1 - s[..., 3:4]) + s[..., :3]
    im = Image.fromarray(np.clip(acc * 255 + 0.5, 0, 255).astype(np.uint8))
    return im if SS == 1 else im.resize((OW, OH), Image.LANCZOS)


def main():
    concept = sys.argv[1]
    part = None
    if len(sys.argv) > 2 and sys.argv[2].startswith("part="):
        k, n_ = sys.argv[2][5:].split("/"); part = (int(k), int(n_)); only = None
    else:
        only = sys.argv[2:] and [int(f) for f in sys.argv[2].split(",")]
    out = os.path.join(OUTROOT, concept, BGDIR); os.makedirs(out, exist_ok=True)
    end = {"combo": 8.4}.get(concept, SHOTS[concept][-1][1])
    n = int(round(end * FPS))
    cams = [cam_at(concept, f / FPS) for f in range(n)]
    json.dump({"C": C.tolist(), "TW": TW, "cams": cams}, open(os.path.join(out if HD else os.path.join(OUTROOT, concept), "cam.json"), "w"))
    layers = load()
    for f in range(n):
        if only and f not in only:
            continue
        if part and f % part[1] != part[0]:
            continue
        p = os.path.join(out, f"bg_{f:04d}.png")
        if os.path.exists(p) and not only:
            continue
        if part and os.path.exists(p + ".lock"):
            continue
        render(layers, cams[f]).save(p)
        if f % FPS == 0:
            print(concept, f, "/", n, flush=True)
    print("done", concept)


if __name__ == "__main__":
    main()

"""Colour calibration for the Cycles renders.

calib.py fit RENDER_REST.png            -> writes calib.json (per-channel linear map, linear light)
calib.py apply IN.png OUT.png           -> applies it (16-bit in, 8-bit sRGB out)

The flat, unshadowed sheet under the key + sky renders as a*plate + b per channel (diffuse
gain and a constant specular term). Inverting that makes a flat rest frame equal the plate
and every lit/shadowed part keeps its relative light.
"""
import sys, os, json
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PLATE = r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\lobby-plate-sky.png"


def to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(l):
    l = np.clip(l, 0, 1)
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * l ** (1 / 2.4) - 0.055)


def load(p):
    im = Image.open(p)
    a = np.asarray(im).astype(np.float64)
    if a.dtype != np.uint8 and a.max() > 255:
        a = a / 65535.0
    else:
        a = a / (65535.0 if im.mode.startswith("I") else 255.0)
    if a.ndim == 2:
        a = np.stack([a] * 3, 2)
    return a[:, :, :3]


def load16(p):
    import cv2  # noqa
    raise RuntimeError


def read_png16(p):
    # Pillow reads 16-bit RGB PNGs as 8-bit; use Blender-free path via imageio if available
    try:
        import imageio.v3 as iio
        a = iio.imread(p).astype(np.float64)
        return (a / (65535.0 if a.max() > 255 else 255.0))[:, :, :3]
    except Exception:
        return load(p)


if sys.argv[1] == "fit":
    r = to_lin(read_png16(sys.argv[2]))
    pl = to_lin(np.asarray(Image.open(PLATE).convert("RGB")).astype(np.float64) / 255)
    if pl.shape != r.shape:
        pl = to_lin(np.asarray(Image.open(PLATE).convert("RGB").resize((r.shape[1], r.shape[0]), Image.BOX)).astype(np.float64) / 255)
    m = np.ones(r.shape[:2], bool)
    m[:40] = m[-40:] = False; m[:, :40] = m[:, -40:] = False
    out = {}
    for c in range(3):
        A = np.stack([pl[m][:, c], np.ones(m.sum())], 1)
        sol, *_ = np.linalg.lstsq(A, r[m][:, c], rcond=None)
        out["abc"[c]] = [float(sol[0]), float(sol[1])]
    json.dump(out, open(os.path.join(HERE, "calib.json"), "w"), indent=1)
    print("calib", out)
else:
    cal = json.load(open(os.path.join(HERE, "calib.json")))
    r = to_lin(read_png16(sys.argv[2]))
    o = np.empty_like(r)
    for c in range(3):
        a, b = cal["abc"[c]]
        o[:, :, c] = (r[:, :, c] - b) / a
    Image.fromarray(np.round(to_srgb(o) * 255).astype(np.uint8)).save(sys.argv[3])

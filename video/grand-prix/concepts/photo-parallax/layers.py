"""Cut the real 2025 photo into depth layers for the 2.5D parallax.

    python layers.py            -> C:/Users/User/scratch-intro/gp/layers/*.png

All coordinates are in the photo resized to 2000x1506 (the original is
4080x3072). Masks are hand-drawn polygons, drawn at 3x and filtered down so
edges are soft (1-2 px). The base plate (wall, ceiling, stage floor, steps)
has every cut-out object filled by push-pull smearing plus cloned grain, so
nothing is blank when the nearer layers slide over it. The projector screen
gets the flat brand title card (AWANA GRAND PRIX) so no year shows.

Shared by photo-parallax and combo (render_bg.py reads these files).
"""
import os, sys, json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SRC = r"C:\Users\User\.claude\uploads\55a49d87-dfcf-59c2-9a77-59c621f611d9\66e527a5-image.jpg"
OUT = r"C:\Users\User\scratch-intro\gp\layers"
HERE = os.path.dirname(os.path.abspath(__file__))
BRAND = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", "shared", "brand"))
W, H = 2000, 1506
SS = 3

TOK = json.load(open(os.path.join(BRAND, "tokens.json")))
HOUSE = TOK["house"]

# --- hand-drawn polygons (photo px) ------------------------------------------
US_FLAG = [(160, 497), (186, 497), (186, 540), (200, 600), (202, 700), (198, 820), (196, 960), (186, 1010),
           (172, 1030), (172, 1060), (208, 1068), (214, 1094), (160, 1108), (98, 1102), (100, 1074), (150, 1062),
           (150, 1050), (96, 1048), (88, 960), (90, 860), (102, 760), (116, 650), (138, 580), (158, 545)]
RED_FLAG = [(552, 494), (574, 494), (572, 540), (580, 580), (596, 660), (604, 760), (602, 840), (588, 880),
            (572, 960), (566, 1040), (560, 1084), (568, 1096), (572, 1132), (512, 1140), (458, 1130), (462, 1104),
            (504, 1092), (500, 1070), (494, 980), (496, 900), (506, 800), (514, 720), (530, 640), (546, 580),
            (552, 540)]
TROPHY = [(180, 868), (186, 840), (194, 822), (240, 816), (300, 816), (326, 812), (332, 790), (356, 790),
          (362, 812), (420, 814), (470, 814), (498, 818), (500, 896), (488, 908), (476, 1086), (456, 1086),
          (456, 920), (340, 916), (334, 1070), (316, 1074), (318, 940), (232, 960), (222, 1094), (204, 1094),
          (206, 912), (180, 900)]
TABLE = [(1140, 882), (1150, 872), (1300, 870), (1460, 866), (1468, 856), (1545, 856), (1560, 872),
         (1700, 880), (1965, 902), (1966, 936), (1946, 962), (1944, 1080), (1960, 1196), (1964, 1222),
         (1900, 1224), (1700, 1206), (1500, 1188), (1300, 1168), (1176, 1154), (1158, 1146), (1164, 1040),
         (1162, 940), (1140, 916)]
# the track's top surface + side face, left edge then right edge (bottom up)
TRACK_L = [(831, 746), (790, 820), (752, 900), (720, 950), (690, 1000), (660, 1050), (628, 1100),
           (594, 1150), (555, 1200), (510, 1250), (462, 1300), (406, 1350), (345, 1400), (280, 1450), (205, 1506)]
TRACK_R = [(908, 746), (872, 820), (838, 900), (814, 950), (794, 1000), (778, 1050), (764, 1100),
           (734, 1150), (700, 1200), (672, 1250), (642, 1300), (604, 1350), (562, 1400), (510, 1450), (446, 1506)]
GATE_CARS = (834, 722, 916, 752)          # the four real cars at the gate (replaced by drawn ones)
SCREEN = (814, 467, 1203, 712)            # projector screen surface

# ceiling line (wall/ceiling join), for the depth field
CEIL = [(0, 595), (210, 635), (770, 478), (1240, 462), (1750, 535), (2000, 568)]


K = 1          # layer resolution: 1 = 2000 px wide (previews), 2 = 4000 px (finals)


def mask(polys):
    ss = SS if K == 1 else 2
    m = Image.new("L", (W * K * ss, H * K * ss), 0)
    d = ImageDraw.Draw(m)
    for p in polys:
        d.polygon([(x * K * ss, y * K * ss) for x, y in p], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(ss * 0.6 * K)).resize((W * K, H * K), Image.LANCZOS)
    return np.asarray(m).astype(np.float32) / 255.0


def pushpull(img, known):
    """Fill unknown pixels by a smooth push-pull pyramid (content smear)."""
    levels = []
    c, w = img * known[..., None], known.copy()
    while min(w.shape) > 2:
        levels.append((c, w))
        h2, w2 = (w.shape[0] + 1) // 2 * 2, (w.shape[1] + 1) // 2 * 2
        cp = np.zeros((h2, w2, 3), np.float32); cp[:c.shape[0], :c.shape[1]] = c
        wp = np.zeros((h2, w2), np.float32); wp[:w.shape[0], :w.shape[1]] = w
        c = cp.reshape(h2 // 2, 2, w2 // 2, 2, 3).sum((1, 3))
        w = wp.reshape(h2 // 2, 2, w2 // 2, 2).sum((1, 3))
    filled = c / np.maximum(w, 1e-6)[..., None]
    for c, w in reversed(levels):
        up = np.repeat(np.repeat(filled, 2, 0), 2, 1)[:w.shape[0], :w.shape[1]]
        up = np.asarray(Image.fromarray(np.clip(up, 0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(1))).astype(np.float32)
        a = np.clip(w, 0, 1)[..., None]
        filled = (c / np.maximum(w, 1e-6)[..., None]) * a + up * (1 - a)
    return filled


def grain_clone(base, hole, shift):
    """Add the high-frequency texture of a nearby patch (clone) into the hole."""
    lo = np.asarray(Image.fromarray(base.astype(np.uint8)).filter(ImageFilter.GaussianBlur(4))).astype(np.float32)
    hi = base - lo
    sh = np.roll(hi, shift, axis=(0, 1))
    return base + sh * hole[..., None] * 0.9


SCREEN_QUAD = [(815, 466), (1200, 463), (1201, 710), (812, 713)]   # TL TR BR BL, the screen surface


def title_card(w, h):
    """The brand title card as designed (flat, no shadows): sky field, house waves, ink Paytone."""
    S = 2
    im = Image.new("RGB", (w * S, h * S), HOUSE["sky"])
    d = ImageDraw.Draw(im)
    def wave(col, top, amp, phase, freq):
        pts = [(i / 200 * w * S, (top + amp * np.sin(i / 200 * 2 * np.pi * freq + phase)) * S) for i in range(201)]
        d.polygon(pts + [(w * S, h * S), (0, h * S)], fill=col)
    wave(HOUSE["cloud"], h * 0.74, h * 0.035, 0.6, 0.8)
    wave(HOUSE["blue"], h * 0.85, h * 0.03, 2.4, 0.9)
    f = ImageFont.truetype(os.path.join(BRAND, "fonts", "PaytoneOne-Regular.ttf"), int(h * 0.19 * S))
    cx = w * S / 2
    for i, line in enumerate(["AWANA", "GRAND PRIX"]):
        y = (h * 0.20 + i * h * 0.23) * S
        tw = d.textlength(line, font=f)
        d.text((cx - tw / 2, y), line, font=f, fill=HOUSE["ink"])
    return im


def perspective_coeffs(dst, src):
    """PIL PERSPECTIVE coefficients mapping output points dst -> input points src."""
    A, B = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); B.append(v)
    return np.linalg.solve(np.array(A, float), np.array(B, float)).tolist()


def projected_insert(P, K):
    """Corner-pin the card onto the screen and make it look projected: the
    photo's own projector white and black level, softness, and grain."""
    H_, W_ = P.shape[:2]
    quad = [(x * K, y * K) for x, y in SCREEN_QUAD]
    cw, ch = 1200, 760
    card = title_card(cw, ch)
    coeffs = perspective_coeffs(quad, [(0, 0), (cw * 2, 0), (cw * 2, ch * 2), (0, ch * 2)])
    warped = np.asarray(card.transform((W_, H_), Image.PERSPECTIVE, coeffs, Image.BICUBIC)).astype(np.float32) / 255
    # tone: the projected image in the photo runs from about (100,118,148) to (172,220,252)
    lo, hi = np.array([100, 118, 148], np.float32), np.array([176, 221, 252], np.float32)
    lum = warped
    proj = lo + lum * (hi - lo)
    proj = np.asarray(Image.fromarray(np.clip(proj, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7 * K))).astype(np.float32)
    rng_ = np.random.default_rng(7)
    proj += rng_.normal(0, 2.6, proj.shape[:2])[..., None]
    # a gentle hot spot: projectors are brighter in the middle
    yy, xx = np.mgrid[0:H_, 0:W_]
    cxq, cyq = np.mean([q[0] for q in quad]), np.mean([q[1] for q in quad])
    r = np.sqrt(((xx - cxq) / (200 * K)) ** 2 + ((yy - cyq) / (130 * K)) ** 2)
    proj *= (1.03 - 0.06 * np.clip(r, 0, 1.5))[..., None]
    m = Image.new("L", (W_, H_), 0); ImageDraw.Draw(m).polygon(quad, fill=255)
    m = np.asarray(m.filter(ImageFilter.GaussianBlur(0.6 * K))).astype(np.float32)[..., None] / 255
    return P * (1 - m) + proj * m


def main():
    global K, OUT
    if len(sys.argv) > 1:
        K = int(sys.argv[1]); OUT = OUT + ("_hd" if K == 2 else "")
    os.makedirs(OUT, exist_ok=True)
    photo = Image.open(SRC).convert("RGB").resize((W * K, H * K), Image.LANCZOS)
    P = np.asarray(photo).astype(np.float32)

    m_us, m_red, m_tro, m_tab = mask([US_FLAG]), mask([RED_FLAG]), mask([TROPHY]), mask([TABLE])
    tp = TRACK_L + TRACK_R[::-1]
    m_trk = mask([tp])
    gx0, gy0, gx1, gy1 = GATE_CARS
    m_cars = mask([[(gx0, gy0), (gx1, gy0), (gx1, gy1), (gx0, gy1)]])

    # --- base plate: everything cut out is smeared/cloned in -----------------
    cut = np.clip(m_us + m_red + m_tro + m_tab + m_trk + m_cars, 0, 1)
    cut_d = np.asarray(Image.fromarray((cut * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9 if K == 1 else 17))).astype(np.float32) / 255
    known = (cut_d < 0.02).astype(np.float32)
    fill = pushpull(P, known)
    fill = grain_clone(fill, 1 - known, (0, 90 * K))
    base = P * known[..., None] + fill * (1 - known[..., None])

    # projector screen: the brand title card, corner-pinned and projected
    base = projected_insert(base, K)
    Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).save(os.path.join(OUT, "base.png"))

    # --- the track: real track with the gate cars smeared out -----------------
    known_t = np.clip(1 - m_cars * 1.5, 0, 1)
    known_t = (known_t > 0.5).astype(np.float32)
    trk_rgb = P * known_t[..., None] + pushpull(P, known_t) * (1 - known_t[..., None])
    # the track top edge stops under the gate (cars area belongs to the wall)
    m_trk2 = m_trk * (1 - m_cars)

    def save(name, rgb, m):
        a = np.dstack([np.clip(rgb, 0, 255), m * 255]).astype(np.uint8)
        Image.fromarray(a, "RGBA").save(os.path.join(OUT, name + ".png"))

    save("track", trk_rgb, m_trk2)
    save("us_flag", P, m_us)
    save("red_flag", P, m_red)
    # trophy table sits behind the US flag: fill the flag area on it from the table
    save("trophy", P, m_tro * (1 - m_us))
    save("table", P, m_tab)
    if K != 1:
        print("layers ->", OUT); return
    # debug overlay
    dbg = photo.copy(); d = ImageDraw.Draw(dbg)
    for p, c in [(US_FLAG, "red"), (RED_FLAG, "yellow"), (TROPHY, "cyan"), (TABLE, "lime"), (tp, "magenta")]:
        d.line(p + [p[0]], fill=c, width=3)
    dbg.save(os.path.join(OUT, "_debug.png"))
    print("layers ->", OUT)


if __name__ == "__main__":
    main()

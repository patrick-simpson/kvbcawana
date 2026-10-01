#!/usr/bin/env python3
"""Extract official Awana mascot sticker art from the printed catalog PDF.

Companion to extract-club-logos.py (which pulls the white-knockout club
wordmarks off the divider pages). The 2026-27 catalog's "Character
Stickers" product pages carry each club's mascot as flat vector sticker
art — die-cut white border included — on a white sheet card, and the PDF
page background is unpainted. Rendering with an alpha channel and
flood-filling the near-white card from the crop edges leaves just the
sticker, which this script trims, downscales and writes as transparent
PNGs the display bundles as banner mascots.

Dev-side tool only (not part of the app build). Requires:
    pip install pymupdf pillow
Usage:
    python3 scripts/extract-club-art.py /path/to/awana-catalog.pdf

Output: src/assets/clubs/{puggles,cubbies,sparks}-mascot.png
        src/assets/clubs/god-loves-you.png

T&T, Trek and Journey have no mascot characters in the catalog; banners
simply omit the mascot slot for them (see src/lib/clubs.js).
"""

import sys
from collections import deque
from pathlib import Path

import fitz  # pymupdf
from PIL import Image, ImageFilter

# (0-based page, clip rect as fractions of page width/height) — hand-tuned
# around each sticker on the "Character Stickers (25 pack)" sheets of the
# New Awana Club Resources page, padded so no art is clipped. Neighboring
# stickers that fall inside a padded rect are discarded by keeping only
# the largest connected component.
ART = {
    "puggles-mascot": (12, (0.540, 0.570, 0.615, 0.622)),   # duck face
    "cubbies-mascot": (12, (0.673, 0.6395, 0.7565, 0.7035)),  # Cubbie bear face
    "sparks-mascot":  (12, (0.578, 0.7495, 0.6755, 0.8285)),  # Sparky starburst pop
    "god-loves-you":  (12, (0.619, 0.5655, 0.699, 0.6265)),   # gold scallop badge
}

DPI = 600
TARGET_MAX = 400     # longest output side, px
WHITE_MIN = 247      # "card white" threshold per RGB channel
MIN_AREA = 20000     # ignore fragments smaller than this at 600 DPI


def is_background(p):
    """Unpainted page (alpha≈0) or the sticker sheet's white card."""
    return p[3] < 24 or (p[0] >= WHITE_MIN and p[1] >= WHITE_MIN and p[2] >= WHITE_MIN)


def is_shadow(p):
    """The soft gray drop-shadow printed around each die-cut sticker:
    grayish (low chroma) and clearly darker than the pure-white border,
    so a fill that traverses shadow stops at the border's white."""
    if p[3] < 24:
        return True
    lo, hi = min(p[0], p[1], p[2]), max(p[0], p[1], p[2])
    return 150 <= lo and hi <= 250 and hi - lo < 20


def extract(page, frac_rect):
    """Render the clip with alpha, key out card white reachable from the
    crop edges, and keep only the largest remaining component."""
    r = page.rect
    fx0, fy0, fx1, fy1 = frac_rect
    clip = fitz.Rect(r.width * fx0, r.height * fy0, r.width * fx1, r.height * fy1)
    pix = page.get_pixmap(dpi=DPI, clip=clip, alpha=True)
    im = Image.frombytes("RGBA", (pix.width, pix.height), pix.samples)
    w, h = im.size
    px = im.load()

    # Flood-fill background from every edge pixel.
    bg = bytearray(w * h)
    queue = deque()
    for x in range(w):
        for y in (0, h - 1):
            if is_background(px[x, y]) and not bg[y * w + x]:
                bg[y * w + x] = 1
                queue.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_background(px[x, y]) and not bg[y * w + x]:
                bg[y * w + x] = 1
                queue.append((x, y))
    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and not bg[ny * w + nx] and is_background(px[nx, ny]):
                bg[ny * w + nx] = 1
                queue.append((nx, ny))

    # Second pass: let the fill continue through the sticker's gray
    # drop-shadow ring (but not its pure-white die-cut border), so the
    # shadow doesn't binarize into a jaggy halo around the border.
    queue = deque(
        (x, y)
        for y in range(h)
        for x in range(w)
        if bg[y * w + x]
    )
    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and not bg[ny * w + nx] and is_shadow(px[nx, ny]):
                bg[ny * w + nx] = 1
                queue.append((nx, ny))

    # Connected components over the remaining (art) pixels.
    seen = bytearray(w * h)
    best = None
    for yy in range(h):
        for xx in range(w):
            i = yy * w + xx
            if bg[i] or seen[i]:
                continue
            comp = deque([(xx, yy)])
            seen[i] = 1
            pixels = []
            while comp:
                x, y = comp.popleft()
                pixels.append((x, y))
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if 0 <= nx < w and 0 <= ny < h:
                        j = ny * w + nx
                        if not bg[j] and not seen[j]:
                            seen[j] = 1
                            comp.append((nx, ny))
            if len(pixels) >= MIN_AREA and (best is None or len(pixels) > len(best)):
                best = pixels

    if not best:
        return None

    keep = bytearray(w * h)
    minx = miny = 10 ** 9
    maxx = maxy = -1
    for x, y in best:
        keep[y * w + x] = 1
        if x < minx: minx = x
        if x > maxx: maxx = x
        if y < miny: miny = y
        if y > maxy: maxy = y

    out = im.crop((minx, miny, maxx + 1, maxy + 1)).copy()
    op = out.load()
    for y in range(out.height):
        row = (miny + y) * w
        for x in range(out.width):
            if not keep[row + minx + x]:
                op[x, y] = (0, 0, 0, 0)

    # Feather the hard cut edge, then let the downscale anti-alias it.
    alpha = out.getchannel("A").filter(ImageFilter.GaussianBlur(1.5))
    out.putalpha(alpha)
    if max(out.size) > TARGET_MAX:
        scale = TARGET_MAX / max(out.size)
        out = out.resize(
            (max(1, round(out.width * scale)), max(1, round(out.height * scale))),
            Image.LANCZOS,
        )
    return out


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    doc = fitz.open(Path(sys.argv[1]))
    out_dir = Path(__file__).resolve().parent.parent / "src" / "assets" / "clubs"
    out_dir.mkdir(parents=True, exist_ok=True)

    for name, (page_no, rect) in ART.items():
        art = extract(doc[page_no], rect)
        if art is None:
            print(f"!! {name}: nothing found in clip — check the rect")
            continue
        dest = out_dir / f"{name}.png"
        # Flat sticker art compresses far better as a palette PNG, and the
        # 256-color quantization is invisible at signage size.
        art.quantize(colors=256, method=Image.Quantize.FASTOCTREE).save(dest, optimize=True)
        print(f"{name}: {art.size[0]}x{art.size[1]} -> {dest} ({dest.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

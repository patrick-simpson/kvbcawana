#!/usr/bin/env python3
"""Extract official Awana club logos from the printed catalog PDF.

The 2026-27 catalog's club divider pages carry each club's wordmark as
white vector art on a solid club-color wave. This script renders each
logo region at 300 DPI, keys the solid background out to alpha, and
writes white-on-transparent PNGs the display bundles as banner logos.

Dev-side tool only (not part of the app build). Requires:
    pip install pymupdf pillow
Usage:
    python3 scripts/extract-club-logos.py /path/to/awana-catalog.pdf

Output: src/assets/clubs/{puggles,cubbies,sparks,tnt}.png

Trek and Journey have no logo art in this catalog; their wordmarks are
custom catalog-style builds instead (see render-club-wordmarks.mjs).
Mascot sticker art comes from extract-club-art.py.
"""

import sys
from pathlib import Path
from statistics import median

import fitz  # pymupdf
from PIL import Image

# (0-based page, clip rect as fractions of page width/height) — hand-tuned
# so each clip contains only the logo on its solid wave color, safely
# below the wave's curved top edge.
LOGOS = {
    "puggles": (24, (0.03, 0.86, 0.42, 0.985)),
    "cubbies": (32, (0.06, 0.875, 0.44, 0.975)),
    "sparks":  (40, (0.06, 0.875, 0.42, 0.985)),
    "tnt":     (48, (0.06, 0.865, 0.30, 0.995)),
}

TARGET_WIDTH = 800
PAD_FRAC = 0.04


def key_out_background(im: Image.Image) -> Image.Image:
    """White art on a solid color -> white RGBA with alpha from color distance."""
    rgb = im.convert("RGB")
    px = rgb.load()
    w, h = rgb.size

    # Median border-ring color = the solid wave background.
    ring = []
    for x in range(0, w, 4):
        ring += [px[x, 0], px[x, h - 1]]
    for y in range(0, h, 4):
        ring += [px[0, y], px[w - 1, y]]
    bg = tuple(median(c[i] for c in ring) for i in range(3))
    white_dist = sum(abs(255 - bg[i]) for i in range(3)) or 1

    out = Image.new("RGBA", rgb.size)
    op = out.load()
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            a = sum(abs(p[i] - bg[i]) for i in range(3)) / white_dist
            # Soft ramp kills compression speckle without eating the
            # anti-aliased stroke edges.
            a = min(1.0, max(0.0, (a - 0.06) / (0.94 - 0.06)))
            op[x, y] = (255, 255, 255, round(a * 255))
    return out


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    pdf_path = Path(sys.argv[1])
    out_dir = Path(__file__).resolve().parent.parent / "src" / "assets" / "clubs"
    out_dir.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(pdf_path)
    for name, (page_no, (fx0, fy0, fx1, fy1)) in LOGOS.items():
        page = doc[page_no]
        r = page.rect
        clip = fitz.Rect(
            r.x0 + r.width * fx0, r.y0 + r.height * fy0,
            r.x0 + r.width * fx1, r.y0 + r.height * fy1,
        )
        pix = page.get_pixmap(dpi=300, clip=clip)
        im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)

        keyed = key_out_background(im)
        bbox = keyed.getbbox()
        if not bbox:
            print(f"!! {name}: nothing found in clip — check the rect")
            continue
        pad_x = round((bbox[2] - bbox[0]) * PAD_FRAC)
        pad_y = round((bbox[3] - bbox[1]) * PAD_FRAC)
        keyed = keyed.crop((
            max(0, bbox[0] - pad_x), max(0, bbox[1] - pad_y),
            min(keyed.width, bbox[2] + pad_x), min(keyed.height, bbox[3] + pad_y),
        ))
        if keyed.width > TARGET_WIDTH:
            keyed = keyed.resize(
                (TARGET_WIDTH, round(keyed.height * TARGET_WIDTH / keyed.width)),
                Image.LANCZOS,
            )
        dest = out_dir / f"{name}.png"
        keyed.save(dest, optimize=True)
        print(f"{name}: {keyed.size[0]}x{keyed.size[1]} -> {dest} ({dest.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

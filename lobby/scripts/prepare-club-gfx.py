#!/usr/bin/env python3
"""Prepare user-supplied official club art for the display.

Companion to extract-club-logos.py / extract-club-art.py (which pull art
out of the printed catalog PDF). This one takes a folder of loose
official art files instead — the Agents of Grace (T&T) character PNGs,
the Puggles character clip art, and the official Trek / Journey wordmark
PNGs — and processes them the same way the catalog pipeline does: trim
to content, downscale to signage size, and quantize flat art to palette
PNGs so the bundle stays light.

The black Trek/Journey wordmarks are recolored to white (preserving each
pixel's alpha) because banner logos sit on the club-color wave, where
only the white-knockout treatment reads (see src/lib/clubs.js).

Dev-side tool only (not part of the app build). Requires:
    pip install pillow
Usage:
    python3 scripts/prepare-club-gfx.py /path/to/gfx

where the folder contains "PNG Files/" (Agents of Grace art),
"Puggles Clip Art/", trek-logo.png and journey-Logo.png.

Output: src/assets/clubs/{tnt-mascot,puggles-mascot,trek,journey}.png
        src/assets/clubs/extras/{tnt,puggles}/*.png  (unbundled spares)
"""

import sys
from pathlib import Path

from PIL import Image

TARGET_LOGO_WIDTH = 800   # matches extract-club-logos.py
TARGET_MASCOT_MAX = 400   # matches extract-club-art.py
TARGET_EXTRA_MAX = 800    # spare character art, longest side
PAD_FRAC = 0.02


def load(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def trim(im: Image.Image) -> Image.Image:
    """Crop to the alpha bounding box plus a whisker of padding."""
    bbox = im.getbbox()
    if not bbox:
        return im
    pad_x = round((bbox[2] - bbox[0]) * PAD_FRAC)
    pad_y = round((bbox[3] - bbox[1]) * PAD_FRAC)
    return im.crop((
        max(0, bbox[0] - pad_x), max(0, bbox[1] - pad_y),
        min(im.width, bbox[2] + pad_x), min(im.height, bbox[3] + pad_y),
    ))


def fit(im: Image.Image, max_side: int) -> Image.Image:
    if max(im.size) <= max_side:
        return im
    scale = max_side / max(im.size)
    return im.resize(
        (max(1, round(im.width * scale)), max(1, round(im.height * scale))),
        Image.LANCZOS,
    )


def whiten(im: Image.Image) -> Image.Image:
    """Black wordmark -> white-on-transparent, keeping anti-aliased edges.

    If the source already carries transparency, keep its alpha and just
    flip the ink to white. A flattened source (opaque white background)
    instead derives alpha from how dark each pixel is.
    """
    alpha = im.getchannel("A")
    if alpha.getextrema()[0] < 128:
        out = Image.new("RGBA", im.size, (255, 255, 255, 255))
        out.putalpha(alpha)
        return out
    lum = im.convert("L").point(lambda v: 255 - v)
    out = Image.new("RGBA", im.size, (255, 255, 255, 255))
    out.putalpha(lum)
    return out


def save(im: Image.Image, dest: Path, quantize: bool = True) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if quantize:
        # Flat vector-style art compresses far better as a palette PNG,
        # and the 256-color quantization is invisible at signage size.
        im = im.quantize(colors=256, method=Image.Quantize.FASTOCTREE)
    im.save(dest, optimize=True)
    print(f"{dest.relative_to(dest.parents[3])}: "
          f"{im.size[0]}x{im.size[1]} ({dest.stat().st_size // 1024} KB)")


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    src = Path(sys.argv[1])
    clubs = Path(__file__).resolve().parent.parent / "src" / "assets" / "clubs"
    aog = src / "PNG Files"
    pug = src / "Puggles Clip Art"

    # ── Banner art (bundled via src/lib/clubs.js) ──────────────
    save(fit(trim(load(aog / "rabbot.png")), TARGET_MASCOT_MAX),
         clubs / "tnt-mascot.png")
    save(fit(trim(load(pug / "Puggles.png")), TARGET_MASCOT_MAX),
         clubs / "puggles-mascot.png")
    for name, filename in (("trek", "trek-logo.png"), ("journey", "journey-Logo.png")):
        mark = trim(whiten(load(src / filename)))
        if mark.width > TARGET_LOGO_WIDTH:
            mark = mark.resize(
                (TARGET_LOGO_WIDTH, round(mark.height * TARGET_LOGO_WIDTH / mark.width)),
                Image.LANCZOS,
            )
        save(mark, clubs / f"{name}.png", quantize=False)

    # ── Spares (committed for future use; Vite bundles only what
    #    src/ code imports, so these cost nothing in dist/) ──────
    tnt_extras = {
        "chase-1": "chase1.png", "chase-2": "chase2.png",
        "tommy-1": "tommy1.png", "tommy-2": "tommy2.png",
        "nora-1": "nora1.png", "nora-2": "nora2.png",
        "marcos-1": "marcos 1.png", "marcos-2": "marcos 2.png",
        "rabbot": "rabbot.png",
        "cover-characters": "cover_characters.png",
        "aog-title": "AOG title.png",
        "tnt-blue-logo": "T&T blue logo.png",
    }
    for name, filename in tnt_extras.items():
        save(fit(trim(load(aog / filename)), TARGET_EXTRA_MAX),
             clubs / "extras" / "tnt" / f"{name}.png")

    puggles_extras = {
        "alice": "Alice.png", "maya": "Maya.png", "sydney": "Sydney.png",
        "puggles-duck": "Puggles.png",
        "four-characters": "Four Characters.png",
        "puggles-logo-color": "Puggles Logo.png",
        "puggles-logo-black": "Puggles Logo_Face and words_black.png",
    }
    for name, filename in puggles_extras.items():
        save(fit(trim(load(pug / filename)), TARGET_EXTRA_MAX),
             clubs / "extras" / "puggles" / f"{name}.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

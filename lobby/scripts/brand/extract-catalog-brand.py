#!/usr/bin/env python3
"""Extract reusable brand assets from the Awana Clubs 2026-27 product catalog.

Reproducible, read-only against the PDF. Everything lands in out-dir.

    python3 scripts/brand/extract-catalog-brand.py /path/to/catalog.pdf [out-dir]

The catalog is the "Download" PDF of the flipbook at
https://awana-catalog.s3.us-east-2.amazonaws.com/flipbooks/awana-product-guide-26-27/index.html
(inc/pdf/ox6kwtbhhd.pdf, 109 pages, ~50 MB; not committed). out-dir defaults to
./catalog-extract. shared/brand/ is then curated BY HAND from that output (the
white / full-colour / one-colour logos, waves, tabs, chip plate + keyline,
starburst, tip blob and doodles); see shared/brand/README.md for the mapping.

Requires: pymupdf (fitz) >= 1.24, pillow, and for the PNG step node + the
playwright-core in this repo's node_modules (see svg2png.mjs; CHROME=<path>
picks a browser binary). MuPDF's own SVG reader
ignores clip-path, which the Sparks gradient letters depend on, so PNGs are
rasterized FROM the SVGs by Chromium: the PNG and the SVG are one artwork.

Pipeline, per asset kind
------------------------
* Logos, grade chips (vector, may carry clips / gradient images / live text):
  page.show_pdf_page(clip) onto a scratch page -> page.get_svg_image(
  text_as_path=True) -> strip every leaf element whose bbox covers the whole
  clip (the award-table cell, the orange band, the purple wave, the page-white
  rect, the photo) -> Chromium PNG with alpha. A fidelity check composites
  the PNG back over the page's own background colour and diffs it against
  MuPDF's render of the original page (numbers go in manifest.json).
* Single shapes (doodles, waves, tabs, starburst, blob): rebuilt from
  page.get_drawings() into a tiny SVG that paints in currentColor, so CSS
  picks the club colour. The sampled source colour is kept in the manifest.
* Rasters that only exist as rasters (divider logo PNGs, product photos of
  pins / books): doc.extract_image at native resolution, smask applied,
  CMYK -> RGB. Kept for reference; the vector versions supersede the logos.

Page numbers below are 1-based PDF pages. Printed folios equal the PDF page
up to p.76 and run one behind from p.77 (pdf 89 is printed "88").
"""

import io
import json
import math
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
PDF = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd() / "catalog.pdf"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path.cwd() / "catalog-extract"
OUT.mkdir(parents=True, exist_ok=True)
PNG_W_LOGO = 1600       # >= 1200 px wide as asked
PNG_W_CHIP = 1200
PNG_W_SHAPE = 1200

doc = pymupdf.open(PDF)
MANIFEST = {"source": str(PDF), "pages": doc.page_count, "assets": []}
PNG_JOBS = []           # (svg, png, width) handed to Chromium in one go
CHECKS = []             # fidelity checks run after rasterizing


def hx(c):
    return None if c is None else "#%02X%02X%02X" % tuple(round(v * 255) for v in c[:3])


def rect(t):
    return pymupdf.Rect(*t)


# ════════════════════════════════════════════════════════════════════
#  1. Official club logos (vector)
# ════════════════════════════════════════════════════════════════════
#
# Full colour: the Awards Directory, pdf p.89 (printed 88) — every club's
# 2026-27 mark in full colour, all vector, on pale tinted table cells.
# White knockout: the "Looking for themed items" band, pdf p.94 (printed 93)
# — every club mark as white vector on the orange band. Its boxes are found
# by clustering, so only the y band is hand-tuned.
# The Awana Clubs master logo exists in vector only as the white mark on the
# cover (pdf p.1). Journey and Trek also appear white on their dividers
# (pdf p.63 / p.57) and are exported as a cross-check of the p.94 copies.

FULL_COLOR = {  # club: (pdf page, tight box in pt, cell background colour)
    "puggles": (89, (47, 141, 147, 198)),
    "cubbies": (89, (37, 237, 157, 271)),
    "sparks":  (89, (38, 320, 156, 359)),
    "tnt":     (89, (59, 396, 126, 456)),
    "trek":    (89, (50, 506, 144, 527)),
    "journey": (89, (43, 593, 151, 611)),
}
WHITE_BAND = (94, 645.0, 692.0)          # pdf page, y0, y1 of the logo row
WHITE_ORDER = ["puggles", "cubbies", "sparks", "tnt", "trek", "journey"]
EXTRA_WHITE = {  # name: (pdf page, box) — single-colour white vector marks
    "awana-clubs/awana-clubs-white": (1, (65, 52, 290, 146)),
    # p.94's Journey mark prints only the "T" of its TM (catalog defect), so the
    # primary white Journey comes from the divider; p.94's copy is kept as -p94.
    "journey/journey-white": (63, (68, 698, 203, 720)),
    "trek/trek-white-divider-p57": (57, (62, 707, 179, 732)),
}

NUM = re.compile(r"[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")
MAT = re.compile(r"matrix\(([^)]*)\)")
ET.register_namespace("", "http://www.w3.org/2000/svg")
ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")
ET.register_namespace("inkscape", "http://www.inkscape.org/namespaces/inkscape")
SVGNS = "{http://www.w3.org/2000/svg}"


def mat_of(el):
    t = el.get("transform")
    if not t:
        return pymupdf.Identity
    m = MAT.search(t)
    if not m:
        return pymupdf.Identity
    return pymupdf.Matrix(*[float(v) for v in NUM.findall(m.group(1))])


def path_points(d):
    """Every end/control point of an SVG path (absolute + relative cmds)."""
    toks = re.findall(r"[MLCHVZSQTAmlchvzsqta]|" + NUM.pattern, d)
    pts, cx, cy, cmd, i, start = [], 0.0, 0.0, "M", 0, (0.0, 0.0)
    arity = {"M": 2, "L": 2, "C": 6, "S": 4, "Q": 4, "T": 2, "H": 1, "V": 1, "A": 7, "Z": 0}
    while i < len(toks):
        t = toks[i]
        if t.isalpha():
            cmd = t
            i += 1
            if cmd in "Zz":
                cx, cy = start
                continue
        n = arity[cmd.upper()]
        vals = [float(v) for v in toks[i:i + n]]
        i += n
        rel = cmd.islower()
        U = cmd.upper()
        if U == "H":
            cx = cx + vals[0] if rel else vals[0]
        elif U == "V":
            cy = cy + vals[0] if rel else vals[0]
        elif U == "A":
            cx, cy = (cx + vals[5], cy + vals[6]) if rel else (vals[5], vals[6])
        else:
            for k in range(0, n, 2):
                x, y = vals[k], vals[k + 1]
                if rel:
                    x, y = cx + x, cy + y
                pts.append((x, y))
            cx, cy = pts[-1]
        pts.append((cx, cy))
        if U == "M":
            start = (cx, cy)
            cmd = "l" if rel else "L"
    return pts


def strip_backgrounds(svg, vw, vh, tol=0.5):
    """Drop leaf elements whose bbox covers the whole viewBox (backgrounds)."""
    root = ET.fromstring(svg)
    parent = {c: p for p in root.iter() for c in p}
    removed = []

    def cum(el):
        # point_in_el * M_el * M_parent * ... = page point
        m = pymupdf.Identity
        while el is not None:
            m = m * mat_of(el)
            el = parent.get(el)
        return m

    view = pymupdf.Rect(0, 0, vw, vh)
    culled = 0
    for el in list(root.iter()):
        tag = el.tag.replace(SVGNS, "")
        if tag not in ("path", "image", "rect", "use"):
            continue
        # skip anything inside <defs> (clip paths, glyph symbols)
        p, in_defs = parent.get(el), False
        while p is not None:
            if p.tag.replace(SVGNS, "") in ("defs", "clipPath", "mask", "symbol"):
                in_defs = True
                break
            p = parent.get(p)
        if in_defs:
            continue
        m = cum(el)
        if tag == "use":
            # glyph instance: the matrix scale is the font size; a glyph spans
            # at most ~1 em either way of its origin. Cull only if far outside.
            o = pymupdf.Point(0, 0) * m
            em = max(abs(m.a), abs(m.d), abs(m.b), abs(m.c)) * 1.2
            if not pymupdf.Rect(o.x - em, o.y - em, o.x + em, o.y + em).intersects(view):
                parent[el].remove(el)
                culled += 1
            continue
        if tag == "path":
            pts = path_points(el.get("d", ""))
        else:
            w, h = float(el.get("width", 0)), float(el.get("height", 0))
            x, y = float(el.get("x", 0)), float(el.get("y", 0))
            pts = [(x, y), (x + w, y), (x, y + h), (x + w, y + h)]
        if not pts:
            continue
        tp = [pymupdf.Point(*q) * m for q in pts]
        bb = pymupdf.Rect(min(q.x for q in tp), min(q.y for q in tp),
                          max(q.x for q in tp), max(q.y for q in tp))
        if bb.x0 <= tol and bb.y0 <= tol and bb.x1 >= vw - tol and bb.y1 >= vh - tol:
            parent[el].remove(el)
            removed.append(f"{tag} fill={el.get('fill')} bbox={[round(v, 1) for v in bb]}")
        elif not (bb + (-1, -1, 1, 1)).intersects(view):
            parent[el].remove(el)          # off-clip content MuPDF emits anyway
            culled += 1

    # drop now-empty groups, then any <defs> entry nothing references
    changed = True
    while changed:
        changed = False
        for el in list(root.iter()):
            for c in list(el):
                if c.tag.replace(SVGNS, "") == "g" and len(c) == 0:
                    el.remove(c)
                    changed = True
    ref = re.compile(r"#([A-Za-z_][\w\-.]*)")
    defs = [d for d in root.iter() if d.tag.replace(SVGNS, "") == "defs"]
    by_id = {c.get("id"): c for d in defs for c in d if c.get("id")}

    def refs_of(el):
        out = set()
        for e in el.iter():
            for k, v in e.attrib.items():
                if "href" in k or "url(" in v:
                    out.update(ref.findall(v))
        return out

    live, stack = set(), []
    for c in root:
        if c.tag.replace(SVGNS, "") != "defs":
            stack.extend(refs_of(c))
    while stack:
        i = stack.pop()
        if i in live or i not in by_id:
            continue
        live.add(i)
        stack.extend(refs_of(by_id[i]))
    for d in defs:
        for c in list(d):
            if c.get("id") and c.get("id") not in live:
                d.remove(c)
    removed.append(f"culled {culled} off-clip elements; kept {len(live)} defs")
    return ET.tostring(root, encoding="unicode"), removed


def clip_svg(pn, box):
    """MuPDF SVG of exactly `box` on pdf page `pn`, backgrounds stripped."""
    box = rect(box)
    scratch = pymupdf.open()
    sp = scratch.new_page(width=box.width, height=box.height)
    sp.show_pdf_page(sp.rect, doc, pn - 1, clip=box)
    raw = sp.get_svg_image(text_as_path=True)
    svg, removed = strip_backgrounds(raw, box.width, box.height)
    return svg, removed


def bg_color_under(pn, box):
    """Colour of the page at a corner of `box` (for the fidelity composite)."""
    pix = doc[pn - 1].get_pixmap(dpi=72, clip=rect(box))
    return pix.pixel(1, 1)


def recolor_svg(svg, frm, to):
    return re.sub(rf'(fill|stroke)="{frm}"', rf'\1="{to}"', svg, flags=re.I)


def add_asset(path_noext, kind, variant, pn, box, svg, png_w, notes="", fidelity_bg=None,
              check=True, png_color=None):
    """Write the SVG, queue its PNG. `png_color` paints a currentColor SVG's
    PNG (the SVG itself stays currentColor so CSS can colour it inline)."""
    svgp = OUT / f"{path_noext}.svg"
    pngp = OUT / f"{path_noext}.png"
    svgp.parent.mkdir(parents=True, exist_ok=True)
    svgp.write_text(svg)
    src = svgp
    if png_color:
        src = OUT / "_tmp" / f"{path_noext.replace('/', '__')}.svg"
        src.parent.mkdir(exist_ok=True)
        src.write_text(svg.replace("<svg ", f'<svg color="{png_color}" ', 1))
    PNG_JOBS.append({"svg": str(src), "png": str(pngp), "width": png_w})
    entry = {"path": f"{path_noext}.png", "svg": f"{path_noext}.svg", "kind": kind,
             "variant": variant, "pdf_page": pn,
             "printed_page": pn if pn <= 76 else pn - 1,
             "box_pt": [round(v, 2) for v in rect(box)], "notes": notes}
    MANIFEST["assets"].append(entry)
    if check:
        CHECKS.append((entry, pn, rect(box), fidelity_bg))
    return entry


def white_band_boxes():
    """Find the six white marks on the orange band from the RENDER, not from
    get_drawings: the band's page also carries pasteboard copies of the same
    art that are clipped away, and would otherwise chain every box together."""
    pn, y0, y1 = WHITE_BAND
    z = 8
    band = pymupdf.Rect(0, y0, 576, y1)
    pix = doc[pn - 1].get_pixmap(matrix=pymupdf.Matrix(z, z), clip=band, alpha=False)
    im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    px = im.load()
    white = lambda p: p[0] > 200 and p[1] > 200 and p[2] > 200 and min(p) > 180
    cols = [any(white(px[x, y]) for y in range(0, im.height, 2)) for x in range(im.width)]
    runs, start = [], None
    for x, c in enumerate(cols + [False]):
        if c and start is None:
            start = x
        elif not c and start is not None:
            runs.append([start, x])
            start = None
    merged = []
    for r in runs:                       # letters of one mark are < 6 pt apart
        if merged and r[0] - merged[-1][1] < 6 * z:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    merged = [r for r in merged if (r[1] - r[0]) > 20 * z]
    assert len(merged) == 6, f"expected 6 logos on p.{pn}, got {len(merged)}: {merged}"
    boxes = {}
    for name, (xa, xb) in zip(WHITE_ORDER, merged):
        rows = [y for y in range(im.height) if any(white(px[x, y]) for x in range(xa, xb, 2))]
        boxes[name] = (xa / z - 1.5, y0 + rows[0] / z - 1.5, xb / z + 1.5, y0 + rows[-1] / z + 1.5)
    return boxes


def do_logos():
    for club, (pn, box) in FULL_COLOR.items():
        svg, removed = clip_svg(pn, box)
        add_asset(f"logos/{club}/{club}-fullcolor", "club-logo", "full-color", pn, box, svg,
                  PNG_W_LOGO, notes=f"Awards Directory cell; stripped: {removed}",
                  fidelity_bg=bg_color_under(pn, box))
    for club, box in white_band_boxes().items():
        pn = WHITE_BAND[0]
        svg, removed = clip_svg(pn, box)
        if club == "journey":            # TM defect on p.94, see EXTRA_WHITE
            add_asset("logos/journey/journey-white-p94-tm-defect", "club-logo",
                      "white knockout (p.94 copy: TM printed as 'T' only)", pn, box, svg,
                      PNG_W_LOGO, notes=f"stripped: {removed}", fidelity_bg=bg_color_under(pn, box))
            continue
        add_asset(f"logos/{club}/{club}-white", "club-logo", "white knockout", pn, box, svg,
                  PNG_W_LOGO, notes=f"orange 'themed items' band; stripped: {removed}",
                  fidelity_bg=bg_color_under(pn, box))
        blk = recolor_svg(svg, "#ffffff", "#000000")
        add_asset(f"logos/{club}/{club}-black", "club-logo",
                  "one-color black (derived: white knockout recoloured)", pn, box, blk,
                  PNG_W_LOGO, notes="for 1-bit thermal labels / light backgrounds", check=False)
    for name, (pn, box) in EXTRA_WHITE.items():
        svg, removed = clip_svg(pn, box)
        bg = None if pn == 1 else bg_color_under(pn, box)   # cover logo sits on a photo
        add_asset(f"logos/{name}", "club-logo", "white knockout", pn, box, svg, PNG_W_LOGO,
                  notes=f"stripped: {removed}", fidelity_bg=bg)
        if name in ("awana-clubs/awana-clubs-white", "journey/journey-white"):
            add_asset(f"logos/{name.replace('-white', '-black')}", "club-logo",
                      "one-color black (derived: white knockout recoloured)", pn, box,
                      recolor_svg(svg, "#ffffff", "#000000"), PNG_W_LOGO, check=False)


# ════════════════════════════════════════════════════════════════════
#  2. Grade / age chips (vector shape + RugFish text as outlines)
# ════════════════════════════════════════════════════════════════════
# One per club divider. The chip is a #030404 plate inside a 50 %-opacity
# transparency group, with a white 1.5 pt keyline offset up-left, and the
# label ("GRADES" 19 pt + "9-12" 34 pt) in RugFish, white.
CHIPS = {  # box = the chip's own clip rectangle on the page (extended get_drawings)
    "puggles": (25, (373, 239, 528, 334), "AGES 2-3"),
    "cubbies": (33, (375, 153, 530, 248), "AGES 3-5"),
    "sparks":  (41, (364, 181, 519, 276), "GRADES K-2"),
    "tnt":     (49, (388, 241, 544, 336), "GRADES 3-6"),
    "trek":    (57, (364, 231, 519, 326), "GRADES 6-8"),
    "journey": (63, (387, 257, 542, 352), "GRADES 9-12"),
}


def do_chips():
    for club, (pn, box, label) in CHIPS.items():
        svg, removed = clip_svg(pn, box)
        add_asset(f"chips/chip-{club}", "grade-chip", "as printed (50% black plate)", pn, box,
                  svg, PNG_W_CHIP, notes=f"{label}; text converted to outlines; stripped: {removed}",
                  check=False)


# ════════════════════════════════════════════════════════════════════
#  3. Single shapes rebuilt from get_drawings (currentColor)
# ════════════════════════════════════════════════════════════════════

def path_d(d, M):
    out, cur = [], None

    def P(p):
        q = p * M
        return f"{q.x:.2f},{q.y:.2f}"

    for it in d["items"]:
        op = it[0]
        if op == "l":
            a, b = it[1], it[2]
            if cur is None or abs(cur.x - a.x) > .01 or abs(cur.y - a.y) > .01:
                out.append("M" + P(a))
            out.append("L" + P(b))
            cur = b
        elif op == "c":
            a, c1, c2, b = it[1:5]
            if cur is None or abs(cur.x - a.x) > .01 or abs(cur.y - a.y) > .01:
                out.append("M" + P(a))
            out.append(f"C{P(c1)} {P(c2)} {P(b)}")
            cur = b
        elif op == "re":
            r = it[1]
            out.append(f"M{P(r.tl)}L{P(r.tr)}L{P(r.br)}L{P(r.bl)}Z")
            cur = None
        elif op == "qu":
            q = it[1]
            out.append(f"M{P(q.ul)}L{P(q.ur)}L{P(q.lr)}L{P(q.ll)}Z")
            cur = None
    if d.get("closePath"):
        out.append("Z")
    return "".join(out)


CAP = {0: "butt", 1: "round", 2: "square"}
JOIN = {0: "miter", 1: "round", 2: "bevel"}


def shape_svg(ds, view, pad=0.0, keep_color=False, rot=0):
    """Rebuild drawings `ds` into an SVG whose viewBox is `view` (+pad)."""
    v = rect(view) + (-pad, -pad, pad, pad)
    M = pymupdf.Matrix(1, 0, 0, 1, -v.x0, -v.y0)
    body = []
    for d in ds:
        dd = path_d(d, M)
        attrs = []
        f, s = d.get("fill"), d.get("color")
        if f is not None:
            attrs.append(f'fill="{hx(f) if keep_color else "currentColor"}"')
            if d.get("fill_opacity", 1) not in (None, 1):
                attrs.append(f'fill-opacity="{d["fill_opacity"]:.3g}"')
            if d.get("even_odd"):
                attrs.append('fill-rule="evenodd"')
        else:
            attrs.append('fill="none"')
        if s is not None:
            attrs.append(f'stroke="{hx(s) if keep_color else "currentColor"}"')
            attrs.append(f'stroke-width="{(d.get("width") or 1):.2f}"')
            caps = d.get("lineCap") or (0,)
            attrs.append(f'stroke-linecap="{CAP.get(max(caps), "butt")}"')
            attrs.append(f'stroke-linejoin="{JOIN.get(int(d.get("lineJoin") or 0), "miter")}"')
        body.append(f'<path {" ".join(attrs)} d="{dd}"/>')
    g = "".join(body)
    if rot:
        g = f'<g transform="rotate({rot} {v.width / 2:.2f} {v.height / 2:.2f})">{g}</g>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {v.width:.2f} {v.height:.2f}" '
            f'width="{v.width:.2f}" height="{v.height:.2f}">{g}</svg>')


def drawing(pn, idx):
    return doc[pn - 1].get_drawings()[idx]


def sig(d):
    return "".join(it[0][0] for it in d["items"])


# name: (pdf page, drawing index, expected item signature prefix)
DOODLES = {
    "sparkle-4pt":      (63, 12, "lclclclc"),
    "sparkle-4pt-x":    (87, 3, "lclclclc"),   # same star, set at 45 degrees
    "dot":              (63, 13, "cccc"),
    "ring":             (1, 4, "cccccccc"),
    "squiggle-wave":    (63, 15, "ccc"),
    "squiggle-s":       (25, 8, "ccc"),
    "squiggle-long":    (33, 5, "ccc"),
    "zigzag":           (63, 14, "ccc"),
    "zigzag-steps":     (41, 5, "ccc"),
    "loop":             (1, 12, "ccc"),
    "loop-stem":        (33, 101, "ccc"),
    "coil-spiral":      (25, 20, "ccc"),
    "coil-spring":      (57, 84, "ccc"),
    "coil-line":        (25, 26, "ccc"),
    "hook-arrow":       (1, 28, "ccc"),
    "check":            (1, 13, "cc"),
    "chevron":          (33, 137, "ll"),
    "smile-arc":        (4, 9, "cc"),
    "dash":             (5, 19, "cccccc"),
    "pixel-heart":      (33, 148, "l"),
    "steps-block":      (25, 35, "l"),
}
BADGES = {
    "starburst":        (93, 1, "llll"),        # "More apparel" 22-point burst
    "tip-blob":         (66, 6, "lccc"),        # "QUICK TIP!" wobbly badge
    "trophy-icon":      (87, 6, "lcc"),         # line-art trophy (Awards opener)
    "chip-plate":       (63, 25, "l"),          # grade chip plate, no text
    "chip-keyline":     (63, 26, "l"),          # grade chip offset keyline
}
# Big colour-block edges. Divider waves: the bottom block on each club
# divider. Section tabs: the wobbly top-left header blob on inner pages.
WAVES = {
    "wave-puggles":  (25, 3), "wave-cubbies": (33, 1), "wave-sparks": (41, 1),
    "wave-tnt":      (49, 11), "wave-trek":   (57, 2), "wave-journey": (63, 1),
    "corner-blob-trek": (57, 1),
}
TABS = {  # name: (pdf page, drawing idx) — three tab families + awards
    "tab-a-puggles": (26, 2), "tab-a-cubbies": (34, 29),
    "tab-b-sparks":  (42, 1), "tab-b-tnt":     (50, 4),
    "tab-c-trek":    (58, 2), "tab-c-journey": (64, 4),
    "tab-awards":    (87, 0),
}
PAGE = pymupdf.Rect(0, 0, 576, 783)


def do_shapes():
    for group, table, folder in (("doodle", DOODLES, "doodles"), ("badge", BADGES, "badges")):
        for name, (pn, idx, want) in table.items():
            d = drawing(pn, idx)
            assert sig(d).startswith(want[:2]), f"{name}: p{pn}#{idx} sig {sig(d)[:12]}"
            pad = (d.get("width") or 0) if d.get("color") else 0.3
            svg = shape_svg([d], d["rect"], pad=pad + 0.5)
            col = "#FFFFFF" if group == "doodle" else hx(d.get("fill") or d.get("color"))
            e = add_asset(f"{folder}/{name}", group, f"SVG currentColor; PNG {col}", pn,
                          d["rect"], svg, PNG_W_SHAPE if group == "badge" else 600,
                          check=False, png_color=col)
            e["source_color"] = hx(d.get("fill") or d.get("color"))
            e["stroke_width_pt"] = d.get("width") if d.get("color") else None
            e["drawing_index"] = idx
    # chip as one recolourable component: plate at 50 % + keyline
    plate, key = drawing(63, 25), drawing(63, 26)
    u = plate["rect"] | key["rect"]
    svg = shape_svg([plate, key], u, pad=1.5, keep_color=True)
    svg = svg.replace('fill="#030404"', 'fill="#030404" fill-opacity="0.5"')
    e = add_asset("badges/chip-blank", "badge", "plate 50% #030404 + white keyline", 63, u, svg,
                  PNG_W_SHAPE, check=False)
    for table, folder in ((WAVES, "edges"), (TABS, "edges")):
        for name, (pn, idx) in table.items():
            d = drawing(pn, idx)
            vis = d["rect"] & PAGE
            svg = shape_svg([d], vis)
            e = add_asset(f"{folder}/{name}", "edge-shape",
                          f"SVG currentColor; PNG {hx(d.get('fill'))}", pn, vis, svg,
                          PNG_W_SHAPE, check=False, png_color=hx(d.get("fill")),
                          notes="viewBox = the part of the shape inside the page trim")
            e["source_color"] = hx(d.get("fill"))
            e["drawing_index"] = idx
            e["full_bbox_pt"] = [round(v, 1) for v in d["rect"]]


# ════════════════════════════════════════════════════════════════════
#  4. Native rasters (reference: the vector logos supersede the first set)
# ════════════════════════════════════════════════════════════════════
RASTERS = {
    "raster/divider-puggles-white":  (25, 1464, "divider white logo (superseded by vector p.94)"),
    "raster/divider-cubbies-white":  (33, 2313, "divider white logo (superseded by vector p.94)"),
    "raster/divider-sparks-white":   (41, 3075, "divider white logo (superseded by vector p.94)"),
    "raster/divider-tnt-white":      (49, 3755, "divider white logo (superseded by vector p.94)"),
    "raster/awana-clubs-white-back": (109, 7737, "back-cover white master logo raster"),
    "journey/awana-ym-pin-photo":    (62, 4380, "PHOTO of the 'awana ym' leadership pin, not a flat logo"),
    "journey/citation-award-pin-photo": (66, 4507, "PHOTO of the Citation Award pin"),
    "journey/citation-award-crystal-photo": (66, 4506, "PHOTO of the crystal Citation Award"),
    "journey/journey-year1-pin-photo": (66, 4508, "PHOTO, Journey Achievement Pin Year 1"),
    "journey/journey-year2-pin-photo": (66, 4509, "PHOTO, Year 2"),
    "journey/journey-year3-pin-photo": (66, 4510, "PHOTO, Year 3"),
    "journey/journey-year4-pin-photo": (66, 4511, "PHOTO, Year 4"),
    "journey/advocates-study-cover-photo": (64, 4414, "PHOTO of the Advocates Study book"),
    "journey/faith-foundation-cover-photo": (64, 4415, "PHOTO of the Faith Foundation booklet"),
    "journey/journey-certificate-photo": (66, 4505, "PHOTO of the Journey Certificate of Award"),
}


def do_rasters():
    for name, (pn, xref, note) in RASTERS.items():
        info = doc.extract_image(xref)
        pix = pymupdf.Pixmap(doc, xref)
        if pix.alpha:
            pix = pymupdf.Pixmap(pix, 0)
        if pix.colorspace is None or pix.colorspace.n != 3:
            pix = pymupdf.Pixmap(pymupdf.csRGB, pix)       # CMYK / Indexed(CMYK) -> RGB
        im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        if info.get("smask"):                              # soft mask may differ in size
            m = pymupdf.Pixmap(doc, info["smask"])
            mask = Image.frombytes("L", (m.width, m.height), m.samples[: m.width * m.height])
            if mask.size != im.size:
                mask = mask.resize(im.size, Image.LANCZOS)
            im.putalpha(mask)
        p = OUT / f"{name}.png"
        p.parent.mkdir(parents=True, exist_ok=True)
        im.save(p, optimize=True)
        MANIFEST["assets"].append({
            "path": f"{name}.png", "kind": "raster", "variant": note, "pdf_page": pn,
            "printed_page": pn if pn <= 76 else pn - 1, "xref": xref,
            "native_px": [pix.width, pix.height], "source_format": info["ext"],
            "source_colorspace": info.get("cs-name") or str(info.get("colorspace"))})


# ════════════════════════════════════════════════════════════════════
#  5. Palette: sampled vector fills, with provenance
# ════════════════════════════════════════════════════════════════════
PALETTE = {  # role: (pdf page, drawing index)
    "puggles.wave": (25, 3), "puggles.tab": (26, 2), "puggles.band": (27, 1),
    "puggles.award_tint": (89, 5), "puggles.logo_blue": (89, 94),
    "cubbies.wave": (33, 1), "cubbies.tab": (34, 29), "cubbies.band": (35, 1),
    "cubbies.award_tint": (89, 6), "cubbies.logo_blue": (89, 140), "cubbies.logo_sky": (89, 147),
    "sparks.wave": (41, 1), "sparks.tab": (42, 1), "sparks.award_tint": (89, 3),
    "sparks.logo_red": (89, 71),
    "tnt.wave": (49, 11), "tnt.tab": (50, 4), "tnt.award_tint": (89, 4), "tnt.logo_green": (89, 50),
    "trek.wave": (57, 2), "trek.tab": (58, 2), "trek.corner_blob": (57, 1),
    "trek.award_tint": (89, 2), "trek.logo_ink": (89, 23),
    "journey.wave": (63, 1), "journey.tab": (64, 4), "journey.band": (65, 1),
    "journey.award_tint": (89, 0), "journey.logo_purple": (89, 14),
    "awards.orange": (87, 0),
    "chip.plate": (63, 25), "doodle.sky": (57, 55),
    "journey.panel": (67, 5), "tip_blob.lavender": (66, 6), "starburst.blue": (93, 1),
}
# Text colours / type roles, sampled from spans: role -> (pdf page, text prefix)
PALETTE_TEXT = {
    "journey.headline_on_panel": (67, "Completely Rewritten"),
    "journey.date_accent": (67, "July 2027"),
    "catalog.subhead_blue": (66, "End-of-Year Awards"),
    "catalog.link_blue": (66, "ExploreAwanaJourney"),
    "catalog.footer_grey": (67, "Product Questions"),
    "divider.club_name": (63, "JOURNEY"),
    "divider.tagline": (63, "Equip and inspire"),
    "chip.label": (63, "GRADES"),
    "tab.label": (64, "STUDENT"),
    "pill.recommended": (67, "RECOMMENDED"),
}


def do_palette():
    pal = {}
    for role, (pn, idx) in PALETTE.items():
        d = drawing(pn, idx)
        pal[role] = {"hex": hx(d.get("fill") or d.get("color")), "pdf_page": pn, "drawing": idx}
    for role, (pn, prefix) in PALETTE_TEXT.items():
        for b in doc[pn - 1].get_text("dict")["blocks"]:
            for ln in b.get("lines", []):
                for sp in ln["spans"]:
                    if sp["text"].strip().startswith(prefix) and role not in pal:
                        pal[role] = {"hex": "#%06X" % sp["color"], "pdf_page": pn,
                                     "font": sp["font"].split("+")[-1],
                                     "size_pt": round(sp["size"], 1), "text": sp["text"].strip()}
    (OUT / "palette.json").write_text(json.dumps(pal, indent=2))
    MANIFEST["palette"] = "palette.json"


# ════════════════════════════════════════════════════════════════════
#  Rasterize, verify, preview
# ════════════════════════════════════════════════════════════════════

def rasterize():
    jobs = OUT / "_png_jobs.json"
    jobs.write_text(json.dumps(PNG_JOBS))
    subprocess.run(["node", str(HERE / "svg2png.mjs"), str(jobs)], check=True)
    jobs.unlink()
    for f in (OUT / "_tmp").glob("*.svg"):
        f.unlink()
    (OUT / "_tmp").rmdir()


def fidelity():
    """Composite each PNG over the page background and diff with MuPDF's render."""
    for entry, pn, box, bg in CHECKS:
        png = Image.open(OUT / entry["path"]).convert("RGBA")
        z = png.width / box.width
        pix = doc[pn - 1].get_pixmap(matrix=pymupdf.Matrix(z, z), clip=box, alpha=False)
        ref = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        png = png.resize(ref.size, Image.LANCZOS)
        a = png.getchannel("A")
        if bg is not None:
            comp = Image.new("RGBA", ref.size, tuple(bg) + (255,))
            comp.alpha_composite(png)
            comp = comp.convert("RGB")
            region = None
        else:  # busy photo background: compare only where the logo is opaque
            comp = Image.composite(png.convert("RGB"), ref, a)
            region = a.point(lambda v: 255 if v > 250 else 0)
        diff = [abs(p - q) for p, q in zip(comp.tobytes(), ref.tobytes())]
        if region is not None:
            mask = region.tobytes()
            sel = [diff[i] for i in range(len(diff)) if mask[i // 3]]
            diff = sel or [0]
        mean = sum(diff) / len(diff)
        bad = sum(1 for v in diff if v > 48) / len(diff)
        entry["fidelity"] = {"mean_abs_diff_0_255": round(mean, 2),
                             "share_channels_off_by_gt48": round(bad, 4),
                             "compared_against": "page background" if bg is not None
                             else "opaque logo pixels only (photo background)"}


def checker(size, sq=24):
    im = Image.new("RGB", size, (255, 255, 255))
    dr = ImageDraw.Draw(im)
    for y in range(0, size[1], sq):
        for x in range(0, size[0], sq):
            if (x // sq + y // sq) % 2:
                dr.rectangle([x, y, x + sq - 1, y + sq - 1], fill=(204, 204, 204))
    return im


def previews():
    pv = OUT / "previews"
    pv.mkdir(exist_ok=True)
    groups = {}
    for e in MANIFEST["assets"]:
        top = e["path"].split("/")[0]
        groups.setdefault(top, []).append(e)
    for top, items in groups.items():
        tiles = []
        for e in items:
            im = Image.open(OUT / e["path"]).convert("RGBA")
            im.thumbnail((380, 150))
            if False:
                col = Image.new("RGBA", im.size, (255, 255, 255, 255))
                col.putalpha(im.getchannel("A"))
                im = col
            t = Image.new("RGB", (800, 190), (255, 255, 255))
            cb = checker((390, 160))
            cb.paste(im, ((390 - im.width) // 2, (160 - im.height) // 2), im)
            dk = Image.new("RGB", (390, 160), (29, 30, 33))
            dk.paste(im, ((390 - im.width) // 2, (160 - im.height) // 2), im)
            t.paste(cb, (5, 5))
            t.paste(dk, (405, 5))
            ImageDraw.Draw(t).text((8, 170), f'{e["path"]}  p.{e["pdf_page"]}  {im.size}',
                                   fill=(160, 0, 0))
            tiles.append(t)
        cols = 2
        rows = math.ceil(len(tiles) / cols)
        sheet = Image.new("RGB", (cols * 800, rows * 190), (255, 255, 255))
        for i, t in enumerate(tiles):
            sheet.paste(t, ((i % cols) * 800, (i // cols) * 190))
        sheet.save(pv / f"sheet-{top}.png")


REPO = HERE.parents[1]
EXISTING = {  # club: (files the repos ship today, catalog replacements)
    "puggles": (["src/assets/clubs/puggles.png", "shared/art/puggles-logo.png",
                 "src/assets/clubs/extras/puggles/puggles-logo-color.png"],
                ["puggles/puggles-white.png", "puggles/puggles-fullcolor.png"]),
    "cubbies": (["src/assets/clubs/cubbies.png", "shared/art/cubbies-logo.png"],
                ["cubbies/cubbies-white.png", "cubbies/cubbies-fullcolor.png"]),
    "sparks":  (["src/assets/clubs/sparks.png", "shared/art/sparks-logo.png"],
                ["sparks/sparks-white.png", "sparks/sparks-fullcolor.png"]),
    "tnt":     (["src/assets/clubs/tnt.png", "shared/art/tnt-logo.png",
                 "src/assets/clubs/extras/tnt/tnt-blue-logo.png"],
                ["tnt/tnt-white.png", "tnt/tnt-fullcolor.png"]),
    "trek":    (["src/assets/clubs/trek.png", "shared/art/trek-logo.png"],
                ["trek/trek-white.png", "trek/trek-fullcolor.png"]),
    "journey": (["src/assets/clubs/journey.png", "shared/art/journey-logo.png"],
                ["journey/journey-white.png", "journey/journey-fullcolor.png"]),
    "awana":   (["shared/art/awana-clubs-logo.png"], ["awana-clubs/awana-clubs-white.png"]),
}


def compare_existing():
    """Side-by-side sheet: what the signage repo ships today vs the catalog set."""
    if not REPO.exists():
        return
    W, H = 260, 120
    sheet = Image.new("RGB", (W * 5 + 10, len(EXISTING) * (H + 18)), (255, 255, 255))
    dr = ImageDraw.Draw(sheet)
    for r, (club, (old, new)) in enumerate(EXISTING.items()):
        cells = [REPO / f for f in old] + [None] * (3 - len(old)) + [OUT / "logos" / f for f in new]
        for c, f in enumerate(cells):
            if f is None or not f.exists():
                continue
            im = Image.open(f).convert("RGBA")
            size = im.size
            im.thumbnail((W - 10, H - 10))
            tile = Image.new("RGB", (W - 6, H), (120, 90, 160))
            tile.paste(im, ((W - 6 - im.width) // 2, (H - im.height) // 2), im)
            x, y = c * W + (10 if c >= 3 else 0), r * (H + 18)
            sheet.paste(tile, (x, y))
            dr.text((x + 2, y + H + 2), ("NEW " if c >= 3 else "OLD ") + f"{f.name} {size[0]}x{size[1]}",
                    fill=(0, 0, 0))
    sheet.save(OUT / "previews" / "compare-existing.png")


def record_sizes():
    for e in MANIFEST["assets"]:
        im = Image.open(OUT / e["path"])
        e["pixel_size"] = list(im.size)


def main():
    do_logos()
    do_chips()
    do_shapes()
    do_palette()
    rasterize()
    do_rasters()
    record_sizes()
    fidelity()
    previews()
    compare_existing()
    (OUT / "manifest.json").write_text(json.dumps(MANIFEST, indent=2))
    for e in MANIFEST["assets"]:
        f = e.get("fidelity")
        print(f'{e["path"]:52s} {str(e["pixel_size"]):>13s} p.{e["pdf_page"]:<3d}'
              + (f' diff={f["mean_abs_diff_0_255"]} off={f["share_channels_off_by_gt48"]}' if f else ""))


if __name__ == "__main__":
    main()

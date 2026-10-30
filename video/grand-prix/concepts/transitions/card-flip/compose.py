"""Assemble the card-flip preview (960x540, 30 fps) from the two rendered
flip segments, the lobby plate and the Grand Prix film's frames, then write
the contact sheet. Encode afterwards with encode.py (Blender VSE).

python compose.py [--work DIR]
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

WORK = sys.argv[sys.argv.index("--work") + 1] if "--work" in sys.argv else r"C:\Users\User\scratch-intro\card-flip-work"
PLATE = r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\lobby-plate-sky.png"
FILM = r"C:\Users\User\scratch-intro\gp\gp-brand\frames1080\frame_%04d.png"
OUTDIR = r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\output\transitions"
SIZE = (960, 540)
NF = 84

def small(path):
    return Image.open(path).convert("RGB").resize(SIZE, Image.BOX)

def blend(a, b, w):
    return Image.fromarray((np.asarray(a, float) * (1 - w) + np.asarray(b, float) * w + 0.5).astype(np.uint8))

def main():
    out = os.path.join(WORK, "final"); os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        os.remove(os.path.join(out, f))
    plate = small(PLATE)
    frames, labels = [], {}
    def put(im, label=None):
        if label:
            labels[len(frames)] = label
        frames.append(im)

    # 1. lobby plate still, 1.0 s
    for i in range(30):
        put(plate, "lobby plate (still)" if i == 0 else None)
    # 2. flip into the film. The render's rest frames are the plate / film
    # to within filtering (measured in the report); the 3 frames at each end,
    # where the card moves < 0.05 px, ease into the exact pictures.
    s1 = os.path.join(WORK, "seg1")
    land1 = small(FILM % 90)
    for n in range(1, NF + 1):
        im = Image.open(os.path.join(s1, "f%03d.png" % n)).convert("RGB")
        if n <= 3:
            im = blend(plate, im, n / 4)
        if n >= NF - 3:
            im = blend(im, land1, (n - (NF - 4)) / 4)
        put(im, {12: "card eases back + tilts", 30: "the flip", 40: "edge-on",
                 56: "film side coming round", 72: "push in, settle"}.get(n))
    # 3. the film's opening plays, film 1.533 -> 4.6 s
    for k, idx in enumerate(range(92, 277, 2)):
        put(small(FILM % idx), {0: "film opening playing", 30: "film 2.5 s (PRIX)", 75: "film 4.0 s"}.get(k))
    # 4. ...skipping the middle... the end card at rest, film 25.0 -> 26.7 s
    for k, idx in enumerate(range(1500, 1601, 2)):
        put(small(FILM % idx), "...skipping the middle... end card" if k == 0 else None)
    # 5. flip back to the lobby
    s2 = os.path.join(WORK, "seg2")
    end0 = small(FILM % 1602)
    for n in range(1, NF + 1):
        im = Image.open(os.path.join(s2, "f%03d.png" % n)).convert("RGB")
        if n <= 3:
            im = blend(end0, im, n / 4)
        if n >= NF - 3:
            im = blend(im, plate, (n - (NF - 4)) / 4)
        put(im, {14: "end card eases back", 36: "flips the other way", 60: "lobby side round",
                 76: "lands flat"}.get(n))
    # 6. lobby plate still, 1.0 s
    for i in range(30):
        put(plate, "lobby plate (still, last frame)" if i == 29 else None)

    for i, im in enumerate(frames):
        im.save(os.path.join(out, "%04d.png" % i))
    print("frames", len(frames), "=", len(frames) / 30, "s")

    # checks: first/last vs plate, and the raw renders' rest frames
    ref = np.asarray(plate, int)
    for name, im in (("first", frames[0]), ("last", frames[-1])):
        d = np.abs(np.asarray(im, int) - ref)
        print(name, "vs plate: mean", round(d.mean(), 4), "max", d.max())
    for name, path, r in (("seg1 n=0 render vs plate", os.path.join(s1, "f000.png"), plate),
                          ("seg1 n=84 render vs film 1.5s", os.path.join(s1, "f084.png"), land1),
                          ("seg2 n=0 render vs end card", os.path.join(s2, "f000.png"), end0),
                          ("seg2 n=84 render vs plate", os.path.join(s2, "f084.png"), plate)):
        d = np.abs(np.asarray(Image.open(path).convert("RGB"), int) - np.asarray(r, int))
        print(name, ": mean", round(d.mean(), 3), "max", d.max())

    # contact sheet
    keys = sorted(labels)
    tw, th = 384, 216
    cols = 4; rows = (len(keys) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (tw + 8) + 8, rows * (th + 34) + 8), (24, 24, 28))
    dr = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("arial.ttf", 15)
    except Exception:
        font = ImageFont.load_default()
    for j, i in enumerate(keys):
        x = 8 + (j % cols) * (tw + 8); y = 8 + (j // cols) * (th + 34)
        sheet.paste(frames[i].resize((tw, th), Image.LANCZOS), (x, y))
        dr.text((x, y + th + 6), "%.2f s  %s" % (i / 30, labels[i]), fill=(235, 235, 235), font=font)
    os.makedirs(OUTDIR, exist_ok=True)
    sheet.save(os.path.join(OUTDIR, "card-flip-contact.png"))

main()

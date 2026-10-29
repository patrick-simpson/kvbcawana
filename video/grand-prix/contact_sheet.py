"""Contact sheet: one labelled still per shot, for reviewing without playing.

    python contact_sheet.py                      # from output/frames_preview
    python contact_sheet.py --dir output/stills --frames 60,200,360
    python contact_sheet.py --ref path/to/photo.jpg   # also output/compare.png

Needs Pillow (pip install pillow). Writes output/contact.png and, given the
reference photo of the room (--ref), output/compare.png: the photo and
frame 1 side by side at the same height, to judge the match.
"""
import argparse, os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = [(1, "1 The room, to the gate"), (136, "2 The race"), (331, "3 The car board"), (466, "4 End card")]


def shot_of(f):
    return [n for s, n in SHOTS if f >= s][-1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.join(HERE, "output", "frames_preview"))
    ap.add_argument("--frames", default="1,60,200,300,400,650")
    ap.add_argument("--ref", default=None, help="the reference photo of the room (for compare.png)")
    ap.add_argument("--out", default=os.path.join(HERE, "output", "contact.png"))
    ap.add_argument("--cols", type=int, default=3)
    a = ap.parse_args()
    frames = [int(x) for x in a.frames.split(",")]
    tw, th, lab = 640, 360, 34
    rows = (len(frames) + a.cols - 1) // a.cols
    sheet = Image.new("RGB", (a.cols * tw + (a.cols + 1) * 8, rows * (th + lab) + (rows + 1) * 8), (24, 24, 28))
    font = ImageFont.truetype(os.path.join(HERE, "..", "..", "shared", "brand", "fonts", "LondrinaSolid-Regular.ttf"), 24)
    d = ImageDraw.Draw(sheet)
    for i, f in enumerate(frames):
        x = 8 + (i % a.cols) * (tw + 8)
        y = 8 + (i // a.cols) * (th + lab + 8)
        p = os.path.join(a.dir, f"frame_{f:04d}.png")
        if os.path.exists(p):
            sheet.paste(Image.open(p).convert("RGB").resize((tw, th), Image.LANCZOS), (x, y))
        else:
            d.rectangle((x, y, x + tw, y + th), outline=(200, 60, 60), width=3)
        t = (f - 1) / 30
        d.text((x + 4, y + th + 4), f"frame {f}  |  {int(t // 60)}:{t % 60:05.2f}  |  shot {shot_of(f)}",
               fill=(235, 235, 235), font=font)
    sheet.save(a.out)
    print("contact sheet:", a.out)
    first = os.path.join(a.dir, "frame_0001.png")
    if a.ref and os.path.exists(a.ref) and os.path.exists(first):
        h = 720
        ref = Image.open(a.ref).convert("RGB")
        f1 = Image.open(first).convert("RGB")
        ref = ref.resize((round(ref.width * h / ref.height), h), Image.LANCZOS)
        f1 = f1.resize((round(f1.width * h / f1.height), h), Image.LANCZOS)
        cmp = Image.new("RGB", (ref.width + f1.width + 24, h + lab + 16), (24, 24, 28))
        cmp.paste(ref, (8, 8)); cmp.paste(f1, (ref.width + 16, 8))
        d = ImageDraw.Draw(cmp)
        d.text((12, h + 12), "the room (reference photo)", fill=(235, 235, 235), font=font)
        d.text((ref.width + 20, h + 12), "frame 1", fill=(235, 235, 235), font=font)
        out = os.path.join(os.path.dirname(a.out), "compare.png")
        cmp.save(out)
        print("compare:", out)


if __name__ == "__main__":
    main()

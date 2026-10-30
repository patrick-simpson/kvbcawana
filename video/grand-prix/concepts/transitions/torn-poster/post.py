"""post.py RENDERDIR FINALDIR CONTACT.png
Blends the rest ends onto the exact plate (first 30 / last 30 frames ARE the plate,
eased hand-over at the edges of the motion), writes FINALDIR/f_####.png, prints the
first/last-frame differences, and builds the labelled contact sheet."""
import sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

src, dst, contact = sys.argv[1:4]
os.makedirs(dst, exist_ok=True)
N = 315
plate_img = Image.open(r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\lobby-plate-sky.png").convert("RGB").resize((960, 540), Image.BOX)
plate = np.asarray(plate_img).astype(float)


def w_render(f):
    if f < 30:
        return 0.0
    if f < 34:                 # tear start: render (AA-level identical) eases in
        return (f - 29) / 5
    if f >= 285:
        return 0.0
    if f >= 277:               # sheet is flat by 273; ease the AA residue onto the plate
        x = (285 - f) / 8
        return x * x * (3 - 2 * x)
    return 1.0


for f in range(N):
    w = w_render(f)
    if w == 0.0:
        out = plate
    else:
        r = np.asarray(Image.open(os.path.join(src, "f_%04d.png" % f)).convert("RGB")).astype(float)
        out = w * r + (1 - w) * plate
    Image.fromarray(np.clip(np.round(out), 0, 255).astype(np.uint8)).save(os.path.join(dst, "f_%04d.png" % f))

for f in (0, N - 1):
    a = np.asarray(Image.open(os.path.join(dst, "f_%04d.png" % f))).astype(int)
    print("frame", f, "vs plate: mean %.4f max %d" % (np.abs(a - plate).mean(), np.abs(a - plate).max()))
for f in (30, 277):
    a = np.asarray(Image.open(os.path.join(src, "f_%04d.png" % f))).astype(int)
    print("raw render", f, "vs plate: mean %.4f max %d" % (np.abs(a - plate).mean(), np.abs(a - plate).max()))

picks = [(0, "0.00s lobby plate"), (40, "1.33 rip runs the diagonal"), (50, "1.67 crack opens, edges curl"),
         (58, "1.93 halves peel back"), (66, "2.20 flaps swing toward camera"), (74, "2.47 leaving past camera"),
         (100, "3.33 film opening plays"), (179, "5.97 film card 1"),
         (181, "6.03 ...skipping the middle... end card"), (240, "8.00 sheet swings in"),
         (250, "8.33 rolls onto the wall"), (262, "8.73 settle"), (314, "10.47 plate (last frame)")]
cols = 4; tw, th = 480, 270
rows = (len(picks) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw, rows * (th + 28)), (20, 20, 22))
try:
    font = ImageFont.truetype("arial.ttf", 18)
except Exception:
    font = ImageFont.load_default()
for i, (f, lab) in enumerate(picks):
    im = Image.open(os.path.join(dst, "f_%04d.png" % f)).resize((tw, th), Image.LANCZOS)
    x, y = (i % cols) * tw, (i // cols) * (th + 28)
    sheet.paste(im, (x, y))
    ImageDraw.Draw(sheet).text((x + 6, y + th + 4), "f%d  %s" % (f, lab), fill=(235, 235, 235), font=font)
sheet.save(contact)
print("contact", contact)

"""peekg.py DIR OUT.png g1 g2 ... [--cols N] : labelled montage of g_#####.png frames."""
import sys, os
from PIL import Image, ImageDraw, ImageFont
d, out = sys.argv[1], sys.argv[2]
args = sys.argv[3:]
cols = 3
if "--cols" in args:
    i = args.index("--cols"); cols = int(args[i + 1]); args = args[:i] + args[i + 2:]
labels = []
for a in args:
    g, _, lab = a.partition(":")
    labels.append((int(g), lab))
tw, th = 640, 360
rows = (len(labels) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw, rows * (th + 26)), (18, 18, 20))
try:
    font = ImageFont.truetype("arial.ttf", 17)
except Exception:
    font = ImageFont.load_default()
for i, (g, lab) in enumerate(labels):
    im = Image.open(os.path.join(d, "g_%05d.png" % g)).convert("RGB").resize((tw, th), Image.LANCZOS)
    x, y = (i % cols) * tw, (i // cols) * (th + 26)
    sheet.paste(im, (x, y))
    ImageDraw.Draw(sheet).text((x + 6, y + th + 4), ("g%d  " % g) + lab, fill=(235, 235, 235), font=font)
sheet.save(out)

"""peek.py DIR f1 f2 ... -> DIR/_peek.png montage (3 per row, 640 wide each) + diff of f_0000 vs plate."""
import sys, os
import numpy as np
from PIL import Image, ImageDraw
d = sys.argv[1]; fs = [int(x) for x in sys.argv[2:]]
plate = np.asarray(Image.open(r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\lobby-plate-sky.png").convert("RGB").resize((960, 540), Image.BOX)).astype(int)
for f in fs:
    p = os.path.join(d, "f_%04d.png" % f)
    a = np.asarray(Image.open(p).convert("RGB")).astype(int)
    df = np.abs(a - plate)
    print(f, "vs plate mean %.3f max %d" % (df.mean(), df.max()))
cols = 3; tw, th = 640, 360
rows = (len(fs) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw, rows * th), "white")
for i, f in enumerate(fs):
    im = Image.open(os.path.join(d, "f_%04d.png" % f)).convert("RGB").resize((tw, th), Image.LANCZOS)
    ImageDraw.Draw(im).text((8, 6), str(f), fill=(255, 0, 255))
    sheet.paste(im, ((i % cols) * tw, (i // cols) * th))
sheet.save(os.path.join(d, "_peek.png"))

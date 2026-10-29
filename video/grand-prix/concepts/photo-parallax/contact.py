"""Contact sheet of labelled frames for a concept.
    python contact.py <concept> f1,f2,... "label1|label2|..." [suffix]
suffix: output name after "<concept>-" (default "contact"); a suffix containing
"1080" reads the 1920x1080 60 fps frames (frames1080), else the 960x540 30 fps ones.
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__))
concept, frames, labels = sys.argv[1], [int(x) for x in sys.argv[2].split(",")], sys.argv[3].split("|")
SUFFIX = sys.argv[4] if len(sys.argv) > 4 else "contact"
HD = "1080" in SUFFIX
SEQ = os.path.join("C:/Users/User/scratch-intro/gp", concept, "frames1080" if HD else "frames")
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "output", "concepts", f"{concept}-{SUFFIX}.png"))
tw, th, lab, cols = 480, 270, 30, 4 if len(frames) > 6 else 3
if len(frames) <= 6:
    tw, th = 640, 360
rows = (len(frames) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw + (cols + 1) * 8, rows * (th + lab) + (rows + 1) * 8), (24, 24, 28))
font = ImageFont.truetype(os.path.join(HERE, "..", "..", "..", "..", "shared", "brand", "fonts", "LondrinaSolid-Regular.ttf"), 22)
d = ImageDraw.Draw(sheet)
for i, f in enumerate(frames):
    x = 8 + (i % cols) * (tw + 8); y = 8 + (i // cols) * (th + lab + 8)
    sheet.paste(Image.open(os.path.join(SEQ, f"frame_{f:04d}.png")).convert("RGB").resize((tw, th), Image.LANCZOS), (x, y))
    t = f / (60 if HD else 30)
    d.text((x + 4, y + th + 4), f"{t:05.2f} s  |  {labels[i] if i < len(labels) else ''}", fill=(235, 235, 235), font=font)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
sheet.save(OUT); print("contact:", OUT)

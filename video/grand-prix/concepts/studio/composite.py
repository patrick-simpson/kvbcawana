"""Lay the flat brand cards (cards.mjs PNGs) over studio.py's 3D frames, then
write the contact sheet. Encode afterwards with encode.py (Blender VSE).

    node cards.mjs && python composite.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

GP = r"C:\Users\User\scratch-intro\gp\studio"
REPO = r"C:\Users\User\Documents\GitHub\kvbcawana"
SRC, CARDS, OUT = os.path.join(GP, "3d"), os.path.join(GP, "cards"), os.path.join(GP, "comp")
CONTACT = os.path.join(REPO, "video", "grand-prix", "output", "concepts", "studio-contact.png")
W, H = 960, 540
TOTAL = 645            # 21.5 s; end card at rest from frame 492 (5.1 s)
LAST3D = 482

def ease_io(t):
    t = max(0.0, min(1.0, t)); return 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2

def settle(t):
    t = max(0.0, min(1.0, t)); return 1 - (1 - t) ** 4

card = {n: Image.open(os.path.join(CARDS, n + ".png")).convert("RGBA").resize((W, H), Image.LANCZOS)
        for n in ("card1", "card2a", "card2b", "end_bg", "end_text")}

def plate(frame, img, f_in, f_out, dx=-40):
    """Slide in from the left with a settle, hold, leave the same way faster. Flat: no fade on the hold."""
    if frame < f_in or frame > f_out + 8:
        return
    if frame < f_in + 14:
        t = settle((frame - f_in) / 14); off = int(dx * (1 - t)); a = t
    elif frame > f_out:
        t = (frame - f_out) / 8; off = int(dx * t * t); a = 1 - t
    else:
        off, a = 0, 1.0
    layer = img if a >= 1 else Image.blend(Image.new("RGBA", img.size, (0, 0, 0, 0)), img, a)
    base = frame_img[0]
    base.alpha_composite(layer, (off, 0))

os.makedirs(OUT, exist_ok=True)
frame_img = [None]
for f in range(1, TOTAL + 1):
    src = os.path.join(SRC, f"f_{min(f, LAST3D):04d}.png")
    base = Image.open(src).convert("RGBA") if f <= LAST3D else Image.new("RGBA", (W, H))
    frame_img[0] = base
    plate(f, card["card1"], 22, 136)
    plate(f, card["card2a"], 296, 388)
    plate(f, card["card2b"], 304, 388)
    # end card: the sky field wipes across from the left, then the words settle up
    if f >= 466:
        t = ease_io((f - 466) / 14)
        x = int(W * t)
        if x > 0:
            base.alpha_composite(card["end_bg"].crop((0, 0, x, H)), (0, 0))
    if f >= 476:
        t = settle((f - 476) / 16)
        layer = card["end_text"] if t >= 1 else Image.blend(Image.new("RGBA", (W, H), (0, 0, 0, 0)), card["end_text"], t)
        base.alpha_composite(layer, (0, int(18 * (1 - t))))
    base.convert("RGB").save(os.path.join(OUT, f"frame_{f:04d}.png"), compress_level=1)

# contact sheet: 6 labelled frames
picks = [(60, "Turntable reveal + card 1"), (175, "Macro: wheel and nail axle"), (255, "Macro: pine underside"),
         (350, "Track rises, cars land + card 2"), (452, "The race"), (TOTAL, "End card (last frame)")]
tw, th, lab, pad = 480, 270, 30, 8
sheet = Image.new("RGB", (3 * tw + 4 * pad, 2 * (th + lab) + 3 * pad), (24, 24, 28))
font = ImageFont.truetype(os.path.join(REPO, "shared", "brand", "fonts", "LondrinaSolid-Regular.ttf"), 22)
d = ImageDraw.Draw(sheet)
for i, (f, name) in enumerate(picks):
    x, y = pad + (i % 3) * (tw + pad), pad + (i // 3) * (th + lab + pad)
    sheet.paste(Image.open(os.path.join(OUT, f"frame_{f:04d}.png")).resize((tw, th), Image.LANCZOS), (x, y))
    d.text((x + 4, y + th + 4), f"{(f - 1) / 30:5.1f}s  {name}", fill=(235, 235, 235), font=font)
os.makedirs(os.path.dirname(CONTACT), exist_ok=True)
sheet.save(CONTACT)
print("composited", TOTAL, "frames; contact", CONTACT)

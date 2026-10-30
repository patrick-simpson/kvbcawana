"""Assemble the 12 s preview (360 frames @30) from Blender renders + 2D film/plate frames.

python assemble.py RENDER_DIR OUT_DIR
"""
import sys, os, glob
import numpy as np
from PIL import Image

R, O = sys.argv[1], sys.argv[2]
os.makedirs(O, exist_ok=True)
PLATE = 'C:/Users/User/Documents/GitHub/kvbcawana/video/grand-prix/concepts/lobby-plate-sky.png'
FILM = 'C:/Users/User/scratch-intro/gp/gp-brand/frames1080/frame_%04d.png'
SZ = (960, 540)

def small(path):
    return Image.open(path).convert('RGB').resize(SZ, Image.BOX)

plate = small(PLATE)
end_card = small(FILM % 1500)
for f in range(360):
    T = f / 30
    p = os.path.join(R, 'f%04d.png' % f)
    subs = sorted(glob.glob(os.path.join(R, 'mb', 'f%04d_*.png' % f)))
    if subs:
        acc = sum(np.asarray(Image.open(s).convert('RGB'), dtype=np.float64) ** 2.2 for s in subs) / len(subs)
        im = Image.fromarray(np.clip(acc ** (1 / 2.2) + 0.5, 0, 255).astype(np.uint8))
    elif os.path.exists(p):
        im = Image.open(p).convert('RGB')
    elif f < 30 or f > 312:
        im = plate
    elif 108 < f < 186:          # the opening plays, film t = T - 1.6
        im = small(FILM % int(round((T - 1.6) * 60)))
    elif 186 <= f < 231:         # ...skipping the middle... end card at rest
        im = end_card
    else:
        raise SystemExit('missing frame %d' % f)
    im.save(os.path.join(O, '%04d.png' % f))
print('ok')

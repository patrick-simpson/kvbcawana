"""Pre-bake the die-cut 'sticker standee' files the Blender intro uses.

For each character PNG already in the repo it adds a rounded white cardboard
border and traces the cut outline (diecuts/<name>.png + diecuts/diecuts.json).
Blender itself can't do this tracing without extra add-ons, so it's done once
here. Re-run only if the character art changes:

    pip install opencv-python-headless pillow numpy
    python video/awana-intro/tools/make_diecuts.py      (from the repo root)
"""
import cv2, numpy as np, json, os, sys
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(HERE, '..', 'diecuts'); os.makedirs(OUT, exist_ok=True)
CAST = {  # source in the repo -> name
 'lobby/src/assets/clubs/cubbies-mascot.png': 'cubbies_bear',
 'lobby/src/assets/clubs/sparks-mascot.png': 'sparks_sparky',
 'shared/art/puggles-char-alice.png': 'puggles_alice', 'shared/art/puggles-char-duck.png': 'puggles_duck',
 'shared/art/puggles-char-maya.png': 'puggles_maya', 'shared/art/puggles-char-sydney.png': 'puggles_sydney',
 'shared/art/tnt-char-chase.png': 'tnt_chase', 'shared/art/tnt-char-marcos.png': 'tnt_marcos',
 'shared/art/tnt-char-nora.png': 'tnt_nora', 'shared/art/tnt-char-tommy.png': 'tnt_tommy',
 'shared/art/tnt-char-rabbot.png': 'tnt_rabbot'}
ONLY = set(sys.argv[1:])        # optional: just these names
meta = {}
for fn, name in CAST.items():
    if ONLY and name not in ONLY:
        continue
    im = Image.open(os.path.join(REPO, fn)).convert('RGBA')
    # work at >= 1400px tall so borders/edges are smooth
    scale = max(1.0, 1400 / im.height)
    im = im.resize((round(im.width*scale), round(im.height*scale)), Image.LANCZOS)
    a = np.array(im)[:, :, 3]
    border = int(0.045 * max(im.size))
    pad = border + 20
    A = np.pad(a, pad)
    m = (A > 40).astype(np.uint8) * 255
    # close small gaps, then grow a soft, rounded die-cut
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (border, border)))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2*border+1, 2*border+1))
    d = cv2.dilate(m, k)
    d = cv2.GaussianBlur(d, (0, 0), border*0.6)
    d = ((d > 110) * 255).astype(np.uint8)
    # keep only the biggest piece, fill its holes
    cs, _ = cv2.findContours(d, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cs, key=cv2.contourArea)
    mask = np.zeros_like(d); cv2.drawContours(mask, [c], -1, 255, -1)
    poly = cv2.approxPolyDP(c, 1.2, True)[:, 0, :].astype(float)
    H, W = mask.shape
    # composite: white card + art on top, transparent outside the cut
    rgba = np.zeros((H, W, 4), np.uint8)
    rgba[mask > 0] = (255, 255, 255, 255)
    art = np.zeros((H, W, 4), np.uint8); art[pad:pad+im.height, pad:pad+im.width] = np.array(im)
    al = art[:, :, 3:4] / 255.0
    rgba[:, :, :3] = (art[:, :, :3] * al + rgba[:, :, :3] * (1 - al)).astype(np.uint8)
    out_png = f'{name}.png'
    Image.fromarray(rgba).save(os.path.join(OUT, out_png), optimize=True)
    pts = [[round(x / W, 5), round(1 - y / H, 5)] for x, y in poly]  # 0..1, y up
    meta[name] = {'image': out_png, 'aspect': round(W / H, 5), 'outline': pts}
    print(name, W, H, len(pts))
jp = os.path.join(OUT, 'diecuts.json')
old = json.load(open(jp)) if (ONLY and os.path.exists(jp)) else {}
old.update(meta)
json.dump(old, open(jp, 'w'))

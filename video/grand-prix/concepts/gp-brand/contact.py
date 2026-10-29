"""Contact sheet of the gp-brand film: python contact.py <frames-dir> <fps> <out.png>"""
import os, sys
from PIL import Image, ImageDraw, ImageFont
D, FPS, OUT = sys.argv[1], int(sys.argv[2]), sys.argv[3]
SHOTS = [(0.5, 'grainy black, bars race in'), (1.6, 'bars lock, AWANA punches'), (2.55, 'PRIX punches (kick)'), (4.6, 'the rip, card 1'),
         (6.7, 'A: close on #1'), (7.8, 'B: the pack whips past'), (8.45, 'torn-edge wipe'), (9.2, 'C: wide, Indy passes the truck'),
         (10.1, 'D: truck pulls out of the draft'), (11.4, 'E: slow-mo photo finish'), (12.4, 'snap back, they blast off'), (13.7, 'starburst stamps'),
         (16.1, 'rev on the beat'), (18.6, 'GO: the kid nips ahead'), (23.0, 'end card at rest'), (28.7, 'waves sweep to the lobby')]
tw, th, cols = 480, 270, 4
rows = (len(SHOTS) + cols - 1) // cols
S = Image.new('RGB', (cols * (tw + 8) + 8, rows * (th + 34) + 8), (20, 20, 24)); d = ImageDraw.Draw(S)
f = ImageFont.truetype(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..', 'shared', 'brand', 'fonts', 'Figtree-Variable.ttf'), 18)
for i, (t, lab) in enumerate(SHOTS):
    x = 8 + (i % cols) * (tw + 8); y = 8 + (i // cols) * (th + 34)
    S.paste(Image.open(os.path.join(D, f'frame_{round(t * FPS):04d}.png')).convert('RGB').resize((tw, th), Image.LANCZOS), (x, y))
    d.text((x + 4, y + th + 6), f'{t:05.2f} s  {lab}', fill=(232, 232, 232), font=f)
S.save(OUT); print('contact', OUT)

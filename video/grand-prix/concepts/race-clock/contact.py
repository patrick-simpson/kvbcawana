# python contact.py <seq_dir> <out.png> <frame,frame,...>  -> 3x2 sheet of labelled frames
import sys, os
from PIL import Image, ImageDraw
seq, out, fr = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(',')]
tw, th = 480, 270
sheet = Image.new('RGB', (tw * 3 + 40, (th + 30) * 2 + 20), '#231F20')
d = ImageDraw.Draw(sheet)
for i, f in enumerate(fr[:6]):
    im = Image.open(os.path.join(seq, f'f{f:04d}.png')).convert('RGB').resize((tw, th), Image.LANCZOS)
    x, y = 10 + (i % 3) * (tw + 10), 10 + (i // 3) * (th + 30)
    sheet.paste(im, (x, y))
    d.text((x + 4, y + th + 6), f'frame {f}  t={f/30:.2f}s', fill='white')
sheet.save(out)
print('saved', out)

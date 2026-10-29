"""Stage 1: pull the official Awana Grand Prix vector assets out of the catalog PDF.
Run: python extract_assets.py   (writes into ./assets)"""
import json, os, pymupdf
from pdfvec import PDF, hexc, path_d

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets')
os.makedirs(OUT, exist_ok=True)
doc = pymupdf.open(PDF)
P1 = doc[0].get_drawings()
P8 = doc[7].get_drawings()
by = lambda ds, s: [d for d in ds if d['seqno'] == s][0]

def union(ds):
    r = pymupdf.Rect(ds[0]['rect'])
    for d in ds[1:]: r |= d['rect']
    return r

def write_svg(name, layers, box, pad=0.0, extra_defs='', attrs=''):
    """layers: list of (fill, [drawings], extra_attr)"""
    x0, y0 = box.x0 - pad, box.y0 - pad
    w, h = box.width + 2 * pad, box.height + 2 * pad
    body = []
    for fill, ds, ex in layers:
        d = ''.join(path_d(q, -x0, -y0) for q in ds)
        body.append(f'<path fill="{fill}" d="{d}" {ex}/>')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.3f} {h:.3f}" '
           f'width="{w:.3f}" height="{h:.3f}" {attrs}>{extra_defs}' + ''.join(body) + '</svg>')
    open(os.path.join(OUT, name), 'w', encoding='utf-8').write(svg)
    print(name, f'{w:.1f}x{h:.1f}pt', len(svg) // 1024, 'KB')
    return (x0, y0, w, h)

# 1. Logo, white line version (catalog cover, on black): seqno 3883..3903, all white
cov = [by(P1, s) for s in range(3883, 3904)]
cbox = union(cov)
write_svg('gp-logo-white.svg', [('#FFFFFF', cov, '')], cbox, pad=0.5)

# 2. Logo, solid version (catalog back cover, on red): dark silhouette + checkers/AWANA, white letters
dark = [by(P8, s) for s in range(4600, 4614)] + [by(P8, 4621), by(P8, 4622)]
white = [by(P8, s) for s in range(4614, 4621)]
bbox = union(dark + white)
LOGO_DARK = hexc(dark[0]['fill'])
write_svg('gp-logo-on-red.svg', [(LOGO_DARK, dark, ''), ('#FFFFFF', white, '')], bbox, pad=0.5)
# 2b. same lockup, all-white checkers/AWANA + white letters on dark silhouette (for photos / mid tones)
sil = [by(P8, 4600)]
rest = [by(P8, s) for s in range(4601, 4614)] + [by(P8, 4621), by(P8, 4622)]
write_svg('gp-logo-solid-white.svg', [(LOGO_DARK, sil, ''), ('#FFFFFF', rest + white, '')], bbox, pad=0.5)

# 3. Torn brush (the black field with the rough edge), cover page seqno 7, plus its grunge specks
brush = by(P1, 7)
FIELD = hexc(brush['fill'])
bb = brush['rect']
write_svg('torn-brush.svg', [(FIELD, [brush], '')], bb)
specks = [d for d in P1 if d.get('fill') and hexc(d['fill']) == '#1E1E22']
lights = [d for d in P1 if d.get('fill') and hexc(d['fill']) == '#DEDEDF']
GRAIN = '#1E1E22'
# The grunge specks on the black (#1E1E22 over #232328) are ~9 MB of vector; they are written to
# scratch and rasterised once into assets/grain-tile.png (a mirrored, seamless alpha tile).
sb = union(specks)
x0, y0 = sb.x0, sb.y0
open(os.path.join(os.environ.get('TEMP', '.'), 'gp-grain-specks.svg'), 'w').write(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {sb.width:.3f} {sb.height:.3f}"><path fill="{GRAIN}" d="'
    + ''.join(path_d(q, -x0, -y0) for q in specks) + '"/></svg>')
RED = hexc(by(P8, 0)['fill'])

# 5. Starburst (cover, white) and back-cover black one
sw = by(P1, 1)
write_svg('starburst.svg', [('#000000', [sw], '')], sw['rect'], pad=0.5)

# 6. Checker bar (left bar of the cover logo: 6 parallelograms)
chk = [by(P1, s) for s in range(3883, 3889)]
write_svg('checker-bar.svg', [('#FFFFFF', chk, '')], union(chk))

# palette + type notes
pal = {
    'red': RED, 'field_black': FIELD, 'grain_black': GRAIN, 'logo_dark': LOGO_DARK,
    'speck_light': '#DEDEDF', 'white': '#FFFFFF',
    'awana_blue': '#75A3D6',
    'notes': {
        'source': 'Awana Grand Prix 2025-2026 catalog PDF; colours are the exact fill values in the PDF.',
        'fonts_in_catalog': 'Gibson SemiBold/Medium/Light (headings, body), MotelCalifornia (small condensed labels e.g. "Step 1:", "2025-2026 CATALOG"), JungleGiantScript (script labels), BreeSerif (minor). The logo is custom lettering, extracted as vector.',
        'substitutes': 'Figtree (repo shared/brand/fonts, OFL) at 700-800 for Gibson. No script face is used in the frames (no extra words allowed).',
    }}
json.dump(pal, open(os.path.join(OUT, 'palette.json'), 'w'), indent=2)
print(json.dumps(pal, indent=1))

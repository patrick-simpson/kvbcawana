"""Write assets/gp-assets.js: the extracted catalog vectors as JS strings for the HTML frames."""
import json, os, pymupdf
from pdfvec import PDF, hexc, path_d
HERE = os.path.dirname(os.path.abspath(__file__))
doc = pymupdf.open(PDF)
P1, P8 = doc[0].get_drawings(), doc[7].get_drawings()
by = lambda ds, s: [d for d in ds if d['seqno'] == s][0]
def union(ds):
    r = pymupdf.Rect(ds[0]['rect'])
    for d in ds[1:]: r |= d['rect']
    return r
J = {}
# white line logo (cover). Groups: checkL, awana, checkR, word (GRAND PRIX outline + counters), tm
cov = {s: by(P1, s) for s in range(3883, 3904)}
box = union(list(cov.values()))
ox, oy = box.x0, box.y0
g = lambda ss: ''.join(path_d(cov[s], -ox, -oy) for s in ss)
J['logoWhite'] = dict(w=box.width, h=box.height,
    checkL=g(range(3883, 3889)), awana=g([3889]), checkR=g(range(3890, 3896)),
    word=g([3896, 3897, 3898, 3899, 3900, 3901]), tm=g([3902, 3903]),
    checkPeriod=60.4476 - 48.2397 + 0)   # spacing of squares in a row
L = union([cov[s] for s in range(3883, 3889)]); R = union([cov[s] for s in range(3890, 3896)])
J['logoWhite'].update(checkLbox=[L.x0-ox, L.y0-oy, L.width, L.height], checkRbox=[R.x0-ox, R.y0-oy, R.width, R.height])
# solid logo (back cover)
bk = {s: by(P8, s) for s in list(range(4600, 4623))}
box = union(list(bk.values())); ox, oy = box.x0, box.y0
g = lambda ss: ''.join(path_d(bk[s], -ox, -oy) for s in ss)
J['logoSolid'] = dict(w=box.width, h=box.height, dark=hexc(bk[4600]['fill']),
    sil=g([4600]), checkL=g(range(4601, 4607)), awana=g([4607]), checkR=g(range(4608, 4614)),
    letters=g(range(4614, 4621)), tm=g([4621, 4622]))
# torn brush
b = by(P1, 7); r = b['rect']
J['brush'] = dict(w=r.width, h=r.height, d=path_d(b, -r.x0, -r.y0))
# starburst
s = by(P1, 1); r = s['rect']
J['star'] = dict(w=r.width, h=r.height, d=path_d(s, -r.x0, -r.y0))
J['colors'] = json.load(open(os.path.join(HERE, 'assets', 'palette.json')))
open(os.path.join(HERE, 'assets', 'gp-assets.js'), 'w').write('window.GP=' + json.dumps(J) + ';')
print({k: (len(json.dumps(v)) // 1024) for k, v in J.items()})

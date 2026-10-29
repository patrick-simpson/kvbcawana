"""Helpers: convert PyMuPDF page.get_drawings() paths to SVG path data."""
import pymupdf
PDF = r"C:\Users\User\.claude\uploads\55a49d87-dfcf-59c2-9a77-59c621f611d9\4598636e-Awana_Grand_Prix_Catalog.pdf"

def hexc(c):
    return '#%02X%02X%02X' % tuple(round(v * 255) for v in c)

def path_d(d, dx=0, dy=0, s=1.0):
    out = []; cur = None
    f = lambda p: f"{(p.x+dx)*s:.3f} {(p.y+dy)*s:.3f}"
    for it in d['items']:
        k = it[0]
        if k == 're':
            r = it[1]
            out.append(f"M{f(r.tl)}L{f(r.tr)}L{f(r.br)}L{f(r.bl)}Z"); cur = None; continue
        if k == 'qu':
            q = it[1]
            out.append(f"M{f(q.ul)}L{f(q.ur)}L{f(q.lr)}L{f(q.ll)}Z"); cur = None; continue
        p0 = it[1]
        if cur is None or abs(cur.x - p0.x) > 1e-3 or abs(cur.y - p0.y) > 1e-3:
            out.append(f"M{f(p0)}")
        if k == 'l':
            out.append(f"L{f(it[2])}"); cur = it[2]
        elif k == 'c':
            out.append(f"C{f(it[2])} {f(it[3])} {f(it[4])}"); cur = it[4]
    if d.get('closePath'):
        out.append('Z')
    return ''.join(out)

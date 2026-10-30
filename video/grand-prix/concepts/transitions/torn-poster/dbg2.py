import sys, os
ns = {"__name__": "x", "__file__": r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\transitions\torn-poster\final_render.py"}
exec(open(ns["__file__"], encoding="utf-8").read(), ns)
np = ns["np"]
line = []
for g in range(134, 152, 1):
    tau = (g - 60) / 60
    cov = np.zeros((54, 96), bool)
    for h, rest, N, z0 in (("A", ns["restA"], ns["NA"], 0.0), ("B", ns["restB"], -ns["NA"], ns["Z_B"])):
        co = ns["deform_half"](rest, N, ns["tear_state"](tau, h), z0, h)
        z = co[:, 2]; ok = z < 24.6
        s = 25 / (25 - z[ok]); px = co[ok, 0] * s; py = co[ok, 1] * s
        ix = ((px / 19.2 + 0.5) * 96).astype(int); iy = ((py / 10.8 + 0.5) * 54).astype(int)
        m = (ix >= 0) & (ix < 96) & (iy >= 0) & (iy < 54)
        cov[iy[m], ix[m]] = True
    line.append("%d:%.2f" % (g, cov.mean()))
print("COV", os.environ.get("TP_OK"), os.environ.get("TP_LK"), " ".join(line))

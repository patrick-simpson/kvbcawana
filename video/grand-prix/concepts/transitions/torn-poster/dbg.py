import sys
ns = {"__name__": "x", "__file__": r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\transitions\torn-poster\final_render.py"}
exec(open(ns["__file__"], encoding="utf-8").read(), ns)
np = ns["np"]
for rho in (0.0, 0.1, 0.15, 0.25, 0.4, 0.7):
    for h, rest, N, z0 in (("A", ns["restA"], ns["NA"], 0.0), ("B", ns["restB"], -ns["NA"], ns["Z_B"])):
        co = ns["deform_half"](rest, N, ns["return_state"](rho, h), z0, h)
        z = co[:, 2]; s = 25 / np.maximum(25 - z, 0.01)
        px = co[:, 0] * s; py = co[:, 1] * s
        vis = (np.abs(px) < 9.6) & (np.abs(py) < 5.4) & (z < 24.7)
        print(rho, h, "zmax %.1f vis %.2f" % (z.max(), vis.mean()))

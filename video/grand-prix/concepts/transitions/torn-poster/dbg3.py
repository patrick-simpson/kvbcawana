import sys, bpy
ns = {"__name__": "x", "__file__": r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\transitions\torn-poster\final_render.py"}
exec(open(ns["__file__"], encoding="utf-8").read(), ns)
sc = bpy.context.scene
for mode in ("nowall", "nomb"):
    if mode == "nowall":
        ns["obW"].hide_render = True
    sc.frame_set(1922)
    sc.render.filepath = r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\transitions\torn-poster\pv3\%s.png" % mode
    bpy.ops.render.render(write_still=True)
    ns["obW"].hide_render = False
    # second: check B/A z range at this frame
np = ns["np"]
for h, rest, N, z0 in (("A", ns["restA"], ns["NA"], 0.0), ("B", ns["restB"], -ns["NA"], ns["Z_B"])):
    co = ns["deform_half"](rest, N, ns["return_state"]((1922 - ns["G_RET0"]) / 60, h), z0, h)
    print("ZR", h, co[:, 2].min(), co[:, 2].max())

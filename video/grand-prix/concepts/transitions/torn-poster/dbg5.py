import sys, bpy
ns = {"__name__": "x", "__file__": r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\transitions\torn-poster\final_render.py"}
exec(open(ns["__file__"], encoding="utf-8").read(), ns)
sc = bpy.context.scene
for name, hideA, hideB in (("onlyA", False, True), ("onlyB", True, False)):
    ns["obA"].hide_render = hideA; ns["obB"].hide_render = hideB
    sc.frame_set(1922)
    sc.render.filepath = r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\transitions\torn-poster\pv3\%s.png" % name
    bpy.ops.render.render(write_still=True)

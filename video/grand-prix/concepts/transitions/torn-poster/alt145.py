import sys, bpy
ns = {"__name__": "x", "__file__": r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\transitions\torn-poster\final_render.py"}
exec(open(ns["__file__"], encoding="utf-8").read(), ns)
sc = bpy.context.scene
sc.render.motion_blur_shutter = 0.45
for sub in (0.6, 0.8):
    sc.frame_set(145, subframe=sub)
    sc.render.filepath = r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\transitions\torn-poster\pv3\b145_%02d.png" % int(sub * 100)
    bpy.ops.render.render(write_still=True)

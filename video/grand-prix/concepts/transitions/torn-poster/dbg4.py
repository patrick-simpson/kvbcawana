import sys, bpy
ns = {"__name__": "x", "__file__": r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\transitions\torn-poster\final_render.py"}
exec(open(ns["__file__"], encoding="utf-8").read(), ns)
sc = bpy.context.scene
sc.cycles.use_denoising = False; sc.cycles.samples = 64
ns["obW"].location.z = -0.5; ns["obW"].scale = ((25.5)/(25.016),)*2+(1,)
sc.frame_set(1922)
sc.render.filepath = r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\transitions\torn-poster\pv3\farwall.png"
bpy.ops.render.render(write_still=True)

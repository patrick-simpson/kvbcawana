import sys, bpy
ns = {"__name__": "x", "__file__": r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\transitions\torn-poster\final_render.py"}
exec(open(ns["__file__"], encoding="utf-8").read(), ns)
sc = bpy.context.scene
out = r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\transitions\torn-poster\pv3\%s.png"
sc.frame_set(1910); sc.render.filepath = out % "base"; bpy.ops.render.render(write_still=True)
# B with alpha forced to 1
for m in bpy.data.materials:
    if m.name.startswith("B_") and m.node_tree:
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                for l in list(n.inputs["Alpha"].links):
                    m.node_tree.links.remove(l)
sc.frame_set(1910); sc.render.filepath = out % "Bopaque"; bpy.ops.render.render(write_still=True)
ns["obA"].hide_render = True
sc.frame_set(1910); sc.render.filepath = out % "onlyB"; bpy.ops.render.render(write_still=True)

import sys, bpy
ns = {"__name__": "x", "__file__": r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\transitions\torn-poster\final_render.py"}
exec(open(ns["__file__"], encoding="utf-8").read(), ns)
sc = bpy.context.scene
out = r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\transitions\torn-poster\pv3\%s.png"
for m in bpy.data.materials:
    if m.node_tree:
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED" and m.name != "wall":
                n.inputs["Specular IOR Level"].default_value = 0.0
sc.frame_set(1910); sc.render.filepath = out % "nospec"; bpy.ops.render.render(write_still=True)
ns["obA"].hide_render = False
ns["obB"].modifiers["thick"].show_render = False
ns["obA"].modifiers["thick"].show_render = False
sc.frame_set(1910); sc.render.filepath = out % "nosolid"; bpy.ops.render.render(write_still=True)

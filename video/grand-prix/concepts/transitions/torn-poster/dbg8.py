import sys, bpy
ns = {"__name__": "x", "__file__": r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\transitions\torn-poster\final_render.py"}
exec(open(ns["__file__"], encoding="utf-8").read(), ns)
sc = bpy.context.scene
out = r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\transitions\torn-poster\pv3\%s.png"
cols = {"A_front": (0, 1, 0, 1), "A_back": (0, 0, 1, 1), "A_edge": (1, 1, 0, 1), "B_front": (1, 0, 1, 1), "B_back": (0, 1, 1, 1), "B_edge": (1, 0.5, 0, 1)}
for name, c in cols.items():
    m = bpy.data.materials[name]; nt = m.node_tree
    o = [n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"][0]
    e = nt.nodes.new("ShaderNodeEmission"); e.inputs[0].default_value = c
    nt.links.new(e.outputs[0], o.inputs["Surface"])
sc.frame_set(1910); sc.render.filepath = out % "ids"; bpy.ops.render.render(write_still=True)

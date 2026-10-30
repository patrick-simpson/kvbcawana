"""blender -b -P decode_check.py -- IN.mp4 OUTDIR : decode the first and last frame through the VSE to PNG."""
import bpy, sys, os
argv = sys.argv[sys.argv.index("--") + 1:]
mp4, out = argv
sc = bpy.context.scene
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 960, 540, 100
sc.render.fps = 30
sc.view_settings.view_transform = "Standard"
sc.render.dither_intensity = 0
se = sc.sequence_editor_create()
strips = se.strips if hasattr(se, "strips") else se.sequences
st = strips.new_movie("m", mp4, 1, 1)
n = st.frame_final_duration
print("DURATION", n)
sc.render.image_settings.file_format = "PNG"
for f, name in ((1, "dec_first.png"), (n, "dec_last.png")):
    sc.frame_start = sc.frame_end = f
    sc.frame_set(f)
    sc.render.filepath = os.path.join(out, name)
    bpy.ops.render.render(write_still=True)

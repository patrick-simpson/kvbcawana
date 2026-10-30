"""blender --factory-startup -b -P encode.py -- FRAMEDIR OUT.mp4 [N]: PNG sequence -> H.264 via the VSE."""
import bpy, sys, os
argv = sys.argv[sys.argv.index("--") + 1:]
d, out = argv[0], argv[1]
n = int(argv[2]) if len(argv) > 2 else 315
sc = bpy.context.scene
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 960, 540, 100
sc.render.fps = 30
sc.frame_start, sc.frame_end = 1, n
sc.view_settings.view_transform = "Standard"
sc.render.dither_intensity = 0
se = sc.sequence_editor_create()
strips = se.strips if hasattr(se, "strips") else se.sequences
files = ["f_%04d.png" % i for i in range(n)]
st = strips.new_image("seq", os.path.join(d, files[0]), 1, 1)
for f in files[1:]:
    st.elements.append(f)
st.frame_final_duration = n
st.colorspace_settings.name = "sRGB"
r = sc.render
if hasattr(r.image_settings, "media_type"):
    r.image_settings.media_type = "VIDEO"
r.image_settings.file_format = "FFMPEG"
r.ffmpeg.format = "MPEG4"
r.ffmpeg.codec = "H264"
r.ffmpeg.constant_rate_factor = "PERC_LOSSLESS"
r.ffmpeg.ffmpeg_preset = "GOOD"
r.ffmpeg.gopsize = 30
r.ffmpeg.audio_codec = "NONE"
r.filepath = out
r.use_file_extension = False
bpy.ops.render.render(animation=True)
print("WROTE", out)

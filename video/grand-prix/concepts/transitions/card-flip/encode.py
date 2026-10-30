"""blender --factory-startup -b -P encode.py -- FRAMES_DIR OUT.mp4
Glue the composed 30 fps PNG frames into an H.264 mp4 with Blender's VSE."""
import bpy, os, sys
a = sys.argv[sys.argv.index("--") + 1:]
src, out = a[0], a[1]
files = sorted(f for f in os.listdir(src) if f.endswith(".png"))
sc = bpy.context.scene
sc.render.fps = 30
sc.sequence_editor_create()
st = sc.sequence_editor.strips.new_image(name="f", filepath=os.path.join(src, files[0]), channel=1, frame_start=1)
for f in files[1:]:
    st.elements.append(f)
sc.frame_start, sc.frame_end = 1, len(files)
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 960, 540, 100
sc.view_settings.view_transform = "Standard"
sc.render.dither_intensity = 0.0
im = sc.render.image_settings
im.media_type = "VIDEO"; im.file_format = "FFMPEG"
ff = sc.render.ffmpeg
ff.format = "MPEG4"; ff.codec = "H264"; ff.audio_codec = "NONE"
ff.constant_rate_factor = "HIGH"; ff.ffmpeg_preset = "BEST"; ff.gopsize = 30
sc.render.filepath = out
sc.render.use_file_extension = False
bpy.ops.render.render(animation=True)
print("[encode] wrote", out)

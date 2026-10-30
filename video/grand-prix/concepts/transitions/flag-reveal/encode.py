"""blender --factory-startup -b -P encode.py -- SEQ_DIR OUT.mp4  (PNG sequence -> H.264, 30 fps)"""
import bpy, sys, os
seq, out = sys.argv[sys.argv.index('--') + 1:][:2]
files = sorted(f for f in os.listdir(seq) if f.endswith('.png'))
sc = bpy.context.scene
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 960, 540, 100
sc.render.fps = 30
sc.view_settings.view_transform = 'Standard'
ed = sc.sequence_editor_create()
strips = ed.strips if hasattr(ed, 'strips') else ed.sequences
st = strips.new_image('seq', os.path.join(seq, files[0]), 1, 1)
for f in files[1:]:
    st.elements.append(f)
sc.frame_start, sc.frame_end = 1, len(files)
r = sc.render
r.image_settings.media_type = 'VIDEO' if hasattr(r.image_settings, 'media_type') else None
r.image_settings.file_format = 'FFMPEG'
r.ffmpeg.format = 'MPEG4'
r.ffmpeg.codec = 'H264'
r.ffmpeg.constant_rate_factor = 'HIGH'
r.ffmpeg.ffmpeg_preset = 'GOOD'
r.ffmpeg.gopsize = 30
r.ffmpeg.audio_codec = 'NONE'
r.filepath = out
bpy.ops.render.render(animation=True)

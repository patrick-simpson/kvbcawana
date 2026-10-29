# Encode a concept's PNG frames to a silent H.264 mp4 with Blender's VSE, then faststart.
#   "<blender.exe>" --factory-startup -b -P encode.py -- <concept> <out.mp4> [hd]
# hd: frames1080 at 1920x1080, 60 fps; otherwise frames at 960x540, 30 fps
import bpy, os, sys
sys.path.insert(0, r"C:\Users\User\Documents\GitHub\kvbcawana\video\awana-intro\tools")
from faststart import faststart
args = sys.argv[sys.argv.index('--') + 1:]
HD = len(args) > 2 and args[2] == "hd"
SEQ = os.path.join(r"C:\Users\User\scratch-intro\gp", args[0], "frames1080" if HD else "frames")
OUT = args[1]
files = sorted(f for f in os.listdir(SEQ) if f.endswith('.png'))
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.data.scenes.new('Encode'); sc.render.fps = 60 if HD else 30
sc.sequence_editor_create()
st = sc.sequence_editor.strips.new_image(name='f', filepath=os.path.join(SEQ, files[0]), channel=1, frame_start=1)
for f in files[1:]: st.elements.append(f)
sc.frame_start, sc.frame_end = 1, len(files)
sc.render.resolution_x, sc.render.resolution_y = (1920, 1080) if HD else (960, 540)
sc.render.resolution_percentage = 100
sc.view_settings.view_transform = 'Standard'
r = sc.render
r.image_settings.media_type = 'VIDEO'; r.image_settings.file_format = 'FFMPEG'
ff = r.ffmpeg; ff.format = 'MPEG4'; ff.codec = 'H264'; ff.audio_codec = 'NONE'
ff.constant_rate_factor = 'PERC_LOSSLESS' if HD else 'HIGH'; ff.ffmpeg_preset = 'BEST'; ff.gopsize = 60 if HD else 30
r.filepath = OUT; r.use_overwrite = True
with bpy.context.temp_override(scene=sc):
    bpy.ops.render.render(animation=True, scene=sc.name)
faststart(OUT)
print('saved', OUT, os.path.getsize(OUT))

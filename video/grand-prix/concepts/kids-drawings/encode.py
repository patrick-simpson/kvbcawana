# blender --factory-startup -b -P encode.py -- <seq_dir> <out.mp4>
import bpy, os, sys
sys.path.insert(0, r"C:\Users\User\Documents\GitHub\kvbcawana\video\awana-intro\tools")
from faststart import faststart
args = sys.argv[sys.argv.index('--') + 1:]
SEQ, OUT = args[0], args[1]
files = sorted(f for f in os.listdir(SEQ) if f.endswith('.png'))
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.data.scenes.new('Encode'); sc.render.fps = 30
sc.sequence_editor_create()
st = sc.sequence_editor.strips.new_image(name='f', filepath=os.path.join(SEQ, files[0]), channel=1, frame_start=1)
for f in files[1:]: st.elements.append(f)
sc.frame_start, sc.frame_end = 1, len(files)
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 960, 540, 100
sc.view_settings.view_transform = 'Standard'
r = sc.render
r.image_settings.media_type = 'VIDEO'; r.image_settings.file_format = 'FFMPEG'
ff = r.ffmpeg; ff.format = 'MPEG4'; ff.codec = 'H264'; ff.audio_codec = 'NONE'
ff.constant_rate_factor = 'HIGH'; ff.ffmpeg_preset = 'BEST'; ff.gopsize = 30
r.filepath = OUT; r.use_overwrite = True
with bpy.context.temp_override(scene=sc):
    bpy.ops.render.render(animation=True, scene=sc.name)
faststart(OUT)
print('saved', OUT, os.path.getsize(OUT))

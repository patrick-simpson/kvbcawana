"""flag-reveal: Blender scene + per-frame render of the two 3D transforms.

blender --factory-startup -b -P render.py -- --out DIR --frames 30-108,231-309 [--mb 4] [--scale 50]

Timeline (30 fps, T = frame / 30):
  0.0-1.0   plate still (assembled outside Blender)
  1.0-3.6   IN : camera pulls back, the lobby turns out to be one panel of a
            checkered flag; the flag ripples, then is whipped away off the left
            toward the camera, revealing the Grand Prix opening (film t = T-1.6)
  3.6-6.2   film plays (2D)            6.2-7.7  end card still (2D)
  7.7-10.3  OUT: the flag is swung back in over the end card, settles flat, the
            camera flies into the plate panel and lands exactly full-frame
  10.3-12.0 plate still
"""
import bpy, sys, math, os
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default):
    return argv[argv.index(name) + 1] if name in argv else default

OUT = arg('--out', 'C:/tmp/flag')
FRAMES = []
for part in arg('--frames', '30').split(','):
    a, _, b = part.partition('-')
    FRAMES += list(range(int(a), int(b or a) + 1))
MB = int(arg('--mb', '1'))
SCALE = int(arg('--scale', '50'))
SAMPLES = int(arg('--samples', '24'))

PLATE = 'C:/Users/User/Documents/GitHub/kvbcawana/video/grand-prix/concepts/lobby-plate-sky.png'
FILM = 'C:/Users/User/scratch-intro/gp/gp-brand/frames1080/frame_%04d.png'
FPS = 30

# ---------------------------------------------------------------- geometry
CW, CH = 19.2, 10.8            # one cell = the 1920x1080 plate
NCX, NCY = 7, 5                # flag = 7 x 5 cells, plate is cell (3, 2)
FW, FH = CW * NCX, CH * NCY
X0 = -FW / 2                   # pole (left edge) at rest
TANH = 18.0 / 40.0             # 40 mm lens, 36 mm sensor fit horizontal
Z_REST = (CW / 2) / TANH       # 21.333: plate fills the frame
Z_BACK = 64.0                  # pulled-back camera
Z_FILM = -60.0                 # film screen behind the flag
NU, NV = 480, 80               # grid segments

def clamp01(x):
    return min(1.0, max(0.0, x))
def smooth(a, b, x):
    t = clamp01((x - a) / (b - a)) if b != a else float(x >= a)
    return t * t * (3 - 2 * t)
def smoother(t):
    t = clamp01(t)
    return t * t * t * (t * (t * 6 - 15) + 10)
def keys(t, ks):
    """Piecewise ease between (time, value) keys, zero slope at every key."""
    if t <= ks[0][0]:
        return ks[0][1]
    for (t0, v0), (t1, v1) in zip(ks, ks[1:]):
        if t <= t1:
            return v0 + (v1 - v0) * smoother((t - t0) / (t1 - t0))
    return ks[-1][1]

def np_smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)

# ---------------------------------------------------------------- scene
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.render.resolution_percentage = SCALE
sc.render.film_transparent = False
sc.render.filter_size = float(arg('--filter', '0.7'))
sc.view_settings.view_transform = 'Standard'
sc.view_settings.look = 'None'
sc.view_settings.exposure = 0
sc.view_settings.gamma = 1
sc.display_settings.display_device = 'sRGB'
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGB'
sc.eevee.taa_render_samples = SAMPLES
sc.eevee.use_shadows = True
sc.eevee.shadow_ray_count = 2
sc.eevee.shadow_step_count = 8
try:
    sc.eevee.use_raytracing = True
    sc.eevee.ray_tracing_method = 'SCREEN'
    sc.eevee.use_fast_gi = True
except Exception:
    pass

world = bpy.data.worlds.new('w'); sc.world = world
world.use_nodes = True
bg = world.node_tree.nodes['Background']
AMB = float(arg('--amb', '0.12'))
bg.inputs[0].default_value = (AMB, AMB, AMB * 1.03, 1)
bg.inputs[1].default_value = 1.0

# camera
cam_data = bpy.data.cameras.new('cam')
cam_data.lens = 40; cam_data.sensor_width = 36; cam_data.sensor_fit = 'HORIZONTAL'
cam_data.clip_start = 0.5; cam_data.clip_end = 2000
cam = bpy.data.objects.new('cam', cam_data); sc.collection.objects.link(cam)
sc.camera = cam

# key light: sun from upper right, in front
sun_data = bpy.data.lights.new('sun', 'SUN')
SUN = float(arg('--sun', '5.45'))
sun_data.energy = SUN
sun_data.angle = math.radians(3.0)
sun_data.use_shadow = True
sun = bpy.data.objects.new('sun', sun_data); sc.collection.objects.link(sun)
SUN_DIR = np.array([0.70, 0.45, 0.55]); SUN_DIR /= np.linalg.norm(SUN_DIR)  # towards the light
# orient: light shines along -Z local; point -Z along -SUN_DIR
from mathutils import Vector
sun.rotation_euler = Vector(SUN_DIR.tolist()).to_track_quat('Z', 'Y').to_euler()

# ---------------------------------------------------------------- images
plate_img = bpy.data.images.load(PLATE)
film_img = bpy.data.images.load(FILM % 0)
film_img.name = 'film'

def emission_mat(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    return m, nt

# film screen: an emissive plane, exactly full-frame from the pulled-back camera
fm, nt = emission_mat('film')
o = nt.nodes.new('ShaderNodeOutputMaterial')
em = nt.nodes.new('ShaderNodeEmission')
tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = film_img; tx.extension = 'EXTEND'
tx.interpolation = 'Linear'
uv = nt.nodes.new('ShaderNodeUVMap')
nt.links.new(uv.outputs[0], tx.inputs[0])
nt.links.new(tx.outputs[0], em.inputs[0]); nt.links.new(em.outputs[0], o.inputs[0])
d = Z_BACK - Z_FILM
fw, fh = 2 * d * TANH, 2 * d * TANH * 9 / 16
OV = 1.6  # oversize, edges clamp-extend
fmesh = bpy.data.meshes.new('film')
hw, hh = fw * OV / 2, fh * OV / 2
fmesh.from_pydata([(-hw, -hh, Z_FILM), (hw, -hh, Z_FILM), (hw, hh, Z_FILM), (-hw, hh, Z_FILM)], [], [(0, 1, 2, 3)])
fuv = fmesh.uv_layers.new()
u0, u1 = 0.5 - OV / 2, 0.5 + OV / 2
for li, (uu, vv) in enumerate([(u0, u0), (u1, u0), (u1, u1), (u0, u1)]):
    fuv.data[li].uv = (uu, vv)
filmo = bpy.data.objects.new('film', fmesh); sc.collection.objects.link(filmo)
fmesh.materials.append(fm)

# flag material
flm, nt = emission_mat('flag')
N = nt.nodes; Lk = nt.links.new
out = N.new('ShaderNodeOutputMaterial')
uvn = N.new('ShaderNodeUVMap')
sep = N.new('ShaderNodeSeparateXYZ'); Lk(uvn.outputs[0], sep.inputs[0])
def math_node(op, a, b=None, val=None):
    n = N.new('ShaderNodeMath'); n.operation = op
    if isinstance(a, (int, float)): n.inputs[0].default_value = a
    else: Lk(a, n.inputs[0])
    if b is not None:
        if isinstance(b, (int, float)): n.inputs[1].default_value = b
        else: Lk(b, n.inputs[1])
    if val is not None: n.inputs[2].default_value = val
    return n.outputs[0]
sx = math_node('MULTIPLY', sep.outputs[0], float(NCX))
sy = math_node('MULTIPLY', sep.outputs[1], float(NCY))
cx = math_node('FLOOR', sx); cy = math_node('FLOOR', sy)
fx = math_node('SUBTRACT', sx, cx); fy = math_node('SUBTRACT', sy, cy)
par = math_node('FLOORED_MODULO', math_node('ADD', cx, cy), 2.0)
mx = math_node('COMPARE', cx, 3.0, 0.5); my = math_node('COMPARE', cy, 2.0, 0.5)
pmask = math_node('MULTIPLY', mx, my)
comb = N.new('ShaderNodeCombineXYZ'); Lk(fx, comb.inputs[0]); Lk(fy, comb.inputs[1])
ptx = N.new('ShaderNodeTexImage'); ptx.image = plate_img; ptx.extension = 'EXTEND'
ptx.interpolation = 'Linear'
Lk(comb.outputs[0], ptx.inputs[0])
chk = N.new('ShaderNodeMix'); chk.data_type = 'RGBA'
Lk(par, chk.inputs['Factor'])
chk.inputs['A'].default_value = (0.010, 0.010, 0.011, 1)
chk.inputs['B'].default_value = (0.80, 0.80, 0.79, 1)
col = N.new('ShaderNodeMix'); col.data_type = 'RGBA'
Lk(pmask, col.inputs['Factor']); Lk(chk.outputs['Result'], col.inputs['A']); Lk(ptx.outputs[0], col.inputs['B'])
# unlit: the plate as it is
emis = N.new('ShaderNodeEmission'); Lk(col.outputs['Result'], emis.inputs[0])
# lit: printed polyester, a faint weave, sheen
texc = N.new('ShaderNodeTexCoord')
weave = N.new('ShaderNodeTexWave'); weave.wave_type = 'BANDS'
weave.inputs['Scale'].default_value = 900; weave.inputs['Distortion'].default_value = 0
Lk(texc.outputs['UV'], weave.inputs['Vector'])
weave2 = N.new('ShaderNodeTexWave'); weave2.wave_type = 'BANDS'; weave2.bands_direction = 'Y'
weave2.inputs['Scale'].default_value = 900
Lk(texc.outputs['UV'], weave2.inputs['Vector'])
wsum = math_node('ADD', weave.outputs['Fac'], weave2.outputs['Fac'])
bump = N.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.04
bump.inputs['Distance'].default_value = 0.02
Lk(wsum, bump.inputs['Height'])
noise = N.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 6
Lk(texc.outputs['UV'], noise.inputs['Vector'])
mott = N.new('ShaderNodeMapRange'); Lk(noise.outputs['Fac'], mott.inputs[0])
mott.inputs[3].default_value = 0.965; mott.inputs[4].default_value = 1.03
tint = N.new('ShaderNodeMix'); tint.data_type = 'RGBA'; tint.blend_type = 'MULTIPLY'
tint.inputs['Factor'].default_value = 1.0
Lk(col.outputs['Result'], tint.inputs['A'])
cmb = N.new('ShaderNodeCombineColor')
for i in range(3): Lk(mott.outputs[0], cmb.inputs[i])
Lk(cmb.outputs[0], tint.inputs['B'])
LIT_GAIN = float(arg('--gain', '1.0'))
gain = N.new('ShaderNodeMix'); gain.data_type = 'RGBA'; gain.blend_type = 'MULTIPLY'
gain.inputs['Factor'].default_value = 1.0
Lk(tint.outputs['Result'], gain.inputs['A']); gain.inputs['B'].default_value = (LIT_GAIN,) * 3 + (1,)
bsdf = N.new('ShaderNodeBsdfPrincipled')
Lk(gain.outputs['Result'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.62
bsdf.inputs['Specular IOR Level'].default_value = 0.25
bsdf.inputs['Sheen Weight'].default_value = 0.35
bsdf.inputs['Sheen Roughness'].default_value = 0.4
Lk(bump.outputs['Normal'], bsdf.inputs['Normal'])
mix = N.new('ShaderNodeMixShader'); mix.name = 'litmix'
mix.inputs[0].default_value = 0.0
Lk(emis.outputs[0], mix.inputs[1]); Lk(bsdf.outputs[0], mix.inputs[2])
Lk(mix.outputs[0], out.inputs[0])

# flag mesh
us = np.linspace(0, FW, NU + 1)
vs = np.linspace(-FH / 2, FH / 2, NV + 1)
UU, VV = np.meshgrid(us, vs)          # shape (NV+1, NU+1)
verts = [(0.0, 0.0, 0.0)] * UU.size
faces = []
W = NU + 1
for j in range(NV):
    for i in range(NU):
        a = j * W + i
        faces.append((a, a + 1, a + W + 1, a + W))
fl = bpy.data.meshes.new('flag')
fl.from_pydata(verts, [], faces)
fl.shade_smooth() if hasattr(fl, 'shade_smooth') else None
for p in fl.polygons: p.use_smooth = True
fuvl = fl.uv_layers.new()
uvv = np.stack([UU.ravel() / FW, (VV.ravel() + FH / 2) / FH], 1)
loop_v = np.empty(len(fl.loops), dtype=np.int32); fl.loops.foreach_get('vertex_index', loop_v)
fuvl.data.foreach_set('uv', uvv[loop_v].ravel())
fl.materials.append(flm)
flag = bpy.data.objects.new('flag', fl); sc.collection.objects.link(flag)

# ---------------------------------------------------------------- motion
D2R = math.pi / 180

def flag_shape(phi, xpole, ypole, zpole):
    """phi: heading angle (NV+1, NU+1); cross-section integrated along u (no stretch)."""
    du = FW / NU
    phi = np.broadcast_to(np.asarray(phi, dtype=float), UU.shape)
    c, s = np.cos(phi), np.sin(phi)
    cx = np.concatenate([np.zeros((phi.shape[0], 1)), np.cumsum((c[:, 1:] + c[:, :-1]) * 0.5 * du, 1)], 1)
    cz = np.concatenate([np.zeros((phi.shape[0], 1)), np.cumsum((s[:, 1:] + s[:, :-1]) * 0.5 * du, 1)], 1)
    return np.stack([xpole + cx, VV + ypole, zpole + cz], -1)

def ripple(t, amp_deg, phase0=0.0):
    if amp_deg <= 0:
        return 0.0
    k = 2 * math.pi / 44.0
    w = 2 * math.pi * 1.25
    g = np_smooth(0, 22, UU) * (0.5 + 0.5 * UU / FW)
    # two wave trains + a slow diagonal: real flags never wave in one sine
    p = k * UU - w * t + 2 * math.pi * VV / 170.0 + phase0
    r = np.sin(p) + 0.35 * np.sin(1.9 * k * UU - 1.7 * w * t - 2 * math.pi * VV / 95.0 + 1.3)
    return amp_deg * D2R * g * r / 1.35

SW_PHI = float(arg('--swphi', '-10'))
SW_X = float(arg('--swx', '150'))
RIP = float(arg('--rip', '17'))

def flap(t, strength):
    """Fast flapping of the free end while the flag is dragged through the air."""
    if strength <= 0:
        return 0.0
    w = (UU / FW) ** 1.6
    p = 2 * math.pi * (UU / 30.0 - 2.4 * t) + 2 * math.pi * VV / 60.0
    p2 = 2 * math.pi * (UU / 17.0 - 3.6 * t) - 2 * math.pi * VV / 40.0 + 0.7
    return strength * D2R * w * (np.sin(p) + 0.45 * np.sin(p2))

def swing_out(t):
    """IN transform: the flag is whipped away (t = seconds since swing start)."""
    c = 160.0
    s = t - UU / c + VV * 0.011
    ph = np.clip(s / 0.9, 0, 1)
    Phi = SW_PHI * D2R * ph ** 2
    # whip crack: an S-pulse running out to the free edge
    q = t - 0.12 - UU / 210.0 + VV * 0.003
    pulse = 24 * D2R * np.exp(-(q / 0.17) ** 2) * np.sin(2 * math.pi * q / 0.45) * np_smooth(0, 30, UU)
    return Phi + pulse + flap(t, 34 * smooth(0.0, 0.45, t))

def phi_in_settle(s):
    """OUT heading factor: 1 (swung away) -> small overshoot past flat -> exactly 0."""
    x = np.clip(s / 1.0, 0, 1)
    base = 1 - (x * x * (3 - 2 * x))
    over = -0.16 * np.sin(np.pi * np.clip((s - 0.7) / 0.7, 0, 1))
    return base + over

def pose(T):
    """Return (camera loc, camera rot (x,y,z) rad, flag verts, lit factor, film frame)."""
    film_frame = None
    if T < 5.0:  # ---------------- IN
        t = T - 1.0
        z = keys(t, [(0, Z_REST), (0.14, Z_REST - 0.35), (1.05, Z_BACK + 2.6), (1.5, Z_BACK - 0.35), (1.85, Z_BACK)])
        cxo = keys(t, [(0, 0), (0.75, -2.2), (1.85, 0)])
        cyo = keys(t, [(0, 0), (0.8, -1.0), (1.85, 0)])
        roll = keys(t, [(0, 0), (0.55, 1.6), (1.25, -0.35), (1.85, 0)]) * D2R
        lit = smooth(0.06, 0.45, t)
        amp = RIP * smooth(0.18, 0.95, t)
        ts = t - 0.9
        phi = ripple(t, amp)
        xpole, ypole, zpole = X0, 0.0, 0.0
        if ts > 0:
            phi = phi + swing_out(ts)
            e = clamp01(ts / 1.25)
            xpole = X0 - SW_X * e ** 2.3
            ypole = 11 * e ** 2.0
        film_frame = int(round(max(0.0, T - 1.6) * 60))
    else:  # ---------------- OUT
        t = T - 7.7
        c = 170.0
        s = t - 0.1 - UU / c - VV * 0.011
        phi = SW_PHI * D2R * phi_in_settle(s) + flap(t, 34 * (1 - smooth(0.45, 1.5, t)))
        amp = (RIP + 3) * (1 - smooth(0.8, 2.05, t))
        phi = phi + ripple(t, amp, 0.8)
        e = 1 - smooth(0.0, 1.15, t)
        xpole = X0 - SW_X * e ** 1.5 + 2.2 * math.sin(math.pi * clamp01((t - 0.95) / 0.6))
        ypole = 11 * e ** 1.5
        zpole = 0.0
        z = keys(t, [(0, Z_BACK), (1.2, Z_BACK), (2.3, Z_REST - 0.28), (2.6, Z_REST)])
        cxo = keys(t, [(1.2, 0), (1.75, 1.6), (2.5, 0)])
        cyo = keys(t, [(1.2, 0), (1.85, 0.6), (2.5, 0)])
        roll = keys(t, [(1.2, 0), (1.75, -1.4), (2.3, 0.25), (2.58, 0)]) * D2R
        lit = 1 - smooth(2.05, 2.55, t)
        film_frame = 1500
    V = flag_shape(phi, xpole, ypole, zpole)
    # aim the camera at the plate's centre with the offset -> small orbit/parallax
    cam_loc = (cxo, cyo, z)
    yaw = math.atan2(cxo, z)       # rotate about Y to look back at x=0
    pitch = -math.atan2(cyo, z)
    return cam_loc, (pitch, yaw, roll), V, lit, film_frame

def apply(T):
    cam_loc, (rx, ry, rz), V, lit, ff = pose(T)
    cam.location = cam_loc
    cam.rotation_euler = (rx, ry, rz)
    fl.vertices.foreach_set('co', V.reshape(-1).astype(np.float32))
    fl.update()
    mix.inputs[0].default_value = lit
    if ff is not None:
        path = FILM % min(1799, ff)
        if film_img.filepath != path:
            film_img.filepath = path
            film_img.reload()
    return V

def frame_overlap(V, T):
    """Fraction of a coarse screen grid still covered by the flag (diagnostic)."""
    cam_loc, (rx, ry, rz), _, _, _ = pose(T)
    return None

FORCE_LIT = arg('--lit', None)
os.makedirs(OUT, exist_ok=True)
for f in FRAMES:
    for k in range(MB):
        T = f / FPS if MB <= 1 else (f + (k + 0.5) / MB * 0.5 - 0.25) / FPS
        apply(T)
        if FORCE_LIT is not None:
            mix.inputs[0].default_value = float(FORCE_LIT)
        sc.render.filepath = os.path.join(OUT, 'f%04d.png' % f if MB <= 1 else 'f%04d_%d.png' % (f, k))
        bpy.ops.render.render(write_still=True)
    print('FRAME', f, flush=True)

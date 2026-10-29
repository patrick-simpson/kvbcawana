"""Grand Prix concept 'studio': a product-commercial look in Blender (EEVEE preview).

A seamless sky-blue cyclorama, one hero homemade pinewood car on a turntable,
three calm macros (wheel, paint edge, underside/axle), then a pull-back as a
silver 4-lane aluminium track rises out of the floor, three more cars land at
the gate, and all four race past the camera. Renders the raw 3D frames only;
composite.py lays the flat brand cards over them and encodes the mp4.

    blender --factory-startup -b -P studio.py                  # all 3D frames
    blender --factory-startup -b -P studio.py -- --stills 60,200,300
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix, Quaternion

REPO = r"C:\Users\User\Documents\GitHub\kvbcawana"
FONTS = os.path.join(REPO, "shared", "brand", "fonts")
OUT = r"C:\Users\User\scratch-intro\gp\studio"
FPS = 30
F_END3D = 490          # last 3D frame (the end card covers everything after)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default

# ---------------------------------------------------------------- helpers ---
def lin(hexs):
    h = hexs.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c) + (1.0,)

def smooth(t):
    t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)

def ease_out(t):
    t = max(0.0, min(1.0, t)); return 1 - (1 - t) ** 3

def ease_io(t):
    t = max(0.0, min(1.0, t)); return 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2

def lerp(a, b, t):
    return a + (b - a) * t

def vlerp(a, b, t):
    return Vector(a).lerp(Vector(b), t)

def look_quat(loc, target):
    return (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y")

def principled(name, color, rough=0.5, metal=0.0, spec=0.5, coat=0.0):
    m = bpy.data.materials.new(name)
    try: m.use_nodes = True
    except Exception: pass
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = color
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    for k in ("Specular IOR Level", "Specular"):
        if k in b.inputs: b.inputs[k].default_value = spec; break
    if coat and "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = 0.08
    return m

def paint_mat(name, color, stripe=lin("#FFFFFF")):
    """Glossy club-colour paint with a white centre stripe along the car (object Y)."""
    m = principled(name, color, rough=0.28, coat=0.6)
    N, L = m.node_tree.nodes, m.node_tree.links
    b = N.get("Principled BSDF")
    tc = N.new("ShaderNodeTexCoord")
    sep = N.new("ShaderNodeSeparateXYZ"); L.new(tc.outputs["Object"], sep.inputs[0])
    ab = N.new("ShaderNodeMath"); ab.operation = "ABSOLUTE"; L.new(sep.outputs["Y"], ab.inputs[0])
    lt = N.new("ShaderNodeMath"); lt.operation = "LESS_THAN"; lt.inputs[1].default_value = 0.06
    L.new(ab.outputs[0], lt.inputs[0])
    top = N.new("ShaderNodeMath"); top.operation = "GREATER_THAN"; top.inputs[1].default_value = 0.165
    L.new(sep.outputs["Z"], top.inputs[0])
    both = N.new("ShaderNodeMath"); both.operation = "MULTIPLY"
    L.new(lt.outputs[0], both.inputs[0]); L.new(top.outputs[0], both.inputs[1])
    mx = N.new("ShaderNodeMix"); mx.data_type = "RGBA"
    mx.inputs[6].default_value = color; mx.inputs[7].default_value = stripe
    L.new(both.outputs[0], mx.inputs[0]); L.new(mx.outputs[2], b.inputs["Base Color"])
    return m

def wood_mat():
    m = principled("pine", lin("#D9B07A"), rough=0.7, spec=0.3)
    N, L = m.node_tree.nodes, m.node_tree.links
    b = N.get("Principled BSDF")
    tc = N.new("ShaderNodeTexCoord")
    mp = N.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (1.0, 7.0, 7.0)
    L.new(tc.outputs["Object"], mp.inputs[0])
    wv = N.new("ShaderNodeTexWave"); wv.wave_type = "BANDS"; wv.bands_direction = "Y"
    wv.inputs["Scale"].default_value = 2.2; wv.inputs["Distortion"].default_value = 5.0
    wv.inputs["Detail"].default_value = 2.0; wv.inputs["Detail Scale"].default_value = 1.5
    L.new(mp.outputs[0], wv.inputs["Vector"])
    cr = N.new("ShaderNodeValToRGB")
    cr.color_ramp.elements[0].position = 0.25; cr.color_ramp.elements[0].color = lin("#E6C495")
    cr.color_ramp.elements[1].position = 0.95; cr.color_ramp.elements[1].color = lin("#B07F4A")
    L.new(wv.outputs["Fac"], cr.inputs[0]); L.new(cr.outputs[0], b.inputs["Base Color"])
    return m

def new_obj(name, mesh):
    o = bpy.data.objects.new(name, mesh); bpy.context.scene.collection.objects.link(o); return o

def mesh_from(name, verts, faces):
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update(); return me

# ---------------------------------------------------------------- scene ---
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = FPS
sc.frame_start, sc.frame_end = 1, F_END3D

SKY, CLOUD, INK = lin("#B3D0E7"), lin("#D6EFF8"), lin("#231F20")
CLUB = {"sparks": lin("#F04A4B"), "tnt": lin("#58BD79"), "cubbies": lin("#4C72B8"), "journey": lin("#8A649D")}

# cyclorama: floor sweeping up into a wall, no seams
prof = [(-80.0, 0.0), (40.0, 0.0)]
R = 14.0
for i in range(1, 17):
    a = i / 16 * math.pi / 2
    prof.append((40.0 + R * math.sin(a), R - R * math.cos(a)))
prof.append((40.0 + R, 90.0))
xs = [-90.0, 90.0]
verts, faces = [], []
for x in xs:
    for (y, z) in prof: verts.append((x, y, z))
n = len(prof)
for i in range(n - 1): faces.append((i, i + 1, n + i + 1, n + i))
cyc = new_obj("cyc", mesh_from("cyc", verts, faces))
for p in cyc.data.polygons: p.use_smooth = True
cyc.data.materials.append(principled("cyc", SKY, rough=0.34, spec=0.3))

world = bpy.data.worlds.new("w"); sc.world = world
try: world.use_nodes = True
except Exception: pass
world.node_tree.nodes["Background"].inputs[0].default_value = SKY
world.node_tree.nodes["Background"].inputs[1].default_value = 0.55

def area(name, loc, target, size, power, color=(1, 1, 1)):
    d = bpy.data.lights.new(name, "AREA"); d.size = size; d.energy = power; d.color = color
    o = new_obj(name, d); o.location = loc
    o.rotation_mode = "QUATERNION"; o.rotation_quaternion = look_quat(loc, target)
    return o

L_KEY = area("key", (-4.5, -5.0, 6.5), (0, 0, 0.2), 7.0, 2600)
L_RIM = area("rim", (2.5, 7.0, 3.0), (0, 0, 0.3), 4.0, 1600)
L_FILL = area("fill", (6.0, -3.0, 1.5), (0, 0, 0.3), 5.0, 350)
# the product lights step down once the track takes over (they glare on the wide floor)
for lo, wide in ((L_KEY, 700), (L_RIM, 400), (L_FILL, 0)):
    full = lo.data.energy
    lo.data.keyframe_insert("energy", frame=1)
    lo.data.energy = wide; lo.data.keyframe_insert("energy", frame=393)
    lo.data.energy = full
sun = new_obj("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 2.2; sun.data.angle = math.radians(18)
sun.rotation_euler = (math.radians(42), 0, math.radians(-35))
area("trackkey", (-8.0, -12.0, 15.0), (4.5, 10.0, 1.0), 14.0, 9000)

# turntable disc
bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=1.45, depth=0.06, location=(0, 0, 0.03))
disc = bpy.context.active_object; disc.name = "disc"
disc.data.materials.append(principled("disc", CLOUD, rough=0.3))
for p in disc.data.polygons: p.use_smooth = abs(p.normal.z) < 0.5
DISC_TOP = 0.06

# ---------------------------------------------------------------- the car ---
paint_font = bpy.data.fonts.load(os.path.join(FONTS, "PaytoneOne-Regular.ttf"), check_existing=True)
M_WOOD = wood_mat()
M_TIRE = principled("tire", lin("#141414"), rough=0.38, spec=0.4)
M_NAIL = principled("nail", lin("#D8D8D8"), rough=0.18, metal=1.0)
M_WHITE = principled("decal", lin("#FFFFFF"), rough=0.3)
PROFILE = [(-0.9, 0.08), (0.9, 0.08), (0.9, 0.145), (0.84, 0.175), (0.25, 0.215),
           (-0.25, 0.30), (-0.62, 0.345), (-0.86, 0.35), (-0.9, 0.33)]
AXLES = (0.6, -0.62)
WR, WW, WY = 0.15, 0.07, 0.27

def make_car(name, color, number):
    bm = bmesh.new()
    vs0 = [bm.verts.new((x, -0.22, z)) for x, z in PROFILE]
    vs1 = [bm.verts.new((x, 0.22, z)) for x, z in PROFILE]
    n = len(PROFILE)
    bm.faces.new(vs0[::-1]); bm.faces.new(vs1)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((vs0[i], vs0[j], vs1[j], vs1[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    body = new_obj(name, me)
    body.data.materials.append(paint_mat(name + "_paint", color))
    body.data.materials.append(M_WOOD)
    for p in me.polygons:
        p.material_index = 1 if p.normal.z < -0.9 else 0
        p.use_smooth = True
    bv = body.modifiers.new("bevel", "BEVEL"); bv.width = 0.025; bv.segments = 4
    bv.harden_normals = True; bv.limit_method = "ANGLE"
    body.rotation_mode = "QUATERNION"
    wheels = []
    for ax in AXLES:
        for side in (-1, 1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=WR, depth=WW)
            w = bpy.context.active_object; w.name = f"{name}_w"
            # axis along Y, hubcap recess as a slightly smaller dark disc
            w.data.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
            w.data.materials.append(M_TIRE)
            for p in w.data.polygons: p.use_smooth = abs(p.normal.y) < 0.5
            bvw = w.modifiers.new("bevel", "BEVEL"); bvw.width = 0.012; bvw.segments = 2
            w.parent = body; w.location = (ax, side * WY, WR)
            w.rotation_mode = "XYZ"
            # tread ribs so the spin reads
            bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.035, depth=0.02)
            hub = bpy.context.active_object; hub.name = f"{name}_hub"
            hub.data.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
            hub.data.materials.append(M_NAIL)
            hub.parent = w; hub.location = (0, side * (WW / 2 + 0.006), 0)
            bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.011, depth=0.16)
            shaft = bpy.context.active_object; shaft.name = f"{name}_nail"
            shaft.data.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
            shaft.data.materials.append(M_NAIL)
            shaft.parent = body; shaft.location = (ax, side * 0.25, WR)
            wheels.append(w)
    for side in (-1, 1):
        cu = bpy.data.curves.new(f"{name}_num", "FONT"); cu.body = str(number); cu.font = paint_font
        cu.size = 0.17; cu.align_x = "CENTER"; cu.align_y = "CENTER"; cu.extrude = 0.002
        t = new_obj(f"{name}_num", cu); t.data.materials.append(M_WHITE)
        t.parent = body
        t.location = (-0.38, side * 0.2235, 0.205)
        t.rotation_euler = (math.pi / 2, 0, 0) if side < 0 else (math.pi / 2, 0, math.pi)
    return body, wheels

cars = [
    make_car("hero", CLUB["sparks"], 7),
    make_car("tnt", CLUB["tnt"], 12),
    make_car("cubbies", CLUB["cubbies"], 3),
    make_car("journey", CLUB["journey"], 21),
]

# ---------------------------------------------------------------- the track ---
TX = 4.6
LANES = [TX - 1.2, TX - 0.4, TX + 0.4, TX + 1.2]
SLOPE, SOFT_R, Y_BEND = 0.24, 7.0, 13.0
Y_NEAR, Y_FAR, Y_GATE = -30.0, 31.5, 28.0

def soft(x):
    return (x + math.sqrt(x * x + SOFT_R * SOFT_R)) / 2

def h(y):
    return 0.30 + SLOPE * soft(y - Y_BEND)

def dh(y, e=1e-3):
    return (h(y + e) - h(y - e)) / (2 * e)

ys = [Y_NEAR + i * 0.35 for i in range(int((Y_FAR - Y_NEAR) / 0.35) + 1)]
tverts, tfaces = [], []
def sweep_box(x0, x1, z0, z1):
    base = len(tverts)
    for y in ys:
        hy = h(y)
        for (x, z) in ((x0, z0), (x1, z0), (x1, z1), (x0, z1)):
            tverts.append((x, y, hy + z))
    for i in range(len(ys) - 1):
        a, b = base + 4 * i, base + 4 * (i + 1)
        for k in range(4):
            k2 = (k + 1) % 4
            tfaces.append((a + k, a + k2, b + k2, b + k))
    e = base + 4 * (len(ys) - 1)
    tfaces.append((base + 3, base + 2, base + 1, base)); tfaces.append((e, e + 1, e + 2, e + 3))
sweep_box(TX - 1.7, TX + 1.7, -0.05, 0.0)                  # the plate
for s in (-1, 1):
    sweep_box(TX + s * 1.7 - 0.04, TX + s * 1.7 + 0.04, -0.05, 0.13)   # side rails
for lx in LANES:
    sweep_box(lx - 0.025, lx + 0.025, 0.0, 0.055)          # centre guide strips
for k in range(3):
    dx = TX - 0.8 + 0.8 * k
    sweep_box(dx - 0.012, dx + 0.012, 0.0, 0.02)           # lane seams
track = new_obj("track", mesh_from("track", tverts, tfaces))
track.data.materials.append(principled("alu", lin("#F2F4F6"), rough=0.32, metal=0.75))
for p in track.data.polygons: p.use_smooth = False
# legs under the slope, plus the start gate
def box(name, loc, size, mat, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object; o.name = name; o.scale = size
    o.data.materials.append(mat)
    if parent: o.parent = parent
    return o
M_LEG = principled("leg", lin("#B9BEC4"), rough=0.3, metal=1.0)
for y in (16.0, 20.0, 24.0, 28.5):
    for s in (-1, 1):
        hh = h(y) - 0.05
        box("leg", (TX + s * 1.5, y, hh / 2), (0.08, 0.08, hh), M_LEG, track)
hg = h(Y_GATE)
for s in (-1, 1):
    box("post", (TX + s * 1.82, Y_GATE, hg + 0.45), (0.1, 0.1, 1.0), M_LEG, track)
box("gatebar", (TX, Y_GATE, hg + 0.9), (3.74, 0.1, 0.1), M_LEG, track)
pins = box("pins", (TX, Y_GATE, hg + 0.12), (3.3, 0.05, 0.22), principled("pin", INK, rough=0.4), track)
# finish line: a flat ink band across the lanes
box("finish", (TX, 1.5, h(1.5) + 0.002), (3.38, 0.25, 0.004), principled("fin", INK, rough=0.5), track)

# ---------------------------------------------------------------- camera ---
cam_d = bpy.data.cameras.new("cam"); cam = new_obj("cam", cam_d); sc.camera = cam
cam.rotation_mode = "QUATERNION"; cam_d.sensor_width = 36; cam_d.clip_start = 0.02; cam_d.clip_end = 400

# ---------------------------------------------------------------- timeline ---
# shots (frames, 1-based)
S_TURN = (1, 150)        # turntable reveal
S_WHEEL = (151, 192)
S_PAINT = (193, 234)
S_UNDER = (235, 276)
S_PULL = (277, 392)      # pull back, track rises, cars land at the gate
RELEASE = 400            # gate drops
S_RACE = (393, F_END3D)
RACE_LOW = 436

HERO_SPIN0, HERO_SPIN1 = math.radians(-150), math.radians(40)
LIFT_POS = Vector((0, 0, 0.75)); LIFT_ROLL = math.radians(-72)

def car_rot(yaw, pitch=0.0, roll=0.0):
    return (Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(pitch, 4, "Y") @ Matrix.Rotation(roll, 4, "X")).to_quaternion()

def gate_pose(lane):
    y = Y_GATE + 0.95
    return Vector((LANES[lane], y, h(y))), car_rot(-math.pi / 2, math.atan(dh(y)))

def race_y(i, f):
    t = max(0.0, (f - RELEASE) / FPS)
    vmax = (17.0, 17.4, 16.7, 17.2)[i]; ta = 0.9
    d = 0.5 * vmax / ta * t * t if t < ta else 0.5 * vmax * ta + vmax * (t - ta)
    return Y_GATE + 0.95 - d

LAND = {1: 334, 2: 343, 3: 352}
HERO_LANE = 1; OTHER_LANES = {1: 0, 2: 2, 3: 3}

def hero_pose(f):
    if f <= S_TURN[1]:
        t = (f - 1) / (S_TURN[1] - 1)
        return Vector((0, 0, DISC_TOP)), car_rot(lerp(HERO_SPIN0, HERO_SPIN1, ease_io(t) * 0.35 + t * 0.65))
    if f < S_UNDER[0]:
        return Vector((0, 0, DISC_TOP)), car_rot(HERO_SPIN1)
    if f < S_PULL[0] + 10:
        return LIFT_POS.copy(), car_rot(HERO_SPIN1, 0, LIFT_ROLL)
    gp, gq = gate_pose(HERO_LANE)
    if f < RELEASE:
        t = ease_io((f - (S_PULL[0] + 10)) / 70)
        p = vlerp(LIFT_POS, gp, t); p.z += 2.2 * math.sin(math.pi * t)
        q0 = car_rot(HERO_SPIN1, 0, LIFT_ROLL)
        q1 = gq
        tr = ease_io((f - (S_PULL[0] + 10)) / 40)
        q = q0.slerp(car_rot(HERO_SPIN1), tr) if tr < 1 else car_rot(HERO_SPIN1)
        q = q.slerp(q1, t)
        return p, q
    y = race_y(0, f)
    return Vector((LANES[HERO_LANE], y, h(y))), car_rot(-math.pi / 2, math.atan(dh(y)))

def other_pose(i, f):
    lane = OTHER_LANES[i]
    gp, gq = gate_pose(lane)
    if f < LAND[i]:
        return Vector((0, 0, -30)), gq
    if f < RELEASE:
        t = (f - LAND[i]) / 16.0
        p = gp.copy()
        if t < 1:
            p.z += 3.0 * (1 - ease_out(t)) ** 1.6
        else:
            p.z += 0.06 * max(0.0, math.sin(math.pi * min(1.0, (t - 1) * 2.5)))
        return p, gq
    y = race_y(i, f)
    return Vector((lane and LANES[lane] or LANES[0], y, h(y))), car_rot(-math.pi / 2, math.atan(dh(y)))

def wheel_angle(i, f):
    if f < RELEASE: return 0.0
    return -(Y_GATE + 0.95 - race_y(i, f)) / WR

def track_z(f):
    t = ease_out((f - (S_PULL[0] + 8)) / 55)
    return lerp(-6.5, 0.0, t)

def camera_at(f):
    """Returns (loc, target, lens, focus distance or None)."""
    if f <= S_TURN[1]:
        t = (f - 1) / (S_TURN[1] - 1)
        loc = vlerp((0.4, -4.6, 1.05), (0.15, -3.5, 0.78), ease_io(t))
        return loc, (0, 0, 0.2), 50, None
    hero_p, hero_q = hero_pose(f)
    M = Matrix.Translation(hero_p) @ hero_q.to_matrix().to_4x4()
    if f <= S_WHEEL[1]:
        t = (f - S_WHEEL[0]) / (S_WHEEL[1] - S_WHEEL[0])
        wheel = M @ Vector((AXLES[0], -WY, WR))
        loc = M @ vlerp((AXLES[0] + 0.55, -0.78, 0.22), (AXLES[0] + 0.42, -0.62, 0.2), ease_io(t))
        return loc, wheel, 85, (loc - wheel).length
    if f <= S_PAINT[1]:
        t = (f - S_PAINT[0]) / (S_PAINT[1] - S_PAINT[0])
        tgt = M @ Vector((lerp(-0.1, -0.45, ease_io(t)), -0.1, 0.27))
        loc = M @ Vector((lerp(0.25, -0.1, ease_io(t)), -0.85, 0.62))
        return loc, tgt, 85, (loc - tgt).length
    if f <= S_UNDER[1]:
        t = (f - S_UNDER[0]) / (S_UNDER[1] - S_UNDER[0])
        tgt = M @ Vector((lerp(0.62, 0.45, ease_io(t)), -0.12, 0.1))
        loc = M @ Vector((lerp(1.25, 1.05, ease_io(t)), -0.62, -0.75))
        return loc, tgt, 50, (loc - tgt).length
    if f <= S_PULL[1]:
        t = ease_io((f - S_PULL[0]) / (S_PULL[1] - S_PULL[0] - 12))
        loc = vlerp((0.9, -2.9, 0.95), (-4.0, -5.5, 5.2), t)
        tgt = vlerp((0, 0, 0.7), (4.4, 17.0, 2.2), t)
        lens = lerp(45, 28, t)
        return loc, tgt, lens, None
    if f < RACE_LOW:
        # tracking alongside the pack down the slope
        yl = race_y(0, f)
        loc = Vector((TX + 3.4, yl - 2.2, h(yl) + 1.1))
        tgt = Vector((TX - 0.2, yl - 0.4, h(yl) + 0.1))
        return loc, tgt, 35, None
    # low beside the finish, looking up the track; a slow, smooth pan
    t = ease_io((f - RACE_LOW) / (S_RACE[1] - RACE_LOW))
    loc = vlerp((TX + 2.5, -2.6, 1.35), (TX + 2.6, -3.0, 1.3), t)
    tgt = vlerp((TX - 0.2, 14.0, 1.4), (TX - 0.7, 5.0, 0.3), t)
    return loc, tgt, 40, None

# ---------------------------------------------------------------- keyframes ---
def key_obj(o, f, loc, q):
    o.location = loc; o.rotation_quaternion = q
    o.keyframe_insert("location", frame=f); o.keyframe_insert("rotation_quaternion", frame=f)

for f in range(1, F_END3D + 2):
    p, q = hero_pose(f); key_obj(cars[0][0], f, p, q)
    for i in (1, 2, 3):
        p, q = other_pose(i, f); key_obj(cars[i][0], f, p, q)
    for i, (_, wheels) in enumerate(cars):
        a = wheel_angle(i, f)
        for w in wheels:
            w.rotation_euler = (0, a, 0); w.keyframe_insert("rotation_euler", index=1, frame=f)
    disc.rotation_euler.z = hero_pose(f)[1].to_euler().z if f <= S_TURN[1] else disc.rotation_euler.z
    disc.keyframe_insert("rotation_euler", index=2, frame=f)
    track.location.z = track_z(f); track.keyframe_insert("location", index=2, frame=f)
    pins.location.z = h(Y_GATE) + 0.12 - (0.3 if f >= RELEASE else 0.0)
    pins.keyframe_insert("location", index=2, frame=f)
    loc, tgt, lens, fd = camera_at(f)
    cam.location = loc; cam.rotation_quaternion = look_quat(loc, tgt); cam_d.lens = lens
    cam.keyframe_insert("location", frame=f); cam.keyframe_insert("rotation_quaternion", frame=f)
    cam_d.keyframe_insert("lens", frame=f)
    cam_d.dof.use_dof = fd is not None
    cam_d.dof.focus_distance = fd or 10.0; cam_d.dof.aperture_fstop = 2.8
    cam_d.dof.keyframe_insert("use_dof", frame=f); cam_d.dof.keyframe_insert("focus_distance", frame=f)

def fcurves_of(idblock):
    ad = idblock.animation_data
    if not ad or not ad.action: return []
    act = ad.action
    try:
        return list(act.fcurves)
    except AttributeError:
        out = []
        for layer in act.layers:
            for strip in layer.strips:
                for cb in strip.channelbags: out.extend(cb.fcurves)
        return out

# cars moving fast blur linearly; everything else steps frame to frame (clean cuts)
fast = set()
for body, wheels in cars:
    fast.add(body.name); fast.update(w.name for w in wheels)
for idb in list(bpy.data.objects) + [cam_d] + list(bpy.data.lights):
    for fc in fcurves_of(idb):
        for kp in fc.keyframe_points:
            moving = idb.name in fast and RELEASE <= kp.co.x
            kp.interpolation = "LINEAR" if moving else "CONSTANT"

# ---------------------------------------------------------------- render ---
r = sc.render
r.engine = "BLENDER_EEVEE"
r.resolution_x, r.resolution_y, r.resolution_percentage = 960, 540, 100
sc.view_settings.view_transform = arg("--view", "Standard")
sc.view_settings.exposure = float(arg("--exposure", -0.6))
r.use_motion_blur = True; r.motion_blur_shutter = 0.5; r.motion_blur_position = "START"
ee = sc.eevee
ee.taa_render_samples = int(arg("--samples", 32))
ee.use_raytracing = True
try:
    ee.ray_tracing_method = "SCREEN"
    ee.ray_tracing_options.resolution_scale = "1"
except Exception: pass
try: ee.use_shadows = True
except Exception: pass
try: ee.motion_blur_steps = 1
except Exception: pass
r.image_settings.file_format = "PNG"; r.image_settings.color_mode = "RGB"; r.image_settings.compression = 15

stills = arg("--stills")
if stills:
    d = os.path.join(OUT, "stills"); os.makedirs(d, exist_ok=True)
    for f in [int(x) for x in stills.split(",")]:
        sc.frame_set(f); r.filepath = os.path.join(d, f"s_{f:04d}.png")
        bpy.ops.render.render(write_still=True)
else:
    if arg("--save"): bpy.ops.wm.save_as_mainfile(filepath=arg("--save"))
    d = os.path.join(OUT, "3d"); os.makedirs(d, exist_ok=True)
    r.filepath = os.path.join(d, "f_"); r.use_overwrite = arg("--overwrite") is not None
    sc.frame_start = int(arg("--start", 1)); sc.frame_end = int(arg("--end", F_END3D))
    bpy.ops.render.render(animation=True)
print("studio done")

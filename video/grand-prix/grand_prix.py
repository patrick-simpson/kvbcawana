"""
Awana Grand Prix - 22-second silent promo  (Blender 5.2 LTS)
============================================================

What this file does, in plain English
-------------------------------------
It is a recipe. Blender reads it top to bottom and BUILDS our own sanctuary
and race from scratch, matched to the owner's photo of the real room (2025):
the bright room with its peaked white ceiling and rows of can lights, tan
walls, the projector screen high under the ridge, the dark-carpeted stage
with its honey-oak steps, the long shiny ribbed aluminium 4-lane track
running from the start gate at the back of the stage down over the steps to
the floor, four homemade pinewood cars at the gate, the flags, trophies and
drums on the left, the red table with the black numbered car board, the
checkered cloth and the blue screen on the right. Then it renders the 3D
shots, lays the flat brand cards over them (made in HTML by cards.mjs with
the kit's own fonts and colours) and glues it all into a silent .mp4.

    blender --factory-startup -b -P grand_prix.py -- --mode preview [--ref photo.jpg]
        960x540, 30 fps, EEVEE: output/Grand Prix - PREVIEW.mp4 + output/contact.png
        (+ output/compare.png, the photo beside frame 1, given --ref)
    blender --factory-startup -b -P grand_prix.py -- --mode final
        1920x1080, 60 fps, Cycles on the graphics card, motion blur:
        output/Grand Prix.mp4
    blender --factory-startup -b -P grand_prix.py -- --mode stills --frames 60,200,400
        a few raw 3D frames (no cards) into output/stills, for checking the look
    blender --factory-startup -b -P grand_prix.py
        just builds the scene and saves output/Grand Prix.blend to look around

The look: a calm church announcement, not a car commercial. Real-world units
(metres; a car is 7 in = 0.178 m), bright, even daylight, slow pushes and
smooth tracking, shallow focus. No shake, no whip pans, no tilted horizons,
no sparks, no coloured gels, no lens streaks, no flares.

The story (seconds; 30 fps frame = seconds x 30 + 1)
-----------------------------------------------------
  0-4.5   From where the photo was taken (on the floor in front of the
          steps, the whole room in view), a slow push up along the track to
          the start gate where four cars wait.
          Card: "The Awana Grand Prix is back."
  4.5-11  The pins drop; the cars roll and pick up speed down the long
          track (gentle slow motion); the camera rolls back down the track
          ahead of them, looking back up at them with the room behind, and
          they come to rest on the run-out. No words.
  11-16   A slow sideways dolly along the numbered car board on the red
          table. Card: "This year, grown-ups race too." then, smaller,
          "Kids race first. Then Trek, Journey and adults race together."
  16-22   The end card (title, leagues, dates, the church's two-line logo),
          at rest from 16.7 s to the end.
"""

import bpy, bmesh, json, math, os, random, subprocess, sys, time, shutil
from mathutils import Vector, Matrix, Euler, Quaternion
from bpy_extras import anim_utils

# ---------------------------------------------------------------- settings --
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
BRAND = os.path.join(REPO, "shared", "brand")
FONTS = os.path.join(BRAND, "fonts")
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    if name in ARGS:
        i = ARGS.index(name)
        return ARGS[i + 1] if i + 1 < len(ARGS) and not ARGS[i + 1].startswith("--") else True
    return default


MODE = arg("--mode", "build")        # build | preview | final | stills
OUT_DIR = arg("--out", os.path.join(HERE, "output"))
FPS = 30
F_END = 660                            # the whole video (22 s)
F_3D = 490                             # the 3D shots end here (the end card covers the rest)
RATE = int(arg("--fps", 60 if MODE == "final" else FPS))
assert RATE % FPS == 0, "--fps must be a multiple of 30"
KR = RATE // FPS
PRE = "[grand-prix]"

# ------------------------------------------------------------- the timeline --
# frame numbers at 30 fps (frame 1 = 0.00 s, frame 31 = 1.00 s)
T = dict(
    race=136,          # CUT: beside the gate (4.5 s)
    pins=150,          # the pins drop, the cars go
    board=331,         # CUT: the car board (11.0 s)
    card1=(31, 126),   # card 1 in, out
    card2=(352, 462),  # card 2 headline in, out
    card2b=376,        # its smaller line, a beat later
    wipe=(466, 486),   # the end card's field wipes up over the board shot
    end_text=(482, 500),  # the end card's words settle; at rest from 500 (16.6 s)
)
CUTS = [T["race"], T["board"]]

# ---------------------------------------------------------------- brand ---
with open(os.path.join(BRAND, "tokens.json")) as fh:
    TOK = json.load(fh)
HOUSE = TOK["house"]


def lin(hexstr, a=1.0):
    """'#B3D0E7' -> linear RGBA (what Blender's colour sockets want)."""
    h = hexstr.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, a)


# ------------------------------------------------- real-world dimensions ---
IN = 0.0254
CAR_L = 7.0 * IN                 # 7 inches long
CAR_W = 1.75 * IN
BLOCK_H = 1.25 * IN
WHEEL_R = 0.6 * IN               # 1.2 in plastic wheels
WHEEL_W = 0.35 * IN
WHEELBASE = 4.375 * IN
AXLE_Z = WHEEL_R
BODY_Z = AXLE_Z - 0.3 * IN       # underside of the block
WHEEL_Y = CAR_W / 2 + 0.0008 + WHEEL_W / 2
LANE_PITCH = 3.5 * IN
LANES_Y = [(i - 1.5) * LANE_PITCH for i in range(4)]
GUIDE_W, GUIDE_H = 1.6 * IN, 0.25 * IN
TRACK_HW = 2 * LANE_PITCH + 0.02

# The world: x runs along the track from the gate (x = 0) toward the camera
# that took the reference photo (x = CAM0.x); y across (+y is the right of
# the picture); z up. The track lies along y = 0.
#
# The room is built in its own frame ("room local") and turned a little:
# in the photo the stage front is not square to the track (its right end is
# nearer the camera), and the track runs 0.7 m left of the room's centre
# line (the ridge and the projector screen are right of it). ROOM_O is the
# room's origin in the world, ROOM_YAW its turn.
ROOM_O = Vector((0.0, 0.70, 0.0))
ROOM_YAW = math.radians(-7.0)
_RC, _RS = math.cos(ROOM_YAW), math.sin(ROOM_YAW)


def l2w(x, y, z=0.0):
    """Room-local point -> world."""
    return Vector((ROOM_O.x + _RC * x - _RS * y, ROOM_O.y + _RS * x + _RC * y, z))


def w2l(x, y, z=0.0):
    """World point -> room-local."""
    dx, dy = x - ROOM_O.x, y - ROOM_O.y
    return Vector((_RC * dx + _RS * dy, -_RS * dx + _RC * dy, z))


# the room, in room-local metres (measured off the reference photo)
STAGE_H = 0.60
STAGE_FRONT = 2.85               # the stage's front edge
STEP_D, STEP_H = 0.35, 0.20      # two oak treads, three risers
N_STEPS = 2
BACK_WALL = -1.05
FRONT_WALL = 14.0
ROOM_HW = 6.2                    # half the room's width
EAVE_Z, RIDGE_Z = 2.75, 3.95     # the peaked ceiling: walls meet it, its ridge
CAM0 = Vector((5.5, 0.95, 1.70))  # where the photo was taken (world)


def ceil_z(y_local):
    return RIDGE_Z - (RIDGE_Z - EAVE_Z) * min(abs(y_local), ROOM_HW) / ROOM_HW


# the track profile (world x -> lane surface height), read off the photo:
# the gate up on its stand at the back of the stage, a steep drop, then a
# long, gentle run over the stage edge and the steps, down to the floor
# behind the camera, and a flat run-out
X_START, X_END = -0.32, 12.0
TRACK_PTS = [(-0.32, 1.76), (0.0, 1.66), (0.55, 1.42), (1.25, 1.08), (2.0, 0.90), (2.9, 0.82),
             (4.4, 0.75), (6.6, 0.48), (8.6, 0.12), (9.6, 0.045), (12.0, 0.045)]
Z_TOP = TRACK_PTS[1][1]
_XS = [X_START + i * 0.005 for i in range(int((X_END - X_START) / 0.005) + 1)]


def _smooth(t):
    t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)


def _pchip(pts):
    """Monotone cubic through the points (no overshoot, smooth slope)."""
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    n = len(pts)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [d[0]] + [0.0] * (n - 2) + [d[-1]]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] <= 0:
            m[i] = 0.0
        else:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

    def f(x):
        i = max(0, min(n - 2, next((k for k in range(n - 1) if x <= xs[k + 1]), n - 2)))
        t = (x - xs[i]) / h[i]
        h00, h10 = 2 * t ** 3 - 3 * t ** 2 + 1, t ** 3 - 2 * t ** 2 + t
        h01, h11 = -2 * t ** 3 + 3 * t ** 2, t ** 3 - t ** 2
        return h00 * ys[i] + h10 * h[i] * m[i] + h01 * ys[i + 1] + h11 * h[i] * m[i + 1]
    return f


_PF = _pchip(TRACK_PTS)
_ZS = [_PF(x) for x in _XS]


def _idx(x):
    return min(max(int((x - X_START) / 0.005), 0), len(_XS) - 2)


def tz(x):
    i = _idx(x); t = (x - _XS[i]) / 0.005
    return _ZS[i] + (_ZS[i + 1] - _ZS[i]) * t


def tslope(x):
    i = _idx(x)
    return (_ZS[i + 1] - _ZS[i]) / 0.005


# arclength table: s = 0 at the gate (x = 0)
_SS = [0.0]
for _i in range(1, len(_XS)):
    _SS.append(_SS[-1] + math.hypot(0.005, _ZS[_i] - _ZS[_i - 1]))
_S0 = _SS[_idx(0.0)]
_SS = [s - _S0 for s in _SS]


def s2x(s):
    import bisect
    i = min(max(bisect.bisect_left(_SS, s), 1), len(_SS) - 1)
    s0, s1 = _SS[i - 1], _SS[i]
    return _XS[i - 1] + 0.005 * (s - s0) / max(s1 - s0, 1e-9)


def ground_local(xl):
    """Height of the floor (stage, steps, sanctuary floor) at room-local x."""
    if xl < STAGE_FRONT:
        return STAGE_H
    k = int((xl - STAGE_FRONT) / STEP_D) + 1
    return max(0.0, STAGE_H - k * STEP_H)


def ground(x, y=0.0):
    """Height of the floor under the world point (x, y)."""
    return ground_local(w2l(x, y).x)


def track_point(s, y, h=0.0):
    """Point on the lane surface at arclength s, across-track y, h above it."""
    x = s2x(s)
    n = Vector((-tslope(x), 0, 1)).normalized()
    return Vector((x, y, tz(x))) + n * h


def track_pitch(s):
    return math.atan(-tslope(s2x(s)))


for _x in [i * 0.05 for i in range(int(X_END / 0.05))]:
    for _y in (-0.2, 0.2):
        assert tz(_x) > ground(_x, _y) + 0.03, f"track hits the stage/steps at x={_x:.2f}"


# ------------------------------------------------------------------ easing --
def clamp(v, a=0.0, b=1.0):
    return max(a, min(b, v))


def smooth(t):
    return _smooth(t)


def ease_io(t):
    t = clamp(t); return 4 * t * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


def ease_out(t):
    t = clamp(t); return 1 - (1 - t) ** 3


def ramp(f, a, b):
    return clamp((f - a) / max(b - a, 1e-9))


def lerp(a, b, t):
    return a + (b - a) * t


def bezier(p1x, p1y, p2x, p2y):
    """CSS cubic-bezier(p1x, p1y, p2x, p2y) as a function of t in 0..1
    (the kit's motion curves, tokens.json motion.curves)."""
    def bx(u, a, b):
        return 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3

    def f(t):
        t = clamp(t)
        lo, hi = 0.0, 1.0
        for _ in range(40):
            mid = (lo + hi) / 2
            if bx(mid, p1x, p2x) < t:
                lo = mid
            else:
                hi = mid
        return bx((lo + hi) / 2, p1y, p2y)
    return f


CURVE = {k: bezier(*v) for k, v in TOK["motion"]["curves"].items()}


# ---------------------------------------------------------- bake helpers ---
def channelbag(idb):
    ad = idb.animation_data
    return anim_utils.action_get_channelbag_for_slot(ad.action, ad.action_slot)


TRACKS = {}


def K(owner, attr, f, val, interp="LINEAR"):
    """Queue a key: owner.attr = val at frame f. Flushed in one go by flush()."""
    k = (owner.as_pointer(), attr)
    if k not in TRACKS:
        TRACKS[k] = [owner, attr, {}, interp]
    if isinstance(val, (Vector, Quaternion, Euler)):
        val = tuple(val)
    TRACKS[k][2][f] = val


def flush():
    """Write every queued key straight into the f-curves, LINEAR, with a
    CONSTANT hold on the frame before each cut so motion blur and the 60 fps
    in-betweens never smear one shot into the next."""
    cut_before = {c - 1 for c in CUTS}
    n = 0
    for owner, attr, d, interp in TRACKS.values():
        frames = sorted(d)
        v0 = d[frames[0]]
        multi = isinstance(v0, tuple)
        cur = getattr(owner, attr)
        if multi:
            for i, v in enumerate(v0):
                cur[i] = v
        else:
            setattr(owner, attr, v0)
        owner.keyframe_insert(attr, frame=frames[0])
        path = owner.path_from_id(attr)
        cb = channelbag(owner.id_data)
        for i in (range(len(v0)) if multi else [-1]):
            fc = next(fc for fc in cb.fcurves if fc.data_path == path and (i < 0 or fc.array_index == i))
            kp = fc.keyframe_points
            kp.clear(); kp.add(len(frames))
            co = []
            for f in frames:
                co += [float(f), float(d[f][i] if multi else d[f])]
            kp.foreach_set("co", co)
            for j, f in enumerate(frames):
                kp[j].interpolation = "CONSTANT" if (interp == "CONSTANT" or f in cut_before) else interp
            fc.update()
            n += len(frames)
    print(f"{PRE} baked {n} keys on {len(TRACKS)} channels", flush=True)


# ------------------------------------------------------- scene helpers -----
def link(obj, coll):
    coll.objects.link(obj)
    return obj


def new_coll(name, sc=None):
    c = bpy.data.collections.new(name)
    (sc or bpy.context.scene).collection.children.link(c)
    return c


def mesh_obj(name, verts, faces, coll, mats=()):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = link(bpy.data.objects.new(name, me), coll)
    for m in mats:
        me.materials.append(m)
    return o


def bm_obj(name, bm, coll, mats=()):
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me), coll)
    for m in mats:
        me.materials.append(m)
    return o


def _faces_of(verts):
    return {f for v in verts for f in v.link_faces}


def bm_box(bm, center, size, mat=0, rot=None):
    m = Matrix.Translation(Vector(center)) @ (rot.to_4x4() if rot else Matrix()) @ Matrix.Diagonal((*size, 1))
    r = bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    for f in _faces_of(r["verts"]):
        f.material_index = mat
    return r["verts"]


def bm_cyl(bm, center, r, depth, axis="Z", mat=0, seg=20, r2=None):
    rot = {"Z": Matrix(), "Y": Matrix.Rotation(math.pi / 2, 4, "X"), "X": Matrix.Rotation(math.pi / 2, 4, "Y")}[axis]
    m = Matrix.Translation(Vector(center)) @ rot
    res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r,
                                radius2=r if r2 is None else r2, depth=depth, matrix=m)
    for f in _faces_of(res["verts"]):
        f.material_index = mat
    return res["verts"]


def bm_sphere(bm, center, r, mat=0, scale=(1, 1, 1)):
    res = bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=r,
                                    matrix=Matrix.Translation(Vector(center)) @ Matrix.Diagonal((*scale, 1)))
    for f in _faces_of(res["verts"]):
        f.material_index = mat
    return res["verts"]


def look_quat(loc, target):
    """Level camera (no roll) at loc looking at target."""
    return (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y")


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.name = "Grand Prix"
    sc.render.fps = RATE
    sc.render.frame_map_old, sc.render.frame_map_new = FPS, RATE
    sc.frame_start, sc.frame_end = 1, F_3D * KR
    sc.unit_settings.system = "METRIC"
    return sc


# ------------------------------------------------------------- materials ---
def _bsdf_mat(name):
    m = bpy.data.materials.new(name)
    if not m.node_tree:
        m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (600, 0)
    b = nt.nodes.new("ShaderNodeBsdfPrincipled"); b.location = (300, 0)
    nt.links.new(b.outputs[0], out.inputs["Surface"])
    return m, nt, b


def mat(name, color, rough=0.5, metal=0.0, coat=0.0, emit=0.0, emit_color=None):
    m, nt, b = _bsdf_mat(name)
    c = lin(color) if isinstance(color, str) else color
    b.inputs["Base Color"].default_value = c
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = 0.08
    if emit:
        b.inputs["Emission Color"].default_value = lin(emit_color) if emit_color else c
        b.inputs["Emission Strength"].default_value = emit
    m.diffuse_color = c
    return m


def emit_mat(name, color, strength=1.0):
    m = bpy.data.materials.new(name)
    if not m.node_tree:
        m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = lin(color)
    em.inputs["Strength"].default_value = strength
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


def mixc(nt, fac, a, b):
    n = nt.nodes.new("ShaderNodeMix"); n.data_type = "RGBA"
    ins = [s for s in n.inputs if s.type == "RGBA"]
    fin = [s for s in n.inputs if s.name == "Factor" and s.type == "VALUE"][0]
    for sock, v in ((fin, fac), (ins[0], a), (ins[1], b)):
        if isinstance(v, bpy.types.NodeSocket):
            nt.links.new(v, sock)
        else:
            sock.default_value = v
    return [o for o in n.outputs if o.type == "RGBA"][0]


def math_node(nt, op, a, b=None, c=None):
    n = nt.nodes.new("ShaderNodeMath"); n.operation = op
    for i, v in enumerate((a, b, c)):
        if v is None:
            continue
        if isinstance(v, bpy.types.NodeSocket):
            nt.links.new(v, n.inputs[i])
        else:
            n.inputs[i].default_value = v
    return n.outputs[0]


def grain(nt, light_c, dark_c, scale, stretch=(1.0, 14.0, 14.0)):
    """Wood grain along object X: stretched noise between two colours."""
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = stretch
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale; nz.inputs["Detail"].default_value = 6.0
    nz.inputs["Distortion"].default_value = 0.6
    nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    r = nt.nodes.new("ShaderNodeValToRGB")
    r.color_ramp.elements[0].position = 0.3; r.color_ramp.elements[0].color = lin(light_c)
    r.color_ramp.elements[1].position = 0.75; r.color_ramp.elements[1].color = lin(dark_c)
    nt.links.new(nz.outputs["Fac"], r.inputs[0])
    return r.outputs["Color"]


def wood_mat(name, light_c="#E6C594", dark_c="#C99A62", rough=0.6, coat=0.0, scale=6.0,
             stretch=(1.0, 14.0, 14.0)):
    m, nt, b = _bsdf_mat(name)
    nt.links.new(grain(nt, light_c, dark_c, scale, stretch), b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = 0.12
    m.diffuse_color = lin(light_c)
    return m


def paint_mat(name, base, stripe=None, stripe_w=0.004, rough=0.4, coat=0.0):
    """Homemade enamel on pine (a little grain shows through), with an
    optional stripe down the top centre line (object y)."""
    m, nt, b = _bsdf_mat(name)
    g = grain(nt, "#FFFFFF", "#D8D8D8", 5.0)
    col = lin(base)
    if stripe:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(tc.outputs["Object"], sep.inputs[0])
        st = math_node(nt, "LESS_THAN", math_node(nt, "ABSOLUTE", sep.outputs["Y"]), stripe_w)
        col = mixc(nt, st, col, lin(stripe))
    mul = nt.nodes.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 0.2
    ins = [s for s in mul.inputs if s.type == "RGBA"]
    if isinstance(col, bpy.types.NodeSocket):
        nt.links.new(col, ins[0])
    else:
        ins[0].default_value = col
    nt.links.new(g, ins[1])
    nt.links.new([o for o in mul.outputs if o.type == "RGBA"][0], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = 0.05
    m.diffuse_color = lin(base)
    return m


def ribbed_alu(name):
    """The track: bright, shiny extruded aluminium with fine ribs along its
    length. Fully metallic and nearly polished, so the ceiling cans show in it
    as bright streaks across the lanes (the ribs smear each one sideways)."""
    m, nt, b = _bsdf_mat(name)
    N, L = nt.nodes, nt.links
    b.inputs["Base Color"].default_value = lin("#D2D5D9")
    b.inputs["Metallic"].default_value = 1.0
    b.inputs["Roughness"].default_value = 0.08
    tc = N.new("ShaderNodeTexCoord")
    sep = N.new("ShaderNodeSeparateXYZ"); L.new(tc.outputs["Object"], sep.inputs[0])
    w = math_node(nt, "SINE", math_node(nt, "MULTIPLY", sep.outputs["Y"], 2 * math.pi / 0.016))
    bump = N.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = float(arg("--tb", 0.5))
    bump.inputs["Distance"].default_value = 0.0008
    L.new(w, bump.inputs["Height"])
    L.new(bump.outputs["Normal"], b.inputs["Normal"])
    # faint brushed streaks so it is not a perfect mirror
    nz = N.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 3.0
    mp = N.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (0.3, 60.0, 60.0)
    L.new(tc.outputs["Object"], mp.inputs["Vector"]); L.new(mp.outputs["Vector"], nz.inputs["Vector"])
    L.new(math_node(nt, "MULTIPLY_ADD", nz.outputs["Fac"], 0.02, float(arg("--tr", 0.09))), b.inputs["Roughness"])
    m.diffuse_color = lin("#D4D8DC")
    return m


def load_font(fname):
    return bpy.data.fonts.load(os.path.join(FONTS, fname), check_existing=True)


def text_obj(name, body, font, size, coll, mat_=None, extrude=0.0):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body; cu.font = font; cu.size = size; cu.extrude = extrude
    cu.align_x = "CENTER"; cu.align_y = "CENTER"; cu.resolution_u = 4
    o = link(bpy.data.objects.new(name, cu), coll)
    if mat_:
        cu.materials.append(mat_)
    return o


def light(name, kind, loc, target, energy, color="#FFFFFF", size=0.1, coll=None, spot_deg=60, blend=0.6,
          size_y=None):
    d = bpy.data.lights.new(name, kind)
    d.energy = energy; d.color = lin(color)[:3]
    if kind == "AREA":
        d.shape = "RECTANGLE" if size_y else "DISK"
        d.size = size
        if size_y:
            d.size_y = size_y
    else:
        d.shadow_soft_size = size
        if kind == "SPOT":
            d.spot_size = math.radians(spot_deg); d.spot_blend = blend
    o = link(bpy.data.objects.new(name, d), coll)
    o.location = loc
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = look_quat(loc, target)
    return o


# ==================================================================== cars ===
# Profiles: top height of the block above its underside at x (rear -CAR_L/2
# to front +CAR_L/2). Homemade shapes: wedges, blocks, a bullet; the grown-up
# builds are lower, smoother and glossier, but still one pine block.
def p_wedge(hr, hf):
    return lambda x: hf + (hr - hf) * (CAR_L / 2 - x) / CAR_L


def p_block(h, r=0.03):
    def f(x):
        d = x - (CAR_L / 2 - r)
        return h if d <= 0 else max(0.006, h - (r - math.sqrt(max(r * r - d * d, 0))) * h / r)
    return f


def p_bullet(h):
    def f(x):
        u = (x + CAR_L / 2) / CAR_L
        return max(0.007, h * math.sin(math.pi * clamp(0.12 + 0.8 * u)) ** 0.6)
    return f


def p_sleek(peak=0.021, nose=0.006, tail=0.014, at=-0.025):
    def f(x):
        if x < at:
            t = (x + CAR_L / 2) / (at + CAR_L / 2)
            return tail + (peak - tail) * math.sin(t * math.pi / 2)
        t = (x - at) / (CAR_L / 2 - at)
        return nose + (peak - nose) * math.cos(t * math.pi / 2) ** 1.4
    return f


def hw_plain(x):
    return CAR_W / 2


def hw_taper(x):
    return CAR_W / 2 - (0.004 * (x / (CAR_L / 2)) ** 2 if x > 0 else 0.0)


def body_mesh(name, top, hw, zb, n=28):
    xs = [-CAR_L / 2 + CAR_L * i / n for i in range(n + 1)]
    verts = []
    for x in xs:
        w, h = hw(x), top(x)
        verts += [(x, -w, zb), (x, w, zb), (x, w, zb + h), (x, -w, zb + h)]
    faces = []
    for i in range(n):
        a, b = 4 * i, 4 * (i + 1)
        for k in range(4):
            k2 = (k + 1) % 4
            faces.append((a + k, a + k2, b + k2, b + k))
    faces.append((3, 2, 1, 0))
    faces.append((4 * n, 4 * n + 1, 4 * n + 2, 4 * n + 3))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    return me


def wheel_mesh(name, tire, hub):
    bm = bmesh.new()
    bm_cyl(bm, (0, 0, 0), WHEEL_R, WHEEL_W, "Y", 0, seg=28)
    bm_cyl(bm, (0, 0, 0), WHEEL_R * 0.42, WHEEL_W + 0.001, "Y", 1, seg=16)
    for sy in (-1, 1):   # moulded spokes on the outside face: shows the spin
        for a in range(5):
            ang = a * 2 * math.pi / 5
            c = (math.cos(ang) * WHEEL_R * 0.66, sy * (WHEEL_W / 2 + 0.0002), math.sin(ang) * WHEEL_R * 0.66)
            bm_box(bm, c, (0.0022, 0.0005, 0.0022), 1)
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    for m in (tire, hub):
        me.materials.append(m)
    return me


def nail_mesh(name, steel):
    bm = bmesh.new()
    bm_cyl(bm, (0, 0.011, 0), 0.0011, 0.022, "Y", 0, seg=8)
    bm_cyl(bm, (0, -0.0004, 0), 0.0025, 0.0008, "Y", 0, seg=12)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    me.materials.append(steel)
    return me


class Car:
    pass


def build_car(name, coll, M, top, hw, paint, extras=(), rnd=None, tuned=False):
    """One pinewood car: root empty at the track contact point, x forward.
    extras: 'dots' / 'squares' (side stickers), 'weights' (tungsten on top),
    'spoiler' (a little pine wing), 'driver' (a round wooden head)."""
    rnd = rnd or random.Random(hash(name) & 0xFFFF)
    c = Car(); c.name = name
    root = link(bpy.data.objects.new(name, None), coll)
    root.empty_display_size = 0.05
    root.rotation_mode = "XYZ"
    c.root = root
    body = link(bpy.data.objects.new(name + " body", body_mesh(name + " body", top, hw, BODY_Z)), coll)
    body.parent = root
    body.data.materials.append(paint)
    bev = body.modifiers.new("Bevel", "BEVEL")
    bev.width = 0.0035 if tuned else 0.0018
    bev.segments = 3 if tuned else 2
    bev.limit_method = "ANGLE"; bev.angle_limit = math.radians(40)
    bm = bmesh.new()
    mats = [M["slot"]]
    for sx in (-1, 1):
        x = sx * WHEELBASE / 2
        for sy in (-1, 1):
            bm_box(bm, (x, sy * (hw(x) + 0.0001), BODY_Z + 0.0032), (0.0028, 0.0004, 0.0064), 0)
    if "dots" in extras or "squares" in extras:
        cols = rnd.sample(M["sticker_cols"], 3)
        base = len(mats)
        mats += [M["sticker"][k] for k in cols]
        for i in range(rnd.randint(2, 4)):
            x = rnd.uniform(-0.06, 0.03)
            zmax = top(x) - 0.006
            if zmax < 0.008:
                continue
            for sy in (-1, 1):
                p = (x, sy * (hw(x) + 0.0003), BODY_Z + rnd.uniform(0.006, zmax))
                mi = base + i % 3
                if "dots" in extras:
                    bm_cyl(bm, p, rnd.uniform(0.0035, 0.006), 0.0004, "Y", mi, seg=16)
                else:
                    s = rnd.uniform(0.006, 0.01)
                    bm_box(bm, p, (s, 0.0004, s * 0.8), mi)
    if "weights" in extras:
        mats.append(M["tungsten"]); wi = len(mats) - 1
        for x in (-0.066, -0.054, -0.042):
            bm_cyl(bm, (x, 0.0, BODY_Z + top(x) - 0.0008), 0.0042, 0.003, "Z", wi, seg=18)
    if "spoiler" in extras:
        mats.append(M["pine"]); wi = len(mats) - 1
        zt = BODY_Z + top(-CAR_L / 2 + 0.012)
        bm_box(bm, (-CAR_L / 2 + 0.012, 0.0, zt + 0.006), (0.006, 0.006, 0.012), wi)
        bm_box(bm, (-CAR_L / 2 + 0.012, 0.0, zt + 0.0125), (0.016, CAR_W * 0.95, 0.003), wi)
    if "driver" in extras:
        mats.append(M["pine"]); wi = len(mats) - 1
        x = -0.02
        bm_sphere(bm, (x, 0.0, BODY_Z + top(x) + 0.006), 0.0075, wi)
    det = bm_obj(name + " details", bm, coll, mats)
    det.parent = root
    c.wheels = []
    wme = M["wheel_tuned"] if tuned else M["wheel"]
    for sx in (1, -1):
        for sy in (-1, 1):
            x = sx * WHEELBASE / 2
            w = link(bpy.data.objects.new(f"{name} wheel", wme), coll)
            w.parent = root; w.location = (x, sy * WHEEL_Y, AXLE_Z)
            w.rotation_mode = "XYZ"
            c.wheels.append(w)
            a = link(bpy.data.objects.new(f"{name} axle", M["nail"]), coll)
            a.parent = root
            a.location = (x, sy * (WHEEL_Y + WHEEL_W / 2 + 0.0009), AXLE_Z)
            a.rotation_euler = (0, 0, 0 if sy < 0 else math.pi)
    return c


def car_assets():
    M = {}
    M["slot"] = mat("Axle slot", "#2a1a0e", 0.8)
    M["tire"] = mat("Black plastic wheel", "#0d0d0e", 0.38)
    M["hub"] = mat("Wheel hub", "#1c1c1e", 0.45)
    M["hub_tuned"] = mat("Polished hub", "#C9CCD0", 0.15, metal=1.0)
    M["steel"] = mat("Nail steel", "#cfd2d6", 0.25, metal=1.0)
    M["tungsten"] = mat("Tungsten", "#6d6f73", 0.3, metal=1.0)
    M["pine"] = wood_mat("Raw pine", scale=8.0)
    M["wheel"] = wheel_mesh("Wheel", M["tire"], M["hub"])
    M["wheel_tuned"] = wheel_mesh("Tuned wheel", M["tire"], M["hub_tuned"])
    M["nail"] = nail_mesh("Nail axle", M["steel"])
    sc = {"white": "#F6F4EE", "yellow": "#F7C531", "red": "#D9352E", "blue": "#2F64C8",
          "green": "#3E9E4F", "black": "#1A1A1C", "orange": "#EE7A22", "pink": "#E86AA6"}
    M["sticker"] = {k: mat(f"Sticker {k}", v, 0.3, coat=0.4) for k, v in sc.items()}
    M["sticker_cols"] = list(sc)
    return M


# ================================================================ the room ===
def build_world(sc):
    w = bpy.data.worlds.new("Sanctuary"); sc.world = w
    if not w.node_tree:
        w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    if bg is None:
        bg = w.node_tree.nodes.new("ShaderNodeBackground")
        out = w.node_tree.nodes.new("ShaderNodeOutputWorld")
        w.node_tree.links.new(bg.outputs[0], out.inputs[0])
    # the room is closed; this is the even, bright daylight bounce off the
    # white ceiling and the tan walls
    bg.inputs["Color"].default_value = lin("#F3EADC")
    bg.inputs["Strength"].default_value = float(arg("--ambient", 0.7))


def uv_quad(name, corners, coll, material, nu=1, nv=1):
    """A flat quad (corners in order bl, br, tr, tl) with 0..1 UVs."""
    bl, br, tr, tl = [Vector(c) for c in corners]
    verts, faces, uvs = [], [], []
    for j in range(nv + 1):
        for i in range(nu + 1):
            u, v = i / nu, j / nv
            verts.append(tuple(bl.lerp(br, u).lerp(tl.lerp(tr, u), v)))
            uvs.append((u, v))
    for j in range(nv):
        for i in range(nu):
            a = j * (nu + 1) + i
            faces.append((a, a + 1, a + nu + 2, a + nu + 1))
    o = mesh_obj(name, verts, faces, coll, [material])
    uv = o.data.uv_layers.new()
    for poly in o.data.polygons:
        for li in poly.loop_indices:
            uv.data[li].uv = uvs[o.data.loops[li].vertex_index]
    return o


def screen_mat():
    """The projector's picture: plain and very light, with a simple red
    block of white stripes on its right. No words."""
    m = bpy.data.materials.new("Projected picture")
    if not m.node_tree:
        m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear(); N, L = nt.nodes, nt.links
    out = N.new("ShaderNodeOutputMaterial")
    em = N.new("ShaderNodeEmission")
    tc = N.new("ShaderNodeTexCoord")
    sep = N.new("ShaderNodeSeparateXYZ"); L.new(tc.outputs["UV"], sep.inputs[0])
    u, v = sep.outputs["X"], sep.outputs["Y"]

    def box(u0, u1, v0, v1):
        a = math_node(nt, "MULTIPLY", math_node(nt, "GREATER_THAN", u, u0), math_node(nt, "LESS_THAN", u, u1))
        b = math_node(nt, "MULTIPLY", math_node(nt, "GREATER_THAN", v, v0), math_node(nt, "LESS_THAN", v, v1))
        return math_node(nt, "MULTIPLY", a, b)
    col = mixc(nt, box(0.02, 0.98, 0.2, 0.78), lin("#E4E3DF"), lin("#FFFFFF"))
    red = box(0.70, 0.95, 0.30, 0.68)
    diag = math_node(nt, "LESS_THAN", math_node(nt, "FRACT", math_node(nt, "MULTIPLY",
                     math_node(nt, "ADD", math_node(nt, "MULTIPLY", u, 1.7), v), 9.0)), 0.62)
    col = mixc(nt, math_node(nt, "MULTIPLY", red, diag), col, lin("#D8262E"))
    L.new(col, em.inputs["Color"])
    em.inputs["Strength"].default_value = float(arg("--screen", 2.4))
    L.new(em.outputs[0], out.inputs["Surface"])
    return m


def build_room(coll):
    """The sanctuary, in room-local metres: stage, oak steps, tan walls, the
    peaked white ceiling with its rows of cans, the projector screen."""
    S = {}
    carpet = mat("Stage carpet", "#111011", 1.0)
    floor_carpet = mat("Sanctuary carpet", "#3B342D", 0.95)
    oak = wood_mat("Step oak", "#B86E1C", "#8A4A10", rough=0.4, coat=0.15, scale=3.0,
                   stretch=(6.0, 0.25, 6.0))
    oak_riser = wood_mat("Riser oak", "#C4823A", "#9C5E22", rough=0.45, coat=0.1, scale=3.0,
                         stretch=(6.0, 0.25, 6.0))
    wall = mat("Wall", "#D8B884", 0.85)
    trim = mat("Trim", "#F1EEE7", 0.6)
    ceil = mat("Ceiling", "#EDEBE6", 0.9)
    HW = ROOM_HW
    # sanctuary floor, stage, the stage's oak front and the steps
    bm = bmesh.new()
    bm_box(bm, ((BACK_WALL + FRONT_WALL) / 2, 0, -0.05), (FRONT_WALL - BACK_WALL, 2 * HW, 0.1), 0)
    bm_obj("Sanctuary floor", bm, coll, [floor_carpet])
    bm = bmesh.new()
    bm_box(bm, ((BACK_WALL + STAGE_FRONT) / 2, 0, STAGE_H / 2), (STAGE_FRONT - BACK_WALL, 2 * HW, STAGE_H), 0)
    bm_obj("Stage", bm, coll, [carpet])
    bm = bmesh.new()
    bm_box(bm, (STAGE_FRONT + 0.012, 0, (STAGE_H - 0.03) / 2), (0.024, 2 * HW, STAGE_H - 0.03), 1)
    for k in range(1, N_STEPS + 1):
        x0 = STAGE_FRONT + 0.024 + (k - 1) * STEP_D
        z = STAGE_H - k * STEP_H
        bm_box(bm, (x0 + STEP_D / 2, 0, z / 2), (STEP_D, 2 * HW, z), 0)
        bm_box(bm, (x0 + STEP_D + 0.012, 0, (z - 0.02) / 2), (0.024, 2 * HW, z - 0.02), 1)
    bm_obj("Steps", bm, coll, [oak, oak_riser])
    # walls: the back wall is a gable (its peak under the ridge)
    def gable(x):
        return [(x, -HW, 0), (x, HW, 0), (x, HW, EAVE_Z), (x, 0, RIDGE_Z), (x, -HW, EAVE_Z)]
    bv = gable(BACK_WALL); fv = gable(FRONT_WALL)
    sv = [(BACK_WALL, -HW, 0), (FRONT_WALL, -HW, 0), (FRONT_WALL, -HW, EAVE_Z), (BACK_WALL, -HW, EAVE_Z),
          (BACK_WALL, HW, 0), (FRONT_WALL, HW, 0), (FRONT_WALL, HW, EAVE_Z), (BACK_WALL, HW, EAVE_Z)]
    mesh_obj("Walls", bv + fv + sv, [(0, 1, 2, 3, 4), (9, 8, 7, 6, 5), (10, 11, 12, 13), (17, 16, 15, 14)],
             coll, [wall])
    mesh_obj("Ceiling", [(BACK_WALL, -HW, EAVE_Z), (FRONT_WALL, -HW, EAVE_Z), (FRONT_WALL, 0, RIDGE_Z),
                         (BACK_WALL, 0, RIDGE_Z), (FRONT_WALL, HW, EAVE_Z), (BACK_WALL, HW, EAVE_Z)],
             [(0, 1, 2, 3), (3, 2, 4, 5)], coll, [ceil])
    # white trim: baseboard on the stage, crown along the gable and the eaves
    bm = bmesh.new()
    bm_box(bm, (BACK_WALL + 0.012, 0, STAGE_H + 0.06), (0.024, 2 * HW, 0.12), 0)
    L_ = math.hypot(HW, RIDGE_Z - EAVE_Z)
    ang = math.atan2(RIDGE_Z - EAVE_Z, HW)
    for sy in (-1, 1):
        bm_box(bm, (BACK_WALL + 0.03, sy * HW / 2, (EAVE_Z + RIDGE_Z) / 2 - 0.07), (0.06, L_, 0.11), 0,
               Matrix.Rotation(-sy * ang, 3, "X"))
        bm_box(bm, ((BACK_WALL + FRONT_WALL) / 2, sy * (HW - 0.03), EAVE_Z - 0.06),
               (FRONT_WALL - BACK_WALL, 0.06, 0.1), 0)
    bm_obj("Trim", bm, coll, [trim])
    # the projector screen, hung high and centred under the ridge, lit
    xs_ = BACK_WALL + 0.16
    sw, sz0, sz1 = 2.5, 1.86, 3.50
    uv_quad("Projector picture", [(xs_ + 0.012, -sw / 2, sz0), (xs_ + 0.012, sw / 2, sz0),
                                  (xs_ + 0.012, sw / 2, sz1), (xs_ + 0.012, -sw / 2, sz1)], coll, screen_mat())
    bm = bmesh.new()
    bm_box(bm, (xs_, 0, (sz0 + sz1) / 2 + 0.03), (0.02, sw + 0.08, sz1 - sz0 + 0.14), 0)   # screen surround
    bm_box(bm, (xs_ + 0.006, 0, sz0 - 0.04), (0.02, sw + 0.08, 0.035), 1)                  # bottom bar
    bm_box(bm, (xs_ - 0.04, 0, sz1 + 0.12), (0.17, sw + 0.3, 0.12), 0)                     # roller case
    bm_box(bm, (xs_ + 0.01, 0.05, sz0 - 0.2), (0.01, 0.03, 0.22), 2)                        # pull tag
    bm_obj("Projector screen", bm, coll, [mat("Screen surround", "#E9E7E1", 0.6),
                                          mat("Screen bar", "#1A1A1C", 0.5), mat("Pull tag", "#E7C24A", 0.5)])
    # ceiling cans in rows down the slope: a lit disc and a soft spot each
    disc = emit_mat("Can light", "#FFF4E2", 60.0)
    ring = mat("Can trim", "#F6F4EF", 0.4)
    bm = bmesh.new(); bmr = bmesh.new()
    S["cans"] = []
    for x in (-0.35, 1.55, 3.45, 5.35, 7.25, 9.15, 11.05, 12.95):
        for y in (-4.8, -2.95, -1.1, 1.1, 2.95, 4.8):
            z = ceil_z(abs(y) + 0.11) - 0.003
            bm_cyl(bm, (x, y, z - 0.002), 0.095, 0.004, "Z", 0, seg=24)
            bm_cyl(bmr, (x, y, z), 0.125, 0.006, "Z", 0, seg=24)
            S["cans"].append(light(f"Can {x},{y}", "SPOT", Vector((x, y, z - 0.06)), Vector((x, y, 0)),
                                   float(arg("--can", 300)), "#FFF0DC", size=0.10, coll=coll, spot_deg=150,
                                   blend=0.5))
            S["cans"][-1].data.specular_factor = float(arg("--canspec", 3.0))
    bm_obj("Can light discs", bm, coll, [disc])
    bm_obj("Can trims", bmr, coll, [ring])
    # the daylight-bright house light: big soft panels under the ceiling
    for x, y in ((1.0, -2.6), (1.0, 2.6), (6.5, -2.6), (6.5, 2.6)):
        h = light(f"House {x},{y}", "AREA", Vector((x, y, ceil_z(abs(y)) - 0.15)), Vector((x, y, 0)),
                  float(arg("--fill", 500)), "#FFF1DE", size=4.5, size_y=4.0, coll=coll)
        h.data.specular_factor = 0.15      # soft fill: no big glare on the oak or the track
    return S


def build_props(coll):
    """The stage as the photo has it. Left: the US flag and the red Awana
    flag on chrome poles, the trophy table, the drum kit and music stands.
    Centre back: a small carpeted box, a black lectern. Right: the checkered
    cloth and the blue screen on its stand (the red table is build_board).
    Room-local; P() converts the world spots read off the photo."""
    def P(xw, yw):
        v = w2l(xw, yw); return v.x, v.y
    gold = mat("Trophy gold", "#C8901E", 0.32, metal=1.0)
    marble = mat("Trophy base", "#2A2522", 0.4)
    black = mat("Black", "#18181A", 0.5)
    chrome = mat("Chrome", "#E2E4E6", 0.08, metal=1.0)
    wood_tab = wood_mat("Table wood", "#7E5532", "#5E3C20", rough=0.5)
    Z0 = STAGE_H
    # trophy table, stage left: rows of small gold trophies, two big cups
    bm = bmesh.new()
    tx, ty = P(1.75, -1.75)
    TL, TD, TH = 1.7, 0.55, 0.74
    bm_box(bm, (tx, ty, Z0 + TH - 0.02), (TD, TL, 0.04), 2)
    for sx in (-1, 1):
        for sy in (-1, 1):
            bm_box(bm, (tx + sx * (TD / 2 - 0.04), ty + sy * (TL / 2 - 0.05), Z0 + (TH - 0.04) / 2),
                   (0.03, 0.03, TH - 0.04), 3)
    zb = Z0 + TH
    for row, dx in enumerate((0.12, -0.08)):
        for i in range(12):
            y = ty - TL / 2 + 0.12 + i * (TL - 0.24) / 11
            big = (row == 1 and i in (2, 8))
            h = 0.34 if big else (0.20 + 0.03 * (i % 2))
            x = tx + dx
            bm_box(bm, (x, y, zb + 0.025), (0.08, 0.08, 0.05), 1)
            bm_cyl(bm, (x, y, zb + 0.05 + h * 0.3), 0.009, h * 0.55, "Z", 0, seg=10)
            bm_cyl(bm, (x, y, zb + 0.05 + h * 0.75), 0.055 if big else 0.034, h * 0.38, "Z", 0, seg=16,
                   r2=0.02 if big else 0.016)
    bm_obj("Trophy table", bm, coll, [gold, marble, wood_tab, black])

    # flags: chrome poles on round chrome bases; the cloth hangs limp in folds
    def flag(name, xw, yw, colfn, H=1.80):
        x, y = P(xw, yw)
        bm = bmesh.new()
        bm_cyl(bm, (x, y, Z0 + H / 2), 0.014, H, "Z", 0, seg=12)
        bm_cyl(bm, (x, y, Z0 + 0.025), 0.17, 0.05, "Z", 0, seg=32, r2=0.12)
        bm_cyl(bm, (x, y, Z0 + 0.09), 0.03, 0.10, "Z", 0, seg=16, r2=0.015)
        bm_sphere(bm, (x, y, Z0 + H + 0.05), 0.04, 0, scale=(1, 1, 1.5))
        bm_obj(name + " pole", bm, coll, [chrome])
        nu, nv = 40, 30
        verts, faces = [], []
        Hh = 1.35
        top = Z0 + H - 0.04
        for j in range(nv + 1):
            for i in range(nu + 1):
                u, v = i / nu, j / nv
                # hanging limp: the hoist along the pole, the rest gathered
                # into deep vertical folds a hand's width or two to its side
                width = 0.26 + 0.08 * v
                fold = ((0.04 + 0.03 * v) * math.sin(u * 2 * math.pi * 2.2 + 0.9 * v)
                        + 0.018 * math.sin(u * 2 * math.pi * 4.7 + 2.6 * v + 1.0)) * min(1.0, u * 5)
                verts.append((x + 0.012 + fold + 0.05 * v * u,
                              y - 0.018 - u * width,
                              top - v * Hh - 0.12 * u * v))
        for j in range(nv):
            for i in range(nu):
                a = j * (nu + 1) + i
                faces.append((a, a + 1, a + nu + 2, a + nu + 1))
        o = mesh_obj(name, verts, faces, coll, [colfn()])
        me = o.data
        uv = me.uv_layers.new()
        for poly in me.polygons:
            for li in poly.loop_indices:
                vi = me.loops[li].vertex_index
                uv.data[li].uv = ((vi % (nu + 1)) / nu, 1 - (vi // (nu + 1)) / nv)
        o.modifiers.new("Smooth", "SUBSURF").levels = 1
        sol = o.modifiers.new("Thick", "SOLIDIFY"); sol.thickness = 0.003

    def us_flag():
        m, nt, b = _bsdf_mat("US flag")
        N, L = nt.nodes, nt.links
        tc = N.new("ShaderNodeTexCoord")
        sep = N.new("ShaderNodeSeparateXYZ"); L.new(tc.outputs["UV"], sep.inputs[0])
        stripes = math_node(nt, "LESS_THAN", math_node(nt, "FRACT", math_node(nt, "MULTIPLY", math_node(
            nt, "ADD", sep.outputs["Y"], math_node(nt, "MULTIPLY", sep.outputs["X"], 0.25)), 6.5)), 0.5)
        col = mixc(nt, stripes, lin("#F4F2EE"), lin("#B22234"))
        canton = math_node(nt, "MULTIPLY", math_node(nt, "LESS_THAN", sep.outputs["X"], 0.4),
                           math_node(nt, "GREATER_THAN", sep.outputs["Y"], 0.46))
        L.new(mixc(nt, canton, col, lin("#3C3B6E")), b.inputs["Base Color"])
        b.inputs["Roughness"].default_value = 0.75
        b.inputs["Sheen Weight"].default_value = 0.4
        return m

    def red_flag():
        m, nt, b = _bsdf_mat("Awana flag")
        N, L = nt.nodes, nt.links
        tc = N.new("ShaderNodeTexCoord")
        sep = N.new("ShaderNodeSeparateXYZ"); L.new(tc.outputs["UV"], sep.inputs[0])
        fringe = math_node(nt, "MAXIMUM", math_node(nt, "LESS_THAN", sep.outputs["Y"], 0.035),
                           math_node(nt, "GREATER_THAN", sep.outputs["X"], 0.94))
        L.new(mixc(nt, fringe, lin("#C8202A"), lin("#E9B730")), b.inputs["Base Color"])
        b.inputs["Roughness"].default_value = 0.6
        b.inputs["Sheen Weight"].default_value = 0.5
        return m
    flag("US flag", 2.35, -1.85, us_flag)
    flag("Awana flag", 2.45, -0.66, red_flag)

    # the drum kit and black music stands, back left
    drum_white = mat("Drum head", "#E9E6DE", 0.5)
    drum_shell = mat("Drum shell", "#3A3D44", 0.35, coat=0.6)
    cym = mat("Cymbal", "#C9A24A", 0.25, metal=1.0)
    bm = bmesh.new()
    dx, dy = P(0.35, -2.35)
    bm_cyl(bm, (dx, dy, Z0 + 0.29), 0.28, 0.40, "X", 1, seg=28)
    bm_cyl(bm, (dx + 0.205, dy, Z0 + 0.29), 0.27, 0.01, "X", 0, seg=28)
    for (ox, oy, r, z) in ((0.35, 0.35, 0.18, 0.62), (0.15, -0.30, 0.15, 0.78), (0.15, 0.05, 0.14, 0.80),
                           (-0.2, 0.55, 0.2, 0.5)):
        bm_cyl(bm, (dx + ox, dy + oy, Z0 + z), r, 0.16, "Z", 1, seg=24)
        bm_cyl(bm, (dx + ox, dy + oy, Z0 + z + 0.082), r, 0.006, "Z", 0, seg=24)
    for (ox, oy, z, r) in ((0.25, -0.65, 1.15, 0.22), (0.05, 0.75, 1.25, 0.24), (0.4, 0.62, 0.95, 0.18)):
        bm_cyl(bm, (dx + ox, dy + oy, Z0 + z / 2), 0.008, z, "Z", 3, seg=8)
        bm_cyl(bm, (dx + ox, dy + oy, Z0 + z), r, 0.01, "Z", 2, seg=28, r2=r * 0.15)
    for (wx, wy, h) in ((0.15, -2.65, 1.25), (1.25, -3.9, 1.2), (0.25, -5.4, 1.2), (0.9, -6.6, 1.2)):
        mx, my = P(wx, wy)
        bm_cyl(bm, (mx, my, Z0 + h / 2), 0.009, h, "Z", 3, seg=8)
        for k in range(3):
            a = k * 2 * math.pi / 3
            bm_box(bm, (mx + 0.12 * math.cos(a), my + 0.12 * math.sin(a), Z0 + 0.06), (0.24, 0.012, 0.012), 3,
                   Matrix.Rotation(a, 3, "Z") @ Matrix.Rotation(math.radians(25), 3, "Y"))
        bm_box(bm, (mx + 0.02, my, Z0 + h + 0.12), (0.03, 0.5, 0.34), 3, Matrix.Rotation(math.radians(-20), 3, "Y"))
    bm_obj("Drums and stands", bm, coll, [drum_white, drum_shell, cym, black])

    # the small carpeted box behind the gate, and the black lectern
    navy = mat("Box carpet", "#22293A", 0.95)
    bm = bmesh.new()
    bx, by = P(-0.70, 0.30)
    bm_box(bm, (bx, by, Z0 + 0.1), (0.6, 1.1, 0.2), 0)
    bm_box(bm, (bx - 0.15, by, Z0 + 0.3), (0.3, 1.1, 0.2), 0)
    bm_obj("Carpet box", bm, coll, [navy])
    bm = bmesh.new()
    lx, ly = P(-0.55, 2.5)
    bm_box(bm, (lx, ly, Z0 + 1.0), (0.42, 0.72, 0.03), 0, Matrix.Rotation(math.radians(-14), 3, "Y"))
    for sy in (-1, 1):
        bm_box(bm, (lx - 0.05, ly + sy * 0.22, Z0 + 0.5), (0.04, 0.04, 1.0), 0)
    bm_box(bm, (lx - 0.05, ly, Z0 + 0.03), (0.4, 0.6, 0.03), 0)
    bm_box(bm, (lx - 0.05, ly, Z0 + 0.5), (0.012, 0.6, 0.012), 0, Matrix.Rotation(math.radians(55), 3, "X"))
    bm_box(bm, (lx - 0.05, ly, Z0 + 0.5), (0.012, 0.6, 0.012), 0, Matrix.Rotation(math.radians(-55), 3, "X"))
    bm_obj("Lectern", bm, coll, [black])

    # stage right: the checkered cloth draped over a low box and hanging
    # behind it, and the big blue screen on its tripod
    def checker_mat():
        m, nt, b = _bsdf_mat("Checkered cloth")
        N, L = nt.nodes, nt.links
        ck = N.new("ShaderNodeTexChecker"); ck.inputs["Scale"].default_value = 1.0
        ck.inputs["Color1"].default_value = lin("#EFEFEC"); ck.inputs["Color2"].default_value = lin("#141416")
        tc = N.new("ShaderNodeTexCoord")
        mp = N.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (9.0, 9.0, 9.0)
        L.new(tc.outputs["Object"], mp.inputs["Vector"]); L.new(mp.outputs["Vector"], ck.inputs["Vector"])
        L.new(ck.outputs["Color"], b.inputs["Base Color"])
        b.inputs["Roughness"].default_value = 0.7
        b.inputs["Sheen Weight"].default_value = 0.3
        return m
    chk = checker_mat()
    bm = bmesh.new()
    cx0, cx1 = 1.25, 1.85                 # room-local x (behind the red table)
    cy0, cy1 = 2.9, 5.0
    bm_box(bm, ((cx0 + cx1) / 2, (cy0 + cy1) / 2, Z0 + 0.32), (cx1 - cx0, cy1 - cy0, 0.64), 0)
    bm_box(bm, (cx0 - 0.05, (cy0 + cy1) / 2 + 0.2, Z0 + 0.45), (0.04, cy1 - cy0 + 0.4, 0.9), 0)
    o = bm_obj("Checkered cloth", bm, coll, [chk])
    o.modifiers.new("Sub", "SUBSURF").levels = 3
    o.modifiers["Sub"].subdivision_type = "SIMPLE"
    tex = bpy.data.textures.new("Cloth folds", "CLOUDS"); tex.noise_scale = 0.12
    d = o.modifiers.new("Folds", "DISPLACE"); d.texture = tex; d.strength = 0.03; d.mid_level = 0.5
    # the blue screen: a plain blue picture with a white foot, black frame, tripod
    blue = emit_mat("Blue picture", "#0A47E0", 1.0)
    bx, by = 0.75, 4.0
    sw, z0_, z1_ = 2.1, Z0 + 0.62, Z0 + 1.88
    o = uv_quad("Blue screen picture", [(0.012, -sw / 2, z0_ + 0.14), (0.012, sw / 2, z0_ + 0.14),
                                         (0.012, sw / 2, z1_ - 0.04), (0.012, -sw / 2, z1_ - 0.04)], coll, blue)
    o.location = (bx, by, 0); o.rotation_euler = (0, 0, math.radians(8))
    bm = bmesh.new()
    bm_box(bm, (0, 0, (z0_ + z1_) / 2), (0.02, sw + 0.06, z1_ - z0_ + 0.04), 0)
    bm_box(bm, (0.006, 0, z0_ + 0.07), (0.02, sw, 0.13), 1)
    bm_cyl(bm, (-0.05, 0, (Z0 + z1_) / 2), 0.015, z1_ - Z0, "Z", 0, seg=8)
    for k in range(3):
        a = k * 2 * math.pi / 3 + 0.5
        bm_box(bm, (-0.05 + 0.25 * math.cos(a), 0.25 * math.sin(a), Z0 + 0.22), (0.5, 0.015, 0.015), 0,
               Matrix.Rotation(a, 3, "Z") @ Matrix.Rotation(math.radians(55), 3, "Y"))
    o = bm_obj("Blue screen", bm, coll, [black, mat("Screen white", "#ECEEF2", 0.5, emit=0.4)])
    o.location = (bx, by, 0); o.rotation_euler = (0, 0, math.radians(8))
    # light probes, so the shiny track and the chrome mirror the room
    for name, (xw, yw, zw), rad in (("Room reflections", (2.0, 0.3, 1.6), 9.0),
                                    ("Run-out reflections", (8.5, 0.3, 1.0), 7.0)):
        pr = bpy.data.lightprobes.new(name, "SPHERE")
        pr.influence_distance = rad
        po = link(bpy.data.objects.new(name, pr), coll)
        po.location = w2l(xw, yw, zw)


def build_track(coll):
    S = {}
    alu = ribbed_alu("Ribbed aluminium")
    alu_edge = mat("Aluminium edge", "#E4E6E8", 0.1, metal=1.0)
    steel = mat("Stand", "#C4C8CC", 0.2, metal=1.0)
    foot = wood_mat("Stand foot", "#D9B98A", "#BF9862", rough=0.6)
    xs = [X_START + i * 0.02 for i in range(int((X_END - X_START) / 0.02) + 1)]

    def sweep(name, polys, material):
        verts, faces = [], []
        for poly in polys:
            n = len(poly); base = len(verts)
            for x in xs:
                nrm = Vector((-tslope(x), 0, 1)).normalized()
                p0 = Vector((x, 0, tz(x)))
                for (y, h) in poly:
                    verts.append(tuple(p0 + Vector((0, y, 0)) + nrm * h))
            for i in range(len(xs) - 1):
                a, b = base + i * n, base + (i + 1) * n
                for k in range(n):
                    k2 = (k + 1) % n
                    faces.append((a + k, b + k, b + k2, a + k2))
            faces.append(tuple(base + k for k in range(n)))
            last = base + (len(xs) - 1) * n
            faces.append(tuple(last + k for k in reversed(range(n))))
        o = mesh_obj(name, verts, faces, coll, [material])
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(o.data); bm.free()
        for poly in o.data.polygons:
            poly.use_smooth = False
        return o

    def rect(y0, y1, h0, h1):
        return [(y0, h0), (y1, h0), (y1, h1), (y0, h1)]
    sweep("Track bed", [rect(-TRACK_HW, TRACK_HW, -0.012, 0.0)], alu)
    sweep("Lane guides", [rect(y - GUIDE_W / 2, y + GUIDE_W / 2, -0.001, GUIDE_H) for y in LANES_Y], alu)
    sweep("Side lips", [rect(-TRACK_HW - 0.004, -TRACK_HW, -0.012, 0.012),
                        rect(TRACK_HW, TRACK_HW + 0.004, -0.012, 0.012)], alu_edge)
    # stands: a slim metal post and a cross bar under the track, on a small
    # wooden foot, down to whatever is below (stage, floor)
    bm = bmesh.new(); bmf = bmesh.new()
    for x in (2.55, 3.85, 6.0, 7.9):
        z = tz(x) - 0.012
        g = ground(x, 0.1)
        bm_box(bm, (x, 0.1, (z + g) / 2), (0.022, 0.022, z - g), 0)
        bm_box(bm, (x, 0, z - 0.012), (0.03, 2 * TRACK_HW - 0.02, 0.02), 0)
        bm_box(bmf, (x, 0.1, g + 0.012), (0.16, 0.12, 0.024), 0)
    # the gate stand at the back of the stage: two posts with an easel brace
    # to the front, on a wooden base board
    xg0, xg1 = 0.18, 0.70
    zt = tz(xg0) - 0.014
    for sy in (-1, 1):
        bm_box(bm, (xg0, sy * (TRACK_HW - 0.03), (zt + STAGE_H) / 2), (0.025, 0.025, zt - STAGE_H), 0)
        p0 = Vector((xg0, sy * (TRACK_HW - 0.03), zt - 0.25)); p1 = Vector((xg1, sy * (TRACK_HW - 0.03), STAGE_H))
        mid, d = (p0 + p1) / 2, (p1 - p0)
        bm_box(bm, tuple(mid), (0.018, 0.018, d.length), 0, Matrix.Rotation(math.atan2(d.x, d.z), 3, "Y"))
    bm_box(bm, (xg0, 0, zt - 0.01), (0.03, 2 * TRACK_HW, 0.02), 0)
    bm_box(bm, (xg0, 0, STAGE_H + 0.45), (0.022, 2 * TRACK_HW - 0.04, 0.022), 0)
    bm_box(bmf, ((xg0 + xg1) / 2, 0, STAGE_H + 0.012), (xg1 - xg0 + 0.3, 2 * TRACK_HW + 0.1, 0.024), 0)
    # behind the cars: a short post holding the track's end
    zt = tz(X_START + 0.05) - 0.014
    bm_box(bm, (X_START + 0.06, 0, (zt + STAGE_H) / 2), (0.022, 0.022, zt - STAGE_H), 0)
    bm_obj("Track stands", bm, coll, [steel])
    bm_obj("Stand feet", bmf, coll, [foot])
    # the start gate: the release mechanism sits under the track; a pin
    # comes up through each lane in front of the car's nose
    gate_m = mat("Gate", "#B8BCC0", 0.25, metal=1.0)
    bm = bmesh.new()
    xg = 0.012
    zg = tz(xg)
    bm_box(bm, (xg - 0.03, 0, zg - 0.03), (0.07, 2 * TRACK_HW - 0.04, 0.03), 0)
    bm_obj("Start gate", bm, coll, [gate_m])
    pin_me = bpy.data.meshes.new("Pin")
    bm = bmesh.new(); bm_cyl(bm, (0, 0, 0), 0.003, 0.05, "Z", 0, seg=10); bm.to_mesh(pin_me); bm.free()
    pin_me.materials.append(mat("Pin", "#D9DBDE", 0.2, metal=1.0))
    S["pins"] = []
    for y in LANES_Y:
        p = link(bpy.data.objects.new("Start pin", pin_me), coll)
        p.location = (xg, y + 0.014, zg + 0.012)
        S["pins"].append(p)
    return S


# ============================================================ the car board ===
# room-local: the red table stands at the front of the stage, right of the track
BOARD = dict(x0=2.50, yc=1.95, slots=24, pitch=0.092)


def build_board(coll, M):
    """The red table and the black two-row numbered car board, cars parked."""
    red = mat("Red tablecloth", "#62000D", 0.7)
    red.node_tree.nodes["Principled BSDF"].inputs["Sheen Weight"].default_value = 0.05
    black = mat("Board black", "#141416", 0.55)
    white = mat("Number white", "#F2F2EE", 0.5, emit=0.25)
    tx, ty, tz_ = BOARD["x0"] - 0.38, BOARD["yc"], STAGE_H + 0.74
    # tablecloth: a box with soft fold displacement down the sides
    bm = bmesh.new()
    bm_box(bm, (tx, ty, (STAGE_H + tz_) / 2 + 0.002), (0.80, 2.32, tz_ - STAGE_H), 0)
    o = bm_obj("Tablecloth", bm, coll, [red])
    o.modifiers.new("Sub", "SUBSURF").levels = 4
    o.modifiers["Sub"].subdivision_type = "SIMPLE"
    tex = bpy.data.textures.new("Folds", "CLOUDS"); tex.noise_scale = 0.18
    d = o.modifiers.new("Folds", "DISPLACE"); d.texture = tex; d.strength = 0.025; d.mid_level = 0.5
    # the board: front tier and raised back tier
    n, pitch = BOARD["slots"], BOARD["pitch"]
    L = n * pitch + 0.06
    zf, zb = tz_ + 0.03, tz_ + 0.075
    xf0, xf1 = BOARD["x0"] - 0.005, BOARD["x0"] - 0.225      # front row (x0 = its front edge)
    xb0, xb1 = xf1, xf1 - 0.23
    bm = bmesh.new()
    bm_box(bm, ((xf0 + xf1) / 2, ty, (tz_ + zf) / 2), (xf0 - xf1, L, zf - tz_), 0)
    bm_box(bm, ((xb0 + xb1) / 2, ty, (tz_ + zb) / 2), (xb0 - xb1, L, zb - tz_), 0)
    y0 = ty - n * pitch / 2
    for i in range(n + 1):
        y = y0 + i * pitch
        bm_box(bm, ((xf0 + xf1) / 2, y, zf + 0.004), (xf0 - xf1 - 0.01, 0.005, 0.008), 0)
        bm_box(bm, ((xb0 + xb1) / 2, y, zb + 0.004), (xb0 - xb1 - 0.01, 0.005, 0.008), 0)
    bm_obj("Car board", bm, coll, [black])
    font = load_font("PaytoneOne-Regular.ttf")
    for i in range(n):
        y = y0 + (i + 0.5) * pitch
        for row, (x, zc, num) in enumerate(((xf0 + 0.0006, (tz_ + zf) / 2, i + 1),
                                            (xb0 + 0.0006, zf + (zb - zf) / 2, n + i + 1))):
            t = text_obj(f"Slot {num}", str(num), font, 0.02, coll, white)
            t.location = (x, y, zc)
            t.rotation_euler = (math.pi / 2, 0, math.pi / 2)
    # parked cars: homemade, with a few grown-up builds among them
    rnd = random.Random(2026)
    kid_cols = ["#D9352E", "#2F64C8", "#F7C531", "#3E9E4F", "#EE7A22", "#7A4FB0", "#E86AA6", "#1DB6D9",
                "#F6F4EE", "#1A1A1C", "#8A5A2B", "#58BD79", "#C8202A", "#4C72B8"]
    grown = [("#0F2C55", None), ("#1A1A1C", "#C9CCD0"), ("#5B0F14", None), ("#E8E6E0", "#1A1A1C"),
             ("#2F5D3A", None), ("#B5121B", "#F6F4EE")]
    filled = 0
    cars = []
    gi = 0
    for row in range(2):
        for i in range(n):
            if rnd.random() > 0.74:
                continue
            y = y0 + (i + 0.5) * pitch
            xc = (xf0 + xf1) / 2 if row == 0 else (xb0 + xb1) / 2
            zc = zf if row == 0 else zb
            name = f"Board car {row}-{i}"
            if rnd.random() < 0.2 and gi < len(grown):
                col, st = grown[gi]; gi += 1
                paint = paint_mat(name + " paint", col, st, 0.0025, rough=0.12, coat=1.0)
                top = p_sleek(peak=rnd.uniform(0.018, 0.024), nose=0.005, tail=rnd.uniform(0.011, 0.016))
                c = build_car(name, coll, M, top, hw_taper, paint, ("weights",), rnd, tuned=True)
            else:
                kind = rnd.choice(["wedge", "wedge", "block", "bullet", "wood"])
                col = rnd.choice(kid_cols)
                stripe = rnd.choice([None, None, "#F6F4EE", "#1A1A1C", "#F7C531"])
                paint = (M["pine"] if kind == "wood" else
                         paint_mat(name + " paint", col, stripe, 0.004, rough=rnd.uniform(0.3, 0.6)))
                top = {"wedge": p_wedge(rnd.uniform(0.026, 0.032), rnd.uniform(0.006, 0.012)),
                       "block": p_block(rnd.uniform(0.02, 0.03)),
                       "bullet": p_bullet(rnd.uniform(0.022, 0.03)),
                       "wood": p_wedge(0.03, 0.01)}[kind]
                extras = rnd.choice([(), ("dots",), ("squares",), ("driver",), ("spoiler",), ("dots", "driver")])
                c = build_car(name, coll, M, top, hw_plain, paint, extras, rnd)
            c.root.location = (xc, y, zc)
            c.root.rotation_euler = (0, 0, rnd.uniform(-0.04, 0.04))
            cars.append(c)
            filled += 1
    print(f"{PRE} car board: {filled} cars parked", flush=True)
    return dict(y0=y0, y1=y0 + n * pitch, xf=(xf0 + xf1) / 2, zf=zf)


# =============================================================== the race ===
G = 9.81
SLOMO = 0.55          # the race plays at 55 % speed: a gentle slow motion
RACERS = [  # lane, colour, shape, extras, rolling resistance
    ("Blue wedge", "#2F64C8", "wedge", ("dots",), 0.020),
    ("Green block", "#3E9E4F", "block", ("squares", "driver"), 0.023),
    ("Yellow bullet", "#F7C531", "bullet", (), 0.021),
    ("Red grown-up build", "#B5121B", "sleek", ("weights",), 0.017),
]
S_REST = -(CAR_L / 2 + 0.008)


def simulate(mu, drag=0.012):
    """s (arclength, m) of a car for every 30 fps frame: gravity along the
    slope, rolling resistance and a little air drag; brakes at the end."""
    out = {}
    s, v = S_REST, 0.0
    dt = 1.0 / FPS * SLOMO / 8
    for f in range(1, F_3D + 2):
        if f > T["pins"]:
            for _ in range(8):
                th = track_pitch(s)
                a = G * (math.sin(th) - mu * math.cos(th)) - drag * v * v
                if s2x(s) > X_END - 3.8:      # the run-out's brake (the soft stop at the end)
                    a -= 7.5
                v = max(0.0, v + a * dt)
                s += v * dt
        out[f] = s
    return out


def build_racers(coll, M):
    cars = []
    for i, (name, col, kind, extras, mu) in enumerate(RACERS):
        tuned = kind == "sleek"
        paint = paint_mat(name + " paint", col, "#F6F4EE" if kind == "bullet" else None, 0.004,
                          rough=0.12 if tuned else 0.38, coat=1.0 if tuned else 0.0)
        top = {"wedge": p_wedge(0.03, 0.008), "block": p_block(0.026), "bullet": p_bullet(0.027),
               "sleek": p_sleek()}[kind]
        c = build_car(name, coll, M, top, hw_taper if tuned else hw_plain, paint, extras,
                      random.Random(40 + i), tuned=tuned)
        c.lane = LANES_Y[i]
        c.s = simulate(mu)
        cars.append(c)
    return cars


def animate_race(S, cars):
    for f in range(1, F_3D + 1):
        for c in cars:
            s = c.s[f]
            K(c.root, "location", f, track_point(s, c.lane, 0.0))
            K(c.root, "rotation_euler", f, Euler((0.0, track_pitch(s), 0.0)))
            for w in c.wheels:
                K(w, "rotation_euler", f, Euler((0.0, (s - S_REST) / WHEEL_R, 0.0)))
        for p in S["pins"]:
            K(p, "location", f, (p.location.x, p.location.y,
                                 tz(p.location.x) + 0.012 - 0.04 * smooth(ramp(f, T["pins"] - 1, T["pins"] + 3))))


# =============================================================== the camera ===
def smax(a, b, k):
    """Smooth maximum of a and b (rounded over a width of about k)."""
    return (a + b + math.sqrt((a - b) ** 2 + k * k)) / 2


def smin(a, b, k):
    return -smax(-a, -b, k)


# the camera's tuning, by shot (world metres; lens in mm)
SHOT1 = dict(loc0=CAM0, tgt0=Vector((CAM0.x - 6.0, CAM0.y + 0.05, CAM0.z - 0.04)), lens0=17.0,
             loc1=Vector((1.85, 0.36, 1.80)), lens1=40.0)
SHOT2 = dict(side=0.32, up=(0.18, 0.22), s_min=0.95, ahead=(0.95, 1.05), lens=(28.0, 40.0), s_max=11.6)
SHOT3 = dict(back=0.95, up=0.26, look=(0.95, 0.70), lens=35.0)


def cam_state(f, cars, board):
    """(location, target, lens mm, f-stop) for frame f: three calm shots."""
    if f < T["race"]:
        # 1: from where the photo was taken (on the floor in front of the
        # steps, the whole room in view), a slow, gentle push up along the
        # track to the four cars waiting at the gate
        t = ease_io(ramp(f, 1, T["race"] + 12))
        car = track_point(S_REST, 0.0, 0.03)
        loc = SHOT1["loc0"].lerp(SHOT1["loc1"], t)
        tgt = SHOT1["tgt0"].lerp(car, ease_io(ramp(f, 1, T["race"] - 10)))
        return loc, tgt, lerp(SHOT1["lens0"], SHOT1["lens1"], t), lerp(8.0, 2.8, t)
    if f < T["board"]:
        # 2: down the track ahead of the cars, a little to their right,
        # looking back up the lanes at them: the gate, the screen, the
        # ceiling and the flags stay behind them. The camera keeps rolling
        # back as they come, closing in a little, so they grow, never shrink.
        lead = max(cars, key=lambda c: c.s[min(f, F_3D)])
        sl = lead.s[min(f, F_3D)]
        ahead = lerp(*SHOT2["ahead"], ease_io(ramp(f, T["pins"], T["board"])))
        sc = smin(smax(SHOT2["s_min"], sl + ahead, 0.5), SHOT2["s_max"], 0.8)
        k = ease_io(ramp(f, T["pins"] + 60, T["board"]))
        loc = track_point(sc, SHOT2["side"], lerp(*SHOT2["up"], k))
        mean = sum(c.s[min(f, F_3D)] for c in cars) / len(cars)
        # aim a little above the pack, more so late on, so the stage, the
        # flags and the screen stay in the picture behind them
        tgt = track_point(min(mean, sl) - 0.6 * k, -0.02, lerp(0.10, 0.14, k))
        return loc, tgt, lerp(*SHOT2["lens"], ease_io(ramp(f, T["race"], T["board"]))), 3.2
    # 3: a slow sideways dolly along the car board on the red table, looking
    # across it so the red cloth, the checkered cloth and the blue screen
    # stay behind
    t = ramp(f, T["board"], F_3D)
    y = lerp(board["y0"] + 0.15, board["y0"] + 1.25, t)
    loc = l2w(board["xf"] + SHOT3["back"], y, board["zf"] + SHOT3["up"])
    tgt = l2w(board["xf"] - 0.10, y + SHOT3["look"][1], board["zf"] + 0.02)
    return loc, tgt, SHOT3["lens"], 3.2


def build_camera(sc, coll, cars, board):
    cd = bpy.data.cameras.new("Camera")
    cd.sensor_fit = "HORIZONTAL"; cd.sensor_width = 36.0
    cd.clip_start = 0.005; cd.clip_end = 60.0
    cd.dof.use_dof = True; cd.dof.aperture_blades = 7
    cam = link(bpy.data.objects.new("Camera", cd), coll)
    cam.rotation_mode = "QUATERNION"
    sc.camera = cam
    prev = None
    for f in range(1, F_3D + 1):
        loc, tgt, lens, fs = cam_state(f, cars, board)
        q = look_quat(loc, tgt)
        if prev is not None and prev.dot(q) < 0:
            q = -q
        prev = q
        K(cam, "location", f, loc)
        K(cam, "rotation_quaternion", f, q)
        K(cd, "lens", f, lens)
        K(cd.dof, "aperture_fstop", f, fs)
        # focus on the subject: the waiting cars, the nearest racer, the front row
        if f < T["race"]:
            foc = (track_point(S_REST, 0, 0.02) - loc).length
        elif f < T["board"]:
            foc = min((track_point(c.s[f], c.lane, 0.02) - loc).length for c in cars)
            foc = max(foc, 0.15)
        else:
            foc = (l2w(board["xf"], w2l(loc.x, loc.y).y + 0.25, board["zf"] + 0.02) - loc).length
        K(cd.dof, "focus_distance", f, foc)
    return cam


# ================================================================= render ===
def setup_render(sc, mode):
    r = sc.render
    r.resolution_x, r.resolution_y = 1920, 1080
    r.resolution_percentage = 100 if mode == "final" else int(arg("--pct", 50))
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Base Contrast"
    sc.view_settings.exposure = float(arg("--exposure", -0.8))
    r.use_motion_blur = True
    r.motion_blur_shutter = 0.5
    r.motion_blur_position = "START"
    if mode == "final":
        r.engine = "CYCLES"
        cy = sc.cycles
        cy.samples = 256; cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.012
        cy.use_denoising = True; cy.denoiser = "OPENIMAGEDENOISE"
        cy.max_bounces = 8; cy.glossy_bounces = 4
        cy.caustics_reflective = False; cy.caustics_refractive = False
        cy.sample_clamp_indirect = 8.0
        r.use_persistent_data = True
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            for dev_type in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
                try:
                    prefs.compute_device_type = dev_type
                    prefs.get_devices()
                    gpus = [d for d in prefs.devices if d.type == dev_type]
                    if gpus:
                        for d in prefs.devices:
                            d.use = d.type == dev_type
                        cy.device = "GPU"
                        print(f"{PRE} rendering on {dev_type}: {', '.join(d.name for d in gpus)}")
                        break
                except Exception:
                    continue
        except Exception as e:
            print(f"{PRE} GPU setup skipped: {e}")
    else:
        r.engine = "BLENDER_EEVEE"
        ee = sc.eevee
        ee.taa_render_samples = int(arg("--samples", 16))
        ee.use_raytracing = True
        try:
            ee.ray_tracing_method = str(arg("--rt", "SCREEN"))
            ee.gi_cubemap_resolution = "1024"
            ee.ray_tracing_options.resolution_scale = "1"
            ee.ray_tracing_options.screen_trace_quality = 1.0
            ee.ray_tracing_options.use_denoise = True
        except Exception:
            pass
        ee.motion_blur_steps = 1
        ee.shadow_resolution_scale = 0.5
        ee.use_shadows = True
    r.image_settings.media_type = "IMAGE"
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGB"
    r.image_settings.compression = 15
    r.use_overwrite = False
    r.use_placeholder = True


# ============================================================ the cards ===
def make_cards(card_dir):
    """Run cards.mjs (Node + Playwright + Chrome) to lay out the flat cards."""
    node = shutil.which("node") or "node"
    print(f"{PRE} laying out the cards with Chrome", flush=True)
    subprocess.run([node, os.path.join(HERE, "cards.mjs"), card_dir], check=True, cwd=HERE)


def composite(frames_3d, card_dir, out_dir, res):
    """Blender's video editor lays the cards over the 3D frames and writes
    the finished frames as PNGs. Timings are the kit's: 'settle' to land,
    'exit' to leave, 'wipe' for the colour field."""
    k = KR
    enc = bpy.data.scenes.new("Composite")
    enc.render.fps = RATE
    enc.render.resolution_x, enc.render.resolution_y = res
    enc.render.resolution_percentage = 100
    enc.view_settings.view_transform = "Standard"
    enc.frame_start, enc.frame_end = 1, F_END * k
    ed = enc.sequence_editor_create()
    files = sorted(f for f in os.listdir(frames_3d) if f.endswith(".png") and
                   os.path.getsize(os.path.join(frames_3d, f)) > 0)
    st = ed.strips.new_image(name="3D", filepath=os.path.join(frames_3d, files[0]), channel=1, frame_start=1,
                             fit_method="FIT")
    for f in files[1:]:
        st.elements.append(f)
    px = res[0] / 1920.0

    def card(name, ch, f0, f1):
        s = ed.strips.new_image(name=name, filepath=os.path.join(card_dir, name + ".png"), channel=ch,
                                frame_start=f0 * k, fit_method="FIT")
        s.frame_final_duration = (f1 - f0) * k + 1
        s.blend_type = "ALPHA_OVER"
        return s

    def keys(s, f0, f1, fn):
        """fn(f30) -> (alpha, offset_y px at 1920) baked every frame f0..f1."""
        for f in range(f0 * k, f1 * k + 1):
            a, dy = fn(f / k)
            s.blend_alpha = a
            s.keyframe_insert("blend_alpha", frame=f)
            s.transform.offset_y = dy * px
            s.transform.keyframe_insert("offset_y", frame=f)

    settle, exit_ = CURVE["settle"], CURVE["exit"]

    def land_leave(f_in, f_out, rise=36, n_in=16, n_out=8):
        def fn(f):
            if f < f_in + n_in:
                t = settle(ramp(f, f_in, f_in + n_in))
                return min(1.0, ramp(f, f_in, f_in + 6)), -rise * (1 - t)
            if f >= f_out:
                t = exit_(ramp(f, f_out, f_out + n_out))
                return 1 - t, 0.0
            return 1.0, 0.0
        return fn
    c1 = card("card1", 2, T["card1"][0], T["card1"][1] + 8)
    keys(c1, T["card1"][0], T["card1"][1] + 8, land_leave(*T["card1"]))
    c2 = card("card2a", 3, T["card2"][0], T["card2"][1] + 8)
    keys(c2, T["card2"][0], T["card2"][1] + 8, land_leave(*T["card2"]))
    c3 = card("card2b", 4, T["card2b"], T["card2"][1] + 8)
    keys(c3, T["card2b"], T["card2"][1] + 8, land_leave(T["card2b"], T["card2"][1], rise=24))
    wipe = CURVE["wipe"]
    w0, w1 = T["wipe"]
    bg = card("end_bg", 5, w0, F_END)
    keys(bg, w0, w1 + 1, lambda f: (1.0, -1080 * (1 - wipe(ramp(f, w0, w1)))))
    e0, e1 = T["end_text"]
    tx = card("end_text", 6, e0, F_END)
    keys(tx, e0, e1 + 1, lambda f: (min(1.0, ramp(f, e0, e0 + 8)), -28 * (1 - settle(ramp(f, e0, e1)))))
    # strip keys need LINEAR (the per-frame values are already eased)
    ad = enc.animation_data
    if ad and ad.action:
        for fc in anim_utils.action_get_channelbag_for_slot(ad.action, ad.action_slot).fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
    os.makedirs(out_dir, exist_ok=True)
    enc.render.image_settings.media_type = "IMAGE"
    enc.render.image_settings.file_format = "PNG"
    enc.render.image_settings.color_mode = "RGB"
    enc.render.filepath = os.path.join(out_dir, "frame_####")
    enc.render.use_overwrite = True
    with bpy.context.temp_override(scene=enc):
        bpy.ops.render.render(animation=True, scene=enc.name)
    bpy.data.scenes.remove(enc)
    print(f"{PRE} composited into {out_dir}", flush=True)


def encode_mp4(frames_dir, out_path, fps=RATE):
    """Glue the PNG frames into one H.264 .mp4 with Blender's own video
    editor (there is no ffmpeg on this PC). Silent: no audio track."""
    files = sorted(f for f in os.listdir(frames_dir) if f.endswith(".png"))
    files = [f for f in files if os.path.getsize(os.path.join(frames_dir, f)) > 0]
    enc = bpy.data.scenes.new("Encode")
    enc.render.fps = fps
    ed = enc.sequence_editor_create()
    st = ed.strips.new_image(name="frames", filepath=os.path.join(frames_dir, files[0]), channel=1, frame_start=1)
    for f in files[1:]:
        st.elements.append(f)
    enc.frame_start, enc.frame_end = 1, len(files)
    img = bpy.data.images.load(os.path.join(frames_dir, files[0]))
    enc.render.resolution_x, enc.render.resolution_y = img.size[0] // 2 * 2, img.size[1] // 2 * 2
    enc.render.resolution_percentage = 100
    bpy.data.images.remove(img)
    enc.view_settings.view_transform = "Standard"
    enc.render.image_settings.media_type = "VIDEO"
    enc.render.image_settings.file_format = "FFMPEG"
    ff = enc.render.ffmpeg
    ff.format = "MPEG4"; ff.codec = "H264"; ff.audio_codec = "NONE"
    ff.constant_rate_factor = "PERC_LOSSLESS"; ff.ffmpeg_preset = "BEST"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    enc.render.filepath = out_path
    enc.render.use_overwrite = True
    with bpy.context.temp_override(scene=enc):
        bpy.ops.render.render(animation=True, scene=enc.name)
    bpy.data.scenes.remove(enc)
    print(f"{PRE} video saved: {out_path}", flush=True)


# ================================================================== main ===
def build():
    t0 = time.time()
    sc = reset_scene()
    build_world(sc)
    M = car_assets()
    c_room = new_coll("Room")
    c_track = new_coll("Track and racers")
    c_board = new_coll("Car board")
    c_cam = new_coll("Camera")
    build_room(c_room)
    build_props(c_room)
    S = build_track(c_track)
    cars = build_racers(c_track, M)
    board = build_board(c_board, M)
    # the room and everything on the stage hang from one pivot: the room's
    # own frame, turned a little against the track (see ROOM_O, ROOM_YAW)
    pivot = link(bpy.data.objects.new("Room pivot", None), c_room)
    pivot.location = ROOM_O
    pivot.rotation_euler = (0.0, 0.0, ROOM_YAW)
    for c in (c_room, c_board):
        for o in c.objects:
            if o.parent is None and o is not pivot:
                o.parent = pivot
    print(f"{PRE} {time.time() - t0:6.1f}s built, animating", flush=True)
    animate_race(S, cars)
    build_camera(sc, c_cam, cars, board)
    flush()
    print(f"{PRE} {time.time() - t0:6.1f}s scene ready", flush=True)
    return sc


def keep_awake():
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)
        except Exception:
            pass


def main():
    sc = build()
    mode = MODE if MODE in ("preview", "final", "stills") else "preview"
    setup_render(sc, mode)
    os.makedirs(OUT_DIR, exist_ok=True)
    blend = os.path.join(OUT_DIR, "Grand Prix.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend, relative_remap=False)
    print(f"{PRE} scene saved: {blend}")
    if MODE == "stills":
        frames = [int(f) for f in str(arg("--frames", "60,200,300,400")).split(",")]
        sc.render.use_overwrite = True; sc.render.use_placeholder = False
        for f in frames:
            t1 = time.time()
            sc.frame_set(f * KR)
            sc.render.filepath = os.path.join(OUT_DIR, "stills", f"frame_{f:04d}.png")
            bpy.ops.render.render(write_still=True)
            print(f"{PRE} still {f} done in {time.time() - t1:.1f}s", flush=True)
    elif MODE in ("preview", "final"):
        keep_awake()
        t_all = time.time()
        card_dir = os.path.join(OUT_DIR, "cards")
        make_cards(card_dir)
        d3 = os.path.join(OUT_DIR, f"frames_{MODE}_3d")
        os.makedirs(d3, exist_ok=True)
        for f in os.listdir(d3):
            fp = os.path.join(d3, f)
            if f.endswith(".png") and os.path.getsize(fp) == 0:
                os.remove(fp)
        sc.render.filepath = os.path.join(d3, "frame_####")
        t1 = time.time()
        bpy.ops.render.render(animation=True)
        print(f"{PRE} 3D frames rendered in {(time.time() - t1) / 60:.1f} min", flush=True)
        res = (sc.render.resolution_x * sc.render.resolution_percentage // 100,
               sc.render.resolution_y * sc.render.resolution_percentage // 100)
        dc = os.path.join(OUT_DIR, f"frames_{MODE}")
        composite(d3, card_dir, dc, res)
        name = "Grand Prix - PREVIEW.mp4" if MODE == "preview" else "Grand Prix.mp4"
        encode_mp4(dc, os.path.join(OUT_DIR, name), fps=RATE)
        if MODE == "preview":
            py = shutil.which("python") or shutil.which("py")
            if py:
                cmd = [py, os.path.join(HERE, "contact_sheet.py")]
                if arg("--ref"):
                    cmd += ["--ref", str(arg("--ref"))]
                subprocess.run(cmd, cwd=HERE)
        print(f"{PRE} all done in {(time.time() - t_all) / 60:.1f} min", flush=True)


if __name__ == "__main__":
    main()

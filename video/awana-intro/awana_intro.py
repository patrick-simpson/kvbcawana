"""
KVBC Awana Clubs - 15-second 3D intro  (Blender 5.2 LTS)
=========================================================

What this file does, in plain English
-------------------------------------
It is a recipe. Blender reads it top to bottom and BUILDS the whole 3D scene
from scratch (shapes, colors, lights, camera moves, timing), using the real
brand files in the repo's shared/brand folder. Then, if asked, it renders
the 450 frames (15 s x 30 fps) and glues them into an .mp4.

You normally don't run this directly - double-click one of the .bat files:
    1  Preview Awana Intro.bat   -> quick, small, rough video (minutes)
    2  Render Awana Intro.bat    -> full quality 1080p video (overnight)
    3  Open Awana Scene.bat      -> opens the scene in Blender to look around

The story (seconds)
-------------------
 0.0-0.6  The exact KVBC lobby welcome screen - flat, so the cut from the
          real lobby display is seamless.
 0.6-1.2  ...wait, it's 3D? Shapes swell, shadows appear.
 1.2-2.4  The camera dives at the little blue ring doodle (Cubbies) - it
          grows into a portal - while the words peel off the screen and
          whip past the lens. Through the ring: a floating sky world.
 2.4-5.0  The club characters flip up like dominoes as the camera swoops
          by. One blob tumbles past with a secret engraved on its back.
 5.0-6.5  KENNEBEC VALLEY BAPTIST CHURCH stands back up, letter by letter.
 6.5-8.1  "Awana Clubs" drops from the sky. Letter. By. Letter. SLAM.
          Shockwave: confetti doodles burst out, the characters get blown
          off their feet.
 8.7-9.3  The tagline pops back in.
 9.3-13   THE TRICK: everything has been floating at wildly different
          distances the whole time. The camera glides back into the one
          exact spot where it all lines up...
 12-15    "We're so glad you're here!" ... the world flattens back into the
          lobby screen it started as. (Bookends.)
"""

import bpy, bmesh, json, math, os, random, sys
from mathutils import Vector, Matrix, Euler
from bpy_extras import anim_utils

# ---------------------------------------------------------------- settings --
HERE = os.path.dirname(os.path.abspath(__file__))
# The brand kit is read straight from the repo's ONE canonical copy
# (shared/brand/) - nothing here duplicates it.
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
BRAND = os.path.join(REPO, "shared", "brand")
DIECUTS = os.path.join(HERE, "diecuts")      # made by tools/make_diecuts.py
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    if name in ARGS:
        i = ARGS.index(name)
        return ARGS[i + 1] if i + 1 < len(ARGS) and not ARGS[i + 1].startswith("--") else True
    return default


MODE = arg("--mode", "build")        # build | preview | final | stills
OUT_DIR = arg("--out", os.path.join(HERE, "output"))
FPS, F_END = 30, 450
# The frame rate the video is RENDERED at (--fps 60, owner 2026-10-28: "super
# smooth"). The timeline below stays in 30 fps frames; Blender's time
# stretching plays it RATE / 30 times as many frames, so at 60 fps every even
# frame is the 30 fps render's frame (frame 2N = frame N) and only the odd
# ones are new: frames_final_60 can start from frames_final copied over.
RATE = int(arg("--fps", FPS))
assert RATE % FPS == 0, "--fps must be a multiple of 30"
random.seed(2152)                      # 2 Tim 2:15 - same "random" every run

# ------------------------------------------------------------- the timeline --
# (frame numbers at 30 fps; 30 frames = 1 second)
T = dict(
    hold=18,            # opening: the flat lobby screen holds this long
    inflate=(18, 38),   # ...then the flat screen swells into 3D
    peel=34,            # the words start peeling off toward the camera
    dive=(30, 64),      # camera dives at, and through, the ring doodle
    dominoes=(80, 5),   # first character flips up at 80, then one every 5 frames
    church=(164, 1.0),  # church name stands back up, one letter per frame
    awana=(206, 3),     # first Awana letter starts falling, one every 3 frames
    fall=11,            # frames a letter takes to fall
    tagline=(262, 0.4),
    glide=(280, 392),   # the big anamorphic pull-back
    glad=360,           # "We're so glad you're here!" pops back in
    flatten=(392, 418), # 3D world flattens into the lobby screen
)
SLAM = T["awana"][0] + 9 * T["awana"][1] + T["fall"]   # the last letter lands

# ---------------------------------------------------------------- brand ---
with open(os.path.join(BRAND, "tokens.json")) as fh:
    TOK = json.load(fh)
CLUB = {k: v["primary"] for k, v in TOK["clubs"].items()}
HOUSE = TOK["house"]


def lin(hexstr, a=1.0):
    """'#B3D0E7' -> linear RGBA (what Blender's color sockets want)."""
    h = hexstr.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, a)


# ------------------------------------------------- the anamorphic layout ---
# The FINAL camera sits at the origin looking down +Y with a 50 mm lens.
# The lobby screen is 100 "u" wide x 56.25 u tall (from the website's CSS).
# Anything meant to land at lobby spot (ux, uy) can be placed at ANY depth,
# as long as it is scaled by depth / Y0 - from the final camera it looks
# identical. During the flight, though, those depths are wildly different.
LENS = 50.0
Y0 = 25.0                           # the "design plane" depth
U = (36.0 / LENS) * Y0 / 100.0      # one lobby u, in metres, at Y0  (=0.18)
H2 = 56.25 / 2


GLAD_U = 6.8        # welcome-line font size, in u (measured off the lobby screen)


def lobby(ux, uy, depth=Y0):
    s = depth / Y0
    return Vector(((ux - 50) * U * s, depth, (H2 - uy) * U * s)), s


# ------------------------------------------------ the measured lobby frame ---
# The lobby cuts straight into the first frame and back out of the last one
# (lobby/src/components/FlagshipIntro.jsx), so those frames must BE the lobby's
# flagship slide, to the pixel. tools/measure-lobby.mjs measures the real slide
# in a browser and writes lobby-layout.json; fit_layout() below then moves and
# sizes every flat piece until the final camera sees it exactly there. Without
# the file the hand-placed layout is used as it is (and the cut will show).
LAYOUT_FILE = os.path.join(HERE, "lobby-layout.json")
LAYOUT = None
if os.path.exists(LAYOUT_FILE):
    with open(LAYOUT_FILE, encoding="utf-8") as fh:
        LAYOUT = json.load(fh)
else:
    print("[awana] WARNING: no lobby-layout.json - run tools/measure-lobby.mjs, "
          "or the lobby's cut into this video will show")


# ============================================================= helpers ===
def channelbag(idb):
    ad = idb.animation_data
    return anim_utils.action_get_channelbag_for_slot(ad.action, ad.action_slot)


def key(target, attr, frame, value=None, ipo="BEZIER", ease="AUTO", index=-1):
    """Set target.attr = value and drop a keyframe with the given easing."""
    if value is not None:
        if index >= 0:
            getattr(target, attr)[index] = value
        else:
            setattr(target, attr, value)
    target.keyframe_insert(attr, frame=frame, index=index)
    idb = target.id_data
    path = target.path_from_id(attr)
    for fc in channelbag(idb).fcurves:
        if fc.data_path == path and (index < 0 or fc.array_index == index):
            for kp in fc.keyframe_points:
                if abs(kp.co.x - frame) < 0.01:
                    kp.interpolation = ipo
                    kp.easing = ease
                    if ipo == "BACK":
                        kp.back = 2.2


def link(obj, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj


def new_coll(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def mesh_bbox(me):
    xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


def set_origin(obj, where="bottom"):
    """Move a mesh object's pivot without moving the shape."""
    lo, hi = mesh_bbox(obj.data)
    if where == "bottom":
        p = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    else:
        p = (lo + hi) / 2
    obj.data.transform(Matrix.Translation(-p))
    obj.location = xform(obj) @ p


def import_svg(name, folder="doodles"):
    """Import an SVG from the brand kit; return its curve objects (unlinked)."""
    before = set(bpy.data.objects)
    bpy.ops.import_curve.svg(filepath=os.path.join(BRAND, folder, name))
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        if o.data and hasattr(o.data, "materials"):
            o.data.materials.clear()          # drop the importer's flat colour
    for c in list(bpy.data.collections):
        if c.name.startswith(name) and not c.objects:
            bpy.data.collections.remove(c)
    return new


def curve_points(obj):
    m = xform(obj)
    return [m @ p.co for s in obj.data.splines for p in s.bezier_points] + \
           [m @ Vector(p.co[:3]) for s in obj.data.splines for p in s.points]


def recentre_curves(objs):
    """Shift curve data so the group's bbox centre is at (0,0); return size."""
    pts = [p for o in objs for p in curve_points(o)]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), 0))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), 0))
    c = (lo + hi) / 2
    for o in objs:
        o.data.transform(Matrix.Translation(-c))
        o.location = (0, 0, 0)
    return hi - lo


def copy_xform(src, dst):
    dst.location = src.location.copy()
    dst.rotation_mode = src.rotation_mode
    dst.rotation_euler = src.rotation_euler.copy()
    dst.scale = src.scale.copy()


def xform(o):
    """The object's transform, computed directly (never stale)."""
    return Matrix.LocRotScale(o.location, o.rotation_euler, o.scale)


def bake_xform(o):
    """Push the object's move/turn/size into its mesh; object is then 'clean'."""
    o.data.transform(xform(o))
    o.location = (0, 0, 0); o.rotation_euler = (0, 0, 0); o.scale = (1, 1, 1)


def scale_curve(cu, k):
    """Resize curve data. (Blender also scales each point's 'radius', which
    would inflate bevels; reset it so bevel sizes mean what they say.)"""
    cu.transform(Matrix.Scale(k, 4))
    for sp in cu.splines:
        for p in sp.bezier_points:
            p.radius = 1.0
        for p in sp.points:
            p.radius = 1.0


def to_mesh(obj):
    """Bake a curve/text object into a real mesh object (same name/place)."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    new = bpy.data.objects.new(obj.name + "_m", me)
    copy_xform(obj, new)
    for c in obj.users_collection:
        c.objects.link(new)
    bpy.data.objects.remove(obj)
    return new


def split_curve_letters(obj):
    """Split one imported SVG curve into one curve per letter.
    A letter = an outline plus any holes inside it (the hole in 'a', 'b' ...)."""
    def bb(sp):
        xs = [p.co.x for p in sp.bezier_points]; ys = [p.co.y for p in sp.bezier_points]
        return min(xs), min(ys), max(xs), max(ys)
    def inside(pt, sp):
        """Is point pt inside the outline of spline sp? (ray casting)"""
        poly = [(q.co.x, q.co.y) for q in sp.bezier_points]
        x, y = pt; hit = False
        for i in range(len(poly)):
            (x1, y1), (x2, y2) = poly[i], poly[i - 1]
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                hit = not hit
        return hit
    sps = [(sp, bb(sp)) for sp in obj.data.splines if len(sp.bezier_points) > 1]
    area = lambda b: (b[2] - b[0]) * (b[3] - b[1])
    sps.sort(key=lambda t: -area(t[1]))
    letters = []          # [(outer_bbox, [splines], outer_spline)]
    for sp, b in sps:
        probe = (sp.bezier_points[0].co.x, sp.bezier_points[0].co.y)
        cands = [L for L in letters
                 if L[0][0] <= b[0] and b[2] <= L[0][2] and L[0][1] <= b[1] and b[3] <= L[0][3]
                 and inside(probe, L[2])]
        if cands:
            min(cands, key=lambda L: area(L[0]))[1].append(sp)   # a hole: tightest fit
        else:
            letters.append((b, [sp], sp))
    letters = [(b, g) for b, g, _ in letters]
    out = []
    for i, (b, group) in enumerate(sorted(letters, key=lambda t: t[0][0])):
        cu = obj.data.copy(); cu.splines.clear()
        for src in group:
            dst = cu.splines.new("BEZIER")
            dst.bezier_points.add(len(src.bezier_points) - 1)
            for a, z in zip(src.bezier_points, dst.bezier_points):
                z.co = a.co; z.handle_left_type = a.handle_left_type; z.handle_right_type = a.handle_right_type
                z.handle_left = a.handle_left; z.handle_right = a.handle_right
            dst.use_cyclic_u = src.use_cyclic_u
            dst.resolution_u = src.resolution_u
        o = bpy.data.objects.new(f"{obj.name} {i:02d}", cu)
        copy_xform(obj, o)
        for c in obj.users_collection:
            c.objects.link(o)
        out.append(o)
    bpy.data.objects.remove(obj)
    return out


def smooth(obj, angle=35):
    """Soft shading on curved surfaces, crisp on sharp corners."""
    me = obj.data
    for poly in me.polygons:
        poly.use_smooth = True
    try:
        me.set_sharp_from_angle(angle=math.radians(angle))
    except Exception:
        pass


# ======================================================== scene + control ===
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.name = "Awana Intro"
    sc.render.fps = RATE
    sc.render.frame_map_old, sc.render.frame_map_new = FPS, RATE
    sc.frame_start, sc.frame_end = 1, F_END * RATE // FPS
    sc.unit_settings.system = "METRIC"
    return sc


def build_control():
    """One shared 'control panel' every material reads:
       Flat  0 = lit 3D world ... 1 = flat lobby colours
       Glow  extra self-glow for doodles (kept at 0 in daylight)"""
    ng = bpy.data.node_groups.new("AwanaControl", "ShaderNodeTree")
    ng.interface.new_socket("Flat", in_out="OUTPUT", socket_type="NodeSocketFloat")
    ng.interface.new_socket("Glow", in_out="OUTPUT", socket_type="NodeSocketFloat")
    out = ng.nodes.new("NodeGroupOutput")
    flat = ng.nodes.new("ShaderNodeValue"); flat.name = "Flat"
    glow = ng.nodes.new("ShaderNodeValue"); glow.name = "Glow"
    ng.links.new(flat.outputs[0], out.inputs["Flat"])
    ng.links.new(glow.outputs[0], out.inputs["Glow"])
    f0, f1 = T["flatten"]
    i0, i1 = T["inflate"]
    key(flat.outputs[0], "default_value", 1, 1.0, "CONSTANT")
    key(flat.outputs[0], "default_value", i0, 1.0, "SINE", "EASE_IN_OUT")
    key(flat.outputs[0], "default_value", i1, 0.0, "CONSTANT")
    key(flat.outputs[0], "default_value", f0, 0.0, "SINE", "EASE_IN_OUT")
    key(flat.outputs[0], "default_value", f1, 1.0)
    glow.outputs[0].default_value = 0.0
    return ng


CTRL = None
MATS = {}


def material(name, color, rough=0.35, coat=0.0, sheen=0.0, sss=0.0,
             flat=None, glow=0.0, metallic=0.0, bump=0.0):
    """A lit 'premium toy plastic / clay' material that can melt into a flat
    brand colour when the Flat control goes to 1 (flat=None: never flattens)."""
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    nt = m.node_tree if m.node_tree else None
    if nt is None:
        m.use_nodes = True
        nt = m.node_tree
    nt.nodes.clear()
    N, L = nt.nodes, nt.links
    out = N.new("ShaderNodeOutputMaterial"); out.location = (900, 0)
    bsdf = N.new("ShaderNodeBsdfPrincipled"); bsdf.location = (300, 0)
    col = lin(color)
    bsdf.inputs["Base Color"].default_value = col
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Coat Weight"].default_value = coat
    bsdf.inputs["Coat Roughness"].default_value = 0.08
    bsdf.inputs["Sheen Weight"].default_value = sheen
    bsdf.inputs["Subsurface Weight"].default_value = sss
    bsdf.inputs["Subsurface Radius"].default_value = (0.4, 0.4, 0.4)
    bsdf.inputs["Subsurface Scale"].default_value = 0.05
    ctrl = N.new("ShaderNodeGroup"); ctrl.node_tree = CTRL; ctrl.location = (-300, -300)
    if glow > 0:
        mul = N.new("ShaderNodeMath"); mul.operation = "MULTIPLY"
        mul.inputs[1].default_value = glow
        L.new(ctrl.outputs["Glow"], mul.inputs[0])
        bsdf.inputs["Emission Color"].default_value = col
        L.new(mul.outputs[0], bsdf.inputs["Emission Strength"])
    if bump > 0:
        tex = N.new("ShaderNodeTexNoise"); tex.location = (-300, 200)
        tex.inputs["Scale"].default_value = 18.0
        tex.inputs["Detail"].default_value = 6.0
        b = N.new("ShaderNodeBump"); b.location = (0, 200)
        b.inputs["Strength"].default_value = bump
        b.inputs["Distance"].default_value = 0.02
        L.new(tex.outputs["Fac"], b.inputs["Height"])
        L.new(b.outputs["Normal"], bsdf.inputs["Normal"])
    if flat is None:
        L.new(bsdf.outputs[0], out.inputs["Surface"])
    else:
        em = N.new("ShaderNodeEmission"); em.location = (300, -350)
        em.inputs["Color"].default_value = lin(flat)
        mix = N.new("ShaderNodeMixShader"); mix.location = (650, 0)
        L.new(ctrl.outputs["Flat"], mix.inputs[0])
        L.new(bsdf.outputs[0], mix.inputs[1])
        L.new(em.outputs[0], mix.inputs[2])
        L.new(mix.outputs[0], out.inputs["Surface"])
    MATS[name] = m
    return m


def image_material(name, path):
    """Front of a die-cut character sticker: the real artwork, satin print."""
    m = bpy.data.materials.new(name)
    if not m.node_tree:
        m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear(); N, L = nt.nodes, nt.links
    out = N.new("ShaderNodeOutputMaterial")
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    img = N.new("ShaderNodeTexImage")
    img.image = bpy.data.images.load(path, check_existing=True)
    img.interpolation = "Cubic"
    img.extension = "CLIP"
    tc = N.new("ShaderNodeTexCoord")
    mp = N.new("ShaderNodeMapping")
    L.new(tc.outputs["Object"], mp.inputs["Vector"])
    L.new(mp.outputs["Vector"], img.inputs["Vector"])
    L.new(img.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.42
    bsdf.inputs["Coat Weight"].default_value = 0.35
    bsdf.inputs["Coat Roughness"].default_value = 0.12
    L.new(bsdf.outputs[0], out.inputs["Surface"])
    return m, mp


# ================================================================= world ===
def build_world(sc):
    """What the camera sees behind everything: the exact lobby sky blue.
       What the scene is LIT by: a soft sky-tinted dome (separate, so the
       background stays the exact brand colour)."""
    w = bpy.data.worlds.new("Awana Sky"); sc.world = w
    if not w.node_tree:
        w.use_nodes = True
    nt = w.node_tree; nt.nodes.clear(); N, L = nt.nodes, nt.links
    out = N.new("ShaderNodeOutputWorld")
    lp = N.new("ShaderNodeLightPath")
    seen = N.new("ShaderNodeBackground"); seen.name = "Seen"
    lit = N.new("ShaderNodeBackground"); lit.name = "Lit"
    mix = N.new("ShaderNodeMixShader")
    L.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
    L.new(lit.outputs[0], mix.inputs[1])
    L.new(seen.outputs[0], mix.inputs[2])
    L.new(mix.outputs[0], out.inputs["Surface"])
    # a gentle top-to-bottom gradient for the lighting dome
    tc = N.new("ShaderNodeTexCoord")
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(tc.outputs["Generated"], sep.inputs[0])
    ramp = N.new("ShaderNodeValToRGB")
    L.new(sep.outputs["Z"], ramp.inputs[0])
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = lin("#F2E3D3")   # warm bounce from below
    ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[1].color = lin("#CFE7FA")   # cool sky from above
    L.new(ramp.outputs["Color"], lit.inputs["Color"])
    seen.inputs["Color"].default_value = lin(HOUSE["sky"])
    lit.inputs["Strength"].default_value = 0.62
    return w


def build_lights(sc):
    def sun(name, rot, strength, color, angle):
        d = bpy.data.lights.new(name, "SUN")
        d.energy = strength; d.color = color[:3]; d.angle = math.radians(angle)
        o = link(bpy.data.objects.new(name, d))
        o.rotation_euler = Euler([math.radians(a) for a in rot])
        return d
    key_l = sun("Key Sun", (48, 0, -28), 3.3, lin("#FFF4E6"), 9)
    rim_l = sun("Rim Sun", (-62, 0, -20), 1.6, lin("#E8F1FF"), 4)
    fill = sun("Fill Sun", (75, 0, 70), 0.35, lin("#FFE3C9"), 25)


# ================================================================ camera ===
def build_camera(sc, ring):
    """A camera on a rig that flies a hand-tuned path, always aiming at a
    moving target. A child 'shake' empty adds the slam's camera shake.
    `ring` = where the little blue ring doodle sits (the dive target)."""
    rig = link(bpy.data.objects.new("CamRig", None))
    aim = link(bpy.data.objects.new("CamAim", None))
    aim_shake = link(bpy.data.objects.new("CamAimShake", None)); aim_shake.parent = aim
    cd = bpy.data.cameras.new("Cam")
    cam = link(bpy.data.objects.new("Cam", cd)); cam.parent = rig
    sc.camera = cam
    cd.sensor_fit = "HORIZONTAL"; cd.sensor_width = 36.0
    cd.clip_start, cd.clip_end = 0.05, 400
    con = cam.constraints.new("TRACK_TO"); con.target = aim_shake
    con.track_axis = "TRACK_NEGATIVE_Z"; con.up_axis = "UP_Y"

    #        frame   camera position          aims at              lens
    r = Vector(ring)
    d0, d1 = T["dive"]
    path = [(1,    (0, 0, 0),            (0, Y0, 0),            LENS),   # = lobby screen
            (T["hold"], (0, 0, 0),       (0, Y0, 0),            LENS),
            (44,   tuple(r * 0.3),       tuple(r),              44),     # lock on to the ring
            (d1,   tuple(r + Vector((0, 0.6, 0))), tuple(r + Vector((-1.5, 13, 0))), 30),  # through!
            (92,   (-5.8, 7.6, 0.9),     (-2.6, 17.0, -1.6),    28),
            (126,  (-1.4, 8.6, 1.35),    (2.6, 18.0, -0.4),     30),
            (150,  (5.4, 10.8, -0.55),   (2.4, 25.0, -0.2),     32),
            (186,  (6.0, 13.2, 2.1),     (-1.2, 25.0, 0.7),     34),
            (228,  (5.2, 9.4, 1.35),     (0.4, 25.0, 0.35),     38),
            (T["glide"][0], (4.6, 8.9, 1.15), (0.3, 25.0, 0.25), 38),
            (332,  (2.6, 3.6, -1.35),            (0.0, 25.0, -0.1),  44),
            (T["glide"][1], (0.0, 0.0, 0.0),   (0.0, Y0, 0.0),   LENS),
            (F_END, (0.0, 0.0, 0.0),           (0.0, Y0, 0.0),   LENS)]
    for f, loc, tgt, lens in path:
        key(rig, "location", f, Vector(loc))
        key(aim, "location", f, Vector(tgt))
        key(cd, "lens", f, lens)
    # the glide: slow start, long satisfying settle
    g0, g1 = T["glide"]
    for o in (rig, aim):
        for fc in channelbag(o).fcurves:
            for kp in fc.keyframe_points:
                if abs(kp.co.x - 1) < .1:
                    kp.interpolation = "CONSTANT"            # dead still: the lobby
                if abs(kp.co.x - T["hold"]) < .1:
                    kp.interpolation, kp.easing = "SINE", "EASE_IN"
                if abs(kp.co.x - 44) < .1:
                    kp.interpolation, kp.easing = "QUAD", "EASE_IN"  # accelerate into the dive
                if abs(kp.co.x - g0) < .1:
                    kp.interpolation, kp.easing = "SINE", "EASE_IN"
                if abs(kp.co.x - 332) < .1:
                    kp.interpolation, kp.easing = "QUINT", "EASE_OUT"
                if abs(kp.co.x - g1) < .1:
                    kp.interpolation = "CONSTANT"
    for fc in channelbag(cd).fcurves:
        for kp in fc.keyframe_points:
            if abs(kp.co.x - g0) < .1:
                kp.interpolation, kp.easing = "QUINT", "EASE_IN_OUT"

    # camera shake on the slam (decaying)
    rnd = random.Random(7)
    key(aim_shake, "location", SLAM - 1, Vector((0, 0, 0)), "LINEAR")
    amp = 0.55
    for i, f in enumerate(range(SLAM, SLAM + 18, 2)):
        a = amp * (0.62 ** i)
        key(aim_shake, "location", f, Vector((rnd.uniform(-a, a), 0, rnd.uniform(-a, a) * 1.2)), "SINE")
    key(aim_shake, "location", SLAM + 20, Vector((0, 0, 0)))

    # depth of field: dreamy early, pin-sharp by the finale
    focus = link(bpy.data.objects.new("Focus", None))
    cd.dof.use_dof = True; cd.dof.focus_object = focus
    for f, loc in ((1, (0, Y0, 0)), (30, (0, Y0, 0)), (48, tuple(r)), (T["dive"][1], (-1, 14, 0)),
                   (92, (-4.6, 15.2, -1.6)), (136, (2.6, 17.4, 1.35)), (158, (2.5, 24, 0)),
                   (186, (0, 25, 0)), (T["glide"][1], (0, Y0, 0))):
        key(focus, "location", f, Vector(loc))
    key(cd.dof, "aperture_fstop", 1, 64.0, "CONSTANT")       # pin-sharp lobby screen
    for f, fs in ((30, 64.0), (50, 2.2), (140, 2.8), (228, 4.0),
                  (T["glide"][0] + 30, 8.0), (T["glide"][1], 64.0)):
        key(cd.dof, "aperture_fstop", f, fs)
    cd.dof.aperture_blades = 7
    return cam


# =========================================================== flat layout ===
def pillow(name, poly, depth, mat, roundness=0.85):
    """A soft, puffy slab with exactly the given outline when seen head-on."""
    # The bevel's inward offset follows the outline's winding: a clockwise
    # outline would bulge OUT by the bevel (the house waves did, by 3 u).
    area = sum(poly[i - 1][0] * poly[i][1] - poly[i][0] * poly[i - 1][1] for i in range(len(poly)))
    if area < 0:                       # clockwise: turn it round
        poly = poly[::-1]
    cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "2D"; cu.fill_mode = "BOTH"
    sp = cu.splines.new("POLY"); sp.points.add(len(poly) - 1)
    for p, (x, y) in zip(sp.points, poly):
        p.co = (x, y, 0, 1)
    sp.use_cyclic_u = True
    b = depth * 0.5 * roundness
    cu.extrude = max(depth * 0.5 - b, 0.0005)
    cu.bevel_depth = b; cu.bevel_resolution = 6; cu.offset = -b
    o = bpy.data.objects.new(name, cu)
    o.data.materials.append(mat)
    link(o)
    o = to_mesh(o)
    smooth(o, 60)
    o.rotation_euler = (math.radians(90), 0, 0)
    return o


def css_blob(w, h, rx=(46, 54, 52, 48), ry=(58, 44, 56, 42), n=40):
    """The website's 'border-radius: 46% 54% 52% 48% / 58% 44% 56% 42%'
    cloud, rebuilt point by point (corners: TL, TR, BR, BL)."""
    rx = [r / 100 * w for r in rx]; ry = [r / 100 * h for r in ry]
    corners = [((-w / 2 + rx[0], h / 2 - ry[0]), (math.pi / 2, math.pi), 0),
               ((-w / 2 + rx[3], -h / 2 + ry[3]), (math.pi, 1.5 * math.pi), 3),
               ((w / 2 - rx[2], -h / 2 + ry[2]), (1.5 * math.pi, 2 * math.pi), 2),
               ((w / 2 - rx[1], h / 2 - ry[1]), (0, math.pi / 2), 1)]
    pts = []
    for (cx, cy), (a0, a1), i in corners:
        for k in range(n):
            a = a0 + (a1 - a0) * k / n
            pts.append((cx + rx[i] * math.cos(a), cy + ry[i] * math.sin(a)))
    return pts


def build_clouds(coll):
    """The lobby's two pale cloud shapes - floating far behind the title."""
    cloud = material("Cloud", "#E4F4FB", rough=0.5, sheen=0.5, sss=0.2,
                     flat=HOUSE["cloud"], bump=0.08)
    out = []
    #          lobby centre(u)   size (u)        depth  drift
    for name, (cx, cy), (w, h), depth in (("Cloud A", (15.0, 24.75), (46, 29.25), 44.0),
                                          ("Cloud B", (84.0, 19.69), (52, 34.875), 62.0)):
        pos, s = lobby(cx, cy, depth)
        o = pillow(name, css_blob(w * U * s, h * U * s), 2.2 * s, cloud)
        o.location = pos
        coll.objects.link(o); bpy.context.scene.collection.objects.unlink(o)
        out.append((o, pos))
    return out


def lobby_outline(pts_u, depth, bottom=None):
    """A measured outline (lobby u, y down) as pillow points around the spot
    lobby(0, 0, depth). `bottom`: points on or past the screen's bottom edge
    are pushed further down, so a rounded pillow edge never shows there."""
    s = depth / Y0
    out = []
    for ux, uy in pts_u:
        if bottom is not None and uy >= 56.0:
            uy = bottom
        out.append((ux * U * s, -uy * U * s))
    return out


def build_corner_tab(coll):
    """The orange corner shape from the lobby's top-left, close to camera."""
    depth = 12.5
    mat = material("Orange", HOUSE["orange"], rough=0.3, coat=0.5, flat=HOUSE["orange"])
    pos0, s = lobby(0, 0, depth)
    if LAYOUT:
        # The lobby's own tab, point for point (its path as the TV draws it).
        o = pillow("Corner Tab", lobby_outline(LAYOUT["outlines"]["tab"], depth), 0.9 * s, mat, 0.9)
        o.location = pos0
        coll.objects.link(o); bpy.context.scene.collection.objects.unlink(o)
        return o
    # The kit's corner-tab path (shared/brand/shapes/tab-c-journey.svg),
    # resampled; SVG units, y down.
    d = [(205.36, -35.10), (-28.80, -35.10), (-28.80, 126.63), (4.35, 130.10), (28.16, 126.59),
         (40.51, 113.0), (52.0, 101.5), (63.35, 96.02), (81.82, 91.84), (100.10, 101.46),
         (118.57, 100.45), (133.31, 100.09), (146.80, 91.64), (152.55, 77.99), (157.0, 62.0),
         (159.60, 52.0), (163.0, 38.0), (169.08, 27.40), (180.32, 12.54), (192.0, 2.0),
         (201.97, -17.74), (203.57, -23.29), (204.71, -29.13)]
    # smooth it a bit with Chaikin corner-cutting
    for _ in range(3):
        nd = []
        for i in range(len(d)):
            a, b = Vector(d[i]), Vector(d[(i + 1) % len(d)])
            nd += [tuple(a * .75 + b * .25), tuple(a * .25 + b * .75)]
        d = nd
    k = (25.0 / 205.36) * U * s        # 25 u wide on the lobby screen
    poly = [(x * k, -y * k) for x, y in d]
    o = pillow("Corner Tab", poly, 0.9 * s, mat, 0.9)
    o.location = pos0
    coll.objects.link(o); bpy.context.scene.collection.objects.unlink(o)
    return o


def build_house_waves(coll):
    """The lobby's two house waves along the bottom (sunflower behind, Awana
    orange in front), from their measured outlines, close to camera like the
    tab: the dive leaves them behind, the glide brings them home."""
    if not LAYOUT:
        return []
    out = []
    #                     outline       colour token  depth
    for name, key_, tok, depth in (("House Wave Sun", "waveSun", "sun", 10.6),
                                   ("House Wave", "waveHouse", "orange", 9.8)):
        pos, s = lobby(0, 0, depth)
        mat = material(f"Wave {tok}", HOUSE[tok], rough=0.3, coat=0.5, flat=HOUSE[tok])
        o = pillow(name, lobby_outline(LAYOUT["outlines"][key_], depth, bottom=62.0), 0.9 * s, mat, 0.9)
        o.location = pos
        coll.objects.link(o); bpy.context.scene.collection.objects.unlink(o)
        out.append((o, pos))
    return out


# ================================================================ lockup ===
INK = None


def side_walls(obj):
    """Give the letter's side walls their own, lighter satin finish, so at an
    angle the depth reads as solid 3D instead of a dark 'ghost' copy of the
    letter. (Flattens to the same ink as the front, so the lobby frame is
    unchanged.)"""
    side = material("Ink Side", "#5A5560", rough=0.55, coat=0.2, flat=HOUSE["ink"])
    me = obj.data
    if "Ink Side" not in [m.name for m in me.materials if m]:
        me.materials.append(side)
    idx = [m.name for m in me.materials].index("Ink Side")
    for poly in me.polygons:
        if abs(poly.normal.y) < 0.6:          # not facing the camera = a wall
            poly.material_index = idx


def ink_material():
    global INK
    if INK is None:
        INK = material("Ink", HOUSE["ink"], rough=0.28, coat=0.8, flat=HOUSE["ink"])
    return INK


def build_lockup(coll):
    """The real KVBC Awana logo (vector), turned into chunky 3D letters.
    Returns {'church': [...], 'awana': [...], 'tagline': [...]} letter pieces."""
    parts = import_svg("kvbc-awana-full-ink.svg", "logos")
    size = recentre_curves(parts)
    scale = 72.0 * U / size.x                 # 72 u wide, like the website
    logo_h = size.y * scale
    top_u = 19.0 + (26.0 - (logo_h / U + 3.0 + GLAD_U)) / 2   # centred in its box
    centre_z = (H2 - (top_u + logo_h / U / 2)) * U
    groups = sorted(parts, key=lambda o: -max(p.y for p in curve_points(o)))
    names = ["church", "awana", "tagline"]
    depth = {"church": 0.09, "awana": 0.42, "tagline": 0.06}
    out = {}
    for name, o in zip(names, groups):
        link(o, coll)
        scale_curve(o.data, scale)
        cu = o.data
        cu.dimensions = "2D"; cu.fill_mode = "BOTH"
        cu.extrude = depth[name] / 2
        if name == "awana":
            bev = 0.018                     # big letters: a soft rounded edge
            cu.bevel_depth = bev; cu.bevel_resolution = 3; cu.offset = -bev
        else:
            # thin letters: a bevel would eat their hairline strokes and leave
            # cracks, so just a whisker of an edge, grown outward
            cu.bevel_depth = 0.0025; cu.bevel_resolution = 1; cu.offset = 0.0
        cu.materials.append(ink_material())
        o.name = f"Logo {name}"
        o.rotation_euler = (math.radians(90), 0, 0)
        o.location = (0, Y0, centre_z)
        pieces = [to_mesh(c) for c in split_curve_letters(o)]
        for k, p in enumerate(pieces):
            p.location.y += (k % 3) * 0.002        # tight-kerned letters that touch
            bake_xform(p)                          # never share a plane (no flicker)
            side_walls(p)
            set_origin(p, "bottom")
            smooth(p, 30)
        out[name] = pieces
    glad_top_u = top_u + logo_h / U + 3.0
    return out, glad_top_u, top_u, logo_h / U


def build_glad_line(coll, top_u):
    """'We're so glad you're here!' in Paytone One (the brand's shout face)."""
    font = bpy.data.fonts.load(os.path.join(BRAND, "fonts", "PaytoneOne-Regular.ttf"))
    if LAYOUT and LAYOUT.get("glad"):
        return build_glad_glyphs(coll, font, LAYOUT["glad"])
    td = bpy.data.curves.new("Glad", "FONT")
    td.body = "We’re so glad you’re here!"
    td.font = font; td.align_x = "CENTER"; td.align_y = "TOP_BASELINE"
    depth = 18.0
    pos, s = lobby(50, top_u + 0.915 * GLAD_U, depth)   # CSS line box -> baseline
    td.size = GLAD_U * U * s
    td.extrude = 0.12 * s; td.bevel_depth = 0.012 * s; td.bevel_resolution = 3
    td.offset = -0.012 * s
    td.materials.append(ink_material())
    o = link(bpy.data.objects.new("Glad Line", td), coll)
    o.rotation_euler = (math.radians(90), 0, 0)
    o.location = pos
    o = to_mesh(o)
    bake_xform(o)
    side_walls(o)
    set_origin(o, "bottom"); smooth(o, 30)
    return o


def build_glad_glyphs(coll, font, glad):
    """The glad line laid letter by letter where the browser lays it
    (lobby-layout.json: each letter's pen position, the baseline, the size),
    so the font's kerning, which Blender's text does not apply, is kept.
    One mesh, like the plain build."""
    depth = 18.0
    s = depth / Y0
    pieces = []
    for ch, x in glad["glyphs"]:
        if ch.isspace():
            continue
        td = bpy.data.curves.new(f"Glad {ch}", "FONT")
        td.body = ch
        td.font = font; td.align_x = "LEFT"; td.align_y = "TOP_BASELINE"
        td.size = glad["size"] * U * s
        td.extrude = 0.12 * s; td.bevel_depth = 0.012 * s; td.bevel_resolution = 3
        td.offset = -0.012 * s
        td.materials.append(ink_material())
        o = link(bpy.data.objects.new(f"Glad {ch}", td), coll)
        o.rotation_euler = (math.radians(90), 0, 0)
        o.location, _ = lobby(x, glad["baseline"], depth)
        pieces.append(to_mesh(o))
    # Blender's font size is not the CSS em (Paytone's metrics differ), so
    # size every letter about its own pen position until the line's ink is
    # as tall as the browser's (the height follows the size alone; the width
    # hardly does, with every pen position fixed): then the letters' sizes
    # AND places agree.
    want = LAYOUT["boxes"]["glad"][3] - LAYOUT["boxes"]["glad"][1]
    lo, hi = 0.3, 3.0
    for _ in range(30):
        f = (lo + hi) / 2
        for o in pieces:
            o.scale = (f, f, f)
        _l, t, _r, b = screen_box(pieces)
        lo, hi = (f, hi) if b - t < want else (lo, f)
    for o in pieces:
        bake_xform(o)
    with bpy.context.temp_override(active_object=pieces[0], selected_editable_objects=pieces,
                                   selected_objects=pieces):
        bpy.ops.object.join()
    o = pieces[0]
    o.name = "Glad Line"
    side_walls(o)
    set_origin(o, "bottom"); smooth(o, 30)
    return o


# =============================================================== doodles ===
DOODLE_FILES = {"sparkle": "sparkle-4pt.svg", "sparkleX": "sparkle-4pt-x.svg", "dot": "dot.svg",
                "ring": "ring.svg", "squiggle": "squiggle-wave.svg", "zigzag": "zigzag.svg",
                "loop": "loop.svg", "heart": "pixel-heart.svg", "spiral": "coil-spiral.svg",
                "squiggleL": "squiggle-long.svg", "steps": "zigzag-steps.svg", "smile": "smile-arc.svg"}
K_SVG = 0.0254 / 90            # Blender's SVG importer: 1 SVG unit = this many metres


def svg_viewbox_w(fname):
    """(viewBox width, ink width) of a brand doodle, in SVG units."""
    import re
    with open(os.path.join(BRAND, "doodles", fname)) as fh:
        t = fh.read()
    vb = t.split('viewBox="')[1].split('"')[0].split()
    d = t.split(' d="')[1].split('"')[0]
    nums = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", d)]
    xs = nums[0::2]
    return float(vb[2]), max(xs) - min(xs)


def doodle(kind, color_hex, coll, size_m=1.0, name=None, glow=0.0, thick=0.16):
    """One brand doodle as a 3D object about size_m wide.
    Filled doodles become chunky plastic; line doodles become round tubes."""
    fname = DOODLE_FILES[kind]
    objs = import_svg(fname)
    o = objs[0]
    for extra in objs[1:]:
        bpy.data.objects.remove(extra)
    link(o, coll)
    ink = recentre_curves([o])
    vbw, ink_svg = svg_viewbox_w(fname)
    units = ink.x / ink_svg               # importer units per SVG unit
    k = size_m / (vbw * units)            # viewBox width -> size_m metres
    scale_curve(o.data, k)
    cu = o.data
    stroked = cu.dimensions == "3D" or cu.fill_mode in ("FULL", "NONE")
    mat = material(f"Doodle {color_hex}", color_hex, rough=0.25, coat=0.7,
                   flat=color_hex, glow=glow)
    if stroked:
        cu.dimensions = "3D"
        cu.bevel_mode = "ROUND"; cu.bevel_depth = 0.9 * units * k * 1.4
        cu.bevel_resolution = 5; cu.use_fill_caps = True
        for s in cu.splines:
            s.use_smooth = True
    else:
        cu.dimensions = "2D"; cu.fill_mode = "BOTH"
        cu.extrude = thick * size_m / 2
        b = min(cu.extrude * 0.9, size_m * 0.03)
        cu.bevel_depth = b; cu.bevel_resolution = 4; cu.offset = -b
    cu.materials.append(mat)
    o.rotation_euler = (math.radians(90), 0, 0)
    o.name = name or f"Doodle {kind}"
    o["stroked"] = stroked
    return o


# The six doodles that frame the logo on the lobby screen (FlagshipSlide.jsx
# DOODLES_AROUND), each parked at its own wildly different depth.
LAYOUT_DOODLES = [
    # kind      club       x(u from logo edge)  y(share of logo h) size rot   depth
    ("sparkle", "puggles", ("L", -7.2), -0.06, 3.4, -8, 5.5),
    ("dot", "sparks", ("L", -3.8), 0.18, 1.1, 0, 16.0),
    ("squiggle", "tnt", ("L", -6.6), 0.38, 4.2, 12, 38.0),
    ("ring", "cubbies", ("R", 5.2), 0.40, 1.6, 0, 7.0),
    ("sparkleX", "journey", ("R", 3.4), 0.62, 3.2, 0, 46.0),
    ("zigzag", "trek", ("R", 5.8), 0.88, 4.4, -6, 4.8),
]


def build_layout_doodles(coll, logo_top_u, logo_h_u):
    out = []
    for kind, club, (side, dx), fy, size, rot, depth in LAYOUT_DOODLES:
        ux = (14.0 if side == "L" else 86.0) + dx
        uy = logo_top_u + fy * logo_h_u
        pos, s = lobby(ux, uy, depth)
        o = doodle(kind, CLUB[club], coll, size * U * s, f"Lobby {kind}", glow=6.0)
        o.location = pos
        o.rotation_euler = (math.radians(90), math.radians(rot), 0)
        out.append((o, pos))
    return out


# ======================================================= fit to the lobby ===
FLAT_DEPTH = 0.02      # how thick a flat layout piece is, as a share of its 3D self


def depth_axis(o):
    """The axis of an object's own thickness: a baked piece's is world Y,
    one stood up by rotation_euler.x = 90 deg (a curve) is its local Z."""
    return 2 if abs(o.rotation_euler.x - math.radians(90)) < 1e-3 else 1


def flat_scale(o, k):
    v = [1.0, 1.0, 1.0]
    v[depth_axis(o)] = k
    return v


def flatten_bookends(objs):
    """The lobby screen is FLAT: every layout piece starts with almost no
    thickness, swells to its full 3D self as the world inflates, and goes
    flat again as it flattens back. Flat, a piece's side walls vanish, so
    the first and last frames are exactly the lobby's 2D shapes (walls seen
    in perspective made the thin lines a pixel bolder). delta_scale, so it
    never meets the scale keys the story's own animation sets."""
    i0, i1 = T["inflate"]
    f0, f1 = T["flatten"]
    for o in objs:
        flat, full = flat_scale(o, FLAT_DEPTH), [1.0, 1.0, 1.0]
        o.delta_scale = flat
        key(o, "delta_scale", 1, flat, "CONSTANT")
        key(o, "delta_scale", i0, flat, "SINE", "EASE_IN_OUT")
        key(o, "delta_scale", i1, full, "CONSTANT")
        key(o, "delta_scale", f0, full, "SINE", "EASE_IN_OUT")
        key(o, "delta_scale", f1, flat, "CONSTANT")


def world_matrix(o):
    """xform() with the flat bookends' delta_scale (the first frame's shape)."""
    s = Vector([a * b for a, b in zip(o.scale, o.delta_scale)])
    return Matrix.LocRotScale(o.location, o.rotation_euler, s)


def screen_box(objs):
    """Where the FINAL camera (origin, looking down +Y, LENS mm) sees these
    objects at rest: their box on the lobby screen, in u [l, t, r, b]. Every
    vertex of the evaluated shape counts (bevels, tubes, side walls)."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    xs, ys = [], []
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        m = world_matrix(o)
        for v in me.vertices:
            p = m @ v.co
            xs.append(50 + p.x * Y0 / (U * p.y))
            ys.append(H2 - p.z * Y0 / (U * p.y))
        ev.to_mesh_clear()
    return min(xs), min(ys), max(xs), max(ys)


def scale_data(o, k):
    """Resize an object's own shape by k about its pivot (never its scale,
    which the animation keys own)."""
    if o.type == "MESH":
        o.data.transform(Matrix.Scale(k, 4))
        return
    cu = o.data
    cu.transform(Matrix.Scale(k, 4))
    for sp in cu.splines:
        for p in sp.bezier_points:
            p.radius = 1.0
        for p in sp.points:
            p.radius = 1.0
    cu.bevel_depth *= k; cu.extrude *= k; cu.offset *= k


def fit_to_box(objs, box, rounds=3):
    """Move and size a group (one uniform scale, so the shape is never
    stretched) until the final camera sees its box at `box` (lobby u). Each
    piece moves within its own depth, so the 3D flight is unchanged."""
    tl, tt, tr, tb = box
    for _ in range(rounds):
        l, t, r, b = screen_box(objs)
        # Weighted by size: a long thin line (the tagline: 71 x 2.3 u) is
        # fitted by its length, where a pixel of antialiasing in its height
        # would otherwise pull the width 0.4 u off.
        k = ((tr - tl) + (tb - tt)) / ((r - l) + (b - t))
        cx, cy = (l + r) / 2, (t + b) / 2
        tx, ty = (tl + tr) / 2, (tt + tb) / 2
        for o in objs:
            y = o.location.y
            m = y * U / Y0                       # metres per u at this depth
            xc, zc = (cx - 50) * m, (H2 - cy) * m
            scale_data(o, k)
            o.location.x = xc + k * (o.location.x - xc) + (tx - cx) * m
            o.location.z = zc + k * (o.location.z - zc) - (ty - cy) * m
    l, t, r, b = screen_box(objs)
    return max(abs(l - tl), abs(t - tt), abs(r - tr), abs(b - tb))


def fit_layout(logo, glad, doodles):
    """Every flat piece onto its measured spot (lobby-layout.json)."""
    if not LAYOUT:
        return doodles
    boxes = LAYOUT["boxes"]
    worst = {}
    for part in ("church", "awana", "tagline"):
        worst[part] = fit_to_box(logo[part], boxes[part])
    worst["glad"] = fit_to_box([glad], boxes["glad"])
    if len(boxes["doodles"]) != len(doodles):
        raise RuntimeError("lobby-layout.json has a different number of doodles: re-run tools/measure-lobby.mjs")
    out = []
    for (o, _), box in zip(doodles, boxes["doodles"]):
        worst[o.name] = fit_to_box([o], box)
        out.append((o, o.location.copy()))
    print("[awana] fitted to the lobby (worst edge, u): "
          + ", ".join(f"{k} {v:.3f}" for k, v in worst.items()))
    return out


# ============================================================== stickers ===
def build_stickers(coll):
    """Every club character as a thick die-cut cardboard sticker standee:
    the real artwork on the front, a bevelled white card edge and back."""
    with open(os.path.join(DIECUTS, "diecuts.json")) as fh:
        meta = json.load(fh)
    card = material("Card Stock", "#F7F5F0", rough=0.75, sheen=0.3, bump=0.05)
    # left -> right along the domino arc; heights in metres
    order = [("puggles_duck", 1.45), ("tnt_chase", 2.25), ("cubbies_bear", 1.5),
             ("puggles_maya", 1.5), ("tnt_nora", 2.3), ("sparks_sparky", 1.65),
             ("puggles_alice", 1.5), ("tnt_tommy", 2.2), ("puggles_sydney", 1.45),
             ("tnt_marcos", 2.3), ("tnt_rabbot", 1.8)]
    n = len(order)
    out = []
    for i, (name, h) in enumerate(order):
        m = meta[name]
        h *= 1.35
        w = h * m["aspect"]; t = 0.055
        bm = bmesh.new()
        pts = [((x - 0.5) * w, y * h) for x, y in m["outline"]]
        front = [bm.verts.new((x, y, t / 2)) for x, y in pts]
        back = [bm.verts.new((x, y, -t / 2)) for x, y in pts]
        f = bm.faces.new(front); f.material_index = 0
        bk = bm.faces.new(list(reversed(back))); bk.material_index = 1
        for j in range(len(pts)):
            a, b = j, (j + 1) % len(pts)
            sf = bm.faces.new((front[b], front[a], back[a], back[b])); sf.material_index = 1
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(f"Sticker {name}")
        bm.to_mesh(me); bm.free()
        mat, mapping = image_material(f"Art {name}", os.path.join(DIECUTS, m["image"]))
        mapping.inputs["Scale"].default_value = (1 / w, 1 / h, 1)
        mapping.inputs["Location"].default_value = (0.5, 0, 0)
        # mapping does (v*scale)+loc ... we need x/w + 0.5, y/h
        mapping.vector_type = "POINT"
        me.materials.append(mat); me.materials.append(card)
        o = bpy.data.objects.new(f"Sticker {name}", me)
        coll.objects.link(o)
        bev = o.modifiers.new("Soft edge", "BEVEL")
        bev.width = 0.012; bev.segments = 3; bev.limit_method = "ANGLE"
        bev.angle_limit = math.radians(50); bev.harden_normals = False
        # their spot on the arc (in front of the title, below eye level)
        u = i / (n - 1)
        x = -9.6 + 19.2 * u
        y = 15.2 + 2.6 * (2 * u - 1) ** 2
        o.location = (x, y, -2.75)
        o.rotation_euler = (math.radians(90), 0, math.radians(-14 + 28 * u))
        out.append(o)
    return out


def animate_stickers(stickers):
    """Dominoes: each sticker lies flat (face up) and flips upright with a
    springy overshoot as the camera sweeps by. On the SLAM they're blown away."""
    f0, step = T["dominoes"]
    rnd = random.Random(11)
    for i, o in enumerate(stickers):
        rest = o.rotation_euler.copy()
        flat = rest.copy(); flat.x = math.radians(0)
        start = int(f0 + i * step)
        key(o, "rotation_euler", 1, flat, "CONSTANT")
        key(o, "rotation_euler", start, flat, "BACK", "EASE_OUT")
        key(o, "rotation_euler", start + 13, rest, "SINE", "EASE_IN_OUT")
        # little idle sway while standing
        sway = rest.copy(); sway.z += math.radians(rnd.uniform(-6, 6))
        key(o, "rotation_euler", start + 60, sway, "SINE", "EASE_IN_OUT")
        key(o, "rotation_euler", SLAM, rest)
        # ... a pop of scale so they 'arrive'
        key(o, "scale", 1, (0.001, 0.001, 0.001), "CONSTANT")
        key(o, "scale", start - 1, (0.001, 0.001, 0.001), "BACK", "EASE_OUT")
        key(o, "scale", start + 8, (1, 1, 1))
        # blown away by the shockwave
        blast_from = Vector((0, Y0, 0.6))
        d = (o.location - blast_from); d.y *= 0.4; d.z = 0
        d = d.normalized() if d.length > 0 else Vector((1, 0, 0))
        hit = SLAM + int(d.length) + rnd.randint(0, 3)
        loc0 = o.location.copy()
        key(o, "location", hit, loc0, "CUBIC", "EASE_OUT")
        away = loc0 + d * rnd.uniform(16, 24) + Vector((0, -rnd.uniform(4, 9), rnd.uniform(4, 9)))
        key(o, "location", hit + 34, away)
        key(o, "rotation_euler", hit, rest, "CUBIC", "EASE_OUT")
        spin = Euler((rest.x + rnd.uniform(-9, 9), rest.y + rnd.uniform(-6, 6), rest.z + rnd.uniform(-9, 9)))
        key(o, "rotation_euler", hit + 34, spin)
        key(o, "scale", hit + 30, (1, 1, 1), "LINEAR")
        key(o, "scale", hit + 36, (0.001, 0.001, 0.001), "CONSTANT")


def build_flight_scenery(coll):
    """Extra puffy clouds + doodle trios the camera whooshes past early on.
    All placed BEHIND the final camera (y < 0) or outside its view, so they
    never spoil the final lobby frame."""
    rnd = random.Random(5)
    cloud = MATS["Cloud"]
    spots = [(-6.5, -3.0, -2.6, 5.0), (7.5, -1.0, 2.8, 6.5), (-9.0, 4.5, 4.2, 5.5),
             (11.5, 6.0, -3.5, 7.0), (-14, 14, -5.0, 9.0), (15, 18, 6.5, 10.0)]
    for i, (x, y, z, w) in enumerate(spots):
        o = pillow(f"Sky Cloud {i}", css_blob(w, w * rnd.uniform(0.5, 0.65)), 1.6, cloud)
        o.location = (x, y, z)
        o.rotation_euler.z = rnd.uniform(-0.5, 0.5)
        coll.objects.link(o); bpy.context.scene.collection.objects.unlink(o)
    trio_kinds = [("loop", "journey"), ("spiral", "trek"), ("heart", "sparks"),
                  ("squiggleL", "puggles"), ("steps", "tnt"), ("smile", "cubbies")]
    for i, (kind, club) in enumerate(trio_kinds):
        o = doodle(kind, CLUB[club], coll, rnd.uniform(0.8, 1.3), f"Flyby {kind}")
        side = -1 if i % 2 == 0 else 1
        o.location = (side * rnd.uniform(3.5, 6.5), rnd.uniform(-6, 7), rnd.uniform(-2.5, 3))
        r0 = Euler((math.radians(90), rnd.uniform(-0.5, 0.5), rnd.uniform(-0.6, 0.6)))
        key(o, "rotation_euler", 1, r0, "LINEAR")
        key(o, "rotation_euler", 200, Euler((r0.x, r0.y + rnd.choice((-2, 2)), r0.z)))
        if o.get("stroked"):
            key(o.data, "bevel_factor_end", 30 + i * 6, 0.0, "CUBIC", "EASE_OUT")
            key(o.data, "bevel_factor_end", 60 + i * 6, 1.0)


# ============================================================== confetti ===
def build_confetti(coll):
    """The shockwave burst: ~56 doodles explode out of the title on the SLAM,
    spinning past (and around) the camera."""
    rnd = random.Random(9)
    kinds = ["sparkle", "sparkleX", "dot", "ring", "squiggle", "zigzag", "loop", "heart", "spiral"]
    clubs = ["puggles", "sparks", "tnt", "cubbies", "trek", "journey"]
    protos = {}
    for kind in kinds:
        for club in clubs:
            p = doodle(kind, CLUB[club], coll, 1.0, f"Confetti proto {kind} {club}")
            m = to_mesh(p)
            m.hide_render = True; m.hide_viewport = True
            protos[(kind, club)] = m
    for i in range(56):
        kind, club = rnd.choice(kinds), rnd.choice(clubs)
        src = protos[(kind, club)]
        o = bpy.data.objects.new(f"Confetti {i}", src.data)
        coll.objects.link(o)
        start = Vector((rnd.uniform(-5.5, 5.5), Y0 - 0.6, rnd.uniform(-0.6, 1.4)))
        # outward, upward, and mostly toward the camera
        d = Vector((start.x * rnd.uniform(0.6, 1.4) + rnd.uniform(-3, 3),
                    -rnd.uniform(6, 16), rnd.uniform(-3.5, 6.5)))
        end = start + d.normalized() * rnd.uniform(16, 30)
        f0 = SLAM + rnd.randint(-1, 3)
        dur = rnd.randint(26, 40)
        sz = rnd.uniform(0.45, 1.05)
        r0 = Euler((math.radians(90) + rnd.uniform(-1, 1), rnd.uniform(-3, 3), rnd.uniform(-3, 3)))
        r1 = Euler((r0.x + rnd.uniform(-10, 10), r0.y + rnd.uniform(-8, 8), r0.z + rnd.uniform(-10, 10)))
        o.location = start; o.rotation_euler = r0
        key(o, "scale", 1, (0.001,) * 3, "CONSTANT")
        key(o, "scale", f0, (0.001,) * 3, "BACK", "EASE_OUT")
        key(o, "scale", f0 + 5, (sz,) * 3, "LINEAR")
        key(o, "scale", f0 + dur - 3, (sz,) * 3, "LINEAR")
        key(o, "scale", f0 + dur, (0.001,) * 3, "CONSTANT")
        key(o, "location", f0, start, "EXPO", "EASE_OUT")
        key(o, "location", f0 + dur, end)
        key(o, "rotation_euler", f0, r0, "CUBIC", "EASE_OUT")
        key(o, "rotation_euler", f0 + dur, r1)
    return protos


def build_dust(coll, protos):
    """A field of small doodles hanging in the air all over the world, for
    depth and parallax. As the camera settles into the final spot they pop
    away one by one - the world 'tidies itself up' into the lobby screen."""
    rnd = random.Random(15)
    keys = list(protos.keys())
    g0, g1 = T["glide"]
    for i in range(110):
        src = protos[rnd.choice(keys)]
        o = bpy.data.objects.new(f"Dust {i}", src.data)
        coll.objects.link(o)
        y = rnd.uniform(1.5, 48)
        half_w = 0.36 * y
        x = rnd.uniform(-1.6, 1.6) * half_w
        z = rnd.uniform(-1.6, 1.6) * 0.2025 * y
        o.location = (x, y, z)
        sz = rnd.uniform(0.12, 0.3) * (0.6 + y / 40)
        r0 = Euler((math.radians(90) + rnd.uniform(-0.5, 0.5), rnd.uniform(-3, 3), rnd.uniform(-0.8, 0.8)))
        spin = rnd.choice((-1, 1)) * rnd.uniform(1.5, 4)
        appear = rnd.randint(40, 70)
        gone = rnd.randint(g0 + 25, g1 - 6)
        key(o, "scale", 1, (0.001,) * 3, "CONSTANT")
        key(o, "scale", appear, (0.001,) * 3, "BACK", "EASE_OUT")
        key(o, "scale", appear + 10, (sz,) * 3, "LINEAR")
        key(o, "scale", gone, (sz,) * 3, "BACK", "EASE_IN")
        key(o, "scale", gone + 7, (0.001,) * 3, "CONSTANT")
        key(o, "rotation_euler", 1, r0, "LINEAR")
        key(o, "rotation_euler", gone + 7, Euler((r0.x, r0.y + spin, r0.z)))
        drift = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.6, 0.6)))
        key(o, "location", 1, o.location.copy(), "LINEAR")
        key(o, "location", gone + 7, o.location + drift)


def build_shockwave(coll):
    """A bright ring that blasts outward from behind the title on the SLAM."""
    mat = material("Shockwave", HOUSE["sun"], rough=0.2, glow=0.0)
    em = mat.node_tree.nodes["Principled BSDF"]
    em.inputs["Emission Color"].default_value = lin("#FFF1C2")
    em.inputs["Emission Strength"].default_value = 2.5
    for i, (delay, size, thick) in enumerate(((0, 13.0, 0.035), (3, 9.5, 0.028))):
        bpy.ops.mesh.primitive_torus_add(major_radius=1.0, minor_radius=thick,
                                         major_segments=160, minor_segments=12,
                                         location=(0, Y0 + 0.6, 0.7), rotation=(math.radians(90), 0, 0))
        r = bpy.context.object; r.name = f"Shockwave {i}"
        for c in list(r.users_collection):
            c.objects.unlink(r)
        coll.objects.link(r); r.data.materials.append(mat); smooth(r, 80)
        f = SLAM + delay
        key(r, "scale", 1, (0.001,) * 3, "CONSTANT")
        key(r, "scale", f - 1, (0.001,) * 3, "CONSTANT")
        key(r, "scale", f, (0.6, 0.6, 0.6), "EXPO", "EASE_OUT")
        key(r, "scale", f + 16, (size, size, 0.25))
        key(r, "scale", f + 17, (0.001,) * 3, "CONSTANT")


# ========================================================= the easter egg ===
def build_egg(coll):
    """A tumbling orange blob with Awana's theme verse engraved on its back.
    It faces the camera for about 8 frames. Blink and you'll miss it."""
    objs = import_svg("tip-blob.svg", "shapes")
    o = objs[0]
    for x in objs[1:]:
        bpy.data.objects.remove(x)
    link(o, coll)
    sz = recentre_curves([o])
    k = 1.7 / sz.x
    scale_curve(o.data, k)
    cu = o.data; cu.dimensions = "2D"; cu.fill_mode = "BOTH"
    cu.extrude = 0.12; cu.bevel_depth = 0.11; cu.bevel_resolution = 6; cu.offset = -0.11
    cu.materials.append(material("Egg Orange", HOUSE["sun"], rough=0.3, coat=0.8, sss=0.1))
    o = to_mesh(o); smooth(o, 60); o.name = "Egg Blob"
    font = bpy.data.fonts.load(os.path.join(BRAND, "fonts", "PaytoneOne-Regular.ttf"))
    td = bpy.data.curves.new("Verse", "FONT"); td.body = "2 Tim 2:15"
    td.font = font; td.size = 0.34; td.align_x = "CENTER"; td.align_y = "CENTER"
    td.extrude = 0.012
    td.materials.append(material("Engraving", HOUSE["orangeDeep"], rough=0.6))
    t = link(bpy.data.objects.new("Verse", td), coll)
    # on the BACK face (local -z), mirrored so it reads correctly from behind
    t.location = (0, -0.05, -0.235); t.rotation_euler = (0, math.radians(180), 0)
    t.parent = o
    root = link(bpy.data.objects.new("Egg", None), coll)
    o.parent = root
    o.rotation_euler = (math.radians(90), 0, 0)
    root.location = (2.6, 17.4, 1.35)
    # tumble: back faces the camera around frame 140
    # hidden on the lobby screen; pops into the sky world after the dive
    key(root, "scale", 1, (0.001,) * 3, "CONSTANT")
    key(root, "scale", 78, (0.001,) * 3, "BACK", "EASE_OUT")
    key(root, "scale", 90, (1, 1, 1), "CONSTANT")
    key(root, "rotation_euler", 84, Euler((0, 0, math.radians(-40))), "LINEAR")
    key(root, "rotation_euler", 170, Euler((math.radians(18), 0, math.radians(320))))
    # ...then it zips up and out of the way before the church name rises
    key(root, "location", 150, root.location.copy(), "BACK", "EASE_IN")
    key(root, "location", 172, Vector((7.5, 14.0, 9.5)))
    key(root, "scale", 171, (1, 1, 1), "CONSTANT")
    key(root, "scale", 172, (0.001,) * 3, "CONSTANT")


# ======================================================== choreography ===
PEEL_RND = random.Random(34)


def peel(p, start):
    """Opening: a word piece sitting on the lobby screen peels off and whips
    past the camera, then vanishes (to come back later in the story)."""
    rnd = PEEL_RND
    rest_loc, rest_rot = p.location.copy(), p.rotation_euler.copy()
    start = int(start)
    away = rest_loc + Vector((rest_loc.x * rnd.uniform(0.3, 1.1) + rnd.uniform(-2.5, 2.5),
                              -rnd.uniform(12, 20),
                              rest_loc.z * rnd.uniform(0.5, 1.5) + rnd.uniform(-1.2, 2.4)))
    spin = Euler((rest_rot.x + rnd.uniform(-5, 5), rest_rot.y + rnd.uniform(-4, 4), rest_rot.z + rnd.uniform(-5, 5)))
    end = start + rnd.randint(18, 24)
    key(p, "location", 1, rest_loc, "CONSTANT")
    key(p, "location", start, rest_loc, "CUBIC", "EASE_IN")
    key(p, "location", end, away, "CONSTANT")
    key(p, "location", end + 1, rest_loc, "CONSTANT")          # home, unseen
    key(p, "rotation_euler", 1, rest_rot, "CONSTANT")
    key(p, "rotation_euler", start, rest_rot, "CUBIC", "EASE_IN")
    key(p, "rotation_euler", end, spin, "CONSTANT")
    key(p, "rotation_euler", end + 1, rest_rot, "CONSTANT")
    key(p, "scale", 1, (1, 1, 1), "CONSTANT")
    key(p, "scale", end - 1, (1, 1, 1), "LINEAR")
    key(p, "scale", end, (0.001,) * 3, "CONSTANT")
    return end


def peel_words(logo, glad):
    t = T["peel"]
    peel(glad, t)
    for i, p in enumerate(logo["awana"]):
        peel(p, t + 3 + i * 0.8)
    for i, p in enumerate(logo["church"]):
        peel(p, t + 1 + i * 0.35)
    for i, p in enumerate(logo["tagline"]):
        peel(p, t + 5 + i * 0.12)


def animate_church(pieces):
    """Letters stand up off their backs like a pop-up book, left -> right."""
    f0, step = T["church"]
    for i, p in enumerate(pieces):
        s = int(f0 + i * step)
        key(p, "rotation_euler", s, Euler((math.radians(-95), 0, 0)), "BACK", "EASE_OUT")
        key(p, "rotation_euler", s + 16, Euler((0, 0, 0)))
        key(p, "scale", s, (0.001,) * 3, "CUBIC", "EASE_OUT")
        key(p, "scale", s + 6, (1, 1, 1))


def animate_awana(pieces):
    """Each letter of 'Awana Clubs' falls from the sky and lands HARD:
    squash on impact, stretch on the rebound, settle."""
    f0, step = T["awana"]; fall = T["fall"]
    for i, p in enumerate(pieces):
        s = f0 + i * step
        land = s + fall
        rest = p.location.copy()
        sky = rest + Vector((0, 0, 9.5))
        key(p, "location", s - 1, sky, "CONSTANT")
        key(p, "location", s, sky, "QUAD", "EASE_IN")         # gravity
        key(p, "location", land, rest, "QUAD", "EASE_OUT")
        key(p, "location", land + 4, rest + Vector((0, 0, 0.22)), "QUAD", "EASE_IN")
        key(p, "location", land + 8, rest)
        tilt = math.radians(random.uniform(-14, 14))
        key(p, "rotation_euler", s, Euler((0, tilt, 0)), "QUAD", "EASE_IN")
        key(p, "rotation_euler", land, Euler((0, 0, 0)))
        sc = [(s, (0.86, 0.86, 1.22), "QUAD", "EASE_IN"),        # stretched in fall
              (land, (1.24, 1.24, 0.66), "SINE", "EASE_OUT"),    # SQUASH
              (land + 4, (0.93, 0.93, 1.1), "SINE", "EASE_IN_OUT"),
              (land + 8, (1.04, 1.04, 0.96), "SINE", "EASE_IN_OUT"),
              (land + 12, (1, 1, 1), "BEZIER", "AUTO")]
        key(p, "scale", s - 1, (0.001,) * 3, "CONSTANT")
        for f, v, ipo, ease in sc:
            key(p, "scale", f, v, ipo, ease)


def animate_tagline(pieces):
    f0, step = T["tagline"]
    for i, p in enumerate(pieces):
        s = int(f0 + i * step)
        # Read before keying: key() moves the piece, so reading p.location
        # after the first key left the tagline 0.25 m low for the whole end.
        rest = p.location.copy()
        key(p, "scale", s, (0.001,) * 3, "BACK", "EASE_OUT")
        key(p, "scale", s + 10, (1, 1, 1))
        key(p, "location", s, rest + Vector((0, 0, -0.25)), "BACK", "EASE_OUT")
        key(p, "location", s + 10, rest)


def animate_glad(o):
    s = T["glad"]
    r = o.rotation_euler.copy()
    key(o, "scale", s, (0.001,) * 3, "BACK", "EASE_OUT")
    key(o, "scale", s + 14, (1, 1, 1))
    key(o, "rotation_euler", s, Euler((0, math.radians(-8), 0)), "BACK", "EASE_OUT")
    key(o, "rotation_euler", s + 16, r)


def animate_floaters(items, amp=0.5, seed=1):
    """Layout pieces sit exactly in place for the lobby opening, drift gently
    in mid-air during the flight ... and settle EXACTLY back into place by
    the end of the glide (that's what makes the final frame line up)."""
    rnd = random.Random(seed)
    g1 = T["glide"][1]
    for o, home in items:
        a = amp * (home.y / Y0)
        key(o, "location", 1, home, "CONSTANT")
        key(o, "location", T["hold"], home, "SINE", "EASE_IN_OUT")
        for f in (100, 200, 290):
            off = Vector((rnd.uniform(-a, a), rnd.uniform(-a, a), rnd.uniform(-a, a)))
            key(o, "location", f, home + off, "SINE", "EASE_IN_OUT")
        key(o, "location", g1 - 6, home, "CONSTANT")


def animate_ring_dive(ring):
    """The little blue ring by the logo swells into a portal as the camera
    dives at it, waits behind us, then shrinks back to its lobby size."""
    d0, d1 = T["dive"]
    big = 46.0
    r0 = ring.rotation_euler.copy()
    key(ring, "scale", 1, (1, 1, 1), "CONSTANT")
    key(ring, "scale", d0, (1, 1, 1), "EXPO", "EASE_IN")
    key(ring, "scale", d1 - 4, (big,) * 3, "LINEAR")
    key(ring, "scale", 110, (big,) * 3, "SINE", "EASE_IN_OUT")
    key(ring, "scale", 150, (1, 1, 1))
    key(ring, "rotation_euler", 1, r0, "CONSTANT")
    key(ring, "rotation_euler", d0, r0, "CUBIC", "EASE_IN")
    key(ring, "rotation_euler", d1, Euler((r0.x, r0.y + math.radians(70), r0.z)), "SINE", "EASE_IN_OUT")
    key(ring, "rotation_euler", 150, r0)


# ================================================================ render ===
def setup_render(sc, mode):
    r = sc.render
    sc.render.engine = "CYCLES"
    cy = sc.cycles
    sc.view_settings.view_transform = "Standard"    # exact brand colours
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    r.resolution_x, r.resolution_y = 1920, 1080
    r.resolution_percentage = 100
    r.use_motion_blur = True
    r.motion_blur_shutter = 0.35 * RATE / FPS     # the same exposure at any frame rate
    r.film_transparent = False
    cy.use_adaptive_sampling = True
    cy.use_denoising = True
    cy.denoiser = "OPENIMAGEDENOISE"
    try:
        cy.denoising_use_gpu = True
    except Exception:
        pass
    cy.max_bounces = 6; cy.diffuse_bounces = 3; cy.glossy_bounces = 3
    cy.transmission_bounces = 4; cy.transparent_max_bounces = 8
    cy.caustics_reflective = False; cy.caustics_refractive = False
    cy.blur_glossy = 1.0
    cy.sample_clamp_indirect = 6.0
    r.use_persistent_data = True
    if mode == "final":
        cy.samples = 256; cy.adaptive_threshold = 0.012; cy.adaptive_min_samples = 32
    elif mode == "preview":
        r.resolution_percentage = int(arg("--pct", 50))     # 960x540
        cy.samples = int(arg("--samples", 20)); cy.adaptive_threshold = 0.08
        r.use_motion_blur = False
        sc.frame_step = int(arg("--step", 1))
    else:  # stills (Claude's art-direction checks)
        r.resolution_percentage = int(arg("--pct", 25))
        cy.samples = int(arg("--samples", 16)); cy.adaptive_threshold = 0.05
    # GPU: prefer NVIDIA OptiX, then CUDA; quietly fall back to CPU.
    # --cpu keeps off the graphics card (a check still while a render runs).
    try:
        if arg("--cpu"):
            raise RuntimeError("--cpu asked for")
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for dev_type in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
            try:
                prefs.compute_device_type = dev_type
                prefs.get_devices()
                gpus = [d for d in prefs.devices if d.type == dev_type]
                if gpus:
                    for d in prefs.devices:
                        d.use = d.type == dev_type
                    sc.cycles.device = "GPU"
                    print(f"[awana] rendering on {dev_type}: {', '.join(d.name for d in gpus)}")
                    break
            except Exception:
                continue
        else:
            print("[awana] no GPU found - rendering on the CPU (slow!)")
    except Exception as e:
        print("[awana] GPU setup skipped:", e)
    # frames go to PNGs first: if the laptop sleeps or crashes, just run
    # the .bat again and it picks up where it left off.
    r.image_settings.media_type = "IMAGE"
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGB"
    r.image_settings.compression = 15
    r.use_overwrite = False
    r.use_placeholder = True


LOBBY_COPY = os.path.join(REPO, "lobby", "public", "intro", "awana-intro.mp4")
WEB_KBPS = 6000 if RATE == FPS else 9000   # the lobby's copy: ~11 MB (30 fps) / ~17 MB (60 fps) for 15 s


def encode_mp4(frames_dir, out_path, fps=RATE, web=False):
    """Glue the PNG frames into one high-quality H.264 .mp4. `web`: the
    lobby's copy instead (lobby/src/components/FlagshipIntro.jsx plays it):
    a steady bitrate, a keyframe every second, and its index moved to the
    front so a TV can start it from the first request."""
    files = sorted(f for f in os.listdir(frames_dir) if f.endswith(".png"))
    files = [f for f in files if os.path.getsize(os.path.join(frames_dir, f)) > 0]
    if not files:
        print("[awana] no frames to encode"); return
    enc = bpy.data.scenes.new("Encode")
    enc.render.fps = fps
    enc.sequence_editor_create()
    st = enc.sequence_editor.strips.new_image(
        name="frames", filepath=os.path.join(frames_dir, files[0]), channel=1, frame_start=1)
    for f in files[1:]:
        st.elements.append(f)
    enc.frame_start, enc.frame_end = 1, len(files)
    img = bpy.data.images.load(os.path.join(frames_dir, files[0]))
    # H.264 needs even sizes (633 px wide would fail): round down to even
    enc.render.resolution_x, enc.render.resolution_y = img.size[0] // 2 * 2, img.size[1] // 2 * 2
    enc.render.resolution_percentage = 100
    bpy.data.images.remove(img)
    enc.view_settings.view_transform = "Standard"
    enc.render.image_settings.media_type = "VIDEO"
    enc.render.image_settings.file_format = "FFMPEG"
    ff = enc.render.ffmpeg
    ff.format = "MPEG4"; ff.codec = "H264"
    ff.audio_codec = "NONE"
    if web:
        ff.constant_rate_factor = "NONE"; ff.ffmpeg_preset = "BEST"
        ff.video_bitrate = WEB_KBPS; ff.minrate = 0; ff.maxrate = int(WEB_KBPS * 1.5)
        ff.gopsize = fps
    else:
        ff.constant_rate_factor = "PERC_LOSSLESS"; ff.ffmpeg_preset = "BEST"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    enc.render.filepath = out_path
    enc.render.use_overwrite = True
    with bpy.context.temp_override(scene=enc):
        bpy.ops.render.render(animation=True, scene=enc.name)
    if web:
        sys.path.insert(0, os.path.join(HERE, "tools"))
        from faststart import faststart
        faststart(out_path)
    bpy.data.scenes.remove(enc)
    print(f"[awana] video saved: {out_path}")


# ================================================================== main ===
def build():
    global CTRL
    import time; t0=time.time()
    def tick(m): print(f'[awana] {time.time()-t0:6.1f}s {m}', flush=True)
    sc = reset_scene()
    CTRL = build_control()
    build_world(sc)
    build_lights(sc)
    c_layout = new_coll("Lobby Layout (anamorphic)")
    c_logo = new_coll("Logo + Words")
    c_fly = new_coll("Flight Scenery")
    c_cast = new_coll("Club Characters")
    c_fx = new_coll("Confetti + Egg")

    clouds = build_clouds(c_layout)
    tab = build_corner_tab(c_layout)
    waves = build_house_waves(c_layout)
    logo, glad_top_u, logo_top_u, logo_h_u = build_lockup(c_logo)
    glad = build_glad_line(c_logo, glad_top_u)
    doodles = build_layout_doodles(c_layout, logo_top_u, logo_h_u)
    # Before anything is animated (every animation keys the pieces' rest
    # spots): flatten the lobby screen, then fit it to the measured lobby.
    layout = ([o for o, _ in clouds] + [tab] + [o for o, _ in waves]
              + logo["church"] + logo["awana"] + logo["tagline"] + [glad] + [o for o, _ in doodles])
    for o in layout:
        o.delta_scale = flat_scale(o, FLAT_DEPTH)
    doodles = fit_layout(logo, glad, doodles)
    flatten_bookends(layout)
    tick('build_flight_scenery(')
    build_flight_scenery(c_fly)
    stickers = build_stickers(c_cast)
    tick('build_confetti(')
    protos = build_confetti(c_fx)
    build_dust(c_fly, protos)
    tick('build_egg(')
    build_egg(c_fx)
    build_shockwave(c_fx)

    tick('animate_church(')
    ring = [o for o, _ in doodles if o.name == "Lobby ring"][0]
    build_camera(sc, ring.location.copy())
    peel_words(logo, glad)
    animate_church(logo["church"])
    animate_awana(logo["awana"])
    animate_tagline(logo["tagline"])
    animate_glad(glad)
    animate_floaters(clouds, amp=1.4, seed=21)
    animate_floaters([(tab, tab.location.copy())], amp=0.8, seed=22)
    animate_floaters(waves, amp=0.8, seed=24)
    animate_floaters([d for d in doodles if d[0] is not ring], amp=0.9, seed=23)
    animate_ring_dive(ring)
    tick('animate_stickers(')
    animate_stickers(stickers)
    print(f"[awana] built: church {len(logo['church'])} pieces, awana {len(logo['awana'])}, "
          f"tagline {len(logo['tagline'])}; slam at frame {SLAM}")
    return sc


def main():
    if MODE == "encode":      # just glue already-rendered frames into a video
        which = arg("--which", "final")
        fd = os.path.join(OUT_DIR, f"frames_{which}" + ("" if RATE == FPS else f"_{RATE}"))
        name = "Awana Intro - PREVIEW.mp4" if which == "preview" else "Awana Intro.mp4"
        bpy.ops.wm.read_factory_settings(use_empty=True)
        encode_mp4(fd, os.path.join(OUT_DIR, name))
        if which == "final":
            encode_mp4(fd, LOBBY_COPY, web=True)
        return
    if MODE == "web":         # just the lobby's copy, from the finished frames
        bpy.ops.wm.read_factory_settings(use_empty=True)
        encode_mp4(os.path.join(OUT_DIR, "frames_final" + ("" if RATE == FPS else f"_{RATE}")), LOBBY_COPY, web=True)
        return
    sc = build()
    mode = MODE if MODE in ("preview", "final", "stills") else "final"
    setup_render(sc, mode)
    os.makedirs(OUT_DIR, exist_ok=True)
    blend = os.path.join(OUT_DIR, "Awana Intro.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend, relative_remap=False)
    print(f"[awana] scene saved: {blend}")
    if MODE == "stills":
        frames = [int(f) for f in str(arg("--frames", "1,44,100,150,206,250,268,300,350,400,450")).split(",")]
        sc.render.use_overwrite = True; sc.render.use_placeholder = False
        for f in frames:
            sc.frame_set(f)
            sc.render.filepath = os.path.join(OUT_DIR, "stills", f"frame_{f:04d}" + ("" if RATE == FPS else f"_{RATE}") + ".png")
            bpy.ops.render.render(write_still=True)
            print(f"[awana] still {f} done", flush=True)
    elif MODE in ("preview", "final"):
        # Keep Windows from going to sleep while this render runs (no
        # settings are changed; it lets go automatically when Blender quits)
        if sys.platform == "win32":
            try:
                import ctypes
                ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)
                print("[awana] sleep blocked while rendering")
            except Exception:
                pass
        frames_dir = os.path.join(OUT_DIR, f"frames_{MODE}" + ("" if RATE == FPS else f"_{RATE}"))
        os.makedirs(frames_dir, exist_ok=True)
        # a frame that was mid-render when the laptop slept is an empty
        # placeholder file: delete those so they get rendered again
        for f in os.listdir(frames_dir):
            fp = os.path.join(frames_dir, f)
            if f.endswith(".png") and os.path.getsize(fp) == 0:
                os.remove(fp)
        sc.render.filepath = os.path.join(frames_dir, "frame_####")
        bpy.ops.render.render(animation=True)
        name = "Awana Intro - PREVIEW.mp4" if MODE == "preview" else "Awana Intro.mp4"
        encode_mp4(frames_dir, os.path.join(OUT_DIR, name), fps=RATE // sc.frame_step)
        if MODE == "final":
            # ...and the lobby's own copy (commit it to put it on the TVs)
            encode_mp4(frames_dir, LOBBY_COPY, web=True)


if __name__ == "__main__":
    main()

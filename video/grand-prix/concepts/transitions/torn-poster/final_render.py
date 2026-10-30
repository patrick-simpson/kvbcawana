"""torn-poster FINAL: Cycles, physically based, 1920x1080 @ 60 fps.

blender --factory-startup -b -P final_render.py -- OUTDIR FRAMES [preview]
  FRAMES: "a-b", comma list, or "calib". Global frame numbers of the full promo (60 fps):
    0-59        lobby plate (not rendered; post uses the exact plate)
    60-~155     the RIP (tau = (g-60)/60 s; film plays underneath from film 0.0 s)
    ...         film continues (post uses the film frames directly)
    G_RET0..    the RETURN: the two torn halves float back in and rejoin; tear closes
  preview: low samples, half res, no motion blur (for motion checks).
Writes OUTDIR/g_#####.png (16-bit, Standard view; post.py does the colour calibration).

Motion: all geometry is a pure function of time, set from a frame_change_pre handler,
so Cycles' motion blur (which re-evaluates sub-frames) sees real deformation.
"""
import bpy, sys, os, json, math
import numpy as np
from mathutils import Matrix, Euler, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0]
SPEC = argv[1] if len(argv) > 1 else "calib"
PREVIEW = len(argv) > 2 and argv[2] == "preview"
os.makedirs(OUT, exist_ok=True)

PLATE = r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\lobby-plate-sky.png"
FILMDIR = r"C:\Users\User\scratch-intro\gp\gp-brand\frames1080"

FPS = 60
G_TEAR0 = 60
FILM_END_N = 1706                 # film 28.45 s: end card at rest
G_RET0 = G_TEAR0 + FILM_END_N + 60   # +1.0 s extra rest on the end card
RET_SKIP = 0.45                   # the first 0.45 s of the arc is off-frame: skipped
RET_LEN = 2.7 - RET_SKIP
G_TOTAL = G_RET0 + int(RET_LEN * FPS) + 60

W, H = 19.2, 10.8
D = 25.0
THICK = 0.010                     # paper thickness (world units; 100 px per unit at 1080p)
Z_B = -0.0015
Z_WALL = -(THICK + 0.004 + 0.002)

# ------------------------------------------------------------------ scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
for dev_type in ("OPTIX", "CUDA"):
    try:
        prefs.compute_device_type = dev_type
        prefs.get_devices()
        if any(d.type == dev_type for d in prefs.devices):
            for d in prefs.devices:
                d.use = d.type == dev_type
            break
    except Exception:
        pass
sc.cycles.device = "GPU"
cy = sc.cycles
cy.samples = 24 if PREVIEW else 384
cy.use_adaptive_sampling = True
cy.adaptive_threshold = 0.02 if PREVIEW else 0.006
cy.use_denoising = True
try:
    cy.denoiser = "OPTIX" if not PREVIEW else "OPTIX"
except Exception:
    pass
cy.max_bounces = 6
cy.diffuse_bounces = 3
cy.glossy_bounces = 2
cy.transmission_bounces = 2
cy.transparent_max_bounces = 16
cy.caustics_reflective = cy.caustics_refractive = False
cy.blur_glossy = 1.0
sc.render.use_motion_blur = not PREVIEW
sc.render.motion_blur_shutter = 0.5
try:
    cy.motion_blur_position = "CENTER"
except Exception:
    pass
sc.render.use_lock_interface = True
sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.render.resolution_percentage = 50 if PREVIEW else 100
sc.render.fps = FPS
sc.render.film_transparent = False
sc.render.dither_intensity = 0.0
sc.render.filter_size = 1.2
sc.view_settings.view_transform = "Standard"
sc.view_settings.look = "None"
sc.view_settings.exposure = 0
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGB"
sc.render.image_settings.color_depth = "16"

world = bpy.data.worlds.new("w")
sc.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.22, 0.225, 0.235, 1)
bg.inputs[1].default_value = 1.0

cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 18.0 * D / (W / 2)
cam_data.sensor_fit = "HORIZONTAL"
cam_data.sensor_width = 36
cam_data.clip_start = 0.3
cam_data.clip_end = 200
cam_data.dof.use_dof = not PREVIEW
cam_data.dof.focus_distance = D
cam_data.dof.aperture_fstop = 1.1
cam = bpy.data.objects.new("cam", cam_data)
cam.location = (0, 0, D)
sc.collection.objects.link(cam)
sc.camera = cam

sun_data = bpy.data.lights.new("key", "SUN")
sun_data.energy = 2.4
sun_data.angle = math.radians(14)       # soft key, gentle shadows
sun = bpy.data.objects.new("key", sun_data)
ld = Vector((-0.42, 0.50, 1.0)).normalized()
sun.rotation_mode = "QUATERNION"
sun.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(ld)
sc.collection.objects.link(sun)
sun2 = bpy.data.objects.new("key_noshadow", sun_data.copy())
sun2.rotation_mode = "QUATERNION"
sun2.rotation_quaternion = sun.rotation_quaternion
sc.collection.objects.link(sun2)
KEY_E = sun_data.energy

# ------------------------------------------------------------------ images
img_plate = bpy.data.images.load(PLATE)
img_film = bpy.data.images.load(os.path.join(FILMDIR, "frame_0000.png"))
img_mA = bpy.data.images.load(os.path.join(HERE, "maskF_A.png"))
img_mB = bpy.data.images.load(os.path.join(HERE, "maskF_B.png"))
for im in (img_mA, img_mB):
    im.colorspace_settings.name = "Non-Color"

RIM_UNIFORMS = []
WALLMIX = {}   # (front node, strength node) per material


def node(nt, kind, loc=(0, 0), **kw):
    n = nt.nodes.new(kind)
    n.location = loc
    for k, v in kw.items():
        setattr(n, k, v)
    return n


def paper_bump(nt, uv_socket):
    """Paper fibre micro-relief: stretched noise (fibres) + fine grain."""
    mp = node(nt, "ShaderNodeMapping", (-1200, -700))
    nt.links.new(uv_socket, mp.inputs[0])
    mp.inputs["Scale"].default_value = (900, 260, 1)
    mp.inputs["Rotation"].default_value = (0, 0, 0.4)
    n1 = node(nt, "ShaderNodeTexNoise", (-1000, -700))
    n1.inputs["Scale"].default_value = 1.0
    n1.inputs["Detail"].default_value = 8
    n1.inputs["Roughness"].default_value = 0.65
    nt.links.new(mp.outputs[0], n1.inputs["Vector"])
    n2 = node(nt, "ShaderNodeTexNoise", (-1000, -900))
    n2.inputs["Scale"].default_value = 2400
    n2.inputs["Detail"].default_value = 2
    nt.links.new(uv_socket, n2.inputs["Vector"])
    add = node(nt, "ShaderNodeMath", (-800, -800), operation="ADD")
    nt.links.new(n1.outputs["Fac"], add.inputs[0]); nt.links.new(n2.outputs["Fac"], add.inputs[1])
    bump = node(nt, "ShaderNodeBump", (-600, -800))
    bump.inputs["Strength"].default_value = 0.10
    bump.inputs["Distance"].default_value = 0.0006
    nt.links.new(add.outputs[0], bump.inputs["Height"])
    return bump.outputs["Normal"], n1.outputs["Fac"]


def make_paper(name, mask_img, face):
    """face: 'front' (lobby print), 'back' (plain paper), 'edge' (cut edge)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = node(nt, "ShaderNodeOutputMaterial", (900, 0))
    bsdf = node(nt, "ShaderNodeBsdfPrincipled", (500, 0))
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    bsdf.inputs["Roughness"].default_value = 0.52
    bsdf.inputs["Specular IOR Level"].default_value = 0.32
    tc = node(nt, "ShaderNodeTexCoord", (-1500, 0))
    uv = tc.outputs["UV"]
    nrm, grain = paper_bump(nt, uv)
    nt.links.new(nrm, bsdf.inputs["Normal"])
    paper_rgb = (0.80, 0.785, 0.75, 1)
    if face == "front":
        tex = node(nt, "ShaderNodeTexImage", (-700, 300), image=img_plate, interpolation="Cubic", extension="EXTEND")
        col = tex.outputs["Color"]
    else:
        # plain paper with faint mottling
        mr = node(nt, "ShaderNodeMapRange", (-500, 300))
        nt.links.new(grain, mr.inputs[0])
        mr.inputs[3].default_value = 0.94; mr.inputs[4].default_value = 1.02
        pc = node(nt, "ShaderNodeRGB", (-500, 500)); pc.outputs[0].default_value = paper_rgb
        mul = node(nt, "ShaderNodeVectorMath", (-300, 400), operation="SCALE")
        nt.links.new(pc.outputs[0], mul.inputs[0]); nt.links.new(mr.outputs[0], mul.inputs["Scale"])
        col = mul.outputs[0]
        # thin paper: a little light comes through where it curls in the air
        bsdf.inputs["Subsurface Weight"].default_value = 0.0
    if mask_img is not None:
        mt = node(nt, "ShaderNodeTexImage", (-900, -200), image=mask_img, interpolation="Linear", extension="EXTEND")
        sep = node(nt, "ShaderNodeSeparateColor", (-700, -200))
        nt.links.new(mt.outputs["Color"], sep.inputs[0])
        # torn-ness: 1 behind the rip front (x strength); before it the edge is a hard,
        # clean step so the intact sheet shows no seam at all
        sx = node(nt, "ShaderNodeSeparateXYZ", (-1300, -400))
        nt.links.new(uv, sx.inputs[0])
        fr = node(nt, "ShaderNodeMath", (-1100, -400), operation="SUBTRACT")
        fr.inputs[0].default_value = -1.0
        nt.links.new(sx.outputs[0], fr.inputs[1])
        k = node(nt, "ShaderNodeMath", (-950, -400), operation="MULTIPLY", use_clamp=True)
        nt.links.new(fr.outputs[0], k.inputs[0]); k.inputs[1].default_value = 30
        stn = node(nt, "ShaderNodeValue", (-950, -550)); stn.outputs[0].default_value = 1.0
        k2 = node(nt, "ShaderNodeMath", (-800, -450), operation="MULTIPLY")
        nt.links.new(k.outputs[0], k2.inputs[0]); nt.links.new(stn.outputs[0], k2.inputs[1])
        RIM_UNIFORMS.append((fr, stn))
        hard = node(nt, "ShaderNodeMath", (-700, -600), operation="GREATER_THAN")
        nt.links.new(sep.outputs[0], hard.inputs[0]); hard.inputs[1].default_value = 0.5
        amix = node(nt, "ShaderNodeMix", (-500, -600), data_type="FLOAT")
        nt.links.new(k2.outputs[0], amix.inputs["Factor"])
        nt.links.new(hard.outputs[0], amix.inputs["A"]); nt.links.new(sep.outputs[0], amix.inputs["B"])
        nt.links.new(amix.outputs["Result"], bsdf.inputs["Alpha"])
        if face == "front":
            rk = node(nt, "ShaderNodeMath", (-600, -300), operation="MULTIPLY")
            nt.links.new(sep.outputs[1], rk.inputs[0]); nt.links.new(k2.outputs[0], rk.inputs[1])
            # core colour: fibrous off-white, streaks a touch brighter
            core = node(nt, "ShaderNodeMix", (-400, -100), data_type="RGBA")
            nt.links.new(sep.outputs[2], core.inputs["Factor"])
            core.inputs["A"].default_value = (0.86, 0.85, 0.82, 1)
            core.inputs["B"].default_value = (0.98, 0.98, 0.96, 1)
            mix = node(nt, "ShaderNodeMix", (-150, 100), data_type="RGBA")
            nt.links.new(rk.outputs[0], mix.inputs["Factor"])
            nt.links.new(col, mix.inputs["A"]); nt.links.new(core.outputs["Result"], mix.inputs["B"])
            col = mix.outputs["Result"]
            # the fuzzy core is rougher, no sheen
            rr = node(nt, "ShaderNodeMapRange", (100, -300))
            nt.links.new(rk.outputs[0], rr.inputs[0])
            rr.inputs[3].default_value = 0.52; rr.inputs[4].default_value = 0.9
            nt.links.new(rr.outputs[0], bsdf.inputs["Roughness"])
    nt.links.new(col, bsdf.inputs["Base Color"])
    if face != "front":
        # thin paper in the air: a touch of translucency (only where light passes through)
        tr = node(nt, "ShaderNodeBsdfTranslucent", (500, -300))
        nt.links.new(col, tr.inputs["Color"])
        ms = node(nt, "ShaderNodeMixShader", (750, 0))
        ms.inputs[0].default_value = 0.0
        nt.links.new(bsdf.outputs[0], ms.inputs[1]); nt.links.new(tr.outputs[0], ms.inputs[2])
        nt.links.new(ms.outputs[0], out.inputs["Surface"])
    return mat


def make_wall():
    """The film is a lit SCREEN: 70% self-lit (matched to the paper's flat response from
    calib.json, so post's calibration returns the film exactly), 30% ordinary lit surface,
    so the halves' shadows darken it by at most ~30%."""
    cal = json.load(open(os.path.join(HERE, "calib.json")))
    A = [cal[c][0] for c in "abc"]; Bc = [cal[c][1] for c in "abc"]
    mat = bpy.data.materials.new("wall")
    mat.use_nodes = True
    nt = mat.node_tree; nt.nodes.clear()
    out = node(nt, "ShaderNodeOutputMaterial", (1100, 0))
    bsdf = node(nt, "ShaderNodeBsdfPrincipled", (500, -200))
    bsdf.inputs["Roughness"].default_value = 0.52
    bsdf.inputs["Specular IOR Level"].default_value = 0.32
    tex = node(nt, "ShaderNodeTexImage", (0, 0), image=img_film, interpolation="Cubic", extension="EXTEND")
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    mul = node(nt, "ShaderNodeVectorMath", (300, 200), operation="MULTIPLY")
    nt.links.new(tex.outputs["Color"], mul.inputs[0]); mul.inputs[1].default_value = A
    add = node(nt, "ShaderNodeVectorMath", (500, 200), operation="ADD")
    nt.links.new(mul.outputs[0], add.inputs[0]); add.inputs[1].default_value = Bc
    em = node(nt, "ShaderNodeEmission", (700, 200))
    nt.links.new(add.outputs[0], em.inputs["Color"]); em.inputs["Strength"].default_value = 1.0
    ms = node(nt, "ShaderNodeMixShader", (900, 0))
    ms.inputs[0].default_value = 0.30
    WALLMIX["node"] = ms
    nt.links.new(em.outputs[0], ms.inputs[1]); nt.links.new(bsdf.outputs[0], ms.inputs[2])
    nt.links.new(ms.outputs[0], out.inputs["Surface"])
    return mat


# ------------------------------------------------------------------ meshes
tear = json.load(open(os.path.join(HERE, "tear.json")))
edges = np.load(os.path.join(HERE, "edges1920.npy"))   # yA_core, yB_core per 1920 column


def px2w(x, y):
    return np.array([(x / 1920 - 0.5) * W, (0.5 - y / 1080) * H])


P0 = px2w(tear["x0"], tear["y0"]); P1 = px2w(tear["x1"], tear["y1"])
T = (P1 - P0) / np.linalg.norm(P1 - P0)
NA = np.array([-T[1], T[0]])
SLEN = np.linalg.norm(P1 - P0)
NX, NY = 400, 225
# the real torn edge as an offset from the straight line, as a function of s
_ex = np.arange(1920)
_ey = 0.5 * (edges[0] + edges[1])
_ew = np.stack([(_ex / 1920 - 0.5) * W, (0.5 - _ey / 1080) * H], 1) - P0
_es = _ew @ T
_ed = _ew @ NA
_o = np.argsort(_es)
EDGE_S, EDGE_D = _es[_o], _ed[_o]
# a smooth version: the curl follows the tear's course, the alpha draws its jaggedness
_kk = np.exp(-np.linspace(-2.5, 2.5, 301) ** 2); _kk /= _kk.sum()
EDGE_D = np.convolve(np.pad(EDGE_D, 150, mode="edge"), _kk, "valid")


def build_half(name, which, z0, mats):
    xs = np.linspace(0, 1, NX + 1); ys = np.linspace(0, 1, NY + 1)
    U, V = np.meshgrid(xs, ys)
    px = np.clip(U * 1919, 0, 1919).astype(int)
    rowpx = (1 - V) * 1080
    margin = 14.0   # px: keep a band of cells beyond the torn edge (alpha does the shape)
    if which == "A":
        keep_v = rowpx < edges[0][px] + margin
    else:
        keep_v = rowpx > edges[1][px] - margin
    faces = []
    for j in range(NY):
        for i in range(NX):
            a = j * (NX + 1) + i
            q = (a, a + 1, a + NX + 2, a + NX + 1)
            if keep_v.ravel()[list(q)].any():
                faces.append(q)
    used = np.unique(np.array(faces).ravel())
    remap = -np.ones((NX + 1) * (NY + 1), int); remap[used] = np.arange(len(used))
    Uu = U.ravel()[used]; Vu = V.ravel()[used]
    verts = np.stack([(Uu - 0.5) * W, (Vu - 0.5) * H, np.full_like(Uu, z0)], 1)
    faces = [tuple(remap[list(f)]) for f in faces]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist(), [], faces)
    uvl = me.uv_layers.new(name="UVMap")
    lv = np.zeros(len(me.loops), int); me.loops.foreach_get("vertex_index", lv)
    uvl.data.foreach_set("uv", np.stack([Uu[lv], Vu[lv]], 1).ravel())
    me.polygons.foreach_set("use_smooth", np.ones(len(me.polygons), bool))
    me.update()
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    for m in mats:
        me.materials.append(m)
    sol = ob.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = THICK
    sol.offset = -1
    sol.use_rim = False
    sol.material_offset = 1
    sol.material_offset_rim = 2
    sol.use_even_offset = False
    sol.use_quality_normals = True
    ob.data.shade_smooth()
    return ob, verts


matsA = [make_paper("A_front", img_mA, "front"), make_paper("A_back", img_mA, "back"), make_paper("A_edge", img_mA, "edge")]
matsB = [make_paper("B_front", img_mB, "front"), make_paper("B_back", img_mB, "back"), make_paper("B_edge", img_mB, "edge")]
obA, restA = build_half("sheetA", "A", 0.0, matsA)
obB, restB = build_half("sheetB", "B", Z_B, matsB)

# wall (the film), scaled so it still fills the frame exactly from the camera
ws = (D - Z_WALL) / D
me = bpy.data.meshes.new("wall")
me.from_pydata([(-W / 2 * ws, -H / 2 * ws, Z_WALL), (W / 2 * ws, -H / 2 * ws, Z_WALL),
                (W / 2 * ws, H / 2 * ws, Z_WALL), (-W / 2 * ws, H / 2 * ws, Z_WALL)], [], [(0, 1, 2, 3)])
uvl = me.uv_layers.new(name="UVMap")
uvl.data.foreach_set("uv", [0, 0, 1, 0, 1, 1, 0, 1])
obW = bpy.data.objects.new("wall", me)
sc.collection.objects.link(obW)
me.materials.append(make_wall())

# the halves' shadows fade out once they are far off the wall (shadow linking):
# key_noshadow is the same sun, but only the small bits block it
blk = bpy.data.collections.new("blockers_small")
sun2.light_linking.blocker_collection = blk


def set_shadow_strength(k):
    sun.data.energy = KEY_E * k
    sun2.data.energy = KEY_E * (1 - k)


# ------------------------------------------------------------------ fragments & dust
rng = np.random.default_rng(5)
frag_mat_front = make_paper("frag_front", None, "front")
frag_mat_back = make_paper("frag_back", None, "back")
FRAGS = []
for i in range(34):
    sN = rng.uniform(0.04, 0.97)
    side = 1 if rng.random() < 0.55 else -1
    r = rng.uniform(0.035, 0.12)
    n = rng.integers(4, 7)
    angs = np.sort(rng.uniform(0, 2 * math.pi, n))
    rad = r * rng.uniform(0.45, 1.0, n)
    loc = np.stack([np.cos(angs) * rad, np.sin(angs) * rad * rng.uniform(0.3, 0.8)], 1)
    p0 = P0 + sN * SLEN * T + side * NA * rng.uniform(0.01, 0.05)
    uvc = p0 / np.array([W, H]) + 0.5
    me = bpy.data.meshes.new("frag%d" % i)
    me.from_pydata([(x, y, 0) for x, y in loc], [], [tuple(range(n))])
    uvl = me.uv_layers.new(name="UVMap")
    uvl.data.foreach_set("uv", np.array([[uvc[0] + x / W, uvc[1] + y / H] for x, y in loc]).ravel())
    ob = bpy.data.objects.new("frag%d" % i, me)
    sc.collection.objects.link(ob)
    blk.objects.link(ob)
    me.materials.append(frag_mat_front); me.materials.append(frag_mat_back); me.materials.append(frag_mat_back)
    so = ob.modifiers.new("t", "SOLIDIFY"); so.thickness = THICK; so.offset = -1; so.material_offset = 1; so.material_offset_rim = 2
    FRAGS.append(dict(ob=ob, sN=sN, p0=np.array([p0[0], p0[1], 0.004]),
                      v=np.concatenate([side * NA * rng.uniform(0.8, 3.0) + T * rng.uniform(-0.8, 0.8), [rng.uniform(4, 13)]]),
                      w=rng.normal(0, 9, 3), e0=rng.uniform(0, 6.28, 3)))

dust_mat = bpy.data.materials.new("dust")
dust_mat.use_nodes = True
dn = dust_mat.node_tree.nodes["Principled BSDF"]
dn.inputs["Base Color"].default_value = (0.85, 0.84, 0.80, 1)
dn.inputs["Roughness"].default_value = 0.9
dmesh = bpy.data.meshes.new("dustmesh")
import bmesh
bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0); bm.to_mesh(dmesh); bm.free()
dmesh.materials.append(dust_mat)
DUST = []
for i in range(140):
    sN = rng.uniform(0.0, 1.0)
    side = 1 if rng.random() < 0.5 else -1
    p0 = P0 + sN * SLEN * T + side * NA * rng.uniform(0.0, 0.05)
    ob = bpy.data.objects.new("dust%d" % i, dmesh)
    sc.collection.objects.link(ob)
    blk.objects.link(ob)
    DUST.append(dict(ob=ob, sN=sN, p0=np.array([p0[0], p0[1], 0.005]), size=rng.uniform(0.006, 0.02) * (1 + 2 * (rng.random() < 0.08)),
                     v=np.concatenate([side * NA * rng.uniform(0.2, 1.5) + T * rng.uniform(-0.6, 0.6), [rng.uniform(1.5, 9.0)]]),
                     sq=rng.uniform(0.4, 1.0, 3)))


# ------------------------------------------------------------------ motion
def sm(x):
    x = np.clip(x, 0, 1); return x * x * (3 - 2 * x)


def smr(x):
    x = np.clip(x, 0, 1); return x * x * x * (x * (6 * x - 15) + 10)


def ramp(t, a, b):
    return np.clip((t - a) / (b - a), 0, 1)


# rip front (fraction of the line, bottom-left -> top-right) vs tau: a slow, stuttering
# first crack, then it RIPS (with two catches)
RIP_KEYS = [(0.45, -0.12), (0.56, 0.035), (0.62, 0.045), (0.74, 0.10), (0.80, 0.105),
            (0.86, 0.13), (0.91, 0.36), (0.935, 0.40), (0.975, 0.70), (0.99, 0.72), (1.04, 1.12)]


def rip_front(tau):
    ks = RIP_KEYS
    if tau <= ks[0][0]:
        return ks[0][1]
    for (t0, v0), (t1, v1) in zip(ks, ks[1:]):
        if tau <= t1:
            u = (tau - t0) / (t1 - t0)
            u = u * u * (3 - 2 * u) * 0.5 + u * 0.5
            return v0 + (v1 - v0) * u
    return ks[-1][1]


G_A, G_B = float(os.environ.get("TP_GA", 1.0)), float(os.environ.get("TP_GB", 1.50))
OUT_K, OUT_P, LIFT_K, LIFT_P = float(os.environ.get("TP_OK", -11)), float(os.environ.get("TP_OP", 1.5)), float(os.environ.get("TP_LK", 26)), float(os.environ.get("TP_LP", 1.7))


def tear_state(tau, half):
    """All the knobs for one half at tear time tau (s)."""
    dl = 0.0 if half == "A" else 0.05          # B follows a beat later (overlap)
    t = tau - dl
    st = {}
    st["front"] = rip_front(tau)
    # strain: the sheet bulges and trembles along the line before it goes
    strain = sm(ramp(tau, 0.0, 0.42)) * (1 - sm(ramp(tau, 0.86, 1.0)))
    st["bulge"] = 0.16 * strain * (1 + 0.10 * math.sin(tau * 2 * math.pi * 23))
    q = ramp(t, 0.82, 1.47)
    st["q"] = (q ** 1.6) * 3.2
    st["R"] = 0.42 + 0.8 * q
    w = ramp(t, 0.96, 1.50)
    st["omega"] = math.radians(62) * sm(w) ** 1.2
    g = ramp(t, G_A, G_B)
    # first they peel apart (outward), then get whipped up toward the camera and
    # sweep inward across the lens
    st["out"] = 1.6 * sm(ramp(t, 0.92, 1.22)) + OUT_K * ramp(t, 1.17, G_B) ** OUT_P
    st["lift"] = LIFT_K * g ** LIFT_P
    st["roll"] = math.radians(18) * g ** 1.5 * (1 if half == "A" else -1)
    st["open"] = 1.0
    st["ripple"] = None
    return st


def return_state(rho, half):
    """The two halves come back through the AIR and rejoin along the tear."""
    dl = 0.0 if half == "B" else 0.08
    t = rho - dl
    st = {}
    st["front"] = 1.12
    st["bulge"] = 0.0
    ph = 0.0 if half == "A" else 1.9
    # an arc: in from beyond the frame edge, high off the wall; it travels in first,
    # then sinks onto the wall (air resistance: slows as it comes down)
    a = ramp(t, 0.0, 1.35)
    ea = 1 - (1 - a) ** 2.2
    st["out"] = 7.0 * (1 - ea)
    dn = sm(ramp(t, 0.35, 1.85))
    st["lift"] = 10.0 * (1 - dn) ** 1.3 + 2.0 * math.sin(math.pi * min(a * 1.1, 1.0)) * (1 - dn)
    # drift across and flutter (a light sheet in air)
    air = 1 - sm(ramp(t, 1.1, 1.9))
    st["drift"] = 0.9 * air * math.sin(2 * math.pi * 0.45 * t + ph)
    st["roll"] = math.radians(9) * air * math.sin(2 * math.pi * 0.9 * t + ph + 0.6)
    st["omega"] = (math.radians(26) * (1 - sm(ramp(t, 0.3, 1.8))) ** 1.2
                   + math.radians(5) * air * math.sin(2 * math.pi * 1.3 * t + ph))
    st["omega"] = max(st["omega"], 0.0)
    # the leading (torn) edge lifts on the air, never rolls over
    lq = 1 - sm(ramp(t, 1.2, 2.05))
    st["q"] = 0.85 * lq ** 1.3 * (1 + 0.15 * math.sin(2 * math.pi * 1.7 * t + ph))
    st["R"] = 0.8 + 0.7 * lq
    st["open"] = 1 - smr(ramp(rho, 1.85, 2.12))
    st["ripple"] = ramp(rho, 2.05, 2.45)
    return st


def deform_half(rest, Nh, st, z0, half):
    p = rest[:, :2] - P0
    s = p @ T
    de = np.interp(s, EDGE_S, EDGE_D) * (1 if half == "A" else -1)
    d = p @ Nh - de          # distance from the actual torn edge
    sn = s / SLEN
    dmax = d.max()
    front = st["front"] * SLEN
    opened = np.clip((front - s) / 1.6, 0, 1) * st["open"]
    lead = 1.0 + 0.45 * (1 - sn) if half == "A" else 1.0 + 0.45 * (1 - sn)
    c = (0.12 * opened + st["q"]) * lead * np.clip(opened * 3, 0, 1)
    c = np.maximum(c, 0)
    R = st["R"]
    th = np.maximum(c - d, 0) / R
    thc = np.minimum(th, math.pi)
    dd = np.where(th <= math.pi, c - R * np.sin(thc), c + (th - math.pi) * R)
    zz = np.where(th <= math.pi, R * (1 - np.cos(thc)), 2 * R)
    inside = (d < c) & (opened > 0.001)
    zz = np.where(inside, zz, 0.0)
    dd = np.where(inside, dd, d)
    dd = dd + 0.09 * opened + de               # the crack opens; back to line frame
    d = d + de
    # flap: swings up about its far side toward the camera
    om = st["omega"]
    Dh = dmax + 0.4
    u = Dh - dd
    along = u * math.cos(om) - zz * math.sin(om)
    zn = u * math.sin(om) + zz * math.cos(om)
    dd = Dh - along
    # strain bulge along the line
    if st["bulge"]:
        b = st["bulge"]
        zn = zn + b * np.exp(-(d / 0.65) ** 2) * (0.75 + 0.25 * np.sin(s * 1.7))
        # tension wrinkles fanning off the line
        dA = d if half == "A" else -d
        zn = zn + 0.06 * b * np.sin(s * 5.0 + dA * 1.5) * np.exp(-(dA / 1.0) ** 2)
    # settle ripple (return): a low wave running from the far edge to the tear, decaying
    if st.get("ripple") is not None and 0 < st["ripple"] < 1:
        r = st["ripple"]
        pos = dmax * (1 - r)
        amp = 0.035 * (1 - r) ** 1.5
        zn = zn + amp * np.exp(-((d - pos) / 0.9) ** 2)
    # whole-half rigid move: off the wall toward the camera, outward, rolled about the line
    out = st["out"]; lift = st["lift"]
    dd = dd + out
    if st["roll"]:
        # roll about an axis along the line through the half's middle
        mid = dmax * 0.5 + out
        cr, sr = math.cos(st["roll"]), math.sin(st["roll"])
        y1 = dd - mid
        dd = mid + y1 * cr - zn * sr
        zn = y1 * sr + zn * cr
    zn = zn + lift
    ss = s + st.get("drift", 0.0)
    xy = P0 + np.outer(ss, T) + np.outer(dd, Nh)
    return np.column_stack([xy, zn + z0])


def set_verts(ob, co):
    ob.data.vertices.foreach_set("co", co.astype(np.float32).ravel())
    ob.data.update()


FILM_LOADED = {"n": -1}


def set_film(n):
    n = int(max(0, min(1799, n)))
    if FILM_LOADED["n"] != n:
        img_film.filepath = os.path.join(FILMDIR, "frame_%04d.png" % n)
        img_film.reload()
        FILM_LOADED["n"] = n


def film_n_for(g):
    if g < G_TEAR0:
        return 0
    if g < G_RET0:
        return min(g - G_TEAR0, FILM_END_N)
    return FILM_END_N


def pose(gt):
    """Pose everything for global time gt (frames, fractional)."""
    if gt < G_RET0 - 1:
        tau = (gt - G_TEAR0) / FPS
        stA = tear_state(max(tau, 0), "A"); stB = tear_state(max(tau, 0), "B")
        if tau <= 0:
            set_verts(obA, restA); set_verts(obB, restB)
        else:
            set_verts(obA, deform_half(restA, NA, stA, 0.0, "A"))
            set_verts(obB, deform_half(restB, -NA, stB, Z_B, "B"))
        frontuv = (P0 + stA["front"] * SLEN * T)[0] / W + 0.5 if tau > 0 else -1.0
        for fr, stn in RIM_UNIFORMS:
            fr.inputs[0].default_value = frontuv
            stn.outputs[0].default_value = 1.0
        # fragments and dust break off as the rip passes them
        for F in FRAGS + DUST:
            t_sp = None
            # time the front reaches sN
            for tt in np.linspace(0.45, 1.05, 121):
                if rip_front(tt) >= F["sN"]:
                    t_sp = tt; break
            age = tau - (t_sp if t_sp is not None else 99)
            ob = F["ob"]
            if age <= 0:
                ob.scale = (0, 0, 0) if "size" in F else (0.0001, 0.0001, 0.0001)
                ob.location = tuple(F["p0"])
                continue
            v = F["v"]
            grav = np.array([0, -2.6 if "size" not in F else -0.6, 0])
            drag = 1 - math.exp(-age * 1.4)
            pos = F["p0"] + v * drag / 1.4 + 0.5 * grav * age * age
            pos[2] += 6.0 * max(age - 0.25, 0) ** 2      # sucked along toward the camera
            ob.location = tuple(pos)
            if "size" in F:
                s0 = F["size"]; ob.scale = tuple(s0 * F["sq"])
                ob.rotation_euler = tuple(F["sq"] * age * 7)
            else:
                ob.scale = (1, 1, 1)
                ob.rotation_euler = tuple(F["e0"] * 0 + F["w"] * age)
        # a tiny camera reaction to the rip (3 frames), nothing on the rest frames
        k = tau - 0.86
        if 0 < k < 0.09:
            amp = math.sin(math.pi * k / 0.09) * math.exp(-k / 0.05)
            cam.location = (0.035 * amp, -0.025 * amp, D)
        else:
            cam.location = (0, 0, D)
        set_film(film_n_for(int(round(gt))))
        set_shadow_strength(1 - sm(ramp(tau, 1.18, 1.48)))
        WALLMIX["node"].inputs[0].default_value = 0.30
    else:
        rho = (gt - G_RET0) / FPS + RET_SKIP
        for F in FRAGS + DUST:
            F["ob"].scale = (0, 0, 0)
        cam.location = (0, 0, D)
        if rho >= 2.5:
            set_verts(obA, restA); set_verts(obB, restB)
        else:
            set_verts(obA, deform_half(restA, NA, return_state(max(rho, 0), "A"), 0.0, "A"))
            set_verts(obB, deform_half(restB, -NA, return_state(max(rho, 0), "B"), Z_B, "B"))
        heal = 1 - sm(ramp(rho, 2.10, 2.36))
        set_shadow_strength(sm(ramp(rho, 0.35, 1.0)))
        # the halves shade the end card under them as they come down (the card is a
        # screen, but close paper still darkens it), so nothing reads through the tear
        WALLMIX["node"].inputs[0].default_value = 0.30 + 0.45 * sm(ramp(rho, 0.6, 1.4))
        for fr, stn in RIM_UNIFORMS:
            fr.inputs[0].default_value = 2.0
            stn.outputs[0].default_value = heal
        set_film(FILM_END_N)


def handler(scene, depsgraph=None):
    pose(scene.frame_current + scene.frame_subframe)


bpy.app.handlers.frame_change_pre.clear()
bpy.app.handlers.frame_change_pre.append(handler)


def parse(spec):
    out = []
    for part in spec.split(","):
        if "-" in part:
            a, b = part.split("-"); out += list(range(int(a), int(b) + 1))
        else:
            out.append(int(part))
    return out


if SPEC == "none":
    frames = []
elif SPEC == "calib":
    frames = [G_TEAR0]           # the flat sheet, at rest, with the full lighting
else:
    frames = parse(SPEC)
import time
PROG = os.environ.get("TP_PROGRESS")
t_start = time.time(); t_note = time.time()
for i_f, g in enumerate(frames):
    t0 = time.time()
    tau_g = (g - G_TEAR0) / FPS
    sc.render.motion_blur_shutter = 0.12 if (g < G_RET0 and tau_g < 0.86) else 0.45
    sc.frame_set(g)
    sc.render.filepath = os.path.join(OUT, "g_%05d.png" % g)
    bpy.ops.render.render(write_still=True)
    print("FRAME", g, "%.1fs" % (time.time() - t0), flush=True)
    if PROG and (time.time() - t_note > 600 or i_f == len(frames) - 1):
        t_note = time.time()
        done = i_f + 1
        with open(PROG, "a") as fp:
            fp.write("%s torn-poster render: %d/%d frames, avg %.1f s/frame" % (
                time.strftime("%H:%M"), done, len(frames), (time.time() - t_start) / done) + chr(10))

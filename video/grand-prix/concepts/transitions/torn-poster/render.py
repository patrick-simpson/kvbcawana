"""torn-poster: Blender (EEVEE) renderer, frame by frame.

blender --factory-startup -b -P render.py -- OUTDIR [frames]
  frames: "all" (default), "a-b", or comma list. Writes OUTDIR/f_0000.png ...

Timeline (30 fps output, 960x540):
  0-29     lobby plate still (rendered flat)
  30-~95   TEAR: the sheet rips along the Grand Prix torn diagonal, both halves
           curl back from the tear and peel off toward/past the camera; film
           plays underneath from film 0.0 s
  ..-179   the film's opening plays (to film 5.0 s)
  180-224  hard cut ("...skipping the middle...") to the red end card (film 25.0 s)
  225-284  RETURN: the whole lobby sheet swings in from the left like a turned page
           (plain paper back first), lands left edge first, rolls flat onto the
           wall, a soft air-cushion settle, exactly flat
  285-314  plate still
"""
import bpy, sys, os, json, math
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else os.path.join(HERE, "frames")
SPEC = argv[1] if len(argv) > 1 else "all"
os.makedirs(OUT, exist_ok=True)

PLATE = r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\lobby-plate-sky.png"
FILMDIR = r"C:\Users\User\scratch-intro\gp\gp-brand\frames1080"

FPS = 30
T_TEAR = 30          # output frame the tear starts
FILM_T0 = 0.0        # film time at T_TEAR
F_CUT = 180          # hard cut to the end card
END_CARD_T = 25.0
T_RET = 220          # return starts
N_FRAMES = 315

W, H = 19.2, 10.8    # world size of the 1920x1080 plane
D = 25.0             # camera distance
Z_B = -0.0012        # lower-right half sits a hair behind the upper-left one
Z_FILM = -0.004

# ---------------------------------------------------------------- scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
sc = bpy.context.scene
for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
    try:
        sc.render.engine = eng
        break
    except TypeError:
        pass
sc.render.resolution_x, sc.render.resolution_y = 960, 540
sc.render.resolution_percentage = 100
sc.render.fps = FPS
sc.render.film_transparent = False
sc.render.dither_intensity = 0.0
sc.render.filter_size = float(os.environ.get("TP_FILTER", "1.0"))
sc.view_settings.view_transform = "Standard"
sc.view_settings.look = "None"
sc.view_settings.exposure = 0
sc.view_settings.gamma = 1
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGB"
sc.render.image_settings.color_depth = "8"
ee = sc.eevee
ee.taa_render_samples = 48
for attr, val in (("use_shadows", True), ("shadow_ray_count", 3), ("shadow_step_count", 8),
                  ("use_raytracing", False), ("fast_gi_method", "GLOBAL_ILLUMINATION")):
    try:
        setattr(ee, attr, val)
    except Exception:
        pass

world = bpy.data.worlds.new("w")
sc.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.35, 0.35, 0.35, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0

cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 18.0 * D / (W / 2)   # 36 mm sensor: half-width 9.6 at z=0
cam_data.sensor_fit = "HORIZONTAL"
cam_data.sensor_width = 36
cam_data.clip_start = 0.05
cam_data.clip_end = 200
cam = bpy.data.objects.new("cam", cam_data)
cam.location = (0, 0, D)
sc.collection.objects.link(cam)
sc.camera = cam

sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = 2.6
sun_data.angle = math.radians(9)   # soft shadows
sun = bpy.data.objects.new("sun", sun_data)
# light comes from upper-left, in front of the wall
ld = np.array([-0.45, 0.55, 1.0]); ld /= np.linalg.norm(ld)
sun.rotation_mode = "QUATERNION"
from mathutils import Vector
sun.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(Vector(ld))
sc.collection.objects.link(sun)


# ---------------------------------------------------------------- meshes
def grid(name, nx, ny, z, scale=1.0):
    xs = np.linspace(0, 1, nx + 1)
    ys = np.linspace(0, 1, ny + 1)
    U, V = np.meshgrid(xs, ys)          # rows = v
    U = U.ravel(); V = V.ravel()
    verts = np.stack([(U - 0.5) * W * scale, (V - 0.5) * H * scale, np.full_like(U, z)], 1)
    faces = []
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist(), [], faces)
    uv = me.uv_layers.new(name="UVMap")
    loop_v = np.zeros(len(me.loops), int)
    me.loops.foreach_get("vertex_index", loop_v)
    uvs = np.stack([U[loop_v], V[loop_v]], 1).ravel()
    uv.data.foreach_set("uv", uvs)
    me.polygons.foreach_set("use_smooth", np.ones(len(me.polygons), bool))
    me.update()
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    return ob, verts


img_plate = bpy.data.images.load(PLATE)
img_film = bpy.data.images.load(os.path.join(FILMDIR, "frame_0000.png"))
img_mA = bpy.data.images.load(os.path.join(HERE, "mask_A.png"))
img_mB = bpy.data.images.load(os.path.join(HERE, "mask_B.png"))
for im in (img_mA, img_mB):
    im.colorspace_settings.name = "Non-Color"

NORM = {"v": 1.0}
SHADOW = {}   # flat-lit diffuse value, calibrated below
norm_nodes = []
rim_nodes = []


def lit_factor(nt, x0):
    """ShaderToRGB(white diffuse) / flat value, clamped. 1.0 exactly when flat & unshadowed."""
    N = nt.nodes
    dif = N.new("ShaderNodeBsdfDiffuse"); dif.location = (x0, -300)
    dif.inputs["Color"].default_value = (1, 1, 1, 1)
    s2r = N.new("ShaderNodeShaderToRGB"); s2r.location = (x0 + 200, -300)
    nt.links.new(dif.outputs[0], s2r.inputs[0])
    sep = N.new("ShaderNodeSeparateColor"); sep.location = (x0 + 400, -300)
    nt.links.new(s2r.outputs["Color"], sep.inputs[0])
    div = N.new("ShaderNodeMath"); div.operation = "DIVIDE"; div.location = (x0 + 600, -300)
    nt.links.new(sep.outputs[1], div.inputs[0])
    div.inputs[1].default_value = 1.0
    norm_nodes.append(div)
    mn = N.new("ShaderNodeMath"); mn.operation = "MINIMUM"; mn.location = (x0 + 800, -300)
    nt.links.new(div.outputs[0], mn.inputs[0]); mn.inputs[1].default_value = 1.12
    return mn.outputs[0]


def emit_out(nt, color_socket, alpha_socket=None):
    N = nt.nodes
    out = N.new("ShaderNodeOutputMaterial"); out.location = (1800, 0)
    em = N.new("ShaderNodeEmission"); em.location = (1400, 0)
    nt.links.new(color_socket, em.inputs["Color"])
    em.inputs["Strength"].default_value = 1.0
    if alpha_socket is None:
        nt.links.new(em.outputs[0], out.inputs["Surface"])
    else:
        tr = N.new("ShaderNodeBsdfTransparent"); tr.location = (1400, 150)
        mix = N.new("ShaderNodeMixShader"); mix.location = (1600, 0)
        nt.links.new(alpha_socket, mix.inputs[0])
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(em.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])


def mul_col(nt, col, fac, loc):
    m = nt.nodes.new("ShaderNodeVectorMath"); m.operation = "SCALE"; m.location = loc
    nt.links.new(col, m.inputs[0]); nt.links.new(fac, m.inputs["Scale"])
    return m.outputs[0]


def paper_material(name, mask_img):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    for attr, val in (("use_transparent_shadow", True), ("use_backface_culling", False),
                      ("surface_render_method", "DITHERED"), ("blend_method", "HASHED")):
        try:
            setattr(mat, attr, val)
        except Exception:
            pass
    nt = mat.node_tree; N = nt.nodes
    N.clear()
    tex = N.new("ShaderNodeTexImage"); tex.image = img_plate; tex.location = (-900, 200)
    tex.interpolation = "Linear"; tex.extension = "EXTEND"
    front = tex.outputs["Color"]
    alpha = None
    if mask_img is not None:
        mt = N.new("ShaderNodeTexImage"); mt.image = mask_img; mt.location = (-900, -100)
        mt.extension = "EXTEND"
        sep = N.new("ShaderNodeSeparateColor"); sep.location = (-650, -100)
        nt.links.new(mt.outputs["Color"], sep.inputs[0])
        alpha = sep.outputs[0]
        # rim shows only behind the rip front: rim * clamp((front - uv.x) * 40, 0, 1)
        tc = N.new("ShaderNodeTexCoord"); tc.location = (-900, -400)
        sxyz = N.new("ShaderNodeSeparateXYZ"); sxyz.location = (-700, -400)
        nt.links.new(tc.outputs["UV"], sxyz.inputs[0])
        sub = N.new("ShaderNodeMath"); sub.operation = "SUBTRACT"; sub.location = (-500, -400)
        sub.inputs[0].default_value = -1.0   # rip front (uv.x), animated
        nt.links.new(sxyz.outputs[0], sub.inputs[1])
        rim_nodes.append(sub)
        k = N.new("ShaderNodeMath"); k.operation = "MULTIPLY"; k.use_clamp = True; k.location = (-300, -400)
        nt.links.new(sub.outputs[0], k.inputs[0]); k.inputs[1].default_value = 40
        rk = N.new("ShaderNodeMath"); rk.operation = "MULTIPLY"; rk.location = (-150, -250)
        nt.links.new(sep.outputs[1], rk.inputs[0]); nt.links.new(k.outputs[0], rk.inputs[1])
        rimcol = N.new("ShaderNodeRGB"); rimcol.location = (-300, 0)
        rimcol.outputs[0].default_value = (0.86, 0.84, 0.80, 1)   # paper core (linear)
        mixr = N.new("ShaderNodeMix"); mixr.data_type = "RGBA"; mixr.location = (0, 150)
        nt.links.new(rk.outputs[0], mixr.inputs["Factor"])
        nt.links.new(front, mixr.inputs["A"]); nt.links.new(rimcol.outputs[0], mixr.inputs["B"])
        front = mixr.outputs["Result"]
    # back: plain paper with faint grain
    noise = N.new("ShaderNodeTexNoise"); noise.location = (-600, 500)
    noise.inputs["Scale"].default_value = 180
    noise.inputs["Detail"].default_value = 6
    ramp = N.new("ShaderNodeMapRange"); ramp.location = (-400, 500)
    nt.links.new(noise.outputs["Fac"], ramp.inputs[0])
    ramp.inputs[3].default_value = 0.80; ramp.inputs[4].default_value = 0.86
    backc = N.new("ShaderNodeCombineColor"); backc.location = (-200, 500)
    for i, mul in enumerate((1.0, 0.985, 0.95)):
        m = N.new("ShaderNodeMath"); m.operation = "MULTIPLY"; m.location = (-300, 650 + i * 60)
        nt.links.new(ramp.outputs[0], m.inputs[0]); m.inputs[1].default_value = mul
        nt.links.new(m.outputs[0], backc.inputs[i])
    geo = N.new("ShaderNodeNewGeometry"); geo.location = (0, 400)
    mixb = N.new("ShaderNodeMix"); mixb.data_type = "RGBA"; mixb.location = (300, 200)
    nt.links.new(geo.outputs["Backfacing"], mixb.inputs["Factor"])
    nt.links.new(front, mixb.inputs["A"]); nt.links.new(backc.outputs[0], mixb.inputs["B"])
    lit = lit_factor(nt, 0)
    col = mul_col(nt, mixb.outputs["Result"], lit, (1100, 0))
    emit_out(nt, col, alpha)
    return mat


def film_material():
    mat = bpy.data.materials.new("film")
    mat.use_nodes = True
    nt = mat.node_tree; N = nt.nodes; N.clear()
    tex = N.new("ShaderNodeTexImage"); tex.image = img_film; tex.extension = "EXTEND"
    lit = lit_factor(nt, 0)
    # shadow strength on the wall (fades as a sheet flies off toward the camera)
    mx = N.new("ShaderNodeMix"); mx.data_type = "FLOAT"; mx.location = (900, -200)
    mx.inputs["Factor"].default_value = 1.0
    mx.inputs["A"].default_value = 1.0
    nt.links.new(lit, mx.inputs["B"])
    SHADOW["node"] = mx
    col = mul_col(nt, tex.outputs["Color"], mx.outputs["Result"], (1100, 0))
    emit_out(nt, col)
    return mat


NX, NY = 256, 144
obA, restA = grid("sheetA", NX, NY, 0.0)
obB, restB = grid("sheetB", NX, NY, Z_B)
obR, restR = grid("sheetR", NX, NY, 0.0)
film_scale = (D - Z_FILM) / D
obF, _ = grid("film", 1, 1, Z_FILM, film_scale)
obA.data.materials.append(paper_material("paperA", img_mA))
obB.data.materials.append(paper_material("paperB", img_mB))
obR.data.materials.append(paper_material("paperR", None))
obF.data.materials.append(film_material())

# ---------------------------------------------------------------- tear frame
tear = json.load(open(os.path.join(HERE, "tear.json")))
def px2w(x, y):
    return np.array([(x / 1920 - 0.5) * W, (0.5 - y / 1080) * H])
P0 = px2w(tear["x0"], tear["y0"])
P1 = px2w(tear["x1"], tear["y1"])
T = (P1 - P0) / np.linalg.norm(P1 - P0)
NA = np.array([-T[1], T[0]])         # points up-left (into half A)
SLEN = np.linalg.norm(P1 - P0)


def ease_in_out(x):
    x = np.clip(x, 0, 1)
    return x * x * x * (x * (6 * x - 15) + 10)


def ramp(t, a, b):
    return np.clip((t - a) / (b - a), 0, 1)


def deform_half(rest, Nh, tau, delay, z0):
    p = rest[:, :2] - P0
    s = p @ T
    d = p @ Nh
    sn = s / SLEN
    dmax = d.max()
    tau = tau / 1.2
    t = tau - delay
    # rip front runs bottom-left -> top-right
    front = (ease_in_out(ramp(tau, 0.10, 0.42)) * 1.25 - 0.1) * SLEN
    opened = np.clip((front - s) / 2.0, 0, 1)
    # curl: rolls back from the tear, the rip's start leading
    q = ramp(t, 0.30, 1.75)
    q = q * q * (3 - 2 * q) * 0.6 + q ** 2.2 * 0.4
    lead = 1.0 + 0.35 * (1 - sn)
    c = (0.25 * opened + 5.0 * q) * lead * opened
    R = 0.45 + 1.6 * q
    th = np.maximum(c - d, 0) / R
    dd = np.where(th <= math.pi, c - R * np.sin(np.minimum(th, math.pi)), c + (th - math.pi) * R)
    zz = np.where(th <= math.pi, R * (1 - np.cos(np.minimum(th, math.pi))), 2 * R)
    zz = np.where(d < c, zz, 0.0)
    dd = np.where(d < c, dd, d)
    # crack opens a few px as the rip passes
    dd = dd + 0.07 * opened
    # flap: the whole half swings up about its far side toward the camera
    w = ramp(t, 0.55, 2.0)
    om = (w ** 1.8) * math.radians(125)
    Dh = dmax + 0.4
    u = Dh - dd
    along = u * math.cos(om) - zz * math.sin(om)
    znew = u * math.sin(om) + zz * math.cos(om)
    dd = Dh - along
    # and leaves: outward and up, accelerating
    g = ramp(t, 1.0, 2.2) ** 2.4
    dd = dd + 9.0 * g
    znew = znew + 13.0 * g
    ss = s + 1.5 * g * (1 if Nh[1] > 0 else -1)
    # a little bulge along the line before the rip (tension)
    pre = ramp(tau, 0.0, 0.18) * (1 - ramp(tau, 0.25, 0.45))
    znew = znew + 0.05 * pre * np.exp(-(d / 0.8) ** 2)
    xy = P0 + np.outer(ss, T) + np.outer(dd, Nh)
    return np.column_stack([xy, znew + z0]), front / SLEN


def uvx_of_front(fs):
    # rip front in sheet uv.x: s along the line -> x pixel
    pt = P0 + fs * SLEN * T
    return pt[0] / W + 0.5


def deform_return(rest, tau):
    x = rest[:, 0] + W / 2           # arc length from the hinge (left edge)
    y = rest[:, 1]
    L = W
    # swing: comes in from off-frame left, tilted toward the camera, gliding right
    # while it lies down; touches the wall left edge first and rolls on
    TS = 1.6
    sw = ramp(tau, 0.0, TS)
    e = sw * sw * (3 - 2 * sw)
    e = 0.75 * e + 0.25 * (1 - (1 - sw) ** 2.0)      # soft start, soft landing
    th = math.radians(75) * (1 - e)
    hx = -7.5 * (1 - sw) ** 2.2                       # hinge glides in from the left
    hz = 1.8 * (1 - ramp(tau, 0.0, TS * 0.8)) ** 2.0  # and comes down onto the wall
    rr = ramp(tau, 0.45, TS) ** 1.3
    st = tau - TS
    bump = 0.0
    if 0 < st < 0.20:
        bump = math.radians(1.6) * math.sin(math.pi * st / 0.20)
    elif 0.20 <= st < 0.34:
        bump = math.radians(0.4) * math.sin(math.pi * (st - 0.20) / 0.14)
    # a top-first lean so it isn't a perfect door
    yl = 1 + 0.10 * (y / (H / 2))
    # integrate along columns: alpha(u) = theta * (u/L)^k
    ncol = NX + 1
    us = np.linspace(0, L, ncol)
    xs_out = np.zeros_like(x); zs_out = np.zeros_like(x)
    nrow = NY + 1
    xg = x.reshape(nrow, ncol); yg = yl.reshape(nrow, ncol)
    du = L / NX
    for j in range(nrow):
        sN = us / L
        g = (1 - rr) * (0.30 + 0.70 * sN ** 1.25) + rr * sN ** 2.6
        a = (th + bump) * yg[j, 0] * g
        a = np.minimum(a, math.radians(178))
        cx = np.concatenate([[0], np.cumsum((np.cos(a[1:]) + np.cos(a[:-1])) / 2 * du)])
        cz = np.concatenate([[0], np.cumsum((np.sin(a[1:]) + np.sin(a[:-1])) / 2 * du)])
        xs_out.reshape(nrow, ncol)[j] = cx
        zs_out.reshape(nrow, ncol)[j] = cz
    # air cushion: a soft dome that sinks out after the landing
    if st > 0:
        dome = 0.05 * math.exp(-st / 0.10) * min(st / 0.05, 1)
        zs_out += dome * np.sin(math.pi * x / L) * np.cos(math.pi * y / H)
    out = np.column_stack([xs_out - W / 2 + hx, y, zs_out + hz])
    flat = (th + bump) == 0 and st > 0.55
    return out, flat


def set_verts(ob, co):
    ob.data.vertices.foreach_set("co", co.astype(np.float32).ravel())
    ob.data.update()


def set_film(t_film):
    n = int(round(t_film * 60))
    n = max(0, min(1799, n))
    img_film.filepath = os.path.join(FILMDIR, "frame_%04d.png" % n)
    img_film.reload()


def frame_state(f):
    """Pose everything for output frame f."""
    rimfront = -1.0
    if f < F_CUT:
        tau = (f - T_TEAR) / FPS
        set_film(FILM_T0 + max(tau, 0))
        obR.hide_render = True
        if tau <= 0:
            SHADOW["node"].inputs["Factor"].default_value = 1.0
            set_verts(obA, restA); set_verts(obB, restB)
            obA.hide_render = obB.hide_render = False
        else:
            ca, fs = deform_half(restA, NA, tau, 0.0, 0.0)
            cb, _ = deform_half(restB, -NA, tau, 0.06, Z_B)
            set_verts(obA, ca); set_verts(obB, cb)
            gone = tau > 3.2
            obA.hide_render = obB.hide_render = gone
            rimfront = uvx_of_front(fs)
            SHADOW["node"].inputs["Factor"].default_value = 1.0 - float(ease_in_out(ramp(tau / 1.2, 1.05, 1.55)))
    else:
        set_film(END_CARD_T)
        obA.hide_render = obB.hide_render = True
        tau = (f - T_RET) / FPS
        SHADOW["node"].inputs["Factor"].default_value = float(ease_in_out(ramp(tau, 0.0, 0.45)))
        if tau < 0:
            obR.hide_render = True
        else:
            obR.hide_render = False
            co, _ = deform_return(restR, tau)
            set_verts(obR, co)
    for n in rim_nodes:
        n.inputs[0].default_value = rimfront


def parse(spec):
    if spec == "all":
        return list(range(N_FRAMES))
    out = []
    for part in spec.split(","):
        if "-" in part:
            a, b = part.split("-"); out += list(range(int(a), int(b) + 1))
        else:
            out.append(int(part))
    return out


# calibrate: the lit value of a flat, unshadowed white diffuse (float EXR, no view transform)
calib_path = os.path.join(OUT, "_calib.exr")
obA.hide_render = obB.hide_render = obR.hide_render = True
texF = [n for n in obF.data.materials[0].node_tree.nodes if n.type == "TEX_IMAGE"][0]
white = bpy.data.images.new("white", 4, 4, float_buffer=True)
white.colorspace_settings.name = "Non-Color"
white.pixels = [1.0] * 64
oldimg = texF.image; texF.image = white
mins = [n for m in bpy.data.materials if m.node_tree for n in m.node_tree.nodes if n.type == "MATH" and n.operation == "MINIMUM"]
for n in mins:
    n.inputs[1].default_value = 1000
sc.render.image_settings.file_format = "OPEN_EXR"
sc.render.image_settings.color_depth = "32"
sc.render.filepath = calib_path
bpy.ops.render.render(write_still=True)
im = bpy.data.images.load(calib_path)
px = np.array(im.pixels[:]).reshape(540, 960, 4)
NORMV = float(np.median(px[200:340, 400:560, 1]))
print("CALIB lit flat", NORMV, "spread", float(px[50:490, 50:910, 1].min()), float(px[50:490, 50:910, 1].max()))
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGB"
sc.render.image_settings.color_depth = "8"
texF.image = oldimg
for n in mins:
    n.inputs[1].default_value = 1.12
for n in norm_nodes:
    n.inputs[1].default_value = NORMV

for f in parse(SPEC):
    frame_state(f)
    sc.render.filepath = os.path.join(OUT, "f_%04d.png" % f)
    bpy.ops.render.render(write_still=True)
    print("FRAME", f, flush=True)

"""Card flip: the lobby screen as a rigid card that flips over to the Grand
Prix film (seg 1), and the red end card flipping back to the lobby (seg 2).

blender --factory-startup -b -P card_flip.py -- --seg 1 --out DIR [--pct 50]
         [--only 0,42,84] [--samples 32]

Each segment is T = 2.8 s. The scene runs at 60 fps (so the film's 60 fps
frames map 1:1) and we render every 2nd frame -> 85 frames at 30 fps,
n = 0..84, where n = 0 and n = 84 are the card exactly flat and full-frame.

Rest = exact: the camera (50 mm, 36 mm sensor) sits D = 8 / 0.36 in front of
the card's face, so the 16 x 9 face fills the frame exactly. The face shader
is a mix of pure Emission (the texture, untouched under the Standard view)
and a lit Principled surface; the mix is 0 at rest, so the rest frames are
the texture itself. The card is a hair bigger than the frame (bevel hides
outside the frame at rest) and its UVs are projected from the rest view.
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(name, default=None):
    if name in ARGS:
        i = ARGS.index(name)
        return ARGS[i + 1] if i + 1 < len(ARGS) and not ARGS[i + 1].startswith("--") else True
    return default

SEG = int(arg("--seg", 1))
OUT = arg("--out", r"C:\Users\User\scratch-intro\card-flip-work\seg%d" % SEG)
PCT = int(arg("--pct", 50))
ONLY = arg("--only", None)
SAMPLES = int(arg("--samples", 64))
SIGN = 1 if SEG == 1 else -1        # seg 2 flips the other way

PLATE = r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\lobby-plate-sky.png"
FILM = r"C:\Users\User\scratch-intro\gp\gp-brand\frames1080\frame_%04d.png"

FPS = 60
T = 2.8
NF = int(round(T * 30))             # 84 -> output frames 0..84
W, H = 16.0, 9.0                    # the face at rest = the frame
THICK = 0.11
BEVEL = 0.03
OVER = 0.06                         # card is this much bigger on every side
D = (W / 2) / (18.0 / 50.0)         # camera to face distance = 22.222


# ------------------------------------------------------------ motion ---
def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x

def sstep(a, b, t):
    x = clamp((t - a) / (b - a))
    return x * x * x * (x * (6 * x - 15) + 10)

def spring(target, omega, zeta, t_end=T, dt=1 / 1200):
    """Critically-ish damped follower of target(t) (a real mass on a spring):
    gives the lag, weight, overshoot and settle. Returns f(t)."""
    xs, x, v, t = [], target(0.0), 0.0, 0.0
    n = int(round(t_end / dt)) + 2
    for i in range(n):
        xs.append(x)
        a = omega * omega * (target(t) - x) - 2 * zeta * omega * v
        v += a * dt; x += v * dt; t += dt
    def f(tt):
        i = clamp(tt / dt, 0, n - 2); i0 = int(i); fr = i - i0
        return xs[i0] * (1 - fr) + xs[i0 + 1] * fr
    return f

def home(f, rest, a=T - 0.5, b=T - 0.02):
    """Blend the last whisper of spring residue to the exact rest value."""
    return lambda t: f(t) + (rest - f(t)) * sstep(a, b, t)

# flip progress 0 -> 1 (a small wind-up the other way first)
_flip_t = lambda t: -0.035 * sstep(0.05, 0.42, t) + 1.035 * sstep(0.40, 1.62, t)
FLIP = home(spring(_flip_t, 9.5, 0.52), 1.0)
# card goes back (away from camera) and comes home with a little push-in
_back_t = lambda t: sstep(0.0, 0.75, t) - sstep(1.20, 2.15, t)
BACK = home(spring(_back_t, 7.5, 0.7), 0.0)
# camera pulls back a touch, pushes in again
_cam_t = lambda t: sstep(0.10, 0.85, t) - sstep(1.30, 2.30, t)
CAM = home(spring(_cam_t, 6.5, 0.8), 0.0)
# perspective tilt (top tips away), a little roll for the diagonal feel, lift
_tilt_t = lambda t: sstep(0.0, 0.55, t) - sstep(1.35, 2.25, t)
TILT = home(spring(_tilt_t, 8.0, 0.6), 0.0)
_roll_t = lambda t: sstep(0.30, 0.95, t) - sstep(1.15, 2.00, t)
ROLL = home(spring(_roll_t, 8.0, 0.6), 0.0)
_lift_t = lambda t: sstep(0.30, 1.00, t) - sstep(1.20, 2.10, t)
LIFT = home(spring(_lift_t, 7.0, 0.7), 0.0)
# how "lit" the faces are (0 = the texture exactly)
LIT = lambda t: sstep(0.0, 0.45, t) - sstep(2.05, T - 0.04, t)


# ------------------------------------------------------------ scene ----
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.frame_start, sc.frame_end = 1, 1 + 2 * NF
    return sc

def tex_node(nt, img, loc):
    n = nt.nodes.new("ShaderNodeTexImage"); n.image = img
    n.interpolation = "Linear"; n.extension = "EXTEND"; n.location = loc
    return n

def face_material(name, img, k_value_node_holder):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (600, 0)
    tx = tex_node(nt, img, (-500, 0))
    em = nt.nodes.new("ShaderNodeEmission"); em.location = (0, 150)
    em.inputs["Strength"].default_value = 1.0
    pb = nt.nodes.new("ShaderNodeBsdfPrincipled"); pb.location = (0, -200)
    pb.inputs["Roughness"].default_value = 0.42
    pb.inputs["Coat Weight"].default_value = 0.10
    pb.inputs["Coat Roughness"].default_value = 0.30
    pb.inputs["Specular IOR Level"].default_value = 0.15
    mix = nt.nodes.new("ShaderNodeMixShader"); mix.location = (350, 0)
    val = nt.nodes.new("ShaderNodeValue"); val.location = (100, 350); val.name = "LIT"
    nt.links.new(tx.outputs["Color"], em.inputs["Color"])
    nt.links.new(tx.outputs["Color"], pb.inputs["Base Color"])
    nt.links.new(val.outputs[0], mix.inputs[0])
    nt.links.new(em.outputs[0], mix.inputs[1])
    nt.links.new(pb.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    k_value_node_holder.append(val)
    return m, tx

def plain_material(name, rgb, rough, coat=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    pb = m.node_tree.nodes["Principled BSDF"]
    pb.inputs["Base Color"].default_value = (*rgb, 1)
    pb.inputs["Roughness"].default_value = rough
    if coat:
        pb.inputs["Coat Weight"].default_value = coat
        pb.inputs["Coat Roughness"].default_value = 0.1
    return m

def build_card(front_img, back_img):
    hx, hy, hz = W / 2 + OVER, THICK / 2, H / 2 + OVER
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * 2 * hx, v.co.y * 2 * hy, v.co.z * 2 * hz))
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=BEVEL, segments=4,
                    profile=0.5, affect="EDGES", clamp_overlap=True)
    me = bpy.data.meshes.new("Card"); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new("Card", me)
    bpy.context.scene.collection.objects.link(ob)
    ks = []
    mf, txf = face_material("Front", front_img, ks)
    mb, txb = face_material("Back", back_img, ks)
    me_ = plain_material("Edge", (0.86, 0.85, 0.82), 0.32, coat=0.4)
    for m in (mf, mb, me_):
        me.materials.append(m)
    uv = me.uv_layers.new(name="UV")
    for p in me.polygons:
        ny = p.normal.y
        p.material_index = 0 if ny < -0.7 else 1 if ny > 0.7 else 2
        p.use_smooth = p.material_index == 2
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            u = co.x / W + 0.5
            if p.material_index == 1:
                u = -co.x / W + 0.5
            uv.data[li].uv = (u, co.z / H + 0.5)
    ob.rotation_mode = "ZYX"            # R = Rx(tilt) Ry(roll) Rz(flip)
    return ob, ks, txb, txf

def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()

def area(name, loc, target, size, energy, sx=None, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, "AREA"); ld.energy = energy; ld.color = color
    if sx:
        ld.shape = "RECTANGLE"; ld.size = sx; ld.size_y = size
    else:
        ld.shape = "DISK"; ld.size = size
    try:
        ld.use_shadow_jitter = True
    except Exception:
        pass
    ob = bpy.data.objects.new(name, ld); ob.location = loc
    bpy.context.scene.collection.objects.link(ob); look_at(ob, target)
    return ob

def build_world(sc):
    w = bpy.data.worlds.new("Void"); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.0025, 0.0025, 0.003, 1)
    bg.inputs["Strength"].default_value = 1.0
    # the studio's back wall: dark, a hair of grit, catches the card's shadow
    bpy.ops.mesh.primitive_plane_add(size=1)
    wall = bpy.context.active_object; wall.name = "Wall"
    wall.scale = (140, 80, 1); wall.rotation_euler = (math.radians(90), 0, 0)
    wall.location = (0, 19.0, 0)
    m = bpy.data.materials.new("Wall"); m.use_nodes = True; nt = m.node_tree
    pb = nt.nodes["Principled BSDF"]
    pb.inputs["Roughness"].default_value = 0.85
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 90
    nz.inputs["Detail"].default_value = 8
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.012, 0.012, 0.015, 1)
    ramp.color_ramp.elements[1].color = (0.022, 0.022, 0.027, 1)
    nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], pb.inputs["Base Color"])
    wall.data.materials.append(m)

def build_lights():
    # key: big soft box above-left-front; casts the soft shadow down-right
    area("Key", (-16, -30, 15), (0, 0, 0), 16.0, float(arg("--key", 10500)))
    # fill from the right, low, to keep the turned face readable
    area("Fill", (18, -26, -6), (0, 0, 0), 16.0, float(arg("--fill", 3800)),
         color=(0.92, 0.95, 1.0))
    # top strip: rakes the top bevel as the card tips
    area("Top", (0, 2, 11), (0, 2, 0), 1.2, float(arg("--top", 250)), sx=22)
    # a soft pool of light on the back wall, behind the card
    area("Pool", (6, 14, 12), (0, 19, -2), 14.0, float(arg("--pool", 3000)),
         color=(1.0, 0.97, 0.94))

def build_camera(sc):
    cd = bpy.data.cameras.new("Cam"); cd.lens = 50; cd.sensor_fit = "HORIZONTAL"
    cd.sensor_width = 36.0; cd.clip_start = 0.5; cd.clip_end = 300
    cam = bpy.data.objects.new("Cam", cd); sc.collection.objects.link(cam)
    cam.rotation_euler = (math.radians(90), 0, 0)   # looking down +Y
    sc.camera = cam
    return cam

def setup_render(sc):
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            sc.render.engine = eng; break
        except Exception:
            continue
    r = sc.render
    r.resolution_x, r.resolution_y, r.resolution_percentage = 1920, 1080, PCT
    r.film_transparent = False
    r.dither_intensity = 0.0
    r.filter_size = float(arg("--filter", 0.5))
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0; sc.view_settings.gamma = 1.0
    ee = sc.eevee
    ee.taa_render_samples = SAMPLES
    for k, v in (("use_shadows", True), ("shadow_ray_count", 2),
                 ("shadow_step_count", 8), ("use_raytracing", True),
                 ("light_threshold", 0.0001)):
        try:
            setattr(ee, k, v)
        except Exception:
            pass
    r.use_motion_blur = True
    r.motion_blur_shutter = 0.9      # in 60 fps frames: ~160 deg at 30 fps
    try:
        ee.motion_blur_steps = 3
    except Exception:
        pass
    r.image_settings.file_format = "PNG"; r.image_settings.color_mode = "RGB"
    r.image_settings.color_depth = "8"


def main():
    sc = reset()
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    plate = bpy.data.images.load(PLATE)
    endcard = bpy.data.images.load(FILM % 1602)
    film = bpy.data.images.load(FILM % 0)
    if SEG == 1:
        front, back = plate, film
    else:
        front, back = endcard, plate
    card, ks, txb, txf = build_card(front, back)
    build_world(sc); build_lights()
    cam = build_camera(sc)
    setup_render(sc)

    face_y = -THICK / 2
    for n2 in range(0, 2 * NF + 1):          # every 60 fps frame
        f = 1 + n2; t = n2 / FPS
        card.rotation_euler = (math.radians(-7.5) * TILT(t),
                               SIGN * math.radians(3.5) * ROLL(t),
                               SIGN * math.pi * FLIP(t))
        card.location = (0, 9.0 * BACK(t), 0.35 * LIFT(t))
        cam.location = (0, face_y - D - 3.0 * CAM(t), 0)
        card.keyframe_insert("rotation_euler", frame=f)
        card.keyframe_insert("location", frame=f)
        cam.keyframe_insert("location", frame=f)
        for v in ks:
            v.outputs[0].default_value = float(arg("--lit", 0.6)) * (1.0 if arg("--litdiag") else LIT(t))
            v.outputs[0].keyframe_insert("default_value", frame=f)

    os.makedirs(OUT, exist_ok=True)
    frames = range(NF + 1)
    if ONLY:
        frames = [int(x) for x in str(ONLY).split(",")]
    for n in frames:
        f = 1 + 2 * n
        sc.frame_set(f)
        if SEG == 1:      # the film plays on the back: film t = 1.5 s at landing
            idx = max(0, 90 - (2 * NF - 2 * n))
            film.filepath = FILM % idx; film.reload()
        else:             # the end card keeps "playing" (it is still)
            idx = min(1602 + 2 * n, 1700)
            endcard.filepath = FILM % idx; endcard.reload()
        sc.render.filepath = os.path.join(OUT, "f%03d.png" % n)
        bpy.ops.render.render(write_still=True)
        print("[card-flip] seg", SEG, "frame", n, "film", idx, flush=True)

main()

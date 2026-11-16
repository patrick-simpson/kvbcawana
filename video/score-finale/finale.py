# The scoreboard's winner films (owner 2026-11-15: "make epic animations. Use blender where
# it makes sense"; picked: 3D for the finale only, 20 seconds, no characters, one film
# coloured live, "one of each, and each night a different one plays"). Three scenes, built
# and animated by this recipe:
#
#   blender --python finale.py -- <scene> <out dir> [first frame] [last frame] [width]
#   blender --python finale.py -- <scene> <out dir> 30,150,300 0 640     (a few frames, small, to look at)
#   scene: trophy | stadium | takeover        600 frames = 20 s at 30 a second
#
# Frames already in <out dir> are skipped, so a stopped render carries on where it left
# off. Blender runs with its window (the owner watches it); the window is always closed
# at the end, an error included.
#
# INKS. Each film is rendered once, in three pure "inks" on black, and the projector
# colours them live for whichever team won (lobby/src/presentation/components/FinaleFilm.jsx):
#   red channel   -> the winning team's colour
#   green channel -> white (sparkle, glints)
#   blue channel  -> the team's second shade (its deep colour; the OTHER team in a tie)
# So a "team coloured" surface is pure red here, lit by white light, and the view
# transform is Standard so the channels stay apart. Team colour plus white turns pastel,
# so white is kept for small things; floors are red metal so their reflections stay red.
#
# NOTHING IS SIMULATED. Every moving piece (confetti, sparks, the wall's balls) is placed
# each frame from the time alone, in bulk (numpy), so any frame can be rendered by itself
# and a frame takes about a second. No words are in the films: the projector draws
# "<TEAM> WINS!" and the scores over them.
#
# THE BATTERY RULE (as video/grand-welcome): renders drain the laptop even on its dock. At
# 20% the render waits until the battery is back to 80%.
import bpy, bmesh, sys, os, math, time, ctypes, traceback
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SCENE = argv[0] if argv else 'trophy'
OUT = argv[1] if len(argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', SCENE)
# The frames: first and last, or a list for a few to look at ("30,150,300").
ONLY = [int(x) for x in argv[2].split(',')] if len(argv) > 2 and ',' in argv[2] else None
FIRST = ONLY[0] if ONLY else int(argv[2]) if len(argv) > 2 else 1
LAST = ONLY[-1] if ONLY else int(argv[3]) if len(argv) > 3 else 1200
WIDTH = int(argv[4]) if len(argv) > 4 else 1920
# Owner 2026-11-15: "60fps professional grade movie studio quality", however long it takes.
FPS, SECONDS = 60, 20
R, G, B = (1, 0, 0), (0, 1, 0), (0, 0, 1)
rng = np.random.default_rng(7)
TAU = math.tau


def ease(x):
    """0 to 1, slow at both ends."""
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def ease_out(x):
    x = min(1.0, max(0.0, x))
    return 1 - (1 - x) ** 3


def span(t, a, b):
    """How far t is from a to b, 0 to 1."""
    return min(1.0, max(0.0, (t - a) / (b - a)))


# ── Blender's pieces ──────────────────────────────────────────────────────────
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try:
            s.render.engine = eng
            break
        except TypeError:
            pass
    s.render.resolution_x, s.render.resolution_y = WIDTH, WIDTH * 9 // 16
    s.render.fps = FPS
    s.view_settings.view_transform = 'Standard'
    s.view_settings.look = 'None'
    s.render.image_settings.file_format = 'PNG'
    s.render.image_settings.color_mode = 'RGB'
    s.render.image_settings.compression = 15
    w = bpy.data.worlds.new('black'); w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0, 0, 0, 1)
    s.world = w
    try:
        s.eevee.use_raytracing = True
        s.eevee.taa_render_samples = 128
    except AttributeError:
        pass
    # Studio pass: real motion blur (the frame handler places every piece at each blur
    # step's sub-frame, so sparks streak and confetti smears as a camera would see it) and
    # a glow round everything bright (the compositor's glare).
    s.render.use_motion_blur = True
    s.render.motion_blur_shutter = 0.5
    for attr, val in (('motion_blur_steps', 4),):
        try:
            setattr(s.eevee, attr, val)
        except AttributeError:
            pass
    glow(s)
    return s


def glow(s):
    """Bloom in the compositor: a soft fog glow round the bright inks, channel by channel,
    so a red spark glows red (the projector's ink matrix still reads it)."""
    try:
        tree = bpy.data.node_groups.new('glow', 'CompositorNodeTree')
        s.compositing_node_group = tree
        tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
        rl = tree.nodes.new('CompositorNodeRLayers')
        out = tree.nodes.new('NodeGroupOutput')
        g = tree.nodes.new('CompositorNodeGlare')
        for name, val in (('Type', 'Fog Glow'), ('Quality', 'High'), ('Threshold', 0.75), ('Strength', 0.9), ('Size', 0.55)):
            sock = g.inputs.get(name)
            if sock is not None:
                try:
                    sock.default_value = val
                except Exception as e:
                    print('glare', name, e)
        tree.links.new(rl.outputs['Image'], g.inputs['Image'])
        tree.links.new(g.outputs['Image'], out.inputs[0])
        print('glow: compositor node group')
    except Exception as e:
        print('glow: falling back', e)
        s.use_nodes = True
        tree = s.node_tree
        rl, comp = tree.nodes['Render Layers'], tree.nodes['Composite']
        g = tree.nodes.new('CompositorNodeGlare')
        g.glare_type = 'FOG_GLOW'; g.quality = 'HIGH'; g.threshold = 0.75; g.size = 7
        tree.links.new(rl.outputs['Image'], g.inputs['Image'])
        tree.links.new(g.outputs['Image'], comp.inputs['Image'])


def link(o):
    bpy.context.scene.collection.objects.link(o)
    return o


def mat(name, color, metallic=0.0, rough=0.4, emit=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*color, 1)
        b.inputs['Emission Strength'].default_value = emit
    return m


def emit_mat(name, color, strength, soft=False):
    """Pure light of one ink (no shading): confetti, sparks, lamps. soft: a round glowing
    point, hot in the middle and fading to nothing at its edge (sparks, crowd lights,
    glints) in place of a flat square; it needs a Quads mesh, whose pieces carry 0-1 UVs."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    e = nt.nodes.new('ShaderNodeEmission'); o = nt.nodes.new('ShaderNodeOutputMaterial')
    e.inputs[0].default_value = (*color, 1); e.inputs[1].default_value = strength
    if not soft:
        nt.links.new(e.outputs[0], o.inputs[0])
        return m
    uv = nt.nodes.new('ShaderNodeUVMap')
    off = nt.nodes.new('ShaderNodeVectorMath'); off.operation = 'SUBTRACT'; off.inputs[1].default_value = (0.5, 0.5, 0)
    ln = nt.nodes.new('ShaderNodeVectorMath'); ln.operation = 'LENGTH'
    fall = nt.nodes.new('ShaderNodeMapRange'); fall.inputs['From Min'].default_value = 0.5; fall.inputs['From Max'].default_value = 0.0
    sq = nt.nodes.new('ShaderNodeMath'); sq.operation = 'POWER'; sq.inputs[1].default_value = 2.2
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = strength * SOFT_GAIN; mul.label = 'level'
    tr = nt.nodes.new('ShaderNodeBsdfTransparent'); add = nt.nodes.new('ShaderNodeAddShader')
    nt.links.new(uv.outputs['UV'], off.inputs[0]); nt.links.new(off.outputs['Vector'], ln.inputs[0])
    nt.links.new(ln.outputs['Value'], fall.inputs['Value']); nt.links.new(fall.outputs['Result'], sq.inputs[0])
    nt.links.new(sq.outputs[0], mul.inputs[0]); nt.links.new(mul.outputs[0], e.inputs[1])
    nt.links.new(e.outputs[0], add.inputs[0]); nt.links.new(tr.outputs[0], add.inputs[1]); nt.links.new(add.outputs[0], o.inputs[0])
    try: m.surface_render_method = 'BLENDED'
    except AttributeError: m.blend_method = 'BLEND'
    return m


SOFT_GAIN = 1.6   # a soft point's middle is brighter, so it gives about the light the square did


def set_strength(m, strength):
    soft = any(n.type == 'MATH' and n.label == 'level' for n in m.node_tree.nodes)
    for n in m.node_tree.nodes:
        if soft and n.type == 'MATH' and n.label == 'level': n.inputs[1].default_value = strength * SOFT_GAIN
        elif not soft and n.type == 'EMISSION': n.inputs[1].default_value = strength


def beam_mat(name, color, strength):
    """A beam of light: brightest at its lamp, fading along its length and at its edge."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeMath'); ramp.operation = 'POWER'; ramp.inputs[1].default_value = 1.6
    lw = nt.nodes.new('ShaderNodeLayerWeight'); lw.inputs[0].default_value = 0.35
    inv = nt.nodes.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
    e = nt.nodes.new('ShaderNodeEmission'); e.inputs[0].default_value = (*color, 1)
    mul2 = nt.nodes.new('ShaderNodeMath'); mul2.operation = 'MULTIPLY'; mul2.inputs[1].default_value = strength; mul2.label = 'level'
    tr = nt.nodes.new('ShaderNodeBsdfTransparent'); add = nt.nodes.new('ShaderNodeAddShader'); o = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0]); nt.links.new(sep.outputs['Z'], ramp.inputs[0])
    nt.links.new(lw.outputs['Facing'], inv.inputs[1]); nt.links.new(ramp.outputs[0], mul.inputs[0]); nt.links.new(inv.outputs[0], mul.inputs[1])
    nt.links.new(mul.outputs[0], mul2.inputs[0]); nt.links.new(mul2.outputs[0], e.inputs[1])
    nt.links.new(e.outputs[0], add.inputs[0]); nt.links.new(tr.outputs[0], add.inputs[1]); nt.links.new(add.outputs[0], o.inputs[0])
    try: m.surface_render_method = 'BLENDED'
    except AttributeError: m.blend_method = 'BLEND'
    return m


def set_beam(m, strength):
    for n in m.node_tree.nodes:
        if n.type == 'MATH' and n.label == 'level': n.inputs[1].default_value = strength


def prim(kind, material, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), smooth=True, **kw):
    getattr(bpy.ops.mesh, f'primitive_{kind}_add')(location=loc, rotation=rot, **kw)
    o = bpy.context.view_layer.objects.active; o.scale = scale
    if material: o.data.materials.append(material)
    if smooth:
        for p in o.data.polygons: p.use_smooth = True
    return o


def lathe(name, profile, material, steps=96):
    """A shape turned on a lathe: `profile` is (radius, height) pairs from the bottom up."""
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0, z)) for r, z in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=TAU, steps=steps, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    o = link(bpy.data.objects.new(name, me)); me.materials.append(material)
    return o


def light(kind, loc, energy, size=1.0, spot=None):
    d = bpy.data.lights.new(kind, kind); d.energy = energy
    if kind == 'SPOT' and spot: d.spot_size = spot; d.spot_blend = 0.35
    if kind == 'AREA': d.size = size
    else: d.shadow_soft_size = size
    o = link(bpy.data.objects.new(kind, d)); o.location = loc
    return o


def aim(o, look, axis='-Z'):
    o.rotation_euler = (Vector(look) - o.location).to_track_quat(axis, 'Y').to_euler()


def camera(lens=35):
    c = bpy.data.cameras.new('cam'); c.lens = lens
    o = link(bpy.data.objects.new('cam', c))
    bpy.context.scene.camera = o
    return o


class Quads:
    """Many small flat pieces in one mesh, moved in bulk each frame (confetti, sparks, lights)."""
    def __init__(self, name, n, materials):
        self.n = n
        me = bpy.data.meshes.new(name)
        me.from_pydata(np.zeros((n * 4, 3)).tolist(), [], [(4 * i, 4 * i + 1, 4 * i + 2, 4 * i + 3) for i in range(n)])
        for m in materials: me.materials.append(m)
        uvl = me.uv_layers.new(name='UVMap')
        uvl.data.foreach_set('uv', np.tile(np.array([0, 0, 1, 0, 1, 1, 0, 1], dtype=np.float32), n))
        self.me = me
        self.o = link(bpy.data.objects.new(name, me))

    def place(self, centers, u, v, mat_index=None):
        """Each piece is centre +/- u +/- v (u and v are its two half-edges; zero hides it)."""
        co = np.empty((self.n, 4, 3), dtype=np.float32)
        co[:, 0] = centers - u - v; co[:, 1] = centers + u - v; co[:, 2] = centers + u + v; co[:, 3] = centers - u + v
        self.me.vertices.foreach_set('co', co.ravel())
        if mat_index is not None: self.me.polygons.foreach_set('material_index', mat_index.astype(np.int32))
        self.me.update()

    def face(self, centers, sizes, cam, mat_index=None):
        """Pieces turned to the camera, each `sizes` wide."""
        m = cam.matrix_world.to_3x3()
        right, up = np.array(m @ Vector((1, 0, 0))), np.array(m @ Vector((0, 1, 0)))
        s = sizes[:, None].astype(np.float32)
        self.place(centers.astype(np.float32), s * right[None, :], s * up[None, :], mat_index)


class Balls:
    """A wall of balls in one mesh; each frame every ball gets a size and one of the materials."""
    def __init__(self, name, centers, materials, segs=12):
        bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=segs // 2 + 2, radius=1.0)
        unit = np.array([v.co[:] for v in bm.verts], dtype=np.float32)
        faces = [[v.index for v in f.verts] for f in bm.faces]; bm.free()
        nb, nv, nf = len(centers), len(unit), len(faces)
        self.centers, self.unit, self.nf = centers.astype(np.float32), unit, nf
        me = bpy.data.meshes.new(name)
        all_faces = [[i + b * nv for i in f] for b in range(nb) for f in faces]
        me.from_pydata(np.zeros((nb * nv, 3)).tolist(), [], all_faces)
        me.polygons.foreach_set('use_smooth', np.ones(nb * nf, dtype=bool))
        for m in materials: me.materials.append(m)
        self.me = me
        self.o = link(bpy.data.objects.new(name, me))

    def place(self, radius, mat_index, push=None):
        c = self.centers if push is None else self.centers + push
        co = c[:, None, :] + self.unit[None, :, :] * radius[:, None, None]
        self.me.vertices.foreach_set('co', co.astype(np.float32).ravel())
        self.me.polygons.foreach_set('material_index', np.repeat(mat_index.astype(np.int32), self.nf))
        self.me.update()


def tumble(n):
    """Fixed spin for n confetti pieces: answers their two half-edges at a time."""
    a0, b0, wa, wb = rng.uniform(0, TAU, n), rng.uniform(0, TAU, n), rng.uniform(2, 7, n) * rng.choice([-1, 1], n), rng.uniform(1.5, 5, n)
    size = rng.uniform(0.6, 1.5, n)
    def at(t, base):
        a, b = a0 + wa * t, b0 + wb * t
        u = np.stack([np.cos(a), np.sin(a) * np.cos(b), np.sin(a) * np.sin(b)], 1)
        w = np.stack([np.cos(b + 1.3), np.sin(b + 1.3) * np.cos(a * 0.7), np.sin(b + 1.3) * np.sin(a * 0.7)], 1)
        v = np.cross(u, w); v /= np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-6)
        s = (size * base)[:, None]
        return (u * s).astype(np.float32), (v * s).astype(np.float32)
    return at


# ── 1. Trophy reveal ──────────────────────────────────────────────────────────
# 0.0  dark stage; three spots hunt across it
# 2.6  the trophy rises out of the plinth, the spots find it
# 5.4  it lands; rays fan out behind it; two cannons fire confetti from the wings
# 7.0  confetti keeps falling from above; the cup turns slowly; the camera drifts in
def trophy():
    prim('plane', mat('floor', (0.5, 0.0, 0.03), metallic=1.0, rough=0.2), size=80, smooth=False)
    chrome = mat('team chrome', R, metallic=1.0, rough=0.2)
    cup = lathe('cup', [
        (0.00, 0.00), (0.62, 0.00), (0.62, 0.10), (0.50, 0.14), (0.26, 0.22), (0.13, 0.34), (0.10, 0.62),
        (0.17, 0.70), (0.17, 0.78), (0.10, 0.86), (0.14, 0.98), (0.40, 1.22), (0.66, 1.62), (0.80, 2.14),
        (0.86, 2.62), (0.90, 2.70), (0.84, 2.70), (0.76, 2.16), (0.60, 1.66), (0.34, 1.30), (0.00, 1.18)], chrome)
    handles = [prim('torus', chrome, rot=(math.pi / 2, 0, 0), scale=(1, 1.35, 1), major_radius=0.42, minor_radius=0.065, major_segments=64, minor_segments=20) for _ in range(2)]
    for h, side in zip(handles, (-1, 1)):
        h.parent = cup; h.location = (side * 0.98, 0, 2.0)
    glint_m = emit_mat('glint', G, 22, soft=True)
    glints = Quads('glints', 6, [glint_m])
    lathe('plinth', [(0.00, 0.00), (1.10, 0.00), (1.10, 0.14), (0.92, 0.20), (0.92, 0.70), (0.80, 0.78), (0.80, 0.86), (0.0, 0.86)], mat('deep', B, metallic=1.0, rough=0.35))
    band = emit_mat('band', G, 2.5)
    prim('cylinder', band, loc=(0, 0, 0.45), scale=(0.925, 0.925, 0.03), vertices=96)
    rays = []
    for i in range(18):
        a = i / 18 * TAU + 0.1
        m = beam_mat(f'ray{i}', R, 0.5)
        ray = prim('cone', m, vertices=24, radius1=0.26 + 0.12 * (i % 2), radius2=0.0, depth=9.5, smooth=False)
        ray.location = (math.cos(a) * 4.6, 2.2, 2.6 + math.sin(a) * 4.6); ray.rotation_euler = (0, -a + math.pi / 2, 0)
        rays.append((ray, m, a))
    spots = []
    for i, x in enumerate((-5.2, 0.0, 5.2)):
        sp = light('SPOT', (x, -1.5, 9.5), 9000, size=0.25, spot=math.radians(26))
        m = beam_mat(f'beam{i}', R, 0.3)
        cone = prim('cone', m, vertices=48, radius1=1.7, radius2=0.1, depth=10.5, smooth=False)
        spots.append((sp, cone, m, i))
    key = light('AREA', (-3.5, -6, 4.5), 1500, size=3); aim(key, (0, 0, 2.6))
    fill = light('AREA', (4, -5, 2.2), 420, size=6); aim(fill, (0, 0, 2.4))
    rims = [light('AREA', (s * 3.2, 3.6, 4.4), 2600, size=1.4) for s in (-1, 1)]
    for r in rims: aim(r, (0, 0, 2.6))
    cam = camera(lens=38)
    # Confetti: two cannons from the wings at 5.4 s, then a steady fall from above.
    inks = [emit_mat('cR', R, 1.9), emit_mat('cG', G, 2.4), emit_mat('cB', B, 2.0)]
    NC, NF = 1100, 900
    cannon, fall = Quads('cannon', NC, inks), Quads('fall', NF, inks)
    c_ink = rng.choice(3, NC, p=[0.52, 0.12, 0.36]); f_ink = rng.choice(3, NF, p=[0.52, 0.12, 0.36])
    c_side = rng.choice([-1, 1], NC)
    c_ang = rng.uniform(math.radians(55), math.radians(86), NC); c_az = rng.normal(0, 0.3, NC); c_v = rng.uniform(8.5, 15.0, NC)
    c_vel = np.stack([-c_side * np.cos(c_ang) * c_v * np.cos(c_az), np.sin(c_az) * c_v * 0.5 - 0.6, np.sin(c_ang) * c_v], 1)
    c_org = np.stack([c_side * 4.4, np.full(NC, -1.6), np.full(NC, 0.2)], 1)
    c_roll = rng.random(NC)
    c_delay = rng.uniform(0, 0.35, NC) + (c_roll < 0.3) * 2.6 + (c_roll > 0.68) * 8.8   # a second volley, and a third at 14 s to fill the hold
    c_spin, f_spin = tumble(NC), tumble(NF)
    f_x, f_y = rng.uniform(-9, 9, NF), rng.uniform(-3.5, 3.0, NF)
    f_speed, f_phase, f_sway = rng.uniform(0.9, 1.7, NF), rng.uniform(0, 9.5, NF), rng.uniform(0.2, 0.7, NF)
    g_at = np.array([(-0.52, -0.72, 2.39), (0.3, -0.8, 1.34), (0.86, -0.3, 2.59), (-0.05, -0.2, 0.76), (-0.8, -0.4, 2.2), (0.55, -0.7, 2.5)], dtype=np.float32)

    def animate(t):
        rise = ease_out(span(t, 2.6, 5.4))
        z = -3.3 + 4.16 * rise                     # from under the floor to on the plinth
        cup.location = (0, 0, z); cup.rotation_euler = (0, 0, 0.35 * t)
        found = ease(span(t, 2.2, 4.4))            # the spots stop hunting and settle on it
        for sp, cone, m, i in spots:
            hunt = Vector((math.sin(t * 1.3 + i * 2.1) * 6.5, math.cos(t * 0.9 + i * 1.7) * 2.5 - 1.0, 0.0))
            sway = Vector((math.sin(t * 0.5 + i * 2.1) * 0.5, 0, 2.4 + math.sin(t * 0.7 + i) * 0.25))
            hit = hunt.lerp(sway, found)
            aim(sp, hit)
            cone.location = sp.location.lerp(hit, 0.5); cone.rotation_euler = (sp.location - hit).to_track_quat('Z', 'Y').to_euler()
            sp.data.energy = 9000 * (0.35 + 0.65 * found)
            set_beam(m, 0.3 * (0.6 + 0.4 * found) * ease(span(t, 0.2, 1.2)))
        burst = ease_out(span(t, 5.2, 6.2))
        for ray, m, a in rays:
            ray.scale = (1, 1, max(0.001, burst)); set_beam(m, 0.5 * burst * (0.75 + 0.25 * math.sin(t * 2.2 + a * 3)))
            ray.location = (math.cos(a + 0.05 * t) * 4.6 * burst, 2.2, 2.6 + math.sin(a + 0.05 * t) * 4.6 * burst)
            ray.rotation_euler = (0, -(a + 0.05 * t) + math.pi / 2, 0)
        lit = ease(span(t, 2.8, 5.6))
        key.data.energy, fill.data.energy = 1500 * lit, 420 * lit
        for r in rims: r.data.energy = 2600 * lit
        set_strength(band, 2.5 * lit)
        # glints twinkle on the cup once it has landed
        tw = np.clip(np.sin(t * 3.1 + np.arange(6) * 1.9), 0, 1) ** 6 * (1 if t > 5.4 else 0)
        ang = 0.35 * t
        ca, sa = math.cos(ang), math.sin(ang)
        gp = np.stack([g_at[:, 0] * ca - g_at[:, 1] * sa, g_at[:, 0] * sa + g_at[:, 1] * ca, g_at[:, 2] + z + 0.86], 1)
        glints.face(gp, 0.05 * tw, cam)
        # the camera: low and wide, then in, then a slow drift round
        push = ease(span(t, 0.0, 8.0))
        orbit = math.sin((t - 8) * 0.16) * 0.11 if t > 8 else 0.0
        dist = 11.6 - 3.4 * push
        cam.location = (math.sin(orbit) * dist, -math.cos(orbit) * dist, 1.55 + 0.5 * push)
        aim(cam, (0, 0, 1.5 + 1.05 * rise))
        # the cannons
        tc = t - 5.4 - c_delay
        live = tc > 0
        tt = np.maximum(tc, 0)[:, None]
        drag = (1 - np.exp(-1.6 * tt)) / 1.6
        pos = c_org + c_vel * drag + np.array([0, 0, -1.0]) * (2.2 * tt * tt * 0.5)
        pos[:, 2] = np.maximum(pos[:, 2], 0.02)
        u, v = c_spin(t, 0.085)
        hide = (~live)[:, None]
        cannon.place(np.where(hide, 0, pos).astype(np.float32), np.where(hide, 0, u), np.where(hide, 0, v), c_ink)
        # the fall from above, from 6.6 s: each piece loops from the top
        tf = t - 6.6
        h = 9.5 - ((tf * f_speed + f_phase) % 9.5)
        fpos = np.stack([f_x + np.sin(t * 1.3 + f_phase) * f_sway, f_y + np.cos(t * 0.9 + f_phase) * 0.3, h], 1)
        started = (tf * f_speed + f_phase) > 9.5      # nothing hangs in the air before its first drop
        u, v = f_spin(t, 0.07)
        hide = (~started | (tf < 0))[:, None]
        fall.place(np.where(hide, 0, fpos).astype(np.float32), np.where(hide, 0, u), np.where(hide, 0, v), f_ink)
    return animate


# ── 2. Stadium fireworks ──────────────────────────────────────────────────────
# 0.0  a dark arena: the crowd's lights twinkle white, the towers' beams come up
# 2.5  the first rockets; a wave of the winner's colour starts round the stands
# 8.0  the whole crowd is the winner's colour, pulsing; the bursts come faster
# 14.0 the barrage; the camera has been rising all the while
# Owner 2026-11-15 ("are they as epic as possible?"): the bursts were small and dim, the
# frame read as mostly black, so every burst is half as wide again, denser, bigger sparks
# twice as bright and longer lived, with more of them over the last six seconds.
BURST_GROW, SPARKS_GROW = 1.45, 1.7
def stadium():
    prim('plane', mat('pitch', (0.45, 0.0, 0.04), metallic=1.0, rough=0.24), size=260, smooth=False)
    cam = camera(lens=21)
    crowd_m = [emit_mat('crowd team', R, 3.4, soft=True), emit_mat('crowd white', G, 1.3, soft=True), emit_mat('crowd deep', B, 1.5, soft=True), emit_mat('crowd off', (0, 0, 0), 0)]
    pts, ang, tier_of = [], [], []
    for tier in range(12):
        rx, ry, z = 15 + tier * 1.25, 10 + tier * 1.25, 0.9 + tier * 0.62
        n = 150 + tier * 12
        a = np.arange(n) / n * TAU + tier * 0.02
        a = a[np.sin(a) > -0.55]                       # open toward the camera
        pts.append(np.stack([np.cos(a) * rx, np.sin(a) * ry, np.full(len(a), z)], 1) + rng.normal(0, 0.06, (len(a), 3)))
        ang.append(a); tier_of.append(np.full(len(a), tier))
    pts, ang, tier_of = np.concatenate(pts), np.concatenate(ang), np.concatenate(tier_of)
    NCROWD = len(pts)
    crowd = Quads('crowd', NCROWD, crowd_m)
    c_size, c_phase, c_kind = rng.uniform(0.08, 0.13, NCROWD), rng.uniform(0, TAU, NCROWD), rng.random(NCROWD)
    towers = []
    for i, (x, y) in enumerate(((-17, 9), (17, 9), (-21, -2), (21, -2))):
        prim('cylinder', mat(f'mast{i}', (0.02, 0.02, 0.02)), loc=(x, y, 6.5), scale=(0.12, 0.12, 6.5), vertices=12)
        lamp_m = emit_mat(f'lamp{i}', G, 9)
        prim('cube', lamp_m, loc=(x, y, 13.2), scale=(0.9, 0.12, 0.45), smooth=False).rotation_euler = (0, 0, math.atan2(-y, -x) + math.pi / 2)
        bm_ = beam_mat(f'tb{i}', R, 0.13)
        top = Vector((x, y, 13.2))
        cone = prim('cone', bm_, vertices=40, radius1=3.6, radius2=0.2, depth=28, smooth=False)
        towers.append((top, cone, bm_, lamp_m, i))
    light('AREA', (0, -10, 12), 500, size=14).rotation_euler = (math.radians(50), 0, 0)
    flashes = [light('POINT', (0, 8, 16), 0, size=2.0) for _ in range(3)]
    # The show: (time, centre, radius, ink, sparks). Rockets climb for 0.9 s before each.
    show = [(2.6, (0, 8, 15.5), 5.2, 1, 150), (3.7, (-11, 10, 13), 4.2, 2, 120), (4.5, (11, 10, 13.5), 4.4, 0, 130),
            (5.8, (-5.5, 13, 20), 3.8, 0, 110), (6.5, (6, 13, 20.5), 3.9, 1, 110), (7.6, (0, 9, 17), 7.2, 0, 220),
            (8.8, (-16, 12, 11), 3.6, 2, 100), (9.2, (16, 12, 11.5), 3.6, 2, 100), (10.3, (-8, 11, 17.5), 5.4, 0, 170),
            (10.9, (8.5, 11, 18), 5.6, 0, 170), (12.0, (0, 13, 23), 4.6, 1, 140), (12.9, (-13, 10, 14.5), 4.8, 0, 150),
            (13.3, (13, 10, 15), 4.8, 2, 150), (14.4, (0, 8, 16.5), 8.2, 0, 260), (15.1, (-6.5, 13, 21.5), 4.4, 1, 130),
            (15.5, (7, 13, 22), 4.4, 0, 130), (16.3, (-17, 12, 11.5), 3.8, 0, 110), (16.6, (17, 12, 12), 3.8, 0, 110),
            (17.3, (-9.5, 10, 16), 6.0, 2, 190), (17.7, (9.5, 10, 16.5), 6.0, 0, 190), (18.5, (0, 9, 18.5), 9.0, 0, 300),
            (18.9, (-4, 14, 24), 4.0, 1, 120), (19.2, (4.5, 14, 24.5), 4.0, 1, 120),
            # the second wave: a ring of bursts round the headline's hold, and a closing salvo
            (11.4, (-14, 12, 19), 4.6, 0, 140), (11.6, (14, 12, 19.5), 4.6, 0, 140), (15.8, (0, 10, 13), 6.5, 2, 200),
            (16.9, (-11, 13, 23), 5.0, 0, 160), (17.0, (11, 13, 23.5), 5.0, 0, 160), (19.5, (0, 11, 21), 10.0, 0, 340)]
    show = [(t0, c, rad * BURST_GROW, ink, int(n * SPARKS_GROW)) for (t0, c, rad, ink, n) in show]
    TRAIL, LIFE = 14, 2.7
    spark_m = [emit_mat('spark team', R, 26, soft=True), emit_mat('spark white', G, 26, soft=True), emit_mat('spark deep', B, 26, soft=True)]
    bursts = []
    for (t0, c, rad, ink, n) in show:
        d = rng.normal(0, 1, (n, 3)); d /= np.linalg.norm(d, axis=1, keepdims=True)
        bursts.append(dict(t0=t0, c=np.array(c, dtype=np.float32), d=d.astype(np.float32), speed=(rad * 3.5 * rng.uniform(0.8, 1.0, n)).astype(np.float32),
                           size=rng.uniform(0.17, 0.3, n).astype(np.float32), ink=ink, n=n, die=rng.uniform(0.7, 1.0, n).astype(np.float32),
                           q=Quads(f'burst{len(bursts)}', n * TRAIL, spark_m), rocket=Quads(f'rocket{len(bursts)}', 10, spark_m)))

    def animate(t):
        rise = ease(span(t, 0.0, 20.0))
        cam.location = (math.sin(t * 0.07) * 2.2, -29 + 3.5 * rise, 2.6 + 2.2 * rise)
        aim(cam, (0, 4, 9.5 + 3.0 * rise))
        # the crowd: white twinkle, then the wave, then all of it
        wave = ease(span(t, 2.5, 4.0)); allin = ease(span(t, 7.2, 8.6))
        on_wave = np.sin(ang * 3 - t * 2.4 - tier_of * 0.35) > (0.55 - 0.6 * wave)
        team = (on_wave & (wave > 0)) | (c_kind < allin)
        twinkle = np.sin(t * (2.0 + c_kind * 3) + c_phase) > 0.2
        kind = np.where(team, 0, np.where(c_kind < 0.34, 1, 2))
        pulse = 1 + 0.35 * np.sin(t * 6.0 - ang * 2) * allin
        size = c_size * np.where(team, 1.25 * pulse, np.where(twinkle, 0.85, 0.0)) * ease(span(t, 0.0, 1.2) + 0.0)
        crowd.face(pts, size, cam, kind)
        for top, cone, bm_, lamp_m, i in towers:
            hit = Vector((math.sin(t * 0.55 + i * 1.6) * 9.0, 2 + math.cos(t * 0.4 + i * 2.2) * 6.0, 0.0))
            cone.location = top.lerp(hit, 0.5); cone.rotation_euler = (top - hit).to_track_quat('Z', 'Y').to_euler()
            cone.scale = (1, 1, (top - hit).length / 28)
            up = ease(span(t, 0.6 + i * 0.25, 1.8 + i * 0.25))
            set_beam(bm_, 0.13 * up); set_strength(lamp_m, 9 * up)
        lit = []
        for b in bursts:
            tb = t - b['t0']
            # the rocket on its way up
            if -0.9 < tb <= 0:
                k = 1 + tb / 0.9
                base = np.array([b['c'][0] * 0.55, b['c'][1] - 3, 0.0], dtype=np.float32)
                ks = np.clip(k - np.arange(10) * 0.022, 0, 1)[:, None]
                rp = base[None, :] + (b['c'][None, :] - base[None, :]) * (1 - (1 - ks) ** 2)
                b['rocket'].face(rp, 0.11 * (1 - np.arange(10) / 11.0), cam, np.full(10, 1))
            else:
                b['rocket'].face(np.zeros((10, 3), dtype=np.float32), np.zeros(10), cam, np.full(10, 1))
            if not (0 < tb < LIFE):
                b['q'].face(np.zeros((b['n'] * TRAIL, 3), dtype=np.float32), np.zeros(b['n'] * TRAIL), cam, np.zeros(b['n'] * TRAIL))
                continue
            cs, ss = [], []
            for j in range(TRAIL):               # each spark drags a short tail behind it
                tj = max(0.0, tb - j * 0.0225)
                drag = (1 - math.exp(-2.4 * tj)) / 2.4
                p = b['c'][None, :] + b['d'] * (b['speed'] * drag)[:, None] + np.array([0, 0, -1.0], dtype=np.float32) * (1.9 * tj * tj * 0.5)
                fade = np.clip(1 - tb / (LIFE * b['die']), 0, 1) ** 0.6
                flick = 0.75 + 0.25 * np.sin(t * 40 + np.arange(b['n']))
                cs.append(p); ss.append(b['size'] * fade * flick * (1 - j / (TRAIL + 1.5)))
            b['q'].face(np.concatenate(cs), np.concatenate(ss), cam, np.full(b['n'] * TRAIL, b['ink']))
            if tb < 0.5: lit.append((b['c'], (1 - tb / 0.5) ** 2 * 8000 * np.sqrt(b['n'] / 100)))
        lit.sort(key=lambda x: -x[1])
        for i, fl in enumerate(flashes):
            if i < len(lit): fl.location = lit[i][0].tolist(); fl.data.energy = float(lit[i][1])
            else: fl.data.energy = 0
    return animate


# ── 3. Colour takeover ────────────────────────────────────────────────────────
# 0.0  a wall of balls in the dark, small ripples running through it
# 3.6  a spark at the centre, and the winner's colour spreads out in a wave
# 9.0  the wall is all one colour; rings keep rolling outward; sparks drift up
def takeover():
    cols, rows, step = 62, 33, 0.5
    j, i = np.mgrid[0:rows, 0:cols]
    x = (i - (cols - 1) / 2) * step + np.where(j % 2 == 1, step / 2, 0)
    z = (j - (rows - 1) / 2) * step * 0.866
    centers = np.stack([x.ravel(), np.zeros(x.size), z.ravel()], 1)
    NB = len(centers)
    # The wall starts grey (the white ink, dim): the team's colour arrives with the wave.
    mats = [mat('team', R, rough=0.34), mat('crest', (1, 0.22, 0.0), rough=0.25, emit=0.55), mat('grey', (0, 0.2, 0), rough=0.45), mat('dark', (0.0, 0.085, 0), rough=0.55)]
    wall = Balls('wall', centers, mats, segs=12)
    d = np.hypot(centers[:, 0] * 0.82, centers[:, 2] * 1.25)
    theta = np.arctan2(centers[:, 2], centers[:, 0])
    pattern = ((i * 7 + j * 13) % 5 < 2).ravel()
    jitter = rng.uniform(0, 0.12, NB)
    prim('plane', mat('back', (0, 0, 0), rough=1), loc=(0, 0.5, 0), rot=(math.pi / 2, 0, 0), size=120, smooth=False)
    lights = [light('AREA', (0, -9, 5), 1500, size=24), light('AREA', (-10, -6, -4), 450, size=10)]
    aim(lights[0], (0, 0, 0)); aim(lights[1], (0, 0, 0))
    for l in lights: l.data.use_shadow = False
    bpy.context.scene.eevee.use_raytracing = False
    cam = camera(lens=36)
    NS = 500
    sparks = Quads('sparks', NS, [emit_mat('sp', G, 3.0, soft=True), emit_mat('spR', R, 3.0, soft=True)])
    s_a, s_r, s_speed, s_phase = rng.uniform(0, TAU, NS), rng.uniform(0.2, 1.0, NS), rng.uniform(0.5, 1.6, NS), rng.uniform(0, 8, NS)
    s_ink = (rng.random(NS) < 0.45).astype(np.int32)
    s_spin = tumble(NS)
    REACH = 17.5

    def animate(t):
        cam.location = (math.sin(t * 0.13) * 0.9, -19.5 + 2.6 * ease(span(t, 0, 20)), math.cos(t * 0.11) * 0.4)
        aim(cam, (0, 0, 0))
        # before the wave: quiet ripples in the wall's own dark colours
        r1 = np.sin(d * 1.6 - t * 3.0) * np.exp(-((d - (t * 3.2 % 14)) ** 2) / 6.0)
        wave_r = -1.0 + (REACH + 1.5) * span(t, 3.6, 9.2) ** 1.35
        edge = d - wave_r + np.sin(theta * 5 + t * 0.8) * 0.55
        behind, crest = edge < -0.55, (edge >= -0.55) & (edge < 0.5)
        k = np.where(crest, 1 - np.abs(edge) / 0.55, 0.0)
        # after it: rings of the crest's light keep rolling out through the team colour
        ring_edge = (d - ((t - 9.0) * 5.5 % 9.0) * 2.2)
        ring = behind & (t > 9.0) & (np.abs(ring_edge) < 0.5)
        ringk = np.where(ring, 1 - np.abs(ring_edge) / 0.5, 0.0)
        kind = np.where(crest | ring, 1, np.where(behind, 0, np.where(pattern, 2, 3)))
        breathe = 0.012 * np.sin(t * 2.2 + d * 0.9)
        radius = np.where(crest, 0.235 + 0.075 * k, np.where(ring, 0.218 + 0.03 * ringk, np.where(behind, 0.215 + breathe, 0.19 + 0.025 * np.clip(r1, 0, 1))))
        push = np.zeros((NB, 3), dtype=np.float32)
        push[:, 1] = np.where(crest, -0.5 * k - 0.1, np.where(ring, -0.18 * ringk, np.where(behind, 0.0, jitter - 0.25 * np.clip(r1, 0, 1))))
        wall.place(radius.astype(np.float32), kind, push)
        lights[0].data.energy = 1500 * (0.55 + 0.45 * ease(span(t, 3.6, 9.0)))
        # sparks thrown off the crest, then drifting up the wall
        live = t > 3.8
        ts = (t * s_speed + s_phase)
        rr = np.where(t < 9.2, np.maximum(wave_r, 0) * (0.92 + 0.5 * (ts % 1.0)), REACH * s_r)
        up = np.where(t < 9.2, 0.0, ((ts * 1.3) % 10) - 5)
        sp = np.stack([np.cos(s_a) * rr / 0.82, -0.8 - 1.8 * (ts % 1.0), np.sin(s_a) * rr / 1.25 + up], 1)
        u, v = s_spin(t, 0.1)
        hide = np.full((NS, 1), not live)
        sparks.place(np.where(hide, 0, sp).astype(np.float32), np.where(hide, 0, u), np.where(hide, 0, v), s_ink)
    return animate


# ── running ───────────────────────────────────────────────────────────────────
def battery():
    """(percent, plugged in?) on Windows; (100, True) anywhere else."""
    try:
        class SPS(ctypes.Structure):
            _fields_ = [('ac', ctypes.c_byte), ('flag', ctypes.c_byte), ('pct', ctypes.c_byte), ('r', ctypes.c_byte), ('life', ctypes.c_ulong), ('full', ctypes.c_ulong)]
        s = SPS(); ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(s))
        return (s.pct & 0xFF), bool(s.ac & 1)
    except Exception:
        return 100, True


def log(line):
    print(line, flush=True)
    try:
        with open(os.path.join(OUT, 'log.txt'), 'a', encoding='utf-8') as f: f.write(f'{time.strftime("%H:%M:%S")} {line}\n')
    except OSError:
        pass


def battery_wait():
    pct, _ = battery()
    if pct > 20: return
    log(f'battery {pct}%: waiting for 80%')
    while battery()[0] < 80: time.sleep(60)
    log('battery back to 80%: carrying on')


def failed():
    print('FAILED', flush=True)
    traceback.print_exc()
    try:
        with open(os.path.join(OUT, 'log.txt'), 'a', encoding='utf-8') as fh: fh.write('FAILED\n' + traceback.format_exc())
    except OSError:
        pass
    sys.stdout.flush(); sys.stderr.flush()


def show_frames():
    """The window's big area shows each frame as it is finished (the owner watches)."""
    try:
        for win in bpy.context.window_manager.windows:
            areas = sorted(win.screen.areas, key=lambda a: -a.width * a.height)
            if not areas: continue
            big = areas[0]
            big.type = 'IMAGE_EDITOR'
            img = bpy.data.images.get('Render Result')
            if img: big.spaces.active.image = img
    except Exception:
        pass


def quit_now():
    bpy.ops.wm.quit_blender()   # always close the window this opened


try:
    os.makedirs(OUT, exist_ok=True)
    scene = reset()
    animate = {'trophy': trophy, 'stadium': stadium, 'takeover': takeover}[SCENE]()

    def on_frame(sc, *_):
        animate((sc.frame_current + sc.frame_subframe - 1) / FPS)
    bpy.app.handlers.frame_change_pre.append(on_frame)
    log(f'{SCENE}: frames {FIRST} to {LAST} at {WIDTH} wide, {FPS} a second')
    queue = [f for f in (ONLY or range(FIRST, LAST + 1)) if not os.path.exists(os.path.join(OUT, f'{f:04d}.png'))]
    state = {'done': 0, 'started': time.time()}

    def claim(f):
        """Several Blenders may render one film at once (the GPU idles while one places its
        pieces): each takes a frame by making its claim file first; a claim older than 15
        minutes is a stopped worker's, and is taken over."""
        png, mark = os.path.join(OUT, f'{f:04d}.png'), os.path.join(OUT, f'{f:04d}.claim')
        if os.path.exists(png): return False
        try:
            os.close(os.open(mark, os.O_CREAT | os.O_EXCL | os.O_WRONLY)); return True
        except FileExistsError:
            try:
                if time.time() - os.path.getmtime(mark) > 900:
                    os.utime(mark, None); return True
            except OSError:
                pass
            return False

    def step():
        try:
            while queue and not claim(queue[0]): queue.pop(0)
            if not queue:
                log(f'{SCENE}: DONE ({state["done"]} frames rendered now by this worker)')
                quit_now(); return None
            f = queue.pop(0)
            battery_wait()
            scene.frame_set(f)
            scene.render.filepath = os.path.join(OUT, f'{f:04d}.png')
            bpy.ops.render.render(write_still=True)
            try: os.remove(os.path.join(OUT, f'{f:04d}.claim'))
            except OSError: pass
            state['done'] += 1
            if state['done'] == 1: show_frames()
            if state['done'] % 10 == 0:
                each = (time.time() - state['started']) / state['done']
                log(f'{SCENE}: frame {f} of {LAST} ({each:.1f} s a frame, battery {battery()[0]}%)')
            return 0.05
        except Exception:
            failed(); quit_now(); return None
    bpy.app.timers.register(step, first_interval=1.0)
except Exception:
    failed()
    quit_now()

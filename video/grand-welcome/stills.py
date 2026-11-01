"""
KVBC Awana - the new grand welcome: LOOK STILLS  (Blender 5.2 LTS)
=================================================================

What this file does, in plain English
-------------------------------------
It is a recipe, like ../awana-intro/awana_intro.py. Blender reads it top to
bottom, BUILDS each little 3D scene from scratch with the real brand files in
the repo's shared/brand folder, and takes one picture of it. Nothing here is
the finished film: these are rough stills for choosing its look (see
BRIEF.md, "Still open").

You normally don't run this directly - double-click
    Make Grand Welcome Stills.bat
It takes about a minute on the RTX 4050 laptop and opens the folder when it
is done. To WATCH it work, double-click
    Watch Grand Welcome Stills.bat
instead: Blender opens full-screen and builds each scene in front of you,
shows it live through the camera, renders it, shows the finished picture,
then moves on (2 to 3 minutes; see "watch mode" below).

What it makes (all 1280 x 720, on pure black, no mascots), in
output/stills/ (git ignores the output folder - never commit renders):

    A1-A3     Story A, "six clubs converge": the club ribbons race in; they
              weave into a knot with a confetti burst; everything landed.
    B1-B3     Story B, "fly to the church doors": a stylized street at night;
              the church doors swing open with light pouring out; everything
              landed, inside.
    F1-F4     The landed frame in four feelings: stadium hype, wonder,
              fun and silly, warm and welcoming.
    M1-M3     The landed frame in three materials: glossy toy plastic,
              paper cut-out with hard shadows, light and neon.
    E1-E2     Where a tiny "2 Tim 2:15" could hide, and a close-up of it.
    contact-sheet.png   all of them on one labelled page.

"Landed" = WELCOME, the church's full logo (with the tagline) and the six
club marks. The logo is the kit's own vector file, made 3D. The club marks
are the kit's own files too, never redrawn: Blender's SVG reader cannot cut
them out of the catalog page they came from, so the script asks the
computer's web browser (Edge, else Chrome) to draw each file exactly as it
is into a picture, and that picture is what sits on each plate.

Engine: EEVEE on the graphics card. Only if EEVEE fails does a still fall
back to Cycles at low samples with the denoiser.

Options (after the -- on Blender's command line):
    --only A1,F3      just these stills
    --redo            render again even if the picture already exists
    --samples 64      EEVEE samples (Cycles fallback uses --cycles-samples 24)
    --engine cycles   skip EEVEE altogether
    --sheet           only remake the contact sheet
    --watch           build them in Blender's open window (no -b), always fresh;
                      --live 3 / --show 2.5 = seconds each scene / picture shows
"""

import bpy, bmesh, json, math, os, random, re, shutil, subprocess, sys, time
from mathutils import Vector, Matrix, Euler

# ---------------------------------------------------------------- settings --
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
BRAND = os.path.join(REPO, "shared", "brand")      # the ONE canonical kit
OUT = os.path.join(HERE, "output")
STILLS = os.path.join(OUT, "stills")
MARKS_DIR = os.path.join(OUT, "marks")             # the club marks, drawn by the browser
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PRE = "[welcome]"


def arg(name, default=None):
    if name in ARGS:
        i = ARGS.index(name)
        return ARGS[i + 1] if i + 1 < len(ARGS) and not ARGS[i + 1].startswith("--") else True
    return default


RES = (1280, 720)
random.seed(2152)                       # 2 Tim 2:15 - the same "random" every run

with open(os.path.join(BRAND, "tokens.json")) as fh:
    TOK = json.load(fh)
CLUBS = ["puggles", "cubbies", "sparks", "tnt", "trek", "journey"]   # youngest first
CLUB = {k: TOK["clubs"][k] for k in CLUBS}
HOUSE = TOK["house"]
PAYTONE = os.path.join(BRAND, "fonts", "PaytoneOne-Regular.ttf")
LONDRINA = os.path.join(BRAND, "fonts", "LondrinaSolid-Regular.ttf")
FIGTREE = os.path.join(BRAND, "fonts", "Figtree-Variable.ttf")


def lin(hexstr, a=1.0):
    """'#B3D0E7' -> linear RGBA (what Blender's colour sockets want)."""
    h = hexstr.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, a)


def log(m):
    print(f"{PRE} {m}", flush=True)


# ============================================================ the club marks ===
def find_browser():
    pf, pf86, la = (os.environ.get(k, "") for k in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"))
    cands = [os.path.join(pf86, r"Microsoft\Edge\Application\msedge.exe"),
             os.path.join(pf, r"Microsoft\Edge\Application\msedge.exe"),
             os.path.join(pf, r"Google\Chrome\Application\chrome.exe"),
             os.path.join(pf86, r"Google\Chrome\Application\chrome.exe"),
             os.path.join(la, r"Google\Chrome\Application\chrome.exe")]
    pw = os.path.join(la, "ms-playwright")
    if os.path.isdir(pw):
        for d in sorted(os.listdir(pw), reverse=True):
            if d.startswith("chromium-"):
                cands += [os.path.join(pw, d, sub, "chrome.exe") for sub in ("chrome-win64", "chrome-win")]
    for c in cands:
        if c and os.path.exists(c):
            return c
    return shutil.which("msedge") or shutil.which("chrome")


def svg_box(path):
    with open(path, encoding="utf-8") as fh:
        t = fh.read(4000)
    vb = re.search(r'viewBox="([^"]+)"', t).group(1).split()
    return float(vb[2]), float(vb[3])


def draw_marks():
    """Each club's official white mark (shared/brand/logos/<club>-white.svg),
    drawn by the web browser exactly as the file is, on a see-through
    background. Returns {club: (png path, width/height)}."""
    os.makedirs(MARKS_DIR, exist_ok=True)
    out, browser = {}, None
    for club in CLUBS:
        svg = os.path.join(BRAND, "logos", f"{club}-white.svg")
        w, h = svg_box(svg)
        png = os.path.join(MARKS_DIR, f"{club}-white.png")
        stale = not os.path.exists(png) or os.path.getmtime(png) < os.path.getmtime(svg)
        if stale:
            browser = browser or find_browser()
            if not browser:
                raise SystemExit(f"{PRE} needs Microsoft Edge or Chrome to draw the club marks")
            W = 1400
            H = round(W * h / w)
            page = os.path.join(MARKS_DIR, "_draw.html")
            with open(page, "w", encoding="utf-8") as fh:
                fh.write('<html><body style="margin:0;background:transparent">'
                         f'<img src="file:///{svg.replace(os.sep, "/")}" '
                         'style="width:100vw;height:100vh;object-fit:contain;display:block">'
                         '</body></html>')
            subprocess.run([browser, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                            "--no-first-run", f"--user-data-dir={os.path.join(MARKS_DIR, '_browser')}",
                            "--allow-file-access-from-files", "--default-background-color=00000000",
                            f"--window-size={W},{H}", f"--screenshot={png}",
                            "file:///" + page.replace(os.sep, "/")],
                           check=False, timeout=120, capture_output=True)
            # Edge can hand the job to a helper and return before the
            # picture is written: wait for it (up to 30 s)
            for _ in range(60):
                if os.path.exists(png) and os.path.getsize(png) > 0:
                    time.sleep(0.5)
                    break
                time.sleep(0.5)
            if not os.path.exists(png):
                raise SystemExit(f"{PRE} the browser could not draw {club}-white.svg")
            log(f"drew the {club} mark from the kit")
        out[club] = (png, w / h)
    return out


MARKS = {}


# ============================================================== helpers ===
def link(obj, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj


def reset_scene(name):
    if WATCH:
        # with Blender's window open, starting a new file would also throw
        # away the window's layout: empty the scene by hand instead
        sc = bpy.context.scene
        for data in (bpy.data.objects, bpy.data.meshes, bpy.data.curves, bpy.data.lights,
                     bpy.data.cameras, bpy.data.materials, bpy.data.worlds, bpy.data.node_groups,
                     bpy.data.images, bpy.data.fonts):
            try:
                bpy.data.batch_remove(list(data))
            except Exception:
                pass
        for c in list(sc.collection.children):
            bpy.data.collections.remove(c)
        sc.render.use_compositing = False
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        sc = bpy.context.scene
    sc.name = name
    sc.unit_settings.system = "METRIC"
    MATS.clear(); FONTS.clear()
    return sc


def verts_world(objs):
    pts = []
    for o in objs:
        m = o.matrix_world if o.type != "MESH" else Matrix.LocRotScale(o.location, o.rotation_euler, o.scale)
        pts += [m @ v.co for v in o.data.vertices]
    return pts


def bbox(objs):
    pts = verts_world(objs)
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def bake(o):
    """Push the object's move/turn/size into its mesh (object is then 'clean')."""
    o.data.transform(Matrix.LocRotScale(o.location, o.rotation_euler, o.scale))
    o.location = (0, 0, 0); o.rotation_euler = (0, 0, 0); o.scale = (1, 1, 1)


def move_to(objs, x=None, z=None, y=None):
    """Move a group of baked meshes so its box centre sits at (x, y, z)."""
    lo, hi = bbox(objs)
    c = (lo + hi) / 2
    d = Vector((0 if x is None else x - c.x, 0 if y is None else y - c.y, 0 if z is None else z - c.z))
    for o in objs:
        o.data.transform(Matrix.Translation(d))


def origin_to_centre(o):
    lo, hi = bbox([o])
    c = (lo + hi) / 2
    o.data.transform(Matrix.Translation(-c))
    o.location = c


def to_mesh(obj):
    """Bake a curve/text object into a real mesh object (same name/place)."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    new = bpy.data.objects.new(obj.name, me)
    new.location, new.rotation_euler, new.scale = obj.location.copy(), obj.rotation_euler.copy(), obj.scale.copy()
    for c in obj.users_collection:
        c.objects.link(new)
    bpy.data.objects.remove(obj)
    bake(new)
    return new


def smooth(o, angle=35):
    for p in o.data.polygons:
        p.use_smooth = True
    try:
        o.data.set_sharp_from_angle(angle=math.radians(angle))
    except Exception:
        pass


def split_loose(o):
    """One mesh -> one object per separate piece (the letters of a word)."""
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)   # weld front, back and walls
    bm.to_mesh(o.data); bm.free()
    bm = bmesh.new(); bm.from_mesh(o.data)
    bm.verts.ensure_lookup_table()
    seen, groups = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, g = [v], []
        seen.add(v.index)
        while stack:
            a = stack.pop(); g.append(a.index)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b.index not in seen:
                    seen.add(b.index); stack.append(b)
        groups.append(set(g))
    bm.free()
    pieces = []
    for i, g in enumerate(groups):
        bm = bmesh.new(); bm.from_mesh(o.data)
        bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in g], context="VERTS")
        me = bpy.data.meshes.new(f"{o.name} {i}")
        bm.to_mesh(me); bm.free()
        for m in o.data.materials:
            me.materials.append(m)
        p = bpy.data.objects.new(me.name, me)
        for c in o.users_collection:
            c.objects.link(p)
        pieces.append(p)
    bpy.data.objects.remove(o)
    pieces.sort(key=lambda p: bbox([p])[0].x)
    for p in pieces:
        smooth(p, 30)
    return pieces


def import_svg(path):
    before = set(bpy.data.objects)
    bpy.ops.import_curve.svg(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        if o.data and hasattr(o.data, "materials"):
            o.data.materials.clear()
    for c in list(bpy.data.collections):
        if not c.objects and not c.children:
            bpy.data.collections.remove(c)
    return new


def curve_pts(o):
    return [o.matrix_world @ p.co for s in o.data.splines for p in s.bezier_points] + \
           [o.matrix_world @ Vector(p.co[:3]) for s in o.data.splines for p in s.points]


def scale_curve(cu, k):
    cu.transform(Matrix.Scale(k, 4))
    for sp in cu.splines:
        for p in sp.bezier_points:
            p.radius = 1.0
        for p in sp.points:
            p.radius = 1.0


# ============================================================= materials ===
MATS = {}


def _mat(name):
    m = bpy.data.materials.new(name)
    if not m.node_tree:
        m.use_nodes = True
    m.node_tree.nodes.clear()
    return m, m.node_tree.nodes, m.node_tree.links


def plastic(color, rough=0.18, coat=1.0, name=None, glow=0.0, metallic=0.0):
    """Glossy toy plastic (the default look)."""
    name = name or f"Plastic {color} {rough} {glow}"
    if name in MATS:
        return MATS[name]
    m, N, L = _mat(name)
    out = N.new("ShaderNodeOutputMaterial")
    b = N.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = lin(color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = 0.05
    if glow:
        b.inputs["Emission Color"].default_value = lin(color)
        b.inputs["Emission Strength"].default_value = glow
    L.new(b.outputs[0], out.inputs["Surface"])
    MATS[name] = m
    return m


def paper(color, name=None):
    """Matte paper with a faint fibre texture."""
    name = name or f"Paper {color}"
    if name in MATS:
        return MATS[name]
    m, N, L = _mat(name)
    out = N.new("ShaderNodeOutputMaterial")
    b = N.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = lin(color)
    b.inputs["Roughness"].default_value = 0.92
    b.inputs["Sheen Weight"].default_value = 0.25
    tex = N.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = 140.0; tex.inputs["Detail"].default_value = 8.0
    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.08; bump.inputs["Distance"].default_value = 0.002
    L.new(tex.outputs["Fac"], bump.inputs["Height"])
    L.new(bump.outputs["Normal"], b.inputs["Normal"])
    L.new(b.outputs[0], out.inputs["Surface"])
    MATS[name] = m
    return m


def neon(color, strength=6.0, name=None):
    """Pure light (glows through the bloom)."""
    name = name or f"Neon {color} {strength}"
    if name in MATS:
        return MATS[name]
    m, N, L = _mat(name)
    out = N.new("ShaderNodeOutputMaterial")
    e = N.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = lin(color)
    e.inputs["Strength"].default_value = strength
    L.new(e.outputs[0], out.inputs["Surface"])
    MATS[name] = m
    return m


def matte(color, rough=0.6, name=None):
    name = name or f"Matte {color} {rough}"
    if name in MATS:
        return MATS[name]
    m, N, L = _mat(name)
    out = N.new("ShaderNodeOutputMaterial")
    b = N.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = lin(color)
    b.inputs["Roughness"].default_value = rough
    L.new(b.outputs[0], out.inputs["Surface"])
    MATS[name] = m
    return m


def mark_material(club, kind):
    """A club's official mark picture: plastic print, paper print or light."""
    name = f"Mark {club} {kind}"
    if name in MATS:
        return MATS[name]
    m, N, L = _mat(name)
    out = N.new("ShaderNodeOutputMaterial")
    img = N.new("ShaderNodeTexImage")
    img.image = bpy.data.images.load(MARKS[club][0], check_existing=True)
    img.interpolation = "Cubic"; img.extension = "CLIP"
    if kind == "neon":
        e = N.new("ShaderNodeEmission")
        e.inputs["Strength"].default_value = 5.0
        L.new(img.outputs["Color"], e.inputs["Color"])
        tr = N.new("ShaderNodeBsdfTransparent")
        mix = N.new("ShaderNodeMixShader")
        L.new(img.outputs["Alpha"], mix.inputs[0])
        L.new(tr.outputs[0], mix.inputs[1]); L.new(e.outputs[0], mix.inputs[2])
        L.new(mix.outputs[0], out.inputs["Surface"])
    else:
        b = N.new("ShaderNodeBsdfPrincipled")
        L.new(img.outputs["Color"], b.inputs["Base Color"])
        L.new(img.outputs["Alpha"], b.inputs["Alpha"])
        b.inputs["Roughness"].default_value = 0.9 if kind == "paper" else 0.2
        b.inputs["Coat Weight"].default_value = 0.0 if kind == "paper" else 1.0
        L.new(b.outputs[0], out.inputs["Surface"])
    if hasattr(m, "use_transparent_shadow"):
        m.use_transparent_shadow = True          # the see-through part casts no shadow
    MATS[name] = m
    return m


def volume(density=0.02, color="#FFFFFF", name="Haze"):
    m, N, L = _mat(name)
    out = N.new("ShaderNodeOutputMaterial")
    v = N.new("ShaderNodeVolumePrincipled")
    v.inputs["Density"].default_value = density
    v.inputs["Color"].default_value = lin(color)
    L.new(v.outputs[0], out.inputs["Volume"])
    return m


# ================================================================ shapes ===
def box(name, size, loc, mat, coll=None, bevel=0.0, rot=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me), coll)
    o.scale = size; o.location = loc; o.rotation_euler = Euler([math.radians(a) for a in rot])
    me.materials.append(mat)
    if bevel:
        bake(o)
        md = o.modifiers.new("Round", "BEVEL")
        md.width = bevel; md.segments = 3; md.limit_method = "ANGLE"
        o.location = Vector(loc) * 0      # baked already
        smooth(o, 40)
    return o


def rounded_outline(w, h, r, n=8):
    """Points of a rounded rectangle centred on (0, 0), in the XZ plane."""
    pts = []
    for cx, cz, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90),
                       (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return pts


def plate(name, w, h, depth, loc, mat, coll=None, r=None, round_edge=0.0):
    """A rounded-corner slab facing the camera (-Y), front face at loc.y."""
    r = min(w, h) * 0.18 if r is None else r
    bm = bmesh.new()
    vs = [bm.verts.new((x, 0, z)) for x, z in rounded_outline(w, h, r)]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    bmesh.ops.translate(bm, verts=[e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)],
                        vec=(0, depth, 0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    me.materials.append(mat)
    o = link(bpy.data.objects.new(name, me), coll)
    o.location = loc
    if round_edge:
        md = o.modifiers.new("Round", "BEVEL")
        md.width = round_edge; md.segments = 4; md.limit_method = "ANGLE"
    smooth(o, 40)
    return o


def outline_tube(name, w, h, loc, mat, coll=None, r=None, thick=0.03):
    """A rounded-rectangle neon tube."""
    r = min(w, h) * 0.18 if r is None else r
    cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"
    sp = cu.splines.new("POLY")
    pts = rounded_outline(w, h, r)
    sp.points.add(len(pts) - 1)
    for p, (x, z) in zip(sp.points, pts):
        p.co = (x, 0, z, 1)
    sp.use_cyclic_u = True
    cu.bevel_depth = thick; cu.bevel_resolution = 4
    cu.materials.append(mat)
    o = link(bpy.data.objects.new(name, cu), coll)
    o.location = loc
    return o


def image_card(name, w, h, loc, mat, coll=None):
    """A flat picture facing the camera."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([(-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new()
    for i, c in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[i].uv = c
    me.materials.append(mat)
    o = link(bpy.data.objects.new(name, me), coll)
    o.location = loc
    return o


FONTS = {}


def font(path):
    if path not in FONTS:
        FONTS[path] = bpy.data.fonts.load(path)
    return FONTS[path]


def text_mesh(body, width, depth, mat, coll=None, bevel=0.0, font_path=PAYTONE, tube=0.0, side_mat=None):
    """Words as one 3D mesh, width metres wide, standing up facing the camera,
    centred on (0, 0, 0). tube > 0: just the outline, as a round neon tube."""
    td = bpy.data.curves.new(body, "FONT")
    td.body = body; td.font = font(font_path)
    td.align_x = "CENTER"; td.align_y = "CENTER"
    o = link(bpy.data.objects.new(body, td), coll)
    probe = to_mesh(o)                               # measure at size 1
    lo, hi = bbox([probe]); w1 = hi.x - lo.x
    bpy.data.objects.remove(probe)
    td = bpy.data.curves.new(body, "FONT")
    td.body = body; td.font = font(font_path)
    td.align_x = "CENTER"; td.align_y = "CENTER"
    td.size = width / w1
    if tube:
        td.fill_mode = "NONE"; td.bevel_depth = tube; td.bevel_resolution = 4
    else:
        td.extrude = depth / 2
        if bevel:
            td.bevel_depth = bevel; td.bevel_resolution = 3; td.offset = -bevel
    td.materials.append(mat)
    if side_mat:
        td.materials.append(side_mat)
    o = link(bpy.data.objects.new(body, td), coll)
    o.rotation_euler = (math.radians(90), 0, 0)
    o = to_mesh(o)
    if side_mat:
        for p in o.data.polygons:
            if abs(p.normal.y) < 0.6:
                p.material_index = 1
    move_to([o], x=0, z=0, y=0)
    smooth(o, 30)
    return o


def logo_mesh(width, depth, mat, coll=None, bevel=0.004, file="kvbc-awana-full-white.svg", side_mat=None):
    """The church's FULL logo (with the tagline), the kit's own vector file,
    as one 3D mesh width metres wide, centred on (0, 0, 0)."""
    parts = import_svg(os.path.join(BRAND, "logos", file))
    for o in parts:
        link(o, coll)
    pts = [p for o in parts for p in curve_pts(o)]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), 0))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), 0))
    k = width / (hi.x - lo.x)
    meshes = []
    for o in parts:
        o.data.transform(Matrix.Translation(-(lo + hi) / 2))
        o.location = (0, 0, 0)
        scale_curve(o.data, k)
        cu = o.data
        cu.dimensions = "2D"; cu.fill_mode = "BOTH"
        cu.extrude = depth / 2
        cu.bevel_depth = bevel; cu.bevel_resolution = 1; cu.offset = 0.0
        cu.materials.append(mat)
        if side_mat:
            cu.materials.append(side_mat)
        o.rotation_euler = (math.radians(90), 0, 0)
        meshes.append(to_mesh(o))
    if side_mat:
        for m in meshes:
            for p in m.data.polygons:
                if abs(p.normal.y) < 0.6:
                    p.material_index = 1
    for m in meshes:
        smooth(m, 30)
    move_to(meshes, x=0, z=0, y=0)
    return meshes


DOODLES = {"sparkle": "sparkle-4pt.svg", "sparkleX": "sparkle-4pt-x.svg", "dot": "dot.svg",
           "ring": "ring.svg", "squiggle": "squiggle-wave.svg", "zigzag": "zigzag.svg",
           "loop": "loop.svg", "heart": "pixel-heart.svg", "spiral": "coil-spiral.svg",
           "smile": "smile-arc.svg", "steps": "zigzag-steps.svg"}


def doodle(kind, size, mat, coll=None, thick=0.12):
    """One brand doodle (shared/brand/doodles) about size metres wide:
    filled ones become chunky shapes, line ones round tubes."""
    objs = import_svg(os.path.join(BRAND, "doodles", DOODLES[kind]))
    o = objs[0]
    for extra in objs[1:]:
        bpy.data.objects.remove(extra)
    link(o, coll)
    pts = curve_pts(o)
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), 0))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), 0))
    o.data.transform(Matrix.Translation(-(lo + hi) / 2))
    k = size / max(hi.x - lo.x, hi.y - lo.y, 1e-6)
    scale_curve(o.data, k)
    cu = o.data
    if cu.dimensions == "3D" or cu.fill_mode in ("FULL", "NONE"):
        cu.dimensions = "3D"; cu.bevel_mode = "ROUND"; cu.bevel_depth = size * 0.045
        cu.bevel_resolution = 4; cu.use_fill_caps = True
    else:
        cu.dimensions = "2D"; cu.fill_mode = "BOTH"; cu.extrude = thick * size / 2
        b = cu.extrude * 0.6
        cu.bevel_depth = b; cu.bevel_resolution = 3; cu.offset = -b
    cu.materials.append(mat)
    o.rotation_euler = (math.radians(90), 0, 0)
    o = to_mesh(o)
    smooth(o, 30)
    origin_to_centre(o)
    return o


# =========================================================== the landing ===
# Camera at (0, -20, 0) looking down +Y, 50 mm: at y = 0 the frame is
# 14.4 m wide x 8.1 m tall. Every "landed" frame uses this layout.
CAM_D = 20.0
LAND = dict(welcome_w=8.4, welcome_z=2.35, logo_w=8.6, logo_z=-0.15,
            tile_w=1.62, tile_h=1.12, tile_z=-2.6, pitch=1.86)


# The words at the peak (owner 2026-11-01: "It should say welcome to Awana"):
# each wording = its lines of shout (text, width, height of centre) and the
# church's full logo (width, height of centre), in metres on the landed layout.
WORDINGS = {
    "welcome":  ([("WELCOME", 8.4, 2.35)], (8.6, -0.15)),
    "to_logo":  ([("WELCOME TO", 7.6, 2.5)], (9.6, -0.1)),
    "to_awana": ([("WELCOME TO", 5.2, 3.15), ("AWANA", 7.2, 1.45)], (5.4, -0.95)),
    "one_line": ([("WELCOME TO AWANA", 11.4, 2.45)], (8.2, -0.15)),
}


def build_landed(look="plastic", coll=None, welcome_colors=None, warm=False, wording="welcome"):
    """WELCOME + the church's full logo + the six club marks, landed.
    look: plastic | paper | neon. Returns the pieces for later dressing."""
    L = LAND
    res = {"letters": [], "logo": [], "tiles": [], "marks": [], "plates": []}
    if look == "plastic":
        face = plastic(HOUSE["cream"] if warm else "#FFFFFF", rough=0.16)
        side = plastic(HOUSE["hot"] if not warm else HOUSE["orange"], rough=0.25)
        lines, (logo_w, logo_z) = WORDINGS[wording]
        for text, width, z in lines:
            w = text_mesh(text, width, 0.55 * width / L["welcome_w"], face, coll, bevel=0.03, side_mat=side)
            move_to([w], z=z)
            res["letters"] += split_loose(w)
        if welcome_colors:
            for p, c in zip(res["letters"], welcome_colors):
                p.data.materials[0] = plastic(c, rough=0.16)
                if len(p.data.materials) > 1:
                    p.data.materials[1] = plastic(c, rough=0.3)
        lf = plastic(HOUSE["cream"] if warm else "#FFFFFF", rough=0.2)
        ls = plastic("#C9CDD6", rough=0.35)
        res["logo"] = logo_mesh(logo_w, 0.16, lf, coll, side_mat=ls)
        move_to(res["logo"], z=logo_z)
        for i, club in enumerate(CLUBS):
            x = (i - 2.5) * L["pitch"]
            t = plate(f"Tile {club}", L["tile_w"], L["tile_h"], 0.28, (x, 0, L["tile_z"]),
                      plastic(CLUB[club]["primary"], rough=0.15), coll, round_edge=0.05)
            mk = mark_card(club, (x, -0.012, L["tile_z"]), "plastic", coll)
            res["tiles"].append(t); res["marks"].append(mk)
    elif look == "paper":
        # Layers of cut paper standing a little apart, so a hard light throws
        # crisp shadows from each layer onto the one behind it.
        res["plates"].append(plate("WELCOME plate", L["welcome_w"] + 0.9, 2.1, 0.012,
                                   (0, 0.16, L["welcome_z"] + 0.02), paper(HOUSE["hot"]), coll, r=0.5))
        res["plates"].append(plate("Logo plate", L["logo_w"] + 0.9, 2.7, 0.012,
                                   (0, 0.3, L["logo_z"] - 0.05), paper(HOUSE["blue"]), coll, r=0.5))
        w = text_mesh("WELCOME", L["welcome_w"], 0.02, paper(HOUSE["cream"]), coll)
        move_to([w], z=L["welcome_z"])
        res["letters"] = split_loose(w)
        res["logo"] = logo_mesh(L["logo_w"], 0.02, paper("#FFFFFF"), coll, bevel=0.0)
        move_to(res["logo"], z=L["logo_z"], y=0.17)
        for i, club in enumerate(CLUBS):
            x = (i - 2.5) * L["pitch"]
            t = plate(f"Tile {club}", L["tile_w"], L["tile_h"], 0.012, (x, 0.25, L["tile_z"]),
                      paper(CLUB[club]["primary"]), coll)
            mk = mark_card(club, (x, 0.17, L["tile_z"]), "paper", coll)
            res["tiles"].append(t); res["marks"].append(mk)
    else:  # neon
        res["letters"] = [text_mesh("WELCOME", L["welcome_w"], 0, neon(HOUSE["hot"], 8), coll, tube=0.045)]
        move_to(res["letters"], z=L["welcome_z"])
        back = text_mesh("WELCOME", L["welcome_w"], 0.04, matte("#120A0A", 0.4), coll)
        move_to([back], z=L["welcome_z"], y=0.12)
        res["logo"] = logo_mesh(L["logo_w"], 0.03, neon("#FFFFFF", 3.2), coll, bevel=0.0)
        move_to(res["logo"], z=L["logo_z"])
        for i, club in enumerate(CLUBS):
            x = (i - 2.5) * L["pitch"]
            t = outline_tube(f"Tube {club}", L["tile_w"], L["tile_h"], (x, 0, L["tile_z"]),
                             neon(CLUB[club]["primary"], 9), coll)
            plate(f"Backing {club}", L["tile_w"], L["tile_h"], 0.03, (x, 0.08, L["tile_z"]),
                  matte("#0B0B0E", 0.5), coll)
            mk = mark_card(club, (x, -0.02, L["tile_z"]), "neon", coll, inset=0.8)
            res["tiles"].append(t); res["marks"].append(mk)
    return res


def mark_card(club, loc, kind, coll=None, inset=0.78):
    """The club's official mark, fitted inside its tile."""
    aspect = MARKS[club][1]
    bw, bh = LAND["tile_w"] * inset, LAND["tile_h"] * inset
    w, h = (bw, bw / aspect) if bw / aspect <= bh else (bh * aspect, bh)
    return image_card(f"Mark {club}", w, h, loc, mark_material(club, kind), coll)


# ============================================================ lights etc ===
def area(name, loc, target, power, color="#FFFFFF", size=4.0, coll=None, shape="DISK"):
    d = bpy.data.lights.new(name, "AREA")
    d.energy = power; d.color = lin(color)[:3]; d.size = size; d.shape = shape
    o = link(bpy.data.objects.new(name, d), coll)
    aim(o, loc, target)
    return o


def spot(name, loc, target, power, color="#FFFFFF", angle=20, blend=0.3, radius=0.05, coll=None):
    d = bpy.data.lights.new(name, "SPOT")
    d.energy = power; d.color = lin(color)[:3]
    d.spot_size = math.radians(angle); d.spot_blend = blend; d.shadow_soft_size = radius
    o = link(bpy.data.objects.new(name, d), coll)
    aim(o, loc, target)
    return o


def point(name, loc, power, color="#FFFFFF", radius=0.1, coll=None):
    d = bpy.data.lights.new(name, "POINT")
    d.energy = power; d.color = lin(color)[:3]; d.shadow_soft_size = radius
    o = link(bpy.data.objects.new(name, d), coll)
    o.location = loc
    return o


def sun(name, rot, power, color="#FFFFFF", angle=1.0, coll=None):
    d = bpy.data.lights.new(name, "SUN")
    d.energy = power; d.color = lin(color)[:3]; d.angle = math.radians(angle)
    o = link(bpy.data.objects.new(name, d), coll)
    o.rotation_euler = Euler([math.radians(a) for a in rot])
    return o


def aim(o, loc, target):
    o.location = Vector(loc)
    d = Vector(target) - Vector(loc)
    o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def camera(sc, loc, target, lens=50.0, roll=0.0, name="Camera"):
    c = bpy.data.cameras.new(name); c.lens = lens; c.sensor_width = 36.0
    c.clip_start = 0.1; c.clip_end = 400
    o = link(bpy.data.objects.new(name, c))
    aim(o, loc, target)
    if roll:
        o.rotation_euler = (o.rotation_euler.to_matrix() @ Matrix.Rotation(math.radians(roll), 3, "Z")).to_euler()
    sc.camera = o
    return o


def world(sc, ambient=0.25, color="#9AA6C0"):
    """The camera always sees pure black (the projector's rule); the scene is
    still gently lit by a dim dome so dark sides aren't lost."""
    w = bpy.data.worlds.new("Black"); sc.world = w
    if not w.node_tree:
        w.use_nodes = True
    nt = w.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = lin(color); bg.inputs["Strength"].default_value = ambient
    # looked at straight by the camera the sky is black (the watch mode's
    # live view shows this); everything is still lit by the dim dome
    black = nt.nodes.new("ShaderNodeBackground")
    black.inputs["Color"].default_value = (0, 0, 0, 1)
    lp = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
    nt.links.new(bg.outputs[0], mix.inputs[1]); nt.links.new(black.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    sc.render.film_transparent = True        # what the camera sees of the sky: nothing


def landed_lights(coll=None, warm=False, k=1.0):
    key_c = "#FFE6C8" if warm else "#FFF6EC"
    area("Key", (-7, -12, 7), (0, 0, 0), 2600 * k, key_c, 6, coll)
    area("Fill", (9, -10, -2), (0, 0, 0), 600 * k, "#DDE8FF" if not warm else "#FFD9B0", 8, coll)
    area("Rim L", (-6, 6, 6), (0, 0, 1), 1800 * k, "#CFE0FF" if not warm else "#FFC98A", 3, coll)
    area("Rim R", (6, 6, 6), (0, 0, 1), 1800 * k, "#FFD6E8" if not warm else "#FFB46A", 3, coll)


def confetti(n, centre, spread, coll=None, seed=1, size=(0.08, 0.2), burst=False, colors=None, look="plastic"):
    rnd = random.Random(seed)
    colors = colors or [CLUB[c]["primary"] for c in CLUBS] + [HOUSE["sun"], HOUSE["hot"]]
    me = bpy.data.meshes.new("Confetti")
    bm = bmesh.new()
    mats = []
    for i in range(n):
        if burst:
            d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 0.5), rnd.gauss(0, 1))).normalized()
            r = spread * (0.25 + 0.75 * rnd.random() ** 0.6)
            p = Vector(centre) + d * r
        else:
            p = Vector(centre) + Vector((rnd.uniform(-1, 1) * spread[0], rnd.uniform(-1, 1) * spread[1],
                                         rnd.uniform(-1, 1) * spread[2]))
        a, b = rnd.uniform(*size), rnd.uniform(*size) * 0.5
        rot = Euler((rnd.uniform(0, 6.3), rnd.uniform(0, 6.3), rnd.uniform(0, 6.3))).to_matrix()
        vs = [bm.verts.new(p + rot @ Vector(q)) for q in ((-a, 0, -b), (a, 0, -b), (a, 0, b), (-a, 0, b))]
        f = bm.faces.new(vs)
        c = colors[i % len(colors)]
        if c not in mats:
            mats.append(c)
        f.material_index = mats.index(c)
    bm.to_mesh(me); bm.free()
    for c in mats:
        me.materials.append(neon(c, 2.5) if look == "neon" else plastic(c, rough=0.3, coat=0.3))
    return link(bpy.data.objects.new("Confetti", me), coll)


def sparkles(n, region, coll=None, seed=3, color="#FFFFFF", size=(0.08, 0.3), strength=6):
    rnd = random.Random(seed)
    out = []
    for i in range(n):
        s = rnd.uniform(*size)
        o = doodle("sparkle", s, neon(color, strength), coll)
        o.location = (rnd.uniform(*region[0]), rnd.uniform(*region[1]), rnd.uniform(*region[2]))
        o.rotation_euler = (0, rnd.uniform(-0.4, 0.4), 0)
        out.append(o)
    return out


def ribbon(name, pts, width, color, coll=None, look="plastic", tilt=0.0):
    """A club ribbon along a list of points (a flat strip, both sides coloured)."""
    cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"
    cu.twist_mode = "MINIMUM"
    sp = cu.splines.new("NURBS")
    sp.points.add(len(pts) - 1)
    for i, (p, q) in enumerate(zip(sp.points, pts)):
        p.co = (*q, 1); p.tilt = tilt * i / max(1, len(pts) - 1)
    sp.order_u = min(4, len(pts)); sp.use_endpoint_u = True; sp.resolution_u = 24
    cu.extrude = width / 2
    cu.materials.append(neon(color, 4) if look == "neon" else plastic(color, rough=0.22, coat=0.8))
    o = link(bpy.data.objects.new(name, cu), coll)
    return o


# ======================================================== the 15 stills ===
def still_A1(sc):
    """Story A, 1: the six club ribbons race in from every side."""
    world(sc, 0.3)
    rnd = random.Random(11)
    starts = [(-16, -3, 6), (17, -2, 5), (-15, 2, -6), (16, 1, -5), (-3, -6, 11), (4, -4, -11)]
    for i, club in enumerate(CLUBS):
        s = Vector(starts[i])
        head = Vector((rnd.uniform(-3.5, 3.5), rnd.uniform(-1, 1), rnd.uniform(-1.6, 1.6)))
        pts = []
        for j in range(9):
            t = j / 8
            p = s.lerp(head, t)
            p += Vector((0, 2.2 * math.sin(t * 3.1 + i), 1.4 * math.sin(t * 6.0 + i * 1.7) * (1 - t)))
            pts.append(tuple(p))
        ribbon(f"Ribbon {club}", pts, 0.55, CLUB[club]["primary"], tilt=rnd.uniform(2, 5))
        # a glowing nose on each ribbon, and a few streaks behind it
        d = (Vector(pts[-1]) - Vector(pts[-2])).normalized()
        o = doodle("sparkle", 0.6, neon(CLUB[club]["tint"], 10))
        o.location = Vector(pts[-1]) + d * 0.25
        for k in range(3):
            a = Vector(pts[-1]) - d * (1.5 + k * 0.8) + Vector((0, 0, 0.35 * (k - 1)))
            ribbon(f"Streak {club} {k}", [tuple(a), tuple(a - d * 0.5), tuple(a - d * 1.4)], 0.025,
                   CLUB[club]["tint"], look="neon")
    landed_lights(k=0.8)
    camera(sc, (1.5, -17, 2.2), (0, 0, 0), lens=30, roll=-6)


def torus_knot(p, q, R, r, phase, n=180, rot=0.0, depth=1.0):
    pts = []
    for i in range(n + 1):
        t = 2 * math.pi * i / n
        rr = R + r * math.cos(q * t + phase)
        x, z = rr * math.cos(p * t), rr * math.sin(p * t)
        y = -r * math.sin(q * t + phase) * depth
        c, s = math.cos(rot), math.sin(rot)
        pts.append((x * c - z * s, y, x * s + z * c))
    return pts


def still_A2(sc):
    """Story A, 2: the ribbons weave into one knot - and burst."""
    world(sc, 0.3)
    for i, club in enumerate(CLUBS):
        pts = torus_knot(2, 3, 1.9, 0.75, 0, n=120, rot=math.radians(20 * i), depth=1.2)
        o = ribbon(f"Knot {club}", pts, 0.34, CLUB[club]["primary"])
        o.data.splines[0].use_cyclic_u = True
    core = bpy.data.meshes.new("Core")
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=0.55)
    bm.to_mesh(core); bm.free()
    c = link(bpy.data.objects.new("Flash", core)); c.data.materials.append(neon("#FFF4D6", 30))
    smooth(c)
    confetti(420, (0, 0, 0), 7.5, burst=True, seed=7, size=(0.06, 0.16))
    sparkles(14, ((-6, 6), (-2, 1), (-3.5, 3.5)), seed=5, color="#FFFFFF", size=(0.12, 0.35), strength=8)
    point("Flash light", (0, -0.5, 0), 900, "#FFF0D0", 0.4)
    landed_lights(k=0.7)
    camera(sc, (0, -15, 0.8), (0, 0, 0), lens=40, roll=4)


def still_A3(sc):
    """Story A, 3: everything landed; the six ribbons settle into one swoop."""
    world(sc, 0.3)
    res = build_landed("plastic")
    for i, club in enumerate(CLUBS):
        z0 = -1.62 - 0.085 * i
        pts = [(-10, 1.2, z0 + 0.5), (-5, 0.9, z0 - 0.1), (0, 0.9, z0 + 0.08), (5, 0.9, z0 - 0.1), (10, 1.2, z0 + 0.4)]
        ribbon(f"Swoop {club}", pts, 0.075, CLUB[club]["primary"])
    confetti(160, (0, 3.5, 0.3), (9.5, 2.5, 5.0), seed=9, size=(0.06, 0.14))
    landed_lights()
    camera(sc, (0, -CAM_D, 0), (0, 0, 0))
    return res


def build_street(coll=None, rnd=None):
    """A stylized town street at night, straight up the middle to the church."""
    rnd = rnd or random.Random(4)
    asphalt = plastic("#17161A", rough=0.32, coat=0.4, name="Asphalt")
    walk = matte("#3A3840", 0.7)
    box("Road", (7, 120, 0.1), (0, 40, -0.05), asphalt, coll)
    for sx in (-1, 1):
        box(f"Walk {sx}", (2.4, 120, 0.3), (sx * 4.7, 40, 0.0), walk, coll)
    for k in range(18):
        box(f"Dash {k}", (0.18, 1.6, 0.02), (0, -12 + k * 4.2, 0.01), neon(HOUSE["sun"], 0.6), coll)
    deeps = ["#1A2A4A", "#2A2050", "#123A3A", "#3A1E2A", "#1E3A5A", "#2B2B3F"]
    win_cols = [HOUSE["cream"], HOUSE["cream"], HOUSE["sun"], HOUSE["cream"]] + [CLUB[c]["tint"] for c in CLUBS]
    for sx in (-1, 1):
        y = -14
        while y < 52:
            w = rnd.uniform(4.5, 7.5); h = rnd.uniform(4.5, 12.0); dpt = 6
            x = sx * (6.4 + dpt / 2)
            col = rnd.choice(deeps)
            box(f"House {sx} {y:.0f}", (dpt, w - 0.4, h), (x, y + w / 2, h / 2), matte(col, 0.55), coll, bevel=0.08)
            # roof cap in a club colour
            box(f"Roof {sx} {y:.0f}", (dpt + 0.3, w - 0.1, 0.3), (x, y + w / 2, h + 0.1),
                plastic(CLUB[rnd.choice(CLUBS)]["deep"], 0.3), coll)
            fx = sx * 6.38
            rows, cols = int(h // 1.6), max(1, int((w - 0.6) // 1.3))
            for r in range(rows):
                for c in range(cols):
                    if rnd.random() < 0.55:
                        wy = y + 0.65 + (c + 0.5) * (w - 1.0) / cols
                        box("Window", (0.05, 0.6, 0.8), (fx, wy, 1.3 + r * 1.6),
                            neon(rnd.choice(win_cols), rnd.uniform(1.5, 4)), coll)
            y += w
    # street lamps
    for k, y in enumerate(range(-10, 50, 9)):
        for sx in (-1, 1):
            x = sx * 4.0
            box("Pole", (0.12, 0.12, 4.4), (x, y + (4 if sx > 0 else 0), 2.2), matte("#2A2A30", 0.4), coll)
            box("Arm", (0.8, 0.1, 0.1), (x - sx * 0.4, y + (4 if sx > 0 else 0), 4.35), matte("#2A2A30", 0.4), coll)
            b = box("Bulb", (0.35, 0.35, 0.18), (x - sx * 0.75, y + (4 if sx > 0 else 0), 4.22),
                    neon("#FFE2A8", 12), coll)
            point("Lamp", (x - sx * 0.75, y + (4 if sx > 0 else 0), 4.0), 380, "#FFD69A", 0.25, coll)


CHURCH_Y = 56.0


def build_church(coll=None, door_open=0.0, glow=1.0, wash=1.0):
    """The church at the end of the street: white walls, a steeple, a round
    window and big double doors (door_open 0..1 swings them out)."""
    wall = plastic("#E9E4DA", rough=0.4, coat=0.2, name="Church wall")
    trim = plastic(HOUSE["ink"], rough=0.35, name="Church trim")
    y = CHURCH_Y
    box("Nave", (11, 9, 7), (0, y + 4.5, 3.5), wall, coll, bevel=0.06)
    # gable roof: a prism
    me = bpy.data.meshes.new("Gable")
    W, H, D = 6.0, 3.6, 9.4
    vs = [(-W, -0.2, 0), (W, -0.2, 0), (0, -0.2, H), (-W, D, 0), (W, D, 0), (0, D, H)]
    me.from_pydata(vs, [], [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)])
    me.materials.append(plastic("#2F3A5A", 0.3, name="Church roof"))
    g = link(bpy.data.objects.new("Gable", me), coll); g.location = (0, y, 7)
    box("Gable face", (10.6, 0.05, 0.25), (0, y - 0.15, 7.05), trim, coll)
    # steeple
    box("Tower", (2.6, 2.6, 6), (0, y + 1.0, 12.5), wall, coll, bevel=0.05)
    box("Belfry", (2.0, 2.7, 1.6), (0, y + 1.0, 14.0), neon("#FFE7B0", 1.2 * glow), coll)
    me = bpy.data.meshes.new("Spire")
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=1.9, radius2=0.0, depth=5)
    bm.to_mesh(me); bm.free()
    me.materials.append(plastic("#2F3A5A", 0.3, name="Church roof"))
    sp = link(bpy.data.objects.new("Spire", me), coll); sp.location = (0, y + 1.0, 18.0)
    sp.rotation_euler = (0, 0, math.radians(45))
    # the cross on top
    box("Cross v", (0.14, 0.14, 1.4), (0, y + 1.0, 21.1), neon("#FFFFFF", 3), coll)
    box("Cross h", (0.8, 0.14, 0.14), (0, y + 1.0, 21.35), neon("#FFFFFF", 3), coll)
    # round window
    me = bpy.data.meshes.new("Rose")
    bm = bmesh.new(); bmesh.ops.create_circle(bm, cap_ends=True, segments=40, radius=1.0)
    bm.to_mesh(me); bm.free()
    me.materials.append(neon(HOUSE["sun"], 3 * glow))
    rw = link(bpy.data.objects.new("Rose window", me), coll)
    rw.location = (0, y - 0.03, 8.3); rw.rotation_euler = (math.radians(90), 0, 0)
    # steps
    for k in range(3):
        box(f"Step {k}", (5.5 - k * 0.6, 1.2, 0.25), (0, y - 1.6 + k * 0.5, 0.12 + k * 0.25),
            plastic("#BEB7AA", 0.6, coat=0, name="Step"), coll)
    # the doorway: light behind the doors
    box("Doorway light", (3.4, 0.1, 4.2), (0, y + 0.3, 2.85), neon("#FFF1D2", 9 * glow), coll)
    box("Door frame", (4.0, 0.3, 0.3), (0, y - 0.1, 5.05), trim, coll)
    door = plastic(HOUSE["hot"], rough=0.25, name="Doors")
    knob = plastic(HOUSE["sun"], rough=0.15, metallic=1.0, name="Brass")
    ang = math.radians(78) * door_open
    for side in (-1, 1):
        hinge = Vector((side * 1.7, y - 0.12, 0.75))
        d = box(f"Door {side}", (1.68, 0.16, 4.2), (0, 0, 0), door, coll, bevel=0.03)
        d.data.transform(Matrix.Translation((-side * 0.84, 0, 2.1)))
        kb = box("Knob", (0.16, 0.16, 0.16), (0, 0, 0), knob, coll)
        kb.data.transform(Matrix.Translation((-side * 1.5, -0.14, 2.0)))
        for o in (d, kb):
            o.location = hinge
            o.rotation_euler = (0, 0, side * ang)
    spot("Facade wash L", (-9, y - 16, 1), (0, y, 6), 9000 * wash, "#FFE9C8", 34, coll=coll)
    spot("Facade wash R", (9, y - 16, 1), (0, y, 6), 9000 * wash, "#DCE6FF", 34, coll=coll)


def still_B1(sc):
    """Story B, 1: down a stylized street at night to the church."""
    world(sc, 0.04, "#6070A0")
    build_street()
    build_church()
    sparkles(18, ((-14, 14), (60, 70), (16, 28)), seed=8, color="#FFFFFF", size=(0.2, 0.5), strength=4)
    camera(sc, (0, -18, 4.2), (0, CHURCH_Y, 6.5), lens=30)


def still_B2(sc):
    """Story B, 2: the doors swing open; light pours out."""
    world(sc, 0.0)
    build_street()
    build_church(door_open=0.62, glow=1.6, wash=0.15)
    # haze only in front of the doors, so the light pouring out shows as beams
    box("Haze", (7, 10, 6), (0, CHURCH_Y - 5.2, 3.0), volume(0.07, "#FFFFFF"), None)
    spot("Pour", (0, CHURCH_Y + 1.2, 3.0), (0, CHURCH_Y - 14, -0.5), 12000, "#FFE7BE", 30, 0.4, 0.6)
    point("Spill", (0, CHURCH_Y - 1.0, 2.2), 500, "#FFE7BE", 1.0)
    sparkles(10, ((-2.5, 2.5), (CHURCH_Y - 3, CHURCH_Y - 1), (1.0, 5.5)), seed=12, color=HOUSE["cream"],
             size=(0.08, 0.2), strength=6)
    camera(sc, (0.8, CHURCH_Y - 28, 4.0), (0, CHURCH_Y, 9.0), lens=30, roll=-2)
    sc.eevee.use_volumetric_shadows = True


def still_B3(sc):
    """Story B, 3: inside - everything landed, framed by the doorway."""
    world(sc, 0.3)
    res = build_landed("plastic", warm=True)
    landed_lights(warm=True)
    # warm floor running in from the doorway
    box("Floor", (30, 40, 0.1), (0, 2, -3.9), plastic("#1E130C", 0.5, 0.2, name="Floor"), None)
    trim = plastic("#2A1A12", rough=0.45, name="Frame")
    for sx in (-1, 1):
        box(f"Jamb {sx}", (1.6, 0.9, 12), (sx * 5.9, -8, 0), trim, bevel=0.05)
        # the open doors, swung back into the room, just catching the light
        d = box(f"Open door {sx}", (2.4, 0.18, 6.9), (0, 0, 0), plastic(HOUSE["hot"], 0.3, name="Doors"))
        d.data.transform(Matrix.Translation((sx * 1.2, 0, 0)))
        d.location = (sx * 5.1, -7.6, -0.75); d.rotation_euler = (0, 0, sx * math.radians(-70))
    box("Lintel", (13.4, 0.9, 1.6), (0, -8, 3.85), trim, bevel=0.05)
    sparkles(16, ((-6.5, 6.5), (0.6, 3), (-3.4, 3.8)), seed=21, color=HOUSE["cream"], size=(0.08, 0.22), strength=5)
    camera(sc, (0, -CAM_D, -0.3), (0, 0, -0.3), lens=35)
    return res


def still_F1(sc):
    """Feeling: stadium hype - low hero angle, crossing beams, confetti."""
    world(sc, 0.03)                 # almost no fill: the haze stays black between beams
    build_landed("plastic")
    beams = [(-9, 4, -6, "#FFFFFF"), (9, 4, -6, "#FFFFFF"), (-5, 6, -6, CLUB["sparks"]["primary"]),
             (5, 6, -6, CLUB["cubbies"]["primary"]), (-12, 8, -6, HOUSE["sun"]), (12, 8, -6, CLUB["tnt"]["primary"])]
    for i, (x, y, z, c) in enumerate(beams):
        tgt = (-x * 0.7, y + 4, 12)
        spot(f"Beam {i}", (x, y + 4, z - 3), tgt, 120000, c, 4.0, 0.1, 0.05)
    box("Haze", (44, 20, 30), (0, 16, 3), volume(0.009, "#FFFFFF"), None)
    area("Key", (-9, -12, 6), (0, 0, 1), 2600, "#FFFFFF", 3)
    area("Fill", (9, -12, 5), (0, 0, 1), 900, "#FFFFFF", 3)
    for o in bpy.data.objects:        # only the beams light the haze
        if o.type == "LIGHT" and not o.name.startswith("Beam"):
            o.data.volume_factor = 0.0
    area("Rim L", (-6, 5, 7), (0, 0, 1), 2500, "#FFFFFF", 2)
    area("Rim R", (6, 5, 7), (0, 0, 1), 2500, HOUSE["sun"], 2)
    confetti(260, (0, 3.5, 2.0), (11, 2.5, 6), seed=31, size=(0.06, 0.15))
    confetti(40, (0, -6, 2.5), (6, 1.5, 0.6), seed=32, size=(0.04, 0.09))
    camera(sc, (0, -17, -3.2), (0, 0, 0.4), lens=32)
    sc.eevee.use_volumetric_shadows = True


def still_F2(sc, wording="welcome"):
    """Feeling: wonder - still and hushed, starlight drifting up.
    (Also the chosen look, for trying the wordings: W1-W3.)"""
    world(sc, 0.18, "#7080C0")
    build_landed("plastic", wording=wording)
    area("Key", (-4, -12, 9), (0, 0, 0), 1500, "#E6EEFF", 8)
    area("Rim L", (-7, 6, 4), (0, 0, 1), 2600, CLUB["journey"]["primary"], 3)
    area("Rim R", (7, 6, 4), (0, 0, 1), 2600, CLUB["puggles"]["primary"], 3)
    area("Under", (0, -6, -8), (0, 0, 0), 600, CLUB["cubbies"]["tint"], 6)
    sparkles(46, ((-8.5, 8.5), (0.8, 6), (-4.6, 4.6)), seed=41, color="#EAF2FF", size=(0.05, 0.26), strength=7)
    for i in range(160):
        rnd = random.Random(400 + i)
        d = bpy.data.meshes.new("Star")
        bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=1, radius=rnd.uniform(0.008, 0.03))
        bm.to_mesh(d); bm.free()
        d.materials.append(neon("#FFFFFF", rnd.uniform(3, 12)))
        o = link(bpy.data.objects.new("Star", d))
        o.location = (rnd.uniform(-9, 9), rnd.uniform(2, 12), rnd.uniform(-5, 5.5))
    camera(sc, (0, -CAM_D - 1, -0.6), (0, 0, 0.1), lens=50)


def still_F3(sc):
    """Feeling: fun and silly - letters bounce and tip, doodles everywhere."""
    world(sc, 0.4)
    order = ["sparks", "cubbies", "tnt", "puggles", "journey", "trek", "sparks"]
    res = build_landed("plastic", welcome_colors=[CLUB[c]["primary"] for c in order])
    rnd = random.Random(51)
    for i, p in enumerate(res["letters"]):
        origin_to_centre(p)
        p.location.z += 0.3 * math.sin(i * 1.9) + 0.15
        p.rotation_euler = (math.radians(rnd.uniform(-12, 12)), math.radians(rnd.uniform(-14, 14)),
                            math.radians(rnd.uniform(-10, 10)))
    for i, (t, m) in enumerate(zip(res["tiles"], res["marks"])):
        piv = Vector((t.location.x, 0, t.location.z))
        ang = math.radians((-1) ** i * rnd.uniform(5, 11))
        dz = 0.25 * ((-1) ** (i + 1))
        for o in (t, m):
            o.location = piv + Matrix.Rotation(ang, 3, "Y") @ (o.location - piv) + Vector((0, 0, dz))
            o.rotation_euler = (0, ang, 0)
    kinds = ["squiggle", "zigzag", "smile", "loop", "heart", "spiral", "ring", "steps", "sparkle", "dot"]
    cols = [CLUB[c]["primary"] for c in CLUBS] + [HOUSE["sun"], HOUSE["hot"]]
    spots = [(-6.4, 3.3), (6.3, 3.4), (-6.7, 0.6), (6.6, 0.4), (-5.4, -1.4), (5.6, -1.3),
             (-2.9, 3.6), (3.0, 3.7), (-6.6, -3.5), (6.6, -3.5), (0, -3.75), (-4.2, 1.2), (4.3, 1.1)]
    for i, (x, z) in enumerate(spots):
        o = doodle(kinds[i % len(kinds)], rnd.uniform(0.6, 1.1), plastic(cols[i % len(cols)], 0.2))
        o.location = (x, rnd.uniform(-1.5, 0.5), z)
        o.rotation_euler = (math.radians(rnd.uniform(-20, 20)), math.radians(rnd.uniform(-40, 40)), 0)
    landed_lights(k=1.1)
    area("Top", (0, -6, 10), (0, 0, 0), 1500, "#FFFFFF", 10)
    camera(sc, (-1.2, -CAM_D, 0.6), (0, 0, 0), lens=48, roll=-4)


def still_F4(sc):
    """Feeling: warm and welcoming - golden light, a soft glow, open arms."""
    world(sc, 0.3, "#C0A080")
    build_landed("plastic", warm=True)
    landed_lights(warm=True)
    # a soft warm glow behind the logo, fading to black at its edge
    m, N, L = _mat("Warm glow")
    out = N.new("ShaderNodeOutputMaterial")
    tc = N.new("ShaderNodeTexCoord"); grad = N.new("ShaderNodeTexGradient"); grad.gradient_type = "SPHERICAL"
    ramp = N.new("ShaderNodeValToRGB"); ramp.color_ramp.interpolation = "EASE"
    ramp.color_ramp.elements[0].position = 0.0; ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
    ramp.color_ramp.elements[1].position = 1.0; ramp.color_ramp.elements[1].color = lin("#FF9A3C")
    em = N.new("ShaderNodeEmission"); em.inputs["Strength"].default_value = 0.3
    L.new(tc.outputs["Object"], grad.inputs["Vector"]); L.new(grad.outputs["Fac"], ramp.inputs["Fac"])
    L.new(ramp.outputs["Color"], em.inputs["Color"]); L.new(em.outputs[0], out.inputs["Surface"])
    g = image_card("Glow", 2, 2, (0, 3.0, 0.2), m)
    g.scale = (9.5, 1, 6.0)
    rnd = random.Random(61)
    for i in range(8):
        o = doodle("heart", rnd.uniform(0.35, 0.6), plastic(rnd.choice([HOUSE["hot"], HOUSE["sun"], HOUSE["orange"]]), 0.2))
        a = i / 8 * 2 * math.pi
        o.location = (6.4 * math.cos(a), rnd.uniform(-0.5, 0.5), 3.4 * math.sin(a) - 0.1)
        o.rotation_euler = (0, math.radians(rnd.uniform(-20, 20)), 0)
    camera(sc, (0, -CAM_D, 0), (0, 0, 0), lens=50)


def still_M(sc, look):
    world(sc, 0.25 if look != "neon" else 0.05)
    build_landed(look)
    if look == "paper":
        # one hard, low light from the upper left: crisp paper shadows
        sun("Hard light", (58, -8, -34), 4.2, "#FFF6E8", angle=0.4)
        area("Soft fill", (8, -14, -2), (0, 0, 0), 500, "#E8EEFF", 10)
        confetti(70, (0, 2.0, 0), (9.0, 0.8, 4.6), seed=71, size=(0.08, 0.16))
    elif look != "neon":
        landed_lights()
    camera(sc, (0, -CAM_D, 0), (0, 0, 0), lens=50)


EGG_TEXT = "2 Tim 2:15"


def still_E(sc, close=False):
    """The easter egg: one confetti piece, near the Journey mark, carries the
    reference in tiny letters - a still frame will show it, a passing eye won't."""
    world(sc, 0.3)
    res = build_landed("plastic")
    confetti(140, (0, 3.5, 0.2), (9.5, 2.5, 5.0), seed=81, size=(0.06, 0.14))
    landed_lights()
    # the egg piece: a sun-yellow confetti slip just above the Journey tile
    x = LAND["pitch"] * 2.5 + 0.35
    z = LAND["tile_z"] + LAND["tile_h"] / 2 + 0.28
    slip = plate("Egg slip", 0.62, 0.2, 0.012, (0, 0, 0), plastic(HOUSE["sun"], 0.3, coat=0.3), None, r=0.04)
    t = text_mesh(EGG_TEXT, 0.5, 0.004, plastic(HOUSE["ink"], 0.4, coat=0.0), None, font_path=FIGTREE)
    t.data.transform(Matrix.Translation((0, -0.004, 0)))
    for o in (slip, t):
        o.location = (x, -1.2, z)
        o.rotation_euler = (math.radians(8), math.radians(-14), math.radians(6))
    sc["egg"] = (x, -1.2, z)
    cam = camera(sc, (0, -CAM_D, 0), (0, 0, 0), lens=50)
    if close:
        aim(cam, (0, -CAM_D, 0), (x, -1.2, z))
        cam.data.lens = 360


STORY = [
    ("A1", "A1  Story A: the club ribbons race in", still_A1),
    ("A2", "A2  Story A: they weave into a knot, confetti burst", still_A2),
    ("A3", "A3  Story A: everything landed", still_A3),
    ("B1", "B1  Story B: down the street at night to the church", still_B1),
    ("B2", "B2  Story B: the doors swing open, light pours out", still_B2),
    ("B3", "B3  Story B: everything landed, inside the doors", still_B3),
    ("F1", "F1  Feeling: stadium hype", still_F1),
    ("F2", "F2  Feeling: wonder", still_F2),
    ("F3", "F3  Feeling: fun and silly", still_F3),
    ("F4", "F4  Feeling: warm and welcoming", still_F4),
    ("M1", "M1  Material: glossy toy plastic", lambda sc: still_M(sc, "plastic")),
    ("M2", "M2  Material: paper cut-out, hard shadows", lambda sc: still_M(sc, "paper")),
    ("M3", "M3  Material: light and neon", lambda sc: still_M(sc, "neon")),
    ("E1", "E1  Easter egg: the whole frame (circled)", lambda sc: still_E(sc)),
    ("E2", "E2  Easter egg: close-up of the same spot", lambda sc: still_E(sc, close=True)),
    ("W1", "W1  \"WELCOME TO\" over the church's logo", lambda sc: still_F2(sc, "to_logo")),
    ("W2", "W2  \"WELCOME TO AWANA\" big, the logo below", lambda sc: still_F2(sc, "to_awana")),
    ("W3", "W3  \"WELCOME TO AWANA\" on one line", lambda sc: still_F2(sc, "one_line")),
]


# ================================================================ render ===
def glow_compositor(sc, strength=0.6):
    """A soft bloom on anything brighter than white (lights, neon)."""
    try:
        ng = bpy.data.node_groups.new("Glow", "CompositorNodeTree")
        ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        rl = ng.nodes.new("CompositorNodeRLayers")
        gl = ng.nodes.new("CompositorNodeGlare")
        gl.inputs["Type"].default_value = "Bloom"
        gl.inputs["Highlights Threshold"].default_value = 1.0
        gl.inputs["Strength"].default_value = strength
        gl.inputs["Size"].default_value = 0.35
        out = ng.nodes.new("NodeGroupOutput")
        ng.links.new(rl.outputs["Image"], gl.inputs["Image"])
        ng.links.new(gl.outputs["Image"], out.inputs["Image"])
        sc.compositing_node_group = ng
        sc.render.use_compositing = True
    except Exception as e:
        log(f"no bloom ({e})")


def setup_render(sc, engine):
    r = sc.render
    r.resolution_x, r.resolution_y = RES
    r.resolution_percentage = int(arg("--pct", 100))
    sc.view_settings.view_transform = "Standard"     # exact brand colours
    sc.view_settings.look = "None"
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGB"              # see-through sky -> pure black
    if engine == "EEVEE":
        r.engine = "BLENDER_EEVEE"
        ee = sc.eevee
        ee.taa_render_samples = int(arg("--samples", 64))
        ee.use_raytracing = True
        try:
            ee.ray_tracing_method = "SCREEN"
            ee.ray_tracing_options.use_denoise = True
        except Exception:
            pass
        ee.use_shadows = True
        ee.shadow_resolution_scale = 1.0
        ee.volumetric_tile_size = "4"
        ee.volumetric_samples = 96
    else:
        r.engine = "CYCLES"
        cy = sc.cycles
        cy.samples = int(arg("--cycles-samples", 24))
        cy.use_denoising = True; cy.denoiser = "OPENIMAGEDENOISE"
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            for dev in ("OPTIX", "CUDA"):
                try:
                    prefs.compute_device_type = dev; prefs.get_devices()
                    if any(d.type == dev for d in prefs.devices):
                        for d in prefs.devices:
                            d.use = d.type == dev
                        cy.device = "GPU"; break
                except Exception:
                    continue
        except Exception as e:
            log(f"Cycles GPU setup skipped: {e}")


def project(sc, p):
    from bpy_extras.object_utils import world_to_camera_view
    v = world_to_camera_view(sc, sc.camera, Vector(p))
    return v.x, 1 - v.y


ENGINES = ["CYCLES"] if str(arg("--engine", "")).lower() == "cycles" else ["EEVEE", "CYCLES"]


def build_still(sid, fn, engine):
    """Build one still's scene, ready to render."""
    sc = reset_scene(f"Grand welcome {sid}")
    fn(sc)
    setup_render(sc, engine)
    if float(arg("--bloom", 1)) > 0:
        glow_compositor(sc, float(arg("--bloom", 1)) * (0.7 if sid in ("M3", "A2", "B2", "F2") else 0.4))
    sc.render.filepath = os.path.join(STILLS, f"{sid}.png")
    return sc


def shoot(sc, sid, engine):
    """Render the built scene to its picture (raises if the engine fails)."""
    if engine == "EEVEE":
        try:
            import gpu
            log(f"EEVEE on {gpu.platform.renderer_get()}")
        except Exception:
            pass
    bpy.ops.render.render(write_still=True)
    if "egg" in sc.keys() and sid == "E1":
        x, y = project(sc, sc["egg"])
        with open(os.path.join(STILLS, "egg.json"), "w") as fh:
            json.dump({"x": x, "y": y}, fh)


def render_one(sid, fn):
    path = os.path.join(STILLS, f"{sid}.png")
    if os.path.exists(path) and not arg("--redo"):
        log(f"{sid} already there (--redo to make it again)")
        return
    for engine in ENGINES:
        t0 = time.time()
        sc = build_still(sid, fn, engine)
        try:
            shoot(sc, sid, engine)
            log(f"{sid} done with {engine} in {time.time() - t0:.0f}s")
            return
        except Exception as e:
            log(f"{sid}: {engine} failed ({e})" + ("; trying Cycles" if engine == "EEVEE" else ""))
    log(f"{sid}: could not render")


# ============================================================ watch mode ===
# --watch (Blender opened WITH its window, "Watch Grand Welcome Stills.bat"):
# the same stills, built one at a time in front of you. Blender's window
# freezes while a script runs, so the work is cut into small steps on a
# timer, with a pause after each so the screen can catch up:
#   build the scene -> show it live through the camera -> render it ->
#   show the finished picture -> next one ... -> the contact sheet.
WATCH = bool(arg("--watch")) and not bpy.app.background
LIVE_SEC = float(arg("--live", 3.0))      # how long each scene shows live
SHOW_SEC = float(arg("--show", 2.5))      # how long each finished picture shows


def stage():
    """The one big area the watch mode draws in: (window, area)."""
    win = bpy.context.window_manager.windows[0]
    areas = sorted(win.screen.areas, key=lambda a: -a.width * a.height)
    return win, areas[0]


def say(text):
    """Write what's happening across the top of the stage (and the console)."""
    log(text)
    try:
        stage()[1].header_text_set(text)
    except Exception:
        pass


def show_scene():
    """The stage as a 3D view through the still's camera, drawn live by EEVEE."""
    win, area = stage()
    area.type = "VIEW_3D"
    sp = area.spaces.active
    sp.shading.type = "RENDERED"
    try:
        sp.shading.use_compositor = "ALWAYS"       # the bloom, live
    except Exception:
        pass
    sp.overlay.show_overlays = False
    sp.show_gizmo = False
    sp.show_region_header = True          # where the "what's happening" line shows
    sp.show_region_tool_header = False
    sp.region_3d.view_perspective = "CAMERA"
    # the live view draws a see-through sky as a checkerboard: show the
    # world instead, whose camera-facing side is black (see world())
    bpy.context.scene.render.film_transparent = False


def show_picture(path):
    """The stage as a picture viewer, showing a finished still."""
    win, area = stage()
    area.type = "IMAGE_EDITOR"
    img = bpy.data.images.load(path, check_existing=False)
    area.spaces.active.image = img


def fit_stage():
    """Fit the camera frame / picture to the stage. Runs one step AFTER the
    stage changes, once Blender has redrawn it (before that it has no size)."""
    win, area = stage()
    region = next((r for r in area.regions if r.type == "WINDOW"), None)
    try:
        with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region):
            bpy.ops.wm.redraw_timer(type="DRAW_WIN_SWAP", iterations=1)   # lay it out first
        # (the redraw forgets the context above: give the fit a fresh one)
        with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region):
            if area.type == "VIEW_3D":
                bpy.ops.view3d.view_center_camera()
            else:
                bpy.ops.image.view_all(fit_view=True)
    except Exception as e:
        log(f"could not fit the view ({e})")


def watch_steps(todo):
    """The whole job as small steps; each yield = pause this many seconds."""
    win, area = stage()
    try:
        region = next((r for r in area.regions if r.type == "WINDOW"), None)
        with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region):
            bpy.ops.screen.screen_full_area(use_hide_panels=True)     # one big stage
    except Exception:
        pass
    # the stills render quietly in the background: Blender's own render
    # display would cover the stage (the live view has already shown it)
    bpy.context.preferences.view.render_display_type = "NONE"
    say("Getting the club marks ready...")
    yield 0.2
    MARKS.update(draw_marks())
    n = len(todo)
    for k, (sid, lab, fn) in enumerate(todo):
        for engine in ENGINES:
            show_scene()
            say(f"[{k + 1}/{n}] Building  {lab}")
            yield 0.2
            sc = build_still(sid, fn, engine)
            show_scene()
            say(f"[{k + 1}/{n}] {lab}   (live, through the camera)")
            yield 0.1
            fit_stage()
            yield LIVE_SEC
            say(f"[{k + 1}/{n}] {lab}   (rendering the still...)")
            yield 0.2
            sc.render.film_transparent = True        # the still itself: exactly as headless
            try:
                shoot(sc, sid, engine)
            except Exception as e:
                log(f"{sid}: {engine} failed ({e})" + ("; trying Cycles" if engine == "EEVEE" else ""))
                continue
            show_picture(sc.render.filepath)
            say(f"[{k + 1}/{n}] {lab}   (done)")
            yield 0.1
            fit_stage()
            yield SHOW_SEC
            break
    say("Making the contact sheet...")
    show_scene()
    yield 0.2
    contact_sheet()
    show_picture(os.path.join(STILLS, "contact-sheet.png"))
    say(f"All done. Every still is in {STILLS}   (close Blender when you're finished)")
    yield 0.1
    fit_stage()


def watch(todo):
    steps = watch_steps(todo)

    def tick():
        try:
            return next(steps)
        except StopIteration:
            return None
        except Exception:
            import traceback
            traceback.print_exc()
            say("Something went wrong - see the black console window")
            return None
    bpy.app.timers.register(tick, first_interval=1.0)


# ========================================================= contact sheet ===
def contact_sheet():
    """Every still on one labelled page: output/stills/contact-sheet.png."""
    sc = reset_scene("Contact sheet")
    w = bpy.data.worlds.new("Sheet"); sc.world = w
    if not w.node_tree:
        w.use_nodes = True
    bg = w.node_tree.nodes.get("Background") or w.node_tree.nodes.new("ShaderNodeBackground")
    if not w.node_tree.nodes.get("World Output"):
        o = w.node_tree.nodes.new("ShaderNodeOutputWorld"); w.node_tree.links.new(bg.outputs[0], o.inputs[0])
    bg.inputs["Color"].default_value = lin("#1B1B22"); bg.inputs["Strength"].default_value = 1.0
    TW, TH, GAP, LAB, HEAD, COLS = 6.4, 3.6, 0.3, 0.55, 0.75, 4
    rows = [("Story A: six clubs converge", ["A1", "A2", "A3"]),
            ("Story B: fly to the church doors", ["B1", "B2", "B3"]),
            ("The landed frame in 4 feelings", ["F1", "F2", "F3", "F4"]),
            ("The landed frame in 3 materials", ["M1", "M2", "M3"]),
            ("Where a tiny \"2 Tim 2:15\" could hide", ["E1", "E2"]),
            ("The words at the peak, in the chosen look (wonder)", ["W1", "W2", "W3"])]
    labels = {sid: lab for sid, lab, _ in STORY}
    width = COLS * TW + (COLS + 1) * GAP
    title_h = 1.3
    height = title_h + len(rows) * (HEAD + TH + LAB + GAP) + GAP

    def label(txt, x, z, size, color="#FFFFFF", path=LONDRINA, align="LEFT"):
        td = bpy.data.curves.new(txt, "FONT"); td.body = txt; td.font = font(path)
        td.size = size; td.align_x = align; td.align_y = "TOP"
        td.materials.append(neon(color, 1.0))
        o = link(bpy.data.objects.new(txt, td)); o.location = (x, z, 0)
        return o

    def flat(name, img_path, x, z, w, h):
        m, N, L = _mat(name)
        out = N.new("ShaderNodeOutputMaterial")
        img = N.new("ShaderNodeTexImage"); img.image = bpy.data.images.load(img_path)
        em = N.new("ShaderNodeEmission")
        L.new(img.outputs["Color"], em.inputs["Color"]); L.new(em.outputs[0], out.inputs["Surface"])
        me = bpy.data.meshes.new(name)
        me.from_pydata([(x, z - h, 0), (x + w, z - h, 0), (x + w, z, 0), (x, z, 0)], [], [(0, 1, 2, 3)])
        uv = me.uv_layers.new()
        for i, c in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
            uv.data[i].uv = c
        me.materials.append(m)
        link(bpy.data.objects.new(name, me))

    left, top = -width / 2, height / 2
    label("The new grand welcome: rough look stills", left + GAP, top - 0.3, 0.75, path=PAYTONE)
    z = top - title_h
    for head, ids in rows:
        label(head.upper(), left + GAP, z - 0.1, 0.42, HOUSE["sun"])
        z -= HEAD
        for c, sid in enumerate(ids):
            x = left + GAP + c * (TW + GAP)
            p = os.path.join(STILLS, f"{sid}.png")
            if os.path.exists(p):
                flat(sid, p, x, z, TW, TH)
            else:
                label("(missing)", x + 0.2, z - 0.2, 0.4, HOUSE["hot"])
            label(labels[sid], x, z - TH - 0.1, 0.3, "#E8E8EE", FIGTREE)
            if sid == "E1" and os.path.exists(os.path.join(STILLS, "egg.json")):
                with open(os.path.join(STILLS, "egg.json")) as fh:
                    e = json.load(fh)
                cu = bpy.data.curves.new("Ring", "CURVE"); cu.dimensions = "3D"
                sp = cu.splines.new("POLY"); n = 48; sp.points.add(n - 1)
                for i, pt in enumerate(sp.points):
                    a = 2 * math.pi * i / n
                    pt.co = (0.42 * math.cos(a), 0.42 * math.sin(a), 0, 1)
                sp.use_cyclic_u = True; cu.bevel_depth = 0.035
                cu.materials.append(neon(HOUSE["hot"], 1.0))
                rg = link(bpy.data.objects.new("Ring", cu))
                rg.location = (x + e["x"] * TW, z - e["y"] * TH, 0.05)
        z -= TH + LAB + GAP
    cam = bpy.data.cameras.new("Sheet"); cam.type = "ORTHO"; cam.ortho_scale = max(width, height)
    co = link(bpy.data.objects.new("Sheet", cam)); co.location = (0, 0, 10); sc.camera = co
    px = 100
    sc.render.resolution_x, sc.render.resolution_y = int(width * px), int(height * px)
    sc.render.resolution_percentage = 100
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.film_transparent = False
    sc.eevee.taa_render_samples = 8
    sc.view_settings.view_transform = "Standard"; sc.view_settings.look = "None"
    sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGB"
    sc.render.filepath = os.path.join(STILLS, "contact-sheet.png")
    bpy.ops.render.render(write_still=True)
    log(f"contact sheet: {sc.render.filepath}")


# ================================================================== main ===
def main():
    os.makedirs(STILLS, exist_ok=True)
    if WATCH:
        only = str(arg("--only", "")).split(",") if arg("--only") else None
        watch([s for s in STORY if not only or s[0] in only])
        return
    if not arg("--sheet"):
        MARKS.update(draw_marks())
        only = str(arg("--only", "")).split(",") if arg("--only") else None
        todo = [s for s in STORY if not only or s[0] in only]
        for k, (sid, lab, fn) in enumerate(todo):
            log(f"[{k + 1}/{len(todo)}] {lab}")
            render_one(sid, fn)
    contact_sheet()


if __name__ == "__main__":
    main()

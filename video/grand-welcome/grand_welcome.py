"""
KVBC Awana - the new grand welcome: the FILM  (Blender 5.2 LTS)
==============================================================

What this file does, in plain English
-------------------------------------
It is a recipe, like stills.py and ../awana-intro/awana_intro.py. Blender
builds the whole 20-second scene from scratch out of the real brand files
(shared/brand), then renders it frame by frame IN ITS OPEN WINDOW, so you can
watch every frame being made, and glues the frames into an .mp4.

Double-click  Preview Grand Welcome Film.bat  (a few minutes on the RTX 4050
laptop). The video lands in output/Grand Welcome - PREVIEW.mp4 (git ignores
the output folder; never commit renders).

This is the ROUGH PREVIEW: the look the owner chose from the stills (BRIEF.md
"The look"), the story and its timing, at 960 x 540. The two seams (its first
frame = the countdown's "0:00", its last frame = the US Pledge slide's first
frame) are only roughed in here: a later step measures the real projector
screens and fits both, like the lobby intro.

The story (30 frames = 1 second; 600 frames = 20 s), the BEATS table below
-------------------------------------------------------------------------
 0.0-0.7   "0:00" alone on black (the countdown's last frame).
 0.7-1.3   the six club ribbons trace the three zeros in club colours (each
           zero's outer and inner edge, youngest club first, left to right)
           and the white 0:00 goes...
 1.3-5.7   ...they peel off the shapes and race round the room, whipping past
           the lens.
 5.7-10.3  all six slot into one knot together; it slowly turns, tightens...
 10.5      ...and bursts: a four-point brand starburst, a ring, starlight in
           the club colours.
 10.8-12.3 WELCOME TO lands letter by letter, the church's full logo rises in.
 11.8-13.3 each club's light streaks from the burst to its own plate and
           delivers its mark, youngest first.
 13.3-19.3 held, the camera gently pushing in, the sparkles drifting. At about
           15-17 s a few sparkles spell 2 Tim 2:15, top left, then fade.
 19.3-20   hand-over to the US Pledge slide (roughed in as a fade to black).

Options (after the -- on Blender's command line):
    --pct 75          size (75 = 960 x 540)        --samples 16   EEVEE samples
    --frames 1-600    just these frames            --no-render    build only
    --fps 60          render at 60 fps (the real film; previews are 30)
"""

import bpy, bmesh, math, os, random, shutil, sys, time
from mathutils import Vector, Matrix, geometry
from bpy_extras import anim_utils

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import stills as S                      # the brand pieces, shared with the stills

S.WATCH = True                          # always in Blender's open window
OUT = os.path.join(HERE, "output")
arg, log, say = S.arg, S.log, S.say
FPS, F_END = 30, 600
# The frame rate the video is RENDERED at. The real film is 60 fps (owner
# 2026-11-01: "the real one should be 60fps"); the rough previews stay 30.
# The timeline below stays in 30 fps frames and Blender's time stretching
# plays it RATE / 30 times as many frames (as in ../awana-intro).
# --final: the real film, 1920 x 1080 at 60 fps with motion blur (owner
# 2026-11-01: "Make the whole thing in 1080p 60fps"), plus the projector's
# copies in lobby/public/welcome/ (the web video and its two stills).
FINAL = bool(arg("--final"))
RATE = int(arg("--fps", 60 if FINAL else FPS))
assert RATE % FPS == 0, "--fps must be a multiple of 30"
# --lead-in: the other screens' five-second see-through lead-in instead
# (build_lead_in), always at full size; with --final, at 60 fps.
LEAD_IN = bool(arg("--lead-in"))
LEAD_END = 150                          # 5 s, in 30 fps frames
FRAMES = os.path.join(OUT, ("frames_lead_in" if LEAD_IN else "frames_final" if FINAL else "frames_preview")
                      + ("" if RATE == FPS else f"_{RATE}"))
MP4 = os.path.join(OUT, "Grand Welcome.mp4" if FINAL else
                   "Grand Welcome - PREVIEW" + ("" if RATE == FPS else f" {RATE}fps") + ".mp4")
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
WEB = os.path.join(REPO, "lobby", "public", "welcome")        # the projector's copies
WEB_KBPS = 8000                        # ~20 MB for 20 s at 1080p60
CENTRE = Vector((0, 0, 0.3))            # where the knot turns and bursts
ZERO_W = 5.2                            # how wide the 0:00 is (roughed in)
TUBE = 0.085                            # the ribbons of light: tube radius

BEATS = dict(
    zero=(1, 20),          # 0:00 still
    trace=(20, 30),        # the ribbons draw round the zeros' edges
    digits_off=32,         # the white 0:00 is gone; only the coloured outlines
    peel=38,               # the ribbons start peeling off the shapes
    knot=(170, 235),       # all six heads enter the knot together / it is full
    tighten=(290, 312),    # the knot shrinks
    burst=314,             # starburst
    letters=(324, 3),      # first letter lands, then one every 3 frames
    logo=(336, 368),
    deliver=(356, 6),      # first club's light reaches its plate, then every 6
    egg=(440, 478, 505, 540),   # sparkles gather, spell, hold, fade
    push=(400, 580),       # the slow push-in
    fade=(580, 600),       # hand-over (roughed in)
)


# ============================================================ keyframes ===
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
                        kp.back = 1.8


def empty(name, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    S.link(e)
    e.location = loc
    return e


def parent_keep(child, parent):
    """Parent without moving the child on screen."""
    child.parent = parent
    # (a new object's matrix_world isn't worked out yet: build it from its
    # own move/turn/size instead)
    child.matrix_parent_inverse = Matrix.LocRotScale(
        parent.location, parent.rotation_euler, parent.scale).inverted()


def pop_in(o, start, dur=12, rest_scale=1.0):
    """Hidden until start, then springs up to full size."""
    key(o, "scale", 1, (0, 0, 0), "CONSTANT")
    key(o, "scale", start, (0, 0, 0), "BACK", "EASE_OUT")
    key(o, "scale", start + dur, (rest_scale,) * 3)


def ball(name, radius, mat, loc=(0, 0, 0), smooth=True):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=2 if smooth else 1, radius=radius)
    bm.to_mesh(me); bm.free()
    me.materials.append(mat)
    o = S.link(bpy.data.objects.new(name, me))
    o.location = loc
    if smooth:
        S.smooth(o)
    return o


# ============================================================ ribbons ===
def light_tube(name, pts, color, radius=TUBE, strength=1.5, order=3):
    """A ribbon of light along pts (a round glowing tube), drawn on and off
    over time by its bevel factors."""
    cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"
    sp = cu.splines.new("NURBS")
    sp.points.add(len(pts) - 1)
    for p, q in zip(sp.points, pts):
        p.co = (*q, 1)
    sp.order_u = min(order, len(pts)); sp.use_endpoint_u = True; sp.resolution_u = 6
    cu.bevel_mode = "ROUND"; cu.bevel_depth = radius; cu.bevel_resolution = 3
    cu.use_fill_caps = True
    cu.bevel_factor_mapping_start = "SPLINE"; cu.bevel_factor_mapping_end = "SPLINE"
    cu.materials.append(S.neon(color, strength))     # brighter washes the club colour out
    return S.link(bpy.data.objects.new(name, cu))


def path_len(pts):
    return sum((Vector(a) - Vector(b)).length for a, b in zip(pts, pts[1:]))


def zero_outlines():
    """The outer and inner edge of each of the 0:00's three zeros, exactly
    where build_zero() draws the digits, left to right:
    [outer 1st, inner 1st, outer 2nd, inner 2nd, outer 3rd, inner 3rd]."""
    td = bpy.data.curves.new("0:00 outline", "FONT")
    td.body = "0:00"; td.font = S.font(S.PAYTONE)
    td.align_x = "CENTER"; td.align_y = "CENTER"
    o = S.link(bpy.data.objects.new("0:00 outline", td))
    dg = bpy.context.evaluated_depsgraph_get()
    cu = o.evaluated_get(dg).to_curve(dg)
    loops = []
    for sp in cu.splines:
        bp = sp.bezier_points
        pts = []
        for a, b in zip(bp, list(bp[1:]) + [bp[0]]):
            pts += geometry.interpolate_bezier(a.co, a.handle_right, b.handle_left, b.co, 10)[:-1]
        loops.append([Vector((p.x, p.y)) for p in pts])
    o.to_curve_clear()
    bpy.data.objects.remove(o)
    allp = [p for lp in loops for p in lp]
    lo = Vector((min(p.x for p in allp), min(p.y for p in allp)))
    hi = Vector((max(p.x for p in allp), max(p.y for p in allp)))
    k = ZERO_W / (hi.x - lo.x)                 # the same size as the digits
    c = (lo + hi) / 2
    def area(lp):
        return (max(p.x for p in lp) - min(p.x for p in lp)) * (max(p.y for p in lp) - min(p.y for p in lp))
    loops.sort(key=area, reverse=True)
    zeros = loops[:6]                          # 3 outer + 3 inner (the colon's dots are smaller)
    zeros.sort(key=lambda lp: sum(p.x for p in lp) / len(lp))     # left to right, in pairs
    ordered = []
    for j in range(0, 6, 2):                   # each zero: outer edge, then inner
        ordered += sorted(zeros[j:j + 2], key=area, reverse=True)
    boxes = plate_zero_boxes()
    out = []
    for j, lp in enumerate(ordered):
        if boxes:
            # Fit this zero (its outer edge's box) onto where the projector
            # draws it (the plate), the inner edge moving with it.
            outer = ordered[j - j % 2]
            ox0, ox1 = min(p.x for p in outer), max(p.x for p in outer)
            oy0, oy1 = min(p.y for p in outer), max(p.y for p in outer)
            bx0, bz0, bx1, bz1 = boxes[j // 2]
            sx, sz = (bx1 - bx0) / (ox1 - ox0), (bz1 - bz0) / (oy1 - oy0)
            w = [Vector((bx0 + (p.x - ox0) * sx, 0.0, bz0 + (p.y - oy0) * sz)) for p in lp]
        else:
            w = [Vector(((p.x - c.x) * k, -0.08, (p.y - c.y) * k)) for p in lp]
        top = max(range(len(w)), key=lambda i: w[i].z)       # start at the top
        w = w[top:] + w[:top + 1]
        out.append(w)
    return out


# The countdown's own "0:00" alone on black, as the gym's wall draws it at
# 1920x1080 (tools/measure-projector.mjs): the film's first frames ARE it,
# so the projector's cut from its countdown to the film is invisible.
PLATE = os.path.join(HERE, "projector-zero.png")
# At frame 1 the camera sits at (0, -CAM_D, 0) with a 50 mm lens on a 36 mm
# sensor: the plane y = 0 shows 14.4 x 8.1 m. The plate stands just behind it
# (PLATE_Y), scaled to fill exactly the same frame.
PLATE_Y = 0.12
VIEW_W, VIEW_H = 36.0 / 50.0 * S.CAM_D, 36.0 / 50.0 * S.CAM_D * 9 / 16


def plate_zero_boxes():
    """The three zeros' ink boxes on the plate, in metres on the plane y = 0:
    [(x0, z0, x1, z1)] left to right, or None without a plate."""
    if not os.path.exists(PLATE):
        log("no projector-zero.png: run tools/measure-projector.mjs (the 0:00 is roughed in)")
        return None
    import numpy as np
    img = bpy.data.images.load(PLATE, check_existing=True)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1]   # top row first
    white = (px[..., 0] > 0.5) & (px[..., 1] > 0.5) & (px[..., 2] > 0.5)    # the orange colon isn't
    cols = np.where(white.any(axis=0))[0]
    groups, start = [], cols[0]
    for a, b in zip(cols, cols[1:]):
        if b - a > 3:
            groups.append((start, a)); start = b
    groups.append((start, cols[-1]))
    boxes = []
    for x0, x1 in groups[:3]:
        rows = np.where(white[:, x0:x1 + 1].any(axis=1))[0]
        y0, y1 = rows[0], rows[-1] + 1
        boxes.append(((x0 / w - 0.5) * VIEW_W, (0.5 - y1 / h) * VIEW_H,
                      ((x1 + 1) / w - 0.5) * VIEW_W, (0.5 - y0 / h) * VIEW_H))
    log(f"0:00 fitted to the projector's zeros at {[(int(a), int(b)) for a, b in groups[:3]]} px")
    return boxes


def build_ribbons(knot):
    """The six ribbons: round the zeros' edges, peel off, race past the lens,
    and all slot into the knot together."""
    t0, t1 = BEATS["trace"]
    peel = BEATS["peel"]
    k0, k1 = BEATS["knot"]
    outlines = zero_outlines()
    for i, club in enumerate(S.CLUBS):
        a = math.radians(60 * i + 15)
        trace = outlines[i]
        s = trace[-1]
        side = -1 if i % 2 == 0 else 1
        race = [s + Vector((0, -0.6, 0.7)),
                Vector((side * (1.7 + 0.35 * i), -13.5, -1.4 + 0.55 * i)),     # past the lens
                Vector((10 * math.cos(a), 6, 5.5 * math.sin(a))),
                Vector((7 * math.cos(a + 2.4), -2, 4 * math.sin(a + 2.4))),
                Vector((4 * math.cos(a + 3.6), 1.5, 2.5 * math.sin(a + 3.6)))]
        kn = [CENTRE + Vector(p) for p in S.torus_knot(2, 3, 1.9, 0.75, 0, n=120,
                                                       rot=math.radians(20 * i), depth=1.2)]
        pts = [tuple(p) for p in trace + race + kn]
        total = path_len(pts)
        A = path_len([tuple(p) for p in trace]) / total            # end of the zero's edge
        K = path_len([tuple(p) for p in trace + race] + [tuple(kn[0])]) / total   # knot starts
        o = light_tube(f"Ribbon {S.CLUB[club]['name']}", pts, S.CLUB[club]["primary"])
        parent_keep(o, knot)
        cu = o.data
        lag = 0.16
        key(cu, "bevel_factor_end", 1, 0.0, "CONSTANT")
        key(cu, "bevel_factor_end", t0, 0.0, "SINE", "EASE_OUT")
        key(cu, "bevel_factor_end", t1, A, "CONSTANT")
        key(cu, "bevel_factor_end", peel, A, "SINE", "EASE_IN")
        key(cu, "bevel_factor_end", k0, K, "LINEAR")
        key(cu, "bevel_factor_end", k1, 1.0, "SINE", "EASE_OUT")
        key(cu, "bevel_factor_start", 1, 0.0, "CONSTANT")
        key(cu, "bevel_factor_start", peel, 0.0, "SINE", "EASE_IN")
        key(cu, "bevel_factor_start", k0, max(A, K - lag), "SINE", "EASE_IN_OUT")
        key(cu, "bevel_factor_start", k1, K, "LINEAR")


def build_zero():
    """The countdown's last frame: 0:00 alone on black, the projector's own
    picture (PLATE). It goes once the ribbons have traced it."""
    off = BEATS["digits_off"]
    if not os.path.exists(PLATE):
        z = S.text_mesh("0:00", ZERO_W, 0.12, S.neon("#FFFFFF", 1.0))   # roughed in
        S.origin_to_centre(z)
        key(z, "scale", 1, (1, 1, 1), "CONSTANT")
        key(z, "scale", off, (0, 0, 0), "CONSTANT")
        return z
    m, N, L = S._mat("Projector 0:00")
    out = N.new("ShaderNodeOutputMaterial")
    img = N.new("ShaderNodeTexImage")
    img.image = bpy.data.images.load(PLATE, check_existing=True)
    img.interpolation = "Closest"; img.extension = "CLIP"      # its pixels, as they are
    em = N.new("ShaderNodeEmission")
    L.new(img.outputs["Color"], em.inputs["Color"]); L.new(em.outputs[0], out.inputs["Surface"])
    k = (S.CAM_D + PLATE_Y) / S.CAM_D
    z = S.image_card("Projector 0:00", VIEW_W * k, VIEW_H * k, (0, PLATE_Y, 0), m)
    key(z, "scale", 1, (1, 1, 1), "CONSTANT")
    key(z, "scale", off, (0, 0, 0), "CONSTANT")
    return z


def build_stars():
    """The quiet starfield behind everything (the wonder still's)."""
    for i in range(160):
        rnd = random.Random(400 + i)
        o = ball("Star", rnd.uniform(0.008, 0.03), S.neon("#FFFFFF", rnd.uniform(3, 12)), smooth=False)
        o.location = (rnd.uniform(-11, 11), rnd.uniform(2, 14), rnd.uniform(-6, 6.5))
        pop_in(o, 30 + int(rnd.uniform(0, 60)), 20)


def build_burst():
    """The knot bursts: a four-point brand starburst, a ring rippling out,
    and starlight in the club colours that keeps drifting."""
    rnd = random.Random(41)
    b = BEATS["burst"]
    star = S.doodle("sparkle", 1.0, S.neon("#FFFFFF", 4))   # brighter blurs it into a blob
    star.location = CENTRE + Vector((0, -0.4, 0))
    key(star, "scale", 1, (0, 0, 0), "CONSTANT")
    key(star, "scale", b - 3, (0, 0, 0), "EXPO", "EASE_OUT")
    key(star, "scale", b + 4, (4.2, 4.2, 4.2), "SINE", "EASE_IN")
    key(star, "scale", b + 18, (0, 0, 0))
    key(star, "rotation_euler", b - 3, (0, 0, 0), "LINEAR")
    key(star, "rotation_euler", b + 18, (0, math.radians(40), 0))
    core = ball("Flash", 0.4, S.neon("#F4F0FF", 30), CENTRE)
    key(core, "scale", 1, (0, 0, 0), "CONSTANT")
    key(core, "scale", b - 4, (0, 0, 0), "SINE", "EASE_OUT")
    key(core, "scale", b + 1, (1, 1, 1), "SINE", "EASE_IN")
    key(core, "scale", b + 10, (0, 0, 0))
    # the ring
    cu = bpy.data.curves.new("Ring", "CURVE"); cu.dimensions = "3D"
    sp = cu.splines.new("POLY"); n = 64; sp.points.add(n - 1)
    for i, p in enumerate(sp.points):
        a = 2 * math.pi * i / n
        p.co = (math.cos(a), 0, math.sin(a), 1)
    sp.use_cyclic_u = True
    cu.bevel_depth = 0.012; cu.bevel_resolution = 2
    cu.materials.append(S.neon("#EAF2FF", 8))
    ring = S.link(bpy.data.objects.new("Ring", cu))
    ring.location = CENTRE
    key(ring, "scale", 1, (0, 0, 0), "CONSTANT")
    key(ring, "scale", b, (0.3, 0.3, 0.3), "EXPO", "EASE_OUT")
    key(ring, "scale", b + 22, (10, 10, 10), "CONSTANT")
    key(ring, "scale", b + 23, (0, 0, 0))
    # starlight: half white, half in the club colours
    for i in range(72):
        col = "#EAF2FF" if i % 2 == 0 else S.CLUB[S.CLUBS[(i // 2) % 6]]["primary"]
        o = S.doodle("sparkle", rnd.uniform(0.05, 0.28), S.neon(col, 6 if i % 2 == 0 else 3))
        rest = Vector((rnd.uniform(-8.5, 8.5), rnd.uniform(0.8, 6), rnd.uniform(-4.6, 4.6)))
        drift = rest + Vector((rnd.uniform(-0.6, 0.6), rnd.uniform(-0.3, 0.3), rnd.uniform(0.1, 0.7)))
        key(o, "location", 1, CENTRE, "CONSTANT")
        key(o, "location", b, CENTRE, "EXPO", "EASE_OUT")
        key(o, "location", b + 30 + rnd.randint(0, 15), rest, "LINEAR")
        key(o, "location", F_END, drift)
        key(o, "scale", 1, (0, 0, 0), "CONSTANT")
        key(o, "scale", b, (0, 0, 0), "SINE", "EASE_OUT")
        key(o, "scale", b + 10, (1, 1, 1))


def build_delivery(plates):
    """Each club's light streaks from the burst to its own plate and delivers
    the mark, youngest first: the six clubs arrive together."""
    b = BEATS["burst"]
    d0, step = BEATS["deliver"]
    for i, (club, plate) in enumerate(zip(S.CLUBS, plates)):
        P = plate.location.copy() + Vector((0, -0.4, 0))
        start = CENTRE.copy()
        # behind the logo, then over the top of the plate into its face, so
        # the streaks never cross the words
        pts = [tuple(start), tuple(start + Vector((P.x * 0.5, 1.6, -1.4))),
               tuple(P + Vector((0, 0.9, 0.75))), tuple(P + Vector((0, -0.5, 0.75))), tuple(P)]
        col = S.CLUB[club]["primary"]
        o = light_tube(f"Delivery {S.CLUB[club]['name']}", pts, col, radius=0.05, strength=2.2)
        arrive = d0 + step * i
        launch = b + 8 + 3 * i
        cu = o.data
        key(cu, "bevel_factor_end", 1, 0.0, "CONSTANT")
        key(cu, "bevel_factor_end", launch, 0.0, "SINE", "EASE_IN_OUT")
        key(cu, "bevel_factor_end", arrive, 1.0)
        key(cu, "bevel_factor_start", 1, 0.0, "CONSTANT")
        key(cu, "bevel_factor_start", launch + 6, 0.0, "SINE", "EASE_IN")
        key(cu, "bevel_factor_start", arrive + 3, 1.0)
        # a little flash where it lands, as the plate springs up
        f = S.doodle("sparkle", 0.9, S.neon(S.CLUB[club]["tint"], 8))
        f.location = P + Vector((0, -0.3, 0))
        key(f, "scale", 1, (0, 0, 0), "CONSTANT")
        key(f, "scale", arrive - 1, (0, 0, 0), "SINE", "EASE_OUT")
        key(f, "scale", arrive + 3, (1, 1, 1), "SINE", "EASE_IN")
        key(f, "scale", arrive + 12, (0, 0, 0))
        pop_in(plate, arrive, 12)


def build_egg():
    """2 Tim 2:15 in starlight: a few sparkles gather into the letters for a
    moment, upper left, then fade. Easy to miss; a paused frame shows it."""
    g0, g1, g2, g3 = BEATS["egg"]
    t = S.text_mesh(S.EGG_TEXT, 1.9, 0.0, S.neon("#FFFFFF", 1.0), font_path=S.FIGTREE)
    pts = [Vector(v.co) for v in t.data.vertices]
    bpy.data.objects.remove(t)
    # thin the outline to about 90 evenly spread points
    keep, cell = {}, 0.05
    for p in pts:
        keep.setdefault((round(p.x / cell), round(p.z / cell)), p)
    pts = list(keep.values())
    random.Random(215).shuffle(pts)
    pts = pts[:90]
    where = Vector((-5.3, 1.2, 3.45))
    rnd = random.Random(2152)
    for p in pts:
        o = ball("Egg star", 0.022, S.neon("#FFFFFF", 6), smooth=False)
        spot = where + p
        before = spot + Vector((rnd.uniform(-1.6, 1.6), rnd.uniform(-0.5, 0.5), rnd.uniform(-1.2, 1.2)))
        after = spot + Vector((rnd.uniform(-0.5, 0.5), rnd.uniform(-0.2, 0.2), rnd.uniform(0, 0.5)))
        key(o, "location", 1, before, "CONSTANT")
        key(o, "location", g0, before, "SINE", "EASE_IN_OUT")
        key(o, "location", g1, spot, "CONSTANT")
        key(o, "location", g2, spot, "SINE", "EASE_IN")
        key(o, "location", g3, after)
        s0 = g0 - 20 + rnd.randint(0, 10)
        key(o, "scale", 1, (0, 0, 0), "CONSTANT")
        key(o, "scale", s0, (0, 0, 0), "BACK", "EASE_OUT")
        key(o, "scale", s0 + 15, (1, 1, 1), "CONSTANT")
        key(o, "scale", g2, (1, 1, 1), "SINE", "EASE_IN")
        key(o, "scale", g3, (0, 0, 0))            # they fade, no stray cloud


def build_landing():
    """WELCOME TO, the church's full logo and the six club marks (the
    wording the owner chose, W1). Returns the six plates (for delivery)."""
    res = S.build_landed("plastic", wording="to_logo")
    l0, step = BEATS["letters"]
    for i, p in enumerate(res["letters"]):
        S.origin_to_centre(p)
        rest = p.location.copy()
        f = l0 + i * step
        key(p, "location", 1, rest + Vector((0, 4, 1.0)), "CONSTANT")
        key(p, "location", f, rest + Vector((0, 4, 1.0)), "BACK", "EASE_OUT")
        key(p, "location", f + 14, rest)
        pop_in(p, f, 14)
    lg0, lg1 = BEATS["logo"]
    lo, hi = S.bbox(res["logo"])
    logo = empty("Logo", (lo + hi) / 2)
    for m in res["logo"]:
        parent_keep(m, logo)
    rest = logo.location.copy()
    key(logo, "location", 1, rest + Vector((0, 6, -1.5)), "CONSTANT")
    key(logo, "location", lg0, rest + Vector((0, 6, -1.5)), "EXPO", "EASE_OUT")
    key(logo, "location", lg1, rest)
    key(logo, "scale", 1, (0, 0, 0), "CONSTANT")
    key(logo, "scale", lg0, (0.6, 0.6, 0.6), "EXPO", "EASE_OUT")
    key(logo, "scale", lg1, (1, 1, 1))
    plates = []
    for i, (t, mk) in enumerate(zip(res["tiles"], res["marks"])):
        e = empty(f"Plate {S.CLUBS[i]}", t.location.copy())
        parent_keep(t, e); parent_keep(mk, e)
        plates.append(e)
    return plates


def build_camera(sc):
    """Still on the 0:00, wide for the race (the ribbons whip past the lens),
    in close for the knot, settled on the landing's framing by the burst (so
    nothing slides while the words land), then a slow push-in."""
    tgt = empty("Camera target", (0, 0, 0))
    cam = S.camera(sc, (0, -S.CAM_D, 0), (0, 0, 0), lens=50)
    cam.rotation_euler = (0, 0, 0)
    con = cam.constraints.new("TRACK_TO")
    con.target = tgt; con.track_axis = "TRACK_NEGATIVE_Z"; con.up_axis = "UP_Y"
    c = cam.data
    b = BEATS["burst"]
    p0, p1 = BEATS["push"]
    for f, loc, aim, lens in [
            (1, (0, -S.CAM_D, 0), (0, 0, 0), 50),
            (BEATS["peel"], (0, -S.CAM_D, 0), (0, 0, 0), 50),
            (100, (0.8, -19, 0.6), (0, -4, 0.3), 30),
            (BEATS["knot"][0], (-1.0, -15.5, 0.6), CENTRE, 36),
            (BEATS["tighten"][0], (0, -15, 0.3), CENTRE, 40),
            (b + 2, (0, -S.CAM_D - 1, -0.6), (0, 0, 0.1), 50),
            (p0, (0, -S.CAM_D - 1, -0.6), (0, 0, 0.1), 50),
            (p1, (0, -S.CAM_D + 0.1, -0.55), (0, 0, 0.12), 50),
            (F_END, (0, -S.CAM_D + 0.1, -0.55), (0, 0, 0.12), 50)]:
        key(cam, "location", f, loc, "BEZIER")
        key(tgt, "location", f, aim, "BEZIER")
        key(c, "lens", f, lens, "BEZIER")
    return cam


def build(sc):
    S.reset_scene("Grand welcome")
    sc.render.fps = RATE
    sc.render.frame_map_old, sc.render.frame_map_new = FPS, RATE
    sc.frame_start, sc.frame_end = 1, F_END * RATE // FPS
    S.MARKS.update(S.draw_marks())
    S.world(sc, 0.18, "#7080C0")
    # the wonder lighting (stills F2), plus a soft front light so the words
    # read clean white instead of grey
    S.area("Key", (-4, -12, 9), (0, 0, 0), 1500, "#E6EEFF", 8)
    S.area("Word light", (0, -14, 4), (0, 0, 1.2), 1400, "#FFFFFF", 6)
    S.area("Rim L", (-7, 6, 4), (0, 0, 1), 2600, S.CLUB["journey"]["primary"], 3)
    S.area("Rim R", (7, 6, 4), (0, 0, 1), 2600, S.CLUB["puggles"]["primary"], 3)
    S.area("Under", (0, -6, -8), (0, 0, 0), 600, S.CLUB["cubbies"]["tint"], 6)
    knot = empty("Knot", CENTRE)
    build_zero()
    build_ribbons(knot)
    t0, t1 = BEATS["tighten"]
    k0 = BEATS["knot"][0]
    key(knot, "rotation_euler", k0, (0, 0, 0), "LINEAR")
    key(knot, "rotation_euler", t1, (0, math.radians(80), 0))
    key(knot, "scale", 1, (1, 1, 1), "CONSTANT")
    key(knot, "scale", t0, (1, 1, 1), "SINE", "EASE_IN")
    key(knot, "scale", t1, (0.12, 0.12, 0.12), "CONSTANT")
    key(knot, "scale", t1 + 2, (0, 0, 0), "CONSTANT")
    build_stars()
    build_burst()
    build_egg()
    plates = build_landing()
    build_delivery(plates)
    build_camera(sc)
    S.setup_render(sc, "EEVEE")
    sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
    sc.render.resolution_percentage = int(arg("--pct", 100 if FINAL else 50))
    sc.eevee.taa_render_samples = int(arg("--samples", 64 if FINAL else 16))
    sc.render.use_motion_blur = FINAL
    sc.render.motion_blur_shutter = 0.5
    sc.render.film_transparent = False     # the world shows black to the camera
    S.glow_compositor(sc, 0.6)
    # the hand-over, roughed in: a fade to black
    f0, f1 = BEATS["fade"]
    key(sc.view_settings, "exposure", 1, 0.0, "CONSTANT")
    key(sc.view_settings, "exposure", f0, 0.0, "SINE", "EASE_IN")
    key(sc.view_settings, "exposure", f1, -30.0)        # all the way to black
    os.makedirs(FRAMES, exist_ok=True)
    sc.render.filepath = os.path.join(FRAMES, "frame_####")
    rng = str(arg("--frames", "")).split("-") if arg("--frames") else None
    if rng:
        sc.frame_start, sc.frame_end = int(rng[0]), int(rng[1])
    sc.frame_set(1)
    return sc


# =============================================================== video ===
def encode_mp4(frames_dir, out_path, fps=RATE, web=False):
    """Glue the PNG frames into one H.264 .mp4 (Blender's own video editor).
    `web`: the projector's copy instead: a steady bitrate, a keyframe every
    second, and its index moved to the front so the wall can start it from
    the first request (as ../awana-intro does for the lobby)."""
    files = sorted(f for f in os.listdir(frames_dir) if f.endswith(".png") and
                   os.path.getsize(os.path.join(frames_dir, f)) > 0)
    if not files:
        log("no frames to encode"); return
    enc = bpy.data.scenes.new("Encode")
    enc.render.fps = fps
    enc.sequence_editor_create()
    st = enc.sequence_editor.strips.new_image(
        name="frames", filepath=os.path.join(frames_dir, files[0]), channel=1, frame_start=1)
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
    if web:
        ff.constant_rate_factor = "NONE"; ff.ffmpeg_preset = "BEST"
        ff.video_bitrate = WEB_KBPS; ff.minrate = 0; ff.maxrate = int(WEB_KBPS * 1.5)
        ff.gopsize = fps
    elif FINAL:
        ff.constant_rate_factor = "PERC_LOSSLESS"; ff.ffmpeg_preset = "BEST"
    else:
        ff.constant_rate_factor = "HIGH"; ff.ffmpeg_preset = "GOOD"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    enc.render.filepath = out_path
    enc.render.use_overwrite = True
    with bpy.context.temp_override(scene=enc):
        bpy.ops.render.render(animation=True, scene=enc.name)
    bpy.data.scenes.remove(enc)
    if web:
        sys.path.insert(0, os.path.join(HERE, "..", "awana-intro", "tools"))
        from faststart import faststart
        faststart(out_path)
    log(f"video saved: {out_path}")


def save_stills(frames_dir):
    """The projector's two stills, from the finished frames: the first frame
    (shown the instant the film's slide lands, before the video plays: the
    countdown's own 0:00) and the landed frame (the low-power switch's
    finished frame, and the stand-in if the video can't play)."""
    files = sorted(f for f in os.listdir(frames_dir) if f.endswith(".png"))
    if not files:
        return
    first = os.path.join(frames_dir, files[0])
    shutil.copyfile(first, os.path.join(WEB, "grand-welcome-first.png"))
    landed = os.path.join(frames_dir, files[min(len(files) - 1, 16 * RATE)])     # 16 s in
    img = bpy.data.images.load(landed)
    img.file_format = "JPEG"
    out = os.path.join(WEB, "grand-welcome-still.jpg")
    try:
        img.save(filepath=out, quality=88)
    except TypeError:                     # older save() without quality
        img.filepath_raw = out
        img.save()
    bpy.data.images.remove(img)
    log(f"stills saved in {WEB}")


# ======================================================= in the window ===
# ===================================================== the lead-in film ===
# The other screens' lead-in (owner 2026-11-01, BRIEF.md "The lead-in"): one
# shared five-second film for the lobby TV, Journey and the classroom, in the
# slot of the old "Switching to opening ceremony" card. It is SEE-THROUGH: it
# plays over whatever the screen shows (lobby/src/components/CeremonyLeadIn.jsx)
# and fills it, then the screen's copy of the gym projector (its countdown,
# on black) takes over from its last frame, pure black. By the second:
#   0.0-1.2  six club-colour edges race across, top to bottom, youngest club
#            first, each pulling the projector's black in behind it
#   1.4-2.4  OPENING CEREMONY lands letter by letter (the film's white
#            plastic, its wonder light), sparkles come out
#   2.4-4.0  held
#   4.0-4.7  the words and sparkles step away
#   4.7-5.0  pure black (the mirror's own black)
LEAD = dict(bands=(1, 4), band_dur=26, letters=(42, 2), out=(120, 141))


def build_lead_in(sc):
    S.reset_scene("Opening ceremony lead-in")
    sc.render.fps = RATE
    sc.render.frame_map_old, sc.render.frame_map_new = FPS, RATE
    sc.frame_start, sc.frame_end = 1, LEAD_END * RATE // FPS
    S.world(sc, 0.18, "#7080C0")           # film_transparent: the screen shows through
    S.area("Key", (-4, -12, 9), (0, 0, 0), 1500, "#E6EEFF", 8)
    S.area("Word light", (0, -14, 4), (0, 0, 0.5), 1400, "#FFFFFF", 6)
    S.area("Rim L", (-7, 6, 4), (0, 0, 1), 2600, S.CLUB["journey"]["primary"], 3)
    S.area("Rim R", (7, 6, 4), (0, 0, 1), 2600, S.CLUB["puggles"]["primary"], 3)
    S.camera(sc, (0, -S.CAM_D, 0), (0, 0, 0), lens=50)
    # The bands: black, each led by a glowing club-colour edge, sweeping in
    # from the left at y = 1.5 (behind the words), together covering the frame.
    y = 1.5
    k = (S.CAM_D + y) / S.CAM_D
    W, H = VIEW_W * k + 0.6, VIEW_H * k + 0.6
    h = H / 6
    b0, step = LEAD["bands"]
    black = S.neon("#000000", 1.0, name="Lead-in black")    # pure #000, no shine
    for i, club in enumerate(S.CLUBS):
        z = H / 2 - h * (i + 0.5)
        band = S.box(f"Band {club}", (W, 0.02, h + 0.02), (0, 0, 0), black)
        edge = S.box(f"Edge {club}", (0.28, 0.02, h + 0.02), (0, 0, 0), S.neon(S.CLUB[club]["primary"], 2.0))
        grp = empty(f"Sweep {club}", (-W, y, z))
        band.location = (0, 0, 0); edge.location = (W / 2 + 0.14, -0.01, 0)
        band.parent = grp; edge.parent = grp
        f0 = b0 + step * i
        key(grp, "location", 1, (-W - 0.5, y, z), "CONSTANT")
        key(grp, "location", f0, (-W - 0.5, y, z), "EXPO", "EASE_OUT")
        key(grp, "location", f0 + LEAD["band_dur"], (0, y, z))
    # OPENING CEREMONY, letter by letter
    face = S.plastic("#FFFFFF", rough=0.16)
    side = S.plastic(S.HOUSE["hot"], rough=0.25)
    # 9.6 m of the 14.4 m frame: the screens fill with it edge to edge
    # (object-fit: cover), and a 4:3 screen keeps 75% of the width.
    w = S.text_mesh("OPENING CEREMONY", 9.6, 0.55 * 9.6 / S.LAND["welcome_w"], face, bevel=0.03, side_mat=side)
    S.move_to([w], z=0.0)
    letters = S.split_loose(w)
    l0, lstep = LEAD["letters"]
    o0, o1 = LEAD["out"]
    for i, p in enumerate(letters):
        S.origin_to_centre(p)
        rest = p.location.copy()
        f = l0 + i * lstep
        key(p, "location", 1, rest + Vector((0, 4, 1.0)), "CONSTANT")
        key(p, "location", f, rest + Vector((0, 4, 1.0)), "BACK", "EASE_OUT")
        key(p, "location", f + 14, rest)
        pop_in(p, f, 14)
        g = o0 + i
        key(p, "scale", g, (1, 1, 1), "SINE", "EASE_IN")
        key(p, "scale", g + 8, (0, 0, 0), "CONSTANT")
    rnd = random.Random(77)
    for i in range(28):
        s = S.doodle("sparkle", rnd.uniform(0.06, 0.24), S.neon("#EAF2FF" if i % 2 else S.CLUB[S.CLUBS[i % 6]]["primary"], 5))
        s.location = (rnd.uniform(-7, 7), rnd.uniform(0.2, 1.2), rnd.choice([-1, 1]) * rnd.uniform(1.0, 3.6))
        pop_in(s, l0 + 6 + rnd.randint(0, 20), 12)
        key(s, "scale", o0 + rnd.randint(0, 10), (1, 1, 1), "SINE", "EASE_IN")
        key(s, "scale", o1, (0, 0, 0), "CONSTANT")
    S.setup_render(sc, "EEVEE")
    sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
    sc.render.resolution_percentage = int(arg("--pct", 100))
    sc.eevee.taa_render_samples = int(arg("--samples", 64 if FINAL else 16))
    sc.render.use_motion_blur = FINAL
    sc.render.motion_blur_shutter = 0.5
    sc.render.film_transparent = True        # see-through until the bands cover it
    sc.render.image_settings.color_mode = "RGBA"
    # No bloom here: the compositor's glare throws the see-through alpha away
    # (every frame came out opaque black).
    sc.render.use_compositing = False
    os.makedirs(FRAMES, exist_ok=True)
    sc.render.filepath = os.path.join(FRAMES, "frame_####")
    sc.frame_set(1)
    return sc


def encode_webm(frames_dir, out_path, fps=RATE):
    """The lead-in's frames (RGBA) as one VP9 WebM WITH its see-through alpha,
    which Chromium plays over the page (the lobby, Journey, the classroom)."""
    files = sorted(f for f in os.listdir(frames_dir) if f.endswith(".png") and
                   os.path.getsize(os.path.join(frames_dir, f)) > 0)
    if not files:
        log("no frames to encode"); return
    enc = bpy.data.scenes.new("Encode")
    enc.render.fps = fps
    enc.sequence_editor_create()
    st = enc.sequence_editor.strips.new_image(
        name="frames", filepath=os.path.join(frames_dir, files[0]), channel=1, frame_start=1)
    for f in files[1:]:
        st.elements.append(f)
    enc.frame_start, enc.frame_end = 1, len(files)
    enc.render.resolution_x, enc.render.resolution_y = 1920, 1080
    enc.render.resolution_percentage = 100
    enc.view_settings.view_transform = "Standard"
    enc.render.film_transparent = True
    enc.render.image_settings.media_type = "VIDEO"
    enc.render.image_settings.file_format = "FFMPEG"
    ff = enc.render.ffmpeg
    ff.format = "WEBM"; ff.codec = "WEBM"; ff.audio_codec = "NONE"
    enc.render.image_settings.color_mode = "RGBA"
    ff.constant_rate_factor = "HIGH"; ff.ffmpeg_preset = "GOOD"
    ff.gopsize = fps
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    enc.render.filepath = out_path
    enc.render.use_overwrite = True
    with bpy.context.temp_override(scene=enc):
        bpy.ops.render.render(animation=True, scene=enc.name)
    bpy.data.scenes.remove(enc)
    log(f"lead-in saved: {out_path}")


def steps():
    """The whole job as small steps on a timer, so the window keeps drawing."""
    win, area = S.stage()
    try:
        region = next((r for r in area.regions if r.type == "WINDOW"), None)
        with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region):
            bpy.ops.screen.screen_full_area(use_hide_panels=True)
    except Exception:
        pass
    say("Building the opening ceremony lead-in..." if LEAD_IN else "Building the grand welcome...")
    yield 0.2
    t0 = time.time()
    sc = build_lead_in(bpy.context.scene) if LEAD_IN else build(bpy.context.scene)
    log(f"built in {time.time() - t0:.0f}s")
    S.show_scene()
    say("The grand welcome: built. A look through the camera, then rendering every frame...")
    yield 0.1
    S.fit_stage()
    yield 3.0
    if arg("--no-render"):
        say("Built (no render asked for). Press Space to play it in the viewport.")
        return
    # Render the frames with Blender's own render view, so each frame shows
    # in the window as it is made; when the last one is done, make the video.
    bpy.context.preferences.view.render_display_type = "AREA"
    if LEAD_IN:
        # The live look above turns the see-through sky off (stills.show_scene);
        # the lead-in's frames must keep it.
        sc.render.film_transparent = True
        sc.render.image_settings.color_mode = "RGBA"
    for f in os.listdir(FRAMES):
        if f.endswith(".png"):
            os.remove(os.path.join(FRAMES, f))
    started = time.time()
    # In chunks, so the battery rule (stills.battery_wait: at 20% pause until
    # 80%) is checked between them; each chunk renders in Blender's own render
    # view, so every frame still shows in the window as it is made.
    first, last = sc.frame_start, sc.frame_end
    chunk = int(arg("--chunk", 2 * RATE))
    win, area = S.stage()
    for c0 in range(first, last + 1, chunk):
        yield from S.battery_wait()
        sc.frame_start, sc.frame_end = c0, min(last, c0 + chunk - 1)
        win, area = S.stage()
        region = next((r for r in area.regions if r.type == "WINDOW"), None)
        with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region):
            bpy.ops.render.render("INVOKE_DEFAULT", animation=True)
        log(f"rendering frames {sc.frame_start}-{sc.frame_end} of {last} in the window")
        yield 0.5
        while bpy.app.is_job_running("RENDER"):
            yield 0.5
    sc.frame_start, sc.frame_end = first, last
    scene = sc
    if LEAD_IN:
        say("All frames done. Making the see-through WebM...")
        yield 0.2
        encode_webm(FRAMES, os.path.join(WEB, "opening-lead-in.webm"))
        # zero animation shows the card at rest: the frame at 3.5 s
        files = sorted(f for f in os.listdir(FRAMES) if f.endswith(".png"))
        shutil.copyfile(os.path.join(FRAMES, files[min(len(files) - 1, int(3.5 * RATE))]),
                        os.path.join(WEB, "opening-lead-in-still.png"))
        say(f"Finished. The lead-in: {WEB}   (close Blender when you're done)")
        return
    say("All frames done. Making the video...")
    yield 0.2
    # Until the ribbons start, the film IS the countdown's 0:00: those frames
    # become the projector's own picture, pixel for pixel (the render matches
    # it to under 1/255 on average, but the cut at 6:00 lands on frame 1, so
    # make it exact).
    if os.path.exists(PLATE) and scene.render.resolution_percentage == 100             and (scene.render.resolution_x, scene.render.resolution_y) == (1920, 1080):
        lastp = (BEATS["trace"][0] - 1) * RATE // FPS
        for f in range(1, lastp + 1):
            p = os.path.join(FRAMES, f"frame_{f:04d}.png")
            if os.path.exists(p):
                shutil.copyfile(PLATE, p)
        log(f"frames 1-{lastp}: the projector's own 0:00")
    encode_mp4(FRAMES, MP4)
    if FINAL:
        say("Making the projector's copy and its stills...")
        yield 0.2
        encode_mp4(FRAMES, os.path.join(WEB, "grand-welcome.mp4"), web=True)
        save_stills(FRAMES)
    mins = (time.time() - started) / 60
    say(f"Finished in {mins:.0f} min. The video: {MP4}   (close Blender when you're done)")


def main():
    if bpy.app.background:
        raise SystemExit(f"{S.PRE} run this with Blender's window open (Preview Grand Welcome Film.bat)")
    it = steps()

    def tick():
        try:
            return next(it)
        except StopIteration:
            return None
        except Exception:
            import traceback
            traceback.print_exc()
            say("Something went wrong - see the black console window")
            return None
    bpy.app.timers.register(tick, first_interval=1.0)


if __name__ == "__main__":
    main()

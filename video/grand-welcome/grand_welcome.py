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
"""

import bpy, bmesh, math, os, random, sys, time
from mathutils import Vector, Matrix, geometry
from bpy_extras import anim_utils

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import stills as S                      # the brand pieces, shared with the stills

S.WATCH = True                          # always in Blender's open window
OUT = os.path.join(HERE, "output")
FRAMES = os.path.join(OUT, "frames_preview")
MP4 = os.path.join(OUT, "Grand Welcome - PREVIEW.mp4")
arg, log, say = S.arg, S.log, S.say
FPS, F_END = 30, 600
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
    out = []
    for lp in ordered:
        w = [Vector(((p.x - c.x) * k, -0.08, (p.y - c.y) * k)) for p in lp]
        top = max(range(len(w)), key=lambda i: w[i].z)       # start at the top
        w = w[top:] + w[:top + 1]
        out.append(w)
    return out


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
    """The countdown's last frame: 0:00 alone on black (roughed in). It goes
    once the ribbons have traced it."""
    z = S.text_mesh("0:00", ZERO_W, 0.12, S.neon("#FFFFFF", 1.0))
    S.origin_to_centre(z)
    off = BEATS["digits_off"]
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
    sc.render.fps = FPS
    sc.frame_start, sc.frame_end = 1, F_END
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
    sc.render.resolution_percentage = int(arg("--pct", 75))
    sc.eevee.taa_render_samples = int(arg("--samples", 16))
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
def encode_mp4(frames_dir, out_path, fps=FPS):
    """Glue the PNG frames into one H.264 .mp4 (Blender's own video editor)."""
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
    ff.constant_rate_factor = "HIGH"; ff.ffmpeg_preset = "GOOD"
    enc.render.filepath = out_path
    enc.render.use_overwrite = True
    with bpy.context.temp_override(scene=enc):
        bpy.ops.render.render(animation=True, scene=enc.name)
    bpy.data.scenes.remove(enc)
    log(f"video saved: {out_path}")


# ======================================================= in the window ===
def steps():
    """The whole job as small steps on a timer, so the window keeps drawing."""
    win, area = S.stage()
    try:
        region = next((r for r in area.regions if r.type == "WINDOW"), None)
        with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region):
            bpy.ops.screen.screen_full_area(use_hide_panels=True)
    except Exception:
        pass
    say("Building the grand welcome...")
    yield 0.2
    t0 = time.time()
    sc = build(bpy.context.scene)
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
    for f in os.listdir(FRAMES):
        if f.endswith(".png"):
            os.remove(os.path.join(FRAMES, f))
    started = time.time()

    def finished(scene, *_):
        if finished in bpy.app.handlers.render_complete:
            bpy.app.handlers.render_complete.remove(finished)
        def make_video():
            say("All frames done. Making the video...")
            encode_mp4(FRAMES, MP4)
            mins = (time.time() - started) / 60
            say(f"Finished in {mins:.0f} min. The video: {MP4}   (close Blender when you're done)")
            return None
        bpy.app.timers.register(make_video, first_interval=1.0)
    bpy.app.handlers.render_complete.append(finished)
    win, area = S.stage()
    region = next((r for r in area.regions if r.type == "WINDOW"), None)
    with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region):
        bpy.ops.render.render("INVOKE_DEFAULT", animation=True)
    log("rendering every frame in the window")


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

"""
KVBC Awana - the new grand welcome: the FILM  (Blender 5.2 LTS)
==============================================================

What this file does, in plain English
-------------------------------------
It is a recipe, like stills.py and ../awana-intro/awana_intro.py. Blender
builds the whole 20-second scene from scratch out of the real brand files
(shared/brand), then renders it frame by frame IN ITS OPEN WINDOW, so you can
watch every frame being made, and glues the frames into an .mp4.

Double-click  Preview Grand Welcome Film.bat  (about 10 minutes on the RTX
4050 laptop). The video lands in output/Grand Welcome - PREVIEW.mp4 (git
ignores the output folder; never commit renders).

This is the ROUGH PREVIEW: the look the owner chose from the stills (BRIEF.md
"The look"), the story and its timing, at 960 x 540. The two seams (its first
frame = the countdown's "0:00", its last frame = the US Pledge slide's first
frame) are only roughed in here: a later step measures the real projector
screens and fits both, like the lobby intro.

The story (30 frames = 1 second; 600 frames = 20 s), the BEATS table below
-------------------------------------------------------------------------
 0.0-0.7   "0:00" alone on black (the countdown's last frame).
 0.7-1.7   it unravels: the six club ribbons pull out of it, glowing.
 1.7-7.7   the ribbons race round the room, past the camera.
 7.7-11    they weave into one knot, which slowly turns.
 11-11.5   the knot tightens and bursts into starlight (sparkles, no confetti).
 11.7-14   WELCOME TO lands letter by letter, the church's full logo rises in
           under it, the six club marks pop in, youngest first.
 14-19.3   held, the sparkles drifting. Somewhere in there a few of them
           line up to spell 2 Tim 2:15, then drift apart.
 19.3-20   hand-over to the US Pledge slide (roughed in as a fade to black).

Options (after the -- on Blender's command line):
    --pct 75          size (75 = 960 x 540)        --samples 16   EEVEE samples
    --frames 1-600    just these frames            --no-render    build only
"""

import bpy, math, os, random, sys, time
from mathutils import Vector, Matrix
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

BEATS = dict(
    zero=(1, 20),          # 0:00 still
    unravel=(20, 50),      # 0:00 shrinks away as the ribbons pull out of it
    race=(22, 230),        # ribbon heads travel the race path
    knot=(230, 320),       # ...and fill the knot
    tighten=(320, 345),    # the knot shrinks
    burst=345,             # flash: starlight
    letters=(352, 3),      # first letter lands, then one every 3 frames
    logo=(366, 398),
    marks=(388, 5),        # first mark pops in, then one every 5 frames
    egg=(440, 478, 505, 540),   # sparkles gather, spell, hold, drift apart
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


# ============================================================== pieces ===
def ribbon(name, pts, color):
    """A glowing club ribbon along pts, drawn on over time by its bevel factors."""
    cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"
    cu.twist_mode = "MINIMUM"
    sp = cu.splines.new("NURBS")
    sp.points.add(len(pts) - 1)
    for p, q in zip(sp.points, pts):
        p.co = (*q, 1)
    sp.order_u = 4; sp.use_endpoint_u = True; sp.resolution_u = 12
    cu.extrude = 0.22; cu.bevel_depth = 0.02; cu.bevel_resolution = 2
    cu.bevel_factor_mapping_start = "SPLINE"; cu.bevel_factor_mapping_end = "SPLINE"
    cu.materials.append(S.neon(color, 1.5))     # brighter washes the club colour out
    return S.link(bpy.data.objects.new(name, cu))


def path_len(pts):
    return sum((Vector(a) - Vector(b)).length for a, b in zip(pts, pts[1:]))


def build_ribbons(knot):
    """The six ribbons: out of the 0:00, round the room, into the knot."""
    rnd = random.Random(15)
    r0, r1 = BEATS["race"]
    k0, k1 = BEATS["knot"]
    for i, club in enumerate(S.CLUBS):
        a = math.radians(60 * i + 15)
        start = Vector((-1.9 + 0.76 * i, 0, rnd.uniform(-0.45, 0.45)))
        race = [start, start + Vector((0, -0.4, 0.1)),
                Vector((4 * math.cos(a), -2, 3 * math.sin(a))),
                Vector((9.5 * math.cos(a + 1.2), 4, 5.5 * math.sin(a + 1.2))),
                Vector((8 * math.cos(a + 2.6), -7, 4.5 * math.sin(a + 2.6))),
                Vector((5 * math.cos(a + 3.8), 1.5, 3 * math.sin(a + 3.8)))]
        kn = [CENTRE + Vector(p) for p in S.torus_knot(2, 3, 1.9, 0.75, 0, n=120,
                                                       rot=math.radians(20 * i), depth=1.2)]
        pts = [tuple(p) for p in race] + [tuple(p) for p in kn]
        frac = path_len([tuple(p) for p in race] + [tuple(kn[0])]) / path_len(pts)
        o = ribbon(f"Ribbon {S.CLUB[club]['name']}", pts, S.CLUB[club]["primary"])
        parent_keep(o, knot)
        cu = o.data
        lag = 0.24 + 0.02 * i                 # how long a tail each ribbon trails
        key(cu, "bevel_factor_end", 1, 0.0, "CONSTANT")
        key(cu, "bevel_factor_end", r0 + i, 0.0, "SINE", "EASE_IN")
        key(cu, "bevel_factor_end", r1, frac, "LINEAR")
        key(cu, "bevel_factor_end", k1, 1.0, "SINE", "EASE_OUT")
        key(cu, "bevel_factor_start", 1, 0.0, "CONSTANT")
        key(cu, "bevel_factor_start", r0 + 40, 0.0, "LINEAR")
        key(cu, "bevel_factor_start", r1, max(0.0, frac - lag), "SINE", "EASE_IN_OUT")
        key(cu, "bevel_factor_start", k1, frac, "LINEAR")


def build_zero():
    """The countdown's last frame: 0:00 alone on black (roughed in)."""
    z = S.text_mesh("0:00", 5.2, 0.12, S.neon("#FFFFFF", 1.0))
    S.origin_to_centre(z)
    u0, u1 = BEATS["unravel"]
    key(z, "scale", 1, (1, 1, 1), "CONSTANT")
    key(z, "scale", u0, (1, 1, 1), "SINE", "EASE_IN")
    key(z, "scale", u1, (0, 0, 0), "CONSTANT")
    key(z, "rotation_euler", u0, (0, 0, 0), "SINE", "EASE_IN")
    key(z, "rotation_euler", u1, (0, math.radians(-25), 0))
    return z


def build_stars():
    """The quiet starfield behind everything (the wonder still's)."""
    stars = []
    for i in range(160):
        rnd = random.Random(400 + i)
        d = bpy.data.meshes.new("Star")
        import bmesh
        bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=1, radius=rnd.uniform(0.008, 0.03))
        bm.to_mesh(d); bm.free()
        d.materials.append(S.neon("#FFFFFF", rnd.uniform(3, 12)))
        o = S.link(bpy.data.objects.new("Star", d))
        o.location = (rnd.uniform(-11, 11), rnd.uniform(2, 14), rnd.uniform(-6, 6.5))
        pop_in(o, 30 + int(rnd.uniform(0, 60)), 20)
        stars.append(o)
    return stars


def build_burst():
    """The knot bursts into starlight: sparkles fly out and keep drifting."""
    rnd = random.Random(41)
    b = BEATS["burst"]
    flash = S.link(bpy.data.objects.new("Flash", bpy.data.meshes.new("Flash")))
    import bmesh
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=0.7)
    bm.to_mesh(flash.data); bm.free()
    flash.data.materials.append(S.neon("#F4F0FF", 30)); S.smooth(flash)
    flash.location = CENTRE
    key(flash, "scale", 1, (0, 0, 0), "CONSTANT")
    key(flash, "scale", b - 8, (0, 0, 0), "SINE", "EASE_OUT")
    key(flash, "scale", b + 1, (1.4, 1.4, 1.4), "SINE", "EASE_IN")
    key(flash, "scale", b + 16, (0, 0, 0))
    sparks = []
    for i in range(70):
        s = rnd.uniform(0.05, 0.28)
        o = S.doodle("sparkle", s, S.neon("#EAF2FF", 7))
        rest = Vector((rnd.uniform(-8.5, 8.5), rnd.uniform(0.8, 6), rnd.uniform(-4.6, 4.6)))
        drift = rest + Vector((rnd.uniform(-0.6, 0.6), rnd.uniform(-0.3, 0.3), rnd.uniform(0.1, 0.7)))
        key(o, "location", 1, CENTRE, "CONSTANT")
        key(o, "location", b, CENTRE, "EXPO", "EASE_OUT")
        key(o, "location", b + 30 + rnd.randint(0, 15), rest, "LINEAR")
        key(o, "location", F_END, drift)
        key(o, "scale", 1, (0, 0, 0), "CONSTANT")
        key(o, "scale", b, (0, 0, 0), "SINE", "EASE_OUT")
        key(o, "scale", b + 10, (1, 1, 1))
        sparks.append(o)
    return sparks


def build_egg():
    """2 Tim 2:15 in starlight: a few sparkles gather into the letters for a
    moment, upper left, then drift apart. Easy to miss; a paused frame shows it."""
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
    import bmesh
    for i, p in enumerate(pts):
        d = bpy.data.meshes.new("Egg star")
        bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.022)
        bm.to_mesh(d); bm.free()
        d.materials.append(S.neon("#FFFFFF", 6))
        o = S.link(bpy.data.objects.new("Egg star", d))
        spot = where + p
        before = spot + Vector((rnd.uniform(-1.6, 1.6), rnd.uniform(-0.5, 0.5), rnd.uniform(-1.2, 1.2)))
        after = spot + Vector((rnd.uniform(-1.6, 1.6), rnd.uniform(-0.5, 0.5), rnd.uniform(-0.6, 1.4)))
        key(o, "location", 1, before, "CONSTANT")
        key(o, "location", g0, before, "SINE", "EASE_IN_OUT")
        key(o, "location", g1, spot, "CONSTANT")
        key(o, "location", g2, spot, "SINE", "EASE_IN_OUT")
        key(o, "location", g3, after)
        pop_in(o, g0 - 20 + rnd.randint(0, 10), 15)


def build_landing():
    """WELCOME TO, the church's full logo and the six club marks (the
    wording the owner chose, W1), each flying in to its place."""
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
    m0, mstep = BEATS["marks"]
    for i, (t, mk) in enumerate(zip(res["tiles"], res["marks"])):
        e = empty(f"Plate {S.CLUBS[i]}", t.location.copy())
        parent_keep(t, e); parent_keep(mk, e)
        pop_in(e, m0 + i * mstep, 12)
    return res


def build_camera(sc):
    """The camera drifts wide for the race, comes in for the knot, then
    settles on the wonder still's framing for the landing."""
    tgt = empty("Camera target", (0, 0, 0))
    cam = S.camera(sc, (0, -S.CAM_D, 0), (0, 0, 0), lens=50)
    cam.rotation_euler = (0, 0, 0)
    con = cam.constraints.new("TRACK_TO")
    con.target = tgt; con.track_axis = "TRACK_NEGATIVE_Z"; con.up_axis = "UP_Y"
    c = cam.data
    for f, loc, aim, lens in [
            (1, (0, -S.CAM_D, 0), (0, 0, 0), 50),
            (BEATS["unravel"][1], (0, -S.CAM_D, 0), (0, 0, 0), 50),
            (150, (2.0, -14, 1.4), (0, 0, 0.3), 36),
            (BEATS["knot"][0], (-1.2, -15.5, 0.6), CENTRE, 36),
            (BEATS["tighten"][0], (0, -15, 0.3), CENTRE, 40),
            # settled on the landing's framing by the burst: nothing slides
            # while the words land
            (BEATS["burst"] + 2, (0, -S.CAM_D - 1, -0.6), (0, 0, 0.1), 50),
            (F_END, (0, -S.CAM_D - 1.3, -0.65), (0, 0, 0.1), 50)]:
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
    # the wonder lighting (stills F2)
    S.area("Key", (-4, -12, 9), (0, 0, 0), 1500, "#E6EEFF", 8)
    S.area("Rim L", (-7, 6, 4), (0, 0, 1), 2600, S.CLUB["journey"]["primary"], 3)
    S.area("Rim R", (7, 6, 4), (0, 0, 1), 2600, S.CLUB["puggles"]["primary"], 3)
    S.area("Under", (0, -6, -8), (0, 0, 0), 600, S.CLUB["cubbies"]["tint"], 6)
    knot = empty("Knot", CENTRE)
    build_zero()
    build_ribbons(knot)
    t0, t1 = BEATS["tighten"]
    k0 = BEATS["knot"][0]
    key(knot, "rotation_euler", k0, (0, 0, 0), "LINEAR")
    key(knot, "rotation_euler", t1, (0, math.radians(70), 0))
    key(knot, "scale", 1, (1, 1, 1), "CONSTANT")
    key(knot, "scale", t0, (1, 1, 1), "SINE", "EASE_IN")
    key(knot, "scale", t1, (0.12, 0.12, 0.12), "CONSTANT")
    key(knot, "scale", t1 + 2, (0, 0, 0), "CONSTANT")
    build_stars()
    build_burst()
    build_egg()
    build_landing()
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
    main = bpy.context.window.scene if bpy.context.window else None
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

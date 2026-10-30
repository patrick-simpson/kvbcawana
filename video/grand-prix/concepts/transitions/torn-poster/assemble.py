"""Assemble the torn-poster Grand Prix promo (1920x1080, 60 fps).

python assemble.py prep        -> calibrate on full/g_00060.png, write asm/g_#####.png
                                  (colour-corrected renders + the hand-over blends)
blender -b -P assemble.py -- encode OUT.mp4   -> VSE: plate / renders / film frames -> H.264
python assemble.py contact OUT.png

Global frames g (60 fps):
  0-59      plate (exact)                  60-180   rip (renders; 60-63 eased from the plate,
  176-180   eased onto the raw film)       181-1765 the film frames 121..1705 as they are
  1766-1825 the end card at rest (film frame 1706, before the old wave sweep)
  1826-1960 return (renders; eased off the raw end card, then onto the exact plate)
  1961-2020 plate (exact)
"""
import sys, os, json, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
PLATE = r"C:\Users\User\Documents\GitHub\kvbcawana\video\grand-prix\concepts\lobby-plate-sky.png"
FILMDIR = r"C:\Users\User\scratch-intro\gp\gp-brand\frames1080"
REND = os.path.join(HERE, "full")
ASM = os.path.join(HERE, "asm")
G_TEAR0, TEAR_END, FILM_END_N = 60, 180, 1706
G_HOLD0 = G_TEAR0 + FILM_END_N        # 1766
G_RET0, RET_END = 1826, 1960
G_TOTAL = 2021


def film_path(n):
    return os.path.join(FILMDIR, "frame_%04d.png" % n)


def prep():
    import numpy as np
    from PIL import Image
    sys.argv = ["calib", "fit", os.path.join(REND, "g_%05d.png" % G_TEAR0)]
    subprocess.run([sys.executable, os.path.join(HERE, "calib.py"), "fit", os.path.join(REND, "g_%05d.png" % G_TEAR0)], check=True)
    cal = json.load(open(os.path.join(HERE, "calib.json")))

    def to_lin(c):
        return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

    def to_srgb(l):
        l = np.clip(l, 0, 1)
        return np.where(l <= 0.0031308, l * 12.92, 1.055 * l ** (1 / 2.4) - 0.055)

    def corrected(g):
        r = to_lin(np.asarray(Image.open(os.path.join(REND, "g_%05d.png" % g)).convert("RGB")).astype(np.float64) / 255)
        o = np.empty_like(r)
        for c in range(3):
            a, b = cal["abc"[c]]
            o[:, :, c] = (r[:, :, c] - b) / a
        return to_srgb(o) * 255

    def img(p):
        return np.asarray(Image.open(p).convert("RGB")).astype(np.float64)

    def ease(x):
        x = min(max(x, 0.0), 1.0)
        return x * x * (3 - 2 * x)

    plate = img(PLATE)
    os.makedirs(ASM, exist_ok=True)
    stats = {}
    for g in list(range(G_TEAR0, TEAR_END + 1)) + list(range(G_RET0, RET_END + 1)):
        r = corrected(g)
        if g < 64:
            w = ease((g - 59) / 5); out = w * r + (1 - w) * plate
        elif g >= 176 and g <= TEAR_END:
            f = img(film_path(g - G_TEAR0)); w = ease((181 - g) / 6)
            stats[g] = float(np.abs(r - f).mean())
            out = w * r + (1 - w) * f
        elif G_RET0 <= g < G_RET0 + 6:
            f = img(film_path(FILM_END_N)); w = ease((g - G_RET0 + 1) / 7)
            stats[g] = float(np.abs(r - f).mean())
            out = w * r + (1 - w) * f
        elif g >= 1948:
            w = ease((1961 - g) / 13); out = w * r + (1 - w) * plate
            stats[g] = float(np.abs(r - plate).mean())
        else:
            out = r
        Image.fromarray(np.clip(np.round(out), 0, 255).astype(np.uint8)).save(os.path.join(ASM, "g_%05d.png" % g))
    print("handover residuals (render vs raw, mean/255):", {k: round(v, 2) for k, v in stats.items()})


def encode(out):
    import bpy
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1920, 1080, 100
    sc.render.fps = 60
    sc.frame_start, sc.frame_end = 1, G_TOTAL
    sc.view_settings.view_transform = "Standard"
    sc.render.dither_intensity = 0
    se = sc.sequence_editor_create()
    strips = se.strips if hasattr(se, "strips") else se.sequences

    def seq(name, files, start, ch):
        d = os.path.dirname(files[0])
        st = strips.new_image(name, files[0], ch, start)
        for f in files[1:]:
            st.elements.append(os.path.basename(f))
        st.frame_final_duration = len(files)
        st.colorspace_settings.name = "sRGB"
        return st

    def still(name, path, start, dur, ch):
        st = strips.new_image(name, path, ch, start)
        st.frame_final_duration = dur
        st.colorspace_settings.name = "sRGB"

    still("plate_in", PLATE, 1, 60, 1)
    seq("rip", [os.path.join(ASM, "g_%05d.png" % g) for g in range(G_TEAR0, TEAR_END + 1)], G_TEAR0 + 1, 2)
    seq("film", [film_path(n) for n in range(TEAR_END + 1 - G_TEAR0, FILM_END_N)], TEAR_END + 2, 3)
    still("endcard", film_path(FILM_END_N), G_HOLD0 + 1, G_RET0 - G_HOLD0, 4)
    seq("ret", [os.path.join(ASM, "g_%05d.png" % g) for g in range(G_RET0, RET_END + 1)], G_RET0 + 1, 5)
    still("plate_out", PLATE, RET_END + 2, G_TOTAL - RET_END - 1, 6)
    r = sc.render
    if hasattr(r.image_settings, "media_type"):
        r.image_settings.media_type = "VIDEO"
    r.image_settings.file_format = "FFMPEG"
    r.ffmpeg.format = "MPEG4"
    r.ffmpeg.codec = "H264"
    r.ffmpeg.constant_rate_factor = "HIGH"
    r.ffmpeg.ffmpeg_preset = "BEST"
    r.ffmpeg.gopsize = 60
    r.ffmpeg.audio_codec = "NONE"
    r.filepath = out
    r.use_file_extension = False
    bpy.ops.render.render(animation=True)
    print("WROTE", out)


def decode_check(mp4, outdir):
    """Decode the first and last second through the VSE, compare with the plate."""
    import bpy
    import numpy as np
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1920, 1080, 100
    sc.render.fps = 60
    sc.view_settings.view_transform = "Standard"
    sc.render.dither_intensity = 0
    se = sc.sequence_editor_create()
    strips = se.strips if hasattr(se, "strips") else se.sequences
    st = strips.new_movie("m", mp4, 1, 1)
    n = st.frame_final_duration
    print("DURATION", n)
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_depth = "8"
    os.makedirs(outdir, exist_ok=True)
    for f in list(range(1, 61)) + list(range(n - 59, n + 1)):
        sc.frame_set(f)
        sc.render.filepath = os.path.join(outdir, "d_%05d.png" % f)
        bpy.ops.render.render(write_still=True)


def contact(out):
    from PIL import Image, ImageDraw, ImageFont
    picks = [(0, "0.00 lobby plate"), (84, "1.40 strain"), (108, "1.80 first crack"), (117, "1.95 rip"),
             (124, "2.07 rip runs out"), (130, "2.17 halves peel"), (140, "2.33 a half whips past"),
             (145, "2.42 past the lens"), (150, "2.50 AWANA lands"), (300, "5.00 film"),
             (1500, "25.0 end card"), (1850, "30.8 halves fly back"), (1880, "31.3 coming down"),
             (1910, "31.8 gap closing"), (1940, "32.3 tear heals"), (2020, "33.67 plate (last)")]
    tw, th = 480, 270; cols = 4
    sheet = Image.new("RGB", (cols * tw, 4 * (th + 26)), (18, 18, 20))
    try:
        font = ImageFont.truetype("arial.ttf", 17)
    except Exception:
        font = ImageFont.load_default()
    for i, (g, lab) in enumerate(picks):
        if g < 60 or g > RET_END:
            p = PLATE
        elif g <= TEAR_END or g >= G_RET0:
            p = os.path.join(ASM, "g_%05d.png" % g)
        elif g < G_HOLD0:
            p = film_path(g - G_TEAR0)
        else:
            p = film_path(FILM_END_N)
        im = Image.open(p).convert("RGB").resize((tw, th), Image.LANCZOS)
        x, y = (i % cols) * tw, (i // cols) * (th + 26)
        sheet.paste(im, (x, y))
        ImageDraw.Draw(sheet).text((x + 6, y + th + 4), "g%d  %ss  %s" % (g, lab.split()[0], " ".join(lab.split()[1:])), fill=(235, 235, 235), font=font)
    sheet.save(out)


if __name__ == "__main__" or "--" in sys.argv:
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    if args[0] == "prep":
        prep()
    elif args[0] == "encode":
        encode(args[1])
    elif args[0] == "decode":
        decode_check(args[1], args[2])
    elif args[0] == "contact":
        contact(args[1])

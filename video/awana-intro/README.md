# Awana Intro (15-second 3D welcome video)

A 15-second, 1080p, silent 3D intro built in Blender 5.2 LTS, styled to match
the lobby's flagship welcome slide. Its first and last frames both match that
slide, so the projector can cut from the lobby screen into the video and back
out again with no visible jump.

## How to make the video

1. Double-click **`1 - Preview Awana Intro.bat`**. You get a small, rough
   version in about 10 minutes. Grainy is normal at this stage; it's only for
   checking the timing.
2. Double-click **`2 - Render Awana Intro (overnight).bat`**. This is the full
   quality version, about 2 to 5 hours on the RTX 4050 laptop. Keep it plugged
   in and set it not to sleep. If it gets interrupted, double-click the file
   again and it picks up where it stopped.
3. The finished video is saved as `output/Awana Intro.mp4`, and the lobby's
   own copy (6 Mbps, about 11 MB, web-ready) as
   `lobby/public/intro/awana-intro.mp4`. Commit and push that file to put it
   on the TVs.

To start a render over from scratch (after changing the scene), delete the
`output/frames_final` folder first: finished frames are never re-rendered.

## On the lobby screens

The lobby's flagship welcome slide now and then carries on into this video
(the second pass through the slides, then every fourth; 16:9 screens with
motion on; `lobby/src/components/FlagshipIntro.jsx`). The video's first and
last frames ARE that slide (bounce style, "We're so glad you're here!", the
corner tab and the house waves), so the lobby fades the video in over the
slide and hands its own tab and waves over to it with nothing on screen
changing, and hands back the same way at the end.

That only holds while the video's flat frames match the lobby to the pixel,
so the scene is fitted to the real lobby: `tools/measure-lobby.mjs` opens the
built lobby in a browser, measures every piece of that slide (each letter of
the glad line, the logo's lines, the doodles, the tab and wave outlines) and
writes `lobby-layout.json`, which `awana_intro.py` reads. If the flagship's
look ever changes:

    cd lobby && npm run build && cd ..
    node video/awana-intro/tools/measure-lobby.mjs

then delete `output/frames_final` and render again.

**`3 - Open Awana Scene in Blender.bat`** opens the 3D scene so you can look
around. Press Space to play and drag with the middle mouse button to orbit.
Changes you make there are NOT used by the render buttons. The script below
rebuilds the scene from scratch every time.

## What's in here

| File | What it is |
| --- | --- |
| `awana_intro.py` | The recipe. Builds the whole scene (shapes, colors, lights, camera, timing) and renders it. The story and timing are explained at the top. |
| `lobby-layout.json` | The lobby's flagship slide, measured (`tools/measure-lobby.mjs`). The video's first and last frames are fitted to it. |
| `tools/faststart.py` | Moves an .mp4's index to the front so a TV can start it at once (used for the lobby's copy). |
| `diecuts/` | The club characters as die-cut "sticker" images plus their cut outlines, made by `tools/make_diecuts.py` from `shared/art/` and `lobby/src/assets/clubs/`. |
| `*.bat` | The double-click buttons. `_find_blender.bat` locates Blender. |
| `output/` | Rendered frames, the .mp4 files, and the .blend scene. Git ignores this folder. |

The brand kit (logo, doodles, fonts, colors) is read straight from
`shared/brand/`, the repo's one canonical copy. Nothing here duplicates it.

## Changing things

The `T = dict(...)` block near the top of `awana_intro.py` holds the timing in
frames (30 frames = 1 second). `LAYOUT_DOODLES` sets where each doodle floats.
The camera's flight path is the `path = [...]` list in `build_camera`.

The easter egg is real, and it's in the script if you go looking.

Awana® and the club characters are trademarks/artwork of Awana Clubs
International, used here by a member church for its own club nights. Not
affiliated with or endorsed by Awana. See `../../lobby/TRADEMARKS.md`.

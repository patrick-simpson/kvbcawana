# Awana Grand Prix (22-second silent promo)

A short, calm, silent announcement for the Awana Grand Prix, built in
Blender 5.2 LTS. It shows OUR race in OUR sanctuary, built to match the
owner's photo of the real room on race day 2025 (owner 2026-10-29: the first
preview "doesn't look like my church"): a bright, airy room with a peaked
white ceiling and rows of round can lights following its slope, warm tan
walls, the projector screen hung high under the ridge (a plain light picture
with a red-and-white stripe block, no words), the dark-carpeted stage with
its wide honey-oak steps, and the long, shiny ribbed aluminium 4-lane track
running from the start gate up on its stand at the back of the stage down
over the steps to the floor. Left of the track: the US flag and the red
Awana flag (yellow fringe) on chrome poles, the table of gold trophies, the
drums and music stands. Right: the black lectern, the red table with the
black numbered car board, the checkered cloth and the big blue screen on
its stand (plain blue). No rows of seats. Even, bright daylight, slow
camera moves, shallow focus. No shake, no whip pans, no sparks, no coloured
lights, no slogans.

The words are flat 2D cards in the lobby screens' brand look (the 2026-27
catalog kit in `shared/brand/`: Paytone One, Figtree, Londrina Solid, house
blue, sky, hot, the kit's waves, hard offsets only), laid out in HTML and
laid over the 3D frames.

## What the lobby plays

The lobby screens play the **gp-brand** cut (owner 2026-10-29: first "The flat
brand one is the one that I wanted to keep. Get that one set to show up on the
displays starting in January.", then, the same day, restyled in Awana's
official Grand Prix sub-brand with permission to use its logos and graphics:
"make it epic and extremely well produced").
`output/gp-brand/grand-prix-torn-1080p60.mp4` (the torn cut, 2026-10-29:
33.68 s = 2021 frames, 1920x1080, 60 fps, silent, ~10.3 MB; it opens on the
lobby's sky screen at rest, `concepts/lobby-plate-sky.png`, still until 1.0 s,
then the plate tears like paper onto the film; its red end card is at rest
~24 to 30.5 s; then the torn halves fly back, the tear heals, and from 32.75 s
to the end it is the plate again) is committed as
`lobby/public/promos/grand-prix.mp4`, with its red end card at rest (the frame
at 27.5 s) as `lobby/public/promos/grand-prix-end.jpg`. It is the season promo
`promo_grand_prix` (2027-01-01 through race day 2027-03-20;
`lobby/src/components/promos/GrandPrixPromo.jsx`, `GRAND_PRIX.homeAt` 32.85 s,
`openPlate` 1.0 s, `durationSec` 2021 / 60; CLAUDE.md "Season promos, snow
alerts, flagship"). Measured in Chrome against the plate: 0.32/255 for its
first second, 0.31/255 for its last. A new cut must keep its first and last
second exactly the lobby plate (and `homeAt` just after the closing plate is
fully drawn), or the hand-over will show: copy both files again, retime
`GRAND_PRIX`, and re-measure both seams. The earlier gp-brand cut
(`output/gp-brand/grand-prix-1080p60.mp4`, 30 s, which only ENDED on the
plate) is kept for reference.

The lobby also brings it IN with no stinger (`enter: 'seamless'` on the
descriptor): the scene's drifting pieces come to rest during the last 3 s of
the slide before it, that slide hands off as usual, and as soon as its words
have gone (about 0.35 s) the video, paused on its first frame, fades in over
it (0.15 s), takes the tab and waves over, then plays. So a cut
must also OPEN on exactly the lobby plate, held still for at least
`GRAND_PRIX.openPlate` (the hand-over is done about 0.3 s in). The torn cut
(`output/gp-brand/grand-prix-torn-1080p60.mp4`, ~1.0 s of plate, the tear,
the film, the tear closing, ~1.0 s of plate) is made for this. Both seams are
measured in Chrome at 1920x1080 by `lobby/e2e/grand-prix-promo.events.spec.js`
(it prints them; `GP_ENTRANCE_SEAM=1` asserts the entrance). Measured
2026-10-29 with the torn cut: entrance 1.01/255, exit 0.51/255, the lobby on
its empty plate 30 ms between the last words leaving and the video showing.

Its source is `concepts/gp-brand/` (one canvas drawn from a time value,
captured in Chrome; the official logo, torn brush edge, grain and starburst
are vectors extracted from Awana's Grand Prix catalog PDF, used with the
owner's permission; `assets/` is NOT committed, as Awana's artwork is not
republished from this public repo: `extract_assets.py` rebuilds it from the
catalog, which the owner has):

    cd concepts/gp-brand
    python extract_assets.py && python build_assets_js.py   # assets/ from the catalog PDF
    node capture.mjs hd 6                                   # 1800 PNG frames (scratch-intro/gp/gp-brand/frames1080)
    GP_CRF=MEDIUM blender --factory-startup -b -P encode.py -- _ ../../output/gp-brand/grand-prix-1080p60.mp4 hd
    node measure.mjs ../../output/gp-brand/grand-prix-torn-1080p60.mp4 32.75 33.68 0.0833   # vs the lobby plate (and 0 0.98 for the opening)

(`node capture.mjs` without `hd` makes the 960x540 30 fps check.) The older
flat-brand cut (`concepts/flat-brand/`) and the Blender film below are kept
for reference.

## How to make the video

Run these from this folder. `blender` means
`"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"`. Node,
Chrome and the lobby's Playwright (`lobby/node_modules`) are needed for the
cards; Python with Pillow for the contact sheet.

1. **Preview** (small, about 10-15 minutes):

       blender --factory-startup -b -P grand_prix.py -- --mode preview --ref room-photo.jpg

   You get `output/Grand Prix - PREVIEW.mp4` (960x540, 30 fps, EEVEE),
   `output/contact.png` (labelled stills: frames 1, 60, 200, 300, 400, 650)
   and, with `--ref` (the owner's photo of the room; not kept in the repo),
   `output/compare.png`: the photo and frame 1 side by side at the same
   height, to judge the match. If it gets
   interrupted, run it again: finished 3D frames are kept. Delete
   `output/frames_preview_3d` first if you changed the scene.
2. **Final** (full quality, a long render, best left overnight):

       blender --factory-startup -b -P grand_prix.py -- --mode final

   Cycles on the graphics card, 1920x1080, 60 fps, motion blur. You get
   `output/Grand Prix.mp4`. Delete `output/frames_final_3d` first if you
   changed the scene.
3. **Stills** (a few raw 3D frames, no cards, to check the look):

       blender --factory-startup -b -P grand_prix.py -- --mode stills --frames 60,200,400

Running the script with no `--mode` just builds the scene and saves
`output/Grand Prix.blend` so you can look around in Blender. Changes made in
there are NOT used by the renders: the script rebuilds everything every time.

## The story

| Seconds | Shot | On screen |
| --- | --- | --- |
| 0-4.5 | Opens on the photo's own view (on the floor in front of the steps, a little right of the track, 17 mm, the whole room in view), then a slow push up along the track to the start gate, four cars waiting | The Awana Grand Prix is back. |
| 4.5-11 | The pins drop; the cars roll down the long track (gentle slow motion); the camera rolls back down the track ahead of them, looking back up at them (28 to 40 mm) with the stage, flags, screen and ceiling lights behind, and they come to rest on the run-out | (no words) |
| 11-16 | A slow sideways dolly along the numbered car board on the red table, looking across it so the red cloth, the checkered cloth and the blue screen stay behind, with a few grown-up builds among the kids' cars | This year, grown-ups race too. / Kids race first. Then Trek, Journey and adults race together. |
| 16-22 | The end card wipes up and comes to rest by 16.7 s; the last frame is the paused picture | AWANA GRAND PRIX / Kids, Trek, Journey & Adults / Register by Sunday, Feb 28 / Build day: Saturday, March 6 · 2:00 pm / Race day: Saturday, March 20 · 2:00 pm, and the church's two-line logo |

The words are the owner's, final: no other words anywhere in the video.

## Changing things

- **Words and card layout:** `cards.mjs` (HTML and CSS; it writes the
  1920x1080 PNGs to `output/cards`).
- **Timing:** the `T = dict(...)` table near the top of `grand_prix.py`
  (frame numbers at 30 fps: frame = seconds x 30 + 1). Card motion uses the
  kit's curves (`settle`, `exit`, `wipe` from `tokens.json`).
- **Camera:** `cam_state()` holds the three shots; `SHOT1`, `SHOT2`,
  `SHOT3` just above it are their numbers. `CAM0` is where the photo was
  taken from.
- **The room, the track, the board:** `build_room` (stage, steps, walls,
  ceiling, cans, projector screen), `build_props` (flags, trophies, drums,
  lectern, checkered cloth, blue screen), `build_track` (its shape is
  `TRACK_PTS`, read off the photo), `build_board`. The cars: `RACERS` and
  `build_car`. The room is built in its own frame and turned 7 degrees
  against the track (`ROOM_O`, `ROOM_YAW`), as in the photo, where the stage
  front is not square to the track; `w2l()` turns a spot read off the photo
  into room coordinates.
- **Light:** `--can`, `--fill`, `--ambient`, `--screen` and `--exposure`
  override the ceiling cans, the soft house light, the room's ambient light,
  the projector's brightness and the exposure (default -0.8). `--tr` and
  `--tb` set the track's roughness and rib depth; `--rt PROBE` swaps EEVEE's
  screen reflections for the light probes.

Everything 3D is modelled by the script itself at real scale (a 7-inch
pine block, 1.2-inch black plastic wheels, nail axles). There are no
downloaded models. The end card uses the church's two-line ink logo on the
sky field (never the stacked logo). The tablecloth is plain red.

## What's in here

| File | What it is |
| --- | --- |
| `grand_prix.py` | The recipe. Builds the scene, animates it, renders it, lays the cards over it and encodes the .mp4. |
| `cards.mjs` | The flat cards, in HTML with the brand kit, screenshotted by Chrome. |
| `contact_sheet.py` | Puts one labelled still per shot on a single picture (needs Pillow). |
| `output/` | Cards, frames, videos, the .blend and the contact sheet. Git ignores this folder. |

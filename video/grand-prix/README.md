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

The lobby screens play the **flat brand** concept, not the Blender film (owner
2026-10-29: "The flat brand one is the one that I wanted to keep. Get that one
set to show up on the displays starting in January."):
`output/concepts/flat-brand-1080p60.mp4` (30 s, 1920x1080, 60 fps, silent, its
last second the lobby's sky screen at rest, `concepts/lobby-plate-sky.png`) is
committed as `lobby/public/promos/grand-prix.mp4`, with its end card at rest
(the frame at 25.0 s) as `lobby/public/promos/grand-prix-end.jpg`. It is the
season promo `promo_grand_prix` (2027-01-01 through race day 2027-03-20;
`lobby/src/components/promos/GrandPrixPromo.jsx`, CLAUDE.md "Season promos,
snow alerts, flagship"). A new cut must keep that last second exactly the
lobby plate, or the hand-back to the lobby will show: copy both files again
and re-measure the seam.

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

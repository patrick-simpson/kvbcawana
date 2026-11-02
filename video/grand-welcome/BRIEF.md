# The new grand welcome (brief, owner 2026-11-01)

A 3D film that REPLACES the projector's 6:00 grand welcome
(`lobby/src/presentation/views/GrandWelcome.jsx`), and one shared 3D lead-in
that REPLACES the other screens' 5-second "Switching to opening ceremony" card
(`lobby/src/components/MirrorSwitching.jsx`). Made in Blender 5.2 like the
lobby's welcome video (`video/awana-intro/`), on the Windows laptop (RTX 4050),
not in the cloud (owner: "use the computer for that, not the cloud").

BUILT and on the screens (2026-11-01, owner: "Make the whole thing in 1080p
60fps then adapt everything to fit it nicely", the projector and the lead-in
both). See "The real film and the lead-in" below and CLAUDE.md "Projector"
(Grand welcome, Ceremony mirror).

It ALTERNATES WEEK BY WEEK with the old style (owner 2026-11-01: "I want this
to alternate with the old style each week"): the film and the lead-in on
film weeks, the classic animated welcome and the switching card on classic
weeks. One rule, `shared/grandWelcomeWeek.js`; Wednesday 2026-11-04 is the
film's first night (a film week), 2026-11-11 classic, and so on.

## Decided (the owner's answers)

The film (projector, then every screen through the ceremony mirror):

- Replaces today's grand welcome, bigger: a 3D Blender film, the same every night.
- About 20 seconds (today: 15); the opening deck shifts 5 seconds.
- 60 fps (owner 2026-11-01: "the real one should be 60fps"), like the
  lobby's intro video; the rough previews stay 30 fps. `grand_welcome.py
  --fps 60`: the timeline stays in 30 fps frames and Blender's time
  stretching renders twice as many (60 fps frame 2N = 30 fps frame N,
  checked to the pixel).
- Silent.
- Must show by its end: WELCOME, the church's full logo (with the tagline),
  the six club marks (official art, never redrawn).
- No mascots.
- Starts FROM the countdown's 0:00: in the countdown's last seconds the
  week's event lines and the corner logo step away, leaving only "0:00" on
  black, which is exactly the film's first frame.
- Ends seamlessly INTO the US Pledge slide: its last frame is that slide's
  first frame.
- Black stage: everything on pure #000 (the projector's rule).
- Easter egg: a tiny "2 Tim 2:15" hidden in it (a sparkle pattern or an edge),
  like the lobby video's star.
- No deadline ("when it's right").

The lead-in (lobby TV, Journey, the classroom):

- One shared film for all three screens.
- 5 seconds, in today's switching card's slot (it ends as the screens start
  copying the countdown's last 10 seconds).
- A SEE-THROUGH layer that sweeps in over whatever the screen is showing and
  fills it (a video with transparency, e.g. VP9 WebM with alpha).
- Says "Opening ceremony" as it lands.

## The look (owner 2026-11-01, chosen from the 3D stills)

The stills: `stills.py` (double-click `Make Grand Welcome Stills.bat`, about
a minute on the laptop) renders 15 rough 1280x720 EEVEE stills and a labelled
`contact-sheet.png` into `output/stills/` (git ignores `output/`; never commit
renders). The club marks are the kit's own `<club>-white.svg` files, drawn by
the laptop's browser (Edge, else Chrome) into pictures, never redrawn:
Blender's SVG reader pulls in bits of the catalog page they were cut from.

Chosen:

- Feeling: WONDER (still F2): still and hushed, starlight and sparkles
  drifting, cool blue and purple edge light; not stadium hype, not silly.
- Story: A, "six clubs converge" (stills A1-A3): the six club ribbons race
  in, weave into one knot, it bursts, then WELCOME, the logo and the marks
  land. Not the street-and-church-doors story.
- Material: glossy toy plastic for WELCOME, the logo and the club plates;
  the six club RIBBONS glow like light (plastic + glowing ribbons).
- The opening: the countdown's "0:00" UNRAVELS into the six club ribbons (one
  seamless move from the film's first frame, the 0:00 on black).
- The burst: sparkles and starlight (a soft flash, then brand sparkles drift
  out and twinkle), NOT confetti.
- WELCOME: white letters with the cool blue and purple rim light (F2).
- The words at the peak (owner 2026-11-01: "It should say welcome to Awana";
  plain WELCOME over the logo read oddly): "WELCOME TO" over the church's
  full logo, so the logo finishes the sentence ("Welcome to Kennebec Valley
  Baptist Church Awana Clubs"); nothing says Awana twice (still W1,
  `WORDINGS["to_logo"]` in stills.py; W2 "WELCOME TO / AWANA" big and W3
  "WELCOME TO AWANA" on one line were turned down).
- At the end the ribbons fade into starlight, leaving only WELCOME, the
  church's full logo and the six club marks (on their club-colour plates)
  before the hand-over to the US Pledge slide.
- Easter egg: a SPARKLE CONSTELLATION: a few drifting sparkles briefly line
  up to spell "2 Tim 2:15", then drift apart.

## The rough moving preview (2026-11-01)

`grand_welcome.py` (double-click `Preview Grand Welcome Film.bat`) builds
the 20-second film from the chosen look and renders it IN BLENDER'S OPEN
WINDOW (owner 2026-11-01: everything runs with a window, never headless;
about 2 minutes on the laptop), then makes `output/Grand Welcome -
PREVIEW.mp4` (960 x 540, 30 fps). It reuses `stills.py`'s brand pieces.
Its `BEATS` table holds the timing (30 frames = 1 s):

- Preview 2 (owner chose all four improvements, 2026-11-01): 0-0.7 s
  "0:00" alone on black; 0.7-1.3 s the six club ribbons (round tubes of
  light, so they can follow tight curves) trace the three zeros' outer and
  inner edges in club colours, youngest first left to right, and the white
  digits go; 1.3-5.7 s they peel off and race round the room, past the
  lens; 5.7-7.8 s all six slot into one knot together, which turns and
  tightens; 10.5 s it bursts: a four-point brand starburst, a ring, starlight
  half white and half in the club colours; 10.8-12.3 s WELCOME TO lands
  letter by letter and the full logo rises in; 11.8-13.3 s each club's light
  streaks (behind the logo) to its own plate and delivers its mark, youngest
  first; 13.3-19.3 s held with a slow push-in, the 2 Tim 2:15 constellation
  at about 15-17 s top left, fading out; 19.3-20 s fade to black. The words
  have their own soft front light so they read white.
- Still rough: the 0:00 (size, place, face) and the hand-over (a fade to
  black) stand in for the real seams. Next: measure the projector's
  countdown 0:00 and the US Pledge slide's first frame and fit both.

## The real film and the lead-in (2026-11-01)

- The film: `grand_welcome.py --final` (in Blender's window, ~18 min on the
  laptop): 1920x1080, 60 fps, motion blur, 64 EEVEE samples; writes
  `output/Grand Welcome.mp4` (near-lossless master) and the projector's
  copies in `lobby/public/welcome/`: `grand-welcome.mp4` (8 Mbps, ~21 MB,
  index first), `grand-welcome-first.png` (its first frame) and
  `grand-welcome-still.jpg` (its landed frame at 16 s).
- The start seam: `tools/measure-projector.mjs` captures the built
  countdown's "0:00" alone on black at 1920x1080 (`projector-zero.png`,
  `projector-layout.json`); the film's ribbons trace the zeros at their
  measured places, and its frames before the ribbons start are copied from
  that picture, so frame 1 is byte for byte the countdown's. Checked in Edge
  through 6:00: the countdown's last instant reads 0:00 and the film lands
  on it with no visible cut. The end seam: the last frame is black (the
  pledge slide starts on black: its words, clock and the corner logo fade in).
- The lead-in: `grand_welcome.py --lead-in --final` (~4 min): 5 s, 1080p60,
  RGBA frames (no bloom: the compositor drops alpha) encoded by Blender to
  VP9 WebM with alpha, `lobby/public/welcome/opening-lead-in.webm` (~0.4 MB)
  and `opening-lead-in-still.png` (its card at 3.5 s, for zero animation).
  Measured playing in Edge: see-through 100% at the start, ~50% at 0.45 s,
  fully covered from 1.3 s. (A seek-and-copy check reads VP9 alpha video as
  blank in Edge: test it playing, or decode with FFmpeg's libvpx-vp9.)

## When it is built (for whoever builds it)

- The projector plays the film in place of GrandWelcome (the deck's `welcome`
  slide, `config.js`), from the same site with Range (`site/lib/largeFiles.js`
  REPO_FOLDERS); low power keeps a still finished frame (the M rule).
- The countdown's last seconds: the event lines and the corner logo step away.
- The mirror screens play the lead-in instead of MirrorSwitching.
- Keep every existing rule in CLAUDE.md "Projector" (ceremony mirror, hosts,
  the black at the end of the deck) and update its tests and the section.
- The home page's "The opening" scene and the film (`printer/reel`) will
  then show the new one (re-record `projector-countdown`).

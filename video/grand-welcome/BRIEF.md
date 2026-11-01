# The new grand welcome (brief, owner 2026-11-01)

A 3D film that REPLACES the projector's 6:00 grand welcome
(`lobby/src/presentation/views/GrandWelcome.jsx`), and one shared 3D lead-in
that REPLACES the other screens' 5-second "Switching to opening ceremony" card
(`lobby/src/components/MirrorSwitching.jsx`). Made in Blender 5.2 like the
lobby's welcome video (`video/awana-intro/`), on the Windows laptop (RTX 4050),
not in the cloud (owner: "use the computer for that, not the cloud").

Nothing is built yet. The look is chosen (below, from the stills); the next
step is building the film.

## Decided (the owner's answers)

The film (projector, then every screen through the ceremony mirror):

- Replaces today's grand welcome, bigger: a 3D Blender film, the same every night.
- About 20 seconds (today: 15); the opening deck shifts 5 seconds.
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
- At the end the ribbons fade into starlight, leaving only WELCOME, the
  church's full logo and the six club marks (on their club-colour plates)
  before the hand-over to the US Pledge slide.
- Easter egg: a SPARKLE CONSTELLATION: a few drifting sparkles briefly line
  up to spell "2 Tim 2:15", then drift apart.

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

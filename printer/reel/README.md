# The reel

The overview film at the top of awana.kvbchurch.org: a 78-second product film
of the family's screens on a club night, cut to its soundtrack's beat. Every
frame is rebuilt from the sources in this folder:

```
npm run reel          # in printer/: labels, footage, film, edit (about 20 minutes)
```

It needs the built site (`SITE_ORIGIN=https://awana.kvbchurch.org node site/build.mjs`
at the repo root; `npm run reel` builds it when `site/dist` is missing),
Chromium (`PLAYWRIGHT_CHROMIUM`, else `/opt/pw-browsers/chromium`) and ffmpeg.
It writes `printer/public/reel/reel.mp4` (one 960x540 file, about 1.5 MB) and `poster.jpg`,
which the page plays; everything in between goes to `reel/.work/` (ignored).

## How it is made

| Step | File | What it does |
| --- | --- | --- |
| Labels | `labels.cjs` | Real 4x2 labels from the print server's own renderer (`generateLabel()` through `/preview`), for a made-up roster. |
| Footage | `record.mjs`, `shots.mjs`, `lib/vclock.mjs` | The real screens from `site/dist` (the lobby, the projector, Journey, `/checkin`, `/settings`), driven the way their own e2e suites drive them (the stand-in live channel, `lib/live.mjs`; a stand-in check-in service behind the phone page, `lib/phone.mjs`), filmed frame by frame on a virtual clock at 60 fps. |
| Film | `film/` (`film.js`, `kit.js`, `lib.js`, `film.css`), `render.mjs` | The motion graphics and the edit in one page: the opener, the section cards, the closer, the footage on the catalog's plates. Every frame is a pure function of time, rendered by seeking and screenshotting. |
| Edit | `edit.mjs` | Cuts the soundtrack to the film (bars 2-31, then the final phrase), mixes it, and encodes the deliverables. |

**The virtual clock** (`lib/vclock.mjs`): Playwright's fake clock owns
`Date`, `performance.now` and the timers; `requestAnimationFrame` becomes a
queue that runs once per recorded frame; CSS animations and transitions are
paused and seeked to the frame's time; framer-motion is kept off the Web
Animations timeline (it only uses WAAPI when `Element.prototype` owns
`animate`) and canvas-confetti off its worker. So the footage is an exact,
smooth 60 fps however slowly a frame draws, and identical on every run.

**The look** is the Awana Clubs 2026-27 catalog's, from the family's one kit
(`shared/brand`): Paytone One shouts, Londrina Solid labels, Figtree is
read; the club waves, the corner tabs, the stepped chip
(`shared/chipGeometry.js`), the doodles in threes, the starburst, photos on a
plate with an offset outline, depth as a hard offset, never a blur. The real
Awana and club marks appear inside the film only (owner, 2026-10-11), and its
last card carries the trademark notice.

**Names are made up.** Every child on screen, on a label or on the phone is
an invented first name (and invented last name on the labels and the phone),
never a real child's.

## The music

"Incredible You" by **Soft and Furious**, released under **CC0 1.0**
(Creative Commons Zero, public domain dedication).

- Source: https://commons.wikimedia.org/wiki/File:Soft_and_Furious_-_03_-_Incredible_You.ogg
- File: https://upload.wikimedia.org/wikipedia/commons/8/87/Soft_and_Furious_-_03_-_Incredible_You.ogg
- License: https://creativecommons.org/publicdomain/zero/1.0/
- Kept here as `music/soft-and-furious-incredible-you.ogg` (sha256
  `ffc0d13137c9a4cdf5a5a6ceb453a6aaf9d9b44df6e92482d79685fcc3ae019b`), so the
  reel rebuilds without the network.

Measured off the file: 120.25 BPM (beat 0.498947 s, first downbeat 0.2812 s),
F major. The film's timeline (`film.js`, `BEAT`) is on that grid: the music
starts at bar 2, the picture's title lands on the lift at bar 8, the
projector's 6:00 on the melody at bar 24, and the payoff on the final phrase
(bar 72 to the track's own ending, spliced in at a phrase boundary).

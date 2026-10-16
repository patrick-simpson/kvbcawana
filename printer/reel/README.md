# The reel

The film at the end of awana.kvbchurch.org (the home page's finale): a
90-second montage of the family's screens on a club night, cut to its
soundtrack's beat. Every
frame is rebuilt from the sources in this folder:

```
npm run reel          # in printer/: labels, footage, film, edit (about 20 minutes)
```

It needs the built site (`SITE_ORIGIN=https://awana.kvbchurch.org node site/build.mjs`
at the repo root; `npm run reel` builds it when `site/dist` is missing),
Chromium (`PLAYWRIGHT_CHROMIUM`, else `/opt/pw-browsers/chromium`) and ffmpeg.
It writes `printer/public/reel/reel.mp4` (one 1280x720 file, about 5.5 MB) and `poster.jpg`,
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

"Happy Dance" by **MercyMe**, chosen by the owner (2026-10-16), who supplied
the file and accepted that it is a copyrighted song on a public page. The
end card credits it.

The audio file is **not in the repo** (the repo is public; publishing the
song is not ours to do). Put it at `reel/music/happy-dance.mp3` (git-ignored)
or name it in `REEL_MUSIC`; `edit.mjs` stops with a plain message without it.

Measured off the file: exactly 125 BPM (beat 0.480 s, first beat 0.044 s;
the grid holds to 4 ms over the whole song). The film's timeline (`film.js`,
`BEAT`) is on that grid: the film starts on song beat 4 (the band's first
downbeat), the first chorus lands at film beat 92 (0:44), the cut jumps at
film beat 156 (the end of the first chorus) to song beat 368 (the second half
of the final chorus), and the end card's logo lands on the song's last hit,
film beat 180 (1:26).

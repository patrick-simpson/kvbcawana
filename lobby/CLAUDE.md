# Awana Check-in Display — Project conventions for Claude

## Git workflow: push directly to `main` on every update

Every code change in this repo should be committed **and pushed to
`main`** as part of the same turn. There are no feature branches and no
pull request review step — the user has explicitly authorized direct
pushes to `main`. The root `.github/workflows/ci.yml` runs this app's
checks (lint, typecheck, vitest, build, the Playwright smoke suite) on every
push and then publishes the one site, so each green push redeploys
https://awana.kvbchurch.org/lobby/ (the signage) and `/lobby/countdown` (the
projector). This folder's own `.github/` workflows are dormant.

Concretely, after editing any file: run the checks a contributor runs
(`npm run lint`, `npm run typecheck`, `npx vitest run`, `npm run build`, and
`npm run e2e` for anything the smoke suite covers), `git add`, `git commit`
with a clear message, and `git push origin HEAD:main` (no PR, no other branch).

**Where the screens are (since 2026-10-03).** Every screen listens to the
sync Worker's live channel (`/api/v1/live`, `lobby/worker/`), signed in with
the church passphrase; the Pusher keys are cleared and Pusher is off
(SWITCH.md). The wire design below was written for a public Pusher channel
and applies unchanged to the live channel: the same events, the same
allowlist sanitizers, the same sealed envelopes and anti-downgrade rule.
Where this file says "the Pusher channel", read "the live channel" too. The
print server still carries the Pusher publisher until switch day's cleanup.

## Embedding on weaker hardware — `?lowPower=1`

The sibling **Journey Display** repo embeds this app via iframe on a
Raspberry Pi Zero — hardware far weaker than the other, standalone
devices running this same signage app elsewhere. `src/lib/urlFlags.js`'s
`?lowPower=1` flag forces `confettiLevel: 'off'` and `reduceMotion: true`
for that one embed's URL only, winning over even this device's saved
Settings — the same way `?key=`/`?cluster=` already do for OBS/
ProPresenter embeds. `confettiLevel`/`reduceMotion` in `src/config.js`
default to full effects (`'full'` / `false`) for everyone else — **do
not** change those defaults to accommodate one weak embed again; that's
exactly the mistake this flag exists to avoid repeating. Journey
Display's `public/index.html` passes the flag on its iframe's `src`.

**`reduceMotion: true` means ZERO animation, not just reduced** — this
was tightened after an initial pass only suppressed transforms. Two
mechanisms, because framer-motion and CSS need different enforcement:

- **Framer-motion:** `src/lib/motion.jsx` exports `M` — a drop-in
  replacement for `motion` (`M.div`, `M.span`, `M.path`, …, proxied so
  any tag works) that reads `ZeroAnimationContext` (provided in
  `App.jsx`, driven by `config.reduceMotion`) and forces
  `transition={{ type: false }}` — an instant jump to the target value,
  no fade, no repeat loop — **regardless of what transition the caller
  passed**, including a hardcoded `repeat: Infinity`, and including one
  NESTED inside a target (`exit={{ opacity: 0, transition: {...} }}`, an
  `animate` target's own transition, a variant's): framer-motion lets a
  nested transition beat the element's prop, so under zero animation M
  strips those too (`stripTransition` / `stripVariants`). Before that, every
  exit with its own timing still animated on the Pi. This is why it's
  stronger than `MotionConfig`'s `reducedMotion="always"` prop (also
  still set): that only ever gates transform/positional values (x, y,
  scale, rotate, width/height, top/left/right/bottom — framer-motion's
  own `positionalKeys` set), never opacity or anything else — verified
  directly against framer-motion's source, not just its docs.
  **Every component in this app (signage side, not `src/presentation/`)
  must import `M` from `src/lib/motion.jsx` instead of `motion` from
  `'framer-motion'` directly.** This is the actual guarantee behind
  "future updates get the animation exemption automatically" — a new
  animated component built with `M.*` is covered with zero extra code;
  one that imports `motion` directly is invisible to this system and
  will animate even under `?lowPower=1`, silently reintroducing the bug
  this exists to prevent. `AnimatePresence`/`MotionConfig` are unaffected
  and still come straight from `'framer-motion'`.
- **Plain CSS** `@keyframes`/`transition` rules (the lobby's ambient
  `lobby-drift-*` / `lobby-float` / `lobby-twinkle` / `lobby-roll` loops,
  the connecting-status pulse, the cozy-filter fade, and any future one)
  don't go through React, so they need a separate kill switch: `App.jsx`
  toggles a `zero-animation-mode` class on `<html>` from the same
  `config.reduceMotion` flag, and `app.css` has one blanket rule —
  `.zero-animation-mode, .zero-animation-mode *, .zero-animation-mode
  *::before, .zero-animation-mode *::after { animation: none !important;
  transition: none !important; }` — that disables every CSS
  animation/transition on the page at once. Deliberately a blanket rule
  rather than listing selectors one at a time, for the same reason as
  `M.*`: a future CSS animation is covered automatically, with nothing
  to remember. The pseudo-elements are named because `*` never matches
  one and neither property is inherited: the kit checkbox's `::before`
  check pop still played under `?lowPower=1` until they were.
  `src/lib/zeroAnimationCss.test.js` pins the rule and fails any
  pseudo-element animation it would not reach.
- Verified live (not just unit-tested): a real animated element sampled
  every 250ms genuinely oscillates opacity standalone but is perfectly
  flat under `?lowPower=1`; a CSS `@keyframes` animation's computed
  `animation-name` is its real name standalone and `none` under
  `?lowPower=1`.

**Double-click fullscreen is handed UP when embedded.** A double-click on
the stage normally fullscreens the stage element. Inside Journey's iframe
that fullscreens only the frame, which covers Journey's own corner buttons
and leaves the operator with no way back out, so `toggleFullscreen` in
`App.jsx` instead posts `{ type: EMBED_FULLSCREEN_MESSAGE }` (the string
lives in `src/lib/constants.js`) to `window.parent` and returns. Journey's
`public/src/schedule.js` is the consumer: it verifies `event.source` is its
own iframe and fullscreens its whole page. The message carries nothing but
its type, and standalone behaviour (`window.self === window.top`) is exactly
what it always was. Both sides have to agree on the string, so changing it
means landing both repos together.

**Embedded, the bottom-right corner belongs to the host.** Journey floats
two always-visible 48px round buttons over the frame, and nothing in here
can paint over a parent's element: live on 2026-09-29 its view toggle covered
the last digit of the RIGHT NOW clock at 720p and its settings gear the end of
OVERCAST at 1080p. The two sides now agree on one place for them: while this
display shows, Journey stacks the gear 8px above the toggle, one column in
the bottom-right corner, `max(3vw, 24px)` in from the right edge, the toggle
`max(3vh, 24px)` up from the bottom (Journey's `#checkin-view:not(.hidden) ~
#settings-btn` rule). Every other corner is ours, and the top-right has to
be: the band beside the stack runs to ~75u, where the widest sky starts, and
under it a tall problem sticker (a fault strip) already uses the room down to
the raised headline at 14u. Moving the stack down under a host button ran
that sticker into the kicker on the Pi (measured: 1.7u past 14u at 640x480),
and moving it left ran the widest weather chip into the band.

So when `isEmbedded()` (`src/lib/embed.js`: `window.self !== window.top`,
the fullscreen hand-off's own test, which now reads it too) App puts
`embedded` on `<html>`, and everything this page draws in the bottom-right
steps LEFT of the host's column, 8px clear (above the corner chip is the
copy, which may reach 45u, so it cannot go up):

- the corner chip (the time, tonight's tally, the WAITING chip when a tall
  sticker sends it down);
- the tonight ticker, which moves left with it, never further than centring
  it between the settings gear and the widest corner chip (at 640x480 the
  gear, the widest night's ticker, the clock and the toggle fill the row but
  for ~15px), and never wider than the room between those two less its own
  stat gap (0.8u) each side: where the widest night is wider than that room
  (a portrait phone, 226px for 174px at 390x844, and 592x432) it wraps its
  stats into rows instead of running under the clock; at 640x480 and on every
  16:9 screen the cap never binds;
- a check-in's name column: `nameRoomU` in `src/lib/checkInMoment.js` for the
  fit, `.checkin__copy`'s right edge for the box (a long name, MAXIMILIANA
  WOLFESCHLEGEL, ran under the toggle on every screen);
- the operator's panels, which reach the right edge on a small screen:
  Settings and the slide editor (94-96vw on `.panel-backdrop`) centre in the
  room left of the column (the backdrop is padded by the clearance, with ONE
  `minmax(0, 1fr)` column, because an auto track grows to the panel's own
  width and takes it under the column anyway), and the debug panel and the
  first-run card are capped to end short of it. At 640x480, 800x480 and
  1024x768 SAVE, the slide editor's CANCEL and the debug panel's Close sat
  under the host's buttons: a click on SAVE's right end opened JOURNEY's
  settings panel and left ours open, unsaved (a click in the column always
  reaches the host, never this page);
- the pickup board's strip and its "has checked out" banners (the first-run
  card's seat), whose right edge moves with the corner chip: `max(2.6u,
  --host-clear-x) + 16.6u` (`html.embedded .checkout-region`).

The column's inner edge is written twice on purpose: `HOST_CONTROL` /
`hostClearancePx` in `embed.js` (the name fit sizes type in JS) and the
`html.embedded` custom property in `app.css`; `embed.test.js` fails if they
drift, if an embedded rule touches the top-right stack, if a panel or the
ticker loses its cap, or if any rule reading `--host-clear-x` is not scoped to
`html.embedded`, so the standalone layout cannot move (measured: 48 standalone
states render identical boxes before and after, and 30 paused-clock screens,
the panels and the first-run card among them, identical pixels).
`e2e/embedded.spec.js` (smoke) and `e2e/embedded.events.spec.js` host the page
in a full-viewport iframe with Journey's buttons written out from JOURNEY's
CSS (`e2e/embedHost.js`), at 640x480, 720p and 1080p, the panels at 640x480
and 1024x768 (each one's corner button clicked at its far end, through the
stand-in host's real buttons), and a portrait phone for the first-run card and
the widest ticker. A new operator surface that can reach the bottom-right
edge needs the same cap and a case there. Journey's
`test/corner-buttons.test.mjs` pins its buttons to the column, so moving one
out of it (or back into our top-right) fails there first. Changing the
geometry means `HOST_CONTROL`, the `html.embedded` block, `embedHost.js` and
that Journey test together, and landing this repo first: a Journey button in
a new place sits on whatever this page still draws there. Nothing crosses the
wire or the URL: the signage infers its host from being framed, and any other
page that frames it (none in the family: OBS and ProPresenter open it
top-level) only gets its bottom-right chrome a little further in.

## Brand kit — `shared/brand/` (2026-27 catalog)

Owner decision 2026-09-27: every screen in the family (lobby signage,
projector, Journey kiosk, label printer) wears the Awana 2026-27 catalog's
design language and full official branding. `shared/brand/` is the one
canonical kit: `tokens.json` (club primary/deep/tint, house colors, fonts,
the motion table), `tokens.css` (the same as `--brand-*` properties),
`fonts.css` + `fonts/` (Paytone One, Londrina Solid, Figtree; WOFF2 for the
web, TTF for the printer's canvas; OFL; Paytone One and Londrina Solid ship
WHOLE, see below), `logos/` (every club mark as white
knockout / full color / one color, plus the Awana Clubs mark), `shapes/`
and `doodles/`. Read its README before changing it.

- **The shout is Paytone One** (owner decision 2026-09-29: it replaced
  Galindo, which "looks too much like SpongeBob", on every surface; Londrina
  Solid and Figtree stay, and so do the posters' own faces). Its license
  reserves the name "Paytone One", so every page loads the kit's FULL,
  unmodified files (`fonts/paytone-one-full-400-normal.woff2`, the TTF as its
  fallback): never an `@fontsource` or Google subset, which the OFL FAQ treats
  as a Modified Version that may not carry the name. `app.css` and the
  projector's `index.css` each declare the one `@font-face` (the tests pin
  them identical); it draws Latin-1, Latin Extended-A, Ș Ț and Vietnamese,
  and Baloo 2 stays behind it only for Devanagari.
- **Londrina Solid (the label voice) is held to the same rule.** Its license
  reserves "Londrina Solid" too, so the kit ships the upstream TTFs
  (`LondrinaSolid-Regular.ttf`, `-Black.ttf`, sha256 pinned) and, beside them,
  `londrina-solid-full-{400,900}-normal.woff2`: every table of the TTF through
  the WOFF2 null transform, differing only where the WOFF2 spec requires
  (head flags bit 11 and checksum; the TTF's empty 8-byte DSIG stub is
  removed). The signage and the projector declare the 400 cut in one
  `@font-face` each (`app.css`, `presentation/index.css`, pinned identical by
  `presentation/lib/kit.test.js`) and load no `@fontsource/londrina-solid`;
  the package is not a dependency. The 900 is not declared there, on purpose
  (the 400 is already bold, and a declared 900 would answer every
  `font-weight: 700+` rule). `brandKit.test.js` derives the reserved names
  from the kit's own `OFL-*.txt` and fails on any reserved-name WOFF2 that is
  not a proven whole font, on any font file `fonts.css` does not serve, and
  on an `@fontsource` package or import of a reserved-name face anywhere in
  `src/` or `package.json`. Figtree's license reserves no name, so its latin
  `@fontsource` subset is fine. The mirrors take the whole kit, both fonts
  included.
- **Its ascent/descent overrides (96% / 43.6%) seat the caps, nothing else.**
  Paytone's own metrics sit its caps ~0.17em lower in any line box than the
  face the mockup and every rule were drawn with, so chips' values sagged and
  names sank; the overrides keep the caps' centre where it was relative to
  the box and to SVG's central baseline, and keep the content box's height.
  `SHOUT_BOX` in `src/lib/brand.js` (and its projector copy in `lib/chip.js`)
  is the same pair for the fits' arithmetic; `promoFonts.test.js` pins it.
- **Sizes hold the mockup's cap heights, not its font sizes.** Paytone One's
  caps stand 5.7% shorter than Galindo's at one size (its figures 5%), so
  every shout size is the mockup's times 1.057 (1.05 for figures) and every
  shout line height the mockup's divided by it, which keeps each line box
  where it was: see the fit, the name steps, the sticker, the stage 4b-2
  overlays (the toast's `LINE` in `MilestoneToast.jsx`, the ticker's
  figures, the pickup board's count) and the projector's `--text-*`;
  `overlayFit.test.js` and `MilestoneToast.test.jsx` pin the overlays'.
  A plate drawn around the caps keeps its size and only the text grows: the
  stepped chip draws both texts 1.06x (`valueSize` / `labelSize` in both
  chip geometries), and a pickup-board name chip draws its name 1.057x its
  pill (`NAME_CHIP_TEXT` in `overlayFit.js`). The stepped PLATE's label is
  Londrina, not the shout, so its pill keeps the catalog chip's 0.56 ratio
  (`plateLabel`; `--plate-pill` is 2.05 x `--plate-label`).
- **Marks never touch.** Paytone draws the marks over and under its capitals
  tall (É to 1.045em, Ễ to 1.161em, Ș's comma to -0.351em, where a caps row
  is 0.93em), so each shout measures its ink (`inkEm` / `measureInk`: the
  canvas's actual bounding box, else `markExtents` from the marks) and makes
  exactly the room a mark needs: the lobby fit per row (`rise`), the check-in
  name against its kicker and its line (`nameBox`), the projector's headline
  (`headlineBox`), and a stepped chip's value against its block's keylines
  (`valueSeat`, both chip copies: it moves, and a value with marks both above
  and below the block cannot hold at 1.06x is drawn as large as it can), the
  milestone and doors-open toast's line against its plate (`toastBox` in
  `MilestoneToast.jsx`: padding above keeps a mark on the FILL, which prints
  below the top keyline with the room's background showing between them;
  padding below keeps a hanging comma's shadow off the bottom keyline; a top
  margin opens a lower row; `toastFit` counts all of it, and where the band
  has no room for it, under the flag strip, sets a marked line as large as the
  band allows on the same rows), and a pickup-board name against its pill's
  edge (`nameChipSeat` in `overlayFit.js`, the chip's `--seat`: the name sits
  lower in the same pill, kept 0.1em clear, not 0.06em, because that edge
  meets the white card, which swallows a white mark, and at 720p a small
  accent paints up to a pixel above its outline). Plain caps get none, so
  nothing moves for them. jsdom has no canvas, so
  `src/lib/inkCanvas.test.js` hands the three ink readers a fake one that
  reports Paytone's real boxes, the render tests pin the wiring (the words'
  `margin-top`, the name's padding, the chip's seat, the toast's padding and
  the board chip's `--seat`), `lobby-fit.spec.js` measures real ink on real
  rows under `?lowPower=1`, and `signage.events.spec.js` ("marks on the
  overlays") sends marked names over a stand-in Pusher socket and checks the
  toast's and the board's painted pixels at 720p, 1080p and 4K.

- **Three spellings of one palette.** `tokens.json`, `tokens.css` and
  `shared/theme.json` must agree; `src/lib/brandKit.test.js` fails if they
  drift. Edit all three together, and the projector's `--color-club-*` in
  `src/presentation/index.css` too (`shared-config.test.js` pins those to
  theme.json).
- **Puggles is blue** (`#1DB6D9`, its wordmark and duck), not the orange its
  catalog page uses: the owner's call, pinned by a test.
- **theme.json is what the screens actually render**, not `clubs.js`: once
  it loads, its values win field by field. Its optional `deep` and `tint`
  beat the derived guesses, and `art.logoWhite` (the knockout) beats
  `art.logo` (full color, for light fields) on banners, which sit on the
  club's own color. `clubs.js` carries the same catalog values as the
  pre-load fallback.
- **Mirrors.** Journey (`journey/public/brand/`) and the printer
  (`print-server/public/brand/`) carry byte-identical copies with drift
  checks, so neither depends on the network at showtime. Change the kit
  here first, then re-copy it into both.
- `scripts/brand/extract-catalog-brand.py` regenerates the marks and shapes
  from a catalog PDF (not committed), for next season.
- **Two sizes of one shout.** `--font-shout` is Paytone One at true size, for
  everything built from the kit (`src/components/brand/`) and every surface a
  stage has rebuilt, which is now all of the lobby's shouts: the typed and
  calendar slides' headlines (sized by the fit in `src/lib/lobbyFrame.js`),
  the check-in name, the sticker, and the 4b-2 overlays (the milestone toasts
  and the doors-open flourish, the ticker, the pickup board's names and
  count), each sized for Paytone One. `--font-display` is the same files drawn
  at 88% (the `'Shout Fit'` @font-face in app.css), for a rule still sized for
  the old Baloo 2: Paytone sets ~9% wider than Baloo 2 ExtraBold with 11.5%
  taller caps, and 88% lands at Baloo's median width less 4%, its caps less 2%
  and no more than ~5% over on the widest names (the envelope the 82% Galindo
  alias kept). Only `.countdown .time` is left on it (`CountdownTimer.jsx`,
  which no screen renders). Move a rule to `--font-shout` only when you
  re-size it. Both stacks fall back to Baloo 2 for Devanagari,
  the one script a name may use that Paytone lacks and a chunky face draws,
  which (with the promos) is why the Baloo import stays.
- **The posters keep their own faces.** `--promo-font-*` and `--font-poster`
  are poster-only and the brand tokens never touch a `.promo-*` rule;
  `src/lib/promoFonts.test.js` pins both directions.
- **Kit primitives** (`src/components/brand/`: StepChip, Wave, CornerTab,
  Sticker, DoodleCluster) are M elements, timed from `src/lib/brand.js`; the
  one static primitive, StepPlate, only draws a measured outline
  (one 100 ms beat, the wipe / settle / pop / exit curves).
  `zeroAnimation.test.jsx` renders each through the real framer-motion under
  zero-animation mode, and `src/lib/motionImports.test.js` fails any signage
  file that imports an animating framer-motion export instead of `M`.
- **The lobby has its own visual suite**, `e2e/signage.visual.spec.js`: a
  paused Playwright clock (install() alone lets time run), Math.random
  reseeded at every click, a fixture calendar and `?lowPower=1`. Regenerate
  its baselines with the update-snapshots workflow, never from a sandbox.

## Tech stack snapshot

- React 19 + Vite (plain JavaScript); the `M` wrapper takes `ref` as a plain prop (no forwardRef)
- framer-motion, canvas-confetti
- pusher-js for realtime check-in events (no backend in this repo)
- Vite `base: './'` so assets use relative paths and work under any URL
- Two independent HTML entries: `index.html` (signage) and
  `countdown.html` (presentation tool, `src/presentation/`)
- Tailwind CSS 4 (`@tailwindcss/vite`) is imported ONLY by
  `src/presentation/index.css`, with `@source` scanning pinned to that
  subtree — the signage CSS graph must never see Tailwind
- Jelly UI web components, vendored at `public/vendor/jelly-ui.js`
  (loaded from `src/main.jsx`; provenance in `public/vendor/README.md`)
- Shared timing/cap constants live in `src/lib/constants.js` (signage);
  operator-tunable ones are mirrored as validated `config.js` keys
- A hand-written service worker (`src/sw.js`, emitted with a per-build
  cache version by the `serviceWorker()` plugin in vite.config.js)
  gives both pages an offline shell — JSON and HTML stay network-first
  (falling back to the cached copy after 8 s of no answer, so lie-fi never
  hangs a reload), `/api` is never touched, and the self-update probes are
  network-ONLY (see "Self-updating pages")
- Quality gates on every push to `main`: lint, `tsc` typecheck of the
  `@ts-check` seams, vitest with coverage thresholds, build, and the
  Playwright smoke suite; visual regression runs in ci.yml only
  (baselines under `e2e/__screenshots__`, regenerate via the
  update-snapshots workflow)
- There is no `@types/react` or `@types/react-dom`, and `tsc` (TypeScript 7,
  whose program load runs in parallel) must never infer either from its own
  JS: whether it reads `react/index.js`' or `react-dom/index.js`' `cjs/`
  files changes from run to run, so `flushSync` failed with TS2305 on some
  runs, and later `useState` failed a deploy the same way after passing 30 of
  30 runs locally (a deeper `maxNodeModuleJsDepth` only made it rarer).
  jsconfig.json's `paths` maps the bare `react` and `react-dom` specifiers to
  `types/react.d.ts` and `types/react-dom.d.ts`, which declare exactly what
  the checked code imports (a handful of hooks, and `flushSync`);
  `react/jsx-runtime`, `react-dom/client` and friends still resolve to the
  packages, and Vite never reads jsconfig, so builds and tests use real
  React. Import anything else from bare `react` or `react-dom` in a checked
  file and you add its declaration there first.

## About page (`public/about.html`)

A plain static showcase page for church leadership, published at
`https://awana.kvbchurch.org/lobby/about.html`. It is
one of three "family" pages (with the Club Label Printer home and Journey
Display's `about.html`) that share one design system. Rules:

- **Static, outside the Vite graph.** `public/about.html` and
  `public/family.css` are copied into `dist/` as-is; the page's own styling
  lives in an inline `<style>` block in `about.html` (there is no
  `about.css`). The page is not a Vite entry and must never import React,
  Tailwind, `app.css`, the signage bundle or any service-worker
  registration. Because Vite copies `public/` outside the rollup bundle, the
  `serviceWorker()` plugin never sees these files: they are not in the
  precache manifest and carry no `awana-build` stamp, so the self-update
  poller ignores them.
- **Bump `family.css?v=` whenever `family.css` changes, on BOTH about pages**
  (this one and Journey's `journey/public/about.html`, which links it the
  same way). A browser that already has the signage's service worker still
  serves this page through it: the HTML network-first, but the stylesheet
  cache-first under the current build's cache name, which a CSS-only deploy
  never changes. A new query string is a new cache key, so the bump is what
  gets a restyled `family.css` to a signage device. Page-only styling needs
  no bump: it is inline, so it travels with the network-first HTML.
- **`family.css` is byte-identical across the three apps** (`lobby/`,
  `journey/`, `printer/`; `scripts/check-mirrors.mjs` fails CI on drift). The
  canonical copy is `printer/styles/family.css` and its spec is
  `printer/docs/FAMILY-DESIGN.md`; never edit this copy, only replace it
  with the canonical file. Page-only styling goes in
  `about.html`'s `<style>` block, every class prefixed `cid-`.
- **No Awana art on this page.** The owner uses the official Awana branding
  (club marks, the Awana Clubs mark, the catalog's design language) on the
  church's OWN screens (TRADEMARKS.md, 2026-09-27). This public showcase page
  is not one of those screens, and by the owner's choice it shows no logos,
  club wordmarks, mascots or curriculum clipart, and no shape copied from
  `shared/brand/` (its waves, starburst and doodles are drawn fresh). Screens
  on the page are hand-built CSS/SVG recreations of the CURRENT signage look:
  the 2026-27 club colors from `shared/brand/tokens.json` and the brand
  faces, which are the kit's own (Paytone One shouts, on the lobby AND the
  projector; Londrina Solid labels; Figtree is read), loaded from
  `shared/brand/fonts.css` (the build serves `shared/` at `/shared/`, so the
  link is relative and works under any base). **Never from Google Fonts**
  (owner, 2026-09-29: Galindo "looks too much like SpongeBob", and it had
  been left on this page after every other screen moved to Paytone One; the
  projector's Lilita One went with it, since the projector retired it). Google
  is asked only for the page's editorial faces (Fraunces, Source Sans 3, IBM
  Plex Mono). Paytone One's and Londrina's licenses reserve their names, so
  they come only from the kit's full files, never a subset.
  `src/lib/aboutPage.test.js` fails if Galindo or Lilita One comes back, or
  if the page fetches anything from another host but the ONE Google
  stylesheet for the editorial faces (and its two preconnects): a v1
  `css?family=Paytone+One` link, a mirror such as fonts.bunny.net, a preload,
  an `@import`, a page-local `@font-face` or a `url()` to another host all
  fail it, not just a `css2` request for a brand face. The four stepped chips are generated by the
  lobby's own `chipGeometry()` around Paytone One's measured widths (the SVG
  `textLength`s are those widths, so a chip's plate hugs its words), so
  regenerate them, never hand-edit, if that geometry changes. The lobby
  mocks' shout sizes carry `--cid-fit` (1.057, the same Galindo-to-Paytone
  cap-height factor the lobby and the projector carry; Journey's kiosk, and
  so its about page, carries 1.05). Each one is `role="img"` with a full `aria-label`,
  captioned "Recreated for illustration", with generic first names only.
  Club names appear only as plain text (where the real screen shows a club
  mark, a plain label stands in and the caption says so). Two deliberate
  departures keep the mocks' small print AA at mock size, and are commented
  in the `<style>` block: the check-in kicker is white on the club's deep
  wave, and the hot sticker is `#CF4518` rather than the kit's `#F15A28`.
  Doodles are placed for the headline that was there: a bigger or different
  face moves the words under them (Paytone One's "Welcome to Awana!" ran its
  "!" into Fig. 1's zigzag until it was moved). `e2e/about.visual.spec.js`
  measures the real layout at twelve widths and fails if any line of text in
  a recreation touches a `.cid-dz` box; it runs with the visual project
  (ci.yml only), not the deploy gate. Change a recreation's face or size,
  run it, and move the doodle, not the test.
  When the signage's look changes, rebuild the recreations in the same
  commit. The disclaimer bar, the meta description and the footer legal
  paragraph carry the not-affiliated line, and the first visible "Awana"
  carries the ®.
- **Never link to the live signage.** No link to this site's root,
  `index.html` or `countdown.html`, nor to the Journey kiosk's root. The only
  links out are the three family pages and the three GitHub repos.
- **Keep claims in step with features.** Every sentence describes current
  code. When a feature the page mentions changes, loses a default, or is
  removed, update the page in the same commit. Opt-in features carry a
  `.fam-card__tag` ("Off by default", "Opt-in"), and that tag is used for
  nothing else ("set up once" notes are a plain `.cid-setup` line). The
  pick-up board is always shown with its four safeguards, worded exactly as
  `decideBoard()` behaves.

## Season promo slides (fall 2026)

Four hardcoded promos in the lobby signage's background rotation, each a
**15 second showreel**: a full motion-design sequence that ends on its own
finished poster. Three recreate the church's printed fall posters (the
DEFEND **poster contest**, **BARF Night**, and **Parents' Night**); the
fourth is one the printer never made, the **slime cut of BARF Night**.
Owner's brief (2026-09-28): go all out, like a motion designer's showreel;
stay on-brand with each printed poster's palette and imagery; spectacle
wins over readability, but every fact lands on the end card. Signage only
(`index.html`); the projector and Journey never see them.

- `src/lib/promos.js` is the pure half: `SEASON_PROMOS` (the four
  descriptors), `nightsUntil()` / `countdownLabel()` (the live "3 club
  nights left" → "Next club night" → "Tonight!" counter) and
  `buildPromoSlot()`. The art is one file per poster under
  `src/components/promos/` (`ContestPromo`, `FriendPromo`,
  `BarfEpicPromo`, `ParentsPromo`), each with its own stylesheet in
  `src/styles/promos/` (@imported at the top of `app.css`) and its own
  test. `src/components/PromoSlide.jsx` is only the index: it maps `kind`
  to a poster, gathers each poster's exported `DETAILS` table into
  `PROMO_DETAILS`, and owns `detailsFor()`.
- **Calendar-driven, and only calendar-driven.** The counter counts real
  club nights out of the same feed the calendar slides use, through
  `calendarLogic.js`'s `clubNights()` — so a break week the shared
  schedule marks `noClub` is subtracted here too, from one copy of the
  rules rather than two. No feed means **no slot at all**, never a promo
  with a blank or guessed counter (that is also what keeps them out of
  the hermetic e2e smoke run, which boots with no calendar).
- **Self-retiring.** Each promo shows from its `showFrom` through its
  event date INCLUSIVE and is gone the next morning — the same
  `slideInWindow()` semantics as a typed slide's `showUntil`, on the
  local date key that already ticks over at midnight without a reload.
  After 2026-11-04 the slot returns null and nothing changes on screen.
- **ONE slot per pass through the deck.** Four extra slides in an
  eight-slide deck would turn the lobby TV into a poster wall, so the
  slot carries every live promo and `ManualSlideshow` shows a different
  one each lap (`step % length` is the position, `step / length` is the
  lap — both derived from one counter so `advance` stays a pure state
  updater). The slot's key stays `slide.id`, so it remounts each visit
  and every entrance animation plays from the top.
- **The hold belongs to the POSTER, not the slot.** Each descriptor
  carries its own `durationSec` (15 for all four today; `PROMO_DURATION_SEC`
  is the slot's fallback and the clock every beat sheet is written
  against, re-exported as `SHOWREEL_SEC`), `buildPromoSlot()` copies it
  onto every slot entry, and `ManualSlideshow` hands `slideDurationMs` the
  promo this lap is showing rather than the slot. `slideDurationMs` stays
  a pure function of one slide. Re-timing a poster means re-timing its
  whole beat sheet: the slideshow cuts away at exactly 15 s.
- **Nothing persisted, nothing on the wire.** Like the calendar slides,
  the slot is derived fresh from (events, today, config) on every
  render; it is never written to localStorage and never published. A
  `type: 'promo'` entry arriving in a `slides` chunk is dropped by the
  existing text-only allowlist, and `eventSanitizers.test.js` pins that.
- **Built from one kit** (`src/components/promos/kit.jsx`): `landsAt()`
  (one beat: hold, then land) and `keyframes()` (a whole choreography in
  absolute seconds, for things that arrive, leave and come back),
  `buildShake()`, the seeded `seeded()` / `splatPath()` (never
  Math.random: the art is identical on every device and in every
  screenshot), and the shared parts every poster renders exactly once:
  `PosterDepth` (`.promo-texture` + `.promo-vignette`), `Wordmark`,
  `CountdownChip` (lands at `at`, pulses at each second in `pulses`) and
  `RotatingDetail` (the one `.promo-detail-slot`). `kit.test.jsx` and the
  shared `PromoSlide.test.jsx` pin these.
- **Beats are keyframes, never `initial` plus a long `delay`.** Measured
  on the real build: framer-motion runs an accelerated value (opacity) on
  the browser's own timeline and everything else on its JS frameloop, so
  an element waiting out a long `delay` can paint at its ANIMATE value
  seconds before its beat. A keyframe list says "nothing here yet" in a
  way nothing downstream can reinterpret. Use `landsAt`/`keyframes` for
  any new beat.
- **The frozen frame is the finished poster.** Every animated element is
  `M.*`, and its LAST keyframe is its place on the end card, because
  `?lowPower=1` jumps straight there and the Pi sits on that frame.
  Anything transient (intro cards, flashes, particles, wipes, the camera
  moves, the slime cut's tidal wave) ends invisible or off-frame;
  ambient `repeat: Infinity` loops end on their resting value. Under
  zero animation `RotatingDetail` shows its LAST line at once and never
  rotates, so each poster's DETAILS table is ordered with the line the
  frozen card should carry last. Every fact a poster must state is fixed
  text on its end card, not only a turn of the detail line.
- **The beat sheets** (the component files document each in full): the
  slide mounts under the lobby director's stinger wave, so nothing lands
  before ~0.6 s, and every end card is assembled by ~11.5 s and holds.
  - **Poster contest** (navy / gold): a gallery wall of kids' posters and
    a spotlight, POSTER / CONTEST slam in, a push through the wall, the
    blank sign slapped up and taped corner by corner, a marker writes
    DEFEND (SVG stroke drawing), gold paint fills it, a confetti cannon,
    then the gold band wipes in with the deadline. Tonight a "DUE
    TONIGHT" stamp thumps onto the sign. The verse REFERENCE only (1 Peter
    3:15 NKJV) sits on the sign, never the verse text.
  - **BARF Night** (purple / lime, comic book): two comic panels ("Wanna
    come to Awana?" / "YES!!"), the kids sprint in and high-five into a
    SPLAT!, B-A-R-F tiles slam in and unfold into Bring / A / Real /
    Friend, then a match cut to the printed poster with its turning burst
    and a reward starburst.
  - **The slime cut** (deep purple / lime, movie trailer): a "THIS
    OCTOBER" cold open, a macro drop that falls and splats on the glass,
    a tidal wave that floods the screen, THE / BIGGEST slam onto the
    slime, a liquid wipe, B-A-R-F letter by letter, EVER with a
    shockwave, two plum kids high-five out of the puddle, then the lower
    third, the date and the reward line. Its splats end as faint stains,
    which is what a splat on glass looks like.
  - **Parents' Night** (cream / rust / gold, the warm one): a single rust
    line draws a parent and child holding hands and then a heart, which
    floods gold with rays and heartbeats, the ribbon header flows in,
    and the title assembles letter by letter.
    Its cream ground needs a warm vignette and a multiply grain, or the
    corners go grey.
- **Copy lives next to its art.** Each poster exports its `DETAILS`
  (`default`, `tonight`, and `afterContest` for Parents' Night; tonight
  wins), and its test pins that copy, the fixed end-card facts for every
  variant, and no em dashes. The poster faces stay the printed ones:
  every `.promo-*` rule (in `app.css` and `src/styles/promos/`) uses only
  `--promo-font-*` / `--font-poster`, never the brand tokens, and
  `src/lib/promoFonts.test.js` reads all of those stylesheets.
- **A promo poster holds check-ins** while it is up (see "The lobby
  director" below): arrivals wait behind a WAITING chip and play at full
  length on the next slide, and the stinger wave carries the lobby into and
  out of each poster. At 15 s a poster now holds the line a little longer
  than the old 8 s ones did.
- Settings → Slides → **"Fall event promos"**
  (`config.seasonPromos`) turns them off without touching the other
  auto-slides.
- Testing: vitest fake timers cannot drive framer-motion (it captured the
  real `requestAnimationFrame` at import), and Playwright's paused clock
  does not drive its opacity, so a moving frame has to be sampled in real
  time (a CDP screencast is far more accurate than repeated screenshots
  on a loaded machine). Structure and copy are tested in jsdom; the
  frozen frame is the one deterministic picture.
- **Next season means editing `SEASON_PROMOS` and the poster files
  together**. Deliberately hardcoded (owner's choice 2026-09-13), because
  the art is built on specific printed posters, not something an operator
  types a date into.

## The flagship welcome slide (first in every pass, except Wednesday club)

Owner request 2026-09-29: one built-in slide, in the catalog's flagship
"Welcome to Awana!" style, that is in the rotation and lets check-ins play
over it. `src/lib/flagship.js` is the pure half (`FLAGSHIP_SLIDE`,
`isFlagshipSlide`, `withFlagship`, `flagshipOnAir`);
`src/components/FlagshipSlide.jsx` + `src/styles/flagship.css` are the art.

- **Derived, never stored.** Like the calendar slides and the promo slot it is
  a constant added at the head of the typed deck (`withFlagship` in
  `BackgroundIframe.jsx`, manual source only), so it is not editable, cannot be
  deleted, is not in the slide editor, and is never published: the slide
  allowlist drops its type (`flagship.test.js` pins that). There is no setting
  for it. Only the clock takes it out:
- **Off the air Wednesdays 6:30-8:30 pm** (`flagshipOnAir`, local time, start
  inclusive, end exclusive; owner, 2026-09-29). `BackgroundIframe` re-asks
  every 30 s and passes a boolean to `withFlagship`, so the deck's identity
  only changes when the window opens or closes. Unit tests that build a deck
  pin the clock to a Tuesday noon; the e2e specs run on the real clock, so
  the ones that need the flagship (`flagship*.spec.js`, and every spec using
  `e2e/pastFlagship.js`) misbehave if run in that window.
- **First in every pass, once.** Operator slides, a published deck, the
  calendar's auto-slides and the promo slot all come after it. A screen with
  nothing else typed shows only the flagship (it replaced the typed-source
  "Welcome" placeholder, which now only serves the video and PowerPoint
  fallbacks, and the Wednesday window with nothing typed); a lone slide never
  advances, so it simply stays on its finished frame.
- **Never holds check-ins.** `holdsCheckIns` is false for it: names play over
  it at once, the slideshow pauses for them like for any slide, and it steps
  back (`.stage.checkin-active .flagship`, the copy's own 0.28 / 0.97) and
  forward again, and steps aside entirely for a critical notice (it is a
  `.lobby-media`). The pickup board in the foot leaves it where it is. `e2e/flagship.events.spec.js` drives all of
  that in a real browser.
- **A 10 second title sequence** (`FLAGSHIP_DURATION_SEC`, the slide's own
  hold): two clouds drift in, WELCOME and TO AWANA! assemble letter by letter
  with a spring, sparkles land, and a sheen crosses the headline once. No club
  plates, no kicker and no waves of its own (owner's calls, 2026-09-29). The
  beat sheet is at the top of the component. Same rules as the posters: every
  element is `M.*`, every beat is a `landsAt` / `keyframes` list (never
  `initial` plus a long delay), the LAST keyframe is the finished slide (that
  is what `?lowPower=1` freezes on; the sheen ends invisible), and the whole
  slide is a `role="img"` with one label so screen readers do not read 15
  letters.
- **The foot and the corner tab are the scene's own chrome.** Unlike a video
  or a poster (`chromeAway`), the flagship leaves `CatalogScene`'s orange
  corner tab and its sunflower + orange house waves at home, so it wears the
  same orange shape as every typed slide; the chrome simply stands still across
  a change into or out of it (the house wave only swells copy-to-copy, see
  `nextTransition`) (`ManualSlideshow`:
  `chromeAway={kind === 'video' || kind === 'promo'}`). It draws neither a
  tab nor waves of its own; do not add them back (they would double up).
- **Layout.** Everything stands in the 100u x 56.25u frame; the headline
  starts 19u down (clear of the corner tab and the top-right stack) and ends
  above 45u, where the lobby's content stops and the house waves begin, so the
  first-run card and the corner chips never cover it (`e2e/flagship.spec.js`
  measures that at five sizes). The headline is Paytone One in `--font-shout`
  with the kit's hard offset shadow, never a blur.
- **What it changed elsewhere.** Every deck now has one more slide, so a test
  that watches a deck from boot starts on the flagship: `App.director.test.jsx`
  plays it out first (`mountPastFlagship`) where it needs Slide A, and the
  corner tests count its load as an item (clock, then tally). Two first-run
  card tests there run first on purpose; see the comment at the top of the
  describe.

## The sound room desktop app (`desktop/`, Awana Lobby Display)

Owner request 2026-09-29: a Windows app for the sound room PC that shows the
lobby signage full screen on the lobby TV on club nights, 5:00 to 8:00 pm.
Electron, in `desktop/` with its own `package.json` (the root `npm ci` never
installs it). `desktop/README.md` is the volunteer's guide. The signage's Settings →
Setup → **Sound room app** card links the installer and that guide
(`DESKTOP_APP_DOWNLOAD_URL` / `DESKTOP_APP_GUIDE_URL` in `src/lib/constants.js`;
the installer's asset name is fixed, so the link never changes). The owner's calls:

- **The live site, not a bundled copy.** It loads
  `https://awana.kvbchurch.org/lobby/` in a
  `persist:lobby` partition, so every deploy reaches the booth by itself and
  the page's own settings, display login and service-worker cache survive
  restarts. Nothing in the page knows it is in the app: `window.self ===
  window.top`, so it is not "embedded".
- **Club nights are the signage's own** (`src/clubNight.js`, pure): a
  `noClub` date in `shared/schedule.json` never shows; a specialDates entry
  with its own `windows` is a special meeting and does; with a
  `calendar-feed.json` (it lists the whole season), a date after its last
  event is past the season and stays dark (summer), and a date it covers
  shows exactly when an uncancelled `kind: 'club'` event is on it; with no
  feed at all, the schedule's meeting day (Wednesday). The window is 17:00 inclusive to 20:00
  exclusive in the schedule's `timezone`, re-asked every minute on the
  minute, so it closes at exactly 8:00. Both files are fetched hourly and the
  last good copies kept in userData, so a dead internet at 5 pm still opens.
- **One visibility rule** (`src/visibility.js`): visible = (in the window and
  not hidden for this window) or a manual Show that has not run out. Tray Show
  lasts `MANUAL_SHOW_MS` (3 h) and is not closed at 8 pm; tray Hide (or closing
  the window) lasts until that window ends. A request to show while the
  schedule already has it up changes nothing, so a click can never turn the
  8 pm close into a manual 3 h ("already up" is judged from the schedule
  alone, `scheduledNow`, since an earlier manual Show outranks it in the
  rule). Launching the app by hand (no `--autostart`,
  which only the login item passes) counts as Show; an update's relaunch does
  not (`quietRelaunch` in state.json).
- **The remembered monitor** (`src/displays.js`, pure): matched by id + label,
  then label (two same-named monitors told apart by position and size), then
  id, then position and size; anything ambiguous is "not found", and then the
  signage opens WINDOWED on the primary screen (owner's choice) and moves to
  the TV on `display-added`. The chooser is one numbered card per monitor
  (`static/chooser.html`, a two-call preload); it opens on first run with
  more than one monitor and from the tray.
- **Sound is allowed, videos stay muted** (owner, 2026-09-29): `autoplayPolicy:
  'no-user-gesture-required'` lets the page's optional check-in chime play
  without a gesture, but the page's `<video muted>` is left alone. The cursor
  hides after 3 s still; display sleep is blocked while visible; the 5 pm open
  uses `showInactive()` so it never takes focus from the booth; the window only
  navigates within this site's path (awana.kvbchurch.org also serves Journey
  and the printer's pages); external links open in the default browser; downloads save
  straight to Downloads (`will-download`), never a Save dialog on the TV;
  localStorage is flushed before the window closes and on quit; a failed first
  load, or a 4xx/5xx answer from Pages, shows `static/offline.html` and retries
  every 30 s. The lobby session DENIES every permission but fullscreen, the
  screen wake lock, persistent storage and sanitized clipboard writes
  (Electron's default grants all silently: microphone, clipboard reads, OS
  protocol handlers from an iframe). The PC is kept awake (display-sleep
  blocker) while the lobby is up and all through a club night until 8:00 pm,
  so a PC switched on at 4:15 is still awake at 5:00. Full screen on a TV that
  is not the main monitor is topmost, so the TV's own taskbar never sits over
  the signage; closing the setup window with its X means "back to the TV",
  never Hide. The tray's **Set up
  on this screen** shows the page windowed on the primary monitor (display
  login, uploads) until "Back to the lobby TV" or the showing ends.
- **Updates** (electron-updater, GitHub provider, channel `lobby`, so the app
  reads `lobby.yml` and can never install another app's `latest.yml`):
  checked every 10 minutes, downloaded in the background and installed the
  moment the download finishes, WHATEVER is on screen (owner, 2026-10-07,
  reversing the old "only while nothing is on screen" rule: every release
  reaches the booth at once, a club night included). The screen is gone for the
  installer's few seconds and the quiet relaunch puts it back from the schedule
  and state.json; do not reintroduce an idle gate.
  The feed is this repo's ONE "Latest" release, so **no other release may
  ever be published in this repo as Latest** (create anything else as a
  prerelease or with `make_latest: false`), and the version stays plain
  X.Y.Z (a prerelease version switches electron-updater to a path that skips
  `desktop-v*` tags). Unsigned: first install needs "More info, Run anyway";
  updates install without prompts. `name` (`awana-lobby-display`) and `appId`
  (`org.kvbc.awana-lobby-display`) fix the install folder, userData and the
  upgrade identity: never rename them.
- **Releasing:** bump `desktop/package.json` (and `npm install
  --package-lock-only` there), push to main, then dispatch
  `create-desktop-release.yml` with the version (`mcp__github__actions_run_trigger`,
  ref main). It creates `desktop-vX.Y.Z` and dispatches `build-desktop.yml`
  against it (a GITHUB_TOKEN tag push fires nothing by itself): tests + lint,
  Windows build, silent install and a `--smoke-test` launch that must load
  the live page with the right version, then the release with the `.exe`,
  its blockmap and `lobby.yml`, and a check that `releases/latest` is the new
  tag. Never tag by hand; a stray release goes with `delete-desktop-release.yml`.
- **One of three screens** (owner, 2026-10-07; `src/screens.js`, pure): the
  lobby (`/lobby/index.html`), the projector (`/lobby/countdown.html`) or
  Journey (`/journey/`), one at a time, in the same `persist:lobby` profile (one
  origin, so one passphrase signs in all three). `state.settings.screen` in
  state.json; an old state.json reads as the lobby. Its window stays inside that
  screen's folder; switching replaces a screen that is up at once, on the same
  monitor. The hours stay 5:00 to 8:00 pm for all three (owner's call). The
  tray has a Screen submenu and the chooser and titles name the screen.
- **The Settings window** (the tray's Settings..., or a double-click on the
  icon): a normal window on the primary monitor. Its left column is
  `static/configure.html` (the app's own settings: screen, monitor, shutdown,
  Start with Windows; `static/configure-preload.cjs` is its whole bridge),
  360px wide under a 64px header (`CONFIG_SIDE` / `CONFIG_HEADER` in main.js,
  change both together); the rest is a `WebContentsView` in the same profile
  loading the screen's `?configure=1` page (see "Configure mode" below), so the
  screen itself is never reloaded or covered. A screen (re)opened while it is
  up never buries it (`place()` moves it back on top). Offline, the pane shows
  `static/settings-offline.html` and retries every 30 s.
- **The club-night shutdown** (`src/shutdown.js`, `src/settings.js`, pure; owner,
  2026-10-07): OFF until turned on in the Settings window, then only on a club
  night (`clubNightToday`, which still answers after the 8:00 pm close), at a
  set evening time (17:00-23:59, default 20:15). Two minutes before, a small
  dark card (`static/shutdown.html`, `card-preload.cjs`) sits in the corner of
  the PRIMARY monitor, above a full-screen screen on a one-monitor PC and on the
  booth monitor otherwise, never a dialog, with "Not tonight", which holds for
  that night (the tray and the Settings window offer the same). It is armed
  only by a minute seen before the warning, in memory, so a PC switched on,
  woken or restarted after that is left alone; an armed shutdown keeps the PC
  awake past the close. It runs `shutdown.exe /s /t 0` (no `/f`: an app with
  unsaved work may ask), only packaged on Windows; a development run logs it.
- **Gates.** The desktop tests run in `build-desktop.yml`
  (`npx vitest run --config desktop/vitest.config.js`), NOT in the website's
  deploy gate: the root vitest excludes `desktop/**`, so a desktop test can
  never block an urgent site redeploy (a lint error in desktop/ still does). The root `eslint .` does lint
  `desktop/` (its `node_modules/` and `release/` are ignored). Dev-only
  environment overrides (`AWANA_LOBBY_SITE`, `AWANA_LOBBY_NOW`,
  `AWANA_LOBBY_USERDATA`) are ignored in a packaged build.

## Configure mode (`?configure=1`, the sound room app's Settings window)

`src/lib/configureRelay.js` (owner, 2026-10-07). The desktop app's Settings
window shows a screen's own settings beside the live screen, in the same
browser profile, so everything SAVED already reaches the live screen through
the shared localStorage (useConfig, useDisplayKey, useSyncedDeck and the
projector's three device stores all take another window's change live). What
storage cannot carry, the buttons that act on the screen itself, is relayed
over one same-origin `BroadcastChannel('awana-configure')` as
`{ screen, action, data }`; the live screen obeys only its own screen's
allowlisted actions, as its own button would (a preview check-in still goes
through `simulateEvent`'s sanitizers).

- **The lobby** (`App.jsx`, `CONFIGURE`): Settings open from load on the
  configurator's paper, no Done, no gear, no Debug, no first-run card. Relayed:
  Preview a check-in, Reset tonight's counter, the pickup board demo, and
  "background video changed" (its bytes are in this profile's IndexedDB). The
  socket still feeds Settings' status, but its check-in, recap, pickup and
  notice handlers are no-ops there, and there is no sound, confetti, wake lock
  or watchdog reload. Journey's embedded copy (`isEmbedded()`) ignores relays.
  `e2e/configure.spec.js` drives both pages in one context.
- **The projector** (`presentation/App.jsx`, `views/ConfigureView.jsx`): the
  menu's items in the touch sheet's layout (the `.pj-sheet` rules sit just
  before the touch block for that reason), no wall, chimes, wake lock, Full
  screen switch or self-reload. A wall pick and Resume Schedule are relayed
  (checked by `isTarget` before the projector obeys) and mirrored on the page.
  `e2e/configure-projector.spec.js`.
- **Journey** speaks the same channel as `screen: 'journey'` (journey/CLAUDE.md).
- A new Settings button that acts on the screen itself must be relayed here too,
  or hidden in configure mode: in the configurator it would otherwise act on
  the hidden configure page.

## The check-in moment (rebrand stage 3)

Every arrival is one component, `src/components/CheckInMoment.jsx`: the
catalog's club opener page played live. The child's club wave rises and
carries the name (Paytone One, `--font-shout`, sized by measurement so it
never breaks between letters: 10.6u / 9.1u / 7.6u by length, the mockup's
Galindo steps at its cap height), the club's white mark rides the low side,
three kit doodles land last, and the one hot sticker marks a birthday or a
first-timer.
The colour is always the child's club. What differs between a welcome, a
welcome back, a first-timer, a birthday and a replayed recap is only the
kicker, the one line under the name and the sticker, all pure functions in
`src/lib/checkInMoment.js` (tests pin the wording, the ribbon rule and that
a birthday never shows a number).

- **Nobody's time is ever shortened** (owner, 2026-09-27). The queue is the
  pure reducer in `src/lib/checkInQueue.js`: every child holds for their full
  configured time (`holdMsFor`, which cannot even see the backlog). A RUN is
  one stretch with the wave up; when a hold ends and someone is waiting, the
  next child takes over in the same run (`step` + 1) with no gap and the name
  FLIPS. The old burst shrink, `BURST_FLOOR_MS` and `burstFloorMs` are gone;
  do not bring them back to "drain a backlog".
- **The gap between runs is never shorter than the run's exit**
  (`RUN_EXIT_MS`, derived from the `WAVE_EXIT` table the component also
  reads). The Overlay keys the moment on `run` with `AnimatePresence
  mode="wait"`, so a new run mounts only after the last has left; a shorter
  gap would spend the next child's hold on the previous child's exit. Under
  zero animation exits are instant and the configured gap alone applies.
- **A name's marks keep clear of the kicker and the line** (`nameBox`,
  `nameUnderKicker` in `src/lib/checkInMoment.js`). A mark on a letter under
  the kicker (measured: the kicker's width in Londrina against the name's
  letters) may rise into the kicker's margin and the empty foot of its line,
  and drops the kicker just far enough past that to stay 0.3u off its letters
  (ÉMILE under WELCOME, JOSÉ under WELCOME TO AWANA CLUBS); a mark past the
  kicker's end needs nothing. A comma below (ȘTEFAN) lifts the name off the
  line under it only when there is one. Galindo's É already touched a long
  kicker; Paytone's taller marks would have landed on it.
- **Flips cross over in place.** Per-child copy (kicker, name, line, sticker,
  mark, a new club's wave) sits in small keyed AnimatePresences; the
  outgoing copy gets `is-leaving` (via `useIsPresent`) the moment its exit
  starts and leaves the flow, so only the incoming child sizes a cell, and
  the cells above glide (`layout="position"`). Per-child copy carries its own
  club colours and sticker size, so an outgoing name never repaints in the
  next club's colours mid-exit. A newer club's wave stacks over the one it
  replaces inside an isolated layer.
- **Confetti** fires from the moment's own effect, once per LIVE child,
  timed to land with the name or out of the sticker (aimed at the sticker's
  measured centre), and cleared if the child flips away first. Bursts throw
  the kit's four-point sparkle (a canvas-confetti path shape built once with
  an explicit matrix; star fallback) and dots; season skins still win.
- The slide behind **steps back** while a name is up (`.stage.checkin-active`,
  scoped to the live background so the slide editor's thumbnails stay true),
  and the idle settings gear hides so it never sits on the club's mark.
- Testing: Playwright's `page.clock` does NOT drive framer-motion's opacity
  (it runs on the browser's own animation timeline), so frames of a moving
  animation must be sampled in real time; paused-clock screenshots are only
  meaningful under `?lowPower=1`, which is what `e2e/signage.visual.spec.js`
  uses.

## The lobby director: held slides and the corner (rebrand stage 4)

The typed slideshow and the check-in queue take turns instead of competing
(the approved mockup's rules; owner, 2026-09-27):

- **Slides that hold check-ins.** A promo poster always holds; so does any
  slide marked "Hold check-ins while this slide is up" (`holdCheckIns: true`,
  `holdsCheckIns()` in `src/lib/slides.js`). While one is up the queue starts
  no run (`hold` in `src/lib/checkInQueue.js`), a WAITING chip counts the
  line, and the celebration queue (doors-open flourish, milestone toasts)
  holds too, because a doors-open flourish names a child. When the held slide
  ends, the waiting children play as one run, each for their full time. A run
  already on screen is never cut off.
- **Names pause the slideshow.** `ManualSlideshow`'s `paused` stops the slide
  timer and KEEPS the time already spent (a video that ends meanwhile waits
  too), so a slide is never skipped or restarted by a rush.
- **A deck can never hold forever.** `special` is only reported for a deck
  that can move on to an ordinary slide (more than one slide, at least one
  not held); unmounting the slideshow reports `special: false`.
- **The stinger.** A change that involves a held slide sweeps a full-screen
  house wave over the lobby and swaps the slides while it covers; ordinary
  changes hand off instead (see the next section). It ends off-screen, so
  `?lowPower=1` never shows it.
- **`holdCheckIns` on the wire** is contract v5's optional slide field, literal
  `true` or absent, never false (printer 6.16.0 publishes it;
  `sanitizeSlidesChunk` and `sanitizeSlides` keep only `true`). Changing it
  means the printer's canonical contract-vectors.json first.
- **Corner info is ONE item at a time** (`src/lib/cornerInfo.js`,
  `useCornerItem`, `CornerChip`): the time or tonight's tally bottom-right,
  the weather top-right, as stepped chips. It moves on at each slide LOAD and
  its value is frozen until the next one (the clock does not tick). The typed
  slideshow reports loads; any other background uses a timer on the slideshow
  delay. It hides on held slides. There is no layout or interval setting any
  more (`widgetDisplayMode` / `cycleIntervalSec` are dropped as unknown keys).
- **Problem indicators are not corner info.** The status sticker (connection,
  printer failures, name faults, layer faults) shows whenever there is a
  problem, on any slide.
- **The club count** (owner, 2026-10-08): per screen, never shared
  (`config.cornerClub`, '' or a club id from `CORNER_CLUB_IDS` in
  `src/lib/clubs.js`; Settings → Screen & corner → This TV → "Club count
  (upper right)"), for a TV at one club's door. A stepped chip in the club's
  plate colour, the club's name over the count, in the top-right stack under
  the sticker, all night, from the latest `tally`'s per-club `counts`
  (`countForClub`, matched by `clubKey`, so "T&T", 'tnt' and "Truth &
  Training" are one club; since printer 7.15.0 the counts are "here now").
  Hidden until a tally has the club. It takes the top slot the weather and the
  WAITING chip share (`topTaken` in App), so they move out exactly as for a
  tall sticker: the weather leaves the rotation and the WAITING chip comes
  down to the bottom corner, and the stack keeps its 14u budget. A tall
  sticker (a fault strip) outranks it. `useConfig.js` writes the ids out
  rather than importing clubs.js (the projector imports useConfig, and
  clubs.js brings every club's art); `useConfig.test.js` pins the two.
  `clubs.test.js` (`clubKey`, `countForClub`), `App.overlays.test.jsx` and
  `e2e/pickup-board.spec.js` ("the club count, top right") pin the rest.

## The lobby scene and the slide frame (rebrand stage 4b)

Everything behind the check-in moment is one scene, `src/components/CatalogScene.jsx`,
and one copy frame on it, `src/components/SlideCopy.jsx`: the idle placeholder,
typed slides and calendar slides all use both, and so do the slide editor's
thumbnails (`still`, at `--lobby-u: 16px` in the 1600x900 frame, so a
thumbnail is the TV at 0.15 scale and fits the same way).

- **One persistent studio, only the copy changes.** The field (flat colour,
  two tone-on-tone clouds, white kit doodles, CSS ambient loops that end at
  rest) and the chrome (the orange corner tab with the Awana Clubs mark, the
  sunflower and orange house waves) never remount on a slide change. The
  field crossfades only when two slides want different themes; seasonal skins
  still dress the idle scene (`sceneForSkin` picks its theme, and
  `.stage[data-skin]` prints the season's two offsets behind the idle
  headline). Colours come from `LOBBY_THEMES` in `src/lib/lobbyFrame.js`.
- **An ordinary change is a copy-only hand-off** (`src/lib/lobbyMotion.js`):
  the outgoing kicker, words and chip lift away one after another, the orange
  house wave swells once, then the next kicker, words and chip land, about a
  second end to end. The swell is keyed by a hand-off count and its keyframes
  stay on the wave while the count stands: framer-motion replays a target that
  goes and comes back. A change into or out of a held slide keeps the stinger,
  and everything under it (copy, field, media, chrome) changes in one frame at
  `SWAP_AT` while the wave covers the screen.
- **The chrome steps aside for a poster or a video.** Under the stinger it is
  hidden and brought back by OPACITY at the swap (`chromeMove`), never by a
  transform alone: the app honours the OS's reduced motion, and framer-motion
  then makes every transform instant, delay and all, while opacity keyframes
  still hold, then land, on time. A video that comes or goes on an ordinary
  change slides the tab up and the waves down on the wipe curve.
- **Keyframes, not delays.** Every beat is one "hold, then land" keyframe list
  (`holdThenLand` / `holdThenLeave` / `vanishAtSwap`), never `initial` plus a
  long `delay` (a delayed opacity paints its target early), and the last
  keyframe is always the resting design, which is what `?lowPower=1` shows.
- **The fit (`fitFrame`) measures words in the faces that draw them** and
  never lets the block leave the safe box (u = 1% of the 16:9 stage). Shout
  (uppercase Paytone One, `--font-shout`, hard offset shadow): up to three
  lines of at most 68u from 7.6u down to 6.3u, then up to two lines of 84u
  down to 5.3u, rows .93em apart; `lg` caps it at 6.1u. Those are the
  mockup's Galindo tiers (7.2 / 6 / 5 / 5.8u at .98) times 1.057, holding its
  cap heights and row pitch; the measure and the box keep their numbers,
  since Paytone runs ~5% narrower per cap on most words. A row whose marks
  would meet the row above, the kicker or the chip gets exactly the room they
  need (`shoutBox`: `rise` per row, set as a top margin on that row's words,
  so the other rows keep their pitch; `padBottom` under the last), and the fit
  counts it. `md` always reads, and so does any headline in a script that
  stacks marks above and below its letters (Thai, Lao, Khmer, Myanmar,
  Tibetan and the Brahmic scripts, Devanagari included:
  `STACKED`), whose marks reach into the next row at a caps line height.
  That holds even in Baloo 2, which draws Devanagari: the u-matra of "प्रभु"
  ran 0.17em into the i-matra over "स्तुति" on the row below.
  `lobbyFrame.test.js` has one sample per script, so dropping any from the
  rule fails.
  Otherwise read (sentence-case Figtree in the theme's reading ink): balanced
  rows of at most 76u from 4.2u down to 1.5u, at a line height of 1.22. The
  block starts at 15.1u and rises only as far as 11u, and a
  row wider than 45u stops at 14u, clear of the corner tab and the top-right
  stack (which is rem-sized and reaches 13.2u at 1280x720); nothing passes
  45u, clear of the house waves and the bottom chip. Lines break only between
  tokens: words, and the words `Intl.Segmenter` finds in Chinese, Japanese and
  Thai (joined with nothing). The operator's line breaks are kept down to
  1.5u, then run on separated by " · ". A word wider than any line keeps a
  readable size (at least 2.4u) and is cut across rows of its own inside 76u,
  and the page draws the fit's own pieces, split by `<br>`: left to wrap it
  itself, Chromium broke a URL after every hyphen and drew rows the fit never
  counted, down behind the waves. So every row on screen is a row the fit
  counted (the headline's `data-rows`; `e2e/lobby-fit.spec.js` pins both). A
  kicker wraps to two lines before it shrinks below 1.6u and never runs wider
  than 84u. Copy takes its direction from its text (`dir="auto"`); and since
  the bidi algorithm sees each word's box as one neutral object, every run of
  two or more words against the headline's direction (a Hebrew phrase in
  English, English in Hebrew) sits in a `<bdi dir>` of its own
  (`bidiIsolates`), or its words would read in reverse order. The
  punctuation at the run's two edges (quotes, a comma, a closing "!", the
  run-on list's " · ") is drawn outside the `<bdi>` in a `.lobby-punct` box
  on its word's beat, because plain text gives it the headline's direction:
  inside, "Say שלום, friends!" put its comma before the Hebrew. A run of one
  word gets no `<bdi>`: its own box, in the headline's direction, already
  lays it out as plain text would ("ל-Awana", "Awana!" in Arabic). The e2e
  order tests compare each drawn row with the same row set as plain text.
  Still not plain text's: punctuation between two words of a run where a row
  breaks between them stays on the run's side, and Arabic-Indic digits in a
  left-to-right headline keep their typed order.
- **A refit never replays.** Every headline token is one element in both
  layouts, keyed by its place, and the beat sheet is fixed when the copy first
  appears, so a web font landing late only re-lays the same elements out. The
  `<bdi>` runs come from the words alone, so a refit never moves a word into
  or out of one. What a run leaves outside it does depend on the fit: the
  run-on list's " · " is there only once the lines are joined, and a word too
  wide for any line keeps its own edge punctuation (it is a block of rows of
  its own, and a piece after it would start a row the fit never counted). So
  every run has both its `.lobby-punct` edge boxes in every fit, and a refit
  only changes their text; an empty one is `display: inline`, which adds
  nothing to its row and no row of its own. Mounted by a refit instead, a box
  landed all over again (`lobbyWiring.test.jsx` pins both cases). The rule
  for anything new here: an element that can exist in any fit exists in
  every fit, and only its content follows the fit.
- **The calendar's `frame` field is local-only.** `buildCalendarSlides` adds
  `frame` (headline, sub, date chip) for the lobby; `sanitizeSlides` and the
  wire contract never accept it, so a published or typed slide can never
  carry one. Its wording is the calendar's, unchanged.

## The lobby's overlays (rebrand stage 4b-2)

Everything that sits on the lobby wears the kit, so the screen reads as one
catalog page. Two shapes carry it all:

- **The stepped chip.** `StepChip` for one value ("UP NEXT / +3", the corner
  chips; `icon` puts the weather's sky doodle, `WeatherGlyph`, at the head of
  the value block), and **`StepPlate`** (`src/components/brand/`) for content
  of any size: the same silhouette measured off the real label and body boxes
  (`plateOutline` in `src/lib/brand.js`, redrawn by a ResizeObserver, never
  per frame). The status sticker (`StickerChip`), the notices and the
  milestone toasts are StepPlates. `.step-plate__echo` is a hidden copy of the
  plate that a skinned night paints in `--skin-a`.
- **The white kit card** (the printer dashboard's): the pickup board with its
  house-blue tab (the kit's wavy tab on its one-line card) and club-colour
  name chips, and the first-run setup card.

Where things go is one table, `OVERLAY` in `src/lib/overlayFit.js`, measured
against the corner tab, the top-right stack, the copy's `LAYOUT` and the
house waves, and who holds which part of the room is one pure function,
`lobbyRoom()` beside it (App renders its answer; `overlayFit.test.js` and
`App.overlays.test.jsx` pin it):

- **The top band** (50u wide, centred, from 1.4u down to 10.4u, above the
  highest the copy can rise) holds a band notice (info / warn) and the
  milestone toasts, ONE at a time: a toast borrows the band and the notice
  lifts out of its way (`yielding`); the toast waits out the notice's exit
  before it lands (`afterNotice`) and the notice waits out the toast's exit
  before it comes back, so the two are never in the band together. A band
  notice steps aside the same way for a promo poster (`poster` from
  ManualSlideshow's onSlide). Every plate in the band is fitted to END by
  10.4u (`bandRoom`), flag strip or not.
- **The flag strip** hangs from the top edge above it: the demo, rehearsal
  and simplified-mode tabs, kept to 54u between the corner tab and the stack
  (all three at once set tighter, `.top-flags--tight`); while one hangs the
  band starts under it (`.stage.has-flags`, `bandTop`).
- **The centre** (12u to 46u of the 16:9 box) is taken over by a critical
  notice, and only by it. The slide copy steps fully aside behind it
  (`.stage.notice-takeover`), and so does a poster or a video (`.lobby-media`),
  as it steps back for a name. Until 2026-10-07 the pickup list took it too.
- **The foot is the pickup board's** (owner, 2026-10-07: "The still remaining
  kids list should just take the bottom of the screen. It shouldn't take over
  all of the announcements."). `boardPlacement(state)` is `'foot'` for every
  state the board shows, never the centre (the name is `'foot'`, not `'band'`,
  because `'band'` is the top band's). `OVERLAY.foot` is the same object as
  `OVERLAY.setup`: the strip under the copy's lowest line (45u down the 16:9
  frame, `calc(50% + 16.875u)`, so a 4:3 screen's extra height is the
  strip's) to the corner chip's line 1.8u off the bottom, from a 1.2u gap past
  the gear to 19.2u from the right (a gap short of the corner chip), at most
  80u wide. The slides above it carry on as normal: no step-back, a critical
  notice keeps the middle, celebrations are never held for it, the tonight
  strip steps away while it is up, and the first-run card yields its seat to
  it. A names list fills the strip: a house-blue tab at the left end with the
  title over the whole count line, then every club's plate (white mark or
  name, "N waiting") followed by its name chips, one run wrapping across the
  strip. `fitFoot` (overlayFit.js) sizes the chips to the run's MEASURED box
  (CheckoutBoard's ResizeObserver; jsdom falls back to the 1080p box in u):
  at most two rows of the largest chips, never smaller than a twelfth of the
  run's height nor `FOOT_FLOOR_PX` (10px) on a real screen (`footRange`; the
  Settings preview, a TV in miniature, has no px floor). Where even that
  cannot hold everyone, the longest club's last names go behind a "+N more"
  chip, one at a time, until it fits; every plate still counts all its
  children and the count line says the total. Measured with real fonts: the
  60-entry cap of ordinary names all shows at 1920x1080 (~15.5px chips) and
  1280x720 (~10.3px); the Pi's 640x480 run is ~310x110px, so a long list
  there is mostly "+N more" (about 13 of 40 names show). A stale or empty
  board, or the anonymous line, is a one-line card on the strip's floor. A
  stale board is never allowed to blank the lobby, and a visible board still
  counts as busy for the self-updater. `e2e/pickup-board.spec.js` measures the
  strip against the copy's drawn rows, the gear and the corner chip, every
  plate and chip against the run, and the 60-entry cap at 1080p, 720p and
  640x480; `overlayFit.test.js` proves the cap on the model at four sizes.
- **The first-run card has the foot too** (`OVERLAY.setup`, `setupUp()`,
  `.panel.setup-card`; live smoke check 2026-09-29: it hid the start
  of a long calendar title at 720p and the chip row at 1080p). A corner is
  never free on the lobby: parked above the gear it was 25u square, inside the copy's own
  box at every size. It is a strip now, in the one zone nothing on a slide
  reaches: under the copy's lowest line (45u, `LAYOUT.safeBottom`), from a
  gap past the gear to a gap short of the corner chip (~82u), on the chip's
  own line 1.8u off the bottom, its words in columns (heading and buttons on
  one row, the two steps side by side) so it fits the ~11u that leaves at a
  12px floor: 102px of the 121px there is at 1280x720. Keep it that way: a
  taller card, or one moved above the strip, is the bug again. It yields, by
  the pure `setupUp(...)` (given lobbyRoom's answer), to whatever legitimately
  holds that part of the room: a name (the check-in wave rises through it), a
  held poster or slide (the chrome steps aside for those), an open panel,
  the pickup board or a "has checked out" banner (its own seat), the tonight strip while it has
  counts to show (content over instructions: the strip is what the room is
  looking at, and the debug panel's "Show tonight ticker" must work on a
  fresh screen) and a critical notice in the middle. App keeps the strip's
  30 s clock and hands it to `TonightTicker` (`now`), so the two agree the
  moment the feed goes stale. Whether the screen still wants the card
  (`useSetupCard`: unconfigured, not dismissed) is separate from whether the
  room has space for it, so App can ask both. `e2e/setup-card.spec.js`
  measures every drawn box of copy and chrome against the card at five sizes.
  **It is judged by what the ROOM sees, not by the flags that lead it**
  (review of the first fix, 2026-09-29; both pinned by
  `e2e/setup-card.events.spec.js`, which samples real frames):
  - *A name is up until its run has left, and a quiet beat after.*
    `currentEvent` goes null the moment a hold ends, but the run is still
    leaving for `RUN_EXIT_MS` and the next may be a second away; judged by it
    alone the white card came back over "WELCOME NOAH" and the club's mark as
    they left, and popped in and out between children a few seconds apart. So
    App asks `useLinger(currentEvent != null || gap, SETUP_CARD_QUIET_MS)`:
    the child on screen, the gap (`useCheckInQueue` returns it; it is never
    shorter than the exit), then 5 s more before the card returns.
  - *A held slide is up until its stinger has cleared.* `checkInsHeld` drops
    the moment the slideshow moves on, while the poster is on screen until the
    wave covers the screen (`SWAP_AT`) and the wave itself until it has gone
    (`STINGER_SEC`). The falling edge lingers `STINGER_SEC` (`useLinger`, zero
    under zero animation, where there is no wave); the rising edge is
    immediate. And `ManualSlideshow` reports `onSlide` from a LAYOUT effect, so
    App learns a held slide is up in the commit that mounts it: passive, the
    report landed a frame or more late, which under `?lowPower=1` on a weak Pi
    left the card drawn over a poster already swapped in.
  - `useLinger(flag, ms)` starts its linger in the render the flag falls in
    (React's adjust-state-during-render), never from an effect, or one
    committed frame would have the flag off and the linger not yet on.
- **When two meet.** A critical notice and the pickup board never meet (the
  centre ends ~6u above the strip), so a notice keeps the middle over the list
  and nothing holds the celebrations for the board (the old `holdCelebrations`
  and the toast's `yielding` are gone). On an OBS overlay feed a critical
  notice always keeps to the band, and a toast drops below it
  (`milestone-toast--below`). The takeover class and the banner
  judge a notice on ONE clock: App's `noticeNow`, handed to NoticeBanner as
  `now` (`noticeShowing`), never the board's ticker, which a checkout
  payload re-stamps.
- **The top-right stack must end by 14u**, where a raised wide row starts.
  The status sticker's height is measured (`useTallerThan`); while it stands
  taller than `OVERLAY.stack.stickerMax` (a fault strip, or the retry wording
  beside the printer's count) the weather sits out of the corner rotation and
  the WAITING chip comes down to the bottom corner. Embedded in the Journey
  kiosk none of this moves: the host keeps its buttons out of the top-right
  (see "Embedded, the bottom-right corner belongs to the host").
- The ticker is house-blue count chips on the waves, between the gear and the
  corner chip (its four counts are the room's, so not club colours); "+N more
  coming" (`UpNextChip`) rides the club's wave above its mark, so it is only
  up while a run is on screen, and on a run's first child it lands once the
  wave has risen (`WAVE_UP_SEC`, from `FRONT_WAVE_DELAY`).

Every size is fitted by measurement (`fitShout`, `fitParagraph` with
`balanceLines`, `fitFoot`), so a 40-character name, a 200-character notice or
a 60-name board steps down inside its band rather than spilling onto the
headline, and plates hug their text. `fitShout` takes the most balanced
two-line split and says `fits: false` when even `twoLineMin` is too wide; the
toast then lets that line wrap inside the band. The toast and the board's name
chips also measure their line's ink, so a mark stays on its plate or pill
(`toastBox`, `nameChipSeat`: "Marks never touch" above). The label size of every plate
(`--plate-label`) is set by the overlay that owns it and never declared on
`.step-plate` itself, which would pin every label to 1rem. StepPlate redraws
its outline inside the ResizeObserver callback with `flushSync`, so a
resize never paints a frame of words off the old plate. Toast plates: a
club's own milestone wears the club's colour and wordmark (and keeps them on
a skinned night); the room's attendance is hot; handbook progress is Awana
blue. The sparkle particles throw the kit's doodles; snow and rain keep their
shapes, flat. Every loop here ends at rest, and the weather glyph is frozen
with the corner snapshot (`glyph`), like the words beside it; each of its
looping SVG groups starts from an `initial` holding its transform keys,
because framer-motion measures an SVG element's box only at mount and drops
every transform frame on a group that did not start with one.

## Soft squish (the jelly motion)

Owner request 2026-09-30: "jelly inspired animations on transitions and
button pushes", a SOFT squish (squash and stretch, a small wobble, then rest)
on the lobby's slide changes (the kicker, a shouted headline's words, the date
chip; the flagship's letters too), check-in names, the chips, toasts and
notices, and the operator's buttons and panels. The promo posters stay exactly
as they are. The projector is a later, separate change.

- **One physics, one module.** Jelly UI's own scale spring (stiffness 260,
  damping 17, mass 1: `E(this.scale, this.scaleVelocity, 1, 260, 17, t)` in
  `public/vendor/jelly-ui.js`, which `squish.test.js` greps for, so a vendor
  refresh that retunes it is noticed): zeta ~0.527, extremes 229 ms apart, each
  keeping 14.2% of the last. `src/lib/squish.js` derives both halves from it
  and imports NOTHING, so the projector can take a verbatim copy pinned equal
  by a test (it may not import the signage's modules). The code word is
  `squish` and the CSS properties are `--squish-*`, never `--jelly-*` (Jelly
  UI's own tokens under `<jelly-theme>`) and never `--dur-*` / `--ease-*`.
- **The M half: `squishLand(at, kind, dur, curve)`** is a scaleX / scaleY
  keyframe list: hold at 1 until `at` (a keyframe, never a `delay`), stretch
  along the travel, squash where the curve arrives (`IMPACT`: settle 30%, wipe
  76%, pop at its overshoot's peak, 57%), ring down on the spring's peaks, and
  a LAST keyframe of exactly 1 on both axes (the frame `?lowPower=1` and the
  visual baselines show: `transform: none`). A pop-curve piece never stretches:
  its own `scale` already overshoots. `withSquish(beat, squish)` composes it
  onto either shape framer-motion takes here (`{ initial, animate, transition }`
  or a target with its own nested transition) through `transition.scaleX` /
  `transition.scaleY` ONLY, so every existing keyframe list and the top-level
  timing stay byte for byte (framer-motion reads `transition[key]` first); it
  is the identity for null and refuses a target with no transition of its own
  (the squish's would re-time every other value).
- **Readability caps live in `DEPTH` / `BULGE`**: a name never squashes below
  0.93, a headline word's bulge never passes 3%, the kicker is a whisper, a
  figure (a count) and a wave move scaleY only. scaleX answers at half the
  squash, less than volume-preserving on purpose, so letters never touch.
  **The caps are on what is DRAWN**, which is the entrance's own uniform
  `scale` times the squish's scaleY. A name's letters grow from 0.7 / 0.85 and
  a shouted word from 0.85, so a squash at the settle curve's 30% stacked with
  them (a name at 0.896 of its height, fully opaque; words at 0.923). Those
  two squash AT ARRIVAL instead (`ARRIVAL` in `squish.js`, passed as the
  `curve`: impact at the very end of the run, where scale is exactly 1, so the
  drawn height is the squish's own and never under the cap). They are built
  by `letterEnter()` / `wordLanding()` in `lobbyMotion.js` (with
  `LETTER_FROM` / `WORD_FROM`), not in the components, because
  `squish.test.js` samples the COMPOSED scale x scaleY from those exact
  beats. Any new squish on a piece whose entrance also grows it does the same.
- **Rules a new squish keeps** (each is a way it went wrong in review):
  - Its keyframes come from the beat sheet alone (SlideCopy's frozen `landing`
    mode and `beat.at`), never from the fit: a late web font refits the words,
    and a changed array is a new target that framer-motion replays.
  - Anything that survives a re-render with the same key is frozen at mount:
    the check-in kicker is keyed on its WORDS, so it stays up through a flip
    whose next child reads the same while its `delay` changes; the name's beat
    sheet per child; each ticker pill (a row turning up later shifts the
    others' places). `delay` alone never re-targeted; a keyframe hold does.
  - Never on a `layout="position"` element (the check-in cells: framer-motion
    resets and folds the dirty node's transform to measure) and never on
    anything read with `getBoundingClientRect` while it could squash (the
    sticker slot `stickerOrigin()` aims the confetti from; the club mark the
    with-motion T&T e2e measures): squish the element inside instead.
  - Transforms only (never width, padding or font size: StepPlate's
    ResizeObserver would redraw every frame); exits are untouched.
  - Not squished, on purpose: read text (a read headline, the supporting
    line, the check-in line), a critical notice (its targets are exactly the
    pre-squish ones), the pickup board, and anything carrying official art out
    of proportion (the club mark, the Awana Clubs mark, a toast that carries a
    club's wordmark). The waves stay as they were: squashing a check-in wave
    would dip the colour from under the name.
  - Type squashes onto its baseline, not its middle (where it seems to float):
    the headline and the name set `--squish-baseline` inline from
    `shoutBaseline(lineHeight)` (`SHOUT_BOX`), and the flagship letter's origin
    is the same number at its 0.9 line height (`FlagshipSlide.test.jsx`).
  - The flagship composes `withSquish` onto `landsAt()`'s output; the promo
    kit (`kit.jsx`), which the five posters share, is never edited for it.
- **Zero animation and reduced motion.** Under `?lowPower=1` M replaces the
  transition prop and strips nested ones, so a squish lands on its last
  keyframe at once; under the OS's reduced motion framer-motion makes scaleX /
  scaleY instant (they are in its `positionalKeys`) while opacity still holds,
  then lands. `zeroAnimation.test.jsx` renders squished pieces through the
  real framer-motion.
- **The CSS half: operator presses** (app.css, "The soft squish: operator
  presses"). A control squashes onto its ledge on `:active` in
  `--squish-press` (100 ms) and sinks 2px, then springs back over
  `--squish-release` (750 ms) on `releaseEasing()`, the spring's step
  response as a `linear()`. Transitions, never `@keyframes`: a transition
  never fires on mount, so a panel opening on a checked or focused control
  never wobbles it. The individual `scale` / `translate` only, never
  `transform` (April Fools owns it, and turns the gear, the backdrop, the
  debug panel and the first-run card about their origin, which stays put).
  The `linear()` is written out LITERALLY, right after the same declaration
  with a `cubic-bezier` (the kit's pop) in its place: behind `var()`, an
  easing a browser cannot read leaves the property unset instead of falling
  back. Softer or firmer amounts per control (the gear, a tab, a debug tile,
  the checkbox) are `--squish-*` tokens on `:root`; `squishCss.test.js` pins
  every token and every `linear()` string to `PRESS` / `releaseEasing()`. The
  kit checkbox's check springs in and goes out on the exit curve: any
  overshoot past 0 is a negative scale, a mirrored check.
  **A held press keeps its hit area.** Squashed about its foot, a pill's top
  edge drops 4-6px, so a press that began in that band and was held past the
  100 ms squash came up OUTSIDE the box and the click went to the ancestor.
  Under `:active` an `::after` strip (12px, `bottom: 100%`) stands on the
  control's top edge and belongs to it. It is positioned against the control
  because `scale` already makes the control a containing block, so no
  `position` is ever set on it, and every kill switch (reduced motion, zero
  animation) sets its `content: none` with the squash, since without a scale
  it would anchor to an ancestor. Pills, radio options, debug tiles; the gear
  (round, mostly rotated, own `::before`) and the checkbox are covered by their
  own box. `e2e/panels.spec.js` holds a press at +1..+8px past the squash and
  expects the control to get the click.
- **Panels enter, and never exit.** Settings, the slide editor and the debug
  panel (`panel-enter`) rise a little stretched and spring home on the same
  easing. Closing stays an instant unmount: the visual suite closes the debug
  panel under a paused clock, the Settings / editor / debug hand-offs happen
  in one commit (an exit would stack two scrims), and `settingsOpen` is the
  self-updater's busy flag. The first-run card has no motion of its own at
  all (only its buttons' press): it must be there, whole, on the very first
  frame (`e2e/setup-card.spec.js` counts its animations) and leave in the
  commit that mounts a name (`setup-card.events.spec.js`).
- **Both kill switches keep today's flat, instant 2px sink.** The blanket rule
  stops the spring but not the squash, so every press rule has a `scale: none`
  twin prefixed `.zero-animation-mode` (one class deeper, so it always wins),
  and another in the `prefers-reduced-motion` block written with the press's
  own selector (the `:not(:disabled)` included, or it loses on specificity).
  `zeroAnimationCss.test.js` fails a press without both, and any rule that
  moves the turned surfaces' `transform-origin`; `e2e/panels.spec.js` holds a
  real button in each mode.
- **Jelly UI's Save button** gates its canvas physics on the OS's reduced
  motion only, never on this app's zero animation, so under
  `ZeroAnimationContext` Settings renders Done as the kit's plain
  `button.primary`; the embedded panel spec's locator takes either.
- Wiring is pinned in `lobbyWiring.test.jsx` ("the soft squish", "the
  check-in moment's squish", "the overlays' squish", as wired), next to the
  keyframes the squish composes onto.

## The Settings panel (two panes, live apply)

Owner request 2026-10-01: Settings "looks bad on desktop and mobile"; rebuilt
for usability. `src/components/SettingsPanel.jsx` is the shell (the form,
live apply, the rail, Undo / Done); `src/components/settings/sections.jsx`
holds the eight sections and `settings/fields.jsx` the rows, cards and the
fields with their own storage (login, display key, publish token, uploads);
`src/lib/settingsSections.js` is the pure half (the section table, the old
tab ids, which section it opens on, the phase in plain words).

- **Eight sections, everyday first:** Status, Check-ins, Slides, Screen &
  corner, Celebrations, Pickup board, Look & season, Setup. The rail is a
  vertical tablist (Up/Down, Left/Right, Home, End); each item's accessible
  name is its label alone, the blurb is its description. Old tab ids
  (`connection`, `background`, `banners`, `display`, `calendar`) still resolve
  (`LEGACY_TABS`), so a caller or old copy lands on the right section.
- **It opens where the volunteer needs to be** (`openingSection`): an explicit
  request (the first-run card asks for `setup`, the slide editor returns to
  `slides`), else Setup when the screen cannot work yet (no Pusher app, or no
  key), else Status when anything is wrong (the rail counts it), else
  Check-ins. App passes `initialTab: null` from the gear and Ctrl+Shift+S.
- **Live apply, Undo and Done (no Save, no Cancel).** A box, radio or menu
  applies the moment it changes; a typed field applies when it loses focus or
  on Enter (one focusout listener on the pane), so a half-typed number never
  reaches the TV. Every apply diffs the clamped form against what was last
  written, so only a touched key is ever written (a baked key or a `?config=`
  value is never pinned). **Undo changes** hands `replaceConfig` (useConfig)
  the device's override layer exactly as it was on opening, never the old
  values merged back. Done, Escape and the backdrop flush a field still being
  typed in and close; nothing asks, because nothing is ever unsaved. Preview,
  Edit slides and the Debug panel flush first too. Simplified mode is a switch
  outside the form, read live from `savedConfig`, like Ctrl+Shift+X. The
  login, keys and uploaded files keep their own storage and are never undone.
- **Durations are typed in seconds** and stored in ms (the keys and their
  clamps are unchanged).
- **Status replaces the old header band**: connection and login, tonight in
  plain words (`PHASE_WORDS`), the calendar line, the published deck, every
  problem worded by fix, the build and the trademark line. The header keeps
  only a short status pill.
- **Layout:** `.panel--settings` (the slide editor also wears `.panel--tabbed`,
  which is unchanged, so restyle only the modifier). Below 720px wide or 480px
  tall the dialog's `data-view` switches between the list and one section with
  "All settings" back (focus moves with it). Focus starts on the selected rail
  item, Tab stays inside the dialog, and focus goes back on closing. Embedded,
  the `html.embedded .panel--tabbed` cap still applies. `e2e/settings.spec.js`
  checks the panes at three sizes and the phone flow; `e2e/panels.spec.js`
  presses Undo (a plain panel button) for the squish tests.
- Copy elsewhere names sections as `Settings → Setup`, `Settings → Slides`,
  `Settings → Screen & corner`: rename a section and grep for its name.

## Shared settings across screens (contract v6)

Owner, 2026-10-01: "Settings changes should apply on all devices also",
except each screen's hardware and location. `src/lib/sharedSettings.js` is the
one table of SHARED keys (`SHARED_SPEC`, rule for rule the printer's
`SETTINGS_SPEC` and the contract's `events.settings.keys`;
`sharedSettings.test.js` fails if they drift). Everything else is per-screen:
what plays behind the names (and its uploads), this TV's chime, motion,
confetti, wake lock and connection sticker, simplified mode, the Pusher keys,
`followPublishedSlides` / `followSharedSettings`, the fleet URLs.

- **The path is the slide deck's.** Settings, live-applying a shared change,
  calls App's `shareSettings` with this screen's whole shared set
  (`pickShared`): it lands in the store's shared layer at once
  (`setSharedLocally`, marked `local`), and `SHARE_DEBOUNCE_MS` after the last
  change `publishSettings()` POSTs it to `http://localhost:3456/api/display-settings`
  with the publish token. The print server (6.20.0+) sanitizes, stamps, persists
  and broadcasts one sealed `settings` frame, rebroadcast every 5 minutes; every
  screen opens it like `slides` (`settings` is in `ENCRYPTED_EVENTS`, on the
  `slides` pad ladder) and `receiveSharedSettings()` commits it iff its
  `publishedAt` is strictly newer than the one held. **Only the check-in
  computer can publish**: an https page may call `http://localhost` but not a
  LAN address (mixed content), so the owner's "any screen via a LAN address"
  was not buildable. Elsewhere the change stays on that screen, Settings says
  so (footer, and Setup → Shared settings), and the next newer publish
  replaces it.
- **The shared layer beats this device's own values for the shared keys**
  (`resolveStoredConfig(remote, device, shared)`), only while
  `followSharedSettings` is on, and through `VALIDATORS` too, so a value this
  build does not know is dropped. It lives in its own `awanaSharedSettings.v1`
  entry: never an override, so Export, `?config=` and Reset this screen do not
  see it, and Undo republishes the opening shared values (`replaceConfig`
  restores only the device layer).
- **Settings says where each setting applies**: every card's head carries an
  "Every screen" or "This screen" tag (`PanelCard`'s `scope`; a shared card on
  a screen that does not follow reads "This screen"). A new setting goes in
  `SHARED_SPEC` (and the printer's table, the contract vectors and the
  printer first) or it stays per-screen; there is no third place.
- **Retired keys** (`RETIRED_SHARED`): `checkoutBoardMode`, `checkoutBoardFrom`
  and `checkoutBoardUntil` left the app on 2026-10-08 (the board comes on by
  itself) but are still in the printer's contract vectors, so `SHARED_SPEC`
  keeps them and a frame carrying them is accepted; they are not config keys,
  so `VALIDATORS` drops them when the shared layer resolves, and `pickShared`
  never publishes them. Retire them from the contract (printer first) and
  they leave here too.
- `App.sharedSettings.test.jsx` drives it end to end: a frame sets the pickup
  board's naming guard and cannot smuggle a per-screen key, a non-following screen ignores
  it, and a shared change in Settings reaches the print server's URL with the
  token.

## The sync service (`worker/`, one passphrase for everything)

Owner, 2026-10-01: "type kennebec and have it sync everything up", without the
check-in laptop on. A Cloudflare Worker with ONE Durable Object
(`worker/src/sync.js` is all the behaviour, `index.js` only wiring) is the home
of the shared settings, the published deck, the "new screen" template,
Journey's room settings and the church calendar. `worker/README.md` is the
setup guide and the API. The owner's calls:

- **Anyone with the passphrase may read and change everything** (choice B).
  So the word is the one lock, and it is checked ONLINE only, with guess limits
  (`IP_MAX_FAILS` / `GLOBAL_MAX_FAILS`); the service stores a salted HMAC.
  `INITIAL_PASSPHRASE` (GitHub secret `SYNC_PASSPHRASE`) counts only the first
  time; changing it (Settings → Setup) needs the current word, signs every
  screen out and replaces the display key.
- **The Worker is the one home** (choice A): signed in, Settings and the slide
  editor publish to it (`publishViaSync`), it seals the same `settings` /
  `slides` frames (contract v5 / v6) and publishes them with the Pusher REST
  API. Check-ins never pass through it.
- **Found by `shared/sync.json`** (`{url}`), written when the Worker was first
  deployed (today the root `ci.yml` deploys it, only when its sources changed,
  because every deploy restarts the Durable Object and drops every screen's
  socket). `url: ""` means no service yet: every screen keeps the
  print server's display login exactly as before (the Setup card and the
  projector's menu switch on `useSync().url`).
- **The session is a secret** in its own slot (`awanaSyncSession.v1`), like the
  display key: never config, an export or a URL (`syncService.test.js`).
- **Nothing it returns is trusted as-is.** `/v1/state` is turned into a
  `settings` payload and a one-chunk `slides` payload (`wirePayloads`) and goes
  through `dispatchEvent`, the same sanitizers as a Pusher frame
  (`useSyncDriver` in App). The template passes `sanitizeTemplate`, the
  calendar `sanitizeFeed`. `src/lib/syncSpecs.js` (the template and Journey
  allowlists) is shared byte for byte with the Worker, which imports it.
- **The template** (`TEMPLATE_SPEC`, per-screen keys only, never Pusher keys,
  panic mode or secrets) is applied at sign-in only to keys the screen has no
  override for (`templatePatch`), so signing an existing screen in never undoes
  a choice made on it. Settings → Setup → "Use this screen as the template".
- **Staying in sync:** a signed-in screen fetches `/v1/state` at start, every
  `SYNC_POLL_MS` and on `online`; a 401 means the word changed (phase
  `expired`, the session is dropped, names keep working on the old key until the
  laptop seals with the new one). The doorbell `changed` `{what}` on
  `awana-sync` (bound in `useSocket.js` beside `provision`, never through
  dispatchEvent) refetches the template or the calendar.
- **The calendar** (`useCalendar` source `sync`, first in line): the Worker reads
  the church page itself (linkedom + the same `calendarParse.js`), every six
  hours and on "Refresh calendar now", which now says what happened. Not signed
  in, Refresh re-reads the copies the screen can reach and says so. That button
  used to re-fetch `calendar-feed.json`, which only changes when the nightly
  Action runs, so it never visibly did anything.
- **The projector** gets it through `useDisplayLogin`, which signs in through
  the Worker when one exists (`template: false`) and reports it in the old
  words, so `QuickNav` and the setup note barely changed and the isolation
  allowlist did not grow.
- **Gates:** the Worker's tests run in `ci.yml`'s `worker` job
  (`npx vitest run --config worker/vitest.config.js`), not this app's vitest
  (the root vitest excludes `worker/**`; the root lint covers it). Its relay
  writes the laptop's "I asked" stamp at most every 15 s, keeps a taken
  request 75 s (the laptop allows itself 60 s), and refuses a body over
  128 KB by Content-Length before reading it.

## Tonight counter: the printer's tally is the source of truth

The corner "Tonight" chip used to run ABOVE the check-in desk's number all
evening. It now has one rule: **the printer's `tally` total is the truth**
(derived on the printer side from TwoTimTwo's own report, and republished
for an hour past club), and a local `bump()` is only an **optimistic tick**
so a child sees the number move within a second of their own check-in.

- **A bump yields to any tally at or after the check-in's time.**
  `bump(at)` in `src/hooks/useTally.js` takes the sanitized `checkin.at` and
  skips when the last adopted tally is stamped at or after it, because that
  total already counts the child. This is not a rare race: plaintext `tally`
  dispatches synchronously in `useSocket.js` while a sealed `checkin` waits
  on a decrypt, so the printer's "check-in then tally" publish order arrives
  here **inverted** almost every time. A check-in with no `at` (a producer
  older than contract v2) falls back to `TALLY_BUMP_GRACE_MS` since the last
  tally landed, measured against this device's own clock only. The printer's
  `at` is never compared to `Date.now()`, for the reason `TALLY_REORDER_MS`
  explains. `sync()` still adopts the printer's total outright.
- **Every check-in is deduped by id before anything else.** `handleCheckIn`
  returns early on `hasSeen(payload.id)`. Two stations, or a recap replaying
  on its own decrypt chain beside the live event, deliver the same id twice.
- **The seen set and the count share one lifetime.** `useSeenEvents.js` is
  day-stamped `localStorage` with the same `todayKey()` shape as
  `useTally.js`. It was sessionStorage, which is shorter: a kiosk relaunch
  kept tonight's number and forgot everyone it had already counted, so the
  next recap replayed the whole `recapMaxAgeMin` window back into the total.
  Two facts about the same evening cannot live on two different clocks.
- **Settings → "Preview a check-in" never moves the public count.** It is a
  rehearsal for the operator: banner yes, demo badge yes, number no. The hint
  rides a local-only fourth argument to `dispatchEvent`/`simulateEvent`
  (`{ countsTowardTally: false }`) that the live Pusher binding never passes.
  Deliberately NOT a payload field: on the wire any publisher could set it,
  and the sanitizer would have to allowlist something the contract has no
  word for. The debug panel's simulators still count, on purpose: that panel
  exists to rehearse the real thing end to end.
- Nothing about the wire changed; the `checkin`/`tally` sanitizers and
  `contract-vectors.json` are untouched. The existing "synced with the
  check-in desk" note still explains a correction bigger than one either way.

## Self-updating pages

Owner request 2026-09-16: a lobby TV or a projector that has been running for
days should pick up a new deploy on its own, within a few minutes, without
anyone walking over to it, and never in the middle of something a room is
watching.

- **One build identity, three places.** The `serviceWorker()` plugin in
  `vite.config.js` already hashed the emitted filenames for the service
  worker's cache name; that same hash now also lands in `dist/version.json`
  (`{ build, builtAt }`) and in a `<meta name="awana-build">` tag in BOTH
  HTML entries. The tag is how app code learns its own build, read from the
  DOM and never imported, which is what lets the projector page share
  `src/lib/buildReload.js` without breaking its isolation rule. The hash is
  only knowable after rollup names every file, so `transformIndexHtml` writes
  a `__BUILD_HASH__` token and the post-order `generateBundle` swaps it in
  the emitted HTML. HTML files are deliberately excluded from the hashed and
  precached file list, so that token can never move the service worker's
  cache name.
- **No stamp means no poller.** `pageBuild()` is null on the dev server and
  in the hermetic e2e smoke run, and `useBuildReload` then starts no timer at
  all. A missing, non-200 or unparsable `version.json` is likewise "no news",
  never a change: a captive portal answering every URL with a login page must
  not be able to reload the wall.
- **The HTML is checked before reloading.** The site's HTML and JSON are
  served `no-cache` now (`site/build.mjs` writes the `_headers`), but a CDN
  edge or a proxy can still hand out the previous `index.html` for a moment
  after `version.json` has moved on, which was the rule under GitHub Pages'
  ten-minute cache. A reload that
  landed on the old HTML would come straight back and loop, so the page
  fetches its own `location.pathname` first and only reloads when that HTML
  already carries the new hash. Both probes carry
  `?awanaBuild=<Date.now()>`; `src/sw.js` passes anything with that query
  (and `version.json` itself) straight through to the network, because a
  cached answer would pin the screen to the build it already has.
- **Busy means busy, and there is no deadline.** Signage is busy while a
  check-in banner (and so any birthday ribbon riding on it), a celebration or
  doors-open flourish, a visible checkout board or "has checked out" banner, an open Settings / slide
  editor / debug panel, or an event from the last `BUILD_QUIET_MS` is on
  screen. The projector is busy unless `projectorIdle()` says otherwise:
  shutdown is always safe, a countdown still more than `COUNTDOWN_IDLE_MS`
  out is safe (before 5:30 on a club night, and every other day), games and
  slideshows never are. Either page also holds while anything focusable is
  being typed in. A busy page re-asks every `BUILD_BUSY_RECHECK_MS`, for as
  long as it takes: a check-in rush is never interrupted to install a fix.
- Poll every `BUILD_CHECK_MS` (3 minutes) and on the browser's `online`
  event, rate-limited to `BUILD_ONLINE_MIN_MS` because `online` fires in
  bursts on a flaky church connection. Nothing is persisted; two
  `console.warn` lines (update detected, reloading) are the whole trace.
  `location.reload()` keeps `?lowPower=1`, `?key=` and friends.

## The presentation page (`src/presentation/` → /countdown.html)

The full Awana Presentation Tool, migrated from KVBC-Awana-Countdown
(see MIGRATION.md for the retirement plan). Its conventions carry over:

- **Pure black page backgrounds** (`#000000`) — it is projected onto a
  blank wall. Broadcast-ready quality on every screen; never regress an
  animation, keyboard shortcut, or effect.
- **Pure schedule engine**: `src/presentation/lib/schedule.js` is the
  highest-risk code. Any change to it, to the window tables, or to
  `shared/schedule.json` needs matching cases in
  `src/presentation/lib/schedule.test.js`, and time-travel QA
  via `countdown.html?now=<ISO>` across the 18:00 / 18:05 / 19:30 /
  19:35 / midnight boundaries plus a non-Wednesday evening — the
  Playwright suite (`npm run e2e`, `e2e/countdown-modes.spec.js`)
  automates exactly those boundaries and gates every deploy, but a
  manual spot-check is still good manners for engine changes.
  A device-local "skip weeks" overlay (`lib/scheduleOverlay.js`,
  QuickNav editor) can mark dates no-club; `shared/schedule.json`
  remains canonical for anything structural.
- **Isolation rule**: `src/presentation/` may import from the existing
  app ONLY `src/hooks/useSocket.js`, `src/hooks/useConfig.js`,
  `src/hooks/useWakeLock.js`, `src/hooks/useBuildReload.js`,
  `src/lib/buildReload.js`, `src/lib/weather.js`, `src/lib/skins.js`,
  `src/components/BirthdayArt.jsx`, and the secret-storage helpers
  `src/hooks/useDisplayLogin.js`, `src/hooks/useDisplayKey.js`,
  `src/lib/displayKey.js` (`maskDisplayKey`) and `src/lib/envelope.js`
  (`isPlausibleKey`). Its realtime data must flow through the sanitized
  socket — never a second Pusher stack; the wake-lock, Open-Meteo
  fetcher, skin table, birthday art, self-update poller and the display
  key / login slots are shared so the two pages can't drift apart (the
  projector page must never grow a second copy of a key slot, and one
  copy of "may this screen reload right now" is the whole point of the
  self-update helper).
  (The skin table earned its place after the two screens disagreed about
  the season: November read as `harvest` on signage and `winter` on the
  projector, from two separate month tables.) Nothing in the signage app
  imports from `src/presentation/`.
- `shared/` at the repo root is served at `/shared/` (dev middleware +
  build copy in vite.config.js) for the whole Awana app family; this
  repo's copy is the canonical one (KVBC-Awana-Countdown is retired).
- Design tokens live in `src/presentation/index.css`; the `--dur-*`
  timing values are mirrored in `src/presentation/lib/motion-tokens.js`
  — keep the two in sync (enforced by
  `src/presentation/lib/motion-tokens.test.js`).
- `shared/slides.json` (verse of the month, closing text) is validated
  in `lib/shared-config.js` like the other shared files — malformed
  content fails the build, never the projector.

### The projector in the brand kit (rebrand stage 6)

The approved mockup: the same brand on pure black. The countdown is type
alone, the Awana Clubs mark is back, and the catalog arrives through the
type, the club colours and marks, the stepped chip and the edge waves.

- **How it gets the kit without breaking isolation.** `shared/` belongs to
  the whole family, so the projector reads it the way it already read
  `schedule.json`: `index.css` `@import`s `shared/brand/tokens.css` (bundled
  and hashed at build time, exactly like the lobby's `app.css`), and
  `lib/kit.js` / `lib/motion-tokens.js` import `shared/brand/tokens.json`.
  Fonts are the same files the lobby bundles (Paytone One and Londrina Solid
  400 from the kit's own full files through the same `@font-face`s, and
  `@fontsource` Figtree and Baloo 2 for Devanagari), so the service worker
  precaches one copy for both pages and nothing is fetched at showtime. The mark and the club wave come in as
  build assets / `?raw` from `shared/brand/`. It never imports
  `src/lib/brand.js`, `src/lib/motion.jsx` or `src/components/brand/*`:
  `src/presentation/isolation.test.js` enforces the whole allowlist, and
  `lib/chip.test.js` pins the projector's own stepped-chip geometry to the
  lobby's so the two cannot drift.
- **Units.** Everything is sized in `--u` (1% of the widest 16:9 frame
  that fits the window) off the mockup, on a centred `.pj-frame`; edge
  waves and the mark use the real screen edges.
- **One headline** (`components/Headline.jsx`, Paytone One caps at .93,
  words never broken, `fit` sizes a title to one line by measurement,
  `headlineBox` opens the rows and pads the box for a title with a tall mark),
  one kicker
  (Londrina), one body (Figtree), one stepped chip (`StepChip.jsx`, which
  replaced the pill Badge everywhere: game ends / warnings / tally /
  birthdays / theme / upcoming nights / the ESC toast / the resume pill).
- **Timing is the kit's**: `DUR`/`EASE` are the kit table (beat, quick,
  exit, settle, pop, wipe, stinger; four curves) plus the projector's own
  `mode` (view crossfade) and `sweep`. `motion-tokens.test.js` pins CSS to
  JS and both to the kit.
- **The mark is a broadcast logo**: `AwanaMark` renders once in `App.jsx`,
  outside every view, so no slide change or crossfade moves it. It drops
  lower and smaller on game time (clear of the top waves) and fades away
  only for a bare wall: views report it through `onBareChange` (the
  opening's closing blackout, the shutdown idle blackout).
- **The first-run setup note is a strip in the wall's bottom margin band**
  (`SETUP_NOTE`, `.pj-setup-note`; live smoke check 2026-09-29: as a 23rem
  corner card it covered the left of the upcoming-nights list at 720p and
  the coming-up chips at 1080p, since a corner of a centred, full-width
  layout is never free). The band is below 51.75u down the frame: the
  Upcoming Awana Nights list stops there (`COMING_UP.bottom`, its title-safe
  margin) and every other view ends higher (the countdown ~46u with its
  four special nights listed and ~50u with the week's theme chip too, game
  time ~46u, the shutdown ~42u, the slides ~31u). Two lines, on the slides'
  own left margin (8u), as wide as its words up to their 84u text block,
  anchored to the window's bottom so a 4:3 window has the black band under the
  frame too; sized in `--u` with a 12px floor; the button rides beside them;
  no animation. It is ~44px tall at 1280x720, ~7px clear of the packed
  coming-up list. Keep it inside the band: a taller note, or a third line, is
  the bug again (the coming-up list is the tightest fit on any wall, and
  `e2e/setup-card.spec.js` packs it and measures every text and chip against
  the note at five sizes). The game-time mascots stand on the bottom wave, so
  the note clips their shoes while it is up; that is art, not content.
  **The band also holds the wall's own overlays** (review of the first fix):
  - The slideshow's hover Prev / Next pill stands at the window's
    bottom-right (`fixed bottom-8 right-8`, ~11.75rem wide, `data-slideshow-nav`),
    so the note stops 14.5rem short of the right edge (`max-width`) and wraps
    rather than run under it; at 4:3 that third line lands in the black band.
    At 1920x1080 the full-width note had "DON'T SHOW AGAIN" clipped to "DON'T
    SHOW AG" by it, and a quarter to two fifths of that button routed a click
    to Prev. `e2e/setup-card.spec.js` measures both at five sizes, and asks
    `elementFromPoint` along the button.
  - The ESC toast ("Exit slides / Press ESC again") and the watchdog's "Back
    to schedule in" pill stand at bottom-centre, over the middle of any strip
    wide enough to read. Both carry `data-pj-bottom-overlay`, and
    `:root:has([data-pj-bottom-overlay]) .pj-setup-note { visibility: hidden }`
    hides the note while either is in the DOM. An overlay that leaves by an
    exit animation stays in the DOM until it ends, so the note returns only
    once it is truly gone, with no plumbing between the components. Any NEW
    overlay that stands in the bottom band takes the same attribute (a marker
    on something always mounted would hide the note for good; a vitest pins
    the list).
- **Slide changes are the sweep, not the old 3D flip**: every kicker,
  headline word, body word and chip is a PART that inherits its slide's
  `hidden`/`shown`/`gone` variant (`lib/landing.js`, keyframe lists, never
  `initial` + `delay`); the outgoing parts climb away one after another,
  `ColorSweep` crosses the bottom edge once in the six club colours
  (`lib/sweep.js`; ← sweeps the other way) and rests OFF the wall, so
  `?vr=1` / reduced motion never show it; the next parts land after the
  last has left. The pledge clock belongs to the deck, so it holds still.
- **The pledges are as big as fits** (owner, 2026-09-30: "a lot larger";
  `lib/pledgeFit.js`, `PledgeBlock` in `views/Slide.jsx`): the room says them
  together, so the title and the whole pledge fill the band from 11u (below
  the Awana mark and the clock) to 51u (above the bottom margin band) in an
  88u measure, at the largest read-voice size that fits, measured in Figtree
  SemiBold (about 5u, five rows, against the old 3u and three), with a 1.2
  line height and the title at 0.72 of the words' size. The fit counts rows
  the way the browser wraps them (balance only evens rows out), centres a
  short pledge in the band, and runs again when a web font lands;
  `e2e/pledges.spec.js` measures both pledges at three sizes and checks every
  drawn row is one the fit counted.
- **Game time**: the club's deep-behind-colour waves on both edges (the
  far bottom one drifting), the white club mark sized by optical area, the
  headline in the club colour, white figures with club-colour colons, a
  "GAME ENDS / 6:30 PM" chip that becomes "GAME ENDS 6:30 PM / TWO
  MINUTES" (sun figures, orange-deep plate) and "... / LAST 30 SECONDS"
  (hot figures, hot-deep plate), a hot HAPPY BIRTHDAY chip with the cake
  (still no age), and small CHECKED IN chips top-right. T&T is its catalog
  green.
- The countdown's figures are Paytone One's tabular figures (`tnum`, on
  `.pj-timer`) in fixed 0.600em cells, the font's own tabular advance (its
  default figures are proportional, 0.444em to 0.679em, and a zero would
  overhang a 0.6em cell); every figure's ink sits inside its cell (0.021em
  to 0.593em), clipped top and bottom only so the roll never shaves a
  figure, in a 1.06em line (the mockup's 1.12em at Galindo's size).

### The projector on phones and tablets (touch)

Owner, 2026-09-30: "I want this website to fully work on mobile." The page was
built for the projector PC, a mouse and a keyboard: the menu opened on hover, a
slide changed on an arrow key, and a finger has neither. The projector PC runs
this page every club night, so the rule for all of it is that **the desktop
does not change at all**.

- **One question, the primary pointer's, never the width.**
  `lib/touch.js` has `TOUCH_QUERY` (`(hover: none) and (pointer: coarse)`)
  and `PORTRAIT_QUERY` (the same plus `(orientation: portrait)`), their hooks
  `useTouch()` / `usePortrait()` (they follow a tablet turning, or a mouse
  plugged into it), and App stamps `html[data-touch]` / `[data-portrait]` for
  the e2e suites. A phone in landscape is as wide as a laptop and the PC's
  window can be any size, so nothing here may key off the window's size.
  The CSS asks the same two strings in `@media` blocks at the very END of
  `index.css`; `lib/touch.test.js` pins the strings to the file and fails if
  anything but those blocks follows the first one. A touch rule overrides a
  rule above it or sets a custom property that defaults to today's value
  (so the desktop computes the same style), never edits one. The proof is
  the desktop suites, unchanged (countdown-modes, setup-card, the
  countdown visual baselines), and a pixel comparison with main's build.
- **The menu (`views/TouchMenu.jsx`) replaces QuickNav on touch**, it is not
  QuickNav made visible: App renders one or the other, so a touch page has no
  hover panel at all. (Its buttons stood at opacity 0 over the top 70% of a
  phone, and an ordinary tap on the timer armed the chimes or jumped the
  wall.) A 44px button top-right opens a full-screen sheet with the same
  items: `QuickNavItems` in `views/QuickNav.jsx`, whose `touch` branch has its
  own `pj-sheet__*` markup (rows 48px, pills and fields 44px, inputs 16px or
  iOS zooms the page, each field a real `<form>` with `enterKeyHint` so the
  phone's Go key submits, never capitalised or autocorrected) and writes the
  tooltips out as hints. **The desktop branch is the old markup verbatim**:
  keep editing both when the menu grows an item. A pick that changes the wall
  closes the sheet; settings leave it open. The sheet owns the keyboard
  (a key typed in it stops at the sheet, any other key is stopped in the
  window's capture phase, Escape closes it), because a
  tablet's keyboard would otherwise skip the countdown from a passphrase
  field. Where the browser can put a page in full screen (Android, iPadOS;
  iPhone Safari cannot, and there the row is not offered) the sheet has a
  "Full screen" switch, the tap being the gesture it needs, and
  `countdown.html`'s `theme-color` (black, for the browser's bars) carries
  the same touch media query, so the PC never reads it. The clock-drift pill
  rides beside the button, and a tap reads out
  the fix its tooltip gives on the PC. The wall's top-right pieces (the
  pledge clock, the CHECKED IN chips) stop short of the button
  (`--pj-menu-room`).
- **A slide deck by finger** (`SlideshowView`). The wall is the clicker: a
  swipe left is Next and right is Prev, a tap in the left 30% is Prev and
  anywhere else Next (`slideGesture` in `lib/touch.js`, pure, with its
  thresholds in `SLIDE_GESTURE`), handled on the deck's own root so it works on
  every slide, the closing blackout included (its next tap starts games, as
  the next key press does; `Slide.jsx`'s black slide has no button to tap).
  A tap on a control is that control only (`CONTROLS`). The PC's hover pill
  and the invisible right-edge Next zone are not rendered on touch (both
  stood at opacity 0 and moved the deck on a blind tap); a visible cluster
  (`data-slideshow-touch-nav`: Exit, Prev, Next, each 44px) stands at the
  bottom-right, or up the right-hand band on a phone on its side
  (`min-aspect-ratio: 43/20`, where the wall fills the height). Exit is tapped
  twice, like Escape, with the same toast reading "Tap Exit again", above the
  cluster and at least 15px (`--pj-toast-bottom` / `--pj-toast-size`, whose
  fallbacks are the PC's values). The keys still work for a tablet with a
  keyboard. The page itself is held in a hand: no pull-to-refresh, no
  double-tap zoom, no long-press callout or text selection on the wall;
  pinch-zoom stays.
- **The wall's own buttons ask a finger for more.** The countdown's clock is
  the biggest thing under a finger and a skip is a fifteen-minute override,
  so on touch one tap only asks (a "Start the opening / Tap the clock again"
  toast, a bottom overlay like Exit's) and a second within 3 s skips; the PC's
  one click, tooltip and hover hint stay (`BigTimer`'s `touch` drops only
  those two). The shutdown screen restarts from Start Over only (on the PC the
  whole screen is a restart click, but one tap on "Have a safe drive home!"
  restarted the countdown), "or press Space" is not offered, and a finger on
  the screen keeps it lit as a mouse move does. Stay (the watchdog pill),
  Start Over and the error screen's Reload are at least 44px with 16px type
  or more, the pill stands above the slide controls, and the PC's hover lift
  on the kit's two buttons is undone on touch (iOS leaves :hover stuck on
  the last button tapped) while the press still shows. All of it is custom
  properties whose fallbacks are the PC's inline values
  (`--pj-stay-size`, `--pj-resume-size`, `--pj-resume-bottom`,
  `--pj-restart-size`, `--pj-reload-size`).
- **The first-run note on touch** (`SetupChecklist` with `touch`) is a card
  at the bottom-left, as wide as its words up to 560px, standing above the
  slide controls while a deck is up (`:has([data-slideshow-touch-nav])`),
  with the same steps, no "hover" in its words, and two 44px buttons: "Set
  up" opens the menu on Display Settings, "Don't show again" is for good. A
  phone on its side has no free band at all (the wall fills its height), so
  there it leaves the wall: the menu button carries an orange mark
  (`data-setup`) and the sheet opens on Display Settings with the note's
  steps at its top (`inSheet`), as it does on any touch device while the
  screen is not set up. The dismissal is one store (`dismissSetup`,
  `useSetupNeeded`) because three things read it; the PC's note renders as
  it did. The `:has([data-pj-bottom-overlay])` rule hides the touch card too.
- **Upright, the wall is re-laid, never letterboxed** (`PORTRAIT_QUERY`, the
  portrait block at the very end of `index.css`; the 16:9 frame had shrunk
  to a band a quarter of a phone's height, with 8px type). The frame is 9:16
  on the same unit (`--u: min(1vw, 0.5625svh)`, 177.78u tall), so every width
  fit in the components holds unchanged; only heights and sizes move: the
  type tokens, custom properties the components fall back from
  (`--pj-mark-*`, `--pj-countdown-*`, `--pj-event-*`, `--pj-game-*`, each
  defaulting to the PC's inline value), and portrait tables picked with
  `usePortrait` (`COMING_UP_PORTRAIT`, `PLEDGE_FIT_PORTRAIT`,
  `THEME_CHIP_PORTRAIT`, the headline fits, game time's `PORTRAIT`), which
  `src/presentation/portrait.test.js` pins to the block. The top 16u is the
  mark's and the menu's (the pledge clock stands centred between them); the
  bottom is the controls' and the setup note's, so a slide's words end by
  122u and every other view's by about 140u. Headlines take rows at one big
  size instead of shrinking to one line, and the doodles keep a full-width
  band clear (`PORTRAIT_CLEAR` in `SparkleDoodles.jsx`, 10% to 76% of the
  height) instead of the wall's centred box, since the words run the frame's
  width (the box's side strips landed on the pledge). A phone on its side
  keeps the 16:9 wall; both use the small viewport (`svh`), because this page
  never scrolls the browser's toolbars away.
- **Sound needs a tap.** WebKit plays a page's audio only from a context made
  or resumed inside a gesture, so on touch App wakes the countdown chimes'
  context on every tap (`unlockStingers`, only once they are armed), and the
  sheet's switch wakes it in the tap that arms them.
- Tests: `lib/touch.test.js`, `views/TouchMenu.test.jsx`,
  `views/SlideshowView.touch.test.jsx`,
  `views/CountdownView.touch.test.jsx`, `views/ShutdownView.touch.test.jsx`,
  `components/SetupChecklist.touch.test.jsx`, `portrait.test.js`,
  `components/SparkleDoodles.test.jsx`,
  `lib/stingers.test.js`, and
  `e2e/touch.spec.js`, which runs Chromium's own touch emulation of the
  iPhone 14, Pixel 7 and iPad Pro 11 descriptors (their viewports are the
  area under the browser's toolbars, 390x664 on an iPhone 14, which is what a
  page really gets), both ways up: the menu by tap and every control in it at
  least 44px, its picks, the switches, taps on the wall that never reach a
  hidden control, the countdown's two-tap skip, the shutdown's Start Over
  (and taps on its words that restart nothing), Stay at 44px, the setup
  note (inside the screen, never overflowing, 14px type or more, covering no
  word or chip of the countdown, game time or the opening deck, its Set up
  opening Display Settings; off the wall on a phone on its side, the mark and
  the sheet's copy instead), every wall upright (a 9:16
  frame at least 85% of the screen's height, its content spanning at least
  half of it, nothing off the screen or under the menu or the slide
  controls, no HTML type under 11px), the landscape phone's 16:9 wall, the opening
  deck by tap zones and real swipes to games, and Exit twice.

## Privacy invariant — DO NOT relax

**One strict allowlist sanitizer per event type** — see
`src/lib/eventSanitizers.js` (bound per-event in
`src/hooks/useSocket.js`). Each incoming payload on the Pusher channel
(`checkin`, `recap`, `checkout`, `tally`, `birthdays`, `ops`, `canary`,
`tonight`, `points`, `schedule`, `notice`, `slides`, `settings`) is reduced
to exactly its allowlisted fields before anything else sees it: first
names only, ever. Allergy info, contact info, last names, birth years,
photos — none of it can ever reach the screen. Payload shapes are
pinned by `src/lib/__fixtures__/contract-vectors.json` (a byte-identical
mirror of the printer repo's canonical copy) and enforced by
`src/lib/eventSanitizers.test.js`. Preserve this invariant on every
change to the socket layer, the sanitizers, or banner components.

**The four name-bearing events arrive ENCRYPTED**, because the Pusher
channel is public and Pusher public channels have no server-side
authorization primitive at all. `checkin`, `recap`, `birthdays` and
`checkout` — plus `slides`, the operator's published slide deck (free-typed
church copy, contract v5; chunked, ordered strictly by `publishedAt`,
cached in `awanaSyncedSlides.v1`, publish token in its own storage like the
display key), and `settings`, the shared settings (contract v6, one frame,
allowlisted keys only; see "Shared settings across screens") — are sealed with AES-256-GCM (`src/lib/envelope.js`; publisher half is
`print-server/events.js` in the printer repo, pinned to a shared
`envelope-vectors.json` interop fixture). Rules that must survive any
change:

- Decryption sits **in front of** `dispatchEvent`, never beside it — a
  sealed frame is authenticated, not trusted, so it still passes its own
  allowlist sanitizer. `eventSanitizers.js` is untouched by the transport.
- **Anti-downgrade:** once a screen holds a key, a *plaintext* payload on
  those four events is dropped. Without it the encryption is decorative.
- The key lives in its **own** localStorage entry (`src/lib/displayKey.js`)
  and must never be added to `VALIDATORS` in `useConfig.js` — that table
  also backs `?config=<url>` and the Settings export, so it would publish
  the key. `displayKey.test.js` guards all three paths.
- Decrypts are serialized through one promise chain per event, or a burst
  of arrivals greets children out of order.
- **Display login** (`src/lib/displayLogin.js`): `provision` frames on the
  `cache-awana-channel-provision` cache channel are opened with a
  passphrase-derived key (PBKDF2-SHA256, params pinned in the fixture's
  `provision` section) and write ONLY into the displayKey/publishToken
  storage slots — never into config, never through `dispatchEvent`, never
  rendered. The derived login key lives in its own `awanaLoginKey.v1` entry
  with the same three leak-path tests as the display key. `useSocket.js` is
  still the only file that imports pusher-js, which is why the subscription
  lives there.
- The other events stay plaintext **on purpose**: their readability
  is what lets a screen distinguish "pipe down" from "cannot read names"
  from "quiet night". See SECURITY.md.

**`checkout` (who is still here) needs more than a sanitizer.** It is the
one payload that names children who are *not yet with a parent*, so the
rendering rules are part of the privacy design, not styling:

- **It comes on by itself at pickup time** (owner, 2026-10-08), from 7:30 pm
  (`PICKUP_START`, `inPickupHours`, `pickupNow`) until midnight, every night.
  There is no on/off mode and no window any more: the printer only publishes
  a checkout list on club nights, and which clubs are on it is set on the
  check-in laptop's dashboard. (Until then it was off by default, then a mode
  and a window in Settings.) Before 7:30 a list on the wire shows nothing.
- Below `checkoutBoardNamesAbove` children it **stops naming anyone**. A
  long list is anonymising; two names late in the evening point at two
  specific unattended children, and `checkin` already published those
  names earlier.
- A missing payload renders **nothing**, never an empty board — "I have
  no data" and "everyone has been picked up" are opposite facts.
- It is **not a headcount**. It reflects whether volunteers *recorded*
  checkout, so it can be fresh and wrong; every string says "not checked
  out yet", never "still in the building".
- All of that judgement lives in the pure `decideBoard()` in
  `src/lib/checkoutBoard.js` so it can be tested exhaustively.
- **Once the list empties** it says "Everyone has been checked out" for
  `EMPTY_HOLD_MS` (one minute, from `emptySince`, which App stamps where the
  payload lands), then steps away for the night. `pickupNow()` is when the
  board shows, when the "has checked out" banners may speak and when the
  corner counts down.
- **"<First name> has checked out"** (owner, 2026-10-08;
  `src/lib/checkoutLeaves.js`, `useCheckoutBanners`, `CheckoutBanner.jsx`):
  the payload has no ids, so a departure is the multiset difference (first
  name + club) between two successive lists. Only between two FRESH lists
  this screen saw in a row, in pickup time: never on the first list after a
  load or a reconnect (any change of the socket's status forgets the
  baseline; the Worker replays the last list to a screen that connects), never
  from or to a stale list, so never because the feed went quiet. A name only
  while the NEW list is still in its names state (more than
  `checkoutBoardNamesAbove` left, or the guard at 0); otherwise "A child has
  checked out", with no name, no club and no club colour. One at a time,
  `LEAVE_BANNER_MS` (3 s) each, in the foot in the list's place
  (`lobbyRoom`'s `banner`), the list back after; past `LEAVE_QUEUE_CAP` (6)
  waiting the rest collapse into one "and N more have checked out". A
  check-in moment outranks it (the head waits unseen and gets its full time
  after), the queue empties outside pickup time, and it is never on an OBS
  feed. Every piece is `M.*`. `checkoutLeaves.test.js` (the rules),
  `useCheckoutBanners.test.jsx` (the turns), `CheckoutBanner.test.jsx`,
  `App.overlays.test.jsx` and `e2e/pickup-board.spec.js` ("a child leaving the
  list", 1080p and 640x480) pin it.
- **The corner counts down only what the board itself says**
  (`stillHereCount`, `cornerStillHere`, on by default): from 7:30 pm, while
  the board is NAMING children, the tally's slot reads PICKUP over the number
  with "not checked out yet" under it (`STILL_HERE_NOTE`, shown even when the
  correction note is switched off). Never while the board is anonymous (an
  exact small number on a public wall singles children out), never from a
  stale, empty or switched-off board; tonight's count comes back.
- **In the foot, one run, club by club** (`fitFoot` in `overlayFit.js`,
  youngest club first by `getAllClubs()`; see "The foot is the pickup board's"
  above): the club's plate (white mark, "N waiting"), then its names as chips,
  alphabetical, "+N more" where the smallest readable chips cannot hold them.
  `e2e/pickup-board.spec.js` checks every plate and chip stays inside the run
  and the strip at three sizes.
- **The demo** (Settings → Pickup board): a live preview on sample names
  (`demoCheckout`, `SAMPLE_BOARD_NAMES`, obviously made-up), and "Show a demo
  on this TV", `BOARD_DEMO_MS` (20 s) on this screen only, with the demo
  badge and a "Demo · sample names" tag on the card. `decideBoard`'s `demo`
  bypasses the clock, never the naming rule, and never touches the real
  checkout data. The demo never says "has checked out".

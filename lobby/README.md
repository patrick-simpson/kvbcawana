# Awana® Check-in Display

> **NOT AFFILIATED OR ENDORSED BY AWANA CLUBS INTERNATIONAL.**
> This is an independent, non-commercial project built by a local church
> for its own club nights. Awana and the Awana club names are trademarks
> of [Awana Clubs International](https://www.awana.org) — see
> [TRADEMARKS.md](TRADEMARKS.md) before reusing anything here, especially
> the bundled club artwork.

**About page:** a plain-language tour of what this display does, for church leadership — <https://awana.kvbchurch.org/#lobby>

A joyful welcome screen for your Awana club, styled after the official Awana Clubs catalog — chunky rounded type, sparkle doodles, wavy shapes and the catalog's warm orange. Runs full-screen on a TV or projector, loops your PowerPoint in the background, and reacts to each child's check-in with a celebratory banner, confetti, and an optional chime.

- **Catalog-true club theming** — every banner uses the club's real color, age range, and tagline (Sparks red with "Grades K–2", Cubbies royal blue with "Ages 3–5", and so on).
- **Birthday mode** — falling gifts, fireworks, and "Happy Birthday, [Name]!"
- **First-timer mode** — a special "Welcome to Awana Clubs, [Name]!" moment.
- **Rush mode** — if five kids scan at once, each still gets their own full moment in turn: the club wave stays up and the names flip in one after another like a scoreboard, so nobody's time on screen is ever cut short.
- **Tonight's tally** — an optional corner counter ("23 checked in tonight"). It stores only a number and resets itself daily.
- **Seasonal skins** — autumn, Christmas, spring and more, or `auto`
  to dress the stage by the calendar.
- **Corner info, one item at a time** — the time or tonight's tally
  bottom-right, the weather top-right ("CLOUDY / 58°", live from
  [Open-Meteo](https://open-meteo.com) every 15 minutes, free, no API key),
  moving on with each slide and stepping aside while a poster is up.
- **Built for signage** — keeps the screen awake during club (Screen Wake Lock), double-click anywhere for fullscreen, and if the connection drops mid-club a warning dot appears on its own.
- **No local server to run** — the display listens on the church's sync service (a Cloudflare Worker, `worker/`) over its live channel, signed in with the church passphrase. The check-in computer publishes events to the same service. (Pusher carried this until 2026-10-11 and is retired.)

---

## The presentation page (`/countdown.html`)

This repo also hosts the full **Awana Presentation Tool** as a second,
independent page — migrated here from the KVBC-Awana-Countdown repo. It
runs on the main projector during club night and automatically cycles
through a week-long countdown, the opening ceremony slides (welcome +
pledges), per-club game-time screens with live check-in counts and
birthday shout-outs, a closing slide, and a shutdown view — all driven
by a pure, tested schedule engine over `shared/schedule.json`.

- **URL:** `https://awana.kvbchurch.org/lobby/countdown`
- **Source:** `src/presentation/` (fully isolated from the signage app;
  it shares only the sanitized live socket and the device config store)
- **Time-travel QA:** append `?now=2026-09-16T18:04:00` (any ISO
  timestamp) to simulate a moment; the simulated clock still ticks.
- **Operator controls:** hover the top-right corner for the QuickNav
  menu (jump between views, sign in with the church passphrase —
  birthdays sync themselves from the print server); Space/→ advance or skip, ←/PageUp
  go back, Esc twice exits a slideshow.
- **Shared data:** `shared/` at the repo root (schedule, club theme,
  art) is served at `/shared/` for the whole Awana app family. See
  `MIGRATION.md` for the plan to retire the old repo.

### Running the screens on club night

- **Before club:** open the lobby page fullscreen (double-click). On the
  projector, the countdown should show the right time to Wednesday 6:00 PM;
  an amber "clock off" chip means the device clock is wrong, so fix that first.
- **Operator keys (lobby page):** Ctrl+Shift+S settings, Ctrl+Shift+E slide
  editor, Ctrl+Shift+D debug panel, Ctrl+Shift+X panic mode (strips the page to
  its core; check-in banners keep working).
- **Projector schedule** (`shared/schedule.json`): opening 18:00, game time
  19:00 to 19:30 by club, closing 19:30, shutdown 19:35. A manual override
  hands back to the schedule on its own; "Stay" keeps it.
- **Skip a holiday:** QuickNav → Skip Weeks applies to that one device. For
  every screen, edit `shared/schedule.json` (CI validates it).
- **Closing text:** `shared/slides.json`. A malformed edit fails the build.
- **Connection lost:** screens reconnect on their own, and check-ins missed
  while offline replay on reconnect. Still wrong: reload (F5), then reboot.
- **Privacy:** screens show first names only. If anything more appears, treat
  it as an incident and report it.
- **Calendar:** the church feed refreshes nightly; a screen keeps its last good copy.
- **Deploys:** every push to `main` redeploys; screens pick it up on their next load.

---

## 1. Fork this repo

1. Click the **Fork** button at the top of this page (top-right on GitHub).
2. On the next screen, click **Create fork**. You now own a copy.

## 2. (Skip — GitHub Pages turns itself on)

The first time the deploy workflow runs in your fork it auto-enables
GitHub Pages with "GitHub Actions" as the source. You don't have to
flip any switches. If you ever want to confirm: **Settings → Pages**,
the source should read **GitHub Actions**.

No secrets, no tokens. Every push to `main` redeploys automatically.

## 3. The live channel

Realtime check-in events reach the display over the sync service's live
channel (`/api/v1/live`, the Worker in [`worker/`](worker/README.md); setup and
API are in its README). A screen signs in with the **church passphrase** and
then listens there; only signed-in screens can, so arrival timing and
headcounts are not public. Names stay sealed end to end with the display key
(see [SECURITY.md](SECURITY.md)), which signing in fills in by itself.

> **Pusher is retired** (2026-10-11): the app no longer contains a Pusher
> client, and the Pusher key and cluster settings are gone. An old saved
> setting or an old OBS link that still carries `?key=` and `?cluster=` is
> simply ignored.

## 4. Configure your app

Pick whichever is easier — most people use the Settings panel.

### Option A — the Settings panel (recommended)

Keeps what you set in the browser's local storage on that device, so it never
enters your repository and is not inherited by anyone who forks it.

1. Open your deployed app (see step 6). A brand-new screen shows a slim
   **New display?** card along the bottom with these same
   steps and an **Open Settings** button.
2. Or press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> (the TV draws no settings
   button; everything else is done from awana.kvbchurch.org/settings → Screens).
3. A new screen opens Settings on **Setup** → **Sign in** → type the church
   passphrase → **Sign in**. That connects the screen to the live channel and
   fills in the display key by itself (every change in Settings applies as you
   make it; there is no Save).
4. Only if signing in is not possible on this screen (no sync service, or a
   page not served over https): open **Advanced — paste keys by hand** in the
   same section and paste the display key.
5. **Slides** section: the default is **Typed & published slides**, which shows the
   deck published from the check-in computer plus the calendar slides. Pick
   another source only if this screen should play its own PowerPoint or video.

Repeat once per screen. Settings only writes what you changed, so a screen
never pins a central setting by accident.

### Option B — edit `src/config.js` (applies to every visitor)

Convenient if you run several screens and don't want to configure each one.
Open `src/config.js` on GitHub (pencil icon to edit in-browser) and fill in,
for example:

```js
backgroundSource: 'powerpoint',
powerpointEmbedUrl: 'https://onedrive.live.com/embed?cid=…',
```

Commit the change. A new build deploys in about a minute. Per-device Settings
and a `?config=` file still override these defaults (the layering lives in
`src/hooks/useConfig.js`: baked defaults < `?config=` file < this device's
Settings < `?lowPower=1`).

> **Forking someone else's deployment?** Point `shared/sync.json` at your own
> sync service, or you will be signing in to theirs. See
> [SECURITY.md](SECURITY.md).

### Signing a screen in (names, slides, publishing)

One word does it. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> → Setup → **Sign in** → type the church
passphrase. The screen receives the display key (children's names, published
slides), applies the shared settings and the "new screen" template, and keeps
following rotations made on the sync service. Pasting the display key by hand
still works under the same tab's **Advanced** section.

#### Getting the OneDrive embed URL

1. Upload your `.pptx` to OneDrive.
2. Open it → **File → Share → Embed**.
3. Copy the URL from the `<iframe src="…"></iframe>` snippet OneDrive gives you.

### Typed slides — no PowerPoint needed

Instead of a PowerPoint embed, you can free-type background slides right in
the app: Settings → Slides → **Typed & published slides** → **Edit slides…**
(or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd>). Each slide gets the
catalog look automatically, with a per-slide theme, text size, and duration.

**Video slides** — the editor's **+ Add video** button drops a local video
file (mp4/webm) into the rotation:

- The file is stored in this browser's local storage (IndexedDB) on the
  display machine only — it is **never uploaded** anywhere.
- Videos play **muted** (browsers block autoplaying sound on a kiosk).
- "Seconds on screen" = 0 plays the video to the end, then advances; a
  number holds the slide that long while the video loops.
- The JSON **Export** carries a video slide's *name* only — after importing
  a deck on another machine, re-add the video files there (the editor
  badges them "Video not on this device" until you do).
- Clearing the browser's site data deletes stored videos.

#### Publishing the deck to every display

Type the deck once, on the check-in computer, then press **Publish to all
displays** — the text slides go to every screen through the print server (the
button is the filled one whenever this machine holds a publish token, which a
logged-in screen gets automatically). Each screen's Settings → Slides →
**Follow published slides** (on by default) is what makes the published deck
appear; **Save slides** only keeps a deck on the device you are typing on;
Settings → Setup → **Forget received deck** drops what a screen received. Video slides never publish: they stay
on the device they were added to, and a following screen keeps playing its own
alongside the published text. **Export**/**Import** remain for moving a deck
between machines by hand, and as the fallback when this machine has no publish
token (paste the file into the dashboard → Lobby Slides → Publish). A screen set
to any other background source ignores the published deck — Settings →
Slides says so and offers **Show the published slides**.

### Calendar slides — automatic, from the church calendar

With **Typed & published slides** as the background, the display also reads the
church's Awana calendar and generates slides on its own (Settings →
**Slides** → **Calendar slides**):

- **Welcome** — "Welcome to Water Night!" on special nights (the calendar
  title after any "` - `note" becomes a subtitle). On regular nights there is
  no welcome slide: the flagship already says "Welcome to Awana!". On non-club
  days it points to the next club night instead.
- **Next week** — "Next week is Backwards Night!" when something special is
  coming, "No club this/next week" on break weeks (with the comeback date),
  or "Club is on a break" across long gaps like summer. **Awana Store nights
  are never announced ahead of time** — any calendar title containing
  "store" is hidden.
- **Nights remaining** — once fewer than 10 club nights are left after
  tonight, a big "N nights remaining" slide with the nudge *"Is your child
  on track to finish their book?"*

The **corner weather chip** is separate from these slides: it takes its turn
top-right in the one-item corner rotation over any background source
(PowerPoint or Typed slides), refreshes every 15 minutes, and sits out
whenever no reading is available. Set your
town in Settings → Screen & corner → **Weather** with the **Look up** button.

**How the data flows:** the calendar site doesn't allow direct browser
fetches, so a nightly GitHub Action (`.github/workflows/lobby-update-calendar.yml`
→ `scripts/fetch-calendar.mjs`) scrapes the calendar page into
`public/calendar-feed.json` and redeploys when it changes. The display reads
that file same-origin. If the file ever goes stale (>3 weeks), the display
falls back to scraping the calendar live through a public CORS proxy and
keeps the last good copy cached in the browser — the screen never goes
calendar-blind. If parsing ever breaks (e.g. the calendar site redesigns),
the Action refuses to overwrite the last good feed and the workflow run
fails, which emails the repo owner.

To point at a different church's calendar, change the URL in Settings →
Slides → **Calendar source** *and* the `DEFAULT_URL` in `scripts/fetch-calendar.mjs`
(or run the workflow with `--url`). Note "tonight" is decided by the display
device's own clock and timezone — keep the TV's clock right.

## 5. Point your check-in system at the live channel

**Using the [Awana Label Printer](../printer/)?**
It broadcasts automatically: it relays every event to the sync service's live
channel, and the dashboard (`http://localhost:3456`) has a **Test Welcome
Screen** button — a "Test" banner should appear here within a second. The exact
payload the two apps exchange is pinned down in [CONTRACT.md](./CONTRACT.md).

Any other check-in tool publishes the same events (`checkin`, `tally`, …) to the
sync service; see [`worker/README.md`](worker/README.md) for the API and
[CONTRACT.md](./CONTRACT.md) for each event's shape.

## 6. Open your app

Your site lives at:

```
https://<your-github-username>.github.io/<repo-name>/
```

On the display PC, open it in Chrome or Edge and press <kbd>F11</kbd> for fullscreen.

---

## Overlay mode (OBS / ProPresenter / vMix)

Add `?overlay=1` to the URL and the page becomes a transparent layer with
only the celebration banners and confetti — no background, countdown,
tally, or buttons — ready to sit on top of a livestream or projection:

```
https://awana.kvbchurch.org/lobby/?overlay=1&passphrase=YOUR_PASSPHRASE
```

- `passphrase` (or `p`) — the church passphrase in the URL, since embedded
  browsers can't open the settings panel; it signs the page in to the live
  channel and is then removed from the address bar. (An old link's Pusher
  `key` / `cluster` are ignored.)
- In OBS: add a **Browser** source with that URL at your canvas size —
  the background is transparent automatically.
- For systems that need a chroma key instead of transparency, use
  `&chroma=00b140` (green) and key it out.

---

## Keyboard shortcuts

| Shortcut                                               | What it does                                 |
| ------------------------------------------------------ | -------------------------------------------- |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>          | Open the Settings panel                      |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd>          | Open the Typed Slides editor                 |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd>          | Open the Debug panel (simulate check-ins)    |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd>          | Panic mode — strip to the reliable core (banners keep working); press again to restore |
| <kbd>F11</kbd> or double-click                         | Toggle fullscreen                            |

The Debug panel is how you test without publishing any real events — click "Standard welcome", "Birthday welcome", or "Trigger 5 simultaneous" to see the exact same animations real check-ins trigger.

---

## Supported clubs

| Club      | Color      | Shown on banner |
| --------- | ---------- | --------------- |
| Puggles   | Orange     | Ages 2–3        |
| Cubbies   | Royal blue | Ages 3–5        |
| Sparks    | Red        | Grades K–2      |
| T&T       | Green      | Grades 3–6      |
| Trek      | Sky blue   | Grades 6–8      |
| Journey   | Slate      | Grades 9–12     |

Common alternate spellings (`Truth & Training`, `TNT`, `Cubbie`, …) resolve to the right club. Unknown club names still work — they just use the default Awana-orange palette.

---

## Privacy

This screen reads only four fields from each check-in payload:

- `firstName`
- `club`
- `isBirthday`
- `isFirstTimer`

Anything else your check-in system publishes (allergies, addresses, parent info, last names, photos) is **ignored and stripped out** before rendering. Nothing about a child's health or contact info can appear on the screen, even by mistake.

---

## Running locally (optional)

```bash
git clone https://github.com/<you>/<repo>.git
cd <repo>
npm install
npm run dev
```

Then open http://localhost:3000/.

Quality checks (these also run in CI and gate every deploy):

```bash
npm run lint   # ESLint (includes React hooks rules)
npm test       # Vitest unit tests
```

---

## Troubleshooting

- **Blank background where the PowerPoint should be.** Make sure you used the *Embed* URL from OneDrive, not the regular share link. The URL should contain `embed?`.
- **"not set up" / "disconnected" status dot.** "Not set up" means this screen is not signed in: Settings → Setup → **Sign in** with the church passphrase. "Disconnected" means it is signed in but cannot reach the sync service: check the network.
- **Banners don't appear even when your check-in system fires events.** Check that the screen shows "connected", then press the label printer dashboard's **Test Welcome Screen**. If a test banner appears but real check-ins do not, look at the printer's relay status.
- **No sound.** Browsers block audio until you interact with the page. Click anywhere or toggle the sound switch in Settings once.
- **Site shows "404" after deploy.** Open the **Actions** tab. If the build step is green but the page is still 404, make sure **Settings → Pages → Source** is set to **GitHub Actions**.

---

## License

MIT — **for the code only**. Use, fork, modify, display on as many screens
as you like.

The Awana name, club/program names, logos, mascots, and clipart appearing
in this repository are trademarks or copyrighted materials of Awana Clubs
International and are **not** covered by the MIT license. If you fork this
project for your own church, the bundled artwork requires your own written
permission from Awana (<permission@awana.org>) — details and a ready-to-send
request draft are in [TRADEMARKS.md](TRADEMARKS.md).

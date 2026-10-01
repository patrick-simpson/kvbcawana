# Awana® Check-in Display

> **NOT AFFILIATED OR ENDORSED BY AWANA CLUBS INTERNATIONAL.**
> This is an independent, non-commercial project built by a local church
> for its own club nights. Awana and the Awana club names are trademarks
> of [Awana Clubs International](https://www.awana.org) — see
> [TRADEMARKS.md](TRADEMARKS.md) before reusing anything here, especially
> the bundled club artwork.

**About page:** a plain-language tour of what this display does, for church leadership — <https://patrick-simpson.github.io/Awana-Check-in-Display/about.html>

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
- **Fully serverless** — no local server to run. Your check-in system publishes events to [Pusher](https://pusher.com) and this display subscribes to them over the internet.

---

## The presentation page (`/countdown.html`)

This repo also hosts the full **Awana Presentation Tool** as a second,
independent page — migrated here from the KVBC-Awana-Countdown repo. It
runs on the main projector during club night and automatically cycles
through a week-long countdown, the opening ceremony slides (welcome +
pledges), per-club game-time screens with live check-in counts and
birthday shout-outs, a closing slide, and a shutdown view — all driven
by a pure, tested schedule engine over `shared/schedule.json`.

- **URL:** `https://<owner>.github.io/Awana-Check-in-Display/countdown.html`
- **Source:** `src/presentation/` (fully isolated from the signage app;
  it shares only the sanitized Pusher socket and the device config store)
- **Time-travel QA:** append `?now=2026-09-16T18:04:00` (any ISO
  timestamp) to simulate a moment; the simulated clock still ticks.
- **Operator controls:** hover the top-right corner for the QuickNav
  menu (jump between views, set the Pusher key — birthdays sync
  themselves from the print server); Space/→ advance or skip, ←/PageUp
  go back, Esc twice exits a slideshow.
- **Shared data:** `shared/` at the repo root (schedule, club theme,
  art) is served at `/shared/` for the whole Awana app family. See
  `MIGRATION.md` for the plan to retire the old repo.

> **Running the displays on club night?** The step-by-step operator
> guide — pre-club checks, panic mode, the "screen is wrong at
> 5:55 PM" decision tree — lives in
> [docs/RUNBOOK.md](docs/RUNBOOK.md).

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

## 3. Get free Pusher API keys

Pusher runs the realtime pipe between your check-in system and this display. The free tier is plenty for a club.

1. Go to [pusher.com](https://pusher.com) and create a free account.
2. Click **Create app** → choose **Channels**.
3. Give it a name (e.g. `awana`) and pick the **Cluster** geographically closest to you (for most U.S. clubs, `us2`).
4. Open the app → **App Keys** in the sidebar. Note the two values:
   - `key` (a short hex string) — this is the **App Key**.
   - `cluster` (e.g. `us2`) — this is the **Cluster**.

> **Only ever use the `key` and `cluster` here.** The same page shows an
> `app_id` and a `secret` — those belong on the *publisher* (the print server),
> never in this repo. The secret allows publishing to your screens, so anyone
> who obtains it can put text on your projector.
>
> Note also that the App Key is **public by design**: this is a browser app, so
> the key ships to every visitor and anyone can subscribe to the channel with
> it. That is safe only because the payload contract is PII-free — see
> [SECURITY.md](SECURITY.md) for exactly what a subscriber can see.

## 4. Configure your app

Pick whichever is easier — most people use the Settings panel.

### Option A — the Settings panel (recommended)

Keeps the key in the browser's local storage on that device, so it never enters
your repository and is not inherited by anyone who forks it.

1. Open your deployed app (see step 6). A brand-new screen shows a slim
   **New display?** card along the bottom, beside the gear, with these same
   steps and an **Open Settings** button.
2. Or click the gear icon in the bottom-left corner (it stays faintly visible),
   or press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>.
3. A new screen opens Settings on **Setup** → **Connect this screen** → type the church's display passphrase
   (print-server dashboard → Settings → **Display login**) → **Log in**. That
   fills in the display key and the slide publish token by itself.
4. Only if the header says *Not set up*: open **Advanced — paste keys by
   hand** in the same section, paste the **Pusher App Key** and **Cluster**
   (every change in Settings applies as you make it; there is no Save), then
   log in. (A site built with the repository variables — Option C — already
   has these filled in.)
5. **Slides** section: the default is **Typed & published slides**, which shows the
   deck published from the check-in computer plus the calendar slides. Pick
   another source only if this screen should play its own PowerPoint or video.

Repeat once per screen. Settings only writes what you changed, so a screen
never pins the baked key or a central setting by accident.

### Option B — edit `src/config.js` (applies to every visitor)

Convenient if you run several screens and don't want to configure each one.
Understand the trade-off first:

- The key is **committed to your repository** and built into the deployed
  bundle, so it is readable by anyone who visits the site or views the repo, and
  it is **inherited by anyone who forks it**. For the App Key that is a
  disclosure you have already accepted by deploying a browser app (see the note
  in step 3) — but it does mean a fork of your repo starts out publishing to
  *your* Pusher app until its owner changes it.
- Never put the Pusher **secret** or **app_id** here. They are not needed by the
  display and must stay on the print server.

Open `src/config.js` on GitHub (pencil icon to edit in-browser) and fill in:

```js
pusherAppKey: 'abcdef1234567890',
pusherCluster: 'us2',
backgroundSource: 'powerpoint',
powerpointEmbedUrl: 'https://onedrive.live.com/embed?cid=…',
```

Commit the change. A new build deploys in about a minute.

> **Forking someone else's deployment?** Clear `pusherAppKey` in `src/config.js`
> and put your own church's key in, or you will be subscribed to their channel
> and showing their children's names on your screen. See
> [SECURITY.md](SECURITY.md).

### Option C — repository variables (recommended for a fleet)

Bakes the key into the build **without** committing it to the repository, so a
brand-new screen connects with nothing typed and a fork starts blank:

1. GitHub → your repo → **Settings → Secrets and variables → Actions → Variables**.
2. Add `PUSHER_APP_KEY` (the public `key`) and `PUSHER_CLUSTER` (e.g. `us2`).
3. Push anything (or re-run the *Deploy to GitHub Pages* workflow). The build
   reads them as `VITE_PUSHER_APP_KEY` / `VITE_PUSHER_CLUSTER`.

Use *variables*, not *secrets*: the App Key is Pusher's public subscribe key and
ships in every display's bundle anyway. Per-device Settings and `?key=` still
override the baked value (the layering lives in `src/hooks/useConfig.js`:
baked defaults < `?config=` file < this device's Settings < `?key=`).

### Logging a screen in (names, slides, publishing)

With Pusher connected, the one remaining step on each screen is the **display
login**. On the print-server dashboard, Settings → **Display login** →
**Generate** (it saves immediately). Then on the screen: gear → Settings →
Setup → **Connect this screen** → type the passphrase → **Log in**. The screen
receives the display key (children's names, published slides) and the slide
publish token by itself, and keeps following rotations made on the print
server. The print server must be running while a screen logs in. Pasting the
keys by hand still works under the same tab's **Advanced** section.

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
  title after any "` - `note" becomes a subtitle), or your own wording
  ("Welcome to Awana!") on regular nights. On non-club days it points to
  the next club night instead.
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
fetches, so a nightly GitHub Action (`.github/workflows/update-calendar.yml`
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

## 5. Point your check-in system at Pusher

**Using the [Awana Label Printer](https://github.com/patrick-simpson/Print-TwoTimTwo-Labels)?**
It broadcasts automatically: on its dashboard (`http://localhost:3456`) →
Settings → Pusher Integration, enter the same Pusher app's App ID, Key,
Secret, and Cluster, then click **Test Welcome Screen** — a "Test" banner
should appear here within a second. The exact payload the two apps
exchange is pinned down in [CONTRACT.md](./CONTRACT.md).

Any other check-in tool just needs to publish a `checkin` event on the `awana-channel` channel. Any Pusher server SDK works — Node, Python, PHP, etc. Node example:

```js
// In your check-in system, not this repo
const Pusher = require('pusher');
const pusher = new Pusher({
  appId:   'YOUR_APP_ID',     // from Pusher → App Keys
  key:     'YOUR_APP_KEY',    // same key you put in the display
  secret:  'YOUR_APP_SECRET', // keep this private, never commit it
  cluster: 'us2',
  useTLS:  true,
});

pusher.trigger('awana-channel', 'checkin', {
  firstName:    'Olivia',
  club:         'Sparks',
  isBirthday:   false,
  isFirstTimer: false,
});
```

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
https://<your-github-username>.github.io/<repo-name>/?overlay=1&key=YOUR_APP_KEY&cluster=us2
```

- `key` / `cluster` — your Pusher app key and cluster in the URL, since
  embedded browsers can't open the settings panel. The key is Pusher's
  public subscribe key, safe to put in a URL.
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

The Debug panel is how you test without publishing any real Pusher events — click "Standard welcome", "Birthday welcome", or "Trigger 5 simultaneous" to see the exact same animations real check-ins trigger.

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
- **"disconnected" status dot.** Double-check the App Key and Cluster in Settings. Both must match your Pusher app exactly. The cluster is usually 3–4 lowercase letters/digits (e.g. `us2`, `eu`).
- **Banners don't appear even when your check-in system fires events.** In the Pusher dashboard, open your app → **Debug Console**. If events show up there but not on your screen, the channel name or event name is wrong — it must be channel `awana-channel`, event `checkin`.
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

# Roadmap

The plans for the Awana screens and check-in, one section per track. Each track has the owner's decisions (dated), what exists today, the design, the status, and what is still to do. Read a track's status before you touch the code it names.

Tracks: [Settings page](#settings-page) · [Online check-in](#online-check-in) · [Cloud check-in](#cloud-check-in) · [Online only](#online-only) · [KVBC Awana one app](#kvbc-awana-one-app) · [Switch-day cleanup](#switch-day-cleanup)

## Settings page

Owner request, 2026-10-11: "move all of the settings to the lobby settings page
... a new page /settings that handles everything. The browser print dashboard
should live there, everything. When people go to the extension's settings, it
should just direct them to this URL. The URL should also handle settings on
the local device like printer selections and diagnostics." A redesign is
welcome. This is the plan; its status is at the end of this track.

### The owner's decisions (2026-10-11)

| Question | Decision |
| --- | --- |
| A screen's own settings (this TV's chime, motion, what plays behind the names) | **Managed from /settings for every screen.** Each screen registers under a name ("Lobby TV", "Gym projector"); /settings lists them and changes any of them from any device, and the screen applies it within seconds. |
| When the old pages give way | **Each part as soon as it is ready** (BARF Night or not). Each switch is tested before it goes live. |

### What exists today (the places settings live)

| Place | Who reads it | What it holds |
| --- | --- | --- |
| Lobby TV, Settings panel (`lobby/src/components/SettingsPanel.jsx`, 8 sections) | that TV | shared settings (sync service, contract v6) and that TV's own (localStorage overrides) |
| Projector menu (`lobby/src/presentation/views/QuickNav.jsx`, touch sheet) | that projector | its display settings, skip weeks |
| Journey kiosk Settings | that kiosk | room settings (sync service) and its own |
| Label printer dashboard (`printer/print-server/public/`, localhost:3456) | the check-in laptop | printer, backup printer, label templates, phone PIN, pickup clubs, schedule, history and reprints, diagnostics (/health) |
| Chrome extension options and popup (`printer/chrome-extension/`) | the laptop's Chrome | mode, printer pick, links to the dashboard |
| Sound room app Settings window (`lobby/desktop/`) | the sound room PC | screen, monitor, shutdown, start with Windows |

### The design

- **One page, one sign-in.** `/settings` is a new entry of the lobby app (a
  third HTML entry beside index.html and countdown.html), signed in with the
  church passphrase like any screen. Same kit, same live apply, Undo and Done.
- **Shared settings** (everything SHARED_SPEC holds, the slides, the template,
  Journey's room settings, cloud check-in, BARF Night, release notes) work
  from any device, through the sync Worker, as today.
- **Screens.** Each lobby TV, projector and Journey kiosk registers with the
  Worker (`POST /v1/screens/hello {id, kind, name}`; the id is made once and
  kept in the screen's own storage) and gets its own settings from it
  (`screen:<id>` in the Worker; a doorbell on the live channel says "yours
  changed"). The screen applies them as its device overrides, so nothing about
  how a TV renders changes. /settings lists the screens (name, kind, last seen,
  online) and opens the SAME Settings panel for any one of them, reading and
  writing that screen's settings in the Worker instead of local storage.
  Actions that act on a screen itself (preview a check-in, reset tonight's
  counter, the pickup demo) are sent to it the same way.
- **The laptop.** Opened on the check-in laptop, /settings also finds the
  print server on `http://localhost:3456` (an https page may call localhost)
  and shows its parts: printer and backup printer, label templates, phone
  PIN, pickup clubs, schedule, history and reprints, and diagnostics (/health).
  Opened anywhere else, those parts say "open this on the check-in laptop".
  The laptop's own dashboard and the extension's options point to /settings;
  the dashboard stays as a plain fallback for a night with no internet.
  (Superseded 2026-10-12, [Online only](#online-only): the dashboard is gone,
  every one of its tools is in the Laptop section, and with no internet the
  desk still prints and nothing else changes.)
- **Privacy and safety stay as they are**: the display key and sessions never
  in config, the shared settings through their allowlist, a screen's settings
  through VALIDATORS, the print server's PIN gate for anything off the laptop.

### Phases (each its own change, tested, live when ready)

1. **The page.** `/settings`: sign-in, the shared sections, Cloud check-in,
   BARF Night, release notes; the lobby TV's own Settings keeps working.
2. **Screens.** The Worker's screen registry and per-screen settings; lobby
   TVs register and follow; /settings edits any lobby TV. Then the projector
   and Journey.
3. **The laptop.** The print dashboard's parts in /settings through localhost;
   the extension's options and the dashboard point to /settings.
4. **The sound room app** and the last per-device bits; the old panels shrink
   to a "Settings moved" card linking to /settings.

### P5: how the Worker names children without reading history (2026-10-12)

The Worker never holds the history key, so it cannot read a name from history, yet the
pickup board names first names and a greeting names a child with a birthday or a milestone.
Chosen, safest first, all on the free plan:

- **Still-here list: the Worker keeps tonight's FIRST names and clubs, sealed, for the night
  only.** One AES-GCM blob under the state key (HKDF from the TwoTimTwo password secret, like
  the watcher's snapshot and the claims' tags): from the applied report (clubber id, first
  name, club) and the desk's rows (first name, club; a visitor's HMAC tag stands in for a
  surname). Never a last name, birthday or note. Purged with the claims when the watch window
  closes; written only on a change; kept only while `SINGLE_PUBLISHER` is on (the shadow
  night's counts need ids and clubs only). It is the second sealed-names exception after the
  friend list, and the Worker already sees these names in memory for every child it prints or
  greets, so it adds an at-rest copy, not a reader. Rejected: the station publishing the
  still-here list (a laptop that sleeps or restarts mid-night would leave the pickup board
  stale, and a list built from its jobs would miss every child already on the report).
- **Greeting: the print station.** It opens the job and holds the roster and the history key,
  so it alone can say birthday, first-timer, welcome back or milestone. It publishes the
  sealed `checkin` through `POST /v1/publish` with `X-Station` and `X-Job`; the relay's
  `SINGLE_PUBLISHER` gate lets exactly one greeting per print job through (the job is marked
  `greeted`) and drops every other `checkin`. The Worker greets nobody itself.
- What the Worker cannot know it is told, plaintext and non-personal: the station posts the
  Screen season, the rehearsal flag and the pickup list's clubs (`POST /v1/station/extras`);
  the laptop's dropped `tonight` frame hands over the books and awards counts.

Full contract: `lobby/worker/src/routes.md` section 8.

### Status and hand-off

- 2026-10-11: plan written (this track).
- 2026-10-11: **Phase 1 built.** `lobby/settings.html` is a third Vite entry
  (the signage bundle, flagged by `<meta name="awana-page" content="settings">`;
  `isSettingsPage()` in `configureRelay.js`), served at `/lobby/settings` with
  `/settings` 302ing there (`site/build.mjs`). It is configure mode plus
  `SettingsPageContext`: a `scope="screen"` card is left out unless marked
  `keep` (Sign in, Typed & published slides), the Tools card, the template
  button, the advanced key fields and every button that acts on a screen
  (Preview a check-in, Reset tonight's counter, the board demo) are gone, the
  pill and footer speak of the sign-in, and it opens on Setup until signed in.
  `e2e/settings-page.spec.js` pins it. The lobby TV's own Settings is unchanged.
- 2026-10-11: **Phase 2 built** (lobby TVs and projectors; Journey left, below).
  - **Worker** (`lobby/worker/src/screens.js`, routes in `sync.js`, API in
    `worker/README.md`): `POST /v1/screens/hello`, `GET /v1/screens`,
    `GET/PUT /v1/screens/<id>/settings`, `PUT .../name`, `POST .../action`,
    `DELETE /v1/screens/<id>`, all behind the session. At most 40 screens,
    2 KB of settings each; online = a hello in the last 3 minutes or a live
    socket tagged with the screen's id (`/v1/live?...&screen=<id>`). The one
    allowlist is `SCREEN_SPECS` in `lobby/src/lib/syncSpecs.js` (lobby: the
    template keys plus `cornerClub` and `showTonightTicker`; projector:
    `lowPower`, `stingers`; journey: `playbackQuality`; computer, for v9
    ([KVBC Awana track](#kvbc-awana-one-app)): `printRole`, `displayRole`, `displayFrom`,
    `displayUntil`), never a shared key, a Pusher key, panic mode, the deck or
    a fleet URL (`screenSpecs.test.js`). A change, rename or action rings
    `changed` `{what: 'screen' | 'screen-action', id}` on the live channel
    only, never replayed.
  - **Lobby TV** (`useScreenSync`, `lib/screenSync.js`): registers when signed
    in and not in configure mode or embedded in Journey; id and last agreed
    copy in `awanaScreens.v1`; the Worker's newer copy replaces the
    allowlisted part of the device layer through `replaceConfig`, a change on
    the TV goes up 1.5 s later. Named in Settings → Setup ("Lobby TV", or "OBS
    overlay" for an overlay feed).
  - **/settings**: a Screens section after Status (`SCREENS_SECTION`,
    `sectionsFor(page, {remote})`). A lobby TV opens in the same panel
    (`RemoteScreenPanel`, `RemoteScreenContext`): its "This screen" cards come
    back tagged "<name> only" and write to the Worker; cards about this
    browser (`PanelCard local`) stay out; shared cards only while it follows
    the shared settings; its Status is the TV (on or off, rename, forget,
    Preview a check-in, pickup demo, Reset tonight's counter). A projector's,
    kiosk's or computer's switches are edited in its row.
    `e2e/settings-screens.spec.js`.
  - **Projector** (`useProjectorScreen` in `presentation/App.jsx`): the same hook,
    Low power and the chimes as its layer, a wall pick or Resume obeyed;
    `useScreenSync.js` joined the isolation allowlist on purpose.
  - **TODO, Journey** (not built): Journey has no live socket, so it would
    follow by its hello alone. In `journey/public/src/sync.js`: keep the id in
    the same `awanaScreens.v1` slot under `journey` (one origin, the lobby's
    format), POST `/v1/screens/hello {id, kind: 'journey'}` every 2 minutes
    while signed in and not in configure mode, reconcile `playbackQuality`
    with `journey.playback.quality` against `synced` exactly as
    `reconcileScreen` does, and apply through the same function
    `LIVE_STORAGE_KEYS[PLAYBACK_QUALITY_KEY]` runs (a same-window write fires
    no `storage` event); add a case to `test/sync.test.mjs`. /settings
    already lists and edits a Journey kiosk in its row.
  - **For the owner**: a forgotten screen that is still running comes back at
    its next hello (by design); and a change made on /settings while the TV
    has an unsent change of its own wins over it.
- 2026-10-11: **Computers follow too** (KVBC Awana 9.0.0, branch
  `kvbc-awana-v9-settings`; [KVBC Awana track](#kvbc-awana-one-app) "On /settings"): the app says
  hello as kind `computer` every 2 minutes and takes its row's switches and
  hours; a hello may carry `pendingRoleChange` (a print-off held until the
  last label prints), which the Worker keeps on the record and the row shows.
- 2026-10-11: **Phase 3 built** (printer 8.3.0; not released, no dispatch).
  Inventory below; what was built and what is still the owner's call after it.

- 2026-10-12: **Settings overhaul, Track C built (the lobby UI; `docs/SETTINGS-OVERHAUL.md`).**
  The page's rail is seven sections (Tonight, Screens, What screens show, Slides &
  look, Printing, History, Account & app); a TV's own panel lists four, a screen
  opened from the page three; the old rail is behind `?rail=classic` (deleted the
  release after Wednesday) and every old section id still resolves
  (`LEGACY_TABS`). Tonight has mission control (the Worker's overview polled
  every 10 s, plus the last five FIRST NAMES from the live frames, in memory
  only), the online check-in switches, the notice composer (`durationSec` on the
  `notice` event, screens hide it by themselves, 0 takes it down) and recent
  changes with Undo. Slides & look has ONE Season control (two writes). The
  live TV preview draws the real components in a scaled 1600x900 stage under
  zero animation. Printing works from any device through the Worker's church
  document and sealed tool jobs, with one collapsed "At the laptop" card for
  localhost. Removed: the display login, the display key fold, the publish
  token, "Other screens", the duplicate season and sign-in, the stale cloud
  check-in card. Waiting on Track A (the Worker's routes) and Track B (KVBC
  Awana 9.3.0): until they land the cards say "arrives with its next update".

#### Inventory: every setting and tool, and where it lives now

*As of phase 3 (2026-10-11). The "dashboard only" rows are historical: the
dashboard was retired on 2026-10-12 and each of them was moved or removed, see
the [Online only](#online-only) inventory.*

The print dashboard (`printer/print-server/public/index.html`, localhost:3456)
and the Chrome extension (`chrome-extension/`). The extension's options page
and popup held no settings of their own (6.26.0 moved the printer pick to the
dashboard); the check-in page's panel shows the printer read-only and holds
the Step Up Night / Awana Store Night switches, which stay there.

| Setting or tool | Routes | On /settings (Laptop) |
| --- | --- | --- |
| Name tag printer, backup printer | GET /printers, GET and POST /config | yes |
| Label footer, visitor palette, trophy band, connect card (+ auto, greeting) | POST /config | yes |
| Per-club label layout, with preview | GET and POST /config/label-templates, GET /preview | yes |
| Pickup clubs | POST /config `pickupClubs` | yes |
| Club schedule, late grace | GET and POST /config/schedule | yes |
| Screen season | POST /config `seasonTheme` | yes |
| Print history and reprint | GET /history/today, POST /reprint | yes |
| Diagnostics, system status | GET /diagnostics, GET /health, GET /failures | yes (diagnostics, status and warnings) |
| Test label (Test Night Systems) | POST /canary | yes |
| Clear print queue, test tune | POST /printer/clear-queue, POST /play-tune | yes |
| Phone PIN, Wi-Fi access for phones, driven check-ins | POST /config | **dashboard only** (see below) |
| Display key, display login, Pusher keys, publish token, sync sign-in | POST /config, /config/*/generate, /config/sync-* | **dashboard only** |
| Check-in URL, fleet config URL, allowed origins, history retention | POST /config | **dashboard only** |
| Rehearsal mode | POST /rehearsal | dashboard only (it changes every print and every screen) |
| Reprint a stretch, leader tags, custom label, one-off tag, attendance audit, lobby slide publish, extension folder path | various | dashboard only (not settings; left where they work) |
| Extension: popup status, Settings button, options page, "Printing to Change" link | GET /health (popup) | now open /settings |

#### How the page reaches the server

`security.js` holds one exact origin (`https://awana.kvbchurch.org`, not
`displayOrigins`, which still lists the archived github.io), a route table
(`SETTINGS_PAGE_ROUTES`) and the keys POST /config takes from the page
(`SETTINGS_PAGE_CONFIG_KEYS`: the printer's own, never a secret, the network
switch or the CORS list). `corsPolicy` answers the preflight for those routes
only, with `Access-Control-Allow-Private-Network: true` when Chrome asks.
Every route but `/health` needs a loopback socket and either the page's sync
sign-in (`Authorization: Sync <session>`, which the print server confirms with
the sync service at `/v1/state` and remembers by its hash for 10 minutes;
owner, 2026-10-11: "passphrase sign-in is enough") or the publish token; what passes is marked
`req.settingsPage`, which the four printer routes that were "dashboard on this
computer only" (templates, clear queue, test tune, POST /config) accept next to
`isTrustedConfigOrigin`. The secret-holding routes never look at the mark.
`scripts/test-settings-page.cjs` pins all of it (91 checks).

The lobby's Laptop section (`laptop.jsx`, `lib/printServer.js`) probes
`/health` only when opened, so Chrome's local-network prompt, if it shows one,
comes from a click and not from page load. Not found, it says "Open this page
on the check-in laptop to set the printer" and lists what it would show.

#### Left for the owner

- **The token** (decided 2026-10-11): signed in to /settings with the
  passphrase is enough; the publish token stays as a fallback, folded away.
- **(Superseded 2026-10-12, see [Online only](#online-only).) Phone PIN and the keys stay on the dashboard.** The PIN protects the
  roster on the Wi-Fi and the token's blast radius was chosen small (slides
  and settings); letting a page set the PIN or the display key would widen it.
  Say so if you want them on /settings anyway (it would need a separate
  confirmation credential).
- **Real Chrome.** Preflight and Private Network Access are pinned with
  headers in tests; not seen in a real browser here. Chrome 142+ replaces PNA
  with a Local Network Access permission prompt for a public page calling the
  laptop: allow it once; test on the laptop before relying on it.

## Cloud check-in

Owner request, 2026-10-11: "make this application so that the check-ins just
happen in a cloud computer, and everything can be done without the check-in
laptop existing", through Cloudflare, with labels still printing at church.
This is the plan; the status of each part is under "Status and hand-off" at
the end. Each phase lands on its own and the laptop keeps working until the
last one.

**Superseded from phase 2 on by [Online check-in](#online-check-in) (owner,
2026-10-11):** the print station is KVBC Awana's print role (no pairing step),
history lives in D1 encrypted to the history key, and TwoTimTwo's read budget
is one read every 5 s, all reads combined (not the 15 s below; the Worker keeps
to one every 15 s while the laptop's extension tab still reads, owner
2026-10-12: see the terms row under Online check-in). Phase 1 and
the phone page's cloud check-in stand as built.

### The owner's decisions (2026-10-11)

| Question | Decision |
| --- | --- |
| Where are check-ins made? | **Anywhere.** Our phone page and touch screen check in through Cloudflare, and a check-in made on TwoTimTwo itself (its site or app, on any device) is noticed and still gets a label. |
| Allergy and medical notes (they print on labels) | **Sealed on arrival.** Cloudflare fetches TwoTimTwo's roster and locks it at once with a key only the church print station holds. Cloudflare stores it but cannot read it. |
| Which TwoTimTwo login | **A new, dedicated check-in user**, made by the owner. Its password lives only in GitHub's secret store and Cloudflare's, never in chat or the repo. |
| What prints at church | **A Raspberry Pi**, always on, with the label printer on USB. |

### Today, and what changes

Today every TwoTimTwo action happens in Chrome on the check-in laptop. The
extension rides the volunteer's logged-in session, posts check-ins and undos,
reads the check-in report and the roster CSV, and hands the print server what
it needs. A phone check-in goes phone → sync Worker relay → laptop print
server → extension → TwoTimTwo, and the label prints on the laptop's printer.

After the move:

```
 phones, touch screen ──┐                         ┌── lobby TVs, projector, Journey
                        ▼                         │   (unchanged: the live channel)
              ┌──────────────────────────┐        │
              │  Cloudflare (sync Worker)│────────┘
              │  · TwoTimTwo session      │◀──── TwoTimTwo site/app check-ins
              │  · check in / undo / out  │      (seen by watching the report)
              │  · report watcher (15 s)  │
              │  · sealed roster          │
              │  · print-job queue        │
              └────────────┬─────────────┘
                           │  print jobs (outbound connection from church)
                           ▼
              ┌──────────────────────────┐
              │  Raspberry Pi at church  │  opens the sealed roster with its own
              │  · label renderer (as now)│  key, renders the label exactly as the
              │  · CUPS → label printer   │  laptop does today, prints, says done
              └──────────────────────────┘
```

Nothing at church needs to be reachable from the internet: the Pi connects out
to Cloudflare, the same way the TVs do.

### The pieces

#### 1. The TwoTimTwo client (in the sync Worker)

Everything it needs is already mapped in `printer/docs/TWOTIMTWO.md`:

- **Sign in:** `GET /site/login` for the CSRF token, `POST /site/login` with
  `LoginForm[username]`, `LoginForm[password]`, `Login=1`. The session cookie
  is kept in the Durable Object. Before each burst of work it is checked with
  the cheap probe (`/clubber/ajaxSearch?text=zz` answers `Login Required` when
  it has expired) and it signs in again if it must.
- **Tonight's meeting:** `GET /clubber/checkin` gives `#calendar_id`, the
  `events[]` items with their club scopes, and the roster rows (first and last
  name, clubber id, club). Read fresh each night, and again whenever TwoTimTwo
  refuses a post (the extension does the same).
- **Check in:** `POST /clubber/checkinclubber` with `clubber_id`,
  `calendar_id` and the applicable `events[]` (Attendance always). The extension's
  rule for a real success carries over: a short snippet naming the child,
  never a page or the login form.
- **Undo:** `POST /clubber/checkinclubberundo`; success is exactly
  "(checkin undone)", then the report must stop listing the child.
- **Check out:** the existing youth check-out (`POST /clubber/checkout`, an
  exact "OK").
- **Visitors:** `/clubber/register?default_visitor=Y`, as the extension does.

The parsers already exist and are tested in the printer folder (the report
parser in `chrome-extension/feeds.js`, `validateCheckinReportBody`, the CSV
reader). They move to one shared module the Worker and the Pi both import,
rather than being written a second time.

#### 2. The report watcher ("anywhere")

During the club window (`shared/schedule.json`, from an hour before to the
tally grace after, the same window the printer ticks in today), a Durable
Object alarm reads `/clubber/checkin_report?date=today` every 15 seconds and
compares it with the last read:

- a child who is new on the report and was not checked in by us is a check-in
  made on TwoTimTwo directly: queue their label and greet them on the TVs;
- a child who left the report was undone on TwoTimTwo: stop counting them.

This is the cloud form of the extension's roster-diff detector, and it keeps
its safety rules: a report that parses fewer children than its own `Count:`
footers is partial and changes nothing, and a read that would drop most of the
room at once is refused (the mass-undo guard). The report is also the count:
`tally`, `tonight` and the pickup list are published from it, as the printer's
`authoritativeTonight()` does today.

Cost: about 720 report reads on a club night, plus the phones' calls. That fits
the Workers free plan (100,000 requests a day) many times over.

#### 3. The sealed roster

Labels print allergies, the no-photo mark, birthdays and first-time stickers,
which come from the roster CSV (`/clubber/csv`). The Worker reads it once at
the start of each club night (and on demand when an unknown child checks in)
and seals it straight away with the **print station's public key**
(ECDH P-256 + AES-256-GCM, Web Crypto on both sides). Only the sealed copy is
stored; the Pi holds the private key and is the only thing that can open it.
The Worker keeps nothing else from it: label jobs carry only the clubber id,
the first name, the club and the events checked.

So the plaintext roster exists in Cloudflare only in memory, between
TwoTimTwo's reply and the seal, the same moment it exists in the laptop's
Chrome today.

#### 4. The print station (Raspberry Pi)

- Raspberry Pi 5 (4 GB) with a good power supply and a small SSD or
  high-endurance SD card, the label printer on USB (a DYMO LabelWriter 450 is
  supported by CUPS on Linux: `printer-driver-dymo`). Wired Ethernet if the
  room has a jack.
- Runs the print server's label renderer unchanged (`generateLabel()`, the
  brand kit, the golden-tested layout). Only the last step changes: the PNG
  goes to CUPS (`lp -d <printer> -o media=…`) instead of PowerShell
  `System.Drawing`. Headless Node under systemd, restarted if it stops.
- Connects out to the Worker's live channel as a **station** (its own
  credential, paired once with the church passphrase), opens the sealed
  roster, and takes print jobs: render, print, report done or failed. A job
  stays queued in the Durable Object until the station says it printed, so a
  Pi reboot or a dropped connection never loses a label.
- Reports its printer's state (online, out of labels, jammed) so the phone
  page and the TVs' status sticker can say "the label printer needs help",
  as the laptop's `/health` warnings do today.
- A small local page on the Pi (church Wi-Fi only) for setup: pick the
  printer, print a test label.

#### 5. Phones and the touch screen

`awana.kvbchurch.org/checkin` keeps its look and its routes; they are
answered by the Worker instead of relayed to the laptop. The roster for
picking a child comes from tonight's check-in page (names, clubs, ids; no
medical data). The touch screen becomes the same page on a tablet or any
browser at the desk. Remove, Undo check-in, Check out, one-off tags and
custom labels keep their meaning; the print ones become print jobs.

#### 6. The screens

Unchanged for the TVs, the projector and Journey: the same sealed `checkin`,
`recap`, `checkout` and plain `tally` / `tonight` frames on the same live
channel, now published by the Worker (which already holds the display key and
seals the `settings` and `slides` frames). The privacy invariant does not move:
first names only, sealed, through each event's own allowlist sanitizer.

### Privacy and safety

- The dedicated TwoTimTwo user's password: GitHub secrets
  `TWOTIMTWO_USERNAME` / `TWOTIMTWO_PASSWORD`, written to the Worker by the
  deploy step the way `SYNC_PASSPHRASE` is. Never logged, never returned.
- Nothing medical is readable in Cloudflare at rest (sealed roster above).
- Every phone action still needs the church passphrase session; the check-in
  routes keep their allowlist and their per-action rules (undo only with a
  clubber id, the 90 s claim lease becomes the job queue's lease).
- TwoTimTwo is closed and unpublished. If it changes a page, the parsers'
  drift checks fail loudly, the phone page says check-in is unavailable, and
  volunteers check in on TwoTimTwo directly: the report watcher still prints
  their labels as long as the report parses.
- TwoTimTwo has agreed (below): an automated user, reading every 15 seconds,
  everything encrypted. Whether they block cloud addresses shows on the first
  shadow night (`lastError` on the status).

### When something breaks on a club night

| Failure | What happens |
| --- | --- |
| TwoTimTwo down | Nothing can check in anywhere (as today). Paper sheet (`/clubber/checkin_form`), keyed in later. |
| Our check-in path broken, TwoTimTwo fine | Check in on TwoTimTwo's own page or app; the watcher still queues labels. |
| Cloudflare down | Check in on TwoTimTwo directly; no labels until it is back (jobs are created when the watcher next reads the report). Keep a roll of blank name tags and a marker. |
| Pi or printer down | Jobs wait in the queue and print when it is back; the phone page and the TVs say so. |
| Church internet down | The Pi cannot get jobs. Same as today's laptop without internet: TwoTimTwo itself is unreachable too. |

During the move the old laptop stays installed as a spare: if a night goes
wrong it can be started and used exactly as before.

### Phases

Each phase is a separate change with its own tests, run in **shadow** beside
the laptop on a club night before anything depends on it.

0. **Owner:** create the dedicated TwoTimTwo user (check-in permissions only)
   and add `TWOTIMTWO_USERNAME`, `TWOTIMTWO_PASSWORD` (and `TWOTIMTWO_HOST`,
   `kvbchurch.twotimtwo.com`) as GitHub secrets; get the Pi, power supply,
   storage; confirm the label printer's exact model; ask TwoTimTwo the
   question above.
1. **Read-only watcher.** Worker signs in, reads tonight's report and the
   check-in page, and logs what it would publish (counts and detected
   check-ins) without publishing. Shadow night: its numbers must match the
   laptop's `authoritativeTonight()`.
2. **Print station.** Pi image and the headless print server with CUPS,
   pairing, the sealed roster, the job queue. Shadow night: a test label for
   every detected check-in on a second printer, compared with the laptop's.
3. **The Worker publishes** `tally`, `tonight`, the pickup list and the
   greetings (laptop's publishing turned off for the night).
4. **Check-in writes.** Phone page and touch screen check in, undo, check out
   and register visitors through the Worker.
5. **Switch night.** The laptop stays home (kept as the spare); the extension
   and the relay are retired afterwards.

### What Claude sessions can and cannot do here

The parsers and every request are built and tested against captured shapes
(selectors and column names only, never real data, per `TWOTIMTWO.md`).
Sessions do not sign in to the live TwoTimTwo site; every live check is the
owner's shadow night, with a test child and an undo.

### Status and hand-off

Read this first if you are picking the work up in a new session.

- **Plan and decisions:** this track (owner, 2026-10-11).
- **TwoTimTwo's agreement:** granted by **Devin at TwoTimTwo**, reported by
  the owner on 2026-10-11. Its terms: automated check-ins through Cloudflare
  are allowed **as long as everything is encrypted**; reads **every 15
  seconds** are fine; and **TwoTimTwo will not give technical support** if
  anything goes wrong with the process. So the Worker never reads faster than
  every 15 s (`READ_INTERVAL_MS`, a manual read included), every request is
  https, the password and session cookie are never stored, and what is stored
  holds no names and seals its ids. Because there is no vendor support, the
  laptop stays as the spare, and the paper sheet stays the fallback. If the
  permission ever needs showing, file the email (or note how it was given)
  here.
- **Built (2026-10-11): phase 1, the read-only watcher.** In the sync Worker:
  `lobby/worker/src/twotimtwo.js` (sign-in, the report and check-in page
  parsers, which a test runs against the extension's own parser on the same
  pages) and `lobby/worker/src/watcher.js` (the 15 s alarm in the club
  window, the partial and mass-undo guards, the sealed state). It publishes
  nothing; `GET /api/v1/cloud/status` (signed in with the passphrase) shows
  its counts, and `POST /api/v1/cloud/read-now` reads once on any day for a
  rehearsal. `CLOUD_CHECKIN = "shadow"` in `wrangler.toml`; `"off"` stops it.
  Tests: `lobby/worker/test/twotimtwo.test.js`, `watcher.test.js`.
- **Checked against the live site (2026-10-11):** the secrets are set and the
  dedicated user signs in. Read as that user, the report for 2026-10-07 gave
  all 94 children its Count: footers declare (Sparks 23, T&T 22, Trek 22,
  Cubbies 16, Puggles 8, Journey 3), and the check-in page read (meeting
  374, 5 check-in items). Two fixes it took: pages go through parse5 so
  rows without a <tbody> are found as Chrome finds them, and this user's
  report has no edit link per row, only the undo control (`undoCheckin(id)`),
  which now identifies the child. Still to do: the shadow night itself,
  holding the Worker's count against the laptop's on a Wednesday.
- **Phase 4, the phone page, built early (owner, 2026-10-11).** A test
  check-in of one child through the Worker worked on the live site (and was
  undone). awana.kvbchurch.org/checkin now checks in through the Worker, laptop
  on or off, with Bible and Brought a friend as ticked (item labels read off
  TwoTimTwo's check-in page, each sent only for the clubs it applies to). With
  the laptop on, the Worker tells it to print the tag at once (printer 8.0.0's
  job route; one tag a night, see printer/CLAUDE.md); with it off the child is
  checked in with no tag, and the roster and Tonight come from TwoTimTwo.
  Undo, check-out, visitors and custom labels still go to the laptop.
  `CLOUD_CHECKIN = "off"` puts the check-in back on the laptop.
- **BARF Night, 2026-10-14 (owner).** Who brought a friend is recorded in the
  Worker (`lobby/worker/src/friends.js`: child, club, the friend's first name,
  sealed per night, deleted after three days) from the cloud check-in and from
  the laptop (printer 8.1.0, every check-in path). `GET /v1/cloud/friends` is
  the report grouped by club; `POST /v1/cloud/friends-link` makes the one
  read-only link (`GET /v1/cloud/friends-report?token=`, that night only,
  until noon the next day) that a scheduled Claude run reads at 6:30 pm to
  email the owner. The BARFED tag is the printer's (printer/CLAUDE.md).
- **To start the shadow night:** add the three GitHub secrets, then **Actions
  → CI → Run workflow** with "Redeploy the sync Worker" ticked (a Worker only
  gets new secrets when it deploys). Before Wednesday, on any lobby screen signed
  in with the passphrase, open Settings → Setup → Cloud check-in → **Test
  TwoTimTwo sign-in** (it calls `POST /api/v1/cloud/read-now` with
  `{test: true}`, which reads the most recent club night's report, because
  on any other day the report has no club tables; a pass names that night's
  count, to hold against the laptop's, and an unreadable page is described
  by its title and table counts, never its text). On the
  night, compare its `checkedIn` and `byClub` with the laptop's dashboard
  (the laptop takes checked-out children off; this does not yet). Watch for
  `lastError`, `partial` and `massUndoRefused`. One risk to watch: the
  Workers free plan allows 10 ms of CPU per run, and each read parses the
  report; if runs are cut off, `lastReadAt` stops moving.
- **Built so far (printer 7.19.0):** the Linux print path the Pi needs.
  `printer/print-server/cups.js` prints through CUPS and reads printer state
  from `lpstat`; it is switched on with `AWANA_PRINT_BACKEND=cups` (plus
  `PRINTER_NAME` set to the CUPS queue). Tested with stand-in `lp` / `lpstat`
  (`scripts/test-cups.cjs`, `scripts/test-cups-server.cjs`); not yet on a real
  Pi or printer.
- **Not built yet:**
  - the Pi image and its service (Node, the print server headless under
    systemd with the two variables above, CUPS with `printer-driver-dymo`),
    the station's pairing with the Worker, the print-job queue and the sealed
    roster (pieces 3 and 4);
  - the watcher's later phases: check-outs off the count, printing a label
    for each check-in it finds (needs the station), and publishing;
  - the phone page and touch screen answered by the Worker (piece 5), and the
    Worker publishing the screens' frames (piece 6).
- **Owner's to-do (phase 0):** the dedicated TwoTimTwo user and its GitHub
  secrets (`TWOTIMTWO_USERNAME`, `TWOTIMTWO_PASSWORD`, `TWOTIMTWO_HOST`), then
  the Worker redeploy above; the Pi hardware; the printer's exact model; and
  changing the password that was posted in a chat on 2026-10-11 (the
  dedicated user should have its own, never that one).

## Online check-in

Owner, 2026-10-11, after an Opus review of the design. **Status: P0
(foundation) built; P1 to P7 not started.** This track **supersedes [Cloud
check-in](#cloud-check-in) phases 2 and later** (that track's phase 1, the
read-only watcher, and the phone page's cloud check-in stay as built) and the
**"No internet" line of [Online only](#online-only)**. Read "Status and
hand-off" at the end before you build a phase.

The goal: retire the Chrome extension. Check-in happens on **our desk page**
(awana.kvbchurch.org, any browser at the desk, signed in with the passphrase),
with **TwoTimTwo's own page as the fallback**; **KVBC Awana's print role prints
every job it pulls from the Worker**; and a **Cloudflare D1 history** keeps
every night with children's names encrypted, so neither the Worker nor
Cloudflare can read them at rest.

### Project-wide rule: everything free, forever

Every piece runs on a free plan, now and later: Cloudflare Workers FREE (10 ms
of CPU per request, 100,000 requests a day), Durable Objects and D1 on their
free allowances, GitHub Actions' free minutes and 0.5 GB of storage. So **all
encryption, decryption and key derivation happen in clients** (the browser
desk page and /settings, the KVBC Awana app), never in the Worker. The Worker
routes, stores ciphertext and keyed-hash identifiers, and does only cheap
hashing (SHA-256, HMAC). A design that needs a paid plan is not this design.
(Also in the root `CLAUDE.md`.)

### The decisions (owner and Opus review, 2026-10-11)

| Question | Decision |
| --- | --- |
| The passphrase | Clients derive `K = PBKDF2-SHA256(normalized passphrase, salt from the Worker, iter)` with iter in [600000, 2000000] (600000 for new wraps), then HKDF-SHA256 splits it: `authKey` (info `kvbc-auth-v1`) and `wrapKey` (info `kvbc-history-wrap-v1`). Clients send only `authKey`; the Worker stores SHA-256(authKey) and never receives the passphrase. This closes the fast-hash weakness of today's `HMAC(salt, passphrase)`. |
| Moving off the old hash | The first v2 login after the deploy sends `{passphrase, authKey}` once and upgrades the stored verifier; old clients keep signing in with the old hash until every client has updated (the first v2 passphrase change, or the owner's switch, deletes it). OBS / ProPresenter links keep their `?passphrase=`: the page computes `authKey` in the browser. `lobby/worker/src/routes.md` §1. |
| Passphrase strength | Unchanged (six characters minimum). The owner accepts the risk; SECURITY.md says so. |
| History key | ECDH P-256. `history:pub` in the Durable Object, first writer wins, replaceable only by an explicit re-key flow (none is built: **no rekey button**). The private key is wrapped with `wrapKey` (AES-GCM, a fresh 16-byte PBKDF2 salt per wrap) as `history:wrapped {v, salt, iter, iv, ct}`, served only to signed-in sessions. Clients unwrap it into a NON-extractable key and check it belongs to `history:pub`. |
| Passphrase change | The client re-wraps, unwraps the new wrap to prove it, and submits `{newAuthVerifier, newWrapped}` in ONE atomic multi-key put; the Worker keeps `history:wrapped:prev` for 7 days. **No recovery code: lose the passphrase, lose the history** (owner). |
| Row sealing | ECIES per row: a fresh ephemeral P-256 key; ECDH x → HKDF-SHA256(salt = epk ‖ fp(recipientPub), info `kvbc-hist-v1`) → AES-256-GCM, random 96-bit IV; AAD = `hist1:` ‖ rowId ‖ night ‖ kind ‖ epk ‖ kid. Wire `{v, kid, epk, iv, ct}`. Plaintext padded to one size (1024 bytes) so lengths leak nothing; the time is inside; row ids are random. Fail closed: no sealed form, nothing written. |
| Stations | **No pairing step** (owner): any computer signed in with the passphrase may register a station key pair (ECDH P-256, private key in Electron safeStorage; the app refuses the station role when safeStorage is unavailable). Medical notes (allergies) are sealed **only** to station keys, never to the history key. Rosters, completed books and print jobs are sealed to every registered station (the same ECIES, info `kvbc-station-v1`, AAD prefix `stn1:`). |
| Identifiers | The Durable Object never stores a plaintext clubber id: claims and job ids are keyed by HMAC(stateKey, night‖clubberId) (watcher.js's state-key approach); a visitor without an id by HMAC(stateKey, night‖normalized name‖club). The night is the church's LOCAL date (America/New_York, `localTime()` / TwoTimTwo's meeting date), never UTC. Claims are purged at the end of the night. |
| BARF friend list | **Stays as is** (owner, 2026-10-12): sealed under the Worker-derived key (3-day retention), readable by the Worker only so it can send the 6:30 pm email. It does NOT move under the history key. |
| TwoTimTwo's terms | Names may be stored, encrypted. Read budget: **one read every 5 seconds, all reads combined** (replaces the 15 s). **Owner 2026-10-12: while the laptop's extension tab still reads TwoTimTwo (about 3 reads a minute), the Worker makes at most ONE read every 15 s, all its reads combined** (`READ_INTERVAL_MS` 15000 in `lobby/worker/src/readbudget.js`; back to 5000 when the tab is retired). The 4 slots a minute: the report every 30 s, the other slot to the roster's check-in page (30 s fresh), the Checkout page (once a minute after 7:15 pm) and a households catch-up when an unknown child appears (routes.md section 7). A desk check-in, undo or check-out reads nothing: the check-in page is kept for the night (routes.md section 5). |
| No internet | **The paper sheet** (TwoTimTwo's `/clubber/checkin_form`), keyed in when the internet is back. This replaces Online only's "check-in still prints at the desk": with the extension retired, nothing at church checks in or prints offline. |
| BARF on the TwoTimTwo-page fallback | When the report marks Brought a friend, the station prints a BARFED tag **without the friend's name** (TwoTimTwo's box has no name field). |
| Printing | **At most once.** The station journals every jobId it spooled; a retried job it already spooled acks `already-spooled` without printing and the Worker flags "check the printer" (the label may not have come out). |
| Publishing | **One publisher: the Worker.** In cloud mode the relay drops the laptop's `tally` and still-here frames, so two counts never fight on the screens. |
| Tonight's count | **One shared `authoritativeTonight()` module** imported by both the Worker and the printer (a generated CommonJS copy for the printer, like `cloud-crypto.js`), not a port of the printer's function. |

### How the pieces fit

```
 desk page (browser, signed in) ─┐   derives keys, seals the history row and the
 TwoTimTwo's own page (fallback) │   print job before it posts; the Worker never
                                 ▼   does key work
              ┌────────────────────────────────────┐
              │ sync Worker (free plan)            │  claims/jobs keyed by HMAC(stateKey, night|id)
              │ · TwoTimTwo writes, 1 read / 15 s  │  history:pub, history:wrapped (DO)
              │ · print-job queue (leases)         │  history_rows, night_summary (D1, HISTORY_DB)
              │ · the ONE publisher to the screens │
              └───────────────┬────────────────────┘
                              │ leases (outbound from church)
                              ▼
              ┌────────────────────────────────────┐
              │ KVBC Awana, print role = station   │  station key in safeStorage; opens jobs and
              │ · prints EVERY job, at most once   │  the sealed roster (allergies) with it
              └────────────────────────────────────┘
```

### Phases

Each lands on its own, tested, and runs in shadow beside today's path before
anything depends on it. "Builder" is who writes it (a Claude session unless
said); "Owner" is what only the owner can do.

| Phase | What | Builder | Owner |
| --- | --- | --- | --- |
| **P0** Foundation | `lobby/shared/cloud-crypto.js` (+ generated `printer/print-server/cloud-crypto.js`), `cloud-vectors.json` and its three test suites, the D1 schema (`lobby/worker/migrations/0001_history.sql`), the route contract (`lobby/worker/src/routes.md`), SECURITY.md, the 5 s read budget in the watcher. | Claude (done 2026-10-12) | Read and approve; create the free D1 database (`wrangler.toml` has the steps). |
| **P1** Passphrase v2, history key, one read clock | `/v1/auth/params`, v2 / upgrade / legacy login, v2 passphrase change (atomic put, `history:wrapped:prev` 7 days), `GET/PUT /v1/history/key`; every client (lobby `syncService`, the printer's `sync-client.js`, the KVBC Awana wizard, Journey) derives `authKey` and the first one creates the history key; every TwoTimTwo read in the Worker on ONE 5 s clock (the phone page's back-to-back reads included). | Claude: Worker + lobby, then printer (release) | Watch `auth:legacyLastAt`; turn the legacy login off. |
| **P2** Desk page + history rows | The desk page (`/desk`, lobby build): roster, check in, undo, check out, visitors, a sealed history row with every action; `/v1/desk/*`, `/v1/history/rows`, `night_summary`; claims keyed and purged nightly. | Claude: lobby + Worker | Bind `HISTORY_DB`; try the desk page on a test child. |
| **P3** Stations | KVBC Awana's print role registers a station key (safeStorage, refused without it); `/v1/station/*`; the roster CSV read through the Worker and sealed by the station to every station; completed books. | Claude: printer (release) + Worker | Install on the check-in laptop (and any second printer). |
| **P4** Print lease | The station leases and prints EVERY job from the Worker, journals jobIds (at most once, "check the printer" on a retried spooled job), reports printer state; the desk page and TVs show it. | Claude: printer (release) + Worker | Shadow night: every label printed from a lease, compared with the extension's. |
| **P5** One publisher, one count, the fallback | The shared `authoritativeTonight()` module (Worker + generated copy for the printer); the Worker publishes `tally`, `tonight`, the pickup list and the greetings; the relay drops the laptop's tally / still-here frames in cloud mode; TwoTimTwo-page check-ins found by the watcher become jobs (BARFED tag without the friend's name); the watcher seals each such job to the stations itself (`sealForStations`) and the station writes the history row when it prints. | Claude: lobby/shared + Worker + printer | Shadow night: the Worker's count against the laptop's. **Built (2026-10-12, not released):** step 1 `lobby/shared/tonight.js` (+ `printer/print-server/tonight.js`) and `shared/pickup.js`; step 2 the Worker publishes (`publisher.js`); step 3 the station greets; step 4 BARFED on the fallback. Design below. |
| **P6** History | History and summary views in /settings (unwrapped in the browser); `POST /v1/history/import` of the laptop's past nights, sealed by the KVBC Awana app. | Claude: lobby + Worker + printer | Look over the history and summary views. **Built (lobby + Worker half):** `worker/src/history.js`, `historyCrypto.js`, the History section; the printer's import of the laptop's past nights is not. |
| **P7** Switch | Retire the Chrome extension (and the relay's laptop paths it served); the paper-sheet drill; remove the legacy hash; docs and SECURITY.md final. Never on a Wednesday. | Claude + owner | Pick the night; keep the paper sheet and blank tags at the desk. |

### Status and hand-off

- **P0 built (2026-10-12).** The module's API is documented at the top of
  `lobby/shared/cloud-crypto.js` and in `lobby/shared/README.md`; the route
  shapes in `lobby/worker/src/routes.md`; what is and is not protected in
  `lobby/SECURITY.md` ("Online check-in history"). The only behaviour that
  changed is the watcher's read clock (5 s, and it waits out any other read
  its session made).
- **Open questions for the owner:**
  - **Decided (owner, 2026-10-12): the 6:30 pm BARF email keeps the existing
    Worker exception.** The friend list stays sealed under the Worker-derived
    key (readable by the Worker, 3-day retention) just for the email;
    `friends.js` does NOT move under the history key. P6 therefore writes no
    friend rows for the email and builds no client-side reader for it.
  - **Decided (owner, 2026-10-12): check-ins made on TwoTimTwo's own page.**
    The Worker (the watcher) seals the print job to the registered stations
    itself with `sealForStations` (ECDH P-256 in WebCrypto is native and cheap
    enough for the free plan's 10 ms of CPU), and the station writes the
    history row when it prints. Measured in
    `lobby/worker/test/cloudCrypto.test.js` (Node, not workerd, so an upper
    bound on the work and not the Worker's own figure): about 4.2 ms per job
    sealed to 3 stations (about 1.4 ms per station). Check the real figure in
    the Worker's logs on the shadow night, and note the station count it was
    sealed to.
  - **Worker core built (2026-10-12):** the phone page's reads, the desk's and the
    watcher's now all take a slot on the one read clock (`readbudget.js`; 15 s
    while the extension tab still reads, owner 2026-10-12); the watcher reads its
    report every 30 s and reserves its slot. Stations, the print lease, the
    claim ledger, the desk claim API and the watcher's claim rules are in
    `lobby/worker/src` (routes.md sections 4 to 7, marked BUILT). Still open for
    the owner: `CLOUD_PRINT` and `SINGLE_PUBLISHER` stay `"off"` in
    `wrangler.toml` until the shadow night (P5 publishes the tally itself, built), and
    the desk's sealed history row is validated but stored only once the history
    module (P6) registers its hook.
  - **P1 + P4 + P6 + P2 merged and reconciled (2026-10-12).** One print lease
    contract (`GET /v1/print/next`, `POST done|failed|heartbeat`, 90 s, the
    heartbeat extends it; no aliases); one job record
    `{route, body, clubberId?, gen?, source?}` from the desk page AND the watcher;
    the gen comes from the lease; history mounted in the Worker (hooks, key
    re-wrap, outbox flush), D1 bound, one row-kind vocabulary, ts in epoch ms; the
    relay drops the laptop's greeting under `SINGLE_PUBLISHER` and the Worker greets
    once. `printer/scripts/test-cloud-e2e.cjs` proves one label per check-in, no
    duplicate, a re-print after undo, no reprint after a lost ack, ciphertext only.
    **Still open before the switch:** the release of the print role (version bump and
    changes.md: server.js, job-puller.js and events.js changed in P5); the shadow night
    with `SINGLE_PUBLISHER = "on"`.
  - **Desk page built (2026-10-12, the desk-page task P3; ROADMAP's "P2 Desk page" row;
    merged into /checkin the same day, see "ONE check-in page" below):**
    awana.kvbchurch.org/desk, `site/desk/` (`index.html`, `desk.js` the screen,
    `desk-transport.js` every Worker call and every seal, `desk-page.mjs` injects
    the touch check-in's own touch-core block from `phone.html` so search, "did you
    mean" and families are exactly the phone's and the laptop's). `site/build.mjs`
    serves it with a copy of `lobby/shared/cloud-crypto.js` beside it. Signed in
    with the passphrase (passphrase v2: `authKey` derived in the browser, never
    stored; the history key is unwrapped once to prove it and its `pub` pinned in
    `awanaDeskHistoryKey.v1`; the session is the screens' own slot). All sealing is
    the browser's: the print job to the stations (resealed on `stations-changed`),
    the history row to the history key. Shows printed / queued / check the printer
    (`GET /v1/print/status`) and the tonight count (`GET /v1/desk/tonight` when P5
    has it, else the roster's); 429 is "busy, try again in Ns". Worker additions:
    `GET /v1/desk/families` and `items` on the roster. `lobby/e2e/desk.spec.js` and
    `site/test/desk-*.test.mjs` pin it. Not built: a `/desk/ym` page (the youth
    leaders have `/checkin/ym`), friend rows via `POST /v1/history/rows` (the
    friend's name rides the sealed check-in row and the sealed job), and the
    leader tag and custom label of the phone's + menu.
  - **Passphrase v2 built (2026-10-12):** the Worker (`GET /v1/auth/params`, `authKey`
    login, the one upgrade login, the old login kept until `AUTH_LEGACY = "off"`, v2
    change in one atomic put) and EVERY client: the lobby screens, projector and OBS
    links, Settings' change, the desk and phone pages, Journey, the print server and
    the Electron wizard sign in through `signInWithPassphrase`
    (`lobby/shared/sync-protocol.js`) with `deriveAuthKey` (`cloud-crypto.js`). The desk
    page seals the job as `{route: '/print', body, clubberId, source: 'desk'}` and rows
    of kind checkin / visitor / undo / checkout. Open: watch `auth.legacyLastAt` in
    `GET /v1/cloud/status`, then set `AUTH_LEGACY = "off"` and later delete the legacy
    code (routes.md section 1). Not measured on a real Pi Zero: expect 1 to 3 s once
    per sign-in.
  - **P5 built (2026-10-12, not released).** One count: `lobby/shared/tonight.js`
    (generated copy `printer/print-server/tonight.js`) is the printer's AND the
    Worker's `authoritativeTonight()` / `tonightHereNow()`, with the partial-report and
    mass-undo rules; `lobby/shared/pickup.js` the still-here list. With
    `SINGLE_PUBLISHER` on the Worker publishes `tally`, `tonight` and the sealed
    still-here list from its own state (it keeps tonight's first names + clubs sealed
    for the night: see "P5: how the Worker names children" above), the relay drops the
    laptop's frames and lets one station greeting per print job through (birthday,
    first-timer and milestone are back), and a TwoTimTwo-page child the report marks
    Brought a friend gets the BARFED tag (station-side `isBarfNight()`, no friend's
    name). Tests: `lobby/shared/tonight.test.js`, Worker `publisher.test.js`,
    `adopt.test.js`, `twotimtwo.test.js`, printer `test-tonight-shared.cjs`,
    `test-station-greeting.cjs`, `test-barf.cjs`, and `test-cloud-e2e.cjs` (the real
    print server behind the puller: one greeting per check-in, the tally, the list).
    Known gap for P7: the extension's youth check-out sweep posts to the laptop only
    (closed by the Worker's youth check-out below once `YM_CHECKOUT` is on).
  - **Youth check-out in the Worker (2026-10-12, not released; `YM_CHECKOUT = "off"`).**
    `lobby/worker/src/ymcheckout.js` runs the extension's Trek/Journey sweep from the
    watcher's alarm with exactly its rules (club nights 7:15 pm to midnight, the
    Checkout page's own POST, exact "OK", 3 tries, a done list), from the watcher's
    latest report (no report read of its own; the Checkout page at most every 60 s),
    at most ONE post every 15 s (owner), each child off the Worker's count. A print
    station's `/config/church` turns the extension's sweep off; `stopCloud` hands it
    back. Owner: set `YM_CHECKOUT = "on"` before (or with) the station role, and
    release the print server change. routes.md section 9.
  - **ONE check-in page (owner, 2026-10-12).** awana.kvbchurch.org/checkin is the phone
    page (`printer/print-server/public/phone.html`: its look, search, families, Bible and
    Brought a friend with the friend's first name, the + menu, Tonight) on the desk's
    online path: passphrase v2, the Worker's desk routes (claim, TwoTimTwo's post,
    settle: never printed twice), the label sealed to the stations and the history row
    to the history key in the browser (`site/checkin/desk-transport.js`), the print
    status line, the paper-sheet note when there is no internet. One-off, leader and
    custom labels are sealed reprint jobs; a visitor is a desk visitor check-in. The
    friend's first name also rides the check-in to the 6:30 BARF list (`friendName`,
    routes.md section 5), as the phone path sent it. `/checkin/ym` is the same page
    for Trek and Journey (check-in only). `/desk` 301s to `/checkin/`; `site/desk/` is
    gone (its transport moved to `site/checkin/`). Back by the owner's call (same day): "Not here the last two club nights",
    rebuilt in the browser from the sealed history (the last two earlier nights, opened
    with the history key held NON-extractable in memory after a passphrase sign-in;
    D1 reads only, lazy, silent without a key), and the remembered leader chips, read
    from and added to the church settings `leaders` (routes.md 10.3; chips appear once
    that route and key land). Left with the laptop (they read its data): Remove/Add back
    of a TwoTimTwo child, the laptop's count check. Visitors and
    who this page checked out are kept per tab for the night, as the desk did.
    `lobby/e2e/checkin.spec.js`, `site/test/checkin-page.test.mjs`.
  - **Same day, later (owner, branch `late-barf`, not released).** (1) A tap queues the
    child ("Checking in…", two at a time in tap order); "Checked in ✓" only after
    TwoTimTwo confirms; busy = "Waiting for TwoTimTwo… Ns" and an automatic retry;
    a refusal reverts that tile alone; undo and check-out ride the queue. (2) "Walk-in
    name tag" replaces the one-off tag and the visitor check-in (one-off route: greeted,
    never counted; Tonight lists "walk-in · not registered yet"). (3) The green BARF
    button (BARF nights only): a friend who came with a child already checked in =
    ONE Worker operation `POST /v1/desk/barf-late` (routes.md 5.1: the child held on
    the report across TwoTimTwo's undo and redo, only the BARF tag printed, the friend
    on the 6:30 list and the bags; a failed redo offers a one-tap re-check-in). The
    tag's own route `/print-barf-tag` needs printer 9.3.1; a 9.3.0 station gets a
    "BARFED! <first>" custom label. (4) `/checkin/ym` gets all of it (walk-in tag for
    Trek and Journey, its own Tonight with Undo check-in, no Check out).
  - **`/checkin/classic`: DELETE after Wednesday 2026-10-14.** The relayed phone
    page exactly as /checkin served it on 2026-10-12 (`site/checkin/classic.html`,
    a frozen copy, pinned by its SHA-256 in `site/test/checkin-classic.test.mjs`),
    with `/checkin/classic/ym`, kept as the one-night fallback while /checkin moves
    to the desk's online path. After 10/14 delete the file, its block in
    `site/build.mjs` (and its two `must` entries) and the test.

## Online only

Owner decision, 2026-10-11. **Status: built 2026-10-12 (not released: no version bump, no `changes.md` entry, no dispatch).**

The laptop keeps its own check-in and its own label path. What moved is the laptop's web surface: its print dashboard (`localhost:3456`) and its Wi-Fi phone page (`http://<laptop-ip>:3456/phone`) are gone. Its tools are on awana.kvbchurch.org/settings (Laptop section), its phones use awana.kvbchurch.org/checkin, and the print server answers only the computer it runs on.

### The owner's decisions (2026-10-11)

| Question | Decision |
| --- | --- |
| The laptop's print dashboard (`localhost:3456`) | **Retired.** Its remaining tools move into awana.kvbchurch.org/settings. The Settings track's inventory marks which are dashboard-only today. |
| The laptop's Wi-Fi phone page (`http://<laptop-ip>:3456/phone`) | **Retired.** Phones use awana.kvbchurch.org/checkin. |
| No internet | ~~Check-in still prints at the desk.~~ **Superseded by [Online check-in](#online-check-in) (2026-10-11): the paper sheet.** No phones and no settings changes until the internet is back. |

### What this changed in the other tracks

- The Settings track said the dashboard "stays as a plain fallback for a night with no internet". This track superseded that line: with no internet nothing is changed from a phone or a settings page, and ~~the desk still prints~~ the desk uses the paper sheet ([Online check-in](#online-check-in), which supersedes the "still prints" wording). The extension's options card now says so instead of linking to a dashboard.
- The Settings track left the phone PIN, the display key and the sync sign-in on the dashboard. The PIN is gone with the Wi-Fi phone page (nothing to protect), the display key is installed by the sync sign-in (the manual generate, copy and clear buttons went with the Pusher design), and the sync sign-in moved to the Laptop section with the model below.
- The Wi-Fi phone page was turned off without waiting for a Worker phase: phones already reach custom labels, one-off tags, leader tags, undo and check-out through the Worker's relay (`phone-relay.js`, the phone page's own calls) while the laptop is on, and check-in itself is the Worker's ([Cloud check-in](#cloud-check-in) phase 4).

### Status

- 2026-10-11: decided by the owner.
- 2026-10-12: **built.** In order, one commit each.
  1. The inventory (below).
  2. The tools moved into `lobby/src/components/settings/laptop-tools.jsx` and `laptop.jsx`, each through a new row in `SETTINGS_PAGE_ROUTES` with its check in `printer/scripts/test-settings-page.cjs` written first: leader tags (`/print-leader`, `/leaders`, `/leaders/forget`), one-off tags (`/print-oneoff`), custom labels (`/print-custom`), a stretch reprint (`/reprint-range`, a dry run and then a confirm), the attendance audit (`/attendance-audit`, apply needs `confirm`), rehearsal mode (`/rehearsal`, with a confirm), print failures, the switches `updateBeacon`, `enableDrivenCheckin` and `musicalPrinter`, and this computer's sync sign-in (`/config/sync-login`).
  3. The dashboard and the LAN phone page retired: `print-server/public/index.html` deleted; `/phone` and `/phone/ym` removed; the server binds 127.0.0.1 only and a loopback gate refuses any other socket (the PIN gate, rate limiter, `resolveBindHost`, `lanAccess`, `AWANA_BIND_HOST` and the config's `allowedOrigins` are gone; "our own page" in the CORS rule is a loopback host); `GET /` answers a tiny page that links to /settings; the app's firewall button, "Phones" address and LAN IPC are gone and its tray and status window open /settings; the extension's popup and options point only there. `phone.html` and its `site/build.mjs` step (`/checkin`) are untouched.
  4. Tests, `printer/CLAUDE.md`, the printer docs, `lobby/CLAUDE.md`, the public site's claims and this file.
- **Secrets.** The display key, the publish token and the display login are never read, minted or set from the page (their routes are not in the table; POST /config refuses their keys from it). The sync sign-in keeps the model the page already used: the page's sync session, confirmed by the print server with the sync service it is already configured for (`config.syncUrl`, which a dropped sign-in keeps, so a computer signed out by a passphrase change can be signed back in from the page's own fresh session). The page then sends only the passphrase, and the print server signs in to `config.syncUrl`, never an address the page names. A computer with no service on record is signed in by the app's setup wizard ("Set up this computer...", the same route with no Origin). Sign-out is removed.
- **Not moved, on purpose.** The check-in URL stays in the app's setup wizard (it is handed to the Windows shell). The extension folder stays in the tray ("Open Chrome extension folder"; the path holds the Windows user name). Tonight at a glance, the roster count, the welcome-screen privacy card, the count check card, the update banner and "Update now", and the what's-new card were read-only monitoring or duplicated elsewhere (the screens show the count, `/health`'s warnings carry every fault, the app updates itself every 10 minutes, the release notes are a /settings card): they went with the page.

### Inventory (2026-10-12): every dashboard feature, and where it goes

Read off `printer/print-server/public/index.html` (every `fetch` it makes) against `security.js` (`SETTINGS_PAGE_ROUTES`, `SETTINGS_PAGE_CONFIG_KEYS`). The page may use a route only if the table lists it; a route that should take the page next to the dashboard calls `isTrustedOrSettingsPage`, one that holds a secret or opens the network keeps `isTrustedConfigOrigin` alone.

| Dashboard feature | Routes it calls | Today | Decision |
| --- | --- | --- | --- |
| Name tag printer, backup printer | GET /printers, GET and POST /config | in /settings | kept there |
| Label footer, visitor palette, trophy band, connect card, greeting | POST /config | in /settings | kept there |
| Per-club label layout and preview | GET and POST /config/label-templates, GET /preview | in /settings | kept there |
| Pickup clubs, schedule, late grace, screen season | POST /config, GET and POST /config/schedule | in /settings | kept there |
| Print history, single reprint | GET /history/today, POST /reprint | in /settings | kept there |
| Diagnostics, status and warnings, test label, clear queue, test tune | GET /diagnostics, GET /health, POST /canary, POST /printer/clear-queue, POST /play-tune | in /settings | kept there |
| Leader tags (print, remembered leaders, forget) | POST /print-leader, GET /leaders, POST /leaders/forget, GET /clubs | dashboard only | **move** (new routes) |
| One-off name tag | POST /print-oneoff | dashboard only | **move** (new route) |
| Custom label | POST /print-custom | dashboard only | **move** (new route) |
| Reprint a stretch | POST /reprint-range | dashboard only | **move** (new route) |
| Attendance audit | GET /attendance-audit, POST /attendance-audit/apply | dashboard only | **move** (new routes) |
| Rehearsal mode | POST /rehearsal | dashboard only (`isTrustedConfigOrigin`) | **move**, with a confirm; the page's sync sign-in is the proof |
| Print failures tonight | GET /failures | route allowed, not drawn | **move** (drawn in the status card) |
| Musical printer, update beacon, driven check-ins | POST /config `musicalPrinter`, `updateBeacon`, `enableDrivenCheckin` | musical key allowed, no switch; the others dashboard only | **move** (two new keys, three switches) |
| Sync sign-in (this computer's own) | POST /config/sync-login, /config/sync-logout | dashboard only | **move sign-in** (the page's confirmed session; the address is fixed to the one this computer already uses, never one the page names); sign-out is **removed** (a laptop leaves the service by turning its print role off) |
| Phone check-in PIN | POST /config `phonePin` | dashboard only | **removed** (no LAN phone page) |
| Wi-Fi access for phones, LAN bind, PIN gate, firewall button, "Phones" address | POST /config `lanAccess`, `resolveBindHost`, the auth gate, the app's `enable-phone-checkin` | dashboard, app, server | **removed** (the server listens on loopback only) |
| Allowed origins | POST /config `allowedOrigins` | no control on the dashboard | **removed** from the page's reach (it existed for the LAN phone page) |
| Display key (generate, copy, clear) | POST /config `displayKey`, /config/display-key/generate | dashboard only | **removed**: the sync sign-in installs the service's key and is the only pipe; the warnings now say "sign this computer in" |
| Publish token, lobby slides paste-and-publish | POST /config/slides-token/generate, GET and POST /api/lobby-slides | dashboard only | **removed**: the slide editor on /settings publishes through the sync service; a token already on the laptop still works as the page's fallback proof |
| Check-in URL | POST /config `checkinUrl` | dashboard only | **kept in the app's setup wizard** ("Set up this computer..."), not on /settings: it is handed to the Windows shell |
| Extension folder path | GET /health `extension.folder` (loopback only) | dashboard only | **kept in the tray** ("Open Chrome extension folder"); the path holds the Windows user name and is never sent to a web page |
| History retention, fleet config URL | POST /config | no control on the dashboard | unchanged (config only) |
| Tonight at a glance, roster count, welcome-screen privacy card, count check, update banner and "Update now", what's new | GET /stats/tonight, /roster-status, /reconcile, /whats-new, POST /update-now | dashboard only | **removed** (read-only monitoring: the screens show the count, /health's warnings carry every fault, the app updates itself every 10 minutes, release notes are a /settings card) |
| Extension popup, options page, "Printing to Change" link | GET /health | open /settings | the offline "dashboard" fallback link goes |

### Still to do

1. ~~**Confirm on the laptop, with the internet off, that check-in still prints at the desk.**~~ Dropped: with no internet the fallback is the paper sheet ([Online check-in](#online-check-in), 2026-10-11).
2. **Real Chrome.** The Laptop section's calls to `http://localhost:3456` are pinned with headers in tests and stubbed in `e2e/settings-laptop.spec.js`; open /settings on the laptop and allow Chrome's local-network prompt once. Every settings tool now depends on it.
3. **Release.** Nothing is released: the version, `changes.md` and the dispatch are the owner's. The first release that carries this removes the dashboard and the LAN page from every laptop at once, so tell the volunteers the phone address changed to awana.kvbchurch.org/checkin.
4. Left alone because another change owns it: the display-login screens in the lobby still tell a person to read the passphrase "on the print-server dashboard" (`SetupChecklist.jsx`, `QuickNav.jsx`, `settings/fields.jsx`); that flow is the retired Pusher design.

## KVBC Awana one app

Owner request, 2026-10-11: "combine the sound room executable with the print
software. It should be one software for the whole thing. There should be a
setting on first install that configures the device as a display or print
server. There should be another space in the unified settings page to change
that." Ship it as v9, once the /settings work in progress ([Settings track](#settings-page)) is in.

### The owner's decisions (2026-10-11)

| Question | Decision |
| --- | --- |
| Name | **KVBC Awana** (Start menu, tray, installer). |
| Roles | **Print server, display, or both** on one computer: two switches. |
| First run | **A full wizard**: role, the church passphrase, a name for the computer, then the printer (print server) and/or the screen and monitor (display). |
| Display hours | **Club nights, hours per computer in /settings**, default 5:00 to 8:00 pm, the sound room app's club-night rule otherwise (cancelled weeks and summer stay dark). |
| Updates | **Always right away**, club night or not (the sound room's rule). |
| The old sound room app | **Replaced automatically**: its last update installs KVBC Awana as a display with its screen, monitor, hours and shutdown carried over, then removes "Awana Lobby Display". |
| Changing a role in /settings | **From any device, signed in, with a confirm**; turning off a print server is refused while it is printing. |
| Existing installs | A computer with the label printer stays a print server and never shows the display; a computer with the sound room app becomes a display. |

### How (engineering calls)

- **The printer's Electron app is the base** (`printer/electron-app/`): it
  keeps its `appId`, so the check-in laptop upgrades in place from the printer
  feed (`/updates/printer/`) and keeps its data; only its display name becomes
  KVBC Awana. Its print server runs only when the print role is on.
- **The display is the sound room app's main process** (`lobby/desktop/src/`:
  club nights, visibility, monitors, screens, shutdown, configure window)
  moved in as a module that runs only when the display role is on. Its pure
  modules and their tests move with it.
- **Migration.** An upgraded printer install has no role file: it is a print
  server, display off. The sound room app's last release (`lobby` feed)
  downloads and silently installs KVBC Awana with a hand-off file (role
  display, its state.json settings), and KVBC Awana removes the old app on
  first start. Both feeds then point at KVBC Awana's releases.
- **Version 9.0.0** for KVBC Awana (the printer's line continues: 8.x → 9.0.0).
- **/settings**: each computer registers as a device (Phase 2's screen
  registry, kind `computer`) with its roles, hours and name, editable there.

### Status

- 2026-10-11: decisions recorded (this track). Waiting on [Settings track](#settings-page) phases 2
  and 3, which are being built now.
- 2026-10-11: **built, not released** (branch `kvbc-awana-v9`): printer
  9.0.0 is KVBC Awana and the sound room app 2.1.0 is its bridge. Not pushed:
  it lands after the /settings work, then the two releases below.
- 2026-10-11: **/settings, the release workflow and the download link built**
  (branch `kvbc-awana-v9-settings`, on `kvbc-awana-v9`; not pushed, nothing
  released): every computer is a row on /settings (below, "On /settings"),
  a print-off waits for the last label (`isBusy()`), `printer-release.yml`
  builds and smoke-tests KVBC Awana, `/download/kvbc-awana` exists and the
  signage's Setup card links it.
- After the sound room PC shows on /settings as a KVBC Awana computer: remove
  lobby/desktop and /download/lobby-display (owner, 2026-10-11).

### How it is built (9.0.0)

All in `printer/electron-app/` unless named; `printer/CLAUDE.md` ("KVBC
Awana") has the rules.

- **Identity.** `build.productName` "KVBC Awana", installer
  `KVBC-Awana-Setup.exe`, shortcuts "KVBC Awana". `name`
  (`awana-label-printer`), `appId` and the feed are unchanged, and there is no
  top-level `productName` (Electron would move userData to it):
  `test/roles.test.cjs` pins all of that.
- **Roles** (`src/roles.js`): `roles.json` in userData, `{print, display,
  name, setupDone}`, decided once on the first v9 start and written: a saved
  file, else the hand-off (display), else printer data in userData (print
  server, display off, setup done: the check-in laptop), else new (the
  wizard). `checkRolesChange` is the one check for a change, `applyRoles` in
  main.js the one path; print off restarts the app.
- **The display** (`src/display/`): the sound room app's pure modules and
  their tests (node:test now, `npm run test:app` in printer/, part of
  `npm test`), and `display.js`, its main process as `createDisplay()` with
  start/stop. Hours per computer: `settings.hours` (default 17:00-20:00), in
  the wizard and its Settings window. Its files are in
  `userData\display\`; its profile is still `persist:lobby`.
- **Updates**: every 10 minutes, installed right away for every role; the
  display marks the relaunch quiet (`prepareInstall`).
- **The wizard** (`src/setup-wizard.js`, `static/setup.html`,
  `static/setup-preload.cjs`): role, passphrase, name, printer, screen +
  monitor + hours. The session is `sync-session.bin`, safeStorage-encrypted
  (`src/sync-session.js`); the passphrase is held in memory only until the
  wizard closes, to sign the print server in too.
- **The hand-off**: `%APPDATA%\awana-label-printer\handoff.json` (KVBC
  Awana's own userData). Written by the sound room app 2.1.0
  (`lobby/desktop/src/handoff.js`) once the printer feed is 9.0.0 or later; it
  then runs the installer with `/S --force-run` and quits. KVBC Awana applies
  it (`src/handoff.js`: the display's state.json, a quiet first start, the old
  `persist:lobby` profile copied over, Start with Windows) and keeps it as
  `handoff.done.json`; `src/old-app.js` then runs Awana Lobby Display's
  uninstaller (its uninstall key, GUID `fb4f7b93-33d6-55b2-a7fe-6244a2d4f44d`,
  else `%LOCALAPPDATA%\Programs\awana-lobby-display`) and deletes its login
  item, retrying each start until it is gone.
- **On /settings** (`src/device-sync.js`): set up and signed in, a computer
  is the Worker's screen kind `computer` under `roles.json`'s `deviceId`
  (made once). At start and every 2 minutes (no live socket) it POSTs
  `/v1/screens/hello` and GETs its settings: `printRole`, `displayRole`,
  `displayFrom`, `displayUntil`, reconciled against the last agreed copy
  (`device-sync.json`) as a lobby TV does. A change from /settings goes
  through `applyDeviceSettings` in main.js (the display's `configure` for
  the hours, `checkRolesChange` + `applyRoles` for the roles: the wizard's
  and `roles:set`'s path; print off restarts the app); a change made here
  (the wizard, the display's Settings window) is PUT up within seconds.
  Renames go both ways. Its bearer is the wizard's session, else on a print
  server the print server's own sign-in (config.json), so the 8.x laptop is
  listed without the wizard. 401: it stops, the tray says "signed out", and
  it resumes when a different session appears.
- **Never off mid-print.** `print-server/server.js` exports `isBusy()` (a
  printing request still open, a job on the printer chain, a stretch
  reprint, or a phone check-in not yet driven). A /settings print-off while
  busy is held: everything else applies, the hello carries
  `pendingRoleChange` (the Worker keeps it on the computer's record, the
  /settings row says "print server off once the last label prints", its
  confirm says it waits), and it applies once the server is idle. The same
  `isBusy()` now gates an update's install (capped at a minute).

### Done since (branch `kvbc-awana-v9-settings`)

- **The release workflow.** `printer-release.yml` ("Release KVBC Awana")
  carries the `KVBC-Awana-Setup` artifact, finds `KVBC Awana.exe` and fails
  unless it is in `%LOCALAPPDATA%\Programs\awana-label-printer` (the 8.x
  folder) from `KVBC-Awana-Setup.exe`, runs and stops the process `KVBC
  Awana`, and after /health and /preview checks that the seeded laptop wrote
  `roles.json` as print server, display off, setup done; the release is
  titled KVBC Awana. `desktop-release.yml` works for 2.1.0 as it was (its
  `--smoke-test` launch skips the hand-off and the updater); only its
  release text changed.
- **Downloads.** `site/lib/downloads.js`: `/download/kvbc-awana` and
  `/download/club-label-printer` are both the newest installer
  `printer/latest.yml` names (the regex takes `KVBC-Awana-Setup.exe`;
  `site/test/downloads.test.mjs`); `/download/lobby-display` stays the
  sound room app's. The signage's Settings → Setup card is now "KVBC Awana
  for Windows", linking `/download/kvbc-awana`; the app's repair dialog
  downloads from it too.
- **/settings**: the `computer` row and the print-off hold (above).

### Still to do

1. Land after /settings phases 2 and 3; merge the printer version (8.3.0 is
   on another branch: this is 9.0.0 on top of it).
2. Release order: printer 9.0.0 first (the laptop updates), check it on the
   laptop, then sound room 2.1.0 (it hands over at its next check). The lobby
   feed then stays at 2.1.0 for good: never point `lobby.yml` at a KVBC Awana
   installer (that would install it without a hand-off). Until 9.0.0 is
   released, `/download/kvbc-awana` serves the 8.2.0 Club Label Printer
   installer (the feed's newest), so the Setup card's link is only right once
   9.0.0 is out: release it soon after this lands.
3. A display smoke test in `printer-release.yml` (`--display-smoke-test`)
   was not added: it needs a seeded `roles.json` with the display on and a
   check of what the display loaded.
4. On Windows, before the release: the wizard end to end, an 8.x laptop
   upgrade (no wizard, no display, data kept, the old `Club Label
   Printer.exe` gone from the folder), the sound room hand-off on a 2.0.0 PC
   (the profile copy, the uninstall, the login item), and /settings against
   the live Worker: the laptop's row appears with the print server's sign-in,
   a display turned on from /settings shows, new hours apply, print off
   while a label prints waits and then restarts the app, the tray's
   "signed out" after a passphrase change.

## Switch-day cleanup

Switch day is done: every screen runs on awana.kvbchurch.org, the old repos
are archived, and the Pusher keys are cleared. This is what is still open.

### Status

The code items are done (2026-10-12): the print server's Pusher publisher, the
Worker's `pusher.js` and its secrets-gated mirror, the Pusher key in the login
body, `ci.yml`'s `PUSHER_*` block, the legacy `provision` display login (the
lobby's `displayLogin.js` machinery, the printer's display-login state and
`/config/display-login/generate`, and the `provision` section of
`envelope-vectors.json`) and the PowerPoint add-in. Three items are the
owner's, by hand.

### Still to do

- **Pusher secrets and variables.** Done 2026-10-12 (owner deleted the
  `PUSHER_*` GitHub secrets). If still present, the Worker's own
  `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET` and `PUSHER_CLUSTER` can go
  too (Cloudflare dashboard, or `npx wrangler secret delete <name>` in
  `lobby/worker`); nothing reads them.
- **Pusher app.** Done 2026-10-12 (owner deleted it).
- **Stray screens.** Find any screen still on the old github.io address
  (it stops getting check-ins once Pusher is off) and open
  awana.kvbchurch.org on it.

# Roadmap

The plans for the Awana screens and check-in, one section per track. Each track has the owner's decisions (dated), what exists today, the design, the status, and what is still to do. Read a track's status before you touch the code it names.

Tracks: [Settings page](#settings-page) · [Cloud check-in](#cloud-check-in) · [Online only](#online-only) · [KVBC Awana one app](#kvbc-awana-one-app) · [Switch-day cleanup](#switch-day-cleanup)

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

#### Inventory: every setting and tool, and where it lives now

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
- **Phone PIN and the keys stay on the dashboard.** The PIN protects the
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

## Online only

Owner decision, 2026-10-11. **Status: decided, not built.**

The laptop keeps its own check-in and its own label path. What moves is the laptop's web surface: its print dashboard (`localhost:3456`) and its Wi-Fi phone page (`http://<laptop-ip>:3456/phone`).

### The owner's decisions (2026-10-11)

| Question | Decision |
| --- | --- |
| The laptop's print dashboard (`localhost:3456`) | **Retired.** Its remaining tools move into awana.kvbchurch.org/settings. The Settings track's inventory marks which are dashboard-only today. |
| The laptop's Wi-Fi phone page (`http://<laptop-ip>:3456/phone`) | **Retired.** Phones use awana.kvbchurch.org/checkin. |
| No internet | Check-in still prints at the desk. No phones and no settings changes until the internet is back. |

### What this changes in the other tracks

- The Settings track says the dashboard "stays as a plain fallback for a night with no internet". This track supersedes that line: with no internet the desk still prints, and nothing is changed from a phone or a settings page.
- The Settings track leaves the phone PIN, the display key and the sync sign-in on the dashboard. Retiring the dashboard needs a new home for them; that is not decided (see below).
- The Wi-Fi phone page cannot be retired while phones still depend on the laptop. Today its Undo check-in, Check out, visitors and custom labels go to the laptop. [Cloud check-in](#cloud-check-in) phase 4 moves check-in, undo, check-out and visitors to the Worker; custom labels are not in any phase yet.

### Status

- 2026-10-11: decided by the owner. Not built.

### Still to do

1. Move the dashboard-only tools (the [Settings track](#settings-page) inventory) to awana.kvbchurch.org/settings, through the same localhost route the Laptop section already uses.
2. Decide where the phone PIN, the display key and the sync sign-in are set once the dashboard is gone. Not decided. The Settings track kept the PIN on the dashboard for a reason that still holds: a page that could set the PIN or the display key would widen the token's blast radius, which was kept small on purpose, unless it had a separate confirmation credential.
3. Give custom labels a phase, then turn off the laptop's Wi-Fi phone page (phones on the church network, the PIN and the phone routes) only after every phone tool has moved.
4. Confirm on the laptop, with the internet off, that check-in still prints at the desk.

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

Four items are still open, below.

### Still to do

- **Pusher publisher code.** Remove it from the print server (`printer/`,
  the Pusher publisher), then remove the `PUSHER_*` block from
  `.github/workflows/ci.yml`. Each app's `CLAUDE.md` says the code stays
  until this step.
- **Pusher secrets and variables.** Delete the `PUSHER_*` secrets and the
  `PUSHER_APP_KEY` / `PUSHER_CLUSTER` variables in this repo. The next deploy
  deletes the Worker's own copies.
- **Pusher app.** Delete the Pusher app itself.
- **Stray screens.** Find any screen still on the old github.io address
  (it stops getting check-ins once Pusher is off) and open
  awana.kvbchurch.org on it.

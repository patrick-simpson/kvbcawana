# The sync service (`worker/`)

One always-on service that every Awana screen talks to, so nothing depends on
the check-in laptop being switched on:

- **One passphrase sets up any screen.** Type it on a lobby TV, the projector
  page, a Journey kiosk or the check-in laptop's printer app, and that screen
  gets the encryption key, the shared settings, the slides, the calendar and
  (for a lobby TV) the "new screen" template.
- **Any signed-in screen can change things for every screen**: shared
  settings, the slide deck, the template, Journey's room settings. Changes
  reach the other screens within seconds over the live channel.
- **"Refresh calendar now" really reads the church calendar**, and the service
  also reads it by itself every six hours.

It is a Cloudflare Worker with one Durable Object. Cloudflare's free plan
covers it many times over.

## Setting it up (about 10 minutes, once)

### 1. Make a free Cloudflare account

1. Go to <https://dash.cloudflare.com/sign-up> and sign up with the church
   email. Pick the **Free** plan if asked. You do not need a domain.
2. In the dashboard, open **Workers & Pages** once. It asks you to choose a
   `workers.dev` subdomain (for example `kvbc-awana`). Pick one and save.
3. Copy your **Account ID**: it is on the right-hand side of **Workers &
   Pages** → **Overview** (a 32-character code).

### 2. Make an API token

1. Top right, your profile → **My Profile** → **API Tokens** →
   **Create Token**.
2. Next to **Edit Cloudflare Workers**, press **Use template**.
3. Under **Account Resources** choose your account; under **Zone Resources**
   choose **All zones** (there are none, which is fine).
4. **Continue to summary** → **Create Token**, and copy the token (it is shown
   only once).

### 3. Put the secrets in GitHub

In this repository on GitHub: **Settings** → **Secrets and variables** →
**Actions** → **New repository secret**, once for each:

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | the token from step 2 |
| `CLOUDFLARE_ACCOUNT_ID` | the Account ID from step 1 |
| `SYNC_PASSPHRASE` | the church passphrase, for example `kennebec` |

For cloud check-in (`ROADMAP.md#cloud-check-in` at the repo root), three more:

| Name | Value |
| --- | --- |
| `TWOTIMTWO_USERNAME` | the church's dedicated TwoTimTwo check-in user (its email) |
| `TWOTIMTWO_PASSWORD` | that user's password |
| `TWOTIMTWO_HOST` | `kvbchurch.twotimtwo.com` (the default when unset; only a `*.twotimtwo.com` name is accepted) |

A secret added later reaches the Worker only when it is redeployed: **Actions**
→ **CI** → **Run workflow** with **Redeploy the sync Worker** ticked.

### 4. Deploy

**Actions** → **Deploy the sync Worker** → **Run workflow**. It tests the
service, deploys it, sets its secrets, and writes its address into
`shared/sync.json`, which redeploys the site so every screen can find it.

### 5. Sign in the check-in laptop FIRST

Make sure the printer app is 6.21.0 or newer (it updates itself). Open its
dashboard → **Settings** → **Sync service** (it appears once step 4 has
finished), type the passphrase and press **Sign in**. The laptop hands the
service the encryption key it already uses, so screens that were set up
before keep reading names. Then sign in every other screen with the same word
(lobby TV: Settings → Setup → Connect this screen; projector: Display
Settings; Journey: Settings → Sync).

## Changing the passphrase

Settings → Setup → **Change passphrase**, on any signed-in screen. It needs
the current word too. Changing it:

- signs **every** screen out, including the check-in laptop, until someone
  types the new word on it;
- replaces the encryption key, because whoever learned the old word also
  learned the old key.

`SYNC_PASSPHRASE` in GitHub is only used the very first time; after that the
service keeps its own copy, so change the word from Settings, not there.

## Guessing protection

Because the word is short, it is only ever checked by this service, never
anywhere a stranger could copy it and guess offline:

- 5 wrong tries from one address lock that address out for 15 minutes;
- 30 wrong tries in an hour, from anywhere, pause new sign-ins for an hour.

A screen already signed in is never affected; a lock only delays setting up a
new one.

## What it stores

The passphrase as a salted hash (never the word), the session-signing secret,
the encryption key, the shared settings, the published slide deck, the screen
template, Journey's room settings, and the church calendar. No names of
children in the clear, ever: the laptop's check-in frames pass through sealed, and the
cloud check-in watcher (below) reads TwoTimTwo's report in memory and keeps
only counts, plus last read's clubber ids sealed under a key derived from the
TwoTimTwo password secret. The TwoTimTwo password and its session cookie are
never stored. Exceptions, each sealed under that same key and purged on
schedule (`src/routes.md` sections 5 and 8): tonight's first names for the
pickup list (`tonight:book`), who brought a friend (3 days), and, so a restart
does not leave the check-in page waiting, tonight's check-in page roster
(`desk:page`: clubber ids, full names, clubs, checked-in marks), deleted when
the watch window closes. The trends back-fill (below) keeps counts only: D1
`night_summary_import` and `trends:import` (seasons, times, fixed codes).
The stations' roster and completed books (below) rest SEALED TO THE PRINT
STATIONS' KEYS only (`station:roster`, `station:books`: the Worker cannot open
them after the seal; allergies are in the roster's Notes), award slips waiting
for their seal sit under the state key for the night (`feeds:slips`), and the
slips already queued are HMAC tags (`awards:slipped`).

## The stations' roster, completed books and award slips (`src/stationfeeds.js`, owner 2026-10-16)

What the laptop's Chrome extension fed its print server besides check-ins, now
read by the Worker from its alarm on the same one read clock (`src/routes.md`
sections 4 and 7):

- **The roster** (`/clubber/csv`, every label's allergies, birthday, group and
  photo consent): read about hourly in the watch window, once a day outside it,
  and at once when a station asks with no copy. The household's addresses,
  phones, emails and payments are left out; the rest is sealed to every
  registered station (one station per alarm tick, the free plan's CPU) and served
  by `GET /v1/station/roster`, which the print role's bundle sync
  (`printer/print-server/job-puller.js createBundleSync`) feeds to its
  `/update-csv`. A cut download, a page or a sign-in form keeps the last good copy.
- **Completed books** (`/report/completed_books`, clubs 2-6, the last 21 days):
  every 10 minutes in club hours, one club per free slot, one sealed bundle,
  `GET /v1/station/books` -> the print server's `/feed/completed-books` (the
  trophy band).
- **The meeting report** (`/meeting/report?output=csv`): every 5 minutes in club
  hours; its books and awards counts go into the Worker's own `tonight` frame,
  and each award slip becomes one sealed `/print-award` job, once per child and
  award a night.
- **The hand-over**: a station reports its app version with its heartbeat. The
  roster and books are served only to a station on KVBC Awana 10.0.0 or newer
  (an older one, which still has the extension, is answered 404 as before), and
  award slips print from the Worker only once no station is older (meanwhile
  each slip is only marked, so an update in the middle of a club night never
  prints one twice).

Check-outs made by hand on TwoTimTwo's Checkout page are the youth check-out's
(`src/ymcheckout.js`, which already reads that page every minute from 7:15 pm):
a child gone between two genuinely read pages leaves tonight's count.
`GET /v1/cloud/status` shows all of it as counts and times (`stationFeeds`,
`ymCheckout.leftPage`).

## Developing

```sh
cd worker
npm ci
npm run lint && npm test     # its own tools (worker/ left lobby/ on 2026-10-16)
npx wrangler dev             # a local copy on :8787
```

For `wrangler dev`, put `INITIAL_PASSPHRASE=kennebec` in
`worker/.dev.vars` (git-ignored).

## The API

All JSON. Every route but the first three needs `Authorization: Bearer
<session>` from a login.

| Route | |
| --- | --- |
| `GET /v1/health` | `{ok: true}` |
| `POST /v1/login` `{passphrase, seedKey?}` | `{session, displayKey, state}`; 401 `{reason: 'wrong', triesLeft}`; 429 `{retryAfterSec}` |
| `GET /v1/calendar` | the calendar feed (`calendar-feed.json`'s shape, plus `checkedAt`) |
| `GET /v1/state` | `{settings, slides, template, journey, calendar, kid}` |
| `PUT /v1/settings` `{settings}` | `{rev, publishedAt, keyCount, broadcast}`; seals a `settings` frame (contract v6) |
| `PUT /v1/slides` `{slides}` | `{deckRev, publishedAt, slideCount, droppedCount, broadcast}`; seals `slides` chunks (contract v5) |
| `PUT /v1/template` `{config}` | `{savedAt, config}` |
| `GET /v1/journey` | `{journey: {savedAt, settings} \| null}` (the room document alone; `src/routes.md` 10.8) |
| `PUT /v1/journey` `{settings}` | `{savedAt, settings}` |
| `POST /v1/calendar/refresh` | `{changed, generatedAt, checkedAt, clubCount, eventCount}`; 502 `{error}` keeps the last good copy |
| `POST /v1/passphrase` `{current, next, rotateKey?}` | `{session, displayKey, rotatedKey}` |

| `GET /v1/cloud/status` | the cloud check-in watcher: `{mode, configured, windowOpen, readIntervalSec, watchIntervalSec, budget: {intervalMs, interactiveWaitMs, readyInMs, reportReservedInMs, taken, refused, reportBumps, displaced}, deskPage: {held, readAt}, families: {held, readAt, waiting, lookedFor, catchUps}, checkedIn, byClub, tonight, lastError, checkinPage, log, ...}`, counts and fixed codes only |
| `GET /v1/history/import-status` | the trends back-fill: `{state, seasons: [{season, nights, importedAt}], oldestSeason, lastRunAt, nextDueAt, lastError, ...}`, fixed codes only (`src/routes.md` section 3) |
| `POST /v1/cloud/read-now` | one report read now, on any day (a rehearsal), never within 5 s of any read: `{ok, verdict?, error?, throttled?, status}` |

Changes to the template, Journey's settings and the calendar ring a plaintext
doorbell, `changed` `{what, at}` on the live channel; it carries
no content, and a screen that hears it fetches from here.

### Screens (`src/screens.js`, ROADMAP.md#settings-page phase 2)

Every lobby TV, projector, Journey kiosk and KVBC Awana computer registers here under an id it made
once and keeps in its own storage, so awana.kvbchurch.org/settings can list
them and change each one's OWN settings (its chime, motion, what plays behind
the names; never a shared setting, panic mode or a secret: the
allowlist is `SCREEN_SPECS` in `src/lib/syncSpecs.js`, which the screens
apply too). At most 40 screens; a full registry makes room only by forgetting
one silent for a month.

| Route | |
| --- | --- |
| `POST /v1/screens/hello` `{id, kind, name?, pendingRoleChange?, status?}` | `{screen, settings}`; adds a new screen (a known one keeps its name), moves `lastSeen`; its `status` (a Journey kiosk's saved lessons, a computer's app version and update, a TV's or projector's page build; one shape per kind, `src/routes.md` 10.7) is kept and listed; a `computer` (KVBC Awana) holding a print-off until its last label prints sends `pendingRoleChange` (its allowlist), kept until a hello without one |
| `GET /v1/screens` | `{screens: [{id, kind, name, createdAt, lastSeen, online, live, pendingRoleChange?, status?}], max}`; online = seen in the last 3 minutes or on the live channel |
| `POST /v1/screens/now` `{id, now?}` | a Journey kiosk's phone-remote poll: `{actions, watch, hello}`; memory only, nothing stored (`src/routes.md` 10.9) |
| `GET /v1/screens/<id>/settings` | `{screen, settings: {savedAt, settings} \| null}` |
| `PUT /v1/screens/<id>/settings` `{settings}` | `{savedAt, settings, dropped}`; the whole layer, through the kind's allowlist |
| `PUT /v1/screens/<id>/name` `{name}` | `{screen}` |
| `POST /v1/screens/<id>/action` `{action, data?}` | `{ok, delivered}`; lobby: `preview-checkin`, `reset-tally`, `board-demo`; projector: `select`, `resume`; journey: `start-downloads`, `pause-downloads`, `resume-downloads`, `stop-downloads`, `delete-downloads`, QUEUED (`{ok, delivered: false, queued: true}`, at most 5, 10 min) and handed over once in the kiosk's next hello answer (`actions`; `src/routes.md` 10.8) |
| `DELETE /v1/screens/<id>` | `{forgotten}`; a screen still running comes back at its next hello |

A settings change, a rename and an action ring the live channel only (never
replayed to a screen that connects later): `changed` `{what:
'screen', id, at}` or `{what: 'screen-action', id, action, data?, at}`. A
screen's live socket carries its id (`/v1/live?session=…&screen=<id>`), which
is how the list knows it is on the channel.

### The settings page's own routes (`src/routes.md` section 10)

| Route | |
| --- | --- |
| `GET` / `PUT /v1/switches` | the runtime switches (`src/switches.js`): `wrangler.toml [vars]` are the defaults, a stored value overrides one; `SWITCHES_STORED = "off"` is the deploy kill |
| `GET` / `PUT /v1/church/settings` | the laptop's church-wide printing settings and the remembered leaders (`src/church.js`, allowlist `shared/churchSettings.js`): seeded once by a print station, edited with `baseRev` |
| `GET` / `POST` / `DELETE /v1/notice` | a notice to every screen for 5 min to 4 h, and "Take it down" (`src/notice.js`) |
| `GET /v1/changes`, `POST /v1/changes/<seq>/undo` | the last 200 changes, who made them (`X-Device`, `X-Device-Name`) and Undo (`src/changes.js`) |
| `GET /v1/tonight/overview` | mission control's one poll: counts, codes, times and station names only (`src/overview.js`) |

## Cloud check-in: the report watcher (phase 1, shadow)

`src/twotimtwo.js` (the client and parsers) and `src/watcher.js` (the
watcher), ROADMAP.md#cloud-check-in pieces 1 and 2. With `CLOUD_CHECKIN = "shadow"`
(`wrangler.toml`) and the three `TWOTIMTWO_*` secrets set, a Durable Object
alarm reads `/clubber/checkin_report?date=<today>` every 30 seconds on club
nights from 4:30 to 9:00 pm Eastern (the printer's `clubNights`, an hour
either side) and sleeps the rest of the week. It **publishes nothing**: it
logs the tally it would publish and what it would print
(`npx wrangler tail`, lines starting `[cloud] shadow:`) and keeps the status
above. TwoTimTwo's terms (2026-10-11): an automated user, ONE read every 5
seconds with every read combined. The Worker keeps to exactly that
(`READ_INTERVAL_MS = 5000` in `src/readbudget.js`; it was 15 s from 2026-10-12
only while the laptop's extension tab still read, which is retired), so the
watcher never reads within 5 s of any read the session made ("read now" and the
pages' reads included). Putting every read on one clock is
ROADMAP.md#online-check-in P1; how the slots are shared is routes.md section 7.

Safety: a report with fewer children than its own `Count:` footers is partial
and changes nothing; a read that would drop more than half the room is
refused; a refused sign-in waits 5, then 15, then 60 minutes; every request is
https to the one TwoTimTwo host and a redirect anywhere else is refused.

## Trends back-fill (`src/trendsimport.js`, owner 2026-10-13)

So the History section's trends reach back before the desk, the Worker reads
TwoTimTwo's Attendance Summary (`/report/attendance_summary?year_start=<year>&output=csv`:
a count per club per meeting, no names) by itself: the current season first,
then one season further back per read until a season has no meetings (20 at
most), and the current season once more after every club night's window
closes (late paper sheets). It runs from the watcher's alarm only outside the
watch window, at the lowest priority on the one read clock, and only with the
`TWOTIMTWO_*` secrets, cloud check-in not off and `HISTORY_DB` bound. A report
that does not read exactly as expected stores nothing (tried again daily, 3
times; a refused current season does not hold up the walk back meanwhile). Counts go to D1 `night_summary_import` (migration 0003); the trends'
summary answers the desk's live line where one exists, else the imported one,
so nothing is counted twice. `GET /v1/history/import-status` says how far it
got; `src/routes.md` section 3 has the details.

### Journey phone remote (`src/journeyRemote.js`, `src/routes.md` 10.9)

`POST /v1/journey/remote` `{action, data?}` sends one press to every Journey kiosk; `GET /v1/journey/remote/state` lists what each kiosk shows and how many are online. Both need a session. Held in memory only (presses 20 s, reports until replaced), never written to storage; the kiosk list is kept in memory too (refreshed when the screen registry is written), so the phone's 1.5 s polls read nothing from storage.

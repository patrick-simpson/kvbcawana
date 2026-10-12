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
children, ever: the laptop's check-in frames pass through sealed, and the
cloud check-in watcher (below) reads TwoTimTwo's report in memory and keeps
only counts, plus last read's clubber ids sealed under a key derived from the
TwoTimTwo password secret. The TwoTimTwo password and its session cookie are
never stored.

## Developing

```sh
npm ci --prefix worker
npx vitest run --config worker/vitest.config.js   # from the repo root
cd worker && npx wrangler dev                      # a local copy on :8787
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
| `PUT /v1/journey` `{settings}` | `{savedAt, settings}` |
| `POST /v1/calendar/refresh` | `{changed, generatedAt, checkedAt, clubCount, eventCount}`; 502 `{error}` keeps the last good copy |
| `POST /v1/passphrase` `{current, next, rotateKey?}` | `{session, displayKey, rotatedKey}` |

| `GET /v1/cloud/status` | the cloud check-in watcher: `{mode, configured, windowOpen, checkedIn, byClub, tonight, lastError, checkinPage, log, ...}`, counts and fixed codes only |
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
| `POST /v1/screens/hello` `{id, kind, name?, pendingRoleChange?}` | `{screen, settings}`; adds a new screen (a known one keeps its name), moves `lastSeen`; a `computer` (KVBC Awana) holding a print-off until its last label prints sends `pendingRoleChange` (its allowlist), kept until a hello without one |
| `GET /v1/screens` | `{screens: [{id, kind, name, createdAt, lastSeen, online, live, pendingRoleChange?}], max}`; online = seen in the last 3 minutes or on the live channel |
| `GET /v1/screens/<id>/settings` | `{screen, settings: {savedAt, settings} \| null}` |
| `PUT /v1/screens/<id>/settings` `{settings}` | `{savedAt, settings, dropped}`; the whole layer, through the kind's allowlist |
| `PUT /v1/screens/<id>/name` `{name}` | `{screen}` |
| `POST /v1/screens/<id>/action` `{action, data?}` | `{ok, delivered}`; lobby: `preview-checkin`, `reset-tally`, `board-demo`; projector: `select`, `resume` |
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

## The phone check-in relay (printer 7.9.0)

`awana.kvbchurch.org/checkin` is the print app's phone page, online. It signs in
with the passphrase like any screen, and every call it would make to the
check-in laptop on the church Wi-Fi goes through four routes instead
(`src/relay.js`):

| Route | Who | What |
|---|---|---|
| `POST /v1/relay` `{method, path, body}` | the page | queue one of the phone page's own calls (`RELAY_ROUTES` only) |
| `GET /v1/relay/next` | the laptop's print app | take every waiting call; `busy` says whether to ask again in a second or in 20 s |
| `POST /v1/relay/answer` `{id, status, body}` | the laptop | the call's answer |
| `GET /v1/relay/result?id=` | the page | the answer, once (`{done: false}` until then) |

Nothing about the roster is stored: a call waits at most 45 s for the laptop, an
answer at most 2 minutes for its page, and is deleted as it is read. The laptop
runs only the same `RELAY_ROUTES` (`printer/print-server/phone-relay.js`,
pinned equal by `printer/scripts/test-phone-relay.cjs`), and only while it is
signed in to this service.

## Cloud check-in: the report watcher (phase 1, shadow)

`src/twotimtwo.js` (the client and parsers) and `src/watcher.js` (the
watcher), ROADMAP.md#cloud-check-in pieces 1 and 2. With `CLOUD_CHECKIN = "shadow"`
(`wrangler.toml`) and the three `TWOTIMTWO_*` secrets set, a Durable Object
alarm reads `/clubber/checkin_report?date=<today>` every 5 seconds on club
nights from 4:30 to 9:00 pm Eastern (the printer's `clubNights`, an hour
either side) and sleeps the rest of the week. It **publishes nothing**: it
logs the tally it would publish and what it would print
(`npx wrangler tail`, lines starting `[cloud] shadow:`) and keeps the status
above. TwoTimTwo's terms (2026-10-11): an automated user, ONE read every 5
seconds with every read combined, so the watcher never reads within 5 s of
any read the session made ("read now" and the phone page's reads included).
Putting every read on one clock is ROADMAP.md#online-check-in P1.

Safety: a report with fewer children than its own `Count:` footers is partial
and changes nothing; a read that would drop more than half the room is
refused; a refused sign-in waits 5, then 15, then 60 minutes; every request is
https to the one TwoTimTwo host and a redirect anywhere else is refused.

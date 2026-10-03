# The sync service (`worker/`)

One always-on service that every Awana screen talks to, so nothing depends on
the check-in laptop being switched on:

- **One passphrase sets up any screen.** Type it on a lobby TV, the projector
  page, a Journey kiosk or the check-in laptop's printer app, and that screen
  gets the encryption key, the shared settings, the slides, the calendar and
  (for a lobby TV) the "new screen" template.
- **Any signed-in screen can change things for every screen**: shared
  settings, the slide deck, the template, Journey's room settings. Changes
  reach the other screens within seconds over Pusher.
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
| `PUSHER_APP_ID` | from the Pusher dashboard → your app → **App Keys** (`app_id`) |
| `PUSHER_KEY` | the same page (`key`) |
| `PUSHER_SECRET` | the same page (`secret`) |
| `PUSHER_CLUSTER` | the same page (`cluster`, for example `us2`) |
| `SYNC_PASSPHRASE` | the church passphrase, for example `kennebec` |

The Pusher values are the ones the printer app already uses.

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
children, ever: check-ins still go from the laptop straight to the screens
over Pusher, sealed, and never pass through here.

## Developing

```sh
npm ci --prefix worker
npx vitest run --config worker/vitest.config.js   # from the repo root
cd worker && npx wrangler dev                      # a local copy on :8787
```

For `wrangler dev`, put `INITIAL_PASSPHRASE=kennebec` (and any `PUSHER_*`) in
`worker/.dev.vars` (git-ignored).

## The API

All JSON. Every route but the first three needs `Authorization: Bearer
<session>` from a login.

| Route | |
| --- | --- |
| `GET /v1/health` | `{ok: true}` |
| `POST /v1/login` `{passphrase, seedKey?}` | `{session, displayKey, pusher: {key, cluster}, state}`; 401 `{reason: 'wrong', triesLeft}`; 429 `{retryAfterSec}` |
| `GET /v1/calendar` | the calendar feed (`calendar-feed.json`'s shape, plus `checkedAt`) |
| `GET /v1/state` | `{settings, slides, template, journey, calendar, kid}` |
| `PUT /v1/settings` `{settings}` | `{rev, publishedAt, keyCount, broadcast}`; seals a `settings` frame (contract v6) |
| `PUT /v1/slides` `{slides}` | `{deckRev, publishedAt, slideCount, droppedCount, broadcast}`; seals `slides` chunks (contract v5) |
| `PUT /v1/template` `{config}` | `{savedAt, config}` |
| `PUT /v1/journey` `{settings}` | `{savedAt, settings}` |
| `POST /v1/calendar/refresh` | `{changed, generatedAt, checkedAt, clubCount, eventCount}`; 502 `{error}` keeps the last good copy |
| `POST /v1/passphrase` `{current, next, rotateKey?}` | `{session, displayKey, rotatedKey}` |

Changes to the template, Journey's settings and the calendar ring a plaintext
doorbell, `changed` `{what, at}` on the `awana-sync` Pusher channel; it carries
no content, and a screen that hears it fetches from here.

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

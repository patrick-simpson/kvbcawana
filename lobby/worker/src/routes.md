# Online check-in: the Worker's new routes (P0 contract)

The route table the P1–P7 builders work against (root
`ROADMAP.md#online-check-in`). Built so far: the crypto module
(`lobby/shared/cloud-crypto.js`), the D1 schema (`../migrations/0001_history.sql`,
`0002_applied_batches.sql`, `0003_trends_import.sql`), sections 2 and 3 (P6, `history.js`) and, in the
Worker core, **the routes marked BUILT below** (stations, the print lease, the
desk's claim API, the one read clock; section 7 says how a module adds its
own). **This file is the single truth for the Worker, the print role
(`printer/print-server/job-puller.js`, `history-sync.js`, `station-keys.js`) and
the desk page (P3): the end-to-end test `printer/scripts/test-cloud-e2e.cjs`
runs all of them against these shapes.** When a route lands, mark it built
here and keep its shape; a change of shape is a change to this file first.

## Rules every route keeps

- **Free forever.** Workers free plan: 10 ms of CPU per request. The Worker
  never derives a key, never runs ECDH, never seals or opens a row or bundle.
  It may hash (SHA-256 of an `authKey`, HMAC identifier tags) and it validates
  shapes and sizes. Every open is a client's (`cloud-crypto.js`). The one kind of
  seal the Worker makes is TO the print stations' public keys, for what only it
  reads from TwoTimTwo (ECDH P-256 in WebCrypto, at most one per alarm tick or
  request): a TwoTimTwo-page check-in's job (`adopt.js`), and the roster, the
  completed books and the award slips (`stationfeeds.js`, section 4).
- **Paths.** The site serves the Worker under `/api`, so `GET /v1/x` here is
  `https://awana.kvbchurch.org/api/v1/x`. Bodies are JSON; `BODY_MAX` (128 KB)
  holds unless a route says otherwise.
- **Auth levels.**
  - `public`: no session.
  - `session`: `Authorization: Bearer <session>` from `POST /v1/login`
    (today's tokens, epoch-bound: a passphrase change signs everyone out).
  - `station`: `session` plus `X-Station: <stationId>` naming a registered
    station. No pairing step (owner): any computer signed in with the
    passphrase may register one. The Worker does not prove key possession; a
    non-station that leases a job cannot open it (it is sealed to the
    stations' keys) and the lease only delays it (see Print).
- **Identifiers.** The Durable Object never stores a plaintext clubber id.
  Claims and job keys are `identityTag(stateKey, night, clubberId)`; a visitor
  with no id is `visitorTag(stateKey, night, name, club)` (both in
  `cloud-crypto.js`, HMAC-SHA256, base64url). `stateKey` is the Worker's own
  secret (HKDF from the TwoTimTwo password secret, as `watcher.js` does).
  `night` is the church's LOCAL date (`churchNight()` /
  `watcher.js localTime().date`), never UTC. Claims and jobs are purged at
  the end of the night (the watcher's alarm after the window closes).
- **Fail closed.** A write that should carry a sealed form and does not
  (no `historyRow`, no station `bundle` when stations exist) writes NOTHING
  and answers 400 `{reason: 'unsealed'}`.
- **TwoTimTwo read budget.** TwoTimTwo allows ONE read every 5 seconds, every
  read combined. While the laptop's extension tab still reads TwoTimTwo (about
  3 reads a minute), the Worker makes at most ONE read every 15 seconds, all its
  reads combined (owner 2026-10-12; `READ_INTERVAL_MS = 15000` in
  `readbudget.js`, back to 5000 when the tab is retired): the watcher's report,
  the check-in page, the Checkout page, the household export, the roster CSV,
  every sign-in hop, a manual read-now. One shared clock in the Durable Object
  (section 7 says how the 4 slots a minute are shared). A route that needs a
  read waits its turn (up to `INTERACTIVE_WAIT_MS`, 20 s), then answers from the
  last read with its `readAt`, or 429 `{retryAfterMs}` when it has none. Posts
  (check in, undo, check out) are writes, not reads, and a desk check-in, undo
  or check-out normally reads nothing at all (section 5).
- **Single publisher** (`SINGLE_PUBLISHER = "on"` with cloud check-in
  running; section 8 has the design). The Worker publishes `tally`, `tonight`
  and the still-here list (`checkout`) from its own state with the shared
  count (`lobby/shared/tonight.js`), and `POST /v1/publish` drops the laptop's
  `tally`, `tonight`, `checkout` and `checkin` frames with 200
  `{dropped: true}` so the print server owes no resend, keeping every other
  event. The ONE exception is a `checkin` greeting sent by a registered
  station with the print job it printed (`X-Station`, `X-Job`): it goes
  through once per job, because only the station can make it (birthday,
  first-timer, milestone). The Worker no longer greets anyone itself.

## Wire shapes (all from `cloud-crypto.js`)

```
Row      { id, night, kind, v: 1, kid, epk, iv, ct }   id 22 base64url chars, night YYYY-MM-DD,
                                                       kind /^[a-z][a-z0-9-]{0,31}$/, kid 16 hex,
                                                       ct = AES-GCM of exactly ROW_PAD (1024) bytes:
                                                       base64 length 1388, every row
Wrapped  { v: 1, salt, iter, iv, ct }                  history private key, iter 600000..2000000
Bundle   { v: 1, id, night, kind, to: [{ v, kid, epk, iv, ct }] }   one entry per station
Verifier SHA-256(authKey), base64                       what the Worker stores
```

The Worker checks a row's shape and that `kid` is the current history kid
(or the previous one during a re-key, which this design does not offer) and
that `ct` is exactly 1388 base64 characters; a bundle's `to[].kid` must each be
a registered station and `ct` a ladder size.

## 1. Sign-in, passphrase v2 (P1)

The passphrase never reaches the Worker once a client is on v2: clients send
`authKey` from `deriveKeys(passphrase, salt, iter)`.

| Route | Auth | Request | Answer |
| --- | --- | --- | --- |
| `GET /v1/auth/params` | public | | `{v: 2, salt, iter, legacy, upgrade}`: the PBKDF2 salt and count for `authKey`. The salt is made (and stored) on first ask, before any v2 verifier exists. `legacy` is true while the bootstrap HMAC hash is still kept (the field keeps its wire name); `upgrade` is true while no v2 verifier is stored (a client then sends `{passphrase, authKey}` in its first sign-in). 503 with no passphrase configured. |
| `POST /v1/login` (v2) | public, lockout as today | `{authKey}` | `{session, displayKey, state, history: {pub, kid, wrapped} \| null}`. 401 `wrong` (counted) on a bad key; 401 `upgrade-needed` (not counted) while no verifier is stored and no passphrase came with it; 409 `no-params` before `GET /v1/auth/params` was ever asked; 400 `bad-authkey` for a malformed key. A v2 login that matches the stored verifier deletes the bootstrap hash if it is still kept. |
| `POST /v1/login` (upgrade, the bootstrap) | public | `{passphrase, authKey}` when no v2 verifier exists | checks the passphrase against the bootstrap HMAC hash; on success stores `verifier = SHA-256(authKey)` under the params' salt, answers as v2 plus `upgraded: true`. |
| `POST /v1/login` `{passphrase}` alone | public | | always 401 `legacy-off` (not counted, nothing stored): the old login is gone (owner 2026-10-16). |
| `POST /v1/passphrase` | session, lockout as today | `{currentAuthKey \| current, next: {salt, iter, verifier}, wrapped}` (`currentAuthKey` proves it against the stored verifier; ONLY while no verifier is stored yet, `current`, the passphrase, is checked against the bootstrap hash instead) (`wrapped` is the history key re-wrapped under the new word by `rewrapPrivateKey`, already proved; `null` only when no history key exists) | ONE atomic multi-key put: `auth` (new salt, iter, verifier, epoch + 1), `history:wrapped`, `history:wrapped:prev` (`{wrapped, until: now + 7 days}`), and the bootstrap hash deleted. Signs every screen out and rotates the display key as today. `{session, displayKey, rotatedKey}`. The old shape (`next` a string) answers 400 `legacy-off` and changes nothing. |

**The bootstrap (kept).** The Worker never runs PBKDF2 (the free plan's CPU,
and every key is derived on a client), so it cannot make a v2 verifier from
`INITIAL_PASSPHRASE` itself. `ensureAuth()` makes `auth = {salt, hash:
HMAC(salt, INITIAL_PASSPHRASE), epoch: 1}` the first time anything asks, and the
first client to sign in sends `{passphrase, authKey}` once (the upgrade above),
which stores the verifier. From then on only `{authKey}` signs in, and the next
such login deletes the hash. `GET /v1/cloud/status` shows `auth: {v2, bootstrap}`
(is the verifier stored; is the bootstrap hash still kept).

**The old login is gone** (owner 2026-10-16, with KVBC Awana 10.0.0 out and
every page on v2). Deleted: the plain `{passphrase}` login, the `AUTH_LEGACY`
switch, `auth:legacyLastAt` (removed from storage by the cron), and the old-shape
change `{current, next: string}`; and in every client (`shared/sync-protocol.js`
and its copies, `/checkin`'s `desk-transport.js`, the Journey kiosk, the
screens' passphrase change) the fallback that sent the passphrase to a service
with no `/v1/auth/params`: such a service is now told it is too old, and a
Journey kiosk whose crypto modules cannot load says to reload the page. A client
from before passphrase v2 cannot sign in any more (it is answered 401). `iter`
stays at 600000 (the floor `cloud-crypto.js` enforces on every client).

## 2. The history key (P1)

| Route | Auth | Request | Answer |
| --- | --- | --- | --- |
| `GET /v1/history/key` | session | | `{pub, kid, wrapped, prev: {wrapped, until} \| null}` or 404 when none yet |
| `PUT /v1/history/key` | session | `{pub, kid, wrapped}` from `createHistoryKey(passphrase)` | first writer wins: 201 when stored, 200 when the same `pub` is already there, 409 `{pub, kid}` when another key is. The Worker checks `kid` = first 8 bytes of SHA-256(pub) (a hash, cheap). No replace route: a re-key would be its own explicit flow, and there is no rekey button (owner). |

A client that gets `history` at login unwraps it once
(`unwrapPrivateKey(wrapped, passphrase, pub)`, a NON-extractable key) and
refuses to seal or show history if that fails. No recovery code: lose the
passphrase, lose the history (owner).

## 3. History rows (P2 desk, P5 import, P6 reports)

| Route | Auth | Request | Answer |
| --- | --- | --- | --- |
| `POST /v1/history/rows` | session | `{rows: Row[] (at most 100), summary?: [{night, club, checkedIn, checkedOut, undone, prints}] (deltas)}` | `INSERT OR IGNORE` into `history_rows` (a retried batch is harmless), upsert-add into `night_summary`. `{stored, duplicates}`. 503 `{reason: 'history-off'}` without `HISTORY_DB`. |
| `GET /v1/history/rows?night=YYYY-MM-DD&after=<id>&limit=<=500` | session | | `{rows: Row[], next: id \| null}` |
| `GET /v1/history/nights?from=&to=` | session | | `[{night, rows}]` (a COUNT by night) |
| `GET /v1/history/summary?from=&to=` | session | | `night_summary` lines, plaintext numbers, plus the trends back-fill's imported counts for every night and club with NO live line (`imported: true`; below) |
| `GET /v1/history/import-status` **BUILT** | session | | the trends back-fill (below): `{state: 'idle'\|'running'\|'done'\|'unreadable'\|'not-configured', reason?, seasons: [{season, nights, importedAt}], oldestSeason, lastRunAt, nextDueAt, lastError, unreadableWhy, skipped, ended, currentSeasonLastAt, crosscheck}` (`crosscheck` = the self-check below, or null before the first import), fixed codes and numbers only; asking also sets the alarm sooner when a season read is due |
| `POST /v1/history/import` | session | `{rows: Row[] (at most 500), summary?}`, rows sealed by the KVBC Awana app from the laptop's own history (`kind` `import-checkin`, …) | as `POST /v1/history/rows`; `BODY_MAX` 1 MB for this route only |

**Row kinds** (the plaintext `kind` of a row; the record inside is sealed). One
vocabulary for the desk page, the print role and the history views:

| `kind` | Written by | Record (sealed JSON; the time is inside) |
| --- | --- | --- |
| `checkin` | the desk page (`source: 'desk'`) with `POST /v1/desk/checkin`; the print role for a TwoTimTwo-page check-in once it prints (`source: 'ttt'`, `history-sync.js rowForPrinted`), posted with its own `summary` line `{checkedIn: 1}` for its club in a post holding only that row, so a retry is the same batch and counts once (a phone page check-in is counted here too: the watcher's job meets its label) | `{ts, first, last, club, clubberId?, friend?, friendFirst?, source}`, `ts` epoch MILLISECONDS |
| `visitor` | the desk page, a visitor with no clubber id | as `checkin`, no `clubberId` (the trends count visitors from this kind) |
| `barf-friend` | the desk page with `POST /v1/desk/barf-late` (5.1): a late Brought a friend; no count line | `{ts, first, last, club, clubberId, friendFirst, source}` |
| `undo` | the desk page with `POST /v1/desk/undo` | `{ts, first, last, club, clubberId?, source}`: the child is NOT here after it |
| `checkout` | the desk page with `POST /v1/desk/checkout` | as `undo` |
| `reprint` | the desk page, posted with `POST /v1/history/rows` beside `POST /v1/print/reprint` | `{ts, first, last, club, source}` |
| `import-checkin` | the print role's one-time "Import laptop history" (`POST /v1/history/import`) | `{ts, first, last, club, clubberId?, visitor?, undone?}` |
| `import-attendance` | the same import | `{k, name, dates: [YYYY-MM-DD...]}` (the laptop's season ledger, 50 nights a row) |

Reading attendance back (the print role does, for milestones and "Go to"): a
child is present on a night when the LAST of their `checkin` / `visitor` /
`import-checkin` and `undo` rows (by `ts`, not by row id: ids are random) is not
an `undo`. A desk `historyRow` rides EVERY desk action (a check-in, an undo and a
check-out each store one); the Worker keeps it through `desk.hooks` (below), so
a client never posts the same row twice.

The friend list (BARF, `friends.js`) does NOT move here (owner, 2026-10-12): it
stays sealed under the Worker-derived key with its 3-day retention, for the 6:30
pm email only.

### Built (P6): `history.js`, sections 2 and 3

`history.js` exports `History` (`new History({ storage, env, now })`), which
answers `GET /v1/history/key`, `PUT /v1/history/key`, `POST /v1/history/rows`,
`POST /v1/history/import`, `GET /v1/history/rows`, `/nights`, `/summary`, and
one more, `GET /v1/history/status` (`{db, pending}`: is `HISTORY_DB` bound, and
how many outbox entries wait). Differences from the table above:

- **Nights** answer `[{night, rows, kinds: {checkin: n, visitor: n, ...}}]`
  (`kinds` is a COUNT by the plaintext kind; the trends read visitors from it).
- **Outbox.** A POST is validated, written to the Durable Object's storage
  (`hout:<batchId>`, at most 40 rows each; 400 entries at most, then 503
  `history-backlog`), then copied to D1 in ONE atomic `db.batch` per entry
  (4 s limit). D1 down or slow: the answer is **202** `{stored, duplicates,
  pending}` and the entry waits; `flush()` retries on the next history request.
  `batchId` is a SHA-256 of the row ids and summary, inserted into
  `applied_batches` inside the same batch, so a retried POST or a lost outbox
  delete never counts `night_summary` twice.
- **No `HISTORY_DB`** (not created yet): POSTs are accepted into the outbox
  and answer **202** `{reason: 'history-off', queued, message: 'History
  storage is not set up yet...'}`; every GET answers 503
  `{reason: 'history-off'}`. This replaces the 503 in the table, so a desk's
  check-ins are never lost before D1 exists.
- **Body limits.** `POST /v1/history/rows` 256 KB (100 sealed rows are about
  170 KB, more than `BODY_MAX`), `import` 1 MB, `PUT key` 16 KB. A row with
  any field off its shape, a `kid` that is not the stored key's, or a missing
  history key (409 `no-key`) refuses the WHOLE batch (400 `unsealed`): nothing
  is stored. Fields outside `{id, night, kind, v, kid, epk, iv, ct}` are dropped.
- **Passphrase change.** `PUT /v1/history/key` is first-writer-wins only. The
  re-wrap rides the passphrase change, which `sync.js` owns:
  `History.rewrapWrites(body.wrapped)` returns `{writes}` (the new
  `history:wrapped` and `history:wrapped:prev` = `{wrapped, until: now + 7
  days}`) or `{error}` (a ready 400 `wrap-missing` when a history key exists
  and the body has no valid `wrapped`: the change then writes NOTHING).

#### How `history.js` is registered (DONE in `sync.js`)

1. The constructor makes `this.history = new History(...)` and calls
   `mountHistory(this.registry, this)`: every history route above is a
   `session` route in the registry (no special case in `handle()`).
2. `mountHistory` also sets `desk.checkRow` to `history.checkRow(row, night)`
   (the shape, tonight's date and the CURRENT history `kid`; **a Worker with no
   history key refuses every desk row: 400 `unsealed`, so a client creates the
   key at sign-in, `PUT /v1/history/key`, first writer wins**) and pushes the
   desk hooks `afterCheckin` / `afterUndo` / `afterCheckout`. Each stores the row
   the desk page ALREADY sealed through `History.storeSealed` (the Worker never
   seals: free-plan CPU) plus ONE plaintext `night_summary` line (`checkedIn`,
   `undone` or `checkedOut` = 1 for the child's club; no line when the club is
   not a valid name, e.g. a visitor with none; undo and check-out bodies may
   carry `club` for it).
3. `changePassphrase` calls `history.rewrapWrites(body.wrapped)` after the
   current passphrase is checked: `{error}` (400 `wrap-missing`) changes
   NOTHING; otherwise `{auth, ...writes}` is ONE `storage.put({...})`.
4. `cron()` and `alarm()` call `history.flush()` (nothing without `HISTORY_DB`),
   so an outbox drains with nobody asking.

`wrangler.toml` binds `HISTORY_DB` (database `awana-history`); `ci.yml`'s deploy
job runs `wrangler d1 migrations apply awana-history --remote` before every
Worker deploy (idempotent).

### The trends back-fill (BUILT, `trendsimport.js`; owner 2026-10-13)

"For the trends page, can the worker grab the data off TwoTimTwo, then import it
into the database in Cloudflare." Fully automatic, no button:

- **Source.** `/report/attendance_summary?year_start=<season's first year>&output=csv`
  (`printer/docs/TWOTIMTWO.md` sections 4, 5, 8.1): `"Meeting","Puggles","",...,"TOTAL",""`,
  one row per meeting, newest first, a count per club. ONE read per season.
  NOT verified against the live site: the `year_start` value (the start year,
  `2025` for 2025-26, is assumed), the Meeting cell's date format (a few exact
  shapes are read: `9/10/2025`, `9/10`, `2025-09-10`, `Sep10`, `September 10,
  2025`, ...; a cell with no year takes it from the Aug-1 season boundary), and
  what the blank-headed column beside each club holds (never read beyond being
  number-like).
- **Strict** (`parseAttendanceSummary`): the header must be `Meeting`, then each
  club the app's club table knows (`lobby/shared/clubs.js`; stored under its
  name, `T&T` etc.) with a blank partner, then `TOTAL`, `""`; every row the same
  width; counts digits or blank; a row's clubs must add up to its TOTAL; a
  Meeting cell is a date, a summary word (`Total`, `Average`) or blank with no
  counts, else the season is refused; a dated row outside the season, or a night
  listed twice, refuses it too. A refused season stores NOTHING (`lastError
  'unreadable'`, `unreadableWhy` = `header`, `row-shape`, `bad-date`, `bad-count`,
  `total-mismatch`, `duplicate-night`, `out-of-season`, `too-many-rows`, `not-csv`,
  or `shrank`: a re-read with fewer nights than last time), is tried again after
  24 h, 3 times, then skipped (`skipped`; the current season gets 3 fresh tries
  after each club night). Nights after today (today only once its window has
  closed) and nights with no attendance (the next, unheld meeting; TOTAL 0) are
  skipped; counts are clamped 0..2000.
- **When.** From the watcher's alarm (one hook line in `Watcher.tick`), only
  while the watch window is CLOSED and the youth check-out is not due (so after
  midnight on a club night when `YM_CHECKOUT` is on). Order: the current season
  until first imported; then, after each club night's window closes, the current
  season once more (late paper sheets); then the walk back, one season a read,
  until a season has no meetings (`ended: 'empty'`) or 20 seasons (`'cap'`).
  The first of these that is DUE runs (`pick`): a current season refused and
  waiting out its 24 h does not hold up the walk back meanwhile (status
  `'unreadable'` with its `unreadableWhy` until it reads); with nothing due, the
  alarm wakes for the soonest.
  An older season is never read again once done. A season that comes back
  identical to another (same body) or dated in another season means TwoTimTwo
  ignored `year_start`: nothing is stored and the walk ends (`'year-ignored'`).
- **The read clock.** One page on the shared clock with `waitMs` 0 and no
  priority, the lowest of all: a booked clock is "next tick". A failed read backs
  off 5 min, 15 min, 1 h (a refused sign-in at least the client's own back-off);
  TwoTimTwo refusing the report (403, 404) waits a day. The whole back-fill is at
  most 20 reads, once (plus a sign-in's hops); then one read a week.
- **Storage.** D1 `night_summary_import (night, club, attended, imported_at)`
  (`migrations/0003_trends_import.sql`), counts only. A season is ONE atomic
  `db.batch`: a DELETE of its Aug 1..Jul 31 range, then upserts (`INSERT ... ON
  CONFLICT DO UPDATE`) of 32 lines each (97 bound parameters; ~250 lines = 9
  statements). DO storage `trends:import` (a small JSON: seasons with nights,
  time and a body fingerprint, the walk's next season, refusals, times, fixed
  error codes; no name). A restart resumes from it; the attempt is written
  through before each read.
- **Never double counted.** `GET /v1/history/summary` answers, per night and
  club, the LIVE `night_summary` line when one exists, else the imported count
  as `checkedIn` (`checkedOut`, `undone`, `prints` 0) with `imported: true`.
  The live desk always wins. Past `SUMMARY_MAX` the oldest lines are left out.
- **Self-check** (owner 2026-10-13: "after its first run, compare one imported
  night with TwoTimTwo", made automatic). After every season it stores, ONE
  SELECT (a read; nothing more is written to D1) sets the desk beside
  TwoTimTwo for every night and club with BOTH a live `night_summary` line
  (`checked_in > 0`; the desk's number is `checked_in - undone`, never below 0)
  and an imported count, newest first, 2000 lines at most. Kept in
  `trends:import` and answered in `import-status` as `crosscheck: {compared,
  matching, differing, deskHigher, examples: [{night, club, desk, twotimtwo}]
  (5 at most, differing lines, newest first), at}`. Counted by NIGHT: a night
  agrees only when every club on it agrees; `deskHigher` = the differing nights
  where the desk counted MORE in some club (the unexpected way). Dates, club
  table names and whole numbers only (`crossCheckOf` drops anything else). A
  failed SELECT keeps the last result. Limits: it only sees nights the desk
  ran (none before it existed: `compared` 0, "Nothing to compare with the desk
  yet"); a night the desk counted only some children (the rest on paper or the
  laptop) reads LOWER at the desk, which is expected and worded kindly in the
  History section; the summary still answers the desk's live line for those.
- **Not configured** (`state: 'not-configured'`, `reason`): `no-secrets` (no
  `TWOTIMTWO_*`), `cloud-off` (`CLOUD_CHECKIN = "off"`: the alarm does not run),
  `history-off` (no `HISTORY_DB`), `sign-in-refused`, `no-permission` (403 on the
  report). It reads nothing and waits.

## 4. Stations (BUILT: register, list, revoke, the roster and the completed books)

| Route | Auth | Request | Answer |
| --- | --- | --- | --- |
| `POST /v1/station/register` **BUILT** | session | `{stationId, name, pub, kid}`; `stationId` is the KVBC Awana app's `roles.json` `deviceId` (8 to 64 of `A-Za-z0-9._-`); `pub` is the 65-byte raw P-256 key in base64, `kid` must be its `kidOf` (the Worker checks it, a hash); the private key is in Electron safeStorage (the app refuses the station role when safeStorage is unavailable) | stores it in the `stations` document; the same `stationId` may replace its own key (keeps `registeredAt`). `{ok, station, stations: [...list]}`. 409: another station already uses that key, or ten stations are registered (`STATIONS_MAX`) |
| `GET /v1/stations` **BUILT** | session | | `[{stationId, name, pub, kid, registeredAt, lastSeenAt, printer}]` (what a client seals bundles to) |
| `DELETE /v1/stations/<stationId>` **BUILT** | session | | removes a dead computer's key; `{ok, stations}`, 404 when unknown. Bundles already sealed to it stay unreadable to it only. Its calls answer 403 from then on |
| `GET /v1/station/roster-source?night=` **BUILT** | station | | `{csv, rows, readAt}`: TwoTimTwo's roster CSV exactly as it came (`/clubber/csv`), read through the Worker on the read clock (interactive wait), passed through in memory and never stored. At most one every 5 minutes (`ROSTER_SOURCE_GAP_MS`; 429 `{retryAfterMs}`); a cut download (its `Clubber Count=` footer disagrees), a page or a sign-in form is 502 `{reason: 'roster-partial' \| 'roster-unreadable' \| ...}`. For a station that seals the roster itself; the Worker's own refresh (below) makes it unnecessary |
| `PUT /v1/station/roster` **BUILT** | station | `{night, bundle}` (`kind: 'roster'`, allergies inside; `night` tonight) | sealed to every registered station or refused (`Stations.checkBundle`: 400 `unsealed`, 409 `stations-changed` with the list); stored as `station:roster` (the latest wins, a PUT or the Worker's own read); `{ok}`. Held to `BODY_MAX` (128 KB) like every body: a roster for more than one station on the 65536 rung does not fit, the Worker's own read does |
| `GET /v1/station/roster?night=` **BUILT** | station | | `{bundle, night, readAt, rows}`: the NEWEST roster, whatever night it was read (`night` is the bundle's). 404 `{reason: 'none'}` before the first read, `'resealing'` when this station has no copy in it yet (a station registered since: the roster is read and sealed again), and `'old-app'` for a station whose heartbeat reports an app below 10.0.0 (`FEEDS_FROM_VERSION`; it still has the extension, so it is answered as before these routes existed). A stale or missing copy asks for a read at once (the alarm is set a second out, even outside the window) |
| `PUT /v1/station/books` / `GET /v1/station/books?night=` **BUILT** | station | `{night, bundle}` (`kind: 'books'`, completed books) | as the roster (`station:books`) |

**The Worker's own read of both** (BUILT, `src/stationfeeds.js`, owner 2026-10-16:
the Chrome extension goes, so nothing on the laptop reads TwoTimTwo any more). The
watcher's alarm reads them itself and seals them to the stations; the print role's
bundle sync (`job-puller.js createBundleSync`, every minute) GETs and opens them and
feeds its own `/update-csv {csv}` and `/feed/completed-books {entries}`.

- **Roster** (`kind: 'roster'`, record `{csv}`): `/clubber/csv` about hourly in the
  watch window (`ROSTER_FRESH_MS`), once a day outside it, and at once when a station
  asks with a stale or missing copy; only while at least one station runs 10.0.0. The
  CSV is TwoTimTwo's own with the household's contact, address and payment columns left
  out (`twotimtwo.js trimRosterCsv`: parent/guardian, address, city, state, zip, every
  phone, email, emergency contact, others pickup, doctor, church, payments, rate, shirt
  size, invited by, created/updated), every field quoted, with the `Clubber Count=<n>`
  footer: the print server's `parseCSV` reads it unchanged (`test/stationfeeds.test.js`
  runs it). A cut download (footer disagrees), a page, a sign-in form, an empty roster,
  or one that lost more than half its children on one read (a second read must agree)
  keeps the last good copy; a failed read is tried again after 10 minutes. An unchanged
  roster (a keyed digest of the plaintext) is not sealed again.
- **Completed books** (`kind: 'books'`, record `{entries: [{name, book, date}]}`): the
  extension's `runCompletedBooks`, `/report/completed_books?output=csv&club_id=<id>&from_date=<21 days back>&to_date=<today>`
  for clubs 2, 3, 4, 5, 6 (church-config `sharesClubIds`), at most 300 a club, merged
  (at most 500), every 10 minutes in club hours (`CLUB_NIGHTS` 5:30 to 8 pm), one club
  per free slot. A club that cannot be read is skipped (the stations merge what they
  get); a pass where none could keeps the last good copy.
- **The seal** (the free plan's 10 ms CPU): the read keeps the record in MEMORY and each
  following alarm tick seals it to ONE station (an ECIES entry is per station; a
  church-sized roster is about 3 to 4 ms to one station under Node,
  `test/stationfeeds.test.js` prints it); when every station has its entry the bundle
  is stored and the plaintext dropped. A restarted object reads again. What rests is
  ciphertext sealed to the stations' keys only: never the state key, never the history
  key (the medical notes rule).

A job's bundle must be sealed to **every** registered station and nobody else
(`Stations.checkBundle`): a missing station answers 409
`{reason: 'stations-changed', stations}` and the client reseals, so a job is
never unreadable to a station about to lease it. Medical notes are sealed ONLY
to station keys, never to the history key (`sealRow` refuses a record with a
medical key).

## 5. The desk page (the Worker's claim API and the page are BUILT)

Our check-in page, awana.kvbchurch.org/checkin (phones, tablets and the desk,
one page since 2026-10-12; `/desk` 301s there; the page is
`printer/print-server/public/phone.html`, its transport
`site/checkin/desk-transport.js`), and the TwoTimTwo page fallback. "The desk
page" below is that page. The desk page derives keys at sign-in, fetches `/v1/stations` and
`/v1/history/key`, and seals before it posts. The handlers are thin: the
behaviour is `desk.js`, which the page calls through these routes.

| Route | Auth | Request | Answer |
| --- | --- | --- | --- |
| `GET /v1/desk/roster` **BUILT** | session | | `awayReady: true` and per child `away` (not seen on either of the last two club nights) once both are known (recent.js, owner 2026-10-15); per child `usual` (minutes after local midnight, rounded) = its average first-seen time over this season's club nights before today (season from August 1; nights the watcher saw live only), absent when never timed (recent.js `usualOf`, owner 2026-10-15); on a day with no club (a TEST DAY since 2026-10-15, below): the same roster read from TwoTimTwo plus `testDay: {today, next, meeting}`; otherwise tonight's check-in page roster `{readAt, stale?, restored?, kids: [{clubberId, first, last, club, clubId, checkedIn}], familiesAt?}` (no medical data; plaintext over TLS, from the last read, held in memory and kept SEALED in storage for the night, see "The held page across a restart" below). After a restart, a page read back from storage is the answer at once, `restored: true` (not `stale`: the page's "TwoTimTwo is not answering" note is for a failed read), and the watcher's alarm reads a fresh one in its next free slot. A page at most 30 s old (`CHECKIN_PAGE_TTL_MS`) is the answer; the watcher's alarm reads it ahead in a free slot while pages poll (pages poll every 15 s), else the request reads it through the read clock, waiting its turn up to 20 s; a clock booked past that answers the last read marked `stale`, or 429 `{reason: 'read-busy', retryAfterMs}` with none. `familiesAt`: when the Worker's household list was read (a page that sees it move asks `/v1/desk/families` again) |
| `GET /v1/desk/families` **BUILT** | session | | `{households: string[][], familiesAt?, familiesError?}`: TwoTimTwo's households (names only, two or more active children each), one read of the export per 30 minutes through the read clock, kept in memory only (`families.js`). A child the roster or the report names that the export does not list at all (a family registered tonight) makes the watcher re-read it in a free slot: at most one such read every 15 s and at most once per unknown child per night; `familiesAt` then moves; a failed read is `[]` plus a fixed `familiesError` code (kept five minutes), a clock turn-away is 429 `{reason: 'read-busy', retryAfterMs}` and not kept. The roster answer also carries `items: {bible: [club], friend: [club]}` (which clubs offer them, from the page it already read) |
| `POST /v1/desk/checkin` **BUILT** | session | `{night, clubberId \| visitor: {first, last, club}, items, friendName?, historyRow: Row, job: Bundle \| null}`; `friendName` (the friend's first name, cleaned to 24 characters) is kept only with `Friend` in `items` and goes ONLY to the 6:30 BARF list (`friends.js`, sealed under the Worker's key for 3 days, exactly what the phone path sent); `night` is the church's local date (else 400 `wrong-night`); `items` is `{Bible?, Friend?}` or `['Bible', 'Friend']`; `job.id` is the jobId, `job.kind` is `print-job`, `job.night` is `night`; `job` may be null only while no station is registered | see below |
| `POST /v1/desk/undo` **BUILT** | session | `{night, clubberId \| visitor, historyRow}` | TwoTimTwo's undo (`checkinclubberundo`, accepted on "(checkin undone)"), then the claim goes `undone` (gen + 1), every unprinted job of that child is dropped, and a TwoTimTwo-page check-in of theirs still waiting on the watcher's backlog is forgotten (`adopt.forget`), so it is never adopted: `{ok, droppedJobs}`. A refusal is 409 `{reason}`, a timeout 504 `{reason: 'unsure'}`: nothing is changed here, and the watcher settles what TwoTimTwo has |
| `POST /v1/desk/checkout` **BUILT** | session | `{night, clubberId \| visitor, historyRow}` | TwoTimTwo check-out (accepted only on "OK"): `{ok}`. The claim is left as it is |
| `GET /v1/desk/tonight` **BUILT (P5)** | session | | `{night, source: 'report' \| 'history', checkedIn, checkedOut, byClub, reportAgeMs, enabled}`: `authoritativeTonight()` from the Worker's own state (the shared module, not a port; section 8). Answers in shadow mode too, so the owner can compare it with the laptop's count |

**Test days** (BUILT, `desk.js` TEST DAYS; owner 2026-10-15: "I still want to be able
to check people in when it's not Wednesday ... I want to test and then just hit the undo
button. I want it to be a real test", "Auto-undo overnight"). This REPLACES the desk's
roster/check-in/undo refusals below: on a day with no club the roster reads the page and
answers `testDay`; `POST /v1/desk/checkin` and `/v1/desk/undo` are real (TwoTimTwo,
claim, label), posted into the meeting TwoTimTwo shows (its next one) with `testDay` on
the write so the client's guard lets them through, answer `testDay: true`, and fire NO
hooks (no history row, no count, no book). Each test check-in is kept sealed
(`desk:testday`: night, clubber id, meeting id); a hand undo removes it; the cron after
that night (`sweepTestDay`, the 6-hourly run, about 2 am Eastern) undoes the rest on
TwoTimTwo (3 tries each, then logged). Check-out and the BARF routes keep the
`no-club` refusal. The page shows a
yellow strip and no Check out.

**No club tonight** (BUILT, `desk.js` + `clubday.js`; owner 2026-10-13, after
/checkin sat on "Reading the roster..." on a Monday evening while the Worker
tried TwoTimTwo, whose check-in page on such a day shows some other meeting: a
tap would check a child into it). A club day is decided by THE club-night rule,
`lobby/shared/clubNight.js` `clubNightToday` (the one the TVs and the KVBC
Awana app use), given `lobby/shared/schedule.json` (bundled at deploy: its time
zone, meeting day and `specialDates`, so a `noClub` date is never a club day and
a special meeting with its own `windows` is one) and the calendar the Worker
keeps (storage `calendar`: an extra club night it lists is a club day, a
cancelled one is not, a date past its last event is past the season). It is the
WHOLE local day, midnight to midnight in the church's zone, not only the watch
window (early arrivals, set-up). On any other day: `GET /v1/desk/roster` answers
at once `{noClub: true, today, next, readAt, kids: [], items: {bible: [],
friend: []}}` (`today` and `next` are YYYY-MM-DD in the church's zone; `next` is
the next club day within 120 days, `null` when none is known, e.g. past the
season), reads nothing and does not mark the roster wanted (so the alarm reads
nothing ahead either); `POST /v1/desk/checkin|undo|checkout` and `POST
/v1/desk/barf-late` (its recheck too) answer 409 `{ok: false, reason: 'no-club',
today, next}` right after the `wrong-night` check (unchanged, first), before any
read, claim, job or post. **Rehearsal** goes through as before: while the print
station's rehearsal mode is on (armed on the laptop from /settings, Printing →
At the laptop; the station sends `rehearsal` in `POST /v1/station/extras` on a
change and every minute or two; `publisher.js rehearsing()`: heard within 5
minutes, memory only, so a laptop gone away armed, or a restart, ends it until
the next post) every route behaves as on a club day. The page shows one note,
"No club tonight" and "Next club night: Wednesday, October 14", and asks again
every 60 s (desk-transport.js maps `no-club` to `DeskError` `no-club`, "There is
no club tonight."). The rule lives in ONE place, `watcher.js clubToday()` (the
desk asks it), and covers every TwoTimTwo write. The older cloud check-in paths
(`POST /v1/cloud/checkin` and the relayed phone check-in of `/checkin/classic`)
were deleted with the laptop relay (2026-10-16): the desk's routes are the only
check-in writes. Under every entry, the TwoTimTwo client's own check-in, undo and
check-out posts ask again (`watcher.clientFor` gives it a `writeGuard`) and are
refused `no-club` unsent, so a path added later cannot post into another
meeting. `test/noclub.test.js`.

Since 2026-10-12 (owner) the page sends no `visitor`: a child not on the list gets
a walk-in name tag (a `reprint:` job on `/print-oneoff`, never counted). The
Worker keeps the `visitor` shape (and `visitorTag`) unchanged; nothing else sends it.

**`POST /v1/desk/checkin`, in order** (nothing is checked-and-set across the
network call):

1. **Fail closed.** No `historyRow` of the Row shape for tonight, or (with
   stations registered) no `job` sealed to exactly the registered stations:
   nothing is written, 400 `{reason: 'unsealed', what}`, or 409
   `{reason: 'stations-changed', stations}`.
2. **Claim** the child: `identityTag` for a clubber id, `visitorTag` for a
   visitor. A child already claimed answers 200 `{ok: true, already: true,
   state, jobId}` and nothing is posted twice, from this desk or a second one.
3. The `job` is stored **with** the claim (not leasable while the claim is
   `checking`).
4. **Post to TwoTimTwo** (a visitor is not on TwoTimTwo: no post). Success, or
   TwoTimTwo already having the child ("already checked in"), settles the claim
   `queued`. A definite refusal releases the claim and drops the job: 409
   `{reason}`. A timeout or network error is AMBIGUOUS (TwoTimTwo may have it):
   the claim is released, the job dropped, 504 `{reason: 'unsure', retry: true}`;
   if TwoTimTwo did record it, the watcher finds the child on the report and
   claims and prints it itself. If the watcher already PROMOTED this claim to
   `queued` while the post was out (slow, failed or refused alike), TwoTimTwo
   has the child: the job is kept, the hooks fire and the answer is the
   ordinary success, the same as a promoted claim at the settle.
5. **Hooks.** `desk.hooks.afterCheckin / afterUndo / afterCheckout` are arrays
   of functions the history (P6, registered) and the count (P5, `publisher.js`,
   registered) modules push to; each gets
   `{night, tag, clubberId?, gen, jobId, club, name, visitor, historyRow, source}` (`name`
   is in memory for the call; the count keeps only the FIRST name, sealed: section 8). A hook
   that throws never fails the check-in. The answer is `{ok, already: false, jobId, gen, history: 'hooked'}`:
   the sealed row is stored (section 3), counted in `night_summary`, and
   ciphertext only. The `historyRow` is **sealed by the desk page, never the
   Worker**; `desk.checkRow` (history.js) accepts only a row of the Row shape for
   tonight under the current history `kid`.

**The print job the desk page seals** (`job`, a Bundle of `kind: 'print-job'`,
`id` = the jobId, one `to` entry per registered station). Its sealed record is
exactly what the print role runs:
`{route: '/print', body: {name, clubName, clubberId?, visitor?, friend?, friendName?}, clubberId, source: 'desk'}` (`body` is the print server's own `POST /print` body: `name` is split there, a visitor has no `clubberId` and `visitor: true`; Bible is an `items` flag for TwoTimTwo and is not a print field).
`route` is one of the print server's own print routes (`/print`, `/reprint`,
`/print-barf-bags`, `/print-barf-tag` (9.3.1+, 5.1), `/print-custom`, `/print-oneoff`,
`/print-leader`, `/print-award`, `/print-welcome` (9.4.8+: the `/checkin/ym` check-in, the
same body as `/print`, the TV's welcome and the history row with NO label; owner 2026-10-15)),
`body` that route's own JSON. The page does NOT know the claim's
`gen` (the Worker assigns it): the lease carries it, plaintext (section 6), and
the print role uses that over any `gen` in the record. The Worker adds
`cloud: true` / `regen` itself on the print server side; the page never sends
them.

**A check-in never waits for a read** (owner 2026-10-12: "When someone is
checking in a child it should be instantaneous as much as possible, never a
wait"; TwoTimTwo still confirms before the label prints, unless EARLY below). What check-in, undo
and check-out need from the check-in page (the meeting's `calendar_id`, the
items and their clubs, each child's club) does not change within a meeting:
the desk keeps the page for the whole club night (`hasNightPage`), warmed by
the watcher when the watch window opens (and again after a restart) and
refreshed by the roster's reads. A desk action uses it and reads nothing. Only
with nothing held for tonight, or a child the held page does not list, does it
read, and then URGENT: the head of the read queue, ahead of every queued
roster, households, Checkout-page or report read, never inside 15 s of a read
already started (`readbudget.js`). A post that meets a lapsed session (the
login form) signs in again at the head of the queue and is made once more
(`TwoTimTwoClient.write`, `{desk: true}`).

Read failures on the way answer 429 `{reason: 'read-busy', retryAfterMs}`,
502 `{reason: 'twotimtwo-unreadable'}` or 503 `{reason: 'not-configured'}`.

**The held page across a restart** (BUILT, `desk.js`; owner 2026-10-12, after
/checkin sat on "Reading the roster..." past a Worker deploy: every deploy
empties the object's memory, and a cold read waits for the clock and a fresh
TwoTimTwo sign-in, about a minute). After each read (the desk's, the roster's
read ahead, the watcher's warm read) the page held is written to storage as
`desk:page`: ONE blob sealed under the state key (`watcher.js sealState`, as
`cloud:snap` and `tonight:book`), holding `{at, night, page}` where `page` is
exactly what the desk reads (`compactPage`: `calendarId`, the items `{id,
clubs, automatic, label}`, per child `{clubberId, clubId, name, club,
checkedIn}`). Written only while the watch window is open, at most once a
minute unless the list or a checked-in mark moved (bounded writes), never
over 120 KB (300 children are about 52 KB; a bigger page is not written at
all, never cut down). A new object reads it back once, lazily, on the first
roster or desk call: only when it is tonight's (`churchNight`), opens, and is
under 6 hours old; another night's, an older one, or one that will not open is
deleted and the call goes on as before, never an error. A look that could not
run yet (cloud check-in off, no TwoTimTwo secret, a storage error) is not the
one look: it is tried again on a later call, at most once a minute, so a mode
turned back on mid-evening still finds the page. A restored page counts
as held (`hasNightPage`): desk actions read nothing, and `rosterRefreshInMs()`
is 0, so the alarm's next free slot replaces it with a fresh read (no read is
started from the request path). A failed read with a restored copy in hand is
the ordinary `stale`. Deleted when the watch window closes (the watcher's
end-of-night purge, with `tonight:book`; also `arm()` from the cron with the
watcher switched off), so it never reaches the next night.

**Privacy (owner may veto):** this puts a sealed copy of tonight's whole
check-in page roster at rest in the Worker's storage until the window closes:
every child the page lists (all active clubbers, not only those who came),
with clubber id, FULL name, club and checked-in mark. It is the pattern of
`cloud:snap` (ids and clubs) and `tonight:book` (first names), but it ALSO
keeps LAST names at rest, sealed, for the whole roster, which nothing did
before (the friends list keeps full names only of children who brought a
friend, and the print backlog only for seconds). Storage alone opens nothing
(the key comes from the TwoTimTwo password secret); no plaintext name or id is
stored (`test/deskpage.test.js`).

**The claim ledger** (`ledger.js`): `checking` (60 s, `CHECKING_TTL_MS`) ->
`queued` -> `printed`, or `undone`. `gen` only goes up: undo (or the child
vanishing from the report) bumps it, and so does checking the child in again;
a ttl-expired `checking` is taken over at gen + 1, so the old attempt cannot
settle. A claim a failed post releases goes `undone` at the same gen (never
deleted, so a gen is never reused). Every check-and-set is one synchronous step
in memory with a write-through to Durable Object storage, loaded once after a
restart. Claims are purged when the watch window closes (`adopt.endOfNight`).

**The TwoTimTwo page fallback** (BUILT in the watcher, `adopt.js`, switched by
`CLOUD_PRINT = "on"`). A check-in made on TwoTimTwo's own page is seen by the
watcher as a child newly on the report:

- no claim (or an undone one): claim `source: 'ttt'` (gen + 1 over an undone
  one) and a job **sealed to the stations in the Worker** with
  `sealForStations`, record `{route: '/print', body: {name, clubName?,
  clubberId}, clubberId, gen, source: 'ttt'}` (`adopt.js printRecord`: the same
  record the desk page's jobs carry, with the claim's gen; the owner's
  2026-10-12 decision, which supersedes the earlier `raw`-leased design). The
  PRINT ROLE then writes the `checkin` history row for it (`source: 'ttt'`,
  section 3) when it prints, since the Worker cannot seal one;
- a `checking` claim (the desk's post went through, its answer was lost):
  promoted to `queued`, its stored job prints;
- a claim already `queued` / `printed`: nothing;
- gone from the report (an applied read only): `queued` / `printed` -> `undone`,
  gen + 1, the unprinted job dropped.

**CPU on the free plan (10 ms per invocation).** One seal is ~2.6 to 4.2 ms for
3 stations (Node; `test/adopt.test.js` measures it). The report read only does
the cheap part (an HMAC per child) and puts the child on a backlog sealed under
the Worker's state key (it holds the name); **at most one job is sealed per
alarm tick or per `GET /v1/print/next`** (`SEAL_PER_TICK = 1`), and while any
wait the watcher asks for another tick `SPILL_MS` (1 s) later. With no station
registered the job waits as a `raw` body (sealed under the state key; the Worker's
own, never leased and never shown to a station) and `drain()` seals it to the
stations once one registers. Brought a friend: a child the report marks Brought a friend gets `friend: true` in the
job body, so the station also prints the BARFED tag on a BARF night (section 8, "BARF on
the TwoTimTwo-page fallback").

**Early labels** (BUILT, `desk.js`; owner 2026-10-15: "labels print sooner ... before
TwoTimTwo processes", "only print sooner when safe", "last 3 went fine"). The desk keeps the
last `EARLY_AFTER` (3) posts' outcomes in memory; while all went through first time in under
`EARLY_FAST_MS` (10 s), a check-in's job is stored `early` and may be leased while its claim
is still `checking` (`printq.verdict`). A station's done on a `checking` claim marks it
`printedEarly` (`settle`/`promote` then make it `printed`). When the post fails: a job no
station leased is dropped and the claim released as ever; a leased or done one stays, the
claim goes live (`queued`, or `printed`) with `recheck: {bible, friend, early: true}`
(`ledger.keepForRecheck`; never undone by the report's gap, never adopted), and the answer is
the refusal with `printed: true` (same status). The next `POST /v1/desk/checkin` of that child
is the post alone (`desk.recheckEarly`): no new job, success clears `recheck`, fires the hooks
(history row, count) and answers `{ok, already: false, recheck: true, jobId, gen}`; a failure is
`printed: true` again. The page retries a `printed` failure by itself unless it is a flat
refusal (`CLAUDE.md` "ONE check-in page"). Tests `test/early.test.js`.

### 5.1 A late BARF friend (BUILT, `barf.js`; owner 2026-10-12)

A child already checked in tonight brought a friend after all. The page's green
BARF button (shown only on a BARF night) picks the child and the friend's first
name; ONE Worker operation does the rest, so nothing prints, greets or counts twice.

| Route | Auth | Request | Answer |
| --- | --- | --- | --- |
| `GET /v1/desk/barf` | session | | `{night, barfNight: true \| false \| null, friends: [clubberId], recheck: [{clubberId, items: {Bible, Friend: true}}], tagRoute, stations}`. `barfNight` = the church settings' `barfNights` (10.3) holds tonight, the station's own rule; `null` (the page hides the button) with no church settings or `CHURCH_SETTINGS` off. `friends`: children who already brought one tonight (the friends list and the applied report's YES). `tagRoute`: `/print-barf-tag` when EVERY registered station reports 9.3.1 or later, else `/print-custom` (what 9.3.0 runs: a job route it would refuse is never sent). `recheck`: children whose late-friend redo never took and who still wait to be checked in again (their claim is marked `recheck`), so a reloaded page shows the red line again. No TwoTimTwo read |
| `POST /v1/desk/barf-late` | session | `{night, clubberId, friendName, friendClub?, historyRow: Row (kind 'barf-friend'), tagJob: {jobId: 'reprint:<uuid>', bundle} \| null}`; `tagJob` sealed to every station (record `{route: tagRoute, body: {firstName, clubName}}` or `{route: '/print-custom', body: {text: 'BARFED! <first>'}}`), null only with no station | `{ok, checkedIn, items: {Bible, Friend: true}, jobId, history, reason?, tries?}` (below). 400 `wrong-night` / `no-child` / `no-friend-name` / `unsealed` (`what`); 409 `no-club` (section 5, "No club tonight"), `not-barf-night`, `already-friend`, `busy` (another operation, or a desk check-in being posted), `not-on-report`, `not-found`, `no-friend-item`, `no-attendance-item`, `stations-changed`; 429 / 502 / 503 as 5 |
| `POST /v1/desk/barf-late` (recheck) | session | `{night, clubberId, recheck: true, items}` (the `items` the failed answer gave) | the redo alone: `{ok, checkedIn, items, reason?}`. One urgent read of the check-in page first (never the page held for the night): a child TwoTimTwo already has is success with no post. No label, no list, no row |

In order: refuse early (above; the friend check and the mark are one synchronous
step per child); ONE report read on the 15 s read clock (section 7), URGENT like
every desk action's read (the head of the queue; the child must be on it; YES
under Bible is `items.Bible`); the check-in page is the one held for the night
(no read unless none is held, the child is not on it or it lacks the items; then one urgent read); **hold** the child on the report
(`watcher.hold`: every read until the hold ends lists them, memory only); TwoTimTwo's
undo (an ambiguous one is checked on the check-in page: still checked in = 504
`unsure`, nothing changed), then its check-in with the same items plus Brought a
friend, up to 3 tries (desk writes, no read slot; a lapsed session signs in again
urgently). So a watcher read in the gap sees no
child leave and none arrive: no claim undone (same gen, same state), no job
dropped, no TwoTimTwo-page check-in adopted, no greeting, the count unchanged.
Then, whatever the redo did: the BARF tag job is queued as a `reprint:` job
(no claim; the station journals it, at most once; nothing greets), the friend goes
on the friends list (`friends.record`: the 6:30 email and `bagNames`, the BARF
bags), the sealed row is kept (no `night_summary` line). A redo that took keeps
the hold 45 s more (`HOLD_AFTER_MS`: the report every 30 s, pushed back one
15 s slot at most, so at least one report read after the redo is read held); one that never took lets it go at once (the next read sees
the truth: the count down) and answers `checkedIn: false` with `reason`. The
claim stays live, marked `recheck` (the child's Bible, nothing named): the report's
gap never undoes it, nothing adopts the child as new, `GET /v1/desk/barf` lists them
(`recheck`), and a NORMAL desk check-in tap on them (`POST /v1/desk/checkin`) is the
re-check-in alone: `{ok, already: false, recheck: true, jobId: null, items}`, or 409
`not-checked-in-again` (still waiting); no claim, job, row or greeting. The page shows
"<Child> is NOT checked in on TwoTimTwo" and a one-tap recheck, which keeps (or makes:
queued, no job) the live claim and holds the child BEFORE its post, so the watcher never
adopts them as new; a recheck that went through clears `recheck`, a failed one leaves it
(a claim it made itself is undone again). The child's name tag is never reprinted.

## 6. Print (BUILT)

A station (`X-Station`) leases a job for **90 s** (`LEASE_MS`), prints it and says
done. **These five names are the only ones** (the first draft's `lease` / `ack` /
`hello` aliases were removed: nothing used them). The print role calls exactly
these (`job-puller.js`; the end-to-end test records every path it uses).

| Route | Auth | Request | Answer |
| --- | --- | --- | --- |
| `GET /v1/print/next?max=1..10` | station | | `{jobs: [{jobId, kind: 'checkin' \| 'reprint', night, gen, bundle, leaseUntil, attempt}], leaseMs: 90000}`. Sweeps expired leases back into the queue first; **drops** (never leases) a job whose claim is undone, on another `gen`, already printed, or older than two hours; skips a job whose claim is still `checking`, and one with no bundle yet; oldest first. Seals at most one waiting TwoTimTwo-page job first. `bundle` is the station-sealed job (section 5 for its record); `gen` is the claim's generation in plaintext |
| `POST /v1/print/done` | station | `{jobId, result?: 'printed' \| 'already-spooled'}` | `{ok, already}`. Idempotent: a job already done, or gone (undone, purged) answers ok. `printed` marks the claim `printed` if the job's gen is still the claim's. `already-spooled` (the station journalled the jobId and did not print again) completes the job and raises `checkThePrinter` |
| `POST /v1/print/failed` | station | `{jobId, error?: <short code a-z0-9->}` (any other text is stored as `failed`) | `{ok, state}`: the job is free for another lease at once; after five failures it is `dead` and shows on the status. A job no station can ever run (`no-payload`, `bundle-id-mismatch`, `route-not-allowed`, `stale-night`: `MALFORMED_CODES`, the puller's `MALFORMED`) is `dead` at once, and the station does not pause for it |
| `POST /v1/print/heartbeat` | station | `{jobId?, printer?: {state, detail?}}` every 30 s, and every 20 s while a job prints | with `jobId`: `{ok: true, leaseUntil}` **extends the lease to now + 90 s**, or `{ok: false, reason}` where `unknown` (dropped: stop), `done`, `stale`, `other` (another station holds it). The printer state (`ok busy offline error paper unknown`; anything else is `unknown`) and `lastSeenAt` are noted for the status. The print role reports a label that may not have come out as `error` with `detail` |
| `GET /v1/print/status` | session | | `{queued, leased, done, dead, waitingToSeal, checkThePrinter: [jobId], dropped: {stale, expired}, claims: {checking, queued, printed, undone}, pendingToSeal, cloudPrint, stations: [{stationId, name, lastSeenAt, printer}]}`. Counts and random ids only |
| `POST /v1/print/reprint` | session | `{jobId: 'reprint:<uuid>', bundle}` sealed to every station, `kind` `print-job`, `night` tonight | a reprint job: bypasses the claims entirely. `{ok, jobId, existing}` |

**The wake-up call** (BUILT, owner 2026-10-15). A station also opens the live channel
as itself, `GET /v1/live?session=<its session>&station=<stationId>` (WebSocket; the id
matches `[A-Za-z0-9._-]{8,64}`): that socket gets NO catch-up frames and hears only
`{e: 'changed', d: {what: 'print'}}`, sent to station sockets alone (index.js
`ringStations`) whenever a label could be leased now (`printq.readyCount() > 0`,
`SyncCore.wakeStations`): after a 200 POST on `/v1/desk/*`, `/v1/print/reprint` or
`/v1/cloud/*`, after each alarm tick, and from the desk right after an early job is
stored. The station then leases at once (`?max=10`); its 5 s poll stays the fallback.
Counts only: the ring names nobody and reads nothing from TwoTimTwo.

**Job ids.** A check-in job's id is its bundle's `id` (22 base64url
characters); a reprint's `jobId` is `reprint:<uuid>` while its bundle keeps a
22-character id (the AAD format): the print role checks `bundle.id === jobId`
for a check-in only. A job is the same station-pad sealed bundle everywhere.

**What the print role does with a job** (`job-puller.js`): opens the bundle with
its station key, takes the record `{route, body, clubberId?, gen?, source?}`,
refuses a route outside the print routes, and runs it on its own print server
from loopback, so every old rule applies. For `/print` it sets `cloud: true`,
`cloudJob: <jobId>` (the greeting the print makes goes to the Worker with the job,
section 8) and, when the lease's `gen` is above 1 (an undo and a new check-in),
`regen: true`, which tells the print server's own duplicate rules that this is a
NEW tag.

**GEN SEMANTICS (one place).** A claim's `gen` starts at 1 and only goes up: an
undo (or the child vanishing from TwoTimTwo's report) makes it `undone` at
gen + 1, and the next claim of that child takes gen + 1 again, so a first
check-in, an undo and a second check-in are gens 1, then 3. A job carries the
gen it was made for; the Worker leases it only while the claim is `queued` at
that gen. The print role takes the gen from the LEASE (the Worker's truth;
a `gen` inside the sealed record is a fallback), and journals `night:clubberId:gen`
as one tag, so two jobs of one generation print once and a later generation
prints again.

**At most once** (the print role's side; no label twice is worse than a missing
one). The station journals every jobId BEFORE it touches the printer
(`print-journal.json`): `spooling`, then `printed`. A job it already holds is
never printed again: it acks `printed` (it came out) or `already-spooled` (it was
mid-print or its outcome is unknown) and the Worker raises "check the printer"
for the latter. A print that gets no answer is unknown, never retried; only a
definite refusal from the print route is `failed` and may run again. An ack that
does not get through is retried every round, never reprinted: **a lost ack plus a
restart plus a lease that expired does not print a second label** (the Worker
offers the job again, the journal says it printed). A lease that is never
renewed or finished goes back to the queue, so a second station can print it;
the journal cannot stop that across stations, which is why a job is leased to one
at a time. A 404 / 409 / 410 on an ack means the Worker dropped the job (an
undo): the station ends it quietly.

## 7. Adding routes, the read clock, the switches (BUILT)

- **The registry** (`registry.js`): a module adds its routes with
  `registry.add(method, '/v1/path/:param', 'public'|'session'|'station', handler)`
  and ONE line in SyncCore's constructor (`mountCheckin(this.registry, this)`;
  `mountHistory(this.registry, this)` beside it). `sync.js` checks the auth level
  (`runRoute`), so a handler only sees a valid session, or a valid session plus
  a registered station (`ctx.stationId`); a handler gets `{core, request, url,
  params, ip, stationId, body}` and returns `json(...)` / `fail(...)` from
  `http.js`. A method + pattern registers once: a second add throws.
- **The read clock** (`readbudget.js`): every TwoTimTwo page GET (the watcher's
  report, the desk, the phone page, the check-in, check-out and household
  pages) takes a slot through `TwoTimTwoClient.page(path, {waitMs, kind})`. One
  read every 15 s in all (owner 2026-10-12, while the laptop's extension tab
  still reads; 5 s once it is retired), so 4 a minute. A caller says how long it
  will queue (`waitMs`): 0 for the watcher's own reads (it skips its turn),
  `INTERACTIVE_WAIT_MS` (20 s, more than one slot) for a desk or phone request,
  and a refusal is `{error: 'read-busy', retryAfterMs}`. **How the 4 slots are
  shared:** the watcher's report every 30 s (`WATCH_INTERVAL_MS`); the watcher
  RESERVES its next report's moment, so every other read keeps a slot clear of
  it and the slots go report, other, report, other. A waiting request that could
  not otherwise be served may take the reserved slot once (the report then reads
  15 s later: at worst 45 s apart, never starved). The watcher's alarm hands out
  the other slot, in this order: tonight's check-in page once (warms the desk),
  a households catch-up (an unknown child), the Checkout page (once a minute
  after 7:15 pm, section 9), the roster's check-in page read ahead while pages
  poll. Outside the window, and never ahead of any of these, the trends
  back-fill (section 3) reads one season in a free slot. Reads a minute: at 6:00 pm report 2 + roster page 2; at 7:30 pm report
  2 + Checkout page 1 + roster page 1 (a poll that finds the page older than 30 s
  reads it itself, waiting its turn).
  **The stations' feeds** (`stationfeeds.js`, section 4; owner 2026-10-16) share the
  same "other" slot, never the report's: the roster export (`/clubber/csv`, about one
  read an hour in the window, once a day outside it, or when a station asks with no
  copy) goes right after the Checkout page and AHEAD of the roster's read-ahead (it is
  what every label's allergies come from: one slot an hour); in club hours the meeting
  report (`/meeting/report`, every 5 minutes) and a completed-books pass (one club per
  slot, 5 reads every 10 minutes) come AFTER the read-ahead and the sealing, in a slot
  nothing above wanted, unless one has waited twice its turn (10 / 20 minutes), when it
  too goes ahead of the read-ahead. So at 6:00 pm with /checkin polling: report 2 +
  roster page about 1.4 + meeting and books about 0.6 a minute; still 4 reads a minute,
  15 s apart. The seals of the roster and books (one station per tick) and of an award
  slip are CPU work in the tick after the read, beside `adopt.drain`, never a read.
  Outside the window the alarm's only feed is the roster (once a day), ahead of the
  trends back-fill. After a restart the page comes back sealed from storage (`desk:page`, section 5), so the
  first roster poll is answered at once and the next free slot refreshes it. A desk action's read (only with nothing
  held, section 5) is URGENT: the head of the queue (queued reads give way and
  book again), never inside 15 s of a read already started. The clock survives
  a restart (`read:next` in storage). The sign-in takes slots too, one per
  request (the form, the login post, its redirect), and so does every redirect
  hop: the first request of a call queues for the caller's `waitMs`, the rest
  behind it (`FOLLOW_WAIT_MS`, 35 s, as `priority` reads that ignore the
  reservation; a desk action's stay URGENT). Sign-ins are shared: a caller that
  finds one under way waits for it. A sign-in that
  meets TwoTimTwo down (5xx) or no network backs off 30 s, 1, 2, then 5 minutes
  (`DOWN_BACKOFF_MS`; answered `twotimtwo-down` with `retryAfterMs` meanwhile; a
  refused password keeps its own 5 / 15 / 60 minutes). The check-in, undo and
  check-out posts themselves are writes and take no slot.
- **Switches** (`wrangler.toml [vars]` are the DEFAULTS since the settings
  overhaul: a stored switch overrides one at runtime, section 10.2):
  `CLOUD_PRINT` (jobs for TwoTimTwo-page check-ins) and `SINGLE_PUBLISHER`
  (in cloud mode the Worker publishes `tally`, `tonight` and the still-here
  list itself, and `POST /v1/publish` drops the laptop's `tally`, `tonight`,
  `checkout` and `checkin` frames with 200 `{dropped: true}`, except the one
  greeting per print job a station sends; section 8). `YM_CHECKOUT` (the
  Worker does the Trek/Journey youth check-out; section 9).

## 8. The one publisher (P5: BUILT)

`src/tonight.js` (the book), `src/publisher.js` (frames, timing, the gate and
three routes), `src/frames.js` (the printer's frame shapes), and the shared
rules `lobby/shared/tonight.js` + `lobby/shared/pickup.js` (the print server runs
the same source through generated copies, `scripts/shared-copies.mjs`:
`authoritativeTonight`, `tonightHereNow`, the identity keys, `reportIsPartial`,
`massUndoRefused`, the pickup list). With `SINGLE_PUBLISHER = "off"` the Worker
still counts (the shadow night's comparison) but publishes nothing and keeps no
first name.

**What is published, and when** (the printer's own rules):

| Frame | Shape | Sealed | When |
| --- | --- | --- | --- |
| `tally` | `{counts, total, at, season?, rehearsal?}` | plaintext numbers | on a change (an applied report, a desk check-in, undo, check-out) and every minute while the watch window is open |
| `tonight` | `{checkedIn, booksCompleted, awardsEarned, friendsBrought, at}` | plaintext numbers | with the tally |
| `checkout` | `{entries: [{firstName, club}], at, printed}` (the still-here list, at most 60, filtered by `pickupClubs`: default every club but Trek and Journey) | **sealed** with the display key, padded on the printer's ladder | inside the window only (60 minutes before the club window to 60 after, `watchWindow`, pinned to the printer's `TALLY_LEAD_MIN` / `TALLY_GRACE_MIN`), on a change (never two within 2 s) and every minute |
| `checkin` | the printer's greeting (birthday, first-timer, milestone, welcome back) | sealed, padded to 512 | by the STATION, once per print job (below) |

**Where the Worker gets each number.** The count comes from its own state, the
applied report (never a partial one or one the mass-undo guard refused: the same
`reportIsPartial` / `massUndoRefused` as the printer's reconcile) plus the desk's
marks (a desk undo beats a report that still lists the child; a check-out takes
the child off; a desk check-in ticks the count before the next read), run through
the shared `authoritativeTonight()`: report when fresh (12 minutes) else the
night's own rows, unregistered visitors only while no report is fresh. What the
Worker cannot know is the print server's: the Screen season and rehearsal flag
that ride the tally, and the pickup list's clubs. The station tells it, plaintext
and non-personal: `POST /v1/station/extras` (station) `{season?, rehearsal?,
pickupClubs?}`, sent every minute and on a change; the books and awards counts
come from the laptop's `tonight` frame the gate drops (it remembers those two
numbers) and, since 2026-10-16, from the Worker's own read of TwoTimTwo's meeting
report (`stationfeeds.js`, every 5 minutes in club hours, the extension's
`parseMeetingReportCsv` rule for rule: a column whose header says "award" counts an
award, "book"/"section" a book; a failed read keeps the last counts). **Award slips**
(BUILT): each row with a name under such a column is one slip, `{name, clubName,
award: <the column's header>}`, at most once per child and award a night (an HMAC tag
of the night, name and award in `awards:slipped`), at most 10 new a read, queued as a
REPRINT-kind job (`reprint:<uuid>`, section 6) whose sealed record is `{route:
'/print-award', body: {name, clubName, award}}` (the print role's `JOB_PULL_ROUTES`
already has it). Slips print from the Worker only once every registered station
reports KVBC Awana 10.0.0 or newer in its heartbeat (`FEEDS_FROM_VERSION`): until then
the extension prints its own, and each slip the Worker sees is only marked. NOTE: the
meeting report's documented header (`"HBGroup","Clubber","Book","Unit","Award","Note"`,
printer/docs/TWOTIMTWO.md 8.1) has no name column the extension's rule knows
("Clubber" is not "Name" / "Clubber Name" / First + Last), so on that layout the counts
are read and no slip is made, as the extension did; widening the rule is the owner's call
(a "Book" column holds every child's current book, which would be a slip per child). `GET /v1/publisher/status` (session) is counts and times only.
Check-outs made by hand on TwoTimTwo's Checkout page (owner 2026-10-15): `POST
/v1/station/checked-out` (station) `{date, clubberIds}` = the extension's list of
children who left that page tonight (print server `sendCheckedOut`, whenever it
grows): each id (digits, max 500) not already out and whose claim is not `undone`
goes off tonight's book (`book.checkout`, as a desk check-out), then one
`publishDue`. `{ok, applied}`; another night's date or a closed watch window
applies nothing (`reason: 'other-night' | 'window-closed'`). Since 2026-10-16 the
Worker sees the same check-outs itself (section 9: its own Checkout page reads), through
the same rule (`Publisher.checkedOut`), so the station's post and the Worker's read of
one child are one check-out.

**Names in the still-here list and the greeting: the design.** The Worker cannot
read names from history (sealed to the history key, which it never holds), and
the pickup board names first names, so something has to know tonight's first
names. Chosen:

- **Still-here: the Worker keeps tonight's FIRST names and clubs, sealed, for
  the night only.** `tonight:book` is one AES-GCM blob under the state key (HKDF
  from the TwoTimTwo password secret, as the watcher's snapshot and the claims'
  tags): a copy of the storage alone opens nothing. It holds the applied
  report's entries (clubber id, FIRST name, club) and the desk's rows (first
  name, club, a visitor's HMAC tag in place of a surname): never a last name,
  birthday, allergy or note. Purged with the claims when the watch window closes.
  It is written only when it changes and only while `SINGLE_PUBLISHER` is on
  (in shadow mode first names are not kept at all: ids and clubs are enough to
  count). Why this and not the station: the Worker already sees these names in
  memory for every check-in it prints or greets and for every report it reads;
  the book adds an at-rest, sealed, one-night copy, not a new reader. The
  station can restart, sleep or be unplugged mid-night, and the pickup list must
  not go quiet or stale with it; a still-here list built from the station's jobs
  would also miss every child already on the report when it started. This is the
  second sealed-names exception after the friend list (`friends.js`, 3 days),
  and the owner should read it as such (SECURITY.md says so).
- **Greeting: the station.** It opens the job, holds the roster and the history
  key, so only it can say birthday / first-timer / milestone. It publishes the
  sealed `checkin` through `POST /v1/publish` with `X-Station` and `X-Job: <jobId>`
  (the job it just printed); the gate lets it through if the station is registered
  and the job is tonight's check-in (not a reprint) and not yet greeted
  (`printq.greet`, one synchronous step, `greeted` on the job), and drops any
  other `checkin` (the laptop's, a retry, a second station's) with 200
  `{dropped: true, reason}`. So a child is greeted exactly once with everything
  the printer used to say, whether the desk page or TwoTimTwo's own page checked
  them in, and the Worker never opens or seals a name for a greeting.
- **Once per CHILD per night, whichever path printed** (review fix, 2026-10-12).
  A label the station prints with NO print job (the touch screen, a hand-made
  check-in on the laptop) greets as the station too, naming the child in the
  publish body: `POST /v1/publish {event: 'checkin', payload, greet: {clubberId}}`
  (or a visitor's `greet: {name, club}`; the id the roster knows wins). The gate
  turns it into the claim's own tag (`identityTag` / `visitorTag`) in memory and
  lets it through once. Every greeting, by job or by child, takes the child's tag
  in `publisher:greeted` (`{night, tags}`: HMACs only, never an id or a name; a new
  night or the end of the window clears it), so a second greeting for the same
  child is `{dropped: true, reason: 'already-greeted'}`. A cloud job that meets a
  label already printed tonight (`printedTonightFor` or the 45 s window) prints
  nothing and greets LATE: the same event the first label made (same `id`, so a
  screen that showed it drops it; a fresh welcome if this computer has none) with
  its `X-Job` and `late: true`. That is how a child whose first greeting the gate
  dropped (a print made without a station) is still greeted once.
  With `SINGLE_PUBLISHER` off the gate passes every greeting as before and drops
  only a `late` one (`reason: 'late'`: the laptop already greeted the child).
  Undo then a new check-in is the same child: not greeted again.
- The youth check-out: with `YM_CHECKOUT = "on"` the Worker does it itself and each
  child comes off this count (section 9). Off, the extension's sweep posts to the
  laptop only and such a child stays on the count here.

**BARF on the TwoTimTwo-page fallback.** The parsed report marks a child
`friend: true` when their row says YES under a Brought a friend column (the
extension's `friendsBrought` rule: the header is searched in every header row, the
cell must read YES). The job the watcher seals for such a child carries `friend: true` in
its `/print` body (`adopt.js printRecord`), so the station prints the BARFED tag after
the child's own on a BARF night (`isBarfNight()`, the church's `barfNights`, which the
print server keeps: the same place that already decides it for the desk and the phone)
and on no other night, with NO friend's name (TwoTimTwo's box has no name field; the tag
is the child's first name alone, as on the desk path). The Worker also records the child
for the 6:30 pm email (`friends.record`, friend's name empty), because a cloud job tells
the station not to report it again; a desk check-in with the Friend item ticked is
recorded the same way (the desk page's sealed job carries the friend's name to the
tag). The same flag counts in the `tonight` frame's `friendsBrought`.

## 9. The youth check-out (BUILT, `YM_CHECKOUT`)

`src/ymcheckout.js`, from the watcher's alarm (no second loop, no new route). The
extension's `ymSweep` rules exactly: club nights (`CLUB_NIGHTS`' weekday) from
**7:15 pm to midnight** Eastern (`YM_AT`; it runs on past the 9 pm watch window),
clubs **Trek and Journey** (`ymClubOf`: a substring of the lowercased club), every
child the watcher's LATEST applied report lists (handed over in memory; it reads
no report of its own), plus any such row the Checkout page lists. Each is checked
out with the Checkout page's own `POST /clubber/checkout` (`calendar_id` +
`clubber_id`, `TwoTimTwoClient.checkOut`), counted only on an exact `OK`; at most
**3 tries** a child a night (`YM_MAX_FAILS`; a signed-out answer is not a try), a
**done list** a night (the report keeps listing a child after a check-out).

- **Pace (owner, 2026-10-12): at most ONE post every 15 s** (`YM_CHECKOUT_GAP_MS`),
  a refused one included: the next allowed moment is claimed in memory in one
  synchronous step and written through (`ym:status.nextPostAt`) before the post, so
  a restart never bursts. Forty children take about ten minutes.
- **Reads.** The Checkout page (`GET /clubber/checkout`: `calendar_id` from its
  script, the date from `select#date`, rows `a.checkout[clubber_id]`) at most every
  60 s (`YM_PAGE_MS`) and only while due, on the one read clock with `waitMs` 0,
  in the slot between two reports (section 7). With the report every 30 s and the
  roster's page that is the 4 reads a minute the 15 s clock allows.
- **Count.** Each check-out goes into tonight's book as a desk check-out does
  (`publisher.deskCheckout`), while the watch window is open (the book is purged
  when it closes): the tally and still-here list drop with `SINGLE_PUBLISHER` on.
- **Check-outs made by hand on that page** (BUILT, owner 2026-10-16: the extension's
  `runCheckout` / `checkoutDisappearances`, which the station's `POST
  /v1/station/checked-out` carried, section 8). Every Checkout page read also takes
  every club's ids (`twotimtwo.js parseCheckoutIds`) when the page was GENUINELY read:
  the extension's four guards (the page's own title; the data table, not the notices
  table; no club filter unticked; rows that parse, or the page's own "nobody here"
  placeholder), else null. A child listed at the last genuine read of that meeting and
  gone at this one has been checked out (`ymcheckout.js checkoutDisappearances`: a read
  that is not genuine compares nothing and keeps the last good one; another meeting
  starts afresh) and comes off tonight's book through `Publisher.checkedOut` (an id
  already out, or whose claim is `undone`, is skipped: an undone check-in also leaves the
  page), while the watch window is open. So this runs from 7:15 pm, as the youth
  check-out's page reads do (the extension read it from 5:30); a child checked out by
  hand before 7:15 pm is seen at the first read after it only if a read before it listed
  them, which none did: at most that early pickup stays on the count until the report
  drops them or the window closes. `ymCheckout.leftPage` / `leftPageCounted` on the status.
- **Storage.** `ym:state` (the night, meeting, page rows, the last genuine read's ids,
  the night's check-outs by hand, done list, tries) is one blob sealed under the state
  key (`sealState`); `ym:status` counts and times only.
- **Status.** `GET /v1/cloud/status` carries `ymCheckout: {enabled, due, at, clubs,
  gapSec, pageSec, maxTries, night, checkedOut, failed, gaveUp, pending, meeting, lastSweep,
  lastPageAt, lastError}`: no name, no id.
- **Hand-off.** A computer that is the Worker's print station (`configureCloud`)
  answers `GET /config/church` with `ymCheckout.enabled: false`, so its extension
  stops sweeping (it reads that at start-up); `stopCloud` hands it back. So turn
  `YM_CHECKOUT` on before, or with, the station role.

## 10. Settings overhaul: switches, church settings, notices, change log, overview (BUILT)

Built (Track A): `src/device.js` (10.1), `src/switches.js` (10.2), `src/church.js`
(10.3), `src/notice.js` (10.4), `src/changes.js` (10.5), `src/overview.js` (10.6),
each mounted with one line in `SyncCore`; tests `test/{changes,switches,church,notice,overview}.test.js`
and `lobby/shared/churchSettings.test.js`. Where the build settled something the
spec left open, or corrected it, the text below says so ("Built:").

Design and build split: `docs/SETTINGS-OVERHAUL.md` (repo root). Section 9 is the
youth check-out (`YM_CHECKOUT`, branch `worker-ymcheckout`); this section assumes
it is merged and names `YM_CHECKOUT` as a switch either way (stored but inert
until `ymcheckout.js` exists). Every rule at the top of this file holds: no key
work in the Worker, counts / codes / church-authored text only, one synchronous
check-and-set with write-through, `BODY_MAX` unless said. Mark each route BUILT
here when it lands.

**Auth (owner decision, 2026-10-12).** The switches (10.2), the church settings
(10.3), notices (10.4) and the change log's undo (10.5) stay `session`: any
session signed in with the passphrase may change them, including a session
made by an OBS / ProPresenter `?passphrase=` link. There is no owner-only role
or second word; the owner accepted that risk after it was explained (anyone
holding a feed link can flip a switch, edit the church settings, post or take
down a notice, or undo a change). Every write is logged with its device (10.1)
and undoable where 10.5 says.

### 10.1 Device identity (every write below, and `PUT /v1/settings|slides|template|journey`, `/v1/screens/*`)

| Header | Value | Use |
| --- | --- | --- |
| `X-Device` | 16..64 of `A-Za-z0-9_-`: the page's `awanaDevice.v1` id, a screen's `awanaScreens.v1` id | change log `device.id` |
| `X-Device-Name` | `encodeURIComponent(name)`, decoded and cleaned with `cleanScreenName` (40) | change log `device.name` |

Both optional (missing = `{kind: 'unknown', name: 'Unknown device'}`). A
registered `X-Station` wins: `{kind: 'station', id, name}` from the registry; an
`X-Device` that is a registered screen id is `{kind: 'screen'}` with the
registry's name; anything else `{kind: 'page'}`. Never an IP, user agent or
session. Built: an `X-Device-Name` with no `X-Device` is still `{kind: 'page',
name}`; a page id with no name is named "Unnamed device"; an `X-Station` that is
not registered falls through to the other headers. The page is same origin
(`/api`), but the Worker's CORS preflight now also allows `X-Device` and
`X-Device-Name` (it allowed `X-Station` only), so a preview deploy calling the
Worker cross-origin is not refused for sending them.

### 10.2 Switches (runtime, stored; `wrangler.toml [vars]` become the defaults)

Storage `switches` = `{v: 1, rev, updatedAt, by, values: {NAME: 'on'|'off'}}`
(a name absent from `values` follows its default).

| Name | Group | Default | Read by |
| --- | --- | --- | --- |
| `CLOUD_PRINT` | online | `env.CLOUD_PRINT`, else `off` | `adopt.on` (jobs for TwoTimTwo-page check-ins) |
| `SINGLE_PUBLISHER` | online | `env.SINGLE_PUBLISHER`, else `off` | `core.singlePublisher` (Worker publishes tally / tonight / still-here; the gate drops the laptop's) |
| `YM_CHECKOUT` | online | `env.YM_CHECKOUT`, else `off` | `ym.enabled` (section 9) |
| `CHURCH_SETTINGS` | safety | `env.CHURCH_SETTINGS`, else `on` | 10.3 edits allowed; stations apply 10.3 |
| `NOTICES` | safety | `env.NOTICES`, else `on` | `POST /v1/notice` allowed |
| `CHANGE_LOG` | safety | `env.CHANGE_LOG`, else `on` | 10.5 entries written |

- **Effective within the request.** `SyncCore` keeps `this.rawEnv`; `this.env =
  Object.create(rawEnv)` with own getters for the six names returning the
  effective value, so every existing `this.env.CLOUD_PRINT` /
  `SINGLE_PUBLISHER` / `YM_CHECKOUT` read (`adopt.js`, `sync.js`,
  `ymcheckout.js`) needs no edit. `await core.switches.load()` (memoized) runs
  first in `handle()`, `alarm()` and `cron()`. A PUT updates memory and
  storage in one synchronous step before answering.
- **Deploy kill.** `SWITCHES_STORED = "off"` in `[vars]` ignores `values`
  (defaults only); the routes still answer (`source: 'default'`), PUT 409
  `{reason: 'stored-off'}`.

| Route | Auth | Request | Answer |
| --- | --- | --- | --- |
| `GET /v1/switches` | session | | `{rev, updatedAt, by, stored, switches: [{name, group, value, default, source: 'worker'\|'default'}], stations: [{stationId, name, lastSeenAt, version\|null, churchRev\|null}]}` |
| `PUT /v1/switches` | session | `{name, value: 'on'\|'off'\|'default', rev?, dryRun?: true}` | `{ok, rev, switch, warnings: [code], oldStations}`. 400 `bad-name` / `bad-value` / `bad-rev`; 409 `{reason: 'stale', rev}` when `rev` is sent and differs; 409 `stored-off`. `default` deletes the stored value. Rings `changed {what: 'switches', rev}`; logs `switch` (10.5) with the STORED value before and after (`null` = following the default). Built: `dryRun: true` answers `{ok, dryRun: true, rev, switch (as it would be), warnings}` and writes nothing, so the page's confirm can list the warnings BEFORE the flip; the same stored value again writes nothing (`warnings: []`, no ring, no entry) |

Warnings (never refusals; the page shows them in its confirm): `no-station` (no
station heartbeat in 2 min), `station-old` (a station seen in 2 min reports no
`version`, or one below `STATION_MIN_VERSION` = `9.3.0`: it cannot follow a
runtime `SINGLE_PUBLISHER` / `YM_CHECKOUT` change), `window-open` (the watch
window is open now), `ym-tab-reload` (`YM_CHECKOUT` turned OFF while a station
holds the extension's sweep: the TwoTimTwo tab must be reloaded before the
extension sweeps again), `station-old-sweep` (`YM_CHECKOUT` turned ON while any
REGISTERED station, seen lately or not, reports no `version` or one below
`9.3.0`: its extension may still sweep, so there would be two),
`station-old-publish` (`SINGLE_PUBLISHER` turned OFF while any registered
station is below `9.3.0`: it publishes only by its start-time switch, so
nobody may publish). Every PUT answer (dry run too) carries `oldStations:
[{stationId, name, version|null}]`, the stations a `station-old*` warning is
about (`[]` otherwise), so the confirm can name them. Turning `SINGLE_PUBLISHER` off does not purge
`tonight:book` (the end-of-window purge does). Built: warnings only when the
EFFECTIVE value changes; `no-station` for the online group only, `station-old`
for `SINGLE_PUBLISHER` / `YM_CHECKOUT` only, `window-open` for any switch,
`ym-tab-reload` whenever any station is registered (the Worker cannot see which
computer's extension stood down). An env value other than `on` / `off` (or
none) is the switch's own fallback. `SWITCHES_STORED` unset counts as `on`.

### 10.3 Church settings (the laptop's church-wide printing settings, edited from anywhere)

One allowlist, `lobby/shared/churchSettings.js` (pure; generated CommonJS copy
`printer/print-server/churchSettings.js` via `scripts/shared-copies.mjs`,
checked by `check-mirrors.mjs`): `CHURCH_SPEC`, `CHURCH_KEYS`,
`sanitizeChurch(raw, {patch?}) -> {settings, dropped: [key]}` (a `null` value is
kept only with `{patch: true}`, an edit's "delete this key", and for
`pickupClubs`, where it is the default list; otherwise dropped),
`mergeChurch(prev, patch) -> settings` (a new object; a key sent as `null` is
deleted; it does NOT clean, so the Worker sanitizes the patch first),
`CHURCH_SEASONS`, `CHURCH_TEMPLATE_SWITCHES`, `CHURCH_JSON_MAX` = 65536 bytes
(raised from 24576 for the leader list: 80 rows at the longest names beside a
full schedule and every template reach about 33 KB; a Durable Object value holds
128 KB) (BUILT: ONE file, written by Track B, commits `adab0cd` / `438b794`,
taken into Track A unchanged but for `CHURCH_JSON_MAX`; its test; the
`shared-copies.mjs` line). It imports
only `./pickup.js`, `./clubs.js` and `./text.js` (each already in `COPIES`, so
`shared-copies.mjs` rewrites the imports to `./pickup`, `./clubTable`, `./textClean`)
and uses only `export const` / `export function`.

| Key | Rule (what `sanitizeChurch` keeps) |
| --- | --- |
| `labelFooter`, `connectCardGreeting` | string, one printable line, at most 60 (`''` kept: none) |
| `firstTimerInverted`, `trophyBand`, `connectCard`, `connectCardAutoFirstTimer`, `enableDrivenCheckin` | bool |
| `labelTemplates` | object, at most 12 keys (`default` or a `shared/clubs.js` club key), each `{version: 1, showIconPanel?, showLastName?, showClubLine?, showGroupLine?, showVisitorPill?, showFooter?: false, nameMaxPt?: int 18..47}` (the print server's `sanitizeLabelTemplates` shape; a template with no override is dropped) |
| `schedule` | array of at most 60 rows `{club: 1..30 chars, startTime: /^\d{1,2}:\d{2}$/ or '', location: ..40, room: ..40}` |
| `lateGraceMin` | int 0..120 (a number or a digit string, rounded and clamped; anything else dropped) |
| `pickupClubs` | `pickup.js normalizePickupClubs` (`null` = the default list) |
| `seasonTheme` | `auto` \| `off` \| `back-to-school` \| `fall` \| `thanksgiving` \| `christmas` \| `winter` \| `spring` \| `easter` \| `vbs-summer` |
| `barfNights` | array of at most 20 unique sorted `YYYY-MM-DD` (the first 20 kept) |
| `leaders` | the remembered leaders (owner 2026-10-12, moved from the print server's `leaders.json`): array of rows `{firstName: ..80, lastName: ..80, clubName: ..40, lastPrintedAt: ms (0 when unknown), printCount: int >= 1}` (one line each), one row per name (first + last, case-folded; the first wins), in the order sent, at most 80 (the print server's `LEADERS_MAX`). Anything else on a row (`key`, a phone number, a birthdate) is never kept. ADULT volunteers' names only |

Never here: printers, `cupsMedia`, `musicalPrinter`, `updateBeacon`,
`worksheetPrinter`, `checkinUrl`, `historyRetentionDays`, `fleetConfigUrl`, any
`SECRET_CONFIG_KEYS` key. Values are church-authored or adult volunteers' names
(`leaders`), never child data.

**The leaders' names are stored in the clear (owner-approved exception,
2026-10-12).** Unlike every child name, which the Worker holds only sealed, the
remembered leaders' (adults') FULL names (first + last, club, last printed,
count) sit UNENCRYPTED in the `church` doc and in its change log (`church`
entries for key `leaders`: `before` in `logv`), and any signed-in session reads
them (`GET /v1/church/settings`, `GET /v1/changes`). That is the price of chips
on any phone with no key step; the owner accepted it. Never put a child's name,
or anything beyond a leader row's fields, in this list. `printer/SECURITY.md`
and `lobby/SECURITY.md` say the same.

**The remembered leaders from any phone.** Remember (after a leader tag prints)
and Forget (the × on a chip) are church edits of the WHOLE `leaders` list with
`baseRev` (409 `stale` → re-read, re-apply, send again); each is logged as a
`church` entry with key `leaders` (a long list's `before` lands in `logv`, its
`after` as a signature) and undoes like any other. The print server's
`/leaders` routes read and write this copy while church sync is active (Track B;
its `leaders.json` stays the offline copy), and a station's seed carries its
`leaders.json`. The 270-day "active" filter stays a reader's rule, not storage.

Storage `church` = `{v: 1, rev, savedAt, by, seededBy: {stationId, name, at} | null, settings}`.

| Route | Auth | Request | Answer |
| --- | --- | --- | --- |
| `GET /v1/church/settings` | session (a station's session + `X-Station` too) | | `{rev, savedAt, by, seeded, paused, settings \| null, switches: {NAME: 'on'\|'off'} (effective, all six), switchesRev}`; `rev: 0, settings: null` before the seed. `paused` = `CHURCH_SETTINGS` off |
| `PUT /v1/church/settings` (seed) | station | `{seed: true, settings}` (the station's whole config.json church part) | first writer wins: 201 `{rev: 1}` stored with `seededBy`; 200 `{already: true, rev}` when a doc exists. Logs `church` (`undoable: false`) |
| `PUT /v1/church/settings` (edit) | session | `{baseRev, settings: {key: value \| null}}` (only the changed keys) | `{ok, rev, savedAt, settings}`. 409 `{reason: 'stale', rev, settings}` when `baseRev !== rev`; 409 `{reason: 'not-seeded'}` when `rev === 0` and the body lacks `fromDefaults: true`; 503 `{reason: 'church-off'}` while `CHURCH_SETTINGS` is off; 413 over `CHURCH_JSON_MAX`; 400 `{reason: 'bad-settings', dropped}` when every sent key was dropped. Rings `changed {what: 'church', rev}`; logs one `church` entry with the changed keys |
| `GET /v1/print/next` (changed, additive) | station | | adds `church: {rev, switchesRev}`; an older puller ignores it |
| `POST /v1/print/heartbeat` (changed, additive) | station | adds `version?: 'X.Y.Z'`, `churchRev?: int` | unchanged; both kept on the station record (they ride `touch`'s throttled write; a CHANGED value forces it) |

Built: `seeded` is true only for a station's seed (`seededBy`), not for "Start
from defaults" (`rev` says whether a doc exists); a seed while `CHURCH_SETTINGS`
is off is refused 503 `church-off` like an edit (a paused station does not seed);
a seed from a session that is not a registered station is 403
`unknown-station`; an edit with no `baseRev` is 400 `bad-rev`; an edit that
changes nothing writes nothing (same rev, no ring, no entry); `dropped` names
the keys an edit could not keep when others were kept; a value its rule refuses
is a dropped key (the old value stays).

The station's side (precedence, offline fallback, first-run migration):
`docs/SETTINGS-OVERHAUL.md` section 4.

### 10.4 Notice to every screen

Wire (contract `events.notice`, printer canonical first): `optionalFields:
["durationSec"]`, int 0..14400. A screen hides a notice `durationSec` after it
RECEIVED it (`min(durationSec * 1000, NOTICE_MAX_AGE_MS)`); `0` = take down now.
An older screen ignores the field (the 4 h ceiling as before). No
`contractVersion` bump (additive optional; `test-contracts.cjs` `buildNotice`
keeps its exact `fields`).

Storage `notice:current` = `{payload: {level, message, at, durationSec}, until, by}`.

| Route | Auth | Request | Answer |
| --- | --- | --- | --- |
| `POST /v1/notice` | session | `{level: 'info'\|'warn'\|'critical', message, durationMin: 5..240}` | builds `{level, message: plainText(message, 200), at: ISO now, durationSec}` (unknown level or empty message: 400), `relay('notice', payload)` (replayed), stores `notice:current`. `{ok, notice, until, screens}`. 503 `{reason: 'notices-off'}`. Logs `notice` (undo = take down) |
| `DELETE /v1/notice` | session | | publishes `{level, message, at, durationSec: 0}`: the SAME text with `at` = the earlier of its original `at` and now - 7 h (`TAKEDOWN_AGE_MS`), so a screen that ignores `durationSec` reads it as stale and drops it (an `at: now` re-showed it for 4 h and revived a laptop notice those screens had already dropped), then deletes `live:notice` and `notice:current`. `{ok, cleared}`. Logs `notice` |
| `GET /v1/notice` | session | | `{notice: {...payload, until, by} \| null}` |

- **Gate.** `POST /v1/publish` with `event: 'notice'` while `notice:current` is
  unexpired answers 200 `{dropped: true, reason: 'owner-notice'}`: the laptop's
  TwoTimTwo `/msg/admin` mirror never overwrites the owner's notice.
- **Replay.** `replayFrames()` hands out `live:notice` only while its notice is
  unexpired, with `durationSec` rewritten to the seconds left; an expired one is
  deleted with `notice:current`. A laptop notice (no `notice:current`) replays
  as before.
- Validation is the Worker's own (`shared/text.js` `plainText`), not an import
  of `src/lib/eventSanitizers.js`; the screen's sanitizer still checks every frame.
- Built: a bad `durationMin` (not an integer 5..240) is 400 `bad-duration`
  (`bad-level`, `no-message` for the other two). The replay is built from
  `notice:current` itself (so a passphrase change, which clears `live:notice`,
  does not lose the owner's notice); the gate forgets an expired
  `notice:current` before relaying the laptop's frame, and the replay deletes
  `live:notice` with it only when that copy IS the owner's frame. `DELETE` also
  takes down a laptop notice (no `notice:current`: the text of `live:notice`) and
  works with `NOTICES` off; `cleared: false` when there was nothing. Its log
  entry is NOT undoable (re-sending an old notice is not "cheap"); a POST's
  entry is (undo = take down, while that notice is still the current one,
  else 409 `changed-since`).

### 10.5 Change log (last 200; undo where cheap)

Storage: `log:meta` `{v: 1, seq}`; a ring of 10 buckets `log:b0`..`log:b9` of 20
entries (entry `n` lives in bucket `floor(n / 20) % 10`; a bucket is reset when
its first slot is written again); `logv:0`..`logv:19` hold a `before` too big
for its entry (`{seq, before}`, slot `n % 20`). One entry = one bucket get + one
multi-key put (bucket + meta [+ logv]). No `list()` needed (the `Store`
interface has none).

```
Entry { seq, at, device: {kind: 'page'|'screen'|'station'|'unknown', id?, name},
        what: 'shared'|'church'|'switch'|'notice'|'screen'|'screen-name'|'screen-forget'|
              'slides'|'template'|'journey'|'passphrase'|'station',
        target?: screenId | stationId | switch name,
        keys: [<= 40], before?: {k: v}, after?: {k: v} | null, bigBefore?: true,
        undoable, undoOf?: seq, undoneBy?: seq }
```

- Values only from allowlists (`SHARED_SPEC`, `CHURCH_SPEC`, `SCREEN_SPECS`,
  switches, a notice's level and message): no child data can reach the log.
  `slides`: `{after: {slideCount}}`; `template` / `journey`: keys only;
  `passphrase`: no values; `station`: register / remove, name only. None of
  those four is undoable. An entry is at most 2 KB: a larger `before` goes to
  `logv`, a larger `after` is stored as `null` (undo still works; the page says
  "changed").
- `undoable`: `shared`, `church` (not the seed), `switch`, `notice`, `screen`,
  `screen-name`.
- `CHANGE_LOG` off: nothing written. A logging failure never fails the write it
  describes (caught, `console.error`).

| Route | Auth | Request | Answer |
| --- | --- | --- | --- |
| `GET /v1/changes?before=<seq>&limit=1..50` | session | | `{entries: [newest first], next: seq \| null, head, off}` |
| `POST /v1/changes/<seq>/undo` | session | | every key must still hold its `after` (JSON compare); then its `before` is written through the SAME path the change took (rebroadcast, doorbell, a new entry with `undoOf`) and the old entry gets `undoneBy`. `{ok, seq}`. 409 `{reason: 'changed-since', keys}`, 409 `not-undoable`, 409 `{reason: 'already-undone', undoneBy}`, 410 `gone` (rotated out), 503 `church-off` / `notices-off` as that path would |

Hooks: `putSettings` (diff of the shared set against the previous one; no change,
no entry), `putSlides`, `putTemplate`, `putJourney`, `changePassphrase`,
`screens.putSettings` / `rename` / `forget`, station `register` / `DELETE`,
10.2, 10.3, 10.4.

Built: a bucket is stored as `{base, entries}` and reset whenever its `base` is
not `floor(n / 20) * 20` (a later lap), so between 181 and 200 entries are kept;
appends (and undo marks) run one at a time through a promise chain and the
buckets stay in memory once read. A dropped big `after` keeps `afterSig` (an
FNV-1a fingerprint of its canonical JSON, not cryptography), so Undo still
answers `changed-since` correctly. `before` / `after` hold `null` for an absent
key; JSON compares are key-order-blind. `template` / `journey` / screen
settings / screen names log only when something changed. `station` entries
carry `keys: ['register'|'remove']` and the station's name. Undo answers 404
`not-found` for a number never written, 410 `gone` for one rotated out or whose
`logv` slot has moved on (20 entries later), or whose screen was forgotten; two
Undo presses at once run once (the second is 409 `already-undone`,
`undoneBy: null`). With `CHANGE_LOG` off an undo still works but marks nothing.
`limit` defaults to 20; a bad `before` / `limit` is 400.

### 10.6 Tonight overview (mission control's one poll)

| Route | Auth | Answer |
| --- | --- | --- |
| `GET /v1/tonight/overview` | session | below: counts, codes, times, station names only |

```
{ at, night, clubNight, window: {open, opensInMin, closesInMin},
  count:    {source, checkedIn, checkedOut, byClub, reportAgeMs, enabled} | null,   // publisher.status()
  read:     {mode, configured, signedIn, lastReadAt, lastOkAt, lastError, loginBlockedForSec, watchIntervalSec},
  print:    {queued, leased, dead, checkThePrinter, claims, pendingToSeal,
             stations: [{stationId, name, lastSeenAt, printer, version, churchRev}]},
  ym:       {enabled, due, checkedOut, failed, gaveUp, pending, lastError} | null, // null before section 9 is merged
  switches: [...as GET /v1/switches],
  notice:   {level, message, at, until, by} | null,
  church:   {rev, savedAt, seeded, paused},
  history:  {db, pending},
  changes:  {head, last: Entry | null} }
```

Built: `print.checkThePrinter` is a COUNT (the job ids stay on `GET
/v1/print/status`); `window.closesInMin` is null while closed; each part is
computed on its own and is `null` if it throws, the rest still answer.

No TwoTimTwo read, no seal: storage reads and in-memory state only. The page
polls it every 10 s while Tonight is open and the tab visible, every 60 s
otherwise, and stops after 3 failures in a row (a "Try again" button restarts it).

### 10.7 A screen's status in its hello (BUILT: every kind)

The screen registry (`screens.js`, `README.md` "Screens") takes one more
optional field on `POST /v1/screens/hello`: `status`, one small report in
its kind's own shape (another kind's shape is ignored: a lobby TV cannot
report lessons). /settings words it under the row's On now / Off line.
Numbers, switches, a version, a build and one short reason; never a name, a
URL or a file path.

```
journey    (journey/public/src/sync.js, from journeyDownloadStatus(): saving every lesson's full-quality video)
status: { lessons: { saved, total,            // videos, ints 0..999, saved <= total
                     bytesSaved, bytesTotal,  // ints 0..1e13, bytesSaved <= bytesTotal
                     downloading, waiting, paused, auto,   // true or false
                     leaders,                 // "Include Leader Videos" ticked (missing = true; 10.8)
                     percent,                 // int 0..100
                     currentWeek,             // int 1..99 while downloading, else null
                     lastSavedAt,             // ISO time (normalized) or null
                     error,                   // one line, control characters out, <= 120 characters, or null
                     known,                   // false until the kiosk has read its disk (missing = true: older kiosk pages)
                     supported } }            // false where the browser cannot save lessons (missing = true)

computer   (printer/electron-app: device-sync.js hello, update-progress.js appReport)
status: { app: { version,                     // the running KVBC Awana version, one line, <= 40 characters (required)
                 update: { state,             // 'none' | 'downloading' | 'ready' | 'error' (required)
                           percent,           // int 0..100 while 'downloading', else null
                           at } } }           // ISO time the state began, or null

lobby, projector   (src/hooks/useScreenSync.js, the page's own <meta name="awana-build">)
status: { page: { build } }                   // first 7 hex of the build hash (7..64 hex accepted, lowercased), or null (no stamp)
```

- One allowlist per kind, `sanitizeScreenStatus(kind, raw)` in
  `src/lib/syncSpecs.js` (the file the Worker bundles and /settings reads):
  unknown keys dropped, numbers clamped, strings trimmed with control
  characters out. Junk is ignored: lessons without numeric `saved` and
  `total`, an app without a version or a known update state, a page whose
  build is not hex.
- A hello without `status` (or with junk) keeps the last one, so a row never
  blanks on a reload.
- Kept on the screen's record in the `screens` index (bounded: one small
  object per screen, at most `SCREENS_MAX` screens) and returned as
  `screen.status` in the hello's answer and in `GET /v1/screens`. Forgotten
  with the screen.
- Storage writes (free Durable Object allowance): the status rides the
  existing once-a-minute `lastSeen` write (`SEEN_WRITE_MS`); sooner only when
  it moved enough to matter (`screenStatusMoved`): lessons `saved`, `total`,
  `error`, `paused`, `downloading`, `waiting`, `auto`, `leaders`, `known` or
  `supported` changed, or `percent` moved 10 or more; app `version` or
  update `state` changed, or `percent` moved 10 or more; page `build`
  changed. The newest status is also held in memory (`Screens.fresh`), so
  the list shows it before storage does; a restart falls back to the stored
  one.
- Who says hello when: every screen every 2 minutes while signed in. The
  Journey kiosk also on a status change, never twice within a minute, never
  in configure mode. The KVBC Awana app also when its update state changes
  or its download moves 10 points, never twice within a minute. A TV or
  projector only at its usual hellos (its build changes only by reloading).
  No CPU-heavy work: clamps and short string clean-ups.

### 10.8 A Journey kiosk's commands, and the room document alone (BUILT, owner 2026-10-12)

/settings → Journey works every Journey kiosk's "Lessons on this computer"
(`journey/src/schedule/26-lesson-downloads.js`) and edits the room settings.
A kiosk has no live channel of its own, so its commands WAIT in the Worker
for its next hello.

| Route | Auth | Request | Answer |
| --- | --- | --- | --- |
| `POST /v1/screens/<id>/action` (a `journey` screen) | session | `{action}`: `start-downloads` \| `pause-downloads` \| `resume-downloads` \| `stop-downloads` \| `delete-downloads` (`SCREEN_ACTIONS.journey`; `data` dropped) | `{ok, delivered: false, queued: true}`; 400 for anything else; 429 when `SCREEN_ACTION_QUEUE_MAX` (5) already wait |
| `POST /v1/screens/hello` (a `journey` screen) | session | as 10.7 | as 10.7 plus `actions: [{action, at}]`: everything queued since its last hello, in order, each ONCE (the queue key is deleted as it is read); `[]` when none. Other kinds' answers have no `actions` field |
| `GET /v1/journey` | session | | `{journey: {savedAt, settings} \| null}` (the room document alone, without the deck `/v1/state` carries) |

- Storage: `screenq:<id>` `{items: [{action, at}]}`, at most 5 items, one key
  per kiosk, written by the action, deleted by the next hello (or when the
  screen is forgotten / makes room). An item older than
  `SCREEN_ACTION_TTL_MS` (10 min) is dropped, both when queuing and when
  handing over (a delete an hour late is worse than none); a stored item is
  re-checked against the kind's allowlist (`freshActions`). One storage get
  per Journey hello, one put per press, one delete per collection: well
  inside the free allowance.
- The doorbell still rings `changed {what: 'screen-action', id, action, at}`
  (not replayed). The kiosk's embedded Check-in Display (the lobby page in its
  iframe, which listens) posts `{type: 'awana-display:sync-doorbell', what,
  id}` to its parent at its own origin (`lobby/src/lib/embed.js`
  `hostDoorbell`); the kiosk (`journey/public/src/sync.js`) checks the sender
  is its own iframe and the id is its own, and says hello at once (never twice
  in 3 s). A `journey` ring makes it pull the room document at once. Without
  the doorbell, the two-minute hello and ten-minute pull carry everything.
- The kiosk runs each command through its own buttons' functions
  (`journey/src/schedule/27-settings-page.js`); its two switches are its
  screen settings (`SCREEN_SPECS.journey`: `downloadsAuto`,
  `downloadsLeader`), taken from the hello's `settings` when they changed
  there, sent up (`PUT /v1/screens/<id>/settings`) when changed on the kiosk.
  Its status gains `lessons.leaders` (10.7 shape; missing = true).
- `PUT /v1/journey` replaces the whole document: /settings reads the newest
  first and changes only its own keys (`lib/journeyClient.js` `mergeJourney`,
  through `sanitizeJourney`), so tonight's edited bullets ride along.

### 10.9 The Journey phone remote (BUILT, owner 2026-10-13)

"Build a way to advance slides for Journey on a phone ... Doing it on the
phone should advance the slide for all." A leader's phone opens
awana.kvbchurch.org/journey/remote/ (`journey/public/remote/`), signs in with
the passphrase, and every press goes to EVERY Journey kiosk in the registry.
Code: `journeyRemote.js`; rules (one copy, shared with the phone page):
`../shared/journeyRemote.js`, re-exported by `src/lib/syncSpecs.js`.

| Route | Auth | Request | Answer |
| --- | --- | --- | --- |
| `POST /v1/journey/remote` | session | `{action, data?}`: `slide-next` \| `slide-prev` \| `slides-start` \| `play` \| `pause` \| `toggle-pause` \| `seek` `{by}` (signed whole seconds, clamped to ±15, never 0) \| `mute` \| `unmute` \| `volume` `{step: 1 \| -1}` (one 10% step; anything else is a 400) \| `begin` \| `pick` `{week 1..99, choice in student/leader/slides/handout/student-prep/leader-prep, force?: true}`; other data dropped, never free text | `{ok, id, kiosks, online}`; 400 anything else; 409 `{reason: 'no-kiosks'}`; 429 `{retryAfterMs}` past 8 presses at once (4 a second after that) per sign-in |
| `GET /v1/journey/remote/state` | session | | `{kiosks: [{id, name, online, now \| null}], online, serverNow, watchMs}` |
| `POST /v1/screens/now` (a `journey` screen) | session | `{id, now?}` | `{actions: [{id, action, data?, at}], watch, hello}`; 404 for an id that is not a registered Journey kiosk |
| `POST /v1/screens/hello` (a `journey` screen) | session | as 10.7 | as 10.8 plus `remote` (the same press list, handed over once) and `watch` |

- `now` (the kiosk's report, `sanitizeJourneyNow`): `{view: splash|intro|video|slides|checkin|trek|idle, week, title (<= 80), preview, wait: captions|loading|settings|reader|null, slide?: {n, of, kind: title|verse|misconception|illumination|questions|template, heading, lines: [<= 3 x <= 80]}, video?: {t, d, paused, muted, volume?: 0..100}, resume?, last: {id, action, ok, reason}|null, at}`. `at` is replaced by the Worker's receipt time. Lesson titles only, never a URL or a file name.
- NOTHING is written to storage: presses live in memory per kiosk (at most 12, the oldest first out, each dropped after 20 s, each handed over ONCE: taken out as it is handed over, so a lost reply loses a press and never repeats it; the kiosk also never runs a press id twice); reports live in memory (newest per kiosk, a restart forgets them); "online" also counts a kiosk's recent poll (memory) without moving its stored `lastSeen`. The download commands of 10.8 stay as they are (stored, 10 min); `hello: true` tells a kiosk one waits (memory flag; after a restart the two-minute hello still collects it).
- Doorbell: each press rings `changed {what: 'screen-action', id, action: 'remote', at, press: {id, action, data?}}` once per kiosk. The ring CARRIES the cleaned press (owner 2026-10-15; presses are not private, no crypto, nothing stored): the embedded Check-in Display passes it up (`lobby/src/lib/embed.js hostDoorbell`, only a well-formed `sanitizeJourneyPress`, size-bounded) and the kiosk runs it the moment it arrives, then reports. The queued copy (above) stays the fallback: a missed doorbell, or a ring without a press, still makes the kiosk poll `POST /v1/screens/now`, and the kiosk never runs a press id twice. The first state read after a quiet spell (no phone for 30 s) rings every kiosk the same way (`action: 'remote-watch'`) so they report straight away.
- Watching: kiosks report only while a phone read the state within 30 s (`watch` in their answers): on each change (at most one every 700 ms) and one poll every 10 s (a playing video's position; and a press whose doorbell was missed is still collected inside its 20 s). Nobody watching = no extra request at all.
- The kiosk list: read from the `screens` index once per object, then kept in memory, refreshed by `screens.js onIndex` each time the registry writes its index (`saveIndex` is the only writer), so a state read or a kiosk poll reads NOTHING from storage (beyond the session check).
- The press allowance is per sign-in, keyed by the session token's epoch, issue time and signature tail, read by the ONE token parser the sign-in check uses (`session.js parseSession`).
- Free plan: no storage writes; CPU = clamps and Map lookups. Requests per hour with a phone open (one kiosk): ~2,400 state polls + ~400-500 kiosk polls (360 timed, plus one per change and per press) + presses; with the phone closed: nothing beyond the kiosks' usual hellos.

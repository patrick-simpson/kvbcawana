# Online check-in: the Worker's new routes (P0 contract)

The route table the P1–P7 builders work against (root
`ROADMAP.md#online-check-in`). Built so far: the crypto module
(`lobby/shared/cloud-crypto.js`), the D1 schema (`../migrations/0001_history.sql`,
`0002_applied_batches.sql`), sections 2 and 3 (P6, `history.js`) and, in the
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
  shapes and sizes. Every seal and open is a client's (`cloud-crypto.js`).
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
- **TwoTimTwo read budget.** ONE read every 5 seconds, every read combined
  (the watcher's report, the check-in page, the roster CSV, a desk roster
  refresh, a manual read-now): one shared clock in the Durable Object
  (`READ_INTERVAL_MS = 5000`). A route that needs a read when the clock is not
  ready answers from the last read with its `readAt`, or 429 `{retryAfterMs}`
  when it has none. Posts (check in, undo, check out) are writes, not reads.
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
| `GET /v1/auth/params` | public | | `{v: 2, salt, iter, legacy}`: the PBKDF2 salt and count for `authKey`. The salt is made (and stored) on first ask, before any v2 verifier exists. `legacy` is true while the old HMAC hash is still kept. |
| `POST /v1/login` (v2) | public, lockout as today | `{authKey}` | today's answer `{session, displayKey, state, pusher}` plus `history: {pub, kid, wrapped} \| null` |
| `POST /v1/login` (upgrade) | public | `{passphrase, authKey}` when no v2 verifier exists | checks the passphrase against the OLD HMAC hash; on success stores `verifier = SHA-256(authKey)` under the params' salt, answers as v2 plus `upgraded: true`. The first v2 client to sign in after the deploy upgrades the store. |
| `POST /v1/login` (legacy) | public | `{passphrase}` | as today, while the legacy hash exists; answers `legacy: true`, and the Worker keeps `auth:legacyLastAt` so the owner can see when the last old client signed in |
| `POST /v1/passphrase` (v2) | public, lockout as today | `{currentAuthKey, next: {salt, iter, verifier}, wrapped}` (`wrapped` is the history key re-wrapped under the new word by `rewrapPrivateKey`, already proved; `null` only when no history key exists) | ONE atomic multi-key put: `auth` (new salt, iter, verifier, epoch + 1), `history:wrapped`, `history:wrapped:prev` (`{wrapped, until: now + 7 days}`), and the legacy hash deleted. Signs every screen out and rotates the display key as today. `{session, displayKey, rotatedKey}` |

**Migration.** Today's store is `auth = {salt, hash: HMAC(salt, passphrase),
epoch}`. After the P1 deploy:

1. `auth` gains `v2: {salt, iter, verifier}`; the old `hash` stays as the
   legacy verifier.
2. New clients ask `/v1/auth/params`, derive `authKey`, and sign in with
   `{authKey}`; while no verifier exists they send `{passphrase, authKey}`
   once (the upgrade), then never the passphrase again.
3. Old clients keep working on `{passphrase}` until the legacy hash goes.
   The screens self-update within minutes and the KVBC Awana app within ten,
   so the window is short. OBS / ProPresenter links with `?passphrase=` keep
   working: they are pages of the same site, compute `authKey` in the browser
   and sign in with v2 (a weak PC takes about a second; the Pi Zero in Journey
   longer, once, then keeps its session).
4. The legacy hash is deleted by the first v2 passphrase change, or by the
   owner's switch (`AUTH_LEGACY = "off"` in `wrangler.toml`) once
   `auth:legacyLastAt` is old. Until then the fast-hash weakness stays for
   that one value; SECURITY.md says so.

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
| `GET /v1/history/summary?from=&to=` | session | | `night_summary` lines, plaintext numbers |
| `POST /v1/history/import` | session | `{rows: Row[] (at most 500), summary?}`, rows sealed by the KVBC Awana app from the laptop's own history (`kind` `import-checkin`, …) | as `POST /v1/history/rows`; `BODY_MAX` 1 MB for this route only |

**Row kinds** (the plaintext `kind` of a row; the record inside is sealed). One
vocabulary for the desk page, the print role and the history views:

| `kind` | Written by | Record (sealed JSON; the time is inside) |
| --- | --- | --- |
| `checkin` | the desk page (`source: 'desk'`) with `POST /v1/desk/checkin`; the print role for a TwoTimTwo-page check-in once it prints (`source: 'ttt'`, `history-sync.js rowForPrinted`) | `{ts, first, last, club, clubberId?, friend?, friendFirst?, source}`, `ts` epoch MILLISECONDS |
| `visitor` | the desk page, a visitor with no clubber id | as `checkin`, no `clubberId` (the trends count visitors from this kind) |
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

## 4. Stations (BUILT: register, list, revoke; the rest is the station role's)

| Route | Auth | Request | Answer |
| --- | --- | --- | --- |
| `POST /v1/station/register` **BUILT** | session | `{stationId, name, pub, kid}`; `stationId` is the KVBC Awana app's `roles.json` `deviceId` (8 to 64 of `A-Za-z0-9._-`); `pub` is the 65-byte raw P-256 key in base64, `kid` must be its `kidOf` (the Worker checks it, a hash); the private key is in Electron safeStorage (the app refuses the station role when safeStorage is unavailable) | stores it in the `stations` document; the same `stationId` may replace its own key (keeps `registeredAt`). `{ok, station, stations: [...list]}`. 409: another station already uses that key, or ten stations are registered (`STATIONS_MAX`) |
| `GET /v1/stations` **BUILT** | session | | `[{stationId, name, pub, kid, registeredAt, lastSeenAt, printer}]` (what a client seals bundles to) |
| `DELETE /v1/stations/<stationId>` **BUILT** | session | | removes a dead computer's key; `{ok, stations}`, 404 when unknown. Bundles already sealed to it stay unreadable to it only. Its calls answer 403 from then on |
| `GET /v1/station/roster-source?night=` | station | | TwoTimTwo's roster CSV, read through the Worker (counts against the 5 s budget), passed through in memory and never stored. The station seals it to every station. |
| `PUT /v1/station/roster` | station | `{night, bundle}` (`kind: 'roster'`, allergies inside) | stores `roster:<night>` (the latest wins); `{ok}` |
| `GET /v1/station/roster?night=` | station | | `{bundle}` or 404 |
| `PUT /v1/station/books` / `GET /v1/station/books?night=` | station | `{night, bundle}` (`kind: 'books'`, completed books) | as the roster |

A job's bundle must be sealed to **every** registered station and nobody else
(`Stations.checkBundle`): a missing station answers 409
`{reason: 'stations-changed', stations}` and the client reseals, so a job is
never unreadable to a station about to lease it. Medical notes are sealed ONLY
to station keys, never to the history key (`sealRow` refuses a record with a
medical key).

## 5. The desk page (the Worker's claim API is BUILT; the page is P3's)

Our desk page (a browser at the desk, signed in) and the TwoTimTwo page
fallback. The desk page derives keys at sign-in, fetches `/v1/stations` and
`/v1/history/key`, and seals before it posts. The handlers are thin: the
behaviour is `desk.js`, which the page calls through these routes.

| Route | Auth | Request | Answer |
| --- | --- | --- | --- |
| `GET /v1/desk/roster` **BUILT** | session | | tonight's check-in page roster `{readAt, stale?, kids: [{clubberId, first, last, club, clubId, checkedIn}]}` (no medical data; plaintext over TLS, from the last read, held in memory, never stored). Read through the 5 s clock: a read within 5 s is the last one; a clock booked past 12 s answers the last read marked `stale`, or 429 `{reason: 'read-busy', retryAfterMs}` with none |
| `POST /v1/desk/checkin` **BUILT** | session | `{night, clubberId \| visitor: {first, last, club}, items, historyRow: Row, job: Bundle \| null}`; `night` is the church's local date (else 400 `wrong-night`); `items` is `{Bible?, Friend?}` or `['Bible', 'Friend']`; `job.id` is the jobId, `job.kind` is `print-job`, `job.night` is `night`; `job` may be null only while no station is registered | see below |
| `POST /v1/desk/undo` **BUILT** | session | `{night, clubberId \| visitor, historyRow}` | TwoTimTwo's undo (`checkinclubberundo`, accepted on "(checkin undone)"), then the claim goes `undone` (gen + 1) and every unprinted job of that child is dropped: `{ok, droppedJobs}`. A refusal is 409 `{reason}`, a timeout 504 `{reason: 'unsure'}`: nothing is changed here, and the watcher settles what TwoTimTwo has |
| `POST /v1/desk/checkout` **BUILT** | session | `{night, clubberId \| visitor, historyRow}` | TwoTimTwo check-out (accepted only on "OK"): `{ok}`. The claim is left as it is |
| `GET /v1/desk/tonight` **BUILT (P5)** | session | | `{night, source: 'report' \| 'history', checkedIn, checkedOut, byClub, reportAgeMs, enabled}`: `authoritativeTonight()` from the Worker's own state (the shared module, not a port; section 8). Answers in shadow mode too, so the owner can compare it with the laptop's count |

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
   claims and prints it itself.
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
`{route: '/print', body: {firstName, lastName, clubName, clubberId, friend?}, clubberId, source: 'desk'}`.
`route` is one of the print server's own print routes (`/print`, `/reprint`,
`/print-barf-bags`, `/print-custom`, `/print-oneoff`, `/print-leader`,
`/print-award`), `body` that route's own JSON. The page does NOT know the claim's
`gen` (the Worker assigns it): the lease carries it, plaintext (section 6), and
the print role uses that over any `gen` in the record. The Worker adds
`cloud: true` / `regen` itself on the print server side; the page never sends
them.

Read failures on the way answer 429 `{reason: 'read-busy', retryAfterMs}`,
502 `{reason: 'twotimtwo-unreadable'}` or 503 `{reason: 'not-configured'}`.

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
stations once one registers. Brought a friend (BARFED, no friend's name) is the next commit's.

## 6. Print (BUILT)

A station (`X-Station`) leases a job for **90 s** (`LEASE_MS`), prints it and says
done. **These five names are the only ones** (the first draft's `lease` / `ack` /
`hello` aliases were removed: nothing used them). The print role calls exactly
these (`job-puller.js`; the end-to-end test records every path it uses).

| Route | Auth | Request | Answer |
| --- | --- | --- | --- |
| `GET /v1/print/next?max=1..10` | station | | `{jobs: [{jobId, kind: 'checkin' \| 'reprint', night, gen, bundle, leaseUntil, attempt}], leaseMs: 90000}`. Sweeps expired leases back into the queue first; **drops** (never leases) a job whose claim is undone, on another `gen`, already printed, or older than two hours; skips a job whose claim is still `checking`, and one with no bundle yet; oldest first. Seals at most one waiting TwoTimTwo-page job first. `bundle` is the station-sealed job (section 5 for its record); `gen` is the claim's generation in plaintext |
| `POST /v1/print/done` | station | `{jobId, result?: 'printed' \| 'already-spooled'}` | `{ok, already}`. Idempotent: a job already done, or gone (undone, purged) answers ok. `printed` marks the claim `printed` if the job's gen is still the claim's. `already-spooled` (the station journalled the jobId and did not print again) completes the job and raises `checkThePrinter` |
| `POST /v1/print/failed` | station | `{jobId, error?: <short code a-z0-9->}` (any other text is stored as `failed`) | `{ok, state}`: the job is free for another lease at once; after five failures it is `dead` and shows on the status |
| `POST /v1/print/heartbeat` | station | `{jobId?, printer?: {state, detail?}}` every 30 s, and every 20 s while a job prints | with `jobId`: `{ok: true, leaseUntil}` **extends the lease to now + 90 s**, or `{ok: false, reason}` where `unknown` (dropped: stop), `done`, `stale`, `other` (another station holds it). The printer state (`ok busy offline error paper unknown`; anything else is `unknown`) and `lastSeenAt` are noted for the status. The print role reports a label that may not have come out as `error` with `detail` |
| `GET /v1/print/status` | session | | `{queued, leased, done, dead, waitingToSeal, checkThePrinter: [jobId], dropped: {stale, expired}, claims: {checking, queued, printed, undone}, pendingToSeal, cloudPrint, stations: [{stationId, name, lastSeenAt, printer}]}`. Counts and random ids only |
| `POST /v1/print/reprint` | session | `{jobId: 'reprint:<uuid>', bundle}` sealed to every station, `kind` `print-job`, `night` tonight | a reprint job: bypasses the claims entirely. `{ok, jobId, existing}` |

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
  report, the desk, the phone page, the check-in and check-out pages) takes a
  slot through `TwoTimTwoClient.page(path, {waitMs, kind})`. One read every 5 s
  in all; a caller says how long it will queue (`waitMs`): 0 for the watcher
  (it skips its turn), `INTERACTIVE_WAIT_MS` (12 s) for a desk or phone request,
  and a refusal is `{error: 'read-busy', retryAfterMs}`. The watcher's report is
  read about every 10 s (`WATCH_INTERVAL_MS`), the rest of the slots are the
  others'. The clock survives a restart (`read:next` in storage). Posts are
  writes and take no slot.
- **Switches** (`wrangler.toml [vars]`, both `"off"` until the shadow night):
  `CLOUD_PRINT` (jobs for TwoTimTwo-page check-ins) and `SINGLE_PUBLISHER`
  (in cloud mode the Worker publishes `tally`, `tonight` and the still-here
  list itself, and `POST /v1/publish` drops the laptop's `tally`, `tonight`,
  `checkout` and `checkin` frames with 200 `{dropped: true}`, except the one
  greeting per print job a station sends; section 8).

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
numbers). `GET /v1/publisher/status` (session) is counts and times only.

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
- Not carried (known, owner's call at P7): the extension's youth check-out sweep
  posts check-outs to the laptop only; a Trek / Journey child checked out that
  way stays on the count here until the extension is retired. The desk's
  check-out and TwoTimTwo's own report are honoured.

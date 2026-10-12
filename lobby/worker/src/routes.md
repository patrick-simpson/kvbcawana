# Online check-in: the Worker's new routes (P0 contract)

The route table the P1–P7 builders work against (root
`ROADMAP.md#online-check-in`). Built so far: the crypto module
(`lobby/shared/cloud-crypto.js`), the D1 schema (`../migrations/0001_history.sql`)
and, in the Worker core, **the routes marked BUILT below** (stations, the print
lease, the desk's claim API, the one read clock; section 7 says how a module
adds its own). When a route lands, mark it built here and keep its shape; a
change of shape is a change to this file first.

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
- **Single publisher.** The Worker publishes `tally`, `tonight`, the pickup
  list and the greetings in cloud mode; the relay drops the laptop's
  `tally` / still-here frames then (`POST /v1/publish` keeps every other
  event).

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

The friend list (BARF, `friends.js`) moves here: each friend brought is a
`kind: 'friend'` row sealed to the history key. The 6:30 pm emailed report
then needs a reader that can unwrap the key (see the roadmap's open
questions); the read-only link cannot open rows by itself.

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

## 5. The desk page (the Worker's claim API and the page, `site/desk/`, are BUILT)

Our desk page (a browser at the desk, signed in) and the TwoTimTwo page
fallback. The desk page derives keys at sign-in, fetches `/v1/stations` and
`/v1/history/key`, and seals before it posts. The handlers are thin: the
behaviour is `desk.js`, which the page calls through these routes.

| Route | Auth | Request | Answer |
| --- | --- | --- | --- |
| `GET /v1/desk/roster` **BUILT** | session | | tonight's check-in page roster `{readAt, stale?, kids: [{clubberId, first, last, club, clubId, checkedIn}]}` (no medical data; plaintext over TLS, from the last read, held in memory, never stored). Read through the 5 s clock: a read within 5 s is the last one; a clock booked past 12 s answers the last read marked `stale`, or 429 `{reason: 'read-busy', retryAfterMs}` with none |
| `GET /v1/desk/families` **BUILT** | session | | `{households: string[][], familiesError?}`: TwoTimTwo's households (names only, two or more active children each), one read of the export per 30 minutes through the 5 s clock, kept in memory only; a failed read is `[]` plus a fixed `familiesError` code (kept five minutes), a clock turn-away is 429 `{reason: 'read-busy', retryAfterMs}` and not kept. The roster answer also carries `items: {bible: [club], friend: [club]}` (which clubs offer them, from the page it already read) |
| `POST /v1/desk/checkin` **BUILT** | session | `{night, clubberId \| visitor: {first, last, club}, items, historyRow: Row, job: Bundle \| null}`; `night` is the church's local date (else 400 `wrong-night`); `items` is `{Bible?, Friend?}` or `['Bible', 'Friend']`; `job.id` is the jobId, `job.kind` is `print-job`, `job.night` is `night`; `job` may be null only while no station is registered | see below |
| `POST /v1/desk/undo` **BUILT** | session | `{night, clubberId \| visitor, historyRow}` | TwoTimTwo's undo (`checkinclubberundo`, accepted on "(checkin undone)"), then the claim goes `undone` (gen + 1) and every unprinted job of that child is dropped: `{ok, droppedJobs}`. A refusal is 409 `{reason}`, a timeout 504 `{reason: 'unsure'}`: nothing is changed here, and the watcher settles what TwoTimTwo has |
| `POST /v1/desk/checkout` **BUILT** | session | `{night, clubberId \| visitor, historyRow}` | TwoTimTwo check-out (accepted only on "OK"): `{ok}`. The claim is left as it is |
| `GET /v1/desk/tonight` | session | | `authoritativeTonight()` counts (the shared module, not a port; P5) |

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
   of functions the history (P6) and tally (P5) modules push to; each gets
   `{night, tag, gen, jobId, club, visitor, historyRow, source}`. A hook that
   throws never fails the check-in. The answer is `{ok, already: false, jobId,
   gen, history: 'hooked' | 'off'}`: **until a history module registers its
   hook the sealed row is validated and not stored** (`history: 'off'`). P6 may
   also replace `desk.checkRow` with a check that knows the current `kid`.

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
  `sealForStations` (`{clubberId, name, club, source: 'ttt'}`; the owner's
  2026-10-12 decision, which supersedes the earlier `raw`-leased design);
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
registered the job waits as a `raw` body (also sealed under the state key) and
is sealed once one registers. Brought a friend (BARFED, no friend's name) is P5's.

## 6. Print (BUILT)

A station (`X-Station`) leases a job for 90 s (`LEASE_MS`), prints it and says
done. **Canonical routes** (the first draft below called them lease / ack /
hello; those answer too, as aliases):

| Route | Auth | Request | Answer |
| --- | --- | --- | --- |
| `GET /v1/print/next?max=1..10` (alias `POST /v1/print/lease {max}`) | station | | `{jobs: [{jobId, kind: 'checkin' \| 'reprint', night, gen, bundle, leaseUntil, attempt}], leaseMs}`. Sweeps expired leases back into the queue first; **drops** (never leases) a job whose claim is undone, on another `gen`, already printed, or older than two hours; skips a job whose claim is still `checking`, and one with no bundle yet; oldest first. Seals at most one waiting TwoTimTwo-page job first |
| `POST /v1/print/done` (alias `POST /v1/print/ack`) | station | `{jobId, result?: 'printed' \| 'already-spooled'}` | `{ok, already}`. Idempotent: a job already done, or gone (undone, purged) answers ok. `printed` marks the claim `printed` if the job's gen is still the claim's. `already-spooled` (the station journalled the jobId and did not print again) completes the job and raises `checkThePrinter` |
| `POST /v1/print/failed` (ack with `result: 'failed'`) | station | `{jobId, error?: <short code>}` | `{ok, state}`: the job is free for another lease at once; after five failures it is `dead` and shows on the status |
| `POST /v1/print/heartbeat` (alias `POST /v1/print/hello`) | station | `{jobId?, printer?: {state, detail?}}` every 30 s, and every few seconds while a job prints | with `jobId`: `{ok: true, leaseUntil}` renews the lease, or `{ok: false, reason}` where `unknown` (dropped: stop), `done`, `stale`, `other` (another station holds it). The printer state (`ok busy offline error paper unknown`) and `lastSeenAt` are noted for the status |
| `GET /v1/print/status` | session | | `{queued, leased, done, dead, waitingToSeal, checkThePrinter: [jobId], dropped: {stale, expired}, claims: {checking, queued, printed, undone}, pendingToSeal, cloudPrint, stations: [{stationId, name, lastSeenAt, printer}]}`. Counts and random ids only |
| `POST /v1/print/reprint` | session | `{jobId: 'reprint:<uuid>', bundle}` sealed to every station, `kind` `print-job`, `night` tonight | a reprint job: bypasses the claims entirely. `{ok, jobId, existing}` |

Job ids: a check-in job's id is its bundle's `id` (22 base64url characters); a
reprint's `jobId` is `reprint:<uuid>` while its bundle keeps a 22-character id
(the AAD format). A job is the same station-pad sealed bundle everywhere.
At most once: the station journals every jobId it spooled, so a retried job it
already spooled acks `already-spooled` without printing, and the Worker raises
"check the printer" (the label may not have come out). A lease that is never
renewed or finished goes back to the queue, so a second station can print it;
the journal cannot stop that across stations, which is why a job is leased to
one at a time.

## 7. Adding routes, the read clock, the switches (BUILT)

- **The registry** (`registry.js`): a module adds its routes with
  `registry.add(method, '/v1/path/:param', 'public'|'session'|'station', handler)`
  and ONE line in SyncCore's constructor (`mountCheckin(this.registry, this)`;
  P6 adds `mountHistory(...)` beside it). `sync.js` checks the auth level
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
  (in cloud mode `POST /v1/publish` drops the laptop's `tally` and `checkout`
  frames with 200 `{dropped: true}`, so the print server owes no resend; turn
  it on only when the Worker publishes those itself, P5).

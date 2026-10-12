# Online check-in: the Worker's new routes (P0 contract)

The route table the P1–P7 builders work against (root
`ROADMAP.md#online-check-in`). **Nothing here is built yet** except the
crypto module (`lobby/shared/cloud-crypto.js`) and the D1 schema
(`../migrations/0001_history.sql`). When a route lands, mark it built here and
keep its shape; a change of shape is a change to this file first.

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

## 4. Stations (P3)

| Route | Auth | Request | Answer |
| --- | --- | --- | --- |
| `POST /v1/station/register` | session | `{stationId, name, pub, kid}`; `stationId` is the KVBC Awana app's `roles.json` `deviceId`; the private key is in Electron safeStorage (the app refuses the station role when safeStorage is unavailable) | stores `station:<id>`; the same `stationId` may replace its own key. `{stations}` |
| `GET /v1/stations` | session | | `[{stationId, name, pub, kid, registeredAt, lastSeenAt, printer}]` (what a client seals bundles to) |
| `DELETE /v1/stations/<stationId>` | session | | removes a dead computer's key; bundles already sealed to it stay unreadable to it only |
| `GET /v1/station/roster-source?night=` | station | | TwoTimTwo's roster CSV, read through the Worker (counts against the 5 s budget), passed through in memory and never stored. The station seals it to every station. |
| `PUT /v1/station/roster` | station | `{night, bundle}` (`kind: 'roster'`, allergies inside) | stores `roster:<night>` (the latest wins); `{ok}` |
| `GET /v1/station/roster?night=` | station | | `{bundle}` or 404 |
| `PUT /v1/station/books` / `GET /v1/station/books?night=` | station | `{night, bundle}` (`kind: 'books'`, completed books) | as the roster |

Medical notes are sealed ONLY to station keys, never to the history key
(`sealRow` refuses a record with a medical key).

## 5. The desk page (P2)

Our desk page (a browser at the desk, signed in) and the TwoTimTwo page
fallback. The desk page derives keys at sign-in, fetches `/v1/stations` and
`/v1/history/key`, and seals before it posts.

| Route | Auth | Request | Answer |
| --- | --- | --- | --- |
| `GET /v1/desk/roster` | session | | tonight's check-in page roster `{readAt, kids: [{clubberId, first, last, club}]}` (no medical data; plaintext over TLS, from the last read, never stored readable) |
| `POST /v1/desk/checkin` | session | `{night, clubberId \| visitor: {first, last, club}, items, friendFirst?, historyRow: Row, job: Bundle \| null}`; `job.id` is the jobId | claim = `identityTag`/`visitorTag`; an existing claim answers `{already: true, jobId}` (nothing posted twice). Else posts to TwoTimTwo; on success stores the job (`job:<tag>` = `{jobId, bundle, state: 'queued'}`), inserts the history row, bumps `night_summary`, publishes the greeting and tally. `{ok, jobId}`. On a TwoTimTwo refusal nothing is stored. |
| `POST /v1/desk/undo` | session | `{night, clubberId, historyRow}` | TwoTimTwo undo; the claim and an unprinted job are dropped |
| `POST /v1/desk/checkout` | session | `{night, clubberId, historyRow}` | TwoTimTwo check-out |
| `GET /v1/desk/tonight` | session | | `authoritativeTonight()` counts (the shared module, not a port) |

**The TwoTimTwo page fallback.** A check-in made on TwoTimTwo's own page is
seen by the watcher (in the Worker, which holds the name in memory only). It
cannot seal a station bundle or a history row (no ECDH in the Worker), so its
job is stored as `{jobId, raw: sealState(...), state: 'queued'}` under the
Worker's symmetric state key (as `cloud:snap` is today) and leased to a
station, which seals the history row and resolves allergies from its own
roster. Brought a friend on that path prints a BARFED tag WITHOUT the
friend's name (the report has only the box).

## 6. Print (P4)

| Route | Auth | Request | Answer |
| --- | --- | --- | --- |
| `POST /v1/print/lease` | station | `{max: 1..10}` | `{jobs: [{jobId, bundle \| raw, leaseUntil}]}`; a lease lasts 60 s, then the job is free again |
| `POST /v1/print/ack` | station | `{jobId, result: 'printed' \| 'already-spooled' \| 'failed', error?}` | `printed` and `already-spooled` complete the job. At most once: the station journals every jobId it spooled, so a retried job it already sent to the printer acks `already-spooled` without printing, and the Worker raises "check the printer" on the status (it may not have come out). `failed` frees the job for another lease. |
| `POST /v1/print/hello` | station | `{printer: {state, detail?}}` every 30 s | `lastSeenAt`, printer state for the status sticker and the desk page |
| `GET /v1/print/status` | session | | `{queued, leased, done, checkThePrinter: [jobId], stations: [{stationId, name, lastSeenAt, printer}]}` |

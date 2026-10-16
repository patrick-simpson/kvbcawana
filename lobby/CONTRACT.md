# Awana Event Bus Contract v2 (mirror)

**The canonical copy of this contract lives in the printer repo:**
[`printer/CONTRACT.md`](../printer/CONTRACT.md) (was Print-TwoTimTwo-Labels),
alongside the machine-readable `contract-vectors.json` (`printer/contract-vectors.json`,
the one copy: the lobby's tests read it in place).
If you change anything, update the canonical copy first, then every app's
contract tests in the same change.

## Transport

- The sync service's **live channel** (`/api/v1/live` on the Worker in
  `worker/`): one WebSocket per signed-in screen, every frame `{e, d}` with the
  event name and payload below. A screen signs in with the church passphrase.
  Until 2026-10-11 the same events also rode Pusher Channels (channel
  `awana-channel`); that transport is retired and the client is gone, so an old
  `pusherAppKey` / `pusherCluster` setting is simply dropped.
- Consumer code: `src/hooks/useSocket.js`, which binds every event through
  its own strict allowlist sanitizer in `src/lib/eventSanitizers.js`.
- The legacy **`provision`** display-login frame is gone (removed 2026-10-12,
  with its section of `envelope-vectors.json`): a screen signs in through the
  sync service, which hands it the display key.

## Privacy invariant — do not relax

**One strict allowlist sanitizer per event type.** Every incoming payload
is reduced to exactly its allowlisted fields before anything else sees
it. First names only, ever: allergy info, last names, contact info, birth
years, photos — none of it can ever reach the screen, even if a future
producer starts sending more. `src/lib/eventSanitizers.test.js` proves
this data-driven against the mirrored contract vectors (valid vectors
survive intact, dirty-PII vectors are scrubbed, garbage is rejected).

## Events

| Event | Payload (wire) | Display behavior |
|---|---|---|
| `checkin` (v2) | `{ id?, at?, firstName, club, isBirthday, isFirstTimer }` | Full celebration banner. `id`/`at` are optional (v1 producers still work); `id` feeds the replay dedupe ledger. |
| `recap` | `{ entries: [checkin…], at }` (≤30 used) | Quiet "Also joined us tonight" banners for unseen ids newer than `recapMaxAgeMin` (default 20 min) — no confetti, no chime. |
| `tally` | `{ counts: {club: int}, total, at }` | Numbers only; reserved for club milestone celebrations. |
| `birthdays` | `{ entries: [{firstName, club, month, day}], at }` | Consumed by the countdown app; sanitized here for forward use. |
| `ops` | `{ type: 'print-failure'\|'selector-fail'\|'canary', club?, at }` | Operator-only: red count on the Signal sticker + panel details. **Never a public banner.** |
| `canary` | `{ at, nonce? }` | End-to-end pipe test; updates last-event health only. |

## Semantics

- One `checkin` per successful new label print. The printer suppresses
  duplicates (25-second window); reprints and canary test prints do not
  broadcast.
- The live channel does not replay missed events by itself — `recap` (published
  every ~2 min during club hours) is the replay mechanism, deduped on
  `id` against the sessionStorage seen-ledger (`useSeenEvents`).
- New fields must stay optional for consumers for at least one release
  cycle so producer/consumer deploy order never matters.

# Awana Event Bus Contract v2 (mirror)

**The canonical copy of this contract lives in the printer repo:**
[Print-TwoTimTwo-Labels → CONTRACT.md](https://github.com/patrick-simpson/Print-TwoTimTwo-Labels/blob/main/CONTRACT.md),
alongside the machine-readable `contract-vectors.json`, which is mirrored
byte-identical here as `src/lib/__fixtures__/contract-vectors.json`.
If you change anything, update the canonical copy first, then the mirrors
and every repo's contract tests in the same change.

## Transport

- **Pusher Channels**, channel **`awana-channel`**.
- Only the print server holds the publish secret; this display subscribes
  with the public key (`pusherAppKey` + `pusherCluster` in settings).
- Consumer code: `src/hooks/useSocket.js`, which binds every event through
  its own strict allowlist sanitizer in `src/lib/eventSanitizers.js`.
- A second channel, **`cache-awana-channel-provision`** (a Pusher cache
  channel), carries one `provision` frame: the display key and slide-publish
  token sealed under a passphrase-derived key — plus an optional, NON-secret
  `configUrl`, the fleet-config address a screen already accepts as
  `?config=` — for the display login. It is
  **transport/provisioning, not a display event** — never sanitized, never
  dispatched, never rendered, opened only by `src/lib/displayLogin.js`, which
  writes solely into the display-key, publish-token and fleet-config-URL
  storage slots (never into the settings object). Shape and KDF are pinned by
  the `provision` section of `envelope-vectors.json`; the authoritative
  description is the printer repo's CONTRACT.md.

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
- Pusher does not replay missed events by itself — `recap` (published
  every ~2 min during club hours) is the replay mechanism, deduped on
  `id` against the sessionStorage seen-ledger (`useSeenEvents`).
- New fields must stay optional for consumers for at least one release
  cycle so producer/consumer deploy order never matters.

# Club Event Bus Contract (v6)

This document pins the payload schemas for every event on the live channel
**`awana-channel`** (the sync Worker's; it was a public Pusher channel until
2026-10-03). The **print server in this repo is the ONLY publisher** (it
relays every frame to the Worker while signed in to it); the consumer is
the lobby app ([`lobby/`](../lobby/) in this repo, was Awana-Check-in-Display) —
both its signage page and its presentation page (`/countdown.html`, which
absorbed the retired KVBC-Awana-Countdown app) — subscribing with the
public key only.

The machine-readable version of this contract is
[`contract-vectors.json`](./contract-vectors.json) — **this repo holds the
canonical copy**, mirrored byte-identical into the consumer repo at
`src/lib/__fixtures__/contract-vectors.json`. Each repo's tests validate
against its own copy, and the consumer repo's CI byte-compares its mirror
against this repo's canonical file, so any drift breaks a build somewhere.

## The privacy rule

> **Only first names ever ride the channel.** No last names, no allergies, no
> contact info, no birth years, no photos. The payload builders in
> [`print-server/events.js`](./print-server/events.js) enforce this
> structurally (they never accept those fields), and every consumer runs each
> event through its own strict allowlist sanitizer before anything reaches a
> screen.

## Events

### `checkin` — one child checked in (v2)

Published on every successful label print (canary test prints excluded).

| Field | Type | Notes |
|---|---|---|
| `id` | string (uuid) | NEW in v2 — consumers dedupe live vs recap delivery on this. Optional for consumers (deploy-order safety). |
| `at` | string (ISO 8601) | NEW in v2 — lets consumers age out stale replays. Optional for consumers. |
| `firstName` | string | First name only, ≤40 chars |
| `club` | string | Club display name as TwoTimTwo reports it |
| `isBirthday` | boolean | Birthday-week flag |
| `isFirstTimer` | boolean | Welcome flag: the operator's explicit visitor mark, or (when the publisher's `connectCardAutoFirstTimer` setting is on) an auto-detected first-ever check-in. Same field, same type — consumers need no change. |
| `welcomeBack` | OPTIONAL literal `true` — a RETURNING kid's first night of the season (#9). Sealed with the rest of the payload; fits the fixed 512-byte pad with wide headroom. |
| `milestone` | OPTIONAL int 1–999 — the season night-count on a label-milestone night (5/10/25/50), for the display's milestone wall (#10). Sealed; per-child data never rides plaintext. |

### `recap` — replay buffer (every ~2 min during club hours)

The last ≤15 `checkin` payloads (same shape, `id`+`at` required per entry) so
a display that reconnects mid-event can celebrate the kids it missed.

| Field | Type |
|---|---|
| `entries` | array of `checkin` payloads (consumers cap at 30) |
| `at` | string (ISO 8601) |

### `tally` — per-club checked-in counts (each check-in + every ~60 s)

Zero PII — numbers only. Keys are club display names exactly as the check-in
system reports them; each consumer normalizes through its own alias map.

| Field | Type |
|---|---|
| `counts` | object `{ "<club name>": int ≥ 0 }` (≤30 clubs) |
| `total` | int ≥ 0 |
| `at` | string (ISO 8601) |
| `season` | OPTIONAL string, lowercase slug (e.g. `christmas`) — the printer's unified-theming broadcast (#18), set by the dashboard's **Screen season** setting (config key `seasonTheme`); absent when that setting is Off. Labels no longer print seasonal art (2026-27 rebrand); this field is now only for the screens. Zero PII. |
| `rehearsal` | OPTIONAL literal `true` — present only while rehearsal mode (#19) is armed, so displays watermark themselves. Absent otherwise. |

Both optional fields stay optional forever: consumers drop unknown fields, so
deploy order between the repos never matters.

### `birthdays` — this week's birthday kids (startup + every ~10 min on club night)

First names only, ever. `month`/`day` are the birthday's calendar month/day
(ints, **no year**) so the countdown app reuses its pure week-matching.

| Field | Type |
|---|---|
| `entries` | array of `{ firstName, club, month (1-12), day (1-31) }` (≤40) |
| `at` | string (ISO 8601) |

### `ops` — operator telemetry (never a public banner)

| Field | Type | Notes |
|---|---|---|
| `type` | `"print-failure" \| "canary" \| "selector-fail" \| "update-ok"` | `update-ok` NEW: the opt-in update health beacon (#5) — the first boot of a freshly-updated print server announces it came back cleanly. |
| `club` | string (optional) | Club only — **never a name** |
| `version` | string (optional) | Bare semver (`5.27.0`), only on `update-ok`. Version + the ok that the event exists at all — nothing else ever rides this. |
| `at` | string (ISO 8601) | |

### `canary` — end-to-end pipe test (POST /canary)

| Field | Type |
|---|---|
| `at` | string (ISO 8601) |
| `nonce` | string (optional, ≤64) |

### `slides` — the operator's typed lobby slide deck (v5, sealed, chunked)

Published by the print server when the operator publishes the typed slide
deck (dashboard "Lobby slides" card, or the display app's slide editor
POSTing to `/api/lobby-slides`), then rebroadcast whole every ~5 minutes
while the server runs so a rebooted screen converges without a handshake.

**TEXT ONLY.** The display app's video slides reference bytes in one
device's own storage, so the publisher strips them and every consumer's
sanitizer drops them. The deck is arbitrary operator-authored copy, which is
why this event rides **sealed** like the name-bearing four.

One publish is split into chunks to stay under the per-frame ceiling (`FRAME_MAX_BYTES`, 10 KB).
Every chunk of a publish carries identical `deckRev` + `publishedAt`:

| Field | Type | Notes |
|---|---|---|
| `deckRev` | int ≥ 1 | Operator-facing counter. Chunk grouping only — **never** the ordering authority; it may restart at 1 if the server loses its state file. |
| `publishedAt` | string (ISO 8601) | **The** ordering + anti-replay authority. A consumer commits an assembled deck iff its `publishedAt` is strictly newer than the committed one. Rebroadcasts reuse it byte-identically. |
| `seq` | int, `0 ≤ seq < total` | Chunk index. |
| `total` | int, 1–12 | Chunk count for this publish. |
| `slides` | array | `{ id? (≤64), eyebrow (≤60), text (required, ≤500, multi-line), theme (whitelist else "auto"), textSize (whitelist else "auto"), durationSec (0 or 3–600) }`. ≤50 per deck. `slides: []` is legal only when `total` is 1 — an explicitly cleared deck propagates. |

A slide may also carry an optional **show window** so a dated announcement
retires itself instead of advertising last month's store night:

| Field | Type | Notes |
|---|---|---|
| `showFrom` | OPTIONAL `YYYY-MM-DD` | First day the slide may show. Absent = from the beginning. |
| `showUntil` | OPTIONAL `YYYY-MM-DD` | Last day it may show, inclusive. Absent = forever. |

Both are **bare local calendar dates with no timezone**, exactly as the
operator typed them. Every consumer compares them against ITS OWN local date
key — never a `toISOString()`-derived one, which in a US-Eastern evening has
already rolled to tomorrow, i.e. exactly club hours. The publisher DROPS a
value that is not a real calendar date (`2026-02-30`, `next Wednesday`), so a
junk window means the slide always shows, never that it silently never does.
A deck whose every slide has expired is still a published deck; what a screen
does with an empty visible set is the consumer's business (this repo's display
falls back to its calendar slides).

A slide may also carry the operator's **"Hold check-ins"** mark:

| Field | Type | Notes |
|---|---|---|
| `holdCheckIns` | OPTIONAL, literal `true` | While this slide is on screen the display holds its check-in banners; the arrivals wait and play afterwards at full length. |

The publisher writes it **only** as `true`, and only when the incoming slide
has exactly `true`; anything else (`false`, `"true"`, `1`, missing) is
**omitted, never written as `false`**, so an unmarked deck is byte-identical
to one published before the field existed. It costs 20 bytes a slide: the
worst deck the caps admit (50 slides at full text and eyebrow, both dates and
the mark, 35 251 bytes) still needs only 10 of the 12 chunks.

The publisher refuses — at publish time, before committing anything — any
deck that cannot be broadcast within the 12-chunk ceiling (greedy packing
can strand slack per chunk, so a raw byte cap alone is not a guarantee),
and also caps a whole deck's serialized JSON at 40 000 bytes. Every chunk
of an accepted publish seals into the `slides` pad ladder (`[2048, 4096]`,
**fail closed** above — the 8192 rung would base64-inflate past the frame
ceiling, so it must not exist for this event).

### `settings` — the lobby screens' shared settings (v6, sealed, one frame)

Published by the print server when the display app's Settings, open on the
check-in computer, changes a SHARED setting (it POSTs the whole shared set to
`/api/display-settings`, with the publish token from the display app's
origin, exactly like `/api/lobby-slides`), then rebroadcast whole every ~5
minutes so a rebooted screen converges. Sealed: it carries church-authored
copy (the welcome wording and one short line per club).

| Field | Type | Notes |
|---|---|---|
| `rev` | int ≥ 1 | Operator-facing counter; may restart at 1. **Never** the ordering authority. |
| `publishedAt` | string (ISO 8601) | **The** ordering + anti-replay authority. A consumer applies a payload iff its `publishedAt` is strictly newer than the one it holds. Rebroadcasts reuse it byte-identically. |
| `settings` | object | ONLY keys from `events.settings.keys` in the vectors, each checked against its rule (bool, a clamped int or number, an enum, a capped plain string, an https URL, an `HH:MM` time, a lowercase skin id, a repaired list of thresholds, or up to 15 club lines of 80 characters). Every key is optional. |

**Shared, not per-screen.** What plays behind the names, the uploads, this
TV's sound, motion, confetti, wake lock and simplified mode, and the sync
keys are per-screen and are not in the table, so they can never ride the
wire; the publisher drops them, and so does every consumer. A consumer that
lacks a key keeps its own value. **No names, ever:** thresholds, switches,
times and church copy. The publisher caps the settings object's JSON at
3 800 bytes (the worst case the caps admit is well under it) and refuses
anything bigger with a 413 before committing, so every accepted frame seals
into the `[2048, 4096]` ladder `slides` uses, fail closed above.

### `update` — retired

The laptop-internal release ping (the release workflow publishing `{ version,
at }` so the Electron shell could check for an update sooner) is retired: the
app no longer listens for it and polls the update feed every ten minutes. No
display ever bound it, and none should.

## Validation

```bash
npm run test:contracts   # → node scripts/test-contracts.cjs
```

Validates every builder in `print-server/events.js` against the vectors:
exact key sets, correct types, PII structurally impossible, plus the
`isClubNightNow()` scheduling gate.

## Changing the contract

1. Update `contract-vectors.json` **here first** (canonical copy).
2. Update the builders + `test-contracts.cjs`, keep them green.
3. Mirror the vectors file byte-identical into `lobby/` (was Awana-Check-in-Display; `scripts/check-mirrors.mjs` fails until you do)
   (`src/lib/__fixtures__/contract-vectors.json`) and update its
   sanitizers/tests in the same change.
4. New fields must be optional for consumers for at least one release cycle so
   deploy order never matters.

## The transport: sealed envelopes

The channel was a **public** Pusher channel, which has no server-side
authorization primitive — subscription was granted by possession of the app
key, which had to ship in the display's public bundle. The Worker's channel is
signed in, and the rules below stand unchanged. So the four
name-bearing events (`checkin`, `recap`, `birthdays`, `checkout`), the
operator-authored `slides` deck and the shared `settings` are **encrypted** with AES-256-GCM before
publish; the remaining events ride in the clear on purpose.

This is a **transport** layer, strictly outside the contract above:

- No payload vector changes. A sealed frame is opened and then handed to the
  same allowlist sanitizer a plaintext one would be — decryption sits *in front
  of* the privacy boundary, never beside it. A frame that authenticates is
  authenticated, not trusted.
- The framing (envelope version, AAD construction, padding sizes, ciphertext
  layout) and a cross-implementation interop fixture live in
  **`envelope-vectors.json`**, mirrored byte-identically into the display repo
  exactly like this file. Both repos assert they can open every envelope in it,
  which is what stops the Node seal and the WebCrypto open from drifting.
- **Changing the framing is a bigger deal than adding a field.** There is no
  partial failure: either the two sides agree or no child's name renders
  anywhere. Bump `ENVELOPE_VERSION` (which changes the AAD, so old frames stop
  authenticating rather than silently misparsing), regenerate the fixture with
  `npm run gen:envelope-fixture`, mirror it, and land both repos together.
- Padding is part of the spec, not an optimisation. GCM adds no padding, so an
  unpadded envelope reveals `len(firstName) + len(club)` — and club is inferable
  by correlating the **plaintext** `tally`. `npm run test:envelope` fails the
  build if two `checkin` frames ever differ in length.

See the display repo's SECURITY.md for what remains exposed (timing and
headcount, irreducibly) and for the operator-facing setup and rollback.

### `provision` (removed)

The display-login frame (a bundle sealed under a passphrase-derived key and
published on a Pusher cache channel) was retired on 2026-10-12 and its code and
fixture section deleted. A screen signs in to the sync service instead.


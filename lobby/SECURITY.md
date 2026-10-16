# Security & privacy

This app puts a screen in a room full of children and their families. Its whole
security posture rests on one idea: **the display is a consumer of a
deliberately PII-free data feed, and it re-validates that feed rather than
trusting it.**

## The privacy invariant

Every payload arriving on the live channel (Pusher until 2026-10-11) is reduced to an explicit
allowlist of fields before anything else in the app sees it. The sanitizers live
in [`src/lib/eventSanitizers.js`](src/lib/eventSanitizers.js) and are bound
per-event in [`src/hooks/useSocket.js`](src/hooks/useSocket.js) — one sanitizer
per event type, no shared fallback path.

**First names only, ever.** Allergy information, contact details, last names,
birth years, addresses and photos cannot reach the screen even if the publisher
sends them, because a field that is not on the allowlist is dropped before the
event is dispatched. The typedefs in that file *are* the display's entire data
surface.

Payload shapes are pinned by
[`src/lib/__fixtures__/contract-vectors.json`](src/lib/__fixtures__/contract-vectors.json)
— a byte-identical mirror of the canonical copy in the printer repo — and
enforced by `src/lib/eventSanitizers.test.js`. See [CONTRACT.md](CONTRACT.md).

Two supporting rules:

- **`notice.message` is the only free-text field on the channel.** It is
  church-authored copy intended for public display, so it is shown verbatim by
  design — but it is length-bounded and forced to plain text, and rendered as an
  ordinary React text child. Nothing in this app uses
  `dangerouslySetInnerHTML`.
- **One realtime stack.** `src/presentation/` may not open a second connection;
  its realtime data must flow through the same sanitized socket. Otherwise a
  second, unsanitized path could appear without anyone noticing.

If you change the socket layer, the sanitizers, or a banner component, preserve
this invariant. It is the only thing standing between a roster and a projector.

## The channel was public, so the names are encrypted

> **Update 2026-10-11:** Pusher is retired. Screens now listen on the sync
> service's live channel, which only a signed-in screen (the church passphrase)
> can open, so arrival timing and headcounts are no longer public either. The
> names are still sealed end to end, on purpose: the service relays ciphertext
> it cannot read. The rest of this section describes the public-channel design
> the sealing was built for; read "Pusher" as "the relay".

This section used to explain, at length, that anyone who viewed the page source
could take the Pusher App Key, subscribe to `awana-channel` from anywhere in the
world, and watch every child's first name arrive live — and that closing it would
require a backend this repo does not have. That was true, and it was not
acceptable. It is now fixed, and the fix did not need a backend.

**The four events that carry a child's name are encrypted end to end.**
`checkin`, `recap`, `birthdays` and `checkout` are sealed with AES-256-GCM under a key that
only the print server and the church's own screens hold. Pusher relays
ciphertext it cannot read. See [`src/lib/envelope.js`](src/lib/envelope.js) for
the framing and the reasoning; the publisher half is `print-server/events.js` in
the printer repo, and the two are pinned to a shared interop fixture
(`envelope-vectors.json`) so they cannot drift.

**The synced slide deck (`slides`, contract v5) is sealed too.** It is
free-typed operator copy — one day it will say "Pray for the Smiths" — so it
gets the same envelope, on its own pad ladder (`[2048, 4096]`, fail-closed,
because the 8192 rung would not fit Pusher's frame ceiling). Honesty about what
that buys: "encrypted" means **church-readable** — every screen holding the
shared display key can read the deck, there is no forward secrecy (a leaked key
opens recorded past frames, same as `checkin`), and the deck sits in plaintext
in each screen's localStorage and in the print server's `lobby-slides.json`.
All acceptable for lobby-facing announcements, and stated here so nobody
mistakes it for more.

The slide **publish token** is a separate, lesser credential: it lets its
holder ask the print server (from an allowlisted origin, with loopback or
PIN-gated reach) to broadcast a new deck. It lives in its own localStorage
entry (`src/lib/publishToken.js`) on the one machine that edits slides, never
in `VALIDATORS`/config — the same three leak paths that displayKey.js
enumerates are pinned shut by `publishToken.test.js`. Blast radius if it leaks:
length-capped, allowlist-sanitized plain text on the lobby TVs, revoked by
regenerating the token on the printer dashboard.

The channel is still a public channel and the App Key still ships in the bundle.
That is deliberate: Pusher public channels have **no server-side authorization
primitive** — subscription is granted by possession of the key, and there is no
setting that changes it. So rather than trying to control who may subscribe, we
made subscribing useless for reading names.

### The who's-still-here board carries an extra obligation

`checkout` lists children who have not been checked out yet. Encryption keeps it
off the open internet, but it is still on a **public wall**, so the rendering
rules are part of the privacy design:

- **Off by default.** It appears only when an operator turns it on.
- **Names disappear when the list gets short.** Forty names is anonymising; two
  names at 8:15pm is a statement about two specific unattended children — and
  their first names were already on this same screen earlier in the evening. The
  threshold is `checkoutBoardNamesAbove` (default 3).
- **Time-windowed.** In `pickup` mode it is only on screen from closing onwards.
- **No data renders nothing**, never an empty board.
- **It is not a headcount** and never claims to be. It reflects whether checkout
  was *recorded* in the check-in system, which during a pickup rush often lags,
  so it can be freshly and confidently wrong. Every string on it says "not
  checked out yet".

The decision logic is a pure function (`src/lib/checkoutBoard.js`) precisely so
it can be tested exhaustively rather than eyeballed.

### Why the other events stay in the clear

`tally`, `tonight`, `points`, `schedule`, `notice`, `ops` and `canary` are
**deliberately** unencrypted. They are counts and church-authored copy, none of
it PII and all of it already visible to anyone standing in the lobby.

Their readability is load-bearing, not laziness. It is what lets a screen tell
three different faults apart:

| What the screen sees | What it means |
|---|---|
| Nothing at all | the pipe is down — check the network |
| Counts and clock fine, no names | this screen cannot read names — check its display key |
| Counts rising, no names, key OK | the **print server** has no key — check the printer |
| Counts flat, no names | quiet night, nothing wrong |

If everything were encrypted, all four would look identical, and the last one is
the dangerous case: nobody investigates a quiet night. The display forces a
worded sticker onto the screen for each fault regardless of the
`showConnectionStatus` setting, because a screen that silently stops welcoming
children is the worst outcome this change could produce.

### The sync service (`worker/`)

Once the church has deployed the sync service (`worker/README.md`) and
`shared/sync.json` names it, the passphrase signs a screen in **through the
service**:

- The word is checked **online only**, by the service, against limits (5 wrong
  tries lock one address out for 15 minutes; 30 in an hour pause sign-ins for
  an hour). It is never on a public channel, so it cannot be guessed offline,
  which is what makes a short dictionary word ("kennebec") reasonable here
  where the old frame needed 12+ characters. Every client is on passphrase v2
  (built 2026-10-12): it derives `authKey` itself (PBKDF2-SHA256, 600000 rounds,
  then HKDF) and the service keeps only SHA-256 of that, so the word never
  reaches the service. The old passphrase-only sign-in is gone (owner
  2026-10-16): a client that sends the word itself is refused. The only salted
  HMAC of the word the service ever holds is the BOOTSTRAP one, made from
  `INITIAL_PASSPHRASE` on a brand-new store so the first client can upgrade it
  (routes.md section 1): "Online check-in history" below.
- A sign-in returns a session (its own storage slot, `awanaSyncSession.v1`,
  never config, never an export or a URL) and the display key.
  **Anyone with the word can read names and change every screen** (the owner's
  choice): treat it like the WiFi password, and change it from Settings →
  Setup → **Change the passphrase** if it gets out. A change signs every screen
  out and replaces the display key.
- The service holds the display key, the shared settings, the slide deck, the
  screen template, Journey's room settings and the church calendar. It never
  sees a check-in: names still go from the check-in laptop straight to the
  screens, sealed.
- What it hands back is not trusted as-is: shared settings and the deck pass
  the same allowlist sanitizers as a live frame (`dispatchEvent`), the
  template its own allowlist, the calendar `sanitizeFeed`.
- Its doorbell (`changed` `{what}` on `awana-sync`) is plaintext and carries no
  content; a screen that hears it fetches from the service.
- **Every signed-in session may change the church-wide controls** (owner
  decision, 2026-10-12, risk accepted after it was explained): the runtime
  switches, the church settings, notices to every screen and the change log's
  undo need only a passphrase session (routes.md section 10), including one
  made by an OBS / ProPresenter `?passphrase=` link. Whoever holds such a link
  holds the passphrase and can do all of that; each change is logged with its
  device and most can be undone.
- **One exception holds names in the clear: the remembered leaders** (owner
  approved, 2026-10-12). The church settings' `leaders` list (routes.md 10.3)
  keeps adult volunteers' FULL names (first and last, club, last printed,
  count) UNENCRYPTED in the Worker's church settings and in its change log,
  readable by any signed-in session. Every child's name stays sealed; never put
  a child in that list.

Until `shared/sync.json` names a service, everything below is how screens are
set up.

### Setting it up

The easy way — **sign in with the church passphrase**:

1. On each screen: gear → Settings → Setup → **Display login** → type the
   passphrase → **Log in**. The sync service hands the screen the display key
   (the old print-server `provision` frame on a Pusher cache channel is gone),
   and the screen keeps following rotations (a passphrase change signs every
   screen out; it asks to be logged in again).
2. On the print-server dashboard, press **Night Test**. Each screen confirms it
   can read names.
3. Write the passphrase on a card and keep it where the church keeps the WiFi
   password. It needs to be somewhere the *next* volunteer can find it.

The manual way still works: copy the display key and paste it under each
screen's Settings → Setup → **Advanced → Display key**. It is the fallback for
a screen that cannot sign in (a browser without secure crypto, no route to the
sync service).

The passphrase is checked online only, by the sync service, against guess
limits; a leaked passphrase is a leaked display key, so rotate the passphrase
(Settings → Setup, which also replaces the key) and screens ask to be logged
in again. Login needs `crypto.subtle`; a plain-http embed has none and falls
back to pasting keys.

Without a key a screen still shows the clock, weather, counts, countdown, slides
and any CLUB CANCELLED notice — **only the welcome banners stop**. So a missed
step is never an emergency. Fix it Thursday.

**Never** email the key, put it in a URL, paste it into a GitHub issue, or
include it in a settings export. The code makes the last three structurally
impossible (see below), but the first one is on you.

### What is still exposed — be plain with yourself about this

This is pseudonymisation of the feed, not an invisible pipe.

- **Timing and volume leak completely, and always will.** Channel and event names
  must stay plaintext for Pusher to route them, so a stranger with the App Key
  still learns to the millisecond when doors opened, the shape of the arrival
  curve, exactly how many children were checked in (count the frames), and
  whether club happened at all on a given date. They cannot learn *who*. This is
  true of every hosted message bus, including Pusher's own end-to-end product.
- **Payload lengths are padded, and that is not cosmetic.** GCM adds no padding
  of its own, so an unpadded envelope would reveal `len(firstName) + len(club)`
  exactly — and club is inferable by correlating the plaintext `tally`. Against a
  known roster over a season that is a real re-identification channel. Every
  sealed `checkin` is therefore padded to an identical size, and a CI test fails
  the build if that ever stops being true.
- **No revocation.** A leaked key is compromised until you generate a new one and
  re-paste it on every screen. At three screens that is a two-minute walk.
- **No forward secrecy.** Someone who logged ciphertext every Wednesday for
  months can decrypt all of it the day the key leaks. **Rotate in the summer, not
  mid-season** — that bounds the window to one program year.
- **Anyone who can read a screen's browser storage gets the key**: filesystem
  access, devtools, a malicious extension. One case deserves naming: if the
  display and the printer repo's marketing site are both served from
  `*.github.io` under the same account, they **share one web origin**, so an XSS
  or a single compromised build dependency on that unrelated site could read this
  key out of the display's `localStorage`. Serving the display from a custom
  domain gives it its own origin and closes that. It is a DNS change, not a code
  change.
- **`crypto.subtle` requires a secure context.** Fine on GitHub Pages HTTPS, but
  it permanently forecloses serving the display from the print server over plain
  HTTP.
- **URL-provisioned embeds lose banners.** `?key=`/`?cluster=` exist so an OBS or
  ProPresenter page with no localStorage can still connect. The display key
  deliberately gets no such flag, so such an embed shows counts and slides but no
  names. That is the right trade and it is a real capability loss.
- **It does nothing about the lobby.** Children's first names are on a wall, by
  design. This closes the remote, anonymous, worldwide, scriptable hole — the
  real one — and nothing else.

One gain worth stating: **Pusher itself can no longer read the names.** Every
hosted-database alternative, Firebase included, necessarily holds the plaintext.

### Where this stops being the right design

At roughly three screens, "regenerate and re-paste" is fine. If the church ever
runs many screens, or if instantly revoking one lost device becomes a
requirement, a symmetric key is the wrong tool and the answer becomes an
identity-based system where revocation is a dashboard click — look at **Ably**
(subscribe-only revocable capability keys, and connections cannot be opened
without a key, so there is no anonymous-connection surface) before Firebase,
whose free tier caps simultaneous connections at 100 and cannot raise it, which
would let a stranger with the public database URL black out the lobby TV.

### Why the key is not in `awanaConfig.v1`

The display key lives in its **own** `localStorage` entry
([`src/lib/displayKey.js`](src/lib/displayKey.js)) and is deliberately absent
from the `VALIDATORS` table in `useConfig.js`. That is not tidiness — it closes
three leak paths at once, each of which is a documented, encouraged workflow:

1. `?config=<url>` merges a remote JSON through the same `sanitizeOverrides`
   table, so anything in `VALIDATORS` is settable from a file at a public URL.
2. Settings → Export serialises the overrides to a JSON file that gets emailed
   and dropped in shared drives.
3. The URL: OBS / ProPresenter links carry the passphrase (`?passphrase=`, the
   owner's choice; it is stripped from the address bar once read) and used to
   carry Pusher's public `?key=`, now ignored. URLs land in browser history,
   screenshots, and the kiosk shortcut taped to the wall, so the display key
   itself never travels in one.

Three deny-lists would each have been one forgotten line away from publishing the
key. A separate storage entry means there is no list to forget.
`src/lib/displayKey.test.js` asserts all three paths stay closed, and those
assertions were verified to fail when the key is added to `VALIDATORS`.

The same rule covers the slide publish token (`src/lib/publishToken.js`) in
its own entry, with the same three tests.

It also covers the **fleet-config URL** (once delivered by the retired display login)
(`src/lib/fleetConfigUrl.js`, `awanaFleetConfigUrl.v1`), and that one is worth
being precise about because it is **not a secret**: it is an address, and the
JSON it points at holds display preferences, never child data. What the
separate entry protects is the *settings object's meaning*. Anything in
`VALIDATORS` is settable by `?config=` and written out by Settings → Export, so
putting the URL there would let one remote config file repoint a screen at
another remote config file with no operator in the loop, and would put the URL
into every exported settings file. It is applied through the same remote-config
path `?config=` already uses, and an explicit `?config=` on the URL still wins —
the person standing at the screen outranks what the print server last handed it.
It is https-only and length-capped on both sides, and re-validated on the way
out of storage, so a hand-edited entry cannot point a screen at plain http.
`src/lib/fleetConfigUrl.test.js` carries the same three leak-path tests.

## Online check-in history (design, P0 built 2026-10-12)

The plan is the root `ROADMAP.md#online-check-in`; the cryptography is
`shared/cloud-crypto.js` (pinned by `shared/cloud-vectors.json`), the storage
`worker/migrations/0001_history.sql`, the routes `worker/src/routes.md`. Only
the module, its vectors and the schema exist so far; this section is the
promise every later phase keeps. Say it in these words: names are **never
stored readable**. That is not the same as "Cloudflare can never see a name".

### What is protected

- **Names at rest.** Every history row (a check-in, an undo, a check-out, a
  visitor, a friend brought) is sealed by a CLIENT to the history public key
  (ECIES on P-256: a fresh ephemeral key per row, HKDF-SHA256, AES-256-GCM)
  before it is sent. D1 and the Durable Object hold only that ciphertext, its
  random row id, the church's local night, its kind, and plaintext counts per
  club (the numbers the plaintext `tally` already publishes). Every row pads to
  the same 1024 bytes, so a row's length says nothing about the name in it.
- **The history private key** exists outside a client's memory only wrapped:
  AES-256-GCM under a key derived from the passphrase (PBKDF2-SHA256, at least
  600000 iterations, a fresh salt per wrap, then HKDF). Clients unwrap it into
  a non-extractable WebCrypto key and check it belongs to `history:pub` before
  they trust either. The Worker never derives, seals or opens anything (it is
  on Cloudflare's free plan, and the design keeps all key work off it).
- **The passphrase itself** (from P1). Clients send `authKey`, an HKDF output
  of the PBKDF2 result; the Worker stores SHA-256(authKey). A stolen store no
  longer gives a fast offline test of the word (today's salted HMAC does), and
  the Worker never receives the word once every client is on v2.
- **Medical notes** (allergies) are sealed only to the registered print
  stations' keys (private halves in Electron safeStorage on those computers),
  never to the history key: someone who knows the passphrase can read the
  history, not the allergy list. A history row carrying a medical field is
  refused before it is sealed.
- **Identifiers.** The Durable Object keys claims and print jobs by
  HMAC(stateKey, night|clubberId), never the clubber id, and forgets them at
  the end of the night.
- **Binding.** Each sealed row's AAD names its id, night, kind, ephemeral key
  and key id, so a row moved to another night or relabelled will not open.
- **Fail closed.** A client that cannot seal writes nothing.

### What is NOT protected (be plain about it)

- **A compromised Worker sees names in memory.** It reads TwoTimTwo's pages
  (names, ids, clubs) to check children in and to watch the report, and it
  passes the roster CSV (allergies included) through to a station. Whoever
  controls the Worker's code (the GitHub repo, the Cloudflare account) can log
  what passes through it from then on. Encryption at rest does not stop that;
  it stops a copy of the storage, a backup, or a later read of old nights.
- **Anyone holding the public key can forge rows.** `history:pub` is not a
  secret (every signed-in client fetches it), and a seal proves nothing about
  who wrote it. A row that opens is well-formed, not authentic: treat history
  as a record the church keeps, not as evidence.
- **The passphrase is the one key, and its strength is the owner's call.**
  Six characters are accepted (owner, 2026-10-11, risk accepted). PBKDF2 at
  600000 iterations slows an offline guess of a stolen wrap, it does not save a
  dictionary word: anyone who gets `history:wrapped` and guesses the word reads
  every night. Anyone who knows the word can read the history (by design, like
  the screens: choice B).
- **No recovery.** There is no recovery code and no escrow (owner). Lose the
  passphrase and the history is gone for good; a changed passphrase keeps it
  (the key is re-wrapped), and the previous wrap is kept 7 days.
- **The bootstrap hash.** A brand-new store holds only the fast salted HMAC of
  `INITIAL_PASSPHRASE` (the Worker never runs PBKDF2, so it cannot make the v2
  verifier itself). The first client to sign in sends the passphrase ONCE with
  its `authKey` (over TLS) to upgrade the store; the next v2 sign-in, or a v2
  passphrase change, deletes the hash, so its weakness lasts only that long.
  `GET /v1/cloud/status` shows `auth.bootstrap` while it is still kept. Since
  2026-10-16 there is no other passphrase-only path: the plain `{passphrase}`
  login, the `AUTH_LEGACY` switch and the old-shape passphrase change are gone.
- **What is visible anyway.** Row counts per night and kind, the per-club
  numbers in `night_summary`, the times rows arrive, and which station leased
  which job. The same counts are already public on the `tally` frame.
- **The screens are unchanged by this.** First names still reach the lobby by
  design, sealed under the display key (above).

## What lives on the device

The Settings panel stores configuration in `localStorage` under
`awanaConfig.v1`, and the "skip weeks" schedule overlay is device-local too.
Every value read back out is re-validated per key (see
`src/hooks/useConfig.js`), so a corrupt or hand-edited entry cannot produce a
broken screen on club night. No roster data is ever persisted — check-in events
are held in memory for the recap window and discarded.

Nothing in this repo requires a deploy secret: the Pages workflow uses GitHub's
own OIDC token.

## Forking this repo

1. **Point `shared/sync.json` at your own sync service** (or clear it). If you
   fork a deployed instance and leave it, your screens sign in to that church's
   service.
2. **Never add the sync service's secrets** (`INITIAL_PASSPHRASE`, the
   TwoTimTwo credentials) to this repo. They live in the Worker's own secrets.
3. **Set your own church identity** — `src/presentation/church.config.js` and
   the files under `shared/` carry church-specific names, schedule and slide
   copy.
4. **Keep `contract-vectors.json` byte-identical** with the printer repo's
   canonical copy. It is the shared definition of what may ride the channel; if
   the two drift, the sanitizers stop matching what the publisher sends.
5. **Generate your own display key** — never reuse another church's. If you fork
   a deployed instance, clear the key from every screen and generate a fresh one
   on your own print server. A shared key means a shared ability to read names.
6. **Run `npm test`.** The sanitizer suite proves the privacy invariant still
   holds; `envelope.test.js` proves this repo can still open what the printer
   seals, and `displayKey.test.js` proves the key cannot leak through a remote
   config, a settings export, or a URL.

## Reporting a vulnerability

Open a GitHub issue for anything non-sensitive. For something that would expose
children's data, contact the repository maintainer directly rather than filing a
public issue.

# Security & privacy

This app puts a screen in a room full of children and their families. Its whole
security posture rests on one idea: **the display is a consumer of a
deliberately PII-free data feed, and it re-validates that feed rather than
trusting it.**

## The privacy invariant

Every payload arriving on the Pusher channel is reduced to an explicit
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
- **One Pusher stack.** `src/presentation/` may not open a second connection;
  its realtime data must flow through the same sanitized socket. Otherwise a
  second, unsanitized path could appear without anyone noticing.

If you change the socket layer, the sanitizers, or a banner component, preserve
this invariant. It is the only thing standing between a roster and a projector.

## The channel is public, so the names are encrypted

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
service** instead of opening the print server's `provision` frame:

- The word is checked **online only**, by the service, against limits (5 wrong
  tries lock one address out for 15 minutes; 30 in an hour pause sign-ins for
  an hour). It is never on a public channel, so it cannot be guessed offline,
  which is what makes a short dictionary word ("kennebec") reasonable here
  where the old frame needed 12+ characters. The service keeps only a salted
  HMAC of it.
- A sign-in returns a session (its own storage slot, `awanaSyncSession.v1`,
  never config, never an export or a URL), the display key and the Pusher key.
  **Anyone with the word can read names and change every screen** (the owner's
  choice): treat it like the WiFi password, and change it from Settings →
  Setup → **Change the passphrase** if it gets out. A change signs every screen
  out and replaces the display key.
- The service holds the display key, the shared settings, the slide deck, the
  screen template, Journey's room settings and the church calendar. It never
  sees a check-in: names still go from the check-in laptop straight to the
  screens, sealed.
- What it hands back is not trusted as-is: shared settings and the deck pass
  the same allowlist sanitizers as a Pusher frame (`dispatchEvent`), the
  template its own allowlist, the calendar `sanitizeFeed`.
- Its doorbell (`changed` `{what}` on `awana-sync`) is plaintext and carries no
  content; a screen that hears it fetches from the service.

Until `shared/sync.json` names a service, everything below is how screens are
set up.

### Setting it up

The easy way — **display login**:

1. On the print-server dashboard (`http://localhost:3456`): **Settings →
   Realtime privacy — display key → Generate display key → Save Settings**,
   then **Settings → Display login → Generate** (saves immediately).
   (Direct links: `http://localhost:3456/#display-key`, `#display-login`.)
2. On each screen: gear → Settings → Connection → **Display login** → type
   the passphrase → **Log in**. The screen receives the display key (and the
   slide-publish token) and keeps following rotations made on the dashboard.
   The print server must be running while a screen logs in.
   Optional: fill in **Screen settings URL** on the dashboard beside the
   passphrase and the login hands each screen its display-settings JSON too —
   the same address `?config=` takes — so weather, calendar and corner widgets
   set themselves up instead of being typed in screen by screen. https only,
   never a secret, and never child data. Clearing it there clears it on every
   logged-in screen.
3. Back on the dashboard, press **Night Test**. Each screen confirms it can read
   names.
4. Write the passphrase on a card and keep it where the church keeps the WiFi
   password. It needs to be somewhere the *next* volunteer can find it.

The manual way still works — **Generate display key**, copy, paste it under
each screen's Settings → Connection → **Advanced → Display key**, *then* Save
Settings on the dashboard — and is the fallback for a screen that cannot log
in (no print server on the network, or a browser without secure crypto).

**How the login works, and what it costs.** The print server derives a
wrapping key from the passphrase with PBKDF2-SHA256 (600,000 iterations, a
random salt minted whenever the passphrase changes) and publishes the display
key + publish token (and, optionally, the non-secret fleet-config URL) sealed
under it — the same AES-256-GCM envelope as the
name events — as a `provision` frame on a Pusher *cache* channel, so a screen
switched on later receives the latest frame at once. The screen derives the
same key from what you type (`src/lib/displayLogin.js`), opens the frame with
the one `openEnvelope()` it already trusts, and writes the two secrets into
their own storage slots; the derived login key is stored the same way so later
frames (a rotated key or token) apply by themselves. Consequences to be plain
about: the frame is **public ciphertext on a public channel**, so the
passphrase's strength is the only protection — generated ones are 80 bits, a
typed one must be 12+ characters; a **leaked passphrase is a leaked display
key and token** — rotate the passphrase (new salt) *and* the key *and* the
token, and screens then ask to be logged in again; a captured frame cannot
roll a screen back to an older key (`issuedAt` replay guard); and nothing is
ever published without a display key, so a screen can never be provisioned
into plaintext. Login needs `crypto.subtle` — a plain-http embed has none and
falls back to pasting keys.

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
3. `?key=` already carries the Pusher App Key on the query string, so a URL is an
   established place for credentials here — and URLs land in browser history,
   screenshots, and the kiosk shortcut taped to the wall.

Three deny-lists would each have been one forgotten line away from publishing the
key. A separate storage entry means there is no list to forget.
`src/lib/displayKey.test.js` asserts all three paths stay closed, and those
assertions were verified to fail when the key is added to `VALIDATORS`.

The same rule covers the slide publish token (`src/lib/publishToken.js`) and
the display-login key (`src/lib/displayLogin.js`, `awanaLoginKey.v1`) — each
in its own entry, each with the same three tests.

It also covers the **fleet-config URL** the display login can deliver
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

1. **Replace `pusherAppKey` in `src/config.js` with your own church's key**, or
   clear it and use the Settings panel. If you fork a deployed instance and
   leave the key in place, you will subscribe to that church's channel and show
   their children's first names on your screen.
2. **Never add the Pusher `secret` or `app_id`** to this repo. The display only
   ever needs the key and the cluster. The secret belongs on the print server.
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

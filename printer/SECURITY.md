# Security & privacy

This app handles personal data about children: names, birthdates, allergy and
medical-release notes, guardian contact details, and photo-consent flags. This
document describes how that data is protected, what the system deliberately
does **not** protect against, and what you must check if you fork this repo.

## Trust model

The print server (`print-server/server.js`) treats its network surface in three
tiers. The rules live in one place — `print-server/security.js` — and are
enforced by an app-level gate ahead of every route.

| Caller | Trust | What it can reach |
|---|---|---|
| **Loopback** (`127.0.0.1`, `::1`) — the Chrome extension via `http://localhost:3456`, the dashboard, the Electron shell | Trusted | Everything |
| **The LAN** — phones running the check-in page | Untrusted; PIN required on **every** request | Everything except the secrets (the PIN, the display key, the sync session) and the PIN itself |
| **Any website open in the volunteer's browser** | Untrusted | Nothing, unless its origin is on the allowlist |

Three consequences worth stating plainly:

- **By default the server binds `127.0.0.1` only.** A default install is not
  reachable from the network at all — not merely PIN-protected there. LAN
  access requires `lanAccess: true` **and** a PIN; without a PIN the server
  refuses to expose itself and says so at startup and in `/health`.
- **The PIN fails closed.** No PIN configured means no LAN access, not open
  LAN access.
- **CORS is an allowlist, never `*`.** Only the extension, `*.twotimtwo.com`,
  this server's own pages, and any operator-configured `allowedOrigins` may
  read a response. Mutating requests carrying a non-allowlisted `Origin` are
  refused outright, which is what stops a hostile tab from writing to the
  server even on requests a browser would not preflight.

### What this does *not* protect against

Be clear-eyed about the limits:

- **The PIN rides plain HTTP.** It stops a bystander from reading the roster on
  the church WiFi. It does not stop someone who can already sniff or MITM that
  network. There is no TLS on the LAN surface.
- **Loopback is trusted wholesale.** Any program running as the volunteer on
  that laptop can read the roster. The threat model is a shared church laptop,
  not a compromised one.
- **The data at rest is not encrypted.** `clubbers.csv`, `print-history.json`
  and `leaders.json` are plain files in the data directory, protected only by
  the OS account. Keep the check-in laptop locked and its disk encrypted.

## Data retention

`print-history.json` is capped both by row count (`MAX_HISTORY`, 200) and by age
(`historyRetentionDays`, default 60, clamped to 1–730). Pruning happens on read
as well as write, so lowering the setting shrinks an existing file on the next
run. The roster CSVs are overwritten by each sync and are never versioned.

`leaders.json` (remembered leader name tags) holds **adult volunteers' names
only** — no contact details, no birthdate, no attendance — one row each, capped
at `LEADERS_MAX` (80, oldest print dropped first). It is deliberately not
pruned by age, because a leader who volunteers once a season should still be one
tap next season; instead a leader not printed for `LEADER_ACTIVE_DAYS` (270, one
club year) stops being offered, and the **×** on a chip deletes the row outright.
It is reachable only from loopback or with the phone PIN, like the roster.

## Where the sensitive files live

`DATA_DIR` — everything the server writes:

- **Electron app** (the supported install): `%APPDATA%/awana-label-printer/`
  (`AWANA_DATA_DIR` is set to Electron's `userData` before the server loads).
- **A bare `node server.js`** (development): `print-server/` itself — i.e. **inside the git
  working tree**.

That second case is why `.gitignore` covers `config.json`, `print-history.json`,
`attendance.json`, `leaders.json` and `events-buffer.json` as well as `clubbers*.csv` (and
`households*.csv`, kept ignored for any old install that still has one on
disk). `config.json` holds the **phone PIN, the display key and the sync session** (and, in old files, a Pusher secret); the
CSVs hold children's and guardians' personal data.

> **If you have ever run the server from a clone of this repo,
> check `git status` before committing anything.** Prior to v5.3.0 only
> `clubbers*.csv` was ignored, so a `git add -A` could commit the church's
> display key, the phone PIN, the full household export and every child's
> check-in history.

## Forking this repo

Work through this list before you run a fork in production.

1. **Check nothing sensitive is already committed.**
   ```sh
   git log --all --name-only --diff-filter=A | sort -u | grep -Ei 'clubber|household|history|config\.json|attendance'
   ```
   Anything real that shows up is in your history permanently until you rewrite
   it (`git filter-repo`) **and** rotate the exposed secret. Deleting the file
   in a later commit is not enough — forks and clones keep the old objects.

2. **Rotate anything the upstream repo might have seen.** Generate your own
   display key and sign in to your own sync service; never reuse a key or
   secret from another church's install.

3. **Set your own church identity.** `print-server/church-config.json`
   (`churchName`, `subdomain`, `checkinUrl`, `pusherChannel`, `clubNights`).
   The baked defaults in `server.js` point at KVBC, so a fork that skips this
   opens another church's check-in page.

4. **Never commit a secret** (the display key, the sync session, an old
   Pusher secret), in `config.json`, in a workflow file, or in a README
   example. They allow publishing to your church's screens.

5. **Keep the sanitizer contract intact.** `contract-vectors.json` is the
   canonical definition of what may ride the live channel, mirrored
   byte-identically into the display repo. Only first names ever go on the
   wire — never last names, allergies, contact details or birth years. See
   `CONTRACT.md`.

6. **Run the tests.** `npm test` includes `scripts/test-server-security.cjs`,
   which asserts the properties above end to end — including that a default
   install is unreachable on the LAN. If you change the middleware order, the
   bind logic or the dashboard's output escaping, that suite is what tells you
   whether you broke the roster's protection.

## The live channel

Screens get their frames from the sync Worker's live channel, which this server
feeds by relaying every frame it publishes (`events.setRelay`). Until
2026-10-03 the channel was a **public** Pusher channel, whose app key anyone
could read from a screen's page source; that is why the payload contract is
PII-free (first names, club names, aggregate counts, birthday month/day —
nothing that identifies a child to a stranger) and why names are sealed with
AES-256-GCM under the display key. Both rules stand on the new channel. The
Pusher publisher is gone from this server (2026-10-12).

## Display login (removed)

Screens used to be provisioned with a single church passphrase through a
`provision` frame on a Pusher cache channel. Screens sign in to the sync
service instead, and the frame builder, the KDF and the fixture section are
gone. `displayLoginPassphrase` stays in the server's secret set so an old
config.json never leaks it (never returned by `GET /config` off-loopback,
never settable from the LAN), and any save scrubs it from disk.

## Reporting a vulnerability

Open a GitHub issue for anything non-sensitive. For something that would expose
children's data, contact the repository maintainer directly rather than filing a
public issue.

# Security & privacy

This app handles personal data about children: names, birthdates, allergy and
medical-release notes, guardian contact details, and photo-consent flags. This
document describes how that data is protected, what the system deliberately
does **not** protect against, and what you must check if you fork this repo.

## Trust model

The print server (`print-server/server.js`) answers the computer it runs on and
nobody else (Online only, owner 2026-10-11: the Wi-Fi phone page, its PIN and
the print dashboard are gone). The rules live in one place —
`print-server/security.js` — and are enforced by an app-level gate ahead of
every route.

| Caller | Trust | What it can reach |
|---|---|---|
| **Loopback** (`127.0.0.1`, `::1`) — the Chrome extension via `http://localhost:3456`, the KVBC Awana app, the phone-relay loop that runs the sync Worker's check-in requests | Trusted | Everything |
| **awana.kvbchurch.org/settings**, in the laptop's own browser | Trusted only for a short route table, and only with proof | Printer settings and tools (no key, no token): see below |
| **The LAN** | Not served | Nothing: the server does not listen there, and the gate refuses a non-loopback socket anyway |
| **Any other website open in the volunteer's browser** | Untrusted | Nothing, unless its origin is on the allowlist |

Four consequences worth stating plainly:

- **The server binds `127.0.0.1` only, always.** There is no setting, PIN or
  environment variable that opens it to the network (`AWANA_BIND_HOST` and
  `lanAccess` are ignored), and a request from any non-loopback address gets a
  403 from the gate on every route. Phones use awana.kvbchurch.org/checkin,
  which the sync Worker answers itself and relays to this computer. Old
  `phonePin`, `lanAccess` and `allowedOrigins` keys in a config.json are never
  read.
- **CORS is an allowlist, never `*`.** Only the extension, `*.twotimtwo.com`,
  a loopback page on this server's own port, and the one settings-page origin
  (below) may read a response. Mutating requests carrying a non-allowlisted
  `Origin` are refused outright, which is what stops a hostile tab from writing
  to the server even on requests a browser would not preflight.
- **The settings page is one exact origin, a route table and a proof.**
  `https://awana.kvbchurch.org` may call only the paths and methods in
  `SETTINGS_PAGE_ROUTES`, only from a loopback socket, and (except `/health`)
  only with its sync sign-in, which the print server confirms with the sync
  service it is already configured for, or a publish token already on the laptop.
  POST /config takes only the printer's own keys from it. The display key, the
  publish token, the display login and sync sign-out are not in the table; the
  one secret the page may handle is the church passphrase, typed to sign this
  computer in again, which goes only to the configured sync service.
- **Secrets stay on the machine.** GET /config withholds them from any caller
  that is not this computer's own app (no `Origin`), and the Electron app writes
  config.json by merge, never whole.

### What this does *not* protect against

Be clear-eyed about the limits:

- **Loopback is trusted wholesale.** Any program running as the volunteer on
  that laptop can read the roster. The threat model is a shared church laptop,
  not a compromised one.
- **A page the volunteer signs in to is trusted with the printer.** The settings
  page can print labels, reprint, arm rehearsal mode and change the printer's
  own settings once signed in with the passphrase; anyone who has the passphrase
  could do the same from the laptop's browser.
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
It is reachable only from loopback (and the settings page's signed-in calls), like the roster.

## Where the sensitive files live

`DATA_DIR` — everything the server writes:

- **Electron app** (the supported install): `%APPDATA%/awana-label-printer/`
  (`AWANA_DATA_DIR` is set to Electron's `userData` before the server loads).
- **A bare `node server.js`** (development): `print-server/` itself — i.e. **inside the git
  working tree**.

That second case is why `.gitignore` covers `config.json`, `print-history.json`,
`attendance.json`, `leaders.json` and `events-buffer.json` as well as `clubbers*.csv` (and
`households*.csv`, kept ignored for any old install that still has one on
disk). `config.json` holds the **display key and the sync session** (and, in old files, a phone PIN or a Pusher secret); the
CSVs hold children's and guardians' personal data.

> **If you have ever run the server from a clone of this repo,
> check `git status` before committing anything.** Prior to v5.3.0 only
> `clubbers*.csv` was ignored, so a `git add -A` could commit the church's
> display key, the old phone PIN, the full household export and every child's
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
   which asserts the properties above end to end — including that the server
   is unreachable on the LAN however it is configured. If you change the
   middleware order, the bind or the settings page's output escaping, that suite
   is what tells you whether you broke the roster's protection.

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

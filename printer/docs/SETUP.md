# Setup guide

First-time setup, after the install in [the README](../README.md#install). Problems: [TROUBLESHOOTING.md](../TROUBLESHOOTING.md). The club-night checklist: [NIGHT-OF.md](NIGHT-OF.md).

## 1. First start, and updates

The app opens its setup wizard on first start: the role (print server, display, or both), the church passphrase (which signs this computer in to the sync service), a name for the computer, then the printer (print server) and the screen, monitor and hours (display). The app then lives in the system tray and starts with Windows. Start with Windows is one setting for both roles; the tray, the display's Settings and the wizard all set it.

A laptop upgrading from an 8.x install is a print server with the display off and setup done, so it never sees the wizard or the display. The print server listens only on this computer, so Windows has nothing to ask about the network.

The tray's **Settings (awana.kvbchurch.org/settings)** opens the one settings page, and its status window can print a test label.

**Updates.** The app checks the update feed at awana.kvbchurch.org/updates/printer/ on every launch and every ten minutes after that, so a release reaches a laptop within about ten minutes. Nothing needs setting up.

Updates install themselves within a minute or two of a release going out, **deliberately even mid-club-night**, since a release that ships while a club is running is almost always an urgent fix. A print server waits only while a label is in flight (a printing request still open, a job on the printer chain, a stretch reprint), capped at a minute; a display-only computer waits five seconds. The tray icon shows "Updating to vX… restarting" for those few seconds. The print server comes back up on its own within seconds; nobody needs to touch the laptop.

## 2. No Chrome extension (since 10.0.0)

There is nothing to load in Chrome. Check-in is **awana.kvbchurch.org/checkin**
(§4); the sync service reads TwoTimTwo for the check-in work the extension used to do
(check-ins made on TwoTimTwo's own page, the roster and completed books, the
meeting report's award slips, the Trek and Journey check-out at 7:15 pm and
hand check-outs on TwoTimTwo's Checkout page), and this computer prints the
jobs it leases.

A laptop that had the old extension needs nothing done: on its first 10.x
launch the app turns the folder Chrome loaded it from
(`%APPDATA%\awana-label-printer\chrome-extension`) into a stub that does
nothing and restarts Chrome once. The entry may stay in `chrome://extensions`;
remove it whenever you like.

## 3. Settings: awana.kvbchurch.org/settings

Everything is set on the one settings page. Open it in Chrome **on this
computer** (the tray's *Settings* opens it): the **Printing** section's *At the laptop* card
finds the print server on `localhost:3456` by itself, after you sign in under
Account & app with the church passphrase. Chrome may ask once to let the site
connect to devices on your computer: allow it. Opened on any other device, *At
the laptop* says to open the page on the check-in laptop; everything else on
the page, the rest of Printing included, works from anywhere.

The print dashboard that used to be at `http://localhost:3456` is retired
(owner, 2026-10-11: online only). **With no internet nothing checks in or
prints: the desk uses the paper sheet ([NIGHT-OF.md](NIGHT-OF.md#paper-sheet-when-the-internet-is-down)).**

What Printing holds (the church-wide settings work from any device; *At the laptop* needs this computer):

- **This laptop** — status and warnings, a test label, diagnostics, *Clear
  print queue*, the test tune, **Rehearsal mode** (every label a TEST label,
  nothing recorded, off by itself after 2 hours), and tonight's print failures.
- **This laptop’s sign-in** (At the laptop) — this laptop's own sign-in. If the church passphrase is
  ever changed, sign the laptop in again here with the new one. (A computer
  that has never been signed in is signed in by the app's setup wizard: tray →
  *Set up this computer...*.) Signing in installs the church's display key, so
  names go out sealed; there is no key to generate or paste any more.
- **Printers** — the name tag printer and the backup ("if it fails, print on").
- **Labels** — the footer, the visitor palette, the trophy band and connect
  cards; **Each club’s label** — each club's layout. Church-wide: saved in
  the sync service and followed by the laptop. The musical printer and the
  update beacon stay with this laptop (At the laptop).
- **Pickup list**, **Club night schedule** (the schedule and the late grace; the
  season is the one Season choice under Slides & look). The schedule has one row per slot of the night (club, from,
  activity, place), filled in with the church's 2026-27 schedule until you
  change it; a late check-in's label gets a "Go to:" line naming where the club
  is now.
- **Tonight's prints** — the list with a *Reprint* on each, and **Reprint this
  stretch** (a from and to time; it counts and names them first, and prints only
  when you confirm).
- **Name tags and labels** — **Leader name tag** (remembered leaders, one tap to
  reprint), **One-off name tag** (a lost tag, or a child who isn't checking in
  tonight; welcomed on the screens, never counted) and **Custom label** (one
  line of text, nothing recorded).

One thing is not on the page on purpose: the **check-in URL** is set in the
app's setup wizard (tray → *Set up this computer...*), because it is handed to
the Windows shell.

## 4. Phone check-in

Phones use **awana.kvbchurch.org/checkin** (and `/checkin/ym` for the youth
leaders), on any network: there is no laptop address, no PIN and no Wi-Fi
setting any more. A volunteer signs in with the church passphrase. The check-in
itself is made by the sync service on TwoTimTwo, and a label job is handed to
this laptop, which prints it through the normal (deduplicated) path while it is
signed in to the sync service. **The print server no longer listens on the
network at all**: it answers only the computer it runs on, so the roster,
check-in history and allergy list are not reachable from the church Wi-Fi.

The page's **+** menu prints a **walk-in name tag** (welcomed, never counted),
a **leader tag** (never counted) and a **custom label**, each a sealed job to
the print stations. The Tonight list shows who is checked in, with Undo
check-in. How volunteers use it on club night is in [NIGHT-OF.md](NIGHT-OF.md).
With the laptop off the page still checks children in, but nothing prints until
the laptop is back.

Leaders who have had a tag printed are remembered in the church settings
(names only, no contact details) and offered back as chips on /checkin and the
settings page. Every club list reads the one club table (`shared/clubs.js`).

See [SECURITY.md](../SECURITY.md) for the full trust model, what it
deliberately does not defend against, and the fork checklist.

## 5. Church configuration

`print-server/church-config.json` — check-in URL, club-night windows
(when live broadcasts run), shares club ids, the live channel's name (`pusherChannel`). Baked
KVBC defaults apply if the file is missing. Forks change this one file.

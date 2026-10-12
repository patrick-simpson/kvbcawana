# Setup guide

First-time setup, after the install in [the README](../README.md#install). Problems: [TROUBLESHOOTING.md](../TROUBLESHOOTING.md). The club-night checklist: [NIGHT-OF.md](NIGHT-OF.md).

## 1. First start, and updates

The app opens its setup wizard on first start: the role (print server, display, or both), the church passphrase (which signs this computer in to the sync service), a name for the computer, then the printer (print server) and the screen, monitor and hours (display). The app then lives in the system tray and starts with Windows. Start with Windows is one setting for both roles; the tray, the display's Settings and the wizard all set it.

A laptop upgrading from an 8.x install is a print server with the display off and setup done, so it never sees the wizard or the display. The print server listens only on this computer, so Windows has nothing to ask about the network.

The tray's **Settings (awana.kvbchurch.org/settings)** opens the one settings page, and its status window can print a test label.

**Updates.** The app checks the update feed at awana.kvbchurch.org/updates/printer/ on every launch and every ten minutes after that, so a release reaches a laptop within about ten minutes. Nothing needs setting up.

Updates install themselves within a minute or two of a release going out, **deliberately even mid-club-night**, since a release that ships while a club is running is almost always an urgent fix. A print server waits only while a label is in flight (a printing request still open, a job on the printer chain, a stretch reprint, or a phone check-in the extension has not driven yet), capped at a minute; a display-only computer waits five seconds. The tray icon shows "Updating to vX… restarting" for those few seconds. The print server comes back up on its own within seconds; nobody needs to touch the laptop.

## 2. Chrome extension

`chrome://extensions` → Developer mode → *Load unpacked* → pick
**`%APPDATA%\awana-label-printer\chrome-extension`**. Open the TwoTimTwo
check-in page — the green widget appears. Pin the page as the browser
homepage.

Load *that* folder, not a copy from Downloads: the app rewrites it on
every launch, so an app update also updates the extension — restart
Chrome to pick it up. The tray menu has **Open Chrome extension folder**,
which opens it in Explorer to drag onto the dialog or copy the path from.
Details in `EXTENSION.md`.

## 3. Settings: awana.kvbchurch.org/settings

Everything is set on the one settings page. Open it in Chrome **on this
computer** (the tray's *Settings*, the extension's Settings button and its
options page all open it): its **Laptop** section finds the print server on
`localhost:3456` by itself, after you sign in under Setup with the church
passphrase. Chrome may ask once to let the site connect to devices on your
computer: allow it. Opened on any other device, the Laptop section says to
open the page on the check-in laptop; everything else on the page works from
anywhere.

The print dashboard that used to be at `http://localhost:3456` is retired
(owner, 2026-10-11: online only). **With no internet the desk still prints:
check-in and the extension talk to this computer only. There are no phones and
no settings changes until the internet is back.**

What the Laptop section holds:

- **This laptop** — status and warnings, a test label, diagnostics, *Clear
  print queue*, the test tune, **Rehearsal mode** (every label a TEST label,
  nothing recorded, off by itself after 2 hours), and tonight's print failures.
- **Sync service** — this laptop's own sign-in. If the church passphrase is
  ever changed, sign the laptop in again here with the new one. (A computer
  that has never been signed in is signed in by the app's setup wizard: tray →
  *Set up this computer...*.) Signing in installs the church's display key, so
  names go out sealed; there is no key to generate or paste any more.
- **Printers** — the name tag printer and the backup ("if it fails, print on").
- **Labels** — the footer, the visitor palette, the trophy band, connect cards,
  *Allow driven check-ins from phones* (the kill switch for the phone page's
  check-in, undo and check-out), the musical printer and the update beacon, and
  each club's label layout with a live preview.
- **Pickup list**, **Club night** (the schedule, the late grace, the screen
  season). The schedule has one row per slot of the night (club, from,
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
- **Attendance audit** — compares the season ledger with TwoTimTwo's attendance
  grid; *Apply missing dates* only ever adds nights, and asks first.

Two things are not on the page on purpose. The **check-in URL** is set in the
app's setup wizard (tray → *Set up this computer...*), because it is handed to
the Windows shell. The **extension folder** is the tray's *Open Chrome extension
folder*, because its path contains the Windows user name.

## 4. Phone check-in

Phones use **awana.kvbchurch.org/checkin** (and `/checkin/ym` for the youth
leaders), on any network: there is no laptop address, no PIN and no Wi-Fi
setting any more. A volunteer signs in with the church passphrase. The check-in
itself is made by the sync service on TwoTimTwo, and a label job is handed to
this laptop, which prints it through the normal (deduplicated) path while it is
signed in to the sync service. **The print server no longer listens on the
network at all**: it answers only the computer it runs on, so the roster,
check-in history and allergy list are not reachable from the church Wi-Fi.

Two things print through the laptop straight from the phone, because neither
can double-print: a **visitor label** for someone not on the roster, and a
**Leader tag** for an adult volunteer (never counted as a check-in). The
Tonight tab shows who is being counted; its Remove is local only and does not
undo the check-in on TwoTimTwo. How volunteers use it on club night is in
[NIGHT-OF.md](NIGHT-OF.md). With the laptop off the phone page still checks
children in, but nothing prints until the laptop is back.

Leaders who have had a tag printed are remembered on this server
(`leaders.json` in the data folder — names only, no contact details) and
offered back as chips on the phone page, the settings page and the check-in
widget. Every club dropdown on all three surfaces is served by the server
(`GET /clubs`), so a club can never be missing from one of them — which is
exactly how the widget's walk-in dropdown ended up as the only one without
Journey.

See [SECURITY.md](../SECURITY.md) for the full trust model, what it
deliberately does not defend against, and the fork checklist.

## 5. Church configuration

`print-server/church-config.json` — check-in URL, club-night windows
(when live broadcasts run), shares club ids, the live channel's name (`pusherChannel`). Baked
KVBC defaults apply if the file is missing. Forks change this one file.

## Per-night knobs (widget)

Step Up Night and Awana Store night modes: auto (from the TwoTimTwo
calendar), or forced on/off. Quick Mode makes any roster click a
one-tap check-in.

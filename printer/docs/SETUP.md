# Setup guide

First-time setup, after the install in [the README](../README.md#install). Problems: [TROUBLESHOOTING.md](../TROUBLESHOOTING.md). The club-night checklist: [NIGHT-OF.md](NIGHT-OF.md).

## 1. First start, and updates

The app opens its setup wizard on first start: the role (print server, display, or both), the church passphrase (which signs this computer in to the sync service), a name for the computer, then the printer (print server) and the screen, monitor and hours (display). The app then lives in the system tray and starts with Windows. Start with Windows is one setting for both roles; the tray, the display's Settings and the wizard all set it.

A laptop upgrading from an 8.x install is a print server with the display off and setup done, so it never sees the wizard or the display. Windows may ask about network access the first time; for phone check-in see [section 4](#4-phone-check-in-optional-off-by-default).

The tray's **Settings** can print a test label.

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
and the dashboard's Diagnostics tab has a **Copy folder path** button.
Details in `EXTENSION.md`.

## 3. Dashboard settings (`http://localhost:3456`)

The dashboard is the print server's page on this computer. Retiring it is decided and not yet built ([ROADMAP.md, Online only](../../ROADMAP.md#online-only)); until then, these are set here.

- **Names on the Welcome Screen** — front page, above the fold. Says
  whether children's first names are leaving this PC encrypted, with a
  button straight to the setting. If you run a lobby TV, this is the one
  to green before club night; see `SECURITY.md`.
- **Printer + check-in URL** — set once.
- **Sync service** (Settings tab) — sign this computer in with the church
  passphrase so the lobby welcome display and the countdown app's live
  counts get their frames; names stay sealed under the display key.
- **Realtime privacy → display key** (Settings tab) — *Generate display
  key*, **Copy**, paste the same value into every screen (their Settings
  → Connection → Display key), *then* **Save Settings**. That order means
  a mistyped paste cannot lock every screen out at once. Without a key the
  names go out in the clear.
- **Check-in Features** — phone PIN, late-arrival grace, visitor label
  style, connect cards, and the driven-check-in kill switch.
- **Club Schedule** — one row per slot of the night (club, from, activity,
  place), filled in with the church's 2026-27 schedule until you change it;
  a late check-in's label gets a "Go to:" line naming where the club is now.

## 4. Phone check-in (optional, OFF by default)

**Since 5.3.0 the server listens only on the laptop itself unless you
turn this on.** The roster, check-in history and allergy list are not
reachable from the church network by default. To enable phone check-in
you need BOTH, in Settings → Check-in Features:

1. **Phone check-in PIN** — at least 4 characters. Without a PIN the
   server refuses to expose itself and stays private (it says so at
   startup and in the dashboard's warnings).
2. **"Let phones on this Wi-Fi reach this PC"** — then restart the app,
   because the listening socket is bound at startup.

Then any phone on the same Wi-Fi: `http://<laptop-ip>:3456/phone`.
Find the laptop's IP with `ipconfig` (Wireless LAN → IPv4). If the page
will not load, the firewall rule may be missing; see
[TROUBLESHOOTING.md](../TROUBLESHOOTING.md#phones-cant-reach-the-phone-page).

**Trust model:** every request from the network must carry the PIN —
including the roster fetch — and wrong PINs are rate-limited. But the
PIN rides plain HTTP, so it stops a bystander reading the roster, not
someone who can already sniff the network. Use the church's private
Wi-Fi, not an open guest network. The display key, the sync session and the PIN itself
are never readable over the network, even with a valid PIN.

For a roster kid the phone page never prints directly; it queues the
check-in for the main laptop, which does the real TwoTimTwo check-in and
prints through the normal (deduplicated) path. Two things do print straight
from the phone, because neither can double-print: a **visitor label** for
someone not on the roster, and a **Leader tag** for an adult volunteer
(never counted as a check-in). The Tonight tab shows who this server is
counting; its Remove is local only and does not undo the check-in on
TwoTimTwo. How volunteers use it on club night is in [NIGHT-OF.md](NIGHT-OF.md).

Leaders who have had a tag printed are remembered on this server
(`leaders.json` in the data folder — names only, no contact details) and
offered back as chips on the phone page, the dashboard and the check-in
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

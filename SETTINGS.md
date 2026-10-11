# One settings page: awana.kvbchurch.org/settings

Owner request, 2026-10-11: "move all of the settings to the lobby settings page
... a new page /settings that handles everything. The browser print dashboard
should live there, everything. When people go to the extension's settings, it
should just direct them to this URL. The URL should also handle settings on
the local device like printer selections and diagnostics." A redesign is
welcome. This is the plan; its status is at the end.

## The owner's decisions (2026-10-11)

| Question | Decision |
| --- | --- |
| A screen's own settings (this TV's chime, motion, what plays behind the names) | **Managed from /settings for every screen.** Each screen registers under a name ("Lobby TV", "Gym projector"); /settings lists them and changes any of them from any device, and the screen applies it within seconds. |
| When the old pages give way | **Each part as soon as it is ready** (BARF Night or not). Each switch is tested before it goes live. |

## What exists today (the places settings live)

| Place | Who reads it | What it holds |
| --- | --- | --- |
| Lobby TV, Settings panel (`lobby/src/components/SettingsPanel.jsx`, 8 sections) | that TV | shared settings (sync service, contract v6) and that TV's own (localStorage overrides) |
| Projector menu (`lobby/src/presentation/views/QuickNav.jsx`, touch sheet) | that projector | its display settings, skip weeks |
| Journey kiosk Settings | that kiosk | room settings (sync service) and its own |
| Label printer dashboard (`printer/print-server/public/`, localhost:3456) | the check-in laptop | printer, backup printer, label templates, phone PIN, pickup clubs, schedule, history and reprints, diagnostics (/health) |
| Chrome extension options and popup (`printer/chrome-extension/`) | the laptop's Chrome | mode, printer pick, links to the dashboard |
| Sound room app Settings window (`lobby/desktop/`) | the sound room PC | screen, monitor, shutdown, start with Windows |

## The design

- **One page, one sign-in.** `/settings` is a new entry of the lobby app (a
  third HTML entry beside index.html and countdown.html), signed in with the
  church passphrase like any screen. Same kit, same live apply, Undo and Done.
- **Shared settings** (everything SHARED_SPEC holds, the slides, the template,
  Journey's room settings, cloud check-in, BARF Night, release notes) work
  from any device, through the sync Worker, as today.
- **Screens.** Each lobby TV, projector and Journey kiosk registers with the
  Worker (`POST /v1/screens/hello {id, kind, name}`; the id is made once and
  kept in the screen's own storage) and gets its own settings from it
  (`screen:<id>` in the Worker; a doorbell on the live channel says "yours
  changed"). The screen applies them as its device overrides, so nothing about
  how a TV renders changes. /settings lists the screens (name, kind, last seen,
  online) and opens the SAME Settings panel for any one of them, reading and
  writing that screen's settings in the Worker instead of local storage.
  Actions that act on a screen itself (preview a check-in, reset tonight's
  counter, the pickup demo) are sent to it the same way.
- **The laptop.** Opened on the check-in laptop, /settings also finds the
  print server on `http://localhost:3456` (an https page may call localhost)
  and shows its parts: printer and backup printer, label templates, phone
  PIN, pickup clubs, schedule, history and reprints, and diagnostics (/health).
  Opened anywhere else, those parts say "open this on the check-in laptop".
  The laptop's own dashboard and the extension's options point to /settings;
  the dashboard stays as a plain fallback for a night with no internet.
- **Privacy and safety stay as they are**: the display key and sessions never
  in config, the shared settings through their allowlist, a screen's settings
  through VALIDATORS, the print server's PIN gate for anything off the laptop.

## Phases (each its own change, tested, live when ready)

1. **The page.** `/settings`: sign-in, the shared sections, Cloud check-in,
   BARF Night, release notes; the lobby TV's own Settings keeps working.
2. **Screens.** The Worker's screen registry and per-screen settings; lobby
   TVs register and follow; /settings edits any lobby TV. Then the projector
   and Journey.
3. **The laptop.** The print dashboard's parts in /settings through localhost;
   the extension's options and the dashboard point to /settings.
4. **The sound room app** and the last per-device bits; the old panels shrink
   to a "Settings moved" card linking to /settings.

## Status and hand-off

- 2026-10-11: plan written (this file).
- 2026-10-11: **Phase 1 built.** `lobby/settings.html` is a third Vite entry
  (the signage bundle, flagged by `<meta name="awana-page" content="settings">`;
  `isSettingsPage()` in `configureRelay.js`), served at `/lobby/settings` with
  `/settings` 302ing there (`site/build.mjs`). It is configure mode plus
  `SettingsPageContext`: a `scope="screen"` card is left out unless marked
  `keep` (Sign in, Typed & published slides), the Tools card, the template
  button, the advanced key fields and every button that acts on a screen
  (Preview a check-in, Reset tonight's counter, the board demo) are gone, the
  pill and footer speak of the sign-in, and it opens on Setup until signed in.
  `e2e/settings-page.spec.js` pins it. The lobby TV's own Settings is unchanged.

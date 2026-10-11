# One app: KVBC Awana (v9)

Owner request, 2026-10-11: "combine the sound room executable with the print
software. It should be one software for the whole thing. There should be a
setting on first install that configures the device as a display or print
server. There should be another space in the unified settings page to change
that." Ship it as v9, once the /settings work in progress (SETTINGS.md) is in.

## The owner's decisions (2026-10-11)

| Question | Decision |
| --- | --- |
| Name | **KVBC Awana** (Start menu, tray, installer). |
| Roles | **Print server, display, or both** on one computer: two switches. |
| First run | **A full wizard**: role, the church passphrase, a name for the computer, then the printer (print server) and/or the screen and monitor (display). |
| Display hours | **Club nights, hours per computer in /settings**, default 5:00 to 8:00 pm, the sound room app's club-night rule otherwise (cancelled weeks and summer stay dark). |
| Updates | **Always right away**, club night or not (the sound room's rule). |
| The old sound room app | **Replaced automatically**: its last update installs KVBC Awana as a display with its screen, monitor, hours and shutdown carried over, then removes "Awana Lobby Display". |
| Changing a role in /settings | **From any device, signed in, with a confirm**; turning off a print server is refused while it is printing. |
| Existing installs | A computer with the label printer stays a print server and never shows the display; a computer with the sound room app becomes a display. |

## How (engineering calls)

- **The printer's Electron app is the base** (`printer/electron-app/`): it
  keeps its `appId`, so the check-in laptop upgrades in place from the printer
  feed (`/updates/printer/`) and keeps its data; only its display name becomes
  KVBC Awana. Its print server runs only when the print role is on.
- **The display is the sound room app's main process** (`lobby/desktop/src/`:
  club nights, visibility, monitors, screens, shutdown, configure window)
  moved in as a module that runs only when the display role is on. Its pure
  modules and their tests move with it.
- **Migration.** An upgraded printer install has no role file: it is a print
  server, display off. The sound room app's last release (`lobby` feed)
  downloads and silently installs KVBC Awana with a hand-off file (role
  display, its state.json settings), and KVBC Awana removes the old app on
  first start. Both feeds then point at KVBC Awana's releases.
- **Version 9.0.0** for KVBC Awana (the printer's line continues: 8.x → 9.0.0).
- **/settings**: each computer registers as a device (Phase 2's screen
  registry, kind `computer`) with its roles, hours and name, editable there.

## Status

- 2026-10-11: decisions recorded (this file). Waiting on SETTINGS.md phases 2
  and 3, which are being built now.
- 2026-10-11: **built, not released** (branch `kvbc-awana-v9`): printer
  9.0.0 is KVBC Awana and the sound room app 2.1.0 is its bridge. Not pushed:
  it lands after the /settings work, then the two releases below.

## How it is built (9.0.0)

All in `printer/electron-app/` unless named; `printer/CLAUDE.md` ("KVBC
Awana") has the rules.

- **Identity.** `build.productName` "KVBC Awana", installer
  `KVBC-Awana-Setup.exe`, shortcuts "KVBC Awana". `name`
  (`awana-label-printer`), `appId` and the feed are unchanged, and there is no
  top-level `productName` (Electron would move userData to it):
  `test/roles.test.cjs` pins all of that.
- **Roles** (`src/roles.js`): `roles.json` in userData, `{print, display,
  name, setupDone}`, decided once on the first v9 start and written: a saved
  file, else the hand-off (display), else printer data in userData (print
  server, display off, setup done: the check-in laptop), else new (the
  wizard). `checkRolesChange` is the one check for a change, `applyRoles` in
  main.js the one path; print off restarts the app.
- **The display** (`src/display/`): the sound room app's pure modules and
  their tests (node:test now, `npm run test:app` in printer/, part of
  `npm test`), and `display.js`, its main process as `createDisplay()` with
  start/stop. Hours per computer: `settings.hours` (default 17:00-20:00), in
  the wizard and its Settings window. Its files are in
  `userData\display\`; its profile is still `persist:lobby`.
- **Updates**: every 10 minutes, installed right away for every role; the
  display marks the relaunch quiet (`prepareInstall`).
- **The wizard** (`src/setup-wizard.js`, `static/setup.html`,
  `static/setup-preload.cjs`): role, passphrase, name, printer, screen +
  monitor + hours. The session is `sync-session.bin`, safeStorage-encrypted
  (`src/sync-session.js`); the passphrase is held in memory only until the
  wizard closes, to sign the print server in too.
- **The hand-off**: `%APPDATA%\awana-label-printer\handoff.json` (KVBC
  Awana's own userData). Written by the sound room app 2.1.0
  (`lobby/desktop/src/handoff.js`) once the printer feed is 9.0.0 or later; it
  then runs the installer with `/S --force-run` and quits. KVBC Awana applies
  it (`src/handoff.js`: the display's state.json, a quiet first start, the old
  `persist:lobby` profile copied over, Start with Windows) and keeps it as
  `handoff.done.json`; `src/old-app.js` then runs Awana Lobby Display's
  uninstaller (its uninstall key, GUID `fb4f7b93-33d6-55b2-a7fe-6244a2d4f44d`,
  else `%LOCALAPPDATA%\Programs\awana-lobby-display`) and deletes its login
  item, retrying each start until it is gone.
- **The /settings hook**: `roles.json`, `sync-session.bin` and the
  `roles:get` / `roles:set` IPC handlers in main.js (only for the app's own
  file:// windows; nothing calls them yet). Phase 2's `computer` device
  registers from `deviceSnapshot()` with the session as its bearer and applies
  a role change through `roles:set`'s path.

## Still to do

1. Land after /settings phases 2 and 3; merge the printer version (8.3.0 is
   on another branch: this is 9.0.0 on top of it).
2. The release workflows (not changed here): `printer-release.yml`'s smoke
   test looks for `Club Label Printer.exe` and the process `Club Label
   Printer` (now `KVBC Awana.exe` / `KVBC Awana`; the install folder is
   still `awana-label-printer`), its release title says Club Label Printer,
   and a display smoke test (`--display-smoke-test`) could be added.
   `desktop-release.yml` needs nothing new for 2.1.0.
3. Release order: printer 9.0.0 first (the laptop updates), check it on the
   laptop, then sound room 2.1.0 (it hands over at its next check). The lobby
   feed then stays at 2.1.0 for good: never point `lobby.yml` at a KVBC Awana
   installer (that would install it without a hand-off).
4. The signage's Setup card and `DESKTOP_APP_DOWNLOAD_URL`
   (`/download/lobby-display`) should point new displays at KVBC Awana.
5. Phase 2's `computer` device (see the hook above), the hours and roles in
   /settings, and "refused while printing" (the print server exports no busy
   signal yet; `serverBusy()` is ready for one).
6. On Windows, before the release: the wizard end to end, an 8.x laptop
   upgrade (no wizard, no display, data kept), the sound room hand-off on a
   2.0.0 PC (the profile copy, the uninstall, the login item).

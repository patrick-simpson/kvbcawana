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

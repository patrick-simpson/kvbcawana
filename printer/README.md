# Club Label Printer

**Automatic label printing for TwoTimTwo.com check-in system**

> Not affiliated with, endorsed by, or approved by Awana Clubs International, or by TwoTimTwo.com — a community-built tool that works alongside their systems. (Called "Awana Label Printer" before v5.9.0.)

When a child checks in during club, automatically print a 4" × 2" label to your label printer with zero dialogs or manual steps.

The Windows app is **KVBC Awana** (since 9.0.0): one app for every KVBC Awana computer. A computer runs the print server, the lobby display, or both.

> **More docs:** [SETUP.md](docs/SETUP.md) (first-time setup, the settings page, phone check-in) ·
> [NIGHT-OF.md](docs/NIGHT-OF.md) (print-and-tape checklist for club night) ·
> [TROUBLESHOOTING.md](TROUBLESHOOTING.md) (problems and fixes; "Still stuck?" is at the end) ·
> [CONTRACT.md](CONTRACT.md) (event bus).

## Install

1. **[Download KVBC-Awana-Setup.exe](https://awana.kvbchurch.org/download/kvbc-awana)** (if SmartScreen shows "Windows protected your PC", click **More info → Run anyway**; see [TROUBLESHOOTING.md](TROUBLESHOOTING.md#smartscreen-windows-protected-your-pc))
2. Double-click to install (one-click, per-user, no admin needed)
3. The app launches and opens its setup wizard. Continue with [SETUP.md](docs/SETUP.md).

No PowerShell, no Node.js install, no terminal window.

## What it does on club night

- **Prints automatically** when a kid checks in — on this laptop, another device, or a volunteer's phone (see [SETUP.md](docs/SETUP.md#4-phone-check-in-optional-off-by-default)).
- **Enriched labels**: set in the Awana 2026-27 catalog's fonts (Paytone One, Londrina Solid, Figtree — bundled, so every PC prints the same label) with the club's TwoTimTwo logo or, when that can't be fetched, its official one-colour club mark; handbook group, allergy/birthday/no-photo icons, store-night share balances, Step Up Night, attendance milestones ("10th club night!"), and a "Go to:" line for late arrivals (from the dashboard's group schedule).
- **Broadcasts the party**: the lobby welcome display and the countdown app's live per-club counts are fed from this server's live-channel events (first names only, ever — see CONTRACT.md).
- **Tells you when it's sick**: selector self-tests, an end-to-end "Night Test" canary, visible print failures, and a status card on the settings page (awana.kvbchurch.org/settings → Printing → At the laptop).

### Fallback Behavior

If the server isn't running or can't reach the printer, the extension falls back to a plain label through the browser's normal print dialog. This means:
- Users can still print manually if needed
- Setup failures are graceful, not blocking
- The tool degrades but doesn't break the check-in workflow

## Technical Details

### Architecture

- **KVBC Awana app** (`electron-app/`) - Windows installer, tray app and auto-updater. It runs the print server when the print role is on, and the lobby display when the display role is on.
- **Chrome extension** - runs on TwoTimTwo.com, detects check-ins and drives the print server
- **Node.js print server** - runs on the computer that has the print role, generates PDFs and prints silently. It answers only the computer it runs on: phones use awana.kvbchurch.org/checkin, and every setting is on awana.kvbchurch.org/settings ([SETUP.md](docs/SETUP.md#3-settings-awanakvbchurchorgsettings)).
- **React web UI** (optional) - Simulator and configuration reference

### Dependencies

- Node.js 18+ LTS
- npm packages:
  - `express` - Web server
  - `pdf-to-printer` - Silent printing to Windows printers
  - `puppeteer` - HTML-to-PDF rendering
  - `cors` - Cross-origin requests

Total install size: ~300 MB (Puppeteer/Chromium is large, but one-time download)

### Label Format

- **Size:** 4 inches wide × 2 inches tall
- **Content:** First name (large), Last name, Club logo (if available), KVBC footer
- **Print quality:** 300 DPI

## Limitations

- **Windows only** - the app requires Windows 10+ (a Raspberry Pi print station runs the server under CUPS)
- **Printer must be Windows-compatible** - Uses Windows printer drivers
- **TwoTimTwo.com structure** - If the site's HTML changes, the extension may need updates
- **Online only** - the server is reachable from this computer alone, so settings and phone check-in need the internet; with none, check-in still prints at the desk

## Releases

The installer is built and released by GitHub Actions on Windows. Never create a release tag by hand: dispatch `printer-release.yml` with the version, as [printer/CLAUDE.md](CLAUDE.md) ("Releasing the Windows app") describes. Users download from https://awana.kvbchurch.org/download/kvbc-awana, which serves the newest release named in `site/updates/printer/latest.yml`.

## Credits

Built with:
- [Electron](https://www.electronjs.org/) for the desktop app
- [React](https://react.dev/) for the UI
- [Vite](https://vitejs.dev/) for fast builds
- [Express.js](https://expressjs.com/) for the print server
- [pdf-to-printer](https://github.com/npm2s/pdf-to-printer) for Windows printing

## License

MIT

## Disclaimer

"Awana" and "Awana Clubs" are trademarks of Awana Clubs International, used here only to describe what this tool is for. Use at your own discretion.

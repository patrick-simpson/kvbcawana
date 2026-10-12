# Club Label Printer

**Automatic label printing for TwoTimTwo.com check-in system**

> Not affiliated with, endorsed by, or approved by Awana Clubs International, or by TwoTimTwo.com — a community-built tool that works alongside their systems. (Called "Awana Label Printer" before v5.9.0.)

When a child checks in during club, automatically print a 4" × 2" label to your label printer with zero dialogs or manual steps.

## Quick Start — Download the Installer (Recommended)

**[👉 Download Club-Label-Printer-Setup.exe](https://awana.kvbchurch.org/download/club-label-printer)**

1. Download the `.exe` file (if SmartScreen shows "Windows protected your PC", click **More info → Run anyway**)
2. Double-click to install (one-click, per-user, no admin needed)
3. The app launches and guides you through first-time setup: pick your printer, confirm the check-in URL, print a test label
4. Done — the server runs silently in your system tray, starts with Windows, and **updates itself** from GitHub Releases

No PowerShell, no Node.js install, no terminal window.

> **More docs:** [docs/SETUP.md](docs/SETUP.md) (full setup incl. phone check-in),
> [docs/NIGHT-OF.md](docs/NIGHT-OF.md) (print-and-tape one-pager for club night),
> [TROUBLESHOOTING.md](TROUBLESHOOTING.md), [CONTRACT.md](CONTRACT.md) (event bus).

## What it does on club night

- **Prints automatically** when a kid checks in — on this laptop, another device, or a volunteer's phone (`http://<laptop-ip>:3456/phone`).
- **Enriched labels**: set in the Awana 2026-27 catalog's fonts (Paytone One, Londrina Solid, Figtree — bundled, so every PC prints the same label) with the club's TwoTimTwo logo or, when that can't be fetched, its official one-colour club mark; handbook group, allergy/birthday/no-photo icons, store-night share balances, Step Up Night, attendance milestones ("10th club night!"), and a "Go to:" line for late arrivals (from the dashboard's group schedule).
- **Broadcasts the party**: the lobby welcome display and the countdown app's live per-club counts are fed from this server's live-channel events (first names only, ever — see CONTRACT.md).
- **Tells you when it's sick**: selector self-tests, an end-to-end "Night Test" canary, visible print failures, and a Night Status dashboard card.

### Fallback Behavior

If the server isn't running or can't reach the printer, the extension falls back to a plain label through the browser's normal print dialog. This means:
- Users can still print manually if needed
- Setup failures are graceful, not blocking
- The tool degrades but doesn't break the check-in workflow

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for solutions to common issues:
- Printer not found
- Extension not detected
- Port already in use
- And more...

## Technical Details

### Architecture

- **KVBC Awana app** (`electron-app/`) - Windows installer, tray app and auto-updater that runs the print server
- **Chrome extension** - runs on TwoTimTwo.com, detects check-ins and drives the print server
- **Node.js print server** - Runs on localhost:3456, generates PDFs and prints silently
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
- **Local network only** - Server runs on localhost, no remote access

## Disclaimer

This project is **not affiliated with, endorsed by, or approved by TwoTimTwo.com or Awana Clubs International**. It is a community-built tool that works alongside their systems. "Awana" and "Awana Clubs" are trademarks of Awana Clubs International, used here only to describe what this tool is for. Use at your own discretion.

## Getting Help

1. **Check the troubleshooting guide:** [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
2. **Open browser DevTools (F12)** → Console tab for error messages
3. **Check the PowerShell window** for server startup messages
4. **Verify your printer** - Go to Windows Settings → Printers and make sure it's there

## For Developers — Releasing a New Version

The `.exe` installer is automatically built and released via GitHub Actions. To release:

```bash
# 1. Bump version in electron-app/package.json
#    (e.g., change "version": "1.0.0" to "1.0.1")

git add electron-app/package.json
git commit -m "Bump version to 1.0.1"
git push origin main

# 2. Create and push a version tag
git tag v1.0.1
git push origin v1.0.1
```

GitHub Actions automatically:
- Builds the installer on a Windows server
- Creates a GitHub Release
- Attaches `Club-Label-Printer-Setup.exe` to it

Users download from: **https://awana.kvbchurch.org/download/club-label-printer** (the newest release in `site/updates/printer/latest.yml`)

To test the build without releasing, go to **Actions** → **Build Electron App** → **Run workflow** and select your branch.

## Credits

Built with:
- [Electron](https://www.electronjs.org/) for the desktop app
- [React](https://react.dev/) for the UI
- [Vite](https://vitejs.dev/) for fast builds
- [Express.js](https://expressjs.com/) for the print server
- [pdf-to-printer](https://github.com/npm2s/pdf-to-printer) for Windows printing

## License

MIT

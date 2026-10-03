# KVBC Kids Check-in Extension

This browser extension provides a **\"zero-click\"** auto-printing experience for the KVBC Kids Check-in system. It automatically runs in the background whenever you are on the check-in page and communicates with the local KVBC Print Server.

## Why use the extension?
- **Zero Clicks:** Automatically starts watching for check-ins as soon as the page loads.
- **Survives Reloads:** If the page is refreshed, the extension automatically re-injects itself.
- **Reliable:** Bypasses browser security restrictions by sending print jobs through a background service worker.

## Installation Instructions (Developer Mode)

**Load the folder the app manages, not a copy from Downloads.** The Windows app
keeps one folder up to date on every launch, so loading *that* one is what lets
future app updates refresh the extension for you. A copy unzipped somewhere else
never updates and will quietly drift behind the print server.

1. Find the managed folder. Either:
   - **Tray icon → Open Chrome extension folder**, or
   - the dashboard at `http://localhost:3456` → **Diagnostics** → *Chrome
     extension folder* → **Copy folder path**.

   It is `%APPDATA%\awana-label-printer\chrome-extension` (the folder is
   still named after the app's pre-v5.9.0 name, "Awana Label Printer" —
   `package.json`'s `name` field is intentionally NOT part of the v5.9.0
   rebrand; see changes.md).
2. Open your browser and go to the extensions page:
   - **Edge:** `edge://extensions`
   - **Chrome:** `chrome://extensions`
3. Turn on **Developer Mode**.
4. Click **Load unpacked** and pick the folder from step 1.
5. Ensure the local KVBC Print Server is running.

The KVBC widget will now automatically appear on the check-in page!

> Running from a source checkout instead of the installer? Load
> `chrome-extension/` from the repo. There is no managed folder in that case,
> and the dashboard hides the Diagnostics block rather than pointing you at a
> path that does not exist.

## Keeping the extension up to date

Chrome does **not** auto-update extensions loaded in Developer Mode, and Chrome
only honours a self-hosted `update_url` for Web Store or enterprise-policy
installs. Since 7.4.1 it loads itself anyway, at any hour:

1. The app updates itself (electron-updater) within a minute of the release,
   and its restart restarts the print server.
2. On that launch it rewrites the managed folder with the extension files from
   the new build. This happens whether or not Chrome is open.
3. The app then closes Chrome (every window) and reopens it on the check-in
   page only, which loads the new extension (`electron-app/src/chrome-restart.js`).
4. As a backup, a check-in page that sees the new version on disk asks the extension to
   re-read its folder (`chrome.runtime.reload()`, the same as **Reload** on
   `chrome://extensions`), and refreshes the check-in tab. It waits only for a
   tag still queued to print, a touch check-in being posted, or a volunteer
   tapping the touch screen (at most two minutes). Other tabs are untouched.

If that cannot happen (an extension loaded from some other folder), the widget
still shows *"Extension vX.Y.Z is installed — restart Chrome to load it"*.

The version banner compares the extension's version against the print server's,
so a mismatch is always visible on the check-in page rather than something you
have to remember to check.

## Technical Transparency & Security
- **Local Communication:** This extension communicates only with \http://localhost:3456\. This is a local network address that refers to your own computer. 
- **Purpose:** The communication is used to send label data (Name, Club, Icon) to the **KVBC Print Server** software that you have installed locally.
- **No External Traffic:** No data ever leaves your local network or is sent to any cloud-based services.

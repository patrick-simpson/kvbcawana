# Troubleshooting Guide

Having issues with KVBC Awana's label printing? This guide covers common problems and solutions. Settings are explained in [SETUP.md](docs/SETUP.md); the club-night checklist is [NIGHT-OF.md](docs/NIGHT-OF.md).

## Windows App (.exe) Issues

### SmartScreen "Windows protected your PC"

This is Windows being cautious about a new community-built app — the installer is not signed with a
paid certificate. Click **More info**, then **Run anyway** (the install steps are in the [README](README.md#install)). It only appears on first install.

After that the app updates itself, including mid-club-night (how it does so is in [SETUP.md §1](docs/SETUP.md#1-first-start-and-updates)). If you'd rather it not surprise you, watch the tray icon — it shows "Updating to vX… restarting" for the few seconds before it happens.

### Phones can't open the check-in page

Phones use **awana.kvbchurch.org/checkin** on any network. There is no address to find on the laptop, no PIN and no Wi-Fi setting any more: the print server listens only on the laptop itself (owner, 2026-10-11: online only), so an old bookmark to `http://<laptop-ip>:3456/phone` will not load. Send the phone to awana.kvbchurch.org/checkin instead. If that page itself will not load, the phone has no internet; check it is on the church Wi-Fi or mobile data.

**With no internet at the church** nothing checks in or prints (since 10.0.0 there is no Chrome extension on the laptop): use the paper sheet ([NIGHT-OF.md](docs/NIGHT-OF.md#paper-sheet-when-the-internet-is-down)).

### The old Chrome extension is still listed in Chrome

KVBC Awana 10.0.0 retired the "KVBC Kids Check-in Extension". On its first launch it empties the folder Chrome loaded the extension from (`%APPDATA%\awana-label-printer\chrome-extension`), leaving a stub that does nothing, and restarts Chrome once so the old code stops. The entry may stay in `chrome://extensions`; it is harmless, and you may remove it.

### "Port 3456 is in use" dialog at startup

Another print server is still running (a second copy of the app, or a leftover process).
Click **Stop it and continue**. If it keeps coming back on every boot, find what starts it in
Task Manager's **Startup apps** tab and turn it off.

### "Server failed to start" error box

Labels cannot print in this state — the app shows the error instead of degrading silently.
Send a screenshot of the message to your administrator, or check
`%APPDATA%\awana-label-printer\` for config problems. Reinstalling the latest
release is safe: your roster and settings live in `%APPDATA%\awana-label-printer`, not in the
install folder. (That folder is still named after the app's pre-v5.9.0 name,
"Awana Label Printer": renaming it would orphan the data.)

---

## Phone check-in problems

**Phone can't open the page** — see [Phones can't open the check-in page](#phones-cant-open-the-check-in-page) above.

**A check-in worked but no label came out** — the label prints on the
laptop running KVBC Awana as a print server, signed in with the passphrase.
Check its tray icon is there and the settings page → Printing → At the
laptop has no warning; then reprint from Printing → *Tonight's prints*.

**Phone shows a kid as not checked in when they are (or vice versa)** —
the page re-reads the list on its own, so check-ins made on other devices
(and undos made on TwoTimTwo) appear by themselves. If a phone seems frozen
anyway, its connection likely dropped; it catches up as soon as the service
answers again.

**Asked to sign in** — the phone page signs in with the church passphrase (the
same word every screen types), not a PIN. "That is not the passphrase" means a
typo or an old one; too many wrong tries locks that phone out for a few minutes.

---

## Runtime Issues

### TwoTimTwo changed its pages

The sync service reads TwoTimTwo's pages (the check-in page, the report, the
roster). If TwoTimTwo ships new markup, /checkin may stop loading the list or
check-ins may be refused with a reason. Use the paper sheet
([NIGHT-OF.md](docs/NIGHT-OF.md#paper-sheet-when-the-internet-is-down)) and
report it: the service's readers need an update.

### Labels print but look wrong

**Problem:** Labels appear cut off, text is wrong size, or formatting is broken.

**Checklist:**
1. **Verify label size:** Settings → Printers → Your Printer → Preferences → Paper size should be **4×2 inches**
2. **Check printer driver:** Some printers need specific label-size drivers
3. **Test with a manual print:** Use Windows print dialog to test one label manually
4. **Check for paper jams:** Some printers fail silently

**Solution:** Set the printer's paper size to 4×2 inches in Windows, then print a test label from the settings page (Printing → At the laptop).

---

### "Connection refused" or "Server not reachable"

**Problem:** The settings page or the test button says the print server can't be reached.

**Solution:**
1. Make sure the KVBC Awana app is running (its tray icon); launch it again if not
2. Check that port 3456 isn't blocked:
   ```powershell
   netstat -ano | findstr 3456
   ```
   If something else is using it, close that application

---

### No label prints at all

**Problem:** Child checks in, but nothing happens - no print, no dialog.

**Debug steps:**
1. Is the KVBC Awana tray icon there, with the print role on? Launch it again if not.
2. Is the laptop signed in to the sync service? The settings page → Printing →
   At the laptop → *This laptop's sign-in*.
3. The settings page → Printing → At the laptop shows the printer, its
   warnings and *Print failures tonight*. **CHECK THE PRINTER** means a label
   was sent and its outcome is unknown: look, reprint if it is missing, then
   press *I looked at it*.

---

## General Debugging

### How to check server logs

The app's status window (tray icon → *Print server status...*) and awana.kvbchurch.org/settings → Printing → At the laptop → *Run diagnostics* show what it is doing. Look for:
- `Printer: DYMO LabelWriter 450` → Printer is configured
- `POST /print` → Someone just tried to print
- `Error: ...` → Something went wrong

---

### How to test locally without TwoTimTwo

1. Open the React app: Run `npm run dev` in a terminal
2. You'll see a simulator with fake check-in data
3. Click "Check In" to try the simulator
4. The Test Connection button verifies the server is running

---

## Quick Checklist

Before getting help, verify:
- [ ] Windows 10+ is running
- [ ] Printer is connected and appears in Windows Settings
- [ ] Printer has paper
- [ ] The KVBC Awana app is running (tray icon)
- [ ] No other application is using port 3456
- [ ] The laptop is signed in to the sync service (the settings page → Printing → At the laptop)

## Still Stuck?

If none of these solutions work:

1. **Collect information:**
   - Screenshot of the error message
   - The settings page's Laptop → *Run diagnostics* list
   - Windows printer name (Settings → Printers & scanners)

2. **Check the GitHub issues:** https://github.com/patrick-simpson/kvbcawana/issues
   - Your issue might already be documented

3. **Create a new issue** with the information above

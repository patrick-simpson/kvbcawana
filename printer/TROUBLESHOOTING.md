# Troubleshooting Guide

Having issues with Club Label Printer? This guide covers common problems and solutions. Settings are explained in [SETUP.md](docs/SETUP.md); the club-night checklist is [NIGHT-OF.md](docs/NIGHT-OF.md).

## Windows App (.exe) Issues

### SmartScreen "Windows protected your PC"

This is Windows being cautious about a new community-built app — the installer is not signed with a
paid certificate. Click **More info**, then **Run anyway** (the install steps are in the [README](README.md#install)). It only appears on first install.

After that the app updates itself, including mid-club-night (how it does so is in [SETUP.md §1](docs/SETUP.md#1-first-start-and-updates)). If you'd rather it not surprise you, watch the tray icon — it shows "Updating to vX… restarting" for the few seconds before it happens.

### Phones can't open the check-in page

Phones use **awana.kvbchurch.org/checkin** on any network. There is no address to find on the laptop, no PIN and no Wi-Fi setting any more: the print server listens only on the laptop itself (owner, 2026-10-11: online only), so an old bookmark to `http://<laptop-ip>:3456/phone` will not load. Send the phone to awana.kvbchurch.org/checkin instead. If that page itself will not load, the phone has no internet; check it is on the church Wi-Fi or mobile data.

**With no internet at the church** there are no phones and no settings changes, but the check-in desk still prints: check-in and the extension talk to the laptop only.

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
"Awana Label Printer" — see EXTENSION.md.)

---

## Phone check-in problems

**Phone can't open the page** — see [Phones can't open the check-in page](#phones-cant-open-the-check-in-page) above.

**Phone says "No answer"** — the check-in page must be open on the
main laptop with the extension loaded for the undo and check-out the laptop
drives. Also check awana.kvbchurch.org/settings → Printing → Labels → "Let the
check-in laptop’s Chrome extension check children in on TwoTimTwo directly" is
on (it works from any phone or computer).

**Phone shows a kid as not checked in when they are (or vice versa)** —
since 5.7.0 the phone re-fetches the roster every ~12 seconds, so
check-ins made on other devices (and undos made on TwoTimTwo) appear on
their own. If a phone seems frozen anyway, its connection likely dropped —
the page backs off polling while unreachable and catches up as soon as
the server answers again.

**Asked to sign in** — the phone page signs in with the church passphrase (the
same word every screen types), not a PIN. "That is not the passphrase" means a
typo or an old one; too many wrong tries locks that phone out for a few minutes.

---

## Runtime Issues

### Red banner: the check-in page layout has changed

The extension's selector self-test failed — TwoTimTwo shipped new
page markup and automatic detection may be blind. Check kids in
normally; print labels via widget search or Walk-in Guest. Then check
awana.kvbchurch.org/settings → Printing → At the laptop → *Run diagnostics* for which selector broke, and file
an issue / update the extension.

### Labels print but look wrong

**Problem:** Labels appear cut off, text is wrong size, or formatting is broken.

**Checklist:**
1. **Verify label size:** Settings → Printers → Your Printer → Preferences → Paper size should be **4×2 inches**
2. **Check printer driver:** Some printers need specific label-size drivers
3. **Test with a manual print:** Use Windows print dialog to test one label manually
4. **Check for paper jams:** Some printers fail silently

**Solution:** Adjust label dimensions in the extension configuration (if available).

---

### Print dialog appears instead of silent print

**Problem:** Despite running the server, a print dialog still shows.

**Causes:**
1. The server might not be running
2. Printer configuration might be wrong
3. Browser might be blocking the action

**Solution:**
1. Check that the KVBC Awana app is running (its tray icon) and that
   `http://localhost:3456/health` answers
2. If not running, launch **KVBC Awana** again; an error box names the problem
3. Verify the printer name in the app's Settings
4. Try clicking the Test Connection button in the simulator (if you have it open)

---

### "Connection refused" or "Server not reachable"

**Problem:** The extension or the test button says the server can't be reached.

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
1. Open your browser's **Developer Tools (F12)**
2. Go to the **Console** tab
3. Do a check-in and look for error messages
4. Common messages:
   - `"Fetch failed"` → Server not running
   - `"Print error"` → Printer issue
   - `"POST failed"` → Network issue

**Solutions:**
- **If server not running:** Launch the KVBC Awana app again
- **If printer error:** Check printer is online and default printer is set correctly
- **If network issue:** Make sure you're accessing TwoTimTwo from localhost or same machine

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
- [ ] Running on the TwoTimTwo.com check-in page (not a different page)

## Still Stuck?

If none of these solutions work:

1. **Collect information:**
   - Screenshot of the error message
   - The settings page's Laptop → *Run diagnostics* list
   - Browser console errors (F12 → Console tab)
   - Windows printer name (Settings → Printers & scanners)

2. **Check the GitHub issues:** https://github.com/patrick-simpson/kvbcawana/issues
   - Your issue might already be documented

3. **Create a new issue** with the information above

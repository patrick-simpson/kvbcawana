# Troubleshooting Guide

Having issues with Club Label Printer? This guide covers common problems and solutions. Settings are explained in [SETUP.md](docs/SETUP.md); the club-night checklist is [NIGHT-OF.md](docs/NIGHT-OF.md).

## Windows App (.exe) Issues

### SmartScreen "Windows protected your PC"

This is Windows being cautious about a new community-built app — the installer is not signed with a
paid certificate. Click **More info**, then **Run anyway** (the install steps are in the [README](README.md#install)). It only appears on first install.

After that the app updates itself, including mid-club-night (how it does so is in [SETUP.md §1](docs/SETUP.md#1-first-start-and-updates)). If you'd rather it not surprise you, watch the tray icon — it shows "Updating to vX… restarting" for the few seconds before it happens.

### Phones can't reach the phone page

Phone check-in is off unless you turn it on, and the server listens only on the laptop until you do. The settings are in [SETUP.md §4](docs/SETUP.md#4-phone-check-in-optional-off-by-default). Check them first:

1. **Settings → Check-in Features:** a **Phone check-in PIN** is set (at least 4 characters), and **"Let phones on this Wi-Fi reach this PC"** is checked. Then **restart the app** — the listening socket is bound at startup. A missing PIN makes the checkbox do nothing: the server refuses to expose the roster without one, says so at startup, and shows a warning on the dashboard.
2. **Firewall:** the first time the server starts, Windows shows an **Allow access** prompt — click **Allow** (make sure "Private networks" is checked). Missed it? Open the app's **Settings** (tray icon → Settings) and click **Enable Phone Check-in (firewall)**, then approve the administrator prompt.
3. **Wi-Fi:** both devices must be on the same network. Use the laptop's IPv4 from `ipconfig` (Wireless LAN), e.g. `http://192.168.1.20:3456/phone`.

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

**Phone can't open the page** — see [Phones can't reach the phone page](#phones-cant-reach-the-phone-page) above.

**Phone says "No answer"** — the check-in page must be open on the
main laptop with the extension loaded; that's what performs the real
check-in. Also check Settings → "Allow driven check-ins" is on.

**Phone shows a kid as not checked in when they are (or vice versa)** —
since 5.7.0 the phone re-fetches the roster every ~12 seconds, so
check-ins made on other devices (and undos made on TwoTimTwo) appear on
their own. If a phone seems frozen anyway, its Wi-Fi likely dropped —
the page backs off polling while unreachable and catches up as soon as
the server answers again.

**Wrong PIN** — the PIN is set on the dashboard (Settings → Check-in
Features), and must be at least 4 characters. A blank PIN no longer means
"no PIN required": it means phones cannot connect at all, because the server
will not expose the roster without one.

**"Too many wrong PINs"** — after 8 *different* wrong attempts that phone is
locked out for a minute; the page shows a live countdown and lets you back in
when it hits zero. Retyping the same wrong PIN (or mashing the button while it
sends) no longer digs the hole deeper — only distinct guesses count. (The
lockout itself is deliberate: without it a 4-digit PIN could be guessed in
seconds.)

---

## Runtime Issues

### Red banner: the check-in page layout has changed

The extension's selector self-test failed — TwoTimTwo shipped new
page markup and automatic detection may be blind. Check kids in
normally; print labels via widget search or Walk-in Guest. Then check
the dashboard's Night Status card for which selector broke, and file
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

The print server's own status window (tray icon → the print server's status) and the dashboard's Diagnostics tab show what it is doing. Look for:
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
   - The dashboard's Diagnostics tab
   - Browser console errors (F12 → Console tab)
   - Windows printer name (Settings → Printers & scanners)

2. **Check the GitHub issues:** https://github.com/patrick-simpson/kvbcawana/issues
   - Your issue might already be documented

3. **Create a new issue** with the information above

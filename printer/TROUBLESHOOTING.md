# Troubleshooting Guide

Having issues with Club Label Printer? This guide covers common problems and solutions.

## Windows App (.exe) Issues

### "Windows protected your PC" (SmartScreen) when running the installer

This is Windows being cautious about a new community-built app — the installer is not signed with a
paid certificate. Click **More info**, then **Run anyway**. It only appears on first install;
after that the app updates itself silently — usually within a minute or two of a release going out,
**including mid-club-night**. That is deliberate: a release that ships while a club is running is
almost always an urgent fix, so the app downloads it, gives any in-flight label print a few seconds
to finish, and restarts itself. The print server comes back up on its own within seconds; nobody
needs to touch the laptop. If you'd rather it not surprise you, watch the tray icon — it shows
"Updating to vX… restarting" for the few seconds before it happens.

Two ways an update reaches the app, in order of speed:

1. **Push** — the release workflow pings the same Pusher channel the lobby display already uses,
   so most laptops start downloading within a minute or two of a release. This needs the
   `PUSHER_APP_ID`/`PUSHER_KEY`/`PUSHER_SECRET`/`PUSHER_CLUSTER` repo secrets (and optionally
   `PUSHER_CHANNEL`) set on the repo — see `docs/SETUP.md`.
2. **Poll** — every launch, and every 24 hours after that, regardless of push. This is what covers
   a laptop that was off or offline when the push fired, so **nothing above is required** for
   updates to work at all; push just makes them faster.

### Phones can't reach phone check-in (`http://<laptop-ip>:3456/phone`)

**Check this first (changed in 5.3.0):** the server now listens only on the
laptop itself unless you explicitly allow network access, so that the roster and
allergy list aren't readable by everything on the church Wi-Fi. Open **Settings →
Check-in Features** and confirm both:

1. A **Phone check-in PIN** is set (at least 4 characters), and
2. **"Let phones on this Wi-Fi reach this PC"** is checked.

Then **restart the app** — the listening socket is bound at startup, so the
change does not apply until it restarts.

If the PIN is missing, the checkbox has no effect: the server refuses to expose
the roster without one, logs that at startup, and shows a warning on the
dashboard. Set a PIN and restart.

Once that is right, it may still be the firewall:

1. The first time the server starts, Windows shows an **Allow access** prompt — click **Allow**.
   (Make sure "Private networks" is checked.)
2. Missed the prompt? Open the app's **Settings** (tray icon → Settings) and click
   **Enable Phone Check-in (firewall)** — approve the administrator prompt.
3. Both devices must be on the same Wi-Fi network.

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

## Runtime Issues

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

---

## Quick Checklist

Before getting help, verify:
- [ ] Windows 10+ is running
- [ ] Printer is connected and appears in Windows Settings
- [ ] Printer has paper
- [ ] The KVBC Awana app is running (tray icon)
- [ ] No other application is using port 3456
- [ ] Running on the TwoTimTwo.com check-in page (not a different page)

## Phone check-in problems

**Phone can't open the page** — first check Settings → Check-in Features has a
**PIN set** and **"Let phones on this Wi-Fi reach this PC"** checked, then
restart the app. Since 5.3.0 network access is off by default, so this is the
most likely cause. Next: same Wi-Fi as the laptop? Use the laptop's IPv4 from
`ipconfig`, e.g. `http://192.168.1.20:3456/phone`. If it still won't load, the
firewall rule is missing — use **Enable Phone Check-in (firewall)** in the app's
Settings and approve the administrator prompt.

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

## Red banner: "the check-in page layout has changed"

The extension's selector self-test failed — TwoTimTwo shipped new
page markup and automatic detection may be blind. Check kids in
normally; print labels via widget search or Walk-in Guest. Then check
the dashboard's Night Status card for which selector broke, and file
an issue / update the extension.

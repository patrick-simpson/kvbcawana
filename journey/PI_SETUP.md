# Setting Up the Journey Display on a Raspberry Pi

This guide is simple enough for anyone to follow. We'll get the Pi showing the Journey Display on a screen.

## What You Need

- Raspberry Pi (any version, we use a Pi Zero)
- Power cord for the Pi
- HDMI cable (to connect to a screen/TV)
- Screen or TV to display on
- Internet connection (WiFi or ethernet cable)
- Keyboard and mouse (only needed during setup)

## Step 1: Get the Pi Ready (5 minutes)

1. Plug the power cord into the Pi
2. Wait for it to boot up (about 1 minute)
3. Plug in the HDMI cable to both the Pi and your screen
4. You should see the desktop appear on your screen

## Step 2: Connect to Internet (5 minutes)

**If using WiFi:**
1. Look in the top right corner of the screen
2. Click the WiFi icon
3. Select your WiFi network from the list
4. Type your WiFi password
5. Click "OK"

**If using Ethernet:**
- Just plug in an ethernet cable to the Pi (no settings needed)

## Step 3: Open the Journey Display (2 minutes)

1. Open the web browser (Chromium or Firefox)
2. In the address bar at the top, type: `https://awana.kvbchurch.org/journey/`
3. Press Enter
4. The Journey Display should now appear on your screen

## Step 4: Make It Start Automatically (10 minutes)

We want the Pi to show the Journey Display every time it starts up.

### 4a. Open Settings

1. Click the Raspberry Pi menu (top left corner)
2. Go to **Preferences** → **Raspberry Pi Configuration**
3. Click the **Display** tab
4. Find "HDMI Safe Mode" and turn it **ON**
5. Click **OK** and **Reboot** when asked

### 4b. Start the Browser on Boot, and Keep It Running

The browser is started by a small service that also **restarts it whenever it
crashes or closes**. Before this, a crashed browser (an "Aw, Snap" page, or the
Pi running out of memory) meant a dark screen until someone brought a
keyboard; now it comes back on its own within a few seconds.

1. Open a terminal:
   - Click Raspberry Pi menu → Accessories → Terminal
2. Download the two files from the website's repository and install them
   (paste these lines exactly, one block at a time, pressing Enter after each):
   ```
   curl -fsSL https://raw.githubusercontent.com/patrick-simpson/kvbcawana/main/journey/pi/journey-kiosk.sh -o ~/journey-kiosk.sh
   chmod +x ~/journey-kiosk.sh
   mkdir -p ~/.config/systemd/user
   curl -fsSL https://raw.githubusercontent.com/patrick-simpson/kvbcawana/main/journey/pi/journey-kiosk.service -o ~/.config/systemd/user/journey-kiosk.service
   systemctl --user daemon-reload
   systemctl --user enable --now journey-kiosk
   sudo loginctl enable-linger "$USER"
   ```
   The Journey Display should open full screen within a few seconds.
3. If you had set up the older autostart entry from an earlier version of this
   guide, remove it so two browsers do not start:
   ```
   rm -f ~/.config/autostart/journey.desktop
   ```

> If step 2 says it cannot find `chromium-browser` or `chromium`, your Pi's
> browser has another name: open a terminal and run
> `which chromium-browser || which chromium`. The script looks for both.

### 4c. Reboot Once a Night, and Let the Pi Watch Itself

Two safety nets for a screen that runs for weeks:

1. **A nightly reboot** at 3:30 AM, when nothing is on screen, so a slow leak
   can never build up for a month. In the terminal:
   ```
   (crontab -l 2>/dev/null; echo '30 3 * * * /sbin/shutdown -r now') | sudo crontab -
   ```
2. **The hardware watchdog**, which reboots the Pi if it ever locks up
   completely (the browser service cannot help with that):
   ```
   sudo apt-get install -y watchdog
   echo 'dtparam=watchdog=on' | sudo tee -a /boot/firmware/config.txt
   sudo sed -i 's/^#\?watchdog-device.*/watchdog-device = \/dev\/watchdog/; s/^#\?max-load-1 .*/max-load-1 = 24/' /etc/watchdog.conf
   sudo systemctl enable --now watchdog
   ```
   (On an older Pi OS the file is `/boot/config.txt`.)

### 4d. Disable Screen Blanking (don't skip this)

Without this, the Pi can go to sleep after a few idle minutes and the
kiosk will show a blank/dark screen even though it's working fine.

1. Raspberry Pi menu → Preferences → Raspberry Pi Configuration → **Display** tab
2. Find **"Screen Blanking"** and set it to **Disable**
3. Click **OK**

### 4e. Test It

1. Reboot the Pi: Click Raspberry Pi menu → Shutdown → Reboot
2. Wait 1-2 minutes
3. The Journey Display should appear automatically on the screen

## Step 5: Adjust the Schedule (Optional)

The Journey Display shows the Awana Check-in Display most of the day, then switches to the Journey video from **6:30 PM to 7:15 PM**.

**Important:** these times live in the **website's own code on GitHub**,
not in a file on the Pi. The Pi always loads the live site at
`https://awana.kvbchurch.org/journey/` — it does not read
a local copy, so editing a file on the Pi itself (even if one happens
to exist there) won't change what the kiosk shows. To change the times
for real:

1. On any computer, go to
   https://github.com/patrick-simpson/kvbcawana/blob/main/journey/public/src/schedule.js
2. Click the pencil (✏️) icon to edit it directly in the browser
3. Find these two lines near the top:
   ```javascript
   const JOURNEY_START_MINUTES = 18 * 60 + 30; // 6:30 PM
   const JOURNEY_END_MINUTES = 19 * 60 + 15;   // 7:15 PM
   ```
4. Change the times to what you want (in 24-hour format)
5. Click **"Commit changes..."** then **"Commit changes"** to save to `main`
6. Wait about a minute for the site to redeploy (check the repository's
   **Actions** tab for a green checkmark)
7. Leave the Pi alone. It checks for a new version every few minutes and
   reloads itself once nothing is on screen (never in the middle of a
   lesson), so the change arrives on its own, usually within about five
   minutes. If you want it right now, refresh the browser with
   **Ctrl + Shift + R** (a plain F5 can keep using cached files)

## Troubleshooting

**The screen is blank or black:**
- Check that the HDMI cable is plugged in firmly on both ends
- Make sure the Pi is plugged in and powered on
- Wait another minute for it to fully boot

**No internet connection:**
- Make sure WiFi is connected (look for the WiFi icon in the top right)
- If using ethernet, make sure the cable is plugged in
- Restart the Pi

**The browser doesn't open automatically:**
- Check that you followed Step 4b exactly
- Make sure there are no typos in the command
- Restart the Pi again

**The lesson starts at the wrong time (or never starts):**
- Check the Pi's clock first. The 6:30 switch is a comparison against the
  Pi's own system time, and the Pi has no battery-backed clock, so after a
  power cut it comes up at whatever time it last knew until it can reach a
  time server.
- Fix: get the Pi back on the internet and give it a minute
  (`timedatectl status` should say "System clock synchronized: yes";
  `sudo timedatectl set-ntp true` if it doesn't).
- Check the **time zone** as well, which is a separate setting and a
  separate way to switch an hour out (`timedatectl` shows it; set it in
  Raspberry Pi Configuration or with `sudo raspi-config`).

**The Journey video doesn't show:**
- Make sure the time and time zone are set correctly on the Pi (check the
  clock in the top right, and see the note above)
- The video only appears between 6:30 PM and 7:15 PM
- Check that you have an internet connection
- Seeing the Journey logo on a plain purple screen, with no lesson name
  and no buttons (not a black/blank screen), is normal — it means the
  week's lesson hasn't resolved yet or
  couldn't load, and the display intentionally shows a placeholder
  instead of a broken video

**A change was made on GitHub but the Pi still acts the old way:**
- Give it a few minutes. The kiosk checks for a new version every few
  minutes and reloads itself when nothing is on screen, so a change
  normally arrives without anyone touching the Pi.
- It deliberately will not reload while a lesson, the teaching slides, a
  preview or the Settings panel is up, so a change made during club
  arrives after club.
- To force it now: the Pi's browser caches the site's files for up to 10
  minutes, and a normal refresh (or even a reboot) can keep using the
  cached copy during that window. Wait 10 minutes and refresh again, or
  press **Ctrl + Shift + R** for a hard refresh that skips the cache.

**I edited the schedule file on the Pi but nothing changed:**
- The schedule lives in the website's code on GitHub, not on the Pi —
  see Step 5 above for the real steps

**The screen shows a GitHub "404 / File not found" page:**

The Pi is loading the wrong URL. The **only** correct address is the
bare root:

```
https://awana.kvbchurch.org/journey/
```

Do **not** append `/public/index.html` or `/pages/index.html`. Only the
contents of `public/` are deployed, and they're served *at the root* —
so `public/` is not part of the live URL even though it is part of the
repo.

To find and fix it over SSH, check **every** place the URL can hide —
having two autostart entries with two different wrong URLs is exactly
how this last went wrong:

```bash
# What is the browser actually on right now?
ps -eo args | grep -i '[c]hromi' | tr ' ' '\n' | grep -i '^http'

# The kiosk service (step 4b) takes its URL from here...
grep -n JOURNEY_URL ~/.config/systemd/user/journey-kiosk.service
# ...and any leftover autostart file from an older setup could launch a second browser
grep -rniI 'chromi' ~/.config/autostart/ ~/.config/labwc/ \
  ~/.config/lxsession/ ~/.config/wayfire.ini /etc/xdg/lxsession/ 2>/dev/null
```

Correct the URL in the service file (then `systemctl --user daemon-reload
&& systemctl --user restart journey-kiosk`), delete any autostart entry
you find, then `sudo reboot`.

**The browser crashed or closed and the screen is dark:**
- The kiosk service restarts it within about five seconds. If the screen
  stays dark, over SSH run `systemctl --user status journey-kiosk` and
  `journalctl --user -u journey-kiosk -n 50`; `systemctl --user restart
  journey-kiosk` brings it back by hand.

Note that a kiosk which fixes *itself* after a while is still broken —
see "The kiosk's address" in `CLAUDE.md` for why a wrong Pi URL once
appeared to work intermittently.

## That's It!

Your Journey Display is now set up. The Pi will automatically start and show the display whenever you power it on.

**Need help?** Ask someone with access to the kvbcawana repository on GitHub to check its issues, or contact the setup team.

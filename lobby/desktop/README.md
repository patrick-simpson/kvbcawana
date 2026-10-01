# Awana Lobby Display (sound room PC)

A small Windows app that puts the **lobby check-in signage** full screen on
the lobby TV on club nights, from **5:00 pm to 8:00 pm**, and takes it down
again. It loads the live signage site, so every website update reaches the
booth on its own, and it updates itself from this repo's GitHub Releases.

## Install (once)

1. Download **Awana-Lobby-Display-Setup.exe** from
   <https://awana.kvbchurch.org/download/lobby-display>.
2. Run it. Windows may say "Windows protected your PC" (the app is not code
   signed): click **More info**, then **Run anyway**. It installs for the
   signed-in user, with no admin prompt, and starts.
3. **Pick the lobby TV.** With more than one monitor connected, a numbered
   orange card appears on every screen: click **Show the lobby on this
   screen** on the TV. It remembers that monitor from then on.
4. **Set up the page** the way you would on any display: choose **Set up on
   this screen** in the tray, open the gear (bottom left) and enter the
   church's display login, then choose **Back to the lobby TV**. It is saved
   inside the app (not in Chrome) and survives restarts.

It starts with Windows from then on, and waits in the system tray (the orange
Awana icon by the clock).

## Every club night

Nothing to do. Switch the PC on and sign in; at 5:00 pm the signage appears
full screen on the TV and at exactly 8:00 pm it closes. If the PC is switched
on after 5:00, it appears straight away.

**Which nights?** The same nights the signage itself counts: the church's
calendar feed, less any break week the shared schedule marks as no club, plus
any special meeting the shared schedule adds. After the calendar's last club
night the season is over and it stays dark all summer (use **Show now** for a
summer event). With no calendar at all it falls back to every Wednesday.

**The TV is off or unplugged?** It opens in a normal window on the main
screen instead (so someone notices) and moves to the TV the moment Windows
sees it again.

## The tray menu

| Item | What it does |
| --- | --- |
| Show now (for 3 hours) | Shows it on the TV now, on any day. It hides itself three hours later. |
| Hide until the next club night | Takes it down; the schedule brings it back next club night. (Closing the window does the same.) |
| Resume schedule | Drops a Show now or a Hide and goes back to the clock. |
| Set up on this screen (in a window) | Shows the signage in a normal window on this monitor, for the display login, uploads and exports. "Back to the lobby TV" returns it. |
| Choose the lobby TV... | Shows the numbered cards again to pick a different monitor. |
| Reload the page | Reloads the signage. |
| Start with Windows | On by default. |
| Check for updates / Restart to update now | Updates install by themselves while nothing is on screen; this does it now. |
| Open log file | For troubleshooting. |

Opening the app from the Start menu or desktop icon while it is running is
the same as **Show now**.

## Notes

- Video slides are always silent (the signage mutes them on every screen). The
  one sound it can make is the check-in chime, off unless turned on in the
  page's Settings; it plays through the PC's default output, which in a sound
  booth may be the room's mix.
- Exports from Settings or the slide editor save straight to Downloads.
- The mouse pointer hides itself over the TV after a few seconds still.
- The PC's display is kept awake while the signage is up.
- If the internet drops, the page keeps running from its offline copy; if it
  has never loaded at all, a "Connecting" screen retries every 30 seconds.

## For developers

`main.js` wires Electron to three pure modules in `src/` (`clubNight.js`,
`visibility.js`, `displays.js`), which hold every rule and have unit tests
(`npm test`, run from this folder). `npm start` runs it unpackaged; these
environment variables work only unpackaged:

- `AWANA_LOBBY_SITE=http://127.0.0.1:4941/` loads a local preview instead of
  the live site;
- `AWANA_LOBBY_NOW=2026-09-30T17:00:00-04:00` starts the clock at that time;
- `AWANA_LOBBY_USERDATA=/tmp/x` uses a scratch profile.

Releases: see CLAUDE.md, "The sound room desktop app".

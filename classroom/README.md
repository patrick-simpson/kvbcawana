# Downstairs classroom screen

The TV in the downstairs classroom, on club nights:

| Time | On the screen |
|---|---|
| 6:30 pm | The Cubbies card, with how many Cubbies are checked in |
| 6:58 pm | Black, while the clubs pass at the door |
| 7:02 pm | Sparks "Large Group Time", with how many Sparks are checked in |
| 7:28 pm | Black again |
| 7:32 pm | The lobby screen, Sparks only (pickup list, welcomes, count) |
| 8:00 pm | The computer shuts down |

The black gaps are 2 minutes either side of each change; that one number lives in `shared/transitionGap.js` for every screen.

While a card is up, a Cubbies (or Sparks) child who checks in gets a welcome on the screen and a ding. During a black gap the clubs on either side are welcomed (each on its own card, on the black).

## The black board (writing on the SMART Board)

Lift a pen from the SMART Board's tray while the Cubbies card, Sparks Large Group Time or the Sparks lobby is up, and the screen turns pure black to write on. Only the club's checked-in count (top right) and the check-in welcomes stay on it. It stays black, writing and all, until the next scheduled screen (the 6:58 or 7:28 black gap, or 8:00). Putting the pen back changes nothing.

- **Lifted by accident?** Tap **Show the card again** (bottom left). It is there for the first minute.
- **Backups:** the small pen button in the bottom-left corner of the cards does the same, and so does a pen touching the board.
- **White writing:** in SMART Settings (the SMART icon by the clock) → **Pen and Button Settings**, set the **black** pen to write **white**, so it shows on the black board.
- Once a night, someone small may drop by to admire the writing.

### First test at the board (about 5 minutes, any day)

1. On the classroom PC, right-click the KVBC Awana icon by the clock and choose **Show now (for 3 hours)**. On a day without club the screen just stays black; that is fine for this test.
2. Lift the black pen and write something: the SMART Ink toolbar should come up, and the writing should be white.
3. Put the pen back. Right-click the KVBC Awana icon → **Open the display log**. Near the bottom, lines starting `pen watch:` should say `"lifted":true` for the moment you lifted the pen. If they don't, send the owner those lines (they name SMART Ink's windows, nothing else).
4. On the next club night, between 6:30 and 6:58, lift a pen once to see the Cubbies card go black, then tap **Show the card again**.

Address: https://awana.kvbchurch.org/classroom/ (the KVBC Awana app opens it; you never type it).

## Setting up the PC

1. Install KVBC Awana from awana.kvbchurch.org and run its setup: choose **Display**, sign in with the church passphrase, and pick the screen **Downstairs classroom**. That sets the hours to 6:30 to 8:00 pm and turns on "Shut down after club" at 8:00 pm (Settings in the tray to check). Leave **Start with Windows** on.
2. Turn off sleep: Settings → System → Power → Screen and sleep → **Never** when plugged in.
3. Make the PC turn itself on every Wednesday before 6:30 pm (it shuts itself down at 8:00). Pick ONE:
   - **In the BIOS/UEFI (most reliable, works from fully off):** restart, press the setup key (often Del, F2 or F10), find **Power → Wake on RTC / RTC Alarm / Resume by Alarm**, turn it on, set **Wednesday at 6:15 pm** if the board lets you pick a day. Save and exit. If it only offers "every day", the PC will also wake on other evenings and stay on (the app's 8:00 pm shutdown runs on club nights only), so shut it down by hand those days or prefer the Task Scheduler way. (Some boards call it "Auto Power On".)
   - **Windows Task Scheduler (wakes from sleep or hibernate, not from shut down):** in that case set the 8:00 pm action to sleep instead of shut down. Task Scheduler → Create Task → Triggers: Weekly, Wednesday, 6:15 pm → Conditions: tick **Wake the computer to run this task** → Actions: Start a program `cmd.exe` with `/c exit`. Also Control Panel → Power Options → Change plan settings → Change advanced power settings → Sleep → **Allow wake timers: Enable**.
4. Test it once on a Wednesday afternoon: shut down, wait for the wake time, check the app opens the screen at 6:30.

## For developers

- Plain static page (`public/`), no framework, no bundler. Rules in `public/src/logic.js`, the page in `public/src/app.js`, look in `public/src/style.css`.
- `npm test` (node:test; the page tests need Chromium: `PLAYWRIGHT_CHROMIUM`, else `/opt/pw-browsers/chromium`, skipped without it). `npm test` makes the brand kit and `clubNight.js` copies first (`node ../scripts/family-assets.mjs classroom`); they are gitignored.
- Preview one moment: `?preview=cubbies|honey|bear|sparks|welcome-cubbies|welcome-sparks|board-cubbies|board-sparks|board-lobby|board-welcome` (`&count=N`); run the clock from a time: `?now=2026-10-14T22:40:00Z`.
- Rules for changing it: the root `CLAUDE.md`, section "App: classroom/"; decisions in `docs/DECISIONS.md`.

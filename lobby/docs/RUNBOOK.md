# Club-night operations runbook

The five-minutes-before-club guide for whoever is standing at the
screen — no coding required. The [README](../README.md) covers setup
from scratch; this covers *running* the two displays and getting out of
trouble fast.

## The two screens

| Screen | URL | Lives where |
| --- | --- | --- |
| **Check-in display** (welcome banners) | `…/index.html` (the site root) | Lobby TV, near the check-in table |
| **Presentation tool** (countdown, pledges, game timers) | `…/countdown.html` | Projector in the main room |

Both are just web pages: any stick/PC with Chrome or Edge, opened
fullscreen, is a working display. Both keep the screen awake on their
own (Screen Wake Lock) and both survive network blips — the service
worker keeps art, slides, and the schedule cached on the device.

---

## Check-in display (lobby TV)

### Pre-club check (5:45 PM)

1. Screen is on, page is fullscreen (double-click anywhere toggles it).
2. Hover the mouse — a gear appears bottom-left. If the header of the
   Settings panel (Ctrl+Shift+S) says **Connected**, you're done.
3. Fire a test: Settings → **Preview a check-in**, or ask the check-in
   table to use the print server's "Test Welcome Screen" button
   (end-to-end proof).

### Operator controls

| Shortcut | What it does |
| --- | --- |
| Ctrl+Shift+S | Settings panel (connection, background, banners, calendar) |
| Ctrl+Shift+E | Typed-slides editor |
| Ctrl+Shift+D | Debug panel — simulate check-ins, rushes, birthdays |
| Ctrl+Shift+X | **Panic mode** — strips to the reliable core, banners keep working |
| Double-click | Fullscreen |

### "The screen is wrong at 5:55 PM" — decision tree

- **Background looks broken / weird slide junk** → Ctrl+Shift+X
  (panic mode). Kids still get their banners; sort the background out
  after club. Ctrl+Shift+X again to restore.
- **"Signal: disconnected" in the corner** → the display lost Pusher.
  It retries on its own (the sticker shows the retry countdown) and
  the page self-reloads after a long outage. Meanwhile check-ins are
  NOT lost: on reconnect, the print server's recap replays anyone
  missed in the last ~20 minutes with quiet banners.
- **"Signal: not set up"** → no Pusher key on this device. Settings →
  Connection → paste the App Key + Cluster (from the same Pusher app
  the print server uses).
- **"⚠ N" printer-problem count on the Signal sticker** → labels are
  failing at the door. That's a print-server issue — check its
  dashboard; the display is just the messenger.
- **Names not appearing but the Pusher Debug Console shows events** →
  channel/event mismatch (`awana-channel` / `checkin`), or the wrong
  Pusher app's key on one side.
- **Frozen / black / anything else inexplicable** → reload the page
  (F5). Tonight's tally and seen-events survive a reload; the recap
  buffer refills anyone missed. Still wrong → reboot the stick.

### Good-to-know behaviors (not bugs)

- One banner at a time, each for its full time. During a rush the club
  wave stays up, the next name flips in the moment the last one's time is
  up, and a "+N more coming" pill appears.
- After the opening ceremony starts, banners switch to a calmer
  late-arrival style with no confetti cannon — that's the shared
  schedule (`shared/schedule.json`) doing its job.
- The tally resets itself each day; "Reset counter" in Settings does it
  on demand.

## Presentation tool (projector)

### Pre-club check

1. Open `…/countdown.html` — the week-long countdown should show the
   right time until Wednesday 6:00 PM. **If the countdown time is
   wrong, the device clock is wrong** — the page shows an amber
   "clock off by ~N min" chip when it detects this. Fix the system
   clock / enable network time; nothing else will look right until
   you do.
2. Hover the **top-right corner** for the hidden operator menu
   (QuickNav): jump to any window, set the Pusher key, toggle
   Low-power mode (weak hardware) or countdown sounds (off by
   default). Birthdays sync themselves from the print server's
   broadcast once the key is set — there is nothing to upload.

### During club

The schedule drives everything: opening slides at 6:00, game screens
per club, closing slides at 7:30, shutdown at 7:35. Manual overrides
from QuickNav hand back to the schedule on their own (a "back to
schedule in Ns" pill warns first — press **Stay** to keep it).

| Keys | Where | What |
| --- | --- | --- |
| Space / → / PageDown | countdown & slides | advance / skip to ceremony |
| ← / PageUp | slides | previous slide |
| Esc twice | slides | exit to countdown |
| Space / Enter | shutdown screen | restart countdown |

### Skipping a week (holiday)

QuickNav → **Skip Weeks** → pick the date → "Mark no club". That
device immediately treats the date as no-club (countdown counts to the
following week). This is per-device; for the change to apply everywhere
and permanently, put it in `shared/schedule.json` instead (any edit
there is validated by CI before it can deploy).

### Closing text

Edit `shared/slides.json` in the repo — the goodnight slide's text
comes from there. A malformed edit fails the build rather than
reaching the projector. (The verse-of-the-month slide was retired: the
opening ceremony ends on a blackout, and pressing → on the blackout
jumps straight into the first game window.)

## Slides on every display (slide sync)

The typed slide deck is published ONCE and every lobby display shows it.
Edit slides anywhere (Ctrl+Shift+E), then get them to the screens one of
two ways:

- **At the check-in computer, in the display app**: open the slide editor
  and press **Publish to all displays**. This needs the one-time publish
  token: printer dashboard → **Lobby Slides** → Generate, then paste it
  into the display's Settings → Background → Publish token. Chrome may ask
  once to allow the page to reach the local printer app — allow it.
- **On the printer dashboard (always works, any browser)**: in the display
  app press **Export** (downloads `awana-slides.json`), then paste or drop
  that file into the dashboard's **Lobby Slides** card and press Publish.
  This is also the path for a deck drafted at home: export it there, carry
  the file, paste it at church.

What the screens do: displays holding the display key decrypt the deck,
show it, and **cache it** — a screen that reboots on club night renders
the deck instantly, and screens that were off catch up within ~5 minutes
of coming back (while the printer app is running). The editor screen
switching to the new deck is your confirmation the whole pipe works.

Facts worth knowing:

- Only **typed text slides** sync. Video slides and pptx/video background
  uploads stay on the device they were added to, on purpose (their files
  live in that device's browser). A following screen still plays its own
  saved video slides alongside the published deck — in the order arranged
  in its editor when its saved text matches the published text, appended
  at the end when a newer publish has since landed (the next local Save
  re-interleaves them).
- Publishing an **empty** deck clears the slides on every display — that
  is a feature, and the editor asks first.
- A display can opt out: Settings → Background → **Follow published
  slides** off pins it to its own local deck.
- With the **display key** set on the print server (the normal state), the
  deck travels encrypted like the names do. Without it, the printer is in
  rollout mode and the deck goes out **unencrypted** — so set the key. A
  keyed screen refuses unencrypted decks; a screen missing the key can't
  read encrypted ones and keeps its local slides — either way Settings →
  Background says exactly what to fix.
- Wrong deck showing after a printer reinstall or clock problem? Settings
  → Background → **Forget received deck** on the affected screen, then
  publish again.

## Moving or replacing a display device

Settings on a device live in that device's browser. To clone a lobby
display: Settings → **Export**, then **Import** on the new machine.
For the projector page: enter the Pusher key via QuickNav (a corner
note appears on fresh devices until it is set); birthdays and live
counts then sync themselves from the print server's broadcasts.

## Deploy facts worth knowing

- Every push to `main` redeploys the site (lint, typecheck, tests, and
  an end-to-end smoke suite all gate it — a red check means the old
  site stays up).
- Devices pick up a deploy on their next page load (the service worker
  never serves stale code after a reload).
- The church calendar feed refreshes itself nightly via a scheduled
  GitHub Action; if the calendar page breaks, displays keep the last
  good copy.

## Privacy (the rule that never bends)

The screens show **first names only** — ever. Every event from the
check-in system is stripped to an allowlist before anything renders
(see `CONTRACT.md`). If you ever see more than a first name and club on
screen, treat it as an incident: panic mode (Ctrl+Shift+X does not
affect banners — instead pull the Pusher key in Settings to stop the
feed), then report it.

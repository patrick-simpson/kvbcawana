# Journey Display

A simple kiosk website that displays the **Journey: Advocates** video lesson on a screen during Awana® meetings, with automatic fallback to the Awana Check-in Display the rest of the day.

> This project is an independent, church-built tool. It is **not affiliated with, endorsed by, or approved by Awana Clubs International** — it simply plays curriculum video the church already licenses through its own Awana Ministry Membership, for internal, on-device use only.

**About page (what it does, in plain words):** https://awana.kvbchurch.org/#journey

- **6:30 PM – 7:30 PM:** Shows the current week's Journey lesson video (on club nights Trek's card takes over at 7:00, below)
- **Club nights, 7:00 PM – 7:30 PM:** Shows Trek's "Small Group Time" card (tonight's Trek count, and Trek's lesson when the church calendar names it); a Journey lesson still running at 7:00 finishes first
- **All other times:** Shows the Awana Check-in Display
- **Runs on:** the Journey room's PC, in the KVBC Awana Windows app (any browser can open the same page)
- **No setup complexity:** Plain HTML/CSS/JavaScript—no build step, no databases

**Live site:** https://awana.kvbchurch.org/journey/

---

## Quick Start: Set Up the Journey PC

The Journey screen is a Windows PC running the **KVBC Awana** app, which
shows `https://awana.kvbchurch.org/journey/` full screen.

1. Install the KVBC Awana app on the PC and plug the PC into the room's
   screen or TV.
2. In the app's first-run setup, turn on **Display** and choose the
   **Journey kiosk** screen.
3. In Windows' power settings, set the screen to **never** turn off or
   sleep. The page keeps the screen awake on its own while it is open,
   but this is the backup.

**That's it!** To try the page without the app, open
`https://awana.kvbchurch.org/journey/` in any browser (Chrome or Edge
work best) and press F11 for full screen.

---

## Adjust the Schedule (Optional)

By default, the Journey Display appears from **6:30 PM to 7:30 PM**.
These times live in the **live website's** code, not on the PC. To
change them:

1. On any computer, go to
   https://github.com/patrick-simpson/kvbcawana/blob/main/journey/src/schedule/00-core.js
2. Find these lines near the top:
   ```javascript
   const JOURNEY_START_MINUTES = 18 * 60 + 30; // 6:30 PM
   const JOURNEY_END_MINUTES = 19 * 60 + 30; // 7:30 PM
   ```
3. Change the numbers, in 24-hour time (e.g., **5:30 PM** = `17 * 60 + 30`)
4. Run `npm run build` in `journey/` (it rebuilds `public/src/schedule.js`)
   and commit both files; the site redeploys itself and the Journey
   screen reloads onto the new version on its own within a few minutes

---

## Troubleshooting

### The screen shows nothing or is black

- Make sure the HDMI cable is plugged in firmly on both ends
- Check that the PC is on and the KVBC Awana app is running
- Check the PC has an internet connection

### The Journey video doesn't appear

- Check the time on the PC (look in the bottom right corner of the screen)
- The video only appears between 6:30 PM and 7:30 PM
- Make sure you have an internet connection
- Wait a minute and refresh the browser (F5)
- If you see the Journey logo on a plain purple screen (no lesson name,
  no buttons) instead of a video, that's normal and expected — it means this week's lesson
  hasn't been resolved yet, or the video couldn't load, and the display
  is deliberately showing a plain placeholder instead of a broken video
- Sound stays muted for the very first play after
  the PC starts (browsers require a tap before allowing autoplay with
  sound) — tap either corner button once and every lesson after that
  plays with sound automatically. The video also always plays through
  once and stops; it never loops.

### I want to change the schedule

- The schedule lives in the **live website's** code, not on the PC —
  see **Adjust the Schedule** above

---

## What's Actually Running?

The Journey Display is a simple website (HTML/CSS/JavaScript) that:

1. **Checks the current time** on the PC
2. **Shows the Awana Check-in Display** most of the day (embedded in an iframe)
3. **Switches to the Journey video** from 6:30 PM – 7:30 PM
4. **Caches the video locally** so it plays even if the internet is flaky
5. **Lets you manually toggle** between the two displays with a button in the corner

The video lessons come from the **Journey: Advocates** curriculum hosted by Awana. A nightly GitHub Action automatically detects the current week's lesson from your church's TwoTimTwo calendar and updates `current-lesson.json`.

### Previewing Any Lesson (Settings Button)

A small gear (⚙) button opens a list of every lesson in the course. While
the Check-in Display is showing (all day, except 6:30–7:30 PM) the gear sits
in the bottom-right corner, just above the switch-display (⇄) button; over
the lesson, the splash and the slides it is in the top-right corner. (Over
Trek's small group card it stays in the bottom-right corner too.) Tap a
week to play it right now — this is just a one-time preview and never
changes what plays automatically at 6:30 PM.

- If you tap a lesson **outside 6:30–7:30 PM**, it asks whether you
  want the **Student Video** (what the kids normally see) or the
  **Leader Video** (has extra discussion notes, meant for the leader
  reviewing ahead of time).
- If you tap a lesson **during 6:30–7:30 PM**, it just plays the
  Student Video right away, same as usual.
- To stop a preview early, tap the switch-display (⇄) button — it
  returns to whatever should normally be showing right now.

### Lessons Saved on This Computer

The church's internet is slow, so the kiosk keeps every lesson's
full-quality video on its own disk (about 8.5 GB with the Leader Videos).
Settings → **Lessons on this computer**:

- **Download lessons automatically** (on by default on the kiosk; off in a
  normal web browser): the kiosk downloads
  by itself, a few minutes after it starts, never during a lesson and never
  from 5:30 to 8 PM. Nothing to press.
- **Download all lessons (full quality)** starts it right now; **Pause**,
  **Resume** and **Stop** do what they say. Finished videos always stay,
  and an interrupted one carries on where it stopped.
- The line under the buttons shows the progress ("Video 7 of 63 · 42% ·
  3.1 of 8.5 GB · about 25 min left"), each video's state, and how much
  disk space is free. "All 32 lessons saved ✓" means it is finished.
- A saved lesson plays from the disk, even with the internet working.
- **Delete downloaded lessons** (asks first) is the only thing that
  removes them.

### How it's Built

- `public/index.html` — the whole app. Two full-viewport layers (Check-in Display iframe, Journey video) are both always mounted; a small script toggles which one is visible.
- `public/src/schedule.js` — the 6:30/7:30 schedule and the manual toggle button's behavior.
- `public/src/style.css` — full-bleed layout and button styling, in the Awana 2026-27 catalog's Journey look.
- `public/brand/` — a generated (ignored, `npm run assets`) byte-identical copy of the Awana brand kit in `shared/brand/` (colours, the Journey logo, and the three self-hosted fonts), so the kiosk never needs the network for its own look. Don't edit it by hand; see CLAUDE.md.
- `public/lessons.json` — the fixed week→video map for the 32-week Advocates course.
- `public/current-lesson.json` — which week is "current" right now, refreshed nightly by GitHub Actions.

The site deliberately uses **plain HTML/CSS/JS with no build step** (only the schedule script is joined from its parts). Keeping it lightweight matters more than developer convenience.

For technical details, see [CLAUDE.md](CLAUDE.md).

---

## Questions or Problems?

- Check the **Troubleshooting** section above
- Contact your tech team or open an issue on GitHub

---

## License

This project respects Awana's licensing terms. The church has an active Awana Ministry Membership. Videos are cached locally for internal display only and are never re-shared or publicly rehosted.

**Not affiliated with, endorsed by, or approved by Awana Clubs International.** "Awana," "Awana Clubs," and program names such as "Journey: Advocates" are trademarks of Awana Clubs International, used here only to describe which licensed curriculum this kiosk plays.

Website code: MIT License

---

**Last Updated:** 2026-10-12  
**Made for:** KVB Church Awana

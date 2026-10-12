# Night-of one-pager — club label printing

Print this page and tape it near the check-in laptop. Setup is in [SETUP.md](SETUP.md); problems are in [TROUBLESHOOTING.md](../TROUBLESHOOTING.md).

## Before doors open (5 minutes)

1. **Start the server** — double-click **KVBC Awana** on the desktop
   (or its tray icon). A green window appears.
2. **Open the check-in page** — it opens automatically; sign in to
   TwoTimTwo if asked. The green **Club Print widget** appears top-right.
3. **Run the night test** — widget → **Night Test** (or
   awana.kvbchurch.org/settings → Printing → At the laptop → *Print a test label*). You should get:
   - ✅ page selectors
   - ✅ print — a label with a big **TEST** band comes out
   - ✅ live channel — the lobby display is listening
4. **Glance at the settings page** (SETUP.md §3), in Chrome on this
   laptop — Laptop → *This laptop* should say *Everything looks right*.
   No internet tonight? Skip it: the desk still prints without it, and
   there are no phones or settings changes until it is back.

## During check-in

- Labels print by themselves when kids are checked in — on this
  laptop, on another device, or from a phone.
- **Label didn't print?** Widget → *Tonight* list → **Reprint**.
- **Kid not in the system?** Widget → *Walk-in Guest* → type the name,
  pick a club, **Print**.
- **Red banner across the top?** The check-in page changed under us
  (see [TROUBLESHOOTING.md](../TROUBLESHOOTING.md#red-banner-the-check-in-page-layout-has-changed)).
  Check kids in normally and use widget search / walk-in printing; labels
  still work.
- **Phone check-in:** volunteers open **awana.kvbchurch.org/checkin** on
  their phone (any network, church passphrase to sign in) and tap the kid.
  The check-in is made for them and the label prints here automatically.
  There is no address or PIN on the laptop any more.
- **Count looks wrong?** Phone → *Tonight* tab shows exactly who is
  being counted. **Remove** fixes the count here (still undo them on
  TwoTimTwo if they really left); **Add back** reverses a slip.
- **Leader name tag:** three places, all the same list — the check-in
  widget's *Walk-in Guest* row with the **Leader** box ticked (the row
  turns amber and the button reads *Print Leader Tag*), phone →
  **Leader tag** (top right), or the settings page's *Name tags and
  labels* card. Never counts as a kid.
- **Leaders you printed before** come back as chips on all three: tap
  **Print** on one, or tick several and press **Print selected** to tag
  a whole team without typing. The **×** forgets a leader (a name typed
  wrong, or someone who has moved on); anyone not printed for a season
  hides itself, and printing them again brings the chip back.

### The TwoTimTwo count check

Under **Tonight** (in the check-in widget and on the phone)
there is one line comparing this server's count with TwoTimTwo's own:

- **`✓ Matches TwoTimTwo (101)`** — nothing to do.
- **`⚠ TwoTimTwo 101 · printed 99 — 2 with no label (Sparks −2)`** — two
  children are checked in at the desk but no label came out for them. **This
  is the one to act on**: find them in Sparks and reprint from the Tonight
  list, or print a walk-in label.
- **`⚠ … — 3 extra`** — more labels than TwoTimTwo has check-ins, beyond the
  walk-in guests it already knows are unregistered. Usually someone was
  printed but never checked in at the desk.
- **No line at all** — the check-in page has not reported a number in the last
  five minutes (nobody has that tab open, or the network dropped). Silence is
  never agreement; open the check-in page and it comes back within a minute.

Walk-in guests printed without *Also register in TwoTimTwo* are counted and
subtracted automatically, so they do not raise a false alarm. A shortfall is
never explained away that way.

## If printing stops

1. Is the green server window still open? If not, double-click
   **KVBC Awana** again — queued labels print on reconnect.
2. Printer on, paper in, USB seated? The server retries by itself.
3. The settings page (SETUP.md §3, in Chrome on this laptop) shows exactly
   what's wrong — Laptop → *This laptop* (warnings, *Run diagnostics*) and
   *Print failures tonight*. With no internet use the app's status window
   (tray → *Print server status...*). Then
   [TROUBLESHOOTING.md](../TROUBLESHOOTING.md).

**The screen never blocks the door.** Worst case: check kids in on
paper, print labels later from the widget's Tonight list.

# Cloud check-in: no check-in laptop

Owner request, 2026-10-11: "make this application so that the check-ins just
happen in a cloud computer, and everything can be done without the check-in
laptop existing", through Cloudflare, with labels still printing at church.
This is the plan; the status of each part is under "Status and hand-off" at
the end. Each phase lands on its own and the laptop keeps working until the
last one.

## The owner's decisions (2026-10-11)

| Question | Decision |
| --- | --- |
| Where are check-ins made? | **Anywhere.** Our phone page and touch screen check in through Cloudflare, and a check-in made on TwoTimTwo itself (its site or app, on any device) is noticed and still gets a label. |
| Allergy and medical notes (they print on labels) | **Sealed on arrival.** Cloudflare fetches TwoTimTwo's roster and locks it at once with a key only the church print station holds. Cloudflare stores it but cannot read it. |
| Which TwoTimTwo login | **A new, dedicated check-in user**, made by the owner. Its password lives only in GitHub's secret store and Cloudflare's, never in chat or the repo. |
| What prints at church | **A Raspberry Pi**, always on, with the label printer on USB. |

## Today, and what changes

Today every TwoTimTwo action happens in Chrome on the check-in laptop. The
extension rides the volunteer's logged-in session, posts check-ins and undos,
reads the check-in report and the roster CSV, and hands the print server what
it needs. A phone check-in goes phone → sync Worker relay → laptop print
server → extension → TwoTimTwo, and the label prints on the laptop's printer.

After the move:

```
 phones, touch screen ──┐                         ┌── lobby TVs, projector, Journey
                        ▼                         │   (unchanged: the live channel)
              ┌──────────────────────────┐        │
              │  Cloudflare (sync Worker)│────────┘
              │  · TwoTimTwo session      │◀──── TwoTimTwo site/app check-ins
              │  · check in / undo / out  │      (seen by watching the report)
              │  · report watcher (15 s)  │
              │  · sealed roster          │
              │  · print-job queue        │
              └────────────┬─────────────┘
                           │  print jobs (outbound connection from church)
                           ▼
              ┌──────────────────────────┐
              │  Raspberry Pi at church  │  opens the sealed roster with its own
              │  · label renderer (as now)│  key, renders the label exactly as the
              │  · CUPS → label printer   │  laptop does today, prints, says done
              └──────────────────────────┘
```

Nothing at church needs to be reachable from the internet: the Pi connects out
to Cloudflare, the same way the TVs do.

## The pieces

### 1. The TwoTimTwo client (in the sync Worker)

Everything it needs is already mapped in `printer/docs/TWOTIMTWO.md`:

- **Sign in:** `GET /site/login` for the CSRF token, `POST /site/login` with
  `LoginForm[username]`, `LoginForm[password]`, `Login=1`. The session cookie
  is kept in the Durable Object. Before each burst of work it is checked with
  the cheap probe (`/clubber/ajaxSearch?text=zz` answers `Login Required` when
  it has expired) and it signs in again if it must.
- **Tonight's meeting:** `GET /clubber/checkin` gives `#calendar_id`, the
  `events[]` items with their club scopes, and the roster rows (first and last
  name, clubber id, club). Read fresh each night, and again whenever TwoTimTwo
  refuses a post (the extension does the same).
- **Check in:** `POST /clubber/checkinclubber` with `clubber_id`,
  `calendar_id` and the applicable `events[]` (Attendance always). The extension's
  rule for a real success carries over: a short snippet naming the child,
  never a page or the login form.
- **Undo:** `POST /clubber/checkinclubberundo`; success is exactly
  "(checkin undone)", then the report must stop listing the child.
- **Check out:** the existing youth check-out (`POST /clubber/checkout`, an
  exact "OK").
- **Visitors:** `/clubber/register?default_visitor=Y`, as the extension does.

The parsers already exist and are tested in the printer folder (the report
parser in `chrome-extension/feeds.js`, `validateCheckinReportBody`, the CSV
reader). They move to one shared module the Worker and the Pi both import,
rather than being written a second time.

### 2. The report watcher ("anywhere")

During the club window (`shared/schedule.json`, from an hour before to the
tally grace after, the same window the printer ticks in today), a Durable
Object alarm reads `/clubber/checkin_report?date=today` every 15 seconds and
compares it with the last read:

- a child who is new on the report and was not checked in by us is a check-in
  made on TwoTimTwo directly: queue their label and greet them on the TVs;
- a child who left the report was undone on TwoTimTwo: stop counting them.

This is the cloud form of the extension's roster-diff detector, and it keeps
its safety rules: a report that parses fewer children than its own `Count:`
footers is partial and changes nothing, and a read that would drop most of the
room at once is refused (the mass-undo guard). The report is also the count:
`tally`, `tonight` and the pickup list are published from it, as the printer's
`authoritativeTonight()` does today.

Cost: about 720 report reads on a club night, plus the phones' calls. That fits
the Workers free plan (100,000 requests a day) many times over.

### 3. The sealed roster

Labels print allergies, the no-photo mark, birthdays and first-time stickers,
which come from the roster CSV (`/clubber/csv`). The Worker reads it once at
the start of each club night (and on demand when an unknown child checks in)
and seals it straight away with the **print station's public key**
(ECDH P-256 + AES-256-GCM, Web Crypto on both sides). Only the sealed copy is
stored; the Pi holds the private key and is the only thing that can open it.
The Worker keeps nothing else from it: label jobs carry only the clubber id,
the first name, the club and the events checked.

So the plaintext roster exists in Cloudflare only in memory, between
TwoTimTwo's reply and the seal, the same moment it exists in the laptop's
Chrome today.

### 4. The print station (Raspberry Pi)

- Raspberry Pi 5 (4 GB) with a good power supply and a small SSD or
  high-endurance SD card, the label printer on USB (a DYMO LabelWriter 450 is
  supported by CUPS on Linux: `printer-driver-dymo`). Wired Ethernet if the
  room has a jack.
- Runs the print server's label renderer unchanged (`generateLabel()`, the
  brand kit, the golden-tested layout). Only the last step changes: the PNG
  goes to CUPS (`lp -d <printer> -o media=…`) instead of PowerShell
  `System.Drawing`. Headless Node under systemd, restarted if it stops.
- Connects out to the Worker's live channel as a **station** (its own
  credential, paired once with the church passphrase), opens the sealed
  roster, and takes print jobs: render, print, report done or failed. A job
  stays queued in the Durable Object until the station says it printed, so a
  Pi reboot or a dropped connection never loses a label.
- Reports its printer's state (online, out of labels, jammed) so the phone
  page and the TVs' status sticker can say "the label printer needs help",
  as the laptop's `/health` warnings do today.
- A small local page on the Pi (church Wi-Fi only) for setup: pick the
  printer, print a test label.

### 5. Phones and the touch screen

`awana.kvbchurch.org/checkin` keeps its look and its routes; they are
answered by the Worker instead of relayed to the laptop. The roster for
picking a child comes from tonight's check-in page (names, clubs, ids; no
medical data). The touch screen becomes the same page on a tablet or any
browser at the desk. Remove, Undo check-in, Check out, one-off tags and
custom labels keep their meaning; the print ones become print jobs.

### 6. The screens

Unchanged for the TVs, the projector and Journey: the same sealed `checkin`,
`recap`, `checkout` and plain `tally` / `tonight` frames on the same live
channel, now published by the Worker (which already holds the display key and
seals the `settings` and `slides` frames). The privacy invariant does not move:
first names only, sealed, through each event's own allowlist sanitizer.

## Privacy and safety

- The dedicated TwoTimTwo user's password: GitHub secrets
  `TWOTIMTWO_USERNAME` / `TWOTIMTWO_PASSWORD`, written to the Worker by the
  deploy step the way `SYNC_PASSPHRASE` is. Never logged, never returned.
- Nothing medical is readable in Cloudflare at rest (sealed roster above).
- Every phone action still needs the church passphrase session; the check-in
  routes keep their allowlist and their per-action rules (undo only with a
  clubber id, the 90 s claim lease becomes the job queue's lease).
- TwoTimTwo is closed and unpublished. If it changes a page, the parsers'
  drift checks fail loudly, the phone page says check-in is unavailable, and
  volunteers check in on TwoTimTwo directly: the report watcher still prints
  their labels as long as the report parses.
- TwoTimTwo has agreed (below): an automated user, reading every 15 seconds,
  everything encrypted. Whether they block cloud addresses shows on the first
  shadow night (`lastError` on the status).

## When something breaks on a club night

| Failure | What happens |
| --- | --- |
| TwoTimTwo down | Nothing can check in anywhere (as today). Paper sheet (`/clubber/checkin_form`), keyed in later. |
| Our check-in path broken, TwoTimTwo fine | Check in on TwoTimTwo's own page or app; the watcher still queues labels. |
| Cloudflare down | Check in on TwoTimTwo directly; no labels until it is back (jobs are created when the watcher next reads the report). Keep a roll of blank name tags and a marker. |
| Pi or printer down | Jobs wait in the queue and print when it is back; the phone page and the TVs say so. |
| Church internet down | The Pi cannot get jobs. Same as today's laptop without internet: TwoTimTwo itself is unreachable too. |

During the move the old laptop stays installed as a spare: if a night goes
wrong it can be started and used exactly as before.

## Phases

Each phase is a separate change with its own tests, run in **shadow** beside
the laptop on a club night before anything depends on it.

0. **Owner:** create the dedicated TwoTimTwo user (check-in permissions only)
   and add `TWOTIMTWO_USERNAME`, `TWOTIMTWO_PASSWORD` (and `TWOTIMTWO_HOST`,
   `kvbchurch.twotimtwo.com`) as GitHub secrets; get the Pi, power supply,
   storage; confirm the label printer's exact model; ask TwoTimTwo the
   question above.
1. **Read-only watcher.** Worker signs in, reads tonight's report and the
   check-in page, and logs what it would publish (counts and detected
   check-ins) without publishing. Shadow night: its numbers must match the
   laptop's `authoritativeTonight()`.
2. **Print station.** Pi image and the headless print server with CUPS,
   pairing, the sealed roster, the job queue. Shadow night: a test label for
   every detected check-in on a second printer, compared with the laptop's.
3. **The Worker publishes** `tally`, `tonight`, the pickup list and the
   greetings (laptop's publishing turned off for the night).
4. **Check-in writes.** Phone page and touch screen check in, undo, check out
   and register visitors through the Worker.
5. **Switch night.** The laptop stays home (kept as the spare); the extension,
   the bookmarklet and the relay are retired afterwards.

## What Claude sessions can and cannot do here

The parsers and every request are built and tested against captured shapes
(selectors and column names only, never real data, per `TWOTIMTWO.md`).
Sessions do not sign in to the live TwoTimTwo site; every live check is the
owner's shadow night, with a test child and an undo.

## Status and hand-off

Read this first if you are picking the work up in a new session.

- **Plan and decisions:** this file (owner, 2026-10-11).
- **TwoTimTwo's agreement:** granted by **Devin at TwoTimTwo**, reported by
  the owner on 2026-10-11. Its terms: automated check-ins through Cloudflare
  are allowed **as long as everything is encrypted**; reads **every 15
  seconds** are fine; and **TwoTimTwo will not give technical support** if
  anything goes wrong with the process. So the Worker never reads faster than
  every 15 s (`READ_INTERVAL_MS`, a manual read included), every request is
  https, the password and session cookie are never stored, and what is stored
  holds no names and seals its ids. Because there is no vendor support, the
  laptop stays as the spare, and the paper sheet stays the fallback. If the
  permission ever needs showing, file the email (or note how it was given)
  here.
- **Built (2026-10-11): phase 1, the read-only watcher.** In the sync Worker:
  `lobby/worker/src/twotimtwo.js` (sign-in, the report and check-in page
  parsers, which a test runs against the extension's own parser on the same
  pages) and `lobby/worker/src/watcher.js` (the 15 s alarm in the club
  window, the partial and mass-undo guards, the sealed state). It publishes
  nothing; `GET /api/v1/cloud/status` (signed in with the passphrase) shows
  its counts, and `POST /api/v1/cloud/read-now` reads once on any day for a
  rehearsal. `CLOUD_CHECKIN = "shadow"` in `wrangler.toml`; `"off"` stops it.
  Idle until the three secrets exist. Tests: `lobby/worker/test/twotimtwo.test.js`,
  `watcher.test.js`. Not yet run against the live site.
- **To start the shadow night:** add the three GitHub secrets, then **Actions
  → CI → Run workflow** with "Redeploy the sync Worker" ticked (a Worker only
  gets new secrets when it deploys). Before Wednesday, on any lobby screen signed
  in with the passphrase, open Settings → Setup → Cloud check-in → **Test
  TwoTimTwo sign-in** (it calls `POST /api/v1/cloud/read-now` and says what
  happened in words; a pass names today's count and the meeting id). On the
  night, compare its `checkedIn` and `byClub` with the laptop's dashboard
  (the laptop takes checked-out children off; this does not yet). Watch for
  `lastError`, `partial` and `massUndoRefused`. One risk to watch: the
  Workers free plan allows 10 ms of CPU per run, and each read parses the
  report; if runs are cut off, `lastReadAt` stops moving.
- **Built so far (printer 7.19.0):** the Linux print path the Pi needs.
  `printer/print-server/cups.js` prints through CUPS and reads printer state
  from `lpstat`; it is switched on with `AWANA_PRINT_BACKEND=cups` (plus
  `PRINTER_NAME` set to the CUPS queue). Tested with stand-in `lp` / `lpstat`
  (`scripts/test-cups.cjs`, `scripts/test-cups-server.cjs`); not yet on a real
  Pi or printer.
- **Not built yet:**
  - the Pi image and its service (Node, the print server headless under
    systemd with the two variables above, CUPS with `printer-driver-dymo`),
    the station's pairing with the Worker, the print-job queue and the sealed
    roster (pieces 3 and 4);
  - the watcher's later phases: check-outs off the count, printing a label
    for each check-in it finds (needs the station), and publishing;
  - the phone page and touch screen answered by the Worker (piece 5), and the
    Worker publishing the screens' frames (piece 6).
- **Owner's to-do (phase 0):** the dedicated TwoTimTwo user and its GitHub
  secrets (`TWOTIMTWO_USERNAME`, `TWOTIMTWO_PASSWORD`, `TWOTIMTWO_HOST`), then
  the Worker redeploy above; the Pi hardware; the printer's exact model; and
  changing the password that was posted in a chat on 2026-10-11 (the
  dedicated user should have its own, never that one).

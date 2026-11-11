# Improvement plan (weekly code review)

Every Wednesday at 6:47 am Eastern a scheduled Claude session (Opus) reviews what
changed in this repo since the last review and writes what it found here. The owner
set this up on 2026-11-11. This file is both the instructions for that review and
its record. It lives on `main`; the next review reads its starting point from here.

## State

- Last review date: 2026-11-11
- Last reviewed commit: 331b5cc
- Reviews done: 1

## Instructions for the reviewer

Follow these in order. `CLAUDE.md` is the authority for every app's rules; read the
sections for the apps the changes touch before judging them.

### 1. Find what changed

1. `git fetch origin main` and work from the newest `main`.
2. List the commits after "Last reviewed commit" (`git log <commit>..origin/main`).
   A fresh checkout holds only the newest 50 commits: first run
   `git fetch --shallow-since=<two days before Last review date> origin main`.
   If the commit is still missing, use the commits since "Last review date".
3. Leave out the nightly bots' commits (calendar, Journey lesson, release feeds) unless
   one looks wrong.
4. No commits to review: write a one-line entry in the Review log, update State, stop.

### 2. Review

- Use at most 4 helper agents in total. Split the changes by app (lobby and shared,
  worker, printer and site, journey and classroom and scripts) only when there is
  enough in each to be worth a helper; a small week needs none.
- Use Haiku helpers for simple jobs (running a check, searching for text) and keep
  the judging with the main model. A helper's finding is a lead: confirm it against
  the code yourself before writing it down.
- Read the diff, then the code around it. Look for, in this order:
  1. **Privacy and safety**: anything that weakens a "DO NOT relax" rule in
     `CLAUDE.md` (first names only, sealed frames, fail closed, secrets never in
     files or pages, names never in storage).
  2. **Bugs**: wrong behaviour on a club night, a label that could print twice or
     not at all, a screen that could go black or wedge, a race, a missed error path.
  3. **Cost**: anything that could need a paid plan, or a new always-on poll faster
     than once a minute (the 100,000 requests a day budget).
  4. **Rules drift**: code that no longer matches what `CLAUDE.md` or a README says,
     a constant written in two places that disagree, a generated copy edited by hand.
  5. **Missing tests**: a behaviour change with no test, or a test changed to pass.
  6. **Simplification**: dead code, a duplicate of something in `shared/`, a section
     of `CLAUDE.md` describing something that is gone.
- Do not report style preferences, things a linter already catches, or guesses you
  could not confirm in the code. Fewer, confirmed findings beat a long list.
- Check last week's Open findings: if a commit fixed one, move it to Closed.

### 3. Write the findings

Add each finding under "Open findings", most serious first, in this shape:

```
### IP-YYYYMMDD-NN: short title
- Severity: High | Medium | Low
- Where: path/to/file.js:line (commit abc1234)
- What: one or two plain sentences on what is wrong.
- Why it matters: what could happen, to whom, and when.
- Suggested fix: the smallest change that fixes the cause.
- Status: Open
```

Severity: **High** = could hurt a club night, privacy, or cost money. **Medium** = a
real bug or drift with a narrow effect. **Low** = clean-up.

Plain English, short sentences, no em dashes. Never write a real child's name, a
passphrase, a token or a key in this file (the repo is public).

### 4. Fix the small safe ones (owner 2026-11-11)

You may fix a finding yourself only when ALL of these are true:

- It changes no behaviour: a typo, a stale or wrong line in a doc or comment, a
  broken link in a doc, a `CLAUDE.md` line that names something deleted.
- It is not in `worker/`, not a test, not a generated copy or build output
  (`journey/public/src/schedule.js`, anything `scripts/family-assets.mjs` makes),
  not a file under a "DO NOT relax" rule, and needs no version bump or release.
- The checks `CLAUDE.md` names for the files you touched pass afterwards.

One finding per commit, pushed to `main`. If a check fails, undo the fix, leave the
finding Open, and say what failed. Never change a test to make it pass. Mark a fixed
finding `Status: Fixed in <commit>` and move it to Closed. Everything else is written
up only: the owner decides.

### 5. Finish

1. Update State: the date (Eastern), the newest commit you reviewed, the count.
2. Add one line to the Review log: date, commit range, number of commits, findings
   by severity, what was fixed.
3. Commit this file alone (`Weekly review YYYY-MM-DD: N findings`) and push to `main`.
4. End with a short summary for the owner: the High findings first, then counts.
   Lead with "Nothing needs you" when that is true.

Keep this file readable: when Closed findings pass 30, delete the oldest (git
history keeps them).

## Open findings

### IP-20261111-01: Cast stays on until someone turns it off by hand
- Severity: High
- Where: printer/electron-app/src/display/display.js:513 (commit d9e8676)
- What: Cast is saved as the chosen screen and comes back after a restart. Nothing ends it when a club night starts or after it sits idle.
- Why it matters: If Cast is left ticked after a Sunday, the lobby TV shows the Cast screen on Wednesday instead of the welcomes, until someone unticks it. The TV page also reads the Worker every 30 seconds around the clock, about 5,800 of the 100,000 daily requests.
- Suggested fix: When a club night's hours begin and the screen is Cast, turn Cast off (`castOff()`), with a test in `display.test.cjs`. Owner's call: also slow the TV's safety read to 60 seconds.
- Status: Open

### IP-20261111-02: Turning Cast off on the classroom computer resets its hours and re-arms the 8 pm shutdown
- Severity: Medium
- Where: printer/electron-app/src/display/display.js:736 and settings.js:94 (commit d9e8676)
- What: Cast off goes back through `setScreen`, which treats the classroom as newly chosen and applies its defaults again (hours 4 to 8 pm, shutdown on).
- Why it matters: CLAUDE.md says those defaults apply once. After one Cast on and off there, changed hours are lost and a shutdown someone switched off is on again, so that PC powers off at 8 pm on a club night.
- Suggested fix: In `castOff`, put the screen id back without the defaults, or remember the whole settings from before Cast. Add a test.
- Status: Open

### IP-20261111-03: The health-check call can hold up the check-in alarm
- Severity: Medium
- Where: worker/src/sync.js:405, worker/src/prints.js:99 (commits b99738d, b985528)
- What: The Worker's alarm waits for the GitHub call that starts the health check at 5:12, 5:47 and 6:15 pm, and that call has no time limit.
- Why it matters: If GitHub answers slowly, the next report read, label hand-off and station wake wait behind it, during check-in.
- Suggested fix: Give that one dispatch a time limit of about 8 seconds, or do not wait for it in the alarm. Do not add a time limit to the print path (a timed-out send could print twice).
- Status: Open

### IP-20261111-04: The projector can reload itself in the middle of a scored game
- Severity: Medium
- Where: lobby/src/presentation/App.jsx:180 (commit 6eba510)
- What: The self-update's busy check looks only at the schedule. The scoreboard shows whatever the schedule says, so a game scored off-schedule does not count as busy.
- Why it matters: A deploy during a game scored before 5:30 pm, on another day, or left up into the shutdown screen reloads the wall mid-game. Scores survive; a takeover or finale on screen is lost.
- Suggested fix: Count a club up or a finale as busy: `CONFIGURE || scoringClub != null || finale != null || !projectorIdle(state)`, with one test.
- Status: Open

### IP-20261111-05: Screen-share relay credentials: asks at the same moment each get their own set
- Severity: Medium
- Where: worker/src/turn.js:113-142 (commit e50fc1a)
- What: The check for an existing set and the write that records one have two waits between them, so parallel asks for one share each make a set.
- Why it matters: The hourly limit is passed, and only the last set is revoked when the share ends; the others live two hours. CLAUDE.md says one set per share. The presenter and the TV asking together hit a mild form of this.
- Suggested fix: Keep one in-flight promise per share, set before the first wait, and count the hourly use before the fetch. Add a test with two asks at once.
- Status: Open

### IP-20261111-06: Cast: an interrupted upload is never cleared and can block the next one
- Severity: Medium
- Where: worker/src/cast.js:208-222 (commit 60a2454)
- What: `makeRoom` counts unfinished uploads against the 12 file and 240 MB caps but only removes finished ones. Cast has no sweep for unfinished uploads.
- Why it matters: A big video whose upload dropped (phone lost Wi-Fi) blocks the retry with 'room full' while nothing is up, until the tray's reset.
- Suggested fix: In `makeRoom`, also remove an unfinished upload older than a few minutes. Add a test.
- Status: Open

### IP-20261111-07: The tray's Show Cast code does not tell the TV when nothing is up
- Severity: Medium
- Where: worker/src/cast.js:353 (commits 4d2f28b, a599832)
- What: `reset()` records that the code should show but rings no doorbell unless something was on the stage. The desk's own button does ring.
- Why it matters: The usual click is on an idle room, so the TV shows the code up to 30 seconds late.
- Suggested fix: Ring the doorbell after the write in `reset()`, as `deskReveal` does. Add a test on an idle room.
- Status: Open

### IP-20261111-08: The home page film is out of date and cannot be rebuilt as it stands
- Severity: Medium
- Where: printer/reel/shots.mjs:157 and :163, printer/reel/film/film.js:507 (after commits 50200cd, 40c79c2)
- What: The film's recipe still films the BARF Night poster, which was deleted, and asks for 9 seconds of an intro video that is now 8 seconds. The committed film still shows that poster and the old 3D intro.
- Why it matters: The public home page shows things the lobby no longer does. A rebuild today would film ordinary slides and label them BARF Night, with no error.
- Suggested fix: Remove the BARF shot and its cut, set the intro to 8 seconds and re-pick its moment, then the owner runs `npm run reel` (it needs his music file).
- Status: Open

### IP-20261111-09: A label given up on is counted, but nobody is told
- Severity: Low
- Where: worker/src/adopt.js:92 and :231 (commit a42c2c1)
- What: After three failed tries to make a print job the Worker adds one to `lost`, and nothing reads that number.
- Why it matters: A child checked in on TwoTimTwo's own page gets no label and the only trace is a Worker log line.
- Suggested fix: Put the count in the check-in health report and Tonight's Needs a look, or remove the counter and say it is log only.
- Status: Open

### IP-20261111-10: The Worker README describes token wiring that does not exist
- Severity: Low
- Where: worker/README.md:183-191
- What: It says `PRINT_FETCH_TOKEN` and `CAST_CONVERT_TOKEN` are pushed by ci.yml and handed to the jobs. ci.yml does not push them and both workflows send `HANDBOOK_TOKEN`. It also says three workflows can be started; there are four. The comment at sync.js:405 leaves out 6:15 pm.
- Why it matters: Setting either secret by hand, as the README invites, makes every print-from-page or PowerPoint job fail with 401.
- Suggested fix: Either wire the two secrets (ci.yml's list, and `secrets.X || secrets.HANDBOOK_TOKEN` in the two workflows) or cut the README down to what is true. In `worker/`, so not fixed by the review.
- Status: Open

### IP-20261111-11: A screen left open overnight keeps last night's scoreboard
- Severity: Low
- Where: lobby/src/hooks/useScoreboard.js:44-80 (commit 6eba510)
- What: No screen checks the board's night. The Worker starts a new night only when asked, and the backup read runs only on the club evening.
- Why it matters: If nobody presses End, a TV left on in a plain browser keeps the club and score bar up after midnight. The KVBC Awana app closes its window, so it is not affected.
- Suggested fix: In the hook, treat a board from another night as no board. It costs no request.
- Status: Open

### IP-20261111-12: The tray says Presentation while Cast is on
- Severity: Low
- Where: printer/electron-app/src/display/display.js:993 (missed in f5e4422)
- What: The status line for an always-on screen still reads 'Presentation: on screen now'. Cast is the only such screen now.
- Why it matters: The taskbar menu names a screen that was removed.
- Suggested fix: Use the screen's own short name, and pin the words in `display.test.cjs`. Needs an app release.
- Status: Open

### IP-20261111-16: A scheduled handbook run can still print after 5 pm in summer time
- Severity: Low
- Where: .github/workflows/handbook-print.yml:38, scripts/handbook/handbook-print.mjs:212
- What: The 5 pm rule is checked once at the start. A run that starts at 4:37 pm and fails its first try waits 15 minutes and tries twice more.
- Why it matters: Sheets could come out at about 5:10 or 5:25 pm. It cannot happen on winter time; the first chance is March.
- Suggested fix: Give scheduled runs a deadline that is checked before each retry, with a test.
- Status: Open

### IP-20261111-17: Several link copies at once could use up the Worker's memory
- Severity: Low
- Where: worker/src/cast.js:226 `fileStart`, worker/src/classroom.js:265 `importFile` (commits 91a65a3, 60a2454)
- What: Each copy from a link holds up to 20 MB in memory, and the room's limits are checked before the fetch, so parallel copies all pass.
- Why it matters: Seven or more at once could restart the Worker: every screen reconnects and TwoTimTwo signs in again. It needs someone with the TV code doing it on purpose. Reasoned from the code, not run.
- Suggested fix: Allow one link copy at a time per room.
- Status: Open

### IP-20261111-18: Three PowerPoints close together: the waiting conversion is cancelled without a word
- Severity: Low
- Where: .github/workflows/cast-convert.yml:26-34
- What: The job's concurrency group keeps one waiting run, so a third start cancels the second, which never reports back. The 10 minute job limit is also shorter than two 5 minute tries.
- Why it matters: The page waits its full 6 minutes and the record counts against the three allowed for an hour. Rare.
- Suggested fix: Drop the concurrency group, and raise the job limit to 15 minutes.
- Status: Open

### IP-20261111-19: Stopwatch: a doorbell's time guess can outrank real readings for 10 minutes
- Severity: Low
- Where: lobby/src/hooks/useScoreboard.js:74 (commit 6eba510)
- What: A ring that lands before the first timed read is stored as a perfect sample, and the sync always prefers the sample with the shortest round trip.
- Why it matters: The wall's stopwatch can run a little behind the phone until that sample ages out.
- Suggested fix: Use the ring's guess only while there is no real sample.
- Status: Open

### IP-20261111-20: Left over from the removed posters: unused styles and two font packages
- Severity: Low
- Where: lobby/src/styles/app.css about 2669-2780, lobby/src/main.jsx:17-22 (after commit 50200cd)
- What: No poster uses `.promo-wordmark`, `.promo-chip`, `.promo-headline` or `.promo-detail` any more, and Oswald and Lilita One are loaded only for them. The comment in main.jsx says to drop the imports after 2026-11-05.
- Why it matters: Every lobby screen downloads two fonts nothing draws. CLAUDE.md says these stay on purpose, pinned by `promoFonts.test.js`, so it is the owner's call.
- Suggested fix: Either delete the rules, the two imports and trim the test, or correct the comment to say they are kept.
- Status: Open

### IP-20261111-21: Two visible lines that are no longer true
- Severity: Low
- Where: lobby/src/scoreboard/logic.js:69, printer/components/home/Night.tsx:272
- What: The scoreboard phone says 'Offline: taps will not reach the projector', but taps are now kept and sent again. The home page's lobby frame is titled 'the 3D intro video'.
- Why it matters: Words people (or a screen reader) see, so not fixed by the review.
- Suggested fix: 'Offline: taps will be sent when the signal is back' (check the tests that pin it), and 'the intro film'.
- Status: Open

### IP-20261111-22: Handbook sheets retry after an unclear mail failure
- Severity: Low
- Where: scripts/handbook/handbook-print.mjs:200-225 (older than this period)
- What: A send that timed out or closed after the message body went is retried 15 minutes later, and the next half-hourly run may print again.
- Why it matters: Gmail may already have taken the first one, so the three full-name sheets could print twice. The letterhead job forbids retries for this reason.
- Suggested fix: Retry only failures from before the body was sent, or record in CLAUDE.md that a second set of sheets is accepted.
- Status: Open

## Closed findings

### IP-20261111-13: The Grand welcome rule still said the other screens show the switching card
- Severity: Medium
- Where: CLAUDE.md Grand welcome bullet, shared/grandWelcomeWeek.js header (after commit cd096b1)
- What: Both said classic weeks show the Switching to opening ceremony card. Since cd096b1 the lead-in film plays every week.
- Why it matters: The next session reading that bullet would put the card back.
- Suggested fix: Say the other screens follow `leadInStyle` and `LEAD_IN_ON`.
- Status: Fixed in 8a2beff

### IP-20261111-14: Comments still called the lobby's intro the 3D intro
- Severity: Low
- Where: nine comments in lobby/, site/lib/largeFiles.js, printer/components/home/, printer/reel/, one CLAUDE.md line (after commit 40c79c2)
- What: The intro is the flat Six doors film now, made in video/lobby-intro/.
- Why it matters: Stale words send the next reader to the wrong folder.
- Suggested fix: Say 'the intro film'.
- Status: Fixed in 05caa16

### IP-20261111-15: Three lines that named things since renamed or removed
- Severity: Low
- Where: CLAUDE.md (the promos' Wordmark), lobby/src/hooks/useSync.js:129, scripts/letterhead/letterhead-print.mjs:3 and :9
- What: The Wordmark was deleted with the fall posters, the scoreboard doorbell is read by the lobby too, and the print page and workflow were renamed.
- Why it matters: Drift between the words and the code.
- Suggested fix: Correct the words.
- Status: Fixed in b64c75a0

## Review log

- 2026-11-11: set up. Starting point 58721b9 (2026-11-03), so the first review covers the week before. No review run yet.
- 2026-11-11: first review, by Fable with four Fable helpers (the owner asked for Fable this once). 58721b9..331b5cc, 171 commits (about 165 without the bots). 22 findings: 1 High, 8 Medium, 13 Low. Fixed 3 (13, 14, 15: stale words in docs and comments). Nothing weakened a privacy rule; no paid-plan risk found.

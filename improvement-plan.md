# Improvement plan (weekly code review)

Every Wednesday at 6:47 am Eastern a scheduled Claude session (Opus) reviews what
changed in this repo since the last review and writes what it found here. The owner
set this up on 2026-11-11. This file is both the instructions for that review and
its record. It lives on `main`; the next review reads its starting point from here.

## State

- Last review date: 2026-11-04
- Last reviewed commit: 58721b9
- Reviews done: 0 (the line above is the starting point; nothing before it has been reviewed)

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

None yet.

## Closed findings

None yet.

## Review log

- 2026-11-11: set up. Starting point 58721b9 (2026-11-03), so the first review covers the week before. No review run yet.

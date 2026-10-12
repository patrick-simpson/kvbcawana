# kvbc-awana — conventions for Claude

One repo for KVBC's Awana screens, merged 2026-10-01 with the full history of
the three old repos: the lobby signage and projector (`lobby/`, was
Awana-Check-in-Display), the Journey kiosk (`journey/`, was Journey-Display)
and the Club Label Printer (`printer/`, was Print-TwoTimTwo-Labels). **Each
folder's own `CLAUDE.md` holds that app's rules and is authoritative for it**;
read it before changing anything inside.

## Git workflow

Push directly to `main` (the owner's standing rule for every app here; the
printer repo used PRs). Before a push, run that app's own checks (each
`CLAUDE.md` names them) and keep one finding per commit. No model names in
commits or files.

## What runs today

- `.github/workflows/ci.yml` runs on every push and PR: each app's checks as
  its old repo ran them (all on Node 22; its "What changed" job skips the
  lobby's 7.5-minute suite and the printer's 3-minute one only when every
  changed file is one that suite never reads, so a Worker-only change
  deploys in about 2 minutes; keep that job's lists in step when a suite
  starts reading another folder), `scripts/check-mirrors.mjs` (the
  contract and envelope vectors, the brand kit and `family.css`, which must be
  byte-identical across the apps; canonical first: the printer's vectors and
  `printer/styles/family.css`, the lobby's `shared/brand/`), and a `site` job
  that builds the one site (once per run: it uploads `site/dist` and
  `site/lib/large-files.generated.js` as a one-day `site-dist` artifact) and
  tests its Pages Function. The lobby runs as two parallel jobs,
  `lobby-checks` (lint, typecheck, vitest) and `lobby-e2e` (build, browser
  smoke; Chromium cached by the `@playwright/test` version in
  `lobby/package-lock.json`). Every `setup-node` caches npm. The printer's
  48 test scripts stay serial on purpose: many bind fixed ports that
  collide across scripts (34573, 34575, 34581, 34583, 34586, 34597).
- `ci.yml`'s deploy job, on `main` only and once everything is green: takes
  the site the `site` job built (it does not rebuild; the `SITE_ORIGIN`
  repository variable is required, and the site job builds with that same
  variable, so they agree), installs only the Worker's packages (wrangler),
  deploys the sync Worker only when its sources changed (every Worker deploy restarts its
  Durable Object and drops every screen's socket), then publishes the site to
  Cloudflare Pages at **awana.kvbchurch.org**: `/` the printer's public site,
  `/lobby`, `/lobby/countdown` (the projector), `/journey`, `/checkin` (the
  phone page), `/settings` (one settings page for every screen, `SETTINGS.md`), `/api` (the Worker), `/updates` (the apps' update feeds).
  Journey is stamped with a hash of its own files, so only a Journey change
  reloads the kiosks.
- Releases: `printer-release.yml` and `desktop-release.yml` (dispatch with
  the version and `ref: main`). Each runs the tests first, creates the tag
  (`printer-v*` / `desktop-v*`), builds and smoke-tests on Windows, publishes
  with `make_latest: false`, and commits the app's update feed into
  `site/updates/`, which only ever moves forward. The delete workflows undo a
  bad release. **Update feeds are ours, not GitHub's "Latest"**: both Electron
  apps use electron-updater's generic provider on
  `awana.kvbchurch.org/updates/printer/` and `/updates/lobby/` (channel
  lobby), with absolute URLs to this repo's release assets (Pages cannot host
  the 170 MB installers).
- Bots: `lobby-update-calendar.yml` and `journey-update-lesson.yml` run
  nightly, commit to `main` (rebase-and-retry) and dispatch `ci.yml`. `clean-artifacts.yml` runs weekly (and by hand) and deletes
  workflow artifacts older than a day: the account has 0.5 GB of Actions
  storage, and the release workflows keep their installer artifacts only a
  day (`retention-days: 1`); the Releases are what people download. The
  per-app `.github/` folders are gone (their workflows were dormant and are
  deleted; the one manual workflow they held that still matters is
  `lobby-update-snapshots.yml`, which regenerates the lobby's visual
  baselines and is dispatched by hand).
- Realtime: since 2026-10-03 every screen listens to the Worker's live channel
  (sign-in with the church passphrase; names stay sealed end to end; the same
  events and sanitizers as the Pusher design). The Pusher keys are cleared and
  the printer relays every frame to the Worker; the Pusher publisher code
  stays until switch day's cleanup.
- **The three old repos are archived** (2026-10-11, after switch day): every
  screen runs on awana.kvbchurch.org and both installed apps update from its
  feeds (their bridge releases, printer 6.22.0 and sound room 1.1.0, went out
  on 2026-10-01). Never work in Print-TwoTimTwo-Labels, Awana-Check-in-Display
  or Journey-Display: all work lands in this repo's folders (a session that
  started in the old lobby repo on 2026-10-11 had to be ported here). Their
  github.io sites still serve the last build, and nothing reads from them (the
  lesson videos come from this repo's own `journey-videos-v2` release).
- `CLOUD-CHECKIN.md` is the plan (owner, 2026-10-11) to retire the check-in
  laptop: the sync Worker talks to TwoTimTwo itself, a Raspberry Pi at church
  prints the labels. Phased, shadow-tested beside the laptop; read it before
  touching check-in, the relay or the print path. TwoTimTwo (Devin) allowed
  it on 2026-10-11: everything encrypted, reads no faster than every 15 s, no
  vendor support. Phase 1 (the Worker's read-only report watcher,
  `lobby/worker/src/twotimtwo.js` / `watcher.js`) is built and idle until the
  `TWOTIMTWO_*` secrets are set.
- `UNIFIED-APP.md` (owner, 2026-10-11): ONE Windows app, **KVBC Awana**
  (printer 9.0.0, `printer/electron-app/`), a print server, a display or
  both per computer, set by a first-run wizard. The sound room app
  (`lobby/desktop/`) ends at 2.1.0, which hands the sound room PC over to it.
  Built on branch `kvbc-awana-v9`, not yet released; its "Still to do" lists
  what the release workflows must change for the rename.
- `AUDIT-2026-10-04.md` is the stability and performance audit; its status
  section says what was fixed on 2026-10-04/05 and what is deferred.

## The move in progress (owner's plan, 2026-10-01)

1. This repo, with history (done).
2. One Cloudflare Pages site at **awana.kvbchurch.org** (done; the printer's
   public site and one About page at `/`, `/lobby`, `/projector` → `/lobby/countdown`,
   `/journey`, `/api`).
3. Pusher replaced by the Worker's own live channel (done 2026-10-03).
4. Every installed app repointed (printer and sound room update feeds, the Pi
   kiosk, Journey's embed, cross-links), one last release from each old repo
   (done by 2026-10-03).
5. A full rehearsal, then ONE switch day (`SWITCH.md` is the runbook) the owner
   picks (never a Wednesday). OBS / ProPresenter feeds carry the passphrase in
   their link (owner's choice). No forwarding from the old github.io addresses.

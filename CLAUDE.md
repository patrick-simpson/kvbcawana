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
  its old repo ran them (all on Node 22), `scripts/check-mirrors.mjs` (the
  contract and envelope vectors, the brand kit and `family.css`, which must be
  byte-identical across the apps; canonical first: the printer's vectors and
  `printer/styles/family.css`, the lobby's `shared/brand/`), and a `site` job
  that builds the one site and tests its Pages Function.
- `ci.yml`'s deploy job, on `main` only and once everything is green: builds
  the site (`site/build.mjs`, `SITE_ORIGIN` required), deploys the sync
  Worker only when its sources changed (every Worker deploy restarts its
  Durable Object and drops every screen's socket), then publishes the site to
  Cloudflare Pages at **awana.kvbchurch.org**: `/` the printer's public site,
  `/lobby`, `/lobby/countdown` (the projector), `/journey`, `/checkin` (the
  phone page), `/api` (the Worker), `/updates` (the apps' update feeds).
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
  nightly, commit to `main` (rebase-and-retry) and dispatch `ci.yml`. The
  apps' own workflows under `lobby/.github/`, `journey/.github/`,
  `printer/.github/` are dormant.
- Realtime: since 2026-10-03 every screen listens to the Worker's live channel
  (sign-in with the church passphrase; names stay sealed end to end; the same
  events and sanitizers as the Pusher design). The Pusher keys are cleared and
  the printer relays every frame to the Worker; the Pusher publisher code
  stays until switch day's cleanup.
- Until switch day (`SWITCH.md`) the church's screens and installed apps may
  still run on the old repos' github.io sites and releases.
- `AUDIT-2026-10-04.md` is the stability and performance audit; its status
  section says what was fixed on 2026-10-04/05 and what is deferred.

## The move in progress (owner's plan, 2026-10-01)

1. This repo, with history (done).
2. One Cloudflare Pages site at **awana.kvbchurch.org** (done; the printer's
   public site and one About page at `/`, `/lobby`, `/projector` → `/lobby/countdown`,
   `/journey`, `/api`).
3. Pusher replaced by the Worker's own live channel (done 2026-10-03).
4. Every installed app repointed (printer and sound room update feeds, the Pi
   kiosk, Journey's embed, cross-links), one last release from each old repo.
5. A full rehearsal, then ONE switch day (`SWITCH.md` is the runbook) the owner
   picks (never a Wednesday). OBS / ProPresenter feeds carry the passphrase in
   their link (owner's choice). No forwarding from the old github.io addresses.

# kvbc-awana — conventions for Claude

One repo for KVBC's Awana screens, merged 2026-10-01 with the full history of
Awana-Check-in-Display (`lobby/`), Journey-Display (`journey/`) and
Print-TwoTimTwo-Labels (`printer/`). **Each folder's own `CLAUDE.md` still
holds that app's rules and is authoritative for it**; read it before changing
anything inside.

## Git workflow

Push directly to `main` (the owner's standing rule for the lobby and Journey
repos, now this one). The printer repo used PRs; in this repo it follows the
same rule as the rest.

## What runs today

- `.github/workflows/ci.yml` tests all three apps on every push, each with its
  old repo's checks, plus `scripts/check-mirrors.mjs`: the contract and
  envelope vectors, the brand kit and `family.css`, which were byte-identical
  copies across the three repos, are compared here directly (canonical first:
  printer's vectors and `styles/family.css`, the lobby's `shared/brand/`).
- `ci.yml`'s deploy job publishes the sync Worker and the one site
  (`site/build.mjs`) to Cloudflare after every green push: **awana.kvbchurch.org**
  (`SITE_ORIGIN` repository variable). The apps' own workflows under
  `lobby/.github/`, `journey/.github/`, `printer/.github/` are dormant; their live
  replacements are at the root: `printer-release.yml`, `desktop-release.yml`
  (each tags `printer-v*` / `desktop-v*`, publishes with make_latest false, and
  writes the app's update feed into `site/updates/`), the delete workflows,
  `journey-update-lesson.yml`, `journey-transcode-all-lessons.yml`,
  `lobby-update-calendar.yml`.
- **Update feeds are ours, not GitHub's "Latest"**: both Electron apps use
  electron-updater's generic provider on `awana.kvbchurch.org/updates/printer/`
  and `/updates/lobby/` (channel lobby), with absolute URLs to this repo's
  release assets (Pages cannot host the 170 MB installers). Two apps in one repo
  cannot both be its single Latest release, which is what the old feeds needed.
- Until switch day (`SWITCH.md`) the church's screens and installed apps still
  run on the old repos' github.io sites and releases.

## The move in progress (owner's plan, 2026-10-01)

1. This repo, with history (done).
2. One Cloudflare Pages site at **awana.kvbchurch.org**: `/` the printer's public
   site and one About page, `/lobby`, `/projector`, `/journey`, `/api` (the sync
   Worker, today `lobby/worker/`).
3. Pusher replaced by the Worker's own live channel (sign-in to listen; names
   stay sealed end to end; same events and sanitizers).
4. Every installed app repointed (printer and sound room update feeds, the Pi
   kiosk, Journey's embed, cross-links), one last release from each old repo.
5. A full rehearsal, then ONE switch day (`SWITCH.md` is the runbook) the owner
   picks (never a Wednesday). OBS / ProPresenter feeds carry the passphrase in
   their link (owner's choice). No forwarding from the old github.io addresses.

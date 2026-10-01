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
- **Nothing deploys from this repo yet.** The apps' own workflows sit dormant
  under `lobby/.github/`, `journey/.github/` and `printer/.github/` (GitHub reads
  only the root's), and the live sites, releases and auto-update feeds still
  come from the three old repos until switch day.

## The move in progress (owner's plan, 2026-10-01)

1. This repo, with history (done).
2. One Cloudflare Pages site at **awana.kvbchurch.org**: `/` the printer's public
   site and one About page, `/lobby`, `/projector`, `/journey`, `/api` (the sync
   Worker, today `lobby/worker/`).
3. Pusher replaced by the Worker's own live channel (sign-in to listen; names
   stay sealed end to end; same events and sanitizers).
4. Every installed app repointed (printer and sound room update feeds, the Pi
   kiosk, Journey's embed, cross-links), one last release from each old repo.
5. A full rehearsal on the temporary address, then ONE switch day the owner
   picks (never a Wednesday). OBS / ProPresenter feeds carry the passphrase in
   their link (owner's choice). No forwarding from the old github.io addresses.

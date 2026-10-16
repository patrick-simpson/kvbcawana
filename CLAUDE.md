# CLAUDE.md — kvbc-awana (root rules)

This one repo holds three apps for Kennebec Valley Baptist Church's Awana club:

- `lobby/`: signage, the projector screens, the sync Worker, and the sound-room app.
- `journey/`: the Journey room kiosk.
- `printer/`: the Club Label Printer.

**Before changing anything inside an app folder, read that folder's own `CLAUDE.md`.** It is the authority for that app. The long-term plans are in `ROADMAP.md`.

## Git

- Push to `main` directly, as the owner's standing rule. Do not create branches or pull requests unless asked.
- Run the app's own checks before committing. Each app's `CLAUDE.md` names them.
- Make one finding per commit.
- Model names are allowed in commit messages and files.
- Never work in the archived repos (`Print-TwoTimTwo-Labels`, `Awana-Check-in-Display`, `Journey-Display`). All work lands here.

## CI and deploy

- `.github/workflows/ci.yml` runs on every push and pull request, using Node 22. It runs each app's checks.
- `scripts/check-mirrors.mjs` confirms that shared files match across apps. The brand kit has one master copy, in `lobby/shared/brand/`. Copies are made at build time by `scripts/family-assets.mjs`. Do not edit the copies.
- Deploy runs only on `main`, after all checks pass. It builds the site and publishes it to Cloudflare Pages at awana.kvbchurch.org. It deploys the sync Worker only when the Worker's files changed.
- Every Worker deploy restarts the Durable Object and drops every screen's connection. Avoid unneeded Worker deploys.
- Journey kiosks reload only when Journey's own files change.
- Release workflows (`printer-release.yml`, `desktop-release.yml`) build installers. Installer files are kept one day, then deleted by a cleanup job. The update feeds live on our site, not on GitHub's "Latest" releases.
- `brand-catalog-release.yml` is run by hand. It downloads the large catalog PDF to a release. Never add that PDF to the repo.
- Nightly bots commit to `main`. `lobby-update-calendar.yml` and `journey-update-lesson.yml` run each night. `clean-artifacts.yml` deletes old workflow files to save storage.

## Costs: everything stays free

- Every part runs on a free plan: Cloudflare Workers free tier, Durable Objects and D1 free allowances, and GitHub Actions free minutes and storage.
- Any change that needs a paid plan is the wrong change.
- Encryption and decryption run in the browser or the app, never in the Worker. The Worker only routes and stores scrambled data.

## Current state

- Live updates: every screen connects to the Worker's live channel. Names are sealed end to end. The old Pusher service is gone.
- The check-in laptop is being retired in phases. Read `ROADMAP.md#cloud-check-in` before touching check-in, the relay, or the print path.
- The one-app plan (`ROADMAP.md#kvbc-awana-one-app`) is built on branch `kvbc-awana-v9` and is not released yet.

## Deferred work (do not start unless the owner asks)

- Split the large file `printer/chrome-extension/content.js` (about 5,200 lines), and add a test harness for the extension.
- Remove the remaining Pusher code from the print server (`ROADMAP.md#switch-day-cleanup`).
- Open audit items: the second public Worker address in `lobby/worker/wrangler.toml`, extra lobby test suites not yet in CI, the extension's local network calls, and the repair installer's missing hash check.

## Keeping it simple and safe

- Prefer small, clear changes. Explain each change in plain English.
- Read a file before changing it.
- Use helper agents for simple, low-stakes jobs such as running a check or searching for text. Use Claude Haiku (the fast, low-cost model) for these. Keep harder work with the main model.
- Never store passwords, tokens, or passphrases in files.
- If a check fails, stop and report it. Do not change a test to make it pass.

# Switch day: moving the screens to awana.kvbchurch.org

One day, any day but Wednesday. About 30 minutes of walking round, plus the
releases (Claude runs those). Until this day nothing at church changes: the
TVs, the projector, Journey and the check-in laptop all run on the old
github.io addresses and Pusher.

## Before the day (done)

- The one site at **https://awana.kvbchurch.org** (`/`, `/lobby/`,
  `/projector`, `/journey/`, `/api`), built and deployed from this repo.
- The sync Worker's live channel (`/api/v1/live`); screens signed in listen
  there instead of Pusher, and the printer relays every frame to it.
- Auto-update feeds on the site: `/updates/printer/latest.yml` and
  `/updates/lobby/lobby.yml`, written by `printer-release.yml` and
  `desktop-release.yml` (the installers stay GitHub release assets here).
- Stable download links: `/download/club-label-printer`, `/download/lobby-display`.

## On the day: the releases (Claude)

The laptops and the sound room PC still check their OLD repos for updates, so
the first release of each must go out from the old repo once more, built from
this repo's folder. That one release is the bridge: it points every later
update at awana.kvbchurch.org/updates/.

**Pick the bridge versions first.** electron-updater never downgrades, and
this repo's release workflows now refuse a feed that does not move forward.
So each bridge version must be above ALL of: what the machines have installed
(the printer dashboard's version; the sound room app's tray), the old repo's
latest release, and what this site's feed already names
(`site/updates/printer/latest.yml`, `site/updates/lobby/lobby.yml`; on
2026-10-04 those were 7.11.0 and 1.1.0, and the tag `desktop-v1.1.0` already
exists here, so the sound room bridge is at least 1.1.1). An earlier draft of
this page named 6.22.0 and 1.1.0: following it would have moved the printer
feed backwards and stopped every updated laptop from updating. Below, P and S
are the versions you picked.

1. **Printer P.** Bump `printer/` (`node scripts/bump-version.cjs P` in
   `printer/`, lockfiles, changes.md), push here, run **Release Club Label
   Printer** (`printer-release.yml`, version P): the feed on the site now
   names P. Then push the same code to the old repo (`git subtree split
   --prefix=printer` → Print-TwoTimTwo-Labels `main`) and dispatch its
   `create-release-tag.yml` with P, so the installed laptops update to it.
2. **Sound room app S.** The same with `lobby/desktop/` (its site is now
   awana.kvbchurch.org/lobby/): bump `lobby/desktop/package.json` to S (and
   its lockfile), `desktop-release.yml` here, then the old repo's
   `create-desktop-release.yml` from `git subtree split --prefix=lobby`.

Both install themselves when nothing is on screen.

## On the day: walking round (you)

| Where | What |
| --- | --- |
| **Check-in laptop, first** | Printer app updates to P (or download it from awana.kvbchurch.org/download/club-label-printer). Dashboard → Settings → **Sync service** → type the passphrase → Sign in. |
| **Each lobby TV** (browser) | Open **awana.kvbchurch.org/lobby/**, gear → Settings → Setup → type the passphrase. Set it as the browser's start page / kiosk URL. |
| **Sound room PC** | The app updates to S and opens awana.kvbchurch.org/lobby/ by itself. Tray → *Set up on this screen* → type the passphrase once. |
| **Projector PC** | Open **awana.kvbchurch.org/projector**, menu → Display Settings → type the passphrase. |
| **Journey Pi** | Change the kiosk URL to **awana.kvbchurch.org/journey/** (`journey/PI_SETUP.md`, the autostart line), reboot, Settings → Sync → passphrase. |
| **OBS / ProPresenter** | Browser source URL: `https://awana.kvbchurch.org/lobby/?passphrase=kennebec` (add `&key=…` flags as before). |

Then press **Night Test** on the printer dashboard: every screen should show
it.

## After the day

- Pusher off (done 2026-10-03, at the owner's word that every screen was
  moved): clear the Pusher keys on the printer dashboard, delete the
  `PUSHER_*` secrets and the `PUSHER_APP_KEY` / `PUSHER_CLUSTER` variables
  here (the next deploy deletes the Worker's own copies, and the site has
  built without a Pusher key since that day), then delete the Pusher app.
- Archive the three old repos (read-only; their Journey video release keeps
  serving the lesson videos, which `journey/public/src/schedule.js` still reads).
- A screen nobody remembered keeps showing the old site, which stops getting
  check-ins once Pusher is off: open awana.kvbchurch.org on it.

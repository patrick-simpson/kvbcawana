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

1. **Printer 6.22.0.** Bump `printer/` (`node scripts/bump-version.cjs 6.22.0`
   in `printer/`, lockfiles, changes.md), push here, run
   **Release Club Label Printer** (`printer-release.yml`, version 6.22.0): the
   feed on the site now names 6.22.0. Then push the same code to the old repo
   (`git subtree split --prefix=printer` → Print-TwoTimTwo-Labels `main`) and
   dispatch its `create-release-tag.yml` with 6.22.0, so installed 6.21.0
   laptops update to it.
2. **Sound room app 1.1.0.** The same with `lobby/desktop/` (its site is now
   awana.kvbchurch.org/lobby/): `desktop-release.yml` here, then the old
   repo's `create-desktop-release.yml` from `git subtree split --prefix=lobby`.

Both install themselves when nothing is on screen.

## On the day: walking round (you)

| Where | What |
| --- | --- |
| **Check-in laptop, first** | Printer app updates to 6.22.0 (or download it from awana.kvbchurch.org/download/club-label-printer). Dashboard → Settings → **Sync service** → type the passphrase → Sign in. |
| **Each lobby TV** (browser) | Open **awana.kvbchurch.org/lobby/**, gear → Settings → Setup → type the passphrase. Set it as the browser's start page / kiosk URL. |
| **Sound room PC** | The app updates to 1.1.0 and opens awana.kvbchurch.org/lobby/ by itself. Tray → *Set up on this screen* → type the passphrase once. |
| **Projector PC** | Open **awana.kvbchurch.org/projector**, menu → Display Settings → type the passphrase. |
| **Journey Pi** | Change the kiosk URL to **awana.kvbchurch.org/journey/** (`journey/PI_SETUP.md`, the autostart line), reboot, Settings → Sync → passphrase. |
| **OBS / ProPresenter** | Browser source URL: `https://awana.kvbchurch.org/lobby/?passphrase=kennebec` (add `&key=…` flags as before). |

Then press **Night Test** on the printer dashboard: every screen should show
it.

## After the day

- After a good club night: clear the Pusher keys on the printer dashboard,
  delete the `PUSHER_*` secrets here (the Worker stops sending to Pusher by
  itself), and delete the Pusher app.
- Archive the three old repos (read-only; their Journey video release keeps
  serving the lesson videos, which `journey/public/src/schedule.js` still reads).
- A screen nobody remembered keeps showing the old site, which stops getting
  check-ins once Pusher is off: open awana.kvbchurch.org on it.

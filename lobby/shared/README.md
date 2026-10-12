# Shared Awana data (`/shared/`)

> **This directory is the canonical copy.** It originated in the retired
> **KVBC-Awana-Countdown** repo; edit schedule/theme data here.

This directory is the **single source of truth** for shared Awana app
data. It is copied into `lobby/dist/shared/` at build time; the one site
(`site/build.mjs`) copies that under `/lobby/`, so it is served at:

    https://awana.kvbchurch.org/lobby/shared/schedule.json
    https://awana.kvbchurch.org/lobby/shared/theme.json
    https://awana.kvbchurch.org/lobby/shared/art/<file>.png

Consumers:

- **The presentation page** (this repo, `/countdown.html`) — imports both
  JSONs at build time (`src/presentation/lib/shared-config.js` validates
  them; a bad file fails lint/test/build before it can deploy).
- **The signage page** (this repo, `/index.html`) — fetches both at
  runtime with a localStorage cache and baked-in fallbacks
  (`sharedScheduleUrl` / `sharedThemeUrl` in `src/config.js`).
- **Print-TwoTimTwo-Labels** — no runtime dependency: the print server's
  group schedule is a dashboard-edited local config
  (`print-server/church-config.json`), not a fetch of these files.

## `schedule.json` (v1)

```jsonc
{
  "version": 1,
  "timezone": "America/New_York",     // informational; times are local wall-clock
  "meeting": { "day": 3, "start": "18:00" },  // 0=Sun … 6=Sat
  "windows": [
    // Gap-free evening. kinds: "slideshow" (needs deck: opening|closing),
    // "game" (needs clubs: [club ids]), "shutdown".
    { "kind": "game", "clubs": ["tnt"], "title": "T&T Game Time", "start": "18:05", "end": "18:30" }
  ],
  "specialDates": {
    // Either cancel a night…
    "2026-11-25": { "noClub": true, "label": "Thanksgiving Break" },
    // …or fully REPLACE the window table for one date (no partial patches):
    "2026-12-16": { "label": "Store Night", "windows": [ /* same shape as windows */ ] }
  }
}
```

Times are `"HH:MM"` local wall-clock strings. A `specialDates` key is a local
`YYYY-MM-DD` date. A replacement table applies on that date even if it is not
the normal meeting day.

## `theme.json` (v1)

Per-club identity: display `name`, `color` (hex), `aliases` (lowercase
spellings other systems may send), and `art` paths **relative to this
directory's URL**. `"monochrome": true` marks black-ink logos (Trek, Journey)
that consumers must invert or recolor on dark backgrounds.

The four scheduled-club colors are mirrored in `src/presentation/index.css`
(`--color-club-*`); `src/presentation/lib/shared-config.test.js` fails if
they drift.

## Versioning

`version` is bumped only on breaking shape changes. Additive fields are fine
without a bump. When bumping, update every consumer in the same change
set — the schedule/theme tests in this repo pin these shapes.

## `sync-protocol.js` (the one sync client's protocol)

The sync service's wire protocol for every client: address validation (https,
at most `SYNC_URL_MAX` = 200 characters), session and display-key shapes, the
passphrase normalization, request building, and reading the login / session /
publish answers. Dependency-free (no imports, DOM, Node or storage): each
client keeps its own transport, storage (browser localStorage, Electron
safeStorage, config.json) and offline cache.

- The lobby imports it (`src/lib/syncService.js`, `src/lib/syncSpecs.js`, which
  the Worker also imports).
- The print server and the Electron app (`printer/print-server/sync-client.js`,
  `printer/electron-app/src/sync-session.js`, `device-sync.js`) run a
  **generated CommonJS copy**, `printer/print-server/sync-protocol.js`: the
  packaged Windows app has no `lobby/` folder and cannot `require` an ES module.
  After editing the canonical file run `node scripts/gen-sync-protocol.mjs`;
  `node scripts/check-mirrors.mjs` fails CI when the copy is stale.
- Journey's `public/src/sync.js` is a browser script with its own copy of the
  session pattern; it is not on this module yet.

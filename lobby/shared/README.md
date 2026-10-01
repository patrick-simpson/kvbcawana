# Shared Awana data (`/shared/`)

> **This directory is the canonical copy.** It originated in the retired
> **KVBC-Awana-Countdown** repo; edit schedule/theme data here.

This directory is the **single source of truth** for shared Awana app
data. It is copied into `dist/shared/` at build time and served by
GitHub Pages at:

    https://<owner>.github.io/Awana-Check-in-Display/shared/schedule.json
    https://<owner>.github.io/Awana-Check-in-Display/shared/theme.json
    https://<owner>.github.io/Awana-Check-in-Display/shared/art/<file>.png

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

# Presentation-tool migration & KVBC-Awana-Countdown retirement plan

The full presentation tool now lives in this repo at
`src/presentation/` → deployed as `/countdown.html`. The original
**KVBC-Awana-Countdown** repo was left untouched and keeps working; the
two can run side by side for as long as needed.

## Current state

- **This repo's `shared/` is now canonical** (see `shared/README.md`).
  The copy in KVBC-Awana-Countdown is frozen; edit here only.
- The signage page runtime-fetches this repo's own
  `…/Awana-Check-in-Display/shared/*.json` (see `sharedScheduleUrl` /
  `sharedThemeUrl` in `src/config.js`).
- The presentation page reads the same copy at build time
  (`src/presentation/lib/shared-config.js`) — no runtime dependency on
  the old repo.

## Retirement checklist (do these in order, when ready)

1. ~~**Repoint this repo's signage config**~~ — **done 2026-07-17**:
   `sharedScheduleUrl` / `sharedThemeUrl` in `src/config.js` now point at
   `https://<owner>.github.io/Awana-Check-in-Display/shared/…` (plus the
   matching URLs in `src/lib/theme.test.js`).
2. ~~**Repoint the printer repo**~~ — **closed as a no-op 2026-07-17**:
   verified Print-TwoTimTwo-Labels has no runtime consumer of the old
   `shared/` URLs. Its group schedule is a dashboard-edited local config
   (`print-server/church-config.json`); the earlier claim that it fetches
   `schedule.json` at server startup was stale documentation.
3. **Operator cutover:** switch the projector machine's kiosk
   bookmark/autostart from `…/KVBC-Awana-Countdown/` to
   `…/Awana-Check-in-Display/countdown.html`. localStorage does not
   cross origins, so on the new page re-enter the Pusher key once
   (QuickNav → Display Settings, or `?key=…&cluster=…` on first
   load); birthdays sync themselves from the print server's broadcast.
   *Tooling shipped 2026-07-18:* the presentation page detects a
   fresh origin (no key) and shows a dismissible setup note (a strip in
   the wall's bottom margin, clear of every view) pointing at that
   QuickNav action — the cutover is a self-guided one-step
   now (the CSV roster was retired in favor of live sync).
4. ~~**Flip canonical (this repo's half)**~~ — **done 2026-07-17**:
   `shared/README.md` here now declares this copy canonical. The old
   repo's README/transition note still needs the matching update (fold
   into step 5).
5. **Archive:** update the old repo's README, optionally add a redirect
   page, then archive KVBC-Awana-Countdown. Keep its Pages site up until
   step 3 (kiosk cutover) has happened and this repo's repoint (step 1)
   has deployed to `main`.

## Follow-up ideas (optional, not required)

- ~~Unify the presentation page's ambient `useWeather` with the signage
  `lib/weather.js`~~ — **done 2026-07-18**: both apps read through
  `fetchCurrentWeather` + `getWeatherType` in `src/lib/weather.js`
  (added to the presentation import allowlist in CLAUDE.md).
- ~~Retire the signage corner `CountdownTimer.jsx` chip~~ — **done
  2026-07-18**: removed from the DataCycle rotation and sticker layout;
  the presentation tool owns countdown duty. The component file and its
  `resolveTarget` tests remain one release for easy revert.

// Timing and cap constants shared across the signage app. Gathered in
// one place so tuning a club-night behavior never means hunting through
// components — and so operator-tunable values (see config.js) have one
// canonical baked fallback.

// How many ops (printer telemetry) failures the Signal sticker keeps.
export const OPS_FAILURES_MAX = 20;

// A stage layer that crashed shows on the Signal sticker for this long after
// its LAST crash. Every stage ErrorBoundary retries on the 30 s boardNow tick,
// so a persistent fault re-crashes and never ages out; a one-off disappears.
export const LAYER_FAULT_SHOW_MS = 10 * 60 * 1000;

// Milestone / club-milestone toast hold time.
export const MILESTONE_TOAST_MS = 6000;

// Settings gear fades after this much mouse stillness.
export const GEAR_IDLE_MS = 3000;

// The first-run setup card waits this long after the lobby's last name has
// gone before it comes back. On a screen that is not keyed yet the card is
// always due, and check-ins a few seconds apart would otherwise have it pop
// in for a second between every pair of names.
export const SETUP_CARD_QUIET_MS = 5000;

// Grace period before a dropped realtime pipe forces the status sticker
// visible — ordinary reconnect blips stay silent.
export const DROPPED_GRACE_MS = 8000;

// How long a climbing tally may run with no check-in NAMES arriving before the
// screen says so. This catches the case where the PRINT SERVER is the side
// missing its display key: it keeps publishing plaintext counts but nothing on
// the sealed name events, so the screen would otherwise look like a quiet night
// and nobody would investigate. Generous on purpose — a real lull between
// arrivals is normal, and a false alarm on the lobby wall costs trust.
export const COUNTS_WITHOUT_NAMES_MS = 6 * 60 * 1000;

// Check-in queue. Past this many waiting children the room is in a rush:
// confetti thins so back-to-back bursts hold 60fps, and the "+N more coming"
// chip shows. A rush never shortens anyone's hold (src/lib/checkInQueue.js).
// The queue is capped against a runaway/duplicated feed.
export const BURST_THRESHOLD = 2;
export const MAX_QUEUE = 100;

// Fallback banner hold when the configured duration is invalid.
export const DEFAULT_HOLD_MS = 6000;

// Seen-events dedupe ledger cap (day-stamped localStorage, same lifetime as
// the tally it guards; see useSeenEvents.js).
export const SEEN_EVENTS_MAX = 500;

// Refuse to trust a calendar scrape that lost most of the calendar.
export const MIN_CLUB_EVENTS = 5;

// Self-heal watchdog: reload the page after this long continuously
// disconnected (minutes, overridable via config.watchdogReloadMin), with
// at most this many automatic reloads per hour so a dead network can't
// put the display in a reload loop.
export const WATCHDOG_DISCONNECT_MIN = 30;
export const WATCHDOG_MAX_RELOADS_PER_HOUR = 2;

// Lobby "tonight" ticker (onTonight): the printer broadcasts aggregate
// counts periodically, so a gap this long means the print server has
// gone quiet — hide the strip rather than freeze it on a stale number.
// Mirrors the presentation tool's own TALLY_STALE_MS idiom.
export const TONIGHT_STALE_MS = 10 * 60 * 1000;

// Corner "Tonight" counter reconciliation (the `tally` event, numbers-only
// per-club counts + total). This used to be a wall-clock freshness window
// (`now - at <= TALLY_STALE_MS`), which was wrong in a way that only shows
// up on real hardware: a broadcast that arrives has (almost always) just
// been sent — while a signage TV's clock can sit minutes or hours off the
// check-in laptop's. On such a screen every broadcast looked stale, the
// counter never reconciled, and bump() drifted it high all night with
// nothing to pull it back. Broadcasts are now ordered against EACH OTHER
// instead: one stamped older than the last adopted broadcast is genuinely
// out of order and dropped (the sync service's replay of the LAST stored
// tally to a new connection is the one old broadcast that does arrive, and
// TALLY_EARLIER_NIGHT_MS turns away one from an earlier night). That is a
// seconds-scale phenomenon, so a
// broadcast older by MORE than this window is read as the printer's own
// clock having moved (a restart, an NTP correction) and re-baselines
// rather than deadlocking the counter forever.
export const TALLY_REORDER_MS = 60 * 1000;

// A tally older than this by the screen's own clock is from an earlier night
// (the sync service replays the last one it stored to every new connection),
// never tonight's count. Far past any real skew between a screen and the
// check-in laptop, far short of a week.
export const TALLY_EARLIER_NIGHT_MS = 18 * 60 * 60 * 1000;

// How long after adopting a printer `tally` an UNSTAMPED check-in is assumed
// to be already counted by it. The printer publishes a check-in and the tally
// that includes it milliseconds apart, but the display's two paths are not
// symmetric: plaintext `tally` dispatches synchronously while a sealed
// `checkin` waits on a decrypt, so the tally routinely lands first. A check-in
// that carries its own `at` is compared against the tally directly and never
// needs this; this window only covers a producer old enough not to stamp one.
// Small on purpose: it must cover a publish-order inversion, not a lull.
export const TALLY_BUMP_GRACE_MS = 1500;

// Church-authored announcements (onNotice) expire after this long so a
// forgotten "CLUB CANCELLED TONIGHT" can never haunt the screen into
// next week's club night.
export const NOTICE_MAX_AGE_MS = 4 * 60 * 60 * 1000;

// Double-click fullscreen, handed UP to the parent page when this app is
// running inside an iframe (the Journey Display kiosk). Its
// `public/src/schedule.js` listens for this message and fullscreens its whole
// page, because fullscreening just the frame hides Journey's own corner
// buttons. Both sides have to spell the string the same way, so it lives here
// rather than inline at the one call site.
export const EMBED_FULLSCREEN_MESSAGE = 'awana-display:toggle-fullscreen';

// Self-updating pages (see CLAUDE.md, "Self-updating pages"). A display that
// has been running for days polls version.json this often, and again on the
// browser's `online` event no more than once per BUILD_ONLINE_MIN_MS, because
// `online` fires in bursts on a flaky church connection. Once a newer build is
// known the page re-asks every BUILD_BUSY_RECHECK_MS instead, since the only
// thing left to wait for is the screen going quiet. There is deliberately NO
// deadline: a busy screen is never reloaded out from under the room.
export const BUILD_CHECK_MS = 3 * 60 * 1000;
export const BUILD_BUSY_RECHECK_MS = 15 * 1000;
export const BUILD_ONLINE_MIN_MS = 60 * 1000;
export const BUILD_PROBE_TIMEOUT_MS = 5000;
// Every other network request (src/lib/timedFetch.js): long enough for a slow
// church connection to answer a calendar page, short enough that a request
// black-holed by the network fails before the next poll is due.
export const FETCH_TIMEOUT_MS = 15_000;

// How long after the last realtime event the signage page still counts as
// busy. A banner has just come down; give the room a beat before the screen
// blinks.
export const BUILD_QUIET_MS = 5000;

// The sound room desktop app (desktop/, "Awana Lobby Display"): the installer
// on this repo's Latest release, and its volunteer guide. Settings → Setup
// links both. The fixed asset name keeps the download link permanent.
export const DESKTOP_APP_DOWNLOAD_URL = 'https://awana.kvbchurch.org/download/lobby-display';
export const DESKTOP_APP_GUIDE_URL = 'https://github.com/patrick-simpson/kvbcawana/blob/main/lobby/desktop/README.md';

// The family's other screens, linked from Settings → Status → Other screens.
// `?view=game` opens the projector straight into game time (its App.jsx).
export const PROJECTOR_GAME_TIME_URL = 'https://awana.kvbchurch.org/lobby/countdown?view=game';
export const JOURNEY_URL = 'https://awana.kvbchurch.org/journey/';

// How long Settings → Pickup board → "Show a demo on this TV" holds a sample
// board on this screen (owner, 2026-10-01: about 20 seconds).
export const BOARD_DEMO_MS = 20_000;

// Shared settings (contract v6): how long Settings waits after the last
// shared change before sending the set to the print server, so a typed field
// or a run of switches is one publish rather than one each.
export const SHARE_DEBOUNCE_MS = 800;

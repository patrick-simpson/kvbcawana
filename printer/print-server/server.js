// Club Label Print Server
// Started by the KVBC Awana app (or `node server.js`) — listens on http://localhost:3456
// Accepts POST /print and silently prints a 4×2 in label as PNG via canvas.

'use strict';

// ── Process-level safety net ──────────────────────────────────────────────────
// Last line of defence: if something unexpected bubbles all the way up, log it
// but NEVER crash the process — a live event cannot afford a dead print server.
process.on('uncaughtException',  err => console.error('[fatal] Uncaught exception (server kept alive):', err));
process.on('unhandledRejection', err => console.error('[fatal] Unhandled rejection (server kept alive):', err));

// The server is split into the modules under server/ (one per section of the old
// single file). They load here in the order that file ran, so the middleware and the
// routes register in the same order; this file keeps every name the tests and the
// Electron shell import, and the standalone start-up.
const security = require('./security');
const tonightRules = require('./tonight');
const {
  REPORT_FRESH_MS, normalizedName, displayClub, splitFullName, historyIdentityKey, reportEntryIdentityKey,
  identityKeysOfRow, identityKeysOfReportEntry, distinctReportChildren, reportIsPartial, massUndoRefused,
} = tonightRules;
const $config = require('./server/config');
const $eventBuffer = require('./server/event-buffer');
require('./server/label-layout');
const $clubbers = require('./server/clubbers');
const $eligibility = require('./server/eligibility');
const $images = require('./server/images');
const $labelType = require('./server/label-type');
const $labelRender = require('./server/label-render');
const $printing = require('./server/printing');
const $tunes = require('./server/tunes');
const $ledger = require('./server/ledger');
const $tags = require('./server/tags');
const $http = require('./server/http');
require('./server/checkin-print');
const $history = require('./server/history');
const $tonightCount = require('./server/tonight-count');
require('./server/reprint');
const $leaders = require('./server/leaders');
const $customPdf = require('./server/custom-pdf');
const $feedRoutes = require('./server/feed-routes');
const $publishers = require('./server/publishers');
const $relay = require('./server/relay');
const $station = require('./server/station');
require('./server/canary');
const $spooler = require('./server/spooler');
const $updates = require('./server/updates');
const $configRoutes = require('./server/config-routes');
require('./server/diagnostics');
const $lifecycle = require('./server/lifecycle');
const app = $http.app;

module.exports = {
  configureCloud: $station.configureCloud, stopCloud: $station.stopCloud,
  // The church settings from the Worker (church-sync.js) and the switch-aware gates.
  get churchSync() { return $station.churchSync; }, startChurchSync: $station.startChurchSync, stopChurchSync: $station.stopChurchSync,
  singlePublisherSilent: $station.singlePublisherSilent, cloudStatus: $station.cloudStatus, clearCheckThePrinter: $station.clearCheckThePrinter, importLaptopHistory: $station.importLaptopHistory, mergeAttendance: $station.mergeAttendance,
  app, startListening: $lifecycle.startListening, stopListening: $lifecycle.stopListening, isBusy: $http.isBusy, resetRelayForTest: $relay.resetRelayForTest, setLatestVersion: $updates.setLatestVersion, setOpsAlertHandler: $eventBuffer.setOpsAlertHandler,
  // For the Electron shell: this module is require-cached across settings
  // saves, so the shell pushes the freshly merged config.json and printer
  // name into the LIVE module instead of relying on load-time state.
  applySavedConfig: $configRoutes.applySavedConfig, setPrinterName: $config.setPrinterName,
  // Pure helpers exported for scripts/test-server-helpers.cjs — they carry
  // the assumptions about TwoTimTwo's real /clubber/csv export format.
  parseCSV: $clubbers.parseCSV, normalizeHeader: $clubbers.normalizeHeader, findClubberIn: $clubbers.findClubberIn, parseNoPhoto: $eligibility.parseNoPhoto, noPhotoFor: $eligibility.noPhotoFor,
  lateGoToLine: $ledger.lateGoToLine, scheduleRowFor: $ledger.scheduleRowFor, DEFAULT_SCHEDULE: $ledger.DEFAULT_SCHEDULE,
  parseYesRelease: $eligibility.parseYesRelease, rosterConsentSummary: $eligibility.rosterConsentSummary, consentWarningFor: $eligibility.consentWarningFor,
  isSafePrinterName: $customPdf.isSafePrinterName,
  parseAllergies: $eligibility.parseAllergies, recapEntriesForTonight: $eventBuffer.recapEntriesForTonight, calendarDaysBetween: $eventBuffer.calendarDaysBetween, isNewerVersion: $updates.isNewerVersion, historyClubImage: $history.historyClubImage,
  historyRowMatches: $history.historyRowMatches, historyIdentityKey, distinctChildrenPrintedToday: $feedRoutes.distinctChildrenPrintedToday,
  reportEntryIdentityKey, computeTonightStats: $tonightCount.computeTonightStats,
  // Tonight's count. authoritativeTonight() is THE definition every surface
  // reads; the setter exists so a test can put the server in report mode (and
  // in stale-report mode) without a scrape, a socket or a wall-clock wait.
  printedTonightFor: $history.printedTonightFor, authoritativeTonight: $tonightCount.authoritativeTonight, tonightHereNow: $tonightCount.tonightHereNow, stillHereEntries: $publishers.stillHereEntries, publishStillHere: $publishers.publishStillHere, publishTally: $publishers.publishTally, sendStationExtras: $station.sendStationExtras, sendGreeting: $relay.sendGreeting, REPORT_FRESH_MS, TALLY_GRACE_MIN: $publishers.TALLY_GRACE_MIN, TALLY_LEAD_MIN: $publishers.TALLY_LEAD_MIN,
  _setLastCheckinReportForTests(report) { $tonightCount.lastCheckinReport = report; },
  _setStillHereWindowForTests(fn) { $publishers.stillHereWindowForTests = fn; },
  _setCheckedOutForTests(date, ids, names) { $tonightCount.checkedOutTonight = { date, ids: new Set(ids), names: new Set((names || []).map(normalizedName)) }; },
  _getLastCheckinReportForTests() { return $tonightCount.lastCheckinReport; },
  // Trophy band (#293) — pure, so the 48-character clip and the malformed-title
  // cases are pinned without rendering a label.
  trophyBandFor: $ledger.trophyBandFor, TROPHY_BAND_MAX: $ledger.TROPHY_BAND_MAX,
  // The shared "who is checked in tonight" set — pure, so it is unit-tested.
  tonightCheckins: $tonightCount.tonightCheckins, splitFullName,
  // The duplicate-print window, exported so a test that has to wait it out
  // reads the real number instead of a copy that drifts (it was 25s while the
  // extension's own client timeout was 35s, which is the bug it now outlasts).
  DUPLICATE_WINDOW_MS: $clubbers.DUPLICATE_WINDOW_MS,
  shouldSendUpdateBeacon: $lifecycle.shouldSendUpdateBeacon, parseLatestChangeEntry: $lifecycle.parseLatestChangeEntry,
  // Attendance ledger — exported so the id-migration and the auto-connect-card
  // signals (firstEver / priorNightExists) can be unit-tested against a temp
  // AWANA_DATA_DIR without driving the whole /print route.
  recordAttendance: $ledger.recordAttendance, isNonCheckinRow: $history.isNonCheckinRow,
  // Range reprint (#257) — the selector is pure, so every exclusion rule
  // (awards, leader tags, failed rows, undone rows, the club filter, the
  // newest-row-per-child dedupe and the cap) is testable without printing.
  selectReprintRange: $history.selectReprintRange, REPRINT_RANGE_MAX: $history.REPRINT_RANGE_MAX, REPRINT_RANGE_GAP_MS: $history.REPRINT_RANGE_GAP_MS,
  dropOffTagFor: $tags.dropOffTagFor, generateDropOffTag: $tags.generateDropOffTag, generateBarfTag: $tags.generateBarfTag, generateBarfBag: $tags.generateBarfBag, barfBagOwner: $tags.barfBagOwner, isBarfNight: $tags.isBarfNight, cleanFriendName: $tags.cleanFriendName, performOneOffPrint: $leaders.performOneOffPrint, oneOffClub: $leaders.oneOffClub,
  localDayISO: $eventBuffer.localDayISO, historyIdentityKey, clubKey: $eligibility.clubKey,
  // Remembered leaders + the one club list every dropdown reads. Pure but for
  // their file, so the upsert/cap/season rules and the club-table agreement
  // are unit-tested against a temp AWANA_DATA_DIR.
  loadLeaders: $leaders.loadLeaders, saveLeaders: $leaders.saveLeaders, rememberLeader: $leaders.rememberLeader, forgetLeader: $leaders.forgetLeader, activeLeaders: $leaders.activeLeaders, leaderKey: $leaders.leaderKey,
  // Free-text labels (POST /print-custom). The validator is pure, so every
  // rejection (blank, too long, control characters) is pinned without a
  // printer; the sizing helpers are pure too, so the wrap/shrink order is
  // testable without reading pixels.
  normalizeCustomText: $customPdf.normalizeCustomText, splitCustomTextInTwo: $labelType.splitCustomTextInTwo, CUSTOM_TEXT_MAX_CHARS: $labelType.CUSTOM_TEXT_MAX_CHARS,
  CLUB_LIST: $labelType.CLUB_LIST, CLUB_DISPLAY_NAMES: $labelType.CLUB_DISPLAY_NAMES, CLUB_MONOGRAM: $images.CLUB_MONOGRAM, LEADERS_MAX: $leaders.LEADERS_MAX, LEADER_ACTIVE_DAYS: $leaders.LEADER_ACTIVE_DAYS,
  // Birthday/cake helpers — the half-birthday rule (#8) has date math worth
  // pinning (June–August gate, day clamping, ISO-week reuse).
  parseBirthdate: $eligibility.parseBirthdate, isBirthdayWeek: $eligibility.isBirthdayWeek, isHalfBirthdayWeek: $eligibility.isHalfBirthdayWeek, isCakeWeek: $eligibility.isCakeWeek, birthdayAgeThisWeek: $eligibility.birthdayAgeThisWeek,
  // Twin-safe labels (#13) — collision detection + hint preference order.
  twinDisambiguation: $eligibility.twinDisambiguation,
  // Screen season (#16/#18) — the computus and the calendar tiling are date
  // math worth pinning; SEASON_KEYS doubles as the dashboard's option list.
  easterSunday: $eligibility.easterSunday, seasonForDate: $eligibility.seasonForDate, SEASON_KEYS: $eligibility.SEASON_KEYS, currentScreenSeason: $eligibility.currentScreenSeason,
  // Musical printer (#11/#12) — the TSPL compiler is the testable artifact.
  buildTuneTspl: $tunes.buildTuneTspl, nextTuneName: $tunes.nextTuneName, TUNE_NAMES: $tunes.TUNE_NAMES, TUNE_ROTATION: $tunes.TUNE_ROTATION,
  // The dispatcher every label print goes through (with its backup printer).
  printLabel: $printing.printLabel, printerFallbackWarnings: $printing.printerFallbackWarnings, backupPrinter: $printing.backupPrinter, printerSetupWarnings: $spooler.printerSetupWarnings,
  // Spooler backlog (#256). The verdict and both parsers are PURE so the one
  // piece of judgement here is exhaustively testable on a machine with no
  // Windows spooler at all — which is every CI runner this repo has.
  summarizeSpoolerJobs: $spooler.summarizeSpoolerJobs, spoolerBacklogMessage: $spooler.spoolerBacklogMessage, parseClearQueueResult: $spooler.parseClearQueueResult,
  SPOOLER_BACKLOG_JOBS: $spooler.SPOOLER_BACKLOG_JOBS, SPOOLER_STUCK_MS: $spooler.SPOOLER_STUCK_MS,
  // Exported for the golden-image suite (scripts/test-label-golden.cjs), which
  // has to render field combinations GET /preview cannot express — a visitor
  // with allergies, a step-up night, an all-fields-on torture case. Going
  // through HTTP would also make every baseline depend on the route's defaults
  // rather than on the renderer itself.
  generateLabel: $labelRender.generateLabel,
  // The label's type helpers (the kit voices over the old fonts), so the golden
  // suite can pin how a line of mixed faces is laid out on a canvas of its own,
  // in checks that do not depend on the host's fonts.
  labelType: $labelType.labelType,
  // The thermal-logo pipeline and the group-line policy, exported so tests can
  // exercise them directly: prepareLogoForThermal against synthetic light-ink /
  // padded / blank images, effectiveHandbookGroup against TwoTimTwo's real
  // pseudo-group values ("all", "Puggles group").
  prepareLogoForThermal: $labelRender.prepareLogoForThermal, effectiveHandbookGroup: $eligibility.effectiveHandbookGroup,
  // The security policy itself is tested through print-server/security.js;
  // re-exported here so a test can assert the server wires up the same module.
  security,
};

if (require.main === module) {
  $lifecycle.startListening();
  // Standalone only: poll the repo VERSION file for /health's update notice.
  // The Electron shell does NOT get this — electron-updater owns its update
  // lifecycle (it reports it through setLatestVersion).
  $updates.checkForUpdates();
  setInterval($updates.checkForUpdates, $updates.UPDATE_CHECK_INTERVAL);
}

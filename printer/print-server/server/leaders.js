'use strict';
// Leader name tags, remembered leaders, one-off name tags.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const events  = require('../events');
const security = require('../security');
const tonightRules = require('../tonight');
const {
  REPORT_FRESH_MS, normalizedName, displayClub, splitFullName, historyIdentityKey, reportEntryIdentityKey,
  identityKeysOfRow, identityKeysOfReportEntry, distinctReportChildren, reportIsPartial, massUndoRefused,
} = tonightRules;
const fs    = require('fs');
const path  = require('path');
const $config = lazy('./config');
const $eventBuffer = lazy('./event-buffer');
const $clubbers = lazy('./clubbers');
const $eligibility = lazy('./eligibility');
const $labelType = lazy('./label-type');
const $labelRender = lazy('./label-render');
const $printing = lazy('./printing');
const $tunes = lazy('./tunes');
const $tags = lazy('./tags');
const $http = lazy('./http');
const $history = lazy('./history');
const $customPdf = lazy('./custom-pdf');
const $configRoutes = lazy('./config-routes');
const $station = lazy('./station');
const app = $http.app;

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  activeLeaders: { enumerable: true, get: () => activeLeaders },
  applyLeaderList: { enumerable: true, get: () => applyLeaderList },
  leadersForChurch: { enumerable: true, get: () => leadersForChurch },
  pendingLeaderKeys: { enumerable: true, get: () => () => [...pendingLeaders.keys()] },
  shareLeaderAdd: { enumerable: true, get: () => shareLeaderAdd },
  shareLeaderForget: { enumerable: true, get: () => shareLeaderForget },
  forgetLeader: { enumerable: true, get: () => forgetLeader },
  LEADER_ACTIVE_DAYS: { enumerable: true, get: () => LEADER_ACTIVE_DAYS },
  leaderKey: { enumerable: true, get: () => leaderKey },
  LEADERS_MAX: { enumerable: true, get: () => LEADERS_MAX },
  loadLeaders: { enumerable: true, get: () => loadLeaders },
  oneOffClub: { enumerable: true, get: () => oneOffClub },
  performOneOffPrint: { enumerable: true, get: () => performOneOffPrint },
  rememberLeader: { enumerable: true, get: () => rememberLeader },
  renderLeaderLabel: { enumerable: true, get: () => renderLeaderLabel },
  renderOneOffLabel: { enumerable: true, get: () => renderOneOffLabel },
  saveLeaders: { enumerable: true, get: () => saveLeaders },
});

// ── Leader name tags ──────────────────────────────────────────────────────────
// A name tag for an adult volunteer: name, a LEADER pill in the visitor-pill
// slot, "<Club> Leader" on the greeting line, the official club mark in the
// icon panel. Same renderer and printer as every other label. Deliberately
// plain: no allergy/birthday/streak icons (those are a child's), no inverted
// palette (black already means step-up, first-timer or award).
//
// A leader tag is a PRINT, never a CHECK-IN. It carries `isLeader` on its
// history row, which isNonCheckinRow() excludes from tonight's stats and the
// lobby tally, the checkin event and recap buffer, the season ledger, the
// checkout board's printed count, the TwoTimTwo write-back CSV, R-1 undo
// reconciliation (and its mass-undo denominator), /reset-tonight and the phone
// roster. This route never calls recordAttendance, events.publish,
// pushEventToBuffer or publishTally.
//
// Reachable from the phone page (relayed, from loopback) and the settings page.
// The phone-never-prints-directly rule exists to keep a KID's label from
// double-printing through the extension's detection paths; a leader has
// nothing to drive on TwoTimTwo, so there is nothing to double.
function renderLeaderLabel({ firstName, lastName, clubName, testBanner = false }) {
  const club = String(clubName == null ? '' : clubName).trim();
  return $labelRender.generateLabel({
    firstName, lastName, clubName: club,
    isLeader: true,
    greeting: club ? `${club} Leader` : 'Leader',
    // The greeting carries the club; the club text line would print it twice.
    template: { showClubLine: false },
    testBanner,
    footerText: $tags.labelFooterText(),
  });
}

// ── Remembered leaders ───────────────────────────────────────────────────────
// The same adults volunteer week after week, so the second time a leader needs
// a tag nobody should have to type their name again. Every successful leader
// print upserts the name here, and the three print surfaces show the remembered
// ones as one-tap chips.
//
// Its OWN file, deliberately not derived from print-history.json: history is
// capped at MAX_HISTORY rows and pruned at historyRetentionDays, so on a busy
// night a leader printed three weeks ago would silently fall out of the chips.
// This file holds one small row per leader and never ages out on its own.
//
// This is adult volunteers' names — the same category of data the dashboard
// already shows, and never a child's — but it is still personal data on disk,
// so it is capped, prunable from the UI, and nothing else is stored: no
// contact details, no birthdate, no attendance.
const LEADERS_FILE = path.join($config.DATA_DIR, 'leaders.json');
const LEADERS_MAX = 80;
// An Awana club year runs roughly September–May. A leader who has not needed a
// tag in that long has missed a whole season, so their chip stops taking up
// room — the row is KEPT, so printing them again brings the chip straight back
// (that is the difference between hiding and the × on the chip, which forgets).
const LEADER_ACTIVE_DAYS = 270;

const leaderKey = (firstName, lastName) => `${firstName || ''} ${lastName || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();

function loadLeaders() {
  try {
    if (!fs.existsSync(LEADERS_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(LEADERS_FILE, 'utf8'));
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const clean = [];
    for (const row of raw) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const firstName = security.sanitizeStoredText(row.firstName || '', 80);
      const lastName = security.sanitizeStoredText(row.lastName || '', 80);
      const key = leaderKey(firstName, lastName);
      if (!key || seen.has(key)) continue;      // a corrupt or duplicated row is dropped, not merged
      seen.add(key);
      const at = Number(row.lastPrintedAt);
      clean.push({
        key,
        firstName,
        lastName,
        clubName: security.sanitizeStoredText(row.clubName || '', 40),
        lastPrintedAt: Number.isFinite(at) ? at : 0,
        printCount: Number.isFinite(Number(row.printCount)) ? Math.max(1, Math.round(Number(row.printCount))) : 1,
      });
    }
    return clean;
  } catch (e) {
    console.warn('[leaders] Failed to load remembered leaders:', e.message);
    return [];
  }
}

function saveLeaders(list) {
  $config.saveFileAtomic(LEADERS_FILE, JSON.stringify(list, null, 2));
}

/**
 * Upsert one leader after a successful print. Newest first, capped — the cap
 * drops the least recently printed, which is the one least likely to be needed.
 * A leader who moves between clubs keeps one row: the club follows the most
 * recent print rather than forking into two chips for the same person.
 * Pure but for the file write, so the ordering/cap/merge rules are unit-tested.
 */
function rememberLeader({ firstName, lastName, clubName }, now = Date.now(), list = loadLeaders()) {
  const key = leaderKey(firstName, lastName);
  if (!key) return list;
  const existing = list.find((l) => l.key === key);
  const next = list.filter((l) => l.key !== key);
  next.unshift({
    key,
    firstName: firstName || '',
    lastName: lastName || '',
    // An explicit club wins; a blank one keeps whatever we knew before, so a
    // quick no-club print does not erase a leader's club.
    clubName: clubName || (existing ? existing.clubName : ''),
    lastPrintedAt: now,
    printCount: existing ? existing.printCount + 1 : 1,
  });
  next.sort((a, b) => b.lastPrintedAt - a.lastPrintedAt);
  const capped = next.slice(0, LEADERS_MAX);
  saveLeaders(capped);
  return capped;
}

/** The × on a chip: forget this leader outright. */
function forgetLeader(key, list = loadLeaders()) {
  const want = String(key || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const next = list.filter((l) => l.key !== want);
  const removed = next.length !== list.length;
  if (removed) saveLeaders(next);
  return { removed, leaders: next };
}

// ── The remembered leaders are a church setting (owner, 2026-10-12) ─────────
// The list lives in the Worker's church settings as `leaders` (routes.md 10.3), so a
// leader remembered on any device is a chip everywhere. leaders.json stays THIS
// computer's copy: the offline fallback the chips and tags read, written through on
// every apply (church-sync.js). The first station seeds the Worker's list from it.
//
// A NEW name printed here is added to the Worker's list through the church settings'
// edit route (church-sync edit: baseRev, a stale base re-read and tried again), and
// kept as PENDING until the Worker has it, so an apply that lands first (or an add
// made with no internet) never drops it; a forget here removes it there too.
const pendingLeaders = new Map();   // key -> entry not yet in the Worker's list
const sharing = new Set();          // keys being added right now

/** The list as the church settings hold it (no derived key). */
function leadersForChurch(list = loadLeaders()) {
  return list.map(({ firstName, lastName, clubName, lastPrintedAt, printCount }) => ({ firstName, lastName, clubName, lastPrintedAt, printCount }));
}

/**
 * The Worker's list over the local one: the Worker decides WHO is remembered (a
 * forget anywhere is a forget here); for a leader both hold, the newer last print
 * and the larger count are kept (a print here may not have reached the Worker);
 * a pending add is kept until the Worker has it. Written through to leaders.json.
 * @returns {boolean} whether leaders.json changed
 */
function applyLeaderList(workerList) {
  if (!Array.isArray(workerList)) return false;
  const local = loadLeaders();
  const byKey = new Map(local.map((l) => [l.key, l]));
  const next = [];
  const seen = new Set();
  for (const w of workerList) {
    const firstName = security.sanitizeStoredText((w && w.firstName) || '', 80);
    const lastName = security.sanitizeStoredText((w && w.lastName) || '', 80);
    const key = leaderKey(firstName, lastName);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    pendingLeaders.delete(key);
    const mine = byKey.get(key);
    const at = Number(w.lastPrintedAt) || 0;
    const count = Math.max(1, Math.round(Number(w.printCount) || 1));
    next.push({
      key, firstName, lastName,
      clubName: security.sanitizeStoredText((mine && mine.lastPrintedAt > at ? mine.clubName : w.clubName) || '', 40),
      lastPrintedAt: Math.max(at, mine ? mine.lastPrintedAt : 0),
      printCount: Math.max(count, mine ? mine.printCount : 1),
    });
  }
  for (const [key, entry] of pendingLeaders) {
    if (seen.has(key)) continue;
    next.push(entry); seen.add(key);
    // Not in the Worker's list yet (an add made offline, or one that lost a race): try again.
    if (!sharing.has(key)) setImmediate(() => { shareLeaderAdd(entry).catch(() => {}); });
  }
  next.sort((a, b) => b.lastPrintedAt - a.lastPrintedAt);
  const capped = next.slice(0, LEADERS_MAX);
  if (JSON.stringify(capped) === JSON.stringify(local)) return false;
  saveLeaders(capped);
  return true;
}

/** A new leader printed here: add them to the Worker's list. Never throws, never awaited by a print. */
async function shareLeaderAdd(entry) {
  if (!entry || !entry.key) return 'none';
  pendingLeaders.set(entry.key, entry);
  if (sharing.has(entry.key)) return 'busy';
  sharing.add(entry.key);
  try {
    const out = await $station.churchSync.edit((settings) => {
      const list = Array.isArray(settings.leaders) ? settings.leaders : [];
      if (list.some((l) => l && leaderKey(l.firstName, l.lastName) === entry.key)) return null;
      return { leaders: [leadersForChurch([entry])[0], ...list].slice(0, LEADERS_MAX) };
    });
    if (out === 'saved' || out === 'unchanged') pendingLeaders.delete(entry.key);
    return out;
  } catch (e) {
    console.warn('[leaders] Could not add to the church settings:', e && e.message);
    return 'error';
  } finally {
    sharing.delete(entry.key);
  }
}

/** The × on a chip here: forget them in the Worker's list too. */
async function shareLeaderForget(key) {
  pendingLeaders.delete(key);
  try {
    return await $station.churchSync.edit((settings) => {
      const list = Array.isArray(settings.leaders) ? settings.leaders : [];
      const next = list.filter((l) => !l || leaderKey(l.firstName, l.lastName) !== key);
      return next.length === list.length ? null : { leaders: next };
    });
  } catch (e) {
    return 'error';
  }
}

/** Chips worth showing: printed within a season, newest first. */
function activeLeaders(list = loadLeaders(), now = Date.now()) {
  const cutoff = now - LEADER_ACTIVE_DAYS * 24 * 60 * 60 * 1000;
  return list.filter((l) => l.lastPrintedAt >= cutoff).sort((a, b) => b.lastPrintedAt - a.lastPrintedAt);
}

// The club list every dropdown reads. Static, but served rather than hardcoded
// per-surface so a club can never again be missing from one of them.
//
// GET and POST both, on purpose: the phone page sends its PIN in the body for
// every call it makes, and a PIN does not belong in a query string where it
// would land in access logs and browser history.
function clubsHandler(req, res) {
  res.json({ clubs: $labelType.CLUB_LIST });
}
app.get('/clubs', clubsHandler);
app.post('/clubs', clubsHandler);

// The remembered leaders, for the chips. `hidden` lets a UI say "3 not printed
// this season" instead of pretending they never existed.
function leadersHandler(req, res) {
  const all = loadLeaders();
  const active = activeLeaders(all);
  res.json({ leaders: active, hidden: all.length - active.length, clubs: $labelType.CLUB_LIST });
}
app.get('/leaders', leadersHandler);
app.post('/leaders', leadersHandler);

// POST, not DELETE: the phone page sends its PIN in the body like every other
// call it makes, and the CORS policy already refuses mutating requests from a
// non-allowlisted origin.
app.post('/leaders/forget', (req, res) => {
  const key = String((req.body && req.body.key) || '');
  if (!key.trim()) return res.status(400).json({ error: 'key is required' });
  const { removed, leaders } = forgetLeader(key);
  shareLeaderForget(String(key).toLowerCase().replace(/\s+/g, ' ').trim()).catch(() => {});
  const active = activeLeaders(leaders);
  console.log(`[leaders] ${removed ? 'Forgot' : 'No such remembered leader:'} '${key}'`);
  res.json({ ok: true, removed, leaders: active, hidden: leaders.length - active.length });
});

// ── One-off name tags (7.18.0, owner 2026-10-08) ──────────────────────────────
// A name tag for a child that is NOT a check-in: a lost or torn tag, or a
// child who is not checking in tonight (a sibling along for the night, a
// guest). Typed first name + club (owner's choice: no roster lookup, so no
// allergy or birthday line). The label is the club's stock label for that
// name; the screens play the full welcome (a sealed `checkin` with
// `oneOff: true`, which the lobby never counts and which never enters the
// recap); the print log keeps a row marked `oneOff`, which isNonCheckinRow()
// keeps out of every count, the attendance ledger, the still-here list and
// the reconcile pass. Same route from the dashboard, the touch check-in and
// the phone (relayed).
function oneOffClub(raw) {
  const want = $eligibility.clubKey(String(raw || ''));
  if (!want) return '';
  return $labelType.CLUB_LIST.find((c) => $eligibility.clubKey(c) === want) || '';
}
async function renderOneOffLabel(firstName, clubName, testBanner = false) {
  return $labelRender.generateLabel({
    firstName, lastName: '', clubName,
    footerText: $tags.labelFooterText(),
    template: $tags.labelTemplateFor(clubName),
    testBanner,
  });
}
async function performOneOffPrint(input) {
  const b = input || {};
  const firstName = security.sanitizeStoredText(b.firstName || '', 40).replace(/\s+/g, ' ').trim();
  if (!firstName) return { status: 400, body: { error: 'Type the child\'s first name.' } };
  const clubName = oneOffClub(b.clubName);
  if (!clubName) return { status: 400, body: { error: 'Pick the child\'s club.' } };
  if (!$customPdf.isSafePrinterName(b.printerName)) return { status: 400, body: { error: 'invalid printer name' } };
  const effectivePrinter = (b.printerName && String(b.printerName).trim()) || $config.PRINTER_NAME;
  // Rehearsal/demo: the TEST band, nothing recorded, nothing on the screens.
  const isDemo = b.demo === true || b.demo === 'true' || $configRoutes.isRehearsalActive();

  // Namespaced, never a check-in's key; absorbs a double tap.
  const dupKey = `oneoff:${firstName}:${clubName}`.toLowerCase();
  if (!isDemo && $clubbers.isDuplicatePrint(dupKey)) {
    console.log(`[print-oneoff] '${firstName}' (${clubName}) already printed within ${$clubbers.DUPLICATE_WINDOW_MS / 1000}s — duplicate suppressed`);
    return { status: 200, body: { success: true, duplicate: true, firstName, clubName } };
  }
  if (!isDemo) $clubbers.claimPrint(dupKey);

  let pngPath = null;
  try {
    const result = await renderOneOffLabel(firstName, clubName, isDemo);
    pngPath = result.pngPath;
    await $tunes.playTuneIfEnabled(effectivePrinter);
    await $printing.printLabel(pngPath, effectivePrinter);
    if (isDemo) {
      console.log(`[print-oneoff] Printed a TEST one-off tag for '${firstName}' — nothing recorded`);
      return { status: 200, body: { success: true, demo: true, firstName, clubName } };
    }
    $clubbers.recordPrint(dupKey);
    $history.addHistoryEntry({ firstName, lastName: '', clubName, printer: effectivePrinter, success: true, oneOff: true });
    // The welcome, never the count: no recap buffer, no tally change.
    events.publish($config.EVENT_CHANNEL, 'checkin', events.buildCheckin({
      firstName, club: clubName, isBirthday: false, isFirstTimer: false, oneOff: true,
    }));
    console.log(`[print-oneoff] ${firstName} — ${clubName}`);
    return { status: 200, body: { success: true, firstName, clubName } };
  } catch (err) {
    console.error('[print-oneoff] Error:', err.message);
    if (!isDemo) {
      $history.addHistoryEntry({ firstName, lastName: '', clubName, printer: effectivePrinter, success: false, oneOff: true });
      $eventBuffer.recordPrintFailure(firstName, clubName, err.message);
    }
    return { status: 500, body: { error: err.message } };
  } finally {
    if (!isDemo) $clubbers.releasePrint(dupKey);
    if (pngPath) fs.unlink(pngPath, () => {});
  }
}
app.post('/print-oneoff', async (req, res) => {
  const out = await performOneOffPrint(req.body);
  res.status(out.status).json(out.body);
});

// One leader tag. Extracted from the route so "Print selected" can print a
// whole team through exactly the same path — one spool job per tag, each with
// its own duplicate guard, history row and remembered-leader upsert, so a jam
// halfway down a batch loses one tag and reports which one.
async function performLeaderPrint(input) {
  const b = input || {};
  let firstName, lastName;
  if (b.firstName !== undefined) {
    firstName = security.sanitizeStoredText(b.firstName || '', 80);
    lastName  = security.sanitizeStoredText(b.lastName  || '', 80);
  } else {
    ({ firstName, lastName } = splitFullName(security.sanitizeStoredText(b.name || '', 160)));
  }
  if (!firstName && !lastName) return { status: 400, body: { error: 'name is required' } };
  const clubName = security.sanitizeStoredText(b.clubName || '', 40);
  if (!$customPdf.isSafePrinterName(b.printerName)) return { status: 400, body: { error: 'invalid printer name' } };
  const effectivePrinter = (b.printerName && String(b.printerName).trim()) || $config.PRINTER_NAME;
  // Rehearsal/demo: a real label with the TEST band, nothing recorded — same
  // rule as /print, so a training night leaves no trace in the print log. A
  // demo tag also does not teach the remembered-leader list a name.
  const isDemo = b.demo === true || b.demo === 'true' || $configRoutes.isRehearsalActive();

  // Namespaced so it can never collide with a child's check-in key in the
  // same recentPrints map; absorbs a phone double-tap.
  const dupKey = `leader:${firstName} ${lastName}`.toLowerCase().trim();
  if (!isDemo && $clubbers.isDuplicatePrint(dupKey)) {
    console.log(`[print-leader] '${firstName} ${lastName}' already printed within ${$clubbers.DUPLICATE_WINDOW_MS / 1000}s — duplicate suppressed`);
    return { status: 200, body: { success: true, duplicate: true } };
  }
  if (!isDemo) $clubbers.claimPrint(dupKey);

  let pngPath = null;
  try {
    const result = await renderLeaderLabel({ firstName, lastName, clubName, testBanner: isDemo });
    pngPath = result.pngPath;
    await $tunes.playTuneIfEnabled(effectivePrinter);
    await $printing.printLabel(pngPath, effectivePrinter);
    if (isDemo) {
      console.log(`[print-leader] Printed a TEST leader tag for '${firstName} ${lastName}' — nothing recorded`);
      return { status: 200, body: { success: true, demo: true } };
    }
    $clubbers.recordPrint(dupKey);
    $history.addHistoryEntry({ firstName, lastName, clubName, printer: effectivePrinter, success: true, isLeader: true });
    // Remembered only after the tag actually reached the printer: a failed
    // print must not seed the chips with a name nobody has a tag for.
    const isNew = !loadLeaders().some((l) => l.key === leaderKey(firstName, lastName));
    const remembered = rememberLeader({ firstName, lastName, clubName });
    // A new name joins the church's list (every device's chips); not awaited.
    if (isNew) shareLeaderAdd(remembered.find((l) => l.key === leaderKey(firstName, lastName))).catch(() => {});
    console.log(`[print-leader] ${firstName} ${lastName}${clubName ? ' — ' + clubName : ''}`);
    return { status: 200, body: { success: true } };
  } catch (err) {
    console.error('[print-leader] Error:', err.message);
    if (!isDemo) {
      $history.addHistoryEntry({ firstName, lastName, clubName, printer: effectivePrinter, success: false, isLeader: true });
      $eventBuffer.recordPrintFailure(`${firstName} ${lastName}`.trim(), clubName, err.message);
    }
    return { status: 500, body: { error: err.message } };
  } finally {
    if (!isDemo) $clubbers.releasePrint(dupKey);
    if (pngPath) fs.unlink(pngPath, () => {});
  }
}

// Batch cap: a church with more leaders than this in one go is a data-entry
// mistake, not a real night, and 25 sequential spool jobs is already ~a minute
// of printing.
const LEADER_BATCH_MAX = 25;

app.post('/print-leader', async (req, res) => {
  const b = req.body || {};

  // Batch ("Print selected" on the remembered chips). Sequential on purpose:
  // the printer is a single serial device and interleaved jobs come out of the
  // spooler in an unpredictable order.
  if (Array.isArray(b.leaders)) {
    if (!b.leaders.length) return res.status(400).json({ error: 'leaders is empty' });
    if (b.leaders.length > LEADER_BATCH_MAX) {
      return res.status(400).json({ error: `too many leaders in one batch (max ${LEADER_BATCH_MAX})` });
    }
    const results = [];
    for (const entry of b.leaders) {
      const one = await performLeaderPrint({ ...(entry || {}), printerName: b.printerName, demo: b.demo });
      const name = `${(entry && (entry.name || `${entry.firstName || ''} ${entry.lastName || ''}`)) || ''}`.trim();
      results.push({
        name,
        success: one.status === 200 && one.body.success === true,
        duplicate: one.body.duplicate === true,
        demo: one.body.demo === true,
        error: one.body.error,
      });
    }
    const printed = results.filter((r) => r.success && !r.duplicate).length;
    const failed = results.filter((r) => !r.success).length;
    console.log(`[print-leader] Batch of ${results.length}: ${printed} printed, ${failed} failed`);
    // 200 even with failures — the body is the per-name record, and a partial
    // batch is a real outcome the operator needs to read, not an error page.
    return res.json({ success: failed === 0, batch: true, printed, failed, results });
  }

  const { status, body } = await performLeaderPrint(b);
  res.status(status).json(body);
});

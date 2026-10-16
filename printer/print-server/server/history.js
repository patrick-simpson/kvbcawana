'use strict';
// Print history, club icons, reprint range selection.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const security = require('../security');
const tonightRules = require('../tonight');
const {
  REPORT_FRESH_MS, normalizedName, displayClub, splitFullName, historyIdentityKey, reportEntryIdentityKey,
  identityKeysOfRow, identityKeysOfReportEntry, distinctReportChildren, reportIsPartial, massUndoRefused,
} = tonightRules;
const crypto = require('crypto');
const fs    = require('fs');
const path  = require('path');
const $config = lazy('./config');
const $eventBuffer = lazy('./event-buffer');
const $eligibility = lazy('./eligibility');
const $ledger = lazy('./ledger');
const $http = lazy('./http');
const app = $http.app;

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  addHistoryEntry: { enumerable: true, get: () => addHistoryEntry },
  historyClubImage: { enumerable: true, get: () => historyClubImage },
  historyRowMatches: { enumerable: true, get: () => historyRowMatches },
  isNonCheckinRow: { enumerable: true, get: () => isNonCheckinRow },
  loadHistory: { enumerable: true, get: () => loadHistory },
  printedTonightFor: { enumerable: true, get: () => printedTonightFor },
  REPRINT_RANGE_GAP_MS: { enumerable: true, get: () => REPRINT_RANGE_GAP_MS },
  REPRINT_RANGE_MAX: { enumerable: true, get: () => REPRINT_RANGE_MAX },
  saveHistory: { enumerable: true, get: () => saveHistory },
  selectReprintRange: { enumerable: true, get: () => selectReprintRange },
});

// ── Print history ────────────────────────────────────────────────────────────
const HISTORY_FILE = path.join($config.DATA_DIR, 'print-history.json');

// ── Club icons, once each ─────────────────────────────────────────────────────
// Every history row used to carry its club's logo as a base64 PNG (10-30 KB),
// so a 200-row file was a few megabytes, re-read and re-parsed on nearly every
// request and rewritten on every check-in. The logo is one of a handful of
// images a night: it is kept ONCE here, by content hash, and a row carries the
// hash (`clubIcon`). Rows written before this still carry `clubImageData` and
// are read either way (historyClubImage); the dashboard never used the blob,
// so /history and /history/today no longer send it.
const ICONS_FILE = path.join($config.DATA_DIR, 'club-icons.json');
const ICONS_MAX = 60;
let clubIcons = null;   // hash → data URL, loaded on first use
function loadClubIcons() {
  if (clubIcons) return clubIcons;
  clubIcons = new Map();
  try {
    if (fs.existsSync(ICONS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(ICONS_FILE, 'utf8'));
      if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') clubIcons.set(k, v);
    }
  } catch (e) { console.warn('[icons] Could not load club-icons.json:', e.message); }
  return clubIcons;
}
function iconHash(dataUrl) { return crypto.createHash('sha256').update(dataUrl).digest('hex').slice(0, 20); }
// Store a data: URL once; returns its hash. Anything else (a URL, nothing) is
// not stored and returns null.
function rememberClubIcon(image) {
  if (typeof image !== 'string' || !image.startsWith('data:') || image.length > 512 * 1024) return null;
  const icons = loadClubIcons();
  const hash = iconHash(image);
  if (!icons.has(hash)) {
    icons.set(hash, image);
    while (icons.size > ICONS_MAX) icons.delete(icons.keys().next().value);
    $config.saveFileAtomic(ICONS_FILE, JSON.stringify(Object.fromEntries(icons)));
  }
  return hash;
}
// The image a history row printed with: its own blob (older rows, URLs) or the
// stored icon its hash names.
function historyClubImage(row) {
  if (!row) return null;
  if (row.clubImageData) return row.clubImageData;
  if (row.clubIcon) return loadClubIcons().get(row.clubIcon) || null;
  return null;
}
// What /history and /history/today send: everything but the blob.
function historyRowForDashboard(row) {
  if (!row || typeof row !== 'object' || !('clubImageData' in row)) return row;
  const { clubImageData, ...rest } = row;
  return rest;
}
// The cap on OLD rows. Today's rows are never evicted (see addHistoryEntry):
// the duplicate guard, "already printed tonight", the trophy marker and the
// tally fallback all read today's rows, and a 200-child night used to push its
// first arrivals out before the evening ended, so a reprint printed a second
// trophy band and the fallback count came up short. HISTORY_HARD_MAX is the
// one bound that still holds on a day gone wrong (a loop of prints).
const MAX_HISTORY = 200;
const HISTORY_HARD_MAX = 5000;

function loadHistory() {
  const rows = $config.cachedStore(HISTORY_FILE, () => {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        return Array.isArray(raw) ? raw : [];
      }
    } catch (e) {
      console.warn('[history] Failed to load print history:', e.message);
    }
    return [];
  });
  // MAX_HISTORY caps the row COUNT; this caps the AGE. Without it a church
  // that prints a handful of labels a week accumulated children's names and
  // check-in times indefinitely. Applied on read as well as write so an
  // existing over-long file shrinks on the next run. A fresh array each call,
  // so a caller that unshifts into its copy never edits the cache behind the
  // next caller's back.
  return security.pruneHistoryByAge(rows, $config.config.historyRetentionDays, Date.now());
}

function saveHistory(entries) {
  // Atomic write: a crash mid-save must not corrupt the history JSON, which
  // would break /history and reprints until manually deleted.
  if ($config.saveFileAtomic(HISTORY_FILE, JSON.stringify(entries, null, 2))) $config.cacheStore(HISTORY_FILE, entries);
}

// Does a history row refer to this child?
//
// Identity is id-first with a name fallback, because rows written before the
// clubberId field existed have none — and a mid-season upgrade must not make
// every earlier check-in unrecognisable. The rules, in order:
//   1. Both sides know an id → the ids decide, and a mismatch is a DIFFERENT
//      child even when the names are identical. This is the whole point.
//   2. Either side lacks an id → fall back to the lowercased full name, which
//      is exactly the old behaviour.
// Mirrors the extension's identityKey()/migrateLegacyKey() pair, which solved
// this on its side (roadmap R-4) while the server never followed.
function historyRowMatches(row, firstName, lastName, clubberId) {
  if (!row) return false;
  const rowId = row.clubberId != null ? String(row.clubberId).trim() : '';
  const wantId = clubberId != null ? String(clubberId).trim() : '';
  if (rowId && wantId) return rowId === wantId;
  const rowName = `${row.firstName || ''} ${row.lastName || ''}`.toLowerCase().trim();
  const wantName = `${firstName || ''} ${lastName || ''}`.toLowerCase().trim();
  return !!rowName && rowName === wantName;
}

// A history row that is a PRINT but not a CHECK-IN: award slips, connect cards
// and leader name tags. One predicate, used by every consumer that counts
// check-ins (tonight's stats and the tally, the checkout board's printed count,
// name-based reprint lookup, the sealed history) — a missed exclusion at any of those sites means a
// recognition print counts as a child, so they must all share this test.
// Has this child a tag tonight that a cloud check-in stands behind? For a
// cloud job (cloud = true): any successful, not-undone check-in row tonight.
// For anyone else: such a row that a cloud job printed. Matched by id, or by
// name when either side has none (historyRowMatches).
function printedTonightFor(firstName, lastName, clubberId, cloud) {
  const today = $eventBuffer.localDayISO();
  return loadHistory().some((row) => row && row.success && !row.undone && !isNonCheckinRow(row)
    && (cloud || row.cloudCheckin === true)
    && $eventBuffer.isOnLocalDay(row.timestamp, today)
    && historyRowMatches(row, firstName, lastName, clubberId));
}

function isNonCheckinRow(e) {
  return !!(e && (e.isAward || e.isConnectCard || e.isLeader || e.oneOff));
}

// ── Reprint a whole stretch of tonight (#257) ────────────────────────────────
// A jam or a torn roll eats eight labels in a rush, and the operator had to
// reprint one Print History row at a time while a line formed at the door.
//
// Cap of 20, not 40: printImage runs PowerShell with a 15s timeout plus one retry
// preceded by a SYNCHRONOUS 750ms wait, i.e. up to ~31s of blocked event loop
// per label. Forty labels could stall POST /print for a child at the door for
// minutes. The inter-label gap below is an awaited setTimeout for the same
// reason — never Atomics.wait, which would defeat the point entirely.
const REPRINT_RANGE_MAX = 20;
const REPRINT_RANGE_GAP_MS = 400;

// Pure: takes a history array and a window, returns the rows to reprint. No
// fs, no config, no clock beyond what the caller passes, so every exclusion
// rule below is exhaustively testable.
//
// Awards, connect cards and leader tags are excluded UNCONDITIONALLY — there
// is no includeAwards flag, deliberately. POST /reprint branches only on
// isLeader; an isAward row would fall into the kid path and record a history
// row WITHOUT its isAward flag, so isNonCheckinRow() would stop excluding it
// and tonight's tally would count an award slip as a child on every screen.
function selectReprintRange(opts) {
  const {
    history = [], today = $eventBuffer.localDayISO(), fromISO, toISO,
    club = '', max = REPRINT_RANGE_MAX,
  } = opts || {};

  const from = new Date(fromISO);
  const to = new Date(toISO);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return { error: 'bad-range' };
  }

  let want = '';
  if (String(club || '').trim()) {
    want = $eligibility.clubKey(club);
    // An unrecognised club string must NOT silently match everything — that
    // would print the whole night when the operator meant one club.
    if (!want) return { error: 'bad-club' };
  }

  const skipped = { nonCheckin: 0, failed: 0, undone: 0, otherClub: 0, duplicate: 0 };
  const seen = new Set();
  const rows = [];
  for (const r of history) {
    if (!r || !$eventBuffer.isOnLocalDay(r.timestamp, today)) continue;
    const t = new Date(r.timestamp);
    if (t < from || t > to) continue;                 // inclusive at both ends
    if (r.success === false) { skipped.failed++; continue; }
    if (isNonCheckinRow(r)) { skipped.nonCheckin++; continue; }
    // Reconciled away by the checkin report or a volunteer's Remove on the
    // phone: that child is not here, so a fresh label must not come out.
    if (r.undone) { skipped.undone++; continue; }
    if (want && $eligibility.clubKey(r.clubName) !== want) { skipped.otherClub++; continue; }
    if (!`${r.firstName || ''} ${r.lastName || ''}`.trim()) continue;
    // History is newest-first, so the FIRST row seen per identity is the
    // newest. Without this a stretch spanning an earlier reprint would print
    // the same child twice.
    const key = historyIdentityKey(r);
    if (seen.has(key)) { skipped.duplicate++; continue; }
    seen.add(key);
    rows.push(r);
  }

  const capped = rows.length > max;
  return { rows: rows.slice(0, max), count: Math.min(rows.length, max), capped, skipped };
}

function addHistoryEntry(entry) {
  const history = loadHistory();
  history.unshift({
    // Bounded and control-character-stripped on the way in: these strings come
    // straight off a request body and are persisted, then rendered by the
    // dashboard. The dashboard escapes on output (that is the real fix for the
    // stored-XSS path); this keeps an unbounded or escape-laden value from
    // bloating the history file or mangling the console log.
    firstName: security.sanitizeStoredText(entry.firstName),
    lastName: security.sanitizeStoredText(entry.lastName),
    clubName: security.sanitizeStoredText(entry.clubName || ''),
    // A data: URL is kept once in club-icons.json and named here by hash; a
    // URL (small) rides along as it always did.
    clubIcon: rememberClubIcon(entry.clubImageData),
    clubImageData: typeof entry.clubImageData === 'string' && !entry.clubImageData.startsWith('data:') ? entry.clubImageData : null,
    printer: security.sanitizeStoredText(entry.printer || ''),
    success: entry.success,
    visitor: !!entry.visitor,
    // Award slips (POST /print-award) are flagged so they never masquerade
    // as a check-in: they're excluded from name-based /reprint lookups and
    // from tonight's check-in stats, but still show up in /history for the
    // dashboard's own record-keeping.
    isAward: !!entry.isAward,
    award: security.sanitizeStoredText(entry.award || ''),
    // #293: which handbook this label's trophy band celebrated. A marker, not
    // display data — it is what stops a second band for the same child tonight.
    // (Today's rows are never evicted, so it holds all evening; a reprint
    // weeks later may band once more, which is acceptable for a decoration.)
    trophyBook: security.sanitizeStoredText(entry.trophyBook || '', 60),
    // Connect cards (#10) are flagged for the same reason award slips are:
    // they show in /history so the operator can see the card went out, but
    // isNonCheckinRow() keeps them out of every place that counts check-ins.
    isConnectCard: !!entry.isConnectCard,
    // Leader name tags (POST /print-leader): an adult volunteer's tag, never a
    // child's check-in. Same exclusion everywhere via isNonCheckinRow().
    isLeader: !!entry.isLeader,
    // A one-off name tag (7.18.0): printed and logged, never a check-in.
    ...(entry.oneOff ? { oneOff: true } : {}),
    // A tag for a cloud check-in (8.0.0): the sync service checked the child
    // in on TwoTimTwo. Marks the night's tag as printed (printedTonightFor).
    ...(entry.cloudCheckin ? { cloudCheckin: true } : {}),
    // TwoTimTwo's own clubber id, when the caller knew it. Everything here was
    // keyed on a lowercased "first last" string, so two children who share a
    // name merged into one row — the same defect the extension already fixed on
    // its side with identityKey(), which the server never followed. Stored as a
    // bounded string (ids are numeric today, but that is TwoTimTwo's business
    // to change). Absent on rows written before this, so every consumer must
    // fall back to the name — see historyRowMatches().
    clubberId: entry.clubberId != null && String(entry.clubberId).trim()
      ? security.sanitizeStoredText(String(entry.clubberId), 40)
      : null,
    timestamp: new Date().toISOString()
  });
  saveHistory(trimHistory(history));
}

// Newest first: the first MAX_HISTORY rows stay, and so does every row from
// today beyond them, up to HISTORY_HARD_MAX in all.
function trimHistory(history) {
  if (history.length <= MAX_HISTORY) return history;
  const today = $eventBuffer.localDayISO();
  const kept = [];
  for (const row of history) {
    if (kept.length >= HISTORY_HARD_MAX) break;
    if (kept.length < MAX_HISTORY || $eventBuffer.isOnLocalDay(row && row.timestamp, today)) kept.push(row);
  }
  return kept;
}

app.get('/history', (req, res) => {
  res.json(loadHistory().map(historyRowForDashboard));
});

app.get('/history/today', (req, res) => {
  const history = loadHistory();
  const today = $eventBuffer.localDayISO();
  const todayEntries = history.filter(e => $eventBuffer.isOnLocalDay(e.timestamp, today));
  res.json(todayEntries.map(historyRowForDashboard));
});

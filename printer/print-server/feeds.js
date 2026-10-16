// The print server's two TwoTimTwo feeds that remain (10.0.0): pure
// validation, Express-free, so scripts/test-server-helpers.cjs can test them
// directly.
//
//   POST /feed/checked-out     children checked out tonight (clubber ids only)
//   POST /feed/completed-books who finished a handbook (the trophy band)
//
// Neither is ever published. Until 10.0.0 the Chrome extension also posted
// TwoTimTwo's report, schedule, points, notices and check-out page here; the
// extension is gone and the sync Worker reads those itself.

'use strict';

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// ── POST /feed/checked-out (7.15.0) ───────────────────────────────────────
// A list of children checked out on one meeting date: TwoTimTwo clubber ids
// only, never names (posted by the Chrome extension until 10.0.0).
const CHECKED_OUT_MAX = 500;
function validateCheckedOutBody(body) {
  if (!isPlainObject(body)) return { ok: false, reason: 'body must be an object' };
  const date = typeof body.date === 'string' ? body.date : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, reason: 'date must be YYYY-MM-DD' };
  if (!Array.isArray(body.clubberIds)) return { ok: false, reason: 'clubberIds must be an array' };
  if (body.clubberIds.length > CHECKED_OUT_MAX) return { ok: false, reason: `clubberIds must not exceed ${CHECKED_OUT_MAX}` };
  const clubberIds = [];
  for (const raw of body.clubberIds) {
    const id = raw != null ? String(raw).trim() : '';
    if (/^\d{1,20}$/.test(id) && !clubberIds.includes(id)) clubberIds.push(id);
  }
  return { ok: true, payload: { date, clubberIds } };
}

// ── POST /feed/completed-books (#293: the trophy band) ──────────────────────
// Which children finished a handbook recently, from TwoTimTwo's own
// /report/completed_books: since 10.0.0 the sync Worker reads it and seals it
// to every station, and the station's job puller posts it here
// (job-puller.js createBundleSync). Loopback-only and NEVER published: these
// rows carry children's full names. They live in memory here, are never
// written to disk, and are read only at print time to decorate that child's
// next label.
//
// MERGE semantics, not replace: a second post (another club's, or a later
// bundle) must not wipe the first's.
const COMPLETED_BOOKS_MAX = 500;
const COMPLETED_BOOKS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const COMPLETED_BOOKS_THROTTLE_MS = 5000;

// The report's "Name" column ordering is undocumented (docs/TWOTIMTWO.md
// §5 lists the header only), so both "First Last" and "Last, First" have to
// key the same child — otherwise the band would silently never fire.
function normalizeChildName(name) {
  let s = String(name == null ? '' : name).replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();
  const comma = s.indexOf(',');
  if (comma !== -1) {
    const last = s.slice(0, comma).trim();
    const first = s.slice(comma + 1).trim();
    s = `${first} ${last}`.trim();
  }
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Returns an ISO YYYY-MM-DD string, or null when the date cannot be read with
// confidence. A row whose date is unreadable is DROPPED: no band beats a band
// celebrating a book finished last spring.
function parseBookDate(raw, now = Date.now()) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  let y; let mo; let d;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]);
  } else {
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
    if (!m) return null;
    mo = Number(m[1]); d = Number(m[2]); y = Number(m[3]);
    if (y < 100) y += 2000;
  }
  if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
  const iso = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  // Guard both ends: a typo'd future date would stick around forever, and an
  // out-of-window one is not worth carrying.
  if (t > now + 24 * 60 * 60 * 1000) return null;
  if (t < now - COMPLETED_BOOKS_WINDOW_MS) return null;
  return iso;
}

function validateCompletedBooksBody(body, now = Date.now()) {
  if (!isPlainObject(body)) return { ok: false, reason: 'body must be an object' };
  if (!Array.isArray(body.entries)) return { ok: false, reason: 'entries must be an array' };
  // Truncate, never reject: a decoration is not worth a 400 that hides every
  // other row in the batch.
  const capped = body.entries.length > COMPLETED_BOOKS_MAX
    ? body.entries.slice(-COMPLETED_BOOKS_MAX)
    : body.entries;
  const entries = [];
  for (const raw of capped) {
    if (!isPlainObject(raw)) continue;
    const key = normalizeChildName(raw.name);
    if (!key) continue;
    const book = String(raw.book || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!book) continue;
    const date = parseBookDate(raw.date, now);
    if (!date) continue;
    entries.push({ key, book, date });
  }
  return { ok: true, payload: { entries } };
}

let completedBooksState = { byName: new Map(), updatedAt: null };
let lastCompletedBooksAt = 0;

function submitCompletedBooks(body, now = Date.now()) {
  const result = validateCompletedBooksBody(body, now);
  if (!result.ok) return { valid: false, status: 400, reason: result.reason };
  if (now - lastCompletedBooksAt < COMPLETED_BOOKS_THROTTLE_MS) {
    return { valid: true, throttled: true, payload: result.payload };
  }
  lastCompletedBooksAt = now;
  for (const e of result.payload.entries) {
    const prev = completedBooksState.byName.get(e.key);
    if (!prev || e.date >= prev.date) completedBooksState.byName.set(e.key, { book: e.book, date: e.date });
  }
  const cutoff = now - COMPLETED_BOOKS_WINDOW_MS;
  for (const [k, v] of completedBooksState.byName) {
    if (Date.parse(`${v.date}T00:00:00Z`) < cutoff) completedBooksState.byName.delete(k);
  }
  completedBooksState.updatedAt = now;
  return { valid: true, throttled: false, payload: result.payload };
}

// The print-time lookup. Synchronous, in-memory, and re-checks the window on
// READ as well as on write — a server left running for a month must not still
// be banding a book finished in September.
function getCompletedBook(name, now = Date.now()) {
  const key = normalizeChildName(name);
  if (!key) return null;
  const row = completedBooksState.byName.get(key);
  if (!row) return null;
  if (Date.parse(`${row.date}T00:00:00Z`) < now - COMPLETED_BOOKS_WINDOW_MS) return null;
  return { book: row.book, date: row.date };
}

// Test-only: reset all in-memory state between unit test cases.
function _resetForTests() {
  completedBooksState = { byName: new Map(), updatedAt: null };
  lastCompletedBooksAt = 0;
}

module.exports = {
  _resetForTests,
  validateCheckedOutBody,
  // POST /feed/completed-books (#293, the trophy band): never published,
  // these rows carry children's full names.
  COMPLETED_BOOKS_MAX,
  COMPLETED_BOOKS_WINDOW_MS,
  normalizeChildName,
  parseBookDate,
  validateCompletedBooksBody,
  submitCompletedBooks,
  getCompletedBook,
};

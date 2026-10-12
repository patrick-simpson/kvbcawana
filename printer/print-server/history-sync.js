// The print role's part of the church's sealed history (ROADMAP.md#online-check-in,
// P2; the routes are lobby/worker/src/routes.md section 3, built by P6 / P5, so
// every call here TOLERATES A MISSING ROUTE: it keeps what it can and says so).
//
//   * WRITE: when this computer prints a job that came from a TwoTimTwo-page
//     check-in (the Worker saw it, but cannot seal a row: no ECDH in the Worker),
//     it seals a history row to the history public key (cloud-crypto sealRow)
//     and posts it (POST /v1/history/rows). Rows wait in a small queue while
//     the route is missing or the network is down.
//   * READ: the history private key (station-keys.js) opens the season's rows
//     (GET /v1/history/nights, /v1/history/rows) and hands their attendance to
//     the print server's own ledger, so milestone, first-time, twin and
//     "Go to" fields keep working with the laptop's local file no longer the
//     only record.
//   * IMPORT, once: seal the laptop's print-history.json and attendance.json
//     with the history public key and post them to POST /v1/history/import.
//     Row ids are derived from the content, so running it twice stores
//     nothing twice (INSERT OR IGNORE on the Worker).
//
// Medical notes never go here (sealRow refuses any record with a medical key).
'use strict';

const cc = require('./cloud-crypto');

const QUEUE_MAX = 500;
const ROWS_POST_MAX = 100;
const IMPORT_POST_MAX = 500;
const DATES_PER_ROW = 50;
const ROUTE_MISSING = (s) => s === 404 || s === 405 || s === 501;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The row kinds that mean a child was here (routes.md section 3): `visitor` is a check-in of a child with no id. */
const PRESENT_KINDS = new Set(['checkin', 'visitor', 'import-checkin']);
/** A record's `ts` is epoch milliseconds (an ISO string is tolerated). @param {unknown} v */
const tsOf = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (Date.parse(String(v)) || 0));

/** A row id that is the same for the same content: base64url of the first 16 bytes of SHA-256. */
async function stableId(...parts) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', cc.utf8(parts.join('|'))));
  return cc.bytesToBase64Url(digest.slice(0, 16));
}

/**
 * @param {{
 *   pub: () => (string|null), signedIn: () => ({ base: string, session: string } | null),
 *   request: Function, stationId: () => string, log?: Function, now?: () => number,
 * }} o
 */
function createHistoryWriter(o) {
  const log = o.log || (() => {});
  const now = o.now || Date.now;
  /** @type {any[]} */ const queue = [];
  const stats = { sent: 0, queued: 0, dropped: 0, missing: false };

  /** Seal one row and queue it. false when it could not be sealed (nothing is written). */
  async function record(kind, recordJson, night) {
    const pub = o.pub();
    if (!pub) return false;
    const id = cc.newRowId();
    const n = night || cc.churchNight(now());
    const wire = await cc.sealRow(pub, { id, night: n, kind, record: recordJson });
    if (!wire) { log(`[history] a ${kind} row could not be sealed; nothing was written`); return false; }
    queue.push({ id, night: n, kind, ...wire });
    while (queue.length > QUEUE_MAX) { queue.shift(); stats.dropped++; }
    stats.queued = queue.length;
    await flush();
    return true;
  }

  async function flush() {
    if (!queue.length) return;
    const s = o.signedIn();
    if (!s) return;
    while (queue.length) {
      const batch = queue.slice(0, ROWS_POST_MAX);
      const r = await o.request(s.base, '/v1/history/rows', { method: 'POST', session: s.session, station: o.stationId(), body: { rows: batch } });
      if (r.ok) { queue.splice(0, batch.length); stats.sent += batch.length; stats.missing = false; continue; }
      if (ROUTE_MISSING(r.status) || (r.status === 503)) { stats.missing = true; break; }     // not built yet / history off: keep them
      if (r.status === 400) { queue.splice(0, batch.length); stats.dropped += batch.length; log('[history] the service refused a batch of rows (400); dropped'); continue; }
      break;   // 401, unreachable, 5xx: keep and try next time
    }
    stats.queued = queue.length;
  }

  return { record, flush, status: () => ({ ...stats, queued: queue.length }) };
}

/**
 * The history row a station writes when it prints a check-in made on TwoTimTwo's
 * own page (source 'ttt'; the Worker could not seal a row for it: no ECDH there).
 * A job from the desk page needs none (the page sealed its row), so null.
 * `ts` is epoch milliseconds, `kind` is `checkin` (routes.md section 3).
 * @param {{ record: any, night: string }} info @param {() => number} [now]
 * @returns {{ kind: string, record: Record<string, any>, night: string }|null}
 */
function rowForPrinted({ record, night }, now = Date.now) {
  if (!record || record.source !== 'ttt') return null;
  const b = record.body || {};
  let first = b.firstName;
  let last = b.lastName;
  if (first === undefined) {
    const parts = String(b.name == null ? '' : b.name).trim().split(/\s+/).filter(Boolean);
    first = parts[0] || '';
    last = parts.slice(1).join(' ');
  }
  return {
    kind: 'checkin',
    night,
    record: {
      ts: now(), first: String(first || ''), last: String(last || ''), club: String(b.clubName || ''),
      ...(b.clubberId ? { clubberId: String(b.clubberId) } : {}), ...(b.visitor ? { visitor: true } : {}),
      ...(b.friend === true ? { friend: true } : {}), source: 'ttt',
    },
  };
}

// ── the one-time import ─────────────────────────────────────────────────────

/** Rows for print-history.json: one `import-checkin` per real check-in. */
async function importCheckinRows(pub, history) {
  const rows = [];
  for (const h of Array.isArray(history) ? history : []) {
    if (!h || h.success !== true || h.isAward || h.isConnectCard || h.isLeader || h.oneOff) continue;
    const ts = Date.parse(h.timestamp);
    if (!Number.isFinite(ts)) continue;
    const night = cc.churchNight(ts);
    const record = {
      ts, first: String(h.firstName || ''), last: String(h.lastName || ''), club: String(h.clubName || ''),
      ...(h.clubberId ? { clubberId: String(h.clubberId) } : {}),
      ...(h.visitor ? { visitor: true } : {}),
      ...(h.undone ? { undone: true } : {}),
    };
    const id = await stableId('import-checkin', h.timestamp, record.clubberId || '', record.first, record.last);
    const wire = await cc.sealRow(pub, { id, night, kind: 'import-checkin', record });
    if (wire) rows.push({ id, night, kind: 'import-checkin', ...wire });
  }
  return rows;
}

/** Rows for attendance.json: one `import-attendance` per kid per DATES_PER_ROW nights. */
async function importAttendanceRows(pub, ledger) {
  const rows = [];
  for (const [key, entry] of Object.entries(ledger && typeof ledger === 'object' ? ledger : {})) {
    const dates = entry && Array.isArray(entry.dates) ? entry.dates.filter((d) => typeof d === 'string' && ISO_DAY.test(d)).sort() : [];
    for (let i = 0; i < dates.length; i += DATES_PER_ROW) {
      const chunk = dates.slice(i, i + DATES_PER_ROW);
      const night = chunk[chunk.length - 1];
      const record = { k: String(key).slice(0, 80), name: String((entry && entry.name) || '').slice(0, 80), dates: chunk };
      const id = await stableId('import-attendance', record.k, night);
      const wire = await cc.sealRow(pub, { id, night, kind: 'import-attendance', record });
      if (wire) rows.push({ id, night, kind: 'import-attendance', ...wire });
    }
  }
  return rows;
}

/**
 * Seal this laptop's history and ledger and post them (POST /v1/history/import).
 * @param {{
 *   pub: () => (string|null), signedIn: Function, request: Function, stationId: () => string,
 *   readHistory: () => any[], readLedger: () => any, log?: Function,
 * }} o
 * @returns {Promise<{ ok: boolean, rows?: number, stored?: number, duplicates?: number, missing?: boolean, reason?: string, error?: string }>}
 */
async function importLaptopHistory(o) {
  const pub = o.pub();
  if (!pub) return { ok: false, reason: 'history-locked', error: 'This computer has not opened the history key yet. Sign in again from "Set up this computer..." to unlock it.' };
  const s = o.signedIn();
  if (!s) return { ok: false, reason: 'signed-out', error: 'This computer is not signed in to the sync service.' };
  const rows = [...await importCheckinRows(pub, o.readHistory()), ...await importAttendanceRows(pub, o.readLedger())];
  if (!rows.length) return { ok: true, rows: 0, stored: 0, duplicates: 0 };
  let stored = 0;
  let duplicates = 0;
  for (let i = 0; i < rows.length; i += IMPORT_POST_MAX) {
    const batch = rows.slice(i, i + IMPORT_POST_MAX);
    const r = await o.request(s.base, '/v1/history/import', { method: 'POST', session: s.session, station: o.stationId(), body: { rows: batch } });
    if (ROUTE_MISSING(r.status)) return { ok: false, missing: true, reason: 'route-missing', error: 'The history import is not available on the service yet.', rows: rows.length };
    if (r.status === 503) return { ok: false, reason: 'history-off', error: 'The service has no history store turned on.', rows: rows.length };
    if (!r.ok) return { ok: false, reason: r.status === 401 ? 'signed-out' : 'refused', error: `The service answered ${r.status} for the import.`, rows: rows.length, stored, duplicates };
    stored += Number(r.body && r.body.stored) || 0;
    duplicates += Number(r.body && r.body.duplicates) || 0;
  }
  return { ok: true, rows: rows.length, stored, duplicates };
}

// ── reading the attendance back ─────────────────────────────────────────────

/** The Awana season's first day (August 1) for the church's local date `today`. */
function seasonStart(today) {
  const [y, m] = today.split('-').map(Number);
  return `${m >= 8 ? y : y - 1}-08-01`;
}

/**
 * Season attendance from the sealed rows, into `merge([{ key, clubberId, name, dates }])`
 * (server.js's ledger). A night is re-read only when its row count changed
 * (tonight is always re-read).
 * @param {{
 *   historyRing: () => Promise<any>, signedIn: Function, request: Function, stationId: () => string,
 *   merge: (entries: any[]) => any, log?: Function, now?: () => number,
 * }} o
 */
function createAttendanceReader(o) {
  const log = o.log || (() => {});
  const now = o.now || Date.now;
  const seen = new Map();   // night -> row count read
  const stats = { nights: 0, rows: 0, unreadable: 0, lastAt: 0 };

  async function syncOnce() {
    const s = o.signedIn();
    const ring = await o.historyRing();
    if (!s || !ring) return { ok: false, reason: s ? 'history-locked' : 'signed-out' };
    const today = cc.churchNight(now());
    const nights = await o.request(s.base, `/v1/history/nights?from=${seasonStart(today)}&to=${today}`, { session: s.session, station: o.stationId() });
    if (ROUTE_MISSING(nights.status)) return { ok: false, reason: 'route-missing' };
    if (!nights.ok || !Array.isArray(nights.body)) return { ok: false, reason: 'error' };
    /** @type {Map<string, { key: string, clubberId: string|null, name: string, dates: Set<string> }>} */
    const found = new Map();
    const add = (clubberId, name, dates) => {
      const id = clubberId != null && String(clubberId).trim() ? String(clubberId).trim() : null;
      const nm = String(name || '').trim();
      const key = id ? `id:${id.toLowerCase()}` : nm.toLowerCase();
      if (!key) return;
      const e = found.get(key) || { key, clubberId: id, name: nm, dates: new Set() };
      for (const d of dates) if (ISO_DAY.test(d) && d <= today) e.dates.add(d);
      found.set(key, e);
    };
    /** @type {{ key: string, id: string|null, name: string, night: string, present: boolean, at: number }[]} */
    const events = [];
    let readNights = 0;
    for (const n of nights.body) {
      if (!n || !ISO_DAY.test(n.night)) continue;
      if (n.night !== today && seen.get(n.night) === n.rows) continue;
      let after = '';
      let count = 0;
      for (let page = 0; page < 40; page++) {
        const q = `/v1/history/rows?night=${n.night}&limit=500${after ? `&after=${encodeURIComponent(after)}` : ''}`;
        const r = await o.request(s.base, q, { session: s.session, station: o.stationId() });
        if (!r.ok || !r.body || !Array.isArray(r.body.rows)) { count = -1; break; }
        for (const row of r.body.rows) {
          count++;
          const rec = await cc.openRow(ring, row);
          if (!rec) { stats.unreadable++; continue; }
          if (rec.undone === true) continue;
          if (PRESENT_KINDS.has(row.kind) || row.kind === 'undo') {
            // A desk undo takes the child back out: the LAST of a child's check-in / undo rows (by time) decides.
            const nm = rec.name || `${rec.first || ''} ${rec.last || ''}`;
            const id = rec.clubberId != null && String(rec.clubberId).trim() ? String(rec.clubberId).trim() : null;
            const key = id ? `id:${id.toLowerCase()}` : String(nm).trim().toLowerCase();
            if (key) events.push({ key, id, name: nm, night: row.night, present: row.kind !== 'undo', at: tsOf(rec.ts) });
          } else if (row.kind === 'import-attendance' && Array.isArray(rec.dates)) {
            const m = /^id:(.+)$/.exec(String(rec.k || ''));
            add(m ? m[1] : null, rec.name, rec.dates);
          }
        }
        if (!r.body.next) break;
        after = r.body.next;
      }
      if (count >= 0) { seen.set(n.night, n.rows); readNights++; }
    }
    // Resolve check-ins against undos, per child per night, in the order they happened.
    const last = new Map();
    for (const e of events.sort((a, b) => a.at - b.at)) last.set(`${e.night}|${e.key}`, e);
    for (const e of last.values()) if (e.present) add(e.id, e.name, [e.night]);
    const entries = [...found.values()].map((e) => ({ key: e.key, clubberId: e.clubberId, name: e.name, dates: [...e.dates].sort() }));
    if (entries.length) o.merge(entries);
    stats.nights += readNights; stats.rows += entries.length; stats.lastAt = now();
    log(`[history] read ${readNights} night(s): ${entries.length} child(ren) merged into the attendance ledger`);
    return { ok: true, nights: readNights, children: entries.length };
  }

  return { syncOnce, status: () => ({ ...stats }) };
}

module.exports = { rowForPrinted, createHistoryWriter, importLaptopHistory, createAttendanceReader, importCheckinRows, importAttendanceRows, seasonStart, stableId };

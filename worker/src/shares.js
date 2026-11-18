// @ts-check
// Store night share balances on the name tags (owner 2026-11-18: "it should come
// on automatically like the calendar before and also have a switch in settings").
//
// The Chrome extension did this until 10.0.0 (printer changes.md 3.6.0): on a
// store night it read TwoTimTwo's share-balance report for Cubbies, Sparks, T&T,
// Trek and Journey and sent each label `awanaShares` = balance + 1 (the report is
// last week's total; tonight's attendance share is the + 1). The print server
// still draws the coin badge from `awanaShares` (label-render.js), so this module
// only has to find the number again:
//
//   MODE (storage `store:mode`, /settings → Tonight → "Awana store night"):
//     auto  today's church calendar has an event with "store" in its title
//           (lobby calendarLogic.js isStoreNight, the same test), not cancelled
//     on    store night today, whatever the calendar says
//     off   never
//   READS  while it is store night and the watch window is open: one club's
//          `/report/shekelBalance?club_id=N&output=csv` per free slot of the one
//          read clock (stationfeeds.js asks), the five clubs again every
//          SHARES_MS. The balances (full name -> number) are held in MEMORY
//          only, never stored, logged or answered as a list.
//   USE    the desk roster answer gives each child `shares` (the page puts it on
//          the label it seals); a TwoTimTwo-page check-in's job (adopt.js) gets
//          `awanaShares`. A child the reports do not list gets no number: no
//          badge, never a guessed balance.

import { Doc } from './doc.js';
import { fail, json } from './http.js';
import { looksLikeCsv, parseCsvRows } from './twotimtwo.js';
import { localTime, watchWindow } from './watcher.js';

/** The clubs whose balances are read (the extension's list: Cubbies, Sparks, T&T, Trek, Journey). */
export const SHARE_CLUB_IDS = Object.freeze([2, 3, 4, 5, 6]);
/** How often the five reports are read again on a store night. */
export const SHARES_MS = 10 * 60 * 1000;
/** A failed club is tried again after this long. */
export const SHARES_RETRY_MS = 2 * 60 * 1000;
/** The most names one report may hold (a runaway answer cannot fill memory). */
export const SHARES_PER_CLUB_MAX = 400;
export const STORE_MODES = Object.freeze(['auto', 'on', 'off']);

/** The calendar's test (lobby calendarLogic.js isStoreNight). @param {unknown} title */
export function isStoreTitle(title) {
  return /store/i.test(String(title ?? ''));
}

/** Lower case, trimmed, runs of spaces made one (the report has "Avery  McAdam"). @param {unknown} name */
export function shareKey(name) {
  return String(name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * One share-balance report: `"Name","Balance"` rows. Header, blank and footer
 * rows and anything that is not a whole number at least 0 are skipped.
 * @param {string} text @returns {Map<string, number>|null} null when it is not a CSV
 */
export function parseShareBalanceCsv(text) {
  if (!looksLikeCsv(text)) return null;
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const row of parseCsvRows(text)) {
    if (!row || row.length < 2) continue;
    const key = shareKey(row[0]);
    const raw = String(row[1] ?? '').trim();
    if (!key || key === 'name' || !/^-?\d+(\.\d+)?$/.test(raw)) continue;
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 0) continue;
    out.set(key, n);
    if (out.size >= SHARES_PER_CLUB_MAX) break;
  }
  return out;
}

/** Does today's calendar say store night? @param {any} feed the stored calendar @param {string} today YYYY-MM-DD */
export function calendarSaysStore(feed, today) {
  const events = feed && Array.isArray(feed.events) ? feed.events : [];
  return events.some((/** @type {any} */ e) => e && e.date === today && !e.isCancelled && isStoreTitle(e.title));
}

export class Shares {
  /**
   * @param {{ storage: any, watcher: any, now: () => number }} deps
   */
  constructor({ storage, watcher, now }) {
    this.storage = storage;
    this.watcher = watcher;
    this.now = now;
    this.modeDoc = new Doc(storage, 'store:mode', () => ({ mode: 'auto', at: null, by: null }));
    /** Today's calendar answer, kept per local date (refreshed by prepare()). @type {{ date: string, store: boolean, at: number }|null} */
    this.cal = null;
    /** The balances, full name -> balance (memory only). @type {Map<string, number>|null} */
    this.map = null;
    /** The pass under way. @type {{ night: string, idx: number, map: Map<string, number>, read: number }|null} */
    this.pass = null;
    this.night = '';
    this.readAt = 0;
    this.passAt = 0;
    this.errorAt = 0;
    /** @type {string|null} */
    this.error = null;
    this.clubsRead = 0;
  }

  get mode() {
    const m = this.modeDoc.data && this.modeDoc.data.mode;
    return STORE_MODES.includes(m) ? m : 'auto';
  }

  /** Read the mode and today's calendar (async; the alarm and the routes call it). */
  async prepare() {
    await this.modeDoc.load();
    const today = localTime(this.now()).date;
    if (!this.cal || this.cal.date !== today || this.now() - this.cal.at > 10 * 60 * 1000) {
      let feed;
      try { feed = await this.storage.get('calendar'); } catch { feed = null; }
      this.cal = { date: today, store: calendarSaysStore(feed, today), at: this.now() };
    }
    if (this.night !== today) { this.night = today; this.map = null; this.pass = null; this.passAt = 0; this.readAt = 0; this.clubsRead = 0; }
  }

  /** Is it store night (sync; after prepare())? */
  active() {
    const m = this.mode;
    if (m === 'on') return true;
    if (m === 'off') return false;
    return !!this.cal && this.cal.date === localTime(this.now()).date && this.cal.store;
  }

  /** A read is wanted now (sync). */
  due() {
    if (!this.active() || !this.watcher.creds || !this.watcher.creds()) return false;
    const now = this.now();
    if (!watchWindow(now).open) return false;
    if (this.pass) return now - this.errorAt >= (this.error ? SHARES_RETRY_MS / 4 : 0);
    if (this.errorAt && !this.map && now - this.errorAt < SHARES_RETRY_MS) return false;
    return now - this.passAt >= SHARES_MS;
  }

  /** How long until a read is wanted (ms), or null. */
  wakeInMs() {
    if (!this.active() || !watchWindow(this.now()).open) return null;
    if (this.due()) return 0;
    return Math.max(1000, this.passAt + SHARES_MS - this.now());
  }

  /** One club's report. true when a read was made (or tried). */
  async readOne() {
    const client = this.watcher.clientFor ? this.watcher.clientFor() : null;
    if (!client) return false;
    const now = this.now();
    const night = localTime(now).date;
    if (!this.pass || this.pass.night !== night) this.pass = { night, idx: 0, map: new Map(), read: 0 };
    const clubId = SHARE_CLUB_IDS[this.pass.idx];
    const page = await client.page(`/report/shekelBalance?club_id=${clubId}&output=csv`, { waitMs: 0, kind: 'share-balance' });
    if (!page.ok && page.error === 'read-busy') return false;
    const parsed = page.ok ? parseShareBalanceCsv(page.html) : null;
    if (parsed) {
      for (const [k, v] of parsed) this.pass.map.set(k, v);
      this.pass.read += 1;
    } else {
      this.error = page.ok ? 'shares-unreadable' : page.error;
      this.errorAt = now;
    }
    this.pass.idx += 1;
    if (this.pass.idx >= SHARE_CLUB_IDS.length) {
      const pass = this.pass;
      this.pass = null;
      this.passAt = now;
      this.clubsRead = pass.read;
      if (pass.read) {
        // A club that could not be read this time keeps last pass's names.
        const merged = new Map(this.map || []);
        for (const [k, v] of pass.map) merged.set(k, v);
        this.map = merged;
        this.readAt = now;
        if (pass.read === SHARE_CLUB_IDS.length) this.error = null;
      }
      console.warn(`[shares] store night: ${pass.read} of ${SHARE_CLUB_IDS.length} reports read, ${this.map ? this.map.size : 0} balances held`);
    }
    return true;
  }

  /**
   * The number for a child's label (balance + 1: tonight's attendance share), or
   * null: not store night, not read yet, or the child is not on a report.
   * @param {string} first @param {string} last
   */
  labelShares(first, last) {
    if (!this.map || !this.active()) return null;
    const v = this.map.get(shareKey(`${first} ${last}`));
    return v === undefined ? null : v + 1;
  }

  /** The same, from one full name. @param {string} name */
  labelSharesFor(name) {
    if (!this.map || !this.active()) return null;
    const v = this.map.get(shareKey(name));
    return v === undefined ? null : v + 1;
  }

  /** For /settings: words and counts only, never a name or a balance. */
  view() {
    const iso = (/** @type {number} */ t) => (t ? new Date(t).toISOString() : null);
    return {
      mode: this.mode,
      calendarSaysStore: !!(this.cal && this.cal.store),
      active: this.active(),
      balances: this.map ? this.map.size : 0,
      readAt: iso(this.readAt),
      clubsRead: this.clubsRead,
      clubs: SHARE_CLUB_IDS.length,
      error: this.error,
      changedAt: this.modeDoc.data ? this.modeDoc.data.at : null,
      changedBy: this.modeDoc.data ? this.modeDoc.data.by : null,
    };
  }

  /** @param {unknown} mode @param {any} by */
  async setMode(mode, by) {
    await this.modeDoc.load();
    if (typeof mode !== 'string' || !STORE_MODES.includes(mode)) return null;
    const d = this.modeDoc.data;
    d.mode = mode;
    d.at = new Date(this.now()).toISOString();
    d.by = by && typeof by === 'object' ? { name: typeof by.name === 'string' ? by.name.slice(0, 60) : null } : null;
    await this.modeDoc.save();
    // Turned on: read at once (the alarm's next free slot).
    if (this.active()) { this.passAt = 0; this.errorAt = 0; this.error = null; }
    return this.view();
  }
}

/**
 * GET /v1/store-night, PUT /v1/store-night {mode: 'auto'|'on'|'off'} (session; routes.md 10.20).
 * @param {import('./registry.js').Registry} registry @param {any} core the SyncCore
 */
export function mountShares(registry, core) {
  registry.add('GET', '/v1/store-night', 'session', async () => {
    await core.shares.prepare();
    return json(core.shares.view());
  });
  registry.add('PUT', '/v1/store-night', 'session', async ({ body, request }) => {
    const b = await body();
    await core.shares.prepare();
    const name = request.headers.get('X-Device-Name');
    const v = await core.shares.setMode(b && b.mode, { name: name ? String(name) : null });
    if (!v) return fail('Mode must be auto, on or off.', 400, { reason: 'bad-mode' });
    // Wake the alarm so the first read is not left for the next tick.
    try { if (v.active && core.watcher && core.watcher.alarms) await core.watcher.alarms.set(core.now() + 1000); } catch { /* the next tick reads */ }
    return json(v);
  });
}

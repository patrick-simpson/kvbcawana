// @ts-check
// Share balances: the store-night name tag and the lobby's "+N SHARES!"
// (owner 2026-11-18, rebuilt 2026-11-22 after store night went badly).
//
// WHERE THE NUMBERS COME FROM: TwoTimTwo's roster export (/clubber/csv), which
// the Worker already reads for the stations (stationfeeds.js) and which carries
// "Clubber ID" and "Share Balance" side by side. The first read of a club night
// inside the watch window (about 4:30 pm, before the doors) is that night's
// BEFORE balance per clubber id. Matching by id, never by name: the 11-18
// version matched the share report's names to the check-in page's and missed
// children. Later reads that night are ignored (a balance read after a child
// checked in may already hold tonight's attendance share).
//
// KEPT: each club night's before balances, SEALED under the Worker's state key
// (`shares:nights`, sealState: clubber ids and numbers only, never a name), the
// newest NIGHTS_KEPT nights. A restarted Worker opens them again (the 11-18
// version held them in memory only and a redeploy that evening lost them).
//
// STORE NIGHT (storage `store:mode`, /settings → Tonight → "Awana store night"):
//   auto  the church calendar OR TwoTimTwo's own check-in page says "store"
//   on / off
// The tag's number (owner 2026-11-21): balance + 1 (tonight's attendance share),
// never under STORE_MIN 10 (tonight's share counts toward it; a child the
// export does not list prints 10).
// "+N SHARES!" (owner 2026-11-21), every club night: tonight's number (the tag's
// on a store night, top-up included; balance + 1 otherwise) minus LAST club
// night's before balance, only when above 0.

import { Doc } from './doc.js';
import { fail, json } from './http.js';
import { rosterKey } from './twotimtwo.js';
import { localTime, openState, sealState, watchWindow } from './watcher.js';

export const STORE_MODES = Object.freeze(['auto', 'on', 'off']);
/** No store-night tag shows fewer shares than this (owner 2026-11-21). */
export const STORE_MIN = 10;
/** Club nights of before balances kept (last week's is the one used). */
export const NIGHTS_KEPT = 4;
/** The most children one night keeps (a runaway export cannot fill storage). */
export const SHARES_MAX = 1500;
/** A "+N" past this is not believed (an export glitch), so nothing is shown. */
export const GAIN_MAX = 500;
export const NIGHTS_KEY = 'shares:nights';

/** The calendar's test (lobby calendarLogic.js isStoreNight). @param {unknown} title */
export function isStoreTitle(title) {
  return /store/i.test(String(title ?? ''));
}

/** Does today's church calendar say store night? @param {any} feed @param {string} today */
export function calendarSaysStore(feed, today) {
  const events = feed && Array.isArray(feed.events) ? feed.events : [];
  return events.some((/** @type {any} */ e) => e && e.date === today && !e.isCancelled && isStoreTitle(e.title));
}

/**
 * Clubber id -> share balance from a parsed roster export. null when it has no
 * Share Balance column. A blank or odd balance is left out (unknown, not 0).
 * @param {{ header: string[], rows: string[][] }} roster @returns {Record<string, number>|null}
 */
export function balancesFromRoster(roster) {
  const keys = (roster && Array.isArray(roster.header) ? roster.header : []).map(rosterKey);
  const idI = keys.indexOf('clubber id');
  const balI = keys.indexOf('share balance');
  if (idI < 0 || balI < 0) return null;
  /** @type {Record<string, number>} */
  const out = {};
  let n = 0;
  for (const row of roster.rows) {
    const id = String(row[idI] ?? '').trim();
    const raw = String(row[balI] ?? '').trim();
    if (!/^\d{1,20}$/.test(id) || !/^-?\d+(\.\d+)?$/.test(raw)) continue;
    const v = Math.floor(Number(raw));
    if (!Number.isFinite(v) || v < 0) continue;
    out[id] = v;
    if (++n >= SHARES_MAX) break;
  }
  return out;
}

/** The tag's number: balance + 1, at least STORE_MIN; a child not listed gets STORE_MIN. @param {number|undefined} before */
export function storeTagNumber(before) {
  return Math.max(STORE_MIN, (before === undefined ? 0 : before + 1));
}

/**
 * "+N": tonight's number minus last club night's before balance, or null.
 * @param {number|undefined} before tonight's before balance @param {number|undefined} last last club night's
 * @param {boolean} store tonight is store night
 */
export function sharesGained(before, last, store) {
  if (last === undefined) return null;
  if (before === undefined && !store) return null;
  const tonight = store ? storeTagNumber(before) : /** @type {number} */ (before) + 1;
  const n = tonight - last;
  return n > 0 && n <= GAIN_MAX ? n : null;
}

export class Shares {
  /**
   * @param {{ storage: any, watcher: any, now: () => number, secret: () => string|null|undefined,
   *   tttSaysStore?: () => boolean }} deps
   */
  constructor({ storage, watcher, now, secret, tttSaysStore }) {
    this.storage = storage;
    this.watcher = watcher;
    this.now = now;
    this.secret = secret;
    this.tttSaysStore = tttSaysStore || (() => false);
    this.modeDoc = new Doc(storage, 'store:mode', () => ({ mode: 'auto', at: null, by: null }));
    /** Today's church calendar answer (refreshed by prepare()). @type {{ date: string, store: boolean, at: number }|null} */
    this.cal = null;
    /** date -> {at, byId} (opened from storage once). @type {Record<string, { at: number, byId: Record<string, number> }>|null} */
    this.nights = null;
    /** @type {Promise<void>|null} */
    this.opening = null;
    /** @type {string|null} */
    this.error = null;
    /** The night an export came with no Share Balance column (memory only): no re-reads for it. */
    this.noColumnNight = '';
  }

  get mode() {
    const m = this.modeDoc.data && this.modeDoc.data.mode;
    return STORE_MODES.includes(m) ? m : 'auto';
  }

  /** Open the kept nights once (a sealed blob under the state key). */
  openNights() {
    if (this.nights) return Promise.resolve();
    if (!this.opening) {
      this.opening = (async () => {
        const secret = this.secret();
        let sealed;
        try { sealed = await this.storage.get(NIGHTS_KEY); } catch { sealed = null; }
        const opened = secret && sealed ? await openState(secret, sealed) : null;
        this.nights = opened && typeof opened === 'object' && opened.nights && typeof opened.nights === 'object' ? opened.nights : {};
      })().finally(() => { this.opening = null; });
    }
    return this.opening;
  }

  /** Read the mode, today's calendar and the kept nights (async; the alarm and the routes call it). */
  async prepare() {
    await this.modeDoc.load();
    await this.openNights();
    const today = localTime(this.now()).date;
    if (!this.cal || this.cal.date !== today || this.now() - this.cal.at > 10 * 60 * 1000) {
      let feed;
      try { feed = await this.storage.get('calendar'); } catch { feed = null; }
      this.cal = { date: today, store: calendarSaysStore(feed, today), at: this.now() };
    }
  }

  /** The church calendar says store night today (sync; after prepare()). */
  calendarStore() {
    return !!this.cal && this.cal.date === localTime(this.now()).date && this.cal.store;
  }

  /** Is it store night (sync; after prepare())? */
  active() {
    const m = this.mode;
    if (m === 'on') return true;
    if (m === 'off') return false;
    let ttt;
    try { ttt = this.tttSaysStore() === true; } catch { ttt = false; }
    return this.calendarStore() || ttt;
  }

  /** Tonight's before balances, or null (not read yet tonight). */
  tonight() {
    const today = localTime(this.now()).date;
    return this.nights && this.nights[today] ? this.nights[today].byId : null;
  }

  /** The newest kept club night before today, or null. */
  lastNight() {
    if (!this.nights) return null;
    const today = localTime(this.now()).date;
    const dates = Object.keys(this.nights).filter((d) => d < today).sort();
    return dates.length ? dates[dates.length - 1] : null;
  }

  /** Should the roster be read now for tonight's before balances? (sync) */
  wantsRoster() {
    return !!this.nights && watchWindow(this.now()).open && !this.tonight()
      && this.noColumnNight !== localTime(this.now()).date;
  }

  /**
   * A roster export the stations' feed just read. Only the first of a club
   * night (inside the watch window) is kept; it is sealed at once.
   * @param {{ header: string[], rows: string[][] }} roster @param {number} at
   */
  async takeRoster(roster, at) {
    if (!watchWindow(at).open) return false;
    await this.openNights();
    const date = localTime(at).date;
    if (!this.nights || this.nights[date]) return false;
    const byId = balancesFromRoster(roster);
    if (!byId) { this.error = 'no-share-column'; this.noColumnNight = date; return false; }
    this.error = null;
    this.nights[date] = { at, byId };
    const keep = Object.keys(this.nights).sort().slice(-NIGHTS_KEPT);
    for (const d of Object.keys(this.nights)) if (!keep.includes(d)) delete this.nights[d];
    const secret = this.secret();
    if (secret) {
      try { await this.storage.put(NIGHTS_KEY, await sealState(secret, { nights: this.nights })); } catch (err) { console.error('[shares] could not keep tonight\'s balances', err); }
    }
    console.warn(`[shares] tonight's balances taken: ${Object.keys(byId).length} children`);
    return true;
  }

  /** The store-night tag number for a child, or null (not store night, or no balances read tonight). @param {string} clubberId */
  tagFor(clubberId) {
    const t = this.tonight();
    if (!t || !this.active()) return null;
    return storeTagNumber(t[String(clubberId)]);
  }

  /** "+N" for a child, or null. @param {string} clubberId */
  gainedFor(clubberId) {
    const t = this.tonight();
    const last = this.lastNight();
    if (!t || !last || !this.nights) return null;
    const id = String(clubberId);
    return sharesGained(t[id], this.nights[last].byId[id], this.active());
  }

  /** For /settings: words and counts only, never a name or a balance. */
  view() {
    const t = this.tonight();
    const today = localTime(this.now()).date;
    const last = this.lastNight();
    let ttt;
    try { ttt = this.tttSaysStore() === true; } catch { ttt = false; }
    return {
      mode: this.mode,
      calendarSaysStore: this.calendarStore(),
      twotimtwoSaysStore: ttt,
      active: this.active(),
      balances: t ? Object.keys(t).length : 0,
      readAt: t && this.nights ? new Date(this.nights[today].at).toISOString() : null,
      lastNight: last,
      minimum: STORE_MIN,
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
    return json(v);
  });
}

// The youth check-out, in the Worker (owner, 2026-10-12): the extension's
// ymSweep (printer/chrome-extension/content.js), rule for rule, run from the
// watcher's alarm instead of the laptop's tab. Switched by YM_CHECKOUT
// (wrangler.toml, "off" until the owner turns it on); the print server tells
// its extension to stop sweeping while that computer is the Worker's station.
//
// THE RULES (exactly the extension's)
//   when     a club night (CLUB_NIGHTS' weekday), from YM_AT (7:15 pm) in the
//            church's zone until midnight
//   who      every child the watcher's LATEST applied report lists in a club
//            matching YM_CLUBS (Trek, Journey: the extension's ymClubOf, a
//            substring of the lowercased club name), plus any such row the
//            Checkout page itself lists. The report keeps listing a child after
//            a check-out, hence the done list.
//   how      the Checkout page's own POST (/clubber/checkout, calendar_id +
//            clubber_id; TwoTimTwoClient.checkOut), counted only on exact "OK"
//   again    re-checked on every tick, so a late arrival goes too; a child is
//            tried at most YM_MAX_FAILS times a night, and the done list means
//            nobody is posted twice
//   count    each check-out goes into tonight's book like the desk's
//            (publisher.deskCheckout), so the tally and the still-here list drop
//            (published while SINGLE_PUBLISHER is on and the window is open)
//
// THE OWNER'S PACE (2026-10-12): at most ONE check-out every YM_CHECKOUT_GAP_MS
// (15 s), a refused one included. The next allowed moment is claimed in memory
// in one synchronous step and written through to storage before the post, so a
// restarted object never bursts. Forty children at 7:15 take about ten minutes.
//
// READS. Who is in comes from the watcher's report (handed over in memory after
// each applied read; no report read of its own). The Checkout page is read only
// for the meeting's calendar_id and date (and its rows), at most every
// YM_PAGE_MS (60 s), only while due, through the one read clock with waitMs 0
// (it skips its turn when the clock is booked, and keeps clear of the report's
// reserved slot: readbudget.js). It needs the page for the meeting's id and the
// rare row the report does not list, so once a minute is plenty, and it leaves
// the roster its share of the 4 reads a minute. Posts are writes.
//
// STORAGE. `ym:state` (the night, the meeting, the page's rows, the done list
// and the tries) is ONE blob sealed under the state key (sealState, as the
// watcher's snapshot); `ym:status` is counts and times only.

import { CLUB_NIGHTS, localTime, openState, sealState, watchWindow } from './watcher.js';

/** When the sweep starts on a club night (the extension's YM_CHECKOUT.at). */
export const YM_AT = '19:15';
/** The clubs swept (the extension's YM_CHECKOUT.clubs). */
export const YM_CLUBS = Object.freeze(['trek', 'journey']);
/** Tries per child per night (the extension's YM_MAX_FAILS). */
export const YM_MAX_FAILS = 3;
/** The Checkout page is read at most this often (the extension sweeps every 30 s; the Worker's 4 reads a minute are shared, owner 2026-10-12). */
export const YM_PAGE_MS = 60 * 1000;
/** At most one check-out post this often (owner, 2026-10-12). */
export const YM_CHECKOUT_GAP_MS = 15 * 1000;
/** More than this many children in a night's lists is a bug. */
const LIST_MAX = 500;

const AT_MIN = (() => { const [h, m] = YM_AT.split(':').map(Number); return h * 60 + m; })();

/** Is the sweep due at `ms` (a club night, 7:15 pm to midnight, the church's zone)? @param {number} ms */
export function ymDue(ms) {
  const t = localTime(ms);
  return t.minutes >= AT_MIN && CLUB_NIGHTS.some((n) => n.dow === t.dow);
}

/** The swept club a club name is, or '' (the extension's ymClubOf). @param {unknown} club */
export function ymClubOf(club) {
  const a = String(club || '').trim().toLowerCase();
  return YM_CLUBS.find((c) => a.includes(c)) || '';
}

/** @returns {{ night: string|null, cal: {calendarId: string, date: string}|null, rows: Record<string, string>, done: string[], fails: Record<string, number> }} */
const freshState = (night = /** @type {string|null} */ (null)) => ({ night, cal: null, rows: {}, done: [], fails: {} });
const freshStatus = (night = /** @type {string|null} */ (null)) => ({
  night, checkedOut: 0, failed: 0, gaveUp: 0, posts: 0, pageReads: 0,
  lastSweep: /** @type {string|null} */ (null), lastPageAt: 0, nextPostAt: 0, lastError: /** @type {string|null} */ (null),
});

export class YmCheckout {
  /**
   * @param {{ storage: { get(k: string): Promise<any>, put(k: string, v: any): Promise<void>, delete(k: string): Promise<any> },
   *   env: Record<string, any>, now: () => number, watcher: import('./watcher.js').Watcher,
   *   publisher?: import('./publisher.js').Publisher|null, log?: (line: string) => void }} deps
   */
  constructor({ storage, env, now, watcher, publisher, log }) {
    this.storage = storage;
    this.env = env || {};
    this.now = now;
    this.watcher = watcher;
    this.publisher = publisher || null;
    this.log = log || ((line) => console.warn(line));
    /** In memory, the truth while the object runs. */
    this.st = freshState();
    this.status = freshStatus();
    /** The watcher's latest applied report: clubber id -> club. @type {{ date: string, kids: Record<string, string> }|null} */
    this.report = null;
    /** @type {Promise<void>|null} */
    this.loading = null;
    /** A step under way (one at a time). */
    this.busy = false;
  }

  /** YM_CHECKOUT = "on", with cloud check-in running and a TwoTimTwo user. */
  get enabled() {
    return String(this.env.YM_CHECKOUT || '').trim().toLowerCase() === 'on' && this.watcher.mode !== 'off' && !!this.watcher.creds();
  }

  secret() { return this.watcher.creds()?.password || null; }

  load() {
    if (!this.loading) {
      this.loading = (async () => {
        const secret = this.secret();
        const status = await this.storage.get('ym:status');
        if (status && typeof status === 'object') this.status = { ...freshStatus(), ...status };
        const st = secret ? await openState(secret, await this.storage.get('ym:state')) : null;
        if (st && typeof st === 'object' && st.night) this.st = { ...freshState(), ...st };
        // A restarted object: the watcher's last applied report, from its sealed snapshot.
        if (!this.report && secret) {
          const snap = await openState(secret, await this.storage.get('cloud:snap'));
          if (!this.report && snap && snap.date && snap.kids) this.report = { date: snap.date, kids: snap.kids };
        }
      })().catch((err) => { this.loading = null; throw err; });
    }
    return this.loading;
  }

  /** The watcher's applied report (in memory only). @param {{ date: string, kids: Record<string, string> }} r */
  onReport({ date, kids }) {
    this.report = { date, kids };
  }

  /** A new night starts clean (synchronous). @param {string} night */
  roll(night) {
    if (this.st.night !== night) this.st = freshState(night);
    if (this.status.night !== night) this.status = freshStatus(night);
  }

  /** Tonight's children still to check out, in order: report first, then the page's rows. @param {string} night */
  pending(night) {
    const out = [];
    const seen = new Set();
    const consider = (/** @type {string} */ id, /** @type {string} */ club) => {
      if (seen.has(id) || !ymClubOf(club)) return;
      seen.add(id);
      if (this.st.done.includes(id) || (this.st.fails[id] || 0) >= YM_MAX_FAILS) return;
      out.push(id);
    };
    if (this.report && this.report.date === night) for (const [id, club] of Object.entries(this.report.kids)) consider(id, club);
    for (const [id, club] of Object.entries(this.st.rows || {})) consider(id, club);
    return out;
  }

  async persist() {
    const secret = this.secret();
    if (secret) await this.storage.put('ym:state', await sealState(secret, this.st));
    await this.storage.put('ym:status', this.status);
  }

  /** Is a Checkout page read due (the sweep due, YM_PAGE_MS since the last)? */
  pageDue() {
    return this.due() && this.now() - (this.status.night === localTime(this.now()).date ? this.status.lastPageAt : 0) >= YM_PAGE_MS;
  }

  /** Due now, and on? */
  due() {
    return this.enabled && ymDue(this.now());
  }

  /**
   * One step of the sweep (the watcher's alarm): a Checkout page read when one
   * is due and the read clock has a slot, otherwise at most ONE check-out post
   * when the 15 s gap has passed. true when it did either.
   */
  async step() {
    if (!this.due() || this.busy) return false;
    this.busy = true;
    try {
      await this.load();
      const now = this.now();
      const night = localTime(now).date;
      this.roll(night);
      if (now - this.status.lastPageAt >= YM_PAGE_MS && this.watcher.budget.peek(false) === 0) {
        if (await this.readPage()) return true;
      }
      return await this.postOne(night);
    } finally {
      this.busy = false;
    }
  }

  /** The Checkout page: the meeting and its rows. */
  async readPage() {
    const client = this.watcher.clientFor();
    if (!client) return false;
    const res = await client.checkoutPage({ waitMs: 0, kind: 'ym-checkout' });
    if (!res.ok && res.error === 'read-busy') return false;
    this.status.lastPageAt = this.now();
    this.status.pageReads += 1;
    if (res.ok) {
      this.st.cal = { calendarId: res.page.calendarId, date: res.page.date };
      /** @type {Record<string, string>} */
      const rows = {};
      for (const r of res.page.rows.slice(0, LIST_MAX)) if (ymClubOf(r.club)) rows[r.clubberId] = r.club;
      this.st.rows = rows;
      if (this.status.lastError && /^page:/.test(this.status.lastError)) this.status.lastError = null;
    } else {
      this.status.lastError = `page:${res.error}`;
      this.log(`[cloud] youth check-out: the Checkout page was unreadable (${res.error})`);
    }
    await this.persist();
    return true;
  }

  /** At most one check-out post, the gap claimed before it. @param {string} night */
  async postOne(night) {
    const now = this.now();
    if (!this.st.cal || now < this.status.nextPostAt) return false;
    const id = this.pending(night)[0];
    if (!id) return false;
    const client = this.watcher.clientFor();
    if (!client) return false;
    // The check-and-set: claimed in memory in one step, then written through.
    this.status.nextPostAt = now + YM_CHECKOUT_GAP_MS;
    this.status.posts += 1;
    await this.storage.put('ym:status', this.status);
    const res = await client.checkOut({ clubberId: id, calendarId: this.st.cal.calendarId });
    this.status.lastSweep = new Date(this.now()).toISOString();
    if (res.ok) {
      if (!this.st.done.includes(id)) this.st.done.push(id);
      if (this.st.done.length > LIST_MAX) this.st.done = this.st.done.slice(-LIST_MAX);
      this.status.checkedOut += 1;
    } else if (res.error === 'signed-out') {
      // Not TwoTimTwo refusing the child: the session lapsed. Not a try; the
      // next page read signs in again.
      this.status.lastError = res.error;
      this.status.lastPageAt = 0;
      this.watcher.clientFor()?.cookies.clear();
    } else {
      const n = (this.st.fails[id] || 0) + 1;
      this.st.fails[id] = n;
      this.status.failed += 1;
      if (n >= YM_MAX_FAILS) this.status.gaveUp += 1;
      this.status.lastError = res.error;
    }
    await this.persist();
    if (res.ok) {
      this.log('[cloud] youth check-out: 1 Trek/Journey checked out');
      // Off tonight's count and the still-here list, as a desk check-out is (the
      // book is purged when the window closes, so only while it is open).
      if (this.publisher && watchWindow(this.now()).open) {
        try { await this.publisher.deskCheckout({ night, clubberId: id }); } catch (err) { console.error('[cloud] counting a youth check-out failed', err); }
      }
    }
    return true;
  }

  /** How long until the sweep has something to do (ms), or null when it is not due. */
  wakeInMs() {
    if (!this.due()) return null;
    const now = this.now();
    const night = localTime(now).date;
    const page = Math.max(this.status.night === night ? this.status.lastPageAt + YM_PAGE_MS - now : 0, this.watcher.budget.peek(false));
    const post = this.st.cal && this.st.night === night && this.pending(night).length ? Math.max(this.status.nextPostAt - now, 0) : Infinity;
    return Math.min(page, post);
  }

  /** For GET /v1/cloud/status: counts and times only, never a name or an id. */
  async statusView() {
    if (this.enabled) await this.load().catch(() => {});
    const now = this.now();
    const night = localTime(now).date;
    const tonight = this.status.night === night;
    return {
      enabled: this.enabled,
      due: this.due(),
      at: YM_AT,
      clubs: [...YM_CLUBS],
      gapSec: YM_CHECKOUT_GAP_MS / 1000,
      pageSec: YM_PAGE_MS / 1000,
      maxTries: YM_MAX_FAILS,
      night: tonight ? night : null,
      checkedOut: tonight ? this.status.checkedOut : 0,
      failed: tonight ? this.status.failed : 0,
      gaveUp: tonight ? this.status.gaveUp : 0,
      pending: tonight && this.st.night === night ? this.pending(night).length : 0,
      meeting: tonight && this.st.cal ? this.st.cal.date : null,
      lastSweep: tonight ? this.status.lastSweep : null,
      lastPageAt: tonight && this.status.lastPageAt ? new Date(this.status.lastPageAt).toISOString() : null,
      lastError: tonight ? this.status.lastError : null,
    };
  }
}

// Who came the last two club nights, held by the Worker (owner 2026-10-15: "I
// want the /checkin page to have the same 'if a family hasn't come in two
// weeks put them at the bottom' feature"; "I want the worker in the cloudflare
// database to hold" it; "fill from TwoTimTwo").
//
// WHAT IS KEPT. D1 table `seen_nights` (migrations/0004_seen_nights.sql): one
// row per (club night, child seen that night), the child as a KEYED HASH that
// is the same every night (`identityTag` under the state key with the fixed
// SEEN_NIGHT in place of a date), never a clubber id or a name. Rows older than
// KEEP_DAYS go.
//
// WHERE IT COMES FROM. Every applied report the watcher reads on a club night
// (record(), only the children not written yet this night, one batch), and
// once for a night it has no rows for (the deploy before the feature, a night
// the watcher missed): the cron reads TwoTimTwo's check-in report for that date
// (`/clubber/checkin_report?date=`, at most RECENT_NIGHTS reads a run, through
// the one read clock) and records it (backfill()).
//
// WHEN THEY CAME (owner 2026-10-15: "sort family tiles by who usually arrives
// first", over the "Whole season"). A row the watcher writes on tonight's own
// date carries `at`, the minutes after local midnight it first saw the child
// (migration 0005; a report every 30 s, so within about half a minute); a
// filled night has no times. usualOf(ids): each child's average `at` over this
// season's club nights before today (the season starts August 1), rounded.
//
// WHAT THE ROSTER GETS. awayOf(ids): for the last RECENT_NIGHTS club nights
// before today (the shared club-night rule, the schedule and the calendar), the
// set of the given clubber ids seen on any of them, or null until every one of
// those nights has rows (so a half-known history never sends a regular to the
// bottom). The desk marks the rest `away: true`. Hashes are kept in memory per
// clubber id, so a page polling every 15 s costs one D1 read every few minutes.

import { identityTag } from '../../shared/cloud-crypto.js';
import { clubNightToday, zonedParts } from '../../shared/clubNight.js';
import { tagKey } from './ledger.js';
import { SCHEDULE } from './clubday.js';

/** Club nights looked back over. */
export const RECENT_NIGHTS = 2;
/** The fixed "night" the cross-night hash is made with (identityTag wants a date). */
export const SEEN_NIGHT = '1970-01-01';
/** Rows kept this long. */
export const KEEP_DAYS = 300;
/** The month a season starts (August); arrival averages look back to its first day. */
export const SEASON_START_MONTH = 8;
/** How long an answer is reused before D1 is asked again. */
const CACHE_MS = 3 * 60 * 1000;
/** A night that could not be filled is not tried again for this long. */
const FILL_RETRY_MS = 5 * 60 * 60 * 1000;
/** How far back the last club nights are looked for (a long break). */
const LOOK_BACK_DAYS = 60;

export class Recent {
  /**
   * @param {{ env: Record<string, any>, watcher: any, storage?: any, now?: () => number, log?: (m: string) => void, schedule?: any }} o
   */
  constructor({ env, watcher, storage, now, log, schedule }) {
    this.env = env;
    this.watcher = watcher;
    this.storage = storage || watcher.storage || null;
    this.now = now || (() => Date.now());
    this.log = log || ((m) => console.warn(m));
    this.schedule = schedule || SCHEDULE;
    /** clubber id -> hash (memory only). @type {Map<string, string>} */
    this.hashes = new Map();
    /** Hashes written this night (memory), so each report writes only the new ones. @type {{ night: string, tags: Set<string> }} */
    this.written = { night: '', tags: new Set() };
    /** @type {{ key: string, at: number, seen: Set<string>|null }|null} */
    this.cache = null;
    /** @type {{ key: string, at: number, usual: Map<string, number> }|null} */
    this.usualCache = null;
    /** night -> when a fill was last tried (memory). @type {Map<string, number>} */
    this.fillTried = new Map();
  }

  get db() { return this.env.HISTORY_DB || null; }

  /** The same hash for a child every night. @param {string} clubberId @returns {Promise<string|null>} */
  async hashOf(clubberId) {
    const id = String(clubberId);
    const hit = this.hashes.get(id);
    if (hit) return hit;
    const secret = this.watcher.creds()?.password;
    if (!secret) return null;
    const tag = await identityTag(await tagKey(secret), SEEN_NIGHT, id);
    if (tag) {
      if (this.hashes.size > 5000) this.hashes.clear();
      this.hashes.set(id, tag);
    }
    return tag;
  }

  /** The church's time zone (the schedule's). */
  zone() { return typeof this.schedule?.timezone === 'string' ? this.schedule.timezone : undefined; }

  /** The calendar the Worker keeps (watcher's storage). */
  async feed() {
    try { return this.storage ? await this.storage.get('calendar') : null; } catch { return null; }
  }

  /**
   * The last `n` club nights before today (YYYY-MM-DD, newest first), by the shared rule.
   * @param {number} nowMs @param {any} feed @param {number} [n]
   */
  pastNights(nowMs, feed, n = RECENT_NIGHTS) {
    const sources = { schedule: this.schedule, feed: feed && Array.isArray(feed.events) ? feed : null };
    const [y, m, d] = zonedParts(new Date(nowMs), this.zone()).dateKey.split('-').map(Number);
    const out = [];
    for (let i = 1; i <= LOOK_BACK_DAYS && out.length < n; i++) {
      // Noon UTC of that date is the same date in the church's zone.
      const probe = new Date(Date.UTC(y, m - 1, d - i, 12));
      if (clubNightToday(probe, sources)) out.push(probe.toISOString().slice(0, 10));
    }
    return out;
  }

  /**
   * The children a report lists on `night` (a club night): the new ones written, one batch,
   * with the time first seen when `night` is today (a live report; `timed: false` for a fill).
   * Never throws. @param {string} night @param {any[]} entries @param {{ timed?: boolean }} [opts]
   */
  async record(night, entries, opts = {}) {
    const db = this.db;
    if (!db || !/^\d{4}-\d{2}-\d{2}$/.test(night)) return 0;
    try {
      if (this.written.night !== night) this.written = { night, tags: new Set() };
      const fresh = [];
      for (const e of Array.isArray(entries) ? entries : []) {
        const id = String(e?.clubberId ?? '').trim();
        if (!/^\d{1,12}$/.test(id)) continue;
        const tag = await this.hashOf(id);
        if (tag && !this.written.tags.has(tag)) fresh.push(tag);
      }
      if (!fresh.length) return 0;
      const here = zonedParts(new Date(this.now()), this.zone());
      const at = opts.timed !== false && here.dateKey === night ? here.minutes : null;
      await db.batch(fresh.map((tag) => db.prepare('INSERT OR IGNORE INTO seen_nights (night, tag, at) VALUES (?1, ?2, ?3)').bind(night, tag, at)));
      for (const tag of fresh) this.written.tags.add(tag);
      this.cache = null;
      return fresh.length;
    } catch (err) {
      console.error('[recent] recording a night failed', err);
      return 0;
    }
  }

  /**
   * Which of these clubber ids came on any of the last RECENT_NIGHTS club nights,
   * or null while those nights are not all known (or there is no database).
   * @param {string[]} ids @returns {Promise<Set<string>|null>}
   */
  async seenOf(ids) {
    const db = this.db;
    if (!db) return null;
    try {
      const t = this.now();
      const nights = this.pastNights(t, await this.feed());
      if (nights.length < RECENT_NIGHTS) return null;
      const key = nights.join(',');
      if (!this.cache || this.cache.key !== key || t - this.cache.at > CACHE_MS) {
        const res = await db.prepare(`SELECT night, tag FROM seen_nights WHERE night IN (${nights.map((_, i) => `?${i + 1}`).join(', ')})`).bind(...nights).all();
        const rows = Array.isArray(res?.results) ? res.results : [];
        const known = new Set(rows.map((r) => r.night));
        const seen = nights.every((n) => known.has(n)) ? new Set(rows.map((r) => String(r.tag))) : null;
        this.cache = { key, at: t, seen };
      }
      const seenTags = this.cache.seen;
      if (!seenTags) return null;
      const out = new Set();
      for (const id of ids) {
        const tag = await this.hashOf(id);
        if (tag && seenTags.has(tag)) out.add(String(id));
      }
      return out;
    } catch (err) {
      console.error('[recent] reading the last club nights failed', err);
      return null;
    }
  }

  /**
   * Each given clubber id's usual arrival: the average minutes after local midnight it was
   * first seen, over this season's club nights before today. Ids never timed are left out;
   * null with no database or on a failed read. @param {string[]} ids @returns {Promise<Map<string, number>|null>}
   */
  async usualOf(ids) {
    const db = this.db;
    if (!db) return null;
    try {
      const t = this.now();
      const today = zonedParts(new Date(t), this.zone()).dateKey;
      const [y, m] = today.split('-').map(Number);
      const from = `${m >= SEASON_START_MONTH ? y : y - 1}-${String(SEASON_START_MONTH).padStart(2, '0')}-01`;
      const key = `${from},${today}`;
      if (!this.usualCache || this.usualCache.key !== key || t - this.usualCache.at > CACHE_MS) {
        const res = await db.prepare('SELECT tag, AVG(at) AS usual FROM seen_nights WHERE night >= ?1 AND night < ?2 AND at IS NOT NULL GROUP BY tag').bind(from, today).all();
        const rows = Array.isArray(res?.results) ? res.results : [];
        this.usualCache = { key, at: t, usual: new Map(rows.map((r) => [String(r.tag), Math.round(Number(r.usual))])) };
      }
      const out = new Map();
      for (const id of ids) {
        const tag = await this.hashOf(id);
        const u = tag ? this.usualCache.usual.get(tag) : undefined;
        if (Number.isFinite(u)) out.set(String(id), /** @type {number} */ (u));
      }
      return out;
    } catch (err) {
      console.error('[recent] reading usual arrivals failed', err);
      return null;
    }
  }

  /**
   * The cron's fill: each of the last RECENT_NIGHTS club nights with no rows is read
   * from TwoTimTwo's check-in report for that date and recorded; old rows go. Never throws.
   * @returns {Promise<{ filled: string[], failed: string[] }>}
   */
  async backfill() {
    const out = { filled: /** @type {string[]} */ ([]), failed: /** @type {string[]} */ ([]) };
    const db = this.db;
    if (!db) return out;
    try {
      const t = this.now();
      const cutoff = new Date(t - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
      await db.prepare('DELETE FROM seen_nights WHERE night < ?1').bind(cutoff).run();
      const nights = this.pastNights(t, await this.feed());
      const client = this.watcher.clientFor();
      if (!client || this.watcher.mode === 'off') return out;
      for (const night of nights) {
        const has = await db.prepare('SELECT 1 AS x FROM seen_nights WHERE night = ?1 LIMIT 1').bind(night).first();
        if (has) continue;
        const tried = this.fillTried.get(night) || 0;
        if (t - tried < FILL_RETRY_MS) continue;
        this.fillTried.set(night, t);
        const r = await client.report(night, { waitMs: 20 * 1000, kind: 'recent-fill' });
        if (!r.ok) { out.failed.push(night); this.log(`[recent] could not read ${night}'s check-in report (${r.error})`); continue; }
        await this.record(night, r.report.entries, { timed: false });
        out.filled.push(night);
      }
      if (out.filled.length) this.log(`[recent] filled ${out.filled.join(', ')} from TwoTimTwo`);
    } catch (err) {
      console.error('[recent] the fill failed', err);
    }
    return out;
  }
}

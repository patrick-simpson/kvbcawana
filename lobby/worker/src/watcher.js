// The report watcher (ROADMAP.md#cloud-check-in, piece 2, phase 1: READ-ONLY SHADOW).
//
// During the club window a Durable Object alarm reads TwoTimTwo's check-in
// report every 30 seconds (WATCH_INTERVAL_MS) on the ONE read clock
// (readbudget.js: one read every 5 s, every Worker read combined; a manual "read now" shares the same
// clock, and the alarm skips its turn when another read holds the slot) and
// compares it with the last read:
//   - a child new on the report is a check-in made on TwoTimTwo (nothing
//     checks in through Cloudflare yet), which phase 2 will print a label for;
//   - a child gone from it was undone on TwoTimTwo.
// Phase 1 PUBLISHES NOTHING. It logs the tally it would publish and keeps a
// status (GET /v1/cloud/status) for the shadow night, whose numbers must match
// the laptop's authoritativeTonight() before anything depends on this.
//
// The extension's safety rules carry over: a report that parses fewer children
// than its own Count: footers is partial and changes nothing, and a read that
// would drop more than half the room at once is refused (the print server's
// mass-undo guard, reconcileHistoryWithReport).
//
// What is kept, and how (TwoTimTwo's condition: everything encrypted):
//   cloud:status  counts, times and fixed error codes only: no names, no ids
//   cloud:snap    last read's clubber ids and clubs, AES-256-GCM sealed under a
//                 key derived from the TwoTimTwo password secret (so a copy of
//                 the storage alone opens nothing). No names, ever.
// The session cookie and the password never touch storage (twotimtwo.js).

import { TwoTimTwoClient, credentialsFrom, reportColumns, rowShape } from './twotimtwo.js';
import { fromBase64, toBase64 } from './crypto.js';
import { INTERACTIVE_WAIT_MS, READ_INTERVAL_MS, ReadBudget } from './readbudget.js';
import { massUndoRefused, reportIsPartial } from '../../shared/tonight.js';
import { SCHEDULE, clubDay } from './clubday.js';

export { READ_INTERVAL_MS };
/**
 * The report is read every WATCH_INTERVAL_MS: every other slot of the read
 * clock (readbudget.js READ_INTERVAL_MS, 5 s). The watcher RESERVES the next report's
 * moment, so the slot between is everyone else's (the roster's check-in page,
 * the Checkout page, a households catch-up) and the report never starves: a
 * waiting request may push it one slot, once (35 s at worst). The alarm is
 * also the scheduler of the Worker's own other reads, one per free slot, in
 * this order: the night's check-in page (warms the desk), a households
 * catch-up (families.js), the youth check-out's Checkout page (once a minute
 * after 7:15 pm), then the roster's check-in page read ahead while pages poll
 * it (desk.js), so a poll is answered from a page at most 30 s old.
 */
export const WATCH_INTERVAL_MS = 30 * 1000;
/**
 * Work per alarm invocation. Sealing a print job to the stations is ECDH per
 * station (measured ~4.2 ms for 3 stations under Node), and the free plan
 * allows 10 ms of CPU an invocation: ONE job per tick, the rest wait for the
 * next (SPILL_MS later). test/adopt.test.js measures it.
 */
export const SEAL_PER_TICK = 1;
export const SPILL_MS = 1000;

/** The longest an idle alarm sleeps before it looks at the clock again. */
export const IDLE_MAX_MS = 6 * 60 * 60 * 1000;
/**
 * The club nights, the printer's church-config.json `clubNights` (test pins
 * them equal), widened like the printer's tally tick: TALLY_LEAD_MIN before,
 * TALLY_GRACE_MIN after.
 */
export const CLUB_NIGHTS = [{ dow: 3, start: '17:30', end: '20:00' }];
export const LEAD_MIN = 60;
export const GRACE_MIN = 60;
export const TIME_ZONE = 'America/New_York';
const LOG_MAX = 40;
const CHECKIN_PAGE_RETRY_MS = 5 * 60 * 1000;
const STATE_SALT = 'kvbc-awana-cloud-checkin';
const STATE_INFO = 'watcher-state-v1';

/** @param {string} hm */
function minutesOf(hm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * The church's local date, weekday and minute of the day.
 * @param {number} ms
 * @returns {{ date: string, dow: number, minutes: number }}
 */
export function localTime(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    dow: WEEKDAYS[/** @type {keyof typeof WEEKDAYS} */ (parts.weekday)] ?? 0,
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
  };
}

/**
 * Is the watch window open, and if not, about how long until it opens? The
 * estimate counts local minutes, so across a clock change it can be an hour
 * out: the caller caps the sleep and asks again.
 * @param {number} ms
 */
export function watchWindow(ms) {
  const t = localTime(ms);
  let untilMin = Infinity;
  for (const night of CLUB_NIGHTS) {
    const open = Math.max(minutesOf(night.start) - LEAD_MIN, 0);
    const close = Math.min(minutesOf(night.end) + GRACE_MIN, 24 * 60);
    if (night.dow === t.dow && t.minutes >= open && t.minutes < close) return { open: true, date: t.date, untilMs: 0 };
    let days = (night.dow - t.dow + 7) % 7;
    if (days === 0 && t.minutes >= open) days = 7;
    untilMin = Math.min(untilMin, days * 24 * 60 + open - t.minutes);
  }
  return { open: false, date: t.date, untilMs: Math.max(60 * 1000, untilMin * 60 * 1000) };
}

/**
 * The date of the most recent club night, today included: what the Settings
 * test reads, because on any other day the report has no club tables at all.
 * Calendar arithmetic on the local date, so a clock change cannot move it.
 * @param {number} ms
 */
export function lastClubNight(ms) {
  const t = localTime(ms);
  const back = Math.min(...CLUB_NIGHTS.map((n) => (t.dow - n.dow + 7) % 7));
  const [y, m, d] = t.date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - back)).toISOString().slice(0, 10);
}

/** @param {string} secret */
async function stateKey(secret) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(STATE_SALT), info: new TextEncoder().encode(STATE_INFO) },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

/** @param {string} secret @param {unknown} value */
export async function sealState(secret, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(STATE_INFO) },
    await stateKey(secret), new TextEncoder().encode(JSON.stringify(value)),
  ));
  return { v: 1, iv: toBase64(iv), ct: toBase64(ct) };
}

/** null when it will not open (another password, damaged): a fresh start. @param {string} secret @param {any} sealed */
export async function openState(secret, sealed) {
  try {
    if (!sealed || sealed.v !== 1) return null;
    const iv = fromBase64(sealed.iv);
    const ct = fromBase64(sealed.ct);
    if (!iv || !ct) return null;
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(STATE_INFO) }, await stateKey(secret), ct,
    );
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    return null;
  }
}

/**
 * One child per clubber id (the report's own rule for identity), each in the
 * first club table it appears in. The tally counts these.
 * @param {{clubberId: string, club: string}[]} entries
 * @returns {Record<string, string>} clubber id -> club
 */
export function childrenOf(entries) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const e of entries) if (!(e.clubberId in out)) out[e.clubberId] = e.club;
  return out;
}

/** @param {Record<string, string>} kids */
export function countByClub(kids) {
  /** @type {Record<string, number>} */
  const byClub = {};
  for (const club of Object.values(kids)) byClub[club || 'No club'] = (byClub[club || 'No club'] || 0) + 1;
  return byClub;
}

/** @param {string[]} ids @param {Record<string, string>} kids */
function clubsOf(ids, kids) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const id of ids) out[kids[id] || 'No club'] = (out[kids[id] || 'No club'] || 0) + 1;
  return out;
}

/**
 * Compare a fresh report with the last applied one. Pure.
 * @param {Record<string, string>|null} prev the last applied read's children, null at the night's first read
 * @param {{ entries: {clubberId: string, club: string}[], declared: number|null }} report
 * @returns {{ verdict: 'baseline'|'applied'|'partial'|'mass-undo', kids: Record<string, string>,
 *   added: string[], gone: string[] }}
 */
export function compareReport(prev, report) {
  const kids = childrenOf(report.entries);
  // The SHARED rules (lobby/shared/tonight.js, the print server's too): a report
  // that parsed fewer children than its own Count: footers is partial, and a read
  // that drops more than half the room at once is refused.
  if (reportIsPartial(report)) {
    return { verdict: 'partial', kids, added: [], gone: [] };
  }
  if (!prev) return { verdict: 'baseline', kids, added: [], gone: [] };
  const added = Object.keys(kids).filter((id) => !(id in prev));
  const gone = Object.keys(prev).filter((id) => !(id in kids));
  if (massUndoRefused(gone.length, Object.keys(prev).length)) return { verdict: 'mass-undo', kids, added: [], gone: [] };
  return { verdict: 'applied', kids, added, gone };
}

/** The tally the screens would get (the print server's buildTally shape). @param {Record<string, string>} kids @param {number} now */
export function wouldPublishTally(kids, now) {
  const counts = countByClub(kids);
  return { counts, total: Object.keys(kids).length, at: new Date(now).toISOString() };
}

export class Watcher {
  /**
   * @param {{ storage: { get(k: string): Promise<any>, put(k: string, v: any): Promise<void>, delete(k: string): Promise<any> },
   *   env: Record<string, any>, fetchFn?: typeof fetch, now?: () => number,
   *   alarms?: { set(atMs: number): Promise<void>|void, get(): Promise<number|null>|number|null },
   *   log?: (line: string) => void, sleep?: (ms: number) => Promise<void>, budget?: ReadBudget }} deps
   */
  constructor({ storage, env, fetchFn, now, alarms, log, sleep, budget }) {
    this.storage = storage;
    this.env = env || {};
    this.fetchFn = fetchFn;
    this.now = now || (() => Date.now());
    /** The ONE TwoTimTwo read clock: this watcher's client and every other read through it share it. */
    this.budget = budget || new ReadBudget({ now: this.now, sleep, storage });
    /** Print-job adoption (adopt.js): set by SyncCore; the watcher only calls it. @type {import('./adopt.js').Adopter|null} */
    this.adopt = null;
    /** The one publisher (publisher.js): set by SyncCore; the watcher feeds it each applied report and its tick. @type {import('./publisher.js').Publisher|null} */
    this.publisher = null;
    /** The youth check-out (ymcheckout.js): set by SyncCore; the watcher hands it each applied report and a turn of its alarm. @type {import('./ymcheckout.js').YmCheckout|null} */
    this.ym = null;
    /** The desk (desk.js): set by SyncCore; the watcher warms its check-in page and catches its families up. @type {import('./desk.js').Desk|null} */
    this.desk = null;
    /** Who came the last two club nights (recent.js; SyncCore sets it). @type {any} */
    this.recent = null;
    /** The trends back-fill (trendsimport.js): set by mountHistory; the watcher only gives it a turn of the closed-window alarm. @type {import('./trendsimport.js').TrendsImport|null} */
    this.trends = null;
    /** The stations' roster, completed books and meeting report (stationfeeds.js): set by SyncCore; the watcher gives it its turns. @type {import('./stationfeeds.js').StationFeeds|null} */
    this.feeds = null;
    /** Children held on the report by a desk operation (barf.js): clubber id -> {entry, until}. Memory only. @type {Map<string, { entry: any, until: number }>} */
    this.holds = new Map();
    this.alarms = alarms || { set() {}, get: () => null };
    // warn, not log: the lint allows warn and error only, and `wrangler tail` shows both.
    this.log = log || ((line) => console.warn(line));
    /** @type {TwoTimTwoClient|null} */
    this.client = null;
    this.clientKey = '';
    /** @type {Promise<any>|null} */
    this.inFlight = null;
    /** The schedule the club-day rule reads (lobby/shared/schedule.json, bundled; tests swap it). */
    this.schedule = SCHEDULE;
  }

  /** 'off' unless CLOUD_CHECKIN says shadow; phase 1 knows no other mode. */
  get mode() {
    return String(this.env.CLOUD_CHECKIN || '').trim().toLowerCase() === 'shadow' ? 'shadow' : 'off';
  }

  creds() { return credentialsFrom(this.env); }

  /**
   * One client per set of credentials (a changed secret starts a new session).
   * Its check-in, undo and check-out posts are refused `no-club` on a day with
   * no club (writeGuard): the backstop under every entry's own early refusal.
   */
  clientFor() {
    const creds = this.creds();
    if (!creds) return null;
    const key = `${creds.host}\n${creds.username}\n${creds.password}`;
    if (!this.client || this.clientKey !== key) {
      this.client = new TwoTimTwoClient(creds, {
        fetchFn: this.fetchFn, now: this.now, budget: this.budget,
        // A desk test-day write (desk.js TEST DAYS) says so itself; everything else asks the day.
        writeGuard: async (/** @type {any} */ opts) => (opts && opts.testDay === true) || (await this.clubToday()).club ? null : 'no-club',
      });
      this.clientKey = key;
    }
    return this.client;
  }

  // ── no club tonight (clubday.js; owner 2026-10-13) ─────────────────────────
  // THE one place the rule is applied to TwoTimTwo writes: the desk's routes
  // (desk.js, barf.js) ask here BEFORE any read, claim or post, and the client's own posts ask again (clientFor's writeGuard), so a
  // path added later cannot post a check-in into whatever meeting TwoTimTwo
  // shows on a day with no club.

  /**
   * Is today a club day (the whole local day, the shared rule given the bundled
   * schedule and the calendar in storage), or is the print station rehearsing
   * (publisher.js `rehearsing`)? No TwoTimTwo read.
   * @returns {Promise<{ club: boolean, today: string, next: string|null, rehearsal?: true }>}
   */
  async clubToday() {
    /** @type {any} */
    let feed;
    try { feed = this.storage ? await this.storage.get('calendar') : null; } catch { feed = null; }
    const day = clubDay(this.now(), feed, this.schedule);
    if (day.club) return day;
    const pub = this.publisher;
    if (pub && typeof pub.rehearsing === 'function' && pub.rehearsing()) return { ...day, club: true, rehearsal: true };
    return day;
  }

  async loadStatus() {
    return (await this.storage.get('cloud:status')) || {
      date: null, reads: 0, okReads: 0, lastReadAt: null, lastOkAt: null, lastError: null,
      checkedIn: null, byClub: null, declared: null, verdict: null,
      tonight: { baseline: 0, addedOnTwoTimTwo: 0, undoneOnTwoTimTwo: 0, partial: 0, massUndoRefused: 0 },
      checkinPage: null, log: [],
    };
  }

  /** @param {any} status @param {string} kind @param {Record<string, unknown>} [detail] */
  note(status, kind, detail = {}) {
    status.log = [...(status.log || []), { at: new Date(this.now()).toISOString(), kind, ...detail }].slice(-LOG_MAX);
  }

  /** What the owner sees: nothing that names or identifies a child. */
  async status() {
    const s = await this.loadStatus();
    const w = watchWindow(this.now());
    const creds = this.creds();
    return {
      mode: this.mode,
      configured: !!creds,
      host: creds ? creds.host : null,
      windowOpen: w.open,
      nextWindowInMin: w.open ? 0 : Math.round(w.untilMs / 60000),
      readIntervalSec: READ_INTERVAL_MS / 1000,
      watchIntervalSec: WATCH_INTERVAL_MS / 1000,
      budget: this.budget.stats(),
      ...(this.desk ? { deskPage: { held: this.desk.hasNightPage(), readAt: this.desk.cache ? new Date(this.desk.cache.at).toISOString() : null, restored: !!this.desk.cache?.restored }, families: this.desk.familiesSource.stats() } : {}),
      signedIn: !!(this.client && this.client.cookies.size),
      loginBlockedForSec: this.client && this.client.loginBlockedUntil > this.now()
        ? Math.ceil((this.client.loginBlockedUntil - this.now()) / 1000) : 0,
      ...s,
    };
  }

  /**
   * Hold a child on the report (barf.js): until `untilMs`, a read that does not list
   * them is read as if it did, with `entry` (their report entry: clubber id, name,
   * club, friend). In memory only, never stored (it holds a name); a restart ends
   * every hold, and the truth (what TwoTimTwo lists) comes back with the next read.
   * @param {{ clubberId: string, name: string, club: string, friend?: boolean }} entry @param {number} untilMs
   */
  hold(entry, untilMs) {
    this.holds.set(entry.clubberId, { entry, until: untilMs });
  }

  /** Let go of a hold (now, or at `untilMs`). @param {string} clubberId @param {number} [untilMs] */
  unhold(clubberId, untilMs) {
    const h = this.holds.get(clubberId);
    if (!h) return;
    if (untilMs && untilMs > this.now()) h.until = untilMs;
    else this.holds.delete(clubberId);
  }

  /** Is this child held right now? @param {string} clubberId */
  held(clubberId) {
    const h = this.holds.get(clubberId);
    return !!h && h.until > this.now();
  }

  /**
   * The report with every held child on it. Pure but for dropping expired holds.
   * @template {{ entries: { clubberId: string }[] }} R @param {R} report @returns {R}
   */
  withHolds(report) {
    if (!this.holds.size) return report;
    const t = this.now();
    const listed = new Set(report.entries.map((e) => e.clubberId));
    const extra = [];
    for (const [id, h] of this.holds) {
      if (h.until <= t) { this.holds.delete(id); continue; }
      if (!listed.has(id)) extra.push({ ...h.entry });
    }
    return extra.length ? { ...report, entries: [...report.entries, ...extra] } : report;
  }

  /** Make sure an alarm is set while the watcher is on (cron, and every status read). */
  async arm() {
    // The desk's sealed check-in page never outlives the window, even with the
    // watcher switched off (its alarm then never runs): the cron asks here too.
    if (this.desk && !watchWindow(this.now()).open) {
      try { await this.desk.endOfNight(); } catch (err) { console.error('[cloud] purge of the check-in page failed', err); }
    }
    if (this.mode === 'off' || !this.creds()) return false;
    const at = await this.alarms.get();
    if (typeof at === 'number' && at > this.now()) return true;
    await this.alarms.set(this.now() + 1000);
    return true;
  }

  /**
   * The alarm. Window closed: forget the night and sleep to the next one.
   * Window open: ONE of two jobs per invocation, to stay inside the free
   * plan's CPU: the report read when it is due (about every WATCH_INTERVAL_MS,
   * and only when the shared read clock has a slot), otherwise seal at most
   * SEAL_PER_TICK waiting print jobs. Then set the next alarm. Never throws.
   */
  async tick() {
    if (this.mode === 'off' || !this.creds()) return { next: null };
    const w = watchWindow(this.now());
    let next;
    if (!w.open) {
      next = Math.min(w.untilMs, IDLE_MAX_MS);
      // The window has closed: tonight's claims and jobs are forgotten.
      try { await this.adopt?.endOfNight(); } catch (err) { console.error('[cloud] end-of-night purge failed', err); }
      try { await this.publisher?.endOfNight(); } catch (err) { console.error('[cloud] end-of-night purge of the names failed', err); }
      // ...and the desk's sealed copy of tonight's check-in page (desk.js `desk:page`).
      try { await this.desk?.endOfNight(); } catch (err) { console.error('[cloud] end-of-night purge of the check-in page failed', err); }
      // The youth check-out runs on to midnight (7:15 pm to midnight, past the
      // watch window): it sweeps from the last applied report and the Checkout page.
      if (this.ym && this.ym.due()) {
        await this.budget.load();
        try { await this.ym.step(); } catch (err) { console.error('[cloud] youth check-out failed', err); }
        next = this.ymWake(next);
      }
      // The stations' roster once a day (or when a station asked), and its seal (stationfeeds.js).
      let fed = false;
      if (this.feeds) {
        try { await this.feeds.endOfNight(); } catch (err) { console.error('[feeds] end-of-night purge failed', err); }
        const r = await this.feeds.onClosedAlarm(next);
        fed = r.did;
        next = r.next;
      }
      // The trends back-fill (trendsimport.js): one season read at the lowest priority, never in the window.
      if (this.trends && !fed) next = await this.trends.onAlarm(next);
    } else {
      await this.budget.load();
      await this.adopt?.load();
      const feeds = this.feeds;
      if (feeds) await feeds.load().catch((err) => console.error('[feeds] load failed', err));
      const before = await this.loadStatus();
      const reportAt = this.lastWatcherRead(before) + WATCH_INTERVAL_MS;
      // The next report's slot is the watcher's: other reads keep clear of it.
      this.budget.reserve(reportAt);
      const due = reportAt <= this.now();
      const families = this.desk ? this.desk.familiesSource : null;
      if (due && this.budget.peek() === 0) {
        try { await this.read(); } catch (err) { console.error('[cloud] watcher read failed', err); }
      } else if (this.budget.peek(false) === 0 && this.checkinPageDue(before)) {
        try { await this.probeCheckinPage(); } catch (err) { console.error('[cloud] check-in page probe failed', err); }
      } else if (this.budget.peek(false) === 0 && families && families.wanted()
        && await families.refresh().catch((err) => { console.error('[cloud] households catch-up failed', err); return false; })) {
        // One households re-read: a child the export did not list (families.js).
      } else if (this.budget.peek(false) === 0 && this.ym && this.ym.pageDue()
        && await this.ym.step().catch((err) => { console.error('[cloud] youth check-out failed', err); return false; })) {
        // The Checkout page, once a minute after 7:15 pm (ymcheckout.js).
      } else if (this.budget.peek(false) === 0 && feeds && feeds.readDue(true)
        && await feeds.step(true).catch((err) => { console.error('[feeds] read failed', err); return false; })) {
        // The stations' roster export (about hourly: labels' allergies), or a completed-books
        // pass / meeting report that has waited two of its turns (stationfeeds.js).
      } else if (this.budget.peek(false) === 0 && this.desk && this.desk.rosterRefreshInMs() === 0
        && await this.desk.refreshRoster().catch((err) => { console.error('[cloud] roster read ahead failed', err); return false; })) {
        // The roster's page read ahead, so the pages' next poll is answered at once.
      } else if (this.adopt && this.adopt.pending() > 0) {
        try { await this.adopt.drain(SEAL_PER_TICK); } catch (err) { console.error('[cloud] sealing a job failed', err); }
      } else if (feeds && feeds.sealDue()) {
        // One station's copy of the roster or the books, or one award slip (stationfeeds.js: one seal a tick).
        try { await feeds.sealOne(); } catch (err) { console.error('[feeds] sealing failed', err); }
      } else if (this.budget.peek(false) === 0 && feeds && feeds.readDue(false)
        && await feeds.step(false).catch((err) => { console.error('[feeds] read failed', err); return false; })) {
        // The completed books (one club a slot) and the meeting report, in a slot nothing above wanted.
      } else if (this.ym && this.ym.due() && await this.ym.step().catch((err) => { console.error('[cloud] youth check-out failed', err); return false; })) {
        // A Checkout page read or ONE check-out post (at most one every 15 s, ymcheckout.js).
      } else if (this.publisher) {
        // The minute's tally / ticker / still-here list, and anything a change left
        // waiting. (A tick that read the report published from onReport already; one
        // job per invocation keeps each inside the free plan's CPU.)
        await this.publisher.tick();
      }
      const s = await this.loadStatus();
      this.budget.reserve(this.lastWatcherRead(s) + WATCH_INTERVAL_MS);
      const reportIn = Math.max((this.budget.reserved ? this.budget.reserved.at : 0) - this.now(), this.budget.peek(), 1000);
      next = reportIn;
      // The free slot between reports, for the watcher's other reads.
      const other = this.otherWakeInMs(s);
      if (other !== null) next = Math.min(next, Math.max(other, this.budget.peek(false), 1000));
      // Jobs still waiting to be sealed: the next tick (not the next read) seals one.
      if (this.adopt && this.adopt.pending() > 0) next = Math.min(next, SPILL_MS);
      if (feeds && feeds.sealDue()) next = Math.min(next, SPILL_MS);
      next = this.ymWake(next);
      // A sign-in that is backing off waits it out instead of waking every few seconds.
      if (this.client && this.client.loginBlockedUntil > this.now()) {
        next = Math.max(next, this.client.loginBlockedUntil - this.now());
      }
      // So does one that met TwoTimTwo down or no network (twotimtwo.js DOWN_BACKOFF_MS).
      if (this.client && this.client.downUntil > this.now()) {
        next = Math.max(next, this.client.downUntil - this.now());
      }
    }
    await this.alarms.set(this.now() + next);
    return { next };
  }

  /**
   * The next alarm, brought forward for the youth check-out's next page read or
   * post, and pushed back for a sign-in that is backing off.
   * @param {number} next
   */
  ymWake(next) {
    const y = this.ym ? this.ym.wakeInMs() : null;
    if (y === null) return next;
    let n = Math.min(next, Math.max(y, 1000));
    if (this.client && this.client.loginBlockedUntil > this.now()) n = Math.max(n, this.client.loginBlockedUntil - this.now());
    if (this.client && this.client.downUntil > this.now()) n = Math.max(n, this.client.downUntil - this.now());
    return n;
  }

  /**
   * When the watcher's other reads next want a slot (ms), or null: the night's
   * check-in page, a households catch-up, the roster read ahead. (The youth
   * check-out's own wake is ymWake.)
   * @param {any} status
   */
  otherWakeInMs(status) {
    if (this.checkinPageDue(status)) return 0;
    const waits = [this.desk ? this.desk.familiesSource.wakeInMs() : null, this.desk ? this.desk.rosterRefreshInMs() : null, this.feeds ? this.feeds.wakeInMs() : null];
    const due = waits.filter((w) => w !== null);
    return due.length ? Math.min(...due) : null;
  }

  /** When the watcher last read the report (ms; 0 never). @param {{ lastReadAt?: string|null }} status */
  lastWatcherRead(status) {
    const own = status.lastReadAt ? Date.parse(status.lastReadAt) : 0;
    return Number.isFinite(own) ? own : 0;
  }

  /** The owner's "read now" (a rehearsal on any day): the one read clock. */
  async readNow() {
    if (this.mode === 'off') return { ok: false, error: 'off', status: await this.status() };
    if (!this.creds()) return { ok: false, error: 'not-configured', status: await this.status() };
    const r = await this.read();
    return { ...r, status: await this.status() };
  }

  /**
   * The Settings button's test: sign in and read the most recent club night's
   * report (today on a Wednesday), so it means something on any day. It
   * changes nothing the watcher keeps but the shared read clock; the answer is
   * counts only, and on an unreadable page its shape (title, table counts).
   */
  async testRead() {
    if (this.mode === 'off') return { ok: false, error: 'off', status: await this.status() };
    const client = this.clientFor();
    if (!client) return { ok: false, error: 'not-configured', status: await this.status() };
    if (this.inFlight) await this.inFlight.catch(() => {});
    const status = await this.loadStatus();
    const now = this.now();
    await this.budget.load();
    const throttled = async () => ({ ok: !!status.lastTest?.ok, throttled: true, test: status.lastTest || null, status: await this.status() });
    if (this.budget.peek() > 0) return throttled();
    const date = lastClubNight(now);
    const res = await client.report(date, { waitMs: 0, kind: 'settings-test' });
    if (!res.ok && res.error === 'read-busy') return throttled();
    status.reads += 1;
    status.lastReadAt = new Date(now).toISOString();
    /** @type {Record<string, any>} */
    let test;
    if (res.ok) {
      const kids = childrenOf(res.report.entries);
      test = {
        ok: true, date, checkedIn: Object.keys(kids).length, byClub: countByClub(kids), declared: res.report.declared,
        partial: res.report.declared !== null && res.report.entries.length < res.report.declared,
      };
      if (test.partial) test.rowShape = rowShape(res.html);
      test.columns = reportColumns(res.html);
      const page = await client.checkinPage({ waitMs: INTERACTIVE_WAIT_MS, kind: 'settings-test' });
      test.checkinPage = page.ok
        ? { ok: true, calendarId: page.page.calendarId, events: page.page.events.length }
        : { ok: false, error: page.error };
    } else {
      test = { ok: false, date, error: res.error, shape: 'shape' in res ? res.shape : null };
    }
    test.at = status.lastReadAt;
    status.lastTest = test;
    this.note(status, 'settings-test', { ok: test.ok, date });
    await this.storage.put('cloud:status', status);
    return { ok: test.ok, test, status: await this.status() };
  }

  /**
   * One read of tonight's report, applied by the rules above. Concurrent calls
   * share one read, and no read starts within READ_INTERVAL_MS of the last.
   * @returns {Promise<{ok: boolean, throttled?: boolean, error?: string, verdict?: string}>}
   */
  async read() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.readOnce().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async readOnce() {
    const status = await this.loadStatus();
    const now = this.now();
    await this.budget.load();
    if (this.budget.peek() > 0) return { ok: true, throttled: true, retryAfterMs: this.budget.peek() };
    const client = this.clientFor();
    if (!client) return { ok: false, error: 'not-configured' };
    const date = localTime(now).date;
    const creds = /** @type {{password: string}} */ (this.creds());

    // A new night starts clean: tonight's counters and a fresh baseline.
    let snap = await openState(creds.password, await this.storage.get('cloud:snap'));
    if (status.date !== date) {
      Object.assign(status, {
        date, checkedIn: null, byClub: null, declared: null, verdict: null, checkinPage: null,
        tonight: { baseline: 0, addedOnTwoTimTwo: 0, undoneOnTwoTimTwo: 0, partial: 0, massUndoRefused: 0 },
      });
      this.note(status, 'new-night');
    }
    if (!snap || snap.date !== date) snap = null;

    const loginsBefore = client.logins;
    // waitMs 0: the watcher never queues for a slot, it skips its turn. priority:
    // the slot it reserved is its own.
    const res = await client.report(date, { waitMs: 0, kind: 'watcher', priority: true });
    if (!res.ok && res.error === 'read-busy') return { ok: true, throttled: true, retryAfterMs: res.retryAfterMs };
    status.reads += 1;
    // When the report was read: after a sign-in (its own slots on the clock) that is later than `now`.
    status.lastReadAt = new Date(Math.max(now, client.lastReadMs || 0)).toISOString();
    if (client.logins > loginsBefore) this.note(status, 'sign-in', { ok: res.ok || res.error !== 'login-refused' });
    if (!res.ok) {
      status.lastError = res.error;
      status.lastShape = 'shape' in res ? res.shape : null;
      this.note(status, 'error', { error: res.error });
      this.log(`[cloud] shadow: report read failed (${res.error})`);
      await this.storage.put('cloud:status', status);
      return { ok: false, error: res.error };
    }

    // A child a desk operation holds (a late BARF friend's undo and redo, barf.js) is
    // read as on the report while the hold lasts, so the brief gap is never seen.
    const report = this.withHolds(res.report);
    const { verdict, kids, added, gone } = compareReport(snap ? snap.kids : null, report);
    status.okReads += 1;
    status.lastOkAt = status.lastReadAt;
    status.lastError = null;
    status.lastShape = null;
    status.verdict = verdict;
    status.declared = res.report.declared;
    if (verdict === 'partial') {
      status.tonight.partial += 1;
      this.note(status, 'partial', { parsed: res.report.entries.length, declared: res.report.declared });
      this.log(`[cloud] shadow: report partial (${res.report.entries.length} of ${res.report.declared}); nothing changed`);
    } else if (verdict === 'mass-undo') {
      status.tonight.massUndoRefused += 1;
      this.note(status, 'mass-undo-refused', { before: Object.keys(snap?.kids || {}).length, now: Object.keys(kids).length });
      this.log('[cloud] shadow: a read that would drop more than half the room was refused; nothing changed');
    } else {
      status.checkedIn = Object.keys(kids).length;
      status.byClub = countByClub(kids);
      if (verdict === 'baseline') {
        status.tonight.baseline = status.checkedIn;
        this.note(status, 'baseline', { checkedIn: status.checkedIn });
      }
      if (added.length) {
        status.tonight.addedOnTwoTimTwo += added.length;
        this.note(status, 'checked-in-on-twotimtwo', { count: added.length, clubs: clubsOf(added, kids) });
        this.log(`[cloud] shadow: would print and greet ${added.length} check-in(s) made on TwoTimTwo`);
      }
      if (gone.length) {
        status.tonight.undoneOnTwoTimTwo += gone.length;
        this.note(status, 'undone-on-twotimtwo', { count: gone.length, clubs: clubsOf(gone, snap?.kids || {}) });
        this.log(`[cloud] shadow: would stop counting ${gone.length} child(ren) undone on TwoTimTwo`);
      }
      if (verdict === 'baseline' || added.length || gone.length) {
        this.log(`[cloud] shadow: would publish tally ${JSON.stringify(wouldPublishTally(kids, now))}`);
      }
      await this.storage.put('cloud:snap', await sealState(creds.password, { date, kids }));
      // Who is in, for the youth check-out (in memory; it reads no report of its own).
      this.ym?.onReport({ date, kids });
      // A child the households export does not list: a family to catch up (families.js).
      this.desk?.familiesSource.noteChildren(date, res.report.entries.map((e) => e.name));
      // Who is checked in, for the desk's roster (the check-in page drops their rows; desk.js onReport).
      this.desk?.onReport(date, res.report.entries);
      // Who came tonight, as keyed hashes in D1, for "Not here the last two club nights" (recent.js).
      if (this.recent) await this.recent.record(date, res.report.entries);
      // The count's own state (tonight.js): what an applied report says, first names and clubs only.
      if (this.publisher) {
        try { await this.publisher.onReport({ night: date, at: now, entries: report.entries }); } catch (err) { console.error('[cloud] publishing the count failed', err); }
      }
      // The claims and print jobs follow what the report says (adopt.js; the
      // children's names stay in this call's memory and are sealed there).
      if (this.adopt && verdict === 'applied') {
        const first = new Map();
        for (const e of report.entries) if (!first.has(e.clubberId)) first.set(e.clubberId, e);
        try {
          await this.adopt.onReport({
            night: date,
            added: added.map((id) => first.get(id)).filter((e) => !!e),
            gone,
          });
        } catch (err) { console.error('[cloud] adopting the report failed', err); }
      }
    }

    await this.storage.put('cloud:status', status);
    return { ok: true, verdict };
  }

  /**
   * Once a night, the check-in page: proves tonight's meeting and its check-in
   * items can be read (the desk posts with them), and warms the desk's copy, so
   * a check-in reads nothing (owner 2026-10-12). Ids and counts only. It takes
   * its own slot on the read clock, so it runs on a tick the report did not
   * (tick() asks `checkinPageDue()` first). A failed read is tried again after
   * CHECKIN_PAGE_RETRY_MS, never every tick.
   */
  checkinPageDue(status) {
    const last = status.checkinPage;
    // The desk holds none for tonight (a restarted object): read it again, so a
    // check-in never has to.
    if (this.desk && !this.desk.hasNightPage() && last && last.ok) return true;
    return !last || (!last.ok && this.now() - Date.parse(last.at) >= CHECKIN_PAGE_RETRY_MS);
  }

  async probeCheckinPage() {
    const client = this.clientFor();
    if (!client) return;
    const status = await this.loadStatus();
    const page = await client.checkinPage({ waitMs: 0, kind: 'watcher' });
    if (!page.ok && page.error === 'read-busy') return;
    // The desk keeps it for the night: a check-in then reads nothing.
    if (page.ok) await this.desk?.warm(page.page, this.now());
    const at = new Date(this.now()).toISOString();
    status.checkinPage = page.ok
      ? { ok: true, at, calendarId: page.page.calendarId, events: page.page.events.length,
        attendanceItem: page.page.events.some((e) => e.automatic), roster: page.page.roster.length }
      : { ok: false, at, error: page.error };
    this.note(status, 'checkin-page', { ok: page.ok });
    if (!page.ok) this.log(`[cloud] shadow: check-in page unreadable (${page.error})`);
    await this.storage.put('cloud:status', status);
  }
}

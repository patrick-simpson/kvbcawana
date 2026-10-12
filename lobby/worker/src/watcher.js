// The report watcher (ROADMAP.md#cloud-check-in, piece 2, phase 1: READ-ONLY SHADOW).
//
// During the club window a Durable Object alarm reads TwoTimTwo's check-in
// report every 5 seconds (TwoTimTwo's terms: ONE read every 5 s, every read
// combined, never faster: a manual "read now" shares the same clock, and the
// alarm skips its turn when any other read, a phone's roster say, was made in
// the last 5 s) and compares it with the last read:
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

import { TwoTimTwoClient, credentialsFrom, itemsToSend, reportColumns, rowShape } from './twotimtwo.js';
import { fromBase64, toBase64 } from './crypto.js';
import { INTERACTIVE_WAIT_MS, READ_INTERVAL_MS, ReadBudget } from './readbudget.js';
import { massUndoRefused, reportIsPartial } from '../../shared/tonight.js';

export { READ_INTERVAL_MS };
/**
 * TwoTimTwo's terms (owner, 2026-10-11, superseding the first 15 s): one read
 * every 5 seconds, ALL reads combined. Every read, the watcher's own included,
 * takes a slot from the one clock in readbudget.js (the client does it before
 * each page GET). The watcher's report is read about every WATCH_INTERVAL_MS,
 * which leaves the slots in between to the desk, the phone page and the
 * check-in and checkout pages.
 */
export const WATCH_INTERVAL_MS = 10 * 1000;
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
    this.alarms = alarms || { set() {}, get: () => null };
    // warn, not log: the lint allows warn and error only, and `wrangler tail` shows both.
    this.log = log || ((line) => console.warn(line));
    /** @type {TwoTimTwoClient|null} */
    this.client = null;
    this.clientKey = '';
    /** @type {Promise<any>|null} */
    this.inFlight = null;
  }

  /** 'off' unless CLOUD_CHECKIN says shadow; phase 1 knows no other mode. */
  get mode() {
    return String(this.env.CLOUD_CHECKIN || '').trim().toLowerCase() === 'shadow' ? 'shadow' : 'off';
  }

  creds() { return credentialsFrom(this.env); }

  /** One client per set of credentials (a changed secret starts a new session). */
  clientFor() {
    const creds = this.creds();
    if (!creds) return null;
    const key = `${creds.host}\n${creds.username}\n${creds.password}`;
    if (!this.client || this.clientKey !== key) {
      this.client = new TwoTimTwoClient(creds, { fetchFn: this.fetchFn, now: this.now, budget: this.budget });
      this.clientKey = key;
    }
    return this.client;
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
      signedIn: !!(this.client && this.client.cookies.size),
      loginBlockedForSec: this.client && this.client.loginBlockedUntil > this.now()
        ? Math.ceil((this.client.loginBlockedUntil - this.now()) / 1000) : 0,
      ...s,
    };
  }

  /** Make sure an alarm is set while the watcher is on (cron, and every status read). */
  async arm() {
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
    } else {
      await this.budget.load();
      await this.adopt?.load();
      const before = await this.loadStatus();
      const due = this.lastWatcherRead(before) + WATCH_INTERVAL_MS <= this.now();
      if (due && this.budget.peek() === 0) {
        try { await this.read(); } catch (err) { console.error('[cloud] watcher read failed', err); }
      } else if (this.budget.peek() === 0 && this.checkinPageDue(before)) {
        try { await this.probeCheckinPage(); } catch (err) { console.error('[cloud] check-in page probe failed', err); }
      } else if (this.adopt && this.adopt.pending() > 0) {
        try { await this.adopt.drain(SEAL_PER_TICK); } catch (err) { console.error('[cloud] sealing a job failed', err); }
      } else if (this.publisher) {
        // The minute's tally / ticker / still-here list, and anything a change left
        // waiting. (A tick that read the report published from onReport already; one
        // job per invocation keeps each inside the free plan's CPU.)
        await this.publisher.tick();
      }
      const s = await this.loadStatus();
      next = Math.max(this.lastWatcherRead(s) + WATCH_INTERVAL_MS - this.now(), this.budget.peek(), 1000);
      // Jobs still waiting to be sealed: the next tick (not the next read) seals one.
      if (this.adopt && this.adopt.pending() > 0) next = Math.min(next, SPILL_MS);
      // A sign-in that is backing off waits it out instead of waking every 5 s.
      if (this.client && this.client.loginBlockedUntil > this.now()) {
        next = Math.max(next, this.client.loginBlockedUntil - this.now());
      }
    }
    await this.alarms.set(this.now() + next);
    return { next };
  }

  /** When the watcher last read the report (ms; 0 never). @param {{ lastReadAt?: string|null }} status */
  lastWatcherRead(status) {
    const own = status.lastReadAt ? Date.parse(status.lastReadAt) : 0;
    return Number.isFinite(own) ? own : 0;
  }

  /** The owner's "read now" (a rehearsal on any day): the same 5 s clock. */
  async readNow() {
    if (this.mode === 'off') return { ok: false, error: 'off', status: await this.status() };
    if (!this.creds()) return { ok: false, error: 'not-configured', status: await this.status() };
    const r = await this.read();
    return { ...r, status: await this.status() };
  }

  /**
   * Check one child in on TwoTimTwo (ROADMAP.md#cloud-check-in phase 4's first piece,
   * owner-only: a signed-in screen asks, never the watcher). Without
   * `confirm: true` it only previews: who it found, their club, and the
   * meeting the check-in would record on. It sends what the check-in page
   * would: Attendance (every automatic item), plus Bible and Brought a friend
   * when `options` ticks them, each only where it applies to the child's club.
   * The answer names the child (the caller asked for them by name); nothing
   * stored or logged does.
   * @param {{name?: unknown, clubberId?: unknown, confirm?: unknown, options?: unknown}} body
   */
  async checkIn(body) {
    if (this.mode === 'off') return { ok: false, error: 'off' };
    const client = this.clientFor();
    if (!client) return { ok: false, error: 'not-configured' };
    const wantId = /^\d{1,20}$/.test(String(body.clubberId ?? '')) ? String(body.clubberId) : '';
    const wantName = String(body.name ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
    if (!wantId && !wantName) return { ok: false, error: 'no-child' };
    const page = await client.checkinPage({ waitMs: INTERACTIVE_WAIT_MS, kind: 'desk-checkin' });
    if (!page.ok) return { ok: false, error: page.error, ...('retryAfterMs' in page ? { retryAfterMs: page.retryAfterMs } : {}) };
    const found = page.page.roster.filter((r) => (wantId ? r.clubberId === wantId : r.name.toLowerCase() === wantName));
    if (!found.length) return { ok: false, error: 'not-found' };
    if (found.length > 1) return { ok: false, error: 'ambiguous', matches: found.length };
    const child = found[0];
    const o = body.options && typeof body.options === 'object' ? /** @type {any} */ (body.options) : {};
    const events = itemsToSend(page.page.events, child.clubId, { Bible: o.Bible === true, Friend: o.Friend === true });
    const hasAttendance = page.page.events.some((e) => e.automatic && (!e.clubs.length || e.clubs.includes(child.clubId)));
    const preview = {
      child: { name: child.name, club: child.club, clubberId: child.clubberId },
      meeting: { calendarId: page.page.calendarId, date: page.page.meetingDate },
      events: events.length,
    };
    if (child.checkedIn) return { ok: false, error: 'already-checked-in', ...preview };
    if (!hasAttendance) return { ok: false, error: 'no-attendance-item', ...preview };
    if (body.confirm !== true) return { ok: true, preview: true, ...preview };
    const res = await client.checkIn({ clubberId: child.clubberId, calendarId: page.page.calendarId, events, name: child.name });
    const status = await this.loadStatus();
    this.note(status, 'cloud-check-in', { ok: res.ok, club: child.club });
    await this.storage.put('cloud:status', status);
    return res.ok ? { ok: true, checkedIn: true, ...preview } : { ok: false, error: res.error, ...preview };
  }

  /**
   * The Settings button's test: sign in and read the most recent club night's
   * report (today on a Wednesday), so it means something on any day. It
   * changes nothing the watcher keeps but the shared 5 s clock; the answer is
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
    // waitMs 0: the watcher never queues for a slot, it skips its turn.
    const res = await client.report(date, { waitMs: 0, kind: 'watcher' });
    if (!res.ok && res.error === 'read-busy') return { ok: true, throttled: true, retryAfterMs: res.retryAfterMs };
    status.reads += 1;
    status.lastReadAt = new Date(now).toISOString();
    if (client.logins > loginsBefore) this.note(status, 'sign-in', { ok: res.ok || res.error !== 'login-refused' });
    if (!res.ok) {
      status.lastError = res.error;
      status.lastShape = 'shape' in res ? res.shape : null;
      this.note(status, 'error', { error: res.error });
      this.log(`[cloud] shadow: report read failed (${res.error})`);
      await this.storage.put('cloud:status', status);
      return { ok: false, error: res.error };
    }

    const { verdict, kids, added, gone } = compareReport(snap ? snap.kids : null, res.report);
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
      // The count's own state (tonight.js): what an applied report says, first names and clubs only.
      if (this.publisher) {
        try { await this.publisher.onReport({ night: date, at: now, entries: res.report.entries }); } catch (err) { console.error('[cloud] publishing the count failed', err); }
      }
      // The claims and print jobs follow what the report says (adopt.js; the
      // children's names stay in this call's memory and are sealed there).
      if (this.adopt && verdict === 'applied') {
        const first = new Map();
        for (const e of res.report.entries) if (!first.has(e.clubberId)) first.set(e.clubberId, e);
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
   * items can be read (the desk posts with them). Ids and counts only. It takes
   * its own slot on the read clock, so it runs on a tick the report did not
   * (tick() asks `checkinPageDue()` first). A failed read is tried again after
   * CHECKIN_PAGE_RETRY_MS, never every tick.
   */
  checkinPageDue(status) {
    const last = status.checkinPage;
    return !last || (!last.ok && this.now() - Date.parse(last.at) >= CHECKIN_PAGE_RETRY_MS);
  }

  async probeCheckinPage() {
    const client = this.clientFor();
    if (!client) return;
    const status = await this.loadStatus();
    const page = await client.checkinPage({ waitMs: 0, kind: 'watcher' });
    if (!page.ok && page.error === 'read-busy') return;
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

// @ts-check
// The trends back-fill (owner 2026-10-13: "For the trends page, can the worker
// grab the data off TwoTimTwo, then import it into the database in
// Cloudflare."). The History section's trends read `night_summary` (the desk's
// live counts). This fills the seasons before the desk existed, and keeps the
// current one honest, from TwoTimTwo's own Attendance Summary report:
//
//   GET /report/attendance_summary?year_start=<season's first year>&output=csv
//   "Meeting","Puggles","","Cubbies","","Sparks","","T&T","","Trek","","Journey","","TOTAL",""
//
// one row per meeting, newest first, a count per club (printer/docs/TWOTIMTWO.md
// sections 4, 5 and 8.1: its totals agree with the check-in report's Count:
// footers). COUNTS ONLY: the report carries no names and nothing here keeps one.
//
// WHAT IT DOES, BY ITSELF (owner's decisions, 2026-10-13; no button)
//   - the first time it can (TWOTIMTWO_* secrets set, cloud check-in not off,
//     HISTORY_DB bound) it reads the CURRENT season, then walks back one season
//     at a time, one read each, until a season has no meetings (SEASONS_MAX
//     seasons at most, the current one included);
//   - after every club night's watch window closes it reads the current season
//     once more, so a paper sheet entered late flows in; an older season is
//     never read again once done.
// It runs from the watcher's alarm (ONE hook line in Watcher.tick), only while
// the watch window is CLOSED and the youth check-out is not due, so it never
// touches a club night's reads; a season read is ONE page on the one read
// clock (readbudget.js) with waitMs 0 and no priority: the lowest of all. A
// clock that is booked means "next tick". A restart resumes from `trends:import`.
//
// STRICT AND SAFE (parseAttendanceSummary): the exact header shape (Meeting,
// then each club the app's club table knows with its blank partner column,
// then TOTAL), every row the same width, a count is digits or blank, a row's
// club counts must add up to its TOTAL, a meeting cell is a date (else a known
// summary word, else the season is refused), never a night after today, counts
// clamped 0..COUNT_MAX. Anything off and the WHOLE season is refused: nothing
// stored, status 'unreadable', tried again after a day, at most 3 times.
// What the blank partner column means (a percent?) is not documented: it is
// never read beyond being number-like.
//
// WHAT IS STORED
//   D1 `night_summary_import (night, club, attended, imported_at)` (migration
//   0003): numbers only. A season is written in ONE atomic D1 batch (one DELETE
//   of the season's range, then multi-row upserts of 32 rows each, so a season
//   of ~250 lines is 9 statements, inside the free plan's per-invocation query
//   limit and D1's 100 bound parameters). GET /v1/history/summary answers the
//   LIVE `night_summary` line where one exists for a night and club, else the
//   imported count as `checkedIn` with `imported: true`, so a night is never
//   counted twice and the desk's own count always wins (history.js).
//   DO storage `trends:import`: a small JSON of seasons, times and fixed codes.
//
// THE SELF-CHECK (owner 2026-10-13: "after its first run, compare one imported
// night with TwoTimTwo", automated): after every season it stores, ONE SELECT
// puts each night and club that has BOTH a live desk line (night_summary,
// checked_in > 0) and an imported count side by side: the desk's number
// (checked_in less undone) against TwoTimTwo's. The tally, counted by NIGHT (a
// night agrees when every club on it agrees), and up to 5 differing lines
// (night, club, the two numbers) go into `trends:import` as `crosscheck`; no
// name, nothing written to D1. A night the desk counted only some children
// reads lower at the desk: that is expected, and the History section says so.
// The check can only see nights the desk ran; before that, nothing compares.
//
// FREE PLAN: a season is one TwoTimTwo read, one D1 batch, one D1 SELECT (the
// self-check) and one small storage write; the whole back-fill is at most 20
// reads, once; then one read a week.

import { clubIdByAlias, CLUB_TABLE } from '../../shared/clubs.js';
import { Doc } from './doc.js';
import { READ_INTERVAL_MS } from './readbudget.js';
import { CLUB_NIGHTS, GRACE_MIN, localTime, watchWindow } from './watcher.js';

export const STATE_KEY = 'trends:import';
/** Seasons walked at most, the current one included (owner: every season TwoTimTwo has, capped). */
export const SEASONS_MAX = 20;
/** A count above this is clamped (no club night has 2000 in one club). */
export const COUNT_MAX = 2000;
/** More data rows than this in one season is not an Awana season. */
export const ROWS_MAX = 150;
/** Back-off after a failed read or write, one step per failure in a row. */
export const BACKOFF_MS = Object.freeze([5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000]);
/** A refused (unreadable) season, or TwoTimTwo refusing the report itself, waits this long. */
export const UNREADABLE_RETRY_MS = 24 * 60 * 60 * 1000;
/** Tries per unreadable season, then it is skipped (the current season gets fresh tries after each club night). */
export const UNREADABLE_TRIES = 3;
/** Desk lines the self-check reads at most, newest first (the desk era is a few seasons of ~35 nights x 6 clubs). */
export const CROSSCHECK_LINES_MAX = 2000;
/** Differing lines kept as examples. */
export const CROSSCHECK_EXAMPLES = 5;
/** Rows per INSERT: 1 + 32 x 3 = 97 bound parameters (D1 allows 100). */
const ROWS_PER_STATEMENT = 32;
const D1_TIMEOUT_MS = 8000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The Awana season a local date is in: its first year (August to July). @param {string} date YYYY-MM-DD */
export function seasonOfDate(date) {
  const y = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 8 ? y : y - 1;
}

/** The season running at `ms` (the church's local date). @param {number} ms */
export function currentSeason(ms) {
  return seasonOfDate(localTime(ms).date);
}

/** "2025-26", the History section's own label (historyTrends.js seasonOf). @param {number} start */
export function seasonLabel(start) {
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** @param {number} n */
const pad2 = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD shifted by whole days (calendar arithmetic, no time zone). @param {string} date @param {number} days */
function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** @param {string} hm */
function minutesOf(hm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/**
 * The local date of the most recent club night whose watch window has CLOSED
 * by `ms` (today's counts once 9 pm has passed). Calendar arithmetic only.
 * @param {number} ms
 */
export function lastClosedClubNight(ms) {
  const t = localTime(ms);
  for (let back = 0; back <= 7; back++) {
    const dow = (t.dow - back + 7) % 7;
    for (const n of CLUB_NIGHTS) {
      if (n.dow !== dow) continue;
      const close = Math.min(minutesOf(n.end) + GRACE_MIN, 24 * 60);
      if (back > 0 || t.minutes >= close) return addDays(t.date, -back);
    }
  }
  return addDays(t.date, -7);
}

/**
 * The last night that may be imported at `ms`: today once today's club window
 * has closed (or today is not a club night), else yesterday. Never later.
 * @param {number} ms
 */
export function importCutoff(ms) {
  const t = localTime(ms);
  const tonight = CLUB_NIGHTS.find((n) => n.dow === t.dow);
  if (!tonight) return t.date;
  return t.minutes >= Math.min(minutesOf(tonight.end) + GRACE_MIN, 24 * 60) ? t.date : addDays(t.date, -1);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** @param {string} word "Sep", "Sept", "September" @returns {number} 1..12, or 0 */
function monthOf(word) {
  const w = word.toLowerCase();
  const i = MONTHS.indexOf(w.slice(0, 3));
  if (i < 0) return 0;
  const full = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'][i];
  return w.length === 3 || (i === 8 && w === 'sept') || w === full ? i + 1 : 0;
}

/** @param {number} y @param {number} m @param {number} d @returns {string|null} */
function realDate(y, m, d) {
  if (!(y >= 2000 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const iso = `${y}-${pad2(m)}-${pad2(d)}`;
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * A Meeting cell as a date. The cell's format is NOT documented (the tenant's
 * date format is M/D/Y, docs 8.3; the grid's date headings are "Sep02" with no
 * year), so this reads a few exact shapes and nothing looser: YYYY-MM-DD,
 * M/D/YYYY, M/D/YY, M/D, "Sep02", "Sep 2", "September 2, 2025", "2 Sep 2025",
 * each optionally after a weekday ("Wed ", "Wednesday, ") and before a time
 * ("6:00 PM"). With no year, the year comes from the Aug-1 season boundary
 * (the extension's gridDateToIso). `hasYear` says which.
 * @param {string} cell @param {number} season the season's first year
 * @returns {{ iso: string, hasYear: boolean } | null}
 */
export function meetingDate(cell, season) {
  let s = String(cell || '').trim().replace(/\s+/g, ' ');
  s = s.replace(/^(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|rsday|urday)?\.?,? /i, '');
  s = s.replace(/ \d{1,2}:\d{2}(?::\d{2})? ?(?:[ap]\.?m\.?)?$/i, '');
  const noYear = (/** @type {number} */ m, /** @type {number} */ d) => {
    const iso = realDate(m >= 8 ? season : season + 1, m, d);
    return iso ? { iso, hasYear: false } : null;
  };
  const withYear = (/** @type {number} */ y, /** @type {number} */ m, /** @type {number} */ d) => {
    const iso = realDate(y < 100 ? 2000 + y : y, m, d);
    return iso ? { iso, hasYear: true } : null;
  };
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return withYear(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/.exec(s))) return withYear(Number(m[3]), Number(m[1]), Number(m[2]));
  if ((m = /^(\d{1,2})\/(\d{1,2})$/.exec(s))) return noYear(Number(m[1]), Number(m[2]));
  if ((m = /^([A-Za-z]{3,9})\.? ?(\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?$/.exec(s))) {
    const mo = monthOf(m[1]);
    if (!mo) return null;
    return m[3] ? withYear(Number(m[3]), mo, Number(m[2])) : noYear(mo, Number(m[2]));
  }
  if ((m = /^(\d{1,2}) ([A-Za-z]{3,9})\.?(?:,? (\d{4}))?$/.exec(s))) {
    const mo = monthOf(m[2]);
    if (!mo) return null;
    return m[3] ? withYear(Number(m[3]), mo, Number(m[1])) : noYear(mo, Number(m[1]));
  }
  return null;
}

/**
 * CSV text as rows of cells (quotes, doubled quotes, CR/LF), as the household
 * parser reads TwoTimTwo's CSVs. @param {string} text @returns {string[][]}
 */
export function csvRows(text) {
  /** @type {string[][]} */
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = ''; rows.push(row); row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** A 32-bit FNV-1a of the report's body, so a season that comes back identical to another is seen (TwoTimTwo ignoring year_start). @param {string} s */
function fingerprint(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

const COUNT_RE = /^\d{1,5}$/;
/** The blank-headed partner column: its meaning is not documented, so it must only look like a number (a count or a percent). */
const PARTNER_RE = /^[0-9][0-9.,]{0,9}\s?%?$|^\.[0-9]{1,6}\s?%?$/;
const SUMMARY_WORD_RE = /^(?:total|totals|grand total|average|averages|avg|mean|sum|count)\b/i;

/**
 * TwoTimTwo's Attendance Summary CSV for one season, read strictly. Pure.
 * @param {string} text the CSV
 * @param {number} season the season's first year (year_start)
 * @param {string} cutoff the last night that may be imported (YYYY-MM-DD)
 * @returns {{ ok: true, nights: { night: string, counts: Record<string, number> }[], fp: string }
 *   | { ok: false, why: 'not-csv'|'header'|'row-shape'|'bad-date'|'bad-count'|'total-mismatch'|'duplicate-night'|'out-of-season'|'too-many-rows' }}
 */
export function parseAttendanceSummary(text, season, cutoff) {
  const t = String(text || '').replace(/^\uFEFF/, '');
  if (!t.trim() || /^\s*</.test(t) || /name\s*=\s*["']LoginForm\[/i.test(t)) return { ok: false, why: 'not-csv' };
  const rows = csvRows(t);
  const head = (rows[0] || []).map((h) => h.trim());
  // The exact shape: Meeting, (club, '') per club, TOTAL, ''.
  const width = head.length;
  if (width < 5 || width % 2 !== 1 || head[0] !== 'Meeting' || head[width - 2] !== 'TOTAL' || head[width - 1] !== '') return { ok: false, why: 'header' };
  /** @type {string[]} the club table's display names, one per header pair */
  const clubs = [];
  for (let i = 1; i < width - 2; i += 2) {
    const id = clubIdByAlias(head[i]);
    const club = CLUB_TABLE.find((c) => c.id === id);
    if (!head[i] || head[i + 1] !== '' || !club || clubs.includes(club.name)) return { ok: false, why: 'header' };
    clubs.push(club.name);
  }
  const first = `${season}-08-01`;
  const last = `${season + 1}-07-31`;
  /** @type {{ night: string, counts: Record<string, number> }[]} */
  const nights = [];
  const seen = new Set();
  let dataRows = 0;
  for (const raw of rows.slice(1)) {
    const row = raw.map((c) => c.trim());
    if (row.every((c) => c === '')) continue;   // a blank line
    if (row.length !== width) return { ok: false, why: 'row-shape' };
    if (++dataRows > ROWS_MAX) return { ok: false, why: 'too-many-rows' };
    /** @type {(number|null)[]} */
    const cells = [];
    for (let i = 1; i < width; i += 2) {
      const v = row[i];
      if (v !== '' && !COUNT_RE.test(v)) return { ok: false, why: 'bad-count' };
      if (row[i + 1] !== '' && !PARTNER_RE.test(row[i + 1])) return { ok: false, why: 'bad-count' };
      cells.push(v === '' ? null : Number(v));
    }
    const total = cells.pop();
    const sum = cells.reduce((/** @type {number} */ n, v) => n + (v ?? 0), 0);
    if (total !== null && total !== undefined && total !== sum) return { ok: false, why: 'total-mismatch' };
    const date = meetingDate(row[0], season);
    if (!date) {
      // Not a date: a summary row ("Total", "Average") or a spacer, else not this report.
      if (row[0] === '' && sum === 0) continue;
      if (SUMMARY_WORD_RE.test(row[0])) continue;
      return { ok: false, why: 'bad-date' };
    }
    if (date.iso < first || date.iso > last) return { ok: false, why: 'out-of-season' };
    if (seen.has(date.iso)) return { ok: false, why: 'duplicate-night' };
    seen.add(date.iso);
    // The next, unheld meeting (all blank, TOTAL 0), a cancelled night, and any night after today: nothing.
    if (date.iso > cutoff || sum === 0) continue;
    /** @type {Record<string, number>} */
    const counts = {};
    clubs.forEach((club, i) => {
      const n = Math.max(0, Math.min(COUNT_MAX, cells[i] ?? 0));
      if (n > 0) counts[club] = n;
    });
    nights.push({ night: date.iso, counts });
  }
  nights.sort((a, b) => (a.night < b.night ? -1 : 1));
  return { ok: true, nights, fp: fingerprint(rows.slice(1).map((r) => r.join(',')).join('\n')) };
}

/**
 * @typedef {{ night: string, club: string, desk: number, twotimtwo: number }} CrossLine
 * @typedef {{ compared: number, matching: number, differing: number, deskHigher: number, examples: CrossLine[], at: number }} CrossCheck
 */

const NIGHT_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLUB_NAMES = new Set(CLUB_TABLE.map((c) => c.name));

/**
 * The self-check's tally, pure. `lines` are the desk's and TwoTimTwo's numbers
 * for the same night and club, newest night first. Counted by night: a night
 * agrees when every club on it agrees; `deskHigher` counts the differing nights
 * where the desk counted MORE than TwoTimTwo in some club (the unexpected way:
 * a desk that counted only some children reads lower). Only a real date, a
 * club of the club table and two whole numbers are kept: a fixed shape.
 * @param {any[]} lines @param {number} at
 * @returns {CrossCheck}
 */
export function crossCheckOf(lines, at) {
  /** @type {Map<string, { differs: boolean, higher: boolean }>} */
  const nights = new Map();
  /** @type {CrossLine[]} */
  const examples = [];
  for (const l of lines || []) {
    const night = String(l?.night ?? '');
    const club = String(l?.club ?? '');
    const desk = Number(l?.desk);
    const twotimtwo = Number(l?.twotimtwo);
    if (!NIGHT_RE.test(night) || !CLUB_NAMES.has(club) || !Number.isInteger(desk) || !Number.isInteger(twotimtwo) || desk < 0 || twotimtwo < 0) continue;
    const n = nights.get(night) || { differs: false, higher: false };
    if (desk !== twotimtwo) {
      n.differs = true;
      if (desk > twotimtwo) n.higher = true;
      if (examples.length < CROSSCHECK_EXAMPLES) examples.push({ night, club, desk, twotimtwo });
    }
    nights.set(night, n);
  }
  const all = [...nights.values()];
  const differing = all.filter((n) => n.differs).length;
  return {
    compared: all.length,
    matching: all.length - differing,
    differing,
    deskHigher: all.filter((n) => n.higher).length,
    examples,
    at,
  };
}

/**
 * @typedef {{ tries: number, nextAt: number, night: string, why: string }} Refusal
 * @typedef {{
 *   v: 1, seasons: Record<string, { nights: number, importedAt: number, fp: string }>,
 *   next: number|null, walkDone: boolean, ended: 'empty'|'cap'|'year-ignored'|null,
 *   unreadable: Record<string, Refusal>, skipped: number[],
 *   refreshedFor: string|null, lastRunAt: number, lastOkAt: number, currentSeasonLastAt: number,
 *   nextDueAt: number, lastError: string|null, unreadableWhy: string|null, errors: number,
 *   crosscheck?: CrossCheck|null,
 * }} State
 */

/** @returns {State} */
const freshState = () => ({
  v: 1, seasons: {}, next: null, walkDone: false, ended: null, unreadable: {}, skipped: [],
  refreshedFor: null, lastRunAt: 0, lastOkAt: 0, currentSeasonLastAt: 0, nextDueAt: 0,
  lastError: null, unreadableWhy: null, errors: 0, crosscheck: null,
});

/**
 * @param {Promise<any>} p @param {number} ms
 */
function withTimeout(p, ms) {
  /** @type {any} */ let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('d1 timeout')), ms); })]).finally(() => clearTimeout(t));
}

export class TrendsImport {
  /**
   * @param {{ storage: { get(k: string): Promise<any>, put(k: string, v: any): Promise<void>, delete(k: string): Promise<any> },
   *   env: Record<string, any>, now: () => number, watcher: import('./watcher.js').Watcher, log?: (line: string) => void }} deps
   */
  constructor({ storage, env, now, watcher, log }) {
    this.env = env || {};
    this.now = now;
    this.watcher = watcher;
    this.log = log || ((line) => console.warn(line));
    this.doc = new Doc(storage, STATE_KEY, freshState);
    /** A step under way (the check-and-set is synchronous). */
    this.busy = false;
  }

  get db() { return this.env.HISTORY_DB || null; }

  /** @returns {State} */
  get st() { return this.doc.data; }

  /** Why nothing can run at all, or null: the fixed reason for status 'not-configured'. */
  blockedReason() {
    if (!this.watcher.creds()) return 'no-secrets';
    if (this.watcher.mode === 'off') return 'cloud-off';
    if (!this.db) return 'history-off';
    return null;
  }

  /** May a read run at `now` (configured, window closed, the youth check-out not due)? @param {number} now */
  allowed(now) {
    if (this.blockedReason()) return false;
    if (watchWindow(now).open) return false;
    return !(this.watcher.ym && this.watcher.ym.due());
  }

  /**
   * A season's refusal as it stands now: the current season's tries start over
   * after each club night that closed since it was refused.
   * @param {number} season @param {number} now
   */
  refusal(season, now) {
    const r = this.st.unreadable[String(season)];
    if (!r) return null;
    if (season === currentSeason(now) && r.night !== lastClosedClubNight(now)) return null;
    return r;
  }

  /**
   * The next season to read and when (`notBefore`), or null when nothing is
   * left. In this order: the current season until it is first imported, then
   * the refresh after a club night closes, then the walk back; the FIRST of
   * them that is due now wins, so a current season refused for a day (waiting
   * out UNREADABLE_RETRY_MS) never holds up the walk through older seasons
   * meanwhile. With none due, the soonest (the earlier in that order on a tie).
   * A season out of tries is never picked. Synchronous.
   * @param {number} now
   * @returns {{ season: number, why: 'current'|'refresh'|'walk', notBefore: number } | null}
   */
  pick(now) {
    const s = this.st;
    const s0 = currentSeason(now);
    const lastNight = lastClosedClubNight(now);
    /** @param {number} season @param {'current'|'refresh'|'walk'} why */
    const job = (season, why) => {
      const r = this.refusal(season, now);
      if (!r) return { season, why, notBefore: 0 };
      if (r.tries >= UNREADABLE_TRIES) return null;
      return { season, why, notBefore: r.nextAt };
    };
    /** @type {{ season: number, why: 'current'|'refresh'|'walk', notBefore: number }[]} */
    const jobs = [];
    /** @param {{ season: number, why: 'current'|'refresh'|'walk', notBefore: number } | null} j */
    const add = (j) => { if (j) jobs.push(j); };
    if (!s.seasons[String(s0)]) add(job(s0, 'current'));
    else if (s.refreshedFor !== lastNight && lastNight >= `${s0}-08-01`) add(job(s0, 'refresh'));
    if (!s.walkDone) {
      const y = s.next ?? s0 - 1;
      if (s0 - y < SEASONS_MAX) add(job(y, 'walk'));
    }
    if (!jobs.length) return null;
    return jobs.find((j) => j.notBefore <= now) || jobs.reduce((a, b) => (b.notBefore < a.notBefore ? b : a));
  }

  /** How long until a read is due (ms), or null when none may run. Needs the state loaded. */
  wakeInMs() {
    const now = this.now();
    if (!this.doc.data || !this.allowed(now)) return null;
    const j = this.pick(now);
    if (!j) return null;
    return Math.max(0, j.notBefore - now, this.st.nextDueAt - now, this.watcher.budget.peek(false));
  }

  /**
   * The watcher's alarm (window closed): one season read when one is due and
   * the clock has a slot, then the alarm's next wake brought forward for the
   * next one. Never throws. @param {number} next the alarm's own next wake (ms)
   */
  async onAlarm(next) {
    try {
      await this.doc.load();
      await this.watcher.budget.load();
      if (this.wakeInMs() === 0) await this.step();
      const wake = this.wakeInMs();
      return wake === null ? next : Math.min(next, Math.max(wake, 1000));
    } catch (err) {
      console.error('[trends] back-fill step failed', err);
      return next;
    }
  }

  /**
   * The status route's nudge: when a read is due and the alarm is set later
   * than that, set it sooner (so a first deploy does not wait for the cron).
   */
  async kick() {
    await this.doc.load();
    await this.watcher.budget.load();
    const wake = this.wakeInMs();
    if (wake === null) return false;
    const want = this.now() + Math.max(wake, 1000);
    const at = await this.watcher.alarms.get();
    if (typeof at === 'number' && at > this.now() && at <= want) return false;
    await this.watcher.alarms.set(want);
    return true;
  }

  /** The back-off after a failed read or write. @param {string} code @param {number} [atLeastMs] */
  failed(code, atLeastMs = 0) {
    const s = this.st;
    s.errors += 1;
    s.lastError = code;
    s.nextDueAt = this.now() + Math.max(BACKOFF_MS[Math.min(s.errors - 1, BACKOFF_MS.length - 1)], atLeastMs);
  }

  /** The walk moves one season back (or ends at the cap). @param {number} season the season just finished @param {number} s0 */
  advance(season, s0) {
    const s = this.st;
    s.next = season - 1;
    if (s0 - s.next >= SEASONS_MAX) { s.walkDone = true; s.ended = 'cap'; }
  }

  /**
   * One season read and, when it reads, its import. true when it read (or
   * tried), false when nothing was due or the clock turned it away.
   */
  async step() {
    await this.doc.load();
    // From here to `busy = true` nothing awaits: the check and the claim are one step.
    if (this.busy) return false;
    const now = this.now();
    if (!this.allowed(now)) return false;
    const j = this.pick(now);
    if (!j || j.notBefore > now || this.st.nextDueAt > now) return false;
    const client = this.watcher.clientFor();
    if (!client) return false;
    // The check-and-set, in one synchronous step, then written through: a
    // restart mid-read never reads again at once.
    this.busy = true;
    const s = this.st;
    s.lastRunAt = now;
    s.nextDueAt = now + READ_INTERVAL_MS;
    try {
      await this.doc.save();
      const season = j.season;
      const res = await client.page(`/report/attendance_summary?year_start=${season}&output=csv`, { waitMs: 0, kind: 'trends-import' });
      if (!res.ok && res.error === 'read-busy') {
        s.nextDueAt = 0;
        await this.doc.save();
        return false;
      }
      const at = this.now();
      const s0 = currentSeason(at);
      if (!res.ok) {
        if (res.error === 'login-refused' || res.error === 'login-backoff') this.failed('sign-in-refused', client.loginBlockedUntil - at);
        else if (res.error === 'http-403') this.failed('no-permission', UNREADABLE_RETRY_MS);
        else if (/^http-4/.test(res.error)) this.failed('report-missing', UNREADABLE_RETRY_MS);
        else this.failed(res.error === 'twotimtwo-down' || res.error === 'timeout' ? res.error : 'network', client.downUntil - at);
        await this.doc.save();
        this.log(`[trends] season ${seasonLabel(season)} not read (${s.lastError})`);
        return true;
      }
      const parsed = parseAttendanceSummary(res.html, season, importCutoff(at));
      const older = season < s0;
      const repeat = parsed.ok && parsed.nights.length > 0
        && Object.entries(s.seasons).some(([k, v]) => Number(k) !== season && v.nights > 0 && v.fp === parsed.fp);
      if (older && ((!parsed.ok && parsed.why === 'out-of-season') || repeat)) {
        // TwoTimTwo answered another season's meetings for this one (year_start not
        // understood): nothing is stored and the walk stops here.
        s.walkDone = true;
        s.ended = 'year-ignored';
        s.lastError = 'year-ignored';
        s.errors = 0;
        s.nextDueAt = 0;
        await this.doc.save();
        this.log(`[trends] season ${seasonLabel(season)} came back as another season's; the walk back stops`);
        return true;
      }
      const shrank = parsed.ok && s.seasons[String(season)] && parsed.nights.length < s.seasons[String(season)].nights;
      if (!parsed.ok || shrank) {
        const why = parsed.ok ? 'shrank' : parsed.why;
        const r = s.unreadable[String(season)] && this.refusal(season, at) ? s.unreadable[String(season)] : { tries: 0, nextAt: 0, night: '', why };
        r.tries += 1;
        r.nextAt = at + UNREADABLE_RETRY_MS;
        r.night = lastClosedClubNight(at);
        r.why = why;
        s.unreadable[String(season)] = r;
        s.lastError = 'unreadable';
        s.unreadableWhy = why;
        s.errors = 0;
        s.nextDueAt = 0;
        if (r.tries >= UNREADABLE_TRIES) {
          if (!s.skipped.includes(season)) s.skipped.push(season);
          if (j.why === 'walk') this.advance(season, s0);
        }
        await this.doc.save();
        this.log(`[trends] season ${seasonLabel(season)} was not the report expected (${why}); nothing stored`);
        return true;
      }
      if (older && parsed.nights.length === 0) {
        // The first season with no meetings: TwoTimTwo has nothing older.
        s.walkDone = true;
        s.ended = 'empty';
        s.lastError = null;
        s.unreadableWhy = null;
        s.errors = 0;
        s.nextDueAt = 0;
        delete s.unreadable[String(season)];
        await this.doc.save();
        return true;
      }
      try {
        await this.write(season, parsed.nights, at);
      } catch (err) {
        console.error('[trends] D1 write failed', err);
        this.failed('d1-failed');
        await this.doc.save();
        return true;
      }
      s.seasons[String(season)] = { nights: parsed.nights.length, importedAt: at, fp: parsed.fp };
      s.crosscheck = await this.crossCheck(at, s.crosscheck ?? null);
      delete s.unreadable[String(season)];
      s.skipped = s.skipped.filter((y) => y !== season);
      s.lastOkAt = at;
      s.lastError = null;
      s.unreadableWhy = null;
      s.errors = 0;
      s.nextDueAt = at + READ_INTERVAL_MS;
      if (season === s0) {
        s.currentSeasonLastAt = at;
        s.refreshedFor = lastClosedClubNight(at);
      }
      if (j.why === 'walk') this.advance(season, s0);
      await this.doc.save();
      this.log(`[trends] season ${seasonLabel(season)}: ${parsed.nights.length} night(s) imported`);
      return true;
    } finally {
      this.busy = false;
    }
  }

  /**
   * One season into D1 in ONE atomic batch: its range cleared, then upserts of
   * ROWS_PER_STATEMENT lines each (counts only).
   * @param {number} season @param {{ night: string, counts: Record<string, number> }[]} nights @param {number} at
   */
  async write(season, nights, at) {
    const db = this.db;
    if (!db) throw new Error('history-off');
    const importedAt = new Date(at).toISOString();
    /** @type {[string, string, number][]} */
    const lines = [];
    for (const n of nights) for (const [club, count] of Object.entries(n.counts)) lines.push([n.night, club, count]);
    const stmts = [db.prepare('DELETE FROM night_summary_import WHERE night BETWEEN ?1 AND ?2').bind(`${season}-08-01`, `${season + 1}-07-31`)];
    for (let i = 0; i < lines.length; i += ROWS_PER_STATEMENT) {
      const part = lines.slice(i, i + ROWS_PER_STATEMENT);
      const values = part.map((_, k) => `(?${2 + k * 3}, ?${3 + k * 3}, ?${4 + k * 3}, ?1)`).join(', ');
      stmts.push(db.prepare(`INSERT INTO night_summary_import (night, club, attended, imported_at) VALUES ${values} `
        + 'ON CONFLICT (night, club) DO UPDATE SET attended = excluded.attended, imported_at = excluded.imported_at')
        .bind(importedAt, ...part.flat()));
    }
    await withTimeout(db.batch(stmts), D1_TIMEOUT_MS);
  }

  /**
   * The self-check after a season is stored: ONE SELECT of every night and club
   * with both a live desk line and an imported count, tallied by crossCheckOf.
   * Reads only; never throws (a failed read keeps the last result).
   * @param {number} at @param {CrossCheck|null} last
   * @returns {Promise<CrossCheck|null>}
   */
  async crossCheck(at, last) {
    const db = this.db;
    if (!db) return last;
    try {
      const res = await withTimeout(db.prepare('SELECT s.night AS night, s.club AS club, MAX(s.checked_in - s.undone, 0) AS desk, i.attended AS twotimtwo '
        + 'FROM night_summary s JOIN night_summary_import i ON i.night = s.night AND i.club = s.club '
        + 'WHERE s.checked_in > 0 ORDER BY s.night DESC, s.club LIMIT ?1')
        .bind(CROSSCHECK_LINES_MAX).all(), D1_TIMEOUT_MS);
      return crossCheckOf(res.results || [], at);
    } catch (err) {
      console.error('[trends] the self-check could not read D1', err);
      return last;
    }
  }

  /**
   * GET /v1/history/import-status: what the back-fill has done, fixed codes and
   * numbers only (no text from TwoTimTwo, no name).
   */
  async statusView() {
    await this.doc.load();
    const now = this.now();
    const s = this.st;
    const blocked = this.blockedReason() || (s.lastError === 'sign-in-refused' || s.lastError === 'no-permission' ? s.lastError : null);
    const done = Object.keys(s.seasons).map(Number).sort((a, b) => b - a);
    const withNights = done.filter((y) => s.seasons[String(y)].nights > 0);
    const j = this.pick(now);
    // The current season refused and waiting out its day, while the walk went on meanwhile.
    const current = s.seasons[String(currentSeason(now))] ? null : this.refusal(currentSeason(now), now);
    /** @type {'idle'|'running'|'done'|'unreadable'|'not-configured'} */
    let state;
    if (blocked) state = 'not-configured';
    else if (s.lastError === 'unreadable' || current) state = 'unreadable';
    else if (!s.lastRunAt) state = 'idle';
    else if (!s.walkDone || !s.seasons[String(currentSeason(now))]) state = 'running';
    else state = 'done';
    const iso = (/** @type {number} */ ms) => (ms ? new Date(ms).toISOString() : null);
    return {
      state,
      ...(blocked ? { reason: blocked } : {}),
      seasons: done.map((y) => ({ season: seasonLabel(y), nights: s.seasons[String(y)].nights, importedAt: iso(s.seasons[String(y)].importedAt) })),
      oldestSeason: withNights.length ? seasonLabel(withNights[withNights.length - 1]) : null,
      lastRunAt: iso(s.lastRunAt),
      nextDueAt: !blocked && j ? iso(Math.max(now, j.notBefore, s.nextDueAt)) : null,
      lastError: s.lastError,
      unreadableWhy: s.lastError === 'unreadable' ? s.unreadableWhy : current ? current.why : null,
      skipped: s.skipped.map(seasonLabel),
      ended: s.ended,
      currentSeasonLastAt: iso(s.currentSeasonLastAt),
      crosscheck: s.crosscheck ? { ...s.crosscheck, examples: s.crosscheck.examples.map((e) => ({ ...e })), at: iso(s.crosscheck.at) } : null,
    };
  }
}

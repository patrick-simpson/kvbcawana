// Who brought a friend tonight (BARF Night, owner 2026-10-11): the child, their
// club and the friend's first name, for the 6:30 pm email, "grouped by club".
//
// Recorded from every check-in path: the Worker's own cloud check-in (phone.js)
// and the laptop (POST /v1/cloud/friend, from the print server whenever a tag
// prints with Brought a friend: the touch screen, a phone on the Wi-Fi, or
// TwoTimTwo's own box at the desk, which has no name field).
//
// Children's and friends' names, so: sealed at rest under the watcher's key
// (AES-256-GCM, derived from the TwoTimTwo password secret; watcher.js), one
// record per night, deleted after KEEP_DAYS. Read by a signed-in screen, or by
// one read-only report link (the scheduled email's) that opens one night only
// and expires the next day; the link's token is stored as its hash.

import { localTime, openState, sealState } from './watcher.js';
import { toBase64Url } from './crypto.js';

export const KEEP_DAYS = 3;
export const CLUB_ORDER = Object.freeze(['Puggles', 'Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey']);
const MAX_PER_NIGHT = 500;

/** One line of typed text: no control characters or angle brackets, spaces folded. @param {unknown} raw @param {number} max */
const clean = (raw, max) => (typeof raw === 'string'
  ? Array.from(raw).filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127 && c !== '<' && c !== '>').join('')
    .replace(/\s+/g, ' ').trim().slice(0, max)
  : '');

/** @param {string} date YYYY-MM-DD @param {number} days */
function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** @param {string} text */
async function sha256(text) {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

/**
 * The report: clubs in club order, children by name, each with their friend
 * ('' when none was typed). Pure.
 * @param {{name: string, club: string, friendName: string}[]} rows @param {string} date
 */
export function friendsReport(rows, date) {
  /** @type {Map<string, {name: string, friend: string}[]>} */
  const byClub = new Map();
  for (const r of rows) {
    const club = r.club || 'No club';
    if (!byClub.has(club)) byClub.set(club, []);
    /** @type {{name: string, friend: string}[]} */ (byClub.get(club)).push({ name: r.name, friend: r.friendName || '' });
  }
  const rank = (c) => { const i = CLUB_ORDER.indexOf(c); return i < 0 ? CLUB_ORDER.length : i; };
  const clubs = [...byClub.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((club) => ({ club, kids: /** @type {{name: string, friend: string}[]} */ (byClub.get(club)).sort((a, b) => a.name.localeCompare(b.name)) }));
  return { date, total: rows.length, clubs };
}

export class Friends {
  /**
   * @param {{ storage: { get(k: string): Promise<any>, put(k: string, v: any): Promise<void>, delete(k: string): Promise<any> },
   *   watcher: import('./watcher.js').Watcher, now: () => number }} deps
   */
  constructor({ storage, watcher, now }) {
    this.storage = storage;
    this.watcher = watcher;
    this.now = now;
  }

  key() { const c = this.watcher.creds(); return c ? c.password : ''; }

  /** @param {string} date */
  async rows(date) {
    const k = this.key();
    if (!k) return [];
    const open = await openState(k, await this.storage.get(`friends:${date}`));
    return open && Array.isArray(open.rows) ? open.rows : [];
  }

  /**
   * One child who brought a friend tonight. A second record for the same
   * child (by clubber id, else by name) fills in a friend's name the first
   * lacked, and otherwise changes nothing.
   * @param {any} body {name, club, clubberId?, friendName?}
   */
  async record(body) {
    const k = this.key();
    if (!k) return { ok: false, status: 503, error: 'Cloud check-in is not set up.' };
    const name = clean(body && body.name, 80);
    if (!name) return { ok: false, status: 400, error: 'name is required' };
    const clubberId = /^\d{1,20}$/.test(String(body.clubberId ?? '')) ? String(body.clubberId) : '';
    const row = { name, club: clean(body.club, 40), clubberId, friendName: clean(body.friendName, 24), at: new Date(this.now()).toISOString() };
    const date = localTime(this.now()).date;
    const rows = await this.rows(date);
    const same = rows.find((r) => (clubberId && r.clubberId ? r.clubberId === clubberId : r.name.toLowerCase() === name.toLowerCase()));
    if (same) {
      if (!same.friendName && row.friendName) same.friendName = row.friendName;
      if (!same.clubberId && clubberId) same.clubberId = clubberId;
      if (!same.club && row.club) same.club = row.club;
    } else {
      if (rows.length >= MAX_PER_NIGHT) return { ok: false, status: 429, error: 'Too many for one night.' };
      rows.push(row);
    }
    await this.storage.put(`friends:${date}`, await sealState(k, { date, rows }));
    const nights = new Set((await this.storage.get('friends:nights')) || []);
    nights.add(date);
    await this.storage.put('friends:nights', [...nights]);
    return { ok: true };
  }

  /** @param {unknown} date */
  async report(date) {
    const d = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localTime(this.now()).date;
    return friendsReport(await this.rows(d), d);
  }

  /**
   * The names for the BARF Bag labels (owner, 2026-10-11): each child who
   * brought a friend, then their friend right after (so a pair's labels come
   * out together), club by club. A friend with no name typed (TwoTimTwo's desk
   * box) has no label, and is counted so the screen can say so.
   * @param {unknown} date
   */
  async bagNames(date) {
    const report = await this.report(date);
    const names = [];
    let unnamed = 0;
    for (const club of report.clubs) {
      for (const kid of club.kids) {
        names.push(kid.name);
        if (kid.friend) names.push(kid.friend); else unnamed += 1;
      }
    }
    return { date: report.date, names, kids: report.total, friends: report.total - unnamed, unnamed };
  }

  /**
   * A read-only link to one night's report, for the scheduled email. It opens
   * that night only and stops working at noon the next day (Eastern, near
   * enough: 16:00 UTC). Only its hash is stored.
   * @param {unknown} date
   */
  async makeLink(date) {
    const d = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localTime(this.now()).date;
    const token = toBase64Url(crypto.getRandomValues(new Uint8Array(24)));
    const until = Date.parse(`${addDays(d, 1)}T16:00:00Z`);
    const hash = await sha256(token);
    await this.storage.put(`friends:link:${hash}`, { date: d, until });
    await this.storage.put('friends:links', [...((await this.storage.get('friends:links')) || []), { hash, until }]);
    return { token, date: d, until: new Date(until).toISOString() };
  }

  /** The report a link opens, or null (unknown, or past its day). @param {unknown} token */
  async reportByLink(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
    const link = await this.storage.get(`friends:link:${await sha256(token)}`);
    if (!link || this.now() > link.until) return null;
    return this.report(link.date);
  }

  /** The cron's tidy-up: nights older than KEEP_DAYS go, records and all. */
  async purge() {
    const today = localTime(this.now()).date;
    const keepFrom = addDays(today, -KEEP_DAYS);
    const nights = (await this.storage.get('friends:nights')) || [];
    const keep = [];
    for (const d of nights) {
      if (d < keepFrom) await this.storage.delete(`friends:${d}`);
      else keep.push(d);
    }
    if (keep.length !== nights.length) await this.storage.put('friends:nights', keep);
    const links = (await this.storage.get('friends:links')) || [];
    const live = [];
    for (const l of links) {
      if (this.now() > l.until) await this.storage.delete(`friends:link:${l.hash}`);
      else live.push(l);
    }
    if (live.length !== links.length) await this.storage.put('friends:links', live);
  }
}

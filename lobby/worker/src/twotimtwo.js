// The sync Worker's TwoTimTwo client (CLOUD-CHECKIN.md, piece 1): signs in as
// the church's dedicated check-in user and reads the pages the check-in laptop's
// extension reads today. Phase 1 is READ-ONLY: nothing here posts a check-in,
// an undo or a check-out.
//
// TwoTimTwo agreed (Devin, 2026-10-11) to an automated check-in user on the
// church's site, reading as often as every 15 seconds, everything encrypted,
// and with no technical support from them if it breaks. So:
//   - every request is https to ONE host (TWOTIMTWO_HOST, a *.twotimtwo.com
//     name), and a redirect anywhere else is refused, so the session cookie
//     and the password can never be sent to another site;
//   - the password is a Worker secret and the session cookie lives in memory
//     only: neither is ever stored, logged or returned;
//   - a refused sign-in backs off (5, 15, then 60 minutes), so a wrong password
//     never hammers their login or locks the account.
//
// The parsers follow the extension's own (chrome-extension/content.js
// fetchCheckinReport, and docs/TWOTIMTWO.md for every selector), on linkedom
// instead of a browser DOM; test/twotimtwo.test.js runs the extension's copy
// and this one on the same pages and requires the same answer.

import { parseHTML } from 'linkedom';
import { parse, serialize } from 'parse5';

export const DEFAULT_HOST = 'kvbchurch.twotimtwo.com';
const HOST_RE = /^[a-z0-9][a-z0-9-]{0,62}\.twotimtwo\.com$/;
const FETCH_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;
/** The largest page read; the report and the check-in page are far smaller. */
export const PAGE_MAX = 4 * 1024 * 1024;
/** Sign-in back-off after each refused try in a row. */
export const LOGIN_BACKOFF_MS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];
const USER_AGENT = 'KVBC-Awana-CloudCheckin/1 (+https://awana.kvbchurch.org)';

const LOGIN_FORM_RE = /name\s*=\s*["']LoginForm\[password\]["']/i;
/** A report or check-in-page column that is not a name ("YES 1 Share 1 Point"). */
const SUMMARY_CELL_RE = /^(?:(?:yes|no)\b\s*)?(?:\d+\s*(?:shares?|points?)\b\s*)*$/i;

/**
 * The host from the Worker's env, or null when it is not a TwoTimTwo name.
 * @param {unknown} raw
 */
export function twoTimTwoHost(raw) {
  const host = String(raw || DEFAULT_HOST).trim().toLowerCase();
  return HOST_RE.test(host) ? host : null;
}

/** @param {Record<string, any>} env */
export function credentialsFrom(env) {
  const host = twoTimTwoHost(env.TWOTIMTWO_HOST);
  const username = String(env.TWOTIMTWO_USERNAME || '').trim();
  const password = String(env.TWOTIMTWO_PASSWORD || '');
  if (!host || !username || !password) return null;
  return { host, username, password };
}

/** @param {string} html */
export function isLoginPage(html) {
  return LOGIN_FORM_RE.test(String(html || ''));
}

/**
 * The page as a browser builds it. linkedom's own parser takes tags as
 * written: rows with no <tbody>, which Chrome wraps in one, stayed bare, so on
 * the live report (2026-10-11) every club's Count: was read and not one child
 * ("0 children checked in", partial). parse5 is the HTML standard's tree
 * builder (jsdom's); its output, written back out, is markup linkedom reads
 * into exactly the tree the extension's DOMParser sees in Chrome.
 * @param {string} html
 */
function documentOf(html) {
  return parseHTML(serialize(parse(String(html || '')))).document;
}

/** @param {string} text */
const squash = (text) => String(text || '').trim().replace(/\s+/g, ' ');

/**
 * The check-in report (/clubber/checkin_report?date=), the authoritative
 * "who is checked in tonight". null when the page is not a report at all (the
 * login form, a changed layout): never an empty night.
 *
 * Rules, each from a bug (docs/TWOTIMTWO.md "the markup, exactly"): one table
 * per club, named only by its crest's alt; tables without a crest are skipped;
 * the name is the text of the cell holding the edit link with every link
 * removed, the next cell only when that is empty; a summary cell is never a
 * name; `declared` is the sum of the Count: footers, or null when a club table
 * has none.
 *
 * @param {string} html
 * @returns {{ entries: {clubberId: string, name: string, club: string}[], declared: number|null } | null}
 */
export function parseCheckinReport(html) {
  if (!html || isLoginPage(html)) return null;
  const doc = documentOf(html);
  const tables = [...doc.querySelectorAll('table')];
  if (!tables.length) return null;
  /** @type {{clubberId: string, name: string, club: string}[]} */
  const entries = [];
  let declared = 0;
  let declaredAll = true;
  let readAnyClub = false;
  for (const table of tables) {
    const titleTh = table.querySelector('th.title');
    const crest = titleTh ? titleTh.querySelector('img[alt]') : null;
    const club = crest ? String(crest.getAttribute('alt') || '').trim().replace(/&amp;/g, '&') : '';
    if (!club) continue;
    readAnyClub = true;
    const totals = table.querySelector('tfoot tr.totals');
    const m = totals ? /Count:\s*(\d+)/i.exec(totals.textContent || '') : null;
    if (m) declared += parseInt(m[1], 10); else declaredAll = false;
    for (const row of table.querySelectorAll('tbody tr')) {
      // Only this table's own rows, should another table ever sit inside it.
      if (row.closest('table') !== table) continue;
      const tds = row.querySelectorAll('td');
      if (!tds.length) continue;
      const link = row.querySelector('a[href*="/meeting/clubberCheckin/"]');
      if (!link) continue;
      const idm = /\/meeting\/clubberCheckin\/(\d+)/.exec(link.getAttribute('href') || '');
      if (!idm) continue;
      const cell = link.closest('td') || tds[0];
      const clone = cell.cloneNode(true);
      for (const a of clone.querySelectorAll('a')) a.remove();
      let name = squash(clone.textContent);
      if (!name) {
        const next = cell.nextElementSibling;
        name = next ? squash(next.textContent) : '';
      }
      if (name && SUMMARY_CELL_RE.test(name)) name = '';
      entries.push({ clubberId: idm[1], name, club });
    }
  }
  if (!readAnyClub) return null;
  return { entries, declared: declaredAll ? declared : null };
}

/**
 * What a page looks like, for a "did not look like the report" message: its
 * title and how many tables and club tables it has. Never any cell text, so
 * never a name.
 * @param {string} html
 */
export function pageShape(html) {
  const doc = documentOf(html);
  const tables = [...doc.querySelectorAll('table')];
  const title = doc.querySelector('title');
  return {
    title: squash(title ? title.textContent : '').slice(0, 80),
    bytes: String(html || '').length,
    tables: tables.length,
    clubTables: tables.filter((t) => t.querySelector('th.title img[alt]')).length,
    loginForm: isLoginPage(html),
  };
}

/**
 * The check-in page (/clubber/checkin): tonight's meeting id, its check-in
 * items with their club scopes, and the roster rows. Phase 1 keeps NO names
 * from it: ids, clubs and the checked-in mark only. null when it is not the
 * check-in page (no #calendar_id).
 * @param {string} html
 * @returns {{ calendarId: string, events: {id: string, clubs: string[], automatic: boolean}[],
 *   roster: {clubberId: string, clubId: string, checkedIn: boolean}[] } | null}
 */
export function parseCheckinPage(html) {
  if (!html || isLoginPage(html)) return null;
  const doc = documentOf(html);
  const cal = doc.querySelector('#calendar_id');
  const calendarId = cal ? String(cal.getAttribute('value') || '').trim() : '';
  if (!/^\d{1,12}$/.test(calendarId)) return null;
  const events = [...doc.querySelectorAll('input.event[name="events[]"]')]
    .map((el) => ({
      id: String(el.getAttribute('value') || '').trim(),
      clubs: String(el.getAttribute('clubs') || '').split(',').map((c) => c.trim()).filter((c) => /^\d+$/.test(c)),
      automatic: el.getAttribute('automatic') === '1',
    }))
    .filter((e) => /^\d{1,12}$/.test(e.id));
  const roster = [...doc.querySelectorAll('.clubber[recid]')]
    .map((el) => ({
      clubberId: String(el.getAttribute('recid') || '').trim(),
      clubId: String(el.getAttribute('club_id') || '').trim(),
      checkedIn: el.classList.contains('checked-in'),
    }))
    .filter((r) => /^\d{1,20}$/.test(r.clubberId));
  return { calendarId, events, roster };
}

/** @param {string} html */
export function loginToken(html) {
  const input = documentOf(html).querySelector('input[name="YII_CSRF_TOKEN"]');
  return input ? String(input.getAttribute('value') || '') : '';
}

/** @param {Response} res @returns {string[]} */
function setCookies(res) {
  const h = /** @type {any} */ (res.headers);
  if (typeof h.getSetCookie === 'function') return h.getSetCookie();
  const one = res.headers.get('set-cookie');
  return one ? [one] : [];
}

/** @param {Response} res */
async function readCapped(res) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > PAGE_MAX) throw new Error('page-too-large');
  const text = await res.text();
  if (text.length > PAGE_MAX) throw new Error('page-too-large');
  return text;
}

/**
 * One signed-in TwoTimTwo session. The cookie jar is memory only: a restarted
 * Durable Object signs in again on its first read.
 */
export class TwoTimTwoClient {
  /**
   * @param {{ host: string, username: string, password: string }} creds
   * @param {{ fetchFn?: typeof fetch, now?: () => number }} [opts]
   */
  constructor(creds, opts = {}) {
    this.host = creds.host;
    this.username = creds.username;
    this.password = creds.password;
    this.fetchFn = opts.fetchFn || ((...args) => fetch(...args));
    this.now = opts.now || (() => Date.now());
    /** @type {Map<string, string>} */
    this.cookies = new Map();
    this.loginFails = 0;
    this.loginBlockedUntil = 0;
    this.logins = 0;
  }

  get origin() { return `https://${this.host}`; }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /** @param {Response} res */
  keepCookies(res) {
    for (const line of setCookies(res)) {
      const first = String(line).split(';')[0];
      const eq = first.indexOf('=');
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (!name) continue;
      if (!value || value === 'deleted' || /max-age=0|expires=thu, 01 jan 1970/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  /**
   * One request, following redirects by hand so every hop's cookies are kept
   * and no hop may leave the TwoTimTwo host.
   * @param {string} path @param {{method?: string, form?: URLSearchParams}} [opts]
   * @returns {Promise<{status: number, path: string, html: string}>}
   */
  async request(path, opts = {}) {
    let url = new URL(path, this.origin);
    let method = opts.method || 'GET';
    let body = opts.form ? opts.form.toString() : undefined;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (url.protocol !== 'https:' || url.host !== this.host) throw new Error('off-site-redirect');
      /** @type {Record<string, string>} */
      const headers = { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' };
      const jar = this.cookieHeader();
      if (jar) headers.Cookie = jar;
      if (body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const res = await this.fetchFn(url.toString(), {
        method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      this.keepCookies(res);
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(String(res.headers.get('location')), url);
        // A redirect after a form post is a plain GET (what a browser does).
        method = 'GET';
        body = undefined;
        continue;
      }
      return { status: res.status, path: url.pathname, html: await readCapped(res) };
    }
    throw new Error('too-many-redirects');
  }

  /** @returns {Promise<{ok: true} | {ok: false, error: string}>} */
  async login() {
    const t = this.now();
    if (this.loginBlockedUntil > t) return { ok: false, error: 'login-backoff' };
    this.cookies.clear();
    this.logins += 1;
    let res;
    try {
      const form = await this.request('/site/login');
      const params = new URLSearchParams();
      const token = loginToken(form.html);
      if (token) params.set('YII_CSRF_TOKEN', token);
      params.set('LoginForm[username]', this.username);
      params.set('LoginForm[password]', this.password);
      params.set('Login', '1');
      res = await this.request('/site/login', { method: 'POST', form: params });
    } catch (err) {
      // A network failure is not a refused password: no back-off for it.
      return { ok: false, error: errorCode(err) };
    }
    if (res.status === 200 && !isLoginPage(res.html) && !/\/site\/login/i.test(res.path)) {
      this.loginFails = 0;
      this.loginBlockedUntil = 0;
      return { ok: true };
    }
    this.cookies.clear();
    // TwoTimTwo itself failing is not a refused password: no back-off for it.
    if (res.status >= 500) return { ok: false, error: 'twotimtwo-down' };
    const wait = LOGIN_BACKOFF_MS[Math.min(this.loginFails, LOGIN_BACKOFF_MS.length - 1)];
    this.loginFails += 1;
    this.loginBlockedUntil = this.now() + wait;
    return { ok: false, error: 'login-refused' };
  }

  /**
   * A signed-in page: signs in first when there is no session, and once more
   * when the page comes back as the login form (the session expired).
   * @param {string} path
   * @returns {Promise<{ok: true, html: string} | {ok: false, error: string}>}
   */
  async page(path) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.cookies.size || attempt > 0) {
        const signedIn = await this.login();
        if (!signedIn.ok) return signedIn;
      }
      let res;
      try {
        res = await this.request(path);
      } catch (err) {
        return { ok: false, error: errorCode(err) };
      }
      if (isLoginPage(res.html) || /\/site\/login/i.test(res.path)) continue;
      if (res.status !== 200) return { ok: false, error: res.status >= 500 ? 'twotimtwo-down' : `http-${res.status}` };
      return { ok: true, html: res.html };
    }
    return { ok: false, error: 'signed-out' };
  }

  /** @param {string} date YYYY-MM-DD */
  async report(date) {
    const page = await this.page(`/clubber/checkin_report?date=${encodeURIComponent(date)}`);
    if (!page.ok) return page;
    const report = parseCheckinReport(page.html);
    return report
      ? { ok: /** @type {const} */ (true), report }
      : { ok: /** @type {const} */ (false), error: 'report-unreadable', shape: pageShape(page.html) };
  }

  async checkinPage() {
    const page = await this.page('/clubber/checkin');
    if (!page.ok) return page;
    const parsed = parseCheckinPage(page.html);
    return parsed ? { ok: /** @type {const} */ (true), page: parsed } : { ok: /** @type {const} */ (false), error: 'checkin-page-unreadable' };
  }
}

/** A fixed code for a thrown error: never its message, which may carry a URL. @param {unknown} err */
function errorCode(err) {
  const msg = err instanceof Error ? err.message : '';
  if (msg === 'off-site-redirect' || msg === 'too-many-redirects' || msg === 'page-too-large') return msg;
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'timeout';
  return 'network';
}

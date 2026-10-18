// The sync Worker's TwoTimTwo client (ROADMAP.md#cloud-check-in, piece 1): signs in as
// the church's dedicated check-in user and reads the pages the check-in laptop's
// Chrome extension once read (retired with KVBC Awana 10.0.0). It began
// read-only; the desk's check-in, undo and check-out posts (desk.js, barf.js,
// ymcheckout.js) are here too now, each behind the club-day writeGuard.
//
// TwoTimTwo agreed (Devin, 2026-10-11) to an automated check-in user on the
// church's site, reading as often as ONE read every 5 seconds (all reads
// combined; the first word was 15 s), everything encrypted, and with no
// technical support from them if it breaks. The extension tab that once read
// beside it is retired, so the Worker keeps to exactly that: one read every 5 s
// (readbudget.js READ_INTERVAL_MS). So:
//   - every request is https to ONE host (TWOTIMTWO_HOST, a *.twotimtwo.com
//     name), and a redirect anywhere else is refused, so the session cookie
//     and the password can never be sent to another site;
//   - the password is a Worker secret and the session cookie lives in memory
//     only: neither is ever stored, logged or returned;
//   - a refused sign-in backs off (5, 15, then 60 minutes), so a wrong password
//     never hammers their login or locks the account;
//   - EVERY request that reads takes a slot from the one read clock
//     (readbudget.js): a page, each hop of the sign-in (the form, the post, a
//     redirect) and every redirect hop. Only the check-in, undo and check-out
//     posts themselves are writes and take none;
//   - a sign-in that meets TwoTimTwo down or the network gone backs off too
//     (30 s, 1, 2, then 5 minutes), so an outage is never a stream of logins.
//
// The parsers follow the extension's own (chrome-extension/content.js
// fetchCheckinReport, and printer/docs/TWOTIMTWO.md for every selector), on linkedom
// instead of a browser DOM; test/twotimtwo.test.js runs the extension's copy
// and this one on the same pages and requires the same answer.

import { parseHTML } from 'linkedom';
import { parse, serialize } from 'parse5';
import { INTERACTIVE_WAIT_MS, READ_INTERVAL_MS } from './readbudget.js';
import { firstLast } from '../../shared/tonight.js';

export const DEFAULT_HOST = 'kvbchurch.twotimtwo.com';
const HOST_RE = /^[a-z0-9][a-z0-9-]{0,62}\.twotimtwo\.com$/;
const FETCH_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;
/** The largest page read; the report and the check-in page are far smaller. */
export const PAGE_MAX = 4 * 1024 * 1024;
/** Sign-in back-off after each refused try in a row. */
export const LOGIN_BACKOFF_MS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];
/** Sign-in back-off after each try in a row that met TwoTimTwo down (5xx) or no network. */
export const DOWN_BACKOFF_MS = [30 * 1000, 60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000];
/**
 * How long a request already under way (a sign-in's next hop, a redirect, the
 * page after a sign-in) queues for its slot: behind what an interactive request
 * may have booked, plus one slot. Such a hop is a `priority` read (it never
 * yields to the report's reservation), so a sign-in is never left half done.
 */
export const FOLLOW_WAIT_MS = INTERACTIVE_WAIT_MS + READ_INTERVAL_MS;
/** A desk check-in, undo or check-out's read: the head of the read queue (readbudget.js). */
export const URGENT = Object.freeze({ urgent: true });
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
export function documentOf(html) {
  return parseHTML(serialize(parse(String(html || '')))).document;
}

/** @param {string} text */
const squash = (text) => String(text || '').trim().replace(/\s+/g, ' ');
/** A child's name as "First Last" (shared/tonight.js: "Sort by: Last Name" shows "Simpson, Micah"). */
export { firstLast };

/**
 * The check-in report (/clubber/checkin_report?date=), the authoritative
 * "who is checked in tonight". null when the page is not a report at all (the
 * login form, a changed layout): never an empty night.
 *
 * Rules, each from a bug (printer/docs/TWOTIMTWO.md "the markup, exactly"): one table
 * per club, named only by its crest's alt; tables without a crest are skipped;
 * no club table at all is an empty night only on a page titled as the report;
 * a child is a row with an edit link or an undo control (the check-in user
 * gets only the undo); the name is the text of the cell holding it with every
 * link removed, the next cell only when that is empty; a summary cell is never a
 * name; `declared` is the sum of the Count: footers, or null when a club table
 * has none.
 *
 * @param {string} html
 * A child whose row says YES under a "Brought a friend" column (any club table
 * that has one; the extension's friendsBrought rule) carries `friend: true`:
 * what a BARF Night tag for a check-in made on TwoTimTwo's own page is printed
 * from (adopt.js; the box has no name field, so no friend's name). A YES under
 * a Bible column is `bible: true` the same way.
 *
 * @returns {{ entries: {clubberId: string, name: string, club: string, friend?: boolean, bible?: boolean}[], declared: number|null } | null}
 */
export function parseCheckinReport(html) {
  if (!html || isLoginPage(html)) return null;
  const doc = documentOf(html);
  const tables = [...doc.querySelectorAll('table')];
  /** @type {{clubberId: string, name: string, club: string, friend?: boolean, bible?: boolean}[]} */
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
    // The Brought a friend column, if this club has one: EVERY header row is searched
    // (the crest sits in a header row of its own ahead of the real headings).
    let friendIdx = -1;
    for (const hr of table.querySelectorAll('thead tr')) {
      if (friendIdx >= 0) break;
      const cells = [...hr.querySelectorAll('th')];
      friendIdx = cells.findIndex((th) => FRIEND_RE.test(squash(th.textContent)));
    }
    // ...and the Bible column, by the same rule (a late BARF friend redoes the
    // check-in with the items the child had: routes.md 5.1).
    let bibleIdx = -1;
    for (const hr of table.querySelectorAll('thead tr')) {
      if (bibleIdx >= 0) break;
      const cells = [...hr.querySelectorAll('th')];
      bibleIdx = cells.findIndex((th) => BIBLE_RE.test(squash(th.textContent)));
    }
    for (const row of table.querySelectorAll('tbody tr')) {
      // Only this table's own rows, should another table ever sit inside it.
      if (row.closest('table') !== table) continue;
      const tds = row.querySelectorAll('td');
      if (!tds.length) continue;
      // The child's id: the edit link, or the undo control. The church's
      // dedicated check-in user (Record Checkin, 2026-10-11) sees the report
      // with NO edit link, only [undo] Name, so the edit link alone read 0 of
      // 94. Both carry the same clubber id (printer/docs/TWOTIMTWO.md).
      const edit = row.querySelector('a[href*="/meeting/clubberCheckin/"]');
      const undo = row.querySelector('[onclick*="undoCheckin"]');
      const byEdit = edit && /\/meeting\/clubberCheckin\/(\d+)/.exec(edit.getAttribute('href') || '');
      const byUndo = undo && /undoCheckin\(\s*(\d+)\s*\)/.exec(undo.getAttribute('onclick') || '');
      const idm = byEdit || byUndo;
      if (!idm) continue;
      const link = /** @type {Element} */ (byEdit ? edit : undo);
      const cell = link.closest('td') || tds[0];
      const clone = cell.cloneNode(true);
      for (const a of clone.querySelectorAll('a')) a.remove();
      let name = firstLast(clone.textContent);
      if (!name) {
        const next = cell.nextElementSibling;
        name = next ? firstLast(next.textContent) : '';
      }
      if (name && SUMMARY_CELL_RE.test(name)) name = '';
      const friend = friendIdx >= 0 && tds.length > friendIdx && /^yes$/i.test(squash(tds[friendIdx].textContent));
      const bible = bibleIdx >= 0 && tds.length > bibleIdx && /^yes$/i.test(squash(tds[bibleIdx].textContent));
      entries.push({ clubberId: idm[1], name, club, ...(friend ? { friend: true } : {}), ...(bible ? { bible: true } : {}) });
    }
  }
  // No club table: before the night's first check-in TwoTimTwo draws the report
  // with none at all, so the report's own title says it is an empty night (as
  // the laptop's extension read it). Any other page is no report.
  if (!readAnyClub) return isReportPage(doc) ? { entries: [], declared: 0 } : null;
  return { entries, declared: declaredAll ? declared : null };
}

/** The check-in report's own title ("KVBC - Checkin Report"). */
const REPORT_TITLE_RE = /\bcheck-?\s*in report\b/i;

/** Is this TwoTimTwo's check-in report, by its title? @param {Document} doc */
function isReportPage(doc) {
  const title = doc.querySelector('title');
  return REPORT_TITLE_RE.test(squash(title ? title.textContent : ''));
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
 * How a club table's rows are built, for a report that read short: per row,
 * its cell count, the tags inside, the NAMES of the attributes it carries,
 * its links' paths (digits as N, no query) and its handlers' function names.
 * Never text, never an attribute value but those two, so never a name. This
 * is what found the fix when the live report read 0 of 94 (2026-10-11).
 * @param {string} html
 */
export function rowShape(html) {
  const doc = documentOf(html);
  const table = [...doc.querySelectorAll('table')].find((t) => t.querySelector('th.title img[alt]'));
  if (!table) return null;
  const rows = [...table.querySelectorAll('tr')].filter((r) => r.closest('table') === table && !r.closest('thead') && !r.closest('tfoot'));
  const uniq = (xs) => [...new Set(xs)].slice(0, 20);
  const sample = rows.slice(0, 3).map((row) => {
    const els = [row, ...row.querySelectorAll('*')];
    return {
      cells: row.querySelectorAll('td').length,
      tags: uniq(els.slice(1).map((e) => e.tagName.toLowerCase())),
      attrs: uniq(els.flatMap((e) => [...e.attributes].map((a) => `${e.tagName.toLowerCase()}[${a.name}]`))),
      links: uniq([...row.querySelectorAll('a[href]')].map((a) => String(a.getAttribute('href') || '').split(/[?#]/)[0].replace(/\d+/g, 'N'))
        .filter((h) => /^[\w/.:-]{0,80}$/.test(h))),
      handlers: uniq(els.flatMap((e) => [...e.attributes].filter((a) => /^on/i.test(a.name))
        .map((a) => `${a.name}:${(/^\s*([A-Za-z_$][\w$.]{0,40})\s*\(/.exec(a.value) || [])[1] || '?'}`))),
    };
  });
  return { rows: rows.length, sample };
}

/**
 * Each club table's column headings and the summary values in its rows
 * ("YES", "No 0 Shares 0 Points"), counted: what the report says beside each
 * child, for Brought a friend (BARF Night, 2026-10-14). Headings are the
 * church's item names, and a value is kept only when it is a summary cell
 * (SUMMARY_CELL_RE), so never a name.
 * @param {string} html
 */
export function reportColumns(html) {
  const doc = documentOf(html);
  /** @type {{club: string, headers: string[], values: Record<string, number>}[]} */
  const out = [];
  for (const table of doc.querySelectorAll('table')) {
    const crest = table.querySelector('th.title img[alt]');
    if (!crest) continue;
    const headers = [...table.querySelectorAll('thead th')].filter((th) => !th.classList.contains('title'))
      .map((th) => squash(th.textContent).slice(0, 40));
    /** @type {Record<string, number>} */
    const values = {};
    for (const td of table.querySelectorAll('tbody td')) {
      const t = squash(td.textContent);
      if (t && SUMMARY_CELL_RE.test(t)) values[t.slice(0, 40)] = (values[t.slice(0, 40)] || 0) + 1;
    }
    out.push({ club: String(crest.getAttribute('alt') || '').trim(), headers, values });
  }
  return out;
}

/**
 * A check-in item's words ("Bible", "Brought a friend"): the label wrapping
 * it, the one for its id, or the label right after it, as the extension
 * reads them (collectApplicableEvents). Church-typed text, never a name.
 * @param {any} doc @param {any} input
 */
function itemLabel(doc, input) {
  let label = input.closest('label');
  const id = input.getAttribute('id');
  if (!label && id) label = [...doc.querySelectorAll('label[for]')].find((l) => l.getAttribute('for') === id) || null;
  if (!label && input.nextElementSibling && input.nextElementSibling.tagName === 'LABEL') label = input.nextElementSibling;
  const text = label ? label.textContent : (input.nextSibling ? input.nextSibling.textContent : '');
  return squash(text).slice(0, 60);
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
      label: itemLabel(doc, el),
    }))
    .filter((e) => /^\d{1,12}$/.test(e.id));
  // Names are read for finding one child to check in (cloud check-in's
  // owner-only route), in memory only: nothing that stores or logs this page's
  // result keeps more than counts.
  const roster = [...doc.querySelectorAll('.clubber[recid]')]
    .map((el) => {
      const crest = el.querySelector('.club img[alt]');
      return {
        clubberId: String(el.getAttribute('recid') || '').trim(),
        clubId: String(el.getAttribute('club_id') || '').trim(),
        name: firstLast(el.querySelector('.name')?.textContent).slice(0, 80),
        club: crest ? String(crest.getAttribute('alt') || '').trim() : '',
        checkedIn: el.classList.contains('checked-in'),
      };
    })
    .filter((r) => /^\d{1,20}$/.test(r.clubberId));
  // The meeting the page is on: its filter form's selected date (docs §8.2).
  const picked = doc.querySelector('select[name="date"] option[selected]') || doc.querySelector('select[name="date"] option');
  const meetingDate = picked ? squash(picked.getAttribute('value') || picked.textContent).slice(0, 30) : null;
  return { calendarId, meetingDate, events, roster };
}

/**
 * The Checkout page (/clubber/checkout, printer/docs/TWOTIMTWO.md §2.1): the
 * meeting its Check out button posts to (`calendar_id` in the page's own
 * script), the meeting's date (the selected `select#date` option) and a row
 * per child it still lists (`a.checkout[clubber_id]`, the club in the row's
 * `img.club-icon-20` alt). The extension's readCheckoutPage, rule for rule.
 * Ids and clubs only, never a name. null when it is not the Checkout page;
 * `calendarId` '' when it names no meeting.
 * @param {string} html
 * @returns {{ calendarId: string, date: string, rows: {clubberId: string, club: string}[] } | null}
 */
export function parseCheckoutPage(html) {
  if (!html || isLoginPage(html)) return null;
  return checkoutPageOf(documentOf(html), html);
}

/** parseCheckoutPage on a document already built. @param {any} doc @param {string} html */
function checkoutPageOf(doc, html) {
  if (!/Checkout Clubber/.test(squash(doc.querySelector('title')?.textContent))) return null;
  const cal = /calendar_id:\s*(\d{1,12})/.exec(html);
  const opt = doc.querySelector('select#date option[selected]');
  const date = opt ? String(opt.getAttribute('value') || '').trim() : '';
  if (!cal || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { calendarId: '', date: '', rows: [] };
  /** @type {{clubberId: string, club: string}[]} */
  const rows = [];
  for (const a of doc.querySelectorAll('a.checkout[clubber_id]')) {
    const id = String(a.getAttribute('clubber_id') || '').trim();
    if (!/^\d{1,20}$/.test(id)) continue;
    const img = a.closest('tr')?.querySelector('img.club-icon-20');
    rows.push({ clubberId: id, club: img ? String(img.getAttribute('alt') || '').trim() : '' });
  }
  return { calendarId: cal[1], date, rows };
}

/**
 * Who the Checkout page lists, by clubber id (every club), when the page was
 * GENUINELY read: the extension's parseCheckoutHtml guards (feeds.js), rule for
 * rule, then parseCheckoutIds. null whenever the page could not be trusted to
 * be the whole list, so a check-out is never read from a page that only LOOKS
 * empty:
 *   1. not positively the Checkout page (title), or signed out
 *   2. no data table (the first table, `table.items`, is an unrelated notices table)
 *   3. a club filter checkbox unticked (a subset: the hidden clubs would look picked up)
 *   4. rows but none parsed and no "nobody here" placeholder (selector drift)
 * Ids only; no name is kept. @param {string} html @param {string} today YYYY-MM-DD, when the page names no date
 * @returns {{ date: string, ids: string[] } | null}
 */
export function parseCheckoutIds(html, today) {
  if (!html || isLoginPage(html)) return null;
  return checkoutIdsOf(documentOf(html), today);
}

/** @param {any} doc @param {string} today */
function checkoutIdsOf(doc, today) {
  if (!/checkout\s*clubber/i.test(String(doc.querySelector('title')?.textContent || ''))) return null;
  let table = null;
  for (const t of doc.querySelectorAll('table')) {
    if (String(t.getAttribute('class') || '').split(/\s+/).includes('items')) continue;
    table = t;
    break;
  }
  if (!table) return null;
  for (const f of doc.querySelectorAll('input.filter[name^="clubs"]')) if (!f.hasAttribute('checked')) return null;
  let entries = 0;
  let sawEmpty = false;
  for (const row of table.querySelectorAll('tr')) {
    if (row.querySelector('th') && !row.querySelector('td')) continue;
    if (row.querySelector('td.empty, .empty')) { sawEmpty = true; continue; }
    const cell = row.querySelector('td.clubber.name') || row.querySelector('td.clubber');
    if (!cell) continue;
    if (!(String(cell.textContent || '').trim().split(/\s+/)[0] || '')) continue;
    entries += 1;
  }
  if (!entries && !sawEmpty) return null;
  /** @type {string[]} */
  const ids = [];
  for (const a of doc.querySelectorAll('a.checkout[clubber_id]')) {
    const id = String(a.getAttribute('clubber_id') || '').trim();
    if (/^\d{1,20}$/.test(id) && !ids.includes(id)) ids.push(id);
  }
  const opt = doc.querySelector('select#date option[selected]');
  const v = opt ? String(opt.getAttribute('value') || '') : '';
  return { date: /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : today, ids };
}

// ── TwoTimTwo's CSV exports (the extension's feeds.js, rule for rule) ─────────

/**
 * The extension's parseCsvText: quoted fields with commas and newlines, a
 * leading BOM dropped, CR skipped. Rows of field strings. @param {string} text
 * @returns {string[][]}
 */
export function parseCsvRows(text) {
  let t = String(text || '');
  if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\r') { /* skip */ } else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** The extension's looksLikeCsv: a first line with a comma that is not markup. @param {string} text */
export function looksLikeCsv(text) {
  if (!text) return false;
  const t = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const first = (t.split(/\r?\n/)[0] || '').replace(/^\s+/, '');
  return first.charAt(0) !== '<' && first.includes(',');
}

/** The extension's signed-out test for a feed (its login form, or the bare "Login Required"). @param {string} text */
function feedSignedOut(text) {
  if (typeof text !== 'string' || !text) return true;
  return text.trim() === 'Login Required' || isLoginPage(text);
}

/** The extension's isFooterOrBlankRow ("Clubber Count=<n>", "FILTER,VALUE", blank lines). @param {string[]} row */
export function isFooterOrBlankRow(row) {
  if (!row || !row.length) return true;
  if (!row.join('').trim()) return true;
  if (/count\s*=/i.test(row[0] || '')) return true;
  if (/^filter$/i.test((row[0] || '').trim())) return true;
  return false;
}

/**
 * Columns of the roster export the stations never need: the household's
 * contact, address and payment fields (printer/docs/TWOTIMTWO.md section 3 lists
 * all 66). Everything else is kept as TwoTimTwo wrote it, a column this list does
 * not know included, and ROSTER_KEEP always wins: the consent columns the print
 * server shape-matches (`normalizeHeader`), Notes (the allergies), any middle name.
 */
const ROSTER_DROP = /^(?:parent|guardian|address|alt address|city|state|zip|alt city|alt state|alt zip|emergency|others pickup|doctor|church$|# ?payments|payments|rate$|shirt|grandprix|invited by|clubber created|clubber last updated|email|alt email)|phone/;
const ROSTER_KEEP = /release|consent|permission|waiver|allerg|medic|note|middle/;
/** A header as the print server compares it (clubbers.js normalizeHeader's first step). @param {string} h */
const rosterKey = (h) => String(h || '').toLowerCase().replace(/[_\s]+/g, ' ').replace(/[?!.:]+$/, '').trim();

/**
 * TwoTimTwo's roster export (GET /clubber/csv, printer/docs/TWOTIMTWO.md section
 * 3): what the print server enriches every label from (allergies in Notes,
 * birthday, group, photo consent). null when it is not that CSV at all (signed
 * out, a page, no Clubber ID / First Name / Last Name header); `partial` when its
 * own "Clubber Count=<n>" footer names more or fewer rows than were read (a cut
 * download): never a roster with children missing.
 * @param {string} text
 * @returns {{ header: string[], rows: string[][], declared: number|null, partial: boolean } | null}
 */
export function parseRosterCsv(text) {
  if (feedSignedOut(text) || !looksLikeCsv(text)) return null;
  const all = parseCsvRows(text);
  if (!all.length) return null;
  const header = all[0].map((h) => String(h).trim());
  const keys = header.map(rosterKey);
  if (!keys.includes('clubber id') || !keys.includes('first name') || !keys.includes('last name')) return null;
  /** @type {string[][]} */
  const rows = [];
  let declared = null;
  for (const r of all.slice(1)) {
    const first = String(r[0] || '').trim();
    const m = /^Clubber Count=(\d+)/i.exec(first);
    if (m) { declared = Number(m[1]); break; }
    if (/^FILTER$/i.test(first)) break;
    if (!r.join('').trim()) continue;
    rows.push(r);
  }
  return { header, rows, declared, partial: declared !== null && declared !== rows.length };
}

/** One CSV field, always quoted (the print server's parser reads quoted fields with newlines). @param {unknown} v */
const csvField = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/**
 * The roster the stations get: the columns they use, in TwoTimTwo's own order,
 * every field quoted, with the "Clubber Count=<n>" footer the print server's
 * parser stops at. The household's addresses, phones, emails and payments are
 * left out (ROSTER_DROP): nothing on a label reads them.
 * @param {{ header: string[], rows: string[][] }} r
 * @returns {{ csv: string, columns: number }}
 */
export function trimRosterCsv(r) {
  const keep = r.header.map((h, i) => ({ h, i, k: rosterKey(h) })).filter((c) => c.k && (ROSTER_KEEP.test(c.k) || !ROSTER_DROP.test(c.k)));
  const lines = [keep.map((c) => csvField(c.h)).join(',')];
  for (const row of r.rows) lines.push(keep.map((c) => csvField(String(row[c.i] ?? '').trim())).join(','));
  lines.push(`Clubber Count=${r.rows.length}`);
  return { csv: `${lines.join('\r\n')}\r\n`, columns: keep.length };
}

/**
 * The completed-books report (/report/completed_books?output=csv, "Name","Book","Date"):
 * the extension's parseCompletedBooksCsv, rule for rule. [] is an honest "nobody
 * finished one"; null when the shape cannot be confidently understood (signed
 * out, a page, no Name or Book column).
 * @param {string} text @returns {{ name: string, book: string, date: string }[] | null}
 */
export function parseCompletedBooksCsv(text) {
  if (feedSignedOut(text) || !looksLikeCsv(text)) return null;
  const rows = parseCsvRows(text);
  if (rows.length < 2 || !rows[0]) return null;
  let nameIdx = -1, bookIdx = -1, dateIdx = -1;
  rows[0].forEach((raw, i) => {
    const h = String(raw || '').trim().toLowerCase();
    if (h === 'name') nameIdx = i;
    else if (h === 'book') bookIdx = i;
    else if (h === 'date') dateIdx = i;
  });
  if (nameIdx < 0 || bookIdx < 0) return null;
  const out = [];
  for (const row of rows.slice(1)) {
    if (isFooterOrBlankRow(row)) continue;
    const name = String(row[nameIdx] || '').trim();
    const book = String(row[bookIdx] || '').trim();
    if (!name || !book) continue;
    const date = dateIdx >= 0 ? String(row[dateIdx] || '').trim() : '';
    out.push({ name: name.slice(0, 80), book: book.slice(0, 60), date: date.slice(0, 40) });
  }
  return out;
}

/** The extension's award and book columns of the meeting report (feeds.js AWARD_RE / BOOK_RE). */
const AWARD_RE = /award/i;
const BOOK_RE = /book|section/i;

/**
 * The meeting report (/meeting/report?output=csv): tonight's books and awards
 * counts for the lobby ticker, and an award slip per child and award. The
 * extension's parseMeetingReportCsv, rule for rule (a column whose header says
 * "award" is an award, "book"/"section" a book; a slip needs a name, from First +
 * Last, or a "Name" / "Clubber Name" column). null when it is not that CSV.
 * @param {string} text
 * @returns {{ booksCompleted: number, awardsEarned: number, slips: { name: string, clubName: string, award: string }[] } | null}
 */
export function parseMeetingReportCsv(text) {
  if (feedSignedOut(text) || !looksLikeCsv(text)) return null;
  const rows = parseCsvRows(text);
  if (rows.length < 2 || !rows[0] || rows[0].length < 2) return null;
  const header = rows[0];
  /** @type {{ idx: number, label: string }[]} */
  const awardCols = [];
  /** @type {{ idx: number, label: string }[]} */
  const bookCols = [];
  let firstIdx = -1, lastIdx = -1, nameIdx = -1, clubIdx = -1;
  header.forEach((raw, i) => {
    const h = String(raw || '').trim();
    const hl = h.toLowerCase();
    if (AWARD_RE.test(h)) { awardCols.push({ idx: i, label: h }); return; }
    if (BOOK_RE.test(h)) { bookCols.push({ idx: i, label: h }); return; }
    if (/^first/.test(hl)) firstIdx = i;
    else if (/^last/.test(hl)) lastIdx = i;
    else if (hl === 'name' || /clubber\s*name/.test(hl)) nameIdx = i;
    else if (/^club$/.test(hl)) clubIdx = i;
  });
  let booksCompleted = 0, awardsEarned = 0;
  /** @type {{ name: string, clubName: string, award: string }[]} */
  const slips = [];
  for (const row of rows.slice(1)) {
    if (isFooterOrBlankRow(row)) continue;
    let name = '';
    if (firstIdx >= 0 && lastIdx >= 0) name = `${String(row[firstIdx] || '').trim()} ${String(row[lastIdx] || '').trim()}`.trim();
    else if (nameIdx >= 0) name = String(row[nameIdx] || '').trim();
    const clubName = clubIdx >= 0 ? String(row[clubIdx] || '').trim() : '';
    for (const col of awardCols) {
      if (!String(row[col.idx] || '').trim()) continue;
      awardsEarned++;
      if (name) slips.push({ name, clubName, award: col.label });
    }
    for (const col of bookCols) {
      if (!String(row[col.idx] || '').trim()) continue;
      booksCompleted++;
      if (name) slips.push({ name, clubName, award: col.label });
    }
  }
  return { booksCompleted, awardsEarned, slips };
}

/**
 * Did TwoTimTwo record a check-in? Its answer to POST /clubber/checkinclubber
 * is the short #lastCheckin snippet naming the child: never a page, never the
 * login form, never "Login Required". The extension's checkinReplyOk, rule for
 * rule (a whole page once passed "names the child" and a refused post was
 * taken for a check-in).
 * @param {string} text @param {string} childName
 */
export function checkinReplyOk(text, childName) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t || t.length > 4000) return false;
  if (/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(t)) return false;
  if (t === 'Login Required' || /name=["']LoginForm\[/.test(t) || /type=["']password["']/i.test(t)) return false;
  const first = String(childName || '').trim().split(/\s+/)[0] || '';
  return !!first && t.toLowerCase().includes(first.toLowerCase());
}

// Which of tonight's check-in items a check-in sends (cloud check-in).
export const BIBLE_RE = /bible/i;
export const FRIEND_RE = /friend|brought/i;

/**
 * The items a check-in sends: every automatic one (Attendance), Bible and
 * Brought a friend when the phone ticked them, and only items whose clubs
 * include the child's (none listed: every club). The extension's
 * collectApplicableEvents, without a checkbox's own state to read.
 * @param {{id: string, clubs: string[], automatic: boolean, label?: string}[]} events
 * @param {string} clubId @param {{Bible?: unknown, Friend?: unknown}} [options]
 */
export function itemsToSend(events, clubId, options = {}) {
  return events.filter((e) => {
    if (e.clubs.length && !e.clubs.includes(String(clubId))) return false;
    if (e.automatic) return true;
    if (BIBLE_RE.test(e.label || '')) return options.Bible === true;
    if (FRIEND_RE.test(e.label || '')) return options.Friend === true;
    return false;
  }).map((e) => e.id);
}

/**
 * TwoTimTwo's /household/csv as families: each household's active children,
 * by name, where it has two or more. That export also carries addresses and
 * phone numbers; only the Household ID and Active Clubbers columns are read,
 * as the extension's householdIndex() does, and nothing else survives.
 * null when it is not that CSV (the login form, a page, a changed header).
 * @param {string} text
 * @returns {string[][] | null}
 */
export function parseHouseholdCsv(text) {
  const all = householdLists(text);
  return all ? all.filter((kids) => kids.length >= 2) : null;
}

/**
 * Every household's active children by name, one-child households included
 * (so a child the export does not list at all can be told from one with no
 * brothers or sisters: families.js). Same columns, same rules.
 * @param {string} text
 * @returns {string[][] | null}
 */
export function householdLists(text) {
  const t = String(text || '').replace(/^\uFEFF/, '');
  if (!t || isLoginPage(t) || /^\s*</.test(t)) return null;
  /** @type {string[][]} */
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(field); field = ''; rows.push(row); row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return null;
  const head = rows[0].map((h) => squash(h).toLowerCase());
  const idCol = head.indexOf('household id');
  const kidsCol = head.indexOf('active clubbers');
  if (idCol < 0 || kidsCol < 0) return null;
  /** @type {string[][]} */
  const out = [];
  for (const r of rows.slice(1)) {
    if (!String(r[idCol] || '').trim()) continue;
    const kids = String(r[kidsCol] || '').split(',').map((k) => squash(k).slice(0, 80)).filter(Boolean);
    if (kids.length) out.push(kids);
  }
  return out;
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
 * A response's bytes, untouched (a PDF), capped like a page. `html` is the
 * text only when TwoTimTwo says the answer is text (so the login form is still
 * seen); a binary answer is never decoded or looked into.
 * @param {Response} res
 */
async function readRaw(res) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > PAGE_MAX) throw new Error('page-too-large');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > PAGE_MAX) throw new Error('page-too-large');
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  const html = /^text\/|html|xml/i.test(contentType) ? new TextDecoder().decode(bytes) : '';
  return { bytes, contentType, html };
}

/**
 * One signed-in TwoTimTwo session. The cookie jar is memory only: a restarted
 * Durable Object signs in again on its first read.
 */
export class TwoTimTwoClient {
  /**
   * @param {{ host: string, username: string, password: string }} creds
   * @param {{ fetchFn?: typeof fetch, now?: () => number, budget?: import('./readbudget.js').ReadBudget }} [opts]
   */
  constructor(creds, opts = {}) {
    this.host = creds.host;
    this.username = creds.username;
    this.password = creds.password;
    this.fetchFn = opts.fetchFn || ((...args) => fetch(...args));
    this.now = opts.now || (() => Date.now());
    /** The one read clock (readbudget.js): every page GET takes a slot. None: no limit (the unit tests). */
    this.budget = opts.budget || null;
    /** @type {Map<string, string>} */
    this.cookies = new Map();
    this.loginFails = 0;
    this.loginBlockedUntil = 0;
    /** TwoTimTwo down or no network at the last sign-in: no sign-in before this (ms). */
    this.downFails = 0;
    this.downUntil = 0;
    this.logins = 0;
    /** When this session last asked for a signed-in page (ms; 0 never): the watcher's read clock reads it. */
    this.lastReadMs = 0;
    /** Desk writes that met a lapsed session and signed in again (write()). */
    this.relogins = 0;
    /** The sign-in under way, shared (signIn()). @type {Promise<any>|null} */
    this.signingIn = null;
    /**
     * Asked before every check-in, undo or check-out post (write()): a fixed
     * error code refuses it unsent (the watcher's `no-club`), null lets it go.
     * None: every post goes (the unit tests).
     * @type {(() => Promise<string|null>)|null}
     */
    this.writeGuard = opts.writeGuard || null;
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
   * A slot from the one clock, or a thrown `ReadBusy` (with retryAfterMs).
   * No clock (the unit tests): nothing to wait for. `priority` (readbudget.js):
   * true for the watcher's report or a hop of a request already under way,
   * URGENT for a desk action's read.
   * @param {number} waitMs @param {string} kind @param {boolean | { urgent: boolean }} [priority]
   */
  async slot(waitMs, kind, priority = false) {
    if (!this.budget) { this.lastReadMs = this.now(); return; }
    const s = await this.budget.take(waitMs, kind, priority);
    if (!s.ok) throw Object.assign(new Error('read-busy'), { name: 'ReadBusy', retryAfterMs: s.retryAfterMs });
    this.lastReadMs = this.now();
  }

  /**
   * One request, following redirects by hand so every hop's cookies are kept
   * and no hop may leave the TwoTimTwo host. `slot` makes the first hop take a
   * slot from the clock (queueing up to its waitMs); every redirect hop takes one
   * too (FOLLOW_WAIT_MS), a write's included.
   * `raw`: the answer's bytes and content type too, untouched (readRaw).
   * @param {string} path @param {{method?: string, form?: URLSearchParams, slot?: { waitMs: number, kind: string, priority?: boolean | { urgent: boolean } }, urgent?: boolean, raw?: boolean}} [opts]
   * @returns {Promise<{status: number, path: string, html: string, bytes?: Uint8Array, contentType?: string}>}
   */
  async request(path, opts = {}) {
    let url = new URL(path, this.origin);
    let method = opts.method || 'GET';
    let body = opts.form ? opts.form.toString() : undefined;
    const kind = opts.slot ? opts.slot.kind : 'redirect';
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (url.protocol !== 'https:' || url.host !== this.host) throw new Error('off-site-redirect');
      if (hop > 0) await this.slot(FOLLOW_WAIT_MS, kind, opts.urgent || (opts.slot && opts.slot.priority === URGENT) ? URGENT : true);
      else if (opts.slot) await this.slot(opts.slot.waitMs, kind, opts.slot.priority || false);
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
      if (opts.raw) return { status: res.status, path: url.pathname, ...(await readRaw(res)) };
      return { status: res.status, path: url.pathname, html: await readCapped(res) };
    }
    throw new Error('too-many-redirects');
  }

  /**
   * Sign in: the form, the post and any redirect, each on the one clock (the
   * first queues up to `waitMs`, the rest up to FOLLOW_WAIT_MS).
   * @param {{ waitMs?: number, kind?: string, priority?: boolean, urgent?: boolean }} [opts]
   * @returns {Promise<{ok: true} | {ok: false, error: string, retryAfterMs?: number}>}
   */
  async login(opts = {}) {
    const t = this.now();
    if (this.loginBlockedUntil > t) return { ok: false, error: 'login-backoff' };
    if (this.downUntil > t) return { ok: false, error: 'twotimtwo-down', retryAfterMs: this.downUntil - t };
    this.cookies.clear();
    let res;
    try {
      const form = await this.request('/site/login', { slot: { waitMs: opts.waitMs ?? 0, kind: 'login', priority: opts.urgent ? URGENT : !!opts.priority } });
      this.logins += 1;
      // TwoTimTwo down already on the form: no post into it.
      if (form.status >= 500) {
        this.cookies.clear();
        this.noteDown();
        return { ok: false, error: 'twotimtwo-down' };
      }
      const params = new URLSearchParams();
      const token = loginToken(form.html);
      if (token) params.set('YII_CSRF_TOKEN', token);
      params.set('LoginForm[username]', this.username);
      params.set('LoginForm[password]', this.password);
      params.set('Login', '1');
      res = await this.request('/site/login', { method: 'POST', form: params, slot: { waitMs: FOLLOW_WAIT_MS, kind: 'login', priority: opts.urgent ? URGENT : true } });
    } catch (err) {
      this.cookies.clear();
      const code = errorCode(err);
      if (code === 'read-busy') return { ok: false, error: code, retryAfterMs: /** @type {any} */ (err).retryAfterMs };
      // A network failure is not a refused password, but it is not a reason to try
      // again at once either: the down back-off.
      if (code === 'network' || code === 'timeout') this.noteDown();
      return { ok: false, error: code };
    }
    if (res.status === 200 && !isLoginPage(res.html) && !/\/site\/login/i.test(res.path)) {
      this.loginFails = 0;
      this.loginBlockedUntil = 0;
      this.downFails = 0;
      this.downUntil = 0;
      return { ok: true };
    }
    this.cookies.clear();
    // TwoTimTwo itself failing is not a refused password: the shorter down back-off.
    if (res.status >= 500) {
      this.noteDown();
      return { ok: false, error: 'twotimtwo-down' };
    }
    const wait = LOGIN_BACKOFF_MS[Math.min(this.loginFails, LOGIN_BACKOFF_MS.length - 1)];
    this.loginFails += 1;
    this.loginBlockedUntil = this.now() + wait;
    return { ok: false, error: 'login-refused' };
  }

  /**
   * One sign-in at a time: callers that find one under way share it (two at
   * once would each clear the other's cookie). @param {{ waitMs?: number, priority?: boolean, urgent?: boolean }} opts
   * @returns {Promise<{ok: true} | {ok: false, error: string, retryAfterMs?: number}>}
   */
  signIn(opts) {
    if (!this.signingIn) this.signingIn = this.login(opts).finally(() => { this.signingIn = null; });
    return this.signingIn;
  }

  /** TwoTimTwo down or no network at a sign-in: wait 30 s, 1, 2, then 5 minutes before the next. */
  noteDown() {
    this.downUntil = this.now() + DOWN_BACKOFF_MS[Math.min(this.downFails, DOWN_BACKOFF_MS.length - 1)];
    this.downFails += 1;
  }

  /**
   * A signed-in page: signs in first when there is no session, and once more
   * when the page comes back as the login form (the session expired).
   * Every GET takes a slot from the read clock first: `waitMs` is how long
   * this caller will queue for one (0: the watcher, which skips its turn),
   * and a refusal is `{error: 'read-busy', retryAfterMs}`. `priority`: the
   * watcher's report (it may take the slot it reserved); `urgent`: a desk
   * check-in, undo or check-out with nothing cached, the head of the queue
   * (readbudget.js).
   * `raw`: also the answer's untouched bytes and content type (a PDF report).
   * @param {string} path
   * @param {{ waitMs?: number, kind?: string, priority?: boolean, urgent?: boolean, raw?: boolean }} [opts]
   * @returns {Promise<{ok: true, html: string, path: string, bytes?: Uint8Array, contentType?: string} | {ok: false, error: string, retryAfterMs?: number}>}
   */
  async page(path, opts = {}) {
    // The caller's wait is for the first request; once one is made the rest queue
    // behind it (FOLLOW_WAIT_MS): a sign-in is never left half done.
    let waitMs = opts.waitMs ?? 0;
    const urgent = !!opts.urgent;
    /** @type {boolean | { urgent: boolean }} */
    let priority = urgent ? URGENT : !!opts.priority;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.cookies.size || attempt > 0) {
        const signedIn = await this.signIn({ waitMs, priority: priority === true, urgent });
        if (!signedIn.ok) return signedIn;
        waitMs = FOLLOW_WAIT_MS;
        priority = urgent ? URGENT : true;
      }
      let res;
      try {
        res = await this.request(path, { slot: { waitMs, kind: opts.kind || 'page', priority }, raw: !!opts.raw });
      } catch (err) {
        const code = errorCode(err);
        return code === 'read-busy' ? { ok: false, error: code, retryAfterMs: /** @type {any} */ (err).retryAfterMs } : { ok: false, error: code };
      }
      waitMs = FOLLOW_WAIT_MS;
      priority = urgent ? URGENT : true;
      if (isLoginPage(res.html) || /\/site\/login/i.test(res.path)) continue;
      // A refusal is answered with one fresh sign-in: TwoTimTwo applies a
      // permission granted to the user at its next sign-in, not to a session
      // already open (the household export, 2026-10-11).
      if (res.status === 403 && attempt === 0) continue;
      if (res.status !== 200) return { ok: false, error: res.status >= 500 ? 'twotimtwo-down' : `http-${res.status}` };
      if (opts.raw) return { ok: true, html: res.html, path: res.path, bytes: res.bytes, contentType: res.contentType };
      return { ok: true, html: res.html, path: res.path };
    }
    return { ok: false, error: 'signed-out' };
  }

  /** @param {string} date YYYY-MM-DD @param {{ waitMs?: number, kind?: string }} [opts] */
  async report(date, opts = {}) {
    const page = await this.page(`/clubber/checkin_report?date=${encodeURIComponent(date)}`, { kind: 'report', ...opts });
    if (!page.ok) return page;
    const report = parseCheckinReport(page.html);
    return report
      ? { ok: /** @type {const} */ (true), report, html: page.html }
      : { ok: /** @type {const} */ (false), error: 'report-unreadable', shape: pageShape(page.html) };
  }

  /**
   * A write for a desk action (`desk: true`): never left waiting on a lapsed
   * session. Its redirect hops are URGENT reads, and when TwoTimTwo answers
   * with the login form (signed out) it signs in again at the head of the
   * read queue and makes the write ONCE more. Without `desk` (the youth
   * check-out sweep) a signed-out answer is just that.
   * @template {{ok: boolean, error?: string}} R
   * @param {(urgent: boolean) => Promise<R>} send @param {{ desk?: boolean }} opts
   * @returns {Promise<R>}
   */
  async write(send, opts) {
    if (this.writeGuard) {
      const refused = await this.writeGuard(opts);
      if (refused) return { ok: /** @type {const} */ (false), error: refused };
    }
    const desk = !!(opts && opts.desk);
    const first = await send(desk);
    if (first.ok || first.error !== 'signed-out' || !desk) return first;
    const signedIn = await this.signIn({ waitMs: INTERACTIVE_WAIT_MS, urgent: true });
    if (!signedIn.ok) return first;
    this.relogins += 1;
    return send(true);
  }

  /**
   * Check one child in: TwoTimTwo's own POST, as the check-in page makes it.
   * @param {{clubberId: string, calendarId: string, events: string[], name: string}} c
   * @param {{ desk?: boolean }} [opts] a desk action: signs in again and retries once (write())
   * @returns {Promise<{ok: true} | {ok: false, error: string}>}
   */
  async checkIn(c, opts = {}) {
    return this.write(async (urgent) => {
      const form = new URLSearchParams();
      form.set('clubber_id', c.clubberId);
      form.set('calendar_id', c.calendarId);
      for (const id of c.events) form.append('events[]', id);
      let res;
      try {
        res = await this.request('/clubber/checkinclubber', { method: 'POST', form, urgent });
      } catch (err) {
        return { ok: /** @type {const} */ (false), error: errorCode(err) };
      }
      if (isLoginPage(res.html) || /\/site\/login/i.test(res.path)) return { ok: /** @type {const} */ (false), error: 'signed-out' };
      if (res.status !== 200) return { ok: /** @type {const} */ (false), error: res.status >= 500 ? 'twotimtwo-down' : `http-${res.status}` };
      return checkinReplyOk(res.html, c.name) ? { ok: /** @type {const} */ (true) } : { ok: /** @type {const} */ (false), error: 'checkin-refused' };
    }, opts);
  }

  /**
   * Undo one check-in: TwoTimTwo's own POST (docs: `checkinclubberundo`),
   * counted only on its short "(checkin undone)" answer. A write: no read slot.
   * @param {{clubberId: string, calendarId: string}} c @param {{ desk?: boolean }} [opts]
   * @returns {Promise<{ok: true} | {ok: false, error: string}>}
   */
  async undoCheckIn(c, opts = {}) {
    return this.write((urgent) => this.postOk('/clubber/checkinclubberundo', c, (t) => /\(checkin undone\)/i.test(t), urgent), opts);
  }

  /**
   * Check one child out: POST /clubber/checkout, accepted only on an exact "OK".
   * @param {{clubberId: string, calendarId: string}} c @param {{ desk?: boolean }} [opts]
   * @returns {Promise<{ok: true} | {ok: false, error: string}>}
   */
  async checkOut(c, opts = {}) {
    return this.write((urgent) => this.postOk('/clubber/checkout', c, (t) => t.trim() === 'OK', urgent), opts);
  }

  /**
   * @param {string} path @param {{clubberId: string, calendarId: string}} c @param {(text: string) => boolean} accept
   * @param {boolean} [urgent] a desk action's: its redirect hops are urgent reads
   * @returns {Promise<{ok: true} | {ok: false, error: string}>}
   */
  async postOk(path, c, accept, urgent = false) {
    const form = new URLSearchParams();
    form.set('calendar_id', c.calendarId);
    form.set('clubber_id', c.clubberId);
    let res;
    try {
      res = await this.request(path, { method: 'POST', form, urgent });
    } catch (err) {
      return { ok: false, error: errorCode(err) };
    }
    if (isLoginPage(res.html) || /\/site\/login/i.test(res.path)) return { ok: false, error: 'signed-out' };
    if (res.status !== 200) return { ok: false, error: res.status >= 500 ? 'twotimtwo-down' : `http-${res.status}` };
    return accept(res.html) ? { ok: true } : { ok: false, error: 'refused' };
  }

  /** The families, from TwoTimTwo's household export (names only kept). */
  async households(opts = {}) {
    const page = await this.page('/household/csv', { kind: 'households', ...opts });
    if (!page.ok) return page;
    const all = householdLists(page.html);
    return all
      ? { ok: /** @type {const} */ (true), households: all.filter((kids) => kids.length >= 2), names: all.flat() }
      : { ok: /** @type {const} */ (false), error: 'households-unreadable' };
  }

  /**
   * The Checkout page: its meeting and the rows it lists (parseCheckoutPage).
   * @param {{ waitMs?: number, kind?: string }} [opts]
   */
  async checkoutPage(opts = {}) {
    const page = await this.page('/clubber/checkout', { kind: 'checkout-page', ...opts });
    if (!page.ok) return page;
    if (isLoginPage(page.html)) return { ok: /** @type {const} */ (false), error: 'checkout-page-unreadable' };
    const doc = documentOf(page.html);
    const parsed = checkoutPageOf(doc, page.html);
    if (!parsed) return { ok: /** @type {const} */ (false), error: 'checkout-page-unreadable' };
    if (!parsed.calendarId) return { ok: /** @type {const} */ (false), error: 'no-meeting' };
    // Every club's ids, when the page was genuinely read (null otherwise): the
    // check-outs made by hand on that page (ymcheckout.js, the extension's runCheckout).
    return { ok: /** @type {const} */ (true), page: parsed, ids: checkoutIdsOf(doc, parsed.date) };
  }

  /**
   * The roster export, /clubber/csv (parseRosterCsv). TwoTimTwo's own text never
   * leaves this function: callers get the parsed rows, which stationfeeds.js trims
   * (trimRosterCsv) before anything is sealed.
   * @param {{ waitMs?: number, kind?: string }} [opts]
   */
  async rosterCsv(opts = {}) {
    const page = await this.page('/clubber/csv', { kind: 'roster-csv', ...opts });
    if (!page.ok) return page;
    const roster = parseRosterCsv(page.html);
    if (!roster) return { ok: /** @type {const} */ (false), error: 'roster-unreadable' };
    if (roster.partial) return { ok: /** @type {const} */ (false), error: 'roster-partial' };
    return { ok: /** @type {const} */ (true), roster };
  }

  /**
   * One club's completed books, the extension's query (output=csv, club_id,
   * from_date, to_date as YYYY-MM-DD). @param {number|string} clubId @param {string} from @param {string} to
   * @param {{ waitMs?: number, kind?: string }} [opts]
   */
  async completedBooks(clubId, from, to, opts = {}) {
    const q = `output=csv&club_id=${encodeURIComponent(String(clubId))}&from_date=${encodeURIComponent(from)}&to_date=${encodeURIComponent(to)}`;
    const page = await this.page(`/report/completed_books?${q}`, { kind: 'completed-books', ...opts });
    if (!page.ok) return page;
    const entries = parseCompletedBooksCsv(page.html);
    return entries ? { ok: /** @type {const} */ (true), entries } : { ok: /** @type {const} */ (false), error: 'books-unreadable' };
  }

  /**
   * Tonight's meeting report (output=csv, with the meeting's calendar_id when it is known).
   * @param {string} calendarId '' when not known @param {{ waitMs?: number, kind?: string }} [opts]
   */
  async meetingReport(calendarId, opts = {}) {
    const cal = /^\d{1,12}$/.test(String(calendarId || '')) ? `&calendar_id=${calendarId}` : '';
    const page = await this.page(`/meeting/report?output=csv${cal}`, { kind: 'meeting-report', ...opts });
    if (!page.ok) return page;
    const report = parseMeetingReportCsv(page.html);
    return report ? { ok: /** @type {const} */ (true), report } : { ok: /** @type {const} */ (false), error: 'meeting-unreadable' };
  }

  /** @param {{ waitMs?: number, kind?: string }} [opts] */
  async checkinPage(opts = {}) {
    const page = await this.page('/clubber/checkin', { kind: 'checkin-page', ...opts });
    if (!page.ok) return page;
    const parsed = parseCheckinPage(page.html);
    return parsed ? { ok: /** @type {const} */ (true), page: parsed } : { ok: /** @type {const} */ (false), error: 'checkin-page-unreadable' };
  }
}

/** A fixed code for a thrown error: never its message, which may carry a URL. @param {unknown} err */
function errorCode(err) {
  const msg = err instanceof Error ? err.message : '';
  if (msg === 'off-site-redirect' || msg === 'too-many-redirects' || msg === 'page-too-large') return msg;
  if (err instanceof Error && err.name === 'ReadBusy') return 'read-busy';
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'timeout';
  return 'network';
}

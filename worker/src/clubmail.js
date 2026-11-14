// @ts-check
// Club email (owner 2026-11-13: "a page that lets directors send emails from the
// awana@ outlook account that goes to all parents who have a kid in that club";
// src/routes.md 10.19). The page is awana.kvbchurch.org/tools/email/.
//
// WHO. Each director has their own login (owner's choice): a code tied to their
// clubs and their own reply address. ONLY THE OWNER adds, changes or removes a
// director (owner 2026-11-13: "Lock adding directors to me only"): the church
// session AND the owner's own code (Worker secret MAIL_OWNER_CODE, header
// X-Mail-Owner); the church passphrase alone opens nothing here. The Worker MAILS
// a director's code to the director's address and never shows it on a page, and
// tells the awana@ mailbox a login was made. A code signs in for a token
// (X-Mail-Token, stored as a hash). The owner may also send, to any club, with
// replies to awana@.
//
// TO WHOM. The parents' addresses come from TwoTimTwo's roster export at the
// moment of sending (the one read clock), every active child of that club, Email
// and Alt Email, each address once. They are held in memory only, a few minutes,
// and are NEVER stored, logged or answered to a page: a page gets counts.
// Parents are always BCC; the visible To is the director; Reply-To is the director.
// The Awana mailbox is BCC'd on every real send too (never on a test, never counted).
// Club "all" (a sender with more than one club) is every one of their clubs' parents,
// each address once, from the Awana mailbox. More addresses than one message takes
// (MAIL_RECIPIENTS_MAX) go out as several messages, one after the other.
//
// HOW. Microsoft Graph with an app registration (client credentials): secrets
// MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET; the mailbox is MAIL_FROM (default
// awana@kvbchurch.org). A club may have a mailbox of its own (owner 2026-11-13:
// puggles@ is "the address that messages from the puggles director sends from"):
// MAIL_FROM_CLUBS, "club=address, club=address"; that club's messages are drafted
// in and sent from it, every other club's and the login mails from MAIL_FROM. The
// app must be allowed each such mailbox (the AwanaMailApp group, worker/README.md).
// Without the secrets every sending route answers 503
// `not-configured`. A message is a draft in the mailbox, its files are attached,
// then it is sent; the PAGE drives that one small step per request (`/step`), so
// no request does much work (the free plan). The step that sends is marked BEFORE
// Microsoft is asked: an answer that never came is "unknown", never sent again.
//
// SEND LATER (owner 2026-11-14). A finished draft may be given a time instead of being
// sent: it leaves the sender's one draft slot, waits (`mail:later`), and the Durable
// Object's alarm walks the same steps the page would, one per alarm (`tick`; the alarm is
// the watcher's, `arm` only ever pulls it EARLIER). The parents are read at that moment.
// A step that fails is tried again later; one that cannot work (or 8 failures) ends the
// wait and MAILS the sender why; a send Microsoft never answered is not sent again, and
// the sender is told to look in Sent Items. A waiting message can be cancelled.
//
// The Worker builds the HTML itself from plain blocks (paragraph, heading, list,
// picture); a page never hands it HTML.
//
// Storage:
//   mail:directors        {rev, list: [{id, name, replyTo, clubs, code (sha-256 hex), at}]}
//   mail:tokens           {<sha-256 hex of the token>: {d: <director id>, at}}
//   mail:draft:<who>      the one message a director is working on (no addresses)
//   mail:part:<id>:<f>:<n> one piece of one file (text for a small file, bytes for a big one)
//   mail:log              the last sends: when, who, club, subject, how many (no addresses)
//   mail:later            the messages waiting for their time: [{id, who, name, club, label, subject, at, ...}] (no addresses)
//   mail:later:<id>       one of them: the draft as uploaded, its files' pieces under mail:part as usual
//   mail:body:<id>        a sent message's words (its blocks, no picture, no address), kept
//                         while its line is in the log, so it can be started from again

import { CLUB_TABLE, clubIdByAlias } from '../../shared/clubs.js';
import { randomBytes, safeEqual, toBase64Url, toHex } from './crypto.js';
import { fail, json } from './http.js';

export const MAIL_FROM_DEFAULT = 'awana@kvbchurch.org';
/** The club id of a message to every club the sender has (owner 2026-11-14: several clubs at once). */
export const MAIL_ALL = 'all';
/** One stored piece of a file: this many base64 chars (a small file) or bytes (a big one). */
export const MAIL_PART = 96 * 1024;
/** A file under this goes to Microsoft in one request, as base64 the browser made. */
export const MAIL_SMALL_BYTES = 3 * 1000 * 1000 - 4096;
/** Every file of one message together. Under the 25 MB many inboxes accept once a file is encoded for mail. */
export const MAIL_TOTAL_BYTES = 18 * 1024 * 1024;
export const MAIL_FILES_MAX = 10;
export const MAIL_SUBJECT_MAX = 150;
export const MAIL_BLOCKS_MAX = 80;
export const MAIL_TEXT_MAX = 20000;
/** A big file's pieces sent to Microsoft per step (about 2.9 MB; its limit is 4 MB). */
export const MAIL_STEP_PARTS = 30;
/** A draft nobody sent is deleted after this. */
export const MAIL_DRAFT_TTL_MS = 3 * 60 * 60 * 1000;
/** A director's token lasts this long. */
export const MAIL_TOKEN_MS = 30 * 24 * 60 * 60 * 1000;
/** Real sends (not tests) a director may make in a day. */
export const MAIL_SENDS_PER_DAY = 6;
export const MAIL_DIRECTORS_MAX = 40;
export const MAIL_RECIPIENTS_MAX = 450;   // Microsoft takes at most 500 on one message
/** The roster's addresses are kept this long, in memory only. */
export const ROSTER_FRESH_MS = 5 * 60 * 1000;
/** Wrong codes from one network / from everyone, per window. */
export const CODE_FAILS_IP = 8;
export const CODE_FAILS_ALL = 60;
export const CODE_WINDOW_MS = 10 * 60 * 1000;
export const MAIL_LOG_MAX = 50;
/** Send later: how soon and how far off a time may be, how many may wait (a sender, everyone). */
export const LATER_MIN_MS = 5 * 60 * 1000;
export const LATER_MAX_MS = 28 * 24 * 60 * 60 * 1000;
export const LATER_PER_SENDER = 3;
export const LATER_ALL = 12;
/** Send later: the wait between its steps, after a failed one (times the tries, at most 15 min), and the tries. */
export const LATER_STEP_MS = 1500;
export const LATER_RETRY_MS = 2 * 60 * 1000;
export const LATER_TRIES = 8;
/** Mail that came back is looked for this long after a send, and an answer is kept this long. */
export const BOUNCE_LOOK_MS = 7 * 24 * 60 * 60 * 1000;
export const BOUNCE_FRESH_MS = 10 * 60 * 1000;
/** The owner's code is at least this long, or the owner's part stays shut. */
export const OWNER_CODE_MIN = 12;

const DIRECTORS_KEY = 'mail:directors';
const TOKENS_KEY = 'mail:tokens';
const LOG_KEY = 'mail:log';
const draftKey = (/** @type {string} */ who) => `mail:draft:${who}`;
const LATER_KEY = 'mail:later';
const laterKey = (/** @type {string} */ id) => `mail:later:${id}`;
const bodyKey = (/** @type {string} */ id) => `mail:body:${id}`;
const partKey = (/** @type {string} */ id, /** @type {number} */ f, /** @type {number} */ n) => `mail:part:${id}:${f}:${n}`;
const GRAPH = 'https://graph.microsoft.com/v1.0';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const EMAIL_RE = /^[^\s@<>,;:"()[\]\\]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/;
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const ID_RE = /^[a-z0-9]{16}$/;
const CLUB_IDS = CLUB_TABLE.map((c) => c.id);
const clubName = (/** @type {string} */ id) => CLUB_TABLE.find((c) => c.id === id)?.name || id;
/** File types a message may carry (anything else is refused: no programs, no web pages). */
const FILE_TYPES = /^(?:image\/(?:jpeg|png|gif|webp)|application\/pdf|text\/plain|text\/calendar|application\/msword|application\/vnd\.openxmlformats-officedocument\.(?:wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|application\/vnd\.ms-(?:excel|powerpoint))$/;
const INLINE_TYPES = /^image\/(?:jpeg|png|gif)$/;

const oneLine = (/** @type {unknown} */ v, /** @type {number} */ max) => String(v ?? '').replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const manyLines = (/** @type {unknown} */ v, /** @type {number} */ max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[^\P{Cc}\n\t]+/gu, '').trim().slice(0, max);
/** A valid address, lower case, or ''. @param {unknown} v */
export const cleanEmail = (v) => { const s = String(v ?? '').trim().toLowerCase(); return s.length <= 254 && EMAIL_RE.test(s) ? s : ''; };
const newId = () => toHex(randomBytes(8));
const esc = (/** @type {string} */ s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
async function sha256Hex(/** @type {string} */ s) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
}
/** A code as typed: letters and figures only, upper case. @param {unknown} v */
export const normalCode = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** A new login code, `XXXX-XXXX-XXXX` (about 59 bits). */
export function newCode() {
  const b = randomBytes(12);
  const s = Array.from(b, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

/** A file name safe for a mail attachment. @param {unknown} v */
export function cleanFileName(v) {
  const s = String(v ?? '').replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return s.replace(/^\.+/, '') || 'file';
}

/** The clubs of a list, known ids only, each once, youngest first. @param {unknown} v */
export function cleanClubs(v) {
  const got = new Set((Array.isArray(v) ? v : []).map((c) => clubIdByAlias(String(c ?? ''))));
  return CLUB_IDS.filter((id) => got.has(id));
}

/**
 * The clubs with a mailbox of their own, from `MAIL_FROM_CLUBS`
 * ("puggles=puggles@kvbchurch.org, sparks=..."): known clubs and valid addresses
 * only, anything else is left out (that club then sends from the Awana mailbox).
 * @param {unknown} v @returns {Record<string, string>}
 */
export function clubMailboxes(v) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const pair of String(v ?? '').split(/[,;\n]+/)) {
    const at = pair.indexOf('=');
    if (at < 0) continue;
    const club = clubIdByAlias(pair.slice(0, at).trim()), address = cleanEmail(pair.slice(at + 1));
    if (CLUB_IDS.includes(club) && address) out[club] = address;
  }
  return out;
}

/**
 * A message's blocks, cleaned: {t:'p'|'h', text}, {t:'ul', items}, {t:'img', file}.
 * null when there is nothing to say. @param {unknown} v @param {number} files
 */
export function cleanBlocks(v, files) {
  /** @type {any[]} */
  const out = [];
  let chars = 0;
  for (const b of (Array.isArray(v) ? v : []).slice(0, MAIL_BLOCKS_MAX)) {
    if (!b || typeof b !== 'object') continue;
    const room = MAIL_TEXT_MAX - chars;
    if (b.t === 'p' || b.t === 'h') {
      const text = b.t === 'h' ? oneLine(b.text, 120) : manyLines(b.text, room);
      if (!text) continue;
      chars += text.length;
      out.push({ t: b.t, text });
    } else if (b.t === 'ul') {
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 40).map((/** @type {unknown} */ i) => oneLine(i, 400)).filter(Boolean);
      const len = items.join('').length;
      if (!items.length || len > room) continue;
      chars += len;
      out.push({ t: 'ul', items });
    } else if (b.t === 'img') {
      const file = Number(b.file);
      if (Number.isInteger(file) && file >= 0 && file < files && !out.some((o) => o.t === 'img' && o.file === file)) out.push({ t: 'img', file });
    }
  }
  return out.some((b) => b.t !== 'img') || out.length ? out : null;
}

/**
 * A paragraph's text as HTML: escaped first, then `**bold**`, `[words](https://address)`
 * and bare web addresses as links (owner 2026-11-14: the page's Bold and Link buttons).
 * Only these three; the page's `inlineHtml` (site/tools/email/logic.js) is the same rule.
 * @param {string} text
 */
export function linked(text) {
  const a = (/** @type {string} */ href, /** @type {string} */ words) => `<a href="${href}" style="color:#0B5CAD">${words}</a>`;
  const bold = (/** @type {string} */ s) => s.replace(/\*\*([^*\n](?:[^\n]*?[^*\n])?)\*\*/g, '<b>$1</b>');
  const plain = (/** @type {string} */ s) => bold(s.replace(/\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)*]/g, (u) => a(u, u)));
  const e = esc(text);
  let out = '', last = 0;
  for (const m of e.matchAll(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s<>"()]+)\)/g)) {
    out += plain(e.slice(last, m.index)) + a(m[2], bold(m[1]));
    last = (m.index || 0) + m[0].length;
  }
  return (out + plain(e.slice(last))).replace(/\n/g, '<br>');
}

/**
 * The email's HTML and plain text, from cleaned blocks.
 * @param {{ blocks: any[], files: { name: string, inline: boolean }[], club: string, label?: string, sender: string, replyTo: string, test: boolean }} m
 */
export function renderMail(m) {
  const font = "font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
  const html = [];
  const text = [];
  for (const b of m.blocks) {
    if (b.t === 'h') { html.push(`<h2 style="font-size:18px;margin:22px 0 8px">${esc(b.text)}</h2>`); text.push(b.text.toUpperCase()); }
    else if (b.t === 'p') { html.push(`<p style="margin:0 0 14px">${linked(b.text)}</p>`); text.push(b.text); }
    else if (b.t === 'ul') { html.push(`<ul style="margin:0 0 14px;padding-left:22px">${b.items.map((/** @type {string} */ i) => `<li style="margin:0 0 4px">${linked(i)}</li>`).join('')}</ul>`); text.push(b.items.map((/** @type {string} */ i) => `- ${i}`).join('\n')); }
    else if (b.t === 'img' && m.files[b.file]?.inline) html.push(`<p style="margin:0 0 14px"><img src="cid:f${b.file}" alt="${esc(m.files[b.file].name)}" style="max-width:100%;height:auto;border:0"></p>`);
  }
  const foot = `Sent by ${m.sender} for ${m.label || clubName(m.club)}, Kennebec Valley Baptist Church Awana. Reply to this email to reach ${m.sender}.`;
  const note = m.test ? 'TEST: only you received this. Parents have not been sent anything.' : '';
  return {
    html: `<div style="${font};color:#231F20;font-size:16px;line-height:1.5;max-width:640px">`
      + (note ? `<p style="margin:0 0 14px;padding:8px 12px;background:#FFF3C4">${note}</p>` : '')
      + html.join('')
      + `<p style="margin:26px 0 0;padding-top:12px;border-top:1px solid #D9D4CC;font-size:13px;color:#6B655E">${esc(foot)}</p></div>`,
    text: `${note ? `${note}\n\n` : ''}${text.join('\n\n')}\n\n${foot}\n`,
  };
}

/**
 * The parents' addresses of each club, from the parsed roster export.
 * @param {{ header: string[], rows: string[][] }} roster
 * @returns {Record<string, { emails: string[], kids: number, noEmail: number }>}
 */
export function recipientsByClub(roster) {
  const keys = roster.header.map((h) => String(h || '').toLowerCase().replace(/[_\s]+/g, ' ').trim());
  const col = (/** @type {string} */ k) => keys.indexOf(k);
  const club = col('club'), inactive = col('inactive'), cols = [col('email'), col('alt email')].filter((i) => i >= 0);
  /** @type {Record<string, { set: Set<string>, kids: number, noEmail: number }>} */
  const by = {};
  for (const id of CLUB_IDS) by[id] = { set: new Set(), kids: 0, noEmail: 0 };
  if (club >= 0) {
    for (const row of roster.rows) {
      if (inactive >= 0 && String(row[inactive] || '').trim()) continue;
      const hit = by[clubIdByAlias(String(row[club] || ''))];
      if (!hit) continue;
      hit.kids += 1;
      let any = false;
      for (const i of cols) {
        for (const raw of String(row[i] || '').split(/[\s,;]+/)) {
          const e = cleanEmail(raw);
          if (e) { hit.set.add(e); any = true; }
        }
      }
      if (!any) hit.noEmail += 1;
    }
  }
  /** @type {Record<string, { emails: string[], kids: number, noEmail: number }>} */
  const out = {};
  for (const id of CLUB_IDS) out[id] = { emails: [...by[id].set].sort(), kids: by[id].kids, noEmail: by[id].noEmail };
  return out;
}

export class ClubMail {
  /**
   * @param {{ storage: any, now: () => number, env: () => Record<string, any>, fetchFn: typeof fetch,
   *   client: () => any, log?: (line: string) => void,
   *   alarms?: () => ({ set(atMs: number): any, get(): any } | undefined) }} deps
   */
  constructor({ storage, now, env, fetchFn, client, log, alarms }) {
    this.alarms = alarms || (() => undefined);
    this.storage = storage;
    this.now = now;
    this.env = env;
    this.fetchFn = fetchFn;
    this.client = client;
    this.log = log || (() => {});
    /** @type {{ token: string, until: number }|null} */
    this.graphToken = null;
    /** @type {{ at: number, by: ReturnType<typeof recipientsByClub> }|null} The addresses: MEMORY ONLY. */
    this.roster = null;
    /** @type {{ ip: string, at: number }[]} */
    this.codeFails = [];
    /** @type {Map<string, { at: number, bounced: number }>} How many came back, per send: memory only. */
    this.bounces = new Map();
  }

  from() { return cleanEmail(this.env()?.MAIL_FROM) || MAIL_FROM_DEFAULT; }
  /** The mailbox one club's messages are sent from: its own (MAIL_FROM_CLUBS), else the Awana one. @param {string} club */
  fromFor(club) { return clubMailboxes(this.env()?.MAIL_FROM_CLUBS)[club] || this.from(); }
  /** May this sender write to that club ("all" needs more than one club)? @param {any} who @param {string} club */
  mayWrite(who, club) { return club === MAIL_ALL ? who.clubs.length > 1 : who.clubs.includes(club); }
  /** The club in words; "all" is every club for the office, the sender's own clubs otherwise. @param {any} who @param {string} club */
  clubLabel(who, club) {
    if (club !== MAIL_ALL) return clubName(club);
    return who.office ? 'all clubs' : who.clubs.map(clubName).join(' and ');
  }
  /**
   * Who one message goes to: the club's parents, or for "all" every one of the sender's
   * clubs' parents, each address once.
   * @param {ReturnType<typeof recipientsByClub>} by @param {any} who @param {string} club
   */
  addressesOf(by, who, club) {
    if (club !== MAIL_ALL) return by[club];
    const set = new Set();
    let kids = 0, noEmail = 0;
    for (const c of who.clubs) { for (const e of by[c].emails) set.add(e); kids += by[c].kids; noEmail += by[c].noEmail; }
    return { emails: [...set].sort(), kids, noEmail };
  }
  configured() { const e = this.env() || {}; return Boolean(e.MS_TENANT_ID && e.MS_CLIENT_ID && e.MS_CLIENT_SECRET); }

  // ── directors ───────────────────────────────────────────────────────────────

  /** @returns {Promise<{ rev: number, list: any[] }>} */
  async directors() {
    const d = await this.storage.get(DIRECTORS_KEY);
    return d && Array.isArray(d.list) ? d : { rev: 0, list: [] };
  }

  /** A director as a page may see one (never the code's hash). @param {any} d */
  pub(d) { return { id: d.id, name: d.name, replyTo: d.replyTo, clubs: d.clubs, at: new Date(d.at).toISOString() }; }

  async tokens() { return (await this.storage.get(TOKENS_KEY)) || {}; }

  /** Every token of one director is forgotten. @param {string} id */
  async dropTokens(id) {
    const t = await this.tokens();
    for (const k of Object.keys(t)) if (t[k].d === id) delete t[k];
    await this.storage.put(TOKENS_KEY, t);
  }

  /** GET /v1/mail/directors (the office). */
  async list() {
    const d = await this.directors();
    return json({ ok: true, ready: this.configured(), from: this.from(), clubs: CLUB_TABLE.map((c) => ({ id: c.id, name: c.name })), directors: d.list.map((x) => this.pub(x)) });
  }

  /**
   * Mail a director their code, and tell the mailbox a login was made.
   * @param {any} d @param {string} code
   */
  async mailCode(d, code) {
    const clubs = d.clubs.map(clubName).join(', ');
    const r = await this.graph('POST', `/users/${encodeURIComponent(this.from())}/sendMail`, {
      saveToSentItems: false,   // the code is not left in the shared mailbox
      message: {
        subject: 'Your Awana club email login',
        body: { contentType: 'text', content: `${d.name},\n\nYou can now email the parents of ${clubs} from the Awana account.\n\nPage: https://awana.kvbchurch.org/tools/email/\nYour code: ${code}\n\nThe code is yours alone: please don't share it. Parents' replies come to this address (${d.replyTo}).\n\nKVBC Awana\n` },
        toRecipients: [{ emailAddress: { address: d.replyTo, name: d.name } }],
      },
    });
    if (!r.ok) return r;
    // The notice carries no code. Best effort: a login that was mailed stands.
    await this.graph('POST', `/users/${encodeURIComponent(this.from())}/sendMail`, {
      message: {
        subject: `Club email: a login was made for ${d.name}`,
        body: { contentType: 'text', content: `A club email login was made or renewed on awana.kvbchurch.org/tools/email.\n\nDirector: ${d.name}\nReplies go to: ${d.replyTo}\nClubs: ${clubs}\n\nIf you did not expect this, remove the director on that page.\n` },
        toRecipients: [{ emailAddress: { address: this.from() } }],
      },
    });
    return r;
  }

  /** POST /v1/mail/directors {name, replyTo, clubs}: add one; the code is mailed. @param {any} body */
  async add(body) {
    const name = oneLine(body?.name, 60), replyTo = cleanEmail(body?.replyTo), clubs = cleanClubs(body?.clubs);
    if (!name || !replyTo || !clubs.length) return fail('A director needs a name, an email address and at least one club.', 400, { reason: 'bad-director' });
    const doc = await this.directors();
    if (doc.list.length >= MAIL_DIRECTORS_MAX) return fail('That is the most directors this page keeps.', 409, { reason: 'full' });
    if (doc.list.some((x) => x.replyTo === replyTo)) return fail('A director with that email address is already on the list.', 409, { reason: 'exists' });
    const code = newCode();
    const d = { id: newId(), name, replyTo, clubs, code: await sha256Hex(normalCode(code)), at: this.now() };
    const sent = await this.mailCode(d, code);
    if (!sent.ok) return this.graphFailed(sent);
    const now = await this.directors();
    now.list.push(d);
    now.rev += 1;
    await this.storage.put(DIRECTORS_KEY, now);
    return json({ ok: true, director: this.pub(d) });
  }

  /** PUT /v1/mail/directors/:id {name?, clubs?}: the address never changes (remove and add). @param {string} id @param {any} body */
  async change(id, body) {
    const doc = await this.directors();
    const d = doc.list.find((x) => x.id === id);
    if (!d) return fail('There is no director by that name.', 404, { reason: 'no-director' });
    const name = body?.name === undefined ? d.name : oneLine(body.name, 60);
    const clubs = body?.clubs === undefined ? d.clubs : cleanClubs(body.clubs);
    if (!name || !clubs.length) return fail('A director needs a name and at least one club.', 400, { reason: 'bad-director' });
    d.name = name; d.clubs = clubs; doc.rev += 1;
    await this.storage.put(DIRECTORS_KEY, doc);
    return json({ ok: true, director: this.pub(d) });
  }

  /** POST /v1/mail/directors/:id/code: a new code is mailed; the old one and every sign-in stop. @param {string} id */
  async recode(id) {
    const doc = await this.directors();
    const d = doc.list.find((x) => x.id === id);
    if (!d) return fail('There is no director by that name.', 404, { reason: 'no-director' });
    const code = newCode();
    const sent = await this.mailCode(d, code);
    if (!sent.ok) return this.graphFailed(sent);
    d.code = await sha256Hex(normalCode(code));
    doc.rev += 1;
    await this.storage.put(DIRECTORS_KEY, doc);
    await this.dropTokens(id);
    return json({ ok: true });
  }

  /** DELETE /v1/mail/directors/:id @param {string} id */
  async remove(id) {
    const doc = await this.directors();
    const before = doc.list.length;
    doc.list = doc.list.filter((x) => x.id !== id);
    if (doc.list.length !== before) { doc.rev += 1; await this.storage.put(DIRECTORS_KEY, doc); }
    await this.dropTokens(id);
    await this.dropDraft(await this.storage.get(draftKey(id)));
    for (const x of await this.laterList()) if (x.who === id) await this.dropLater(x.id);
    return json({ ok: true });
  }

  // ── the owner ──────────────────────────────────────────────────────────────

  /**
   * The owner's code on this request (beside the church session, which the route
   * checks). Wrong codes share the directors' guess limit.
   * @param {Request} request @param {string} ip
   * @returns {'ok'|'unset'|'bad'|'locked'}
   */
  ownerCheck(request, ip) {
    const want = String(this.env()?.MAIL_OWNER_CODE || '');
    if (want.length < OWNER_CODE_MIN) return 'unset';
    const got = (request.headers.get('X-Mail-Owner') || '').trim();
    if (!got) return 'bad';
    const t = this.now();
    this.codeFails = this.codeFails.filter((f) => t - f.at < CODE_WINDOW_MS);
    if (this.codeFails.length >= CODE_FAILS_ALL || this.codeFails.filter((f) => f.ip === ip).length >= CODE_FAILS_IP) return 'locked';
    if (safeEqual(got, want)) return 'ok';
    this.codeFails.push({ ip, at: t });
    return 'bad';
  }

  // ── signing in ──────────────────────────────────────────────────────────────

  /** POST /v1/mail/login {code} @param {any} body @param {string} ip */
  async login(body, ip) {
    const t = this.now();
    this.codeFails = this.codeFails.filter((f) => t - f.at < CODE_WINDOW_MS);
    if (this.codeFails.length >= CODE_FAILS_ALL || this.codeFails.filter((f) => f.ip === ip).length >= CODE_FAILS_IP) {
      return fail('Too many wrong codes. Wait ten minutes and try again.', 429, { reason: 'locked' });
    }
    // The slot is taken before any await, so guesses made at once all count.
    const slot = { ip, at: t };
    this.codeFails.push(slot);
    const code = normalCode(body?.code);
    const hash = code.length === 12 ? await sha256Hex(code) : '';
    const doc = await this.directors();
    let hit = null;
    for (const d of doc.list) if (hash && safeEqual(d.code, hash)) hit = d;
    if (!hit) return fail('That code is not right.', 401, { reason: 'bad-code' });
    this.codeFails = this.codeFails.filter((f) => f !== slot);
    const token = toBase64Url(randomBytes(32));
    const tokens = await this.tokens();
    for (const k of Object.keys(tokens)) if (t - tokens[k].at > MAIL_TOKEN_MS) delete tokens[k];
    tokens[await sha256Hex(token)] = { d: hit.id, at: t };
    await this.storage.put(TOKENS_KEY, tokens);
    return json({ ok: true, token, name: hit.name });
  }

  /**
   * Who is asking: a director by token, or the owner (church session + owner's code).
   * @param {Request} request @param {() => Promise<boolean>} sessionOk @param {string} ip
   * @returns {Promise<{ id: string, name: string, replyTo: string, clubs: string[], office: boolean } | null>}
   */
  async who(request, sessionOk, ip) {
    const token = (request.headers.get('X-Mail-Token') || '').trim();
    if (token) {
      const row = (await this.tokens())[await sha256Hex(token)];
      if (!row || this.now() - row.at > MAIL_TOKEN_MS) return null;
      const d = (await this.directors()).list.find((x) => x.id === row.d);
      return d ? { id: d.id, name: d.name, replyTo: d.replyTo, clubs: d.clubs, office: false } : null;
    }
    if (request.headers.get('X-Mail-Owner') && (await sessionOk()) && this.ownerCheck(request, ip) === 'ok') return { id: 'office', name: 'The Awana office', replyTo: this.from(), clubs: CLUB_IDS.slice(), office: true };
    return null;
  }

  /** POST /v1/mail/logout @param {Request} request */
  async logout(request) {
    const token = (request.headers.get('X-Mail-Token') || '').trim();
    if (token) {
      const tokens = await this.tokens();
      delete tokens[await sha256Hex(token)];
      await this.storage.put(TOKENS_KEY, tokens);
    }
    return json({ ok: true });
  }

  // ── Microsoft Graph ─────────────────────────────────────────────────────────

  /** An app token (client credentials), kept in memory until shortly before it ends. */
  async token() {
    const t = this.now();
    if (this.graphToken && this.graphToken.until > t) return this.graphToken.token;
    const e = this.env();
    let res;
    try {
      res = await this.fetchFn(`https://login.microsoftonline.com/${encodeURIComponent(e.MS_TENANT_ID)}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: String(e.MS_CLIENT_ID), client_secret: String(e.MS_CLIENT_SECRET), scope: 'https://graph.microsoft.com/.default' }).toString(),
      });
    } catch { return ''; }
    if (!res.ok) { this.log(`[mail] Microsoft refused the app sign-in (${res.status})`); return ''; }
    const body = await res.json().catch(() => null);
    if (!body?.access_token) return '';
    this.graphToken = { token: String(body.access_token), until: t + Math.max(60, Number(body.expires_in) - 300 || 0) * 1000 };
    return this.graphToken.token;
  }

  /**
   * One Graph call. `ok: false, status: 0` = no answer (the outcome is not known).
   * @param {string} method @param {string} path @param {unknown} [body]
   * @returns {Promise<{ ok: boolean, status: number, body: any }>}
   */
  async graph(method, path, body) {
    const token = await this.token();
    if (!token) return { ok: false, status: 401, body: null };
    let res;
    try {
      res = await this.fetchFn(`${GRAPH}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch { return { ok: false, status: 0, body: null }; }
    if (res.status === 401) this.graphToken = null;
    const parsed = res.status === 202 || res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) this.log(`[mail] Microsoft answered ${res.status} to ${method} ${path.replace(/\/messages\/[^/]+/, '/messages/…').replace(/users\/[^/]+/, 'users/…')}`);
    return { ok: res.ok, status: res.status, body: parsed };
  }

  /** @param {{ status: number }} r */
  graphFailed(r) {
    if (r.status === 401 || r.status === 403) return fail('Microsoft refused. The app that sends as the Awana mailbox may have expired or lost its permission (worker/README.md).', 502, { reason: 'graph-auth', status: r.status });
    return fail('Microsoft did not take that. Try again in a minute.', 502, { reason: 'graph', status: r.status });
  }

  // ── the parents ─────────────────────────────────────────────────────────────

  /** The clubs' addresses, read now unless a read from the last few minutes is in memory. */
  async readRoster() {
    const t = this.now();
    if (this.roster && t - this.roster.at < ROSTER_FRESH_MS) return { ok: /** @type {const} */ (true), by: this.roster.by };
    const client = this.client();
    if (!client) return { ok: /** @type {const} */ (false), error: 'cloud-off' };
    const res = await client.rosterCsv({ kind: 'roster-csv' });
    if (!res.ok) return { ok: /** @type {const} */ (false), error: String(res.error || 'roster') };
    this.roster = { at: this.now(), by: recipientsByClub(res.roster) };
    return { ok: /** @type {const} */ (true), by: this.roster.by };
  }

  /** @param {string} error */
  rosterFailed(error) {
    const busy = error === 'read-busy';
    return fail(busy ? 'TwoTimTwo is busy. Try again in a few seconds.' : 'The parents\' addresses could not be read from TwoTimTwo just now. Try again in a minute.', busy ? 503 : 502, { reason: busy ? 'read-busy' : 'roster', error });
  }

  /** GET /v1/mail/recipients?club=: counts only, never an address. @param {any} who @param {string} club */
  async recipients(who, club) {
    if (!this.mayWrite(who, club)) return fail('That is not one of your clubs.', 403, { reason: 'not-your-club' });
    const r = await this.readRoster();
    if (!r.ok) return this.rosterFailed(r.error);
    const c = this.addressesOf(r.by, who, club);
    return json({ ok: true, club, name: this.clubLabel(who, club), addresses: c.emails.length, kids: c.kids, kidsWithoutEmail: c.noEmail });
  }

  // ── a message ───────────────────────────────────────────────────────────────

  /** @param {any} who */
  me(who) {
    return json({
      ok: true, ready: this.configured(), name: who.name, replyTo: who.replyTo, office: who.office, from: this.from(),
      clubs: who.clubs.map((/** @type {string} */ id) => ({ id, name: clubName(id), from: this.fromFor(id) })),
      // Every club at once, for a sender with more than one.
      all: who.clubs.length > 1 ? { id: MAIL_ALL, name: who.office ? 'All clubs' : 'All my clubs', label: this.clubLabel(who, MAIL_ALL), from: this.fromFor(MAIL_ALL) } : null,
      limits: { totalBytes: MAIL_TOTAL_BYTES, files: MAIL_FILES_MAX, subject: MAIL_SUBJECT_MAX, text: MAIL_TEXT_MAX, part: MAIL_PART, smallBytes: MAIL_SMALL_BYTES },
    });
  }

  /** @param {any} draft */
  async dropDraft(draft) {
    if (!draft) return;
    for (let f = 0; f < draft.files.length; f += 1) for (let n = 0; n < draft.files[f].parts; n += 1) await this.storage.delete(partKey(draft.id, f, n));
    const now = await this.storage.get(draftKey(draft.who));
    if (now && now.id === draft.id) await this.storage.delete(draftKey(draft.who));
  }

  /** The draft a director is on (an old one is deleted). @param {string} whoId @param {string} [id] */
  async draft(whoId, id) {
    const d = await this.storage.get(draftKey(whoId));
    if (d && this.now() - d.at > MAIL_DRAFT_TTL_MS) { await this.dropDraft(d); return null; }
    return d && (!id || d.id === id) ? d : null;
  }

  /** POST /v1/mail/drafts {club, subject, blocks, files}: a new message (it replaces the last). @param {any} who @param {any} body */
  async start(who, body) {
    const club = body?.club === MAIL_ALL ? MAIL_ALL : clubIdByAlias(String(body?.club ?? ''));
    if (!this.mayWrite(who, club)) return fail('That is not one of your clubs.', 403, { reason: 'not-your-club' });
    const subject = oneLine(body?.subject, MAIL_SUBJECT_MAX);
    if (!subject) return fail('The email needs a subject.', 400, { reason: 'subject' });
    const raw = Array.isArray(body?.files) ? body.files : [];
    if (raw.length > MAIL_FILES_MAX) return fail(`An email takes at most ${MAIL_FILES_MAX} pictures and files.`, 400, { reason: 'files' });
    let total = 0;
    const files = [];
    for (const f of raw) {
      const size = Number(f?.size), type = String(f?.type || '').toLowerCase();
      if (!Number.isInteger(size) || size < 1) return fail('One of the files is empty.', 400, { reason: 'file-size' });
      if (!FILE_TYPES.test(type)) return fail('One of the files is a kind this page does not send. Pictures, PDFs and Office files are fine.', 400, { reason: 'file-type' });
      total += size;
      const small = size < MAIL_SMALL_BYTES;
      const units = small ? Math.ceil(size / 3) * 4 : size;   // base64 chars, or bytes
      files.push({ name: cleanFileName(f?.name), type, size, inline: Boolean(f?.inline) && INLINE_TYPES.test(type), enc: small ? 'b64' : 'raw', units, parts: Math.ceil(units / MAIL_PART), next: 0 });
    }
    if (total > MAIL_TOTAL_BYTES) return fail(`The pictures and files are over ${Math.round(MAIL_TOTAL_BYTES / 1048576)} MB together.`, 400, { reason: 'too-big' });
    const blocks = cleanBlocks(body?.blocks, files.length);
    if (!blocks || !blocks.some((b) => b.t !== 'img')) return fail('The email needs some words.', 400, { reason: 'empty' });
    // A picture nobody placed is an ordinary attachment.
    files.forEach((f, i) => { if (f.inline && !blocks.some((b) => b.t === 'img' && b.file === i)) f.inline = false; });
    await this.dropDraft(await this.storage.get(draftKey(who.id)));
    const draft = { id: newId(), who: who.id, club, subject, blocks, files, at: this.now(), run: null, sent: null };
    await this.storage.put(draftKey(who.id), draft);
    return json({ ok: true, id: draft.id, part: MAIL_PART, files: files.map((f) => ({ enc: f.enc, parts: f.parts })) });
  }

  /** PUT /v1/mail/drafts/:id/files/:f/:n: one piece. @param {any} who @param {string} id @param {string} f @param {string} n @param {Request} request */
  async part(who, id, f, n, request) {
    const draft = await this.draft(who.id, id);
    const fi = Number(f), i = Number(n);
    const file = draft && Number.isInteger(fi) ? draft.files[fi] : null;
    if (!draft || !file || draft.run) return fail('There is no email by that name.', 404, { reason: 'no-draft' });
    if (!Number.isInteger(i) || i < 0 || i >= file.parts || i > file.next || i < file.next - 1) return fail('That part is out of order.', 409, { reason: 'order', next: file.next });
    const want = i === file.parts - 1 ? file.units - i * MAIL_PART : MAIL_PART;
    let value;
    if (file.enc === 'b64') {
      value = await request.text();
      if (value.length !== want || !B64_RE.test(value) || (i < file.parts - 1 && value.includes('='))) return fail('That part is the wrong size.', 400, { reason: 'size' });
    } else {
      value = new Uint8Array(await request.arrayBuffer());
      if (value.length !== want) return fail('That part is the wrong size.', 400, { reason: 'size' });
    }
    await this.storage.put(partKey(draft.id, fi, i), value);
    if (i === file.next) { file.next = i + 1; await this.storage.put(draftKey(who.id), draft); }
    return json({ ok: true, next: file.next });
  }

  async sendLog() { const l = await this.storage.get(LOG_KEY); return Array.isArray(l) ? l : []; }

  /**
   * POST /v1/mail/drafts/:id/send {test}: begin sending. A test goes to the sender
   * alone. Nothing is sent yet: the page calls /step until it is done.
   * @param {any} who @param {string} id @param {any} body
   */
  async begin(who, id, body) {
    const draft = await this.draft(who.id, id);
    if (!draft) return fail('There is no email by that name.', 404, { reason: 'no-draft' });
    if (draft.sent) return fail('That email was already sent.', 409, { reason: 'sent' });
    if (draft.run && draft.run.stage !== 'failed') return fail('That email is already on its way.', 409, { reason: 'running' });
    if (draft.files.some((/** @type {any} */ f) => f.next !== f.parts)) return fail('Part of a file did not arrive. Try again.', 400, { reason: 'parts' });
    const test = Boolean(body?.test);
    if (!test) {
      const day = this.now() - 24 * 60 * 60 * 1000;
      const mine = (await this.sendLog()).filter((l) => l.who === who.id && l.at > day).length;
      if (mine >= MAIL_SENDS_PER_DAY) return fail(`That is ${MAIL_SENDS_PER_DAY} emails in a day, the most this page sends. Try again tomorrow.`, 429, { reason: 'daily-limit' });
    }
    draft.run = { test, stage: 'draft', graphId: '', file: 0, offset: 0, uploadUrl: '', count: 0, batch: 0, batches: 1, done: 0 };
    await this.storage.put(draftKey(who.id), draft);
    return json({ ok: true, ...this.progress(draft) });
  }

  /** @param {any} draft */
  progress(draft) {
    const run = draft.run;
    // One message's work: its draft, each file's parts, its send. A long list is several messages.
    const each = draft.files.reduce((/** @type {number} */ a, /** @type {any} */ f) => a + f.parts, 0) + 2;
    const total = each * Math.max(1, run.batches || 1);
    const here = run.stage === 'draft' ? 0
      : 1 + draft.files.slice(0, run.file).reduce((/** @type {number} */ a, /** @type {any} */ f) => a + f.parts, 0) + (run.stage === 'files' ? run.offset : 0);
    const done = run.stage === 'sent' ? total : each * (run.batch || 0) + here;
    return { stage: run.stage, test: run.test, done: run.stage === 'sent', percent: Math.min(100, Math.round((100 * done) / total)), recipients: run.count };
  }

  /**
   * POST /v1/mail/drafts/:id/step: ONE piece of work, then the progress.
   * Stages: draft -> files -> send -> sent; `unknown` when the send had no answer.
   * @param {any} who @param {string} id @param {{ draft: any, save: () => Promise<any> }} [held]
   */
  async step(who, id, held) {
    // `held`: a message waiting for its time (send later), walked by the alarm, kept under its own key.
    const draft = held ? held.draft : await this.draft(who.id, id);
    const run = draft?.run;
    if (!draft || !run) return fail('There is no email on its way by that name.', 404, { reason: 'no-run' });
    const save = held ? held.save : () => this.storage.put(draftKey(who.id), draft);
    // The club's own mailbox when it has one: the same answer at every step of one message.
    const base = `/users/${encodeURIComponent(this.fromFor(draft.club))}`;
    if (run.stage === 'sent' || run.stage === 'unknown') return json({ ok: true, ...this.progress(draft) });

    if (run.stage === 'draft') {
      /** @type {string[]} */
      let bcc = [];
      if (!run.test) {
        const r = await this.readRoster();
        if (!r.ok) return this.rosterFailed(r.error);
        if (!this.mayWrite(who, draft.club)) return fail('That is not one of your clubs.', 403, { reason: 'not-your-club' });
        const all = this.addressesOf(r.by, who, draft.club).emails.filter((e) => e !== who.replyTo);
        if (!all.length) return fail('TwoTimTwo has no parent email address for that club.', 409, { reason: 'no-recipients' });
        // More than one message takes: this message's share of the list (the list in order).
        run.batches = Math.max(run.batches || 1, (run.batch || 0) + 1, Math.ceil(all.length / MAIL_RECIPIENTS_MAX));
        bcc = all.slice((run.batch || 0) * MAIL_RECIPIENTS_MAX, ((run.batch || 0) + 1) * MAIL_RECIPIENTS_MAX);
      }
      const m = renderMail({ blocks: draft.blocks, files: draft.files, club: draft.club, label: this.clubLabel(who, draft.club), sender: who.name, replyTo: who.replyTo, test: run.test });
      const person = { emailAddress: { address: who.replyTo, name: who.name } };
      // The Awana mailbox gets a copy of every real send (owner 2026-11-14: "copy the Awana
      // email on every message sent through this"): BCC, unless it is already the To.
      const copy = this.from();
      const hidden = !run.test && !(run.batch > 0) && copy !== who.replyTo && !bcc.includes(copy) ? [...bcc, copy] : bcc;
      const r = await this.graph('POST', `${base}/messages`, {
        subject: `${run.test ? '[Test] ' : ''}${draft.subject}`,
        body: { contentType: 'html', content: m.html },
        toRecipients: [person],
        replyTo: [person],
        bccRecipients: hidden.map((address) => ({ emailAddress: { address } })),
      });
      if (!r.ok || !r.body?.id) return this.graphFailed(r);
      run.graphId = String(r.body.id);
      run.count = (run.done || 0) + bcc.length;
      run.stage = draft.files.length ? 'files' : 'send';
      await save();
      return json({ ok: true, ...this.progress(draft) });
    }

    const msg = `${base}/messages/${encodeURIComponent(run.graphId)}`;
    if (run.stage === 'files') {
      const f = draft.files[run.file];
      const meta = { name: f.name, contentType: f.type, isInline: f.inline, ...(f.inline ? { contentId: `f${run.file}` } : {}) };
      if (f.enc === 'b64') {
        let b64 = '';
        for (let n = 0; n < f.parts; n += 1) b64 += await this.storage.get(partKey(draft.id, run.file, n));
        const r = await this.graph('POST', `${msg}/attachments`, { '@odata.type': '#microsoft.graph.fileAttachment', ...meta, contentBytes: b64 });
        if (!r.ok) return this.graphFailed(r);
      } else {
        if (!run.uploadUrl) {
          const r = await this.graph('POST', `${msg}/attachments/createUploadSession`, { AttachmentItem: { attachmentType: 'file', size: f.size, ...meta } });
          if (!r.ok || !/^https:\/\//.test(String(r.body?.uploadUrl || ''))) return this.graphFailed(r);
          run.uploadUrl = String(r.body.uploadUrl);
          await save();
          return json({ ok: true, ...this.progress(draft) });
        }
        const last = Math.min(f.parts, run.offset + MAIL_STEP_PARTS);
        const pieces = [];
        for (let n = run.offset; n < last; n += 1) pieces.push(/** @type {Uint8Array} */ (await this.storage.get(partKey(draft.id, run.file, n))));
        const bytes = new Uint8Array(pieces.reduce((a, p) => a + p.length, 0));
        let at = 0;
        for (const p of pieces) { bytes.set(p, at); at += p.length; }
        const start = run.offset * MAIL_PART;
        let res;
        try {
          // The upload address carries its own key: no Authorization header (Microsoft's rule).
          res = await this.fetchFn(run.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${start}-${start + bytes.length - 1}/${f.size}` }, body: bytes });
        } catch { return this.graphFailed({ status: 0 }); }
        if (!res.ok) return this.graphFailed({ status: res.status });
        run.offset = last;
        if (last < f.parts) { await save(); return json({ ok: true, ...this.progress(draft) }); }
      }
      run.file += 1; run.offset = 0; run.uploadUrl = '';
      if (run.file >= draft.files.length) run.stage = 'send';
      await save();
      return json({ ok: true, ...this.progress(draft) });
    }

    // stage 'send'. Marked BEFORE Microsoft is asked: an answer that never comes is never a second send.
    run.stage = 'unknown';
    await save();
    const r = await this.graph('POST', `${msg}/send`);
    if (!r.ok && r.status !== 0) {
      run.stage = 'send';   // a definite refusal: nothing went, the step may be tried again
      await save();
      return this.graphFailed(r);
    }
    if (!r.ok) return json({ ok: true, ...this.progress(draft) });   // unknown: the page says to look in Sent Items
    run.done = run.count;
    if (!run.test && (run.batch || 0) + 1 < (run.batches || 1)) {
      // The rest of a long list: the next message, from its draft.
      Object.assign(run, { batch: (run.batch || 0) + 1, stage: 'draft', graphId: '', file: 0, offset: 0, uploadUrl: '' });
      await save();
      return json({ ok: true, ...this.progress(draft) });
    }
    run.stage = 'sent';
    if (run.test) {
      // A test leaves the message ready for the real send.
      const out = { ok: true, ...this.progress(draft) };
      draft.run = null;
      await save();
      return json(out);
    }
    draft.sent = this.now();
    await save();
    const log = await this.sendLog();
    log.unshift({ id: draft.id, at: draft.sent, who: who.id, name: who.name, club: draft.club, label: this.clubLabel(who, draft.club), subject: draft.subject, recipients: run.count, files: draft.files.length });
    // The words are kept with the log line (to start from again), and go when it does.
    await this.storage.put(bodyKey(draft.id), { blocks: draft.blocks.filter((/** @type {any} */ b) => b.t !== 'img') });
    for (const old of log.slice(MAIL_LOG_MAX)) if (old.id) await this.storage.delete(bodyKey(old.id));
    await this.storage.put(LOG_KEY, log.slice(0, MAIL_LOG_MAX));
    const out = { ok: true, ...this.progress(draft) };
    for (let fi = 0; fi < draft.files.length; fi += 1) for (let n = 0; n < draft.files[fi].parts; n += 1) await this.storage.delete(partKey(draft.id, fi, n));
    return json(out);
  }

  // ── send later ─────────────────────────────────────────────────────────────

  /** @returns {Promise<any[]>} */
  async laterList() { const l = await this.storage.get(LATER_KEY); return Array.isArray(l) ? l : []; }

  /** A waiting message is forgotten: its pieces, itself, its line. @param {string} id */
  async dropLater(id) {
    const draft = await this.storage.get(laterKey(id));
    if (draft) for (let f = 0; f < draft.files.length; f += 1) for (let n = 0; n < draft.files[f].parts; n += 1) await this.storage.delete(partKey(id, f, n));
    await this.storage.delete(laterKey(id));
    await this.storage.put(LATER_KEY, (await this.laterList()).filter((x) => x.id !== id));
  }

  /**
   * POST /v1/mail/drafts/:id/later {at}: send this draft at that time instead of now.
   * @param {any} who @param {string} id @param {any} body
   */
  async later(who, id, body) {
    const draft = await this.draft(who.id, id);
    if (!draft) return fail('There is no email by that name.', 404, { reason: 'no-draft' });
    if (draft.sent) return fail('That email was already sent.', 409, { reason: 'sent' });
    if (draft.run && draft.run.stage !== 'failed') return fail('That email is already on its way.', 409, { reason: 'running' });
    if (draft.files.some((/** @type {any} */ f) => f.next !== f.parts)) return fail('Part of a file did not arrive. Try again.', 400, { reason: 'parts' });
    const at = Date.parse(String(body?.at ?? '')), t = this.now();
    if (!Number.isFinite(at) || at < t + LATER_MIN_MS - 60 * 1000) return fail('Pick a time at least five minutes from now.', 400, { reason: 'too-soon' });
    if (at > t + LATER_MAX_MS) return fail('Pick a time within the next four weeks.', 400, { reason: 'too-far' });
    const list = await this.laterList();
    const waiting = list.filter((x) => x.state !== 'failed');
    if (waiting.filter((x) => x.who === who.id).length >= LATER_PER_SENDER) return fail(`You already have ${LATER_PER_SENDER} emails waiting to be sent. Cancel one first.`, 409, { reason: 'later-full' });
    if (waiting.length >= LATER_ALL) return fail('Too many emails are waiting to be sent. Try again after one has gone.', 409, { reason: 'later-full' });
    draft.sendAt = at;
    draft.run = { test: false, stage: 'draft', graphId: '', file: 0, offset: 0, uploadUrl: '', count: 0, batch: 0, batches: 1, done: 0 };
    await this.storage.put(laterKey(draft.id), draft);
    await this.storage.delete(draftKey(who.id));
    list.push({ id: draft.id, who: who.id, name: who.name, club: draft.club, label: this.clubLabel(who, draft.club), subject: draft.subject, files: draft.files.length, at, made: t, state: 'waiting', tries: 0, wakeAt: at, problem: '' });
    await this.storage.put(LATER_KEY, list);
    await this.arm();
    return json({ ok: true, id: draft.id, at: new Date(at).toISOString() });
  }

  /** GET /v1/mail/later: the messages waiting (the office: everyone's). @param {any} who */
  async waiting(who) {
    const list = (await this.laterList()).filter((x) => who.office || x.who === who.id).sort((a, b) => a.at - b.at);
    return json({ ok: true, later: list.map((x) => ({ id: x.id, at: new Date(x.at).toISOString(), name: x.name, club: x.club, clubName: x.label || clubName(x.club), subject: x.subject, files: x.files, state: x.state, problem: x.problem || '' })) });
  }

  /** DELETE /v1/mail/later/:id: cancel one (not once it has begun to go). @param {any} who @param {string} id */
  async cancel(who, id) {
    const x = (await this.laterList()).find((y) => y.id === id && (who.office || y.who === who.id));
    if (!x) return fail('That email is not waiting any more.', 404, { reason: 'no-later' });
    if (x.state === 'sending') return fail('That email is going out now.', 409, { reason: 'running' });
    await this.dropLater(id);
    return json({ ok: true });
  }

  /** The sender of a waiting message as they are now (the office, or a director still on the list). @param {string} id */
  async senderNow(id) {
    if (id === 'office') return { id: 'office', name: 'The Awana office', replyTo: this.from(), clubs: CLUB_IDS.slice(), office: true };
    const d = (await this.directors()).list.find((x) => x.id === id);
    return d ? { id: d.id, name: d.name, replyTo: d.replyTo, clubs: d.clubs, office: false } : null;
  }

  /** When the alarm is next wanted for a waiting message (ms), or null. */
  async wake() {
    const due = (await this.laterList()).filter((x) => x.state !== 'failed').map((x) => x.wakeAt || x.at);
    return due.length ? Math.min(...due) : null;
  }

  /** Pull the Durable Object's alarm EARLIER when a waiting message needs it sooner; never later. */
  async arm() {
    const alarms = this.alarms();
    const wake = await this.wake();
    if (!alarms || wake === null) return false;
    const t = this.now(), want = Math.max(wake, t + 1000);
    const at = await alarms.get();
    if (typeof at === 'number' && at > t && at <= want) return false;
    await alarms.set(want);
    return true;
  }

  /**
   * The alarm's part: ONE step of the waiting message that is due (the oldest first).
   * Never throws. @returns {Promise<boolean>} was there anything to do?
   */
  async tick() {
    try {
      const t = this.now();
      const list = await this.laterList();
      const x = list.filter((y) => y.state !== 'failed' && (y.wakeAt || y.at) <= t).sort((a, b) => a.at - b.at)[0];
      if (!x) return false;
      const put = () => this.storage.put(LATER_KEY, list);
      const draft = await this.storage.get(laterKey(x.id));
      const who = draft ? await this.senderNow(x.who) : null;
      /** The wait ends without a send: the pieces go, the line stays (failed) for the sender to see, and they are mailed why. */
      const giveUp = async (/** @type {string} */ why, /** @type {string} */ advice) => {
        Object.assign(x, { state: 'failed', problem: why, wakeAt: 0 });
        await put();
        if (draft) for (let f = 0; f < draft.files.length; f += 1) for (let n = 0; n < draft.files[f].parts; n += 1) await this.storage.delete(partKey(x.id, f, n));
        await this.storage.delete(laterKey(x.id));
        if (who) await this.tell(who, `Not sent: ${x.subject}`, `${who.name},\n\nThe email "${x.subject}" you set to send later was NOT sent to parents.\n\n${why}\n\n${advice}\n\nPage: https://awana.kvbchurch.org/tools/email/\n\nKVBC Awana\n`);
        return true;
      };
      if (!draft) { list.splice(list.indexOf(x), 1); await put(); return true; }
      if (!who || !this.mayWrite(who, draft.club)) return giveUp('Its sender can no longer email that club.', 'Ask the Awana director if that is a mistake.');
      if (!this.configured()) return giveUp('Sending is not set up on the service.', 'Tell the Awana director.');
      const res = await this.step(who, x.id, { draft, save: () => this.storage.put(laterKey(x.id), draft) });
      const body = await res.json().catch(() => null);
      if (res.status === 200 && body?.stage === 'unknown') {
        // Microsoft never answered the send: it may have gone. Never sent again.
        Object.assign(x, { state: 'failed', problem: 'Microsoft did not answer when it was sent, so it may or may not have gone out.', wakeAt: 0 });
        await put();
        await this.storage.delete(laterKey(x.id));
        await this.tell(who, `Check: ${x.subject}`, `${who.name},\n\nThe email "${x.subject}" you set to send later may or may not have gone out: Microsoft did not answer when it was sent.\n\nDo NOT send it again yet. Look in the Sent folder of ${this.fromFor(draft.club)} first (you were on the To line, so check your own inbox too).\n\nKVBC Awana\n`);
        return true;
      }
      if (res.status === 200 && body?.done) {
        await this.storage.delete(laterKey(x.id));
        list.splice(list.indexOf(x), 1);
        await put();
        return true;
      }
      if (res.status === 200) {
        Object.assign(x, { state: 'sending', tries: 0, wakeAt: this.now() + LATER_STEP_MS });
        await put();
        return true;
      }
      // A step that did not work. Nothing has been sent by it; some reasons never will.
      const reason = String(body?.reason || '');
      const words = String(body?.error || 'It could not be sent.');
      if (['no-recipients', 'not-your-club', 'graph-auth', 'no-run'].includes(reason)) return giveUp(words, 'Open the page to write it again.');
      x.tries = (x.tries || 0) + 1;
      if (x.tries >= LATER_TRIES) return giveUp(`${words} (It was tried ${LATER_TRIES} times.)`, 'Open the page to send it again.');
      Object.assign(x, { problem: words, wakeAt: this.now() + Math.min(LATER_RETRY_MS * x.tries, 15 * 60 * 1000) });
      await put();
      return true;
    } catch (err) {
      this.log(`[mail] a waiting email's step failed: ${String(/** @type {any} */ (err)?.message || err)}`);
      return false;
    }
  }

  /** A plain note to a sender from the Awana mailbox (send later's news). Best effort. @param {any} who @param {string} subject @param {string} content */
  async tell(who, subject, content) {
    return this.graph('POST', `/users/${encodeURIComponent(this.from())}/sendMail`, {
      message: { subject, body: { contentType: 'text', content }, toRecipients: [{ emailAddress: { address: who.replyTo, name: who.name } }] },
    });
  }

  /**
   * GET /v1/mail/log/:id: a sent message's subject and words, to start a new one from
   * (owner 2026-11-14). No picture, no file, no address.
   * @param {any} who @param {string} id
   */
  async again(who, id) {
    const line = await logLine(this, who, id);
    const body = line ? await this.storage.get(bodyKey(id)) : null;
    if (!line || !body) return fail('That email is no longer kept.', 404, { reason: 'no-send' });
    return json({ ok: true, club: line.club, subject: line.subject, blocks: body.blocks });
  }

  /**
   * GET /v1/mail/log/:id/bounces: how many of a send came back undelivered, counted in
   * the sending mailbox's inbox (Microsoft's "Undeliverable: <subject>" notices since
   * the send). A count only, never an address; `bounced: null` = not known (older than
   * a week, or Microsoft did not answer).
   * @param {any} who @param {string} id
   */
  async bounced(who, id) {
    const line = await logLine(this, who, id);
    if (!line) return fail('That email is no longer kept.', 404, { reason: 'no-send' });
    const t = this.now();
    const mailbox = this.fromFor(line.club);
    if (t - line.at > BOUNCE_LOOK_MS) return json({ ok: true, bounced: null, mailbox });
    const kept = this.bounces.get(id);
    if (kept && t - kept.at < BOUNCE_FRESH_MS) return json({ ok: true, bounced: kept.bounced, mailbox });
    const filter = `receivedDateTime ge ${new Date(line.at).toISOString()} and startswith(subject,'Undeliverable')`;
    const r = await this.graph('GET', `/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?$select=subject&$top=200&$filter=${encodeURIComponent(filter)}`);
    if (!r.ok || !Array.isArray(r.body?.value)) return json({ ok: true, bounced: null, mailbox });
    const want = `Undeliverable: ${line.subject}`;
    const bounced = r.body.value.filter((/** @type {any} */ m) => String(m?.subject || '').trim() === want).length;
    this.bounces.set(id, { at: t, bounced });
    if (this.bounces.size > MAIL_LOG_MAX) this.bounces.delete(this.bounces.keys().next().value);
    return json({ ok: true, bounced, mailbox });
  }

  /** GET /v1/mail/log: the office sees every send, a director their own. @param {any} who */
  async history(who) {
    const log = (await this.sendLog()).filter((l) => who.office || l.who === who.id);
    return json({ ok: true, sends: log.map((l) => ({ id: l.id || '', at: new Date(l.at).toISOString(), name: l.name, club: l.club, clubName: l.label || clubName(l.club), subject: l.subject, recipients: l.recipients, files: l.files })) });
  }
}

/** One line of the log the asker may see (the office every line, a director their own). @this {ClubMail} */
async function logLine(/** @type {ClubMail} */ mail, /** @type {any} */ who, /** @type {string} */ id) {
  return (await mail.sendLog()).find((l) => l.id === id && (who.office || l.who === who.id)) || null;
}

/**
 * The routes (src/routes.md 10.19). The owner's need the church session and the
 * owner's code; a sender's take a director's token (X-Mail-Token) or the owner's pair.
 * @param {import('./registry.js').Registry} registry
 * @param {any} core
 */
export function mountClubMail(registry, core) {
  const clubOf = (/** @type {string|null} */ v) => (v === MAIL_ALL ? MAIL_ALL : clubIdByAlias(v || ''));
  const m = () => /** @type {ClubMail} */ (core.clubMail);
  /** @typedef {import('./registry.js').RouteContext} Ctx */
  const ready = (/** @type {(ctx: Ctx) => Promise<Response>} */ fn) => async (/** @type {Ctx} */ ctx) => (m().configured() ? fn(ctx) : json({ ok: false, reason: 'not-configured' }, 503));
  const sender = (/** @type {(ctx: Ctx, who: any) => Promise<Response>} */ fn) => async (/** @type {Ctx} */ ctx) => {
    const who = await m().who(ctx.request, () => core.authorized(ctx.request), ctx.ip);
    if (!who) return fail('Not signed in.', 401, { reason: 'signed-out' });
    return fn(ctx, who);
  };
  // The owner's routes: the church session (the route's own auth) and the owner's code.
  const owner = (/** @type {(ctx: Ctx) => Promise<Response>} */ fn) => async (/** @type {Ctx} */ ctx) => {
    const c = m().ownerCheck(ctx.request, ctx.ip);
    if (c === 'unset') return json({ ok: false, reason: 'owner-not-set' }, 503);
    if (c === 'locked') return fail('Too many wrong codes. Wait ten minutes and try again.', 429, { reason: 'locked' });
    if (c !== 'ok') return fail('That is not the owner\'s code.', 403, { reason: 'not-owner' });
    return fn(ctx);
  };
  const draftId = (/** @type {(ctx: Ctx, who: any) => Promise<Response>} */ fn) => sender(async (ctx, who) => (ID_RE.test(ctx.params.id || '') ? fn(ctx, who) : fail('There is no email by that name.', 404, { reason: 'no-draft' })));

  registry.add('GET', '/v1/mail/directors', 'session', owner(async () => m().list()));
  registry.add('POST', '/v1/mail/directors', 'session', owner(ready(async ({ body }) => m().add(await body()))));
  registry.add('PUT', '/v1/mail/directors/:id', 'session', owner(async ({ params, body }) => m().change(params.id, await body())));
  registry.add('POST', '/v1/mail/directors/:id/code', 'session', owner(ready(async ({ params }) => m().recode(params.id))));
  registry.add('DELETE', '/v1/mail/directors/:id', 'session', owner(async ({ params }) => m().remove(params.id)));

  registry.add('POST', '/v1/mail/login', 'public', async ({ body, ip }) => m().login(await body(), ip));
  registry.add('POST', '/v1/mail/logout', 'public', async ({ request }) => m().logout(request));
  registry.add('GET', '/v1/mail/me', 'public', sender(async (_ctx, who) => m().me(who)));
  registry.add('GET', '/v1/mail/log', 'public', sender(async (_ctx, who) => m().history(who)));
  registry.add('GET', '/v1/mail/log/:id', 'public', draftId(async ({ params }, who) => m().again(who, params.id)));
  registry.add('GET', '/v1/mail/log/:id/bounces', 'public', draftId(ready(async (ctx) => m().bounced(await m().who(ctx.request, () => core.authorized(ctx.request), ctx.ip), ctx.params.id))));
  registry.add('GET', '/v1/mail/recipients', 'public', sender(async ({ url }, who) => m().recipients(who, clubOf(url.searchParams.get('club')))));
  registry.add('POST', '/v1/mail/drafts', 'public', sender(async ({ body }, who) => m().start(who, await body())));
  registry.add('PUT', '/v1/mail/drafts/:id/files/:f/:n', 'public', draftId(async ({ params, request }, who) => m().part(who, params.id, params.f, params.n, request)));
  registry.add('POST', '/v1/mail/drafts/:id/send', 'public', draftId(ready(async (ctx) => m().begin(await m().who(ctx.request, () => core.authorized(ctx.request), ctx.ip), ctx.params.id, await ctx.body()))));
  registry.add('POST', '/v1/mail/drafts/:id/later', 'public', draftId(ready(async (ctx) => m().later(await m().who(ctx.request, () => core.authorized(ctx.request), ctx.ip), ctx.params.id, await ctx.body()))));
  registry.add('GET', '/v1/mail/later', 'public', sender(async (_ctx, who) => m().waiting(who)));
  registry.add('DELETE', '/v1/mail/later/:id', 'public', draftId(async ({ params }, who) => m().cancel(who, params.id)));
  registry.add('POST', '/v1/mail/drafts/:id/step', 'public', draftId(ready(async (ctx) => m().step(await m().who(ctx.request, () => core.authorized(ctx.request), ctx.ip), ctx.params.id))));
}

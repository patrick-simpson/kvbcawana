// @ts-check
// Club email (owner 2026-11-13: "a page that lets directors send emails from the
// awana@ outlook account that goes to all parents who have a kid in that club";
// src/routes.md 10.19). The page is awana.kvbchurch.org/tools/email/.
//
// WHO. Each director has their own login (owner's choice): a code tied to their
// clubs and their own reply address. The office adds a director with the church
// session; the Worker MAILS the code to the director's address and never shows it
// on a page, and tells the awana@ mailbox a login was made. A code signs in for a
// token (X-Mail-Token, stored as a hash). The church session itself may also send
// (the office), to any club, with replies to awana@.
//
// TO WHOM. The parents' addresses come from TwoTimTwo's roster export at the
// moment of sending (the one read clock), every active child of that club, Email
// and Alt Email, each address once. They are held in memory only, a few minutes,
// and are NEVER stored, logged or answered to a page: a page gets counts.
// Parents are always BCC; the visible To is the director; Reply-To is the director.
//
// HOW. Microsoft Graph with an app registration (client credentials): secrets
// MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET; the mailbox is MAIL_FROM (default
// awana@kvbchurch.org). Without them every sending route answers 503
// `not-configured`. A message is a draft in the mailbox, its files are attached,
// then it is sent; the PAGE drives that one small step per request (`/step`), so
// no request does much work (the free plan). The step that sends is marked BEFORE
// Microsoft is asked: an answer that never came is "unknown", never sent again.
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

import { CLUB_TABLE, clubIdByAlias } from '../../shared/clubs.js';
import { randomBytes, safeEqual, toBase64Url, toHex } from './crypto.js';
import { fail, json } from './http.js';

export const MAIL_FROM_DEFAULT = 'awana@kvbchurch.org';
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

const DIRECTORS_KEY = 'mail:directors';
const TOKENS_KEY = 'mail:tokens';
const LOG_KEY = 'mail:log';
const draftKey = (/** @type {string} */ who) => `mail:draft:${who}`;
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

/** Text with its web addresses made links (https only shown as written). @param {string} text */
function linked(text) {
  return esc(text).replace(/\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)]/g, (u) => `<a href="${u}" style="color:#0B5CAD">${u}</a>`).replace(/\n/g, '<br>');
}

/**
 * The email's HTML and plain text, from cleaned blocks.
 * @param {{ blocks: any[], files: { name: string, inline: boolean }[], club: string, sender: string, replyTo: string, test: boolean }} m
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
  const foot = `Sent by ${m.sender} for ${clubName(m.club)}, Kennebec Valley Baptist Church Awana. Reply to this email to reach ${m.sender}.`;
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
   *   client: () => any, log?: (line: string) => void }} deps
   */
  constructor({ storage, now, env, fetchFn, client, log }) {
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
  }

  from() { return cleanEmail(this.env()?.MAIL_FROM) || MAIL_FROM_DEFAULT; }
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
    return json({ ok: true });
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
   * Who is asking: a director by token, or the office by the church session.
   * @param {Request} request @param {() => Promise<boolean>} sessionOk
   * @returns {Promise<{ id: string, name: string, replyTo: string, clubs: string[], office: boolean } | null>}
   */
  async who(request, sessionOk) {
    const token = (request.headers.get('X-Mail-Token') || '').trim();
    if (token) {
      const row = (await this.tokens())[await sha256Hex(token)];
      if (!row || this.now() - row.at > MAIL_TOKEN_MS) return null;
      const d = (await this.directors()).list.find((x) => x.id === row.d);
      return d ? { id: d.id, name: d.name, replyTo: d.replyTo, clubs: d.clubs, office: false } : null;
    }
    if (await sessionOk()) return { id: 'office', name: 'The Awana office', replyTo: this.from(), clubs: CLUB_IDS.slice(), office: true };
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
    if (!who.clubs.includes(club)) return fail('That is not one of your clubs.', 403, { reason: 'not-your-club' });
    const r = await this.readRoster();
    if (!r.ok) return this.rosterFailed(r.error);
    const c = r.by[club];
    return json({ ok: true, club, name: clubName(club), addresses: c.emails.length, kids: c.kids, kidsWithoutEmail: c.noEmail });
  }

  // ── a message ───────────────────────────────────────────────────────────────

  /** @param {any} who */
  me(who) {
    return json({
      ok: true, ready: this.configured(), name: who.name, replyTo: who.replyTo, office: who.office, from: this.from(),
      clubs: who.clubs.map((/** @type {string} */ id) => ({ id, name: clubName(id) })),
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
    const club = clubIdByAlias(String(body?.club ?? ''));
    if (!who.clubs.includes(club)) return fail('That is not one of your clubs.', 403, { reason: 'not-your-club' });
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
    draft.run = { test, stage: 'draft', graphId: '', file: 0, offset: 0, uploadUrl: '', count: 0 };
    await this.storage.put(draftKey(who.id), draft);
    return json({ ok: true, ...this.progress(draft) });
  }

  /** @param {any} draft */
  progress(draft) {
    const run = draft.run;
    const total = draft.files.reduce((/** @type {number} */ a, /** @type {any} */ f) => a + f.parts, 0) + 2;
    const done = run.stage === 'draft' ? 0 : run.stage === 'sent' ? total
      : 1 + draft.files.slice(0, run.file).reduce((/** @type {number} */ a, /** @type {any} */ f) => a + f.parts, 0) + (run.stage === 'files' ? run.offset : 0);
    return { stage: run.stage, test: run.test, done: run.stage === 'sent', percent: Math.min(100, Math.round((100 * done) / total)), recipients: run.count };
  }

  /**
   * POST /v1/mail/drafts/:id/step: ONE piece of work, then the progress.
   * Stages: draft -> files -> send -> sent; `unknown` when the send had no answer.
   * @param {any} who @param {string} id
   */
  async step(who, id) {
    const draft = await this.draft(who.id, id);
    const run = draft?.run;
    if (!draft || !run) return fail('There is no email on its way by that name.', 404, { reason: 'no-run' });
    const save = () => this.storage.put(draftKey(who.id), draft);
    const base = `/users/${encodeURIComponent(this.from())}`;
    if (run.stage === 'sent' || run.stage === 'unknown') return json({ ok: true, ...this.progress(draft) });

    if (run.stage === 'draft') {
      /** @type {string[]} */
      let bcc = [];
      if (!run.test) {
        const r = await this.readRoster();
        if (!r.ok) return this.rosterFailed(r.error);
        bcc = r.by[draft.club].emails.filter((e) => e !== who.replyTo).slice(0, MAIL_RECIPIENTS_MAX);
        if (!bcc.length) return fail('TwoTimTwo has no parent email address for that club.', 409, { reason: 'no-recipients' });
      }
      const m = renderMail({ blocks: draft.blocks, files: draft.files, club: draft.club, sender: who.name, replyTo: who.replyTo, test: run.test });
      const person = { emailAddress: { address: who.replyTo, name: who.name } };
      const r = await this.graph('POST', `${base}/messages`, {
        subject: `${run.test ? '[Test] ' : ''}${draft.subject}`,
        body: { contentType: 'html', content: m.html },
        toRecipients: [person],
        replyTo: [person],
        bccRecipients: bcc.map((address) => ({ emailAddress: { address } })),
      });
      if (!r.ok || !r.body?.id) return this.graphFailed(r);
      run.graphId = String(r.body.id);
      run.count = bcc.length;
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
    log.unshift({ at: draft.sent, who: who.id, name: who.name, club: draft.club, subject: draft.subject, recipients: run.count, files: draft.files.length });
    await this.storage.put(LOG_KEY, log.slice(0, MAIL_LOG_MAX));
    const out = { ok: true, ...this.progress(draft) };
    for (let fi = 0; fi < draft.files.length; fi += 1) for (let n = 0; n < draft.files[fi].parts; n += 1) await this.storage.delete(partKey(draft.id, fi, n));
    return json(out);
  }

  /** GET /v1/mail/log: the office sees every send, a director their own. @param {any} who */
  async history(who) {
    const log = (await this.sendLog()).filter((l) => who.office || l.who === who.id);
    return json({ ok: true, sends: log.map((l) => ({ at: new Date(l.at).toISOString(), name: l.name, club: l.club, clubName: clubName(l.club), subject: l.subject, recipients: l.recipients, files: l.files })) });
  }
}

/**
 * The routes (src/routes.md 10.19). The office's need the church session; a
 * sender's take a director's token (X-Mail-Token) or the church session.
 * @param {import('./registry.js').Registry} registry
 * @param {any} core
 */
export function mountClubMail(registry, core) {
  const m = () => /** @type {ClubMail} */ (core.clubMail);
  /** @typedef {import('./registry.js').RouteContext} Ctx */
  const ready = (/** @type {(ctx: Ctx) => Promise<Response>} */ fn) => async (/** @type {Ctx} */ ctx) => (m().configured() ? fn(ctx) : json({ ok: false, reason: 'not-configured' }, 503));
  const sender = (/** @type {(ctx: Ctx, who: any) => Promise<Response>} */ fn) => async (/** @type {Ctx} */ ctx) => {
    const who = await m().who(ctx.request, () => core.authorized(ctx.request));
    if (!who) return fail('Not signed in.', 401, { reason: 'signed-out' });
    return fn(ctx, who);
  };
  const draftId = (/** @type {(ctx: Ctx, who: any) => Promise<Response>} */ fn) => sender(async (ctx, who) => (ID_RE.test(ctx.params.id || '') ? fn(ctx, who) : fail('There is no email by that name.', 404, { reason: 'no-draft' })));

  registry.add('GET', '/v1/mail/directors', 'session', async () => m().list());
  registry.add('POST', '/v1/mail/directors', 'session', ready(async ({ body }) => m().add(await body())));
  registry.add('PUT', '/v1/mail/directors/:id', 'session', async ({ params, body }) => m().change(params.id, await body()));
  registry.add('POST', '/v1/mail/directors/:id/code', 'session', ready(async ({ params }) => m().recode(params.id)));
  registry.add('DELETE', '/v1/mail/directors/:id', 'session', async ({ params }) => m().remove(params.id));

  registry.add('POST', '/v1/mail/login', 'public', async ({ body, ip }) => m().login(await body(), ip));
  registry.add('POST', '/v1/mail/logout', 'public', async ({ request }) => m().logout(request));
  registry.add('GET', '/v1/mail/me', 'public', sender(async (_ctx, who) => m().me(who)));
  registry.add('GET', '/v1/mail/log', 'public', sender(async (_ctx, who) => m().history(who)));
  registry.add('GET', '/v1/mail/recipients', 'public', sender(async ({ url }, who) => m().recipients(who, clubIdByAlias(url.searchParams.get('club') || ''))));
  registry.add('POST', '/v1/mail/drafts', 'public', sender(async ({ body }, who) => m().start(who, await body())));
  registry.add('PUT', '/v1/mail/drafts/:id/files/:f/:n', 'public', draftId(async ({ params, request }, who) => m().part(who, params.id, params.f, params.n, request)));
  registry.add('POST', '/v1/mail/drafts/:id/send', 'public', draftId(ready(async (ctx) => m().begin(await m().who(ctx.request, () => core.authorized(ctx.request)), ctx.params.id, await ctx.body()))));
  registry.add('POST', '/v1/mail/drafts/:id/step', 'public', draftId(ready(async (ctx) => m().step(await m().who(ctx.request, () => core.authorized(ctx.request)), ctx.params.id))));
}

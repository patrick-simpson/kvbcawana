// The handbook check-off form, shown (routes.md 10.11; owner 2026-10-18).
//
// The owner wants TwoTimTwo's handbook check-off report (/meeting/handbook)
// printed for Cubbies, Sparks and T&T before every club night. Nobody here
// knows that page's form yet, and Claude cannot sign in to TwoTimTwo, so step
// 1 is a setup aid: GET /v1/print/handbook-form reads the page ONCE through
// the one read clock (an interactive read, readbudget.js) and answers only
// the page's FORM STRUCTURE: each form's action and method, and each control's
// tag, type, name, id, value, checked and label; a select's options. Plus the
// page's title, its final path (no query) and its h1-h3 headings.
//
// NEVER the page's other text: tables, lists and paragraphs are where
// children's names are, and none of them is looked at. A control or select
// whose name or id says it is about a child (clubber, child, kid, student,
// member, person) has its label, value and option texts withheld (`withheld:
// true`, the option count kept) and the digits in its name and id masked (N). Hidden and password values are "(hidden)".
// Everything is capped (option texts and labels 80 chars, 200 options a
// select, 300 controls a form, 20 forms) and kept in memory 10 minutes, so
// repeated presses cost no read. Nothing is stored.

import { safeEqual } from './crypto.js';
import { fail, json } from './http.js';
import { INTERACTIVE_WAIT_MS, READ_INTERVAL_MS } from './readbudget.js';
import { documentOf, isLoginPage } from './twotimtwo.js';

export const HANDBOOK_PATH = '/meeting/handbook';
/** How long one answer is kept (memory only). */
export const HANDBOOK_FORM_TTL_MS = 10 * 60 * 1000;
export const TEXT_MAX = 80;
export const OPTIONS_MAX = 200;
export const CONTROLS_MAX = 300;
export const FORMS_MAX = 20;
export const HEADINGS_MAX = 10;
/** A control about one child: its words are withheld. */
const CHILDISH_RE = /clubber|child|kid|student|member|person|people|attendee|guardian|parent/i;
const SECRET_TYPES = new Set(['hidden', 'password']);

/** @param {unknown} text @param {number} [max] */
const clip = (text, max = TEXT_MAX) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/**
 * A label's own words: its text with any control inside it (a select's
 * options, a textarea) left out.
 * @param {any} node
 */
function ownText(node) {
  let out = '';
  for (const c of node.childNodes || []) {
    if (c.nodeType === 3) out += c.textContent;
    else if (c.nodeType === 1 && !/^(SELECT|TEXTAREA|OPTION|SCRIPT|STYLE|BUTTON)$/.test(c.tagName)) out += ` ${ownText(c)} `;
  }
  return out;
}

/** @param {any} doc @param {any} el */
function labelFor(doc, el) {
  const id = el.getAttribute('id');
  if (id) {
    for (const l of doc.querySelectorAll('label')) {
      if (l.getAttribute('for') === id) return clip(ownText(l));
    }
  }
  for (let p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) {
    if (p.tagName === 'LABEL') return clip(ownText(p));
  }
  return '';
}

/** @param {any} doc @param {any} el */
function controlOf(doc, el) {
  const tag = el.tagName.toLowerCase();
  const name = clip(el.getAttribute('name') || '');
  const id = clip(el.getAttribute('id') || '');
  const childish = CHILDISH_RE.test(`${name} ${id}`);
  // A per-child control's name or id may carry its clubber id (clubber[903]): digits become N.
  /** @param {string} s */
  const mask = (s) => (childish ? s.replace(/\d+/g, 'N') : s);
  /** @type {Record<string, any>} */
  const c = { tag, name: mask(name), id: mask(id) };
  if (tag === 'select') {
    const options = [...el.querySelectorAll('option')];
    c.multiple = el.hasAttribute('multiple');
    c.optionCount = options.length;
    if (childish) {
      c.withheld = true;
    } else {
      c.label = labelFor(doc, el);
      c.options = options.slice(0, OPTIONS_MAX).map((o) => ({
        value: clip(o.hasAttribute('value') ? o.getAttribute('value') : o.textContent),
        text: clip(o.textContent),
        selected: o.hasAttribute('selected'),
      }));
      if (options.length > OPTIONS_MAX) c.optionsTruncated = true;
    }
    return c;
  }
  const type = (el.getAttribute('type') || (tag === 'button' ? 'submit' : tag === 'input' ? 'text' : '')).toLowerCase();
  if (type) c.type = type;
  if (tag === 'input' || tag === 'button') {
    if (SECRET_TYPES.has(type)) c.value = '(hidden)';
    else if (childish) c.withheld = true;
    else c.value = clip(el.getAttribute('value') || '');
  }
  if (tag === 'input' && (type === 'checkbox' || type === 'radio')) c.checked = el.hasAttribute('checked');
  if (!childish) {
    const label = tag === 'button' ? clip(ownText(el)) : labelFor(doc, el);
    if (label) c.label = label;
  } else {
    c.withheld = true;
  }
  return c;
}

/**
 * The page's forms, title, headings: nothing else (see the top of this file).
 * Pure.
 * @param {string} html
 */
export function parseHandbookForm(html) {
  const doc = documentOf(html);
  const forms = [...doc.querySelectorAll('form')];
  /** @param {any[]} els */
  const controls = (els) => els.slice(0, CONTROLS_MAX).map((el) => controlOf(doc, el));
  const all = [...doc.querySelectorAll('input, select, textarea, button')];
  const loose = all.filter((el) => !el.closest('form'));
  return {
    title: clip(doc.querySelector('title')?.textContent || '', 120),
    headings: [...doc.querySelectorAll('h1, h2, h3')].map((h) => clip(h.textContent)).filter(Boolean).slice(0, HEADINGS_MAX),
    forms: forms.slice(0, FORMS_MAX).map((f) => {
      const els = [...f.querySelectorAll('input, select, textarea, button')];
      return {
        action: clip(String(f.getAttribute('action') || '').split('?')[0], 200),
        hasQuery: String(f.getAttribute('action') || '').includes('?'),
        method: clip(f.getAttribute('method') || 'get').toLowerCase(),
        id: clip(f.getAttribute('id') || ''),
        controls: controls(els),
        ...(els.length > CONTROLS_MAX ? { controlsTruncated: els.length } : {}),
      };
    }),
    ...(forms.length > FORMS_MAX ? { formsTruncated: forms.length } : {}),
    looseControls: controls(loose),
  };
}

/** The route's memory: one answer for HANDBOOK_FORM_TTL_MS, one read at a time. */
export class HandbookForm {
  /** @param {any} core the SyncCore */
  constructor(core) {
    this.core = core;
    /** @type {{ at: number, body: any }|null} */
    this.cache = null;
    /** @type {Promise<any>|null} */
    this.inflight = null;
  }

  /** @returns {Promise<Response>} */
  async get() {
    const now = this.core.now();
    if (this.cache && now - this.cache.at < HANDBOOK_FORM_TTL_MS) return json({ ...this.cache.body, cached: true });
    const watcher = this.core.watcher;
    const client = watcher.clientFor();
    if (!client) return json({ ok: false, reason: 'not-configured' }, 503);
    if (!this.inflight) {
      this.inflight = client.page(HANDBOOK_PATH, { waitMs: INTERACTIVE_WAIT_MS, kind: 'handbook-form' });
      this.inflight.finally(() => { this.inflight = null; }).catch(() => {});
    }
    const r = await this.inflight;
    if (!r.ok) {
      if (r.error === 'read-busy') return json({ ok: false, reason: 'read-busy', retryAfterMs: r.retryAfterMs ?? READ_INTERVAL_MS }, 429);
      return json({ ok: false, reason: r.error }, 502);
    }
    if (isLoginPage(r.html) || /\/site\/login/i.test(r.path || '')) return json({ ok: false, reason: 'signed-out' }, 502);
    this.core.handbookSheets?.noteCal(r.html);
    const body = { ok: true, readAt: new Date(this.core.now()).toISOString(), path: r.path || HANDBOOK_PATH, ...parseHandbookForm(r.html) };
    this.cache = { at: this.core.now(), body };
    return json({ ...body, cached: false });
  }
}

// ── The handbook sheets (routes.md 10.12; owner 2026-10-18) ─────────────────
//
// GET /v1/print/handbook?club=cubbies|sparks|tnt[&balances=0|1] answers
// TwoTimTwo's handbook check-off report for one club, its bytes passed through
// untouched with TwoTimTwo's content type (a PDF, or the HTML page), for the
// 4 pm GitHub job (scripts/handbook-print.mjs) that emails the three sheets to
// the downstairs printer. The report names children (the owner approved full
// names on paper, 2026-10-18): its body is NEVER parsed, stored, cached or
// logged; it lives in memory for the one response only.
//
// Auth: the machine token (secret HANDBOOK_TOKEN, `Authorization: Bearer`,
// compared in constant time) or a signed-in session (so /tools can try it).
// No token secret set: 503 not-configured. Not a club night (watcher
// clubToday()): 200 {noClub: true} with no read. Reads: the form page once (its
// hidden cal_id, kept 10 minutes, memory only) then the report, both
// interactive reads on the one clock through the client's page().

/** club -> TwoTimTwo's club_id on the handbook form (read live 2026-10-18), and the owner's share balance rule. */
export const HANDBOOK_CLUBS = Object.freeze({
  cubbies: { id: '1', balances: false },
  sparks: { id: '2', balances: true },
  tnt: { id: '3', balances: true },
});
/** How long the meeting's cal_id is kept (memory only). */
export const HANDBOOK_CAL_TTL_MS = 10 * 60 * 1000;

/**
 * The form's hidden cal_id: a scan of the <input> tags only (no parse; free
 * plan CPU). '' when there is none.
 * @param {string} html
 */
export function calIdOf(html) {
  for (const m of String(html || '').matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/\bname\s*=\s*["']?cal_id["'\s>/]/i.test(tag)) continue;
    const v = /\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const id = v ? (v[1] ?? v[2] ?? v[3] ?? '') : '';
    return /^\d{1,12}$/.test(id) ? id : '';
  }
  return '';
}

export class HandbookSheets {
  /** @param {any} core the SyncCore */
  constructor(core) {
    this.core = core;
    /** @type {{ at: number, id: string }|null} */
    this.cal = null;
  }

  /** The form page was read (here or by the form route): keep its cal_id. @param {string} html */
  noteCal(html) {
    const id = calIdOf(html);
    if (id) this.cal = { at: this.core.now(), id };
    return id;
  }

  /** @param {Request} request */
  async allowed(request) {
    const token = String(this.core.rawEnv?.HANDBOOK_TOKEN || '');
    const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
    if (token && m && safeEqual(m[1].trim(), token)) return true;
    return this.core.authorized(request);
  }

  /** @param {import('./registry.js').RouteContext} ctx @returns {Promise<Response>} */
  async get(ctx) {
    if (!(await this.allowed(ctx.request))) return fail('Not signed in.', 401, { reason: 'signed-out' });
    if (!this.core.rawEnv?.HANDBOOK_TOKEN) return json({ ok: false, reason: 'not-configured' }, 503);
    const club = String(ctx.url.searchParams.get('club') || '').toLowerCase();
    const spec = Object.hasOwn(HANDBOOK_CLUBS, club) ? HANDBOOK_CLUBS[/** @type {keyof typeof HANDBOOK_CLUBS} */ (club)] : null;
    if (!spec) return json({ ok: false, reason: 'bad-club', clubs: Object.keys(HANDBOOK_CLUBS) }, 400);
    const b = ctx.url.searchParams.get('balances');
    if (b !== null && b !== '0' && b !== '1') return json({ ok: false, reason: 'bad-balances' }, 400);
    const balances = b === null ? spec.balances : b === '1';
    const watcher = this.core.watcher;
    const day = await watcher.clubToday();
    if (!day.club) return json({ ok: true, noClub: true, today: day.today, next: day.next });
    const client = watcher.clientFor();
    if (!client) return json({ ok: false, reason: 'not-configured' }, 503);

    /** @param {any} r */
    const refused = (r) => (r.error === 'read-busy'
      ? json({ ok: false, reason: 'read-busy', retryAfterMs: r.retryAfterMs ?? READ_INTERVAL_MS }, 429)
      : json({ ok: false, reason: r.error }, 502));
    let calId = this.cal && this.core.now() - this.cal.at < HANDBOOK_CAL_TTL_MS ? this.cal.id : '';
    if (!calId) {
      const f = await client.page(HANDBOOK_PATH, { waitMs: INTERACTIVE_WAIT_MS, kind: 'handbook-form' });
      if (!f.ok) return refused(f);
      if (isLoginPage(f.html) || /\/site\/login/i.test(f.path || '')) return json({ ok: false, reason: 'signed-out' }, 502);
      calId = this.noteCal(f.html);
      if (!calId) return json({ ok: false, reason: 'no-meeting' }, 502);
    }
    const q = new URLSearchParams({ cal_id: calId, club_id: spec.id });
    if (balances) q.set('print_balances', '1');
    q.set('yt0', '1');
    const r = await client.page(`${HANDBOOK_PATH}?${q}`, { waitMs: INTERACTIVE_WAIT_MS, kind: 'handbook', raw: true });
    if (!r.ok) return refused(r);
    if (isLoginPage(r.html) || /\/site\/login/i.test(r.path || '')) return json({ ok: false, reason: 'signed-out' }, 502);
    return new Response(r.bytes, {
      status: 200,
      headers: {
        'Content-Type': r.contentType || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Handbook-Club': club,
        'X-Handbook-Cal': calId,
        'X-Handbook-Balances': balances ? '1' : '0',
      },
    });
  }
}

/** @param {import('./registry.js').Registry} registry @param {any} core */
export function mountHandbook(registry, core) {
  const form = new HandbookForm(core);
  const sheets = new HandbookSheets(core);
  core.handbookForm = form;
  core.handbookSheets = sheets;
  registry.add('GET', '/v1/print/handbook-form', 'session', async () => form.get());
  // 'public' to the registry: the route checks its own two ways in (token or session).
  registry.add('GET', '/v1/print/handbook', 'public', async (ctx) => sheets.get(ctx));
}

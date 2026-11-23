// @ts-check
// A look-only peek at a TwoTimTwo page's SHAPE (owner 2026-11-23: "Yes, please
// figure out how to top up shares"). Before the Worker ever writes shares to a
// child, the form it would post must be known, not guessed. This route reads
// one allowlisted page on the one read clock and answers ONLY its structure:
// the page title, headings, table headers, and each form's action, method,
// field names (digits masked, so a clubber id never leaves), field types,
// button words and a few option words of selects that name a club, date or
// kind. NEVER a cell, a value, a name, a balance or a clubber id; nothing is
// stored or logged. It posts nothing. GET /v1/twotimtwo/shape (routes.md 10.21),
// the machine token (HANDBOOK_TOKEN, like the handbook sheets) or a session.

import { safeEqual } from './crypto.js';
import { fail, json } from './http.js';
import { documentOf, isLoginPage } from './twotimtwo.js';
import { INTERACTIVE_WAIT_MS, READ_INTERVAL_MS } from './readbudget.js';

/** The only pages it may look at: where TwoTimTwo records shares. */
export const PEEK_PATHS = Object.freeze(['/meeting/shekels', '/meeting/formClubberShekels', '/meeting/record', '/meeting/colorGroup', '/meeting/index', '/calendar/index']);
/** `sample=<key>` puts ONE real child's clubber id under that key (the Worker picks it; it is never answered). */
export const SAMPLE_KEYS = Object.freeze(['id', 'clubber_id', 'clubberId', 'recid']);
/** The only query keys passed on (a meeting, a club, a date, a tab). */
export const PEEK_KEYS = Object.freeze(['club_id', 'calendar_id', 'cal_id', 'date', 'tab']);
/** Selects whose option words are told: never one that lists children. */
const SAFE_SELECT = /club|date|cal|meeting|type|reason|kind|book|tab|sort|color/i;
const CHILD_SELECT = /clubber|child|kid|name|student|recid/i;

const squash = (/** @type {unknown} */ t) => String(t ?? '').replace(/\s+/g, ' ').trim();
/** Digits masked: `shekels[12345]` -> `shekels[#]`, so no clubber id leaves. @param {unknown} s */
export const mask = (s) => squash(s).replace(/\d+/g, '#').slice(0, 80);

/** Only a path, masked (never a query: it may carry an id). @param {unknown} href */
function pathOf(href) {
  const s = String(href ?? '').trim();
  if (!s || /^(javascript|mailto|#)/i.test(s)) return '';
  try { return mask(new URL(s, 'https://x.invalid').pathname); } catch { return ''; }
}

/** A piece of a page's script: numbers masked, and every quoted string that is not a path or a name of
 * something dropped (a script could carry a child's name in a string; a capitalised word is dropped too). @param {string} code */
export function scriptBit(code) {
  return code.replace(/(["'])((?:\\.|(?!\1).)*)\1/g, (all, q, inner) => (/^(?:[/#.][\w/#.:\-[\]]{0,40}|[a-z_][\w-]{0,30}|)$/.test(inner) ? all : `${q}…${q}`))
    .replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 400);
}

/**
 * The shape of a page: structure only, never data.
 * @param {string} html
 */
export function pageShapeOf(html) {
  const doc = documentOf(html);
  const headings = [...doc.querySelectorAll('h1, h2, h3, h4, legend')].map((h) => mask(h.textContent)).filter(Boolean).slice(0, 20);
  const tables = [...doc.querySelectorAll('table')].slice(0, 10).map((t) => ({
    headers: [...t.querySelectorAll('th')].map((th) => mask(th.textContent)).filter(Boolean).slice(0, 20),
    rows: t.querySelectorAll('tbody tr').length,
  }));
  const forms = [...doc.querySelectorAll('form')].slice(0, 10).map((f) => {
    /** @type {Map<string, {name: string, tag: string, type: string, count: number, options?: number, words?: string[]}>} */
    const fields = new Map();
    for (const el of f.querySelectorAll('input, select, textarea')) {
      const tag = el.tagName.toLowerCase();
      const type = tag === 'input' ? String(el.getAttribute('type') || 'text').toLowerCase() : tag;
      if (type === 'submit' || type === 'button') continue;
      const name = mask(el.getAttribute('name') || el.getAttribute('id') || '');
      const key = `${tag}|${type}|${name}`;
      const had = fields.get(key);
      if (had) { had.count += 1; continue; }
      /** @type {{name: string, tag: string, type: string, count: number, options?: number, words?: string[]}} */
      const field = { name, tag, type, count: 1 };
      if (tag === 'select') {
        const opts = [...el.querySelectorAll('option')];
        field.options = opts.length;
        const raw = String(el.getAttribute('name') || el.getAttribute('id') || '');
        if (SAFE_SELECT.test(raw) && !CHILD_SELECT.test(raw)) field.words = opts.slice(0, 12).map((o) => mask(o.textContent));
      }
      fields.set(key, field);
    }
    const buttons = [...f.querySelectorAll('button, input[type="submit"], input[type="button"]')]
      .map((b) => mask(b.tagName === 'BUTTON' ? b.textContent : b.getAttribute('value'))).filter(Boolean).slice(0, 10);
    return { action: pathOf(f.getAttribute('action') || ''), method: String(f.getAttribute('method') || 'get').toLowerCase(), fields: [...fields.values()].slice(0, 60), buttons };
  });
  // Where the page's own script posts (ajax), paths only.
  const posts = new Set();
  /** The script around each such path (how the page builds the call), numbers masked, quoted words dropped. */
  const around = new Set();
  for (const s of doc.querySelectorAll('script:not([src])')) {
    const text = String(s.textContent || '');
    for (const m of text.matchAll(/["'](\/(?:meeting|clubber|shekel|calendar|award)[\w/.-]*)["']/gi)) {
      posts.add(mask(m[1]));
      const at = m.index ?? 0;
      around.add(scriptBit(text.slice(Math.max(0, at - 160), at + 240)));
    }
  }
  return {
    title: mask(doc.querySelector('title')?.textContent),
    headings, tables, forms,
    scriptPaths: [...posts].slice(0, 20),
    scriptAround: [...around].slice(0, 10),
    links: [...new Set([...doc.querySelectorAll('a[href]')].map((a) => pathOf(a.getAttribute('href'))).filter((p) => /shekel|share/i.test(p)))].slice(0, 20),
  };
}

/** The machine token (HANDBOOK_TOKEN, as the handbook sheets) or a signed-in session. @param {any} core @param {Request} request */
async function allowed(core, request) {
  const token = String(core.rawEnv?.HANDBOOK_TOKEN || '');
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
  if (token && m && safeEqual(m[1].trim(), token)) return true;
  return core.authorized(request);
}

/** @param {import('./registry.js').Registry} registry @param {any} core the SyncCore */
export function mountPeek(registry, core) {
  registry.add('GET', '/v1/twotimtwo/shape', 'public', async ({ request, url }) => {
    if (!(await allowed(core, request))) return fail('Not signed in.', 401, { reason: 'signed-out' });
    const path = String(url.searchParams.get('path') || '');
    if (!PEEK_PATHS.includes(path)) return json({ ok: false, reason: 'bad-path', paths: PEEK_PATHS }, 400);
    const q = new URLSearchParams();
    for (const k of PEEK_KEYS) {
      const v = url.searchParams.get(k);
      if (v !== null && /^[\w-]{1,20}$/.test(v)) q.set(k, v);
    }
    const client = core.watcher.clientFor();
    if (!client) return json({ ok: false, reason: 'not-configured' }, 503);
    // One real child for a one-child form: the check-in page's first child, never answered.
    const sample = url.searchParams.get('sample');
    if (sample !== null) {
      if (!SAMPLE_KEYS.includes(sample)) return json({ ok: false, reason: 'bad-sample', keys: SAMPLE_KEYS }, 400);
      const c = await client.checkinPage({ waitMs: INTERACTIVE_WAIT_MS, kind: 'peek' });
      const kid = c.ok && c.page && Array.isArray(c.page.roster) ? c.page.roster[0] : null;
      if (!kid) return json({ ok: false, reason: 'no-sample', error: c.ok ? null : c.error }, 502);
      q.set(sample, String(kid.clubberId));
    }
    const r = await client.page(q.toString() ? `${path}?${q}` : path, { waitMs: INTERACTIVE_WAIT_MS, kind: 'peek' });
    if (!r.ok) return r.error === 'read-busy' ? json({ ok: false, reason: 'read-busy', retryAfterMs: r.retryAfterMs ?? READ_INTERVAL_MS }, 429) : json({ ok: false, reason: r.error }, 502);
    if (isLoginPage(r.html)) return json({ ok: false, reason: 'signed-out' }, 502);
    return json({ ok: true, path, landedOn: pathOf(r.path || ''), shape: pageShapeOf(r.html) });
  });
}

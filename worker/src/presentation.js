// @ts-check
// The presentation (owner 2026-11-01: "a new page protected by the passcode ...
// /presentation ... display on the lobby computer screen in the app the
// PowerPoint esque report ... In the other window view it should show slide
// controls"; src/routes.md 10.14).
//
// The deck is AwanaReports' congregation deck (deck/index.html, built weekly
// from the club's records). The weekly job SEALS it to history:pub before it
// leaves GitHub (scripts/presentation/publish-deck.mjs, shared/cloud-crypto.js
// sealDocument), so this Worker only ever holds ciphertext: the passphrase
// opens it in the browser, the same way /settings opens past nights.
//
// Storage:
//   pres:deck            {rev, id, night, kind, v, kid, epk, iv, chars, parts, builtAt, at}
//   pres:up              the upload in progress: the same fields + next (parts received)
//   pres:part:<rev>:<n>  one piece of the ciphertext's base64, PRES_PART_CHARS long
//                        (one stored value stays far under the 128 KiB limit)
//   pres:slide           {index, rev, at}: the slide every presentation screen shows
//
// The machine token (Worker secret PRESENTATION_TOKEN, `Authorization: Bearer`)
// uploads; a session reads the deck and moves the slide. Every screen
// (the TV window, the presenter view, a phone) polls GET /v1/presentation/state;
// last press wins.

import { safeEqual } from './crypto.js';
import { fail, json } from './http.js';

export const PRES_PART_CHARS = 96 * 1024;
/** The sealed deck may be at most this many base64 characters (a 4 MiB pad, sealed). */
export const PRES_MAX_CHARS = Math.ceil(((4 * 1048576) + 16) / 3) * 4;
export const PRES_SLIDE_MAX = 999;

const DECK_KEY = 'pres:deck';
const UP_KEY = 'pres:up';
const SLIDE_KEY = 'pres:slide';
const partKey = (/** @type {number} */ rev, /** @type {number} */ n) => `pres:part:${rev}:${n}`;

const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const NIGHT_RE = /^\d{4}-\d{2}-\d{2}$/;
const KIND_RE = /^[a-z][a-z0-9-]{0,31}$/;
const KID_RE = /^[0-9a-f]{16}$/;

/**
 * The upload's header, cleaned; null when anything is off.
 * @param {any} b
 */
export function cleanDeckHeader(b) {
  if (!b || typeof b !== 'object') return null;
  const chars = Number(b.chars);
  if (b.v !== 1 || !ID_RE.test(b.id) || !NIGHT_RE.test(b.night) || b.kind !== 'deck' || !KIND_RE.test(b.kind)) return null;
  if (!KID_RE.test(b.kid) || typeof b.epk !== 'string' || !B64_RE.test(b.epk) || b.epk.length !== 88) return null;
  if (typeof b.iv !== 'string' || !B64_RE.test(b.iv) || b.iv.length !== 16) return null;
  if (!Number.isInteger(chars) || chars < 4 || chars > PRES_MAX_CHARS || chars % 4) return null;
  const builtAt = typeof b.builtAt === 'string' && b.builtAt.length <= 40 && !Number.isNaN(Date.parse(b.builtAt)) ? b.builtAt : null;
  return { v: 1, id: b.id, night: b.night, kind: b.kind, kid: b.kid, epk: b.epk, iv: b.iv, chars, parts: Math.ceil(chars / PRES_PART_CHARS), builtAt };
}

export class Presentation {
  /** @param {{ storage: any, now: () => number, env: () => Record<string, any>, historyKid: () => Promise<string|null> }} deps */
  constructor({ storage, now, env, historyKid }) {
    this.storage = storage;
    this.now = now;
    this.env = env;
    this.historyKid = historyKid;
    /** @type {{ index: number, rev: number, at: number }|null} */
    this.slideCache = null;
    /** @type {{ rev: number, builtAt: string|null }|null|undefined} */
    this.deckCache = undefined;
  }

  /** Does the request carry the machine token? @param {Request} request */
  tokenOk(request) {
    const token = String(this.env()?.PRESENTATION_TOKEN || '');
    const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
    return Boolean(token && m && safeEqual(m[1].trim(), token));
  }

  /** GET /v1/presentation/key: history:pub, what the job seals to. */
  async key() {
    const pub = await this.storage.get('history:pub');
    if (!pub) return fail('There is no history key yet.', 404, { reason: 'no-key' });
    return json({ ok: true, pub: pub.pub, kid: pub.kid });
  }

  /** POST /v1/presentation/deck: start an upload. @param {any} body */
  async start(body) {
    const head = cleanDeckHeader(body);
    if (!head) return fail('That is not a sealed deck.', 400, { reason: 'bad-deck' });
    const kid = await this.historyKid();
    if (!kid || kid !== head.kid) return fail('The deck is not sealed to the current history key.', 409, { reason: 'wrong-key', kid });
    const deck = await this.storage.get(DECK_KEY);
    const old = await this.storage.get(UP_KEY);
    if (old) await this.dropParts(old.rev, old.parts);
    const rev = Math.max(deck?.rev || 0, old?.rev || 0) + 1;
    await this.storage.put(UP_KEY, { ...head, rev, next: 0, at: this.now() });
    return json({ ok: true, rev, parts: head.parts, partChars: PRES_PART_CHARS });
  }

  /** PUT /v1/presentation/deck/:rev/:n with one piece of the base64. @param {string} rev @param {string} n @param {Request} request */
  async part(rev, n, request) {
    const up = await this.storage.get(UP_KEY);
    const i = Number(n);
    if (!up || String(up.rev) !== rev) return fail('There is no upload by that name.', 404, { reason: 'no-upload' });
    if (!Number.isInteger(i) || i < 0 || i >= up.parts || i > up.next || i < up.next - 1) return fail('That part is out of order.', 409, { reason: 'order', next: up.next });
    const text = await request.text();
    const want = i === up.parts - 1 ? up.chars - i * PRES_PART_CHARS : PRES_PART_CHARS;
    if (text.length !== want || !B64_RE.test(text) || (i < up.parts - 1 && text.includes('='))) return fail('That part is the wrong size.', 400, { reason: 'size' });
    await this.storage.put(partKey(up.rev, i), text);
    if (i === up.next) await this.storage.put(UP_KEY, { ...up, next: i + 1 });
    return json({ ok: true, next: Math.max(up.next, i + 1) });
  }

  /** POST /v1/presentation/deck/:rev/done: every part is here; it becomes THE deck. @param {string} rev */
  async done(rev) {
    const up = await this.storage.get(UP_KEY);
    if (!up || String(up.rev) !== rev) return fail('There is no upload by that name.', 404, { reason: 'no-upload' });
    if (up.next !== up.parts) return fail('Part of the deck did not arrive. Try again.', 400, { reason: 'parts', next: up.next });
    const old = await this.storage.get(DECK_KEY);
    const deck = { ...up, at: this.now() };
    delete deck.next;
    await this.storage.put(DECK_KEY, deck);
    await this.storage.delete(UP_KEY);
    if (old && old.rev !== deck.rev) await this.dropParts(old.rev, old.parts);
    this.deckCache = { rev: deck.rev, builtAt: deck.builtAt };
    return json({ ok: true, rev: deck.rev });
  }

  /** @param {number} rev @param {number} parts */
  async dropParts(rev, parts) {
    for (let n = 0; n < (parts || 0); n += 1) await this.storage.delete(partKey(rev, n));
  }

  /** GET /v1/presentation/deck: the sealed deck as one JSON object, streamed part by part. */
  async deck() {
    const d = await this.storage.get(DECK_KEY);
    if (!d) return fail('No deck has been sent yet.', 404, { reason: 'no-deck' });
    const head = JSON.stringify({ v: d.v, id: d.id, night: d.night, kind: d.kind, kid: d.kid, epk: d.epk, iv: d.iv, rev: d.rev, builtAt: d.builtAt });
    const enc = new TextEncoder();
    const storage = this.storage;
    let n = -1;
    const body = new ReadableStream({
      async pull(controller) {
        if (n === -1) { controller.enqueue(enc.encode(`${head.slice(0, -1)},"ct":"`)); n = 0; return; }
        if (n >= d.parts) { controller.enqueue(enc.encode('"}')); controller.close(); return; }
        const part = await storage.get(partKey(d.rev, n));
        if (typeof part !== 'string') { controller.error(new Error('missing part')); return; }
        controller.enqueue(enc.encode(part));
        n += 1;
      },
    });
    return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  async slide() {
    if (!this.slideCache) {
      const s = await this.storage.get(SLIDE_KEY);
      this.slideCache = s && Number.isInteger(s.index) ? s : { index: 0, rev: 0, at: 0 };
    }
    return this.slideCache;
  }

  async deckInfo() {
    if (this.deckCache === undefined) {
      const d = await this.storage.get(DECK_KEY);
      this.deckCache = d ? { rev: d.rev, builtAt: d.builtAt || null } : null;
    }
    return this.deckCache;
  }

  /** GET /v1/presentation/state: which deck and which slide (memory after the first read). */
  async state() {
    const s = await this.slide();
    return json({ ok: true, deck: await this.deckInfo(), slide: { index: s.index, rev: s.rev, at: s.at ? new Date(s.at).toISOString() : null } });
  }

  /** POST /v1/presentation/go {index}: every presentation screen goes to that slide. @param {any} body */
  async go(body) {
    const index = Number(body?.index);
    if (!Number.isInteger(index) || index < 0 || index > PRES_SLIDE_MAX) return fail('That is not a slide.', 400, { reason: 'bad-slide' });
    const s = await this.slide();
    if (s.index !== index) {
      this.slideCache = { index, rev: s.rev + 1, at: this.now() };
      await this.storage.put(SLIDE_KEY, this.slideCache);
    }
    return this.state();
  }
}

/**
 * The routes (src/routes.md 10.14). Uploads take the machine token only; the
 * key takes the token or a session; the rest a session.
 * @param {import('./registry.js').Registry} registry
 * @param {any} core
 */
export function mountPresentation(registry, core) {
  const p = () => /** @type {Presentation} */ (core.presentation);
  const machine = (/** @type {(ctx: import('./registry.js').RouteContext) => Promise<Response>} */ fn) => async (/** @type {import('./registry.js').RouteContext} */ ctx) => {
    if (!core.rawEnv?.PRESENTATION_TOKEN) return json({ ok: false, reason: 'not-configured' }, 503);
    if (!p().tokenOk(ctx.request)) return fail('Not signed in.', 401, { reason: 'signed-out' });
    return fn(ctx);
  };
  registry.add('GET', '/v1/presentation/key', 'public', async ({ request }) => {
    if (!core.rawEnv?.PRESENTATION_TOKEN && !(await core.authorized(request))) return json({ ok: false, reason: 'not-configured' }, 503);
    if (!p().tokenOk(request) && !(await core.authorized(request))) return fail('Not signed in.', 401, { reason: 'signed-out' });
    return p().key();
  });
  registry.add('POST', '/v1/presentation/deck', 'public', machine(async ({ body }) => p().start(await body())));
  registry.add('PUT', '/v1/presentation/deck/:rev/:n', 'public', machine(async ({ params, request }) => p().part(params.rev, params.n, request)));
  registry.add('POST', '/v1/presentation/deck/:rev/done', 'public', machine(async ({ params }) => p().done(params.rev)));
  registry.add('GET', '/v1/presentation/deck', 'session', async () => p().deck());
  registry.add('GET', '/v1/presentation/state', 'session', async () => p().state());
  registry.add('POST', '/v1/presentation/go', 'session', async ({ body }) => p().go(await body()));
}

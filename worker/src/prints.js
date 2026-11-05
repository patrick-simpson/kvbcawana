// @ts-check
// Print from the letterhead page (owner 2026-11-04: "a page where I can upload a
// PDF and it will send whatever quantity I specify ... I also want to have a
// button that prints handbook sheets"; src/routes.md 10.16). The page is
// awana.kvbchurch.org/tools/print/.
//
// Printing is a GitHub Actions job (.github/workflows/letterhead-print.yml,
// handbook-print.yml) that mails a PDF to the downstairs Epson. The page cannot
// start a job itself, so the Worker starts it for a signed-in page with the
// secret PRINT_DISPATCH_TOKEN (a fine-grained GitHub token that can only run
// this repo's Actions). Without the secret every route here answers 503
// `not-configured` and the page says so.
//
// A PDF: the browser scrambles it (AES-256-GCM, a fresh random key) and uploads
// the ciphertext in PRINT_PART_CHARS pieces of base64; "send" hands the job the
// upload's id and the key as ONE dispatch input (`pdf_job` = `<id>.<key>`). The
// key passes through here in memory only, on its way to GitHub, and is never
// stored. The job reads the ciphertext with the machine token (HANDBOOK_TOKEN,
// the handbook job's) and deletes it once it has it. ONE upload at a time (a new
// one replaces it); anything left over is deleted after PRINT_TTL_MS.
//
// Storage:
//   prints:up            {id, parts, chars, name, copies, next, at, sent?}
//   prints:part:<id>:<n> one piece of the ciphertext's base64

import { safeEqual } from './crypto.js';
import { fail, json } from './http.js';

export const PRINT_PART_CHARS = 96 * 1024;
/** The largest PDF (bytes), the print job's own PDF_MAX. */
export const PRINT_PDF_MAX = 15 * 1024 * 1024;
/** Copies, the print job's own limits. */
export const PRINT_COPIES_MAX = 100;
/** An upload nobody printed is deleted after this. */
export const PRINT_TTL_MS = 60 * 60 * 1000;
/** A second handbook print within this is refused (a double tap prints twice otherwise). */
export const HANDBOOK_GAP_MS = 2 * 60 * 1000;
export const GITHUB_REPO = 'patrick-simpson/kvbcawana';
export const PDF_WORKFLOW = 'letterhead-print.yml';
export const HANDBOOK_WORKFLOW = 'handbook-print.yml';

const UP_KEY = 'prints:up';
const partKey = (/** @type {string} */ id, /** @type {number} */ n) => `prints:part:${id}:${n}`;
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const ID_RE = /^[a-z0-9]{16}$/;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
// Ciphertext = 12-byte IV + PDF + 16-byte tag, as base64.
const MAX_CHARS = Math.ceil((PRINT_PDF_MAX + 28) / 3) * 4;

/** A file name safe for a mail subject and an attachment. @param {unknown} v */
export function cleanName(v) {
  const s = String(v || '').replace(/\.pdf$/i, '').replace(/[^\w &'()-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return s || 'document';
}

export class Prints {
  /** @param {{ storage: any, now: () => number, env: () => Record<string, any>, fetchFn: typeof fetch }} deps */
  constructor({ storage, now, env, fetchFn }) {
    this.storage = storage;
    this.now = now;
    this.env = env;
    this.fetchFn = fetchFn;
    this.handbookAt = 0;
  }

  configured() { return Boolean(this.env()?.PRINT_DISPATCH_TOKEN); }

  /** The print job's machine token (HANDBOOK_TOKEN). @param {Request} request */
  machineOk(request) {
    const token = String(this.env()?.HANDBOOK_TOKEN || '');
    const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
    return Boolean(token && m && safeEqual(m[1].trim(), token));
  }

  /** Start a GitHub Actions job. @param {string} workflow @param {Record<string, string>} inputs */
  async dispatch(workflow, inputs) {
    let res;
    try {
      res = await this.fetchFn(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${workflow}/dispatches`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.env().PRINT_DISPATCH_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'kvbc-awana-sync',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main', inputs }),
      });
    } catch {
      return { ok: false, status: 0 };
    }
    return { ok: res.status === 204, status: res.status };
  }

  /** @param {{status: number}} r */
  dispatchFailed(r) {
    const why = r.status === 401 || r.status === 403 || r.status === 404
      ? 'GitHub refused the print token. It may have expired: make a new one (worker/README.md).'
      : 'GitHub did not start the print. Try again in a minute.';
    return fail(why, 502, { reason: 'dispatch', status: r.status });
  }

  /** Delete an upload's pieces and its record. @param {any} up */
  async drop(up) {
    if (!up) return;
    for (let n = 0; n < (up.parts || 0); n += 1) await this.storage.delete(partKey(up.id, n));
    const now = await this.storage.get(UP_KEY);
    if (now && now.id === up.id) await this.storage.delete(UP_KEY);
  }

  /** An upload past its time is deleted. */
  async current() {
    const up = await this.storage.get(UP_KEY);
    if (up && this.now() - (up.at || 0) > PRINT_TTL_MS) { await this.drop(up); return null; }
    return up || null;
  }

  /** POST /v1/prints/pdf {chars, name, copies}: start an upload. @param {any} body */
  async start(body) {
    const chars = Number(body?.chars);
    const copies = Number(body?.copies);
    if (!Number.isInteger(chars) || chars < 40 || chars > MAX_CHARS || chars % 4 !== 0) return fail('That PDF is empty or larger than 15 MB.', 400, { reason: 'size' });
    if (!Number.isInteger(copies) || copies < 1 || copies > PRINT_COPIES_MAX) return fail(`Copies must be 1 to ${PRINT_COPIES_MAX}.`, 400, { reason: 'copies' });
    const old = await this.storage.get(UP_KEY);
    if (old) await this.drop(old);
    const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
    const parts = Math.ceil(chars / PRINT_PART_CHARS);
    await this.storage.put(UP_KEY, { id, parts, chars, name: cleanName(body?.name), copies, next: 0, at: this.now() });
    return json({ ok: true, id, parts, partChars: PRINT_PART_CHARS });
  }

  /** PUT /v1/prints/pdf/:id/:n, one piece. @param {string} id @param {string} n @param {Request} request */
  async part(id, n, request) {
    const up = await this.current();
    const i = Number(n);
    if (!up || up.id !== id || up.sent) return fail('There is no upload by that name.', 404, { reason: 'no-upload' });
    if (!Number.isInteger(i) || i < 0 || i >= up.parts || i > up.next || i < up.next - 1) return fail('That part is out of order.', 409, { reason: 'order', next: up.next });
    const text = await request.text();
    const want = i === up.parts - 1 ? up.chars - i * PRINT_PART_CHARS : PRINT_PART_CHARS;
    if (text.length !== want || !B64_RE.test(text) || (i < up.parts - 1 && text.includes('='))) return fail('That part is the wrong size.', 400, { reason: 'size' });
    await this.storage.put(partKey(up.id, i), text);
    if (i === up.next) await this.storage.put(UP_KEY, { ...up, next: i + 1 });
    return json({ ok: true, next: Math.max(up.next, i + 1) });
  }

  /** POST /v1/prints/pdf/:id/send {key}: every piece is here; start the print job. @param {string} id @param {any} body */
  async send(id, body) {
    const up = await this.current();
    if (!up || up.id !== id) return fail('There is no upload by that name.', 404, { reason: 'no-upload' });
    if (up.sent) return fail('That PDF was already sent to the printer.', 409, { reason: 'sent' });
    if (up.next !== up.parts) return fail('Part of the PDF did not arrive. Try again.', 400, { reason: 'parts', next: up.next });
    const key = String(body?.key || '');
    if (!KEY_RE.test(key)) return fail('That is not a key.', 400, { reason: 'bad-key' });
    // Marked sent BEFORE the dispatch: a second tap never prints twice.
    await this.storage.put(UP_KEY, { ...up, sent: this.now() });
    const r = await this.dispatch(PDF_WORKFLOW, { pdf_job: `${up.id}.${key}`, copies: String(up.copies) });
    if (!r.ok) { await this.storage.put(UP_KEY, { ...up }); return this.dispatchFailed(r); }
    return json({ ok: true, copies: up.copies, name: up.name });
  }

  /** GET /v1/prints/pdf/:id (the job): the ciphertext as `{name, ct}`. @param {string} id */
  async fetchJob(id) {
    const up = await this.current();
    if (!up || up.id !== id || up.next !== up.parts) return fail('There is no upload by that name.', 404, { reason: 'no-upload' });
    const enc = new TextEncoder();
    const storage = this.storage;
    let n = -1;
    const body = new ReadableStream({
      async pull(controller) {
        if (n === -1) { controller.enqueue(enc.encode(`{"name":${JSON.stringify(up.name)},"ct":"`)); n = 0; return; }
        if (n >= up.parts) { controller.enqueue(enc.encode('"}')); controller.close(); return; }
        const part = await storage.get(partKey(up.id, n));
        if (typeof part !== 'string') { controller.error(new Error('missing part')); return; }
        controller.enqueue(enc.encode(part));
        n += 1;
      },
    });
    return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  /** DELETE /v1/prints/pdf/:id (the job, once it has it). @param {string} id */
  async remove(id) {
    const up = await this.storage.get(UP_KEY);
    if (up && up.id === id) await this.drop(up);
    return json({ ok: true });
  }

  /** POST /v1/prints/handbook: print today's handbook sheets now. */
  async handbook() {
    const t = this.now();
    if (t - this.handbookAt < HANDBOOK_GAP_MS) return fail('The handbook sheets were just sent. Give it a couple of minutes.', 429, { reason: 'just-sent' });
    this.handbookAt = t;
    const r = await this.dispatch(HANDBOOK_WORKFLOW, {});
    if (!r.ok) { this.handbookAt = 0; return this.dispatchFailed(r); }
    return json({ ok: true });
  }
}

/**
 * The routes (src/routes.md 10.16): the page's need a session; the job's the machine token.
 * @param {import('./registry.js').Registry} registry
 * @param {any} core
 */
export function mountPrints(registry, core) {
  const p = () => /** @type {Prints} */ (core.prints);
  const ready = (/** @type {(ctx: import('./registry.js').RouteContext) => Promise<Response>} */ fn) => async (/** @type {import('./registry.js').RouteContext} */ ctx) => {
    if (!p().configured()) return json({ ok: false, reason: 'not-configured' }, 503);
    return fn(ctx);
  };
  const machine = (/** @type {(ctx: import('./registry.js').RouteContext) => Promise<Response>} */ fn) => async (/** @type {import('./registry.js').RouteContext} */ ctx) => {
    if (!p().machineOk(ctx.request)) return fail('Not signed in.', 401, { reason: 'signed-out' });
    if (!ID_RE.test(ctx.params.id || '')) return fail('There is no upload by that name.', 404, { reason: 'no-upload' });
    return fn(ctx);
  };
  registry.add('GET', '/v1/prints', 'session', async () => json({ ok: true, ready: p().configured() }));
  registry.add('POST', '/v1/prints/pdf', 'session', ready(async ({ body }) => p().start(await body())));
  registry.add('PUT', '/v1/prints/pdf/:id/:n', 'session', ready(async ({ params, request }) => p().part(params.id, params.n, request)));
  registry.add('POST', '/v1/prints/pdf/:id/send', 'session', ready(async ({ params, body }) => p().send(params.id, await body())));
  registry.add('GET', '/v1/prints/pdf/:id', 'public', machine(async ({ params }) => p().fetchJob(params.id)));
  registry.add('DELETE', '/v1/prints/pdf/:id', 'public', machine(async ({ params }) => p().remove(params.id)));
  registry.add('POST', '/v1/prints/handbook', 'session', ready(async () => p().handbook()));
}

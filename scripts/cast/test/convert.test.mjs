// The Cast PowerPoint job (scripts/cast/convert.mjs, cast-convert.yml): opens the
// browser's scrambling, hands LibreOffice only a presentation, keeps the PDF under
// 20 MB, sends it back, and reports a failure so the page stops waiting. The last
// test runs the REAL LibreOffice on sample.pptx when `soffice` is installed (CI's
// job installs it; skipped, and says so, without it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDF_MAX, exportFilter, openUpload, parseJob, presentationKind, run, toPdf } from '../convert.mjs';

const SAMPLE = new Uint8Array(readFileSync(fileURLToPath(new URL('./sample.pptx', import.meta.url))));
const PDF = Uint8Array.from(Buffer.from('%PDF-1.7\n% test\n'));
const ID = 'cabcdefghijklmnop';

async function scramble(bytes) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return { ct: out, key: Buffer.from(raw).toString('base64url') };
}

/** A stand-in Worker: answers the job's three routes, records what it was told. */
function worker(ct) {
  const calls = [];
  const get = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', auth: init.headers?.Authorization, body: init.body });
    if (String(url).endsWith('/job')) return ct ? new Response(ct) : new Response('{}', { status: 404 });
    if (String(url).endsWith('/result')) return new Response('{"ok":true}');
    if (String(url).endsWith('/failed')) return new Response('{"ok":true}');
    throw new Error(`unexpected ${url}`);
  };
  return { calls, get };
}

test('the job input is <id>.<key>; anything else is refused', () => {
  assert.deepEqual(parseJob(`${ID}.${'A'.repeat(43)}`), { id: ID, key: 'A'.repeat(43) });
  assert.throws(() => parseJob('nope'));
  assert.throws(() => parseJob(`${ID}.short`));
});

test('only a presentation goes to LibreOffice: pptx/odp (zip) or ppt (OLE)', () => {
  assert.equal(presentationKind(SAMPLE), 'pptx');
  assert.equal(presentationKind(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0])), 'ppt');
  assert.equal(presentationKind(PDF), '');
  assert.equal(presentationKind(Uint8Array.from(Buffer.from('<html>'))), '');
});

test('the export keeps pictures sharp for a TV, then smaller on a second try', () => {
  assert.match(exportFilter(220), /^pdf:impress_pdf_Export:\{.*"MaxImageResolution":\{"type":"long","value":"220"\}/);
  assert.match(exportFilter(110), /"Quality":\{"type":"long","value":"75"\}/);
});

test('a wrong key is a failure named key', async () => {
  const { ct } = await scramble(SAMPLE);
  await assert.rejects(openUpload(ct, 'A'.repeat(43)), (e) => e.reason === 'key');
});

test('the whole job: read, open, convert, send the PDF back with the machine token', async () => {
  const { ct, key } = await scramble(SAMPLE);
  const w = worker(ct);
  const out = await run({ JOB: `${ID}.${key}`, PRINT_FETCH_TOKEN: 'machine', SITE_ORIGIN: 'https://awana.test' }, { get: w.get, convert: async () => PDF });
  assert.equal(out, 'done');
  assert.deepEqual(w.calls.map((c) => `${c.method} ${c.url.replace('https://awana.test/api/v1/cast/convert/', '')}`), [`GET ${ID}/job`, `PUT ${ID}/result`]);
  assert.ok(w.calls.every((c) => c.auth === 'Bearer machine'));
  assert.deepEqual(new Uint8Array(w.calls[1].body), PDF);
});

test('not a PowerPoint, too big, or the upload gone: the Worker is told why', async () => {
  const notPpt = await scramble(PDF);
  let w = worker(notPpt.ct);
  assert.equal(await run({ JOB: `${ID}.${notPpt.key}`, PRINT_FETCH_TOKEN: 'm' }, { get: w.get, convert: async () => PDF }), 'failed:type');
  assert.equal(JSON.parse(w.calls.at(-1).body).reason, 'type');

  const big = new Uint8Array(PDF_MAX + 1); big.set(PDF);
  const { ct, key } = await scramble(SAMPLE);
  w = worker(ct);
  const dpis = [];
  assert.equal(await run({ JOB: `${ID}.${key}`, PRINT_FETCH_TOKEN: 'm' }, { get: w.get, convert: async (_d, _f, dpi) => { dpis.push(dpi); return big; } }), 'failed:too-big');
  assert.deepEqual(dpis, [220, 110]);

  w = worker(null);
  assert.equal(await run({ JOB: `${ID}.${key}`, PRINT_FETCH_TOKEN: 'm' }, { get: w.get }), 'failed:convert');
});

let haveSoffice = true;
try { execFileSync('soffice', ['--version'], { stdio: 'ignore', timeout: 60000 }); } catch { haveSoffice = false; }

test('LibreOffice really makes a three-page PDF of sample.pptx', { skip: haveSoffice ? false : 'soffice is not installed here', timeout: 180000 }, async () => {
  const pdf = await toPdf(SAMPLE);
  const text = Buffer.from(pdf).toString('latin1');
  assert.ok(text.startsWith('%PDF-'));
  assert.equal((text.match(/\/Type\s*\/Page[^s]/g) || []).length, 3);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import os from 'node:os';
import { run, copiesFrom, repeatPdf, fileNameFor, releasePdfUrl, printsPath, ROOT, EPSON, MAX_COPIES } from '../letterhead-print.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = fs.readFileSync(path.join(HERE, 'november.txt'), 'utf8');
const EXE = process.env.PLAYWRIGHT_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const launch = async () => (await import('playwright')).chromium.launch(EXE ? { executablePath: EXE } : {});
const ENV = { GMAIL_USER: 'owner@example.org', GMAIL_APP_PASSWORD: 'x', LETTER_TEXT: SAMPLE };

/** The PDF out of a built message. */
function pdfOf(message) {
  const b64 = message.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, '');
  return Buffer.from(b64, 'base64');
}

test('copies: default 50, whole numbers 1..MAX only', () => {
  assert.equal(copiesFrom(undefined), 50);
  assert.equal(copiesFrom(''), 50);
  assert.equal(copiesFrom('12'), 12);
  for (const bad of ['0', '-1', '2.5', 'x', String(MAX_COPIES + 1)]) assert.throws(() => copiesFrom(bad));
});

test('file name from the title', () => {
  assert.equal(fileNameFor('November Update'), 'November-Update.pdf');
  assert.equal(fileNameFor('<>'), 'Awana-letter.pdf');
});

test('the November sample: ONE page, 50 copies in one PDF, mailed to the Epson with no text body', async () => {
  /** @type {any} */
  let sent = null;
  const out = await run(ENV, { launch, send: async (m) => { sent = m; } });
  assert.equal(out.fit, 'one-page');
  assert.equal(out.pages, 1);
  assert.equal(sent.to, EPSON);
  assert.match(sent.message, /^Subject: November Update$/m);
  assert.doesNotMatch(sent.message, /text\/plain|text\/html/);
  const pdf = await PDFDocument.load(pdfOf(sent.message));
  assert.equal(pdf.getPageCount(), 50);
  const { width, height } = pdf.getPage(0).getSize();
  assert.deepEqual([Math.round(width), Math.round(height)], [612, 792]);
});

test('dry run: one copy, to GMAIL_USER, never the printer', async () => {
  /** @type {any} */
  let sent = null;
  await run({ ...ENV, DRY_RUN: 'true', TO: EPSON }, { launch, send: async (m) => { sent = m; } });
  assert.equal(sent.to, ENV.GMAIL_USER);
  assert.match(sent.message, /^Subject: \[Dry run\] November Update$/m);
  assert.equal((await PDFDocument.load(pdfOf(sent.message))).getPageCount(), 1);
});

test('a long letter shrinks before it ever runs onto a second page', async () => {
  const longer = SAMPLE.replace('Upcoming Events', 'Also, we have so much more to share with you this month. Thank you for everything you do for these kids.\n\nUpcoming Events');
  const out = await run({ ...ENV, LETTER_TEXT: longer, COPIES: '2' }, { launch, send: async () => {} });
  assert.equal(out.fit, 'one-page');
});

test('a very long letter flows to page 2; the page cap holds', async () => {
  const essay = `Long Letter\n\n${Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}. ${'Words that go on and on about club night. '.repeat(6)}`).join('\n\n')}`;
  const out = await run({ ...ENV, LETTER_TEXT: essay, COPIES: '3' }, { launch, send: async () => {} });
  assert.equal(out.fit, 'flow');
  assert.ok(out.pages >= 2);
  const one = await PDFDocument.create();
  one.addPage(); one.addPage(); one.addPage();
  await assert.rejects(repeatPdf(await one.save(), 100), /at most 200/);
});

test('refuses: no text, no Gmail secrets, a bad address, and a send that fails is not retried', async () => {
  await assert.rejects(run({ ...ENV, LETTER_TEXT: '  ' }), /empty/);
  await assert.rejects(run({ ...ENV, GMAIL_APP_PASSWORD: '' }), /GMAIL_USER/);
  await assert.rejects(run({ ...ENV, TO: 'not an address' }), /not a plain email/);
  let tries = 0;
  await assert.rejects(run(ENV, { launch, send: async () => { tries++; throw new Error('smtp data 451'); } }), /did not take/);
  assert.equal(tries, 1);
});

// A ready-made PDF (owner 2026-11-04: the poster contest ballots).
const BALLOTS = 'https://github.com/patrick-simpson/kvbcawana/releases/download/media-poster-contest-2026/Poster-Contest-Ballots.pdf';
async function onePagePdf() {
  const d = await PDFDocument.create();
  d.addPage([612, 792]).drawRectangle({ x: 72, y: 72, width: 100, height: 20 });
  return d.save();
}

test('a PDF url must be a .pdf on this repo\'s releases', () => {
  assert.equal(releasePdfUrl(BALLOTS), BALLOTS);
  for (const bad of ['https://example.org/x.pdf', 'http://github.com/patrick-simpson/kvbcawana/releases/download/t/x.pdf',
    'https://github.com/someone/else/releases/download/t/x.pdf', BALLOTS.replace('.pdf', '.exe'), BALLOTS + '?x=1']) {
    assert.throws(() => releasePdfUrl(bad), /PDF_URL/);
  }
});

test('a PDF url prints that PDF, copies as pages, no letter text needed', async () => {
  const one = await onePagePdf();
  let asked = '', sent;
  const get = async (url) => { asked = url; return new Response(one); };
  const send = async (m) => { sent = m; };
  const out = await run({ GMAIL_USER: 'owner@example.org', GMAIL_APP_PASSWORD: 'x', PDF_URL: BALLOTS, COPIES: '50' }, { get, send });
  assert.equal(asked, BALLOTS);
  assert.deepEqual([out.copies, out.pages], [50, 1]);
  assert.equal(sent.to, EPSON);
  assert.match(sent.message, /Poster-Contest-Ballots\.pdf/);
  assert.ok(!/text\/plain/.test(sent.message), 'no text body');
  assert.equal((await PDFDocument.load(pdfOf(sent.message))).getPageCount(), 50);
});

test('a PDF url refuses a file that is not a PDF and a failed download', async () => {
  const env = { GMAIL_USER: 'owner@example.org', GMAIL_APP_PASSWORD: 'x', PDF_URL: BALLOTS };
  let sent = false;
  const send = async () => { sent = true; };
  await assert.rejects(run(env, { send, get: async () => new Response('<html>') }), /not a PDF/);
  await assert.rejects(run(env, { send, get: async () => new Response('', { status: 404 }) }), /HTTP 404/);
  assert.equal(sent, false);
});

// A PDF the repo holds under prints/ (owner 2026-11-04: the Parents' Night half
// sheet; one print job for all three sources).
async function standInRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prints-'));
  fs.mkdirSync(path.join(root, 'prints'));
  fs.writeFileSync(path.join(root, 'prints', 'sample-sheet.pdf'), await onePagePdf());
  fs.writeFileSync(path.join(root, 'prints', 'fake.pdf'), 'not a pdf');
  return root;
}

test('a PDF file must be a .pdf under prints/, never climbing out', () => {
  assert.equal(printsPath('prints/a.pdf'), 'prints/a.pdf');
  assert.equal(printsPath('./prints/a.pdf'), 'prints/a.pdf');
  for (const bad of ['', 'a.pdf', 'prints/a.txt', 'prints/../secret.pdf', '/etc/a.pdf', 'printsx/a.pdf']) assert.throws(() => printsPath(bad), /PDF_FILE/, bad);
});

test('a PDF file prints that PDF, copies as pages, to the Epson with no text body; a dry run mails one copy to GMAIL_USER', async () => {
  const root = await standInRepo();
  let sent;
  const send = async (m) => { sent = m; };
  const env = { GMAIL_USER: 'owner@example.org', GMAIL_APP_PASSWORD: 'x', PDF_FILE: 'prints/sample-sheet.pdf', COPIES: '10' };
  const out = await run(env, { root, send });
  assert.deepEqual([out.copies, out.pages], [10, 1]);
  assert.equal(sent.to, EPSON);
  assert.match(sent.message, /^Subject: sample-sheet$/m);
  assert.ok(!/text\/plain/.test(sent.message), 'no text body');
  assert.equal((await PDFDocument.load(pdfOf(sent.message))).getPageCount(), 10);
  const dry = await run({ ...env, DRY_RUN: 'true' }, { root, send });
  assert.equal(dry.copies, 1);
  assert.equal(sent.to, 'owner@example.org');
});

test('a PDF file refuses a missing file, a non-PDF, and both sources at once', async () => {
  const root = await standInRepo();
  let sent = false;
  const send = async () => { sent = true; };
  const env = { GMAIL_USER: 'owner@example.org', GMAIL_APP_PASSWORD: 'x' };
  await assert.rejects(run({ ...env, PDF_FILE: 'prints/none.pdf' }, { root, send }), /not in the repo/);
  await assert.rejects(run({ ...env, PDF_FILE: 'prints/fake.pdf' }, { root, send }), /not a PDF/);
  await assert.rejects(run({ ...env, PDF_FILE: 'prints/sample-sheet.pdf', PDF_URL: BALLOTS }, { root, send }), /not both/);
  assert.equal(sent, false);
});

test('the Parents\' Night half sheet in the repo is one Letter page', async () => {
  const doc = await PDFDocument.load(fs.readFileSync(path.join(ROOT, 'prints/2026-11-04-parents-night-half-sheet.pdf')));
  assert.equal(doc.getPageCount(), 1);
  const { width, height } = doc.getPage(0).getSize();
  assert.deepEqual([Math.round(width), Math.round(height)], [612, 792]);
});

// An uploaded PDF from the letterhead page (worker/src/prints.js): scrambled in the
// browser, read with the machine token, opened with the key, deleted after.
async function scramble(bytes) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return { ct: Buffer.concat([iv, ct]).toString('base64'), key: Buffer.from(raw).toString('base64url') };
}

async function twoPagePdf() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawText('Page one', { x: 72, y: 700 });
  doc.addPage([612, 792]).drawText('Page two', { x: 72, y: 700 });
  return doc.save();
}

test('an uploaded PDF: opened with its key, copies as pages of one PDF, deleted from the Worker', async () => {
  const { ct, key } = await scramble(await twoPagePdf());
  const id = '0123456789abcdef';
  const calls = [];
  const get = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', auth: init.headers?.Authorization });
    if ((init.method || 'GET') === 'DELETE') return new Response('{"ok":true}', { status: 200 });
    return new Response(JSON.stringify({ name: 'Sign up sheet', ct }), { status: 200 });
  };
  /** @type {any} */
  let sent = null;
  const out = await run({ GMAIL_USER: 'owner@example.org', GMAIL_APP_PASSWORD: 'x', PDF_JOB: `${id}.${key}`, COPIES: '3', PRINT_FETCH_TOKEN: 'machine', SITE_ORIGIN: 'https://awana.example.org' },
    { get, send: async (m) => { sent = m; } });
  assert.deepEqual([out.copies, out.pages], [3, 2]);
  assert.equal(sent.to, EPSON);
  assert.match(sent.message, /^Subject: Sign up sheet$/m);
  assert.equal((await PDFDocument.load(pdfOf(sent.message))).getPageCount(), 6);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url} ${c.auth}`), [
    `GET https://awana.example.org/api/v1/prints/pdf/${id} Bearer machine`,
    `DELETE https://awana.example.org/api/v1/prints/pdf/${id} Bearer machine`,
  ]);
});

test('an upload with the wrong key prints nothing and is still deleted', async () => {
  const { ct } = await scramble(await twoPagePdf());
  const methods = [];
  const get = async (_url, init = {}) => {
    methods.push(init.method || 'GET');
    return new Response(JSON.stringify({ name: 'x', ct }), { status: 200 });
  };
  let sent = false;
  await assert.rejects(run({ GMAIL_USER: 'owner@example.org', GMAIL_APP_PASSWORD: 'x', PDF_JOB: `0123456789abcdef.${'B'.repeat(43)}`, PRINT_FETCH_TOKEN: 'machine' },
    { get, send: async () => { sent = true; } }), /could not be opened/);
  assert.equal(sent, false);
  assert.deepEqual(methods, ['GET', 'DELETE']);
});

test('PDF_JOB must be an id and a key, and only one source at a time', async () => {
  const env = { GMAIL_USER: 'owner@example.org', GMAIL_APP_PASSWORD: 'x', PRINT_FETCH_TOKEN: 'm' };
  await assert.rejects(run({ ...env, PDF_JOB: 'nope' }, { send: async () => {} }), /PDF_JOB/);
  await assert.rejects(run({ ...env, PDF_JOB: `0123456789abcdef.${'B'.repeat(43)}`, PDF_FILE: 'prints/x.pdf' }, { send: async () => {} }), /one of/);
});

test('a PDF whose page cannot be embedded is copied whole instead', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);   // no contents at all
  const { pdf, pages } = await repeatPdf(await doc.save(), 4);
  assert.equal(pages, 1);
  assert.equal((await PDFDocument.load(pdf)).getPageCount(), 4);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { run, copiesFrom, repeatPdf, fileNameFor, EPSON, MAX_COPIES } from '../letterhead-print.mjs';

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

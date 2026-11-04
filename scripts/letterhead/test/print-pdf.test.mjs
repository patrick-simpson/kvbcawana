import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { run, printPath, copiesOf, ROOT } from '../print-pdf.mjs';
import { EPSON } from '../letterhead-print.mjs';

const ENV = { GMAIL_USER: 'owner@example.org', GMAIL_APP_PASSWORD: 'x' };

/** The PDF out of a built message. */
function pdfOf(message) {
  const b64 = message.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, '');
  return Buffer.from(b64, 'base64');
}

/** A one-page PDF under a stand-in repo's prints/. */
async function stand() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'print-pdf-'));
  fs.mkdirSync(path.join(root, 'prints'));
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawText('Hello');
  fs.writeFileSync(path.join(root, 'prints', 'sample-sheet.pdf'), await doc.save());
  fs.writeFileSync(path.join(root, 'prints', 'fake.pdf'), 'not a pdf');
  return root;
}

test('only a .pdf under prints/, never climbing out', () => {
  assert.equal(printPath('prints/a.pdf'), 'prints/a.pdf');
  assert.equal(printPath('./prints/a.pdf'), 'prints/a.pdf');
  for (const bad of ['', 'a.pdf', 'prints/a.txt', 'prints/../secret.pdf', '/etc/a.pdf', 'printsx/a.pdf']) assert.throws(() => printPath(bad), bad);
});

test('copies: default 1, whole numbers 1..100', () => {
  assert.equal(copiesOf(undefined), 1);
  assert.equal(copiesOf('10'), 10);
  for (const bad of ['0', '2.5', 'x', '101']) assert.throws(() => copiesOf(bad));
});

test('10 copies of a one-page PDF: ten pages in one PDF, to the Epson, no text body', async () => {
  const root = await stand();
  /** @type {any} */
  let sent = null;
  const out = await run({ ...ENV, FILE: 'prints/sample-sheet.pdf', COPIES: '10' }, { root, send: async (m) => { sent = m; } });
  assert.equal(out.pages, 1);
  assert.equal(out.copies, 10);
  assert.equal(sent.to, EPSON);
  assert.match(sent.message, /^Subject: sample sheet$/m);
  assert.ok(!/Content-Type: text\/plain/.test(sent.message), 'no text body');
  assert.equal((await PDFDocument.load(pdfOf(sent.message))).getPageCount(), 10);
});

test('a dry run mails one copy to GMAIL_USER', async () => {
  const root = await stand();
  /** @type {any} */
  let sent = null;
  const out = await run({ ...ENV, FILE: 'prints/sample-sheet.pdf', COPIES: '10', DRY_RUN: 'true' }, { root, send: async (m) => { sent = m; } });
  assert.equal(out.copies, 1);
  assert.equal(sent.to, ENV.GMAIL_USER);
});

test('refuses a missing file, a non-PDF, and no Gmail secrets', async () => {
  const root = await stand();
  const send = async () => { throw new Error('must not send'); };
  await assert.rejects(run({ ...ENV, FILE: 'prints/none.pdf' }, { root, send }), /not in the repo/);
  await assert.rejects(run({ ...ENV, FILE: 'prints/fake.pdf' }, { root, send }), /not a PDF/);
  await assert.rejects(run({ FILE: 'prints/sample-sheet.pdf' }, { root, send }), /GMAIL_USER/);
});

test('the Parents\' Night half sheet in the repo is one Letter page', async () => {
  const doc = await PDFDocument.load(fs.readFileSync(path.join(ROOT, 'prints/2026-11-04-parents-night-half-sheet.pdf')));
  assert.equal(doc.getPageCount(), 1);
  const { width, height } = doc.getPage(0).getSize();
  assert.deepEqual([Math.round(width), Math.round(height)], [612, 792]);
});

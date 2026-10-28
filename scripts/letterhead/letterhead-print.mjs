// The letterhead print job (owner 2026-10-28; .github/workflows/letterhead-print.yml):
// plain newsletter text in, the Awana letterhead (shared/letterhead.js, the same
// drawing as awana.kvbchurch.org/letterhead/) printed to a Letter PDF in
// Chromium, repeated COPIES times in ONE PDF (Epson Connect email print takes
// no copy count from the mail), and emailed with the handbook job's own SMTP
// client from the owner's Gmail to the downstairs Epson. No text body: the
// Epson would print it as a page of its own.
//
// Started by hand (Actions → "Print a letterhead") or by the Claude routine
// that turns a MailChimp newsletter into this text.
//
// Env: LETTER_TEXT (the text), COPIES (default 50, 1..MAX_COPIES), TO (default
// the downstairs Epson), DRY_RUN ('true' = one copy mailed to GMAIL_USER
// instead), GMAIL_USER, GMAIL_APP_PASSWORD. The log shows sizes and page
// counts only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLetter, letterHtml, LETTERHEAD_SVGS } from '../../shared/letterhead.js';
import { ADDRESS_RE, buildMessage, sendMail } from '../handbook/smtp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(HERE, '../../shared/brand');
export const EPSON = 'kvbcdownstairs@print.epsonconnect.com';
export const DEFAULT_COPIES = 50;
export const MAX_COPIES = 100;
/** Most pages one email may carry (two-page letters halve the copies). */
export const MAX_PAGES = 200;

class Fatal extends Error {}
const log = (s) => console.log(s);

/** @param {string|undefined} v */
export function copiesFrom(v) {
  if (v === undefined || v === '') return DEFAULT_COPIES;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_COPIES) throw new Fatal(`COPIES must be a whole number from 1 to ${MAX_COPIES}.`);
  return n;
}

/** The four kit drawings, read from the one kit. */
export function kitSvgs() {
  return /** @type {any} */ (Object.fromEntries(Object.entries(LETTERHEAD_SVGS)
    .map(([k, rel]) => [k, fs.readFileSync(path.join(KIT, rel), 'utf8')])));
}

/**
 * One copy of the letter as a PDF, and how it fitted.
 * @param {any} browser playwright Chromium
 * @param {string} text
 * @param {Date} [date]
 */
export async function letterPdf(browser, text, date = new Date()) {
  const letter = parseLetter(text);
  if (!letter.title || !letter.parts.length) throw new Fatal('The letter has no title or no text.');
  const html = letterHtml(letter, { kitUrl: `file://${KIT}`, svgs: kitSvgs(), date });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'letterhead-'));
  const file = path.join(dir, 'letter.html');
  fs.writeFileSync(file, html);
  const page = await browser.newPage({ viewport: { width: 816, height: 1056 } });
  try {
    await page.goto(`file://${file}`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.fit, null, { timeout: 30_000 });
    const fit = await page.evaluate(() => ({ fit: document.documentElement.dataset.fit, size: document.documentElement.dataset.size }));
    const pdf = await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true, tagged: true });
    return { pdf: new Uint8Array(pdf), ...fit, title: letter.title };
  } finally {
    await page.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The letter `copies` times over in one PDF (each copy's pages in order).
 * @param {Uint8Array} one
 * @param {number} copies
 */
export async function repeatPdf(one, copies) {
  const { PDFDocument } = await import('pdf-lib');
  const src = await PDFDocument.load(one);
  const n = src.getPageCount();
  if (n * copies > MAX_PAGES) throw new Fatal(`${copies} copies of a ${n}-page letter is ${n * copies} pages; at most ${MAX_PAGES} go in one email.`);
  const out = await PDFDocument.create();
  out.setTitle(src.getTitle() || 'Awana letter');
  // Each page is drawn ONCE (one embedded page, its fonts once) and every copy
  // points at it, so 50 copies weigh about what one does.
  const drawn = await out.embedPages(src.getPages());
  for (let c = 0; c < copies; c++) {
    for (const d of drawn) out.addPage([d.width, d.height]).drawPage(d);
  }
  return { pdf: await out.save(), pages: n };
}

/** @param {string} title */
export function fileNameFor(title) {
  return `${title.replace(/[^\w &'-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'Awana-letter'}.pdf`;
}

/** @param {NodeJS.ProcessEnv} env @param {{send?: typeof sendMail, launch?: () => Promise<any>}} [deps] */
export async function run(env, deps = {}) {
  const text = String(env.LETTER_TEXT || '');
  if (!text.trim()) throw new Fatal('LETTER_TEXT is empty.');
  const dry = env.DRY_RUN === 'true';
  const copies = dry ? 1 : copiesFrom(env.COPIES);
  const user = String(env.GMAIL_USER || '');
  const pass = String(env.GMAIL_APP_PASSWORD || '');
  if (!ADDRESS_RE.test(user) || !pass) throw new Fatal('GMAIL_USER and GMAIL_APP_PASSWORD are needed (the handbook job\'s secrets).');
  const to = dry ? user : String(env.TO || EPSON);
  if (!ADDRESS_RE.test(to)) throw new Fatal('The "to" address is not a plain email address.');

  const exe = env.PLAYWRIGHT_CHROMIUM;
  const launch = deps.launch || (async () => (await import('playwright')).chromium.launch(exe ? { executablePath: exe } : {}));
  const browser = await launch();
  let one;
  try {
    one = await letterPdf(browser, text);
  } finally {
    await browser.close();
  }
  log(`Drew the letter: ${one.fit === 'one-page' ? 'one page' : 'ran onto a second page'} at ${one.size} pt.`);
  const { pdf, pages } = await repeatPdf(one.pdf, copies);
  log(`${copies} ${copies === 1 ? 'copy' : 'copies'} of ${pages} ${pages === 1 ? 'page' : 'pages'}: ${pdf.length} bytes.`);
  const message = buildMessage({ from: user, to, subject: `${dry ? '[Dry run] ' : ''}${one.title}`, attachments: [{ name: fileNameFor(one.title), bytes: pdf }] });
  try {
    await (deps.send || sendMail)({ user, pass, from: user, to, message });
  } catch (e) {
    const why = String(/** @type {any} */ (e).message || 'smtp');
    if (/smtp auth 5\d\d/.test(why)) throw new Fatal(`Gmail refused the sign-in (${why}). Check GMAIL_USER and GMAIL_APP_PASSWORD.`);
    throw new Error(`Gmail did not take the message (${why}).`);
  }
  log(dry ? 'Dry run: one copy was emailed to GMAIL_USER.' : `Sent to the printer (${copies} copies).`);
  return { copies, pages, bytes: pdf.length, fit: one.fit };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await run(process.env);
  } catch (e) {
    console.log(`::error::The letter was NOT printed. ${/** @type {any} */ (e).message || e}`);
    process.exitCode = 1;
  }
}

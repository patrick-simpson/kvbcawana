// The letterhead print job (owner 2026-10-28; .github/workflows/letterhead-print.yml):
// plain newsletter text in, the Awana letterhead (shared/letterhead.js, the same
// drawing as awana.kvbchurch.org/tools/print/) printed to a Letter PDF in
// Chromium, repeated COPIES times in ONE PDF (Epson Connect email print takes
// no copy count from the mail), and emailed with the handbook job's own SMTP
// client from the owner's Gmail to the downstairs Epson. No text body: the
// Epson would print it as a page of its own.
//
// Started by hand (Actions → "Print to the downstairs Epson") or by the Claude routine
// that turns a MailChimp newsletter into this text.
//
// Or a ready-made PDF instead of a letter (owner 2026-11-04: "50 sheets of the
// ballots ... to the downstairs printer"; the Parents' Night half sheet): PDF_URL,
// a file on THIS repo's GitHub releases only (`releasePdfUrl`), or PDF_FILE, a
// .pdf the repo holds under prints/ (`printsPath`; the repo is public, so
// nothing private goes there), repeated the same way. One job for all three
// (owner 2026-11-04: "merge the two print jobs into one").
//
// Or an UPLOADED PDF (owner 2026-11-04: "a page where I can upload a PDF and it
// will send whatever quantity I specify"): PDF_JOB = `<id>.<key>` from the sync
// Worker (worker/src/prints.js, routes.md 10.16), which holds the PDF scrambled in
// the browser (AES-256-GCM: IV + ciphertext, base64). The job reads it with the
// machine token PRINT_FETCH_TOKEN (the handbook's HANDBOOK_TOKEN) from SITE_ORIGIN,
// opens it with the key, and deletes it from the Worker whatever happens.
//
// Env: LETTER_TEXT (the text), PDF_URL or PDF_FILE or PDF_JOB, COPIES (default 50, 1..MAX_COPIES), TO (default
// the downstairs Epson), DRY_RUN ('true' = one copy mailed to GMAIL_USER
// instead), GMAIL_USER, GMAIL_APP_PASSWORD. The log shows sizes and page
// counts only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLetter, letterHtml, LETTERHEAD_SVGS } from '../../shared/letterhead.js';
import { ADDRESS_RE, EPSON_ADDRESS, buildMessage, recipientAllowed, sendMail } from '../handbook/smtp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(HERE, '../../shared/brand');
export const EPSON = EPSON_ADDRESS;
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
  // Each page is drawn ONCE (one embedded page, its fonts once) and every copy
  // points at it, so 50 copies weigh about what one does. A page pdf-lib cannot
  // embed (an uploaded PDF's odd page) is copied whole each time instead.
  try {
    const out = await PDFDocument.create();
    out.setTitle(src.getTitle() || 'Awana letter');
    const drawn = await out.embedPages(src.getPages());
    for (let c = 0; c < copies; c++) {
      for (const d of drawn) out.addPage([d.width, d.height]).drawPage(d);
    }
    return { pdf: await out.save(), pages: n };
  } catch {
    const out = await PDFDocument.create();
    out.setTitle(src.getTitle() || 'Awana letter');
    const idx = src.getPageIndices();
    for (let c = 0; c < copies; c++) for (const pg of await out.copyPages(src, idx)) out.addPage(pg);
    return { pdf: await out.save(), pages: n };
  }
}

/** Where a ready-made PDF may come from: this repo's own release files. */
export const RELEASE_PDF_RE = /^https:\/\/github\.com\/patrick-simpson\/kvbcawana\/releases\/download\/[\w.-]+\/[\w.()-]+\.pdf$/;
/** The largest ready-made PDF taken (bytes; the mail must stay under Gmail's 25 MB). */
export const PDF_MAX = 15 * 1024 * 1024;

/** @param {string} url */
export function releasePdfUrl(url) {
  const u = String(url || '').trim();
  if (!RELEASE_PDF_RE.test(u)) throw new Fatal('PDF_URL must be a .pdf on this repo\'s GitHub releases (https://github.com/patrick-simpson/kvbcawana/releases/download/<tag>/<file>.pdf).');
  return u;
}

/** @param {string} url @param {typeof fetch} [get] */
export async function fetchPdf(url, get = fetch) {
  const res = await get(url, { redirect: 'follow' });
  if (!res.ok) throw new Fatal(`Could not download the PDF (HTTP ${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > PDF_MAX) throw new Fatal(`The PDF is ${bytes.length} bytes; at most ${PDF_MAX} go in one email.`);
  if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new Fatal('That file is not a PDF.');
  return bytes;
}

/** The repo's root, and the one folder a committed PDF may be printed from. */
export const ROOT = path.resolve(HERE, '../..');
export const PRINTS = 'prints/';

/** A .pdf under prints/, never climbing out. @param {string} rel */
export function printsPath(rel) {
  const clean = String(rel || '').trim().replace(/^\.?\//, '');
  if (!clean.startsWith(PRINTS) || !/\.pdf$/i.test(clean) || clean.split('/').some((p) => p === '..' || p === '')) {
    throw new Fatal(`PDF_FILE must be a .pdf under ${PRINTS} (got "${clean}").`);
  }
  return clean;
}

/** A committed PDF's bytes. @param {string} rel @param {string} [root] */
export function readPrintsPdf(rel, root = ROOT) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) throw new Fatal(`${rel} is not in the repo.`);
  const bytes = new Uint8Array(fs.readFileSync(file));
  if (bytes.length > PDF_MAX) throw new Fatal(`The PDF is ${bytes.length} bytes; at most ${PDF_MAX} go in one email.`);
  if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new Fatal(`${rel} is not a PDF.`);
  return bytes;
}

/** @param {string} title */
export function fileNameFor(title) {
  return `${title.replace(/[^\w &'-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'Awana-letter'}.pdf`;
}

/** @param {NodeJS.ProcessEnv} env @param {{send?: typeof sendMail, launch?: () => Promise<any>}} [deps] */
export async function run(env, deps = {}) {
  const text = String(env.LETTER_TEXT || '');
  const pdfUrl = String(env.PDF_URL || '').trim();
  const pdfFile = String(env.PDF_FILE || '').trim();
  const pdfJob = String(env.PDF_JOB || '').trim();
  if (pdfUrl && pdfFile) throw new Fatal('Give PDF_URL or PDF_FILE, not both.');
  if (pdfJob && (pdfUrl || pdfFile)) throw new Fatal('Give one of PDF_URL, PDF_FILE or PDF_JOB.');
  if (pdfJob) return runPdf(env, { job: pdfJob }, deps);
  if (pdfUrl || pdfFile) return runPdf(env, pdfUrl ? { url: pdfUrl } : { file: pdfFile }, deps);
  if (!text.trim()) throw new Fatal('LETTER_TEXT is empty.');
  const dry = env.DRY_RUN === 'true';
  const copies = dry ? 1 : copiesFrom(env.COPIES);
  const user = String(env.GMAIL_USER || '');
  const pass = String(env.GMAIL_APP_PASSWORD || '');
  if (!ADDRESS_RE.test(user) || !pass) throw new Fatal('GMAIL_USER and GMAIL_APP_PASSWORD are needed (the handbook job\'s secrets).');
  const to = dry ? user : String(env.TO || EPSON);
  if (!ADDRESS_RE.test(to)) throw new Fatal('The "to" address is not a plain email address.');
  if (!recipientAllowed(to, user)) throw new Fatal('The "to" address must be the downstairs Epson or GMAIL_USER; nothing was sent.');

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

/** The secrets and address checks both kinds of job share. @param {NodeJS.ProcessEnv} env */
function mailSetup(env) {
  const dry = env.DRY_RUN === 'true';
  const user = String(env.GMAIL_USER || '');
  const pass = String(env.GMAIL_APP_PASSWORD || '');
  if (!ADDRESS_RE.test(user) || !pass) throw new Fatal('GMAIL_USER and GMAIL_APP_PASSWORD are needed (the handbook job\'s secrets).');
  const to = dry ? user : String(env.TO || EPSON);
  if (!ADDRESS_RE.test(to)) throw new Fatal('The "to" address is not a plain email address.');
  if (!recipientAllowed(to, user)) throw new Fatal('The "to" address must be the downstairs Epson or GMAIL_USER; nothing was sent.');
  return { dry, user, pass, to };
}

/** `<id>.<key>`: the Worker's upload id and the browser's key. @param {string} v */
export function parseJob(v) {
  const m = /^([a-f0-9]{16})\.([A-Za-z0-9_-]{43})$/.exec(String(v || '').trim());
  if (!m) throw new Fatal('PDF_JOB is not an upload id and key.');
  return { id: m[1], key: m[2] };
}

/** Open the browser's scrambling: base64 of 12-byte IV + AES-GCM ciphertext. @param {string} ct @param {string} key */
export async function openUpload(ct, key) {
  const raw = Buffer.from(ct, 'base64');
  if (raw.length < 29) throw new Fatal('The uploaded PDF is empty.');
  const k = await crypto.subtle.importKey('raw', Buffer.from(key, 'base64url'), 'AES-GCM', false, ['decrypt']);
  let plain;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, k, raw.subarray(12)));
  } catch {
    throw new Fatal('The uploaded PDF could not be opened with its key.');
  }
  if (plain.length > PDF_MAX) throw new Fatal(`The PDF is ${plain.length} bytes; at most ${PDF_MAX} go in one email.`);
  if (String.fromCharCode(...plain.slice(0, 5)) !== '%PDF-') throw new Fatal('That file is not a PDF.');
  return plain;
}

/** The upload's base: SITE_ORIGIN's /api. @param {NodeJS.ProcessEnv} env */
function jobBase(env) {
  const origin = String(env.SITE_ORIGIN || 'https://awana.kvbchurch.org').replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/?#]+$/.test(origin)) throw new Fatal('SITE_ORIGIN is not an https origin.');
  return `${origin}/api/v1/prints/pdf`;
}

/**
 * Fetch an uploaded PDF from the Worker and open it.
 * @param {NodeJS.ProcessEnv} env @param {{id: string, key: string}} job @param {typeof fetch} [get]
 */
export async function fetchUpload(env, job, get = fetch) {
  const token = String(env.PRINT_FETCH_TOKEN || '');
  if (!token) throw new Fatal('PRINT_FETCH_TOKEN is needed (the HANDBOOK_TOKEN secret).');
  const res = await get(`${jobBase(env)}/${job.id}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (res.status === 404) throw new Fatal('The upload is gone (it was printed already, or waited over an hour). Upload it again.');
  if (!res.ok) throw new Fatal(`Could not read the upload (HTTP ${res.status}).`);
  const body = await res.json();
  const bytes = await openUpload(String(body?.ct || ''), job.key);
  return { bytes, name: `${String(body?.name || 'document').replace(/[^\w &'()-]+/g, ' ').trim() || 'document'}.pdf` };
}

/** Delete the upload from the Worker (never fails the job). @param {NodeJS.ProcessEnv} env @param {{id: string}} job @param {typeof fetch} [get] */
export async function forgetUpload(env, job, get = fetch) {
  try {
    const res = await get(`${jobBase(env)}/${job.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${String(env.PRINT_FETCH_TOKEN || '')}` } });
    log(`Deleted the upload from the sync service (HTTP ${res.status}).`);
  } catch {
    log('Could not delete the upload now; the sync service deletes it within the hour.');
  }
}

/**
 * A ready-made PDF (this repo's releases, a file under prints/, or an upload
 * from the letterhead page), COPIES times in one PDF, mailed like a letter
 * (never retried).
 * @param {NodeJS.ProcessEnv} env @param {{url?: string, file?: string, job?: string}} source
 * @param {{send?: typeof sendMail, get?: typeof fetch, root?: string}} [deps]
 */
export async function runPdf(env, source, deps = {}) {
  const job = source.job ? parseJob(source.job) : null;
  try {
    return await runPdfFrom(env, source, job, deps);
  } finally {
    if (job) await forgetUpload(env, job, deps.get);
  }
}

/** @param {NodeJS.ProcessEnv} env @param {{url?: string, file?: string}} source @param {{id: string, key: string}|null} job @param {{send?: typeof sendMail, get?: typeof fetch, root?: string}} deps */
async function runPdfFrom(env, source, job, deps) {
  const { dry, user, pass, to } = mailSetup(env);
  const copies = dry ? 1 : copiesFrom(env.COPIES);
  let one;
  let name;
  if (job) {
    ({ bytes: one, name } = await fetchUpload(env, job, deps.get));
  } else {
    const src = source.url ? releasePdfUrl(source.url) : printsPath(source.file || '');
    one = source.url ? await fetchPdf(src, deps.get) : readPrintsPdf(src, deps.root);
    name = decodeURIComponent(src.split('/').pop() || 'document.pdf');
  }
  const { pdf, pages } = await repeatPdf(one, copies);
  log(`${copies} ${copies === 1 ? 'copy' : 'copies'} of ${pages} ${pages === 1 ? 'page' : 'pages'}: ${pdf.length} bytes.`);
  const message = buildMessage({ from: user, to, subject: `${dry ? '[Dry run] ' : ''}${name.replace(/\.pdf$/i, '')}`, attachments: [{ name, bytes: pdf }] });
  try {
    await (deps.send || sendMail)({ user, pass, from: user, to, message });
  } catch (e) {
    const why = String(/** @type {any} */ (e).message || 'smtp');
    if (/smtp auth 5\d\d/.test(why)) throw new Fatal(`Gmail refused the sign-in (${why}). Check GMAIL_USER and GMAIL_APP_PASSWORD.`);
    throw new Error(`Gmail did not take the message (${why}).`);
  }
  log(dry ? 'Dry run: one copy was emailed to GMAIL_USER.' : `Sent to the printer (${copies} copies).`);
  return { copies, pages, bytes: pdf.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await run(process.env);
  } catch (e) {
    console.log(`::error::The letter was NOT printed. ${/** @type {any} */ (e).message || e}`);
    process.exitCode = 1;
  }
}

// Print a ready-made PDF on the downstairs Epson (owner 2026-11-04: the Parents'
// Night half sheet; .github/workflows/print-pdf.yml). The file is one the repo
// holds under prints/ (a PDF too big to hand over any other way); it goes out
// COPIES times in ONE PDF (Epson Connect email print takes no copy count from
// the mail, so the copies are pages, every page drawn once: letterhead-print.mjs
// repeatPdf), mailed from the owner's Gmail with the handbook job's SMTP client,
// no text body (the Epson would print it).
//
// Env: FILE (a path under prints/, ending .pdf), COPIES (1..MAX_COPIES, default
// 1; at most MAX_PAGES pages in all), TO (default the downstairs Epson),
// DRY_RUN ('true' = one copy mailed to GMAIL_USER instead), GMAIL_USER,
// GMAIL_APP_PASSWORD. Never retried: a send that failed after Gmail took it
// would print twice. The log shows sizes and page counts only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADDRESS_RE, buildMessage, sendMail } from '../handbook/smtp.mjs';
import { EPSON, MAX_COPIES, MAX_PAGES, repeatPdf } from './letterhead-print.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
export const PRINTS = 'prints/';

class Fatal extends Error {}

/** A file under prints/ ending .pdf, no climbing out, or a Fatal. @param {string} rel */
export function printPath(rel) {
  const clean = String(rel || '').trim().replace(/^\.?\//, '');
  if (!clean.startsWith(PRINTS) || !/\.pdf$/i.test(clean) || clean.split('/').some((p) => p === '..' || p === '')) {
    throw new Fatal(`FILE must be a .pdf under ${PRINTS} (got "${clean}").`);
  }
  return clean;
}

/** @param {string|undefined} v */
export function copiesOf(v) {
  if (v === undefined || v === '') return 1;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_COPIES) throw new Fatal(`COPIES must be a whole number from 1 to ${MAX_COPIES}.`);
  return n;
}

/** @param {NodeJS.ProcessEnv} env @param {{send?: typeof sendMail, root?: string}} [deps] */
export async function run(env, deps = {}) {
  const rel = printPath(String(env.FILE || ''));
  const dry = env.DRY_RUN === 'true';
  const copies = dry ? 1 : copiesOf(env.COPIES);
  const user = String(env.GMAIL_USER || '');
  const pass = String(env.GMAIL_APP_PASSWORD || '');
  if (!ADDRESS_RE.test(user) || !pass) throw new Fatal('GMAIL_USER and GMAIL_APP_PASSWORD are needed (the handbook job\'s secrets).');
  const to = dry ? user : String(env.TO || EPSON);
  if (!ADDRESS_RE.test(to)) throw new Fatal('The "to" address is not a plain email address.');
  const file = path.join(deps.root || ROOT, rel);
  if (!fs.existsSync(file)) throw new Fatal(`${rel} is not in the repo.`);
  const one = fs.readFileSync(file);
  if (one.subarray(0, 5).toString() !== '%PDF-') throw new Fatal(`${rel} is not a PDF.`);
  let out;
  try {
    out = await repeatPdf(one, copies);
  } catch (e) {
    throw new Fatal(String(/** @type {any} */ (e).message || e));
  }
  const { pdf, pages } = out;
  if (pages * copies > MAX_PAGES) throw new Fatal(`At most ${MAX_PAGES} pages go in one email.`);
  console.log(`${copies} ${copies === 1 ? 'copy' : 'copies'} of ${pages} ${pages === 1 ? 'page' : 'pages'}: ${pdf.length} bytes.`);
  const name = path.basename(rel);
  const subject = `${dry ? '[Dry run] ' : ''}${name.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ')}`;
  const message = buildMessage({ from: user, to, subject, attachments: [{ name, bytes: pdf }] });
  try {
    await (deps.send || sendMail)({ user, pass, from: user, to, message });
  } catch (e) {
    const why = String(/** @type {any} */ (e).message || 'smtp');
    if (/smtp auth 5\d\d/.test(why)) throw new Fatal(`Gmail refused the sign-in (${why}). Check GMAIL_USER and GMAIL_APP_PASSWORD.`);
    throw new Error(`Gmail did not take the message (${why}).`);
  }
  console.log(dry ? 'Dry run: one copy was emailed to GMAIL_USER.' : `Sent to the printer (${copies} copies).`);
  return { copies, pages, bytes: pdf.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await run(process.env);
  } catch (e) {
    console.log(`::error::The PDF was NOT printed. ${/** @type {any} */ (e).message || e}`);
    process.exitCode = 1;
  }
}

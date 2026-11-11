// The 4 pm handbook sheets (owner 2026-10-18; .github/workflows/handbook-print.yml,
// CLAUDE.md "Handbook sheets"). On a club night this asks the sync Worker for
// TwoTimTwo's handbook check-off report for Cubbies, Sparks and T&T
// (GET /api/v1/print/handbook, worker/src/routes.md 10.12), makes each a
// Letter PDF (a PDF answer is kept as it is; an HTML answer is printed to PDF
// by Chromium), and emails the three in ONE message from the owner's Gmail to
// the downstairs Epson (kvbcdownstairs@print.epsonconnect.com), which prints
// every attachment. Not a club night: exits 0 quietly.
//
// Retries: up to ATTEMPTS (3) tries RETRY_MS (15 min) apart; the last failure
// exits 1 with a plain reason, so GitHub emails the owner. Only a failure from
// BEFORE the mail body was sent is tried again. If Gmail may already have taken
// the mail (a timeout or a closed connection after the body), a second try
// could print the sheets twice, so the job stops and says so (and writes
// `maybe_sent=true` to the step output; the workflow then counts the day as
// sent so the next half-hourly run does not print again).
//
// Deadline: NOT_AFTER (for example 17:00, New York time) is set on scheduled
// runs. It is checked before every try and right before the mail goes, so a
// scheduled run can never print after it. Hand-started runs leave it empty.
//
// PRIVACY: the sheets carry children's full names (the owner approved them on
// paper via Epson's cloud). Nothing here logs a body, a file's text or the
// server's words: only club, HTTP status, content type and byte size. The
// PDFs live in memory and are never written to disk or uploaded.
//
// Env: SITE_ORIGIN (default https://awana.kvbchurch.org), HANDBOOK_TOKEN,
// GMAIL_USER, GMAIL_APP_PASSWORD, TO (default the Epson), DRY_RUN ('true':
// email the PDFs to GMAIL_USER instead), ATTEMPTS, RETRY_MS, TWOTIMTWO_ORIGIN
// (the report's <base>, default https://kvbchurch.twotimtwo.com/), NOT_AFTER
// ('HH:MM' New York time, empty = no deadline).

import fs from 'node:fs';
import { ADDRESS_RE, EPSON_ADDRESS, buildMessage, recipientAllowed, sendMail } from './smtp.mjs';

export const EPSON = EPSON_ADDRESS;
/** [club query value, name on the file], in print order. */
export const CLUBS = [['cubbies', 'Cubbies'], ['sparks', 'Sparks'], ['tnt', 'T&T']];
/** Letter at 96 px an inch, 0.4 inch margins. */
const MARGIN_IN = 0.4;
const PRINTABLE_PX = Math.round((8.5 - 2 * MARGIN_IN) * 96);

const log = (/** @type {string} */ s) => console.log(s);

/** A failure that another try 15 minutes later cannot fix. */
class Fatal extends Error {}

/** The Gmail may already have the mail: never send again. */
class MaybeSent extends Error {}

/** Past the deadline: stop without sending. */
class TooLate extends Error {}

/** The clock in New York as minutes after midnight. @param {Date} d */
function easternMinutes(d) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const get = (/** @type {string} */ t) => Number(parts.find((p) => p.type === t)?.value);
  return get('hour') * 60 + get('minute');
}

/**
 * Is it at or past the deadline? `notAfter` is 'HH:MM' in New York time; empty
 * or unreadable means no deadline. Pure.
 * @param {string|undefined} notAfter @param {Date} [now]
 */
export function pastDeadline(notAfter, now = new Date()) {
  const m = /^(\d{1,2}):(\d\d)$/.exec(String(notAfter || '').trim());
  if (!m) return false;
  return easternMinutes(now) >= Number(m[1]) * 60 + Number(m[2]);
}

/** Today's date in Eastern time, YYYY-MM-DD. @param {Date} [d] */
export function easternDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** @param {string} name @param {string} date */
export const fileNameFor = (name, date) => `${name} handbook ${date}.pdf`;

/** @param {Uint8Array} bytes */
export const isPdf = (bytes) => bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;

/**
 * What one Worker answer is. Pure.
 * @param {{ status: number, contentType: string, bytes: Uint8Array }} r
 * @returns {{ kind: 'pdf'|'html'|'noClub' } | { kind: 'busy', waitMs: number } | { kind: 'error', reason: string, fatal: boolean }}
 */
export function classify({ status, contentType, bytes }) {
  const type = String(contentType || '').toLowerCase();
  /** @type {any} */
  let body = null;
  if (type.includes('json')) {
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { body = null; }
  }
  if (status === 200 && body && body.noClub === true) return { kind: 'noClub' };
  if (status === 200 && (type.includes('application/pdf') || isPdf(bytes))) return { kind: 'pdf' };
  if (status === 200 && type.includes('html')) return { kind: 'html' };
  const reason = body && typeof body.reason === 'string' ? body.reason : '';
  if (status === 429) return { kind: 'busy', waitMs: Math.min(30_000, Math.max(5_000, Number(body?.retryAfterMs) || 5_000)) };
  if (status === 401) return { kind: 'error', fatal: true, reason: 'The sync service refused the HANDBOOK_TOKEN (401). Check that the GitHub secret HANDBOOK_TOKEN matches the one the Worker has (re-run CI with "deploy_worker" ticked after changing it).' };
  if (status === 503 && reason === 'not-configured') return { kind: 'error', fatal: true, reason: 'The sync service has no HANDBOOK_TOKEN (or no TwoTimTwo sign-in) set (503 not-configured). Re-run CI with "deploy_worker" ticked so the Worker gets its secrets.' };
  if (status === 404) return { kind: 'error', fatal: true, reason: 'The sync service has no handbook route (404): is the newest Worker deployed?' };
  if (status === 200) return { kind: 'error', fatal: false, reason: `TwoTimTwo answered with an unexpected kind of file (${type || 'no content type'}).` };
  const words = {
    'signed-out': 'TwoTimTwo signed the sync service out (its password may have changed).',
    'no-meeting': 'TwoTimTwo\'s handbook page has no meeting picked for tonight (no cal_id on the form). Is tonight\'s meeting set up on TwoTimTwo?',
    'twotimtwo-down': 'TwoTimTwo is not answering.',
    'login-refused': 'TwoTimTwo refused the sync service\'s sign-in.',
    'read-busy': 'The sync service\'s TwoTimTwo read clock stayed busy.',
  };
  return { kind: 'error', fatal: false, reason: `${words[/** @type {keyof typeof words} */ (reason)] || 'The sync service could not get the report.'} (HTTP ${status}${reason ? ` ${reason}` : ''})` };
}

/**
 * The report page with a <base> so its stylesheets and pictures load from
 * TwoTimTwo. Pure; the page's text is not looked at.
 * @param {string} html @param {string} origin
 */
export function withBase(html, origin) {
  const tag = `<base href="${origin.replace(/"/g, '')}">`;
  if (/<base\b/i.test(html)) return html;
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (m) => `${m}${tag}`);
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, (m) => `${m}<head>${tag}</head>`);
  return `<!doctype html><html><head>${tag}</head><body>${html}</body></html>`;
}

/**
 * HTML -> one Letter PDF, fitted to the page's width, backgrounds printed.
 * No script runs; only stylesheets, pictures and fonts from TwoTimTwo's own
 * host load (no cookies are sent: anything that needs a sign-in just fails).
 * @param {any} browser @param {string} html @param {string} origin
 */
async function htmlToPdf(browser, html, origin) {
  const host = new URL(origin).host;
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: PRINTABLE_PX, height: 1000 } });
  try {
    const page = await context.newPage();
    await page.route('**/*', (route) => {
      const req = route.request();
      let ok = false;
      try {
        const u = new URL(req.url());
        ok = u.protocol === 'https:' && u.host === host && req.method() === 'GET'
          && ['stylesheet', 'image', 'font'].includes(req.resourceType());
      } catch { ok = false; }
      return ok ? route.continue() : route.abort();
    });
    await page.setContent(withBase(html, origin), { waitUntil: 'load', timeout: 60_000 });
    await page.emulateMedia({ media: 'print' });
    const width = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0));
    const scale = Math.max(0.1, Math.min(1, PRINTABLE_PX / Math.max(1, width)));
    const pdf = await page.pdf({
      format: 'Letter', printBackground: true, scale,
      margin: { top: `${MARGIN_IN}in`, bottom: `${MARGIN_IN}in`, left: `${MARGIN_IN}in`, right: `${MARGIN_IN}in` },
    });
    return new Uint8Array(pdf);
  } finally {
    await context.close();
  }
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One club's answer from the Worker (a busy read clock is waited out a few times).
 * `test` (a hand-started test run) asks even on a day with no club.
 * @param {{ site: string, token: string, test?: boolean }} o @param {string} club
 */
async function askWorker({ site, token, test }, club) {
  const url = `${site.replace(/\/+$/, '')}/api/v1/print/handbook?club=${encodeURIComponent(club)}${test ? '&test=1' : ''}`;
  for (let i = 0; ; i++) {
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120_000) });
    } catch (e) {
      throw new Error(`Could not reach the sync service (${/** @type {any} */ (e).name || 'network'}).`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || '';
    log(`${club}: HTTP ${res.status}, ${contentType || 'no content type'}, ${bytes.length} bytes`);
    const what = classify({ status: res.status, contentType, bytes });
    if (what.kind === 'busy' && i < 4) { await sleep(what.waitMs); continue; }
    if (what.kind === 'busy') throw new Error('The sync service\'s TwoTimTwo read clock stayed busy.');
    if (what.kind === 'error') throw what.fatal ? new Fatal(what.reason) : new Error(what.reason);
    return { kind: what.kind, bytes };
  }
}

/**
 * One whole try: ask, make PDFs, send. Returns 'no-club' or 'sent'.
 * `send` is for the tests (smtp.mjs sendMail otherwise).
 * @param {Record<string, string|undefined>} env @param {{ send?: typeof sendMail, now?: () => Date }} [deps]
 */
export async function attempt(env, { send = sendMail, now = () => new Date() } = {}) {
  const site = env.SITE_ORIGIN || 'https://awana.kvbchurch.org';
  const token = env.HANDBOOK_TOKEN || '';
  const user = env.GMAIL_USER || '';
  const pass = (env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  const dry = env.DRY_RUN === 'true';
  const to = dry ? user : (env.TO || EPSON);
  const origin = env.TWOTIMTWO_ORIGIN || 'https://kvbchurch.twotimtwo.com/';
  if (!token) throw new Fatal('The GitHub secret HANDBOOK_TOKEN is not set.');
  if (!user || !pass) throw new Fatal('The GitHub secrets GMAIL_USER and GMAIL_APP_PASSWORD must both be set.');
  if (!ADDRESS_RE.test(user)) throw new Fatal('GMAIL_USER is not a plain email address.');
  if (!ADDRESS_RE.test(to)) throw new Fatal('The "to" address is not a plain email address.');
  if (!recipientAllowed(to, user)) throw new Fatal('The "to" address must be the downstairs Epson or GMAIL_USER; nothing was sent.');

  const tooLate = `It is past ${env.NOT_AFTER} in New York, so nothing was sent.`;
  if (pastDeadline(env.NOT_AFTER, now())) throw new TooLate(tooLate);
  const date = easternDate();
  /** @type {{ name: string, bytes: Uint8Array }[]} */
  const files = [];
  /** @type {any} */
  let browser = null;
  try {
    for (const [club, name] of CLUBS) {
      const got = await askWorker({ site, token, test: env.TEST === 'true' }, club);
      if (got.kind === 'noClub') return 'no-club';
      let bytes = got.bytes;
      if (got.kind === 'html') {
        if (!browser) {
          const { chromium } = await import('playwright');
          browser = await chromium.launch();
        }
        bytes = await htmlToPdf(browser, new TextDecoder().decode(got.bytes), origin);
        log(`${club}: printed the page to a PDF, ${bytes.length} bytes`);
      }
      files.push({ name: fileNameFor(name, date), bytes });
    }
  } finally {
    if (browser) await browser.close();
  }

  // Asking the Worker and printing PDFs can take a while: look at the clock again.
  if (pastDeadline(env.NOT_AFTER, now())) throw new TooLate(tooLate);
  const message = buildMessage({ from: user, to, subject: `${dry ? '[Dry run] ' : ''}Handbook sheets ${date}`, attachments: files });
  log(`Sending ${files.length} PDFs (${files.map((f) => f.bytes.length).join(', ')} bytes) to ${dry ? 'GMAIL_USER (dry run)' : to}.`);
  try {
    await send({ user, pass, from: user, to, message });
  } catch (e) {
    const why = String(/** @type {any} */ (e).message || 'smtp');
    if (/** @type {any} */ (e).afterData) throw new MaybeSent(`Gmail went quiet after the message was sent (${why}). The sheets may already have printed, so this job will not try again. Look at the printer before printing by hand.`);
    if (/smtp auth 5\d\d/.test(why)) throw new Fatal(`Gmail refused the sign-in (${why}). Check GMAIL_USER and GMAIL_APP_PASSWORD (an app password, made under the Google account's Security → App passwords).`);
    throw new Error(`Gmail did not take the message (${why}).`);
  }
  return 'sent';
}

/** Tell the workflow the mail may be out (a step output; nothing else). */
function markMaybeSent(env) {
  if (!env.GITHUB_OUTPUT) return;
  try { fs.appendFileSync(env.GITHUB_OUTPUT, 'maybe_sent=true\n'); } catch { /* the log line is enough */ }
}

/**
 * The whole job with its retries. Returns the exit code.
 * `deps` is for the tests: send, sleep and now.
 * @param {Record<string, string|undefined>} env @param {{ send?: typeof sendMail, sleep?: (ms: number) => Promise<void>, now?: () => Date }} [deps]
 */
export async function run(env, deps = {}) {
  const wait = deps.sleep || sleep;
  const now = deps.now || (() => new Date());
  const attempts = Math.max(1, Number(env.ATTEMPTS) || 3);
  const retryMs = Number.isFinite(Number(env.RETRY_MS)) && env.RETRY_MS !== '' && env.RETRY_MS !== undefined ? Number(env.RETRY_MS) : 15 * 60 * 1000;
  let last = '';
  for (let n = 1; n <= attempts; n++) {
    try {
      // Checked before every try, retries included.
      if (pastDeadline(env.NOT_AFTER, now())) throw new TooLate(`It is past ${env.NOT_AFTER} in New York, so nothing was sent.`);
      const done = await attempt(env, { send: deps.send, now });
      if (done === 'no-club') { log('No club tonight: nothing to print.'); return 0; }
      log(env.DRY_RUN === 'true' ? 'Dry run: the three sheets were emailed to GMAIL_USER.' : 'The three handbook sheets were emailed to the downstairs printer.');
      return 0;
    } catch (e) {
      last = String(/** @type {any} */ (e).message || e);
      log(`Try ${n} of ${attempts} failed: ${last}`);
      if (e instanceof MaybeSent) markMaybeSent(env);
      if (e instanceof Fatal || e instanceof MaybeSent || e instanceof TooLate) break;
      if (n < attempts) { log(`Trying again in ${Math.round(retryMs / 60000)} minutes.`); await wait(retryMs); }
    }
  }
  console.log(`::error::The handbook sheets were NOT printed (or may have printed once, see above). ${last}`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await run(process.env);
}

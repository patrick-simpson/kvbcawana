// @ts-check
// The screen's half of the sync service (worker/): sign in with the church
// passphrase, then fetch, push and follow everything the screens share.
//
// Owner, 2026-10-01: "type kennebec and have it sync everything up", with the
// check-in laptop off. The Worker's address is in shared/sync.json (written by
// deploy-worker.yml); until it has one, this screen keeps using the print
// server's display login exactly as before.
//
// THE SESSION IS A SECRET and lives in its own storage slot, for the same
// three reasons as the display key (src/lib/displayKey.js): `?config=<url>`,
// Settings → Export and the URL flags all work on the config object, and a
// credential must ride none of them. syncService.test.js pins that.
//
// Nothing the Worker sends is trusted as-is: shared settings and the slide
// deck go through the SAME allowlist sanitizers as a live frame (the caller
// hands them to dispatchEvent), the calendar through sanitizeFeed, and the
// template through sanitizeTemplate.

import {
  buildRequest,
  isValidSession,
  isValidSyncUrl,
  parseLoginResponse,
  parseSyncIndex,
  publishRequest,
  readResponse,
  signInWithPassphrase,
  UNREACHABLE,
} from '../../shared/sync-protocol.js';
import { deriveAuthKey } from '../../shared/cloud-crypto.js';
import { saveDisplayKey } from './displayKey.js';
import { sanitizeTemplate } from './syncSpecs.js';
import { timedFetch } from './timedFetch.js';
import { deviceHeaders } from './deviceId.js';

export const SYNC_SESSION_STORAGE = 'awanaSyncSession.v1';
/** The last address shared/sync.json gave (not a secret), for offline boots. */
export const SYNC_URL_STORAGE = 'awanaSyncUrl.v1';
/** This tab's own sign-in / sign-out announcements. */
export const SYNC_CHANGE_EVENT = 'awana-sync-change';
/** The Worker's plaintext doorbell (no content: "fetch from me"). */
export const SYNC_CHANNEL = 'awana-sync';
export const SYNC_EVENT = 'changed';
/** How often a signed-in screen re-reads the state, whatever the doorbell said. */
export const SYNC_POLL_MS = 10 * 60 * 1000;

// The address / session rules, request building and answer parsing are the
// family's one sync protocol (shared/sync-protocol.js, which the print server
// and the Electron app use too); this file adds the browser's storage, its
// offline URL cache and its fetch.
export { isValidSyncUrl };

/** @returns {string} */
export function loadSyncSession() {
  try {
    const s = String(localStorage.getItem(SYNC_SESSION_STORAGE) || '').trim();
    return isValidSession(s) ? s : '';
  } catch {
    return '';
  }
}

/** @param {string} value '' signs out @returns {boolean} false when storage is blocked */
export function saveSyncSession(value) {
  try {
    if (value) localStorage.setItem(SYNC_SESSION_STORAGE, value);
    else localStorage.removeItem(SYNC_SESSION_STORAGE);
    window.dispatchEvent(new Event(SYNC_CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

function loadCachedUrl() {
  try {
    const u = localStorage.getItem(SYNC_URL_STORAGE) || '';
    return isValidSyncUrl(u) ? u : '';
  } catch {
    return '';
  }
}

/** @param {string} url */
function cacheUrl(url) {
  try {
    if (url) localStorage.setItem(SYNC_URL_STORAGE, url);
    else localStorage.removeItem(SYNC_URL_STORAGE);
  } catch { /* the next boot asks shared/sync.json again */ }
}

/**
 * Where the Worker lives: shared/sync.json from this site, else the last copy
 * this screen saw. '' means "no sync service yet" (keep the old login).
 * @param {{fetchFn?: typeof fetch, base?: string}} [opts]
 * @returns {Promise<string>}
 */
export async function resolveSyncUrl(opts = {}) {
  const fetchFn = opts.fetchFn || fetch;
  const base = opts.base ?? import.meta.env.BASE_URL;
  try {
    const res = await fetchFn(`${base}shared/sync.json`, { cache: 'no-cache' });
    if (res.ok) {
      const url = parseSyncIndex(await res.json());
      if (url !== null) {
        cacheUrl(url);
        return url;
      }
    }
  } catch { /* offline: fall back to the last known address */ }
  return loadCachedUrl();
}

/**
 * One request to the Worker. Never throws.
 * @param {string} base
 * @param {string} path
 * @param {{method?: string, body?: unknown, session?: string, fetchFn?: typeof fetch}} [opts]
 * @returns {Promise<{ok: boolean, status: number, body: any}>} status 0 = unreachable
 */
export async function syncRequest(base, path, opts = {}) {
  const fetchFn = opts.fetchFn || timedFetch;
  const req = buildRequest(base, path, opts);
  // Who is asking, for the change log (routes.md 10.1). Only a signed-in call
  // carries it: a sign-in has no session, so no device either.
  const headers = opts.session ? { ...req.init.headers, ...deviceHeaders() } : req.init.headers;
  try {
    return await readResponse(await fetchFn(req.url, { ...req.init, headers, cache: 'no-store' }));
  } catch {
    return { ...UNREACHABLE };
  }
}

/**
 * @typedef {{ok: true, displayKey: string, state: any, template: Record<string, unknown>}} LoginOk
 * @typedef {{ok: false, reason: 'wrong'|'locked'|'unreachable'|'not-set-up'|'storage'|'rejected', message: string, triesLeft?: number, retryAfterSec?: number}} LoginErr
 */

/**
 * Sign this screen in (passphrase v2: the passphrase is turned into an authKey
 * HERE and only the authKey is sent, once the service is on v2). On success the
 * session and the display key are saved in their own slots; the caller applies
 * the template and the state (it owns the config store and the dispatch path).
 * The derivation is one 600000-round PBKDF2 per typed passphrase (a sign-in is
 * a person's act); nothing re-derives per request, because every later call
 * rides the session.
 * @param {string} base
 * @param {string} passphrase
 * @param {{fetchFn?: typeof fetch, seedKey?: string}} [opts]
 * @returns {Promise<LoginOk | LoginErr>}
 */
export async function syncLogin(base, passphrase, opts = {}) {
  const { res } = await signInWithPassphrase({
    request: (path, o) => syncRequest(base, path, { ...o, fetchFn: opts.fetchFn }),
    derive: deriveAuthKey,
    passphrase,
    seedKey: opts.seedKey,
  });
  const r = parseLoginResponse(res, { who: 'screen' });
  if (!r.ok) {
    const { reason, message } = r;
    return {
      ok: false,
      reason,
      message,
      ...(r.triesLeft !== undefined ? { triesLeft: r.triesLeft } : {}),
      ...(r.retryAfterSec !== undefined ? { retryAfterSec: r.retryAfterSec } : {}),
    };
  }
  if (!saveDisplayKey(r.displayKey) || !saveSyncSession(r.session)) {
    return { ok: false, reason: 'storage', message: 'This screen cannot save its sign-in. Browser storage is blocked.' };
  }
  return {
    ok: true,
    displayKey: r.displayKey,
    state: r.state,
    template: sanitizeTemplate(r.state?.template?.config),
  };
}

/** Sign out: forget the session (the display key stays, so names keep working). */
export function syncLogout() {
  saveSyncSession('');
}

/**
 * The template keys to apply to THIS screen: only those it has no value of
 * its own for, so signing an already-configured screen in never undoes a
 * choice someone made on it.
 * @param {Record<string, unknown>} template
 * @param {Record<string, unknown>} deviceOverrides
 */
export function templatePatch(template, deviceOverrides) {
  /** @type {Record<string, unknown>} */
  const patch = {};
  for (const [key, value] of Object.entries(sanitizeTemplate(template))) {
    if (!Object.prototype.hasOwnProperty.call(deviceOverrides || {}, key)) patch[key] = value;
  }
  return patch;
}

/**
 * Turn the Worker's state into the two wire payloads the screen already knows
 * how to take, so they pass the same sanitizers a live frame does: one
 * `settings` payload and one single-chunk `slides` payload (or null).
 * @param {any} state
 */
export function wirePayloads(state) {
  const settings = state?.settings && typeof state.settings === 'object' ? state.settings : null;
  const deck = state?.slides && typeof state.slides === 'object' ? state.slides : null;
  const slides = deck ? {
    deckRev: deck.deckRev,
    publishedAt: deck.publishedAt,
    seq: 0,
    total: 1,
    slides: Array.isArray(deck.slides) ? deck.slides : [],
  } : null;
  return { settings, slides };
}

/**
 * The publish paths, in the shapes publishSettings() / publishDeck() return,
 * so the callers' status copy does not care which path it took.
 * @param {string} base
 * @param {string} session
 * @param {'settings'|'slides'} kind
 * @param {unknown} payload
 * @param {{fetchFn?: typeof fetch}} [opts]
 */
export async function syncPublish(base, session, kind, payload, opts = {}) {
  const { path, method, body } = publishRequest(kind, payload);
  const res = await syncRequest(base, path, { method, body, session, fetchFn: opts.fetchFn });
  if (res.status === 0) {
    return { ok: false, reason: 'unreachable', message: 'Could not reach the sync service, so this change stayed on this screen. It is sent the next time you change something with the internet up.' };
  }
  if (res.status === 401) {
    return { ok: false, reason: 'auth', message: 'This screen is signed out of the sync service. Settings → Setup: type the passphrase again.' };
  }
  if (!res.ok) {
    return { ok: false, reason: 'rejected', message: typeof res.body?.error === 'string' ? res.body.error : `HTTP ${res.status}` };
  }
  const b = res.body || {};
  return kind === 'settings'
    ? { ok: true, rev: Number(b.rev) || 0, publishedAt: String(b.publishedAt || ''), keyCount: Number(b.keyCount) || 0 }
    : { ok: true, deckRev: Number(b.deckRev) || 0, publishedAt: String(b.publishedAt || ''), slideCount: Number(b.slideCount) || 0, droppedCount: Number(b.droppedCount) || 0 };
}

/** The words for the Worker's fixed error codes (cloud check-in). */
const CLOUD_ERRORS = {
  'login-refused': 'TwoTimTwo refused the user name or password. Check the two secrets in GitHub (and that the user can sign in on TwoTimTwo), then redeploy the Worker.',
  'twotimtwo-down': 'TwoTimTwo is not answering properly right now. Try again in a few minutes.',
  timeout: 'TwoTimTwo took too long to answer. Try again in a few minutes.',
  network: 'The sync service could not reach TwoTimTwo. Try again in a few minutes.',
  'signed-out': 'TwoTimTwo signed the user in but then would not show the report. Check the user has the Record Checkin role.',
  'report-unreadable': 'Signed in, but the check-in report did not look like the report. TwoTimTwo may have changed the page.',
  'off-site-redirect': 'TwoTimTwo sent the service to another website, so it stopped. Check TWOTIMTWO_HOST is kvbchurch.twotimtwo.com.',
};

/** @param {unknown} error @param {any} st */
function cloudErrorWords(error, st) {
  if (error === 'login-backoff') {
    const wait = Math.max(1, Math.ceil((Number(st?.loginBlockedForSec) || 0) / 60));
    return `TwoTimTwo refused the last sign-in, so the service is waiting ${wait} minute${wait === 1 ? '' : 's'} before trying again (it never hammers their login).`;
  }
  return CLOUD_ERRORS[/** @type {keyof typeof CLOUD_ERRORS} */ (String(error))] || `It did not work (${String(error).slice(0, 40)}).`;
}

/** "Wednesday, Oct 7" for a YYYY-MM-DD. @param {unknown} date */
function clubNightWords(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  if (!m) return 'the last club night';
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
}

/** @param {any} page */
function checkinPageWords(page) {
  if (!page || typeof page !== 'object') return '';
  return page.ok
    ? ` The check-in page read too (meeting ${String(page.calendarId || '?').slice(0, 12)}, ${Number(page.events) || 0} check-in items).`
    : ' But the check-in page could not be read; check the user has the Record Checkin role.';
}

/** @param {unknown} n */
const childrenWords = (n) => `${n} child${n === 1 ? '' : 'ren'} checked in`;

/**
 * The club-night test (the Worker's {test: true} read): the most recent club
 * night's report, so the count can be held against the laptop's for that night.
 * @param {any} test @param {boolean} throttled @param {any} st
 * @returns {{ok: boolean, text: string}}
 */
function describeClubNightTest(test, throttled, st) {
  const lead = throttled ? 'Read a moment ago (TwoTimTwo allows one read every 5 s): ' : '';
  const day = clubNightWords(test.date);
  if (!test.ok) {
    const shape = test.shape && typeof test.shape === 'object' ? test.shape : null;
    if (test.error === 'report-unreadable' && shape) {
      const title = String(shape.title || '').slice(0, 80) || 'no title';
      return {
        ok: false,
        text: `${lead}Signed in to TwoTimTwo, but the report for ${day} did not look like the report (page “${title}”, ` +
          `${Number(shape.tables) || 0} tables, ${Number(shape.clubTables) || 0} with a club). If club met that night, ` +
          'TwoTimTwo has changed the page: send this line to whoever looks after the screens.',
      };
    }
    return { ok: false, text: lead + cloudErrorWords(test.error, st) };
  }
  const n = Number.isInteger(test.checkedIn) ? test.checkedIn : 0;
  const partial = test.partial ? ' (TwoTimTwo listed more than could be read, so this is short)' : '';
  const page = checkinPageWords(test.checkinPage);
  return {
    ok: !test.partial && (!test.checkinPage || test.checkinPage.ok === true),
    text: `${lead}Signed in to TwoTimTwo and read the report for ${day}: ${childrenWords(n)}${partial}.${page} ` +
      'It should match the laptop’s count for that night.',
  };
}

/**
 * What the Setup card's "Test TwoTimTwo sign-in" says about the Worker's
 * answer to POST /v1/cloud/read-now (ROADMAP.md#cloud-check-in, phase 1). Pure. The
 * answer carries counts and fixed codes only, never a name.
 * @param {{ok: boolean, status: number, body: any}} res
 * @returns {{ok: boolean, text: string}}
 */
export function describeCloudTest(res) {
  if (res.status === 0) return { ok: false, text: 'Could not reach the sync service. Check this screen’s internet connection.' };
  if (res.status === 401) return { ok: false, text: 'This screen is signed out. Type the passphrase again above, then test.' };
  if (res.status === 404) return { ok: false, text: 'The sync service does not have cloud check-in yet. It arrives with its next deploy.' };
  const body = res.body && typeof res.body === 'object' ? res.body : {};
  const st = body.status && typeof body.status === 'object' ? body.status : {};
  if (!res.ok) return { ok: false, text: typeof body.error === 'string' ? body.error : `The sync service answered HTTP ${res.status}.` };
  if (body.error === 'off') return { ok: false, text: 'Cloud check-in is switched off on the sync service (CLOUD_CHECKIN in wrangler.toml).' };
  if (body.error === 'not-configured') {
    return { ok: false, text: 'The sync service has no TwoTimTwo user yet. Add the TWOTIMTWO_USERNAME and TWOTIMTWO_PASSWORD secrets in GitHub, then run CI with "Redeploy the sync Worker" ticked.' };
  }
  if (body.test && typeof body.test === 'object') return describeClubNightTest(body.test, Boolean(body.throttled), st);
  // A read in the last 5 s (TwoTimTwo's limit, all reads combined) is not repeated: report that one.
  const error = body.throttled ? st.lastError : body.error;
  const lead = body.throttled ? 'Read a moment ago (TwoTimTwo allows one read every 5 s): ' : '';
  if (error) return { ok: false, text: lead + cloudErrorWords(error, st) };
  const n = Number.isInteger(st.checkedIn) ? st.checkedIn : null;
  const count = n === null ? 'the report was only partly readable, so no count yet' : `${childrenWords(n)} today`;
  const page = st.checkinPage;
  return { ok: !page || page.ok, text: `${lead}Signed in to TwoTimTwo and read today’s report: ${count}.${checkinPageWords(page)}` };
}

/**
 * What "Print BARF Bag labels" says about the Worker's answer to POST
 * /v1/cloud/barf-bags (BARF Night, owner 2026-10-11). Pure.
 * @param {{ok: boolean, status: number, body: any}} res
 * @returns {{ok: boolean, text: string}}
 */
export function describeBarfBags(res) {
  if (res.status === 0) return { ok: false, text: 'Could not reach the sync service. Check this screen’s internet connection.' };
  if (res.status === 401) return { ok: false, text: 'This screen is signed out. Type the passphrase again above, then try.' };
  if (res.status === 404) return { ok: false, text: 'The sync service does not have BARF Bag labels yet. They arrive with its next deploy.' };
  const b = res.body && typeof res.body === 'object' ? res.body : {};
  if (!res.ok) return { ok: false, text: typeof b.error === 'string' ? b.error : `The sync service answered HTTP ${res.status}.` };
  const n = (/** @type {unknown} */ x) => (Number.isInteger(x) ? /** @type {number} */ (x) : 0);
  const unnamed = n(b.unnamed) ? ` ${n(b.unnamed)} friend${n(b.unnamed) === 1 ? ' was' : 's were'} checked in at TwoTimTwo’s desk box with no name, so no label for ${n(b.unnamed) === 1 ? 'them' : 'those'}.` : '';
  if (b.ok) {
    return { ok: true, text: `Sent ${n(b.labels)} BARF Bag label${n(b.labels) === 1 ? '' : 's'} to the label printer as one job: ${n(b.kids)} child${n(b.kids) === 1 ? '' : 'ren'} and ${n(b.friends)} friend${n(b.friends) === 1 ? '' : 's'}.${unnamed}` };
  }
  if (b.reason === 'none') return { ok: false, text: 'Nobody has been checked in with Brought a friend tonight yet.' };
  if (b.reason === 'laptop-off') return { ok: false, text: 'The check-in laptop is not on, so nothing could print. Turn it on (with the label printer), then press again.' };
  return { ok: false, text: 'Too many requests are waiting for the laptop. Try again in a moment.' };
}

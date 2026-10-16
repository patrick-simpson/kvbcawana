// @ts-check
// The browser's half of the check-in history (ROADMAP.md#online-check-in, P6),
// on shared/cloud-crypto.js. The Worker only stores sealed rows; every unwrap
// and every open happens HERE.
//
// THE PASSPHRASE IS NEVER KEPT. unlockHistory() turns it into a NON-extractable
// private key, held in this module's memory only (a reload forgets it; nothing
// goes to localStorage, sessionStorage or IndexedDB, and the key cannot be
// exported even by this page). A wrong passphrase, or a key that is not the
// stored history:pub's, unlocks nothing.

import { keyRing, openRow, rewrapPrivateKey, unwrapPrivateKey } from '../../../shared/cloud-crypto.js';
import { syncRequest } from './syncService.js';

/** @typedef {{ privateKey: CryptoKey, publicKey: string, kid: string }} Ring */
/** @typedef {{ id: string, kind: string, night: string, record: Record<string, any> }} OpenedRow */

/** @type {Ring|null} */
let held = null;

/** Is the history open on this page right now? */
export function historyUnlocked() { return held !== null; }

/** Forget the key (sign-out, "Lock history"). */
export function lockHistory() { held = null; }

/** The words for a failed request. @param {{status: number, body: any}} res */
function problem(res) {
  const no = /** @type {const} */ ({ ok: false });
  if (res.status === 0) return { ...no, reason: 'unreachable', message: 'Could not reach the sync service.' };
  if (res.status === 401) return { ...no, reason: 'auth', message: 'This page is signed out of the sync service. Sign in again under Setup.' };
  if (res.status === 503 && res.body?.reason === 'history-off') return { ...no, reason: 'history-off', message: 'History storage is not set up yet.' };
  return { ...no, reason: 'rejected', message: typeof res.body?.error === 'string' ? res.body.error : `HTTP ${res.status}` };
}

/**
 * Fetch the wrapped history key and open it with the passphrase.
 * @param {string} base @param {string} session @param {string} passphrase
 * @param {{ fetchFn?: typeof fetch }} [opts]
 * @returns {Promise<{ ok: true, kid: string } | { ok: false, reason: string, message: string }>}
 */
export async function unlockHistory(base, session, passphrase, opts = {}) {
  const res = await syncRequest(base, '/v1/history/key', { session, fetchFn: opts.fetchFn });
  if (res.status === 404) return { ok: false, reason: 'no-key', message: 'There is no history yet: no check-in has been saved.' };
  if (!res.ok) return problem(res);
  const { pub, wrapped } = res.body || {};
  const privateKey = await unwrapPrivateKey(wrapped, passphrase, pub).catch(() => null);
  if (!privateKey) return { ok: false, reason: 'wrong', message: 'That is not the passphrase for the history.' };
  held = await keyRing(privateKey, pub);
  return { ok: true, kid: held.kid };
}

/**
 * The nights that have rows: [{night, rows, kinds}], newest first.
 * @param {string} base @param {string} session @param {{ fetchFn?: typeof fetch }} [opts]
 */
export async function fetchNights(base, session, opts = {}) {
  const res = await syncRequest(base, '/v1/history/nights', { session, fetchFn: opts.fetchFn });
  return res.ok && Array.isArray(res.body) ? { ok: true, nights: /** @type {any[]} */ (res.body) } : problem(res);
}

/**
 * night_summary lines (plaintext numbers).
 * @param {string} base @param {string} session @param {{ fetchFn?: typeof fetch }} [opts]
 */
export async function fetchSummary(base, session, opts = {}) {
  const res = await syncRequest(base, '/v1/history/summary', { session, fetchFn: opts.fetchFn });
  return res.ok && Array.isArray(res.body) ? { ok: true, lines: /** @type {any[]} */ (res.body) } : problem(res);
}

/**
 * One night's rows, opened. A row that will not open (damaged, or sealed to
 * another key) is counted, never shown.
 * @param {string} base @param {string} session @param {string} night
 * @param {{ fetchFn?: typeof fetch }} [opts]
 * @returns {Promise<{ ok: true, rows: OpenedRow[], unreadable: number } | { ok: false, reason: string, message: string }>}
 */
export async function fetchNightRows(base, session, night, opts = {}) {
  if (!held) return { ok: false, reason: 'locked', message: 'Type the passphrase to open the history.' };
  /** @type {OpenedRow[]} */
  const rows = [];
  let unreadable = 0;
  let after = '';
  for (let page = 0; page < 40; page++) {
    const res = await syncRequest(base, `/v1/history/rows?night=${encodeURIComponent(night)}&limit=500${after ? `&after=${after}` : ''}`, { session, fetchFn: opts.fetchFn });
    if (!res.ok) return problem(res);
    for (const row of res.body.rows || []) {
      const record = await openRow(held, row).catch(() => null);
      if (record && typeof record === 'object') rows.push({ id: row.id, kind: row.kind, night: row.night, record: /** @type {Record<string, any>} */ (record) });
      else unreadable += 1;
    }
    if (!res.body.next) break;
    after = res.body.next;
  }
  rows.sort((a, b) => (Number(a.record.ts) || 0) - (Number(b.record.ts) || 0));
  return { ok: true, rows, unreadable };
}

/**
 * The passphrase change's half (settings page): re-wrap the history key under
 * the NEW passphrase BEFORE anything is changed. rewrapPrivateKey opens the
 * wrap with the old passphrase, wraps again with a fresh salt and IV, and
 * opens that result with the new passphrase and checks it is history:pub's key;
 * only then is the new wrap handed back, to ride in the same POST that changes
 * the passphrase (the Worker stores both in one atomic put). Any failure
 * returns ok:false and the caller sends NOTHING, so the history is never left
 * behind a word nobody knows.
 * @param {string} base @param {string} session @param {string} oldPassphrase @param {string} newPassphrase
 * @param {{ fetchFn?: typeof fetch }} [opts]
 * @returns {Promise<{ ok: true, wrapped: any|null } | { ok: false, reason: string, message: string }>}
 */
export async function rewrapHistoryKey(base, session, oldPassphrase, newPassphrase, opts = {}) {
  const res = await syncRequest(base, '/v1/history/key', { session, fetchFn: opts.fetchFn });
  if (res.status === 404) return { ok: true, wrapped: null };   // no history yet: nothing to carry over
  if (!res.ok) return problem(res);
  const { pub, wrapped } = res.body || {};
  const next = await rewrapPrivateKey(wrapped, oldPassphrase, newPassphrase, pub).catch(() => null);
  if (!next) {
    return { ok: false, reason: 'wrong', message: 'The passphrase was not changed: the saved history could not be moved to the new word. Check the current passphrase and try again.' };
  }
  return { ok: true, wrapped: next };
}

/**
 * After a change: is the history key stored under the new wrap? (An old
 * service that ignores `wrapped` would leave the history behind the old word.)
 * @param {string} base @param {string} session @param {any} sent
 * @param {{ fetchFn?: typeof fetch }} [opts]
 */
export async function historyWrapLanded(base, session, sent, opts = {}) {
  const res = await syncRequest(base, '/v1/history/key', { session, fetchFn: opts.fetchFn });
  return res.ok && res.body?.wrapped?.ct === sent?.ct;
}

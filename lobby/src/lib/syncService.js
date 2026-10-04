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
// deck go through the SAME allowlist sanitizers as a Pusher frame (the caller
// hands them to dispatchEvent), the calendar through sanitizeFeed, and the
// template through sanitizeTemplate.

import { saveDisplayKey } from './displayKey.js';
import { isPlausibleKey } from './envelope.js';
import { normalizeSyncPassphrase, sanitizeTemplate } from './syncSpecs.js';
import { timedFetch } from './timedFetch.js';

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

const SESSION_RE = /^v1\.\d+\.\d+\.[A-Za-z0-9_-]{20,}$/;
const URL_MAX = 200;

/** @param {unknown} value */
export function isValidSyncUrl(value) {
  if (typeof value !== 'string' || !value || value.length > URL_MAX) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.search && !u.hash && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** @returns {string} */
export function loadSyncSession() {
  try {
    const s = String(localStorage.getItem(SYNC_SESSION_STORAGE) || '').trim();
    return SESSION_RE.test(s) ? s : '';
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
      const body = await res.json();
      const url = typeof body?.url === 'string' ? body.url.trim().replace(/\/+$/, '') : '';
      if (url === '' || isValidSyncUrl(url)) {
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
  /** @type {Record<string, string>} */
  const headers = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.session) headers.Authorization = `Bearer ${opts.session}`;
  try {
    const res = await fetchFn(`${base}${path}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: 'no-store',
    });
    /** @type {any} */
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

/**
 * @typedef {{ok: true, displayKey: string, pusher: {key: string, cluster: string}, state: any, template: Record<string, unknown>}} LoginOk
 * @typedef {{ok: false, reason: 'wrong'|'locked'|'unreachable'|'not-set-up'|'storage'|'rejected', message: string, triesLeft?: number, retryAfterSec?: number}} LoginErr
 */

/**
 * Sign this screen in. On success the session and the display key are saved
 * in their own slots; the caller applies the Pusher keys, the template and the
 * state (it owns the config store and the dispatch path).
 * @param {string} base
 * @param {string} passphrase
 * @param {{fetchFn?: typeof fetch, seedKey?: string}} [opts]
 * @returns {Promise<LoginOk | LoginErr>}
 */
export async function syncLogin(base, passphrase, opts = {}) {
  /** @type {Record<string, unknown>} */
  const body = { passphrase: normalizeSyncPassphrase(passphrase) };
  if (opts.seedKey) body.seedKey = opts.seedKey;
  const res = await syncRequest(base, '/v1/login', { method: 'POST', body, fetchFn: opts.fetchFn });
  if (res.status === 0) return { ok: false, reason: 'unreachable', message: 'Could not reach the sync service. Check this screen\'s internet connection.' };
  if (res.status === 401) {
    const triesLeft = Number(res.body?.triesLeft);
    return { ok: false, reason: 'wrong', message: 'That is not the passphrase.', ...(Number.isFinite(triesLeft) ? { triesLeft } : {}) };
  }
  if (res.status === 429) {
    const retryAfterSec = Number(res.body?.retryAfterSec) || 900;
    return { ok: false, reason: 'locked', message: 'Too many wrong tries.', retryAfterSec };
  }
  if (res.status === 503) return { ok: false, reason: 'not-set-up', message: 'The sync service has no passphrase yet. Finish its setup (worker/README.md).' };
  const b = res.body || {};
  if (!res.ok || typeof b.session !== 'string' || !SESSION_RE.test(b.session) || !isPlausibleKey(b.displayKey)) {
    return { ok: false, reason: 'rejected', message: typeof b.error === 'string' ? b.error : `The sync service answered HTTP ${res.status}.` };
  }
  if (!saveDisplayKey(b.displayKey) || !saveSyncSession(b.session)) {
    return { ok: false, reason: 'storage', message: 'This screen cannot save its sign-in. Browser storage is blocked.' };
  }
  const pusher = {
    key: typeof b.pusher?.key === 'string' ? b.pusher.key.trim().slice(0, 64) : '',
    cluster: typeof b.pusher?.cluster === 'string' ? b.pusher.cluster.trim().slice(0, 32) : '',
  };
  return {
    ok: true,
    displayKey: b.displayKey,
    pusher,
    state: b.state || null,
    template: sanitizeTemplate(b.state?.template?.config),
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
 * how to take, so they pass the same sanitizers a Pusher frame does: one
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
  const res = await syncRequest(base, `/v1/${kind}`, {
    method: 'PUT',
    body: kind === 'settings' ? { settings: payload } : { slides: payload },
    session,
    fetchFn: opts.fetchFn,
  });
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

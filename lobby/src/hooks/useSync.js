// @ts-check
// The sync service, as a tiny store every part of the page can read: where the
// Worker is, whether this screen is signed in, and when it last synced. App
// mounts useSyncDriver() once (it fetches and applies the state); Settings and
// the slide editor read useSync() and call its actions.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  SYNC_CHANGE_EVENT,
  SYNC_POLL_MS,
  loadSyncSession,
  resolveSyncUrl,
  saveSyncSession,
  syncLogin,
  syncLogout,
  syncPublish,
  syncRequest,
  templatePatch,
  wirePayloads,
} from '../lib/syncService.js';
import { normalizeSyncPassphrase, sanitizeTemplate, PASSPHRASE_MIN } from '../lib/syncSpecs.js';
import { saveDisplayKey } from '../lib/displayKey.js';

/**
 * @typedef {{
 *   url: string|null,
 *   signedIn: boolean,
 *   phase: 'idle'|'syncing'|'ok'|'offline'|'expired',
 *   lastSyncAt: number|null,
 *   template: {savedAt: string, config: Record<string, unknown>}|null,
 *   kid: string|null,
 * }} SyncSnapshot
 */

/** @type {SyncSnapshot} */
let snapshot = {
  url: null,
  signedIn: typeof window !== 'undefined' && Boolean(loadSyncSession()),
  phase: 'idle',
  lastSyncAt: null,
  template: null,
  kid: null,
};
/** @type {Set<() => void>} */
const listeners = new Set();
/** @type {Set<(what: string) => void>} */
const doorbellListeners = new Set();
/** @type {((state: any) => void) | null} */
let applier = null;
let inFlight = /** @type {Promise<void> | null} */ (null);

/** @param {Partial<SyncSnapshot>} patch */
function update(patch) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((fn) => fn());
}

/** @param {() => void} fn */
function subscribe(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
const getSnapshot = () => snapshot;

/** Where the Worker is; resolved once per page load (null until known). */
async function ensureUrl() {
  if (snapshot.url !== null) return snapshot.url;
  const url = await resolveSyncUrl();
  update({ url });
  return url;
}

/**
 * Fetch the Worker's state and hand it to App's applier. Coalesced: a burst
 * of doorbells is one request.
 */
export function syncNow() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const url = await ensureUrl();
    const session = loadSyncSession();
    if (!url || !session) return;
    update({ phase: 'syncing' });
    const res = await syncRequest(url, '/v1/state', { session });
    if (res.status === 401) {
      // The passphrase was changed somewhere: this sign-in no longer counts.
      saveSyncSession('');
      update({ signedIn: false, phase: 'expired' });
      return;
    }
    if (!res.ok || !res.body) { update({ phase: 'offline' }); return; }
    applier?.(res.body);
    update({
      phase: 'ok',
      lastSyncAt: Date.now(),
      template: res.body.template && typeof res.body.template === 'object'
        ? { savedAt: String(res.body.template.savedAt || ''), config: sanitizeTemplate(res.body.template.config) }
        : null,
      kid: typeof res.body.kid === 'string' ? res.body.kid : null,
    });
  })().finally(() => { inFlight = null; });
  return inFlight;
}

/**
 * The Worker's doorbell (useSocket hears it on `awana-sync`). The payload says
 * WHAT changed and nothing else; only known words are acted on.
 * @param {unknown} payload
 */
export function ringSyncDoorbell(payload) {
  const what = payload && typeof payload === 'object' ? /** @type {any} */ (payload).what : null;
  if (!['calendar', 'journey', 'template'].includes(what)) return;
  doorbellListeners.forEach((fn) => fn(what));
  if (what === 'template') syncNow();
}

/** @param {(what: string) => void} fn */
export function onSyncDoorbell(fn) {
  doorbellListeners.add(fn);
  return () => { doorbellListeners.delete(fn); };
}

/**
 * App's half: register how the state is applied (through the sanitizing
 * dispatch path and the config store), then keep it fresh.
 * @param {{ handlers: any, dispatch: (event: string, payload: unknown, handlers: any) => unknown,
 *   store?: { config: Record<string, unknown>, overrides: Record<string, unknown>, updateConfig: (patch: Record<string, unknown>) => void } }} deps
 */
export function useSyncDriver({ handlers, dispatch, store }) {
  // A feed that cannot be typed into (OBS, ProPresenter) carries the word in
  // its address: ?passphrase=… signs it in once (owner's choice, 2026-10-01).
  // The word is then taken out of the address bar, so it is not left on
  // screen or in this browser's history; the session is what stays.
  const storeRef = useRef(store);
  useEffect(() => { storeRef.current = store; }, [store]);
  useEffect(() => {
    const word = passphraseFromUrl();
    if (!word) return;
    stripPassphraseFromUrl();
    if (loadSyncSession() || !storeRef.current) return;
    signIn(word, storeRef.current).catch(() => {});
  }, []);

  useEffect(() => {
    applier = (state) => {
      const { settings, slides } = wirePayloads(state);
      if (settings) dispatch('settings', settings, handlers);
      if (slides) dispatch('slides', slides, handlers);
    };
    return () => { applier = null; };
  }, [handlers, dispatch]);

  useEffect(() => {
    let cancelled = false;
    ensureUrl().then(() => { if (!cancelled) syncNow(); });
    const timer = setInterval(() => syncNow(), SYNC_POLL_MS);
    const online = () => syncNow();
    const onChange = () => update({ signedIn: Boolean(loadSyncSession()) });
    window.addEventListener('online', online);
    window.addEventListener(SYNC_CHANGE_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('online', online);
      window.removeEventListener(SYNC_CHANGE_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);
}

/**
 * Sign in with the passphrase. On success applies the Pusher keys (only if
 * they differ from what this screen has), the template (only keys this screen
 * has not set itself) and the state.
 * @param {string} passphrase
 * @param {{ config: Record<string, unknown>, overrides: Record<string, unknown>, updateConfig: (patch: Record<string, unknown>) => void, template?: boolean }} store
 */
export async function signIn(passphrase, store) {
  const url = await ensureUrl();
  if (!url) return { ok: false, reason: 'no-service', message: 'There is no sync service yet.' };
  const res = await syncLogin(url, passphrase);
  if (!res.ok) return res;
  /** @type {Record<string, unknown>} */
  const patch = store.template === false ? {} : templatePatch(res.template, store.overrides);
  if (res.pusher.key && res.pusher.key !== store.config.pusherAppKey) patch.pusherAppKey = res.pusher.key;
  if (res.pusher.cluster && res.pusher.cluster !== store.config.pusherCluster) patch.pusherCluster = res.pusher.cluster;
  if (Object.keys(patch).length) store.updateConfig(patch);
  if (res.state) applier?.(res.state);
  update({ signedIn: true, phase: 'ok', lastSyncAt: Date.now(), kid: res.state?.kid ?? null });
  return { ok: true, applied: Object.keys(patch) };
}

export function signOut() {
  syncLogout();
  update({ signedIn: false, phase: 'idle' });
}

/**
 * @param {'settings'|'slides'} kind
 * @param {unknown} payload
 */
export async function publishViaSync(kind, payload) {
  const url = await ensureUrl();
  return syncPublish(url, loadSyncSession(), kind, payload);
}

/** Save these per-screen settings as the template new screens start from. @param {Record<string, unknown>} config */
export async function saveTemplate(config) {
  const url = await ensureUrl();
  const res = await syncRequest(url, '/v1/template', { method: 'PUT', body: { config: sanitizeTemplate(config) }, session: loadSyncSession() });
  if (res.ok && res.body) update({ template: { savedAt: String(res.body.savedAt || ''), config: sanitizeTemplate(res.body.config) } });
  return res.ok
    ? { ok: true }
    : { ok: false, message: res.status === 0 ? 'Could not reach the sync service.' : (res.body?.error || `HTTP ${res.status}`) };
}

/**
 * Read the church calendar now (signed in), or just re-read the service's copy.
 * @returns {Promise<{ok: boolean, changed?: boolean, generatedAt?: string|null, checkedAt?: string|null, message?: string}>}
 */
export async function refreshCalendarViaSync() {
  const url = await ensureUrl();
  if (!url || !loadSyncSession()) return { ok: false, message: 'not-signed-in' };
  const res = await syncRequest(url, '/v1/calendar/refresh', { method: 'POST', body: {}, session: loadSyncSession() });
  if (res.status === 0) return { ok: false, message: 'Could not reach the sync service.' };
  if (!res.ok) return { ok: false, message: res.body?.error || `HTTP ${res.status}`, generatedAt: res.body?.generatedAt ?? null, checkedAt: res.body?.checkedAt ?? null };
  doorbellListeners.forEach((fn) => fn('calendar'));
  return { ok: true, changed: Boolean(res.body?.changed), generatedAt: res.body?.generatedAt ?? null, checkedAt: res.body?.checkedAt ?? null };
}

/**
 * @param {string} current
 * @param {string} next
 */
export async function changePassphrase(current, next) {
  if (normalizeSyncPassphrase(next).length < PASSPHRASE_MIN) {
    return { ok: false, message: `The new passphrase needs at least ${PASSPHRASE_MIN} characters.` };
  }
  const url = await ensureUrl();
  const res = await syncRequest(url, '/v1/passphrase', { method: 'POST', body: { current, next }, session: loadSyncSession() });
  if (res.status === 0) return { ok: false, message: 'Could not reach the sync service.' };
  if (!res.ok) {
    if (res.status === 429) return { ok: false, message: 'Too many wrong tries. Wait a little, then try again.' };
    return { ok: false, message: res.body?.error || `HTTP ${res.status}` };
  }
  saveDisplayKey(res.body.displayKey);
  saveSyncSession(res.body.session);
  update({ signedIn: true });
  return { ok: true, rotatedKey: Boolean(res.body.rotatedKey) };
}

/** The ?passphrase= (or ?p=) a feed's link carries, or ''. */
export function passphraseFromUrl(search = typeof window !== 'undefined' ? window.location.search : '') {
  const q = new URLSearchParams(search);
  return normalizeSyncPassphrase(q.get('passphrase') || q.get('p') || '');
}

function stripPassphraseFromUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('passphrase');
    url.searchParams.delete('p');
    window.history.replaceState(window.history.state, '', url);
  } catch { /* an embed that cannot rewrite its URL keeps it; harmless */ }
}

/** @returns {SyncSnapshot} */
export function useSync() {
  // Whoever asks first finds out where the service is (the projector page has
  // no driver of its own).
  useEffect(() => { ensureUrl(); }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test seam. */
export function _resetSyncForTest() {
  snapshot = { url: null, signedIn: Boolean(loadSyncSession()), phase: 'idle', lastSyncAt: null, template: null, kid: null };
  applier = null;
  inFlight = null;
  doorbellListeners.clear();
  listeners.forEach((fn) => fn());
}

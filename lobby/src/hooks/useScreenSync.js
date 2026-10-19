// @ts-check
// A screen registered with the sync Worker (ROADMAP.md#settings-page, phase 2): it says
// hello on start and every SCREEN_HELLO_MS, follows its own settings there
// (the doorbell `changed` {what: 'screen', id} says when /settings changed
// them), sends up a change made on the screen itself, and does what /settings
// asks of it ({what: 'screen-action'}). The rules are lib/screenSync.js; this
// is the wiring, plus the calls /settings makes for any screen.
//
// Only a real screen registers: signed in to the sync service, not in
// configure mode (the sound room app's Settings window, or /settings itself)
// and not the copy embedded in Journey's kiosk (Journey is its own screen).

import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  SCREEN_HELLO_MS,
  SCREEN_PUSH_DEBOUNCE_MS,
  loadScreenSlot,
  reconcileScreen,
  saveScreenSlot,
  screenIdFor,
  screenPartChanged,
  screenSettingsFrom,
  setLiveScreenId,
  setLiveScreenName,
  withScreenPart,
} from '../lib/screenSync.js';
import { SCREEN_DEFAULT_NAMES, cleanScreenName, sanitizeScreenAction, sanitizeScreenSettings } from '../lib/syncSpecs.js';
import { onSyncDoorbell, syncAuthed, useSync } from './useSync.js';
import { pageBuild } from '../lib/buildReload.js';

/**
 * What a TV or projector reports about itself in its hello (worker/src/routes.md
 * 10.7): its page's own build, the first 7 hex of its awana-build meta, so
 * /settings can say which version each screen is running. null (no stamp) on
 * the dev server.
 * @param {Document} [doc]
 * @returns {{ page: { build: string | null } }}
 */
export function pageStatus(doc) {
  const build = pageBuild(doc);
  return { page: { build: build && /^[0-9a-f]{7,}$/i.test(build) ? build.slice(0, 7).toLowerCase() : null } };
}

/**
 * @typedef {import('../lib/syncSpecs.js').ScreenKind} ScreenKind
 * @typedef {{ id: string | null, name: string, registered: boolean, kind: ScreenKind | null }} ThisScreen
 */

// ── This page's screen, for Settings → Setup's name field ───────────────────

/** @type {ThisScreen} */
let thisScreen = { id: null, name: '', registered: false, kind: null };
/** @type {Set<() => void>} */
const listeners = new Set();
/** @param {Partial<ThisScreen>} patch */
function setThisScreen(patch) {
  thisScreen = { ...thisScreen, ...patch };
  listeners.forEach((fn) => fn());
}

/**
 * Every projector's actions as they ring, whatever its id (the lobby's mirror
 * of the projector follows the gym projector's slide-go and backups; it is
 * never a registered screen of its own). Cleaned by the projector's
 * allowlist; the Worker only rings an action for a screen of that kind.
 * @param {(action: string, data: unknown, id: string) => void} fn
 * @returns {() => void} unsubscribe
 */
export function listenToProjectors(fn) {
  return onSyncDoorbell((what, payload) => {
    if (what !== 'screen-action' || !payload || typeof payload.id !== 'string') return;
    const clean = sanitizeScreenAction('projector', payload.action, payload.data);
    if (clean) fn(clean.action, clean.data, payload.id);
  });
}

/** This page's screen id, once useScreenSync has one (null before, or when it does not register). */
export function thisScreenId() {
  return thisScreen.id;
}

/** What this page is registered as (a name field reads it). @returns {ThisScreen} */
export function useThisScreen() {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => thisScreen,
    () => thisScreen,
  );
}

/**
 * Rename this page's screen (Settings → Setup on the TV).
 * @param {string} name
 * @returns {Promise<{ok: boolean, message?: string}>}
 */
export async function renameThisScreen(name) {
  const { id, kind } = thisScreen;
  if (!id || !kind) return { ok: false, message: 'This screen is not registered yet.' };
  const res = await renameScreen(id, name);
  if (res.ok) {
    saveScreenSlot(kind, { name: res.name });
    setLiveScreenName(res.name || '');
    setThisScreen({ name: res.name });
  }
  return res;
}

// ── The calls /settings makes for any screen ────────────────────────────────

/** @param {{status: number, body: any}} res */
function why(res) {
  if (res.status === -1) return 'Sign in first.';
  if (res.status === 0) return 'Could not reach the sync service.';
  if (res.status === 401) return 'Signed out: type the passphrase again.';
  return typeof res.body?.error === 'string' ? res.body.error : `The sync service answered HTTP ${res.status}.`;
}

/** @returns {Promise<{ok: true, screens: any[]} | {ok: false, message: string, status: number}>} */
export async function listScreens() {
  const res = await syncAuthed('/v1/screens');
  return res.ok && Array.isArray(res.body?.screens) ? { ok: true, screens: res.body.screens } : { ok: false, message: why(res), status: res.status };
}

/** @param {string} id */
export async function loadScreen(id) {
  const res = await syncAuthed(`/v1/screens/${encodeURIComponent(id)}/settings`);
  return res.ok ? { ok: true, screen: res.body?.screen, settings: res.body?.settings ?? null } : { ok: false, message: why(res), status: res.status };
}

/**
 * The screen's whole own layer.
 * @param {string} id @param {ScreenKind} kind @param {Record<string, unknown>} settings
 */
export async function saveScreenSettings(id, kind, settings) {
  const res = await syncAuthed(`/v1/screens/${encodeURIComponent(id)}/settings`, {
    method: 'PUT', body: { settings: sanitizeScreenSettings(kind, settings) },
  });
  return res.ok ? { ok: true, savedAt: String(res.body?.savedAt || ''), settings: res.body?.settings ?? {} } : { ok: false, message: why(res) };
}

/** @param {string} id @param {string} name @returns {Promise<{ok: boolean, name?: string, message?: string}>} */
export async function renameScreen(id, name) {
  const clean = cleanScreenName(name);
  if (!clean) return { ok: false, message: 'Give the screen a name.' };
  const res = await syncAuthed(`/v1/screens/${encodeURIComponent(id)}/name`, { method: 'PUT', body: { name: clean } });
  return res.ok ? { ok: true, name: String(res.body?.screen?.name || clean) } : { ok: false, message: why(res) };
}

/** @param {string} id */
export async function forgetScreen(id) {
  const res = await syncAuthed(`/v1/screens/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return res.ok ? { ok: true } : { ok: false, message: why(res) };
}

/** @param {string} id @param {string} action @param {unknown} [data] */
export async function sendScreenAction(id, action, data) {
  const res = await syncAuthed(`/v1/screens/${encodeURIComponent(id)}/action`, { method: 'POST', body: data === undefined ? { action } : { action, data } });
  return res.ok ? { ok: true, delivered: res.body?.delivered === true } : { ok: false, message: why(res) };
}

// ── The screen's own half ───────────────────────────────────────────────────

/**
 * @param {{
 *   kind: ScreenKind,
 *   enabled: boolean,
 *   overrides: Record<string, unknown>,
 *   replaceConfig: (next: Record<string, unknown>) => void,
 *   onAction?: (action: string, data?: unknown) => void,
 *   defaultName?: string,
 * }} opts
 */
export function useScreenSync({ kind, enabled, overrides, replaceConfig, onAction, defaultName }) {
  const { url, signedIn } = useSync();
  const live = Boolean(enabled && url && signedIn);
  const overridesRef = useRef(overrides);
  const onActionRef = useRef(onAction);
  const replaceRef = useRef(replaceConfig);
  useEffect(() => {
    overridesRef.current = overrides;
    onActionRef.current = onAction;
    replaceRef.current = replaceConfig;
  });
  // True once a hello has answered: before that nothing is pushed, or a
  // screen's first load would race /settings' last change.
  const readyRef = useRef(false);
  const idRef = useRef(/** @type {string | null} */ (null));

  useEffect(() => {
    if (!live) return undefined;
    const id = screenIdFor(kind);
    if (!id) return undefined;
    idRef.current = id;
    setLiveScreenId(id);
    const have = loadScreenSlot(kind);
    setThisScreen({ id, kind, name: have?.name || defaultName || SCREEN_DEFAULT_NAMES[kind], registered: false });
    setLiveScreenName(have?.name || defaultName || SCREEN_DEFAULT_NAMES[kind]);
    let stopped = false;
    let gone = false; // a Worker without the registry (404): stop asking

    /** @param {Record<string, unknown>} settings */
    const push = async (settings) => {
      const res = await saveScreenSettings(id, kind, settings);
      if (stopped || !res.ok) return;
      const synced = screenSettingsFrom(kind, { savedAt: res.savedAt, settings: res.settings });
      if (synced) saveScreenSlot(kind, { synced });
    };

    /** @param {unknown} remote */
    const reconcile = async (remote) => {
      const decision = reconcileScreen(kind, {
        remote: screenSettingsFrom(kind, remote), synced: loadScreenSlot(kind)?.synced, overrides: overridesRef.current,
      });
      if (decision.do === 'push') await push(decision.settings);
      else {
        saveScreenSlot(kind, { synced: decision.synced });
        if (decision.do === 'apply') replaceRef.current(withScreenPart(kind, overridesRef.current, decision.settings));
      }
    };

    /** @param {any} body */
    const took = async (body) => {
      if (stopped) return;
      const name = typeof body?.screen?.name === 'string' ? body.screen.name : null;
      if (name) {
        saveScreenSlot(kind, { name });
        setLiveScreenName(name);
        setThisScreen({ name });
      }
      setThisScreen({ registered: true });
      await reconcile(body?.settings ?? null);
      readyRef.current = true;
    };

    const hello = async () => {
      if (stopped || gone) return;
      const body = { id, kind, name: loadScreenSlot(kind)?.name || defaultName || SCREEN_DEFAULT_NAMES[kind] };
      const res = await syncAuthed('/v1/screens/hello', {
        method: 'POST', body: kind === 'lobby' || kind === 'projector' ? { ...body, status: pageStatus() } : body,
      });
      if (res.status === 404) { gone = true; return; }
      if (res.ok) await took(res.body);
    };

    const fetchMine = async () => {
      const res = await syncAuthed(`/v1/screens/${encodeURIComponent(id)}/settings`);
      if (res.ok) await took(res.body);
      else if (res.status === 404) hello(); // forgotten on /settings while running: back with a hello
    };

    hello();
    const timer = setInterval(hello, SCREEN_HELLO_MS);
    const online = () => { hello(); };
    window.addEventListener('online', online);
    const off = onSyncDoorbell((what, payload) => {
      if (!payload || payload.id !== id) return;
      if (what === 'screen') fetchMine();
      else if (what === 'screen-action') {
        const clean = sanitizeScreenAction(kind, payload.action, payload.data);
        if (clean) onActionRef.current?.(clean.action, clean.data);
      }
    });
    return () => {
      stopped = true;
      readyRef.current = false;
      clearInterval(timer);
      window.removeEventListener('online', online);
      off();
      setLiveScreenId(null);
      setThisScreen({ registered: false });
    };
  }, [live, kind, defaultName]);

  // A change made on the screen itself goes up, a moment after the last one.
  useEffect(() => {
    if (!live || !readyRef.current || !idRef.current) return undefined;
    if (!screenPartChanged(kind, overrides, loadScreenSlot(kind)?.synced)) return undefined;
    const id = idRef.current;
    const t = setTimeout(async () => {
      const settings = sanitizeScreenSettings(kind, overridesRef.current);
      const res = await saveScreenSettings(id, kind, settings);
      if (!res.ok) return;
      const synced = screenSettingsFrom(kind, { savedAt: res.savedAt, settings: res.settings });
      if (synced) saveScreenSlot(kind, { synced });
    }, SCREEN_PUSH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [live, kind, overrides]);
}

/** Test seam. */
export function _resetThisScreenForTest() {
  thisScreen = { id: null, name: '', registered: false, kind: null };
  setLiveScreenId(null);
}

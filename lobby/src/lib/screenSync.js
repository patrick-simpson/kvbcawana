// @ts-check
// A screen's own settings, kept in the sync Worker (SETTINGS.md, phase 2) so
// awana.kvbchurch.org/settings can change them from any device. This is the
// pure half and the one storage slot; useScreenSync is the hook.
//
// THE SCREEN'S DEVICE LAYER STAYS WHERE IT IS. useConfig's overrides
// (awanaConfig.v1) are still what the stage renders from. The Worker holds a
// copy of the part SCREEN_SPECS allows, and the two are reconciled against
// the last copy both agreed on (`synced`):
//   - the Worker's copy moved on since `synced` (someone changed it on
//     /settings): it replaces that part of the device layer, through the same
//     replaceConfig a Settings Undo uses, and through sanitizeOverrides there;
//   - otherwise, this device's part moved on (someone changed it on the TV):
//     it is sent up, so /settings sees it.
// Everything else in the device layer (the typed deck, the Pusher keys, panic
// mode, anything the allowlist does not name) is never touched.
//
// The slot holds, per kind, the screen's id (random, made once), its name as
// the Worker last said, and `synced`. Not a secret: the id authorizes
// nothing (every route needs the session), but it is still its own slot, so
// Export, ?config= and Reset this screen never see it.

import { SCREEN_SPECS, isScreenId, sanitizeScreenSettings } from './syncSpecs.js';

export const SCREENS_STORAGE = 'awanaScreens.v1';
/** A hello this often (the Worker calls a screen online for 3 minutes after one). */
export const SCREEN_HELLO_MS = 2 * 60 * 1000;
/** A change made on the screen is sent up this long after the last one. */
export const SCREEN_PUSH_DEBOUNCE_MS = 1500;

/**
 * @typedef {import('./syncSpecs.js').ScreenKind} ScreenKind
 * @typedef {{savedAt: string, settings: Record<string, unknown>}} ScreenSettings
 * @typedef {{id: string, name?: string, synced?: ScreenSettings | null}} ScreenSlot
 */

/** @returns {Record<string, ScreenSlot>} */
function loadAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(SCREENS_STORAGE) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

/** @param {ScreenKind} kind @param {unknown} s @returns {ScreenSettings | null} */
function cleanSettingsRecord(kind, s) {
  const r = /** @type {any} */ (s);
  if (!r || typeof r !== 'object' || typeof r.savedAt !== 'string' || !Number.isFinite(Date.parse(r.savedAt))) return null;
  return { savedAt: r.savedAt, settings: sanitizeScreenSettings(kind, r.settings) };
}

/**
 * This browser's slot for one kind of screen, or null before it has an id.
 * @param {ScreenKind} kind
 * @returns {ScreenSlot | null}
 */
export function loadScreenSlot(kind) {
  const slot = /** @type {any} */ (loadAll()[kind]);
  if (!slot || !isScreenId(slot.id)) return null;
  return {
    id: slot.id,
    name: typeof slot.name === 'string' ? slot.name.slice(0, 40) : undefined,
    synced: cleanSettingsRecord(kind, slot.synced),
  };
}

/**
 * @param {ScreenKind} kind
 * @param {Partial<ScreenSlot>} patch
 * @returns {ScreenSlot | null} the slot as saved (null when storage is blocked)
 */
export function saveScreenSlot(kind, patch) {
  const all = loadAll();
  const next = { ...(all[kind] || {}), ...patch };
  try {
    localStorage.setItem(SCREENS_STORAGE, JSON.stringify({ ...all, [kind]: next }));
    return /** @type {ScreenSlot} */ (next);
  } catch {
    return null;
  }
}

/** 16 random bytes, url-safe: an id no two screens will ever share. */
export function newScreenId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * This browser's id for a kind of screen, made and kept the first time it is
 * asked for. null when storage is blocked: a screen that cannot keep an id
 * would register as a new screen at every load, so it does not register.
 * @param {ScreenKind} kind
 * @returns {string | null}
 */
export function screenIdFor(kind) {
  const have = loadScreenSlot(kind);
  if (have) return have.id;
  const saved = saveScreenSlot(kind, { id: newScreenId(), synced: null });
  return saved && loadScreenSlot(kind)?.id === saved.id ? saved.id : null;
}

/**
 * The part of a device layer the Worker keeps for this kind, in spec order.
 * @param {ScreenKind} kind
 * @param {Record<string, unknown>} overrides
 */
export function screenPart(kind, overrides) {
  return sanitizeScreenSettings(kind, overrides);
}

/**
 * The device layer with its screen part replaced by `settings`: every key the
 * allowlist names is taken from `settings` (or dropped, back to its default,
 * when `settings` does not set it), and nothing else is touched.
 * @param {ScreenKind} kind
 * @param {Record<string, unknown>} overrides
 * @param {Record<string, unknown>} settings
 */
export function withScreenPart(kind, overrides, settings) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(overrides || {})) if (!(k in SCREEN_SPECS[kind])) out[k] = v;
  return { ...out, ...sanitizeScreenSettings(kind, settings) };
}

/** @param {unknown} a @param {unknown} b */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What to do with the Worker's copy. Pure.
 *  - `apply`: replace the device layer's screen part with the Worker's
 *    (it changed since the last agreed copy);
 *  - `push`: send this device's part up (it changed, or the Worker has none);
 *  - `none`: they agree.
 * @param {ScreenKind} kind
 * @param {{ remote: ScreenSettings | null, synced: ScreenSettings | null | undefined, overrides: Record<string, unknown> }} state
 * @returns {{ do: 'apply', settings: Record<string, unknown>, synced: ScreenSettings }
 *   | { do: 'push', settings: Record<string, unknown> }
 *   | { do: 'none', synced: ScreenSettings }}
 */
export function reconcileScreen(kind, { remote, synced, overrides }) {
  const local = screenPart(kind, overrides);
  const theirs = cleanSettingsRecord(kind, remote);
  if (!theirs) return { do: 'push', settings: local };
  if (theirs.savedAt !== synced?.savedAt) {
    return same(theirs.settings, local) ? { do: 'none', synced: theirs } : { do: 'apply', settings: theirs.settings, synced: theirs };
  }
  return same(local, theirs.settings) ? { do: 'none', synced: theirs } : { do: 'push', settings: local };
}

/**
 * Has this device's part moved on from the last agreed copy? (A change made on
 * the TV, to be sent up.)
 * @param {ScreenKind} kind
 * @param {Record<string, unknown>} overrides
 * @param {ScreenSettings | null | undefined} synced
 */
export function screenPartChanged(kind, overrides, synced) {
  return !synced || !same(screenPart(kind, overrides), synced.settings);
}

/**
 * The record a Worker answer carries, cleaned: `{savedAt, settings}` or null.
 * @param {ScreenKind} kind
 * @param {unknown} raw
 */
export function screenSettingsFrom(kind, raw) {
  return cleanSettingsRecord(kind, raw);
}

// The id of the screen this page registered, for the live socket's address
// (useSocket adds ?screen=<id>, so /settings can say the screen is on the
// channel). Module state: one page is at most one screen.
/** @type {string | null} */
let liveId = null;
/** @param {string | null} id */
export function setLiveScreenId(id) { liveId = isScreenId(id) ? id : null; }
export function liveScreenId() { return liveId; }

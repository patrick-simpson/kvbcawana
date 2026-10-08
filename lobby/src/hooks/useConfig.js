import { useSyncExternalStore } from 'react';
import defaults from '../config.js';
import { sanitizeSlides } from '../lib/slides.js';
import { sanitizeMilestoneList } from '../lib/milestones.js';
import { NIGHT_THEME_VALUES } from '../lib/skins.js';
import { parseUrlFlags } from '../lib/urlFlags.js';
import { SHARED_KEYS, sanitizeSettingsPayload, sanitizeSharedValues } from '../lib/sharedSettings.js';

const STORAGE_KEY = 'awanaConfig.v1';
// The shared settings this screen last received or published (contract v6):
// { rev, publishedAt, settings }. Its own entry, never part of the overrides,
// so Export / ?config= / Reset this screen never see it as a device setting.
const SHARED_STORAGE_KEY = 'awanaSharedSettings.v1';

// Per-key validators for override values coming back out of
// localStorage. Anything that fails its check is dropped so a corrupt
// or stale entry (e.g. a string where a number belongs) can never
// produce NaN timers or a broken screen on club night.
const isBool = (v) => typeof v === 'boolean';
const isString = (v) => typeof v === 'string';
const numberBetween = (min, max) => (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

const VALIDATORS = {
  pusherAppKey: isString,
  pusherCluster: isString,
  backgroundSource: (v) => ['powerpoint', 'manual', 'pptx', 'video'].includes(v),
  manualSlides: Array.isArray,
  powerpointEmbedUrl: isString,
  slideshowDelaySec: numberBetween(0, 600),
  useLocalSlideshow: isBool,
  countdownTargetTime: isString,
  standardDisplayMs: numberBetween(1000, 60000),
  specialDisplayMs: numberBetween(1000, 60000),
  gapBetweenBannersMs: numberBetween(0, 10000),
  audioMuted: isBool,
  showConnectionStatus: isBool,
  showTally: isBool,
  keepScreenAwake: isBool,
  // lib/clubs.js CORNER_CLUB_IDS, written out: the projector imports this
  // file, and clubs.js brings every club's art with it (useConfig.test.js
  // pins the two lists equal).
  cornerClub: (v) => ['', 'puggles', 'cubbies', 'sparks', 'tnt', 'trek', 'journey'].includes(v),
  milestoneEvery: numberBetween(0, 10000),
  showTallySyncNote: isBool,
  showTonightTicker: isBool,
  // Threshold LISTS, repaired rather than rejected — see sanitizeMilestoneList
  // in lib/milestones.js. Array-shaped here, whole-number-repaired below.
  bookMilestones: Array.isArray,
  awardMilestones: Array.isArray,
  showClock: isBool,
  showWeatherChip: isBool,
  showBirthdayWeekRibbon: isBool,
  calendarEnabled: isBool,
  calendarUrl: isString,
  sharedScheduleUrl: isString,
  sharedThemeUrl: isString,
  recapMaxAgeMin: numberBetween(1, 240),
  panicMode: isBool,
  clubMilestoneEvery: numberBetween(0, 1000),
  firstArrivalMoment: isBool,
  clubTintBackground: isBool,
  // Who's-still-here board. No mode or window since 2026-10-08: it comes on
  // by itself at 7:30 pm (checkoutBoard.js), so checkoutBoardMode / From /
  // Until are unknown keys here and a saved value is dropped.
  checkoutBoardNamesAbove: numberBetween(0, 200),
  checkoutBoardStaleMin: numberBetween(1, 120),
  cornerStillHere: isBool,
  // Reads the one skin table rather than repeating its ids — adding a season
  // used to mean editing this list, skins.js, the Settings dropdown and the CSS.
  nightTheme: (v) => NIGHT_THEME_VALUES.includes(v),
  followPrinterTheme: (v) => typeof v === 'boolean',
  followPublishedSlides: isBool,
  followSharedSettings: isBool,
  aprilFools: (v) => typeof v === 'boolean',
  particleEffect: (v) => ['auto', 'off', 'snow', 'rain', 'sparkle'].includes(v),
  weatherTheme: isBool,
  calendarWelcomeText: isString,
  calendarShowWelcome: isBool,
  calendarShowNextWeek: isBool,
  calendarShowRemaining: isBool,
  seasonPromos: isBool,
  weatherLocationName: isString,
  weatherLat: numberBetween(-90, 90),
  weatherLon: numberBetween(-180, 180),
  weatherUnits: (v) => v === 'fahrenheit' || v === 'celsius',
  watchdogReloadMin: numberBetween(0, 1440),
  clubPhrases: (v) => !!v && typeof v === 'object' && !Array.isArray(v),
  confettiLevel: (v) => ['full', 'reduced', 'off'].includes(v),
  reduceMotion: isBool,
};

// Banner flavor text per club: keep only short strings, keyed
// case-insensitively, capped so a runaway import can't bloat storage.
function sanitizeClubPhrases(raw) {
  const clean = {};
  for (const [club, phrase] of Object.entries(raw).slice(0, 15)) {
    if (typeof phrase !== 'string' || !phrase.trim()) continue;
    const key = club.trim().toLowerCase().slice(0, 40);
    if (!key) continue;
    clean[key] = phrase.trim().slice(0, 80);
  }
  return clean;
}

// Values that need repair beyond a type check. sanitizeSlides salvages
// a partially-corrupt slide array slide-by-slide, so one bad entry
// can't take out the whole typed deck.
const TRANSFORMS = {
  manualSlides: sanitizeSlides,
  clubPhrases: sanitizeClubPhrases,
  // A NaN or a thousand-entry list here would reach crossedMilestones, so
  // both lists are repaired on the way in (from localStorage AND from
  // ?config=, which routes through this same function).
  bookMilestones: sanitizeMilestoneList,
  awardMilestones: sanitizeMilestoneList,
};

export function sanitizeOverrides(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const clean = {};
  for (const [key, value] of Object.entries(raw)) {
    const valid = VALIDATORS[key];
    if (valid && valid(value)) clean[key] = TRANSFORMS[key] ? TRANSFORMS[key](value) : value;
  }
  return clean;
}

function loadOverrides() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeOverrides(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function loadShared() {
  try {
    const raw = localStorage.getItem(SHARED_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.local === true && parsed.settings) {
      // A change made here that has not been stamped by the print server yet.
      return { rev: Number(parsed.rev) || 0, publishedAt: parsed.publishedAt ?? null, settings: sanitizeSharedValues(parsed.settings), local: true };
    }
    return sanitizeSettingsPayload(parsed);
  } catch {
    return null;
  }
}

function saveShared(value) {
  try {
    if (value) localStorage.setItem(SHARED_STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(SHARED_STORAGE_KEY);
  } catch {
    /* in memory only */
  }
}

function saveOverrides(overrides) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    /* localStorage may be blocked; fall back to in-memory only */
  }
}

// ── One store for the whole page ─────────────────────────────────────────────
// Every useConfig() call used to own its own useState(loadOverrides) slot and
// only heard about changes through the cross-tab `storage` event — which never
// fires in the tab that made the change. So saving the Pusher key in Settings
// did not reach the socket's copy until someone reloaded, and the ?config= layer
// (fetched in App) never reached the socket at all. A single module-level store
// read through useSyncExternalStore gives every hook the same snapshot the
// instant anything changes, in this tab and (via `storage`) in others, and keeps
// working when localStorage is blocked because the overrides live in memory.
//
// Layers, lowest to highest:
//   1. src/config.js baked defaults (incl. VITE_PUSHER_* from the build)
//   2. ?config=<url> remote JSON — App fetches it and calls setRemoteDefaults()
//   3. this device's saved overrides (awanaConfig.v1)
//   3b. the SHARED settings from the check-in computer (awanaSharedSettings.v1,
//      contract v6), for the shared keys only, while followSharedSettings
//      ⇒ storedConfig: what Settings edits and Export writes
//   4. URL flags — ?key=/&cluster= and ?lowPower=1 (src/lib/urlFlags.js) — in
//      memory only: never saved, never shown as a saved setting, never exported
//      ⇒ config: what the socket and the stage consume
// The panic mask (src/lib/panic.js) is applied by App on top of `config` and
// nowhere else — it is a rendering concern, not a setting.

let flags = null;           // parsed lazily once per page (tests reset it)
let overrides = null;       // null = not yet read from localStorage
let remoteDefaults = {};    // the ?config= layer
let shared;                 // undefined = not yet read; null = none
let snapshot = null;        // cached { config, storedConfig, overrides, shared }
const listeners = new Set();

const getFlags = () => flags ?? (flags = parseUrlFlags());
const getOverrides = () => overrides ?? (overrides = loadOverrides());
const getShared = () => (shared === undefined ? (shared = loadShared()) : shared);

/**
 * Layers 1–3: baked defaults < ?config= remote < this device's overrides.
 * Pure and exported so the compatibility rule below is unit-testable.
 */
export function resolveStoredConfig(remote, device, shared = null) {
  const stored = {
    ...defaults,
    audioMuted: !defaults.audioEnabledByDefault,
    ...remote,
    ...device,
  };
  // The shared layer (contract v6) beats this device's own values for the
  // shared keys only, and only while the screen follows it: a change made on
  // the check-in computer must reach a screen that once changed the same
  // setting itself. Run through VALIDATORS too, so a value the wire allows
  // but this build does not (a skin it has never heard of) is dropped.
  if (shared?.settings && stored.followSharedSettings !== false) {
    const mine = sanitizeOverrides(sanitizeSharedValues(shared.settings));
    for (const key of SHARED_KEYS) if (key in mine) stored[key] = mine[key];
  }
  // backgroundSource now defaults to 'manual' (the typed/published deck). A
  // screen — or a fleet file — set up before that saved only a PowerPoint URL
  // and relied on 'powerpoint' being the default. A URL with no explicit source
  // at either layer still means PowerPoint, so nothing already on a wall changes.
  const explicit = 'backgroundSource' in remote || 'backgroundSource' in device;
  if (!explicit && (device.powerpointEmbedUrl || remote.powerpointEmbedUrl)) {
    stored.backgroundSource = 'powerpoint';
  }
  return stored;
}

// Layer 4: URL flags. ?cluster= is honoured only alongside ?key= (an embed
// URL names a whole Pusher app or nothing); ?lowPower=1 forces the two
// motion keys down for THIS embed only — confettiLevel/reduceMotion's own
// defaults stay full-strength for every other device (see CLAUDE.md).
function applyFlags(stored, f) {
  let out = stored;
  if (f.pusherAppKey) {
    out = { ...out, pusherAppKey: f.pusherAppKey, pusherCluster: f.pusherCluster || out.pusherCluster };
  }
  if (f.lowPower) out = { ...out, confettiLevel: 'off', reduceMotion: true };
  return out;
}

function getSnapshot() {
  if (!snapshot) {
    const storedConfig = resolveStoredConfig(remoteDefaults, getOverrides(), getShared());
    snapshot = {
      config: applyFlags(storedConfig, getFlags()),
      storedConfig,
      overrides: getOverrides(),
      shared: getShared(),
    };
  }
  return snapshot;
}

function invalidate() {
  snapshot = null;
  for (const fn of listeners) fn();
}

// Other tabs announce their saves through `storage` (key null = a clear).
const onStorage = (e) => {
  if (e.key === STORAGE_KEY || e.key === null) {
    overrides = loadOverrides();
    invalidate();
  } else if (e.key === SHARED_STORAGE_KEY) {
    shared = loadShared();
    invalidate();
  }
};

function subscribe(fn) {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

/** Merge a patch into this device's overrides (sanitized key by key) and persist. */
export function updateConfig(patch) {
  overrides = sanitizeOverrides({ ...getOverrides(), ...patch });
  saveOverrides(overrides);
  invalidate();
}

/**
 * Replace this device's whole override layer (sanitized). Settings' Undo uses
 * it to put back exactly the layer it opened on: merging the old VALUES back
 * would pin keys that were never overrides (a baked key, a ?config= value).
 */
export function replaceConfig(next) {
  overrides = sanitizeOverrides(next);
  saveOverrides(overrides);
  invalidate();
}

/** Drop every device override — back to defaults (+ the remote layer, if any). */
export function resetConfig() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  overrides = {};
  invalidate();
}

/**
 * A `settings` payload from the print server (already sanitized by the socket).
 * Commits iff its publishedAt is strictly newer than the one held: the
 * 5-minute rebroadcast of the same publish, or an older one replayed, changes
 * nothing, and neither overwrites a change made here that is newer. Returns
 * whether it was applied.
 */
export function receiveSharedSettings(payload) {
  const next = sanitizeSettingsPayload(payload);
  if (!next) return false;
  const held = getShared();
  const heldAt = held?.publishedAt ? Date.parse(held.publishedAt) : -Infinity;
  if (!(Date.parse(next.publishedAt) > heldAt)) return false;
  shared = next;
  saveShared(shared);
  invalidate();
  return true;
}

/**
 * A shared change made on THIS screen: applied here at once (so live apply is
 * live), marked local until the print server stamps it, then given the
 * server's publishedAt and rev (`stamp`). A later publish from the check-in
 * computer, newer than the last stamp, replaces it like any other.
 */
export function setSharedLocally(settings, stamp = null) {
  const held = getShared();
  shared = stamp
    ? { rev: stamp.rev, publishedAt: new Date(Date.parse(stamp.publishedAt)).toISOString(), settings: sanitizeSharedValues(settings) }
    : { rev: held?.rev ?? 0, publishedAt: held?.publishedAt ?? null, settings: sanitizeSharedValues(settings), local: true };
  saveShared(shared);
  invalidate();
}

/** The ?config=<url> layer, already fetched by App. Sanitized like overrides. */
export function setRemoteDefaults(raw) {
  remoteDefaults = sanitizeOverrides(raw);
  invalidate();
}

/** Tests only: forget flags, overrides and the remote layer so each case starts clean. */
export function _resetForTest() {
  flags = null;
  overrides = null;
  remoteDefaults = {};
  shared = undefined;
  snapshot = null;
}

/**
 * The page's config, from the one store above.
 *  - `config`       effective: defaults < remote < overrides < URL flags
 *  - `storedConfig` the same without URL flags — what Settings edits/exports
 *  - `overrides`    this device's saved layer alone
 *  - `shared`       the shared settings layer (contract v6), or null
 * `updateConfig` / `replaceConfig` / `resetConfig` are stable module functions, safe in deps.
 */
export function useConfig() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    config: snap.config,
    storedConfig: snap.storedConfig,
    overrides: snap.overrides,
    shared: snap.shared,
    updateConfig,
    replaceConfig,
    resetConfig,
  };
}

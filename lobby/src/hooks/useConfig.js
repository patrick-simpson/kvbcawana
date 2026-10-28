import { useSyncExternalStore } from 'react';
import defaults from '../config.js';
import { sanitizeSlides } from '../lib/slides.js';
import { sanitizeMilestoneList } from '../lib/milestones.js';
import { NIGHT_THEME_VALUES } from '../lib/skins.js';
import { parseUrlFlags } from '../lib/urlFlags.js';
import { matchesRule } from '../lib/settingRules.js';
import { SHARED_KEYS, sanitizeSettingsPayload, sanitizeSharedValues } from '../lib/sharedSettings.js';

const STORAGE_KEY = 'awanaConfig.v1';
// The shared settings this screen last received or published (contract v6):
// { rev, publishedAt, settings }. Its own entry, never part of the overrides,
// so Export / ?config= / Reset this screen never see it as a device setting.
const SHARED_STORAGE_KEY = 'awanaSharedSettings.v1';

// Per-key rules for override values coming back out of localStorage, as data
// over lib/settingRules.js (matchesRule: a value passes as it stands, nothing
// is clamped). Anything that fails its rule is dropped so a corrupt or stale
// entry (e.g. a string where a number belongs) can never produce NaN timers or
// a broken screen on club night.
const bool = { type: 'bool' };
const string = { type: 'string' };
const array = { type: 'array' };
const between = (min, max) => ({ type: 'number', min, max });
const oneOf = (...values) => ({ type: 'enum', values });

const VALIDATORS = {
  backgroundSource: oneOf('powerpoint', 'manual', 'pptx', 'video'),
  manualSlides: array,
  powerpointEmbedUrl: string,
  slideshowDelaySec: between(0, 600),
  useLocalSlideshow: bool,
  countdownTargetTime: string,
  standardDisplayMs: between(1000, 60000),
  specialDisplayMs: between(1000, 60000),
  gapBetweenBannersMs: between(0, 10000),
  audioMuted: bool,
  showConnectionStatus: bool,
  showTally: bool,
  keepScreenAwake: bool,
  // lib/clubs.js CORNER_CLUB_IDS, written out: the projector imports this
  // file, and clubs.js brings every club's art with it (useConfig.test.js
  // pins the two lists equal).
  cornerClub: oneOf('', 'puggles', 'cubbies', 'sparks', 'tnt', 'trek', 'journey'),
  milestoneEvery: between(0, 10000),
  showTallySyncNote: bool,
  showTonightTicker: bool,
  // Threshold LISTS, repaired rather than rejected — see sanitizeMilestoneList
  // in lib/milestones.js. Array-shaped here, whole-number-repaired below.
  bookMilestones: array,
  awardMilestones: array,
  showClock: bool,
  showWeatherChip: bool,
  showBirthdayWeekRibbon: bool,
  calendarEnabled: bool,
  calendarUrl: string,
  sharedScheduleUrl: string,
  sharedThemeUrl: string,
  recapMaxAgeMin: between(1, 240),
  panicMode: bool,
  clubMilestoneEvery: between(0, 1000),
  firstArrivalMoment: bool,
  clubTintBackground: bool,
  // Who's-still-here board. No mode or window since 2026-10-08: it comes on
  // by itself at 7:30 pm (checkoutBoard.js), so checkoutBoardMode / From /
  // Until are unknown keys here and a saved value is dropped.
  checkoutBoardNamesAbove: between(0, 200),
  checkoutBoardStaleMin: between(1, 120),
  cornerStillHere: bool,
  // Reads the one skin table rather than repeating its ids — adding a season
  // used to mean editing this list, skins.js, the Settings dropdown and the CSS.
  nightTheme: { type: 'enum', values: NIGHT_THEME_VALUES },
  followPrinterTheme: bool,
  followPublishedSlides: bool,
  followSharedSettings: bool,
  aprilFools: bool,
  particleEffect: oneOf('auto', 'off', 'snow', 'rain', 'sparkle'),
  weatherTheme: bool,
  calendarShowWelcome: bool,
  calendarShowNextWeek: bool,
  calendarShowRemaining: bool,
  seasonPromos: bool,
  weatherLocationName: string,
  weatherLat: between(-90, 90),
  weatherLon: between(-180, 180),
  weatherUnits: oneOf('fahrenheit', 'celsius'),
  watchdogReloadMin: between(0, 1440),
  clubPhrases: { type: 'record' },
  confettiLevel: oneOf('full', 'reduced', 'off'),
  reduceMotion: bool,
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
    const rule = Object.prototype.hasOwnProperty.call(VALIDATORS, key) ? VALIDATORS[key] : null;
    if (rule && matchesRule(rule, value)) clean[key] = TRANSFORMS[key] ? TRANSFORMS[key](value) : value;
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
// fires in the tab that made the change. So saving a setting
// did not reach the socket's copy until someone reloaded, and the ?config= layer
// (fetched in App) never reached the socket at all. A single module-level store
// read through useSyncExternalStore gives every hook the same snapshot the
// instant anything changes, in this tab and (via `storage`) in others, and keeps
// working when localStorage is blocked because the overrides live in memory.
//
// Layers, lowest to highest:
//   1. src/config.js baked defaults
//   2. ?config=<url> remote JSON — App fetches it and calls setRemoteDefaults()
//   3. this device's saved overrides (awanaConfig.v1)
//   3b. the SHARED settings from the check-in computer (awanaSharedSettings.v1,
//      contract v6), for the shared keys only, while followSharedSettings
//      ⇒ storedConfig: what Settings edits and Export writes
//   4. URL flag — ?lowPower=1 (src/lib/urlFlags.js) — in
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

// Layer 4: URL flags. ?lowPower=1 forces the two
// motion keys down for THIS embed only — confettiLevel/reduceMotion's own
// defaults stay full-strength for every other device (see CLAUDE.md).
function applyFlags(stored, f) {
  let out = stored;
  if (f.lowPower) out = { ...out, confettiLevel: 'off', reduceMotion: true };
  // ?club=<id>: one club's lobby (urlFlags.js). Its count in the corner, no chime.
  if (f.club) out = { ...out, cornerClub: f.club, audioMuted: true };
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
  // A stamp without a readable publishedAt must not throw (toISOString on an
  // invalid date) and strand the share on "sending": keep the held time.
  const stampedAt = stamp ? Date.parse(stamp.publishedAt) : NaN;
  shared = stamp && Number.isFinite(stampedAt)
    ? { rev: stamp.rev, publishedAt: new Date(stampedAt).toISOString(), settings: sanitizeSharedValues(settings) }
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

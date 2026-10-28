// @ts-check
// The lobby screens' SHARED settings (contract v6): which settings follow the
// check-in computer, and the strict allowlist sanitizer for the sealed
// `settings` event that carries them. Pure (its one import, settingRules.js, is pure and itself imports only shared/text.js), so the socket's
// sanitizer table and the config store can both use it.
//
// Owner, 2026-10-01: "settings changes should apply on all devices", except
// the hardware and the location of each screen. So what plays behind the
// names (and its uploads), the TV's sound, motion, confetti, wake lock and
// simplified mode, the connection keys and the per-screen switches stay on
// the screen; everything a volunteer tunes for the ROOM is shared.
//
// SHARED_SPEC is the printer's SETTINGS_SPEC (print-server/events.js) and the
// contract's `events.settings.keys`, rule for rule; sharedSettings.test.js
// fails if this copy drifts from the contract vectors.

import { cleanSpec } from './settingRules.js';

/** @typedef {import('./settingRules.js').Rule} Rule */

/** @type {Record<string, Rule>} */
export const SHARED_SPEC = {
  standardDisplayMs: { type: 'int', min: 2000, max: 20000 },
  specialDisplayMs: { type: 'int', min: 3000, max: 25000 },
  clubPhrases: { type: 'phrases', maxKeys: 15, maxKey: 40, maxValue: 80 },
  showBirthdayWeekRibbon: { type: 'bool' },
  clubTintBackground: { type: 'bool' },
  firstArrivalMoment: { type: 'bool' },
  milestoneEvery: { type: 'int', min: 0, max: 10000 },
  clubMilestoneEvery: { type: 'int', min: 0, max: 1000 },
  bookMilestones: { type: 'intList', maxItems: 8, min: 1, max: 10000 },
  awardMilestones: { type: 'intList', maxItems: 8, min: 1, max: 10000 },
  showClock: { type: 'bool' },
  showTally: { type: 'bool' },
  showTallySyncNote: { type: 'bool' },
  showWeatherChip: { type: 'bool' },
  weatherLocationName: { type: 'string', max: 80 },
  weatherLat: { type: 'number', min: -90, max: 90 },
  weatherLon: { type: 'number', min: -180, max: 180 },
  weatherUnits: { type: 'enum', values: ['fahrenheit', 'celsius'] },
  calendarEnabled: { type: 'bool' },
  calendarUrl: { type: 'url', max: 300 },
  calendarShowWelcome: { type: 'bool' },
  calendarShowNextWeek: { type: 'bool' },
  calendarShowRemaining: { type: 'bool' },
  seasonPromos: { type: 'bool' },
  checkoutBoardMode: { type: 'enum', values: ['off', 'pickup', 'always'] },
  checkoutBoardNamesAbove: { type: 'int', min: 0, max: 200 },
  checkoutBoardStaleMin: { type: 'int', min: 1, max: 120 },
  checkoutBoardFrom: { type: 'time' },
  checkoutBoardUntil: { type: 'time' },
  cornerStillHere: { type: 'bool' },
  nightTheme: { type: 'slug', max: 32 },
  followPrinterTheme: { type: 'bool' },
  particleEffect: { type: 'enum', values: ['auto', 'off', 'snow', 'rain', 'sparkle'] },
  weatherTheme: { type: 'bool' },
  aprilFools: { type: 'bool' },
};

/**
 * Keys the contract still allows (printer/'s contract-vectors.json, which this
 * table mirrors) but this build no longer has: the pickup board's mode and
 * window, gone since 2026-10-08 (it comes on by itself at 7:30 pm). A frame
 * carrying them is accepted, and the values go nowhere: they are not config
 * keys, so useConfig's VALIDATORS drop them when the shared layer resolves.
 * Retire them from the contract (printer first) and they leave here too.
 */
export const RETIRED_SHARED = Object.freeze(['checkoutBoardMode', 'checkoutBoardFrom', 'checkoutBoardUntil']);

export const SHARED_KEYS = Object.freeze(Object.keys(SHARED_SPEC));
const SHARED = new Set(SHARED_KEYS);

/** @param {string} key */
export const isSharedKey = (key) => SHARED.has(key);

/**
 * Exactly the shared allowlist, every value checked against its rule. Per-screen
 * keys, unknown keys and failing values are dropped. {} for junk.
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function sanitizeSharedValues(raw) {
  return cleanSpec(SHARED_SPEC, raw);
}

/**
 * The `settings` event's allowlist sanitizer: {rev, publishedAt, settings}, or
 * null when it cannot be ordered (no valid publishedAt) or carries no object.
 * @param {unknown} raw
 * @returns {{ rev: number, publishedAt: string, settings: Record<string, unknown> } | null}
 */
export function sanitizeSettingsPayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = /** @type {Record<string, unknown>} */ (raw);
  if (typeof p.publishedAt !== 'string' || !Number.isFinite(Date.parse(p.publishedAt))) return null;
  if (!p.settings || typeof p.settings !== 'object' || Array.isArray(p.settings)) return null;
  const rev = typeof p.rev === 'number' && Number.isFinite(p.rev) ? Math.max(1, Math.floor(p.rev)) : 1;
  return { rev, publishedAt: new Date(Date.parse(p.publishedAt)).toISOString(), settings: sanitizeSharedValues(p.settings) };
}

/**
 * This screen's shared values, ready to publish: every shared key the config
 * has, through the same rules the wire enforces.
 * @param {Record<string, unknown>} config
 */
export function pickShared(config) {
  return sanitizeSharedValues(config);
}

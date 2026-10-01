// @ts-check
// The lobby screens' SHARED settings (contract v6): which settings follow the
// check-in computer, and the strict allowlist sanitizer for the sealed
// `settings` event that carries them. Pure and import-free, so the socket's
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

/**
 * @typedef {{ type: 'bool' }
 *   | { type: 'int' | 'number', min: number, max: number }
 *   | { type: 'enum', values: string[] }
 *   | { type: 'string' | 'url' | 'slug', max: number }
 *   | { type: 'time' }
 *   | { type: 'intList', maxItems: number, min: number, max: number }
 *   | { type: 'phrases', maxKeys: number, maxKey: number, maxValue: number }} Rule
 */

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
  calendarWelcomeText: { type: 'string', max: 80 },
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

export const SHARED_KEYS = Object.freeze(Object.keys(SHARED_SPEC));
const SHARED = new Set(SHARED_KEYS);

/** @param {string} key */
export const isSharedKey = (key) => SHARED.has(key);

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * The printer's plainText(): no markup, one line, capped.
 * @param {unknown} s
 * @param {number} max
 */
function plainText(s, max) {
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * One value against its rule: the clean value, or undefined to drop it. Never
 * coerces a string into a number or a boolean.
 * @param {Rule} rule
 * @param {unknown} v
 */
function clean(rule, v) {
  switch (rule.type) {
    case 'bool':
      return typeof v === 'boolean' ? v : undefined;
    case 'int':
      if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
      return Math.min(rule.max, Math.max(rule.min, Math.round(v)));
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
      return Math.min(rule.max, Math.max(rule.min, v));
    case 'enum':
      return typeof v === 'string' && rule.values.includes(v) ? v : undefined;
    case 'string':
      return typeof v === 'string' ? plainText(v, rule.max) : undefined;
    case 'url': {
      if (typeof v !== 'string') return undefined;
      const s = v.trim();
      if (!s) return '';
      return s.length <= rule.max && /^https:\/\/[^\s<>"']+$/i.test(s) ? s : undefined;
    }
    case 'time':
      return typeof v === 'string' && TIME_RE.test(v) ? v : undefined;
    case 'slug':
      return typeof v === 'string' && v.length <= rule.max && SLUG_RE.test(v) ? v : undefined;
    case 'intList':
      if (!Array.isArray(v)) return undefined;
      return [...new Set(v
        .filter((x) => typeof x === 'number' && Number.isFinite(x))
        .map((x) => Math.round(x))
        .filter((x) => x >= rule.min && x <= rule.max))]
        .sort((a, b) => a - b)
        .slice(0, rule.maxItems);
    case 'phrases': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
      /** @type {Record<string, string>} */
      const out = {};
      for (const [k, phrase] of Object.entries(v).slice(0, rule.maxKeys)) {
        const key = String(k).trim().toLowerCase().slice(0, rule.maxKey);
        if (!key || typeof phrase !== 'string') continue;
        const text = plainText(phrase, rule.maxValue);
        if (text) out[key] = text;
      }
      return out;
    }
    default:
      return undefined;
  }
}

/**
 * Exactly the shared allowlist, every value checked against its rule. Per-screen
 * keys, unknown keys and failing values are dropped. {} for junk.
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function sanitizeSharedValues(raw) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const src = /** @type {Record<string, unknown>} */ (raw);
  for (const [key, rule] of Object.entries(SHARED_SPEC)) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    const value = clean(rule, src[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
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

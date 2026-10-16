// @ts-check
// The projector's handle on the family brand kit (shared/brand/, see its
// README): house colours, club shades and the palettes the ambient layers
// throw. Read straight out of shared/brand/tokens.json, the same way
// shared-config.js reads schedule.json and theme.json, so there is one copy
// of every value. (The isolation rule is about the signage app's src/; the
// kit in shared/ belongs to the whole Awana app family.)
//
// Pure data and pure functions only.

import tokens from '../../../../shared/brand/tokens.json';

/** @typedef {{ name: string, primary: string, deep: string, tint: string, ink?: string }} KitClub */

/** House colours: orange, sun, hot, blue, ink and friends. */
export const HOUSE = /** @type {Record<string, string>} */ (
  Object.fromEntries(Object.entries(tokens.house).filter(([, v]) => typeof v === 'string'))
);

/** Club primary / deep / tint, keyed by club id. */
export const KIT_CLUBS = /** @type {Record<string, KitClub>} */ (tokens.clubs);

/** The catalog's club order, youngest first (the sweep runs in it). */
export const CLUB_ORDER = ['puggles', 'cubbies', 'sparks', 'tnt', 'trek', 'journey'];

const HEX = /^#([0-9a-f]{6})$/i;

/**
 * Darken a colour by keeping `keep` (0..1) of each channel (the
 * weather scene's leaf vein). Anything that is not a #rrggbb comes back as-is.
 * @param {string} hex
 * @param {number} keep
 */
export function shade(hex, keep) {
  const m = HEX.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const k = Math.min(1, Math.max(0, keep));
  const ch = (/** @type {number} */ v) => Math.round(v * k).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`.toUpperCase();
}

/** Every club colour plus the sun and white: confetti, particles, sparkles. */
export const CELEBRATION = [
  ...CLUB_ORDER.map((id) => KIT_CLUBS[id].primary),
  HOUSE.sun,
  '#FFFFFF',
];

/**
 * Warning treatments for the game clock (lib/gameWarning.js states): the
 * digits' colour and the chip's plate. The heads-up is sunflower on an
 * orange-deep plate; the final call is the kit's one hot red-orange.
 */
export const WARNING_TONES = /** @type {Record<string, { digits: string, plate: string }>} */ ({
  'two-minute': { digits: HOUSE.sun, plate: HOUSE.orangeDeep },
  'final-thirty': { digits: HOUSE.hot, plate: HOUSE.hotDeep },
});

/** The countdown's final-minute red: the kit's hot, never a club's colour. */
export const URGENT_COLOR = HOUSE.hot;

/**
 * Deterministic PRNG for stable "hand-scattered" layouts.
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

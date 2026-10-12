// @ts-check
// The one vocabulary for a settings table: rule TYPES and the two functions
// that apply them. Pure and import-free, so the Worker bundles it (through
// syncSpecs.js) and the signage and projector read the same rules.
//
//   cleanRule(rule, v)    the wire's check: the clean value (clamped, trimmed,
//                         capped) or undefined to drop. Never coerces a string
//                         into a number or a boolean. SHARED_SPEC, TEMPLATE_SPEC
//                         and SCREEN_SPECS go through it (cleanSpec below).
//   matchesRule(rule, v)  the device layer's check: does the value pass as it
//                         stands? Nothing is repaired or clamped. useConfig's
//                         VALIDATORS go through it.
//
// Each table is data over these rule types and keeps its own keys, limits and
// quirks. A type either function does not know yields undefined / false.

/**
 * @typedef {{ type: 'bool' }
 *   | { type: 'int' | 'number', min: number, max: number }
 *   | { type: 'enum', values: readonly string[] }
 *   | { type: 'string' | 'url' | 'slug', max: number }
 *   | { type: 'time' }
 *   | { type: 'intList', maxItems: number, min: number, max: number }
 *   | { type: 'phrases', maxKeys: number, maxKey: number, maxValue: number }} Rule
 * The wire's rules (cleanRule).
 *
 * @typedef {{ type: 'bool' }
 *   | { type: 'number', min: number, max: number }
 *   | { type: 'enum', values: readonly string[] }
 *   | { type: 'string' }
 *   | { type: 'array' }
 *   | { type: 'record' }} MatchRule
 * The device layer's rules (matchesRule).
 */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * The printer's plainText(): no markup, one line, capped.
 * @param {unknown} s
 * @param {number} max
 */
export function plainText(s, max) {
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
export function cleanRule(rule, v) {
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
      // "HH:MM", 24-hour, as an <input type="time"> gives it.
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
 * Exactly the spec's keys, in the spec's order, every value cleaned by its
 * rule; unknown keys and failing values are dropped. {} for junk.
 * @param {Record<string, Rule>} spec
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function cleanSpec(spec, raw) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const src = /** @type {Record<string, unknown>} */ (raw);
  for (const [key, rule] of Object.entries(spec)) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    const value = cleanRule(rule, src[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Does a value pass its rule as it stands (no repair, no clamp)? A 'number' is
 * any finite number in range, whole or not.
 * @param {MatchRule} rule
 * @param {unknown} v
 */
export function matchesRule(rule, v) {
  switch (rule.type) {
    case 'bool':
      return typeof v === 'boolean';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) && v >= rule.min && v <= rule.max;
    case 'enum':
      return typeof v === 'string' && rule.values.includes(v);
    case 'string':
      return typeof v === 'string';
    case 'array':
      return Array.isArray(v);
    case 'record':
      return !!v && typeof v === 'object' && !Array.isArray(v);
    default:
      return false;
  }
}

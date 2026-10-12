// GENERATED from lobby/shared/churchSettings.js by scripts/shared-copies.mjs: do not edit; edit the source and run
// `node scripts/shared-copies.mjs`. scripts/check-mirrors.mjs fails when this copy drifts.
'use strict';
// @ts-check
// THE church settings allowlist (lobby/worker/src/routes.md section 10.3): the
// check-in laptop's church-wide printing settings, kept by the sync Worker and
// edited from awana.kvbchurch.org/settings. Three readers, ONE table:
//
//   - the Worker (lobby/worker/src/church.js) cleans every seed and edit with it;
//   - the settings page (lobby/src) shows and sends these keys;
//   - the print server (through its generated copy,
//     printer/print-server/churchSettings.js) cleans what it fetches before its
//     own per-key cleaner (config-routes.js cleanChurchPatch) writes config.json.
//
// Values are church-authored (a label footer, a schedule, which clubs are on the
// pickup list), never child data. Pure: imports only the shared pickup, club and
// text modules, so scripts/shared-copies.mjs can make the CommonJS copy.

const { normalizePickupClubs } = require('./pickup');
const { clubKeyByLabel } = require('./clubTable');
const { stripControlChars } = require('./textClean');

/** The largest settings object (JSON bytes) the Worker stores. */
const CHURCH_JSON_MAX = 24576;

/** The Screen season choices (`auto` and `off` plus the print server's SEASON_KEYS). */
const CHURCH_SEASONS = Object.freeze([
  'auto', 'off', 'back-to-school', 'fall', 'thanksgiving', 'christmas', 'winter', 'spring', 'easter', 'vbs-summer',
]);

/** The label template switches a template may turn OFF (the print server's LABEL_TEMPLATE_BOOLEANS). */
const CHURCH_TEMPLATE_SWITCHES = Object.freeze([
  'showIconPanel', 'showLastName', 'showClubLine', 'showGroupLine', 'showVisitorPill', 'showFooter',
]);

/**
 * One row per key: `type` names the rule `sanitizeChurch` applies.
 *   line      a string, one printable line, at most `max` ('' kept: none)
 *   bool      a boolean
 *   templates the per-club label templates (at most 12, overrides only)
 *   schedule  at most 60 rows {club, startTime, location, room}
 *   int       an integer from `min` to `max`
 *   pickup    pickup.js normalizePickupClubs (null: the default list)
 *   season    one of CHURCH_SEASONS
 *   dates     at most 20 unique sorted YYYY-MM-DD
 */
const CHURCH_SPEC = Object.freeze({
  labelFooter: Object.freeze({ type: 'line', max: 60 }),
  firstTimerInverted: Object.freeze({ type: 'bool' }),
  trophyBand: Object.freeze({ type: 'bool' }),
  connectCard: Object.freeze({ type: 'bool' }),
  connectCardAutoFirstTimer: Object.freeze({ type: 'bool' }),
  connectCardGreeting: Object.freeze({ type: 'line', max: 60 }),
  enableDrivenCheckin: Object.freeze({ type: 'bool' }),
  labelTemplates: Object.freeze({ type: 'templates', maxClubs: 12, minPt: 18, maxPt: 47 }),
  schedule: Object.freeze({ type: 'schedule', maxRows: 60, club: 30, location: 40, room: 40 }),
  lateGraceMin: Object.freeze({ type: 'int', min: 0, max: 120 }),
  pickupClubs: Object.freeze({ type: 'pickup' }),
  seasonTheme: Object.freeze({ type: 'season' }),
  barfNights: Object.freeze({ type: 'dates', max: 20 }),
});

/** Every key, in the table's order. */
const CHURCH_KEYS = Object.freeze(Object.keys(CHURCH_SPEC));

const DROP = Symbol('drop');

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// One printable line: control characters become spaces, whitespace collapses
// (the print server's printableConfigLine).
function oneLine(value, max) {
  return stripControlChars(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanTemplate(raw, rule) {
  if (!isPlainObject(raw)) return null;
  /** @type {Record<string, any>} */
  const out = { version: 1 };
  for (const k of CHURCH_TEMPLATE_SWITCHES) if (raw[k] === false) out[k] = false;
  if (raw.nameMaxPt !== undefined) {
    const n = Math.round(Number(raw.nameMaxPt));
    if (Number.isFinite(n) && n >= rule.minPt && n <= rule.maxPt) out.nameMaxPt = n;
  }
  return Object.keys(out).length > 1 ? out : null;
}

function cleanRow(r, rule) {
  if (!isPlainObject(r)) return null;
  const text = (v, max) => (typeof v === 'string' || typeof v === 'number' ? stripControlChars(String(v)).trim().slice(0, max) : '');
  const club = text(r.club, rule.club);
  if (!club) return null;
  const start = typeof r.startTime === 'string' && /^\d{1,2}:\d{2}$/.test(r.startTime) ? r.startTime : '';
  return { club, startTime: start, location: text(r.location, rule.location), room: text(r.room, rule.room) };
}

/** One value by its rule; DROP when it is not one this key may hold. */
function cleanValue(key, value) {
  const rule = /** @type {any} */ (CHURCH_SPEC)[key];
  switch (rule.type) {
    case 'line':
      return typeof value === 'string' ? oneLine(value, rule.max) : DROP;
    case 'bool':
      return typeof value === 'boolean' ? value : DROP;
    case 'templates': {
      if (!isPlainObject(value)) return DROP;
      /** @type {Record<string, any>} */
      const out = {};
      for (const rawKey of Object.keys(value).slice(0, rule.maxClubs)) {
        const k = rawKey === 'default' ? 'default' : clubKeyByLabel(rawKey);
        if (!k) continue;
        const t = cleanTemplate(value[rawKey], rule);
        if (t) out[k] = t;
      }
      return out;
    }
    case 'schedule': {
      if (!Array.isArray(value)) return DROP;
      return value.slice(0, rule.maxRows).map((r) => cleanRow(r, rule)).filter(Boolean);
    }
    case 'int': {
      if (typeof value !== 'number' && typeof value !== 'string') return DROP;
      if (typeof value === 'string' && !/^\s*\d+\s*$/.test(value)) return DROP;
      const n = Math.round(Number(value));
      if (!Number.isFinite(n)) return DROP;
      return Math.max(rule.min, Math.min(rule.max, n));
    }
    case 'pickup': {
      const p = normalizePickupClubs(value);
      return p.ok ? p.value : DROP;
    }
    case 'season':
      return typeof value === 'string' && CHURCH_SEASONS.includes(value) ? value : DROP;
    case 'dates': {
      if (!Array.isArray(value)) return DROP;
      const days = value.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)));
      return [...new Set(days)].sort().slice(0, rule.max);
    }
    default:
      return DROP;
  }
}

/**
 * Keep the keys of CHURCH_SPEC whose value follows its rule, cleaned.
 * A key outside the table, or one whose value breaks its rule, is left out and
 * named in `dropped`. `null` for a key: with `{patch: true}` (an edit's
 * "delete this key", mergeChurch) it is kept as null; otherwise it is dropped,
 * except `pickupClubs`, where null is "the default list" and is kept.
 * @param {unknown} raw
 * @param {{ patch?: boolean }} [opts]
 * @returns {{ settings: Record<string, any>, dropped: string[] }}
 */
function sanitizeChurch(raw, opts = {}) {
  /** @type {Record<string, any>} */
  const settings = {};
  /** @type {string[]} */
  const dropped = [];
  if (!isPlainObject(raw)) return { settings, dropped };
  const src = /** @type {Record<string, any>} */ (raw);
  for (const key of Object.keys(src)) {
    if (!Object.prototype.hasOwnProperty.call(CHURCH_SPEC, key)) { if (dropped.length < 40) dropped.push(key.slice(0, 40)); continue; }
    const value = src[key];
    if (value === undefined) continue;
    if (value === null) {
      if (opts.patch || key === 'pickupClubs') settings[key] = null;
      else dropped.push(key);
      continue;
    }
    const clean = cleanValue(key, value);
    if (clean === DROP) dropped.push(key);
    else settings[key] = clean;
  }
  return { settings, dropped };
}

/**
 * `prev` with `patch` laid over it: a key sent as null is deleted, a key outside
 * the table is ignored. Neither argument is changed.
 * @param {Record<string, any> | null | undefined} prev
 * @param {Record<string, any> | null | undefined} patch
 * @returns {Record<string, any>}
 */
function mergeChurch(prev, patch) {
  /** @type {Record<string, any>} */
  const out = {};
  if (isPlainObject(prev)) {
    for (const key of CHURCH_KEYS) if (Object.prototype.hasOwnProperty.call(prev, key) && /** @type {any} */ (prev)[key] !== undefined) out[key] = /** @type {any} */ (prev)[key];
  }
  if (isPlainObject(patch)) {
    for (const key of CHURCH_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
      const v = /** @type {any} */ (patch)[key];
      if (v === undefined) continue;
      if (v === null) delete out[key];
      else out[key] = v;
    }
  }
  return out;
}

module.exports = {
  CHURCH_JSON_MAX,
  CHURCH_SEASONS,
  CHURCH_TEMPLATE_SWITCHES,
  CHURCH_SPEC,
  CHURCH_KEYS,
  sanitizeChurch,
  mergeChurch,
};

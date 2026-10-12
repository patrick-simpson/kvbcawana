// @ts-check
// Church settings (docs/SETTINGS-OVERHAUL.md section 4, lobby/worker/src/routes.md 10.3):
// the check-in laptop's church-wide printing settings, kept by the sync Worker and
// edited from awana.kvbchurch.org/settings. ONE allowlist for every reader:
//
//   - the Worker (lobby/worker/src/church.js) cleans every seed and edit with it;
//   - the print server applies the Worker's copy through its generated CommonJS
//     copy (printer/print-server/churchSettings.js, scripts/shared-copies.mjs),
//     then through its own per-key cleaners as POST /config does;
//   - the settings page shows and edits exactly these keys.
//
// Values are church-authored (a label footer, a schedule, which clubs are on the
// pickup list) plus the remembered leaders (adult volunteers' names, `leaders`),
// never child data. Never here: printers, cupsMedia, musicalPrinter,
// updateBeacon, worksheetPrinter, checkinUrl, historyRetentionDays, fleetConfigUrl,
// or any secret.
//
// A shared module (scripts/shared-copies.mjs): `export const` / `export function`
// only, and it imports only other shared modules by a relative named import.

import { normalizePickupClubs } from './pickup.js';
import { clubKeyByLabel } from './clubs.js';
import { cleanText } from './text.js';

/**
 * The whole church document, as JSON, at most this many bytes (64 KB: room for
 * the full leader list beside a full schedule; a Durable Object value holds 128 KB).
 */
export const CHURCH_JSON_MAX = 65536;

/** The Screen seasons `seasonTheme` may name (the print server's SEASON_KEYS), plus auto and off. */
export const CHURCH_SEASONS = Object.freeze([
  'auto', 'off', 'back-to-school', 'fall', 'thanksgiving', 'christmas', 'winter', 'spring', 'easter', 'vbs-summer',
]);

/** A label template's switches (the print server's LABEL_TEMPLATE_BOOLEANS); only `false` is stored. */
export const LABEL_TEMPLATE_SWITCHES = Object.freeze([
  'showIconPanel', 'showLastName', 'showClubLine', 'showGroupLine', 'showVisitorPill', 'showFooter',
]);
export const LABEL_TEMPLATES_MAX = 12;
export const SCHEDULE_ROWS_MAX = 60;
export const BARF_NIGHTS_MAX = 20;
/**
 * The remembered leaders (owner, 2026-10-12: moved from the print server's
 * leaders.json so a leader-tag chip works from any phone): ADULT volunteers'
 * names only, never a child's, and nothing else about them (no contact, no
 * birthdate, no attendance). Rows `{firstName, lastName, clubName,
 * lastPrintedAt, printCount}` as leaders.json keeps them, at most LEADERS_MAX,
 * one per name (first + last, case and spacing folded), newest print first.
 */
export const LEADERS_MAX = 200;
export const LEADER_NAME_MAX = 40;

/**
 * Every key and its rule. `type` names the cleaner below; the table is what a
 * reader may show (the settings page lists the keys from here).
 */
export const CHURCH_SPEC = Object.freeze({
  labelFooter: Object.freeze({ type: 'line', max: 60 }),
  connectCardGreeting: Object.freeze({ type: 'line', max: 60 }),
  firstTimerInverted: Object.freeze({ type: 'bool' }),
  trophyBand: Object.freeze({ type: 'bool' }),
  connectCard: Object.freeze({ type: 'bool' }),
  connectCardAutoFirstTimer: Object.freeze({ type: 'bool' }),
  enableDrivenCheckin: Object.freeze({ type: 'bool' }),
  labelTemplates: Object.freeze({ type: 'labelTemplates', max: LABEL_TEMPLATES_MAX }),
  schedule: Object.freeze({ type: 'schedule', max: SCHEDULE_ROWS_MAX }),
  lateGraceMin: Object.freeze({ type: 'int', min: 0, max: 120 }),
  pickupClubs: Object.freeze({ type: 'pickupClubs' }),
  seasonTheme: Object.freeze({ type: 'enum', values: CHURCH_SEASONS }),
  barfNights: Object.freeze({ type: 'dates', max: BARF_NIGHTS_MAX }),
  leaders: Object.freeze({ type: 'leaders', max: LEADERS_MAX }),
});

export const CHURCH_KEYS = Object.freeze(Object.keys(CHURCH_SPEC));

/** A plain object (not an array, not null). @param {unknown} v @returns {v is Record<string, any>} */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** @param {Record<string, any>} o @param {string} k */
function own(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k);
}

/** One label template, overrides only (`{version: 1}` plus what differs from the stock label). @param {unknown} raw */
function cleanTemplate(raw) {
  if (!isPlainObject(raw)) return null;
  /** @type {Record<string, any>} */
  const out = { version: 1 };
  for (const k of LABEL_TEMPLATE_SWITCHES) if (raw[k] === false) out[k] = false;
  if (raw.nameMaxPt !== undefined) {
    const n = Math.round(Number(raw.nameMaxPt));
    if (Number.isFinite(n) && n >= 18 && n <= 47) out.nameMaxPt = n;
  }
  return out;
}

/** @param {string} s */
function realDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * One value by its rule. `{ok: true, value}` or `{ok: false}`.
 * @param {string} key @param {unknown} v
 * @returns {{ ok: true, value: any } | { ok: false }}
 */
export function cleanChurchValue(key, v) {
  if (!own(CHURCH_SPEC, key)) return { ok: false };
  const rule = /** @type {any} */ (CHURCH_SPEC)[key];
  switch (rule.type) {
    case 'line':
      // One printable line ('' kept: none). Control characters are spaces, runs collapse.
      return typeof v === 'string' ? { ok: true, value: cleanText(v, rule.max, { control: ' ', collapse: true }) } : { ok: false };
    case 'bool':
      return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false };
    case 'int':
      return typeof v === 'number' && Number.isInteger(v) && v >= rule.min && v <= rule.max ? { ok: true, value: v } : { ok: false };
    case 'enum':
      return typeof v === 'string' && rule.values.includes(v) ? { ok: true, value: v } : { ok: false };
    case 'pickupClubs': {
      const n = normalizePickupClubs(v);
      return n.ok && n.value ? { ok: true, value: n.value } : { ok: false };
    }
    case 'labelTemplates': {
      if (!isPlainObject(v)) return { ok: false };
      /** @type {Record<string, any>} */
      const out = {};
      for (const rawKey of Object.keys(v).slice(0, rule.max)) {
        const k = rawKey === 'default' ? 'default' : clubKeyByLabel(rawKey);
        if (!k) continue;
        const t = cleanTemplate(v[rawKey]);
        if (!t || Object.keys(t).length <= 1) continue;   // no override: nothing to keep
        out[k] = t;
      }
      return { ok: true, value: out };
    }
    case 'schedule': {
      if (!Array.isArray(v)) return { ok: false };
      const rows = [];
      for (const r of v.slice(0, rule.max)) {
        if (!isPlainObject(r)) continue;
        const club = cleanText(r.club, 30, { control: ' ', collapse: true });
        if (!club) continue;
        const time = typeof r.startTime === 'string' ? r.startTime.trim() : '';
        rows.push({
          club,
          startTime: /^\d{1,2}:\d{2}$/.test(time) ? time : '',
          location: cleanText(r.location, 40, { control: ' ', collapse: true }),
          room: cleanText(r.room, 40, { control: ' ', collapse: true }),
        });
      }
      return { ok: true, value: rows };
    }
    case 'leaders': {
      if (!Array.isArray(v)) return { ok: false };
      const seen = new Set();
      const rows = [];
      for (const r of v) {
        if (!isPlainObject(r)) continue;
        const firstName = cleanText(r.firstName, LEADER_NAME_MAX, { control: ' ', angle: true, collapse: true });
        const lastName = cleanText(r.lastName, LEADER_NAME_MAX, { control: ' ', angle: true, collapse: true });
        const key = `${firstName} ${lastName}`.toLowerCase().trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const at = Number(r.lastPrintedAt);
        const count = Math.round(Number(r.printCount));
        rows.push({
          firstName,
          lastName,
          clubName: cleanText(r.clubName, 40, { control: ' ', angle: true, collapse: true }),
          lastPrintedAt: Number.isFinite(at) && at > 0 ? Math.floor(at) : 0,
          printCount: Number.isFinite(count) ? Math.min(Math.max(count, 1), 1e6) : 1,
        });
      }
      rows.sort((a, b) => b.lastPrintedAt - a.lastPrintedAt);
      return { ok: true, value: rows.slice(0, rule.max) };
    }
    case 'dates': {
      if (!Array.isArray(v)) return { ok: false };
      const days = [...new Set(v.filter((d) => typeof d === 'string' && realDate(d)))].sort();
      return days.length <= rule.max ? { ok: true, value: days } : { ok: false };
    }
    default:
      return { ok: false };
  }
}

/**
 * The church settings a document may hold: every allowlisted key whose value
 * passes its rule. `dropped` names every key that was not kept (an unknown key,
 * a value its rule refused), at most 40. A `null` or `undefined` value is
 * neither kept nor dropped (it means "the default").
 * @param {unknown} raw
 * @returns {{ settings: Record<string, any>, dropped: string[] }}
 */
export function sanitizeChurch(raw) {
  /** @type {Record<string, any>} */
  const settings = {};
  /** @type {string[]} */
  const dropped = [];
  if (!isPlainObject(raw)) return { settings, dropped };
  for (const key of Object.keys(raw)) {
    const v = raw[key];
    if (v === null || v === undefined) continue;
    const c = cleanChurchValue(key, v);
    if (c.ok) settings[key] = c.value;
    else if (dropped.length < 40) dropped.push(String(key).slice(0, 40));
  }
  return { settings, dropped };
}

/**
 * An edit applied to a document: a key sent as `null` is deleted (back to the
 * default), any other allowlisted key whose value passes its rule replaces the
 * old one, and everything else is ignored (the old value stays). Returns a new
 * object; `prev` is not changed.
 * @param {unknown} prev @param {unknown} patch
 * @returns {Record<string, any>}
 */
export function mergeChurch(prev, patch) {
  const out = sanitizeChurch(prev).settings;
  if (!isPlainObject(patch)) return out;
  for (const key of Object.keys(patch)) {
    if (!own(CHURCH_SPEC, key)) continue;
    const v = patch[key];
    if (v === null) { delete out[key]; continue; }
    const c = cleanChurchValue(key, v);
    if (c.ok) out[key] = c.value;
  }
  return out;
}

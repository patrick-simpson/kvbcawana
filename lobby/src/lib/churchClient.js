// @ts-check
// The check-in laptop's church-wide printing settings, edited from anywhere
// through the sync Worker (routes.md 10.3, docs/SETTINGS-OVERHAUL.md section 4
// and 2.5). The Worker holds ONE document; every edit names the revision it
// was made against (`baseRev`), and a 409 `stale` hands back the newer
// document so the card can show it WITH its own unsaved edits re-applied.
//
// This file never judges a value (the Worker's `sanitizeChurch` does, one
// allowlist for the whole family); it only builds the request, reads the five
// answers and keeps the unsaved edits from being lost. Church-authored
// settings only: nothing here is a child.

import { call } from './workerClient.js';

/** The keys the church document may hold (routes.md 10.3 CHURCH_SPEC). */
export const CHURCH_KEYS = [
  'labelFooter', 'firstTimerInverted', 'trophyBand', 'connectCard', 'connectCardAutoFirstTimer',
  'connectCardGreeting', 'enableDrivenCheckin', 'labelTemplates', 'schedule', 'lateGraceMin',
  'pickupClubs', 'seasonTheme', 'barfNights',
];

/** What the cards show for a key the document does not hold (the laptop's own defaults). */
export const CHURCH_DEFAULTS = Object.freeze({
  labelFooter: '',
  firstTimerInverted: true,
  trophyBand: true,
  connectCard: false,
  connectCardAutoFirstTimer: false,
  connectCardGreeting: '',
  enableDrivenCheckin: true,
  labelTemplates: {},
  schedule: [],
  lateGraceMin: 10,
  pickupClubs: null,
  seasonTheme: 'auto',
  barfNights: [],
});

export const STALE_WORDS = 'Someone else changed this a moment ago; check and save again.';
export const UNSEEDED_WORDS = 'Waiting for the check-in laptop to send its settings (KVBC Awana 9.3.0).';
export const PAUSED_WORDS = 'Paused: change these at the laptop.';

/**
 * @typedef {{
 *   rev: number, savedAt: string | null, by: any, seeded: any, paused: boolean,
 *   settings: Record<string, any> | null, switches: Record<string, 'on' | 'off'>, switchesRev: number,
 * }} ChurchDoc
 */

/** @param {any} b @returns {ChurchDoc} */
export function docFrom(b) {
  const o = b && typeof b === 'object' ? b : {};
  return {
    rev: Number.isInteger(o.rev) ? o.rev : 0,
    savedAt: typeof o.savedAt === 'string' ? o.savedAt : null,
    by: o.by ?? null,
    seeded: o.seeded ?? null,
    paused: o.paused === true,
    settings: o.settings && typeof o.settings === 'object' && !Array.isArray(o.settings) ? o.settings : null,
    switches: o.switches && typeof o.switches === 'object' ? o.switches : {},
    switchesRev: Number.isInteger(o.switchesRev) ? o.switchesRev : 0,
  };
}

/**
 * What the cards do with the document.
 * @param {ChurchDoc | null} doc
 * @returns {'loading' | 'unseeded' | 'paused' | 'ready'}
 */
export function churchState(doc) {
  if (!doc) return 'loading';
  if (doc.rev === 0 || !doc.settings) return 'unseeded';
  if (doc.paused) return 'paused';
  return 'ready';
}

/** The value a card shows for `key`. @param {ChurchDoc | null} doc @param {string} key */
export function churchValue(doc, key) {
  const have = doc?.settings && Object.prototype.hasOwnProperty.call(doc.settings, key) ? doc.settings[key] : undefined;
  return have === undefined ? /** @type {any} */ (CHURCH_DEFAULTS)[key] : have;
}

/**
 * A copy of `settings` with `changes` applied (a key sent as null is deleted,
 * as the Worker's mergeChurch does).
 * @param {Record<string, any> | null} settings @param {Record<string, any>} changes
 */
export function mergeLocal(settings, changes) {
  const next = { ...(settings || {}) };
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) delete next[k]; else next[k] = v;
  }
  return next;
}

export async function fetchChurch() {
  const a = await call('/v1/church/settings');
  return a.ok ? { ok: /** @type {const} */ (true), doc: docFrom(a.body) } : { ok: /** @type {const} */ (false), message: a.message };
}

/**
 * @typedef {{ ok: true, doc: ChurchDoc }
 *   | { ok: false, kind: 'stale', doc: ChurchDoc, message: string }
 *   | { ok: false, kind: 'not-seeded' | 'paused' | 'too-big' | 'refused' | 'error', message: string }} SaveResult
 */

/**
 * Save the changed keys against the revision the card was showing.
 * @param {ChurchDoc} doc the document the card was drawn from
 * @param {Record<string, any>} changes only the changed keys; null deletes a key
 * @param {{ fromDefaults?: boolean }} [opts]
 * @returns {Promise<SaveResult>}
 */
export async function saveChurch(doc, changes, opts = {}) {
  const body = { baseRev: doc.rev, settings: changes, ...(opts.fromDefaults ? { fromDefaults: true } : {}) };
  const a = await call('/v1/church/settings', { method: 'PUT', body });
  if (a.ok) {
    const b = a.body || {};
    return {
      ok: true,
      doc: {
        ...doc,
        rev: Number.isInteger(b.rev) ? b.rev : doc.rev + 1,
        savedAt: typeof b.savedAt === 'string' ? b.savedAt : doc.savedAt,
        settings: b.settings && typeof b.settings === 'object' ? b.settings : mergeLocal(doc.settings, changes),
      },
    };
  }
  const reason = a.body?.reason;
  if (a.status === 409 && reason === 'stale') {
    const fresh = docFrom({ ...doc, ...a.body, switches: doc.switches });
    return { ok: false, kind: 'stale', doc: { ...fresh, switchesRev: doc.switchesRev }, message: STALE_WORDS };
  }
  if (a.status === 409 && reason === 'not-seeded') return { ok: false, kind: 'not-seeded', message: UNSEEDED_WORDS };
  if (a.status === 503 && reason === 'church-off') return { ok: false, kind: 'paused', message: PAUSED_WORDS };
  if (a.status === 413) return { ok: false, kind: 'too-big', message: 'That is too much for one settings document. Remove something and try again.' };
  if (a.status === 400) return { ok: false, kind: 'refused', message: 'The service did not accept that value. Check it and try again.' };
  return { ok: false, kind: 'error', message: a.message };
}

/**
 * The unsaved edits of a card laid over a document that moved on: the card
 * shows the new document with its own typing still in it.
 * @param {Record<string, any> | null} fresh the new document's settings
 * @param {Record<string, any>} unsaved the card's edits, keyed like the document
 */
export function reapplyEdits(fresh, unsaved) {
  return mergeLocal(fresh, unsaved);
}

/** @returns {Promise<{ok: true, doc: ChurchDoc} | {ok: false, message: string}>} */
export async function startFromDefaults() {
  const doc = docFrom({ rev: 0 });
  // One harmless default key, so the Worker never sees an empty edit (it would
  // answer 400 "every sent key was dropped"); the laptop's own value is 10 too.
  const r = await saveChurch(doc, { lateGraceMin: CHURCH_DEFAULTS.lateGraceMin }, { fromDefaults: true });
  return r.ok ? r : { ok: false, message: r.message };
}

// @ts-check
// Print jobs started from the settings page, from anywhere (docs/SETTINGS-
// OVERHAUL.md 2.5, routes.md section 6): a reprint, a leader tag, a one-off
// name tag, a custom label. The record is SEALED IN THIS BROWSER to every
// registered station (cloud-crypto sealForStations) and posted as a
// `reprint:<uuid>` job; a station opens it and runs the route on its own print
// server from loopback, so every old rule still applies. The Worker never sees
// a name in the clear and never opens a bundle.
//
// At most once is the station's journal (routes.md section 6); this side's
// part is ONE jobId per press (the caller disables its button until this
// answers) and resealing only when a station registered or left meanwhile
// (409 `stations-changed`), at most RESEAL_MAX times, as site/desk/
// desk-transport.js does.

import { churchNight, newRowId, sealForStations, sealRow } from '../../../shared/cloud-crypto.js';
import { call } from './workerClient.js';

/** A stations-changed answer is resealed at most this many times. */
export const RESEAL_MAX = 3;

/** The print routes a settings-page job may name (the station's JOB_PULL_ROUTES allow them). */
export const TOOL_ROUTES = Object.freeze(['/reprint', '/print-leader', '/print-oneoff', '/print-custom', '/print-barf-bags']);

/**
 * @param {string} route @param {Record<string, unknown>} body @param {number} [now]
 * @returns {{ route: string, body: Record<string, unknown>, source: 'settings', at: string }}
 */
export function toolRecord(route, body, now = Date.now()) {
  if (!TOOL_ROUTES.includes(route)) throw new Error(`not a settings-page print route: ${route}`);
  return { route, body, source: 'settings', at: new Date(now).toISOString() };
}

/** Reprint one child's label from tonight's list. @param {{ name: string, clubberId?: string | null }} child */
export const reprintRecord = (/** @type {{ name: string, clubberId?: string | null }} */ child, /** @type {number} */ now = Date.now()) => toolRecord('/reprint', { name: String(child.name || '').trim(), clubberId: child.clubberId || null }, now);
/** @param {{ name: string, clubName: string }} tag */
export const leaderRecord = (/** @type {{ name: string, clubName: string }} */ tag, /** @type {number} */ now = Date.now()) => toolRecord('/print-leader', { name: tag.name, clubName: tag.clubName || '' }, now);
/** @param {{ firstName: string, clubName: string }} tag */
export const oneOffRecord = (/** @type {{ firstName: string, clubName: string }} */ tag, /** @type {number} */ now = Date.now()) => toolRecord('/print-oneoff', { firstName: tag.firstName, clubName: tag.clubName }, now);
/** @param {string} text */
export const customRecord = (/** @type {string} */ text, /** @type {number} */ now = Date.now()) => toolRecord('/print-custom', { text }, now);
/** Tonight's BARF Bag labels, one job (the station's /print-barf-bags). @param {string[]} names @param {any[]} bags */
export const barfBagsRecord = (/** @type {string[]} */ names, /** @type {any[]} */ bags, /** @type {number} */ now = Date.now()) => toolRecord('/print-barf-bags', { names, bags }, now);

/** @param {any[]} list */
export function asStations(list) {
  return (Array.isArray(list) ? list : []).filter((s) => s && typeof s.pub === 'string')
    .map((s) => ({ stationId: s.stationId, name: s.name, kid: s.kid, publicKey: s.pub }));
}

/**
 * @typedef {{
 *   call: typeof call, seal: typeof sealForStations, sealRow: typeof sealRow,
 *   newId: () => string, uuid: () => string, now: () => number,
 * }} Deps
 * @typedef {{ ok: true, jobId: string, existing: boolean, history: 'none' | 'stored' | 'failed' }
 *   | { ok: false, reason: string, message: string }} JobResult
 */

/** @returns {Deps} */
function realDeps() {
  return { call, seal: sealForStations, sealRow, newId: newRowId, uuid: () => globalThis.crypto.randomUUID(), now: () => Date.now() };
}

/**
 * Seal a record to every station and post it as a reprint job.
 * @param {ReturnType<typeof toolRecord>} record
 * @param {{ historyRow?: { first: string, last?: string, club?: string }, deps?: Partial<Deps> }} [opts]
 * @returns {Promise<JobResult>}
 */
export async function sendToolJob(record, opts = {}) {
  const d = { ...realDeps(), ...(opts.deps || {}) };
  const night = churchNight(d.now());
  const first = await d.call('/v1/stations');
  if (!first.ok) return { ok: false, reason: 'unreachable', message: first.message };
  let stations = asStations(first.body);
  if (!stations.length) return { ok: false, reason: 'no-station', message: 'No printing computer is registered, so there is nowhere to print.' };
  const jobId = `reprint:${d.uuid()}`;

  for (let attempt = 0; attempt <= RESEAL_MAX; attempt++) {
    const bundle = await d.seal(stations, { id: d.newId(), night, kind: 'print-job', record });
    if (!bundle) return { ok: false, reason: 'unsealed', message: 'The job could not be sealed for the printing computers. Try again.' };
    const r = await d.call('/v1/print/reprint', { method: 'POST', body: { jobId, bundle } });
    if (r.status === 409 && r.body?.reason === 'stations-changed') {
      stations = asStations(r.body.stations);
      if (!stations.length) {
        const again = await d.call('/v1/stations');
        stations = again.ok ? asStations(again.body) : [];
      }
      if (!stations.length) return { ok: false, reason: 'no-station', message: 'No printing computer is registered, so there is nowhere to print.' };
      continue;
    }
    if (!r.ok || r.body?.ok === false) {
      return { ok: false, reason: 'refused', message: r.body?.reason === 'unsealed' ? 'The job could not be sealed for the printing computers. Try again.' : r.message || 'The service did not take the job.' };
    }
    const history = opts.historyRow ? await storeReprintRow(night, opts.historyRow, d) : 'none';
    return { ok: true, jobId, existing: r.body?.existing === true, history };
  }
  return { ok: false, reason: 'stations-changed', message: 'The printing computers keep changing. Try again in a moment.' };
}

/**
 * The `reprint` history row that rides beside a reprint (routes.md section 3):
 * sealed to the history key in this browser. Best effort: the label is the
 * point, so a failure here is reported, never an error for the print.
 * @param {string} night @param {{ first: string, last?: string, club?: string }} who @param {Deps} d
 * @returns {Promise<'stored' | 'failed'>}
 */
async function storeReprintRow(night, who, d) {
  try {
    const key = await d.call('/v1/history/key');
    const pub = key.ok ? key.body?.pub : null;
    if (typeof pub !== 'string') return 'failed';
    const id = d.newId();
    const record = { ts: d.now(), first: who.first, last: who.last || '', club: who.club || '', source: 'settings' };
    const sealed = await d.sealRow(pub, { id, night, kind: 'reprint', record });
    if (!sealed) return 'failed';
    const r = await d.call('/v1/history/rows', { method: 'POST', body: { rows: [{ id, night, kind: 'reprint', ...sealed }] } });
    return r.ok ? 'stored' : 'failed';
  } catch {
    return 'failed';
  }
}

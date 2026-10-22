// @ts-check
// The settings page's calls to the sync Worker's overhaul routes
// (worker/src/routes.md section 10): the overview, the switches, the
// notice and the change log. One signed-in request each, through the same
// `syncAuthed` every other Settings call uses (so every one carries X-Device /
// X-Device-Name). Never throws; every answer is {ok, status, body, message}.
// Counts, codes and church-authored text, and (Printing → Reprint a name tag, owner
// 2026-10-22) the desk roster the check-in page also reads: names held in React state only.

import { syncAuthed } from '../hooks/useSync.js';

/**
 * @typedef {{ ok: boolean, status: number, body: any, message: string }} Answer
 */

/**
 * The words for a failed call. A route the Worker does not have yet (it is
 * built beside this page) reads as "not there yet", never as an error.
 * @param {{ status: number, body: any }} res
 */
export function whyFailed(res) {
  if (res.status === -1) return 'Sign in first.';
  if (res.status === 0) return 'Could not reach the sync service.';
  if (res.status === 401) return 'Signed out: type the passphrase again under Account & app.';
  if (res.status === 404) return 'The sync service does not have this yet. It arrives with its next update.';
  if (typeof res.body?.error === 'string') return res.body.error;
  return `The sync service answered HTTP ${res.status}.`;
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [opts]
 * @returns {Promise<Answer>}
 */
export async function call(path, opts = {}) {
  const res = await syncAuthed(path, opts);
  return { ok: res.ok, status: res.status, body: res.body, message: res.ok ? '' : whyFailed(res) };
}

export const getOverview = () => call('/v1/tonight/overview');
export const getSwitches = () => call('/v1/switches');
/**
 * `dryRun: true` answers the warnings (and `oldStations`) the flip WOULD get and
 * writes nothing (routes.md 10.2), so the confirm can name them first.
 * @param {{ name: string, value: 'on' | 'off' | 'default', rev?: number, dryRun?: boolean }} body
 */
export const putSwitch = (body) => call('/v1/switches', { method: 'PUT', body });
export const getNotice = () => call('/v1/notice');
/** @param {{ level: 'info' | 'warn' | 'critical', message: string, durationMin: number }} body */
export const postNotice = (body) => call('/v1/notice', { method: 'POST', body });
export const deleteNotice = () => call('/v1/notice', { method: 'DELETE' });
/** @param {{ before?: number, limit?: number }} [q] */
export function getChanges(q = {}) {
  const p = new URLSearchParams();
  if (q.before) p.set('before', String(q.before));
  p.set('limit', String(q.limit ?? 50));
  return call(`/v1/changes?${p}`);
}
/** @param {number} seq */
export const undoChange = (seq) => call(`/v1/changes/${encodeURIComponent(String(seq))}/undo`, { method: 'POST', body: {} });
export const getAuthStatus = () => call('/v1/cloud/status');
export const getStations = () => call('/v1/stations');

/** The levels the composer offers, in the Worker's words. */
export const NOTICE_LEVELS = [
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Heads up' },
  { value: 'critical', label: 'Urgent' },
];
/** How long it stays up (routes.md 10.4: durationMin 5..240). */
export const NOTICE_DURATIONS = [
  { min: 15, label: '15 minutes' },
  { min: 30, label: '30 minutes' },
  { min: 60, label: '1 hour' },
  { min: 120, label: '2 hours' },
  { min: 240, label: '4 hours' },
];
export const NOTICE_MESSAGE_MAX = 200;

/** The words for a switch warning code (routes.md 10.2). @param {string} code */
export function warningWords(code) {
  return /** @type {Record<string, string>} */ ({
    'no-station': 'No printing computer has been heard from in 2 minutes, so nothing would notice the change yet.',
    'station-old': 'A printing computer is on an older KVBC Awana (before 9.3.0) and cannot follow this change until it updates.',
    'window-open': 'Check-in is open right now.',
    'ym-tab-reload': 'With this off, nothing checks Trek and Journey out at 7:15 pm: KVBC Awana 10.0.0 has no Chrome extension to do it (only a laptop still on 9.x does, once its TwoTimTwo tab is reloaded).',
    'station-old-sweep': 'A printing computer is on an older KVBC Awana (before 9.3.0): its Chrome extension may still check Trek and Journey out too, so there would be two. Update it to the newest first (10.0.0 has no extension).',
    'station-old-publish': 'A printing computer is on an older KVBC Awana (before 9.3.0): it publishes the count only by how it started, so with this off nobody may publish the count and pickup list. Update it first.',
  })[code] || code;
}

/**
 * The stations a `station-old*` warning is about, in words (the PUT's
 * `oldStations`, routes.md 10.2). '' when there are none.
 * @param {unknown} old
 */
export function oldStationWords(old) {
  const list = Array.isArray(old) ? old : [];
  if (!list.length) return '';
  const names = list.slice(0, 5).map((/** @type {any} */ s) => `${s?.name || 'A printing computer'} (${s?.version ? `KVBC Awana ${s.version}` : 'version unknown'})`);
  return `Older printing computers: ${names.join(', ')}${list.length > 5 ? `, and ${list.length - 5} more` : ''}.`;
}

/** A station seen this recently counts as on (routes.md 10.2). */
export const STATION_RECENT_MS = 2 * 60 * 1000;
/** The first KVBC Awana that follows a runtime SINGLE_PUBLISHER / YM_CHECKOUT change. */
export const STATION_MIN_VERSION = '9.3.0';

/** @param {unknown} v @returns {number[]} */
function versionParts(v) {
  return String(v ?? '').split('.').map((n) => Number.parseInt(n, 10) || 0);
}
/** @param {unknown} a @param {unknown} b @returns {boolean} a < b */
export function versionBelow(a, b) {
  const x = versionParts(a);
  const y = versionParts(b);
  for (let i = 0; i < 3; i += 1) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  }
  return false;
}

/**
 * What the Worker is likely to warn about, worked out here from what the page
 * already holds (the switches' station list and the overview's watch window).
 * Only a fallback: the confirm asks the Worker first (`dryRun`), and uses this
 * when that call fails. Same rules as `switchWarnings` (routes.md 10.2):
 * `no-station` for the online group, `station-old` for SINGLE_PUBLISHER /
 * YM_CHECKOUT, `window-open` for any switch, `ym-tab-reload` when YM_CHECKOUT
 * goes off with any station registered, `station-old-sweep` / `-publish` from
 * every REGISTERED station, seen lately or not.
 * @param {{ stations?: any[], switches?: any[] } | null} switches the GET /v1/switches answer
 * @param {any} overview
 * @param {string} name @param {'on' | 'off' | 'default'} value @param {number} [now]
 * @returns {string[]} warning codes
 */
export function predictWarnings(switches, overview, name, value, now = Date.now()) {
  /** @type {string[]} */
  const out = [];
  const stations = Array.isArray(switches?.stations) ? switches.stations : [];
  const row = (Array.isArray(switches?.switches) ? switches.switches : []).find((s) => s.name === name);
  const to = value === 'default' ? (row?.default ?? null) : value;
  if (row && to !== null && row.value === to) return out;   // the effective value does not change
  const recent = stations.filter((s) => {
    const t = typeof s.lastSeenAt === 'number' ? s.lastSeenAt : Date.parse(s.lastSeenAt);
    return Number.isFinite(t) && now - t <= STATION_RECENT_MS;
  });
  const isOld = (/** @type {any} */ s) => !s.version || versionBelow(s.version, STATION_MIN_VERSION);
  const online = name === 'CLOUD_PRINT' || name === 'SINGLE_PUBLISHER' || name === 'YM_CHECKOUT';
  if (online && !recent.length) out.push('no-station');
  if ((name === 'SINGLE_PUBLISHER' || name === 'YM_CHECKOUT') && recent.some(isOld)) out.push('station-old');
  if (overview?.window?.open) out.push('window-open');
  if (name === 'YM_CHECKOUT' && to === 'off' && stations.length) out.push('ym-tab-reload');
  if (name === 'YM_CHECKOUT' && to === 'on' && stations.some(isOld)) out.push('station-old-sweep');
  if (name === 'SINGLE_PUBLISHER' && to === 'off' && stations.some(isOld)) out.push('station-old-publish');
  return out;
}

/** The sentence a notice send/undo/take-down failure gets. @param {Answer} a */
export function noticeFailure(a) {
  if (a.status === 503 && a.body?.reason === 'notices-off') return 'Notices are switched off (Online check-in switches, Advanced).';
  if (a.status === 400) return 'Write a message first (up to 200 characters).';
  return a.message;
}

/** The sentence an undo that did not happen gets. @param {Answer} a */
export function undoFailure(a) {
  const reason = a.body?.reason;
  if (a.status === 409 && reason === 'changed-since') return 'Changed again since; nothing undone.';
  if (a.status === 409 && reason === 'already-undone') return 'That was already undone.';
  if (a.status === 409) return 'That change cannot be undone.';
  if (a.status === 410) return 'That change is too old to undo.';
  if (a.status === 503) return 'The setting it belongs to is switched off, so it cannot be undone right now.';
  return a.message;
}

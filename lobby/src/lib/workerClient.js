// @ts-check
// The settings page's calls to the sync Worker's overhaul routes
// (lobby/worker/src/routes.md section 10): the overview, the switches, the
// notice and the change log. One signed-in request each, through the same
// `syncAuthed` every other Settings call uses (so every one carries X-Device /
// X-Device-Name). Never throws; every answer is {ok, status, body, message}.
// Counts, codes and church-authored text only: nothing here carries a child.

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
/** @param {{ name: string, value: 'on' | 'off' | 'default', rev?: number }} body */
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
    'ym-tab-reload': 'The TwoTimTwo tab on the check-in laptop must be reloaded before its own Trek and Journey check-out runs again.',
  })[code] || code;
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

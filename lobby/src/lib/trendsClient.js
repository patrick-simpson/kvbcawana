// @ts-check
// The trends back-fill's status, for the History section's Trends card
// (lobby/worker/src/routes.md section 3, "The trends back-fill" and its
// self-check; owner 2026-10-13). The Worker brings in earlier seasons from
// TwoTimTwo's Attendance Summary by itself; this reads what it has done
// (`GET /v1/history/import-status`) and says it in plain words: where the
// trends' older nights come from, and how they compare with the check-in desk.
// Read-only. Fixed codes, season labels, dates, club names and numbers only:
// nothing here is a child.

import { call } from './workerClient.js';
import { agoWords, atMs } from './missionControl.js';
import { nightWords } from './historyTrends.js';

/** How often the card asks while the History section is open and the tab visible. */
export const IMPORT_STATUS_POLL_MS = 60 * 1000;

const STATES = new Set(['idle', 'running', 'done', 'unreadable', 'not-configured']);
const SEASON_RE = /^\d{4}-\d{2}$/;
const NIGHT_RE = /^\d{4}-\d{2}-\d{2}$/;

/** @param {unknown} v */
const count = (v) => (Number.isInteger(v) && /** @type {number} */ (v) >= 0 ? /** @type {number} */ (v) : 0);
/** @param {unknown} v */
const time = (v) => (typeof v === 'string' && atMs(v) !== null ? v : null);

/**
 * @typedef {{ night: string, club: string, desk: number, twotimtwo: number }} CrossLine
 * @typedef {{ compared: number, matching: number, differing: number, deskHigher: number, examples: CrossLine[], at: string|null }} CrossCheck
 * @typedef {{
 *   state: 'idle'|'running'|'done'|'unreadable'|'not-configured', reason: string|null,
 *   seasons: { season: string, nights: number, importedAt: string|null }[],
 *   oldestSeason: string|null, nextDueAt: string|null, ended: string|null, crosscheck: CrossCheck|null,
 * }} ImportStatus
 */

/**
 * The Worker's answer, kept to the shape the card reads (anything else is
 * dropped). null when it is not a status at all.
 * @param {any} raw @returns {ImportStatus|null}
 */
export function importStatusFrom(raw) {
  if (!raw || typeof raw !== 'object' || !STATES.has(raw.state)) return null;
  const seasons = (Array.isArray(raw.seasons) ? raw.seasons : [])
    .filter((/** @type {any} */ s) => s && SEASON_RE.test(String(s.season)))
    .map((/** @type {any} */ s) => ({ season: String(s.season), nights: count(s.nights), importedAt: time(s.importedAt) }));
  const c = raw.crosscheck;
  const crosscheck = c && typeof c === 'object' ? {
    compared: count(c.compared),
    matching: count(c.matching),
    differing: count(c.differing),
    deskHigher: count(c.deskHigher),
    examples: (Array.isArray(c.examples) ? c.examples : [])
      .filter((/** @type {any} */ e) => e && NIGHT_RE.test(String(e.night)) && typeof e.club === 'string' && e.club.length <= 24)
      .slice(0, 5)
      .map((/** @type {any} */ e) => ({ night: String(e.night), club: e.club, desk: count(e.desk), twotimtwo: count(e.twotimtwo) })),
    at: time(c.at),
  } : null;
  return {
    state: raw.state,
    reason: typeof raw.reason === 'string' ? raw.reason : null,
    seasons,
    oldestSeason: typeof raw.oldestSeason === 'string' && SEASON_RE.test(raw.oldestSeason) ? raw.oldestSeason : null,
    nextDueAt: time(raw.nextDueAt),
    ended: typeof raw.ended === 'string' ? raw.ended : null,
    crosscheck,
  };
}

/**
 * Ask the Worker once. A Worker from before this route answers 404 (`missing`):
 * the card then says nothing about it.
 * @returns {Promise<{ ok: true, status: ImportStatus } | { ok: false, missing: boolean, message: string }>}
 */
export async function fetchImportStatus() {
  const a = await call('/v1/history/import-status');
  const status = a.ok ? importStatusFrom(a.body) : null;
  if (status) return { ok: true, status };
  return { ok: false, missing: a.status === 404, message: a.ok ? 'The sync service answered something unexpected.' : a.message };
}

/** The words for each reason it is waiting (routes.md section 3, "Not configured"). */
export const WAITING_WORDS = Object.freeze({
  'no-secrets': 'Waiting for TwoTimTwo to be connected in Settings.',
  'cloud-off': 'Waiting: online check-in is switched off, so the service does not read TwoTimTwo.',
  'history-off': 'Waiting for history storage to be set up.',
  'sign-in-refused': 'Waiting: TwoTimTwo did not accept the church’s check-in sign-in. It will try again later.',
  'no-permission': 'Waiting: the church’s TwoTimTwo user is not allowed to open the attendance report.',
});

/** @param {number} n @param {string} one @param {string} many */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The card's two lines: where the earlier seasons come from (`line`), and how
 * they compare with the check-in desk (`check`, null until there is a result).
 * `tone` is 'warn' only for something the owner may want to look at (a report
 * that did not read, a refused sign-in or report), never for a plain wait.
 * @param {ImportStatus|null} st @param {number} [now]
 * @returns {{ line: string, tone: 'ok'|'warn', check: string|null, checkTone: 'ok'|'warn' } | null}
 */
export function importStatusWords(st, now = Date.now()) {
  if (!st) return null;
  const withNights = st.seasons.filter((s) => s.nights > 0);
  const n = withNights.length;
  const last = st.seasons.reduce((/** @type {number|null} */ m, s) => {
    const t = atMs(s.importedAt);
    return t !== null && (m === null || t > m) ? t : m;
  }, null);
  const backTo = st.oldestSeason && n ? `back to ${st.oldestSeason} (${plural(n, 'season', 'seasons')})` : '';
  /** @type {string} */
  let line;
  /** @type {'ok'|'warn'} */
  let tone = 'ok';
  if (st.state === 'running') {
    line = `Bringing in earlier seasons from TwoTimTwo…${n ? ` ${plural(n, 'season', 'seasons')} in so far.` : ''}`;
  } else if (st.state === 'done') {
    line = backTo
      ? `Earlier seasons from TwoTimTwo: ${backTo}, last updated ${agoWords(last, now)}.`
      : 'TwoTimTwo has no earlier seasons to bring in.';
  } else if (st.state === 'unreadable') {
    tone = 'warn';
    const next = atMs(st.nextDueAt);
    const when = next !== null && next - now <= 36 * 3600 * 1000 ? 'It will try again tomorrow.' : 'It will try again after the next club night.';
    line = `TwoTimTwo’s attendance report did not read as expected, so nothing was imported. ${when}`;
    if (backTo) line += ` The seasons already in (${backTo}) are still shown.`;
  } else if (st.state === 'not-configured') {
    // Not connected yet is a wait, not a fault; a refused sign-in or report is worth a look.
    if (st.reason === 'sign-in-refused' || st.reason === 'no-permission') tone = 'warn';
    line = /** @type {Record<string, string>} */ (WAITING_WORDS)[st.reason || ''] || 'Waiting for TwoTimTwo to be connected.';
  } else {
    line = 'Earlier seasons will come in by themselves after the next sync.';
  }
  const c = st.crosscheck;
  /** @type {string|null} */
  let check = null;
  /** @type {'ok'|'warn'} */
  let checkTone = 'ok';
  if (c) {
    if (!c.compared) check = 'Nothing to compare with the desk yet.';
    else if (!c.differing) check = `Checked against the check-in desk on ${plural(c.compared, 'night', 'nights')}: ${c.compared === 1 ? 'it agrees' : `all ${c.compared} agree`}.`;
    else {
      const agree = `${c.matching} ${c.matching === 1 ? 'agrees' : 'agree'}`;
      const differ = `${c.differing} ${c.differing === 1 ? 'differs' : 'differ'}`;
      check = `Checked against the check-in desk on ${plural(c.compared, 'night', 'nights')}: ${agree}, ${differ}`;
      if (c.deskHigher) {
        checkTone = 'warn';
        check += `. On ${plural(c.deskHigher, 'night', 'nights')} the desk counted more than TwoTimTwo, which is worth a look.`;
      } else {
        check += ' (the desk may have counted only some children).';
      }
      const e = c.examples[0];
      if (e) check += ` For example ${nightWords(e.night)}, ${e.club}: ${e.desk} at the desk, ${e.twotimtwo} in TwoTimTwo.`;
    }
  }
  return { line, tone, check, checkTone };
}

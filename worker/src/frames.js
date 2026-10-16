// The frames the Worker publishes when it is the one publisher (P5), in the
// SAME shapes the print server's builders make (printer/print-server/events.js
// buildTally, buildCheckout, buildTonight; the contract vectors pin them and
// printer/scripts/test-cloud-e2e.cjs compares the Worker's frames with the
// printer's builders on the same input). Names and caps are the same:
// the text cleaner is shared/text.js, the one both sides use.
//
// PRIVACY (unchanged): `tally` and `tonight` are PURE NUMBERS (plaintext, like
// today); `checkout` (who is still here) is first name + club only and is
// SEALED with the display key by the caller (sync.js publishSealed), padded on
// the `checkout` ladder by crypto.js seal(), so its length leaks nothing.

import { cleanText } from '../../shared/text.js';

export const NAME_MAX = 40;
export const TALLY_CLUBS_MAX = 30;
export const CHECKOUT_MAX = 60;

/** @param {unknown} s */
const cleanName = (s) => cleanText(s, NAME_MAX, { coerce: true });

/** Whole non-negative integer, or 0. @param {unknown} v */
export function wholeCount(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/**
 * Per-club counts, zero PII. `extras.season` (a lowercase slug) and
 * `extras.rehearsal` (true) are the optional plaintext fields contract v5 has.
 * @param {Record<string, number>} byClub @param {number} total
 * @param {{ season?: unknown, rehearsal?: unknown }|null} extras @param {number} now ms
 */
export function buildTally(byClub, total, extras, now) {
  /** @type {Record<string, number>} */
  const counts = {};
  let sum = 0;
  for (const [club, n] of Object.entries(byClub && typeof byClub === 'object' ? byClub : {}).slice(0, TALLY_CLUBS_MAX)) {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) continue;
    const key = cleanName(club);
    if (!key) continue;
    counts[key] = Math.floor(v);
    sum += counts[key];
  }
  const t = Number(total);
  /** @type {Record<string, any>} */
  const out = { counts, total: Number.isFinite(t) && t >= 0 ? Math.floor(t) : sum, at: new Date(now).toISOString() };
  if (extras && typeof extras === 'object') {
    const s = String(extras.season || '').toLowerCase();
    if (/^[a-z][a-z-]{1,19}$/.test(s)) out.season = s;
    if (extras.rehearsal === true) out.rehearsal = true;
  }
  return out;
}

/**
 * Who is still here: first name + club, structurally nothing else. `printed`
 * rides beside the list (how many children had a label tonight).
 * @param {{ firstName?: unknown, club?: unknown }[]} rawEntries @param {number} printed @param {number} now ms
 */
export function buildCheckout(rawEntries, printed, now) {
  /** @type {{ firstName: string, club: string }[]} */
  const entries = [];
  for (const item of Array.isArray(rawEntries) ? rawEntries : []) {
    if (entries.length >= CHECKOUT_MAX) break;
    if (!item || typeof item !== 'object') continue;
    const firstName = cleanName(item.firstName);
    if (!firstName) continue;
    entries.push({ firstName, club: cleanName(item.club) });
  }
  /** @type {Record<string, any>} */
  const payload = { entries, at: new Date(now).toISOString() };
  const p = Number(printed);
  if (Number.isFinite(p) && p >= 0) payload.printed = Math.floor(p);
  return payload;
}

/**
 * The lobby ticker's aggregate counters: pure numbers.
 * @param {{ checkedIn?: unknown, booksCompleted?: unknown, awardsEarned?: unknown, friendsBrought?: unknown }} src @param {number} now ms
 */
export function buildTonight(src, now) {
  const s = src || {};
  return {
    checkedIn: wholeCount(s.checkedIn),
    booksCompleted: wholeCount(s.booksCompleted),
    awardsEarned: wholeCount(s.awardsEarned),
    friendsBrought: wholeCount(s.friendsBrought),
    at: new Date(now).toISOString(),
  };
}

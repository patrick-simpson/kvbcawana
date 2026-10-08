import { stampOf } from './freshness.js';

// @ts-check
// Should the who's-still-here board be on screen right now, and if so, may it
// name individuals?
//
// This is a PURE function on purpose, kept out of the component, because it is
// the safety-relevant part of the feature and it needs to be tested exhaustively
// rather than eyeballed in a browser.
//
// WHY THE BOARD IS GATED AT ALL
//
// The board's data is a list of children who are not yet with a parent. That is
// genuinely useful during pickup — a volunteer can see at a glance who is still
// waiting — and it is the one payload on this system where being wrong, or being
// read by the wrong person, actually matters. Three separate things are wrong
// with showing it unconditionally:
//
//  1. IT IS NOT A HEADCOUNT. It reflects whether volunteers PERFORMED checkout
//     in TwoTimTwo, which during a pickup rush they frequently do not. So it can
//     be *fresh* and *confidently wrong* — a state no staleness check can catch,
//     because the data really did just arrive.
//
//  2. A SHORT LIST IDENTIFIES INDIVIDUALS. Forty names is anonymising; two names
//     is a statement about two specific unattended children, arriving exactly
//     when the room has emptied and a stranger is most conspicuous. And
//     `checkin` already published those names earlier in the evening, so the
//     board is not adding a name — it is adding "and this one is still alone".
//
//  3. IT GOES QUIET NORMALLY. The scraper only runs while a volunteer has the
//     TwoTimTwo tab open, so silence is the expected end-of-night state, not a
//     fault. A frozen list that still looks live is the worst rendering.
//
// So: time-windowed, name-suppressed below a threshold, and aged rather than
// frozen.
//
// Until 2026-10-01 'pickup' mode followed the schedule's phases (and went DOWN
// at 7:35, as families arrived); until 2026-10-08 a mode and a window set in
// Settings. Since then there is no switch at all (owner, 2026-10-08): the
// pickup features come on by themselves from PICKUP_START local time every
// night until midnight. The printer only publishes a checkout list on club
// nights, and which clubs are on it is set on the check-in laptop's
// dashboard, so "on" is the printer's business and "when" is this clock's.

/** Board states the component knows how to render. */
export const BOARD_HIDDEN = 'hidden';
export const BOARD_NAMES = 'names';
export const BOARD_ANONYMOUS = 'anonymous';
export const BOARD_STALE = 'stale';
export const BOARD_EMPTY = 'empty';

/**
 * @typedef {object} BoardDecision
 * @property {'hidden'|'names'|'anonymous'|'stale'|'empty'} state
 * @property {string} [reason] Why it is hidden/limited — for the operator, not the wall.
 * @property {number} [ageMin] How old the data is, when that matters.
 */

/** When the pickup features come on, local time, every night until midnight (owner, 2026-10-08). */
export const PICKUP_START = '19:30';

/**
 * How long "Everyone has been checked out" stays up once the list empties, before the board steps away for the night.
 */
export const EMPTY_HOLD_MS = 60_000;

/**
 * "HH:MM" (24-hour) to minutes after midnight, or null when it is not one.
 * @param {unknown} hhmm
 * @returns {number | null}
 */
export function parseHHMM(hhmm) {
  if (typeof hhmm !== 'string') return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Whether `now` (epoch ms, read in the screen's local time) is pickup time:
 * PICKUP_START or later, until midnight.
 * @param {number} now
 * @returns {boolean}
 */
export function inPickupHours(now) {
  const start = /** @type {number} */ (parseHHMM(PICKUP_START));
  const d = new Date(now);
  return d.getHours() * 60 + d.getMinutes() >= start;
}

/**
 * @param {object} input
 * @param {{entries: {firstName: string, club: string}[], at: number, printed?: number, receivedAt?: number}|null} input.checkout
 *   Latest sanitized `checkout` payload, or null if none has arrived.
 * @param {number} input.namesAbove Suppress names at or below this count. 0 disables.
 * @param {number} input.staleMin Minutes before the data is stale.
 * @param {number} input.now Epoch ms.
 * @param {number | null} [input.emptySince] When this screen first saw the list
 *   empty (epoch ms), or null while it has names on it.
 * @param {boolean} [input.demo] A sample board shown on purpose (Settings' demo):
 *   on whatever the clock says, but the naming rule still applies.
 * @returns {BoardDecision}
 */
export function decideBoard({ checkout, namesAbove, staleMin, now, emptySince = null, demo = false }) {
  // Nothing has ever arrived. Show NOTHING rather than an empty board: an empty
  // board reads as "everyone has been picked up", and we do not know that.
  if (!checkout || !Number.isFinite(checkout.at)) {
    return { state: BOARD_HIDDEN, reason: 'no checkout data has arrived yet' };
  }

  // Pickup time only: from 7:30 pm until midnight. The board has no business
  // on the wall at 6:10pm when every child has just arrived.
  if (!demo && !inPickupHours(now)) {
    return { state: BOARD_HIDDEN, reason: `not pickup time yet (it comes on by itself at ${PICKUP_START})` };
  }

  // Aged from its arrival here, not the printer's clock, unless it really is
  // old (lib/freshness.js, stampOf).
  const ageMin = (now - stampOf(checkout)) / 60000;
  // A future timestamp means the two clocks disagree. Treat it as age zero
  // rather than as "fresh forever" — a skewed producer clock must not be able to
  // pin the board open indefinitely.
  const age = ageMin < 0 ? 0 : ageMin;
  if (age > staleMin) {
    return { state: BOARD_STALE, ageMin: Math.round(age), reason: 'the checkout tab is probably closed' };
  }

  const count = checkout.entries.length;
  // An empty board is real information and is safe to show: nobody is named, and
  // "everyone has been checked out" is exactly what a volunteer wants at 8:15.
  // Once it has said so for a minute, it steps away for the night.
  if (count === 0) {
    if (!demo && typeof emptySince === 'number' && Number.isFinite(emptySince) && now - emptySince >= EMPTY_HOLD_MS) {
      return { state: BOARD_HIDDEN, reason: 'everyone has been checked out' };
    }
    return { state: BOARD_EMPTY, ageMin: Math.round(age) };
  }

  if (namesAbove > 0 && count <= namesAbove) {
    return {
      state: BOARD_ANONYMOUS,
      ageMin: Math.round(age),
      reason: `only ${count} left — naming them would single out unattended children`,
    };
  }
  return { state: BOARD_NAMES, ageMin: Math.round(age) };
}

/**
 * Is the room being picked up right now, as far as the board, the "has checked
 * out" banners and the corner counter are concerned? From PICKUP_START until
 * midnight, every night (the printer only sends a list on club nights); a
 * demo always is.
 * @param {{ now: number, demo?: boolean }} input
 * @returns {boolean}
 */
export function pickupNow({ now, demo = false }) {
  return demo || inPickupHours(now);
}

/**
 * How many children the corner may count down during pickup, or null when it
 * shows tonight's check-ins instead: only in the pickup window, and only
 * while the board itself is naming children, so the corner never states an
 * exact small number the board withholds, nor a stale or switched-off
 * board's.
 * @param {BoardDecision} decision
 * @param {{entries: unknown[]} | null} checkout
 * @param {boolean} pickup
 * @returns {number | null}
 */
export function stillHereCount(decision, checkout, pickup) {
  if (!pickup || decision?.state !== BOARD_NAMES || !checkout) return null;
  return checkout.entries.length;
}

/**
 * A made-up board for Settings' preview and demo: sample first names across
 * the clubs, more in the middle ones, as a real night has. Never real data,
 * never published.
 * @param {ReadonlyArray<string>} clubs
 * @param {ReadonlyArray<string>} names
 * @param {number} at
 * @returns {{entries: {firstName: string, club: string}[], at: number}}
 */
export function demoCheckout(clubs, names, at) {
  const perClub = [2, 4, 4, 3, 2, 2];
  /** @type {{firstName: string, club: string}[]} */
  const entries = [];
  let n = 0;
  clubs.forEach((club, i) => {
    for (let k = 0; k < (perClub[i] ?? 2); k += 1) {
      entries.push({ firstName: names[n % names.length], club });
      n += 1;
    }
  });
  return { entries, at };
}

/**
 * Group entries by club for rendering, names sorted. Deterministic so a
 * re-render never reshuffles the wall. With `order` (the clubs youngest to
 * oldest, as the columns stand), clubs follow it and any club not in it comes
 * after, by name; without it, the largest club first.
 *
 * @param {{firstName: string, club: string}[]} entries
 * @param {ReadonlyArray<string>} [order]
 * @returns {{club: string, names: string[]}[]}
 */
export function groupByClub(entries, order) {
  /** @type {Map<string, string[]>} */
  const byClub = new Map();
  for (const e of entries || []) {
    const club = e.club || 'Other';
    if (!byClub.has(club)) byClub.set(club, []);
    (byClub.get(club) || []).push(e.firstName);
  }
  const groups = [...byClub.entries()]
    .map(([club, names]) => ({ club, names: [...names].sort((a, b) => a.localeCompare(b)) }));
  if (!order) {
    return groups.sort((a, b) => b.names.length - a.names.length || a.club.localeCompare(b.club));
  }
  /** @param {string} club */
  const rank = (club) => {
    const i = order.findIndex((o) => o.toLowerCase() === String(club).trim().toLowerCase());
    return i === -1 ? order.length : i;
  };
  return groups.sort((a, b) => rank(a.club) - rank(b.club) || a.club.localeCompare(b.club));
}

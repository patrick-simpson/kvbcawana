// @ts-check
// Big-number night milestones.
//
// Distinct from the two existing milestone paths:
//   • config.milestoneEvery     — every Nth check-in this DEVICE saw (local).
//   • config.clubMilestoneEvery — every Nth check-in per club (broadcast).
//
// These are the church-wide round numbers ("the 100th kid tonight"), taken from
// the printer's authoritative `tonight.checkedIn` broadcast rather than a local
// count, because a screen that booted late or dropped its connection would hit
// its own "100" at the wrong moment — and two screens in the same building would
// disagree about when it happened.

/**
 * Thresholds that earn their own celebration, ascending.
 * @type {ReadonlyArray<number>}
 */
export const NIGHT_MILESTONES = [50, 100, 150, 200, 250, 300];

/**
 * Which thresholds a count crossed moving from `prev` to `next`.
 *
 * Crossing is judged on the TRANSITION, never on `next` alone, for two reasons
 * that both really happen:
 *   • the broadcast can jump by more than one (a batch reconcile, or a screen
 *     that missed a few events), so `next % 50 === 0` would miss 100 entirely
 *     if the count went 98 → 103;
 *   • a reconnect re-delivers the current total, and celebrating on arrival
 *     would re-fire every milestone already passed.
 *
 * Returns them ascending so a single big jump celebrates in order.
 *
 * @param {number} prev
 * @param {number} next
 * @param {ReadonlyArray<number>} [thresholds]
 * @returns {number[]}
 */
export function crossedMilestones(prev, next, thresholds = NIGHT_MILESTONES) {
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return [];
  if (next <= prev) return [];
  return thresholds.filter((t) => prev < t && next >= t).sort((a, b) => a - b);
}

/**
 * Copy for a night milestone. Deliberately not the generic "N kids!" the
 * every-Nth toast uses — the point of a named threshold is that it reads as an
 * occasion rather than another routine toast.
 *
 * @param {number} count
 * @returns {{ label: string, headline: string }}
 */
export function nightMilestoneCopy(count) {
  if (count >= 200) {
    return { label: 'Tonight is huge', headline: `${count} kids in the building!` };
  }
  if (count >= 100) {
    return { label: 'Triple digits', headline: `${count} kids tonight!` };
  }
  return { label: 'Milestone', headline: `${count} kids and counting!` };
}

/**
 * Handbook progress thresholds (#358). Awana is about the handbook, but the
 * only thing the screen ever cheered was attendance — so these ride the same
 * `tonight` broadcast's booksCompleted / awardsEarned counters, which the
 * printer has been sending all along with nothing rendering them.
 *
 * Smaller numbers than the attendance thresholds on purpose: finishing ten
 * books in one night is a bigger deal than the hundredth kid through the door.
 * @type {ReadonlyArray<number>}
 */
export const BOOK_MILESTONES = [5, 10, 25];

/** @type {ReadonlyArray<number>} */
export const AWARD_MILESTONES = [10, 25, 50];

/**
 * Repair an operator-supplied threshold list: whole numbers 1–10000 only,
 * de-duplicated, ascending, and capped at twelve entries.
 *
 * Used by BOTH the config validator (so a corrupt localStorage entry or a
 * hostile ?config= file can never hand crossedMilestones a NaN or a
 * thousand-entry list) and the Settings field, so the two agree on what a
 * threshold list even is. Order matters downstream: crossedMilestones sorts
 * its output, but a caller reading thresholds directly should not have to.
 *
 * @param {unknown} raw
 * @returns {number[]}
 */
export function sanitizeMilestoneList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  for (const value of raw) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 10000) continue;
    seen.add(n);
  }
  return [...seen].sort((a, b) => a - b).slice(0, 12);
}

/**
 * Parse a Settings text field ("5, 10, 25") into a threshold list.
 * Anything unparseable is simply dropped — an operator mid-typing must never
 * see the field fight them, and an empty result means "off".
 *
 * @param {string} text
 * @returns {number[]}
 */
export function parseMilestoneList(text) {
  return sanitizeMilestoneList(String(text ?? '').split(/[^0-9]+/).filter(Boolean).map(Number));
}

/**
 * Copy for a "books finished tonight" celebration.
 *
 * Says *tonight* explicitly, and "finished" rather than "completed", because
 * this counter is the evening's own total from the check-in system — not a
 * running club-year figure, which is what a bare "10 books!" would imply on a
 * lobby wall.
 *
 * @param {number} count
 * @returns {{ label: string, headline: string }}
 */
export function bookMilestoneCopy(count) {
  return {
    label: 'Handbooks',
    headline: `${count} book${count === 1 ? '' : 's'} finished tonight!`,
  };
}

/**
 * Copy for an "awards earned tonight" celebration.
 * @param {number} count
 * @returns {{ label: string, headline: string }}
 */
export function awardMilestoneCopy(count) {
  return {
    label: 'Awards earned',
    headline: `${count} award${count === 1 ? '' : 's'} earned tonight!`,
  };
}

/**
 * Is this milestone big enough for the escalated confetti burst?
 * @param {number} count
 * @returns {boolean}
 */
export function isBigMilestone(count) {
  return count >= 100;
}

/**
 * English ordinal for a kid-milestone night count: 5 → "5th", 25 → "25th".
 * Handles the 11/12/13 exceptions for completeness even though the current
 * milestone set (5/10/25/50) never hits them.
 * @param {number} n
 * @returns {string}
 */
export function ordinalNight(n) {
  const v = Math.abs(Math.trunc(n));
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] ?? 'th';
  return `${v}${suffix}`;
}

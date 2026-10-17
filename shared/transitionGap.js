// @ts-check
// THE gap between two things a club-night screen shows (owner 2026-10-17):
// around every hand-off from one club's view to the next, the screen goes
// pure black for TRANSITION_GAP_MIN minutes before the hand-off and as many
// after it, so children of the two clubs can pass at the door with no wrong
// logo up. ONE number for every screen: change it here and every screen's
// gaps move together. Pure (no clock, no DOM, no imports), so any page can
// load it as a plain ES module (the downstairs classroom gets a byte copy from
// scripts/family-assets.mjs, as Journey gets clubNight.js).
//
// Who is welcomed during a gap is data too (`periodsFor`): a gap's clubs are
// the clubs of the views on either side of it.
//
// Pinned by shared/transitionGap.test.js.

/** Minutes of black before a hand-off, and again after it. */
export const TRANSITION_GAP_MIN = 2;

/**
 * The black window around a hand-off at `boundaryMin` (minute of the day):
 * [from, until), from inclusive, until exclusive.
 * @param {number} boundaryMin
 * @param {number} [gap]
 * @returns {{ from: number, until: number }}
 */
export function gapAround(boundaryMin, gap = TRANSITION_GAP_MIN) {
  return { from: boundaryMin - gap, until: boundaryMin + gap };
}

/**
 * The hand-off whose gap holds `minutes`, or null.
 * @param {number} minutes
 * @param {number[]} boundaries  hand-off minutes
 * @param {number} [gap]
 * @returns {number | null}
 */
export function inTransitionGap(minutes, boundaries, gap = TRANSITION_GAP_MIN) {
  for (const b of boundaries) {
    const g = gapAround(b, gap);
    if (minutes >= g.from && minutes < g.until) return b;
  }
  return null;
}

/**
 * @typedef {{ view: string, from: number, until: number, clubs: string[] }} View
 * @typedef {{ view: string, from: number, until: number, clubs: string[], gap: boolean }} Period
 */

/**
 * A night's views laid end to end, with a black gap cut around every
 * hand-off between two views: each view shrinks by `gap` minutes at a
 * hand-off, and the gap's `clubs` are both neighbours' clubs (no repeats).
 * The first view's start and the last view's end are not hand-offs.
 * @param {View[]} views  in order, each `until` the next's `from`
 * @param {number} [gap]
 * @returns {Period[]}
 */
export function periodsFor(views, gap = TRANSITION_GAP_MIN) {
  /** @type {Period[]} */
  const out = [];
  views.forEach((v, i) => {
    const prev = views[i - 1];
    const next = views[i + 1];
    const from = prev ? v.from + gap : v.from;
    const until = next ? v.until - gap : v.until;
    if (prev) {
      const g = gapAround(v.from, gap);
      out.push({ view: 'black', from: g.from, until: g.until, clubs: [...new Set([...prev.clubs, ...v.clubs])], gap: true });
    }
    if (until > from) out.push({ view: v.view, from, until, clubs: [...v.clubs], gap: false });
  });
  return out;
}

/**
 * The period holding `minutes`, or null.
 * @param {Period[]} periods
 * @param {number} minutes
 * @returns {Period | null}
 */
export function periodAt(periods, minutes) {
  if (!Number.isFinite(minutes)) return null;
  return periods.find((p) => minutes >= p.from && minutes < p.until) ?? null;
}

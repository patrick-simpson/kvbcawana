// @ts-check
// The judgement App.jsx makes about arriving events, as pure functions: which
// milestones a tally or a tonight broadcast crossed, which recap entries are
// still worth replaying, which ops events are failures. The refs, the fired
// ledgers and the queues stay in App (they are state); these only answer.
import { CLOCK_SKEW_TOLERANCE_MS } from './freshness.js';
import { crossedMilestones } from './milestones.js';

/**
 * The club milestones a tally broadcast crossed: a club whose count passed a
 * multiple of `every` since the last broadcast. First sight of a club is a
 * baseline, not a crossing. The caller drops any it has already fired tonight
 * (a tally that bounces down on an undo and back up must not re-fire).
 * @param {Record<string, number>} prevCounts the last broadcast's per-club counts
 * @param {Record<string, number>} counts this broadcast's
 * @param {number} every clubMilestoneEvery, 0 for off
 * @returns {Array<{ club: string, count: number, key: string }>}
 */
export function clubMilestoneCrossings(prevCounts, counts, every) {
  if (!(every > 0)) return [];
  const out = [];
  for (const [club, n] of Object.entries(counts)) {
    const prev = prevCounts[club] ?? n;
    if (n > prev && Math.floor(n / every) > Math.floor(prev / every)) {
      const count = Math.floor(n / every) * every;
      out.push({ club, count, key: `${club}:${count}` });
    }
  }
  return out;
}

/**
 * The thresholds a tonight counter crossed that have not fired yet tonight.
 * The first payload (`prev` null) is a baseline, never a crossing, so a screen
 * that boots at 120 kids does not replay every threshold it missed.
 * @param {number | null | undefined} prev the last value seen, if any
 * @param {unknown} value
 * @param {ReadonlySet<number>} fired
 * @param {number[]} [thresholds]
 * @returns {number[]}
 */
export function freshCrossings(prev, value, fired, thresholds) {
  if (typeof value !== 'number' || prev == null) return [];
  return [...new Set(crossedMilestones(prev, value, thresholds))].filter((t) => !fired.has(t));
}

/**
 * Whether the room-wide tally just hit one of its every-Nth milestones: only
 * a genuine one-step increment (a restored or reconciled count never reads as
 * crossing one).
 * @param {number} prev
 * @param {number} count
 * @param {number | undefined} every
 */
export function tallyMilestoneHit(prev, count, every) {
  return Boolean(every) && count > prev && count % /** @type {number} */ (every) === 0;
}

/**
 * The recap entries still worth replaying by age. The window is measured from
 * the recap's own newest entry, never from this screen's clock (a TV twenty
 * minutes fast used to discard every child), and this clock still bounds it
 * (CLOCK_SKEW_TOLERANCE_MS) so last Wednesday's recap, replayed by the Worker
 * to a screen that connects, never greets last Wednesday's children.
 * @param {Array<{ at: number }>} entries
 * @param {{ maxAgeMin: number | undefined, now: number }} q
 */
export function recapInWindow(entries, { maxAgeMin, now }) {
  const maxAgeMs = (maxAgeMin ?? 20) * 60 * 1000;
  const newest = entries.reduce((m, e) => (Number.isFinite(e.at) && e.at > m ? e.at : m), -Infinity);
  return entries.filter((e) => !(newest - e.at > maxAgeMs) && !(now - e.at > maxAgeMs + CLOCK_SKEW_TOLERANCE_MS));
}

/**
 * Only genuine FAILURE ops events feed the red count: the channel also carries
 * good news (update-ok, the post-update beacon) and neutral pings (canary), and
 * counting those would raise a standing false alarm.
 * @param {{ type?: string }} ops
 */
export function isPrinterFailure(ops) {
  return ops.type === 'print-failure' || ops.type === 'selector-fail';
}

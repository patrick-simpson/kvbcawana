// @ts-check
// "<First name> has checked out" (owner, 2026-10-08): from pickup time (7:30
// pm, checkoutBoard.js PICKUP_START), when a child leaves the still-here list,
// the foot of the lobby says so for a few seconds, one child at a time, in
// place of the list. Pure, so the rules about WHEN a name may appear are
// tested rather than eyeballed; App owns the baseline and the clock, and
// useCheckoutBanners the queue.
//
// The checkout payload carries no ids, only { firstName, club } per child, so
// a departure is a difference between two successive lists, counted as a
// multiset of first name + club (two Avas in Sparks are two entries; one of
// them leaving is one departure).
//
// The privacy rules are the board's own (CLAUDE.md, "checkout needs more than
// a sanitizer"):
//  - only between two FRESH lists this screen saw in a row: never on the first
//    payload after a load or a reconnect (there is nothing to compare, and a
//    whole room would "check out" at once), never from or to a stale list (a
//    feed that went quiet and came back is not a room emptying), so never
//    "everyone has checked out" because the feed stopped;
//  - a name only while the list is in its names state (more than
//    checkoutBoardNamesAbove left, or the guard switched off); below that, "A
//    child has checked out", with no name and no club.

/** How long each banner stays up, ms ("a few seconds each"). */
export const LEAVE_BANNER_MS = 3000;
/** How many children are named one after another before the rest collapse into one line. */
export const LEAVE_QUEUE_CAP = 6;

/**
 * @typedef {{ firstName: string, club: string }} Entry
 * @typedef {{ kind: 'name', firstName: string, club: string }
 *   | { kind: 'child' }
 *   | { kind: 'more', count: number }} LeaveItem
 */

const keyOf = (/** @type {Entry} */ e) => `${String(e.club ?? '').trim().toLowerCase()}\u0000${String(e.firstName ?? '').trim()}`;

/**
 * The children in `before` who are not in `after`, as a multiset: one entry
 * per departure, in `before`'s order.
 * @param {ReadonlyArray<Entry> | null | undefined} before
 * @param {ReadonlyArray<Entry> | null | undefined} after
 * @returns {Entry[]}
 */
export function departures(before, after) {
  /** @type {Map<string, number>} */
  const left = new Map();
  for (const e of after || []) left.set(keyOf(e), (left.get(keyOf(e)) || 0) + 1);
  /** @type {Entry[]} */
  const out = [];
  for (const e of before || []) {
    const k = keyOf(e);
    const n = left.get(k) || 0;
    if (n > 0) left.set(k, n - 1);
    else out.push({ firstName: e.firstName, club: e.club });
  }
  return out;
}

/**
 * Whether a list is fresh at `now`: received (or stamped) at most `staleMin`
 * minutes ago, the board's own staleness budget.
 * @param {number | null | undefined} stamp
 * @param {number} staleMin
 * @param {number} now
 */
export function listFresh(stamp, staleMin, now) {
  return Number.isFinite(stamp) && now - /** @type {number} */ (stamp) <= staleMin * 60000;
}

/**
 * What to say for a new list, given the last one this screen saw in a row.
 * Returns the banner items (possibly none) for the departures, under the rules
 * at the top of this file.
 *
 * @param {{
 *   before: { entries: Entry[], stamp: number } | null,
 *   after: { entries: Entry[], stamp: number },
 *   now: number,
 *   staleMin: number,
 *   namesAbove: number,
 *   pickup: boolean,
 * }} s
 * @returns {LeaveItem[]}
 */
export function leavesFor({ before, after, now, staleMin, namesAbove, pickup }) {
  if (!pickup || !before) return [];
  if (!listFresh(before.stamp, staleMin, now) || !listFresh(after.stamp, staleMin, now)) return [];
  const gone = departures(before.entries, after.entries);
  if (!gone.length) return [];
  const named = namesAbove <= 0 || after.entries.length > namesAbove;
  return gone.map((e) => (named ? { kind: 'name', firstName: e.firstName, club: e.club } : { kind: 'child' }));
}

/**
 * The queue with `items` added at its end, held to LEAVE_QUEUE_CAP banners
 * one after another: what does not fit collapses into one trailing "and N more
 * have checked out" (which grows if more arrive while it waits). The banner on
 * screen (the head) is never dropped.
 * @param {ReadonlyArray<LeaveItem>} queue
 * @param {ReadonlyArray<LeaveItem>} items
 * @param {number} [cap]
 * @returns {LeaveItem[]}
 */
export function enqueueLeaves(queue, items, cap = LEAVE_QUEUE_CAP) {
  const out = [...queue];
  let more = 0;
  if (out.length && out[out.length - 1].kind === 'more') {
    more = /** @type {{ count: number }} */ (out.pop()).count;
  }
  for (const item of items) {
    if (!more && out.length < cap) out.push(item);
    else more += 1;
  }
  if (more) out.push({ kind: 'more', count: more });
  return out;
}

/**
 * The banner's words.
 * @param {LeaveItem} item
 */
export function leaveText(item) {
  if (item.kind === 'name') return `${item.firstName} has checked out`;
  if (item.kind === 'more') return `and ${item.count} more ${item.count === 1 ? 'has' : 'have'} checked out`;
  return 'A child has checked out';
}

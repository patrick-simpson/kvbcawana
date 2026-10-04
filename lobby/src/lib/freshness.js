// Shared "is this realtime data still worth showing?" check. The same
// idiom recurs all over the app (recap replay window, watchdog grace
// periods, the presentation tool's TALLY_STALE_MS) but always inlined
// as a one-off `Date.now() - x.at > maxAge` — pulled out here once two
// more widgets (TonightTicker, NoticeBanner) needed the identical check
// so their staleness rules stay obviously correct and easy to unit test
// without fake timers.

/**
 * @param {unknown} at Epoch ms the data was stamped at, or undefined/null.
 * @param {number} maxAgeMs How old the data may be before it's stale.
 * @param {number} [now] Injectable clock for tests; defaults to Date.now().
 * @returns {boolean} true when `at` is a real timestamp within maxAgeMs of now.
 */
export function isFresh(at, maxAgeMs, now = Date.now()) {
  return typeof at === 'number' && Number.isFinite(at) && now - at <= maxAgeMs;
}

/**
 * Judge a payload's age by THIS screen's clock, not the printer's. The
 * printer's `at` is for ordering frames against each other; a signage TV's
 * clock can sit minutes or hours off (CLAUDE.md, TALLY_REORDER_MS), and a TV
 * ten minutes fast read every fresh tonight strip as stale, twenty minutes
 * fast threw away every recap, and a large skew could hide a club-cancelled
 * notice or pin the pickup board "stale". App stamps each payload where it
 * lands (stampReceived); the widgets read that stamp, and fall back to `at`
 * only for a payload that was never stamped (a test's bare fixture).
 * Local only: the stamp is never on the wire and never stored.
 * @template T
 * @param {T} payload
 * @param {number} [now]
 * @returns {T & { receivedAt: number }}
 */
export function stampReceived(payload, now = Date.now()) {
  return { ...payload, receivedAt: now };
}

/**
 * How far the printer's clock may sit from this screen's before a payload's
 * own `at` is believed over its arrival. Two hours covers a mis-set time
 * zone or a DST mistake on either side; a frame older than that by this
 * clock really is old: the Worker replays the last tally, checkout, notice
 * and recap to a screen that connects, and last Wednesday's pickup list or
 * club-cancelled notice must not come up fresh on Thursday.
 */
export const CLOCK_SKEW_TOLERANCE_MS = 2 * 60 * 60 * 1000;

/**
 * The moment to age a payload from: its arrival here (stampReceived), unless
 * the printer's own `at` is more than CLOCK_SKEW_TOLERANCE_MS behind this
 * clock, which means the payload itself is old, not the clocks apart. An
 * unstamped payload (a bare fixture) ages from its `at`, as before.
 * @param {{ receivedAt?: unknown, at?: unknown } | null | undefined} payload
 */
export function stampOf(payload) {
  if (!payload) return undefined;
  const { receivedAt, at } = payload;
  if (typeof receivedAt !== 'number') return at;
  if (typeof at === 'number' && receivedAt - at > CLOCK_SKEW_TOLERANCE_MS) return at;
  return receivedAt;
}

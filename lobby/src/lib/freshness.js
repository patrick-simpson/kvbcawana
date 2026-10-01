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

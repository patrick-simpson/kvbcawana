/**
 * Live check-in tally — pure parsing/lookup for the `tally` events the
 * print server publishes on the shared Pusher channel:
 *   { counts: { "<club display name>": n, ... }, total: n, at: ISO }
 * Counts are keyed by club name as the check-in system reports it, so
 * lookups go through the same club-name normalizer the birthday CSV uses.
 */
import { normalizeClub } from './birthdays.js';

/** Tonight's count for one club id, or null when the tally doesn't cover it. */
export function countForClub(tally, clubId) {
  let found = null;
  for (const [name, n] of Object.entries(tally.counts)) {
    if (normalizeClub(name) === clubId) found = (found ?? 0) + n;
  }
  return found;
}

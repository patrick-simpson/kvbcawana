// @ts-check
/**
 * "Birthday later this week" matcher — pure, no imports, no state.
 *
 * The printer broadcasts a weekly `birthdays` ROSTER (first name, club,
 * month and day; never a year — see src/lib/eventSanitizers.js's
 * sanitizeBirthdays). This module answers one question for one arriving
 * child: does the roster say their birthday falls later this week, and if
 * so which day? The answer is a short label the banner can render.
 *
 * Design rules, all of which resolve to "no ribbon" rather than a wrong
 * one, because a wrong birthday on the lobby TV is worse than none:
 *  - the first name AND the club must both match, and EXACTLY ONE roster
 *    entry may match (two Ellies in Sparks means no ribbon);
 *  - the birthday must fall inside the next RIBBON_FORWARD_DAYS days;
 *  - a birthday TODAY returns null — the birthday banner's own words own
 *    the day itself.
 */

/** How far ahead a birthday may be and still earn a ribbon. */
export const RIBBON_FORWARD_DAYS = 6;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// `checkin.club` is the check-in request's club name while a roster entry
// carries the raw CSV `Club` column, so "T&T" and "TnT" have to agree
// here or the ribbon would silently never fire for that club. This is a
// deliberate local copy: src/presentation/ owns a similar normalizer, and
// CLAUDE.md forbids the signage side importing from there.
/** @type {Record<string, string>} */
const CLUB_ALIASES = {
  tnt: 'tt',
  truthandtraining: 'tt',
  truthtraining: 'tt',
};

/**
 * Comparison key for a club name: case- and punctuation-insensitive.
 * @param {unknown} raw
 * @returns {string}
 */
export function clubKey(raw) {
  const s = String(raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return CLUB_ALIASES[s] ?? s;
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
const nameKey = (raw) => String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** @param {number} y */
const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * The ribbon label for an arriving child, or null when they have not
 * earned one.
 * @param {unknown} firstName the arriving child's first name (`checkin`)
 * @param {unknown} club the arriving child's club (`checkin`)
 * @param {unknown} entries this week's roster entries (`birthdays`)
 * @param {Date} [today] local "today"; defaults to now
 * @returns {string | null}
 */
export function birthdayRibbon(firstName, club, entries, today = new Date()) {
  if (!Array.isArray(entries)) return null;
  const name = nameKey(firstName);
  if (!name) return null;
  const clubId = clubKey(club);

  const hits = entries.filter((e) => (
    e && typeof e === 'object'
    && nameKey(/** @type {{ firstName?: unknown }} */ (e).firstName) === name
    && clubKey(/** @type {{ club?: unknown }} */ (e).club) === clubId
  ));
  // Ambiguity is a refusal, not a coin flip.
  if (hits.length !== 1) return null;

  const entry = /** @type {{ month?: unknown, day?: unknown }} */ (hits[0]);
  const month = entry.month;
  const day = entry.day;
  if (typeof month !== 'number' || typeof day !== 'number') return null;

  const base = new Date(today.getTime());
  base.setHours(0, 0, 0, 0);

  for (let i = 0; i <= RIBBON_FORWARD_DAYS; i++) {
    const d = new Date(base.getTime());
    d.setDate(base.getDate() + i);
    const m = d.getMonth() + 1;
    const dayOfMonth = d.getDate();
    const exact = month === m && day === dayOfMonth;
    // A Feb-29 birthday is celebrated on Feb 28 in a common year, the same
    // rule the projector's own birthday list uses.
    const feb29 = month === 2 && day === 29
      && m === 2 && dayOfMonth === 28 && !isLeapYear(d.getFullYear());
    if (!exact && !feb29) continue;
    // Today: the birthday banner already says the right thing.
    if (i === 0) return null;
    return `Birthday this ${DAY_NAMES[d.getDay()]}!`;
  }

  return null;
}

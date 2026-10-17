// @ts-check
// THE gap between two things a club-night screen shows (owner 2026-10-17):
// around every hand-off from one club's view to the next, the screen goes
// pure black for TRANSITION_GAP_MIN minutes before the hand-off and as many
// after it, so children of the two clubs can pass at the door with no wrong
// logo up. ONE number for every screen: change it here and every screen's
// gaps move together. Pure (no clock, no DOM, no imports), so any page can
// load it as a plain ES module (the downstairs classroom and the Journey kiosk
// get byte copies from scripts/family-assets.mjs, as they get clubNight.js).
//
// Who is welcomed during a gap is data too (`periodsFor`): a gap's clubs are
// the clubs of the views on either side of it; the welcome cards' own rules
// (one card per club, 20 s after the latest arrival, deduped by id) are at
// the end of this file, shared by every screen that welcomes in a gap.
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

/* ── Welcomes during a gap (owner 2026-10-17) ─────────────────────────
   A check-in from one of the gap's clubs (`periodsFor` clubs) shows a welcome
   card over the black: ONE card per club (two clubs' names never share one),
   names added as they come, each card up WELCOME_MS after its latest arrival.
   The names arrive already sanitized by the embedded lobby (first name, club,
   id, oneOff: lobby/src/lib/embed.js hostCheckin) and live in memory only.
   Used by the downstairs classroom (classroom/public/src/logic.js re-exports
   these) and the Journey kiosk (journey/src/schedule/29-transition-gap.js).
   A one-off name tag (`oneOff`) is welcomed like any child, as the lobby
   welcomes it; nothing here counts. */

/** A welcome stays this long after the latest arrival. */
export const WELCOME_MS = 20 * 1000;
export const WELCOME_NAMES_MAX = 5;

/**
 * "Cubbies" / "T&T" / "Truth & Training" ... -> a club id, or ''.
 * @param {unknown} club
 */
export function clubIdOf(club) {
  const s = typeof club === 'string' ? club.toLowerCase() : '';
  if (s.includes('cubbies')) return 'cubbies';
  if (s.includes('sparks')) return 'sparks';
  if (s.includes('puggles')) return 'puggles';
  if (s.includes('t&t') || s.includes('truth')) return 'tnt';
  if (s.includes('trek')) return 'trek';
  if (s.includes('journey')) return 'journey';
  return '';
}

/**
 * The words of a welcome for these first names (arrival order).
 * "Welcome, Ava!" / "Ava & Ben" / "Ava, Ben & Cara" / "... & 3 more".
 * @param {string[]} names
 */
export function welcomeWords(names) {
  const list = names.filter((n) => typeof n === 'string' && n);
  if (list.length === 0) return '';
  const shown = list.length > WELCOME_NAMES_MAX ? list.slice(0, WELCOME_NAMES_MAX - 1) : list;
  const more = list.length - shown.length;
  const parts = more > 0 ? [...shown, `${more} more`] : shown;
  if (parts.length === 1) return `${parts[0]}!`;
  return `${parts.slice(0, -1).join(', ')} & ${parts[parts.length - 1]}!`;
}

/**
 * The welcome cards' state: ONE card per club (a Cubbies and a Sparks name
 * never share one), names added as they come, each card up WELCOME_MS after
 * its latest arrival. Which clubs are welcomed is the period's `clubs` (a
 * card's own club; both neighbours in a black gap).
 * @typedef {{ cards: Record<string, { names: string[], until: number }>, seen: string[] }} Welcomes
 */

/** @returns {Welcomes} */
export function emptyWelcomes() { return { cards: {}, seen: [] }; }

/**
 * A check-in heard. Returns the next state, whether to ding, and the club.
 * @param {Welcomes} state
 * @param {{ id?: unknown, firstName?: unknown, club?: unknown }} event  already sanitized by the lobby
 * @param {string[]} clubs  the clubs welcomed now (the period's `clubs`)
 * @param {number} nowMs
 */
export function welcomeFor(state, event, clubs, nowMs) {
  const club = clubIdOf(event?.club);
  const id = typeof event?.id === 'string' ? event.id : '';
  const name = typeof event?.firstName === 'string' ? event.firstName.trim() : '';
  if (!club || !name || !clubs.includes(club)) return { state, ding: false, club: '' };
  if (id && state.seen.includes(id)) return { state, ding: false, club: '' };
  const card = state.cards[club];
  const live = Boolean(card) && nowMs < card.until;
  const seen = id ? [...state.seen.slice(-199), id] : state.seen;
  const names = live ? [...card.names, name] : [name];
  return { state: { cards: { ...state.cards, [club]: { names, until: nowMs + WELCOME_MS } }, seen }, ding: true, club };
}

/**
 * The clubs whose welcome card is up now, in the period's order.
 * @param {Welcomes} state @param {string[]} clubs @param {number} nowMs
 */
export function welcomesUp(state, clubs, nowMs) {
  return clubs.filter((c) => state.cards[c] && state.cards[c].names.length > 0 && nowMs < state.cards[c].until);
}


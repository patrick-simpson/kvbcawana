// @ts-check
// ─────────────────────────────────────────────────────────────
// Season promo slides — fall 2026. Pure date math, no React.
//
// The church printed three posters for this fall (the DEFEND poster
// contest, BARF Night, and Parents' Night). These are the animated
// lobby-TV recreations of them, plus a fourth the printer never made (the
// slime cut of BARF Night), and this module is the only place that decides
// WHICH of them a screen may show today and WHAT the counter under each
// one says.
//
// House rules, same as the rest of the calendar code:
//   • Every comparison is a bare local YYYY-MM-DD key. Never
//     toISOString(): in a US-Eastern evening UTC has already rolled to
//     tomorrow, which is exactly club hours.
//   • A promo's show window is INCLUSIVE of its event date and closes
//     the day after, exactly like a typed slide's showUntil.
//   • The counter counts real club nights, so it has to ask
//     calendarLogic's clubNights() about break weeks rather than
//     keeping its own idea of a cancellation.
//   • No feed, no promo. An empty/absent calendar returns null rather
//     than a promo with a blank or guessed counter — "I have no data"
//     and "no nights left" are opposite facts.
//
// These descriptors are DELIBERATELY hardcoded (owner's choice,
// 2026-09-13): the art is a recreation of specific printed posters, so
// next season's promos mean editing this table and PromoSlide.jsx
// together, not typing dates into Settings.
// ─────────────────────────────────────────────────────────────

import { clubNights, formatLongDate } from './calendarLogic.js';
import { showDate, slideInWindow } from './slides.js';

/**
 * @typedef {Object} SeasonPromo
 * @property {string} id
 * @property {string} kind 'contest' | 'friend' | 'parents' | 'barfEpic'
 * @property {string} eventDate Last day the promo shows, inclusive.
 * @property {string} showFrom First day the promo may show.
 * @property {number} durationSec How long the slideshow holds THIS poster.
 */

/** @type {ReadonlyArray<SeasonPromo>} */
export const SEASON_PROMOS = [
  { id: 'promo_contest', kind: 'contest', eventDate: '2026-10-14', showFrom: '2026-09-01', durationSec: 15 },
  { id: 'promo_friend', kind: 'friend', eventDate: '2026-10-14', showFrom: '2026-09-01', durationSec: 15 },
  { id: 'promo_parents', kind: 'parents', eventDate: '2026-11-04', showFrom: '2026-09-01', durationSec: 15 },
  // The slime-soaked hype cut of BARF Night, the fourth poster the printer
  // never made.
  { id: 'promo_barf_epic', kind: 'barfEpic', eventDate: '2026-10-14', showFrom: '2026-09-01', durationSec: 15 },
];

// The poster-contest deadline. Parents' Night says something different
// about the voting once the posters are actually in.
export const CONTEST_DATE = '2026-10-14';

// Parents' Night, named once here so the contest promo can point at it
// without a second copy of the date (the two events are chained).
export const PARENTS_DATE = '2026-11-04';

// Every poster is a 15 second showreel (owner's call, 2026-09-28): a full
// motion-design sequence that lands on the finished printed poster. Each
// descriptor still carries its OWN durationSec, which is what the
// slideshow actually holds for; this is the slot's fallback and the clock
// every poster's beat sheet is written against (promos/kit.jsx).
export const PROMO_DURATION_SEC = 15;

/**
 * @param {any} slide
 * @returns {boolean}
 */
export function isPromoSlide(slide) {
  return slide?.type === 'promo';
}

/**
 * How many real club nights are left before (and including) `eventDate`.
 *
 * Today itself never counts — a night the room is already standing in is not
 * one it is waiting for — and the event's own night does, so the last ordinary
 * club night before the event reads "Next club night" and the event date reads
 * 0 (which the label turns into "Tonight!").
 *
 * null means "no calendar", which is a different answer from 0 and has to stay
 * distinguishable all the way to the copy.
 *
 * @param {Array<any>|null|undefined} events
 * @param {string} todayStr
 * @param {string} eventDate
 * @param {Record<string, { noClub?: boolean, label?: string }>|null} [specialDates]
 * @returns {number|null}
 */
export function nightsUntil(events, todayStr, eventDate, specialDates = null) {
  if (!Array.isArray(events) || events.length === 0) return null;
  return clubNights(events, specialDates)
    .filter((e) => !e.isCancelled && e.date > todayStr && e.date <= eventDate)
    .length;
}

/**
 * The line on the countdown chip, or null when there is nothing to say.
 *
 * @param {number|null} n
 * @param {string} todayStr
 * @param {string} eventDate
 * @returns {string|null}
 */
export function countdownLabel(n, todayStr, eventDate) {
  if (todayStr === eventDate) return 'Tonight!';
  // No feed: name the date instead of a count we cannot honestly produce.
  if (n === null) return formatLongDate(eventDate) || null;
  if (n <= 0) return null;
  if (n === 1) return 'Next club night';
  return `${n} club nights left`;
}

/**
 * @typedef {Object} PromoDescriptor
 * @property {string} id
 * @property {string} kind
 * @property {string} eventDate
 * @property {boolean} tonight
 * @property {string|null} countdown
 * @property {boolean} afterContest
 * @property {number} durationSec
 */

/**
 * @typedef {Object} PromoSlot
 * @property {string} id
 * @property {'promo'} type
 * @property {number} durationSec
 * @property {PromoDescriptor[]} promos
 */

/**
 * The ONE promo slot in the background rotation, or null.
 *
 * One slot, however many promos are live: four extra slides in an eight-slide
 * deck would turn the lobby TV into a poster wall. ManualSlideshow shows a
 * different entry from `promos` on each lap through the deck instead, so every
 * promo still gets the room's attention without crowding the calendar slides.
 *
 * Each entry carries its OWN durationSec, because the posters are not the same
 * length of read. The slot keeps one too, as the fallback for an entry that
 * somehow has none.
 *
 * Never persisted and never published: like the calendar slides, this is
 * derived fresh from (events, today, config) on every render.
 *
 * @param {Array<any>|null|undefined} events
 * @param {string} todayStr
 * @param {{ specialDates?: Record<string, any>|null, enabled?: boolean }} [opts]
 * @returns {PromoSlot|null}
 */
export function buildPromoSlot(events, todayStr, opts = {}) {
  const { specialDates = null, enabled = true } = opts;
  if (!enabled) return null;
  // The counter is the whole point of these slides, and it needs the feed.
  // (It is also what keeps them out of the hermetic e2e smoke run, which
  // boots with no calendar at all.)
  if (!Array.isArray(events) || events.length === 0) return null;
  const today = showDate(todayStr);
  if (!today) return null;

  const afterContest = today > CONTEST_DATE;
  const promos = SEASON_PROMOS
    // Same inclusive window semantics as a typed slide's showFrom/showUntil:
    // the event date still shows, the day after is gone.
    .filter((p) => slideInWindow({ showFrom: p.showFrom, showUntil: p.eventDate }, today))
    .map((p) => ({
      id: p.id,
      kind: p.kind,
      eventDate: p.eventDate,
      tonight: today === p.eventDate,
      countdown: countdownLabel(nightsUntil(events, today, p.eventDate, specialDates), today, p.eventDate),
      afterContest,
      durationSec: p.durationSec,
    }));

  if (!promos.length) return null;
  return { id: 'season_promo', type: 'promo', durationSec: PROMO_DURATION_SEC, promos };
}

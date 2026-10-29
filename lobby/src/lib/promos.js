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
import { SNOW_ALERT_SEC, SNOW_CADENCE, inSnowSeason, snowOutlook } from './snowAlerts.js';
import { dateKey } from './time.js';

/**
 * @typedef {Object} SeasonPromo
 * @property {string} id
 * @property {string} kind 'contest' | 'friend' | 'parents' | 'barfEpic' | 'finalists' | 'grandPrix'
 * @property {string} eventDate Last day the promo shows, inclusive.
 * @property {string} showFrom First day the promo may show.
 * @property {number} durationSec How long the slideshow holds THIS poster.
 * @property {'seamless'} [exit] The promo ENDS on the lobby itself: its last
 *   frame is the lobby's normal screen at rest in `theme` (field, corner tab,
 *   house waves; no slide words), so leaving it is an ordinary slide change,
 *   never the stinger (lobbyMotion.js nextTransition). While it is up the
 *   scene behind it wears `theme`, its ambient loops come to rest, the chrome
 *   comes home under it before its end, and it ends its own showing, the
 *   hold being only a cap (ManualSlideshow, SEAMLESS_GRACE_SEC).
 * @property {string} [theme] The lobby theme its last frame is drawn in
 *   (with `exit: 'seamless'`).
 */

// Parents' Night, where the finalists are voted on (PARENTS_DATE below is the same day).
const PARENTS_NIGHT = '2026-11-04';

/** @type {ReadonlyArray<SeasonPromo>} */
export const SEASON_PROMOS = [
  { id: 'promo_contest', kind: 'contest', eventDate: '2026-10-14', showFrom: '2026-09-01', durationSec: 15 },
  { id: 'promo_friend', kind: 'friend', eventDate: '2026-10-14', showFrom: '2026-09-01', durationSec: 15 },
  { id: 'promo_parents', kind: 'parents', eventDate: '2026-11-04', showFrom: '2026-09-01', durationSec: 15 },
  // The slime-soaked hype cut of BARF Night, the fourth poster the printer
  // never made.
  { id: 'promo_barf_epic', kind: 'barfEpic', eventDate: '2026-10-14', showFrom: '2026-09-01', durationSec: 15 },
  // The contest's six finalists, "vote for your favorite" (owner 2026-10-28):
  // from the day they were picked through the vote at Parents' Night. Its own
  // 21 s: six posters take their bow, each with its epic zoom, before the call (FinalistsPromo.jsx).
  { id: 'promo_finalists', kind: 'finalists', eventDate: PARENTS_NIGHT, showFrom: '2026-10-28', durationSec: 21 },
  // The Awana Grand Prix, a 30 s video (owner 2026-10-29: "The flat brand one
  // is the one that I wanted to keep. Get that one set to show up on the
  // displays starting in January."; restyled the same day in Awana's official
  // Grand Prix sub-brand): from New Year's Day through race day. Its last
  // second is the lobby's own sky screen at rest, so it hands back to the
  // lobby with no stinger (GrandPrixPromo.jsx; video/grand-prix/concepts/gp-brand/).
  {
    id: 'promo_grand_prix', kind: 'grandPrix', eventDate: '2027-03-20', showFrom: '2027-01-01', durationSec: 30,
    exit: 'seamless', theme: 'sky',
  },
];

/**
 * How far past its own durationSec a promo that ends itself (`exit:
 * 'seamless'`, a video) may run before the slideshow moves on anyway: a video
 * that started a little late still finishes; one that stalls cannot hold the
 * deck.
 */
export const SEAMLESS_GRACE_SEC = 4;

// The poster-contest deadline. Parents' Night says something different
// about the voting once the posters are actually in.
export const CONTEST_DATE = '2026-10-14';

// Parents' Night, named once here so the contest promo can point at it
// without a second copy of the date (the two events are chained).
export const PARENTS_DATE = PARENTS_NIGHT;

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
 * The promo a slot shows on a given lap of the deck, or null when the slot
 * sits that lap out. A deck that is nothing but the slot never sits out: it
 * shows the first promo it has rather than a blank screen.
 *
 * @param {PromoSlot|any} slot
 * @param {number} lap
 * @param {number} deckLength
 * @returns {PromoDescriptor|null}
 */
export function promoForLap(slot, lap, deckLength) {
  const list = Array.isArray(slot?.promos) ? slot.promos : [];
  if (!list.length) return null;
  const pick = list[lap % list.length] ?? null;
  if (pick || deckLength > 1) return pick;
  return list.find(Boolean) ?? null;
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
 * @property {'seamless'} [exit] see SeasonPromo
 * @property {string} [theme] see SeasonPromo
 * @property {import('./snowAlerts.js').SnowOutlook|null} [snow] the snow-alerts slide only
 */

/**
 * @typedef {Object} PromoSlot
 * @property {string} id
 * @property {'promo'} type
 * @property {number} durationSec
 * @property {Array<PromoDescriptor|null>} promos one entry per lap; null = no promo that lap
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
 * The snow-alerts slide (src/lib/snowAlerts.js) rides the same slot, on its
 * own clock: in the snow season it takes one lap in SNOW_CADENCE.calm, or one
 * in SNOW_CADENCE.storm when snow is forecast near club night, however many
 * fall posters are live. The fall posters fill the other laps, and a lap with
 * nothing to fill it is a null entry: ManualSlideshow steps straight past the
 * slot that lap, so a lone snow slide is still rare. `snowAlerts` turns it on
 * (App always does; the tests that predate it leave it off) and
 * `snowForecast` is useSnowForecast()'s answer.
 *
 * @param {Array<any>|null|undefined} events
 * @param {string} todayStr
 * @param {{ specialDates?: Record<string, any>|null, enabled?: boolean, snowAlerts?: boolean,
 *   snowForecast?: import('./snowAlerts.js').SnowForecast|null }} [opts]
 * @returns {PromoSlot|null}
 */
export function buildPromoSlot(events, todayStr, opts = {}) {
  const { specialDates = null, enabled = true, snowAlerts = false, snowForecast = null } = opts;
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
      ...ending(p),
    }));

  const lapped = snowAlerts && inSnowSeason(today)
    ? withSnowAlerts(promos, snowOutlook(events, today, snowForecast, specialDates), afterContest)
    : promos;
  if (!lapped.length) return null;
  return { id: 'season_promo', type: 'promo', durationSec: PROMO_DURATION_SEC, promos: lapped };
}

/**
 * The snow slide on its own cadence: [S, x, x, x, x, x] on a calm week and
 * [S, x] when snow is coming, where each x is the next fall poster in turn, or
 * null (no promo that lap) when none is live. Enough rounds that every live
 * poster still gets its turn.
 *
 * @param {PromoDescriptor[]} fall
 * @param {import('./snowAlerts.js').SnowOutlook|null} outlook
 * @param {boolean} afterContest
 * @returns {Array<PromoDescriptor|null>}
 */
function withSnowAlerts(fall, outlook, afterContest) {
  /** @type {PromoDescriptor} */
  const snow = {
    id: 'promo_snow_alerts',
    kind: 'snowAlerts',
    eventDate: outlook ? outlook.date : '',
    tonight: outlook?.when === 'tonight',
    countdown: null,
    afterContest,
    durationSec: SNOW_ALERT_SEC,
    snow: outlook,
  };
  const per = (outlook ? SNOW_CADENCE.storm : SNOW_CADENCE.calm) - 1;
  const rounds = Math.max(1, Math.ceil(fall.length / per));
  /** @type {Array<PromoDescriptor|null>} */
  const out = [];
  let next = 0;
  for (let r = 0; r < rounds; r += 1) {
    out.push(snow);
    for (let i = 0; i < per; i += 1) {
      out.push(fall.length ? fall[next % fall.length] : null);
      next += 1;
    }
  }
  return out;
}

/**
 * Settings → Slides → "Preview the promos": every promo this build knows, in the
 * order the buttons list them, whether or not today's date would show it.
 * The snow slide is there twice, once as an ordinary week and once as a
 * snow week, because those read differently.
 */
export const PREVIEW_PROMOS = Object.freeze([
  Object.freeze({ key: 'contest', label: 'Poster contest' }),
  Object.freeze({ key: 'friend', label: 'BARF Night' }),
  Object.freeze({ key: 'barfEpic', label: 'BARF Night: slime cut' }),
  Object.freeze({ key: 'parents', label: 'Parents’ Night' }),
  Object.freeze({ key: 'finalists', label: 'Poster finalists: vote' }),
  Object.freeze({ key: 'grandPrix', label: 'Grand Prix (video)' }),
  Object.freeze({ key: 'snowAlerts', label: 'Snow alerts' }),
  Object.freeze({ key: 'snowAlertsStorm', label: 'Snow alerts: snow week' }),
]);

/**
 * The descriptor a preview plays: the same shape buildPromoSlot() makes, so
 * the poster draws exactly what the room would see. A fall poster counts down
 * from the real calendar while its night is ahead, and names its date once it
 * has passed (or with no feed). The snow week names the next club night, or
 * the next Wednesday without a feed. Unknown keys give null.
 *
 * @param {string} key one of PREVIEW_PROMOS' keys
 * @param {Array<any>|null|undefined} events
 * @param {string} todayStr
 * @param {Record<string, any>|null} [specialDates]
 * @returns {PromoDescriptor|null}
 */
export function previewPromo(key, events, todayStr, specialDates = null) {
  const today = showDate(todayStr) || todayStr;
  const afterContest = today > CONTEST_DATE;
  if (key === 'snowAlerts' || key === 'snowAlertsStorm') {
    const storm = key === 'snowAlertsStorm';
    const night = storm ? nextClubNightOrWednesday(events, today, specialDates) : '';
    return {
      id: 'promo_snow_alerts',
      kind: 'snowAlerts',
      eventDate: night,
      tonight: false,
      countdown: null,
      afterContest,
      durationSec: SNOW_ALERT_SEC,
      snow: storm
        ? { date: night, when: night === today ? 'tonight' : 'later', weekday: weekdayName(night), inches: 3 }
        : null,
    };
  }
  const p = SEASON_PROMOS.find((x) => x.kind === key);
  if (!p) return null;
  const ahead = today <= p.eventDate;
  return {
    id: p.id,
    kind: p.kind,
    eventDate: p.eventDate,
    tonight: today === p.eventDate,
    countdown: ahead
      ? countdownLabel(nightsUntil(events, today, p.eventDate, specialDates), today, p.eventDate)
      : formatLongDate(p.eventDate) || null,
    afterContest,
    durationSec: p.durationSec,
    ...ending(p),
  };
}

/**
 * A promo's `exit` and `theme`, only when it has them (most do not, and their
 * descriptors keep the shape they always had).
 * @param {SeasonPromo} p
 */
function ending(p) {
  return p.exit ? { exit: p.exit, theme: p.theme || 'sky' } : {};
}

/** @param {string} dateStr */
function weekdayName(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' });
}

/**
 * @param {Array<any>|null|undefined} events
 * @param {string} today
 * @param {Record<string, any>|null} specialDates
 */
function nextClubNightOrWednesday(events, today, specialDates) {
  const next = clubNights(events, specialDates)
    .filter((e) => !e.isCancelled && typeof e.date === 'string' && e.date >= today)
    .map((e) => e.date)
    .sort()[0];
  if (next) return next;
  const [y, m, d] = today.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + ((3 - date.getDay() + 7) % 7));
  return dateKey(date);
}

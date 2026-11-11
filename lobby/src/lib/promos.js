// @ts-check
// ─────────────────────────────────────────────────────────────
// Season promo slides. Pure date math, no React.
//
// The animated lobby-TV promos for the church's events: the Veterans Day
// poster (November 11, 2026 only), the Awana Grand Prix video (January to race
// day, 2027), and the snow-alerts slide, which rides the same slot on its own
// clock (snowAlerts.js). The five fall 2026 promos (the DEFEND poster contest,
// BARF Night and its slime cut, Parents' Night, the poster finalists) were
// removed on 2026-11-10 after their dates passed; git history has them. This
// module is the only place that decides WHICH promo a screen may show today
// and WHAT the counter under each one says.
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
// 2026-09-13): the art is made for specific events, so a new promo means
// editing this table and PromoSlide.jsx together, not typing dates into
// Settings.
// ─────────────────────────────────────────────────────────────

import { clubNights, formatLongDate } from './calendarLogic.js';
import { showDate, slideInWindow } from './slides.js';
import { SNOW_ALERT_SEC, SNOW_CADENCE, inSnowSeason, snowOutlook } from './snowAlerts.js';
import { dateKey } from './time.js';

/**
 * @typedef {Object} SeasonPromo
 * @property {string} id
 * @property {string} kind 'grandPrix' | 'veterans'
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
 * @property {'seamless'} [enter] The promo also STARTS on the lobby itself
 *   (with `exit: 'seamless'`): its first frame is that same screen at rest,
 *   so coming in is an ordinary change too, never the stinger: the words
 *   lift away, the field turns to `theme`, the scene comes to rest, and only
 *   then does it appear over the identical picture (GrandPrixPromo.jsx).
 * @property {string} [theme] The lobby theme its last (and with `enter`,
 *   first) frame is drawn in (with `exit: 'seamless'`).
 * @property {boolean} [encore] On its `eventDate` ONLY it gets a second showing
 *   in every pass through the deck (buildEncoreSlot, lobbyDeck.js placeEncore).
 */

// The Grand Prix video's length, to the frame: 2021 frames at 60 fps (the torn
// cut, video/grand-prix/output/gp-brand/grand-prix-torn-1080p60.mp4).
export const GRAND_PRIX_SEC = 2021 / 60;

// The Veterans Day poster's hold: a quiet 10 s (VeteransPromo.jsx).
export const VETERANS_SEC = 10;

/** @type {ReadonlyArray<SeasonPromo>} */
export const SEASON_PROMOS = [
  // The Awana Grand Prix, a 33.68 s video (owner 2026-10-29: "The flat brand one
  // is the one that I wanted to keep. Get that one set to show up on the
  // displays starting in January."; restyled the same day in Awana's official
  // Grand Prix sub-brand): from New Year's Day through race day. Its first
  // and last second are the lobby's own sky screen at rest, so it takes over
  // from the lobby and hands back to it with no stinger either way
  // (GrandPrixPromo.jsx; video/grand-prix/concepts/gp-brand/).
  {
    id: 'promo_grand_prix', kind: 'grandPrix', eventDate: '2027-03-20', showFrom: '2027-01-01', durationSec: GRAND_PRIX_SEC,
    exit: 'seamless', enter: 'seamless', theme: 'sky',
  },
  // "Thank you, veterans" (owner 2026-11-10: "It's only to show up on 11/11"):
  // Wednesday, November 11 ONLY (showFrom and eventDate are the same day), gone
  // the day after. It airs twice per pass that day (`encore`, buildEncoreSlot).
  { id: 'promo_veterans', kind: 'veterans', eventDate: '2026-11-11', showFrom: '2026-11-11', durationSec: VETERANS_SEC, encore: true },
];

/**
 * How far past its own durationSec a promo that ends itself (`exit:
 * 'seamless'`, a video) may run before the slideshow moves on anyway: a video
 * that started a little late still finishes; one that stalls cannot hold the
 * deck.
 */
export const SEAMLESS_GRACE_SEC = 4;

// The showreel posters were 15 seconds (owner's call, 2026-09-28): a full
// motion-design sequence that lands on the finished poster. Each descriptor
// carries its OWN durationSec, which is what the slideshow actually holds
// for; this is the slot's fallback.
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
 * @property {number} durationSec
 * @property {'seamless'} [exit] see SeasonPromo
 * @property {'seamless'} [enter] see SeasonPromo
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
 * other promos are live. The other promos fill the other laps, and a lap with
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
      durationSec: p.durationSec,
      ...ending(p),
    }));

  const lapped = snowAlerts && inSnowSeason(today)
    ? withSnowAlerts(promos, snowOutlook(events, today, snowForecast, specialDates))
    : promos;
  if (!lapped.length) return null;
  return { id: 'season_promo', type: 'promo', durationSec: PROMO_DURATION_SEC, promos: lapped };
}

/**
 * The "double time" showing: on the day of a promo that has `encore`, a SECOND
 * slot the deck places far from the main one (lobbyDeck.js placeEncore), so the
 * poster airs twice in every pass that day and never on any other. Same guards
 * as buildPromoSlot (switched off, no feed, unusable date key: nothing). Never
 * persisted or published.
 *
 * @param {Array<any>|null|undefined} events
 * @param {string} todayStr
 * @param {{ specialDates?: Record<string, any>|null, enabled?: boolean }} [opts]
 * @returns {PromoSlot|null}
 */
export function buildEncoreSlot(events, todayStr, opts = {}) {
  const { specialDates = null, enabled = true } = opts;
  if (!enabled) return null;
  if (!Array.isArray(events) || events.length === 0) return null;
  const today = showDate(todayStr);
  if (!today) return null;
  const p = SEASON_PROMOS.find((x) => x.encore && x.eventDate === today && slideInWindow({ showFrom: x.showFrom, showUntil: x.eventDate }, today));
  if (!p) return null;
  return {
    id: 'season_promo_encore',
    type: 'promo',
    durationSec: PROMO_DURATION_SEC,
    promos: [{
      id: p.id,
      kind: p.kind,
      eventDate: p.eventDate,
      tonight: true,
      countdown: countdownLabel(nightsUntil(events, today, p.eventDate, specialDates), today, p.eventDate),
      durationSec: p.durationSec,
      ...ending(p),
    }],
  };
}

/**
 * The snow slide on its own cadence: [S, x, x, x, x, x] on a calm week and
 * [S, x] when snow is coming, where each x is the next other promo in turn, or
 * null (no promo that lap) when none is live. Enough rounds that every live
 * poster still gets its turn.
 *
 * @param {PromoDescriptor[]} fall
 * @param {import('./snowAlerts.js').SnowOutlook|null} outlook
 * @returns {Array<PromoDescriptor|null>}
 */
function withSnowAlerts(fall, outlook) {
  /** @type {PromoDescriptor} */
  const snow = {
    id: 'promo_snow_alerts',
    kind: 'snowAlerts',
    eventDate: outlook ? outlook.date : '',
    tonight: outlook?.when === 'tonight',
    countdown: null,
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
  Object.freeze({ key: 'grandPrix', label: 'Grand Prix (video)' }),
  Object.freeze({ key: 'snowAlerts', label: 'Snow alerts' }),
  Object.freeze({ key: 'snowAlertsStorm', label: 'Snow alerts: snow week' }),
]);

/**
 * The descriptor a preview plays: the same shape buildPromoSlot() makes, so
 * the poster draws exactly what the room would see. A dated promo counts down
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
  if (key === 'snowAlerts' || key === 'snowAlertsStorm') {
    const storm = key === 'snowAlertsStorm';
    const night = storm ? nextClubNightOrWednesday(events, today, specialDates) : '';
    return {
      id: 'promo_snow_alerts',
      kind: 'snowAlerts',
      eventDate: night,
      tonight: false,
      countdown: null,
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
    durationSec: p.durationSec,
    ...ending(p),
  };
}

/**
 * A promo's `exit`, `enter` and `theme`, only when it has them (most do not,
 * and their descriptors keep the shape they always had).
 * @param {SeasonPromo} p
 */
function ending(p) {
  if (!p.exit) return {};
  return p.enter ? { exit: p.exit, enter: p.enter, theme: p.theme || 'sky' } : { exit: p.exit, theme: p.theme || 'sky' };
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

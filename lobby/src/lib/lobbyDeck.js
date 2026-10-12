// @ts-check
// Which slides the lobby plays, as pure functions of their inputs: the typed
// deck (published or this device's own), the calendar's auto-slides, the
// season promo slot, and the facts App asks of them. App.jsx keeps the hooks
// and memoizes each answer on exactly the inputs named here, so a fresh array
// identity never restarts the background slideshow's hold timer.
import { buildCalendarSlides, deriveClubInfo } from './calendarLogic.js';
import { buildPromoSlot } from './promos.js';
import { inSnowSeason } from './snowAlerts.js';
import { mergeSyncedDeck, visibleSlides } from './slides.js';

/**
 * Which typed deck actually renders: the published one wherever this device
 * follows it (the default), else this device's own. An EMPTY published deck is
 * a real deck (the operator cleared the slides everywhere), so it wins too;
 * only "never received one" falls back to the local deck. Either way this
 * device's saved video slides stay in the rotation (mergeSyncedDeck): their
 * bytes exist only in this browser and can never ride a publish.
 * @param {boolean} followPublished
 * @param {{ slides: any[] } | null | undefined} syncedDeck
 * @param {any[]} manualSlides
 */
export function effectiveManualSlides(followPublished, syncedDeck, manualSlides) {
  return (followPublished && syncedDeck)
    ? mergeSyncedDeck(syncedDeck.slides, manualSlides)
    : manualSlides;
}

/**
 * The typed deck that is on air today: per-slide show windows (#345) judged
 * on the local date key, never a toISOString()-derived one (in a US-Eastern
 * evening that is already tomorrow, i.e. club hours).
 * @param {any[]} slides
 * @param {string} todayStr
 */
export function visibleManualSlides(slides, todayStr) {
  return visibleSlides(slides, todayStr);
}

/**
 * The calendar's auto-slides, or none with the calendar off.
 * @param {{
 *   enabled: boolean, events: any, todayStr: string, specialDates: any,
 *   welcomeText: any, showWelcome: any, showNextWeek: any, showRemaining: any,
 * }} q
 */
export function calendarSlidesFor({
  enabled, events, todayStr, specialDates, welcomeText, showWelcome, showNextWeek, showRemaining,
}) {
  if (!enabled) return [];
  return buildCalendarSlides(deriveClubInfo(events, todayStr, specialDates), {
    calendarWelcomeText: welcomeText,
    calendarShowWelcome: showWelcome,
    calendarShowNextWeek: showNextWeek,
    calendarShowRemaining: showRemaining,
  });
}

/**
 * Whether the season promos may air: the calendar is the source of their
 * counter, so with it off there is no slot at all.
 * @param {boolean} calendarEnabled
 * @param {boolean | undefined} seasonPromos
 */
export function promosAreOn(calendarEnabled, seasonPromos) {
  return Boolean(calendarEnabled) && seasonPromos !== false;
}

/**
 * Whether the snow-alerts forecast is worth asking for: only in the snow
 * season and only when the slide could show, so a September screen or an OBS
 * overlay never calls the weather API for it.
 * @param {boolean} promosOn
 * @param {string} todayStr
 * @param {boolean} overlay
 */
export function wantsSnowForecast(promosOn, todayStr, overlay) {
  return promosOn && inSnowSeason(todayStr) && !overlay;
}

/**
 * The snow slide's phone shows the weather too, so the weather is asked for
 * while that slide can air.
 * @param {{ calendarEnabled: boolean, seasonPromos?: boolean }} config
 * @param {string} todayStr
 */
export function snowPhoneAsksWeather(config, todayStr) {
  return Boolean(config.calendarEnabled && config.seasonPromos !== false && inSnowSeason(todayStr));
}

/**
 * This season's event promos as ONE slot however many are live today, or null.
 * @param {any} events
 * @param {string} todayStr
 * @param {{ specialDates: any, enabled: boolean, snowForecast: any }} o
 */
export function promoSlotFor(events, todayStr, { specialDates, enabled, snowForecast }) {
  return buildPromoSlot(events, todayStr, {
    specialDates,
    enabled,
    snowAlerts: true,
    snowForecast,
  });
}

/**
 * The calendar slides and the promo slot, concatenated, in that order.
 * @param {any[]} calendarSlides
 * @param {any} promoSlot
 */
export function autoSlideDeck(calendarSlides, promoSlot) {
  return promoSlot ? [...calendarSlides, promoSlot] : calendarSlides;
}

/**
 * Tonight's calendar title, which lets the 'auto' skin pick Easter / VBS /
 * Thanksgiving. `.tonight`, not `.today`: deriveClubInfo has never returned a
 * `today` key.
 * @param {any} events
 * @param {string} todayStr
 * @param {any} specialDates
 * @returns {string | null}
 */
export function tonightTitleOf(events, todayStr, specialDates) {
  return deriveClubInfo(events, todayStr, specialDates)?.tonight?.title ?? null;
}

/**
 * Whether the slideshow itself drives the corner info (every slide load is a
 * step), rather than a timer standing in: the typed deck, on a screen, with
 * more than one slide.
 * @param {{ overlay: boolean, backgroundSource: string, autoCount: number, manualCount: number }} q
 */
export function isSlideDriven({ overlay, backgroundSource, autoCount, manualCount }) {
  return !overlay && backgroundSource === 'manual' && (autoCount + manualCount) > 1;
}

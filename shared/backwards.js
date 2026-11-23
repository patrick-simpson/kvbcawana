// Backwards Night (owner 2026-11-23: "I want almost everything to be backwards
// on the screen"): ONE copy of its rules for the Worker, the screens and the
// print server. Pure, no imports.
//
// - On when the church calendar has an event titled with "backwards" that day,
//   or when /settings says On (worker/src/theme.js holds the switch).
// - Words are reversed letter by letter, whole string ("GO!" -> "!OG"), by
//   grapheme so an accented letter or an emoji stays whole.
// - Kept the right way round (owner): pledges and Scripture, the pickup
//   board's names, game scores and timers, notices to every screen. Those
//   surfaces simply never call `backwardsText`.

/** The event title that makes a day Backwards Night. @param {unknown} title */
export function isBackwardsTitle(title) {
  return /\bbackwards?\b/i.test(String(title ?? ''));
}

/**
 * Does this calendar feed say today is Backwards Night?
 * @param {{ events?: Array<{ date?: string, title?: string, isCancelled?: boolean }> }|null|undefined} feed
 * @param {string} today YYYY-MM-DD
 */
export function calendarSaysBackwards(feed, today) {
  const events = feed && Array.isArray(feed.events) ? feed.events : [];
  return events.some((e) => e && e.date === today && !e.isCancelled && isBackwardsTitle(e.title));
}

/** @param {string} s @returns {string[]} */
function graphemes(s) {
  const Seg = /** @type {any} */ (globalThis.Intl)?.Segmenter;
  if (typeof Seg === 'function') {
    try { return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment); } catch { /* fall through */ }
  }
  return Array.from(s);
}

/**
 * A string spelled backwards ("LIAM" -> "MAIL", "Welcome back!" -> "!kcab emocleW").
 * Anything that is not a string comes back as it was.
 * @template T @param {T} text @returns {T}
 */
export function backwardsText(text) {
  if (typeof text !== 'string' || !text) return text;
  return /** @type {any} */ (graphemes(text).reverse().join(''));
}

/** The switch's modes (worker/src/theme.js). */
export const BACKWARDS_MODES = Object.freeze(['auto', 'on', 'off']);

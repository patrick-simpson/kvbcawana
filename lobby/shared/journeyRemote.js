// @ts-check
// The Journey phone remote's rules (owner 2026-10-13: "build a way to advance
// slides for Journey on a phone ... Doing it on the phone should advance the
// slide for all"). ONE copy, pure, no imports, used by:
//   - the sync Worker (lobby/worker/src/journeyRemote.js, through
//     src/lib/syncSpecs.js), which checks every press and every kiosk report
//   - the phone page (journey/public/remote/, a byte copy in
//     journey/public/src/shared/ made by scripts/family-assets.mjs), which
//     cleans what the Worker hands back before drawing it
//   - the tests on both sides.
//
// A press is one of JOURNEY_REMOTE_ACTIONS with, for two of them, a little
// data (a seek's signed seconds, a pick's week and choice); never free text.
// A kiosk's report (`now`) says what its screen shows: which view, which
// lesson (title only, never a file), the slide or the video position, why
// it is waiting, and how its last remote press went. Strings are one line,
// at most JOURNEY_NOW_TEXT_MAX characters; numbers are clamped.

/** Everything the phone may ask every Journey screen to do. */
export const JOURNEY_REMOTE_ACTIONS = Object.freeze([
  'slide-next', 'slide-prev', 'slides-start',
  'play', 'pause', 'toggle-pause', 'seek', 'mute', 'unmute', 'volume',
  'begin', 'pick',
]);

/** The kiosk's picker choices (journey/src/schedule/19-picker-final-step.js PICKER_CHOICES). */
export const JOURNEY_PICKER_CHOICES = Object.freeze(['student', 'leader', 'slides', 'handout', 'student-prep', 'leader-prep']);

/** A remote press not collected by a kiosk within this long is dropped (a Next 30 s late is worse than none). */
export const JOURNEY_REMOTE_TTL_MS = 20 * 1000;
/** How many presses may wait for one kiosk; the oldest goes first. */
export const JOURNEY_REMOTE_QUEUE_MAX = 12;
/** A kiosk reports what it shows only while a phone asked within this long. */
export const JOURNEY_REMOTE_WATCH_MS = 30 * 1000;
/** Presses per phone sign-in: this many at once, then this many a second. */
export const JOURNEY_REMOTE_BURST = 8;
export const JOURNEY_REMOTE_REFILL_PER_S = 4;
/** A seek moves at most this far, either way (the kiosk's Back 15s / Skip 15s). */
export const JOURNEY_SEEK_MAX_S = 15;
/** One volume press moves the video's volume by this many percent (owner 2026-10-15). */
export const JOURNEY_VOLUME_STEP_PCT = 10;

/** What a kiosk's screen can be showing. */
export const JOURNEY_NOW_VIEWS = Object.freeze(['splash', 'intro', 'video', 'slides', 'checkin', 'trek', 'idle']);
/** Which teaching slide: the deck's four pictures, then the filled-in template slides. */
export const JOURNEY_NOW_SLIDE_KINDS = Object.freeze(['title', 'verse', 'misconception', 'illumination', 'questions', 'template']);
/** Why a screen is waiting for someone standing at it. */
export const JOURNEY_NOW_WAITS = Object.freeze(['captions', 'loading', 'settings', 'reader']);
/** Why a kiosk skipped a press (the phone words each one). */
export const JOURNEY_REMOTE_REASONS = Object.freeze([
  'no-slides', 'first-slide', 'no-video', 'already', 'starting', 'not-splash', 'settings-open', 'reader-open',
  'captions-question', 'lesson-running', 'unknown-week', 'no-leader', 'lessons-loading', 'sound-blocked', 'configure', 'unknown',
]);
export const JOURNEY_NOW_TEXT_MAX = 80;
export const JOURNEY_NOW_LINES_MAX = 3;
const WEEK_MAX = 99;
const SECONDS_MAX = 36000;
const PRESS_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** @param {unknown} v @returns {v is Record<string, any>} */
const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** @param {readonly string[]} list @param {unknown} v @returns {v is string} */
const oneOf = (list, v) => typeof v === 'string' && list.includes(v);

/** A week number 1..99, or null. @param {unknown} v */
function cleanWeek(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= WEEK_MAX ? v : null;
}

/** One line, control characters out, at most `max` characters (whole code points), or null. @param {unknown} raw @param {number} [max] */
export function cleanNowText(raw, max = JOURNEY_NOW_TEXT_MAX) {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const flat = raw.slice(0, 1000).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  const out = [...flat].slice(0, max).join('').trim();
  return out || null;
}

/** Seconds 0..36000 to a tenth, or 0. @param {unknown} v */
function cleanSeconds(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(SECONDS_MAX, Math.max(0, v)) * 10) / 10 : 0;
}

/**
 * One press from the phone, or null. Only a seek and a pick carry data: a
 * seek its signed seconds (rounded, clamped to ±JOURNEY_SEEK_MAX_S, never 0),
 * a volume press its direction `step` (exactly +1 or -1: one tap = one
 * JOURNEY_VOLUME_STEP_PCT step), a pick a week 1..99, a choice from JOURNEY_PICKER_CHOICES and, only after
 * the phone's confirm tap, `force: true` (replace a lesson already running).
 * Every other action's data is dropped.
 * @param {unknown} action
 * @param {unknown} [data]
 * @returns {{ action: string, data?: { by: number } | { step: 1 | -1 } | { week: number, choice: string, force?: true } } | null}
 */
export function sanitizeJourneyRemote(action, data) {
  if (!oneOf(JOURNEY_REMOTE_ACTIONS, action)) return null;
  if (action === 'seek') {
    const by = isPlain(data) && typeof data.by === 'number' && Number.isFinite(data.by)
      ? Math.max(-JOURNEY_SEEK_MAX_S, Math.min(JOURNEY_SEEK_MAX_S, Math.round(data.by))) : 0;
    return by ? { action, data: { by } } : null;
  }
  if (action === 'volume') {
    const step = isPlain(data) ? data.step : null;
    return step === 1 || step === -1 ? { action, data: { step } } : null;
  }
  if (action === 'pick') {
    if (!isPlain(data)) return null;
    const week = cleanWeek(data.week);
    if (week === null || !oneOf(JOURNEY_PICKER_CHOICES, data.choice)) return null;
    return { action, data: { week, choice: data.choice, ...(data.force === true ? { force: /** @type {true} */ (true) } : {}) } };
  }
  return { action };
}

/**
 * A press as the doorbell carries it to a kiosk: the Worker's press id, an
 * action and its cleaned data, in exactly the shape sanitizeJourneyRemote
 * allows, or null (anything else, an id that is not url-safe or over 40
 * characters). Pure: the lobby's embed bridge and the tests use it.
 * @param {unknown} raw
 * @returns {{ id: string, action: string, data?: Record<string, unknown> } | null}
 */
export function sanitizeJourneyPress(raw) {
  if (!isPlain(raw) || typeof raw.id !== 'string' || !PRESS_ID_RE.test(raw.id)) return null;
  const clean = sanitizeJourneyRemote(raw.action, raw.data);
  return clean ? { id: raw.id, action: clean.action, ...(clean.data ? { data: { ...clean.data } } : {}) } : null;
}

/**
 * @typedef {{ n: number, of: number, kind: string, heading: string | null, lines: string[] }} NowSlide
 * @typedef {{ t: number, d: number, paused: boolean, muted: boolean, volume?: number }} NowVideo
 * @typedef {{ id: string | null, action: string, ok: boolean, reason: string | null }} NowLast
 * @typedef {{ view: string, week: number | null, title: string | null, preview: boolean, wait: string | null,
 *   slide?: NowSlide, video?: NowVideo, resume?: number, last: NowLast | null, at: string | null }} JourneyNow
 */

/** @param {unknown} s @returns {NowSlide | null} */
function cleanSlide(s) {
  if (!isPlain(s)) return null;
  const of = cleanWeek(s.of);
  const n = cleanWeek(s.n);
  if (of === null || n === null || n > of || !oneOf(JOURNEY_NOW_SLIDE_KINDS, s.kind)) return null;
  const lines = Array.isArray(s.lines)
    ? s.lines.slice(0, 10).map((l) => cleanNowText(l)).filter((l) => l !== null).slice(0, JOURNEY_NOW_LINES_MAX) : [];
  return { n, of, kind: s.kind, heading: cleanNowText(s.heading), lines: /** @type {string[]} */ (lines) };
}

/** @param {unknown} v @returns {NowVideo | null} */
function cleanVideo(v) {
  if (!isPlain(v)) return null;
  /** @type {NowVideo} */
  const out = { t: cleanSeconds(v.t), d: cleanSeconds(v.d), paused: v.paused === true, muted: v.muted === true };
  // The video's volume in whole percent (a kiosk that does not say leaves it out).
  if (typeof v.volume === 'number' && Number.isFinite(v.volume)) out.volume = Math.round(Math.min(100, Math.max(0, v.volume)));
  return out;
}

/** @param {unknown} l @returns {NowLast | null} */
function cleanLast(l) {
  if (!isPlain(l) || !oneOf(JOURNEY_REMOTE_ACTIONS, l.action)) return null;
  const ok = l.ok === true;
  return {
    id: typeof l.id === 'string' && PRESS_ID_RE.test(l.id) ? l.id : null,
    action: l.action,
    ok,
    reason: ok ? null : (oneOf(JOURNEY_REMOTE_REASONS, l.reason) ? l.reason : 'unknown'),
  };
}

/**
 * A kiosk's report of what its screen shows, in the one fixed shape, or null
 * (junk, an unknown view). Unknown keys dropped, numbers clamped, strings one
 * line of at most JOURNEY_NOW_TEXT_MAX characters; `slide` only in the slides
 * view, `video` only in the video view, `resume` (seconds the splash offers to
 * resume at) only on the splash. Never a URL or a file name: a title is a
 * lesson's title.
 * @param {unknown} raw
 * @returns {JourneyNow | null}
 */
export function sanitizeJourneyNow(raw) {
  if (!isPlain(raw) || !oneOf(JOURNEY_NOW_VIEWS, raw.view)) return null;
  /** @type {JourneyNow} */
  const out = {
    view: raw.view,
    week: cleanWeek(raw.week),
    title: cleanNowText(raw.title),
    preview: raw.preview === true,
    wait: oneOf(JOURNEY_NOW_WAITS, raw.wait) ? raw.wait : null,
    last: cleanLast(raw.last),
    at: null,
  };
  if (raw.view === 'slides') {
    const slide = cleanSlide(raw.slide);
    if (slide) out.slide = slide;
  }
  if (raw.view === 'video') {
    const video = cleanVideo(raw.video);
    if (video) out.video = video;
  }
  if (raw.view === 'splash' && typeof raw.resume === 'number' && raw.resume > 0) out.resume = Math.floor(cleanSeconds(raw.resume));
  if (typeof raw.at === 'string' && raw.at.length <= 40) {
    const t = Date.parse(raw.at);
    if (Number.isFinite(t) && t > 0) out.at = new Date(t).toISOString();
  }
  return out;
}

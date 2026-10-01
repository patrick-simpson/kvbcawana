// ─────────────────────────────────────────────────────────────
// Manual "typed slides" — the free-text alternative to the
// PowerPoint background. Pure data helpers, no React.
//
// A text slide is:
//   { id, eyebrow, text, theme, durationSec, textSize }
//
// text     the free-typed body (required, multi-line, ≤ MAX_TEXT)
// showFrom  optional first day this slide may show (YYYY-MM-DD, local)
// showUntil optional last day, inclusive — an outdated announcement
//           retires itself instead of advertising last month's store
//           night. Both are BARE LOCAL dates and are compared against
//           the screen's own local date key, never toISOString()
// eyebrow  optional small-caps line above the text (≤ MAX_EYEBROW)
// theme    'auto' rotates through SLIDE_THEMES by position
// textSize 'auto' picks a size from the text length; 'xl'/'lg'/'md'
//          force one when auto guesses wrong
// durationSec  0 = follow the global slideshowDelaySec setting
//
// A video slide is:
//   { id, type: 'video', videoId, videoName, videoSize, durationSec }
//
// videoId   key of the video Blob in IndexedDB (see videoStore.js) —
//           the bytes live on this device only, never uploaded
// videoName display-only filename (≤ MAX_VIDEO_NAME)
// videoSize bytes, display-only (0 = unknown)
// durationSec  0 = play the video to the END, then advance (NOT the
//           global-delay fallback text slides use); >0 = hold that
//           long with the video looping underneath
// ─────────────────────────────────────────────────────────────

export const SLIDE_THEMES = ['sky', 'sunset', 'night', 'meadow', 'lavender'];
export const TEXT_SIZES = ['auto', 'xl', 'lg', 'md'];
export const MAX_SLIDES = 50;
export const MAX_TEXT = 500;
export const MAX_EYEBROW = 60;
export const MAX_VIDEO_NAME = 120;
export const MIN_DURATION_SEC = 3;
export const MAX_DURATION_SEC = 600;
export const DEFAULT_DURATION_SEC = 8;
// Above this the picker asks "are you sure" (large files are slow to
// store and decode on signage sticks) — it warns, never blocks.
export const VIDEO_SIZE_WARN_BYTES = 200 * 1024 * 1024;

// ── The optional per-slide show window (#345) ──────────────────────────
// A bare local calendar date, exactly as the operator typed it. NEVER
// toISOString(): in a US-Eastern evening UTC has already rolled over to
// tomorrow, which is precisely club hours — the house rule this repo has
// been bitten by before (see calendarLogic.js). Anything that is not a
// real calendar date is DROPPED, so a slide with a junk window shows
// ALWAYS, which is the same as no window and strictly better than a
// slide that silently never appears.
const SHOW_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The date string a slide may keep, or null.
 * @param {unknown} value
 * @returns {string|null}
 */
export function showDate(value) {
  const m = SHOW_DATE_RE.exec(typeof value === 'string' ? value.trim() : '');
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // Date.UTC only answers "does this calendar date exist" (leap years,
  // month lengths). Nothing derived from it is ever stored or compared.
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Is this slide inside its show window on `todayStr`? A plain STRING
 * comparison of two YYYY-MM-DD keys — lexicographic order is calendar
 * order for that format, so no Date object (and no timezone) is involved
 * at all. Both bounds are INCLUSIVE: a slide dated showUntil today is
 * still shown tonight and gone tomorrow, which is what an operator
 * typing "the store night is on the 16th" means.
 * @param {{showFrom?: string, showUntil?: string}} slide
 * @param {string} todayStr local YYYY-MM-DD (see calendarLogic.localDateStr)
 */
export function slideInWindow(slide, todayStr) {
  const today = showDate(todayStr);
  // No usable "today" (a caller mid-boot) must never blank the screen.
  if (!today) return true;
  const from = showDate(slide?.showFrom);
  if (from && today < from) return false;
  const until = showDate(slide?.showUntil);
  if (until && today > until) return false;
  return true;
}

/** True when this slide's window has ALREADY closed (the editor's badge). */
export function slideExpired(slide, todayStr) {
  const today = showDate(todayStr);
  const until = showDate(slide?.showUntil);
  return Boolean(today && until && today > until);
}

/** True when this slide's window has not opened yet (the editor's badge). */
export function slideScheduled(slide, todayStr) {
  const today = showDate(todayStr);
  const from = showDate(slide?.showFrom);
  return Boolean(today && from && today < from);
}

/**
 * The slides a screen may actually rotate today. Pure filter — the
 * editor keeps showing every slide (with an "expired" badge), because
 * an operator has to be able to see and fix the one that stopped.
 *
 * A deck whose every slide has expired returns [], and App.jsx hands
 * that to the background as an empty MANUAL deck: the calendar slides
 * are concatenated separately, so the screen falls back to those (or,
 * with the calendar off, to the welcome placeholder) — never to black.
 * @param {Array<any>} slides
 * @param {string} todayStr
 */
export function visibleSlides(slides, todayStr) {
  if (!Array.isArray(slides)) return [];
  return slides.filter((s) => slideInWindow(s, todayStr));
}

export function makeSlideId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return 's_' + crypto.randomUUID();
  }
  return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function makeSlide(partial = {}) {
  return {
    id: makeSlideId(),
    eyebrow: '',
    text: '',
    theme: 'auto',
    durationSec: 0,
    textSize: 'auto',
    ...partial,
  };
}

export function makeVideoSlide({ videoId, videoName = '', videoSize = 0 } = {}) {
  return {
    id: makeSlideId(),
    type: 'video',
    videoId,
    videoName: String(videoName).slice(0, MAX_VIDEO_NAME),
    videoSize: Number.isFinite(videoSize) && videoSize > 0 ? Math.round(videoSize) : 0,
    durationSec: 0,
  };
}

export function isVideoSlide(slide) {
  return slide?.type === 'video';
}

// The robustness core: turns whatever came out of localStorage (or a
// pasted import file) into a safe slide array. Salvages what it can —
// a single corrupt entry drops that slide, not the whole deck — and
// never throws, so a bad value can't blank the signage screen.
export function sanitizeSlides(raw) {
  if (!Array.isArray(raw)) return [];
  const clean = [];
  const seenIds = new Set();
  for (const entry of raw) {
    if (clean.length >= MAX_SLIDES) break;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;

    const isVideo = entry.type === 'video';
    if (isVideo) {
      if (typeof entry.videoId !== 'string' || entry.videoId.trim() === '') continue;
    } else if (typeof entry.text !== 'string' || entry.text.trim() === '') {
      // Unknown `type` values fall through to the text rules, so a
      // future/bogus type without usable text drops harmlessly.
      continue;
    }

    let id = typeof entry.id === 'string' && entry.id ? entry.id : makeSlideId();
    while (seenIds.has(id)) id = makeSlideId();
    seenIds.add(id);

    let durationSec = 0;
    if (typeof entry.durationSec === 'number' && Number.isFinite(entry.durationSec) && entry.durationSec > 0) {
      durationSec = Math.min(MAX_DURATION_SEC, Math.max(MIN_DURATION_SEC, Math.round(entry.durationSec)));
    }

    if (isVideo) {
      const videoName = typeof entry.videoName === 'string' ? entry.videoName.slice(0, MAX_VIDEO_NAME) : '';
      const videoSize = typeof entry.videoSize === 'number' && Number.isFinite(entry.videoSize) && entry.videoSize > 0
        ? Math.round(entry.videoSize)
        : 0;
      /** @type {Record<string, unknown>} */
      const video = { id, type: 'video', videoId: entry.videoId, videoName, videoSize, durationSec };
      if (entry.holdCheckIns === true) video.holdCheckIns = true;
      clean.push(video);
      continue;
    }

    // Trim BEFORE slicing, exactly as the print server (events.js slideText)
    // and eventSanitizers.js cleanString do, so a locally saved deck and its
    // published echo compare equal (a trailing newline used to demote this
    // device's video slides to the end of the rotation on every publish).
    const eyebrow = typeof entry.eyebrow === 'string' ? entry.eyebrow.trim().slice(0, MAX_EYEBROW) : '';
    const theme = SLIDE_THEMES.includes(entry.theme) ? entry.theme : 'auto';
    const textSize = TEXT_SIZES.includes(entry.textSize) ? entry.textSize : 'auto';

    /** @type {Record<string, unknown>} */
    const slide = { id, eyebrow, text: entry.text.trim().slice(0, MAX_TEXT), theme, durationSec, textSize };
    // Omitted (not null, not '') when absent or unparseable, so a deck
    // with no dates round-trips byte-identically to the published one.
    const showFrom = showDate(entry.showFrom);
    if (showFrom) slide.showFrom = showFrom;
    const showUntil = showDate(entry.showUntil);
    if (showUntil) slide.showUntil = showUntil;
    // "Hold check-ins while this slide is up": strictly `true` or absent,
    // never false, exactly as the print server publishes it, so an unmarked
    // deck stays byte-identical to what it always was.
    if (entry.holdCheckIns === true) slide.holdCheckIns = true;
    clean.push(slide);
  }
  return clean;
}

/**
 * Whether check-ins wait while this slide is up (rebrand stage 4): the fall
 * promo posters always do (printed art, its own full-screen moment), and so
 * does any slide the operator marks "Hold check-ins". The arrivals queue
 * behind a WAITING chip and then play, each for their full time, on the
 * next slide. Checks the promo type directly rather than importing
 * isPromoSlide, which would make promos.js and this file import each other;
 * slides.test.js pins that the two agree.
 * @param {{ type?: unknown, holdCheckIns?: unknown } | null | undefined} slide
 */
export function holdsCheckIns(slide) {
  return slide?.type === 'promo' || slide?.holdCheckIns === true;
}

/**
 * The deck a screen that FOLLOWS a published deck actually rotates: the
 * published (text-only) slides merged with THIS device's saved video
 * slides. Video bytes live in this browser's storage and can never ride
 * a publish, so without this merge a following screen had no way to show
 * a video at all — an operator added one, pressed Save, and it silently
 * never appeared ("it doesn't actually stay" — reported 2026-09-02).
 *
 * Ordering: when the local deck's text slides are exactly the published
 * ones (the normal state right after a follow-mode Save copies them
 * down), the local deck IS the published deck plus positioned videos —
 * honor its interleaving. When the fleet has published something newer,
 * the published text wins and this device's videos join at the end of
 * the rotation until the next local Save re-interleaves them.
 */
export function mergeSyncedDeck(syncedSlides, localSlides) {
  const synced = sanitizeSlides(syncedSlides);
  const local = sanitizeSlides(localSlides);
  const localVideos = local.filter(isVideoSlide);
  if (!localVideos.length) return synced;
  // Compare CONTENT the way the publisher normalizes it, and WITHOUT ids (the
  // print server may assign its own — see contract-vectors.json): a trailing
  // newline or a regenerated id must never demote this device's videos to the
  // end of the rotation.
  const textOf = (slides) => JSON.stringify(slides
    .filter((s) => !isVideoSlide(s))
    .map((s) => [s.eyebrow.replace(/\s+/g, ' ').trim(), s.text.trim(), s.theme, s.textSize, s.durationSec,
      s.showFrom || '', s.showUntil || '', s.holdCheckIns === true]));
  if (textOf(local) === textOf(synced)) return local;
  // Re-sanitize the concatenation: it dedupes any id shared across the
  // two sources and re-applies the MAX_SLIDES cap.
  return sanitizeSlides([...synced, ...localVideos]);
}

// 'auto' cycles through the themes by slide position, so a deck typed
// with all-default themes still gets the full catalog variety.
export function resolveTheme(slide, index) {
  if (slide && SLIDE_THEMES.includes(slide.theme)) return slide.theme;
  return SLIDE_THEMES[((index % SLIDE_THEMES.length) + SLIDE_THEMES.length) % SLIDE_THEMES.length];
}

// Auto-fit: short punchy lines get the giant catalog headline size,
// long announcements step down so they never overflow the screen.
export function slideSizeClass(text = '') {
  const len = text.length;
  if (len < 60) return 'slide-size-xl';
  if (len < 160) return 'slide-size-lg';
  if (len < 320) return 'slide-size-md';
  return 'slide-size-sm';
}

// The class the slideshow (and editor thumbnails) actually render:
// an explicit per-slide textSize wins; 'auto' falls back to length.
export function resolveSizeClass(slide) {
  if (slide && slide.textSize && slide.textSize !== 'auto' && TEXT_SIZES.includes(slide.textSize)) {
    return `slide-size-${slide.textSize}`;
  }
  return slideSizeClass(slide?.text ?? '');
}

// Per-slide override → global slideshow delay → default, in ms.
// TEXT slides only — video slides use videoSlideTimerMs.
export function slideDurationMs(slide, globalDelaySec) {
  let sec = slide?.durationSec;
  if (!(typeof sec === 'number' && Number.isFinite(sec) && sec > 0)) {
    sec = typeof globalDelaySec === 'number' && Number.isFinite(globalDelaySec) && globalDelaySec > 0
      ? globalDelaySec
      : DEFAULT_DURATION_SEC;
  }
  return Math.min(MAX_DURATION_SEC, Math.max(MIN_DURATION_SEC, sec)) * 1000;
}

// Video slides: null means "no timer — advance when the video ends".
// A positive durationSec holds the slide exactly that long instead.
export function videoSlideTimerMs(slide) {
  const sec = slide?.durationSec;
  if (typeof sec === 'number' && Number.isFinite(sec) && sec > 0) {
    return Math.min(MAX_DURATION_SEC, Math.max(MIN_DURATION_SEC, sec)) * 1000;
  }
  return null;
}

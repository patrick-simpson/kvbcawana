// @ts-check
// What the sync Worker (worker/) keeps besides the shared settings and the
// slide deck, and the strict allowlists both sides apply to it. Pure and
// import-free, so the Worker bundles this exact file and the signage reads the
// same rules: a value one side accepts is a value the other side accepts.
//
// TEMPLATE_SPEC is the "new screen" template (owner, 2026-10-01): the
// per-screen settings a screen starts from when it is set up with the
// passphrase. Never the Pusher keys (the login hands those out), never the
// slide deck, never uploads, never panic mode, and never a secret.
//
// JOURNEY_SPEC is the Journey kiosk's room settings: the ones every Journey
// screen should share. Video quality and the leader prep transcript choice
// stay on each device (they depend on that device and that leader).

/**
 * @typedef {{ type: 'bool' }
 *   | { type: 'int', min: number, max: number }
 *   | { type: 'enum', values: string[] }
 *   | { type: 'url', max: number }} SimpleRule
 */

/** @type {Record<string, SimpleRule>} */
export const TEMPLATE_SPEC = {
  backgroundSource: { type: 'enum', values: ['manual', 'powerpoint', 'pptx', 'video'] },
  powerpointEmbedUrl: { type: 'url', max: 500 },
  slideshowDelaySec: { type: 'int', min: 0, max: 600 },
  useLocalSlideshow: { type: 'bool' },
  gapBetweenBannersMs: { type: 'int', min: 0, max: 10000 },
  audioMuted: { type: 'bool' },
  showConnectionStatus: { type: 'bool' },
  keepScreenAwake: { type: 'bool' },
  recapMaxAgeMin: { type: 'int', min: 1, max: 240 },
  followPublishedSlides: { type: 'bool' },
  followSharedSettings: { type: 'bool' },
  watchdogReloadMin: { type: 'int', min: 0, max: 1440 },
  confettiLevel: { type: 'enum', values: ['full', 'reduced', 'off'] },
  reduceMotion: { type: 'bool' },
};

export const TEMPLATE_KEYS = Object.freeze(Object.keys(TEMPLATE_SPEC));

/** The Journey kiosk's caption sizes (its own <select>'s values). */
export const JOURNEY_CAPTION_SIZES = ['0.8', '1', '1.3', '1.6'];
/** Its generated teaching-slide kinds. */
export const JOURNEY_SLIDE_KINDS = ['questions', 'takeaways', 'challenges'];
const JOURNEY_BULLET_MAX = 80;
const JOURNEY_BULLETS_PER_KIND = 3;
const JOURNEY_WEEKS_MAX = 80;

/** Shortest passphrase the Worker accepts on a change (owner: "kennebec"). */
export const PASSPHRASE_MIN = 6;
export const PASSPHRASE_MAX = 128;

/**
 * Both the screens and the Worker apply exactly this before comparing.
 * @param {unknown} p
 */
export function normalizeSyncPassphrase(p) {
  return String(p == null ? '' : p).trim().normalize('NFKC').toLowerCase();
}

/**
 * @param {SimpleRule} rule
 * @param {unknown} v
 */
function cleanSimple(rule, v) {
  switch (rule.type) {
    case 'bool':
      return typeof v === 'boolean' ? v : undefined;
    case 'int':
      if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
      return Math.min(rule.max, Math.max(rule.min, Math.round(v)));
    case 'enum':
      return typeof v === 'string' && rule.values.includes(v) ? v : undefined;
    case 'url': {
      if (typeof v !== 'string') return undefined;
      const s = v.trim();
      if (!s) return '';
      return s.length <= rule.max && /^https:\/\/[^\s<>"']+$/i.test(s) ? s : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Exactly the template allowlist; anything else is dropped. {} for junk.
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function sanitizeTemplate(raw) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const src = /** @type {Record<string, unknown>} */ (raw);
  for (const [key, rule] of Object.entries(TEMPLATE_SPEC)) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    const value = cleanSimple(rule, src[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** @param {unknown} value */
function cleanBullet(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, JOURNEY_BULLET_MAX);
}

/**
 * The Journey room settings: captions on/off, caption size and backdrop, the
 * teaching slides' auto-advance and extras, and tonight's edited bullets.
 * Exactly these keys, each in the shape Journey's own storage uses.
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function sanitizeJourney(raw) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const src = /** @type {Record<string, any>} */ (raw);
  if (typeof src.captions === 'boolean') out.captions = src.captions;
  if (typeof src.captionSize === 'string' && JOURNEY_CAPTION_SIZES.includes(src.captionSize)) {
    out.captionSize = src.captionSize;
  }
  if (typeof src.captionBackdrop === 'boolean') out.captionBackdrop = src.captionBackdrop;
  if (typeof src.slidesAutoAdvanceSec === 'number' && Number.isFinite(src.slidesAutoAdvanceSec)) {
    out.slidesAutoAdvanceSec = Math.min(600, Math.max(0, Math.round(src.slidesAutoAdvanceSec)));
  }
  if (src.slideExtras && typeof src.slideExtras === 'object' && !Array.isArray(src.slideExtras)) {
    /** @type {Record<string, boolean>} */
    const extras = {};
    for (const kind of JOURNEY_SLIDE_KINDS) {
      if (typeof src.slideExtras[kind] === 'boolean') extras[kind] = src.slideExtras[kind];
    }
    out.slideExtras = extras;
  }
  if (src.slideNotes && typeof src.slideNotes === 'object' && !Array.isArray(src.slideNotes)) {
    /** @type {Record<string, Record<string, string[]>>} */
    const notes = {};
    for (const week of Object.keys(src.slideNotes).slice(0, JOURNEY_WEEKS_MAX)) {
      const byKind = src.slideNotes[week];
      if (!/^\d{1,4}$/.test(week) || !byKind || typeof byKind !== 'object' || Array.isArray(byKind)) continue;
      /** @type {Record<string, string[]>} */
      const kinds = {};
      for (const kind of JOURNEY_SLIDE_KINDS) {
        if (!Array.isArray(byKind[kind])) continue;
        const bullets = byKind[kind].map(cleanBullet).filter(Boolean).slice(0, JOURNEY_BULLETS_PER_KIND);
        if (bullets.length) kinds[kind] = bullets;
      }
      if (Object.keys(kinds).length) notes[week] = kinds;
    }
    out.slideNotes = notes;
  }
  return out;
}

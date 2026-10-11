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
//
// SCREEN_SPECS (below) is each registered screen's OWN settings, per kind,
// which /settings edits through the Worker.

/**
 * @typedef {{ type: 'bool' }
 *   | { type: 'int', min: number, max: number }
 *   | { type: 'enum', values: string[] }
 *   | { type: 'url', max: number }
 *   | { type: 'time' }} SimpleRule
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
    case 'time':
      // "HH:MM", 24-hour, as an <input type="time"> gives it.
      return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : undefined;
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

// ── Screens (SETTINGS.md, phase 2) ─────────────────────────────────────────
// Every lobby TV, projector and Journey kiosk registers with the Worker under
// a name, and /settings edits any one's OWN settings there; the screen applies
// them as its device layer. SCREEN_SPECS is the one allowlist both sides
// apply, per kind. Never a shared key (those travel as the `settings` frame),
// never the Pusher keys, never panic mode (simplified mode is a hand on the
// TV, not a remote switch), never the typed deck or an upload, never a URL a
// screen would fetch on its own (the fleet's schedule and theme files), and
// never a secret. screenSpecs.test.js pins the lobby's against useConfig's
// VALIDATORS and SHARED_SPEC.

// `computer` is the KVBC Awana Windows app (UNIFIED-APP.md, v9): a computer
// registers with its roles (print server, display, or both) and its display
// hours, under the name its first-run wizard gave it. The kind is here so the
// registry, the allowlist and /settings' list already take it; the app's side
// and its /settings card come with v9.

/** @typedef {'lobby' | 'projector' | 'journey' | 'computer'} ScreenKind */

/** @type {readonly ScreenKind[]} */
export const SCREEN_KINDS = Object.freeze(['lobby', 'projector', 'journey', 'computer']);

/** @type {Record<ScreenKind, Record<string, SimpleRule>>} */
export const SCREEN_SPECS = {
  lobby: {
    ...TEMPLATE_SPEC,
    // lib/clubs.js CORNER_CLUB_IDS, written out like useConfig's (pinned).
    cornerClub: { type: 'enum', values: ['', 'puggles', 'cubbies', 'sparks', 'tnt', 'trek', 'journey'] },
    showTonightTicker: { type: 'bool' },
  },
  // The projector's two device switches (presentation/hooks/useLowPower.js,
  // presentation/lib/stingers.js).
  projector: {
    lowPower: { type: 'bool' },
    stingers: { type: 'bool' },
  },
  // Journey's one device setting the room does not share (schedule.js
  // PLAYBACK_QUALITY_CHOICES).
  journey: {
    playbackQuality: { type: 'enum', values: ['auto', 'full', 'low'] },
  },
  // The two role switches and the club-night display hours (default 5:00 to
  // 8:00 pm). Whether a role may change now (never a print server turned off
  // mid-print) is the app's to refuse; this only says what may be stored.
  computer: {
    printRole: { type: 'bool' },
    displayRole: { type: 'bool' },
    displayFrom: { type: 'time' },
    displayUntil: { type: 'time' },
  },
};

/**
 * What /settings may ask a screen to do (the configure relay's own actions,
 * configureRelay.js), delivered on the live channel. Each one is a request the
 * screen treats like a press of its own button.
 * @type {Record<ScreenKind, readonly string[]>}
 */
export const SCREEN_ACTIONS = {
  lobby: Object.freeze(['preview-checkin', 'reset-tally', 'board-demo']),
  projector: Object.freeze(['select', 'resume']),
  journey: Object.freeze([]),
  computer: Object.freeze([]),
};

/** What a screen is called until someone names it. @type {Record<ScreenKind, string>} */
export const SCREEN_DEFAULT_NAMES = { lobby: 'Lobby TV', projector: 'Projector', journey: 'Journey kiosk', computer: 'Computer' };

export const SCREEN_NAME_MAX = 40;
const SCREEN_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** @param {unknown} kind @returns {kind is ScreenKind} */
export function isScreenKind(kind) {
  return typeof kind === 'string' && /** @type {readonly string[]} */ (SCREEN_KINDS).includes(kind);
}

/** A screen's id: random, made once on the screen. @param {unknown} id @returns {id is string} */
export function isScreenId(id) {
  return typeof id === 'string' && SCREEN_ID_RE.test(id);
}

/**
 * A screen's name as people type it: one line, no control characters, at most
 * SCREEN_NAME_MAX characters. '' when nothing is left.
 * @param {unknown} raw
 */
export function cleanScreenName(raw) {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SCREEN_NAME_MAX).trim();
}

/**
 * Exactly the kind's allowlist; anything else is dropped. {} for junk or an
 * unknown kind. Key order is the spec's, so two sanitized copies of the same
 * settings stringify the same.
 * @param {unknown} kind
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function sanitizeScreenSettings(kind, raw) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (!isScreenKind(kind) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const src = /** @type {Record<string, unknown>} */ (raw);
  for (const [key, rule] of Object.entries(SCREEN_SPECS[kind])) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    const value = cleanSimple(rule, src[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * One action for a screen of this kind, or null. Only the projector's wall
 * pick carries data, checked exactly as the projector checks a relayed one.
 * @param {unknown} kind
 * @param {unknown} action
 * @param {unknown} [data]
 * @returns {{action: string, data?: {type: 'countdown'} | {type: 'window', index: number}} | null}
 */
export function sanitizeScreenAction(kind, action, data) {
  if (!isScreenKind(kind) || typeof action !== 'string' || !SCREEN_ACTIONS[kind].includes(action)) return null;
  if (kind !== 'projector' || action !== 'select') return { action };
  const t = /** @type {any} */ (data);
  if (t && t.type === 'countdown') return { action, data: { type: 'countdown' } };
  if (t && t.type === 'window' && Number.isInteger(t.index) && t.index >= 0 && t.index < 50) {
    return { action, data: { type: 'window', index: t.index } };
  }
  return null;
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

// @ts-check
// What the sync Worker (worker/) keeps besides the shared settings and the
// slide deck, and the strict allowlists both sides apply to it. Pure (its one
// import, settingRules.js, is pure too), so the Worker bundles this exact file and the signage reads the
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
// which /settings edits through the Worker; sanitizeScreenStatus what a
// screen reports about itself (a kiosk's saved lessons, a computer's app
// version and update, a TV's or projector's page build).

import { cleanSpec } from './settingRules.js';

/**
 * The rule types these tables use: a subset of settingRules.js's.
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

// Both the screens and the Worker apply exactly this before comparing: the
// sync protocol's one definition (shared/sync-protocol.js).
export { normalizeSyncPassphrase } from '../../../shared/sync-protocol.js';

/**
 * Exactly the template allowlist; anything else is dropped. {} for junk.
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function sanitizeTemplate(raw) {
  return cleanSpec(TEMPLATE_SPEC, raw);
}

// ── Screens (ROADMAP.md#settings-page, phase 2) ─────────────────────────────────────────
// Every lobby TV, projector and Journey kiosk registers with the Worker under
// a name, and /settings edits any one's OWN settings there; the screen applies
// them as its device layer. SCREEN_SPECS is the one allowlist both sides
// apply, per kind. Never a shared key (those travel as the `settings` frame),
// never the Pusher keys, never panic mode (simplified mode is a hand on the
// TV, not a remote switch), never the typed deck or an upload, never a URL a
// screen would fetch on its own (the fleet's schedule and theme files), and
// never a secret. screenSpecs.test.js pins the lobby's against useConfig's
// VALIDATORS and SHARED_SPEC.

// `computer` is the KVBC Awana Windows app (ROADMAP.md#kvbc-awana-one-app, v9): a computer
// registers with its roles (print server, display, or both) and its display
// hours, under the name its first-run wizard gave it. The app's side is
// printer/electron-app/src/device-sync.js, whose copy of this kind's rules
// its test pins to the one below.

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
  // Journey plays the same on every device since the Pi was removed (2026-10-12);
  // its two own settings are about saving lessons on that computer
  // (journey/src/schedule/26-lesson-downloads.js, owner 2026-10-12: edited from
  // /settings → Journey → Lessons on the Journey PCs): "Download lessons
  // automatically" (journey.downloads.auto) and "Include Leader Videos"
  // (journey.downloads.leaders). The kiosk applies them, and sends up a change
  // made on the kiosk itself (journey/public/src/sync.js).
  journey: {
    downloadsAuto: { type: 'bool' },
    downloadsLeader: { type: 'bool' },
  },
  // The two role switches and the club-night display hours (default 5:00 to
  // 8:00 pm). Whether a role may change now (never a print server turned off
  // mid-print) is the app's to hold until it is idle (its hello then carries
  // `pendingRoleChange`); this only says what may be stored.
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
 *
 * A Journey kiosk has no socket of its own (CLAUDE.md "room sync"), so
 * its actions are QUEUED by the Worker and handed over in its next hello's
 * answer, each one once (SCREEN_ACTION_QUEUED_KINDS; worker/src/screens.js,
 * worker/src/routes.md 10.8): the buttons of its own Settings → "Lessons on
 * this computer", pressed from /settings → Journey.
 * @type {Record<ScreenKind, readonly string[]>}
 */
export const SCREEN_ACTIONS = {
  lobby: Object.freeze(['preview-checkin', 'reset-tally', 'board-demo']),
  // slide-next/slide-prev and the backups are the opening-ceremony remote's
  // (owner 2026-10-19; /lobby/projector-remote.html).
  projector: Object.freeze(['select', 'resume', 'slide-next', 'slide-prev', 'backup', 'backup-end']),
  journey: Object.freeze(['start-downloads', 'pause-downloads', 'resume-downloads', 'stop-downloads', 'delete-downloads']),
  computer: Object.freeze([]),
};

/** The opening-ceremony remote's backup screens: a flag beside its pledge, or the verse. */
export const PROJECTOR_BACKUPS = Object.freeze(['us-flag', 'awana-flag', 'verse']);

/** The kinds whose actions wait in the Worker for the screen's next hello (no live channel of their own). */
export const SCREEN_ACTION_QUEUED_KINDS = Object.freeze(/** @type {readonly ScreenKind[]} */ (['journey']));
/** How many actions may wait for one screen; one more is refused. */
export const SCREEN_ACTION_QUEUE_MAX = 5;
/** An action not collected within this long is dropped (a press an hour late is worse than none). */
export const SCREEN_ACTION_TTL_MS = 10 * 60 * 1000;

// The Journey phone remote (owner 2026-10-13; awana.kvbchurch.org/journey/remote/):
// one press goes to EVERY Journey kiosk, and each kiosk reports what its
// screen shows while a phone is watching. Its rules live in
// shared/journeyRemote.js, so the phone page (a plain static page under
// /journey/, which gets a byte copy) applies exactly what the Worker does;
// the Worker reaches them through this file like every other allowlist.
export {
  JOURNEY_NOW_SLIDE_KINDS,
  JOURNEY_NOW_VIEWS,
  JOURNEY_NOW_WAITS,
  JOURNEY_PICKER_CHOICES,
  JOURNEY_REMOTE_ACTIONS,
  JOURNEY_REMOTE_BURST,
  JOURNEY_REMOTE_QUEUE_MAX,
  JOURNEY_REMOTE_REASONS,
  JOURNEY_REMOTE_REFILL_PER_S,
  JOURNEY_REMOTE_TTL_MS,
  JOURNEY_REMOTE_WATCH_MS,
  JOURNEY_SEEK_MAX_S,
  JOURNEY_VOLUME_STEP_PCT,
  sanitizeJourneyNow,
  sanitizeJourneyPress,
  sanitizeJourneyRemote,
} from '../../../shared/journeyRemote.js';

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
  // Cut by code points, never between the halves of a surrogate pair (an emoji).
  // eslint-disable-next-line no-control-regex
  return [...raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, SCREEN_NAME_MAX).join('').trim();
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
  return isScreenKind(kind) ? cleanSpec(SCREEN_SPECS[kind], raw) : {};
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
  if (kind === 'projector' && action === 'backup') {
    const what = /** @type {any} */ (data)?.what;
    return PROJECTOR_BACKUPS.includes(what) ? { action, data: { what } } : null;
  }
  if (kind !== 'projector' || action !== 'select') return { action };
  const t = /** @type {any} */ (data);
  if (t && t.type === 'countdown') return { action, data: { type: 'countdown' } };
  if (t && t.type === 'window' && Number.isInteger(t.index) && t.index >= 0 && t.index < 50) {
    return { action, data: { type: 'window', index: t.index } };
  }
  return null;
}

// ── A screen's status (what it reports in its hello; never a setting) ───────
// Every kind reports one small thing about itself, through ONE sanitizer per
// kind (strict allowlist, numbers clamped, strings cleaned; never a name,
// never a URL). The Worker keeps exactly this shape on the screen's record;
// /settings words it under the row (settings/screens.jsx).
//   journey    {lessons}  how saving every lesson's full-quality video onto
//              the kiosk is going (journey/src/schedule/26-lesson-downloads.js
//              journeyDownloadStatus(), trimmed by journey/public/src/sync.js)
//   computer   {app}      the KVBC Awana app's version and its update
//              (printer/electron-app/src/update-progress.js appReport)
//   lobby,     {page}     the page's own build (its awana-build meta, 7 hex)
//   projector

/** The longest error line kept (characters). */
export const SCREEN_STATUS_ERROR_MAX = 120;
/** The longest app version kept (characters). */
export const SCREEN_STATUS_VERSION_MAX = 40;
/** What a computer's app update can be doing. */
export const APP_UPDATE_STATES = Object.freeze(/** @type {const} */ (['none', 'downloading', 'ready', 'error']));
const STATUS_COUNT_MAX = 999;
const STATUS_BYTES_MAX = 1e13; // 10 TB: far past any kiosk's disk
const STATUS_WEEK_MAX = 99;
const BUILD_RE = /^[0-9a-f]{7,64}$/;

/**
 * `known` false: the kiosk has not read its disk yet (a few minutes after
 * load); `supported` false: this browser cannot save lessons at all. Both are
 * true for a kiosk page older than them (it only reported once it knew).
 * `leaders`: whether its "Include Leader Videos" is ticked (missing = true,
 * the kiosk's own default).
 * @typedef {{ saved: number, total: number, bytesSaved: number, bytesTotal: number,
 *   downloading: boolean, waiting: boolean, paused: boolean, percent: number,
 *   currentWeek: number | null, lastSavedAt: string | null, error: string | null, auto: boolean,
 *   leaders: boolean, known: boolean, supported: boolean }} LessonsStatus
 * @typedef {{ version: string, update: { state: 'none' | 'downloading' | 'ready' | 'error', percent: number | null, at: string | null } }} AppStatus
 * @typedef {{ build: string | null }} PageStatus
 * @typedef {{ lessons: LessonsStatus } | { app: AppStatus } | { page: PageStatus }} ScreenStatus
 */

/** @param {unknown} v @param {number} max */
const clampInt = (v, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : 0);

/** @param {unknown} v @returns {v is Record<string, any>} */
const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** One line of plain words, at most `max` characters; null when nothing is left. @param {unknown} raw @param {number} [max] */
function cleanStatusText(raw, max = SCREEN_STATUS_ERROR_MAX) {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const flat = raw.slice(0, 1000).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  const out = [...flat].slice(0, max).join('').trim();
  return out || null;
}

/** An ISO time, normalized, or null. @param {unknown} raw */
function cleanStatusTime(raw) {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null;
}

/** @param {unknown} l @returns {LessonsStatus | null} */
function cleanLessons(l) {
  if (!isPlainObject(l)) return null;
  if (typeof l.total !== 'number' || typeof l.saved !== 'number') return null;
  const total = clampInt(l.total, STATUS_COUNT_MAX);
  const bytesTotal = clampInt(l.bytesTotal, STATUS_BYTES_MAX);
  const week = clampInt(l.currentWeek, STATUS_WEEK_MAX);
  return {
    saved: Math.min(total, clampInt(l.saved, STATUS_COUNT_MAX)),
    total,
    bytesSaved: Math.min(bytesTotal, clampInt(l.bytesSaved, STATUS_BYTES_MAX)),
    bytesTotal,
    downloading: l.downloading === true,
    waiting: l.waiting === true,
    paused: l.paused === true,
    percent: clampInt(l.percent, 100),
    currentWeek: week >= 1 ? week : null,
    lastSavedAt: cleanStatusTime(l.lastSavedAt),
    error: cleanStatusText(l.error),
    auto: l.auto === true,
    leaders: l.leaders !== false,
    known: l.known !== false,
    supported: l.supported !== false,
  };
}

/** @param {unknown} a @returns {AppStatus | null} */
function cleanApp(a) {
  if (!isPlainObject(a) || !isPlainObject(a.update)) return null;
  const version = cleanStatusText(a.version, SCREEN_STATUS_VERSION_MAX);
  const state = /** @type {readonly unknown[]} */ (APP_UPDATE_STATES).includes(a.update.state)
    ? /** @type {AppStatus['update']['state']} */ (a.update.state) : null;
  if (!version || !state) return null;
  return {
    version,
    update: { state, percent: state === 'downloading' ? clampInt(a.update.percent, 100) : null, at: cleanStatusTime(a.update.at) },
  };
}

/** @param {unknown} p @returns {PageStatus | null} */
function cleanPage(p) {
  if (!isPlainObject(p)) return null;
  if (p.build === null) return { build: null };
  const build = typeof p.build === 'string' ? p.build.trim().toLowerCase() : '';
  return BUILD_RE.test(build) ? { build: build.slice(0, 7) } : null;
}

/**
 * A screen's reported status, in its kind's one fixed shape, or null (junk,
 * or another kind's status: a lobby TV cannot report lessons). Every number
 * clamped, every switch a real boolean, every unknown key dropped.
 * @param {unknown} kind
 * @param {unknown} raw
 * @returns {ScreenStatus | null}
 */
export function sanitizeScreenStatus(kind, raw) {
  if (!isPlainObject(raw)) return null;
  if (kind === 'journey') {
    const lessons = cleanLessons(raw.lessons);
    return lessons ? { lessons } : null;
  }
  if (kind === 'computer') {
    const app = cleanApp(raw.app);
    return app ? { app } : null;
  }
  if (kind === 'lobby' || kind === 'projector') {
    const page = cleanPage(raw.page);
    return page ? { page } : null;
  }
  return null;
}

/**
 * Has a status moved enough to be worth a storage write before the next
 * once-a-minute one? (The free Durable Object allowance counts writes.) Both
 * sanitized for the same kind (or null).
 *   lessons  a lesson saved, the set changing, an error, pause, start, stop or
 *            wait, the automatic switch, the Leader Videos tick, knowing or
 *            not, or 10 points of progress
 *   app      a new version, the update's state, or 10 points of its download
 *   page     a new build
 * @param {ScreenStatus | null | undefined} a
 * @param {ScreenStatus | null | undefined} b
 */
export function screenStatusMoved(a, b) {
  if (!a || !b) return Boolean(a) !== Boolean(b);
  if ('lessons' in a && 'lessons' in b) {
    const x = a.lessons;
    const y = b.lessons;
    return x.saved !== y.saved || x.total !== y.total || x.error !== y.error || x.paused !== y.paused
      || x.downloading !== y.downloading || x.waiting !== y.waiting || x.auto !== y.auto
      || x.leaders !== y.leaders || x.known !== y.known || x.supported !== y.supported
      || Math.abs(x.percent - y.percent) >= 10;
  }
  if ('app' in a && 'app' in b) {
    const x = a.app;
    const y = b.app;
    return x.version !== y.version || x.update.state !== y.update.state
      || Math.abs((x.update.percent ?? 0) - (y.update.percent ?? 0)) >= 10;
  }
  if ('page' in a && 'page' in b) return a.page.build !== b.page.build;
  return true;
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

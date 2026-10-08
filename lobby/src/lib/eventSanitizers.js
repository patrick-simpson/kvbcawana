// @ts-check
// PRIVACY INVARIANT — DO NOT relax. One strict allowlist sanitizer per
// event type on the shared Pusher channel. Every incoming payload is
// reduced to exactly its allowlisted fields before anything else sees
// it: allergy info, contact info, last names, photos, and any future
// fields the check-in system might send must never reach the display.
//
// Each sanitizer returns null on garbage and never throws. Payload
// shapes are pinned by src/lib/__fixtures__/contract-vectors.json — a
// byte-identical mirror of the canonical copy in the printer repo
// (Print-TwoTimTwo-Labels/contract-vectors.json).
//
// The typedefs below ARE the display's data surface: if a field isn't
// named here, nothing downstream can see it.

/**
 * @typedef {Object} CheckinEvent
 * @property {string} firstName First name only — never a full name.
 * @property {string} club
 * @property {boolean} isBirthday
 * @property {boolean} isFirstTimer
 * @property {true} [welcomeBack] Returning kid's first night of the season (#9).
 * @property {true} [oneOff] A one-off name tag (printer 7.18.0): welcomed, never counted.
 * @property {number} [milestone] Season night-count on a label-milestone night (#10).
 * @property {string} [id] Producer uuid for live-vs-replay dedupe.
 * @property {number} [at] Epoch ms.
 */

/**
 * @typedef {Object} RecapEvent
 * @property {CheckinEvent[]} entries Deduplicatable entries only (id + at present).
 * @property {number} at Epoch ms.
 */

/**
 * @typedef {Object} TallyEvent
 * @property {Record<string, number>} counts Per-club whole counts.
 * @property {number} total
 * @property {number} at Epoch ms.
 * @property {string} [season] Printer's unified-theming broadcast (#18).
 * @property {true} [rehearsal] Present only while rehearsal mode is armed (#19).
 */

/**
 * @typedef {Object} BirthdayEntry
 * @property {string} firstName
 * @property {string} club
 * @property {number} month 1–12 — calendar month only, never a year.
 * @property {number} day 1–31
 */

/**
 * @typedef {Object} BirthdaysEvent
 * @property {BirthdayEntry[]} entries
 */

/**
 * @typedef {Object} OpsEvent
 * @property {'print-failure'|'canary'|'selector-fail'|'update-ok'} type
 * @property {number} at Epoch ms.
 * @property {string} [club]
 * @property {string} [version] Bare semver on 'update-ok' (#5) — the update health beacon.
 */

/**
 * @typedef {Object} CanaryEvent
 * @property {number} at Epoch ms.
 * @property {string} [nonce]
 */

/**
 * `tonight` (contract v3) — aggregate counters for the lobby ticker.
 * Structurally numbers-only: no field here can carry a name.
 * @typedef {Object} TonightEvent
 * @property {number} checkedIn
 * @property {number} booksCompleted
 * @property {number} awardsEarned
 * @property {number} friendsBrought
 * @property {number} at Epoch ms.
 */

/**
 * `points` (contract v3) — color-team points race. Keys are team names
 * ("Red", "Blue"), never child names.
 * @typedef {Object} PointsEvent
 * @property {Record<string, number>} groups
 * @property {number} at Epoch ms.
 * @property {string} [club]
 */

/**
 * `schedule` (contract v3) — next-meeting facts from the check-in
 * system's calendar feed. Bare calendar date only; no attendee data.
 * @typedef {Object} ScheduleEvent
 * @property {number} at Epoch ms.
 * @property {string} [nextMeetingDate] Strict YYYY-MM-DD.
 * @property {string} [title] Church-authored public meeting theme.
 * @property {boolean} [noClubThisWeek]
 */

/**
 * `notice` (contract v3) — a church-authored announcement mirrored to
 * the screens (e.g. "CLUB CANCELLED TONIGHT").
 *
 * PRIVACY NOTE: `message` is the ONLY free-text field on the channel. It
 * is copy written BY church staff FOR public display, so it is shown
 * verbatim by design — but it is bounded and forced to plain text here
 * so it can neither inject markup nor break a fixed-height banner. It is
 * never derived from roster data.
 * @typedef {Object} NoticeEvent
 * @property {'info'|'warn'|'critical'} level
 * @property {string} message
 * @property {number} at Epoch ms.
 */

import {
  MAX_DURATION_SEC,
  MAX_EYEBROW,
  MAX_SLIDES,
  MAX_TEXT,
  MIN_DURATION_SEC,
  SLIDE_THEMES,
  TEXT_SIZES,
  showDate,
} from './slides.js';

const NAME_MAX = 40;
const ID_MAX = 64;
const RECAP_MAX = 30;
const BIRTHDAYS_MAX = 40;
const CHECKOUT_MAX = 60;
const TALLY_CLUBS_MAX = 30;
const POINTS_GROUPS_MAX = 20;
const NOTICE_MAX = 200;
const TITLE_MAX = 60;

/** @type {ReadonlyArray<OpsEvent['type']>} */
const OPS_TYPES = ['print-failure', 'canary', 'selector-fail', 'update-ok'];
/** @type {ReadonlyArray<NoticeEvent['level']>} */
const NOTICE_LEVELS = ['info', 'warn', 'critical'];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {unknown} v
 * @param {number} max
 * @returns {string}
 */
function cleanString(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * Bounded plain text for the one free-text display field (`notice`):
 * strips anything markup-shaped and collapses whitespace/newlines.
 * @param {unknown} v
 * @param {number} max
 * @returns {string}
 */
function plainText(v, max) {
  if (typeof v !== 'string') return '';
  return v
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Whole non-negative count, or null when the value isn't a usable number
 * (so a name smuggled into a counter is refused, never coerced).
 * @param {unknown} v
 * @returns {number | null}
 */
function wholeCount(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
  return Math.floor(v);
}

// ISO string or epoch → epoch ms, or null when unparseable.
/**
 * @param {unknown} v
 * @returns {number | null}
 */
function toEpochMs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

/**
 * `checkin` v2 — the original four public fields plus optional `id`
 * (producer uuid, for live-vs-replay dedupe) and `at` (→ epoch ms).
 * Both stay optional so producer/consumer deploy order never matters.
 * @param {unknown} payload
 * @returns {CheckinEvent | null}
 */
export function sanitizeCheckin(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const raw = /** @type {Record<string, unknown>} */ (payload);
  const firstName = cleanString(raw.firstName, NAME_MAX);
  if (!firstName) return null;
  /** @type {CheckinEvent} */
  const safe = {
    firstName,
    club: cleanString(raw.club, NAME_MAX),
    isBirthday: raw.isBirthday === true,
    isFirstTimer: raw.isFirstTimer === true,
  };
  const id = cleanString(raw.id, ID_MAX);
  if (id) safe.id = id;
  const at = toEpochMs(raw.at);
  if (at !== null) safe.at = at;
  // Optional sealed celebration flags (printer v5.21+): a returning kid's
  // first night of the season (#9) and the label-milestone night count for
  // the milestone wall (#10). Same literal/int discipline as the producer.
  if (raw.welcomeBack === true) safe.welcomeBack = true;
  // A one-off name tag (a lost tag, a child not checking in tonight): the
  // welcome plays, the count never moves (printer 7.18.0). Literal true only.
  if (raw.oneOff === true) safe.oneOff = true;
  if (typeof raw.milestone === 'number' && Number.isInteger(raw.milestone)
      && raw.milestone > 0 && raw.milestone <= 999) {
    safe.milestone = raw.milestone;
  }
  return safe;
}

/**
 * `recap` — replay buffer of recent checkins. Entries without id + at
 * can't be deduped against live delivery, so they're dropped rather
 * than risk a double banner.
 * @param {unknown} payload
 * @returns {RecapEvent | null}
 */
export function sanitizeRecap(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const raw = /** @type {Record<string, unknown>} */ (payload);
  if (!Array.isArray(raw.entries)) return null;
  /** @type {CheckinEvent[]} */
  const entries = [];
  for (const item of raw.entries.slice(0, RECAP_MAX)) {
    const safe = sanitizeCheckin(item);
    if (!safe || !safe.id || safe.at === undefined) continue;
    entries.push(safe);
  }
  const at = toEpochMs(raw.at);
  return { entries, at: at !== null ? at : Date.now() };
}

/**
 * @typedef {object} CheckoutEntry
 * @property {string} firstName
 * @property {string} club
 */

/**
 * @typedef {object} CheckoutEvent
 * @property {CheckoutEntry[]} entries Children still in the building.
 * @property {number} at Epoch ms.
 * @property {number} [printed] Labels this print server printed tonight.
 */

/**
 * `checkout` (contract v4) — who is still in the building.
 *
 * FIRST NAME AND CLUB ONLY, like every other name-bearing event. The producer's
 * row on TwoTimTwo's checkout page also holds the child's full name, guardian
 * names, an authorized-pickup name and a pickup security code; none of that is
 * on the allowlist, so none of it can reach the screen even if a future scraper
 * regression started sending it.
 *
 * Two consumer obligations that this sanitizer CANNOT enforce, and which the
 * rendering component must honour instead:
 *
 *  1. It is not a verified headcount. It reflects whether volunteers PERFORMED
 *     checkout, which during a pickup rush they often do not, so it can be
 *     freshly and confidently wrong. `printed` travels with it so the UI can say
 *     "labels printed tonight: 43" rather than implying the list is complete.
 *  2. Once the list is short it identifies which children are still UNATTENDED —
 *     and `checkin` has already published their names. So the board must be off
 *     by default, and must stop naming individuals below an operator threshold.
 *
 * @param {unknown} payload
 * @returns {CheckoutEvent|null}
 */
export function sanitizeCheckout(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const raw = /** @type {Record<string, unknown>} */ (payload);
  // A MISSING array is not an empty board. "I could not read the page" and
  // "everyone has been picked up" are opposite facts, and collapsing them would
  // tell a lobby the building was clear.
  if (!Array.isArray(raw.entries)) return null;
  const at = toEpochMs(raw.at);
  if (at === null) return null;   // required: the board must be ageable

  /** @type {CheckoutEntry[]} */
  const entries = [];
  for (const item of raw.entries.slice(0, CHECKOUT_MAX)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const e = /** @type {Record<string, unknown>} */ (item);
    const firstName = cleanString(e.firstName, NAME_MAX);
    if (!firstName) continue;
    entries.push({ firstName, club: cleanString(e.club, NAME_MAX) });
  }

  /** @type {CheckoutEvent} */
  const out = { entries, at };
  const printed = Number(raw.printed);
  if (Number.isFinite(printed) && printed >= 0) out.printed = Math.floor(printed);
  return out;
}

/**
 * `tally` — per-club counts. Numbers only: any non-numeric value (a
 * name smuggled into a count) is dropped, never passed through.
 * @param {unknown} payload
 * @returns {TallyEvent | null}
 */
export function sanitizeTally(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const obj = /** @type {Record<string, unknown>} */ (payload);
  const raw = obj.counts;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const at = toEpochMs(obj.at);
  if (at === null) return null;
  /** @type {Record<string, number>} */
  const counts = {};
  for (const [club, n] of Object.entries(raw).slice(0, TALLY_CLUBS_MAX)) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) continue;
    const key = cleanString(club, NAME_MAX);
    if (!key) continue;
    counts[key] = Math.floor(n);
  }
  const total = typeof obj.total === 'number' && Number.isFinite(obj.total) && obj.total >= 0
    ? Math.floor(obj.total)
    : Object.values(counts).reduce((a, b) => a + b, 0);
  /** @type {TallyEvent} */
  const out = { counts, total, at };
  // Optional contract extras (printer v5.20+): the unified-theming season
  // broadcast (#18) and the rehearsal watermark flag (#19). Same validation
  // the producer applies — a non-slug season or truthy-junk rehearsal is
  // dropped, never a reason to reject the tally.
  if (typeof obj.season === 'string' && /^[a-z][a-z-]{1,19}$/.test(obj.season)) {
    out.season = obj.season;
  }
  if (obj.rehearsal === true) out.rehearsal = true;
  return out;
}

/**
 * `birthdays` — this week's birthday kids: first name, club, and the
 * birthday's calendar month/day only. No years, no last names, ever.
 * @param {unknown} payload
 * @returns {BirthdaysEvent | null}
 */
export function sanitizeBirthdays(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const raw = /** @type {Record<string, unknown>} */ (payload);
  if (!Array.isArray(raw.entries)) return null;
  /** @type {BirthdayEntry[]} */
  const entries = [];
  for (const item of raw.entries.slice(0, BIRTHDAYS_MAX)) {
    if (!item || typeof item !== 'object') continue;
    const entry = /** @type {Record<string, unknown>} */ (item);
    const firstName = cleanString(entry.firstName, NAME_MAX);
    if (!firstName) continue;
    const month = typeof entry.month === 'number' ? Math.floor(entry.month) : NaN;
    const day = typeof entry.day === 'number' ? Math.floor(entry.day) : NaN;
    if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) continue;
    entries.push({ firstName, club: cleanString(entry.club, NAME_MAX), month, day });
  }
  return { entries };
}

/**
 * `ops` — operator telemetry. type/club/at only; anything else (and any
 * unknown type) is refused. These surface on status widgets, NEVER as a
 * public banner.
 * @param {unknown} payload
 * @returns {OpsEvent | null}
 */
export function sanitizeOps(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const raw = /** @type {Record<string, unknown>} */ (payload);
  const type = OPS_TYPES.find((t) => t === raw.type);
  if (!type) return null;
  /** @type {OpsEvent} */
  const safe = { type, at: toEpochMs(raw.at) ?? Date.now() };
  const club = cleanString(raw.club, NAME_MAX);
  if (club) safe.club = club;
  // Update health beacon (#5): 'update-ok' may carry the updated server's
  // version — a bare semver only, same validation the producer applies.
  // Displays don't render this event, but the sanitizer must pass it so
  // the ops log/debug panel can show it faithfully.
  if (typeof raw.version === 'string' && /^\d+\.\d+\.\d+$/.test(raw.version)) {
    safe.version = raw.version;
  }
  return safe;
}

/**
 * `canary` — end-to-end pipe test.
 * @param {unknown} payload
 * @returns {CanaryEvent | null}
 */
export function sanitizeCanary(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const raw = /** @type {Record<string, unknown>} */ (payload);
  const at = toEpochMs(raw.at);
  if (at === null) return null;
  /** @type {CanaryEvent} */
  const safe = { at };
  const nonce = cleanString(raw.nonce, ID_MAX);
  if (nonce) safe.nonce = nonce;
  return safe;
}

/**
 * `tonight` — aggregate counters for the lobby ticker. Every field is a
 * whole count; a non-numeric counter is refused rather than coerced, and
 * no other key (e.g. a list of kids) can survive the rebuild.
 * @param {unknown} payload
 * @returns {TonightEvent | null}
 */
export function sanitizeTonight(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const raw = /** @type {Record<string, unknown>} */ (payload);
  const at = toEpochMs(raw.at);
  if (at === null) return null;
  return {
    checkedIn: wholeCount(raw.checkedIn) ?? 0,
    booksCompleted: wholeCount(raw.booksCompleted) ?? 0,
    awardsEarned: wholeCount(raw.awardsEarned) ?? 0,
    friendsBrought: wholeCount(raw.friendsBrought) ?? 0,
    at,
  };
}

/**
 * `points` — color-team points race. Numbers only: a name smuggled in as
 * a point value is dropped, exactly like `tally`.
 * @param {unknown} payload
 * @returns {PointsEvent | null}
 */
export function sanitizePoints(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const obj = /** @type {Record<string, unknown>} */ (payload);
  const raw = obj.groups;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const at = toEpochMs(obj.at);
  if (at === null) return null;
  /** @type {Record<string, number>} */
  const groups = {};
  for (const [group, n] of Object.entries(raw).slice(0, POINTS_GROUPS_MAX)) {
    const value = wholeCount(n);
    if (value === null) continue;
    const key = cleanString(group, NAME_MAX);
    if (!key) continue;
    groups[key] = value;
  }
  /** @type {PointsEvent} */
  const safe = { groups, at };
  const club = cleanString(obj.club, NAME_MAX);
  if (club) safe.club = club;
  return safe;
}

/**
 * `schedule` — next-meeting facts. The date must be a strict calendar
 * date or it is dropped (never rendered as free text), and nothing else
 * from an iCal feed (attendees, organizer, location) can survive.
 * @param {unknown} payload
 * @returns {ScheduleEvent | null}
 */
export function sanitizeSchedule(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const raw = /** @type {Record<string, unknown>} */ (payload);
  const at = toEpochMs(raw.at);
  if (at === null) return null;
  /** @type {ScheduleEvent} */
  const safe = { at };
  const date = cleanString(raw.nextMeetingDate, 10);
  if (ISO_DATE_RE.test(date)) safe.nextMeetingDate = date;
  const title = plainText(raw.title, TITLE_MAX);
  if (title) safe.title = title;
  if (typeof raw.noClubThisWeek === 'boolean') safe.noClubThisWeek = raw.noClubThisWeek;
  return safe;
}

/**
 * One text slide inside a `slides` chunk — the caps come straight from
 * src/lib/slides.js so the wire contract and the local editor can never
 * disagree about what a slide is.
 * @typedef {Object} SlidesChunkEntry
 * @property {string} [id]
 * @property {string} eyebrow
 * @property {string} text
 * @property {string} theme
 * @property {string} textSize
 * @property {number} durationSec
 * @property {string} [showFrom] Optional bare local date, YYYY-MM-DD.
 * @property {string} [showUntil] Optional bare local date, YYYY-MM-DD.
 * @property {true} [holdCheckIns] Hold check-in banners while this slide is up (literal true only).
 */

/**
 * `slides` (contract v5) — one sealed chunk of the operator's published slide
 * deck. TEXT ONLY: a `type: 'video'` (or any typed) entry references bytes in
 * one device's own storage, so it is dropped here no matter what the producer
 * sent. `publishedAt` is the consumer's ordering + anti-replay authority and
 * is therefore required; `deckRev` is an operator-facing counter used only to
 * group chunks. slides:[] is legal only on a single-chunk publish — an
 * explicitly cleared deck propagates, a multi-chunk deck has no empty pieces.
 * An entry may carry an optional showFrom/showUntil window (#345): bare local
 * calendar dates, kept verbatim and validated with the SAME showDate() the
 * local editor uses, so a published deck and a typed one can never disagree
 * about what a date is. Filtering happens at render time against the screen's
 * own local date key — never toISOString() — see slides.js visibleSlides().
 * @typedef {Object} SlidesChunkEvent
 * @property {number} deckRev int ≥ 1
 * @property {number} publishedAt Epoch ms.
 * @property {number} seq 0 ≤ seq < total
 * @property {number} total 1..12
 * @property {SlidesChunkEntry[]} slides
 */

const SLIDES_TOTAL_MAX = 12;

/**
 * @param {unknown} payload
 * @returns {SlidesChunkEvent | null}
 */
export function sanitizeSlidesChunk(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const raw = /** @type {Record<string, unknown>} */ (payload);
  const publishedAt = toEpochMs(raw.publishedAt);
  if (publishedAt === null) return null;
  const deckRev = typeof raw.deckRev === 'number' && Number.isFinite(raw.deckRev)
    ? Math.floor(raw.deckRev)
    : NaN;
  if (!(deckRev >= 1)) return null;
  const seq = typeof raw.seq === 'number' && Number.isInteger(raw.seq) ? raw.seq : NaN;
  const total = typeof raw.total === 'number' && Number.isInteger(raw.total) ? raw.total : NaN;
  if (!(total >= 1 && total <= SLIDES_TOTAL_MAX)) return null;
  if (!(seq >= 0 && seq < total)) return null;
  if (!Array.isArray(raw.slides)) return null;
  if (raw.slides.length === 0 && total !== 1) return null;

  /** @type {SlidesChunkEntry[]} */
  const slides = [];
  for (const item of raw.slides.slice(0, MAX_SLIDES)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const entry = /** @type {Record<string, unknown>} */ (item);
    // TEXT ONLY — any typed entry (video today, whatever tomorrow) is dropped.
    if (entry.type !== undefined) continue;
    const text = typeof entry.text === 'string' ? entry.text.trim().slice(0, MAX_TEXT) : '';
    if (!text) continue;
    /** @type {SlidesChunkEntry} */
    const safe = {
      eyebrow: cleanString(entry.eyebrow, MAX_EYEBROW),
      text,
      theme: typeof entry.theme === 'string' && SLIDE_THEMES.includes(entry.theme) ? entry.theme : 'auto',
      textSize: typeof entry.textSize === 'string' && TEXT_SIZES.includes(entry.textSize) ? entry.textSize : 'auto',
      durationSec: 0,
    };
    if (typeof entry.durationSec === 'number' && Number.isFinite(entry.durationSec) && entry.durationSec > 0) {
      safe.durationSec = Math.min(MAX_DURATION_SEC, Math.max(MIN_DURATION_SEC, Math.round(entry.durationSec)));
    }
    // The optional show window. Dropped when it is not a real calendar date:
    // a slide with a junk window shows ALWAYS, never never.
    const showFrom = showDate(entry.showFrom);
    if (showFrom) safe.showFrom = showFrom;
    const showUntil = showDate(entry.showUntil);
    if (showUntil) safe.showUntil = showUntil;
    // "Hold check-ins while this slide is up" (contract: entryOptionalFields).
    // Literal true only; anything else is dropped, never coerced, never false.
    if (entry.holdCheckIns === true) safe.holdCheckIns = true;
    const id = cleanString(entry.id, ID_MAX);
    if (id) safe.id = id;
    slides.push(safe);
  }
  return { deckRev, publishedAt, seq, total, slides };
}

/**
 * `notice` — church-authored public announcement. An unknown level falls
 * back to 'info' rather than being trusted, and an empty message is
 * refused so a blank notice can never blank the screen.
 * @param {unknown} payload
 * @returns {NoticeEvent | null}
 */
export function sanitizeNotice(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const raw = /** @type {Record<string, unknown>} */ (payload);
  const at = toEpochMs(raw.at);
  if (at === null) return null;
  const message = plainText(raw.message, NOTICE_MAX);
  if (!message) return null;
  const level = NOTICE_LEVELS.find((l) => l === raw.level) || 'info';
  return { level, message, at };
}

/**
 * `settings` (contract v6): the lobby screens' shared settings, one sealed
 * frame. Reduced to {rev, publishedAt, settings} with ONLY the shared keys,
 * every value checked against its rule (src/lib/sharedSettings.js, pinned to
 * the contract's `events.settings.keys`). Per-screen keys can never arrive
 * this way, and no name can either: none of the keys holds one.
 */
export { sanitizeSettingsPayload as sanitizeSettings } from './sharedSettings.js';

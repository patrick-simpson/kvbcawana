// @ts-check
// The words and sizes of one check-in moment, as pure functions, so the
// component (src/components/CheckInMoment.jsx) is only choreography.
//
// One moment for every kind of arrival, the catalog's club opener page
// played live: the child's club wave rises and carries the name. What
// changes between a birthday, a first-timer, a returning kid and a plain
// welcome is the kicker above the name, one line below it, and the hot
// sticker. The club colour never changes: the colour is the child's club.

import { inkOverflow } from './brand.js';

/** @typedef {'birthday' | 'first' | 'back' | 'welcome'} Moment */

/**
 * Priority: birthday > first-timer > welcome-back > welcome, the same order
 * the old per-kind banners used (a rostered birthday child can never also be
 * a first-timer, and the printer never sets both first-timer and
 * welcome-back).
 * @param {{ isBirthday?: boolean, isFirstTimer?: boolean, welcomeBack?: boolean }} event
 * @returns {Moment}
 */
export function momentFor(event) {
  if (event.isBirthday) return 'birthday';
  if (event.isFirstTimer) return 'first';
  if (event.welcomeBack) return 'back';
  return 'welcome';
}

const KICKERS = {
  birthday: 'Happy birthday',
  first: 'Welcome to Awana Clubs',
  back: 'Welcome back',
  welcome: 'Welcome',
};

/**
 * The small label-voice line above the name. A recap replayed after a
 * reconnect is not an arrival happening now, so it says so.
 * @param {{ presentation?: string }} event
 * @param {Moment} moment
 */
export function kickerFor(event, moment) {
  if (event.presentation === 'replay') return 'Also joined us tonight';
  return KICKERS[moment];
}

const TAGLINES = {
  birthday: 'Hip hip hooray — it’s your special day!',
  first: 'We’re so glad you’re here for the very first time!',
  back: 'Welcome back for a brand-new season!',
};

/**
 * The one line under the name, or null.
 *
 * `ribbon` is the birthday-week label from src/lib/birthdayWeek.js ("Birthday
 * this Friday!"). The printer's isBirthday flag covers the whole ISO week, so
 * on a birthday moment the ribbon REPLACES the day-claiming tagline: "it's
 * your special day" is simply wrong on Wednesday for a Friday birthday. On a
 * plain welcome it rides along with the club's phrase, if there is one.
 *
 * @param {Moment} moment
 * @param {{ ribbon?: string | null, phrase?: string | null }} extras
 * @returns {string | null}
 */
export function sublineFor(moment, { ribbon = null, phrase = null } = {}) {
  if (moment === 'birthday') return ribbon || TAGLINES.birthday;
  if (moment === 'first' || moment === 'back') return TAGLINES[moment];
  const parts = [ribbon, phrase].filter((p) => typeof p === 'string' && p.trim() !== '');
  return parts.length ? parts.join(' · ') : null;
}

/**
 * The hot sticker's lines, or null. Birthdays and first-timers only: the
 * catalog uses its one hot sticker for what is new or special, and a
 * sticker on every arrival would stop meaning anything.
 * @param {Moment} moment
 * @returns {string[] | null}
 */
export function stickerFor(moment) {
  if (moment === 'birthday') return ['Happy', 'birthday!'];
  if (moment === 'first') return ['New!'];
  return null;
}

/* ── The name's size ─────────────────────────────────────────────── */

// All in u, the moment's unit: 1u is 1% of a 16:9 stage's width (the CSS
// sets --u: min(1vw, 1.7778vh)). The name column runs from 24.6u to 3u shy
// of the right edge (.checkin__copy's left and right, which a test pins);
// NAME_ROOM leaves a little air for the hard shadow.
export const COPY_LEFT_U = 24.6;
export const COPY_RIGHT_U = 3;
export const NAME_ROOM_U = 71;
// The catalog's own steps: short names shout biggest. Sized to hold the
// approved mockup's cap heights (it was drawn in Galindo at 10u / 8.6u /
// 7.2u, whose caps stand 5.7% taller than Paytone One's at the same size),
// so each step is the mockup's times 1.057. BARTHOLOMEW (11 letters) takes
// the long step and runs 60u of the 71u column.
export const NAME_STEPS = [[6, 10.6], [9, 9.1], [Infinity, 7.6]];
export const NAME_MIN_U = 3.4;
// The name's line box: the mockup's line-height 1 at Galindo's size, held
// in u at the new sizes (1 / 1.057), so the kicker and the line under the
// name keep their places.
export const NAME_LINE_HEIGHT = 0.95;

/**
 * The name's room in u, for a stage `stageU` wide (100 on a 16:9 or squarer
 * screen) whose column must also end `clearU` in from the right edge: the
 * host's bottom-right control when this page is embedded (src/lib/embed.js;
 * app.css moves .checkin__copy's right edge by the same amount). The air
 * NAME_ROOM_U leaves for the shadow is kept. Standalone (`clearU` 0) it is
 * NAME_ROOM_U exactly, on any screen.
 * @param {number} stageU
 * @param {number} clearU
 */
export function nameRoomU(stageU, clearU) {
  const air = 100 - COPY_LEFT_U - COPY_RIGHT_U - NAME_ROOM_U;
  const column = stageU - COPY_LEFT_U - Math.max(COPY_RIGHT_U, clearU);
  return Math.min(NAME_ROOM_U, column - air);
}

/**
 * The name's font size in u: the catalog step for its length, shrunk just
 * enough to fit the column on one line, never below NAME_MIN_U. Measured, so
 * a wide name ("WILLIAM") shrinks where a narrow one of the same length
 * ("JILLIAN") does not, and a name never breaks between letters.
 *
 * `wraps` is true only when even the smallest size cannot hold the name on
 * one line AND it has a space to break at: then it may wrap between words
 * (never inside one).
 *
 * @param {string} name       as displayed (upper-cased)
 * @param {(text: string) => number} measure  advance width at 1em
 * @param {number} [room]     the column's room in u (nameRoomU); NAME_ROOM_U
 *                            unless the page is embedded
 * @returns {{ size: number, wraps: boolean }}
 */
export function nameSizeU(name, measure, room = NAME_ROOM_U) {
  const text = String(name ?? '');
  const len = [...text].length;
  const step = NAME_STEPS.find(([max]) => len <= max)?.[1] ?? 7.6;
  const em = measure(text);
  const fit = em > 0 ? room / em : step;
  const size = Math.max(NAME_MIN_U, Math.min(step, fit));
  return { size: Math.round(size * 100) / 100, wraps: fit < NAME_MIN_U && /\s/.test(text.trim()) };
}

// The kicker over the name (.checkin__kicker in app.css: Londrina Solid at
// 2.5u, tracked 0.07em, 0.9u above the name's box; a test pins the three).
// Londrina's caps sit 0.1465em above the bottom of its line box, so a mark on
// the name may rise that far past the margin, and no closer than
// NAME_MARK_CLEAR_U to the kicker's letters.
export const KICKER_U = 2.5;
export const KICKER_TRACKING = 0.07;
export const KICKER_MARGIN_U = 0.9;
const KICKER_FOOT = 0.1465;
export const NAME_MARK_CLEAR_U = 0.3;
// The name's hard shadow (.checkin__name's text-shadow offset), which hangs
// below a mark as it does below the letters.
export const NAME_SHADOW_U = 0.45;

/**
 * The letters of `name` that sit under the kicker: those that start within
 * `kickerU` (the kicker's width, in u) plus the clear space, set at `sizeU`.
 * Only a mark on one of them can meet the kicker's letters.
 * @param {string} name   as displayed
 * @param {number} kickerU
 * @param {number} sizeU
 * @param {(text: string) => number} measure  advance width at 1em
 */
export function nameUnderKicker(name, kickerU, sizeU, measure) {
  const letters = [...String(name ?? '').normalize('NFC')];
  let under = '';
  for (const ch of letters) {
    if (measure(under) * sizeU > kickerU + NAME_MARK_CLEAR_U) break;
    under += ch;
  }
  return under;
}

/**
 * The name's line box, in em: its line height, and the padding a tall mark
 * needs to stay clear of its neighbours. Paytone One draws the marks over and
 * under its capitals tall (JOSÉ's accent reaches 1.045em, NGUYỄN's 1.161em,
 * ȘTEFAN's comma -0.351em, against a plain name's box from 0.737em to
 * -0.213em). Above the name is the kicker: a mark on a letter under it
 * (`under`, from nameUnderKicker) may rise into the kicker's margin and the
 * empty foot of its line, and the name drops the kicker just far enough
 * beyond that to keep NAME_MARK_CLEAR_U off its letters (a mark past the
 * kicker's end has open wave above it and needs nothing). Below is the line
 * under the name, when there is one (`line`): a hanging mark and its shadow
 * get room above it; with no line, the mark hangs into the margin over the
 * screen's edge, where nothing is. A name that wraps also opens its rows
 * until one row's marks clear the next.
 * @param {{ under: { ascent: number, descent: number }, whole: { ascent: number, descent: number } }} ink
 *   in em (inkEm): of the letters under the kicker, and of the whole name
 * @param {{ sizeU: number, line?: boolean, wraps?: boolean }} at
 * @returns {{ lineHeight: number, padTop: number, padBottom: number }}
 */
export function nameBox({ under, whole }, { sizeU, line = false, wraps = false }) {
  const lineHeight = wraps
    ? Math.max(NAME_LINE_HEIGHT, Math.ceil((whole.ascent + whole.descent + 0.1) * 100) / 100)
    : NAME_LINE_HEIGHT;
  const room = (KICKER_MARGIN_U + KICKER_FOOT * KICKER_U - NAME_MARK_CLEAR_U) / sizeU;
  const top = Math.max(0, inkOverflow(wraps ? whole : under, lineHeight).top - room);
  const shadow = NAME_SHADOW_U / sizeU;
  const bottom = line ? inkOverflow({ ascent: 0, descent: whole.descent + shadow }, lineHeight).bottom : 0;
  /** @param {number} n */
  const up = (n) => (n > 0 ? Math.ceil(n * 1000 - 1e-6) / 1000 : 0);
  return { lineHeight, padTop: up(top), padBottom: up(bottom) };
}

/**
 * Per-letter animation costs a spring per glyph; past this many letters the
 * name animates per word instead, which reads the same from across a lobby.
 */
export const PER_LETTER_MAX = 14;

/* ── How a run arrives ───────────────────────────────────────────── */

/**
 * The club-colour front wave rises this long (seconds) after the deep one at
 * the start of a run, over the brand's wipe. CheckInMoment.jsx reads it, and
 * so does the "UP NEXT" chip that rides that wave (UpNextChip.jsx), so the
 * chip can never land before the wave it sits on.
 */
export const FRONT_WAVE_DELAY = 0.07;

/* ── How long a run takes to leave ───────────────────────────────── */

// The waves drop last when a run ends (seconds): the front wave, then the
// deep one behind it. CheckInMoment.jsx reads these, so the two can't drift.
export const WAVE_EXIT = {
  front: { delay: 0.12, duration: 0.48 },
  back: { delay: 0.19, duration: 0.48 },
};

/**
 * The whole run's exit, in ms, rounded up with a frame to spare. The queue
 * never starts the next run's hold before this has passed: the Overlay only
 * mounts a new run once the old one has fully left (AnimatePresence
 * mode="wait"), so a shorter gap would spend the next child's time on screen
 * on the previous child's exit.
 */
export const RUN_EXIT_MS = Math.ceil(
  Math.max(...Object.values(WAVE_EXIT).map((w) => (w.delay + w.duration) * 1000)) + 30,
);

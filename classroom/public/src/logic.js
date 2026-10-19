// The downstairs classroom's rules, pure (no DOM, no clock of its own), so
// the tests can ask them anything (classroom/test/logic.test.mjs).
//
// Club nights only (shared/clubNight.js, asked by app.js), by the church's
// wall clock (owner 2026-10-16/17). The VIEWS, end to end:
//   6:30  the Cubbies card        (welcomes Cubbies)
//   7:00  Sparks "Large Group Time" (welcomes Sparks)
//   7:30  the lobby screen, Sparks only (it welcomes Sparks itself)
//   8:00  off
// and around every hand-off a pure black gap of TRANSITION_GAP_MIN minutes
// each side (shared/transitionGap.js, the ONE number for every screen), whose
// welcomes are both neighbours' clubs. With the gap at 2: 6:30-6:58 Cubbies,
// 6:58-7:02 black, 7:02-7:28 Sparks, 7:28-7:32 black, 7:32-8:00 lobby.
// Nothing here spells a gap edge: PERIODS is derived.

import {
  TRANSITION_GAP_MIN, gapAround, periodAt, periodsFor,
  WELCOME_MS, WELCOME_NAMES_MAX, clubIdOf, welcomeWords, emptyWelcomes, welcomeFor, welcomesUp,
} from './shared/transitionGap.js';

// The gap welcomes' rules are the shared module's (Journey's kiosk uses the same).
export { TRANSITION_GAP_MIN, WELCOME_MS, WELCOME_NAMES_MAX, clubIdOf, welcomeWords, emptyWelcomes, welcomeFor, welcomesUp };
export const CUBBIES_AT = 18 * 60 + 30;
export const SPARKS_AT = 19 * 60;
export const LOBBY_AT = 19 * 60 + 30;
export const CLOSE_AT = 20 * 60;

/** The night's views, as data (a gap's clubs come from its neighbours). */
export const VIEWS = Object.freeze([
  { view: 'cubbies', from: CUBBIES_AT, until: SPARKS_AT, clubs: ['cubbies'] },
  { view: 'sparks', from: SPARKS_AT, until: LOBBY_AT, clubs: ['sparks'] },
  // The lobby welcomes its own club (lobby ?club=sparks); this page adds nothing there.
  { view: 'lobby', from: LOBBY_AT, until: CLOSE_AT, clubs: [] },
]);
export const PERIODS = Object.freeze(periodsFor(VIEWS.map((v) => ({ ...v, clubs: [...v.clubs] }))));

/** The honey drip (easter egg): done 30 s before the Cubbies card fades into the gap. */
export const HONEY_MS = 150 * 1000;
export const HONEY_AT_S = gapAround(SPARKS_AT).from * 60 - HONEY_MS / 1000 - 30;

/** @typedef {'off' | 'cubbies' | 'black' | 'sparks' | 'lobby'} Phase */

/**
 * The period at `minutes` on a club night, or null (off).
 * @param {number} minutes  minute of the church's day
 * @param {boolean} clubNight
 */
export function periodNow(minutes, clubNight) {
  return clubNight ? periodAt(PERIODS, minutes) : null;
}

/**
 * @param {number} minutes  minute of the church's day
 * @param {boolean} clubNight
 * @returns {Phase}
 */
export function phaseAt(minutes, clubNight) {
  const p = periodNow(minutes, clubNight);
  return p ? /** @type {Phase} */ (p.view) : 'off';
}

/** The clubs welcomed at `minutes` (a card's club; both neighbours in a gap). */
export function welcomeClubsAt(minutes, clubNight) {
  const p = periodNow(minutes, clubNight);
  return p ? p.clubs : [];
}

/** The club whose card (and count chip) is up, or null. @param {Phase} phase */
export function cardClub(phase) {
  return phase === 'cubbies' || phase === 'sparks' ? phase : null;
}

/**
 * How far the honey has run, 0..1, or null when it is not running.
 * @param {number} seconds  second of the church's day
 */
export function honeyProgress(seconds) {
  const t = (seconds - HONEY_AT_S) * 1000;
  if (!(t >= 0) || t >= HONEY_MS) return null;
  return t / HONEY_MS;
}

/** The bear peek (easter egg): once a night, some time in 6:33-6:50. */
export const BEAR_FROM = 18 * 60 + 33;
export const BEAR_UNTIL = 18 * 60 + 50;
export const BEAR_MS = 6000;

export const CLUB_COUNTS_KEY = 'awanaClubCounts.v1';
const COUNT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const COUNT_SKEW_MS = 60 * 60 * 1000;

/**
 * The night's bear minute, from the date alone (the same on a reload, a
 * different moment every week). @param {string} dateKey YYYY-MM-DD
 */
export function bearMinute(dateKey) {
  let h = 2166136261;
  for (const c of String(dateKey)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const span = BEAR_UNTIL - BEAR_FROM;
  return BEAR_FROM + ((h >>> 0) % span);
}

/**
 * Tonight's count for one club id from the embedded lobby's stored entry
 * (lobby/src/lib/clubCountsStore.js: {v:1, at, byClub}), or null. The same
 * reading as Journey's chip (journey/src/schedule/25-trek.js clubCountFrom).
 * @param {unknown} raw  the localStorage string
 * @param {number} nowMs
 * @param {string} club
 */
export function clubCountFrom(raw, nowMs, club) {
  if (typeof raw !== 'string') return null;
  let entry;
  try { entry = JSON.parse(raw); } catch { return null; }
  if (!entry || entry.v !== 1 || typeof entry.at !== 'number' || !Number.isFinite(entry.at)) return null;
  const age = nowMs - entry.at;
  if (age > COUNT_MAX_AGE_MS || age < -COUNT_SKEW_MS) return null;
  if (new Date(entry.at).toDateString() !== new Date(nowMs).toDateString()) return null;
  const n = entry.byClub && entry.byClub[club];
  return Number.isInteger(n) && n >= 0 && n <= 999 ? n : null;
}

// The kit's stepped chip, ported from shared/chipGeometry.js (which imports
// tokens.json, which a plain page cannot import): the same numbers and the
// same path, without the marks seat (a count is plain figures).
// test/logic.test.mjs pins it against the shared module's own output.
export const CHIP = {
  valueSize: 1.06, labelSize: 0.59, pillHeight: 1.15, pillPad: 0.42, pillMin: 2.2,
  blockLeft: 0.84, blockTop: 1.05, blockHeight: 1.38, blockPad: 0.5, step: 0.5,
  radiusBR: 0.39, radiusBL: 0.27,
};

/**
 * @param {number} labelEm  label advance width at 1em
 * @param {number} valueEm  value advance width at 1em
 */
export function chipGeometry(labelEm, valueEm) {
  const y = CHIP.blockTop + CHIP.blockHeight / 2 + 0.03;
  const lw = Math.max(0, labelEm) * CHIP.labelSize;
  const vw = Math.max(0, valueEm) * CHIP.valueSize;
  const H1 = CHIP.pillHeight;
  const r1 = H1 / 2;
  const W1 = Math.max(lw + CHIP.pillPad * 2, CHIP.pillMin);
  const bx0 = CHIP.blockLeft;
  const by0 = CHIP.blockTop;
  const by1 = by0 + CHIP.blockHeight;
  let bx1 = bx0 + vw + CHIP.blockPad * 2;
  if (bx1 < W1 + CHIP.step) bx1 = W1 + CHIP.step;
  const rBR = CHIP.radiusBR;
  const rBL = CHIP.radiusBL;
  const n = (/** @type {number} */ v) => Number(v.toFixed(3));
  const d = [
    `M${n(r1)},0`, `L${n(W1 - r1)},0`, `A${n(r1)},${n(r1)} 0 0 1 ${n(W1)},${n(r1)}`,
    `L${n(W1)},${n(by0)}`, `L${n(bx1)},${n(by0)}`, `L${n(bx1)},${n(by1 - rBR)}`,
    `A${rBR},${rBR} 0 0 1 ${n(bx1 - rBR)},${n(by1)}`, `L${n(bx0 + rBL)},${n(by1)}`,
    `A${rBL},${rBL} 0 0 1 ${n(bx0)},${n(by1 - rBL)}`, `L${n(bx0)},${n(H1)}`, `L${n(r1)},${n(H1)}`,
    `A${n(r1)},${n(r1)} 0 0 1 0,${n(r1)}`, `A${n(r1)},${n(r1)} 0 0 1 ${n(r1)},0`, 'Z',
  ].join(' ');
  return {
    d,
    label: { x: W1 / 2, y: H1 / 2 + 0.02, size: CHIP.labelSize, width: lw },
    value: { x: (bx0 + bx1) / 2, y, size: CHIP.valueSize, width: vw },
    width: bx1 + 0.2,
    height: by1 + 0.14,
  };
}

/* ── The black board (owner 2026-10-18) ──────────────────────────
   A leader lifts a SMART Board pen (KVBC Awana sees SMART Ink's toolbar and
   tells the page), touches the board with a pen, or presses the corner pen
   button: the screen goes black to write on (SMART Ink's black pen set to
   write white), with only the club's count chip and the welcomes on it,
   until the next scheduled screen. Putting the pen back changes nothing; a
   "Show the card again" button stays up for BOARD_UNDO_MS in case it was an
   accident. Never in a black gap or with the screen off. */
export const BOARD_UNDO_MS = 60 * 1000;
const BOARD_VIEWS = { cubbies: ['cubbies'], sparks: ['sparks'], lobby: ['sparks'] };

/**
 * The period a board started now would last for, or null when no board can
 * start (a gap, off, or not a club night).
 * @param {number} minutes  minute of the church's day
 * @param {boolean} clubNight
 */
export function boardPeriod(minutes, clubNight) {
  const p = periodNow(minutes, clubNight);
  return p && BOARD_VIEWS[p.view] ? p : null;
}

/**
 * Is a board started in the period beginning at `from` still up at `minutes`?
 * It goes when its period does (the next scheduled screen takes over).
 * @param {{ from: number } | null} board
 */
export function boardUp(board, minutes, clubNight) {
  if (!board) return false;
  const p = boardPeriod(minutes, clubNight);
  return Boolean(p && p.from === board.from);
}

/** The clubs a board welcomes (and whose count it keeps): the period's own; the lobby's is Sparks. */
export function boardClubs(view) {
  return BOARD_VIEWS[view] ? [...BOARD_VIEWS[view]] : [];
}

/** The ink spill's length (style.css cr-spill). */
export const SPILL_MS = 1000;

/**
 * How much the spill blob (a wobbly ring whose narrowest radius is 0.39 of
 * its size) must grow from (x, y) to cover a w x h screen, with a margin.
 */
export function spillScale(x, y, w, h, size) {
  const far = Math.max(Math.hypot(x, y), Math.hypot(w - x, y), Math.hypot(x, h - y), Math.hypot(w - x, h - y));
  return Math.max(1, (far / (0.39 * size)) * 1.08);
}

/** The chalk Cubbie (easter egg): once a night, this long after a board goes up. */
export const CHALK_AFTER_MS = 45 * 1000;
export const CHALK_MS = 2600;

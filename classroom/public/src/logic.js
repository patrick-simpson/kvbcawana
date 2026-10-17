// The downstairs classroom's rules, pure (no DOM, no clock of its own), so
// the tests can ask them anything (classroom/test/logic.test.mjs).
//
// Club nights only (shared/clubNight.js, asked by app.js), by the church's
// wall clock (owner 2026-10-16/17):
//   6:30-6:57  the Cubbies card
//   6:57-7:03  black (#000), so the clubs can pass at the door with no logo up
//   7:03-7:30  Sparks "Large Group Time"
//   7:30-8:00  the lobby screen, Sparks only
//   otherwise  black (the KVBC Awana app has the screen down then anyway)

export const CUBBIES_AT = 18 * 60 + 30;
export const BLACK_AT = 18 * 60 + 57;
export const SPARKS_AT = 19 * 60 + 3;
export const LOBBY_AT = 19 * 60 + 30;
export const CLOSE_AT = 20 * 60;

/** The honey drip (easter egg): starts 6:54, done before the 6:57 fade. */
export const HONEY_AT_S = (18 * 60 + 54) * 60;
export const HONEY_MS = 150 * 1000;

/** The bear peek (easter egg): once a night, some time in 6:33-6:50. */
export const BEAR_FROM = 18 * 60 + 33;
export const BEAR_UNTIL = 18 * 60 + 50;
export const BEAR_MS = 6000;

/** A welcome stays this long after the latest arrival. */
export const WELCOME_MS = 20 * 1000;
export const WELCOME_NAMES_MAX = 5;

export const CLUB_COUNTS_KEY = 'awanaClubCounts.v1';
const COUNT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const COUNT_SKEW_MS = 60 * 60 * 1000;

/** @typedef {'off' | 'cubbies' | 'black' | 'sparks' | 'lobby'} Phase */

/**
 * @param {number} minutes  minute of the church's day
 * @param {boolean} clubNight
 * @returns {Phase}
 */
export function phaseAt(minutes, clubNight) {
  if (!clubNight || !Number.isFinite(minutes)) return 'off';
  if (minutes < CUBBIES_AT || minutes >= CLOSE_AT) return 'off';
  if (minutes < BLACK_AT) return 'cubbies';
  if (minutes < SPARKS_AT) return 'black';
  if (minutes < LOBBY_AT) return 'sparks';
  return 'lobby';
}

/** The club whose card is up (its welcomes and count), or null. @param {Phase} phase */
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

/** "Cubbies" / "T&T" / "Truth & Training" ... -> a club id, or ''. */
export function clubIdOf(club) {
  const s = typeof club === 'string' ? club.toLowerCase() : '';
  if (s.includes('cubbies')) return 'cubbies';
  if (s.includes('sparks')) return 'sparks';
  if (s.includes('puggles')) return 'puggles';
  if (s.includes('t&t') || s.includes('truth')) return 'tnt';
  if (s.includes('trek')) return 'trek';
  if (s.includes('journey')) return 'journey';
  return '';
}

/**
 * The words of a welcome for these first names (arrival order).
 * "Welcome, Ava!" / "Ava & Ben" / "Ava, Ben & Cara" / "... & 3 more".
 * @param {string[]} names
 */
export function welcomeWords(names) {
  const list = names.filter((n) => typeof n === 'string' && n);
  if (list.length === 0) return '';
  const shown = list.length > WELCOME_NAMES_MAX ? list.slice(0, WELCOME_NAMES_MAX - 1) : list;
  const more = list.length - shown.length;
  const parts = more > 0 ? [...shown, `${more} more`] : shown;
  if (parts.length === 1) return `${parts[0]}!`;
  return `${parts.slice(0, -1).join(', ')} & ${parts[parts.length - 1]}!`;
}

/**
 * The welcome card's state machine. One card for a club, names added as
 * they come; it stays WELCOME_MS after the latest arrival.
 * @typedef {{ club: string, names: string[], until: number, seen: string[] }} Welcome
 */

/** @returns {Welcome} */
export function emptyWelcome() { return { club: '', names: [], until: 0, seen: [] }; }

/**
 * A check-in heard. Returns the next state and whether to ding.
 * @param {Welcome} state
 * @param {{ id?: unknown, firstName?: unknown, club?: unknown }} event  already sanitized by the lobby
 * @param {Phase} phase
 * @param {number} nowMs
 */
export function welcomeFor(state, event, phase, nowMs) {
  const club = cardClub(phase);
  const id = typeof event?.id === 'string' ? event.id : '';
  const name = typeof event?.firstName === 'string' ? event.firstName.trim() : '';
  if (!club || !name || clubIdOf(event?.club) !== club) return { state, ding: false };
  if (id && state.seen.includes(id)) return { state, ding: false };
  const live = state.club === club && nowMs < state.until;
  const seen = id ? [...state.seen.slice(-199), id] : state.seen;
  const names = live ? [...state.names, name] : [name];
  return { state: { club, names, until: nowMs + WELCOME_MS, seen }, ding: true };
}

/** Whether the welcome is up at `nowMs` for this phase. @param {Welcome} state @param {Phase} phase @param {number} nowMs */
export function welcomeUp(state, phase, nowMs) {
  return state.names.length > 0 && state.club === cardClub(phase) && nowMs < state.until;
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

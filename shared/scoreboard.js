// The game time scoreboard (owner 2026-11-05): four colour teams for T&T,
// Sparks and Cubbies, scored from a leader's phone and shown big on the game
// time projector, with a stopwatch / countdown timer both share.
//
// ONE copy of the rules, read by the sync Worker (worker/src/scoreboard.js,
// routes.md 10.17), the projector (lobby src/presentation/) and the phone page
// (lobby src/scoreboard/). Pure ES module, no imports: anything the Worker
// sends is cleaned here again before a screen draws it.
//
// The board (numbers only, never a name):
//   { v: 1, night: 'YYYY-MM-DD', active: club|null,
//     scores: { tnt: {blue, red, yellow, green}, sparks: {...}, cubbies: {...} },
//     clock: null | { id, kind: 'stopwatch'|'timer', startedAt: ms|null,
//                     elapsedMs, durationMs|null },
//     finale: null | { id, club, scores: {blue, red, yellow, green}, at },
//     rev, at }
//
// The clock is anchored to the WORKER's clock: `startedAt` is the Worker's time
// the run (re)started, `elapsedMs` what had run before. Every screen reads it
// as elapsedMs + (serverNow - startedAt), with serverNow estimated from its own
// clock and the offset measured on each answer (`clockOffset`), so every
// screen shows the same tenth.

export const SCORE_CLUBS = Object.freeze(['tnt', 'sparks', 'cubbies']);
/** The 2 x 2 order, top-left first (owner: blue top-left, red top-right, yellow bottom-left, green bottom-right). */
export const SCORE_TEAMS = Object.freeze(['blue', 'red', 'yellow', 'green']);
export const SCORE_TEAM_WORDS = Object.freeze({ blue: 'BLUE', red: 'RED', yellow: 'YELLOW', green: 'GREEN' });
/**
 * The four team colours, from the brand kit (shared/brand/tokens.json): the
 * plate, its hard-offset shade, and the ink drawn on it (yellow takes the kit's
 * ink; white on sun fails contrast).
 */
export const SCORE_TEAM_COLORS = Object.freeze({
  blue: Object.freeze({ fill: '#4C72B8', deep: '#2F4F8A', ink: '#FFFFFF' }),
  red: Object.freeze({ fill: '#F04A4B', deep: '#B82B32', ink: '#FFFFFF' }),
  yellow: Object.freeze({ fill: '#FCB614', deep: '#C97A08', ink: '#231F20' }),
  green: Object.freeze({ fill: '#58BD79', deep: '#2F8A4E', ink: '#FFFFFF' }),
});
/** Each team's point chime (owner: "a short chime per point", a little different per team), in Hz. */
export const SCORE_TEAM_CHIMES = Object.freeze({ blue: [523, 784], red: [587, 880], yellow: [659, 988], green: [698, 1047] });
export const SCORE_CLUB_WORDS = Object.freeze({ tnt: 'T&T', sparks: 'SPARKS', cubbies: 'CUBBIES' });
/** No score above this (a guard, not a real limit). */
export const SCORE_MAX = 999;
/** The longest countdown the timer takes. */
export const TIMER_MAX_MS = 60 * 60 * 1000;
/** The phone's quick picks for the timer, in seconds. */
export const TIMER_PICKS = Object.freeze([30, 60, 120, 300]);
/** Points within this of each other share one takeover on the wall. */
export const COMBINE_MS = 1500;
/** How long a point's takeover holds the wall. */
export const TAKEOVER_MS = 1500;
/** How long the winner screen holds the wall after End (or a club switch). */
export const FINALE_MS = 8000;
/** A finale older than this is never played (a screen that just loaded). */
export const FINALE_FRESH_MS = 20000;
/** The church's zone: a night is its local date. */
export const SCORE_ZONE = 'America/New_York';

const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
const isTime = (n) => Number.isFinite(n) && n > 0 && n < 8.64e15;

/** @returns {{blue: number, red: number, yellow: number, green: number}} */
export function emptyScores() {
  return { blue: 0, red: 0, yellow: 0, green: 0 };
}

/** @param {string} night */
export function emptyBoard(night) {
  return {
    v: 1,
    night,
    active: null,
    scores: { tnt: emptyScores(), sparks: emptyScores(), cubbies: emptyScores() },
    clock: null,
    finale: null,
    rev: 0,
    at: null,
  };
}

/** The church's local date for a time, 'YYYY-MM-DD'. @param {number} ms */
export function nightOf(ms, zone = SCORE_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** One club's four scores, or null when anything is off. @param {any} s */
export function cleanScores(s) {
  if (!s || typeof s !== 'object') return null;
  const out = emptyScores();
  for (const t of SCORE_TEAMS) {
    if (!isInt(s[t], 0, SCORE_MAX)) return null;
    out[t] = s[t];
  }
  return out;
}

/** @param {any} c */
export function cleanClock(c) {
  if (!c || typeof c !== 'object') return null;
  if (c.kind !== 'stopwatch' && c.kind !== 'timer') return null;
  if (!isInt(c.id, 1, Number.MAX_SAFE_INTEGER)) return null;
  if (!isInt(c.elapsedMs, 0, 24 * 3600 * 1000)) return null;
  if (c.startedAt !== null && !isTime(c.startedAt)) return null;
  if (c.kind === 'timer' ? !isInt(c.durationMs, 1000, TIMER_MAX_MS) : c.durationMs !== null) return null;
  return { id: c.id, kind: c.kind, startedAt: c.startedAt, elapsedMs: c.elapsedMs, durationMs: c.kind === 'timer' ? c.durationMs : null };
}

/** @param {any} f */
function cleanFinale(f) {
  if (!f || typeof f !== 'object') return null;
  if (!SCORE_CLUBS.includes(f.club) || !isInt(f.id, 1, Number.MAX_SAFE_INTEGER) || !isTime(f.at)) return null;
  const scores = cleanScores(f.scores);
  return scores ? { id: f.id, club: f.club, scores, at: f.at } : null;
}

/**
 * A board as anything sent it (the Worker's answer, a doorbell's payload,
 * storage), cleaned to the shape above, or null when it is not one.
 * @param {any} b
 */
export function cleanBoard(b) {
  if (!b || typeof b !== 'object' || b.v !== 1) return null;
  if (typeof b.night !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.night)) return null;
  if (!isInt(b.rev, 0, Number.MAX_SAFE_INTEGER)) return null;
  const out = emptyBoard(b.night);
  out.rev = b.rev;
  out.at = isTime(b.at) ? b.at : null;
  out.active = SCORE_CLUBS.includes(b.active) ? b.active : null;
  for (const club of SCORE_CLUBS) {
    const s = cleanScores(b.scores?.[club]);
    if (s) out.scores[club] = s;
  }
  out.clock = cleanClock(b.clock);
  out.finale = cleanFinale(b.finale);
  return out;
}

/** True when any team has a point. @param {{[t: string]: number}} scores */
export function anyPoints(scores) {
  return SCORE_TEAMS.some((t) => scores[t] > 0);
}

/**
 * Who won: the team(s) with the top score. `tie` when two or more share it;
 * no teams when nobody scored.
 * @param {{[t: string]: number}} scores
 * @returns {{teams: string[], tie: boolean, top: number}}
 */
export function winnerOf(scores) {
  const top = Math.max(...SCORE_TEAMS.map((t) => scores[t]));
  if (!(top > 0)) return { teams: [], tie: false, top: 0 };
  const teams = SCORE_TEAMS.filter((t) => scores[t] === top);
  return { teams, tie: teams.length > 1, top };
}

/** The team in front alone, or null (no points, or a tie at the top). @param {{[t: string]: number}} scores */
export function leaderOf(scores) {
  const w = winnerOf(scores);
  return w.teams.length === 1 ? w.teams[0] : null;
}

/**
 * Teams whose score went UP between two readings, with how many points.
 * A removed point gets no takeover (owner: "a removed point just ticks down quietly").
 * @param {{[t: string]: number}|null} before @param {{[t: string]: number}} after
 * @returns {{team: string, gained: number}[]}
 */
export function pointsGained(before, after) {
  if (!before) return [];
  return SCORE_TEAMS.filter((t) => after[t] > before[t]).map((t) => ({ team: t, gained: after[t] - before[t] }));
}

/**
 * What the clock reads at `serverNow`.
 * Stopwatch: time run. Timer: time left (never below 0), `done` at 0.
 * @param {ReturnType<typeof cleanClock>} clock @param {number} serverNow
 * @returns {null | {kind: 'stopwatch'|'timer', ms: number, running: boolean, done: boolean, durationMs: number|null}}
 */
export function clockReading(clock, serverNow) {
  if (!clock) return null;
  const running = clock.startedAt !== null;
  const ran = clock.elapsedMs + (running ? Math.max(0, serverNow - clock.startedAt) : 0);
  if (clock.kind === 'stopwatch') return { kind: 'stopwatch', ms: ran, running, done: false, durationMs: null };
  const left = Math.max(0, clock.durationMs - ran);
  return { kind: 'timer', ms: left, running: running && left > 0, done: left === 0, durationMs: clock.durationMs };
}

/**
 * The clock's face: whole part 'm:ss' (or 'h:mm:ss') and the tenth.
 * A stopwatch rounds DOWN (it never shows a tenth that has not run); a timer
 * rounds UP (it reads 0:00.0 exactly when time is up, never early).
 * @param {number} ms @param {'stopwatch'|'timer'} kind
 */
export function clockFace(ms, kind) {
  const tenths = kind === 'timer' ? Math.ceil(Math.max(0, ms) / 100) : Math.floor(Math.max(0, ms) / 100);
  const tenth = tenths % 10;
  const secs = Math.floor(tenths / 10);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const ss = String(s).padStart(2, '0');
  const main = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  return { main, tenth: String(tenth) };
}

/**
 * One clock-offset sample from a round trip: the server said `serverNow`
 * somewhere between `sentAt` and `gotAt` (this device's clock). Assumes the
 * answer was stamped mid-trip; its error is at most half the trip.
 * @param {number} sentAt @param {number} gotAt @param {number} serverNow
 * @returns {{offset: number, rtt: number} | null}
 */
export function offsetSample(sentAt, gotAt, serverNow) {
  if (!Number.isFinite(sentAt) || !Number.isFinite(gotAt) || !isTime(serverNow) || gotAt < sentAt) return null;
  const rtt = gotAt - sentAt;
  return { offset: serverNow - (sentAt + rtt / 2), rtt };
}

/**
 * Keeps the best offset: the sample with the shortest round trip among the
 * recent ones (a short trip pins the server's time tightest). Samples older
 * than `keepMs` age out so a drifting device clock is followed.
 */
export function createClockSync({ keepMs = 10 * 60 * 1000, max = 12 } = {}) {
  /** @type {{offset: number, rtt: number, at: number}[]} */
  let samples = [];
  return {
    /** @param {number} sentAt @param {number} gotAt @param {number} serverNow */
    add(sentAt, gotAt, serverNow) {
      const s = offsetSample(sentAt, gotAt, serverNow);
      if (!s) return;
      samples.push({ ...s, at: gotAt });
      samples = samples.filter((x) => gotAt - x.at <= keepMs).slice(-max);
    },
    /** The best offset (server minus device), 0 before any sample. */
    offset() {
      if (!samples.length) return 0;
      return samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
    },
    /** True once one answer has been timed. */
    known() { return samples.length > 0; },
  };
}

/**
 * The club's game window end today, from shared/schedule.json's windows
 * (`{kind: 'game', clubs, end: 'HH:MM'}`), as minutes after midnight; null when
 * the schedule has no game window for it.
 * @param {{windows?: any[]}|any[]} schedule @param {string} club
 */
export function gameEndMinute(schedule, club) {
  const windows = Array.isArray(schedule) ? schedule : schedule?.windows;
  if (!Array.isArray(windows)) return null;
  const w = windows.find((x) => x && x.kind === 'game' && Array.isArray(x.clubs) && x.clubs.includes(club) && /^\d{1,2}:\d{2}$/.test(x.end));
  if (!w) return null;
  const [h, m] = w.end.split(':').map(Number);
  return h * 60 + m;
}

/** The other clubs whose game window the club shares (Cubbies with Puggles). @param {any} schedule @param {string} club */
export function gameClubsWith(schedule, club) {
  const windows = Array.isArray(schedule) ? schedule : schedule?.windows;
  const w = Array.isArray(windows) ? windows.find((x) => x && x.kind === 'game' && Array.isArray(x.clubs) && x.clubs.includes(club)) : null;
  return w ? w.clubs.filter((c) => typeof c === 'string') : [club];
}

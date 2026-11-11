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
//     setups: { tnt: 'four', sparks: 'boys-girls', cubbies: 'four' },
//     scores: { tnt: {blue, red, yellow, green, boys, girls, leaders, kids}, ... },
//     clock: null | { id, kind: 'stopwatch'|'timer', startedAt: ms|null,
//                     elapsedMs, durationMs|null },
//     finale: null | { id, club, teams: [team...], scores: {...}, at },
//     sounds: boolean (the projector's point chimes and timer buzzer; kept across nights),
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
/** Every team any setup uses (each club keeps a score for each, per night). */
export const SCORE_ALL_TEAMS = Object.freeze(['blue', 'red', 'yellow', 'green', 'boys', 'girls', 'leaders', 'kids']);
export const SCORE_TEAM_WORDS = Object.freeze({
  blue: 'BLUE', red: 'RED', yellow: 'YELLOW', green: 'GREEN', boys: 'BOYS', girls: 'GIRLS', leaders: 'LEADERS', kids: 'KIDS',
});
/**
 * How the teams are split (owner 2026-11-05: the phone's Options): the four
 * colours (the default), or two halves. Each club keeps its own setup for the
 * night; a new night starts every club on the four colours. Two-team setups
 * read left to right.
 */
export const SCORE_SETUPS = Object.freeze({
  four: Object.freeze({ teams: SCORE_TEAMS, words: '4 colors' }),
  'boys-girls': Object.freeze({ teams: Object.freeze(['boys', 'girls']), words: 'Boys vs Girls' }),
  'red-green': Object.freeze({ teams: Object.freeze(['red', 'green']), words: 'Red vs Green' }),
  'blue-yellow': Object.freeze({ teams: Object.freeze(['blue', 'yellow']), words: 'Blue vs Yellow' }),
  'leaders-kids': Object.freeze({ teams: Object.freeze(['leaders', 'kids']), words: 'Leaders vs Kids' }),
});
export const SCORE_SETUP_IDS = Object.freeze(Object.keys(SCORE_SETUPS));
/**
 * The four team colours, from the brand kit (shared/brand/tokens.json): the
 * plate, its hard-offset shade, and the ink drawn on it (yellow and green take
 * the kit's ink; white on sun or on green fails contrast).
 */
export const SCORE_TEAM_COLORS = Object.freeze({
  blue: Object.freeze({ fill: '#4C72B8', deep: '#2F4F8A', ink: '#FFFFFF' }),
  red: Object.freeze({ fill: '#F04A4B', deep: '#B82B32', ink: '#FFFFFF' }),
  yellow: Object.freeze({ fill: '#FCB614', deep: '#C97A08', ink: '#231F20' }),
  green: Object.freeze({ fill: '#58BD79', deep: '#2F8A4E', ink: '#231F20' }),
  // Boys vs Girls: the blue and the red (the kit has no pink).
  boys: Object.freeze({ fill: '#4C72B8', deep: '#2F4F8A', ink: '#FFFFFF' }),
  girls: Object.freeze({ fill: '#F04A4B', deep: '#B82B32', ink: '#FFFFFF' }),
  // Leaders vs Kids: the kit's ink (its white keyline carries it on the black wall) and Awana orange.
  leaders: Object.freeze({ fill: '#231F20', deep: '#000000', ink: '#FFFFFF' }),
  kids: Object.freeze({ fill: '#FAA41D', deep: '#C97A08', ink: '#231F20' }),
});
/** Each team's point chime (owner: "a short chime per point", a little different per team), in Hz. */
export const SCORE_TEAM_CHIMES = Object.freeze({
  blue: [523, 784], red: [587, 880], yellow: [659, 988], green: [698, 1047],
  boys: [523, 784], girls: [587, 880], leaders: [440, 659], kids: [784, 1175],
});
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

/** Every team's score at 0. @returns {Record<string, number>} */
export function emptyScores() {
  return Object.fromEntries(SCORE_ALL_TEAMS.map((t) => [t, 0]));
}

/** Every club on the four colours. */
export function emptySetups() {
  return { tnt: 'four', sparks: 'four', cubbies: 'four' };
}

/** The teams a club plays as on this board. @param {any} board @param {string|null} club */
export function teamsFor(board, club) {
  const id = board && club && board.setups ? board.setups[club] : 'four';
  return (SCORE_SETUPS[id] || SCORE_SETUPS.four).teams;
}

/** @param {string} night */
export function emptyBoard(night) {
  return {
    v: 1,
    night,
    active: null,
    setups: emptySetups(),
    scores: { tnt: emptyScores(), sparks: emptyScores(), cubbies: emptyScores() },
    clock: null,
    finale: null,
    sounds: false,
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

/**
 * One club's scores, or null when anything is off. A team a board from before
 * the setups (2026-11-05) never had reads 0.
 * @param {any} s
 */
export function cleanScores(s) {
  if (!s || typeof s !== 'object') return null;
  const out = emptyScores();
  for (const t of SCORE_ALL_TEAMS) {
    if (s[t] === undefined && !SCORE_TEAMS.includes(t)) continue;
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
  const setup = Object.values(SCORE_SETUPS).find((x) => Array.isArray(f.teams) && x.teams.join() === f.teams.join());
  return scores ? { id: f.id, club: f.club, teams: (setup || SCORE_SETUPS.four).teams.slice(), scores, at: f.at } : null;
}

/**
 * Is this board tonight's? A board stamped with another night is last night's
 * (the Worker starts a new night only when someone asks), so a screen shows no
 * board. A board with no usable `night` (an older Worker) is not dropped.
 * `ms` is the Worker's clock when known, else the device's.
 * @param {{night?: unknown}|null} board @param {number} ms
 */
export function boardIsTonight(board, ms) {
  if (!board) return false;
  if (typeof board.night !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(board.night)) return true;
  if (!Number.isFinite(ms)) return true;
  return board.night === nightOf(ms);
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
    if (SCORE_SETUP_IDS.includes(b.setups?.[club])) out.setups[club] = b.setups[club];
  }
  out.clock = cleanClock(b.clock);
  out.finale = cleanFinale(b.finale);
  out.sounds = b.sounds === true;
  return out;
}

/** True when any of these teams has a point. @param {{[t: string]: number}} scores @param {readonly string[]} [teams] */
export function anyPoints(scores, teams = SCORE_TEAMS) {
  return teams.some((t) => scores[t] > 0);
}

/**
 * Who won: the team(s) with the top score. `tie` when two or more share it;
 * no teams when nobody scored.
 * @param {{[t: string]: number}} scores @param {readonly string[]} [playing]
 * @returns {{teams: string[], tie: boolean, top: number}}
 */
export function winnerOf(scores, playing = SCORE_TEAMS) {
  const top = Math.max(...playing.map((t) => scores[t]));
  if (!(top > 0)) return { teams: [], tie: false, top: 0 };
  const teams = playing.filter((t) => scores[t] === top);
  return { teams, tie: teams.length > 1, top };
}

/** The team in front alone, or null (no points, or a tie at the top). @param {{[t: string]: number}} scores @param {readonly string[]} [playing] */
export function leaderOf(scores, playing = SCORE_TEAMS) {
  const w = winnerOf(scores, playing);
  return w.teams.length === 1 ? w.teams[0] : null;
}

/**
 * The team that just took the lead (owner 2026-11-06: "RED TAKES THE LEAD!"):
 * in front alone now, and before it was another team in front or a tie at the
 * top with points on the board. The first point of a game is not a lead change
 * (nobody was ahead), and nor is a team adding to its own lead.
 * @param {{[t: string]: number}|null} before @param {{[t: string]: number}} after @param {readonly string[]} [playing]
 * @returns {string|null}
 */
export function leadChange(before, after, playing = SCORE_TEAMS) {
  if (!before) return null;
  const now = leaderOf(after, playing);
  if (!now) return null;
  const was = winnerOf(before, playing);
  if (was.top <= 0) return null;
  return was.teams.length === 1 && was.teams[0] === now ? null : now;
}

/**
 * Teams whose score went UP between two readings, with how many points.
 * A removed point gets no takeover (owner: "a removed point just ticks down quietly").
 * @param {{[t: string]: number}|null} before @param {{[t: string]: number}} after @param {readonly string[]} [playing]
 * @returns {{team: string, gained: number}[]}
 */
export function pointsGained(before, after, playing = SCORE_TEAMS) {
  if (!before) return [];
  return playing.filter((t) => after[t] > before[t]).map((t) => ({ team: t, gained: after[t] - before[t] }));
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

/** The club's game window start, minutes after midnight (null when none). @param {any} schedule @param {string} club */
export function gameStartMinute(schedule, club) {
  const windows = Array.isArray(schedule) ? schedule : schedule?.windows;
  const w = Array.isArray(windows) ? windows.find((x) => x && x.kind === 'game' && Array.isArray(x.clubs) && x.clubs.includes(club) && /^\d{1,2}:\d{2}$/.test(x.start)) : null;
  if (!w) return null;
  const [h, m] = w.start.split(':').map(Number);
  return h * 60 + m;
}

/**
 * The game clock line for a club, read the same on the phone and the lobby:
 * "Game ends 6:30" and the time left (m:ss); before the game, when it runs
 * ("Game time 6:05–6:30", never hours of countdown); "Time's up" after.
 * Minutes from the device's own clock (the screens are in the church's zone).
 * @param {any} schedule @param {string|null} club @param {Date} now
 * @returns {{label: string, left: string}}
 */
export function gameClockWords(schedule, club, now) {
  if (!club || !SCORE_CLUBS.includes(club)) return { label: 'Pick a club', left: '' };
  const end = gameEndMinute(schedule, club);
  if (end === null) return { label: 'No game time', left: '' };
  const clock = (mins) => `${((Math.floor(mins / 60) + 11) % 12) + 1}:${String(mins % 60).padStart(2, '0')}`;
  const nowS = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const left = end * 60 - nowS;
  if (left <= 0) return { label: "Time's up", left: '' };
  const start = gameStartMinute(schedule, club);
  if (start !== null && nowS < start * 60) return { label: `Game time ${clock(start)}–${clock(end)}`, left: '' };
  return { label: `Game ends ${clock(end)}`, left: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` };
}

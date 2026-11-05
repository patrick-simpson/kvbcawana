import { describe, expect, it } from 'vitest';
import {
  SCORE_ALL_TEAMS,
  SCORE_SETUPS,
  SCORE_TEAM_WORDS,
  SCORE_TEAMS,
  SCORE_TEAM_COLORS,
  cleanBoard,
  clockFace,
  clockReading,
  createClockSync,
  emptyBoard,
  gameClubsWith,
  gameEndMinute,
  leaderOf,
  nightOf,
  offsetSample,
  pointsGained,
  teamsFor,
  winnerOf,
} from './scoreboard.js';
import schedule from './schedule.json';
import tokens from './brand/tokens.json';

// The game time scoreboard's one copy of the rules (shared/scoreboard.js):
// the Worker, the projector and the phone all read these.

describe('the board', () => {
  it('keeps the 2 x 2 order the owner set: blue, red, yellow, green', () => {
    expect(SCORE_TEAMS).toEqual(['blue', 'red', 'yellow', 'green']);
  });

  it('team colours are the brand kit\'s', () => {
    const kit = JSON.stringify(tokens).toUpperCase();
    for (const t of SCORE_TEAMS) {
      expect(kit).toContain(SCORE_TEAM_COLORS[t].fill.toUpperCase());
      expect(kit).toContain(SCORE_TEAM_COLORS[t].deep.toUpperCase());
    }
  });

  it('cleans a board and refuses anything else', () => {
    const b = emptyBoard('2026-11-04');
    b.active = 'sparks';
    b.scores.sparks.red = 4;
    b.clock = { id: 1, kind: 'timer', startedAt: 1_700_000_000_000, elapsedMs: 0, durationMs: 60000 };
    expect(cleanBoard(b)).toEqual(b);
    expect(cleanBoard(null)).toBe(null);
    expect(cleanBoard({ ...b, v: 2 })).toBe(null);
    expect(cleanBoard({ ...b, active: 'trek' }).active).toBe(null);
    const bad = cleanBoard({ ...b, scores: { ...b.scores, sparks: { blue: -1, red: 1, yellow: 1, green: 1 } } });
    expect(bad.scores.sparks).toMatchObject({ blue: 0, red: 0, yellow: 0, green: 0 });
    expect(cleanBoard({ ...b, clock: { ...b.clock, durationMs: 10 } }).clock).toBe(null);
    expect(cleanBoard({ ...b, extra: 'Ava Smith' })).not.toHaveProperty('extra');
  });

  it('a night is the church\'s local date', () => {
    expect(nightOf(Date.parse('2026-11-05T03:30:00Z'))).toBe('2026-11-04');   // 10:30 pm Eastern
    expect(nightOf(Date.parse('2026-11-05T05:30:00Z'))).toBe('2026-11-05');
  });
});

describe('who leads and who won', () => {
  it('a single leader, none on a tie or with no points', () => {
    expect(leaderOf({ blue: 3, red: 5, yellow: 1, green: 0 })).toBe('red');
    expect(leaderOf({ blue: 5, red: 5, yellow: 1, green: 0 })).toBe(null);
    expect(leaderOf({ blue: 0, red: 0, yellow: 0, green: 0 })).toBe(null);
  });

  it('the winner, or every team sharing the top score', () => {
    expect(winnerOf({ blue: 3, red: 5, yellow: 1, green: 0 })).toEqual({ teams: ['red'], tie: false, top: 5 });
    expect(winnerOf({ blue: 7, red: 5, yellow: 1, green: 7 })).toEqual({ teams: ['blue', 'green'], tie: true, top: 7 });
    expect(winnerOf({ blue: 0, red: 0, yellow: 0, green: 0 }).teams).toEqual([]);
  });

  it('a takeover only for a score that went up', () => {
    expect(pointsGained({ blue: 1, red: 2, yellow: 0, green: 0 }, { blue: 2, red: 1, yellow: 2, green: 0 })).toEqual([
      { team: 'blue', gained: 1 },
      { team: 'yellow', gained: 2 },
    ]);
    expect(pointsGained(null, { blue: 2, red: 0, yellow: 0, green: 0 })).toEqual([]);
  });
});

describe('the stopwatch and timer', () => {
  const at = 1_700_000_000_000;

  it('a stopwatch counts up from its start on the server\'s clock, paused or running', () => {
    const running = { id: 1, kind: 'stopwatch', startedAt: at, elapsedMs: 2000, durationMs: null };
    expect(clockReading(running, at + 1500)).toMatchObject({ ms: 3500, running: true, done: false });
    expect(clockReading({ ...running, startedAt: null }, at + 99999)).toMatchObject({ ms: 2000, running: false });
  });

  it('a timer counts down and stops at 0', () => {
    const t = { id: 1, kind: 'timer', startedAt: at, elapsedMs: 0, durationMs: 30000 };
    expect(clockReading(t, at + 10000)).toMatchObject({ ms: 20000, running: true, done: false });
    expect(clockReading(t, at + 45000)).toMatchObject({ ms: 0, running: false, done: true });
  });

  it('the face: a stopwatch never shows a tenth that has not run; a timer reads 0.0 exactly at the end', () => {
    expect(clockFace(83_499, 'stopwatch')).toEqual({ main: '1:23', tenth: '4' });
    expect(clockFace(83_401, 'timer')).toEqual({ main: '1:23', tenth: '5' });
    expect(clockFace(1, 'timer')).toEqual({ main: '0:00', tenth: '1' });
    expect(clockFace(0, 'timer')).toEqual({ main: '0:00', tenth: '0' });
    expect(clockFace(3_725_000, 'stopwatch')).toEqual({ main: '1:02:05', tenth: '0' });
  });

  it('the clock offset comes from the tightest round trip', () => {
    expect(offsetSample(1000, 1100, 5050)).toEqual({ offset: 4000, rtt: 100 });
    const sync = createClockSync();
    expect(sync.offset()).toBe(0);
    sync.add(1000, 1400, 5300);   // rtt 400: offset 4100 (loose)
    sync.add(2000, 2020, 6010);   // rtt 20: offset 4000 (tight)
    sync.add(3000, 3300, 7400);   // rtt 300
    expect(sync.offset()).toBe(4000);
    expect(sync.known()).toBe(true);
  });
});

describe('team setups', () => {
  it('the four colours, and four two-team splits', () => {
    expect(Object.fromEntries(Object.entries(SCORE_SETUPS).map(([k, v]) => [k, v.teams]))).toEqual({
      four: ['blue', 'red', 'yellow', 'green'],
      'boys-girls': ['boys', 'girls'],
      'red-green': ['red', 'green'],
      'blue-yellow': ['blue', 'yellow'],
      'leaders-kids': ['leaders', 'kids'],
    });
    for (const t of SCORE_ALL_TEAMS) expect(SCORE_TEAM_COLORS[t] && SCORE_TEAM_WORDS[t]).toBeTruthy();
  });

  it('a board from before the setups reads as the four colours; a club\'s setup picks its teams', () => {
    const old = { v: 1, night: '2026-11-04', active: 'tnt', rev: 3, at: null, clock: null, finale: null, scores: { tnt: { blue: 1, red: 2, yellow: 3, green: 4 } } };
    const b = cleanBoard(old);
    expect(b.setups.tnt).toBe('four');
    expect(b.scores.tnt).toMatchObject({ red: 2, boys: 0 });
    b.setups.tnt = 'boys-girls';
    expect(teamsFor(b, 'tnt')).toEqual(['boys', 'girls']);
    expect(cleanBoard({ ...b, setups: { tnt: 'nonsense' } }).setups.tnt).toBe('four');
  });

  it('who leads and who won among the teams playing only', () => {
    const s = { blue: 9, red: 2, yellow: 0, green: 0, boys: 3, girls: 4, leaders: 0, kids: 0 };
    expect(leaderOf(s, ['boys', 'girls'])).toBe('girls');
    expect(winnerOf(s, ['boys', 'girls']).teams).toEqual(['girls']);
    expect(pointsGained({ ...s, blue: 0 }, s, ['boys', 'girls'])).toEqual([]);
  });
});

describe('the schedule', () => {
  it('each scoring club has a game window: T&T 6:30, Sparks 7:00, Cubbies 7:30 (with Puggles)', () => {
    expect(gameEndMinute(schedule, 'tnt')).toBe(18 * 60 + 30);
    expect(gameEndMinute(schedule, 'sparks')).toBe(19 * 60);
    expect(gameEndMinute(schedule, 'cubbies')).toBe(19 * 60 + 30);
    expect(gameClubsWith(schedule, 'cubbies').sort()).toEqual(['cubbies', 'puggles']);
    expect(gameEndMinute(schedule, 'trek')).toBe(null);
  });
});

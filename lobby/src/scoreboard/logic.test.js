import { describe, expect, it } from 'vitest';
import { CLUB_FIELDS, gameClockWords, liveWords, mmss, sheetButtons, shownScores, stepTimer } from './logic.js';
import { emptyBoard } from '../../../shared/scoreboard.js';
import schedule from '../../../shared/schedule.json';

describe('the scoreboard phone page', () => {
  it('shows this phone\'s taps on top of the last board, never below 0', () => {
    const b = emptyBoard('2026-11-04');
    b.active = 'tnt';
    b.scores.tnt.red = 3;
    expect(shownScores(b, 'tnt', { red: 2, blue: -1 })).toEqual({ blue: 0, red: 5, yellow: 0, green: 0 });
    expect(shownScores(null, null, {})).toEqual({ blue: 0, red: 0, yellow: 0, green: 0 });
  });

  it('the game clock: ends time and time left, then TIME\'S UP', () => {
    const at = (h, m, s = 0) => new Date(2026, 10, 4, h, m, s);
    expect(gameClockWords(schedule, 'tnt', at(18, 17, 19))).toEqual({ label: 'Game ends 6:30', left: '12:41' });
    expect(gameClockWords(schedule, 'sparks', at(18, 59, 59))).toEqual({ label: 'Game ends 7:00', left: '0:01' });
    expect(gameClockWords(schedule, 'cubbies', at(19, 31))).toEqual({ label: "Time's up", left: '' });
    expect(gameClockWords(schedule, null, at(18, 10)).label).toBe('Pick a club');
  });

  it('the deep club fields stay dark enough for white text', () => {
    for (const hex of Object.values(CLUB_FIELDS)) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      expect(1.05 / (lum + 0.05)).toBeGreaterThan(7);
    }
  });

  it('the timer stepper: 15 s steps, 15 s to 60 min', () => {
    expect(stepTimer(60, 1)).toBe(75);
    expect(stepTimer(15, -1)).toBe(15);
    expect(stepTimer(3600, 1)).toBe(3600);
    expect(mmss(75)).toBe('1:15');
  });

  it('the sheet\'s buttons follow the clock', () => {
    expect(sheetButtons(null, 'stopwatch')).toMatchObject({ go: 'Start', goOp: 'start', resetShown: false });
    expect(sheetButtons(null, 'timer')).toMatchObject({ go: 'Start timer', setting: true });
    expect(sheetButtons({ kind: 'stopwatch', running: true, done: false }, 'stopwatch')).toMatchObject({ go: 'Pause', goOp: 'pause', reset: 'Reset', resetShown: true });
    expect(sheetButtons({ kind: 'timer', running: false, done: false }, 'timer')).toMatchObject({ go: 'Resume', reset: 'Cancel' });
    expect(sheetButtons({ kind: 'timer', running: false, done: true }, 'timer')).toMatchObject({ go: 'Start again', reset: 'Clear' });
    // A stopwatch running while the timer tab is open: starting the timer replaces it.
    expect(sheetButtons({ kind: 'stopwatch', running: true, done: false }, 'timer')).toMatchObject({ goOp: 'start' });
  });

  it('says plainly whether taps reach the projector', () => {
    expect(liveWords('ok')).toMatch(/Live/);
    expect(liveWords('off')).toMatch(/Offline/);
  });
});

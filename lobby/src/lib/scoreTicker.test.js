import { describe, expect, it } from 'vitest';
import { scoreTickerView, scoreTickerWanted } from './scoreTicker.js';
import { emptyBoard } from '../../../shared/scoreboard.js';

describe('the lobby score bar: what it shows', () => {
  it('nothing with no club up and no finale', () => {
    expect(scoreTickerView(null, null)).toBeNull();
    expect(scoreTickerView(emptyBoard('2026-11-04'), null)).toBeNull();
  });

  it('the club up, its setup\'s teams and their scores', () => {
    const b = emptyBoard('2026-11-04');
    b.active = 'sparks';
    b.scores.sparks.red = 4;
    expect(scoreTickerView(b, null)).toMatchObject({ club: 'sparks', teams: ['blue', 'red', 'yellow', 'green'], final: false, won: [] });
    b.setups.sparks = 'boys-girls';
    expect(scoreTickerView(b, null).teams).toEqual(['boys', 'girls']);
  });

  it('after an End, the finale\'s final scores with the winner marked', () => {
    const v = scoreTickerView(emptyBoard('2026-11-04'), { id: 1, club: 'tnt', scores: { blue: 3, red: 7, yellow: 7, green: 0 } });
    expect(v).toMatchObject({ club: 'tnt', final: true, won: ['red', 'yellow'] });
  });

  it('a club up wins over a finale (a switch: the new game is what is on)', () => {
    const b = emptyBoard('2026-11-04');
    b.active = 'cubbies';
    expect(scoreTickerView(b, { id: 2, club: 'tnt', scores: { blue: 1, red: 0, yellow: 0, green: 0 } }).club).toBe('cubbies');
  });

  it('only on a real lobby TV: never an OBS feed, the settings page or a framed copy', () => {
    expect(scoreTickerWanted({ overlay: false, configure: false, embedded: false })).toBe(true);
    expect(scoreTickerWanted({ overlay: true, configure: false, embedded: false })).toBe(false);
    expect(scoreTickerWanted({ overlay: false, configure: true, embedded: false })).toBe(false);
    expect(scoreTickerWanted({ overlay: false, configure: false, embedded: true })).toBe(false);
  });
});

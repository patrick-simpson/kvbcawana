import { describe, expect, it } from 'vitest';
import { TRANSITION_GAP_MIN, gapAround, inTransitionGap, periodAt, periodsFor } from './transitionGap.js';

describe('the club-night transition gap (owner 2026-10-17)', () => {
  it('is two minutes before and two after a hand-off', () => {
    expect(TRANSITION_GAP_MIN).toBe(2);
    expect(gapAround(19 * 60)).toEqual({ from: 19 * 60 - 2, until: 19 * 60 + 2 });
    expect(inTransitionGap(19 * 60 - 3, [19 * 60])).toBeNull();
    expect(inTransitionGap(19 * 60 - 2, [19 * 60])).toBe(19 * 60);
    expect(inTransitionGap(19 * 60 + 1, [19 * 60, 19 * 60 + 30])).toBe(19 * 60);
    expect(inTransitionGap(19 * 60 + 2, [19 * 60])).toBeNull();
  });

  it('cuts a black period around every hand-off, welcoming both neighbours\' clubs', () => {
    const p = periodsFor([
      { view: 'cubbies', from: 1110, until: 1140, clubs: ['cubbies'] },
      { view: 'sparks', from: 1140, until: 1170, clubs: ['sparks'] },
      { view: 'lobby', from: 1170, until: 1200, clubs: [] },
    ]);
    expect(p).toEqual([
      { view: 'cubbies', from: 1110, until: 1138, clubs: ['cubbies'], gap: false },
      { view: 'black', from: 1138, until: 1142, clubs: ['cubbies', 'sparks'], gap: true },
      { view: 'sparks', from: 1142, until: 1168, clubs: ['sparks'], gap: false },
      { view: 'black', from: 1168, until: 1172, clubs: ['sparks'], gap: true },
      { view: 'lobby', from: 1172, until: 1200, clubs: [], gap: false },
    ]);
    expect(periodAt(p, 1109)).toBeNull();
    expect(periodAt(p, 1139)?.view).toBe('black');
    expect(periodAt(p, 1200)).toBeNull();
    expect(periodAt(p, NaN)).toBeNull();
  });

  it('follows the one constant: a different gap moves every edge', () => {
    const p = periodsFor([{ view: 'a', from: 0, until: 10, clubs: ['a'] }, { view: 'b', from: 10, until: 20, clubs: ['b'] }], 3);
    expect(p.map((x) => [x.view, x.from, x.until])).toEqual([['a', 0, 7], ['black', 7, 13], ['b', 13, 20]]);
  });
});

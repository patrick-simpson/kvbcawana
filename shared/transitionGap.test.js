import { describe, expect, it } from 'vitest';
import {
  TRANSITION_GAP_MIN, WELCOME_MS, clubIdOf, emptyWelcomes, gapAround, inTransitionGap, periodAt, periodsFor, welcomeFor, welcomeWords, welcomesUp,
} from './transitionGap.js';

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

describe('the gap welcomes (owner 2026-10-17; the classroom and the Journey kiosk)', () => {
  const ci = (id, firstName, club, extra = {}) => ({ id, firstName, club, ...extra });
  it('one card per club of the moment, deduped by id, up WELCOME_MS after the latest arrival', () => {
    const clubs = ['journey', 'trek'];
    let r = welcomeFor(emptyWelcomes(), ci('a', 'Ava', 'Journey'), clubs, 0);
    expect(r.ding).toBe(true);
    r = welcomeFor(r.state, ci('b', 'Ben', 'Trek'), clubs, 1000);
    r = welcomeFor(r.state, ci('e', 'Eli', 'Journey', { oneOff: true }), clubs, 2000);
    expect(r.state.cards.journey.names).toEqual(['Ava', 'Eli']);
    expect(r.state.cards.trek.names).toEqual(['Ben']);
    expect(welcomeFor(r.state, ci('a', 'Ava', 'Journey'), clubs, 3000).ding).toBe(false);
    expect(welcomeFor(r.state, ci('t', 'Tom', 'T&T'), clubs, 3000).ding).toBe(false);
    expect(welcomesUp(r.state, clubs, 2000 + WELCOME_MS - 1)).toEqual(['journey']);
    expect(welcomesUp(r.state, clubs, 1000 + WELCOME_MS - 1)).toEqual(['journey', 'trek']);
    expect(welcomesUp(r.state, clubs, 2000 + WELCOME_MS)).toEqual([]);
    expect(WELCOME_MS).toBe(20 * 1000);
  });

  it('reads clubs and words the same for every screen', () => {
    expect(['Cubbies', 'Truth & Training', 'T&T', 'Trek', 'Journey', 'Puggles', 'Sparks', 'Leaders'].map(clubIdOf))
      .toEqual(['cubbies', 'tnt', 'tnt', 'trek', 'journey', 'puggles', 'sparks', '']);
    expect(welcomeWords(['Ava'])).toBe('Ava!');
    expect(welcomeWords(['Ava', 'Ben', 'Cara'])).toBe('Ava, Ben & Cara!');
    expect(welcomeWords(['A', 'B', 'C', 'D', 'E', 'F'])).toBe('A, B, C, D & 2 more!');
  });
});

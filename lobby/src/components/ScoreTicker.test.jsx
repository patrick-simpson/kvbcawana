import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import ScoreTicker from './ScoreTicker.jsx';
import { ZeroAnimationContext } from '../lib/motion.jsx';

// The lobby's score bar (owner 2026-11-05, option A): the club, one chip per
// team, the clock; a point bumps its chip with a "+1" and a sweep; a point
// that lands while the bar is down (a name on screen) only shows as its new
// number when the bar comes back.
const scores = (blue, red, yellow, green) => ({ blue, red, yellow, green });
const view = (s, extra = {}) => ({ club: 'tnt', teams: ['blue', 'red', 'yellow', 'green'], scores: s, final: false, won: [], ...extra });
const bar = (v, active = true, clock = null) => (
  <ZeroAnimationContext.Provider value>
    <ScoreTicker view={v} active={active} clock={clock} serverNow={() => Date.now()} />
  </ZeroAnimationContext.Provider>
);

describe('ScoreTicker', () => {
  afterEach(cleanup);

  it('draws the club and the four teams in the phone\'s order', () => {
    const { container } = render(bar(view(scores(12, 9, 14, 7))));
    // Owner 2026-11-05: no LIVE tag while the game is on.
    expect(container.querySelector('.score-ticker__live')).toBeNull();
    const teams = [...container.querySelectorAll('.score-ticker__team')];
    expect(teams.map((t) => t.dataset.team)).toEqual(['blue', 'red', 'yellow', 'green']);
    expect(teams.map((t) => t.querySelector('.score-ticker__num').textContent)).toEqual(['12', '9', '14', '7']);
    expect(container.querySelector('.score-ticker__clock').dataset.kind).toBe('game');
  });

  it('a point bumps that chip with its +1 and sweeps the bar', () => {
    const { container, rerender } = render(bar(view(scores(0, 9, 0, 0))));
    expect(container.querySelector('.score-ticker__plus')).toBeNull();
    rerender(bar(view(scores(0, 10, 0, 0))));
    const red = container.querySelector('[data-team="red"]');
    expect(red.querySelector('.score-ticker__plus').textContent).toBe('+1');
    expect(red.querySelector('.score-ticker__ring')).not.toBeNull();
    expect(container.querySelector('.score-ticker__sweep')).not.toBeNull();
    expect(container.querySelector('[data-team="blue"] .score-ticker__plus')).toBeNull();
  });

  it('a removed point ticks down quietly', () => {
    const { container, rerender } = render(bar(view(scores(4, 0, 0, 0))));
    rerender(bar(view(scores(3, 0, 0, 0))));
    expect(container.querySelector('.score-ticker__plus')).toBeNull();
    expect(container.querySelector('[data-team="blue"] .score-ticker__num').textContent).toBe('3');
  });

  it('steps aside while a name has the foot, and comes back with the new numbers, no replayed +1', async () => {
    const { container, rerender } = render(bar(view(scores(0, 0, 0, 0))));
    rerender(bar(view(scores(0, 0, 0, 0)), false));
    await waitFor(() => expect(container.querySelector('.score-ticker')).toBeNull());
    rerender(bar(view(scores(0, 2, 0, 0)), false));
    rerender(bar(view(scores(0, 2, 0, 0)), true));
    expect(container.querySelector('[data-team="red"] .score-ticker__num').textContent).toBe('2');
    expect(container.querySelector('.score-ticker__plus')).toBeNull();
  });

  it('two teams: two chips', () => {
    const { container } = render(bar(view({ boys: 3, girls: 5 }, { teams: ['boys', 'girls'] })));
    expect(container.querySelectorAll('.score-ticker__team')).toHaveLength(2);
    expect(container.querySelector('.score-ticker').dataset.count).toBe('2');
  });

  it('the finale: FINAL, the winner named in the clock slot and its chip marked', () => {
    const { container } = render(bar(view(scores(3, 9, 1, 0), { final: true, won: ['red'] })));
    expect(container.querySelector('.score-ticker__live').textContent).toBe('Final');
    expect(container.querySelector('.score-ticker__clock').textContent).toMatch(/Winner.*RED/);
    expect(container.querySelector('[data-team="red"]').dataset.won).toBe('1');
  });

  it('a running stopwatch takes the clock slot', () => {
    const clock = { id: 1, kind: 'stopwatch', startedAt: Date.now() - 83400, elapsedMs: 0, durationMs: null };
    const { container } = render(bar(view(scores(0, 0, 0, 0)), true, clock));
    const slot = container.querySelector('.score-ticker__clock');
    expect(slot.dataset.kind).toBe('stopwatch');
    expect(slot.textContent).toMatch(/Stopwatch.*1:23/);
  });
});

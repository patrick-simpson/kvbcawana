import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

// The game time scoreboard on the wall (owner 2026-11-05): the four plates in
// the phone's 2 x 2, the leader tagged, everything else in the strip, a
// takeover (and a chime) per point, shared by points close together, nothing
// for a removed point, and the game clock out of the strip once time is up.
vi.mock('../lib/stingers.js', () => ({ playStinger: vi.fn(), playTones: vi.fn() }));
vi.mock('../hooks/useBirthdays.js', () => ({ useBirthdays: () => [] }));

import { playTones } from '../lib/stingers.js';
import { ScoringView } from './ScoringView.jsx';
import { ScoreFinale } from '../components/ScoreFinale.jsx';

const WINDOWS = [
  { kind: 'game', clubs: ['tnt'], startMin: 18 * 60 + 5, endMin: 18 * 60 + 30 },
  { kind: 'game', clubs: ['cubbies', 'puggles'], startMin: 19 * 60, endMin: 19 * 60 + 30 },
];
const NOW = new Date(2026, 10, 4, 18, 17, 19);
const scores = (blue, red, yellow, green) => ({ blue, red, yellow, green });

const view = (s, extra = {}) => (
  <ScoringView now={NOW} club="tnt" scores={s} clock={null} serverNow={() => Date.now()} windows={WINDOWS} tally={null} {...extra} />
);

describe('ScoringView', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('draws the four teams blue, red, yellow, green, with the leader tagged', () => {
    const { container } = render(view(scores(12, 9, 14, 7)));
    const teams = [...container.querySelectorAll('.pj-score__team')];
    expect(teams.map((t) => t.dataset.team)).toEqual(['blue', 'red', 'yellow', 'green']);
    expect(teams.map((t) => t.querySelector('.pj-score__num').textContent)).toEqual(['12', '9', '14', '7']);
    expect(container.querySelector('[data-team="yellow"]').textContent).toMatch(/Leading/);
    expect(container.querySelectorAll('.pj-score__lead')).toHaveLength(1);
  });

  it('no LEADING tag on a tie at the top', () => {
    const { container } = render(view(scores(5, 5, 1, 0)));
    expect(container.querySelector('.pj-score__lead')).toBeNull();
  });

  it('the strip carries the game clock with its end time', () => {
    const { container } = render(view(scores(0, 0, 0, 0)));
    expect(container.querySelector('.pj-score__strip').textContent).toMatch(/GAME ENDS 6:30/i);
    expect(container.querySelector('.pj-score__strip').textContent).toMatch(/12:41/);
  });

  it('before the club\'s game starts the strip says when it runs, not an hour-long countdown', () => {
    const { container } = render(view(scores(0, 0, 0, 0), { club: 'cubbies', now: new Date(2026, 10, 4, 18, 17) }));
    const strip = container.querySelector('.pj-score__strip').textContent;
    expect(strip).toMatch(/GAME TIME/i);
    expect(strip).toMatch(/7:00–7:30/);
    expect(strip).not.toMatch(/72:/);
  });

  it('the game clock leaves the strip once time is up; the scores stay', () => {
    const { container } = render(view(scores(3, 0, 0, 0), { now: new Date(2026, 10, 4, 18, 45) }));
    expect(container.querySelector('.pj-score__gameclock')).toBeNull();
    expect(container.querySelector('[data-team="blue"] .pj-score__num').textContent).toBe('3');
  });

  it('Cubbies share their game time with Puggles: both marks in the strip', () => {
    const { container } = render(view(scores(0, 0, 0, 0), { club: 'cubbies', now: new Date(2026, 10, 4, 19, 10) }));
    expect([...container.querySelectorAll('.pj-score__mark, .pj-score__markword')].length).toBe(2);
  });

  it('a point takes the wall over with the team and its new total, and chimes', () => {
    const { container, rerender } = render(view(scores(0, 9, 0, 0)));
    expect(container.querySelector('.pj-take')).toBeNull();
    rerender(view(scores(0, 10, 0, 0)));
    const take = container.querySelector('.pj-take');
    expect(take.dataset.teams).toBe('red');
    expect(take.textContent).toMatch(/RED \+1!/);
    expect(take.textContent).toMatch(/10 POINTS/);
    expect(playTones).toHaveBeenCalledTimes(1);
  });

  it('the phone\'s sound switch makes the chime play even with the projector\'s own switch off', () => {
    const { rerender } = render(view(scores(0, 0, 0, 0), { sounds: true }));
    rerender(view(scores(0, 1, 0, 0), { sounds: true }));
    expect(playTones.mock.calls.at(-1)[2]).toEqual({ force: true });
    rerender(view(scores(0, 2, 0, 0), { sounds: false }));
    expect(playTones.mock.calls.at(-1)[2]).toEqual({ force: false });
  });

  it('points close together share one takeover, split', () => {
    const { container, rerender } = render(view(scores(0, 0, 0, 0)));
    rerender(view(scores(0, 1, 0, 0)));
    act(() => { vi.advanceTimersByTime(600); });
    rerender(view(scores(1, 1, 0, 0)));
    const takes = container.querySelectorAll('.pj-take');
    expect(takes[takes.length - 1].dataset.teams).toBe('blue red');
    expect(container.querySelectorAll('.pj-take__band').length).toBeGreaterThanOrEqual(2);
  });

  it('a removed point ticks down quietly: no takeover, no chime', () => {
    const { container, rerender } = render(view(scores(4, 0, 0, 0)));
    rerender(view(scores(3, 0, 0, 0)));
    expect(container.querySelector('.pj-take')).toBeNull();
    expect(playTones).not.toHaveBeenCalled();
  });

  it('the stopwatch takes the middle and the plates go compact', () => {
    const clock = { id: 1, kind: 'stopwatch', startedAt: null, elapsedMs: 83400, durationMs: null };
    const { container } = render(view(scores(1, 2, 3, 4), { clock }));
    expect(container.querySelector('.pj-score').dataset.compact).toBe('1');
    expect(container.querySelector('.pj-score-clock')).not.toBeNull();
  });
});

describe('ScoreFinale', () => {
  afterEach(cleanup);

  it('names the winner over the final scores', () => {
    const { container } = render(<ScoreFinale club="tnt" scores={scores(12, 9, 14, 7)} still />);
    expect(container.textContent).toMatch(/T&T · Final/);
    expect(container.textContent).toMatch(/YELLOW WINS!/);
    expect(container.querySelector('[data-won="1"]').textContent).toMatch(/YELLOW/);
    expect(container.querySelector('.pj-finale').dataset.ink).toBe('ink');
  });

  it('shares a tie, the field split in the tied colours', () => {
    const { container } = render(<ScoreFinale club="sparks" scores={scores(7, 2, 1, 7)} still />);
    expect(container.textContent).toMatch(/IT'S A TIE!/);
    expect(container.querySelectorAll('.pj-finale__field > span')).toHaveLength(2);
    expect(container.querySelectorAll('[data-won="1"]')).toHaveLength(2);
  });
});

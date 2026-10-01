import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { GameTimeView } from './GameTimeView.jsx';

// The wrap-up warning is the point of this suite: the badge appears at
// the right two moments, the chime fires ONCE per flip (never again on
// a re-render — the clock re-renders every second), and both go quiet
// once the window is actually over.
vi.mock('../lib/stingers.js', () => ({ playStinger: vi.fn() }));
const { roster } = vi.hoisted(() => ({ roster: { list: [] } }));
vi.mock('../hooks/useBirthdays.js', () => ({ useBirthdays: () => roster.list }));

import { playStinger } from '../lib/stingers.js';
import { HOUSE, WARNING_TONES } from '../lib/kit.js';

const GAME_WINDOW = { kind: 'game', clubs: ['tnt'], title: 'T&T Game Time', startMin: 18 * 60 + 5 };
const ENDS_AT = new Date('2026-09-16T18:30:00');
/** `now` that leaves exactly `seconds` on the game clock. */
const nowFor = (seconds) => new Date(ENDS_AT.getTime() - seconds * 1000);

const view = (seconds) => (
  <GameTimeView now={nowFor(seconds)} window={GAME_WINDOW} endsAt={ENDS_AT} tally={null} />
);

describe('GameTimeView wrap-up warning', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('shows no warning badge with more than two minutes left', () => {
    const { container } = render(view(121));
    expect(container.textContent).not.toMatch(/two minutes/i);
    expect(container.textContent).not.toMatch(/30 seconds/i);
    expect(container.querySelector('[data-warning]')).toBeNull();
  });

  it('shows TWO MINUTES at the two-minute mark', () => {
    const { container } = render(view(120));
    expect(container.textContent).toMatch(/TWO MINUTES/);
    expect(container.querySelector('[data-warning="two-minute"]')).not.toBeNull();
  });

  it('shows LAST 30 SECONDS for the final call', () => {
    const { container } = render(view(30));
    expect(container.textContent).toMatch(/LAST 30 SECONDS/);
    expect(container.querySelector('[data-warning="final-thirty"]')).not.toBeNull();
  });

  it('drops the badge once the clock reaches zero — the window is over', () => {
    const { container } = render(view(0));
    expect(container.querySelector('[data-warning]')).toBeNull();
  });

  it('keeps the rest of the screen intact while warning, the end time included', () => {
    const { container } = render(view(60));
    expect(container.textContent).toMatch(/GAME TIME!/);
    // The warning chip carries the end time on its label.
    expect(container.querySelector('[data-warning]').textContent).toMatch(/GAME ENDS 6:30 PM/);
  });

  it('says when the game ends on a stepped chip in the club\'s deep shade', () => {
    const { container } = render(view(600));
    const chip = container.querySelector('[role="img"][aria-label="GAME ENDS 6:30 PM"]');
    expect(chip).not.toBeNull();
    expect(chip.querySelector('path').getAttribute('fill')).toBe('#2F8A4E');
  });

  it('paints each warning in the kit\'s own tones', () => {
    const plate = (seconds) => render(view(seconds)).container
      .querySelector('[data-warning] path').getAttribute('fill');
    expect(plate(100)).toBe(WARNING_TONES['two-minute'].plate);
    cleanup();
    expect(plate(20)).toBe(WARNING_TONES['final-thirty'].plate);
  });
});

describe('GameTimeView in the kit', () => {
  afterEach(() => {
    cleanup();
    roster.list = [];
  });

  it('shows the live tally as a CHECKED IN chip, and hides a stale one', () => {
    const tally = { counts: { 'T&T': 23 }, total: 23, at: new Date(nowFor(600).getTime() - 60_000) };
    const fresh = render(<GameTimeView now={nowFor(600)} window={GAME_WINDOW} endsAt={ENDS_AT} tally={tally} />);
    expect(fresh.container.querySelector('[aria-label="CHECKED IN 23"]')).not.toBeNull();
    cleanup();
    const stale = { ...tally, at: new Date(nowFor(600).getTime() - 11 * 60_000) };
    const old = render(<GameTimeView now={nowFor(600)} window={GAME_WINDOW} endsAt={ENDS_AT} tally={stale} />);
    expect(old.container.querySelector('[aria-label^="CHECKED IN"]')).toBeNull();
  });

  it('greets this week\'s birthdays on the hot chip, with no age anywhere', () => {
    roster.list = [{ name: 'Ivy', month: 9, day: 17, club: 'tnt' }];
    const { container } = render(view(600));
    const chip = container.querySelector('[aria-label="HAPPY BIRTHDAY Ivy"]');
    expect(chip).not.toBeNull();
    expect(chip.querySelector('path').getAttribute('fill')).toBe(HOUSE.hot);
    expect(container.textContent).not.toMatch(/\bturns\b|\byears?\b/i);
  });

  it('shows the club\'s white knockout mark (the one that reads on black)', () => {
    const { container } = render(view(600));
    const mark = [...container.querySelectorAll('img')].find((i) => i.getAttribute('alt') === 'T&T');
    expect(mark.getAttribute('src')).toMatch(/tnt-white\.svg$/);
  });
});

describe('GameTimeView warning chime', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('fires once per flip and never again on a re-render', () => {
    const { rerender } = render(view(130));
    expect(playStinger).not.toHaveBeenCalled();

    rerender(view(120));
    expect(playStinger).toHaveBeenCalledTimes(1);
    expect(playStinger).toHaveBeenLastCalledWith(0.5);

    // Every second of the next minute and a half re-renders this view;
    // none of those ticks may re-announce.
    for (const seconds of [119, 90, 61, 45, 31]) rerender(view(seconds));
    expect(playStinger).toHaveBeenCalledTimes(1);

    rerender(view(30));
    expect(playStinger).toHaveBeenCalledTimes(2);
    expect(playStinger).toHaveBeenLastCalledWith(1);

    for (const seconds of [29, 10, 1]) rerender(view(seconds));
    expect(playStinger).toHaveBeenCalledTimes(2);
  });

  it('does not announce a state the screen opened in the middle of twice', () => {
    const { rerender } = render(view(45));
    expect(playStinger).toHaveBeenCalledTimes(1);
    rerender(view(44));
    rerender(view(40));
    expect(playStinger).toHaveBeenCalledTimes(1);
  });

  it('stays silent through a window with no warning left to give', () => {
    const { rerender } = render(view(600));
    rerender(view(500));
    rerender(view(300));
    expect(playStinger).not.toHaveBeenCalled();
  });
});

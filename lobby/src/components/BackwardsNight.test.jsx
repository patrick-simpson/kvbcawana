import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { ZeroAnimationContext } from '../lib/motion.jsx';
import { BackwardsContext } from '../hooks/useBackwards.js';
import { flipBurst } from '../lib/confetti.js';
import { hostBackwards } from '../lib/embed.js';
import { EMBED_BACKWARDS_MESSAGE } from '../lib/constants.js';
import CheckInMoment from './CheckInMoment.jsx';
import VhsRewind from './VhsRewind.jsx';

vi.mock('../lib/audio.js', () => ({ playChime: vi.fn(), playBirthdayChime: vi.fn(), playFirstTimerChime: vi.fn(), playCoinClink: vi.fn() }));

afterEach(() => { cleanup(); vi.useRealTimers(); });

const backwards = (ui, on = true) => (
  <ZeroAnimationContext.Provider value><BackwardsContext.Provider value={on}>{ui}</BackwardsContext.Provider></ZeroAnimationContext.Provider>
);
const kid = (extra = {}) => ({ id: 1, firstName: 'Liam', club: 'Sparks', isBirthday: false, isFirstTimer: false, welcomeBack: false, milestone: null, presentation: 'replay', ...extra });

describe('Backwards Night on the lobby (owner 2026-11-23)', () => {
  it('spells the welcome backwards: the name, the kicker and "+N SHARES!"', () => {
    const { container } = render(backwards(<CheckInMoment event={kid({ sharesGained: 2 })} />));
    expect(container.querySelector('.checkin__name').textContent).toBe('MAIL');
    const plain = render(backwards(<CheckInMoment event={kid()} />, false)).container.querySelector('.checkin__kicker').textContent;
    expect(container.querySelector('.checkin__kicker').textContent).toBe([...plain].reverse().join(''));
    expect(container.querySelector('.checkin__shares').textContent).toBe('!SERAHS 2+');
  });

  it('an ordinary night is untouched', () => {
    const { container } = render(backwards(<CheckInMoment event={kid()} />, false));
    expect(container.querySelector('.checkin__name').textContent).toBe('LIAM');
  });

  it('confetti and coins are thrown upside down: mirrored place and angle, gravity up', () => {
    expect(flipBurst({ origin: { x: 0.3, y: -0.05 }, angle: 270, gravity: 1 })).toMatchObject({ origin: { x: 0.3, y: 1.05 }, angle: 90, gravity: -0.7 });
    const b = flipBurst({ origin: { x: 0, y: 0.78 }, angle: 60 });
    expect(b.origin.y).toBeCloseTo(0.22);
    expect(b).toMatchObject({ angle: 300, gravity: -0.7 });
  });

  it('a framing host is told with its own message and nothing else', () => {
    expect(hostBackwards(true)).toEqual({ type: EMBED_BACKWARDS_MESSAGE, on: true });
    expect(hostBackwards('yes')).toEqual({ type: EMBED_BACKWARDS_MESSAGE, on: false });
  });

  it('the VHS rewind waits for a quiet moment, plays once, then waits its turn', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<VhsRewind on busy every={60000} first={1000} />);
    act(() => { vi.advanceTimersByTime(1500); });
    expect(container.querySelector('.vhs')).toBe(null);          // a name is up: it waits
    rerender(<VhsRewind on busy={false} every={60000} first={1000} />);
    expect(container.querySelector('.vhs__tag').textContent).toBe('◀◀ REW');
    act(() => { vi.advanceTimersByTime(3000); });
    expect(container.querySelector('.vhs')).toBe(null);
    rerender(<VhsRewind on={false} busy={false} every={60000} first={1000} />);
    act(() => { vi.advanceTimersByTime(120000); });
    expect(container.querySelector('.vhs')).toBe(null);
  });
});

describe('the share banner (owner 2026-11-23)', () => {
  it('names the children and the amount; spelled backwards on Backwards Night', async () => {
    const { default: ShareBanner } = await import('./ShareBanner.jsx');
    const gift = { kids: [{ firstName: 'Ava', club: 'Sparks' }, { firstName: 'Ben', club: 'T&T' }], shares: 3 };
    const a = render(backwards(<ShareBanner gift={gift} />, false));
    expect(a.container.querySelector('.share-banner__names').textContent).toBe('AVA & BEN');
    expect(a.container.querySelector('.share-banner__line').textContent).toBe('got 3 shares each!');
    a.unmount();
    const b = render(backwards(<ShareBanner gift={gift} />));
    expect(b.container.querySelector('.share-banner__names').textContent).toBe('NEB & AVA');
  });
  it('a framing host is handed first names, clubs and the amount only', async () => {
    const { hostShares } = await import('../lib/embed.js');
    expect(hostShares({ kids: [{ firstName: 'Ava', club: 'Sparks', lastName: 'Stone' }], shares: 2 }))
      .toEqual({ type: 'awana-display:shares', kids: [{ firstName: 'Ava', club: 'Sparks' }], shares: 2 });
  });
});

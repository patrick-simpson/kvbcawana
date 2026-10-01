import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ZeroAnimationContext } from '../lib/motion.jsx';
import CheckoutBoard from './CheckoutBoard.jsx';
import { getClubPalette } from '../lib/clubs.js';

// The board's visibility and naming rules live in src/lib/checkoutBoard.js
// (decideBoard, tested there); this pins that the kit card renders each
// decision it is handed with its wording intact.
afterEach(cleanup);
const still = (ui) => render(<ZeroAnimationContext.Provider value>{ui}</ZeroAnimationContext.Provider>);

const checkout = {
  entries: [
    { firstName: 'Sample Star', club: 'Sparks' },
    { firstName: 'Demo Kid', club: 'Sparks' },
    { firstName: 'Test Kid', club: 'T&T' },
  ],
  printed: 43,
  at: Date.now(),
};

describe('CheckoutBoard', () => {
  it('renders nothing for a hidden decision', () => {
    const { container } = still(<CheckoutBoard decision={{ state: 'hidden' }} checkout={checkout} />);
    expect(container.innerHTML).toBe('');
  });

  it('names each child as a chip in their club\'s colour, one column per club, with the honest foot', () => {
    const { container } = still(<CheckoutBoard decision={{ state: 'names', ageMin: 3 }} checkout={checkout} />);
    const board = container.querySelector('.checkout-board.names');
    expect(board.querySelector('.checkout-title').textContent).toBe('Still to be picked up');
    const columns = [...board.querySelectorAll('.checkout-column')];
    // Youngest club first, as the clubs stand: Sparks before T&T.
    expect(columns.map((c) => c.querySelector('.checkout-column__mark').getAttribute('alt'))).toEqual(['Sparks', 'T&T']);
    expect(board.style.getPropertyValue('--columns')).toBe('2');
    const [sparks] = columns;
    expect(sparks.style.getPropertyValue('--club')).toBe(getClubPalette('Sparks').primary);
    expect(sparks.querySelector('.checkout-column__count').textContent).toBe('2 waiting');
    expect([...sparks.querySelectorAll('.checkout-name__chip')].map((c) => c.textContent)).toEqual(['Demo Kid', 'Sample Star']);
    // Still reads as a list, separators and all.
    expect(sparks.querySelector('.checkout-names').textContent).toBe('Demo Kid · Sample Star');
    const foot = board.querySelector('.checkout-foot');
    expect(foot.querySelector('.checkout-count').textContent).toBe('3');
    expect(foot.textContent).toBe('3 not checked out yet · 43 labels printed tonight · updated 3 min ago');
    expect(board.textContent).not.toMatch(/still in the building/i);
    expect(board.querySelector('.checkout-demo')).toBeNull();
  });

  it('a club the clubs table does not know still gets a column, by name', () => {
    const odd = { ...checkout, entries: [...checkout.entries, { firstName: 'Visitor', club: 'Guests' }] };
    const { container } = still(<CheckoutBoard decision={{ state: 'names', ageMin: 0 }} checkout={odd} />);
    const last = [...container.querySelectorAll('.checkout-column')].at(-1);
    expect(last.querySelector('.checkout-column__name').textContent).toBe('Guests');
  });

  it('a demo says so on the card and in the foot', () => {
    const { container } = still(<CheckoutBoard decision={{ state: 'names', ageMin: 30 }} checkout={checkout} demo />);
    expect(container.querySelector('.checkout-demo').textContent).toBe('Demo · sample names');
    expect(container.querySelector('.checkout-foot').textContent).toMatch(/a demo, not real children$/);
    expect(container.querySelector('.checkout-foot').textContent).not.toMatch(/updated/);
  });

  it('names nobody when the decision is anonymous', () => {
    const { container } = still(<CheckoutBoard decision={{ state: 'anonymous', ageMin: 0 }} checkout={checkout} />);
    expect(container.querySelector('.checkout-name__chip')).toBeNull();
    expect(container.textContent).not.toMatch(/Demo Kid|Sample Star|Test Kid/);
    expect(container.textContent).toContain('Almost everyone has been picked up. Please see the check-in desk.');
  });

  it('keeps the stale and empty wording', () => {
    const stale = still(<CheckoutBoard decision={{ state: 'stale', ageMin: 20 }} checkout={checkout} />).container;
    expect(stale.textContent).toContain('This list stopped updating about 20 min ago — please check with the check-in desk rather than relying on it.');
    cleanup();
    const empty = still(<CheckoutBoard decision={{ state: 'empty', ageMin: 0 }} checkout={{ ...checkout, entries: [] }} />).container;
    expect(empty.textContent).toContain('Everyone has been checked out. Thanks for a great night!');
  });
});

describe('a name chip with a tall mark', () => {
  // Paytone One carries a capital's mark up to the pill's top edge (É) or
  // through it (Ấ), onto the white card: that name sits lower in the same
  // pill (overlayFit.js nameChipSeat). jsdom has no canvas, so the ink is
  // markExtents' estimate from the marks.
  it('seats a marked capital lower and leaves every plain name alone', () => {
    const board = { ...checkout, entries: [{ firstName: 'Élodie', club: 'Sparks' }, { firstName: 'Ava', club: 'Sparks' }, { firstName: 'Ấn', club: 'Sparks' }] };
    const { container } = still(<CheckoutBoard decision={{ state: 'names', ageMin: 0 }} checkout={board} />);
    const seat = Object.fromEntries([...container.querySelectorAll('.checkout-name__chip')]
      .map((c) => [c.textContent, c.style.getPropertyValue('--seat')]));
    expect(seat['Ava']).toBe('');
    expect(seat['Élodie']).toMatch(/^0\.\d+em$/);
    expect(parseFloat(seat['Ấn'])).toBeGreaterThan(parseFloat(seat['Élodie']));
  });
});

describe('CheckoutBoard at the foot', () => {
  // Where it goes is overlayFit.js boardPlacement; at the foot it is one line
  // beside the slides, in the same words.
  it('lists nobody at the foot: a live list there is its honest count line', () => {
    const { container } = still(<CheckoutBoard decision={{ state: 'names', ageMin: 3 }} checkout={checkout} placement="foot" />);
    expect(container.querySelector('.checkout-region--foot')).not.toBeNull();
    const board = container.querySelector('.checkout-board.names.checkout-board--foot');
    expect(board.querySelector('.checkout-title').textContent).toBe('Still to be picked up');
    // A partial list must never pass for the whole one: no names at all.
    expect(board.querySelector('.checkout-name__chip')).toBeNull();
    expect(board.textContent).not.toMatch(/Demo Kid|Sample Star|Test Kid/);
    expect(board.querySelector('.checkout-foot').textContent)
      .toBe('3 not checked out yet · 43 labels printed tonight · updated 3 min ago');
  });

  it('keeps the stale, empty and anonymous wording at the foot', () => {
    const stale = still(<CheckoutBoard decision={{ state: 'stale', ageMin: 1560 }} checkout={checkout} placement="foot" />).container;
    expect(stale.querySelector('.checkout-board--foot').textContent)
      .toContain('This list stopped updating about 1560 min ago — please check with the check-in desk rather than relying on it.');
    cleanup();
    const empty = still(<CheckoutBoard decision={{ state: 'empty', ageMin: 0 }} checkout={{ ...checkout, entries: [] }} placement="foot" />).container;
    expect(empty.textContent).toContain('Everyone has been checked out. Thanks for a great night!');
    cleanup();
    const anon = still(<CheckoutBoard decision={{ state: 'anonymous', ageMin: 0 }} checkout={checkout} placement="foot" />).container;
    expect(anon.textContent).toContain('Almost everyone has been picked up. Please see the check-in desk.');
    expect(anon.textContent).not.toMatch(/\d+ not checked out/);
  });

  it('the middle is the default, and lists the names', () => {
    const { container } = still(<CheckoutBoard decision={{ state: 'names', ageMin: 0 }} checkout={checkout} />);
    expect(container.querySelector('.checkout-region--foot')).toBeNull();
    expect(container.querySelectorAll('.checkout-name__chip')).toHaveLength(3);
  });
});

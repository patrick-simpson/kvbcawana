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

  it('at pickup time names each child as a chip in their club\'s colour, after the club\'s plate, with the honest count line', () => {
    const { container } = still(<CheckoutBoard decision={{ state: 'names', ageMin: 3 }} checkout={checkout} />);
    // Always in the foot: the strip under the slides (owner, 2026-10-07).
    expect(container.querySelector('.checkout-region')).not.toBeNull();
    const board = container.querySelector('.checkout-board.names.checkout-board--list');
    expect(board.querySelector('.checkout-title').textContent).toBe('Still to be picked up');
    const clubs = [...board.querySelectorAll('.checkout-run > .checkout-club')];
    // Youngest club first, as the clubs stand: Sparks before T&T.
    expect(clubs.map((c) => c.querySelector('.checkout-plate__mark').getAttribute('alt'))).toEqual(['Sparks', 'T&T']);
    const [sparks] = clubs;
    expect(sparks.style.getPropertyValue('--club')).toBe(getClubPalette('Sparks').primary);
    expect(sparks.querySelector('.checkout-plate__count').textContent).toBe('2 waiting');
    expect([...sparks.querySelectorAll('.checkout-name__chip')].map((c) => c.textContent)).toEqual(['Demo Kid', 'Sample Star']);
    // Still reads as a list, separators and all.
    expect(sparks.querySelector('.checkout-names').textContent).toBe('Demo Kid · Sample Star');
    // Sized by the fit (unmeasured in jsdom: its 1080p box, in u).
    expect(board.style.getPropertyValue('--name-size')).toMatch(/^calc\([\d.]+ \* var\(--u\)\)$/);
    const foot = board.querySelector('.checkout-meta .checkout-foot');
    expect(foot.querySelector('.checkout-count').textContent).toBe('3');
    expect(foot.textContent).toBe('3 not checked out yet · 43 labels printed tonight · updated 3 min ago');
    expect(board.textContent).not.toMatch(/still in the building/i);
    expect(board.querySelector('.checkout-demo')).toBeNull();
    expect(board.querySelector('.checkout-more')).toBeNull();
  });

  it('a club the clubs table does not know still gets a plate, by name', () => {
    const odd = { ...checkout, entries: [...checkout.entries, { firstName: 'Visitor', club: 'Guests' }] };
    const { container } = still(<CheckoutBoard decision={{ state: 'names', ageMin: 0 }} checkout={odd} />);
    const last = [...container.querySelectorAll('.checkout-club')].at(-1);
    expect(last.querySelector('.checkout-plate__name').textContent).toBe('Guests');
    expect(last.querySelector('.checkout-plate__count').textContent).toBe('1 waiting');
  });

  it('the 60-entry cap never lists more than fits: the rest stand behind "+N more", every plate and the count line whole', () => {
    // Ten long names in each of six clubs, in jsdom's 1080p box at its rough
    // (wide) letter widths.
    const clubs = ['Puggles', 'Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey'];
    const names = ['Alexander', 'Charlotte', 'Benjamin', 'Isabella', 'Theodore', 'Penelope', 'Sebastian', 'Josephine', 'Nathaniel', 'Gabriella'];
    const big = { entries: clubs.flatMap((club) => names.map((firstName) => ({ firstName: `${firstName}-Rose`, club }))), printed: 60, at: Date.now() };
    const { container } = still(<CheckoutBoard decision={{ state: 'names', ageMin: 0 }} checkout={big} />);
    const plates = [...container.querySelectorAll('.checkout-plate__count')].map((p) => p.textContent);
    expect(plates).toEqual(Array(6).fill('10 waiting'));
    const shown = container.querySelectorAll('.checkout-name__chip').length;
    const more = [...container.querySelectorAll('.checkout-more')].map((m) => Number(/^\+(\d+) more$/.exec(m.textContent)[1]));
    expect(more.length).toBeGreaterThan(0);
    expect(shown + more.reduce((a, b) => a + b, 0)).toBe(60);
    expect(container.querySelector('.checkout-foot').textContent).toMatch(/^60 not checked out yet/);
  });

  it('a demo says so on the card and in the count line', () => {
    const { container } = still(<CheckoutBoard decision={{ state: 'names', ageMin: 30 }} checkout={checkout} demo />);
    expect(container.querySelector('.checkout-meta .checkout-demo').textContent).toBe('Demo · sample names');
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

describe('the one-line card', () => {
  // A stale or empty board, or the anonymous line, is one line on a small
  // card on the strip's floor, in the same words.
  it('the stale, empty and anonymous lines are one-line cards', () => {
    const stale = still(<CheckoutBoard decision={{ state: 'stale', ageMin: 1560 }} checkout={checkout} />).container;
    expect(stale.querySelector('.checkout-region .checkout-board--line').textContent)
      .toContain('This list stopped updating about 1560 min ago — please check with the check-in desk rather than relying on it.');
    expect(stale.querySelector('.checkout-run')).toBeNull();
    cleanup();
    const empty = still(<CheckoutBoard decision={{ state: 'empty', ageMin: 0 }} checkout={{ ...checkout, entries: [] }} />).container;
    expect(empty.querySelector('.checkout-board--line').textContent).toContain('Everyone has been checked out. Thanks for a great night!');
    cleanup();
    const anon = still(<CheckoutBoard decision={{ state: 'anonymous', ageMin: 0 }} checkout={checkout} />).container;
    expect(anon.querySelector('.checkout-board--line').textContent).toContain('Almost everyone has been picked up. Please see the check-in desk.');
    expect(anon.textContent).not.toMatch(/\d+ not checked out/);
    expect(anon.querySelector('.checkout-name__chip')).toBeNull();
  });
});

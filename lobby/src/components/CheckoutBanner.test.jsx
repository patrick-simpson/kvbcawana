import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ZeroAnimationContext } from '../lib/motion.jsx';
import CheckoutBanner from './CheckoutBanner.jsx';
import { getClubPalette } from '../lib/clubs.js';

// "<First name> has checked out" (owner, 2026-10-08). The rules about when a
// name may be said are src/lib/checkoutLeaves.js's; this pins the drawing.
afterEach(cleanup);
const still = (ui) => render(<ZeroAnimationContext.Provider value>{ui}</ZeroAnimationContext.Provider>);

describe('CheckoutBanner', () => {
  it('a named child: the club\'s colour and white mark, and the words', () => {
    const { container } = still(<CheckoutBanner item={{ id: 1, kind: 'name', firstName: 'Ava', club: 'Sparks' }} />);
    const banner = container.querySelector('.checkout-leaves .checkout-leave--name');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.style.getPropertyValue('--club')).toBe(getClubPalette('Sparks').primary);
    expect(banner.querySelector('.checkout-leave__mark').getAttribute('alt')).toBe('Sparks');
    expect(banner.querySelector('.checkout-leave__text').textContent).toBe('Ava has checked out');
  });

  it('"A child" carries no name, no club and no club colour', () => {
    const { container } = still(<CheckoutBanner item={{ id: 2, kind: 'child' }} />);
    const banner = container.querySelector('.checkout-leave--child');
    expect(banner.textContent).toBe('A child has checked out');
    expect(banner.querySelector('img')).toBeNull();
    expect(banner.style.getPropertyValue('--club')).toBe('');
  });

  it('"and N more" collapses a rush', () => {
    const { container } = still(<CheckoutBanner item={{ id: 3, kind: 'more', count: 4 }} />);
    expect(container.textContent).toBe('and 4 more have checked out');
  });

  it('nothing up, nothing drawn but its empty seat', () => {
    const { container } = still(<CheckoutBanner item={null} />);
    expect(container.querySelector('.checkout-leaves').textContent).toBe('');
  });
});

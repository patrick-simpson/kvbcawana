import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ZeroAnimationContext } from '../../lib/motion.jsx';
import BackwardsPromo, { BACKWARDS_LABEL, DETAILS } from './BackwardsPromo.jsx';

describe('the Backwards Night poster (owner 2026-11-23)', () => {
  it('rests on the readable poster: the owner\'s words, the date, the shares line', () => {
    const { container } = render(<ZeroAnimationContext.Provider value><BackwardsPromo /></ZeroAnimationContext.Provider>);
    const row = (sel) => [...container.querySelectorAll(sel)].map((el) => el.textContent).join('');
    expect(row('.backwards-promo__row:not(.backwards-promo__row--back) .backwards-promo__letter')).toBe('BACKWARDSNIGHT');
    expect(row('.backwards-promo__letter--back')).toBe('SDRAWKCABTHGIN');
    expect(container.querySelector('.backwards-promo__chip').textContent).toBe('Wed Jan 13');
    expect(container.querySelector('.backwards-promo__shares').textContent).toBe('Come backwards and you might win shares!');
    expect(container.querySelector('[role="img"]').getAttribute('aria-label')).toBe(BACKWARDS_LABEL);
    expect(BACKWARDS_LABEL).not.toMatch(/—/);
    expect(DETAILS.default).toEqual([]);
  });
});

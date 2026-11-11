import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ZeroAnimationContext } from '../../lib/motion.jsx';
import PromoSlide, { detailsFor } from '../PromoSlide.jsx';
import { DETAILS, VETERANS_LABEL } from './VeteransPromo.jsx';

// No global test setup file: clean up explicitly. Fake timers can't drive
// framer-motion, so these pin what is IN the DOM, not how it moves.
afterEach(cleanup);

const promo = (tonight = true) => ({
  id: 'promo_veterans', kind: 'veterans', eventDate: '2026-11-11', tonight,
  countdown: tonight ? 'Tonight!' : 'Next club night', durationSec: 10,
});
const mount = (still = false) => render(
  <ZeroAnimationContext.Provider value={still}>
    <PromoSlide promo={promo()} />
  </ZeroAnimationContext.Provider>,
);

describe('VeteransPromo', () => {
  it('is in the promo slot, in the lobby’s kit (not a poster)', () => {
    const { container } = mount();
    expect(container.querySelector('.promo-slide.promo-slide--veterans.veterans')).not.toBeNull();
  });

  it('says the two headline lines alone: no kicker over them, nothing under them', () => {
    const { container } = mount();
    // No small line naming the day and date (owner 2026-11-10).
    expect(container.querySelector('.veterans__kicker')).toBeNull();
    expect(container.textContent).not.toMatch(/Veterans Day|November/);
    expect([...container.querySelectorAll('.veterans__line')].map((l) => l.textContent)).toEqual(['Thank you,', 'veterans']);
    // No subtitle (owner 2026-11-10), no exclamation mark anywhere.
    expect(container.querySelector('.veterans__body, .veterans__sub, .veterans__read')).toBeNull();
    expect(container.textContent).not.toContain('!');
    expect(container.textContent.includes('Tonight we honor')).toBe(false);
  });

  it('is one labelled picture, its parts hidden from a screen reader', () => {
    const { container } = mount();
    const root = container.querySelector('.veterans');
    expect(root.getAttribute('role')).toBe('img');
    expect(root.getAttribute('aria-label')).toBe('Thank you, veterans.');
    expect(VETERANS_LABEL).toBe(root.getAttribute('aria-label'));
    for (const sel of ['.veterans__waves', '.veterans__tab', '.veterans__stage']) {
      expect(container.querySelector(sel).getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('draws three stars, three bands and the church logo', () => {
    const { container } = mount();
    expect(container.querySelectorAll('.veterans__star')).toHaveLength(3);
    expect(container.querySelectorAll('.veterans__band')).toHaveLength(3);
    expect(container.querySelector('.veterans__logo').getAttribute('src')).toMatch(/kvbc-awana-two-line-white/);
  });

  it('has no rotating detail lines', () => {
    expect(DETAILS.default).toEqual([]);
    expect(detailsFor(promo())).toEqual([]);
  });

  it('renders its finished frame under zero animation, same words, nothing hidden by motion', () => {
    const { container } = mount(true);
    expect(container.querySelectorAll('.veterans__line')).toHaveLength(2);
    expect(container.querySelectorAll('.veterans__star')).toHaveLength(3);
    // Never an unfinished frame: no piece is left at opacity 0 in its inline style.
    for (const el of container.querySelectorAll('.veterans *')) {
      expect(el.style.opacity === '0').toBe(false);
    }
  });

  it('draws nothing for an unknown kind', () => {
    const { container } = render(<PromoSlide promo={{ kind: 'nope' }} />);
    expect(container.firstChild).toBeNull();
  });
});

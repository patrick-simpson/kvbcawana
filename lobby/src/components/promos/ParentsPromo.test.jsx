import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ZeroAnimationContext } from '../../lib/motion.jsx';
import PromoSlide, { detailsFor } from '../PromoSlide.jsx';
import ParentsPromo, { DETAILS } from './ParentsPromo.jsx';

// No global test setup file in this repo, so RTL's automatic cleanup
// doesn't run: do it explicitly. Fake timers can't drive framer-motion
// (its frame loop captured the real requestAnimationFrame at import), so
// these pin what is IN the DOM, not how it moves.
afterEach(cleanup);

const promo = (extra = {}) => ({
  id: 'promo_parents',
  kind: 'parents',
  eventDate: '2026-11-04',
  tonight: false,
  countdown: '3 club nights left',
  afterContest: false,
  durationSec: 15,
  ...extra,
});

const mount = (p, still = false) => render(
  <ZeroAnimationContext.Provider value={still}>
    <PromoSlide promo={p} />
  </ZeroAnimationContext.Provider>,
);

// The assembled title is one span per glyph, so read its label, which is
// the whole string, rather than text content.
const titleOf = (container) => container.querySelector('.promo-par-title-text').getAttribute('aria-label');

describe('ParentsPromo', () => {
  it('keeps its detail copy exactly', () => {
    expect(DETAILS).toEqual({
      default: ['Spend the evening with your clubber', 'Posters due Oct 14', 'DEFEND poster voting that night'],
      afterContest: ['Spend the evening with your clubber', 'Vote for your favorite DEFEND poster'],
      tonight: ['Spend the evening with your clubber', 'Vote for your favorite DEFEND poster tonight'],
    });
    for (const lines of Object.values(DETAILS)) expect(Object.isFrozen(lines)).toBe(true);
    expect(Object.isFrozen(DETAILS)).toBe(true);
  });

  it('picks tonight over afterContest, and afterContest over default', () => {
    expect(detailsFor(promo())).toBe(DETAILS.default);
    expect(detailsFor(promo({ afterContest: true }))).toBe(DETAILS.afterContest);
    expect(detailsFor(promo({ tonight: true }))).toBe(DETAILS.tonight);
    expect(detailsFor({ kind: 'parents', tonight: true, afterContest: true })).toBe(DETAILS.tonight);
  });

  it('ends on the title, the date and the tagline by default', () => {
    const { container } = mount(promo());
    const slide = container.querySelector('.promo-slide.promo-slide--parents');
    expect(slide).not.toBeNull();
    expect(titleOf(container)).toBe('Parents’ Night');
    expect(container.querySelector('.promo-par-date').textContent).toBe('WEDNESDAY, NOVEMBER 4');
    expect(container.querySelector('.promo-par-tagline').textContent).toBe('Spend the evening with your clubber');
    expect(container.querySelector('.promo-chip').textContent).toBe('3 club nights left');
  });

  it('welcomes parents instead of dating the night when it is tonight', () => {
    const { container } = mount(promo({ tonight: true, afterContest: true, countdown: 'Tonight!' }));
    expect(titleOf(container)).toBe('Parents’ Night is tonight!');
    expect(container.querySelector('.promo-par-date').textContent).toBe('Welcome, parents!');
    expect(container.textContent).not.toContain('NOVEMBER');
    expect(container.querySelector('.promo-par-tagline').textContent).toBe('Spend the evening with your clubber');
    expect(container.querySelector('.promo-chip').textContent).toBe('Tonight!');
  });

  it('renders exactly one detail slot and one chip, and no chip without a label', () => {
    const { container } = mount(promo());
    expect(container.querySelectorAll('.promo-detail-slot')).toHaveLength(1);
    expect(container.querySelectorAll('.promo-chip')).toHaveLength(1);
    expect(container.querySelector('.promo-texture')).not.toBeNull();
    expect(container.querySelector('.promo-vignette')).not.toBeNull();
    cleanup();
    const { container: bare } = mount(promo({ countdown: null }));
    expect(bare.querySelector('.promo-chip')).toBeNull();
  });

  it('starts the detail line on the first string', () => {
    for (const p of [promo(), promo({ afterContest: true }), promo({ tonight: true })]) {
      const { container } = mount(p);
      expect(container.querySelector('.promo-detail').textContent).toBe(detailsFor(p)[0]);
      cleanup();
    }
  });

  it('renders the same facts under zero animation', () => {
    const { container } = mount(promo(), true);
    expect(titleOf(container)).toBe('Parents’ Night');
    expect(container.querySelector('.promo-par-date').textContent).toBe('WEDNESDAY, NOVEMBER 4');
    expect(container.querySelectorAll('.promo-detail-slot')).toHaveLength(1);
    // The frozen frame is already on the last line: the voting fact.
    expect(container.querySelector('.promo-detail').textContent).toBe('DEFEND poster voting that night');
  });

  it('never uses an em dash and keeps the curly apostrophe', () => {
    for (const extra of [{}, { afterContest: true }, { tonight: true }, { tonight: true, afterContest: true }]) {
      const { container } = render(<ParentsPromo promo={promo(extra)} lines={detailsFor(promo(extra))} />);
      const all = `${container.textContent} ${titleOf(container)} ${detailsFor(promo(extra)).join(' ')}`;
      expect(all).not.toContain('—');
      expect(all).not.toContain("'");
      expect(titleOf(container)).toContain('’');
      cleanup();
    }
  });
});

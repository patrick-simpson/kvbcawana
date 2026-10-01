import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import ContestPromo, { DETAILS, VERSE_REF } from './ContestPromo.jsx';
import { detailsFor } from '../PromoSlide.jsx';

// No global test setup file in this repo, so RTL's automatic cleanup
// doesn't run: do it explicitly.
afterEach(cleanup);

// Framer-motion runs on the real requestAnimationFrame, so these pin what
// is in the DOM (every beat's element is mounted from the first frame and
// only its keyframes move it), not the choreography itself.
const promo = (extra = {}) => ({
  id: 'promo_contest',
  kind: 'contest',
  eventDate: '2026-10-14',
  tonight: false,
  countdown: '3 club nights left',
  afterContest: false,
  durationSec: 15,
  ...extra,
});

function mount(extra) {
  const p = promo(extra);
  return render(<ContestPromo promo={p} lines={detailsFor(p)} />).container;
}

const letters = (c) => [...c.querySelectorAll('.promo-contest-letter')].map((el) => el.textContent).join('');

describe('ContestPromo', () => {
  it('keeps the detail copy exactly', () => {
    expect(DETAILS.default).toEqual([
      'Open to all clubbers',
      'Voting at Parents’ Night · Nov 4',
    ]);
    expect(DETAILS.tonight).toEqual([
      'Voting at Parents’ Night · Nov 4',
      '1 Peter 3:15 NKJV',
    ]);
    expect(Object.isFrozen(DETAILS)).toBe(true);
    expect(Object.isFrozen(DETAILS.default)).toBe(true);
    expect(Object.isFrozen(DETAILS.tonight)).toBe(true);
  });

  it('is handed the tonight lines on the deadline itself', () => {
    expect(detailsFor(promo())).toBe(DETAILS.default);
    expect(detailsFor(promo({ tonight: true }))).toBe(DETAILS.tonight);
  });

  it('carries every fact of the printed poster by default', () => {
    const c = mount();
    expect(c.querySelector('.promo-slide.promo-slide--contest')).not.toBeNull();
    expect(c.querySelector('.promo-contest-headline').textContent).toBe('Poster Contest');
    // DEFEND is one element per letter so each can be written and filled.
    expect(letters(c)).toBe('DEFEND');
    expect(c.textContent).toContain('Posters due');
    expect(c.querySelector('.promo-contest-due').textContent).toBe('WEDNESDAY, OCTOBER 14');
    // The verse reference is fixed text on the sign, so the frozen frame has
    // it even though the rotating line ends on the voting link.
    expect(c.querySelector('.promo-contest-verse').textContent).toBe(VERSE_REF);
    expect(c.querySelector('.promo-detail').textContent).toBe(DETAILS.default[0]);
    expect(c.querySelector('.promo-chip').textContent).toBe('3 club nights left');
    expect(c.textContent).not.toMatch(/tonight/i);
  });

  it('turns into the hand-it-in poster tonight', () => {
    const c = mount({ tonight: true, countdown: 'Tonight!' });
    expect(letters(c)).toBe('DEFEND');
    expect(c.textContent).toContain('Posters due tonight');
    expect(c.querySelector('.promo-contest-due').textContent).toBe('Hand yours in at the check-in desk');
    expect(c.querySelector('.promo-contest-stamp').textContent).toBe('Due tonight');
    // No date tonight, and the rotating line (ending on the verse
    // reference) carries the reference instead of the sign.
    expect(c.textContent).not.toContain('OCTOBER');
    expect(c.querySelector('.promo-contest-verse')).toBeNull();
    expect(DETAILS.tonight.at(-1)).toBe(VERSE_REF);
    expect(c.querySelector('.promo-chip').textContent).toBe('Tonight!');
  });

  it('gives the reference only, never the verse text', () => {
    for (const tonight of [false, true]) {
      const c = mount({ tonight });
      expect(c.textContent).not.toMatch(/sanctify|ready to give/i);
      cleanup();
    }
    for (const lines of Object.values(DETAILS)) {
      expect(lines.join(' ')).not.toMatch(/sanctify|ready to give/i);
    }
  });

  it('keeps the shared frame: one detail slot, one chip, the depth layers', () => {
    const c = mount();
    expect(c.querySelectorAll('.promo-detail-slot')).toHaveLength(1);
    expect(c.querySelectorAll('.promo-chip')).toHaveLength(1);
    expect(c.querySelector('.promo-texture')).not.toBeNull();
    expect(c.querySelector('.promo-vignette')).not.toBeNull();
    expect(c.querySelector('.promo-wordmark')).not.toBeNull();
  });

  it('drops the chip when there is nothing to count', () => {
    const c = mount({ countdown: null });
    expect(c.querySelector('.promo-chip')).toBeNull();
    expect(letters(c)).toBe('DEFEND');
  });

  it('uses no em dash in any variant or detail line', () => {
    for (const tonight of [false, true]) {
      const c = mount({ tonight, countdown: tonight ? 'Tonight!' : 'Next club night' });
      expect(c.textContent).not.toContain('—');
      cleanup();
    }
    for (const lines of Object.values(DETAILS)) {
      expect(lines.join(' ')).not.toContain('—');
    }
  });

  it('draws the same gallery and confetti on every render', () => {
    const a = mount().innerHTML;
    cleanup();
    expect(mount().innerHTML).toBe(a);
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import FinalistsPromo, { DETAILS, DIVISIONS, FINALISTS, FINALISTS_SEC, T, paradeBeats } from './FinalistsPromo.jsx';
import { detailsFor } from '../PromoSlide.jsx';
import { ZeroAnimationContext } from '../../lib/motion.jsx';
import { SEASON_PROMOS } from '../../lib/promos.js';

afterEach(cleanup);

// Framer-motion runs on the real requestAnimationFrame, so these pin what is
// in the DOM (every beat's element is mounted from the first frame and only
// its keyframes move it), not the choreography itself.
const promo = (extra = {}) => ({
  id: 'promo_finalists',
  kind: 'finalists',
  eventDate: '2026-11-04',
  tonight: false,
  countdown: 'Next club night',
  afterContest: true,
  durationSec: 21,
  ...extra,
});

function mount(extra, zero = false) {
  const p = promo(extra);
  return render(
    <ZeroAnimationContext.Provider value={zero}>
      <FinalistsPromo promo={p} lines={detailsFor(p)} />
    </ZeroAnimationContext.Provider>,
  ).container;
}

describe('FinalistsPromo', () => {
  it('keeps the detail copy exactly, with no em dashes', () => {
    expect(DETAILS.default).toEqual(['One vote in each division', 'Made by our clubbers']);
    expect(DETAILS.tonight).toEqual(['Last chance to vote', 'Voting ends tonight']);
    expect(Object.isFrozen(DETAILS)).toBe(true);
    for (const line of [...DETAILS.default, ...DETAILS.tonight]) expect(line).not.toMatch(/—/);
  });

  it('is handed the tonight lines on the last day of voting', () => {
    expect(detailsFor(promo())).toBe(DETAILS.default);
    expect(detailsFor(promo({ tonight: true }))).toBe(DETAILS.tonight);
  });

  it('carries every fact as fixed text on the end card', () => {
    const c = mount();
    expect(c.querySelector('.promo-slide.promo-slide--finalists')).not.toBeNull();
    expect(c.querySelector('.promo-fin-headline').textContent).toBe('Vote foryourfavorite!');
    expect(c.querySelector('.promo-fin-band-what').textContent).toBe('Voting ends');
    expect(c.textContent).not.toMatch(/Parents/);
    expect(c.querySelector('.promo-fin-band-date').textContent).toBe('WEDNESDAY, NOVEMBER 4');
    expect(c.textContent).toContain('Pick one in each division.');
    expect(c.querySelector('.promo-chip').textContent).toBe('Next club night');
  });

  it('shows the two divisions, Older Kids on top, each numbered 1 to 3 (the ballot’s numbers)', () => {
    const c = mount();
    expect(DIVISIONS).toEqual(['Older Kids', 'Younger Kids']);
    expect([...c.querySelectorAll('.promo-fin-row')].map((r) => r.textContent)).toEqual(['Older Kids', 'Younger Kids']);
    const frames = [...c.querySelectorAll('.promo-fin-frame')];
    expect(frames).toHaveLength(6);
    expect(frames.map((f) => f.querySelector('.promo-fin-badge').textContent)).toEqual(['1', '2', '3', '1', '2', '3']);
    expect(frames.map((f) => f.querySelector('img').getAttribute('src'))).toEqual(FINALISTS.map((f) => f.src));
    expect(frames.map((f) => f.querySelector('img').getAttribute('alt'))).toEqual([
      'Older Kids 1', 'Older Kids 2', 'Older Kids 3', 'Younger Kids 1', 'Younger Kids 2', 'Younger Kids 3',
    ]);
    expect([...c.querySelectorAll('.promo-fin-caption')].map((p) => p.textContent)).toEqual([
      'Older Kids No. 1', 'Older Kids No. 2', 'Older Kids No. 3', 'Younger Kids No. 1', 'Younger Kids No. 2', 'Younger Kids No. 3',
    ]);
  });

  it('says TONIGHT on the last day of voting', () => {
    const c = mount({ tonight: true, countdown: 'Tonight!' });
    expect(c.querySelector('.promo-fin-band-date').textContent).toBe('TONIGHT');
    expect(c.querySelector('.promo-slide').classList.contains('promo-fin--tonight')).toBe(true);
  });

  it('draws the finished end card under zero animation (the frame ?lowPower=1 shows)', () => {
    const c = mount({}, true);
    expect(c.querySelectorAll('.promo-fin-frame')).toHaveLength(6);
    // The rotating line rests on its last string.
    expect(c.querySelector('.promo-detail').textContent).toBe(DETAILS.default[DETAILS.default.length - 1]);
  });

  it('fits its beat sheet inside the hold the slideshow gives it', () => {
    expect(SEASON_PROMOS.find((p) => p.kind === 'finalists').durationSec).toBe(FINALISTS_SEC);
    // The parade ends before the call, and the last badge pulse well before the cut.
    expect(paradeBeats(5).landed).toBeLessThanOrEqual(T.call);
    expect(T.pulse + 5 * T.pulseStep + 0.5).toBeLessThan(FINALISTS_SEC);
    // One poster at a time takes the centre: each is presented after the one before.
    for (let i = 1; i < 6; i += 1) expect(paradeBeats(i).shown).toBeGreaterThan(paradeBeats(i - 1).glide);
  });
});

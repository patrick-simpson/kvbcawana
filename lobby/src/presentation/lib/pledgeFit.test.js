import { describe, expect, it } from 'vitest';
import { PLEDGE_FIT, fitPledge, rowsAt } from './pledgeFit.js';
import { AWANA_PLEDGE_TEXT, US_PLEDGE_TEXT } from '../config.js';

// Figtree SemiBold's widths, near enough (jsdom has no canvas): about 0.56em
// a letter, 0.26em a space.
const measure = (text) => (text === 'a a' ? 0.56 * 2 + 0.26 : text.length * 0.56);

describe('the pledges, as big as fits (owner, 2026-09-30)', () => {
  it('fill the band between the Awana mark and the bottom margin band, much larger than the old 3u', () => {
    for (const text of [US_PLEDGE_TEXT, AWANA_PLEDGE_TEXT]) {
      const fit = fitPledge(text, measure);
      expect(fit.bodyU).toBeGreaterThanOrEqual(4.5); // 1.5x the old 3u at least
      expect(fit.topU).toBeGreaterThanOrEqual(PLEDGE_FIT.top);
      expect(fit.topU + fit.heightU).toBeLessThanOrEqual(PLEDGE_FIT.bottom + 1e-6);
      expect(fit.kickerU).toBeGreaterThan(2.6); // the title grows with the words
    }
  });

  it('picks the LARGEST size that fits: one step bigger would not', () => {
    const fit = fitPledge(US_PLEDGE_TEXT, measure);
    if (fit.bodyU < PLEDGE_FIT.maxU) {
      const words = US_PLEDGE_TEXT.split(/\s+/).map(measure);
      const bigger = fit.bodyU + PLEDGE_FIT.step;
      const kicker = Math.min(PLEDGE_FIT.kickerMaxU, Math.max(PLEDGE_FIT.kickerMinU, bigger * PLEDGE_FIT.kickerRatio));
      const height = kicker + bigger * PLEDGE_FIT.gapRatio + rowsAt(words, 0.26, bigger, PLEDGE_FIT.widthU) * PLEDGE_FIT.lineHeight * bigger;
      expect(height).toBeGreaterThan(PLEDGE_FIT.bottom - PLEDGE_FIT.top);
    }
  });

  it('counts rows the way the browser wraps them', () => {
    expect(rowsAt([1, 1, 1], 0.25, 1, 2.5)).toBe(2);
    expect(rowsAt([1, 1, 1], 0.25, 1, 3.5)).toBe(1);
    expect(rowsAt([1], 0.25, 10, 5)).toBe(1);
  });

  it('a short pledge sits in the middle of the band, and a long one never leaves it', () => {
    const short = fitPledge('I pledge.', measure);
    expect(short.bodyU).toBe(PLEDGE_FIT.maxU);
    expect(short.topU).toBeGreaterThan(PLEDGE_FIT.top);
    const long = fitPledge(Array.from({ length: 120 }, () => 'allegiance').join(' '), measure);
    expect(long.bodyU).toBe(PLEDGE_FIT.minU);
  });
});

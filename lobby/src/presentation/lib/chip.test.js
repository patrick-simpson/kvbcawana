import { describe, expect, it } from 'vitest';
import {
  CHIP_HEIGHT_EM, chipGeometry, fitChipList, fitChipU, measureEm, widestDigits, wrapRows,
} from './chip.js';
// The geometry is the one shared copy (shared/chipGeometry.js, tested there);
// the projector's chip is that without the lobby's weather glyph.
import { chipGeometry as sharedChipGeometry, markExtents } from '../../../../shared/chipGeometry.js';

describe('the projector\'s stepped chip', () => {
  it('is the shared geometry, with no glyph', () => {
    const inks = [null, markExtents('7:56'), markExtents('\u00c9LODIE'), markExtents('\u0218TEFAN & \u00c9LODIE'), { ascent: 1.161, descent: 0.02 }];
    for (const [l, v] of [[0, 0], [1.2, 2.5], [5.1, 1.1], [3.3, 9.8], [8, 4]]) {
      for (const ink of inks) {
        const { icon, ...shared } = sharedChipGeometry(l, v, 0, ink);
        expect(icon).toBeNull();
        expect(chipGeometry(l, v, ink)).toEqual(shared);
        expect('icon' in chipGeometry(l, v, ink)).toBe(false);
      }
    }
  });

  it('sizes a ticking value for its widest digits', () => {
    expect(widestDigits('41s')).toBe('00s');
    expect(widestDigits('6:30 PM')).toBe('0:00 PM');
  });
});

describe('fitting chips to the wall', () => {
  it('breaks a row the way flex-wrap does: first fit, in order', () => {
    expect(wrapRows([], 80, 1.6)).toBe(0);
    expect(wrapRows([30, 30], 80, 1.6)).toBe(1);
    expect(wrapRows([60, 30, 30], 80, 1.6)).toBe(2);
    expect(wrapRows([40, 40], 80, 1.6)).toBe(2); // 40 + 1.6 + 40 is past 80
    expect(wrapRows([70, 70, 70], 80, 1.6)).toBe(3);
  });

  it('shrinks one chip only as far as its row needs', () => {
    expect(fitChipU('This week', 'Pajama Night', { maxU: 2.6, widthU: 90 })).toBe(2.6);
    const long = 'MISSIONS MONTH KICKOFF: WEAR WHITE & BRING A FRIEND TONIGHT!';
    const u = fitChipU('This week', long, { maxU: 2.6, widthU: 90 });
    expect(u).toBeLessThan(2.6);
    expect(u * chipGeometry(measureEm('THIS WEEK'), measureEm(long)).width).toBeCloseTo(90);
  });

  const BOX = { maxU: 3.2, minU: 2, rowU: 80, heightU: 28, gapXU: 1.6, gapYU: 1.4 };
  /** Rows and height (u) of a list shown at a fit. */
  const measure = (widths, { sizeU, count }) => {
    const shown = widths.slice(0, count).map((w) => w * sizeU);
    const rows = wrapRows(shown, BOX.rowU, BOX.gapXU);
    return { rows, height: rows * CHIP_HEIGHT_EM * sizeU + (rows - 1) * BOX.gapYU, widest: Math.max(...shown) };
  };

  it('keeps short lists at full size', () => {
    const widths = [9, 9, 9, 9, 9];
    expect(fitChipList(widths, BOX)).toEqual({ sizeU: 3.2, count: 5 });
  });

  it('shrinks a list that would run off the bottom until it fits, all at one size', () => {
    // Three long names (a row each at full size) and two short ones sharing
    // a fourth: the church's feed on 2026-09-30.
    const widths = [20.4, 20.4, 21.9, 9.3, 9.3];
    const fit = fitChipList(widths, BOX);
    expect(fit.count).toBe(5);
    expect(fit.sizeU).toBeLessThan(3.2);
    expect(fit.sizeU).toBeGreaterThanOrEqual(BOX.minU);
    const m = measure(widths, fit);
    expect(m.height).toBeLessThanOrEqual(BOX.heightU);
    expect(m.widest).toBeLessThanOrEqual(BOX.rowU);
    // ... and it is the LARGEST size that fits (a hair bigger does not).
    const bigger = measure(widths, { sizeU: fit.sizeU + 0.01, count: 5 });
    expect(bigger.height).toBeGreaterThan(BOX.heightU);
  });

  it('below the floor it shows the soonest nights that fit instead of shrinking further', () => {
    const widths = [22, 22, 22, 22, 22];
    const fit = fitChipList(widths, BOX);
    expect(fit.sizeU).toBeGreaterThanOrEqual(BOX.minU);
    expect(fit.count).toBeLessThan(5);
    expect(fit.count).toBeGreaterThan(0);
    expect(measure(widths, fit).height).toBeLessThanOrEqual(BOX.heightU);
  });

  it('a single chip too wide for the row shrinks as far as it must', () => {
    const fit = fitChipList([90], BOX);
    expect(fit.count).toBe(1);
    expect(fit.sizeU * 90).toBeLessThanOrEqual(BOX.rowU);
  });

  it('an empty list is nothing', () => {
    expect(fitChipList([], BOX).count).toBe(0);
  });
});

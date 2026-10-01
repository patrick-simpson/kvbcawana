import { describe, expect, it } from 'vitest';
import {
  CHIP_HEIGHT_EM, SHOUT_BOX, chipGeometry, fitChipList, fitChipU, inkOverflow, markExtents, measureEm, widestDigits, wrapRows,
} from './chip.js';
// Test-only reach into the lobby's copy: the projector may not import it at
// run time (the isolation rule), so this is what keeps the two stepped chips
// the same shape.
import {
  SHOUT_BOX as LOBBY_SHOUT_BOX, chipGeometry as lobbyChipGeometry, inkOverflow as lobbyInkOverflow, markExtents as lobbyMarkExtents,
} from '../../lib/brand.js';

describe('the projector\'s stepped chip', () => {
  it('has exactly the lobby chip\'s geometry', () => {
    const inks = [null, markExtents('7:56'), markExtents('ÉLODIE'), markExtents('ȘTEFAN & ÉLODIE'), { ascent: 1.161, descent: 0.02 }];
    for (const [l, v] of [[0, 0], [1.2, 2.5], [5.1, 1.1], [3.3, 9.8], [8, 4]]) {
      for (const ink of inks) {
        // The lobby's chip can also carry a glyph (the weather's); with none
        // it reports none, and every other number is the projector's.
        const { icon, ...lobby } = lobbyChipGeometry(l, v, 0, ink);
        expect(icon).toBeNull();
        expect(chipGeometry(l, v, ink)).toEqual(lobby);
      }
    }
  });

  it('widens with its value and always steps the value block out past the label', () => {
    const narrow = chipGeometry(3, 1);
    const wide = chipGeometry(3, 8);
    expect(wide.width).toBeGreaterThan(narrow.width);
    const pillEnd = Math.max(3 * 0.59 + 0.84, 2.2);
    expect(narrow.width - 0.2).toBeGreaterThanOrEqual(pillEnd + 0.5 - 1e-9);
  });

  it('reads the shout\'s marks exactly as the lobby does', () => {
    expect(SHOUT_BOX).toEqual(LOBBY_SHOUT_BOX);
    for (const text of ['MAYA', 'JOSÉ', 'NGUYỄN', 'ȘTEFAN', 'ÇAĞLA', 'Å', 'आज', '']) {
      expect(markExtents(text), text).toEqual(lobbyMarkExtents(text));
      for (const lh of [0.93, 1, 1.4]) expect(inkOverflow(markExtents(text), lh, 0.05)).toEqual(lobbyInkOverflow(lobbyMarkExtents(text), lh, 0.05));
    }
  });

  // Where the value's ink lands, in the chip's em: SVG's central baseline
  // sits (ascent - descent) / 2 of the face above the alphabetic one.
  const inkOf = (g, ink) => {
    const baseline = g.value.y + ((SHOUT_BOX.ascent - SHOUT_BOX.descent) / 2) * g.value.size;
    return { top: baseline - ink.ascent * g.value.size, bottom: baseline + ink.descent * g.value.size };
  };
  const BLOCK = { top: 1.05, bottom: 1.05 + 1.38 };

  it('keeps a value\'s marks off the block\'s keylines, however tall they are', () => {
    // Paytone One's own ink (canvas measurements) and the no-canvas estimate.
    const inks = [
      { ascent: 1.045, descent: 0.02 }, // É
      { ascent: 1.161, descent: 0.02 }, // Ễ
      { ascent: 0.688, descent: 0.351 }, // Ș
      { ascent: 1.045, descent: 0.351 }, // Ștefan & Élodie
      { ascent: 1.161, descent: 0.351 },
      ...['ÉLODIE', 'NGUYỄN', 'ȘTEFAN', 'ÇAĞLA', 'ȘTEFAN & ÉLODIE', 'Ǻ'].map((t) => markExtents(t)),
    ];
    for (const ink of inks) {
      const g = chipGeometry(3, 4, ink);
      const at = inkOf(g, ink);
      expect(at.top, JSON.stringify(ink)).toBeGreaterThanOrEqual(BLOCK.top + 0.06 - 1e-9);
      expect(at.bottom, JSON.stringify(ink)).toBeLessThanOrEqual(BLOCK.bottom - 0.06 + 1e-9);
    }
  });

  it('plain caps, figures and lowercase keep the catalog\'s seat', () => {
    for (const ink of [markExtents('6:30 PM'), { ascent: 0.7, descent: 0 }, { ascent: 0.75, descent: 0.23 }]) {
      expect(chipGeometry(3, 4, ink)).toEqual(chipGeometry(3, 4));
    }
  });

  it('a mark on one side moves the value only as far as it must, at full size', () => {
    const e = { ascent: 1.045, descent: 0.02 };
    const g = chipGeometry(3, 4, e);
    expect(g.value.size).toBe(1.06);
    expect(inkOf(g, e).top).toBeCloseTo(BLOCK.top + 0.06, 9);
    const s = { ascent: 0.688, descent: 0.351 };
    const h = chipGeometry(3, 4, s);
    expect(h.value.size).toBe(1.06);
    expect(inkOf(h, s).bottom).toBeCloseTo(BLOCK.bottom - 0.06, 9);
  });

  it('marks above and below the block cannot hold at full size set the value as large as it can, and the block hugs it', () => {
    const both = { ascent: 1.045, descent: 0.351 };
    const g = chipGeometry(3, 4, both);
    expect(g.value.size).toBeLessThan(1.06);
    expect(g.value.size).toBeGreaterThan((1.38 - 0.12) / (1.045 + 0.351) - 0.002);
    expect(g.value.width).toBeCloseTo(4 * g.value.size, 9);
    expect(g.width).toBeLessThan(chipGeometry(3, 4).width);
    expect(g.height).toBe(chipGeometry(3, 4).height);
  });

  it('measures without a canvas (tests) by a per-character estimate', () => {
    expect(measureEm('GAME ENDS')).toBeGreaterThan(measureEm('GAME'));
    expect(measureEm('6:30')).toBeCloseTo(0.64 * 3 + 0.3);
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

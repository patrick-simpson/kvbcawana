import { describe, expect, it } from 'vitest';
import { CHIP, SHOUT_BOX, chipGeometry, inkEm, inkOverflow, markExtents, measureEm } from './chipGeometry.js';

// The one stepped chip: the lobby's corner chips (src/lib/brand.js) and the
// projector's (src/presentation/lib/chip.js) both draw with it, so these are
// the only geometry tests there are.

describe('the shared stepped chip', () => {
  it('widens with its value and always steps the value block out past the label', () => {
    const narrow = chipGeometry(3, 1);
    const wide = chipGeometry(3, 8);
    expect(wide.width).toBeGreaterThan(narrow.width);
    const pillEnd = Math.max(3 * 0.59 + 0.84, 2.2);
    expect(narrow.width - 0.2).toBeGreaterThanOrEqual(pillEnd + 0.5 - 1e-9);
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
      const g = chipGeometry(3, 4, 0, ink);
      const at = inkOf(g, ink);
      expect(at.top, JSON.stringify(ink)).toBeGreaterThanOrEqual(BLOCK.top + 0.06 - 1e-9);
      expect(at.bottom, JSON.stringify(ink)).toBeLessThanOrEqual(BLOCK.bottom - 0.06 + 1e-9);
    }
  });

  it('plain caps, figures and lowercase keep the catalog\'s seat', () => {
    for (const ink of [markExtents('6:30 PM'), { ascent: 0.7, descent: 0 }, { ascent: 0.75, descent: 0.23 }]) {
      expect(chipGeometry(3, 4, 0, ink)).toEqual(chipGeometry(3, 4));
    }
  });

  it('a mark on one side moves the value only as far as it must, at full size', () => {
    const e = { ascent: 1.045, descent: 0.02 };
    const g = chipGeometry(3, 4, 0, e);
    expect(g.value.size).toBe(1.06);
    expect(inkOf(g, e).top).toBeCloseTo(BLOCK.top + 0.06, 9);
    const s = { ascent: 0.688, descent: 0.351 };
    const h = chipGeometry(3, 4, 0, s);
    expect(h.value.size).toBe(1.06);
    expect(inkOf(h, s).bottom).toBeCloseTo(BLOCK.bottom - 0.06, 9);
  });

  it('marks above and below the block cannot hold at full size set the value as large as it can, and the block hugs it', () => {
    const both = { ascent: 1.045, descent: 0.351 };
    const g = chipGeometry(3, 4, 0, both);
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

  it('is the catalog\'s lockup: a pill over a block that steps out, the texts a touch larger than the plate\'s caps', () => {
    expect(CHIP).toMatchObject({ valueSize: 1.06, labelSize: 0.59, plateLabel: 0.56, pillHeight: 1.15, blockLeft: 0.84, blockTop: 1.05, blockHeight: 1.38, step: 0.5 });
    const g = chipGeometry(2, 1.6);
    expect(g.icon).toBeNull();
    expect(g.label.size).toBe(0.59);
    expect(g.value.size).toBe(1.06);
    expect(g.d.startsWith('M')).toBe(true);
    expect(g.d.endsWith('Z')).toBe(true);
  });

  it('makes room for a glyph at the head of the value block, and only then', () => {
    const plain = chipGeometry(2, 1.6);
    const withGlyph = chipGeometry(2, 1.6, 1.15);
    expect(chipGeometry(2, 1.6, 0)).toEqual(plain);
    expect(withGlyph.icon).toMatchObject({ size: 1.15 });
    expect(withGlyph.width).toBeGreaterThan(plain.width);
  });
});

describe('the shout\'s marks', () => {
  it('seats its caps in a line box as the stylesheets say (Paytone One, 96% / 43.6%)', () => {
    expect(SHOUT_BOX).toEqual({ ascent: 0.96, descent: 0.436 });
  });

  it('estimates the ink from the marks alone: plain caps, a mark above, stacked marks, a mark below', () => {
    expect(markExtents('MAYA')).toEqual({ ascent: 0.7, descent: 0.02 });
    expect(markExtents('JOS\u00c9')).toEqual({ ascent: 1.05, descent: 0.02 });
    expect(markExtents('NGUY\u1ec4N')).toEqual({ ascent: 1.17, descent: 0.02 });
    expect(markExtents('\u0218TEFAN')).toEqual({ ascent: 0.7, descent: 0.36 });
    expect(markExtents('')).toEqual({ ascent: 0.7, descent: 0.02 });
  });

  it('says how far a line reaches past its box: nothing for caps, the mark\'s excess otherwise', () => {
    expect(inkOverflow(markExtents('MAYA'), 1)).toEqual({ top: 0, bottom: 0 });
    expect(inkOverflow({ ascent: 1.045, descent: 0.02 }, 1)).toEqual({ top: 0.283, bottom: 0 });
    expect(inkOverflow({ ascent: 0.688, descent: 0.351 }, 1)).toEqual({ top: 0, bottom: 0.113 });
    // A gap wanted between the ink and the box's edge is added on both sides.
    expect(inkOverflow({ ascent: 0.7, descent: 0.02 }, 1, 0.1)).toEqual({ top: 0.038, bottom: 0 });
  });

  it('reads the ink of a text on the page, else from its marks (no canvas here)', () => {
    for (const text of ['MAYA', 'JOS\u00c9', '\u0218TEFAN']) expect(inkEm(text), text).toEqual(markExtents(text));
  });
});

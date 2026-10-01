// The shout's ink as the screens measure it: on the canvas, from the letters'
// own outlines (CLAUDE.md, "Marks never touch"). jsdom has no canvas, so
// every other test runs on markExtents' estimate; this one hands the three
// ink readers (the lobby fit's, the kit's and the projector's copy) a canvas
// that reports Paytone One's real bounding boxes, so a canvas branch that
// stopped reading them would fail here rather than only on a TV.
import { describe, it, expect, vi } from 'vitest';
import { fitFrame, measureInk } from './lobbyFrame.js';
import { inkEm, markExtents } from './brand.js';
import { inkEm as projectorInkEm } from '../presentation/lib/chip.js';
import { nameBox } from './checkInMoment.js';
import { nameChipSeat } from './overlayFit.js';
import { toastFit } from '../components/MilestoneToast.jsx';

vi.hoisted(() => {
  // Paytone One's ink per letter, in em (fontTools / Chromium's
  // actualBoundingBox): caps and figures stand 0.70, É's accent reaches
  // 1.045, Ễ's stacked marks 1.161, and Ș's comma hangs to -0.351. The
  // estimate says 1.05 / 1.17 / 0.36, so the two can be told apart.
  const up = { É: 1.045, Ễ: 1.161 };
  const down = { Ș: 0.351, Ț: 0.351 };
  class FakeCanvas {
    getContext() {
      return {
        font: '',
        measureText(text) {
          const letters = [...String(text).normalize('NFC')];
          const shout = /Paytone One/.test(this.font);
          return {
            width: letters.reduce((w, ch) => w + (ch === ' ' ? 0.28 : 0.62), 0) * 100,
            actualBoundingBoxAscent: letters.length ? Math.max(...letters.map((ch) => (shout && up[ch]) || 0.7)) * 100 : 0,
            actualBoundingBoxDescent: letters.length ? Math.max(...letters.map((ch) => (shout && down[ch]) || 0.012)) * 100 : 0,
          };
        },
      };
    }
  }
  globalThis.OffscreenCanvas = FakeCanvas;
});

describe('the shout\'s ink, measured on the canvas', () => {
  it('every reader returns the outlines\' own reach, not the estimate', () => {
    for (const [text, ascent, descent] of [['ÉMILE', 1.045, 0.012], ['NGUYỄN', 1.161, 0.012], ['ȘTEFAN', 0.7, 0.351], ['MAYA', 0.7, 0.012]]) {
      for (const read of [(t) => measureInk(t, 'shout'), (t) => inkEm(t), (t) => projectorInkEm(t)]) {
        const ink = read(text);
        expect(ink.ascent, text).toBeCloseTo(ascent, 3);
        expect(ink.descent, text).toBeCloseTo(descent, 3);
      }
    }
    // ... which is not what the estimate would have said.
    expect(markExtents('NGUYỄN').ascent).not.toBeCloseTo(1.161, 3);
  });

  it('the lobby fit opens the row a measured mark would crowd, and no other', () => {
    const h = fitFrame({ kicker: 'Welcome', headline: 'Ștefan\nÉmile Nguyễn', sub: '', chip: null, textSize: 'auto' }).headline;
    expect(h.mode).toBe('shout');
    expect(h.lines).toHaveLength(2);
    expect(h.rise[0]).toBe(0);
    // Ș's comma (0.351) plus the shadow and the gap, then Ễ's 1.161, against
    // the 0.93 row pitch.
    expect(h.rise[1]).toBeGreaterThan(0.6);
    const plain = fitFrame({ kicker: 'Welcome', headline: 'Stefan\nEmile Nguyen', sub: '', chip: null, textSize: 'auto' }).headline;
    expect(plain.rise).toEqual([0, 0]);
  });

  it('the check-in name makes room for the mark the canvas measured', () => {
    const box = nameBox({ under: inkEm('ÉM'), whole: inkEm('ÉMILE') }, { sizeU: 10.6, line: true });
    expect(box.padTop).toBeGreaterThan(0.1);
    const plain = nameBox({ under: inkEm('EM'), whole: inkEm('EMILE') }, { sizeU: 10.6, line: true });
    expect(plain).toMatchObject({ padTop: 0, padBottom: 0 });
  });

  it('the doors-open toast gives the mark the canvas measured room on its plate, and a plain line none', () => {
    // The estimate would say 1.17 for the Ễ; the canvas says 1.161.
    const marked = toastFit('Nguyễn is first in tonight!');
    const plain = toastFit('Nguyen is first in tonight!');
    expect(marked.size).toBe(plain.size);
    expect(marked.padTop).toBeGreaterThan(0.9);
    expect(plain).toMatchObject({ padTop: 0, padBottom: 0, rise: [0] });
    expect(toastFit('Ștefan is first in tonight!').padBottom).toBeGreaterThan(0);
  });

  it('a pickup-board chip seats the capital\'s mark the canvas measured, and nothing else', () => {
    expect(nameChipSeat(measureInk('Élodie', 'shout'))).toBeGreaterThan(0);
    expect(nameChipSeat(measureInk('NGUYỄN', 'shout'))).toBeGreaterThan(nameChipSeat(measureInk('Élodie', 'shout')));
    expect(nameChipSeat(measureInk('Maya', 'shout'))).toBe(0);
    expect(nameChipSeat(measureInk('Ștefan', 'shout'))).toBe(0);
  });
});

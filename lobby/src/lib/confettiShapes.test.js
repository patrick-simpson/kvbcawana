import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The brand sparkle is a canvas-confetti PATH shape. confetti.test.js mocks
// the library without shapeFromPath, so there every burst takes the star
// fallback; this file gives the mock a shapeFromPath and checks the real
// path: the kit's own sparkle, built once, with a matrix (so the library
// never pixel-scans for the path's bounds).
const SPARKLE = { type: 'path', path: 'kit-sparkle' };
vi.mock('canvas-confetti', () => {
  const fn = vi.fn();
  fn.shapeFromPath = vi.fn(() => SPARKLE);
  return { default: fn };
});

import confetti from 'canvas-confetti';
import { DOODLES } from './brand.js';
import {
  fireBirthday, fireFirstTimer, fireMilestone, fireStandard, resetConfettiShapes,
  setConfettiLevel, setConfettiLoad, setConfettiSkin,
} from './confetti.js';

beforeEach(() => {
  vi.clearAllMocks();
  resetConfettiShapes();
  setConfettiLevel('full');
  setConfettiLoad(false);
  setConfettiSkin(null);
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('the catalog sparkle', () => {
  it('builds the kit sparkle once, with an explicit matrix, and throws it with dots', () => {
    fireStandard(['#F04A4B']);
    fireMilestone({ big: true });
    fireBirthday();
    fireFirstTimer();
    // Every wave, the delayed cannons and puffs included: no default squares.
    vi.runAllTimers();
    expect(confetti.shapeFromPath).toHaveBeenCalledTimes(1);
    const arg = confetti.shapeFromPath.mock.calls[0][0];
    expect(arg.path).toBe(DOODLES.sparkle.d);
    expect(arg.matrix).toHaveLength(6);
    expect(arg.matrix.every(Number.isFinite)).toBe(true);
    for (const call of confetti.mock.calls) expect(call[0].shapes).toEqual([SPARKLE, 'circle']);
  });

  it('the matrix scales the sparkle to about 10px, centred on the origin', () => {
    fireStandard();
    const [a, , , d, e, f] = confetti.shapeFromPath.mock.calls[0][0].matrix;
    const [x, y, w, h] = DOODLES.sparkle.viewBox.split(/\s+/).map(Number);
    expect(Math.max(w, h) * a).toBeCloseTo(10);
    expect(a).toBe(d);
    expect(e + (x + w / 2) * a).toBeCloseTo(0);
    expect(f + (y + h / 2) * d).toBeCloseTo(0);
  });

  it('falls back to the built-in star where paths are unsupported', () => {
    confetti.shapeFromPath.mockImplementationOnce(() => { throw new Error('path confetti are not supported'); });
    fireStandard();
    expect(confetti.mock.calls[0][0].shapes).toEqual(['star', 'circle']);
  });

  it('a club colour set rides the standard cannons as given', () => {
    fireStandard(['#F04A4B', '#FDDACF']);
    expect(confetti.mock.calls[0][0].colors).toEqual(['#F04A4B', '#FDDACF']);
  });

  it('a measured sticker centre wins over the 16:9 fallback, and a bad one is ignored', () => {
    fireFirstTimer({ x: 0.9, y: 0.62 });
    fireBirthday(undefined, { x: 2, y: NaN });
    expect(confetti.mock.calls[0][0].origin).toEqual({ x: 0.9, y: 0.62 });
    expect(confetti.mock.calls[1][0].origin).toEqual({ x: 0.87, y: 0.5 });
  });

  it('birthday and first-timer bursts start at the sticker', () => {
    fireBirthday(['#58BD79']);
    fireFirstTimer();
    const origins = confetti.mock.calls.map((c) => c[0].origin);
    expect(origins[0]).toEqual({ x: 0.87, y: 0.5 });
    expect(origins[1]).toEqual({ x: 0.87, y: 0.5 });
    expect(confetti.mock.calls[0][0].colors).toContain('#58BD79');
  });

  it("the season's shapes still win over the sparkle", () => {
    setConfettiSkin({ colors: ['#ffffff'], shapes: ['circle'] });
    fireBirthday();
    expect(confetti.mock.calls[0][0].shapes).toEqual(['circle']);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// canvas-confetti is imported at module scope and the real library wants a
// 2d canvas context, which jsdom returns null for — so it is mocked. The
// module has a DEFAULT export, hence the `default` key.
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

import confetti from 'canvas-confetti';
import {
  CONFETTI_SHAPES, fireBirthday, fireMilestone, setConfettiLevel, setConfettiLoad, setConfettiSkin,
} from './confetti.js';
import { SKIN_TABLE } from './skins.js';

// Asserted as literals rather than imported: a silent palette edit should
// fail this file, not quietly agree with it.
const HOUSE = ['#FAA41D', '#FCB614', '#FFFFFF', '#F15A28', '#4C72B8', '#58BD79'];
const SPARKS = ['#E14B4B', '#FFB300', '#FFFFFF'];

describe('fireMilestone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // levelFactor / loadFactor are module state and persist across cases in
    // one file, so reset both or the 'off' case poisons everything after it.
    setConfettiLevel('full');
    setConfettiLoad(false);
    // The seasonal profile (#340) is module state too — leaking Christmas out
    // of one case would repaint every later assertion.
    setConfettiSkin(null);
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  const paletteOf = (call) => call[0].colors;

  it('keeps the house palette when no colors are passed', () => {
    fireMilestone();
    expect(confetti).toHaveBeenCalled();
    expect(paletteOf(confetti.mock.calls[0])).toEqual(HOUSE);
  });

  it('keeps the house palette on every wave of a big room-wide milestone', () => {
    fireMilestone({ big: true });
    vi.runAllTimers();
    expect(confetti.mock.calls.length).toBe(4);
    for (const call of confetti.mock.calls) expect(paletteOf(call)).toEqual(HOUSE);
  });

  it("sends a club's colors to EVERY wave, not just the first", () => {
    fireMilestone({ colors: SPARKS });
    vi.runAllTimers();
    // Opening pop plus the two delayed side cannons.
    expect(confetti.mock.calls.length).toBe(3);
    expect(confetti.mock.calls.every((c) => paletteOf(c) === SPARKS)).toBe(true);
  });

  it('carries the colors through the big milestone second wave too', () => {
    fireMilestone({ big: true, colors: SPARKS });
    vi.runAllTimers();
    expect(confetti.mock.calls.length).toBe(4);
    expect(confetti.mock.calls.every((c) => paletteOf(c) === SPARKS)).toBe(true);
  });

  it("fires nothing at level 'off', colors or not", () => {
    setConfettiLevel('off');
    fireMilestone({ colors: SPARKS });
    vi.runAllTimers();
    expect(confetti).not.toHaveBeenCalled();
  });

  it("still thins a club burst for 'reduced' and for a rush", () => {
    setConfettiLevel('reduced');
    setConfettiLoad(true);
    fireMilestone({ colors: SPARKS });
    // 160 * 0.5 (level) * 0.5 (rush) — colors must not bypass scaled().
    expect(confetti.mock.calls[0][0].particleCount).toBe(40);
  });

  it('keeps the reduced-motion opt-out on every wave', () => {
    fireMilestone({ big: true, colors: SPARKS });
    vi.runAllTimers();
    expect(confetti.mock.calls.every((c) => c[0].disableForReducedMotion === true)).toBe(true);
  });

  it('falls back to the house palette for empty or non-array colors', () => {
    fireMilestone({ colors: [] });
    expect(paletteOf(confetti.mock.calls[0])).toEqual(HOUSE);
    vi.clearAllMocks();
    // A malformed shared-theme override must not strip the burst's color.
    fireMilestone({ colors: 'red' });
    expect(paletteOf(confetti.mock.calls[0])).toEqual(HOUSE);
  });
});

// ── Season-shaped confetti (#340) ────────────────────────────────────────────
describe('setConfettiSkin', () => {
  const CHRISTMAS = SKIN_TABLE.christmas.confetti;
  const SNOWDAY = SKIN_TABLE.snowday.confetti;

  beforeEach(() => {
    vi.clearAllMocks();
    setConfettiLevel('full');
    setConfettiLoad(false);
    setConfettiSkin(null);
    vi.useFakeTimers();
  });
  afterEach(() => {
    setConfettiSkin(null);
    vi.useRealTimers();
  });

  const paletteOf = (call) => call[0].colors;
  const shapesOf = (call) => call[0].shapes;

  it("dresses every wave of a room-wide milestone in the season's colours", () => {
    setConfettiSkin(CHRISTMAS);
    fireMilestone({ big: true });
    vi.runAllTimers();
    expect(confetti.mock.calls.length).toBe(4);
    for (const call of confetti.mock.calls) {
      expect(paletteOf(call)).toEqual(CHRISTMAS.colors);
      expect(shapesOf(call)).toEqual(CHRISTMAS.shapes);
    }
  });

  it("lets a CLUB's own colours beat the season — the skin dresses the room, not the kids", () => {
    setConfettiSkin(CHRISTMAS);
    fireMilestone({ colors: SPARKS });
    vi.runAllTimers();
    expect(confetti.mock.calls.every((c) => paletteOf(c) === SPARKS)).toBe(true);
    // The shapes are still seasonal: it is the club's colours that are its own.
    expect(shapesOf(confetti.mock.calls[0])).toEqual(CHRISTMAS.shapes);
  });

  it('falls back to the house palette and shapes once the season is cleared', () => {
    setConfettiSkin(SNOWDAY);
    fireMilestone();
    expect(paletteOf(confetti.mock.calls[0])).toEqual(SNOWDAY.colors);
    vi.clearAllMocks();
    setConfettiSkin(null);
    fireMilestone();
    expect(paletteOf(confetti.mock.calls[0])).toEqual(HOUSE);
    expect(shapesOf(confetti.mock.calls[0])).toEqual(['star', 'circle']);
  });

  it('carries the season into a birthday burst', () => {
    setConfettiSkin(SNOWDAY);
    fireBirthday();
    vi.runAllTimers();
    expect(confetti).toHaveBeenCalled();
    for (const call of confetti.mock.calls) {
      expect(paletteOf(call)).toEqual(SNOWDAY.colors);
      expect(shapesOf(call)).toEqual(SNOWDAY.shapes);
    }
  });

  it('drops unknown shapes rather than rendering them as squares', () => {
    // canvas-confetti draws every unrecognised shape name as a square, so a
    // typo would silently un-star Christmas. Unknown names are dropped and
    // the burst keeps its own shapes.
    setConfettiSkin({ colors: ['#ffffff'], shapes: ['snowflake', 'hexagon'] });
    fireMilestone();
    expect(paletteOf(confetti.mock.calls[0])).toEqual(['#ffffff']);
    expect(shapesOf(confetti.mock.calls[0])).toEqual(['star', 'circle']);
  });

  it('ignores a malformed profile entirely instead of throwing', () => {
    for (const bad of [undefined, null, 'christmas', 42, [], { colors: 'red', shapes: 'star' }, {}]) {
      setConfettiSkin(bad);
      vi.clearAllMocks();
      fireMilestone();
      expect(paletteOf(confetti.mock.calls[0])).toEqual(HOUSE);
      expect(shapesOf(confetti.mock.calls[0])).toEqual(['star', 'circle']);
    }
  });

  it("never fires at level 'off', however seasonal", () => {
    setConfettiSkin(CHRISTMAS);
    setConfettiLevel('off');
    fireMilestone();
    fireBirthday();
    vi.runAllTimers();
    expect(confetti).not.toHaveBeenCalled();
  });

  it('still thins a seasonal burst for a rush and keeps the reduced-motion opt-out', () => {
    setConfettiSkin(CHRISTMAS);
    setConfettiLevel('reduced');
    setConfettiLoad(true);
    fireMilestone();
    expect(confetti.mock.calls[0][0].particleCount).toBe(40);
    expect(confetti.mock.calls.every((c) => c[0].disableForReducedMotion === true)).toBe(true);
  });

  it('only ever offers canvas-confetti shapes it can actually draw', () => {
    expect(CONFETTI_SHAPES).toEqual(['square', 'circle', 'star']);
  });
});

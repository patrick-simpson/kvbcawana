import { describe, expect, it } from 'vitest';
import { DUR, EASE } from './motion-tokens.js';
import { FROM_NOW, LEAVE_TOTAL, RISE, ambientVariants, holdThen, landsAt, leavesAt, partVariants } from './landing.js';

describe('holdThen', () => {
  it('holds, then moves, as ONE keyframe list whose last value is the target', () => {
    const t = holdThen(0.5, 0.5, { opacity: 0, y: 10 }, { opacity: 1, y: 0 }, EASE.settle);
    expect(t.opacity).toEqual([0, 0, 1]);
    expect(t.y).toEqual([10, 10, 0]);
    expect(t.transition).toEqual({ duration: 1, times: [0, 0.5, 1], ease: ['linear', EASE.settle] });
  });

  it('with no hold it is a plain two-value move', () => {
    const t = holdThen(0, 0.3, { opacity: 1 }, { opacity: 0 }, EASE.exit);
    expect(t.opacity).toEqual([1, 0]);
    expect(t.transition).toEqual({ duration: 0.3, ease: EASE.exit });
  });

  it('a key missing from `from` holds at its target', () => {
    expect(holdThen(0.2, 0.2, {}, { opacity: 1 }, EASE.pop).opacity).toEqual([1, 1, 1]);
  });
});

describe('a slide\'s parts', () => {
  it('land in reading order: the first four a beat-ish apart, the rest in a quick ripple', () => {
    expect(landsAt(0)).toBe(0);
    expect(landsAt(1)).toBeCloseTo(0.08);
    expect(landsAt(3)).toBeCloseTo(0.24);
    expect(landsAt(4)).toBeCloseTo(0.32);
    expect(landsAt(30)).toBeCloseTo(0.32 + 26 * 0.018);
    expect(landsAt(2, 0.5)).toBeCloseTo(0.66);
  });

  it('leave one after another, never more than twelve steps behind the first', () => {
    expect(leavesAt(0)).toBe(0);
    expect(leavesAt(5)).toBeCloseTo(0.11);
    expect(leavesAt(12)).toBeCloseTo(leavesAt(40));
    expect(LEAVE_TOTAL).toBeCloseTo(leavesAt(12) + DUR.exit);
  });

  it('rest landed (opacity 1, no offset) and leave upward to nothing', () => {
    const v = partVariants(3, 0.56);
    expect(v.hidden).toEqual({ opacity: 0, y: RISE });
    expect(v.shown.opacity.at(-1)).toBe(1);
    expect(v.shown.y.at(-1)).toBe('0em');
    expect(v.shown.transition.ease.at(-1)).toEqual(EASE.settle);
    expect(v.gone.opacity.at(-1)).toBe(0);
    expect(v.gone.y.at(-1)).toBe(`-${RISE}`);
    expect(v.gone.transition.ease.at(-1)).toEqual(EASE.exit);
  });

  // A press that catches a slide before all of it has landed sends its
  // still-invisible parts straight to `gone`. Started from an explicit 1,
  // every one of them flashed at full strength before fading (measured: a
  // skipped pledge's 31 words at opacity 1.00 within 45 ms of a double
  // press). null is framer-motion's "current value" keyframe.
  it('leave from wherever each part is now, never from its landed state', () => {
    expect(FROM_NOW).toBeNull();
    for (const i of [0, 1, 7, 30]) {
      const { gone } = partVariants(i, 0.56);
      // Every keyframe before the last is "now": hold where it is, then go.
      expect(gone.opacity.slice(0, -1).every((k) => k === null)).toBe(true);
      expect(gone.y.slice(0, -1).every((k) => k === null)).toBe(true);
    }
    const ambient = ambientVariants(0.56).gone;
    expect(ambient.opacity).toEqual([null, 0]);
  });

  // ...and land from wherever each part is now. Space then ← inside ~250 ms
  // brings back a slide that is still leaving; a landing started from an
  // explicit 0 dropped its words from 1.00 to 0.00 in one frame (measured)
  // and left the wall blank for ~600 ms. A fresh part is already at `hidden`.
  it('land from wherever each part is now, never from an explicit zero', () => {
    for (const i of [0, 1, 7, 30]) {
      const { shown } = partVariants(i, 0.56);
      expect(shown.opacity.slice(0, -1).every((k) => k === null)).toBe(true);
      expect(shown.y.slice(0, -1).every((k) => k === null)).toBe(true);
      expect(shown.opacity.at(-1)).toBe(1);
      expect(shown.y.at(-1)).toBe('0em');
    }
    const ambient = ambientVariants(0.56).shown;
    expect(ambient.opacity.slice(0, -1).every((k) => k === null)).toBe(true);
    expect(ambient.opacity.at(-1)).toBe(1);
  });

  it('holdThen keeps a null start as a null hold', () => {
    const t = holdThen(0.2, 0.3, { opacity: null }, { opacity: 0 }, EASE.exit);
    expect(t.opacity).toEqual([null, null, 0]);
  });

  it('the ambient layer fades with the type and rests visible', () => {
    const v = ambientVariants(0.56);
    expect(v.shown.opacity.at(-1)).toBe(1);
    expect(v.gone.opacity.at(-1)).toBe(0);
    expect(v.gone.transition.duration).toBeCloseTo(LEAVE_TOTAL);
  });

  it('exits run faster than entrances (the kit\'s rule)', () => {
    expect(DUR.exit).toBeLessThan(DUR.settle);
  });
});

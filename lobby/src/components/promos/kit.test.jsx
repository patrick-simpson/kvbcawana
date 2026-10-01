import { describe, it, expect } from 'vitest';
import { buildShake, keyframes, landsAt, seeded, SHOWREEL_SEC } from './kit.jsx';
import { PROMO_DURATION_SEC } from '../../lib/promos.js';

// The timing helpers every showreel poster is built from. What matters is the
// shape of what they hand framer-motion: one clock per element, and a LAST
// keyframe that is the resting value ?lowPower=1 freezes on.

describe('SHOWREEL_SEC', () => {
  it('is the hold promos.js gives every poster', () => {
    expect(SHOWREEL_SEC).toBe(PROMO_DURATION_SEC);
  });
});

describe('landsAt', () => {
  it('holds on the first value until the beat, then lands on the last', () => {
    const { initial, animate, transition } = landsAt(4, 0.5, { opacity: [0, 1], scale: [3, 1] });
    expect(initial).toEqual({ opacity: 0, scale: 3 });
    expect(animate.opacity).toEqual([0, 0, 1]);
    expect(animate.scale).toEqual([3, 3, 1]);
    expect(transition.duration).toBe(4.5);
    expect(transition.times).toEqual([0, 4 / 4.5, 1]);
  });

  it('pads a shorter value so every list has the same length', () => {
    const { animate } = landsAt(1, 1, { opacity: [0, 1], scale: [0, 1.2, 1] });
    expect(animate.opacity).toHaveLength(animate.scale.length);
    expect(animate.opacity.at(-1)).toBe(1);
    expect(animate.scale.at(-1)).toBe(1);
  });
});

describe('keyframes', () => {
  const frames = [
    [0, { opacity: 0, x: 0 }],
    [2, { opacity: 1 }],
    [5, { x: 40 }],
    [10, { opacity: 0.5, x: 0 }],
  ];

  it('normalises absolute seconds onto one clock', () => {
    const { transition } = keyframes(frames);
    expect(transition.duration).toBe(10);
    expect(transition.times).toEqual([0, 0.2, 0.5, 1]);
    expect(transition.ease).toHaveLength(3);
  });

  it('carries a missing prop forward from the frame before', () => {
    const { initial, animate } = keyframes(frames);
    expect(initial).toEqual({ opacity: 0, x: 0 });
    expect(animate.opacity).toEqual([0, 1, 1, 0.5]);
    expect(animate.x).toEqual([0, 0, 40, 0]);
  });

  it('takes one ease per segment when given a list of curves', () => {
    const eases = ['linear', 'easeOut', [0.1, 0.2, 0.3, 1]];
    expect(keyframes(frames, eases).transition.ease).toBe(eases);
    // A single cubic-bezier array is ONE curve, repeated.
    expect(keyframes(frames, [0.1, 0.2, 0.3, 1]).transition.ease).toHaveLength(3);
  });

  it('refuses a timeline that does not start at 0', () => {
    expect(() => keyframes([[1, { opacity: 0 }]])).toThrow();
  });
});

describe('buildShake', () => {
  it('starts and ends at rest', () => {
    const s = buildShake([{ at: 1, amp: 6 }, { at: 3, amp: 9 }], 15);
    expect([s.x[0], s.y[0], s.x.at(-1), s.y.at(-1)]).toEqual([0, 0, 0, 0]);
    expect(s.times[0]).toBe(0);
    expect(s.times.at(-1)).toBe(1);
    expect(s.times.length).toBe(s.x.length);
  });
});

describe('seeded', () => {
  it('is the same sequence every time for a seed, and in [0, 1)', () => {
    const a = seeded(7);
    const b = seeded(7);
    const seq = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(seq);
    expect(seq.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(seeded(8)()).not.toBe(seq[0]);
  });
});

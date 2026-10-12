import { describe, expect, it } from 'vitest';
import { BEAT, DUR, EASE, beats } from './motion.js';
import tokens from './brand/tokens.json';

// The one motion table (the lobby's src/lib/brand.js re-exports it; the
// projector's motion-tokens.js builds its own from it).

describe('the shared motion table', () => {
  it('reads one beat, the four curves and the durations straight from tokens.json', () => {
    expect(BEAT).toBe(tokens.motion.beatMs / 1000);
    expect(Object.keys(EASE).sort()).toEqual(['exit', 'pop', 'settle', 'wipe']);
    for (const [name, curve] of Object.entries(EASE)) {
      expect(curve, name).toHaveLength(4);
      expect(curve, name).toEqual(tokens.motion.curves[name]);
    }
    expect(Object.keys(DUR).sort()).toEqual(Object.keys(tokens.motion.durationsMs).sort());
    for (const [k, ms] of Object.entries(tokens.motion.durationsMs)) expect(DUR[k]).toBe(ms / 1000);
  });

  it('is the kit\'s 100 ms beat, and beats() never accumulates float error', () => {
    expect(BEAT).toBe(0.1);
    expect(beats(3)).toBe(0.3);
    expect(beats(0)).toBe(0);
    // 7 * 0.1 is 0.7000000000000001 in floating point.
    expect(beats(7)).toBe(0.7);
    expect(beats(1.5)).toBe(0.15);
  });

  it('runs exits faster than entrances', () => {
    expect(DUR.exit).toBeLessThan(DUR.settle);
  });
});

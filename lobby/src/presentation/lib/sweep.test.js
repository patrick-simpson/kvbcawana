import { describe, expect, it } from 'vitest';
import { CLUB_ORDER, KIT_CLUBS } from './kit.js';
import { DUR } from './motion-tokens.js';
import { SWEEP_TOTAL, sweepWaves } from './sweep.js';

describe('the club-colour sweep', () => {
  it('is the six club colours, youngest first, from the kit', () => {
    const waves = sweepWaves();
    expect(waves.map((w) => w.club)).toEqual(CLUB_ORDER);
    expect(waves.map((w) => w.color)).toEqual(CLUB_ORDER.map((id) => KIT_CLUBS[id].primary));
  });

  it('stacks each wave a little shorter and a step later than the one behind it', () => {
    const waves = sweepWaves();
    for (let i = 1; i < waves.length; i++) {
      expect(waves[i].heightPct).toBeLessThan(waves[i - 1].heightPct);
      expect(waves[i].delay).toBeGreaterThan(waves[i - 1].delay);
      expect(waves[i].flip).toBe(!waves[i - 1].flip);
    }
  });

  it('crosses the wall once and rests OFF it (which is where ?vr=1 leaves it)', () => {
    for (const w of sweepWaves(1)) expect([w.from, w.to]).toEqual(['-110%', '110%']);
    for (const w of sweepWaves(-1)) expect([w.from, w.to]).toEqual(['110%', '-110%']);
  });

  it('is over inside a second and a half', () => {
    expect(SWEEP_TOTAL).toBeCloseTo(0.12 + 5 * 0.045 + DUR.sweep);
    expect(SWEEP_TOTAL).toBeLessThan(1.5);
  });
});

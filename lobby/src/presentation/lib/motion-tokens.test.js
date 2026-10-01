import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { DUR, EASE } from './motion-tokens.js';
import tokens from '../../../shared/brand/tokens.json';

// Drift guard in the same spirit as the club-color check in
// shared-config.test.js: the CSS custom properties in index.css and
// their JS mirror in motion-tokens.js must stay byte-for-value equal.
// Editing one side without the other fails here.

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

/** All --dur-* DECLARATIONS (name: value) — var(--dur-*) usages don't match. */
function cssDurations() {
  const out = new Map();
  for (const m of css.matchAll(/--dur-([a-z0-9-]+)\s*:\s*([0-9.]+)\s*(ms|s)\b/g)) {
    const seconds = m[3] === 'ms' ? Number(m[2]) / 1000 : Number(m[2]);
    out.set(m[1], seconds);
  }
  return out;
}

/** All --ease-* declarations as cubic-bezier control-point arrays. */
function cssEasings() {
  const out = new Map();
  for (const m of css.matchAll(/--ease-([a-z0-9-]+)\s*:\s*cubic-bezier\(([^)]*)\)/g)) {
    out.set(m[1], m[2].split(',').map((n) => Number(n.trim())));
  }
  return out;
}

describe('motion token parity (index.css ↔ motion-tokens.js)', () => {
  it('found the CSS declarations at all (regex canary)', () => {
    expect(cssDurations().size).toBeGreaterThan(0);
    expect(cssEasings().size).toBeGreaterThan(0);
  });

  it('declares exactly the same --dur-* names as DUR exports', () => {
    expect([...cssDurations().keys()].sort()).toEqual(Object.keys(DUR).sort());
  });

  it('every --dur-* value equals its DUR mirror (seconds)', () => {
    for (const [name, seconds] of cssDurations()) {
      expect(DUR[name], `--dur-${name} vs DUR.${name}`).toBeCloseTo(seconds, 10);
    }
  });

  it('declares exactly the same --ease-* names as EASE exports', () => {
    expect([...cssEasings().keys()].sort()).toEqual(Object.keys(EASE).sort());
  });

  it('every --ease-* cubic-bezier matches its EASE mirror', () => {
    for (const [name, points] of cssEasings()) {
      expect(points, `--ease-${name} malformed in CSS`).toHaveLength(4);
      expect(EASE[name], `--ease-${name} vs EASE.${name}`).toEqual(points);
    }
  });
});

// ...and both sides are the family brand kit's motion table: one beat, the
// kit's durations, its four curves and no others. Only `mode` and `sweep`
// are the projector's own.
describe('motion tokens are the brand kit\'s (shared/brand/tokens.json)', () => {
  const PROJECTOR_ONLY = ['mode', 'sweep'];

  it('the beat and every kit duration, in seconds', () => {
    expect(DUR.beat).toBeCloseTo(tokens.motion.beatMs / 1000, 10);
    for (const [name, ms] of Object.entries(tokens.motion.durationsMs)) {
      expect(DUR[name], name).toBeCloseTo(ms / 1000, 10);
    }
  });

  it('nothing but the kit table plus the projector\'s own two', () => {
    const kitNames = ['beat', ...Object.keys(tokens.motion.durationsMs)];
    expect(Object.keys(DUR).sort()).toEqual([...kitNames, ...PROJECTOR_ONLY].sort());
  });

  it('exactly the kit\'s four curves', () => {
    expect(EASE).toEqual(tokens.motion.curves);
  });

  it('the CSS side carries the same kit values (so CSS is pinned to the kit too)', () => {
    for (const [name, ms] of Object.entries(tokens.motion.durationsMs)) {
      expect(cssDurations().get(name), `--dur-${name}`).toBeCloseTo(ms / 1000, 10);
    }
    for (const [name, pts] of Object.entries(tokens.motion.curves)) {
      expect(cssEasings().get(name), `--ease-${name}`).toEqual(pts);
    }
  });
});

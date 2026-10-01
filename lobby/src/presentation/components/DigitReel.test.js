import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DUR } from '../lib/motion-tokens.js';
import { DIGIT_CELL_EM, ROLL } from './DigitReel.jsx';

/** Progress (0..1) of a CSS cubic-bezier at time fraction `x`, solved by bisection. */
function bezier([x1, y1, x2, y2], x) {
  const at = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (at(x1, x2, mid) < x) lo = mid;
    else hi = mid;
  }
  return at(y1, y2, (lo + hi) / 2);
}

const em = (v) => (typeof v === 'number' ? v : parseFloat(v));

/** Where one half of the roll is `t` seconds after a tick: { y (em), o (opacity) }. */
function sample(from, to, transition, t) {
  const p = t >= transition.duration ? 1 : bezier(transition.ease, t / transition.duration);
  return {
    y: em(from.y) + (em(to.y) - em(from.y)) * p,
    o: from.opacity + (to.opacity - from.opacity) * p,
  };
}

// Every tick of the countdown and the game clock: the old figure leaves on
// ROLL.exit while the new one arrives on ROLL.animate, in the same cell.
// Sampled every 2 ms across the whole roll.
describe('the odometer roll', () => {
  const rest = { y: 0, opacity: 1 };
  const frames = [];
  for (let t = 0; t <= DUR.settle + 0.01; t += 0.002) {
    frames.push({
      t,
      out: sample(rest, ROLL.exit, ROLL.exit.transition, t),
      in: sample(ROLL.initial, ROLL.animate, ROLL.animate.transition, t),
    });
  }

  it('never draws the two figures on top of each other', () => {
    for (const f of frames) {
      // A figure is legible when it is near rest and mostly opaque; the
      // reviewer's measure of a double exposure was both at once.
      const outShows = f.out.o > 0.4 && Math.abs(f.out.y) < 0.35;
      const inShows = f.in.o > 0.4 && Math.abs(f.in.y) < 0.35;
      expect(outShows && inShows, `double exposure ${Math.round(f.t * 1000)} ms into a tick`).toBe(false);
    }
  });

  it('keeps the pair at least one roll (0.9em) apart the whole way', () => {
    const gap = Math.min(...frames.map((f) => f.out.y - f.in.y));
    expect(gap).toBeGreaterThanOrEqual(0.9 - 1e-6);
  });

  it('lands the new figure at rest and takes the old one fully away', () => {
    const last = frames.at(-1);
    expect(last.in).toEqual({ y: 0, o: 1 });
    expect(last.out.o).toBe(0);
    expect(last.out.y).toBeCloseTo(0.9);
  });

  it('leaves faster than it arrives (the kit\'s rule)', () => {
    expect(ROLL.exit.transition.duration).toBeLessThan(ROLL.animate.transition.duration);
  });
});

describe('the digit cell', () => {
  const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel) => css.match(new RegExp(`${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

  it('is one of Paytone One\'s tabular figures, which the timer turns on, so no digit twitches or spills', () => {
    // Paytone One's tnum figures all advance 0.600em, their ink inside
    // 0.021em..0.593em (measured from the font file). Its default figures
    // run 0.444em ("1") to 0.679em ("0"), so without tnum a zero would
    // overhang a 0.6em cell and touch its neighbour.
    expect(DIGIT_CELL_EM).toBe(0.6);
    expect(rule('.pj-timer')).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it('keeps the figures clear of the cell\'s clipped top and bottom at rest', () => {
    const line = parseFloat(rule('.pj-reel').match(/height:\s*([\d.]+)em/)?.[1]);
    expect(rule('.pj-reel')).toMatch(new RegExp(`line-height:\\s*${line}em`));
    // The baseline sits (ascent - descent + line) / 2 down the cell, with
    // index.css's overrides (96% / 43.6%); figures reach 0.703em up and
    // 0.017em down.
    const baseline = (0.96 - 0.436 + line) / 2;
    expect(baseline - 0.703).toBeGreaterThan(0.05);
    expect(line - baseline - 0.017).toBeGreaterThan(0.05);
  });
});

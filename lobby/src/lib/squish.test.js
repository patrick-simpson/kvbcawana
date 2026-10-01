import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import tokens from '../../shared/brand/tokens.json';
import {
  ARRIVAL, BULGE, DEPTH, HALF_PERIOD, IMPACT, OVERSHOOT, PRESS, REST, SPRING,
  releaseEasing, settleScale, springPeaks, springProgress, squishBump, squishLand, withSquish,
} from './squish.js';
import { LETTER_FROM, WORD_FROM, holdThenLand, holdThenLeave, letterEnter, wordLanding } from './lobbyMotion.js';
import { landsAt } from '../components/promos/kit.jsx';

// The soft squish (CLAUDE.md, "Soft squish"): one pure primitive, one physics.
// These are the invariants every caller leans on: the last keyframe is the
// resting design (?lowPower=1 and the visual baselines show it), the hold is
// a keyframe and never a delay, the readability caps hold, and composing a
// squish onto a beat never touches what the beat already animates.

const KINDS = /** @type {Array<keyof typeof DEPTH>} */ (Object.keys(DEPTH));
const ATS = [0, 0.08, 0.2, 0.25, 0.3, 0.564, 1.2, 1.44, 2.3];
const DURS = [0.28, 0.32, 0.36, 0.46, 0.52, 0.6, 0.64];
const CURVES = /** @type {Array<'settle' | 'pop' | 'wipe' | number>} */ (['settle', 'pop', 'wipe', 0.65]);

/** Every squish the table above can make. */
function* everySquish() {
  for (const kind of KINDS) {
    for (const at of ATS) {
      for (const dur of DURS) {
        for (const curve of CURVES) yield { kind, at, dur, curve, s: squishLand(at, kind, dur, curve) };
      }
    }
  }
}

/** The axes a squish sets, with their keyframes and timing. */
const axes = (s) => ['scaleX', 'scaleY'].filter((k) => s[k]).map((k) => ({ key: k, values: s[k], timing: s.transition[k] }));

/** Does anything in this value carry a `delay` key, at any depth? */
const hasDelay = (v) => (v && typeof v === 'object' ? ('delay' in v || Object.values(v).some(hasDelay)) : false);

/** A cubic-bezier's progress at time x (bisection on the x polynomial). */
function bezier([x1, y1, x2, y2]) {
  const cx = 3 * x1; const bx = 3 * (x2 - x1) - cx; const ax = 1 - cx - bx;
  const cy = 3 * y1; const by = 3 * (y2 - y1) - cy; const ay = 1 - cy - by;
  const X = (s) => ((ax * s + bx) * s + cx) * s;
  const Y = (s) => ((ay * s + by) * s + cy) * s;
  return (x) => {
    let lo = 0; let hi = 1;
    for (let i = 0; i < 60; i += 1) { const mid = (lo + hi) / 2; if (X(mid) < x) lo = mid; else hi = mid; }
    return Y((lo + hi) / 2);
  };
}

describe('the physics', () => {
  it('is Jelly UI\'s own scale spring, as vendored', () => {
    const vendored = readFileSync(resolve(__dirname, '../../public/vendor/jelly-ui.js'), 'utf8');
    // E(value, velocity, target, stiffness, damping, dt), mass 1: a vendor
    // refresh that retunes the spring must be noticed here.
    expect(vendored).toContain(`E(this.scale, this.scaleVelocity, 1, ${SPRING.stiffness}, ${SPRING.damping}, t)`);
    expect(SPRING.mass).toBe(1);
  });

  it('rings with a 229 ms half-period, keeping 14.2% of each swing', () => {
    expect(HALF_PERIOD).toBeCloseTo(0.2293, 4);
    expect(OVERSHOOT).toBeCloseTo(0.1424, 4);
    // The step response's first overshoot and first dip sit a half-period apart.
    expect(springProgress(HALF_PERIOD)).toBeCloseTo(1 + OVERSHOOT, 6);
    expect(springProgress(2 * HALF_PERIOD)).toBeCloseTo(1 - OVERSHOOT ** 2, 6);
    expect(springProgress(0)).toBe(0);
    expect(Math.abs(springProgress(PRESS.releaseMs / 1000) - 1)).toBeLessThan(0.002);
  });

  it('springPeaks alternate, shrink by OVERSHOOT a half-period apart, and end at rest', () => {
    for (const depth of Object.values(DEPTH)) {
      const peaks = springPeaks(depth);
      expect(peaks.at(-1).v).toBe(0);
      peaks.forEach(({ t, v }, n) => {
        expect(t).toBeCloseTo(n * HALF_PERIOD, 10);
        if (n < peaks.length - 1) {
          expect(Math.abs(v)).toBeGreaterThanOrEqual(REST);
          expect(v).toBeCloseTo(depth * (-OVERSHOOT) ** n, 12);
        }
      });
    }
    expect(springPeaks(0)).toEqual([{ t: 0, v: 0 }]);
  });

  it('IMPACT is where each kit curve arrives, sampled from the kit\'s own beziers', () => {
    expect(bezier(tokens.motion.curves.settle)(IMPACT.settle)).toBeCloseTo(0.88, 2);
    expect(bezier(tokens.motion.curves.wipe)(IMPACT.wipe)).toBeCloseTo(0.95, 2);
    // The pop's overshoot peak: the largest progress it reaches.
    const pop = bezier(tokens.motion.curves.pop);
    let peak = 0;
    for (let x = 0; x <= 1; x += 0.001) if (pop(x) > pop(peak)) peak = x;
    expect(Math.abs(peak - IMPACT.pop)).toBeLessThanOrEqual(0.01);
  });

  it('defaults to the kit\'s settle (a landing) and pop (a bump)', () => {
    expect(squishLand(0.4, 'text')).toEqual(squishLand(0.4, 'text', tokens.motion.durationsMs.settle / 1000, 'settle'));
    expect(squishBump('figure')).toEqual(squishLand(0, 'figure', tokens.motion.durationsMs.pop / 1000, 'pop'));
  });

  it('the pill press is DEPTH.press and BULGE.press', () => {
    expect(PRESS.scaleY).toBe(Math.round((1 - DEPTH.press) * 1e4) / 1e4);
    expect(PRESS.scaleX).toBe(Math.round((1 + DEPTH.press * BULGE.press) * 1e4) / 1e4);
    expect(PRESS.ms).toBe(100);
    expect(PRESS.releaseMs).toBe(750);
  });
});

describe('squishLand', () => {
  it('a headline word landing at 1.4 s, worked out', () => {
    const s = squishLand(1.4, 'text');
    expect(s.scaleY).toEqual([1, 1, 1.03, 0.94, 1.0085, 1]);
    expect(s.scaleX).toEqual([1, 1, 0.985, 1.03, 0.9957, 1]);
    const t = s.transition.scaleY.times.map((f) => f * s.transition.scaleY.duration);
    [0, 1.4, 1.4 + 0.078, 1.4 + 0.156, 1.4 + 0.156 + HALF_PERIOD, 1.4 + 0.156 + 2 * HALF_PERIOD]
      .forEach((sec, i) => expect(t[i]).toBeCloseTo(sec, 10));
    expect(s.transition.scaleY.ease).toEqual(['linear', 'easeOut', 'easeIn', 'easeInOut', 'easeInOut']);
    expect(s.transition.scaleX).toEqual(s.transition.scaleY);
  });

  it('a chip popping in: no stretch, the squash at the pop\'s peak', () => {
    const s = squishLand(0, 'chip', 0.46, 'pop');
    expect(s.scaleY).toEqual([1, 0.92, 1.0114, 1]);
    expect(s.scaleX).toEqual([1, 1.04, 0.9943, 1]);
    expect(s.transition.scaleY.times[1] * s.transition.scaleY.duration).toBeCloseTo(0.46 * IMPACT.pop, 10);
  });

  it('the last keyframe is exactly 1 on every axis, for every kind, hold, run and curve', () => {
    for (const { s } of everySquish()) {
      for (const { values } of axes(s)) expect(values.at(-1)).toBe(1);
    }
  });

  it('the hold is a keyframe at rest that ends exactly at `at`, and never a delay', () => {
    for (const { at, s } of everySquish()) {
      expect(hasDelay(s)).toBe(false);
      for (const { values, timing } of axes(s)) {
        expect(values[0]).toBe(1);
        if (at > 0) {
          expect(values[1]).toBe(1);
          expect(timing.times[1]).toBe(at / timing.duration);
          expect(timing.times[1] * timing.duration).toBeCloseTo(at, 12);
          expect(timing.ease[0]).toBe('linear');
        } else {
          expect(values[1]).not.toBe(1);
        }
      }
    }
  });

  it('times ascend inside [0, 1], one per keyframe, one ease per segment', () => {
    for (const { s } of everySquish()) {
      for (const { values, timing } of axes(s)) {
        expect(timing.times).toHaveLength(values.length);
        expect(timing.ease).toHaveLength(values.length - 1);
        expect(timing.times[0]).toBe(0);
        expect(timing.times.at(-1)).toBe(1);
        for (let i = 1; i < timing.times.length; i += 1) expect(timing.times[i]).toBeGreaterThan(timing.times[i - 1]);
      }
    }
  });

  it('squashes at the curve\'s arrival and has rung down within two half-periods of it', () => {
    for (const { at, dur, curve, s } of everySquish()) {
      const impact = typeof curve === 'number' ? curve : IMPACT[curve];
      const { times, duration } = s.transition.scaleY;
      const low = s.scaleY.indexOf(Math.min(...s.scaleY));
      expect(times[low] * duration).toBeCloseTo(at + dur * impact, 10);
      expect(duration).toBeLessThanOrEqual(at + dur * impact + 2 * HALF_PERIOD + 1e-9);
    }
  });

  it('keeps the readability caps', () => {
    for (const { kind, curve, s } of everySquish()) {
      const depth = DEPTH[kind];
      for (const v of s.scaleY) {
        expect(v).toBeGreaterThanOrEqual(Math.round((1 - depth) * 1e4) / 1e4);
        // A pop-curve piece never stretches: its own scale already overshoots.
        expect(v).toBeLessThanOrEqual(curve === 'pop' ? 1 + depth * OVERSHOOT + 1e-4 : 1 + depth / 2);
      }
      if (kind === 'name') expect(Math.min(...s.scaleY)).toBeGreaterThanOrEqual(0.93);
      if (kind === 'figure' || kind === 'wave') {
        expect(s.scaleX).toBeUndefined();
        expect(s.transition.scaleX).toBeUndefined();
        continue;
      }
      for (const v of s.scaleX) expect(Math.abs(v - 1)).toBeLessThanOrEqual(depth * BULGE[kind] + 1e-9);
      if (kind === 'text') expect(Math.max(...s.scaleX)).toBeLessThanOrEqual(1.03);
    }
  });

  it('depends on its arguments alone: the same beat gives the same keyframes', () => {
    expect(JSON.stringify(squishLand(1.44, 'text'))).toBe(JSON.stringify(squishLand(1.44, 'text')));
    expect(squishLand(-1, 'chip', 0.46, 'pop')).toEqual(squishLand(0, 'chip', 0.46, 'pop'));
  });
});

/**
 * One value of a framer-motion keyframe animation at `t` seconds, the way
 * framer-motion reads it: `times` are shares of `duration`, `ease` is one
 * curve per segment (a bezier, or a preset name).
 */
function sampleValue(values, timing, t) {
  const PRESETS = { linear: (x) => x, easeIn: bezier([0.42, 0, 1, 1]), easeOut: bezier([0, 0, 0.58, 1]), easeInOut: bezier([0.42, 0, 0.58, 1]) };
  const x = Math.min(1, Math.max(0, t / timing.duration));
  // No `times` means an even spread; a lone bezier (numbers) is every segment's.
  const times = timing.times ?? values.map((_, k) => k / (values.length - 1));
  const eases = typeof timing.ease[0] === 'number' ? values.slice(1).map(() => timing.ease) : timing.ease;
  let i = 0;
  while (i < values.length - 2 && x > times[i + 1]) i += 1;
  const span = times[i + 1] - times[i];
  const e = eases[i];
  const curve = Array.isArray(e) ? bezier(e) : PRESETS[e];
  return values[i] + (values[i + 1] - values[i]) * curve(span > 0 ? (x - times[i]) / span : 1);
}

describe('the squish composed onto the entrance that grows the piece', () => {
  // What is DRAWN is the entrance's uniform `scale` times the squish's
  // scaleY, so the readability caps (names 0.93, words 0.94) are only kept if
  // the two never stack. The squish lands at ARRIVAL, where scale is 1.
  /** Drawn height at `t`, and the entrance's own scale there. */
  const drawn = (beat, t) => {
    const scale = sampleValue(beat.animate.scale, beat.transition, t);
    return { scale, y: scale * sampleValue(beat.animate.scaleY, beat.transition.scaleY, t) };
  };
  const names = [];
  for (const [entrance, from] of Object.entries(LETTER_FROM)) {
    for (const index of [0, 1, 4, 9]) {
      for (const at of [0.2, 0.564, 1.44]) for (const dur of [0.4, 0.52, 0.6]) names.push({ entrance, beat: letterEnter({ at, dur, from: from(index) }), at, dur, cap: 0.93 });
    }
  }
  const words = [];
  for (const at of [0, 0.2, 0.564, 1.44]) {
    for (const dur of [0.4, 0.52]) words.push({ entrance: 'word', beat: wordLanding(at, dur, 'shout'), at, dur, cap: 0.94 });
  }

  it('never draws a piece shorter than its cap once its entrance has finished growing', () => {
    for (const { entrance, beat, at, dur, cap } of [...names, ...words]) {
      const total = beat.transition.scaleY.duration;
      let lowest = Infinity;
      for (let t = at + dur; t <= total + 1e-9; t += total / 4000) lowest = Math.min(lowest, drawn(beat, t).y);
      expect(lowest, `${entrance} at ${at} for ${dur}`).toBeGreaterThanOrEqual(cap - 1e-3);
    }
  });

  it('never lets the squish take a growing piece below what its entrance alone draws, or its cap', () => {
    for (const { entrance, beat, at, dur, cap } of [...names, ...words]) {
      const total = beat.transition.scaleY.duration;
      for (let t = 0; t <= total + 1e-9; t += total / 2000) {
        const { scale, y } = drawn(beat, t);
        expect(y, `${entrance} at ${at}+${dur}, t=${t.toFixed(3)}`).toBeGreaterThanOrEqual(Math.min(scale, cap) - 1e-3);
      }
    }
  }, 30000); // samples ~20,000 frames; under coverage on a CI runner it passed 5 s

  it('squashes at the very end of the entrance, and still rests on the design at the last keyframe', () => {
    for (const { beat, at, dur } of [...names, ...words]) {
      const { times, duration } = beat.transition.scaleY;
      const low = beat.animate.scaleY.indexOf(Math.min(...beat.animate.scaleY));
      expect(times[low] * duration).toBeCloseTo(at + dur * ARRIVAL, 10);
      for (const key of ['scale', 'scaleX', 'scaleY']) expect(beat.animate[key].at(-1)).toBe(1);
      expect(beat.animate.opacity.at(-1)).toBe(1);
      expect(beat.animate.y.at(-1)).toBe('0em');
    }
  });

  it('a read headline word only lands: no squish at all', () => {
    const read = wordLanding(0.3, 0.52, 'read');
    expect(read.animate.scaleY).toBeUndefined();
    expect(WORD_FROM.read.scale).toBe(1);
  });

  it('would fail on the old stacking: a squish at the settle curve\'s 30% under a 0.7 entrance', () => {
    const old = { ...holdThenLand(0.4, 0.52, LETTER_FROM.pop(0), { opacity: 1, y: '0em', scale: 1 }, tokens.motion.curves.settle) };
    const beat = withSquish(old, squishLand(0.4, 'name', 0.52, 'settle'));
    let lowest = Infinity;
    for (let t = 0; t <= beat.transition.scaleY.duration; t += 0.002) lowest = Math.min(lowest, drawn(beat, t).y);
    expect(lowest).toBeLessThan(0.93 - 1e-3);
    let readable = Infinity;
    for (let t = 0.4 + 0.52 * 0.3; t <= beat.transition.scaleY.duration; t += 0.002) readable = Math.min(readable, drawn(beat, t).y);
    expect(readable).toBeLessThan(0.91);
  });
});

describe('settleScale', () => {
  it('goes home from wherever it is, on the timing it is given', () => {
    const s = settleScale(0.28, 0.46, 'easeOut');
    expect(s.scaleX).toEqual([null, null, 1]);
    expect(s.scaleY).toEqual([null, null, 1]);
    expect(s.transition.scaleY).toEqual({ duration: 0.74, times: [0, 0.28 / 0.74, 1], ease: ['linear', 'easeOut'] });
    expect(settleScale(0, 0.28, 'easeIn').scaleY).toEqual([null, 1]);
  });
});

describe('withSquish', () => {
  const EASE = tokens.motion.curves;
  const beats = [
    ['holdThenLand, held', holdThenLand(1.4, 0.52, { opacity: 0, y: '0.45em', scale: 0.85 }, { opacity: 1, y: '0em', scale: 1 }, EASE.settle)],
    ['holdThenLand, at once', holdThenLand(0, 0.46, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1 }, EASE.pop)],
    ['landsAt', landsAt(1.3, 0.6, { y: ['112%', '-9%', '0%'], rotate: [-9, 3, 0], opacity: [0, 1, 1] })],
  ];
  const targets = [
    ['holdThenLeave', holdThenLeave(0.28, 0.46, { opacity: 0, y: '-60%' }, { opacity: 1, y: '0%' }, EASE.pop)],
    ['a target with a nested transition', { opacity: 1, y: '0%', scale: 1, transition: { duration: 0.46, ease: EASE.pop } }],
  ];
  const squish = squishLand(1.4, 'text');

  it('null is the identity', () => {
    for (const [, beat] of [...beats, ...targets]) {
      expect(withSquish(beat, null)).toBe(beat);
      expect(withSquish(beat, undefined)).toBe(beat);
    }
  });

  it.each(beats)('onto %s it only adds: every existing keyframe list and the top-level timing are untouched', (_, beat) => {
    const before = JSON.stringify(beat);
    const out = withSquish(beat, squish);
    expect(JSON.stringify(beat)).toBe(before); // never mutated
    for (const key of Object.keys(beat.animate)) expect(out.animate[key]).toBe(beat.animate[key]);
    for (const key of Object.keys(beat.transition)) expect(out.transition[key]).toBe(beat.transition[key]);
    for (const key of Object.keys(beat.initial)) expect(out.initial[key]).toBe(beat.initial[key]);
    expect(out.animate.scaleX).toBe(squish.scaleX);
    expect(out.animate.scaleY).toBe(squish.scaleY);
    expect(out.transition.scaleX).toBe(squish.transition.scaleX);
    expect(out.transition.scaleY).toBe(squish.transition.scaleY);
    expect(out.initial).toEqual({ ...beat.initial, scaleX: 1, scaleY: 1 });
    // Take the squish back out and it is the beat, byte for byte.
    const strip = ({ scaleX: _x, scaleY: _y, ...rest }) => rest;
    expect(JSON.stringify({ initial: strip(out.initial), animate: strip(out.animate), transition: strip(out.transition) }))
      .toBe(JSON.stringify({ initial: beat.initial, animate: beat.animate, transition: beat.transition }));
  });

  it.each(targets)('onto %s it only adds, at the top level and in the nested transition', (_, target) => {
    const before = JSON.stringify(target);
    const out = withSquish(target, squish);
    expect(JSON.stringify(target)).toBe(before);
    const { transition, ...keys } = target;
    for (const key of Object.keys(keys)) expect(out[key]).toBe(target[key]);
    for (const key of Object.keys(transition)) expect(out.transition[key]).toBe(transition[key]);
    expect(out.scaleY).toBe(squish.scaleY);
    expect(out.transition.scaleY).toBe(squish.transition.scaleY);
    const { scaleX: _x, scaleY: _y, transition: t, ...rest } = out;
    const { scaleX: _tx, scaleY: _ty, ...top } = t;
    expect(JSON.stringify({ ...rest, transition: top })).toBe(before);
  });

  it('a scaleY-only squish adds only scaleY', () => {
    const beat = beats[0][1];
    const out = withSquish(beat, squishLand(1.4, 'figure'));
    expect('scaleX' in out.animate).toBe(false);
    expect('scaleX' in out.transition).toBe(false);
    expect(out.initial).toEqual({ ...beat.initial, scaleY: 1 });
  });

  it('refuses a target with no transition of its own (it would re-time every other value)', () => {
    expect(() => withSquish({ opacity: 1 }, squish)).toThrow(TypeError);
  });

  it('carries no delay anywhere', () => {
    for (const [, beat] of [...beats, ...targets]) expect(hasDelay(withSquish(beat, squish))).toBe(false);
  });
});

describe('releaseEasing', () => {
  it('is the spring\'s step response at 16 even steps over 750 ms, exactly', () => {
    expect(releaseEasing()).toBe(
      'linear(0, 0.213, 0.605, 0.93, 1.103, 1.142, 1.106, 1.05, 1.006, 0.984, 0.98, 0.986, 0.994, 1, 1.002, 1.003, 1)',
    );
  });

  it('always starts at 0 and ends on exactly 1', () => {
    for (const stops of [4, 8, 16, 32]) {
      const values = releaseEasing(stops).slice('linear('.length, -1).split(', ').map(Number);
      expect(values).toHaveLength(stops + 1);
      expect(values[0]).toBe(0);
      expect(values.at(-1)).toBe(1);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { DUR, EASE } from './brand.js';
import {
  HANDOFF, STINGER_SEC, SWAP_AT,
  chromeMove, chromeSpot, copyBeats, entranceHold, exitDelay, firstTransition, holdThenLand, holdThenLeave,
  nextTransition, swellKeyframes, vanishAtSwap,
} from './lobbyMotion.js';

const showing = (key, over = {}) => ({ key, special: false, kind: 'copy', theme: 'sky', ...over });

describe('the hand-off, as numbers', () => {
  it('rides the brand rhythm: the kit\'s own exit, settle and pop, the rest in beats', () => {
    expect(HANDOFF.exit).toBe(DUR.exit);
    expect(HANDOFF.word).toBe(DUR.settle);
    expect(HANDOFF.chip).toBe(DUR.pop);
    for (const v of Object.values(HANDOFF)) expect(Math.round(v * 1000) % 10).toBe(0);
  });

  it('the stinger swaps the slides at mid-cover', () => {
    expect(SWAP_AT).toBeCloseTo(STINGER_SEC / 2);
  });

  it('the outgoing copy is gone before the incoming copy lands, however long it was', () => {
    for (const n of [1, 3, 6, 12, 40]) {
      const lastStarts = exitDelay(n - 1, n);
      expect(lastStarts).toBeLessThanOrEqual(HANDOFF.exitSpread + 1e-9);
      expect(lastStarts + HANDOFF.exit).toBeLessThanOrEqual(HANDOFF.hold);
    }
    expect(exitDelay(0, 5)).toBe(0);
    expect(exitDelay(1, 5)).toBeCloseTo(HANDOFF.exitStagger);
  });

  it('holds each arrival for its own reason', () => {
    expect(entranceHold('handoff')).toBe(HANDOFF.hold);
    expect(entranceHold('wipe')).toBe(STINGER_SEC);
    expect(entranceHold('reveal')).toBe(HANDOFF.reveal);
    expect(entranceHold('boot')).toBe(HANDOFF.boot);
  });
});

describe('hold, then land', () => {
  it('is one keyframe list that sits still, then moves, and ends at rest', () => {
    const { initial, animate, transition } = holdThenLand(0.5, 0.52, { opacity: 0, y: '0.45em' }, { opacity: 1, y: '0em' }, 'linear');
    expect(initial).toEqual({ opacity: 0, y: '0.45em' });
    expect(animate).toEqual({ opacity: [0, 0, 1], y: ['0.45em', '0.45em', '0em'] });
    expect(transition.duration).toBeCloseTo(1.02);
    expect(transition.times[1]).toBeCloseTo(0.5 / 1.02);
    // No delay anywhere: framer-motion runs opacity on the browser's own
    // timeline, where a delayed opacity paints its target before its beat.
    expect(transition).not.toHaveProperty('delay');
  });

  it('with no hold, is a plain two-keyframe move', () => {
    expect(holdThenLand(0, 0.3, { opacity: 0 }, { opacity: 1 }, 'linear').animate).toEqual({ opacity: [0, 1] });
  });

  it('a value only in `to` simply holds there', () => {
    expect(holdThenLand(0.2, 0.3, {}, { scale: 1 }, 'linear').animate.scale).toEqual([1, 1, 1]);
  });

  it('leaving under the stinger waits for the cover, then goes', () => {
    const exit = vanishAtSwap({ opacity: 1 }, { opacity: 0 });
    expect(exit.opacity).toEqual([1, 1, 0]);
    expect(exit.transition.duration * exit.transition.times[1]).toBeCloseTo(SWAP_AT);
    expect(holdThenLeave(0.1, 0.28, { opacity: 1 }, { opacity: 0 }, 'linear').opacity.at(-1)).toBe(0);
  });

  it('the swell starts late, crests and comes home', () => {
    const { animate, transition } = swellKeyframes('-16%');
    expect(animate.y).toEqual(['0%', '0%', '-16%', '0%']);
    expect(transition.times[1]).toBeCloseTo(HANDOFF.swellAt / (HANDOFF.swellAt + HANDOFF.swell));
  });
});

describe('copyBeats', () => {
  const fit = (over = {}) => ({
    kicker: { text: 'This week' },
    headline: { mode: 'shout', tokens: [{ text: 'Bring' }, { text: 'your' }, { text: 'handbook' }], starts: [0, 2] },
    sub: null,
    chip: { label: 'WED' },
    ...over,
  });

  it('lands the kicker, then each word in order, then the chip', () => {
    const b = copyBeats(fit(), 0.5);
    expect(b.kicker.at).toBe(0.5);
    expect(b.tokens).toHaveLength(3);
    expect(b.tokens[0].at).toBeCloseTo(0.5 + HANDOFF.wordAt);
    for (let i = 1; i < b.tokens.length; i += 1) expect(b.tokens[i].at - b.tokens[i - 1].at).toBeCloseTo(HANDOFF.wordStagger);
    expect(b.chip.at).toBeGreaterThan(b.tokens.at(-1).at);
    expect(b.pieces).toBe(5);
    expect([b.kicker.index, ...b.tokens.map((w) => w.index), b.chip.index]).toEqual([0, 1, 2, 3, 4]);
  });

  it('nothing lands before the hold is over', () => {
    const b = copyBeats(fit({ sub: { lines: ['x'] } }), 1.2);
    for (const beat of [b.kicker, ...b.tokens, b.sub, b.chip]) expect(beat.at).toBeGreaterThanOrEqual(1.2);
    expect(b.chip.at).toBeGreaterThan(b.sub.at);
  });

  it('a read-layout headline lands row by row: every token on a row shares its beat and its exit', () => {
    const b = copyBeats(fit({
      kicker: null,
      chip: null,
      headline: { mode: 'read', tokens: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }], starts: [0, 2, 2, 3] },
    }), 0);
    // Token 2 is a word too wide for a line, cut across rows 1 and 2.
    expect(b.tokens.map((t) => t.index)).toEqual([0, 0, 1, 2]);
    expect(b.tokens[1].at).toBe(b.tokens[0].at);
    expect(b.tokens[2].at - b.tokens[0].at).toBeCloseTo(HANDOFF.lineStagger);
    expect(b.tokens[3].at - b.tokens[0].at).toBeCloseTo(HANDOFF.lineStagger * 3);
    expect(b.pieces).toBe(3);
  });
});

describe('the chrome', () => {
  it('goes aside for a video on an ordinary change, hides for anything under the stinger, and stays put while away', () => {
    expect(chromeSpot('home', false, 'handoff')).toBe('home');
    expect(chromeSpot('home', true, 'handoff')).toBe('aside');
    expect(chromeSpot('home', true, 'wipe')).toBe('hidden');
    expect(chromeSpot('aside', true, 'wipe')).toBe('aside');
    expect(chromeSpot('hidden', true, 'handoff')).toBe('hidden');
    expect(chromeSpot('hidden', false, 'wipe')).toBe('home');
  });

  const cut = ({ animate, transition }) => ({ animate, at: transition.duration * (transition.times?.[1] ?? 0) });

  it('under the stinger it moves only at the swap, in one frame, by opacity, both ways', () => {
    const out = cut(chromeMove('home', 'hidden', 'wipe', '-112%'));
    expect(out.animate).toEqual({ y: ['0%', '0%', '0%'], opacity: [1, 1, 0] });
    expect(out.at).toBeCloseTo(SWAP_AT);
    const back = cut(chromeMove('hidden', 'home', 'wipe', '-112%'));
    expect(back.animate).toEqual({ y: ['0%', '0%', '0%'], opacity: [0, 0, 1] });
    expect(back.at).toBeCloseTo(SWAP_AT);
    expect(chromeMove('hidden', 'home', 'wipe', '-112%').transition.duration - SWAP_AT).toBeLessThan(0.02);
  });

  it('coming home under the stinger from aside, the move of y hides behind opacity (a reduced-motion OS makes y instant)', () => {
    const back = cut(chromeMove('aside', 'home', 'wipe', '112%'));
    expect(back.animate).toEqual({ y: ['112%', '112%', '0%'], opacity: [0, 0, 1] });
    expect(back.at).toBeCloseTo(SWAP_AT);
  });

  it('on an ordinary change it slides on the wipe curve', () => {
    const { animate, transition } = chromeMove('home', 'aside', 'handoff', '-112%');
    expect(animate).toEqual({ y: ['0%', '-112%'], opacity: [1, 1] });
    expect(transition).toMatchObject({ duration: HANDOFF.chrome, ease: EASE.wipe });
    expect(chromeMove('aside', 'home', 'reveal', '112%').animate).toEqual({ y: ['112%', '0%'], opacity: [1, 1] });
    // Hidden has no position to rise from: it fades home in place.
    expect(chromeMove('hidden', 'home', 'reveal', '112%').animate).toEqual({ y: ['0%', '0%'], opacity: [0, 1] });
  });

  it('at rest it simply sits where it is', () => {
    expect(chromeMove(null, 'home', 'boot', '-112%').animate).toEqual({ y: '0%', opacity: 1 });
    expect(chromeMove(null, 'aside', 'boot', '-112%').animate).toEqual({ y: '-112%', opacity: 1 });
    expect(chromeMove(null, 'hidden', 'boot', '-112%').animate).toEqual({ y: '0%', opacity: 0 });
  });
});

describe('nextTransition', () => {
  it('an ordinary slide after an ordinary slide hands off, and swells the house wave once', () => {
    const a = firstTransition(showing('0:a'));
    expect(a).toMatchObject({ via: 'boot', wipe: false, wipes: 0, swells: 0 });
    const b = nextTransition(a, showing('1:b'));
    expect(b).toMatchObject({ via: 'handoff', wipe: false, wipes: 0, swells: 1 });
    expect(nextTransition(b, showing('1:b'))).toBe(b);
  });

  it('a held slide on either side wipes, and never swells', () => {
    const a = firstTransition(showing('0:a'));
    const held = nextTransition(a, showing('1:h', { special: true }));
    expect(held).toMatchObject({ via: 'wipe', wipe: true, wipes: 1, swells: 0 });
    const back = nextTransition(held, showing('2:a'));
    expect(back).toMatchObject({ via: 'wipe', wipe: true, wipes: 2, swells: 0 });
  });

  it('after a video the next words reveal; the field keeps its theme under the video', () => {
    const a = firstTransition(showing('0:a', { theme: 'night' }));
    const video = nextTransition(a, showing('1:v', { kind: 'video', theme: 'sunset' }));
    expect(video).toMatchObject({ via: 'handoff', theme: 'night', swells: 0 });
    const next = nextTransition(video, showing('2:b', { theme: 'meadow' }));
    expect(next).toMatchObject({ via: 'reveal', theme: 'meadow', swells: 0 });
  });

  it('an edit to the slide on screen takes the new facts and plays nothing', () => {
    const a = firstTransition(showing('0:a'));
    const edited = nextTransition(a, showing('0:a', { theme: 'night', special: true }));
    expect(edited).toMatchObject({ key: '0:a', theme: 'night', special: true, via: 'boot', wipes: 0, swells: 0 });
  });
});

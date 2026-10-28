// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cssAnimation, restPlan, resumeFromRest, settleToRest } from './ambientRest.js';
import { AMBIENT_REST_MS } from '../components/CatalogScene.jsx';
import { FLAGSHIP_INTRO } from './flagship.js';

// A CSS animation as the Web Animations API shows it: an 18 s loop with a
// negative delay (app.css offsets every loop to "started at page load").
function fakeLoop({ progress, delay = -7000, duration = 18000, iteration = 3, playState = 'running' }) {
  const anim = {
    animationName: 'lobby-roll',
    playState,
    playbackRate: 1,
    currentTime: delay + (iteration + progress) * duration,
    effect: {
      getComputedTiming: () => ({ duration, progress }),
      getTiming: () => ({ delay }),
    },
    pause: vi.fn(() => { anim.playState = 'paused'; }),
    play: vi.fn(() => { anim.playState = 'running'; }),
  };
  return anim;
}

describe('bringing the rolling wave to rest', () => {
  afterEach(() => vi.useRealTimers());

  it('goes to the NEAREST end of its loop, never slower than its own speed', () => {
    expect(restPlan(0.25, 18000, 3000)).toEqual({ rate: -1.5, ms: 3000 }); // back 4.5 s of roll in 3 s
    const near = restPlan(0.9, 18000, 3000); // on 1.8 s, at its usual pace
    expect(near.rate).toBe(1);
    expect(near.ms).toBeCloseTo(1800, 6);
    expect(restPlan(0.5, 18000, 3000).rate).toBe(3); // the far point: on, three times as fast
    expect(restPlan(0, 18000, 3000).ms).toBe(0);
    expect(restPlan(Number.NaN, 18000, 3000).ms).toBe(0);
  });

  it('is home in time for the intro to take the waves over', () => {
    // The worst case (half a loop away) arrives within AMBIENT_REST_MS...
    expect(restPlan(0.5, 18000, AMBIENT_REST_MS).ms).toBeLessThanOrEqual(AMBIENT_REST_MS);
    // ...which is well before the video starts.
    expect(AMBIENT_REST_MS).toBeLessThan(FLAGSHIP_INTRO.lead * 1000 - 500);
  });

  it('stops exactly on the end of a loop, and carries on from there when let go', () => {
    vi.useFakeTimers();
    const anim = fakeLoop({ progress: 0.8 });
    settleToRest(/** @type {any} */ (anim), 3000);
    expect(anim.playbackRate).toBeCloseTo(1.2, 9);
    anim.currentTime += 3000 * 1.2 + 7; // the clock overshoots a hair
    vi.advanceTimersByTime(3000);
    expect(anim.pause).toHaveBeenCalled();
    // active time (currentTime - delay) is a whole number of loops: at rest
    expect((anim.currentTime - -7000) % 18000).toBe(0);
    resumeFromRest(/** @type {any} */ (anim));
    expect(anim.play).toHaveBeenCalled();
    expect(anim.playbackRate).toBe(1);
  });

  it('leaves alone what is not rolling (zero animation, reduced motion, no Web Animations)', () => {
    const still = fakeLoop({ progress: 0.3, playState: 'idle' });
    settleToRest(/** @type {any} */ (still), 3000);
    expect(still.playbackRate).toBe(1);
    expect(() => settleToRest(null, 3000)()).not.toThrow();
    expect(() => resumeFromRest(null)).not.toThrow();
    expect(cssAnimation(null, 'lobby-roll')).toBeNull();
    expect(cssAnimation(/** @type {any} */ ({}), 'lobby-roll')).toBeNull();
    const el = { getAnimations: () => [{ animationName: 'lobby-drift-a' }, { animationName: 'lobby-roll', id: 'r' }] };
    expect(cssAnimation(/** @type {any} */ (el), 'lobby-roll')).toMatchObject({ id: 'r' });
  });
});

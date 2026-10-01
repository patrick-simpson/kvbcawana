import { describe, it, expect } from 'vitest';
import { checkInQueueReducer as reduce, holdMsFor, INITIAL_QUEUE_STATE } from './checkInQueue.js';
import { DEFAULT_HOLD_MS, MAX_QUEUE } from './constants.js';

const kid = (id, extra = {}) => ({
  id, firstName: `Kid${id}`, club: 'Sparks', isBirthday: false, isFirstTimer: false,
  welcomeBack: false, milestone: null, presentation: 'live', ...extra,
});
const run = (state, ...actions) => actions.reduce(reduce, state);

describe('holdMsFor', () => {
  const config = { standardDisplayMs: 6000, specialDisplayMs: 8000 };

  it('gives the special hold to birthdays and first-timers only', () => {
    expect(holdMsFor(kid(1), config)).toBe(6000);
    expect(holdMsFor(kid(1, { isBirthday: true }), config)).toBe(8000);
    expect(holdMsFor(kid(1, { isFirstTimer: true }), config)).toBe(8000);
    expect(holdMsFor(kid(1, { welcomeBack: true }), config)).toBe(6000);
  });

  it('falls back to the default for any broken setting, so a banner never flashes or sticks', () => {
    for (const bad of [NaN, 0, -1, Infinity, '6000', null, undefined]) {
      expect(holdMsFor(kid(1), { standardDisplayMs: bad })).toBe(DEFAULT_HOLD_MS);
    }
    expect(holdMsFor(null, {})).toBe(DEFAULT_HOLD_MS);
  });

  it('has no notion of a backlog at all', () => {
    // The old burst mode took the waiting count; this signature cannot.
    expect(holdMsFor.length).toBe(2);
  });
});

describe('checkInQueueReducer', () => {
  it('an arrival on an idle screen raises the wave at once and starts a run', () => {
    const s = run(INITIAL_QUEUE_STATE, { type: 'enqueue', event: kid(1) });
    expect(s.current.id).toBe(1);
    expect(s.run).toBe(1);
    expect(s.step).toBe(0);
    expect(s.queue).toEqual([]);
  });

  it('arrivals while someone is on screen wait their turn, in order', () => {
    const s = run(INITIAL_QUEUE_STATE,
      { type: 'enqueue', event: kid(1) },
      { type: 'enqueue', event: kid(2) },
      { type: 'enqueue', event: kid(3) });
    expect(s.current.id).toBe(1);
    expect(s.queue.map((k) => k.id)).toEqual([2, 3]);
  });

  it('a hold ending with someone waiting flips to them in the same run', () => {
    const s = run(INITIAL_QUEUE_STATE,
      { type: 'enqueue', event: kid(1) },
      { type: 'enqueue', event: kid(2) },
      { type: 'hold-done', id: 1 });
    expect(s.current.id).toBe(2);
    expect(s.run).toBe(1);
    expect(s.step).toBe(1);
    expect(s.gap).toBe(false);
  });

  it('a hold ending with nobody waiting ends the run and opens the gap', () => {
    const s = run(INITIAL_QUEUE_STATE, { type: 'enqueue', event: kid(1) }, { type: 'hold-done', id: 1 });
    expect(s.current).toBeNull();
    expect(s.gap).toBe(true);
  });

  it('an arrival during the gap waits for it, then starts the next run', () => {
    let s = run(INITIAL_QUEUE_STATE,
      { type: 'enqueue', event: kid(1) },
      { type: 'hold-done', id: 1 },
      { type: 'enqueue', event: kid(2) });
    expect(s.current).toBeNull();
    expect(s.queue.map((k) => k.id)).toEqual([2]);
    s = reduce(s, { type: 'gap-done' });
    expect(s.current.id).toBe(2);
    expect(s.run).toBe(2);
    expect(s.step).toBe(0);
    expect(s.gap).toBe(false);
  });

  it('the gap closing on an empty queue leaves the screen idle and ready', () => {
    let s = run(INITIAL_QUEUE_STATE, { type: 'enqueue', event: kid(1) }, { type: 'hold-done', id: 1 }, { type: 'gap-done' });
    expect(s).toMatchObject({ current: null, gap: false, run: 1 });
    s = reduce(s, { type: 'enqueue', event: kid(2) });
    expect(s.current.id).toBe(2);
    expect(s.run).toBe(2);
  });

  it('ignores a stale hold timer for a child who is no longer on screen', () => {
    const before = run(INITIAL_QUEUE_STATE,
      { type: 'enqueue', event: kid(1) },
      { type: 'enqueue', event: kid(2) },
      { type: 'hold-done', id: 1 });
    expect(reduce(before, { type: 'hold-done', id: 1 })).toBe(before);
    expect(reduce(INITIAL_QUEUE_STATE, { type: 'hold-done', id: 9 })).toBe(INITIAL_QUEUE_STATE);
    expect(reduce(INITIAL_QUEUE_STATE, { type: 'gap-done' })).toBe(INITIAL_QUEUE_STATE);
  });

  it('skip ends the run; whoever waits starts fresh after the gap', () => {
    let s = run(INITIAL_QUEUE_STATE,
      { type: 'enqueue', event: kid(1) },
      { type: 'enqueue', event: kid(2) },
      { type: 'skip' });
    expect(s.current).toBeNull();
    expect(s.gap).toBe(true);
    s = reduce(s, { type: 'gap-done' });
    expect(s.current.id).toBe(2);
    expect(s.run).toBe(2);
    expect(reduce(INITIAL_QUEUE_STATE, { type: 'skip' })).toBe(INITIAL_QUEUE_STATE);
  });

  it('caps what is in flight at MAX_QUEUE, keeping everyone already promised a moment', () => {
    let s = INITIAL_QUEUE_STATE;
    for (let i = 1; i <= MAX_QUEUE + 25; i++) s = reduce(s, { type: 'enqueue', event: kid(i) });
    expect(s.current.id).toBe(1);
    expect(s.queue).toHaveLength(MAX_QUEUE - 1);
    expect(s.queue[0].id).toBe(2);
    expect(s.queue.at(-1).id).toBe(MAX_QUEUE);
  });

  it('ignores an unknown action', () => {
    expect(reduce(INITIAL_QUEUE_STATE, { type: 'nope' })).toBe(INITIAL_QUEUE_STATE);
  });
});

describe('holding check-ins behind a special slide', () => {
  const hold = (held) => ({ type: 'hold', held });

  it('arrivals wait while held, in order, and play as one run when it lifts', () => {
    let s = run(INITIAL_QUEUE_STATE, hold(true),
      { type: 'enqueue', event: kid(1) },
      { type: 'enqueue', event: kid(2) });
    expect(s.current).toBeNull();
    expect(s.queue.map((k) => k.id)).toEqual([1, 2]);
    s = reduce(s, hold(false));
    expect(s.current.id).toBe(1);
    expect(s.run).toBe(1);
    s = reduce(s, { type: 'hold-done', id: 1 });
    // Same run: the second child flips in, full hold, no gap.
    expect(s.current.id).toBe(2);
    expect(s.run).toBe(1);
    expect(s.step).toBe(1);
  });

  it('never cuts off a run already on screen', () => {
    let s = run(INITIAL_QUEUE_STATE,
      { type: 'enqueue', event: kid(1) },
      { type: 'enqueue', event: kid(2) },
      hold(true));
    expect(s.current.id).toBe(1);
    s = reduce(s, { type: 'hold-done', id: 1 });
    expect(s.current.id).toBe(2);
  });

  it('a gap that closes while held waits; the lift then starts the run', () => {
    let s = run(INITIAL_QUEUE_STATE,
      { type: 'enqueue', event: kid(1) },
      { type: 'hold-done', id: 1 },
      hold(true),
      { type: 'enqueue', event: kid(2) },
      { type: 'gap-done' });
    expect(s.current).toBeNull();
    expect(s.gap).toBe(false);
    s = reduce(s, hold(false));
    expect(s.current.id).toBe(2);
    expect(s.run).toBe(2);
  });

  it('lifting with the post-run gap still open lets the gap finish first', () => {
    let s = run(INITIAL_QUEUE_STATE,
      { type: 'enqueue', event: kid(1) },
      { type: 'hold-done', id: 1 },
      hold(true),
      { type: 'enqueue', event: kid(2) },
      hold(false));
    expect(s.current).toBeNull();
    expect(s.gap).toBe(true);
    s = reduce(s, { type: 'gap-done' });
    expect(s.current.id).toBe(2);
  });

  it('a repeated hold value is a no-op, and a lift with nobody waiting just clears it', () => {
    const held = reduce(INITIAL_QUEUE_STATE, hold(true));
    expect(reduce(held, hold(true))).toBe(held);
    expect(reduce(held, hold(false))).toEqual(INITIAL_QUEUE_STATE);
  });

  it('holding never drops or reorders anyone, even past the cap', () => {
    let s = reduce(INITIAL_QUEUE_STATE, hold(true));
    for (let i = 1; i <= MAX_QUEUE + 5; i++) s = reduce(s, { type: 'enqueue', event: kid(i) });
    // Nobody is on screen while held, so the whole line fits the cap.
    expect(s.queue).toHaveLength(MAX_QUEUE);
    expect(s.queue.map((k) => k.id)).toEqual(Array.from({ length: MAX_QUEUE }, (_, i) => i + 1));
  });
});

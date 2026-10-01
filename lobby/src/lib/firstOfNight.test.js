import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  FIRST_OF_NIGHT_KEY,
  clearFirstOfNight,
  firstOfNightCopy,
  hasFiredToday,
  isFirstOfNight,
  markFiredToday,
} from './firstOfNight.js';

// The gates matter more than the flourish. Two of them exist because the
// feature is otherwise a lie:
//
//   - a screen that boots mid-program cannot know who arrived first, so every
//     phase after the first window is excluded;
//   - a recap replay is history catching up after a reconnect, so a replayed
//     child must never be crowned.
//
// The third assertion in this file is a privacy one: the persisted entry holds
// a date string and nothing else.

/** The all-pass input; each case below spoils exactly one field. */
const OPEN = { count: 0, phase: 'countdown', presentation: 'live', alreadyFired: false };

describe('isFirstOfNight', () => {
  it('passes for a live arrival on a screen that was awake before doors', () => {
    expect(isFirstOfNight(OPEN)).toBe(true);
    expect(isFirstOfNight({ ...OPEN, phase: 'off' })).toBe(true);
  });

  it('never fires for a recap replay or a late-phase arrival', () => {
    expect(isFirstOfNight({ ...OPEN, presentation: 'replay' })).toBe(false);
    expect(isFirstOfNight({ ...OPEN, presentation: 'late' })).toBe(false);
    expect(isFirstOfNight({ ...OPEN, presentation: undefined })).toBe(false);
  });

  it('never fires once this device has already counted somebody', () => {
    expect(isFirstOfNight({ ...OPEN, count: 1 })).toBe(false);
    expect(isFirstOfNight({ ...OPEN, count: 42 })).toBe(false);
  });

  it('never fires on a screen that booted after the program started', () => {
    for (const phase of ['ceremony', 'game-time', 'closing', 'shutdown']) {
      expect(isFirstOfNight({ ...OPEN, phase })).toBe(false);
    }
  });

  it('never fires twice', () => {
    expect(isFirstOfNight({ ...OPEN, alreadyFired: true })).toBe(false);
  });

  it('fails closed on junk input rather than guessing', () => {
    expect(isFirstOfNight({ ...OPEN, count: undefined })).toBe(false);
    expect(isFirstOfNight({ ...OPEN, count: -1 })).toBe(false);
    expect(isFirstOfNight({ ...OPEN, count: 0.5 })).toBe(false);
    expect(isFirstOfNight({ ...OPEN, count: '0' })).toBe(false);
    expect(isFirstOfNight({ ...OPEN, phase: undefined })).toBe(false);
    expect(isFirstOfNight({ ...OPEN, phase: 'nonsense' })).toBe(false);
    expect(isFirstOfNight({})).toBe(false);
    expect(isFirstOfNight()).toBe(false);
  });
});

describe('the day key', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('is empty until the flourish has been spent, then holds for the day', () => {
    expect(hasFiredToday()).toBe(false);
    markFiredToday();
    expect(hasFiredToday()).toBe(true);
  });

  it('stores a DATE STRING AND NOTHING ELSE — no name, no club, no count', () => {
    markFiredToday(new Date(2026, 8, 9, 18, 2));
    const raw = JSON.parse(localStorage.getItem(FIRST_OF_NIGHT_KEY));
    expect(Object.keys(raw)).toEqual(['date']);
    expect(raw.date).toBe('2026-09-09');
  });

  it('lets last week\'s entry expire instead of muting tonight', () => {
    localStorage.setItem(FIRST_OF_NIGHT_KEY, JSON.stringify({ date: '2020-01-01' }));
    expect(hasFiredToday()).toBe(false);
  });

  it('reads corrupt storage as "not yet fired" rather than throwing', () => {
    localStorage.setItem(FIRST_OF_NIGHT_KEY, 'not json at all');
    expect(hasFiredToday()).toBe(false);
  });

  it('survives blocked storage in both directions', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(hasFiredToday()).toBe(false);
    expect(() => markFiredToday()).not.toThrow();
  });

  it('is given back by clearFirstOfNight, so a rehearsal is undoable', () => {
    markFiredToday();
    expect(hasFiredToday()).toBe(true);
    clearFirstOfNight();
    expect(hasFiredToday()).toBe(false);
    expect(localStorage.getItem(FIRST_OF_NIGHT_KEY)).toBe(null);
  });

  it('does not throw when removal is blocked', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => clearFirstOfNight()).not.toThrow();
  });
});

describe('firstOfNightCopy', () => {
  it('announces the doors, naming only the first name', () => {
    expect(firstOfNightCopy('Ava')).toEqual({
      label: 'Doors are open',
      headline: 'Ava is first in tonight!',
    });
  });
});

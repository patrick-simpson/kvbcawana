import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSeenEvents } from './useSeenEvents.js';
import { SEEN_EVENTS_MAX } from '../lib/constants.js';

const STORAGE_KEY = 'awanaSeenEvents.v1';

function Harness({ onReady }) {
  onReady(useSeenEvents());
  return null;
}

function setup() {
  const api = { current: null };
  render(<Harness onReady={(s) => { api.current = s; }} />);
  return api;
}

function todayKey(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY));

describe('useSeenEvents', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  afterEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('remembers an id it has marked', () => {
    const api = setup();
    expect(api.current.hasSeen('a1')).toBe(false);
    act(() => { api.current.markSeen('a1', 1000); });
    expect(api.current.hasSeen('a1')).toBe(true);
  });

  it('ignores a missing or non-string id', () => {
    const api = setup();
    act(() => { api.current.markSeen(''); api.current.markSeen(null); api.current.markSeen(7); });
    expect(api.current.stats().size).toBe(0);
  });

  // THE POINT OF THIS FILE. The count lives in localStorage under a day
  // stamp; the ledger that stops it double counting has to have exactly the
  // same lifetime. On sessionStorage it had a shorter one, so a kiosk relaunch
  // kept tonight's number and forgot everyone already counted, and the next
  // recap replayed the whole window straight back into the total.
  it('persists to localStorage under today\'s date, not sessionStorage', () => {
    const api = setup();
    act(() => { api.current.markSeen('a1', 1000); });

    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(stored().date).toBe(todayKey());
    expect(stored().entries).toEqual([['a1', 1000]]);
  });

  it('reloads what a previous run of the same day stored', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      date: todayKey(), entries: [['a1', 1000], ['a2', 2000]],
    }));
    const api = setup();
    expect(api.current.hasSeen('a1')).toBe(true);
    expect(api.current.hasSeen('a2')).toBe(true);
    expect(api.current.stats().size).toBe(2);
  });

  it('prunes a previous day wholesale', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      date: '2000-01-01', entries: [['a1', 1000]],
    }));
    const api = setup();
    expect(api.current.hasSeen('a1')).toBe(false);
    expect(api.current.stats().size).toBe(0);

    // ...and the next write re-stamps the entry with today.
    act(() => { api.current.markSeen('b1', 5000); });
    expect(stored().date).toBe(todayKey());
    expect(stored().entries).toEqual([['b1', 5000]]);
  });

  it('starts empty on corrupt or legacy-shaped storage', () => {
    localStorage.setItem(STORAGE_KEY, 'not json');
    expect(setup().current.stats().size).toBe(0);

    localStorage.clear();
    // The old sessionStorage shape was a bare array of pairs.
    localStorage.setItem(STORAGE_KEY, JSON.stringify([['a1', 1000]]));
    expect(setup().current.stats().size).toBe(0);
  });

  it('trims the oldest entries past the cap', () => {
    const api = setup();
    act(() => {
      for (let i = 0; i < SEEN_EVENTS_MAX + 5; i++) api.current.markSeen(`id-${i}`, i);
    });
    expect(api.current.stats().size).toBe(SEEN_EVENTS_MAX);
    expect(api.current.hasSeen('id-0')).toBe(false);
    expect(api.current.hasSeen(`id-${SEEN_EVENTS_MAX + 4}`)).toBe(true);
  });

  it('survives blocked storage without throwing', () => {
    const real = localStorage.setItem;
    localStorage.setItem = () => { throw new Error('blocked'); };
    try {
      const api = setup();
      act(() => { api.current.markSeen('a1', 1000); });
      // In-memory dedupe still works for tonight, which is what matters.
      expect(api.current.hasSeen('a1')).toBe(true);
    } finally {
      localStorage.setItem = real;
    }
  });
});

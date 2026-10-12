import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { night, setup } from './test/appHarness.js';

// "COUNTS RISING, NO NAMES — CHECK THE PRINTER", end to end (owner report,
// 2026-10-11: it was up on a Sunday). The sync Worker replays the last
// `tonight` frame to a screen that connects, and the alarm used to read any
// count above zero with no name for six minutes as the fault. It must fire
// only on a rise this screen sees, with no name following.

import { fakeLive } from './lib/__fixtures__/fakeLive.js';
const live = fakeLive();
const bound = live.bound;

const App = (await import('./App.jsx')).default;

const MIN = 60 * 1000;
const alarmUp = (c) => c.textContent.includes('COUNTS RISING, NO NAMES');

beforeEach(() => {
  live.reset();
  localStorage.clear();
  live.signIn();
  sessionStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date(2026, 9, 11, 12, 30, 0));   // a Sunday afternoon
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

async function mount() {
  setup();
  let utils;
  await act(async () => { utils = render(<App />); });
  await vi.waitFor(() => expect(bound.tonight).toBeTypeOf('function'));
  return utils.container;
}

describe('counts rising, no names', () => {
  it('stays down on a Sunday when the Worker replays last Wednesday\'s count', async () => {
    const c = await mount();
    const wednesday = new Date(2026, 9, 7, 20, 15).getTime();
    await act(async () => { bound.tonight(night(118, wednesday)); });
    await act(async () => { vi.advanceTimersByTime(20 * MIN); });
    expect(alarmUp(c)).toBe(false);
  });

  it('stays down on a screen opened mid-evening, after the names went by', async () => {
    const c = await mount();
    for (let i = 0; i < 6; i += 1) {
      await act(async () => { bound.tonight(night(63)); });
      await act(async () => { vi.advanceTimersByTime(2 * MIN); });
    }
    expect(alarmUp(c)).toBe(false);
  });

  it('comes up when the count rises while the screen watches and no name follows', async () => {
    const c = await mount();
    await act(async () => { bound.tonight(night(40)); });
    await act(async () => { vi.advanceTimersByTime(MIN); });
    await act(async () => { bound.tonight(night(44)); });
    for (let i = 0; i < 4; i += 1) {
      await act(async () => { vi.advanceTimersByTime(2 * MIN); });
      await act(async () => { bound.tonight(night(44)); });
    }
    await act(async () => { vi.advanceTimersByTime(30 * 1000); });
    expect(alarmUp(c)).toBe(true);
  });
});

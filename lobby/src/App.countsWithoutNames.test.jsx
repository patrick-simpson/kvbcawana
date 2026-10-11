import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

// "COUNTS RISING, NO NAMES — CHECK THE PRINTER", end to end (owner report,
// 2026-10-11: it was up on a Sunday). The sync Worker replays the last
// `tonight` frame to a screen that connects, and the alarm used to read any
// count above zero with no name for six minutes as the fault. It must fire
// only on a rise this screen sees, with no name following.

let bound = {};
vi.mock('pusher-js', () => ({
  default: class FakePusher {
    constructor() {
      this.connection = { state: 'connected', bind: () => {}, unbind: () => {} };
    }
    subscribe() { return { bind: (evt, fn) => { bound[evt] = fn; }, unbind_all: () => {} }; }
    unsubscribe() {}
    disconnect() {}
    connect() {}
  },
}));

const App = (await import('./App.jsx')).default;
const cfg = await import('./hooks/useConfig.js');

function setup() {
  localStorage.setItem('awanaConfig.v1', JSON.stringify({
    pusherAppKey: 'k', pusherCluster: 'us2', confettiLevel: 'off', firstArrivalMoment: false,
    sharedScheduleUrl: '', backgroundSource: 'manual', calendarEnabled: false, seasonPromos: false,
    manualSlides: [{ id: 's_1', type: 'text', eyebrow: 'This week', text: 'Bring your handbook', theme: 'sky' }],
    reduceMotion: true,
  }));
  cfg._resetForTest();
}

const MIN = 60 * 1000;
const frame = (checkedIn, at = Date.now()) => ({ checkedIn, booksCompleted: 0, awardsEarned: 0, friendsBrought: 0, at });
const alarmUp = (c) => c.textContent.includes('COUNTS RISING, NO NAMES');

beforeEach(() => {
  bound = {};
  localStorage.clear();
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
    await act(async () => { bound.tonight(frame(118, wednesday)); });
    await act(async () => { vi.advanceTimersByTime(20 * MIN); });
    expect(alarmUp(c)).toBe(false);
  });

  it('stays down on a screen opened mid-evening, after the names went by', async () => {
    const c = await mount();
    for (let i = 0; i < 6; i += 1) {
      await act(async () => { bound.tonight(frame(63)); });
      await act(async () => { vi.advanceTimersByTime(2 * MIN); });
    }
    expect(alarmUp(c)).toBe(false);
  });

  it('comes up when the count rises while the screen watches and no name follows', async () => {
    const c = await mount();
    await act(async () => { bound.tonight(frame(40)); });
    await act(async () => { vi.advanceTimersByTime(MIN); });
    await act(async () => { bound.tonight(frame(44)); });
    for (let i = 0; i < 4; i += 1) {
      await act(async () => { vi.advanceTimersByTime(2 * MIN); });
      await act(async () => { bound.tonight(frame(44)); });
    }
    await act(async () => { vi.advanceTimersByTime(30 * 1000); });
    expect(alarmUp(c)).toBe(true);
  });
});

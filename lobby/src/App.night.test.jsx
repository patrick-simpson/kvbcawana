import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

// A NEW NIGHT ON A SCREEN THAT STAYS UP. The once-per-night ledgers (the
// 25/50/100 crossings and friends) and tonight's count lived as long as the
// page, so a TV left up all week celebrated nothing on the second Wednesday
// and read last week's count in the corner. At midnight App starts them over.
// Events go in through the real socket seam, as in App.overlays.test.jsx; the
// clock is faked so the minute tick that notices the date can be driven.

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

const night = (checkedIn) => ({ checkedIn, booksCompleted: 0, awardsEarned: 0, friendsBrought: 0, at: Date.now() });
const toast = (c) => c.querySelector('.milestone-toast');

beforeEach(() => {
  bound = {};
  localStorage.clear();
  sessionStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date(2026, 9, 7, 23, 58, 0));   // Wednesday, two minutes to midnight
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('a new night', () => {
  it('the night milestones fire again after midnight, from a fresh baseline', async () => {
    setup();
    let utils;
    await act(async () => { utils = render(<App />); });
    await vi.waitFor(() => expect(bound.tonight).toBeTypeOf('function'));
    const { container } = utils;

    // Tonight: 48 is the baseline, 51 crosses 50.
    await act(async () => { bound.tonight(night(48)); });
    await act(async () => { bound.tonight(night(51)); });
    await vi.waitFor(() => expect(toast(container)).not.toBeNull());
    // The toast runs its course; the same crossing again tonight is nothing.
    await act(async () => { vi.advanceTimersByTime(30000); });
    await vi.waitFor(() => expect(toast(container)).toBeNull());
    await act(async () => { bound.tonight(night(49)); });
    await act(async () => { bound.tonight(night(51)); });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(toast(container)).toBeNull();

    // Midnight passes; the minute tick notices the new date.
    vi.setSystemTime(new Date(2026, 9, 8, 0, 0, 30));
    await act(async () => { vi.advanceTimersByTime(60000); });

    // Next week (the page is still up): 48 is a baseline again, never a replay...
    await act(async () => { bound.tonight(night(48)); });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(toast(container)).toBeNull();
    // ...and the crossing celebrates again.
    await act(async () => { bound.tonight(night(51)); });
    await vi.waitFor(() => expect(toast(container)).not.toBeNull());
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { NOTICE_MAX_AGE_MS } from './lib/constants.js';

// WHO HOLDS WHICH PART OF THE ROOM (rebrand stage 4b-2): whole-App tests of
// the rules src/lib/overlayFit.js lobbyRoom decides and App wires up: the
// slide copy steps aside for whatever holds the middle, the pickup board is
// the room's focus only at pickup time, a critical notice keeps to the band
// over the board, a band notice gives the band to a toast, and the takeover
// and the banner judge a notice on one clock. Events go in through the real
// socket seam (sanitizers and all), as in App.tally.test.jsx.

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

const pad = (n) => String(n).padStart(2, '0');
// The pickup window (Settings → Pickup board) around the real clock: open
// (half an hour either side of now) or shut (starting an hour from now).
function pickupWindow(open) {
  const d = new Date();
  const mins = d.getHours() * 60 + d.getMinutes();
  const hm = (m) => { const w = ((m % 1440) + 1440) % 1440; return `${pad(Math.floor(w / 60))}:${pad(w % 60)}`; };
  return open
    ? { checkoutBoardFrom: hm(mins - 30), checkoutBoardUntil: hm(mins + 30) }
    : { checkoutBoardFrom: hm(mins + 60), checkoutBoardUntil: hm(mins + 120) };
}

function setup(config = {}) {
  localStorage.setItem('awanaConfig.v1', JSON.stringify({
    pusherAppKey: 'k',
    pusherCluster: 'us2',
    confettiLevel: 'off',
    firstArrivalMoment: false,
    sharedScheduleUrl: '',
    backgroundSource: 'manual',
    calendarEnabled: false,
    seasonPromos: false,
    manualSlides: [{ id: 's_1', type: 'text', eyebrow: 'This week', text: 'Bring your handbook', theme: 'sky' }],
    // Zero animation: what is on screen is the resting state, at once.
    reduceMotion: true,
    ...config,
  }));
  cfg._resetForTest();
}

async function mount() {
  let utils;
  await act(async () => { utils = render(<App />); });
  await waitFor(() => expect(bound.notice).toBeTypeOf('function'));
  return utils;
}

const stage = (c) => c.querySelector('.stage');
const has = (c, cls) => stage(c).classList.contains(cls);
const kids = (n) => Array.from({ length: n }, (_, i) => ({ firstName: `Kid${i}`, club: ['Sparks', 'T&T', 'Cubbies'][i % 3] }));

beforeEach(() => {
  bound = {};
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('the room rules, wired up', () => {
  it('a critical notice takes the middle and the copy steps aside; clearing it brings the copy back', async () => {
    setup();
    const { container } = await mount();
    expect(has(container, 'notice-takeover')).toBe(false);
    await act(async () => { bound.notice({ level: 'critical', message: 'CLUB CANCELLED TONIGHT', at: Date.now() }); });
    expect(has(container, 'notice-takeover')).toBe(true);
    expect(container.querySelector('.notice-banner--critical').classList.contains('is-band')).toBe(false);
    // A band notice does not take the middle.
    await act(async () => { bound.notice({ level: 'info', message: 'Snacks in the hall', at: Date.now() + 1 }); });
    expect(has(container, 'notice-takeover')).toBe(false);
  });

  it('at pickup time a live list takes the middle; during the program it waits at the foot beside the slides', async () => {
    setup({ checkoutBoardMode: 'always', ...pickupWindow(true) });
    const pickup = await mount();
    await act(async () => { bound.checkout({ entries: kids(9), printed: 40, at: Date.now() }); });
    expect(has(pickup.container, 'board-up')).toBe(true);
    expect(pickup.container.querySelector('.checkout-region--foot')).toBeNull();
    expect(pickup.container.querySelectorAll('.checkout-name__chip')).toHaveLength(9);
    cleanup();

    bound = {};
    setup({ checkoutBoardMode: 'always', ...pickupWindow(false) });
    const program = await mount();
    await act(async () => { bound.checkout({ entries: kids(9), printed: 40, at: Date.now() }); });
    expect(has(program.container, 'board-up')).toBe(false);
    expect(program.container.querySelector('.checkout-region--foot .checkout-board--foot')).not.toBeNull();
    expect(program.container.querySelector('.checkout-name__chip')).toBeNull();
  });

  it('a stale board never blanks the slides, even in the pickup window', async () => {
    setup({ checkoutBoardMode: 'always', ...pickupWindow(true) });
    const { container } = await mount();
    await act(async () => { bound.checkout({ entries: kids(9), printed: 40, at: Date.now() - 26 * 3600 * 1000 }); });
    expect(container.querySelector('.checkout-board.stale.checkout-board--foot')).not.toBeNull();
    expect(has(container, 'board-up')).toBe(false);
  });

  it('over the pickup list a critical notice keeps to the band, and both stay whole', async () => {
    setup({ checkoutBoardMode: 'always', ...pickupWindow(true) });
    const { container } = await mount();
    await act(async () => { bound.checkout({ entries: kids(12), printed: 40, at: Date.now() }); });
    await act(async () => { bound.notice({ level: 'critical', message: 'SEVERE WEATHER: everyone stays inside', at: Date.now() }); });
    expect(has(container, 'board-up')).toBe(true);
    expect(has(container, 'notice-takeover')).toBe(false);
    expect(container.querySelector('.notice-banner--critical').classList.contains('is-band')).toBe(true);
    expect(container.querySelectorAll('.checkout-name__chip')).toHaveLength(12);
  });

  it('with a critical notice over the pickup list, celebrations wait for the band', async () => {
    setup({ checkoutBoardMode: 'always', ...pickupWindow(true) });
    const { container } = await mount();
    await act(async () => { bound.checkout({ entries: kids(12), printed: 40, at: Date.now() }); });
    await act(async () => { bound.notice({ level: 'critical', message: 'SEVERE WEATHER: everyone stays inside', at: Date.now() }); });
    await act(async () => { bound.tonight({ checkedIn: 48, booksCompleted: 0, awardsEarned: 0, friendsBrought: 0, at: Date.now() }); });
    await act(async () => { bound.tonight({ checkedIn: 51, booksCompleted: 0, awardsEarned: 0, friendsBrought: 0, at: Date.now() }); });
    await new Promise((r) => setTimeout(r, 200));
    expect(container.querySelector('.milestone-toast')).toBeNull();
    // The alert goes: the band is free, and the toast that waited comes up.
    await act(async () => { bound.notice({ level: 'info', message: 'All clear', at: Date.now() + 1 }); });
    await waitFor(() => expect(container.querySelector('.milestone-toast')).not.toBeNull());
  });

  it('a flag tab hanging from the top edge pushes the band down', async () => {
    setup();
    const { container } = await mount();
    expect(has(container, 'has-flags')).toBe(false);
    await act(async () => { bound.tally({ counts: { Sparks: 1 }, total: 1, at: Date.now(), rehearsal: true }); });
    expect(has(container, 'has-flags')).toBe(true);
    expect(container.querySelector('.top-flags .rehearsal-pill')).not.toBeNull();
  });

  it('a band notice gives the band to a milestone toast and takes it back after', async () => {
    setup();
    const { container } = await mount();
    const opacity = (el) => Number(el.style.opacity === '' ? 1 : el.style.opacity);
    await act(async () => { bound.notice({ level: 'info', message: 'Bring your Bible next week', at: Date.now() }); });
    await waitFor(() => expect(opacity(container.querySelector('.notice-banner--info'))).toBe(1));
    // The first tonight payload is only a baseline; the second crosses 50.
    await act(async () => { bound.tonight({ checkedIn: 48, booksCompleted: 0, awardsEarned: 0, friendsBrought: 0, at: Date.now() }); });
    await act(async () => { bound.tonight({ checkedIn: 51, booksCompleted: 0, awardsEarned: 0, friendsBrought: 0, at: Date.now() }); });
    await waitFor(() => expect(container.querySelector('.milestone-toast')).not.toBeNull());
    await waitFor(() => expect(opacity(container.querySelector('.notice-banner--info'))).toBe(0));
  });
});

describe('the first-run card\'s seat', () => {
  // The card stands in the foot of the lobby, in the strip under the copy's
  // lowest line (OVERLAY.setup). App asks setupUp() whether the room has
  // space for it, and clears the tonight strip out of the foot while it is up.
  const card = (c) => c.querySelector('.setup-card');
  const ticker = (c) => c.querySelector('.tonight-ticker');
  const night = () => ({ checkedIn: 12, booksCompleted: 0, awardsEarned: 0, friendsBrought: 0, at: Date.now() });

  it('an unconfigured screen shows it, and the card gives the foot to the tonight strip while the strip has counts', async () => {
    setup();
    const { container } = await mount();
    expect(card(container)).not.toBeNull();
    // Counts to show: the strip is what the lobby is showing, so the card waits.
    await act(async () => { bound.tonight(night()); });
    expect(ticker(container)).not.toBeNull();
    expect(card(container)).toBeNull();
    // Nothing to show (every stat zero) and the strip stays away: the card is back.
    await act(async () => { bound.tonight({ ...night(), checkedIn: 0 }); });
    await waitFor(() => expect(ticker(container)).toBeNull());
    expect(card(container)).not.toBeNull();
  });

  it('the card comes back when the tonight feed goes stale, on the strip\'s own clock', async () => {
    // Only the intervals and the wall clock are faked: framer-motion keeps its own frame clock.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    setup();
    const { container } = await mount();
    await act(async () => { bound.tonight(night()); });
    expect(ticker(container)).not.toBeNull();
    expect(card(container)).toBeNull();
    for (let i = 0; i < 22; i++) await act(async () => { vi.advanceTimersByTime(30_000); });
    // Eleven minutes on: no broadcast since, so the strip is gone and the card has the foot back.
    await waitFor(() => expect(ticker(container)).toBeNull());
    expect(card(container)).not.toBeNull();
  });

  it('a configured screen never shows it, and the strip is never held back', async () => {
    localStorage.setItem('awanaSetupCardDismissed.v1', '1');
    setup();
    const { container } = await mount();
    await act(async () => { bound.tonight(night()); });
    expect(card(container)).toBeNull();
    expect(ticker(container)).not.toBeNull();
  });

  it('waits behind a critical notice that takes the middle, and comes back when it goes', async () => {
    setup();
    const { container } = await mount();
    expect(card(container)).not.toBeNull();
    await act(async () => { bound.notice({ level: 'critical', message: 'CLUB CANCELLED TONIGHT', at: Date.now() }); });
    expect(has(container, 'notice-takeover')).toBe(true);
    expect(card(container)).toBeNull();
    await act(async () => { bound.notice({ level: 'info', message: 'All clear', at: Date.now() + 1 }); });
    expect(card(container)).not.toBeNull();
  });

  it('waits behind a pickup list, and behind the board\'s one-line card at the foot', async () => {
    setup({ checkoutBoardMode: 'always', ...pickupWindow(true) });
    const list = await mount();
    expect(card(list.container)).not.toBeNull();
    await act(async () => { bound.checkout({ entries: kids(9), printed: 40, at: Date.now() }); });
    expect(has(list.container, 'board-up')).toBe(true);
    expect(card(list.container)).toBeNull();
    cleanup();

    bound = {};
    setup({ checkoutBoardMode: 'always', ...pickupWindow(false) });
    const foot = await mount();
    expect(card(foot.container)).not.toBeNull();
    await act(async () => { bound.checkout({ entries: kids(9), printed: 40, at: Date.now() }); });
    expect(foot.container.querySelector('.checkout-board--foot')).not.toBeNull();
    expect(card(foot.container)).toBeNull();
  });

  it('gives way to a name: the check-in wave rises through the foot', async () => {
    setup();
    const { container } = await mount();
    expect(card(container)).not.toBeNull();
    await act(async () => { bound.checkin({ firstName: 'Ann', club: 'Sparks', id: 'a1', at: Date.now() }); });
    expect(has(container, 'checkin-active')).toBe(true);
    expect(card(container)).toBeNull();
  });

  it('opening Settings takes it off the stage, and closing Settings brings it back', async () => {
    setup();
    const { container } = await mount();
    await act(async () => { container.querySelector('.setup-card .primary').click(); });
    expect(container.querySelector('.panel--tabbed')).not.toBeNull();
    expect(card(container)).toBeNull();
    // Escape closes an untouched panel, and the card is still due.
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await waitFor(() => expect(container.querySelector('.panel--tabbed')).toBeNull());
    expect(card(container)).not.toBeNull();
  });
});

describe('one clock for a notice', () => {
  it('the takeover and the banner go together when a critical notice expires, whatever the board is doing', async () => {
    // Only the intervals and the wall clock are faked: framer-motion keeps
    // its own frame clock, and the socket's timers stay real.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    setup({ checkoutBoardMode: 'off' });
    const { container } = await mount();
    const agree = () => {
      const banner = container.querySelector('.notice-banner--critical') != null;
      expect(has(container, 'notice-takeover')).toBe(banner);
      return banner;
    };
    const t0 = Date.now();
    await act(async () => { bound.notice({ level: 'critical', message: 'CLUB CANCELLED', at: t0 - NOTICE_MAX_AGE_MS + 40_000 }); });
    expect(agree()).toBe(true);
    // A checkout payload arriving mid-way re-stamps the board's own ticker;
    // it must not move the notice's.
    await act(async () => { vi.advanceTimersByTime(12_500); });
    await act(async () => { bound.checkout({ entries: kids(3), printed: 5, at: Date.now() }); });
    for (let i = 0; i < 8; i++) {
      await act(async () => { vi.advanceTimersByTime(7_500); });
      agree();
    }
    expect(agree()).toBe(false);
  });
});

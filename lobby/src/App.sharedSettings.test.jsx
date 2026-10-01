import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { NOTICE_MAX_AGE_MS } from './lib/constants.js';

// (setup borrowed from App.overlays.test.jsx)
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

const kids = (n) => Array.from({ length: n }, (_, i) => ({ firstName: `Kid${i}`, club: ['Sparks', 'T&T', 'Cubbies'][i % 3] }));

// SHARED SETTINGS (contract v6), end to end through the real socket seam:
// a `settings` frame from the print server changes what this screen does,
// a per-screen key cannot ride it, and a shared change made in Settings here
// goes to the print server on this computer, with the publish token.

beforeEach(() => {
  bound = {};
  localStorage.clear();
  sessionStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); cfg._resetForTest(); });

describe('shared settings, wired up', () => {
  it('a settings frame turns on the pickup board here, and cannot touch a per-screen key', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    setup();
    const { container } = await mount();
    await act(async () => {
      bound.settings({
        rev: 2, publishedAt: new Date().toISOString(),
        settings: { checkoutBoardMode: 'always', ...pickupWindow(true), backgroundSource: 'video', reduceMotion: false },
      });
    });
    await act(async () => { bound.checkout({ entries: kids(9), printed: 40, at: Date.now() }); });
    expect(container.querySelectorAll('.checkout-name__chip')).toHaveLength(9);
    // The per-screen keys it smuggled in are gone: still zero animation, still typed slides.
    expect(document.documentElement.classList.contains('zero-animation-mode')).toBe(true);
    expect(JSON.parse(localStorage.getItem('awanaSharedSettings.v1')).settings).not.toHaveProperty('backgroundSource');
  });

  it('a screen that does not follow ignores it', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    setup({ followSharedSettings: false });
    const { container } = await mount();
    await act(async () => {
      bound.settings({ rev: 2, publishedAt: new Date().toISOString(), settings: { checkoutBoardMode: 'always', ...pickupWindow(true) } });
    });
    await act(async () => { bound.checkout({ entries: kids(9), printed: 40, at: Date.now() }); });
    expect(container.querySelector('.checkout-board')).toBeNull();
  });

  it('a shared change in Settings is sent to the print server on this computer, with the token', async () => {
    const fetchFn = vi.fn(async (url) => {
      if (String(url).includes('/api/display-settings')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, rev: 7, publishedAt: new Date().toISOString(), keyCount: 36 }) };
      }
      throw new Error('offline');
    });
    vi.stubGlobal('fetch', fetchFn);
    setup();
    localStorage.setItem('awanaPublishToken.v1', 'tok_AbCdEfGhIjKlMnOpQrStUvWx');
    const { container, getByLabelText, getByRole, findByText } = await mount();
    await act(async () => { getByLabelText('Open settings').click(); });
    await act(async () => { getByRole('tab', { name: 'Celebrations' }).click(); });
    const input = getByLabelText('Room milestone (every N check-ins)');
    await act(async () => {
      input.focus();
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(input, '40');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.blur();
    });
    expect(await findByText('Sent to every screen.', {}, { timeout: 3000 })).toBeTruthy();
    const call = fetchFn.mock.calls.find(([url]) => String(url).includes('/api/display-settings'));
    expect(call[0]).toBe('http://localhost:3456/api/display-settings');
    expect(call[1].headers.Authorization).toBe('Bearer tok_AbCdEfGhIjKlMnOpQrStUvWx');
    expect(JSON.parse(call[1].body).settings.milestoneEvery).toBe(40);
    expect(JSON.parse(localStorage.getItem('awanaSharedSettings.v1'))).toMatchObject({ rev: 7 });
    void container;
  });
});

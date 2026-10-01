import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor, fireEvent } from '@testing-library/react';
import { EMBED_FULLSCREEN_MESSAGE } from './lib/constants.js';

// DOUBLE-CLICK FULLSCREEN: who actually goes fullscreen.
//
// Standalone, a double-click on the stage fullscreens the stage, as it always
// has. Inside the Journey Display kiosk's iframe that would fullscreen only
// the frame, covering Journey's own corner buttons with no way back, so the
// request is handed up to the parent page instead. A whole-App test because
// the behaviour lives in the stage's own onDoubleClick handler.

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

async function mount() {
  await act(async () => { render(<App />); });
  await waitFor(() => expect(document.querySelector('.stage')).not.toBeNull());
  return document.querySelector('.stage');
}

let requestFullscreen;

beforeEach(() => {
  bound = {};
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('awanaConfig.v1', JSON.stringify({
    pusherAppKey: 'k',
    pusherCluster: 'us2',
    confettiLevel: 'off',
    firstArrivalMoment: false,
  }));
  cfg._resetForTest();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // jsdom implements neither of these; the app only calls them behind ?.
  requestFullscreen = vi.fn(() => Promise.resolve());
  Element.prototype.requestFullscreen = requestFullscreen;
});
afterEach(() => {
  cleanup();
  delete Element.prototype.requestFullscreen;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('double-click fullscreen', () => {
  it('fullscreens the stage when the display is standalone', async () => {
    const post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
    const stage = await mount();

    // No stubbing here: in jsdom window.self === window.top, which is exactly
    // the standalone case.
    await act(async () => { fireEvent.doubleClick(stage); });

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen.mock.instances[0]).toBe(stage);
    expect(post).not.toHaveBeenCalled();
  });

  it('asks the parent page instead when embedded in an iframe', async () => {
    const post = vi.fn();
    vi.stubGlobal('top', { name: 'a-different-window' });
    vi.stubGlobal('parent', { postMessage: post });
    const stage = await mount();

    await act(async () => { fireEvent.doubleClick(stage); });

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ type: EMBED_FULLSCREEN_MESSAGE }, '*');
    // Nothing sensitive rides along: the message is its type and nothing else.
    expect(Object.keys(post.mock.calls[0][0])).toEqual(['type']);
    expect(requestFullscreen).not.toHaveBeenCalled();
  });
});

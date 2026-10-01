import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';

// The provision (display-login) channel, as wired into useSocket. Three things
// matter and all three fail silently if they regress: the screen subscribes to
// the cache channel at all; a frame with a stored login key installs the
// display key (so a rotated key reaches every logged-in screen with nobody
// touching it); and NOTHING from that channel ever reaches a render handler.

let channels = {};
let subscribed = [];
let unsubscribed = [];

vi.mock('pusher-js', () => ({
  default: class FakePusher {
    constructor() {
      this.connection = { state: 'connected', bind: () => {}, unbind: () => {} };
    }
    subscribe(name) {
      subscribed.push(name);
      const bound = {};
      channels[name] = bound;
      return { bind: (evt, fn) => { bound[evt] = fn; }, unbind_all: () => {} };
    }
    unsubscribe(name) { unsubscribed.push(name); }
    disconnect() {}
    connect() {}
  },
}));

const { useSocket } = await import('./useSocket.js');
const cfg = await import('./useConfig.js');
const login = await import('./../lib/displayLogin.js');
const { sealForTest, fromBase64 } = await import('./../lib/envelope.js');
const { loadDisplayKey } = await import('./../lib/displayKey.js');
const fixture = (await import('./../lib/__fixtures__/envelope-vectors.json')).default;

const P = fixture.provision;
const AT = '2026-08-01T23:30:00.000Z';
const emit = (channel, event, payload) => act(() => { channels[channel]?.[event]?.(payload); });

function setup(handlers) {
  localStorage.setItem('awanaConfig.v1', JSON.stringify({ pusherAppKey: 'testkey', pusherCluster: 'us2' }));
  return renderHook(() => useSocket(handlers));
}

beforeEach(() => {
  channels = {};
  subscribed = [];
  unsubscribed = [];
  localStorage.clear();
  cfg._resetForTest(); // one config store per page — start each case clean
  login._resetForTest();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
// There are no vitest globals, so Testing Library registers no cleanup of its
// own: unmount every hook here, once the decrypt chain has settled. A hook
// left mounted let React's scheduler run after this file's jsdom was gone
// ("window is not defined", an unhandled error that fails the whole run),
// which a loaded machine's slow PBKDF2 made likely.
afterEach(async () => {
  await act(async () => { await login._settleForTest(); });
  cleanup();
  vi.restoreAllMocks();
});

describe('the provision channel', () => {
  it('subscribes to the contract channel, the provision cache channel and the sync doorbell', () => {
    setup({});
    expect(subscribed).toEqual(['awana-channel', login.PROVISION_CHANNEL, 'awana-sync']);
    expect(channels['awana-sync'].changed).toBeTypeOf('function');
    expect(channels[login.PROVISION_CHANNEL][login.PROVISION_EVENT]).toBeTypeOf('function');
    expect(channels[login.PROVISION_CHANNEL]['pusher:cache_miss']).toBeTypeOf('function');
  });

  it('a cache miss is surfaced to the login store', () => {
    setup({});
    emit(login.PROVISION_CHANNEL, 'pusher:cache_miss', {});
    expect(login.getSnapshot().frameStatus).toBe('miss');
  });

  it('a frame with a stored login key installs the display key, and a sealed checkin then opens', async () => {
    login.saveLoginKey(P.derivedKey);
    login._resetForTest();
    const onCheckin = vi.fn();
    const { result } = setup({ onCheckin });
    expect(result.current.hasDisplayKey).toBe(false);

    emit(login.PROVISION_CHANNEL, login.PROVISION_EVENT, P.frame);
    await login._settleForTest();
    expect(loadDisplayKey()).toBe(P.bundle.displayKey);
    await waitFor(() => expect(result.current.hasDisplayKey).toBe(true));

    // The provisioned key is the fixture testKey, so a sealed checkin opens.
    const sealed = await sealForTest(fromBase64(fixture.testKey), 'checkin',
      { id: 'c1', at: AT, firstName: 'Amy', club: 'Sparks', isBirthday: false, isFirstTimer: false });
    emit('awana-channel', 'checkin', sealed);
    await waitFor(() => expect(onCheckin).toHaveBeenCalled());
    expect(onCheckin.mock.calls[0][0].firstName).toBe('Amy');
  });

  it('a frame with NO login key stored writes nothing', async () => {
    setup({});
    emit(login.PROVISION_CHANNEL, login.PROVISION_EVENT, P.frame);
    await login._settleForTest();
    expect(loadDisplayKey()).toBe('');
    expect(login.getSnapshot().frameStatus).toBe('received');
  });

  it('a forged / junk frame is ignored', async () => {
    login.saveLoginKey(P.derivedKey);
    login._resetForTest();
    setup({});
    emit(login.PROVISION_CHANNEL, login.PROVISION_EVENT, { v: 1, displayKey: 'plaintext-attempt' });
    emit(login.PROVISION_CHANNEL, login.PROVISION_EVENT, 'garbage');
    await login._settleForTest();
    expect(loadDisplayKey()).toBe('');
  });

  it('provision frames never reach a render handler', async () => {
    const handlers = {
      onCheckin: vi.fn(), onRecap: vi.fn(), onTally: vi.fn(), onBirthdays: vi.fn(), onOps: vi.fn(),
      onCanary: vi.fn(), onTonight: vi.fn(), onPoints: vi.fn(), onSchedule: vi.fn(), onNotice: vi.fn(),
      onSlides: vi.fn(), onCheckout: vi.fn(),
    };
    login.saveLoginKey(P.derivedKey);
    login._resetForTest();
    const { result } = setup(handlers);
    emit(login.PROVISION_CHANNEL, login.PROVISION_EVENT, P.frame);
    await login._settleForTest();
    for (const fn of Object.values(handlers)) expect(fn).not.toHaveBeenCalled();
    expect(result.current.lastEventAt).toBeNull();
  });

  it('cleanup unsubscribes both channels', () => {
    const { unmount } = setup({});
    unmount();
    expect(unsubscribed).toEqual(expect.arrayContaining(['awana-channel', login.PROVISION_CHANNEL]));
  });
});

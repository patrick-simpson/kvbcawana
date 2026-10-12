import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEVICE_STORAGE, _resetDeviceForTest, cleanDeviceName, defaultDeviceName, deviceHeaders, loadDevice, saveDeviceName,
} from './deviceId.js';
import { setLiveScreenId, setLiveScreenName } from './screenSync.js';
import { syncRequest } from './syncService.js';

beforeEach(() => { localStorage.clear(); _resetDeviceForTest(); });
afterEach(() => { setLiveScreenId(null); setLiveScreenName(''); });

describe('the change log device (routes.md 10.1)', () => {
  it('names a browser and an OS from the user agent', () => {
    expect(defaultDeviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36')).toBe('Chrome on Windows');
    expect(defaultDeviceName('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36')).toBe('Chrome on Android');
    expect(defaultDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17 Mobile Safari/604')).toBe('Safari on iOS');
    expect(defaultDeviceName('Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/130.0')).toBe('Firefox on Windows');
    expect(defaultDeviceName('')).toBe('A browser');
  });

  it('makes one id of the right shape and keeps it', () => {
    const a = loadDevice();
    expect(a.id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(JSON.parse(localStorage.getItem(DEVICE_STORAGE))).toEqual(a);
    _resetDeviceForTest();
    expect(loadDevice()).toEqual(a);
  });

  it('keeps a typed name, cleaned and capped at 40', () => {
    const id = loadDevice().id;
    expect(saveDeviceName('  Pastor\u0007  Pat\'s   phone ')).toEqual({ id, name: "Pastor Pat's phone" });
    expect(cleanDeviceName('x'.repeat(80))).toHaveLength(40);
    expect(saveDeviceName('   ').name).toBe(defaultDeviceName());
  });

  it('works with storage blocked (memory only)', () => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('blocked'); };
    try {
      const a = loadDevice();
      expect(loadDevice()).toEqual(a);
    } finally { Storage.prototype.setItem = real; }
  });

  it('sends X-Device and an encoded X-Device-Name', () => {
    saveDeviceName('Pat’s phone, 100%');
    const h = deviceHeaders();
    expect(h['X-Device']).toBe(loadDevice().id);
    expect(decodeURIComponent(h['X-Device-Name'])).toBe('Pat’s phone, 100%');
    expect(h['X-Device-Name']).not.toMatch(/[^\x20-\x7e]/);
  });

  it('a registered screen speaks as itself', () => {
    setLiveScreenId('tv_aaaaaaaaaaaaaaaaaaaa');
    setLiveScreenName('Front door TV');
    const h = deviceHeaders();
    expect(h['X-Device']).toBe('tv_aaaaaaaaaaaaaaaaaaaa');
    expect(decodeURIComponent(h['X-Device-Name'])).toBe('Front door TV');
  });

  it('rides every signed-in Worker call, and no sign-in', async () => {
    const seen = [];
    const fetchFn = async (url, init) => { seen.push(init.headers); return { ok: true, status: 200, json: async () => ({}) }; };
    await syncRequest('https://w.test', '/v1/x', { session: 'v1.1.1.aaaaaaaaaaaaaaaaaaaaaaaa', fetchFn });
    await syncRequest('https://w.test', '/v1/login', { method: 'POST', body: {}, fetchFn });
    expect(seen[0]['X-Device']).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(seen[0].Authorization).toMatch(/^Bearer /);
    expect(seen[1]['X-Device']).toBeUndefined();
  });
});

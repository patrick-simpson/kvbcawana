import { describe, expect, it } from 'vitest';
import { SyncCore } from '../src/sync.js';
import { LIVE_EVENTS, LIVE_MAX_BYTES, checkPublish } from '../src/live.js';
import { importDisplayKey, openEnvelope } from '../../src/lib/envelope.js';

function memoryStore() {
  const map = new Map();
  return {
    get: async (k) => (map.has(k) ? structuredClone(map.get(k)) : undefined),
    put: async (k, v) => { map.set(k, structuredClone(v)); },
    delete: async (k) => map.delete(k),
  };
}

const ENVELOPE = { v: 1, kid: 'abcd1234', iv: 'AAAAAAAAAAAAAAAA', ct: 'Zm9vYmFyYmF6cXV4cXV1eA==' };

function setup() {
  const frames = [];
  let closed = null;
  const core = new SyncCore({
    storage: memoryStore(),
    env: { INITIAL_PASSPHRASE: 'kennebec' },
    publish: async () => ({ ok: true }),
    broadcast: (text) => { frames.push(JSON.parse(text)); return 3; },
    closeAll: (code) => { closed = code; },
  });
  const call = (method, path, body, token) => core.handle(new Request(`https://sync.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), '10.0.0.1');
  const login = async () => (await (await call('POST', '/v1/login', { passphrase: 'kennebec' })).json());
  return { core, frames, call, login, closed: () => closed };
}

describe('what may ride the live channel', () => {
  it('only the contract\'s thirteen events', () => {
    expect(LIVE_EVENTS).toHaveLength(13);
    expect(checkPublish({ event: 'provision', payload: {} }).ok).toBe(false);
    expect(checkPublish({ event: 'changed', payload: {} }).ok).toBe(false);
    expect(checkPublish({ event: 'tally', payload: { total: 4 } }).ok).toBe(true);
  });

  it('name-bearing events only sealed, never in the clear', () => {
    for (const event of ['checkin', 'recap', 'birthdays', 'checkout', 'slides', 'settings']) {
      expect(checkPublish({ event, payload: { firstName: 'Noah' } }), event).toMatchObject({ ok: false, status: 400 });
      expect(checkPublish({ event, payload: ENVELOPE }).ok, event).toBe(true);
    }
  });

  it('nothing bigger than Pusher took', () => {
    expect(checkPublish({ event: 'notice', payload: { message: 'x'.repeat(LIVE_MAX_BYTES) } })).toMatchObject({ ok: false, status: 413 });
  });
});

describe('publishing and catching up', () => {
  it('a signed-in device publishes, every screen gets it as {e, d}', async () => {
    const s = setup();
    const { session } = await s.login();
    expect((await s.call('POST', '/v1/publish', { event: 'tally', payload: { total: 4 } })).status).toBe(401);
    const res = await s.call('POST', '/v1/publish', { event: 'checkin', payload: ENVELOPE }, session);
    expect(await res.json()).toEqual({ ok: true, screens: 3 });
    expect(s.frames.at(-1)).toEqual({ e: 'checkin', d: ENVELOPE });
  });

  it('a joining screen is handed the latest of each kept event, never a checkin', async () => {
    const s = setup();
    const { session } = await s.login();
    await s.call('POST', '/v1/publish', { event: 'tally', payload: { total: 3 } }, session);
    await s.call('POST', '/v1/publish', { event: 'tally', payload: { total: 4 } }, session);
    await s.call('POST', '/v1/publish', { event: 'checkin', payload: ENVELOPE }, session);
    await s.call('POST', '/v1/publish', { event: 'recap', payload: ENVELOPE }, session);
    const replay = (await s.core.replayFrames()).map((t) => JSON.parse(t));
    expect(replay).toEqual([{ e: 'recap', d: ENVELOPE }, { e: 'tally', d: { total: 4 } }]);
  });

  it('the Worker\'s own settings and slides ride the channel too, sealed, and catch up', async () => {
    const s = setup();
    const { session, displayKey } = await s.login();
    await s.call('PUT', '/v1/settings', { settings: { showClock: false } }, session);
    await s.call('PUT', '/v1/slides', { slides: [{ text: 'Store next week' }] }, session);
    const key = await importDisplayKey(displayKey);
    const settings = s.frames.find((f) => f.e === 'settings');
    expect((await openEnvelope(key, 'settings', settings.d)).ok).toBe(true);
    const replay = (await s.core.replayFrames()).map((t) => JSON.parse(t).e);
    expect(replay).toEqual(['settings', 'slides']);
  });

  it('the doorbell rings on the channel', async () => {
    const s = setup();
    const { session } = await s.login();
    await s.call('PUT', '/v1/template', { config: { audioMuted: true } }, session);
    expect(s.frames.at(-1)).toMatchObject({ e: 'changed', d: { what: 'template' } });
  });

  it('a socket\'s session is checked the same way a request is', async () => {
    const s = setup();
    const { session } = await s.login();
    expect(await s.core.sessionValid(session)).toBe(true);
    expect(await s.core.sessionValid('v1.1.1.nope')).toBe(false);
    expect(await s.core.sessionValid('')).toBe(false);
  });

  it('changing the passphrase closes every socket and forgets what it would replay', async () => {
    const s = setup();
    const { session } = await s.login();
    await s.call('POST', '/v1/publish', { event: 'tally', payload: { total: 4 } }, session);
    await s.call('POST', '/v1/passphrase', { current: 'kennebec', next: 'moosehead' }, session);
    expect(s.closed()).toBe(4001);
    expect(await s.core.replayFrames()).toEqual([]);
    expect(await s.core.sessionValid(session)).toBe(false);
  });
});

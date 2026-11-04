import { describe, expect, it } from 'vitest';
import { SyncCore } from '../src/sync.js';
import { TALLY_KEY } from '../src/tally.js';
import { memoryStore, signInV2 } from './helpers.js';

// The poster contest vote tally (src/routes.md 10.15): six shared counts, a
// session each, never below 0, a doorbell ring on every change.

async function setup() {
  const storage = memoryStore();
  const frames = [];
  const core = new SyncCore({
    storage,
    env: { INITIAL_PASSPHRASE: 'kennebec' },
    now: () => Date.parse('2026-11-04T23:30:00Z'),
    broadcast: (text) => { frames.push(JSON.parse(text)); return 1; },
    liveScreens: () => new Set(),
  });
  const session = (await signInV2(core)).body.session;
  const call = async (method, path, body, auth = session) => {
    const res = await core.handle(new Request(`https://sync.test${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), '10.0.0.1');
    return { status: res.status, body: await res.json() };
  };
  const rings = () => frames.filter((f) => f.e === 'changed' && f.d.what === 'tally');
  return { core, storage, call, rings };
}

describe('the vote tally', () => {
  it('starts at zero and needs a session', async () => {
    const s = await setup();
    const a = await s.call('GET', '/v1/tally');
    expect(a.status).toBe(200);
    expect(a.body.counts).toEqual({ older: [0, 0, 0], younger: [0, 0, 0] });
    expect((await s.call('GET', '/v1/tally', undefined, null)).status).toBe(401);
    expect((await s.call('POST', '/v1/tally', { division: 'older', poster: 1, delta: 1 }, null)).status).toBe(401);
  });

  it('counts each tap, never below 0, and keeps them in storage', async () => {
    const s = await setup();
    await s.call('POST', '/v1/tally', { division: 'older', poster: 2, delta: 1 });
    await s.call('POST', '/v1/tally', { division: 'older', poster: 2, delta: 1 });
    await s.call('POST', '/v1/tally', { division: 'younger', poster: 3, delta: 1 });
    const minus = await s.call('POST', '/v1/tally', { division: 'younger', poster: 1, delta: -1 });
    expect(minus.body.counts).toEqual({ older: [0, 2, 0], younger: [0, 0, 1] });
    expect(minus.body.rev).toBe(3);
    expect((await s.storage.get(TALLY_KEY)).counts).toEqual({ older: [0, 2, 0], younger: [0, 0, 1] });
    expect(s.rings().length).toBe(3);   // the no-op -1 rang nothing
  });

  it('two devices tapping at once both count', async () => {
    const s = await setup();
    await Promise.all(Array.from({ length: 20 }, () => s.call('POST', '/v1/tally', { division: 'younger', poster: 1, delta: 1 })));
    expect((await s.call('GET', '/v1/tally')).body.counts.younger[0]).toBe(20);
  });

  it('refuses anything but a poster and a +1 or -1', async () => {
    const s = await setup();
    for (const bad of [{ division: 'middle', poster: 1, delta: 1 }, { division: 'older', poster: 4, delta: 1 }, { division: 'older', poster: 0, delta: 1 },
      { division: 'older', poster: 1, delta: 2 }, { division: 'older', poster: 1.5, delta: 1 }, {}]) {
      expect((await s.call('POST', '/v1/tally', bad)).status).toBe(400);
    }
  });

  it('reset zeroes every count and rings', async () => {
    const s = await setup();
    await s.call('POST', '/v1/tally', { division: 'older', poster: 1, delta: 1 });
    const r = await s.call('POST', '/v1/tally/reset', {});
    expect(r.body.counts).toEqual({ older: [0, 0, 0], younger: [0, 0, 0] });
    expect(s.rings().at(-1).d).toEqual({ what: 'tally', rev: 2 });
  });
});

// One publisher: in cloud mode the Worker drops the laptop's tally and
// still-here frames (the laptop's other events keep flowing).
import { describe, expect, it } from 'vitest';
import { seal } from '../src/crypto.js';
import { SyncCore } from '../src/sync.js';
import { fakeClock, memoryStore } from './helpers.js';
import { ENV } from './rig.js';

async function core(env) {
  const clock = fakeClock();
  const sent = [];
  const c = new SyncCore({ storage: memoryStore(), env, now: clock.now, fetchFn: async () => new Response('', { status: 500 }), broadcast: (text) => { sent.push(JSON.parse(text).e); return 1; } });
  const login = await c.handle(new Request('https://sync.test/v1/login', { method: 'POST', body: JSON.stringify({ passphrase: 'kennebec' }) }));
  const { session } = await login.json();
  const publish = async (event, payload) => (await c.handle(new Request('https://sync.test/v1/publish', {
    method: 'POST', headers: { Authorization: `Bearer ${session}` }, body: JSON.stringify({ event, payload }),
  }))).json();
  return { c, sent, publish };
}

describe('the single publisher gate', () => {
  it('drops the laptop\'s tally and still-here list when SINGLE_PUBLISHER is on and cloud check-in runs', async () => {
    const { c, sent, publish } = await core({ ...ENV, SINGLE_PUBLISHER: 'on' });
    const checkout = await seal(await c.displayKey(), 'checkout', { names: [] });
    expect(await publish('tally', { counts: {}, total: 3, at: '2026-10-14T22:00:00.000Z' })).toEqual({ ok: true, screens: 0, dropped: true, reason: 'single-publisher' });
    expect(await publish('checkout', checkout)).toMatchObject({ dropped: true });
    // every other event still flows
    expect(await publish('notice', { text: 'Hello', level: 'info' })).toMatchObject({ ok: true });
    expect(sent).toEqual(['notice']);
  });

  it('is off by default (the Worker publishes nothing of its own yet), and off without cloud check-in', async () => {
    for (const env of [ENV, { ...ENV, SINGLE_PUBLISHER: 'off' }, { INITIAL_PASSPHRASE: 'kennebec', SINGLE_PUBLISHER: 'on' }, { ...ENV, SINGLE_PUBLISHER: 'on', CLOUD_CHECKIN: 'off' }]) {
      const { sent, publish } = await core(env);
      const r = await publish('tally', { counts: {}, total: 3, at: '2026-10-14T22:00:00.000Z' });
      expect(r.dropped).toBeUndefined();
      expect(sent).toEqual(['tally']);
    }
  });
});

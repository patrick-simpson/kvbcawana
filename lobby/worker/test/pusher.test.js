import { describe, expect, it } from 'vitest';
import { signedEventsUrl, trigger } from '../src/pusher.js';

const ENV = { PUSHER_APP_ID: '3', PUSHER_KEY: '278d425bdf160c739803', PUSHER_SECRET: '7ad3773142a6692b25b8', PUSHER_CLUSTER: 'mt1' };

describe('Pusher REST signing', () => {
  it('matches the worked example in Pusher\'s own docs', async () => {
    const body = '{"name":"foo","channels":["project-3"],"data":"{\\"some\\":\\"data\\"}"}';
    const url = new URL(await signedEventsUrl(ENV, body, 1353088179));
    expect(url.pathname).toBe('/apps/3/events');
    expect(url.searchParams.get('body_md5')).toBe('ec365a775a4cd0599faeb73354201b6f');
    expect(url.searchParams.get('auth_signature')).toBe('da454824c97ba181a32ccc17a72625ba02771f50b50e1e7430e47a1f3f457e6c');
  });

  it('posts the event and reports a refusal without throwing', async () => {
    const calls = [];
    const ok = await trigger(ENV, 'awana-channel', 'settings', { a: 1 }, {
      nowSec: 1, fetchFn: async (url, init) => { calls.push({ url, init }); return new Response('{}', { status: 200 }); },
    });
    expect(ok.ok).toBe(true);
    expect(JSON.parse(calls[0].init.body)).toEqual({ name: 'settings', channel: 'awana-channel', data: '{"a":1}' });
    const refused = await trigger(ENV, 'c', 'e', {}, { fetchFn: async () => new Response('', { status: 403 }) });
    expect(refused).toMatchObject({ ok: false, status: 403 });
    const down = await trigger(ENV, 'c', 'e', {}, { fetchFn: async () => { throw new Error('offline'); } });
    expect(down.ok).toBe(false);
    expect((await trigger({}, 'c', 'e', {})).error).toBe('pusher-not-configured');
  });
});

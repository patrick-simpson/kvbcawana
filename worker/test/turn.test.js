import { describe, expect, it } from 'vitest';
import { SyncCore } from '../src/sync.js';
import { STUN_URL, TURN_HOURS_PER_MONTH, TURN_SHARES_PER_HOUR, TURN_TTL_S, cleanIceServers } from '../src/turn.js';
import { memoryStore, signInV2 } from './helpers.js';

// The screen share's relay (owner 2026-11-08: "a laptop that was on the network didn't
// connect. We got a black screen ... Any way to make this work over the Web?"; picked:
// Cloudflare's relay, kept inside its free 1,000 GB a month).

async function setup(env = { CF_TURN_KEY_ID: 'key123', CF_TURN_API_TOKEN: 'secret-token' }) {
  let t = Date.parse('2026-11-08T21:00:00Z');
  const asked = [];
  const revoked = [];
  const core = new SyncCore({
    storage: memoryStore(),
    env: { INITIAL_PASSPHRASE: 'kennebec', ...env },
    now: () => t,
    fetchFn: async (url, init) => {
      if (String(url).endsWith('/revoke')) { revoked.push(String(url)); return new Response(null, { status: 204 }); }
      asked.push({ url: String(url), auth: init.headers.Authorization, body: JSON.parse(init.body) });
      return Response.json({ iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
        { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u1', credential: 'c1' },
      ] });
    },
    broadcast: () => 1,
    liveScreens: () => new Set(),
  });
  const session = (await signInV2(core)).body.session;
  const call = async (method, path, body, { auth = session, cast = '' } = {}) => {
    const res = await core.handle(new Request(`https://sync.test${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(cast ? { 'X-Cast-Token': cast } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), '10.0.0.9');
    return { status: res.status, body: await res.json() };
  };
  const { code } = (await call('POST', '/v1/cast/open', {})).body;
  const { token } = (await call('POST', '/v1/cast/join', { code }, { auth: '' })).body;
  let cast = token;
  const share = async () => (await call('POST', '/v1/cast/press', { action: 'screen', data: {} }, { auth: '', cast })).body.button;
  // A presenter's pass lasts 8 hours: join again (after a long gap in a test).
  const rejoin = async () => { cast = (await call('POST', '/v1/cast/join', { code }, { auth: '' })).body.token; };
  return { core, call, token: () => cast, share, rejoin, asked, revoked, tick: (ms) => { t += ms; } };
}

describe('the screen share relay', () => {
  it('both ends of one share get the same Cloudflare credentials, asked for once, port 53 left out', async () => {
    const s = await setup();
    const id = await s.share();
    const presenter = await s.call('GET', `/v1/cast/ice?id=${id}`, undefined, { auth: '', cast: s.token() });
    const tv = await s.call('GET', `/v1/cast/screen/ice?id=${id}`);
    expect(presenter.body.relay).toBe(true);
    expect(tv.body.iceServers).toEqual(presenter.body.iceServers);
    expect(s.asked).toHaveLength(1);
    expect(s.asked[0].url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/key123/credentials/generate-ice-servers');
    expect(s.asked[0].auth).toBe('Bearer secret-token');
    expect(s.asked[0].body).toEqual({ ttl: TURN_TTL_S });
    const urls = presenter.body.iceServers.flatMap((x) => x.urls);
    expect(urls).toContain(STUN_URL);
    expect(urls.some((u) => /:53\?/.test(u))).toBe(false);
    expect(JSON.stringify(presenter.body)).not.toContain('secret-token');
  });

  it('only for the share now up, and a presenter needs the token', async () => {
    const s = await setup();
    const id = await s.share();
    expect((await s.call('GET', '/v1/cast/ice?id=bnotthisshare', undefined, { auth: '', cast: s.token() })).status).toBe(409);
    expect((await s.call('GET', `/v1/cast/ice?id=${id}`, undefined, { auth: '' })).status).toBe(401);
    expect((await s.call('GET', `/v1/cast/screen/ice?id=${id}`, undefined, { auth: '' })).status).toBe(401);
  });

  it('no relay key: STUN only, and the page is told why', async () => {
    const s = await setup({});
    const id = await s.share();
    const r = await s.call('GET', `/v1/cast/ice?id=${id}`, undefined, { auth: '', cast: s.token() });
    expect(r.body).toMatchObject({ relay: false, reason: 'not-configured', iceServers: [{ urls: [STUN_URL] }] });
    expect(s.asked).toHaveLength(0);
  });

  it('the month cap keeps it inside the free allowance; a new month starts again', async () => {
    const s = await setup();
    const shares = TURN_HOURS_PER_MONTH / ((TURN_TTL_S / 3600) * 2);
    for (let i = 0; i < shares; i += 1) {
      s.tick(60 * 1000); // a share a minute: under the press rate limit
      // A fresh presenter each time: one token gets the relay for only a few shares an hour.
      await s.call('POST', '/v1/cast/leave', {}, { auth: '', cast: s.token() });
      await s.rejoin();
      const id = await s.share();
      expect((await s.call('GET', `/v1/cast/screen/ice?id=${id}`)).body.relay).toBe(true);
    }
    s.tick(60 * 1000);
    await s.call('POST', '/v1/cast/leave', {}, { auth: '', cast: s.token() });
    await s.rejoin();
    const over = await s.share();
    expect((await s.call('GET', `/v1/cast/screen/ice?id=${over}`)).body).toMatchObject({ relay: false, reason: 'month-cap' });
    s.tick(30 * 24 * 60 * 60 * 1000);
    await s.rejoin();
    const next = await s.share();
    expect((await s.call('GET', `/v1/cast/screen/ice?id=${next}`)).body.relay).toBe(true);
  });

  it('one presenter gets relay credentials for only a few shares an hour; STUN always', async () => {
    const s = await setup();
    for (let i = 0; i < TURN_SHARES_PER_HOUR; i += 1) {
      s.tick(60 * 1000);
      const id = await s.share();
      expect((await s.call('GET', `/v1/cast/ice?id=${id}`, undefined, { auth: '', cast: s.token() })).body.relay).toBe(true);
    }
    s.tick(60 * 1000);
    const id = await s.share();
    // Whoever asks (the TV too), the share's starter is the one counted.
    const tv = await s.call('GET', `/v1/cast/screen/ice?id=${id}`);
    expect(tv.body).toMatchObject({ relay: false, reason: 'too-many', iceServers: [{ urls: [STUN_URL] }] });
    expect(s.asked).toHaveLength(TURN_SHARES_PER_HOUR);
    s.tick(61 * 60 * 1000);
    const later = await s.share();
    expect((await s.call('GET', `/v1/cast/screen/ice?id=${later}`)).body.relay).toBe(true);
  });

  it('a share\'s credentials are revoked when it ends, is replaced, or its presenter is let go', async () => {
    const s = await setup();
    const revokeUrl = 'https://rtc.live.cloudflare.com/v1/turn/keys/key123/credentials/u1/revoke';
    const a = await s.share();
    await s.call('GET', `/v1/cast/ice?id=${a}`, undefined, { auth: '', cast: s.token() });
    s.tick(60 * 1000);
    await s.share();   // replaced
    await new Promise((r) => setTimeout(r, 0));
    expect(s.revoked).toEqual([revokeUrl]);
    const b = s.core.cast.engine.rtc.id;
    await s.call('GET', `/v1/cast/ice?id=${b}`, undefined, { auth: '', cast: s.token() });
    s.tick(60 * 1000);
    await s.call('POST', '/v1/cast/press', { action: 'back' }, { auth: '', cast: s.token() });   // ended
    await new Promise((r) => setTimeout(r, 0));
    expect(s.revoked).toHaveLength(2);
    s.tick(60 * 1000);
    const c = await s.share();
    await s.call('GET', `/v1/cast/ice?id=${c}`, undefined, { auth: '', cast: s.token() });
    await s.call('POST', '/v1/cast/kick', {});   // the tray's Disconnect the presenter
    await new Promise((r) => setTimeout(r, 0));
    expect(s.revoked).toHaveLength(3);
  });

  it('the classroom\'s share uses it too (signed in)', async () => {
    const s = await setup();
    const press = await s.call('POST', '/v1/classroom/remote', { action: 'screen', data: {} });
    expect(press.status).toBe(200);
    const id = s.core.classroom.rtc.id;
    expect((await s.call('GET', `/v1/classroom/ice?id=${id}`)).body.relay).toBe(true);
  });

  it('cleans what Cloudflare answers', () => {
    expect(cleanIceServers({ urls: 'turn:x.example:3478', username: 'u', credential: 'c' })).toEqual([{ urls: ['turn:x.example:3478'], username: 'u', credential: 'c' }]);
    expect(cleanIceServers([{ urls: ['turn:x.example:3478'] }])).toEqual([]);
    expect(cleanIceServers([{ urls: ['javascript:alert(1)'] }])).toEqual([]);
  });
});

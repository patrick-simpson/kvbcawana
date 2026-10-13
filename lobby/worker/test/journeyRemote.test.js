import { describe, expect, it } from 'vitest';
import { SyncCore } from '../src/sync.js';
import { REMOTE_BUCKETS_MAX, sessionKeyOf, takeToken } from '../src/journeyRemote.js';
import {
  JOURNEY_REMOTE_BURST, JOURNEY_REMOTE_QUEUE_MAX, JOURNEY_REMOTE_TTL_MS, JOURNEY_REMOTE_WATCH_MS,
} from '../../src/lib/syncSpecs.js';

// The Journey phone remote (src/routes.md 10.9): one press from a leader's
// phone goes to EVERY Journey kiosk, each kiosk collects it once, and while a
// phone watches each kiosk says what its screen shows. All of it in memory:
// nothing here may write the Durable Object's storage.

function memoryStore() {
  const map = new Map();
  const writes = [];
  return {
    map,
    writes,
    get: async (k) => (map.has(k) ? structuredClone(map.get(k)) : undefined),
    put: async (k, v) => { writes.push(['put', k]); map.set(k, structuredClone(v)); },
    delete: async (k) => { writes.push(['delete', k]); return map.delete(k); },
  };
}

const K1 = 'jk_aaaaaaaaaaaaaaaaaaaa';
const K2 = 'jk_bbbbbbbbbbbbbbbbbbbb';
const TV = 'tv_cccccccccccccccccccc';

async function setup({ kiosks = [K1, K2], tv = true } = {}) {
  let t = Date.parse('2026-10-14T23:00:00Z') - 1;
  const frames = [];
  const storage = memoryStore();
  const core = new SyncCore({
    storage,
    env: { INITIAL_PASSPHRASE: 'kennebec' },
    now: () => t,
    broadcast: (text) => { frames.push(JSON.parse(text)); return 1; },
    liveScreens: () => new Set(),
  });
  const call = async (method, path, body, token) => {
    const res = await core.handle(new Request(`https://sync.test${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), '10.0.0.1');
    return { status: res.status, body: await res.json() };
  };
  const signIn = async () => (await call('POST', '/v1/login', { passphrase: 'kennebec' })).body.session;
  const phone = await signIn();
  t += 1;
  const kioskSession = await signIn();
  for (const [i, id] of kiosks.entries()) await call('POST', '/v1/screens/hello', { id, kind: 'journey', name: `Journey ${i + 1}` }, kioskSession);
  if (tv) await call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' }, kioskSession);
  frames.length = 0;
  const s = {
    core, storage, frames, call, phone, kioskSession, signIn,
    tick: (ms) => { t += ms; },
    press: (action, data, token = phone) => call('POST', '/v1/journey/remote', data === undefined ? { action } : { action, data }, token),
    poll: (id, now) => call('POST', '/v1/screens/now', now === undefined ? { id } : { id, now }, kioskSession),
    state: (token = phone) => call('GET', '/v1/journey/remote/state', undefined, token),
  };
  return s;
}

const NOW_SLIDES = {
  view: 'slides', week: 5, title: 'Worldview', preview: false, wait: null,
  slide: { n: 3, of: 5, kind: 'misconception', heading: null, lines: [] },
  last: null, at: '2026-10-14T23:00:00.000Z',
};

describe('signed in only', () => {
  it('refuses the phone and the kiosk poll without a session', async () => {
    const s = await setup();
    expect((await s.press('slide-next', undefined, '')).status).toBe(401);
    expect((await s.state('')).status).toBe(401);
    expect((await s.call('POST', '/v1/screens/now', { id: K1 })).status).toBe(401);
    expect((await s.press('slide-next', undefined, 'v1.1.123.notasignature')).status).toBe(401);
  });
});

describe('one press to every Journey kiosk', () => {
  it('queues the press for each kiosk (never the lobby TV) and rings each kiosk\'s doorbell', async () => {
    const s = await setup();
    const res = await s.press('slide-next');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, kiosks: 2, online: 2 });
    expect(typeof res.body.id).toBe('string');
    const rings = s.frames.filter((f) => f.e === 'changed');
    expect(rings.map((f) => f.d.id).sort()).toEqual([K1, K2]);
    expect(rings.every((f) => f.d.what === 'screen-action' && f.d.action === 'remote')).toBe(true);
    const a = await s.poll(K1);
    const b = await s.poll(K2);
    expect(a.body.actions).toEqual([{ id: res.body.id, action: 'slide-next', at: '2026-10-14T23:00:00.000Z' }]);
    expect(b.body.actions.map((x) => x.id)).toEqual([res.body.id]);
    expect((await s.poll(TV)).status).toBe(404); // a TV is not a Journey kiosk
  });

  it('with no kiosk signed in, says so instead of queuing into nothing', async () => {
    const s = await setup({ kiosks: [] });
    const res = await s.press('slide-next');
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('no-kiosks');
  });

  it('two presses are two presses, in order; each handed over ONCE (a lost reply never repeats one)', async () => {
    const s = await setup();
    const one = await s.press('slide-next');
    const two = await s.press('slide-next');
    expect(one.body.id).not.toBe(two.body.id);
    const first = await s.poll(K1);
    expect(first.body.actions.map((x) => x.id)).toEqual([one.body.id, two.body.id]);
    // The kiosk never saw that answer (say): asking again gets nothing, not the same two.
    expect((await s.poll(K1)).body.actions).toEqual([]);
    // The other kiosk still has its own copies.
    expect((await s.poll(K2)).body.actions).toHaveLength(2);
  });

  it('a press waits 20 seconds at most', async () => {
    const s = await setup();
    await s.press('slide-next');
    s.tick(JOURNEY_REMOTE_TTL_MS + 1);
    expect((await s.poll(K1)).body.actions).toEqual([]);
    await s.press('slide-prev');
    s.tick(JOURNEY_REMOTE_TTL_MS - 1000);
    expect((await s.poll(K1)).body.actions.map((x) => x.action)).toEqual(['slide-prev']);
  });

  it('a kiosk that is away keeps only the newest presses', async () => {
    const s = await setup();
    for (let i = 0; i < JOURNEY_REMOTE_QUEUE_MAX + 4; i += 1) {
      s.tick(1000); // well inside the press allowance
      expect((await s.press('seek', { by: 15 })).status).toBe(200);
    }
    expect((await s.poll(K1)).body.actions).toHaveLength(JOURNEY_REMOTE_QUEUE_MAX);
  });

  it('a hello from a kiosk also hands its presses over, once', async () => {
    const s = await setup();
    const p = await s.press('pause');
    const hello = await s.call('POST', '/v1/screens/hello', { id: K1, kind: 'journey' }, s.kioskSession);
    expect(hello.body.remote.map((x) => x.id)).toEqual([p.body.id]);
    expect(hello.body.watch).toBe(false);
    expect(hello.body.actions).toEqual([]);
    expect((await s.poll(K1)).body.actions).toEqual([]);
    // Another kind's hello carries no remote fields.
    const tv = await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' }, s.kioskSession);
    expect(tv.body.remote).toBeUndefined();
  });
});

describe('the allowlist', () => {
  it('takes only the eleven actions; anything else is 400', async () => {
    const s = await setup();
    for (const bad of ['format-disk', 'start-downloads', '', 'slide-next ', null, 42]) {
      expect((await s.press(bad)).status).toBe(400);
    }
    for (const ok of ['slide-next', 'slide-prev', 'slides-start', 'play', 'pause', 'toggle-pause', 'mute', 'unmute', 'begin']) {
      s.tick(500);
      expect((await s.press(ok)).status).toBe(200);
    }
  });

  it('a seek is signed seconds clamped to 15 either way; free text and zero are refused', async () => {
    const s = await setup();
    await s.press('seek', { by: 90 });
    s.tick(500);
    await s.press('seek', { by: -15.4 });
    s.tick(500);
    expect((await s.press('seek', { by: 0 })).status).toBe(400);
    expect((await s.press('seek', { by: 'fifteen' })).status).toBe(400);
    expect((await s.press('seek')).status).toBe(400);
    expect((await s.poll(K1)).body.actions.map((x) => x.data)).toEqual([{ by: 15 }, { by: -15 }]);
  });

  it('a pick is a known choice and a week number; force only when literally true; nothing else rides along', async () => {
    const s = await setup();
    expect((await s.press('pick', { week: 5, choice: 'teaching-slides' })).status).toBe(400);
    expect((await s.press('pick', { week: 0, choice: 'slides' })).status).toBe(400);
    expect((await s.press('pick', { week: '5', choice: 'slides' })).status).toBe(400);
    expect((await s.press('pick', { week: 5.5, choice: 'slides' })).status).toBe(400);
    s.tick(2000);
    await s.press('pick', { week: 5, choice: 'slides', force: 'yes', note: 'hello' });
    s.tick(500);
    await s.press('pick', { week: 27, choice: 'student', force: true });
    s.tick(500);
    await s.press('play', { week: 5, anything: 'dropped' });
    expect((await s.poll(K1)).body.actions.map(({ action, data }) => ({ action, data }))).toEqual([
      { action: 'pick', data: { week: 5, choice: 'slides' } },
      { action: 'pick', data: { week: 27, choice: 'student', force: true } },
      { action: 'play', data: undefined },
    ]);
  });
});

describe('the press allowance (per phone sign-in)', () => {
  it('eight at once, then 429 with how long to wait, then it refills', async () => {
    const s = await setup();
    for (let i = 0; i < JOURNEY_REMOTE_BURST; i += 1) expect((await s.press('slide-next')).status).toBe(200);
    const over = await s.press('slide-next');
    expect(over.status).toBe(429);
    expect(over.body.retryAfterMs).toBeGreaterThan(0);
    // Another phone (signed in a moment later: its own session) is not held up by this one.
    s.tick(1);
    const other = await s.signIn();
    expect((await s.press('slide-next', undefined, other)).status).toBe(200);
    s.tick(over.body.retryAfterMs);
    expect((await s.press('slide-next')).status).toBe(200);
  });

  it('the bucket arithmetic, and which part of a session names the phone', () => {
    let b = undefined;
    for (let i = 0; i < JOURNEY_REMOTE_BURST; i += 1) { const r = takeToken(b, 1000); expect(r.ok).toBe(true); b = r.bucket; }
    const no = takeToken(b, 1000);
    expect(no.ok).toBe(false);
    expect(no.retryMs).toBe(250);
    expect(takeToken(no.bucket, 1250).ok).toBe(true);
    const req = new Request('https://x/', { headers: { Authorization: 'Bearer v1.3.1790839331729.SECRETPART' } });
    expect(sessionKeyOf(req)).toBe('3.1790839331729.ETPART');
    expect(sessionKeyOf(new Request('https://x/'))).toBe('');
  });

  it('remembers a bounded number of phones', async () => {
    const s = await setup();
    for (let i = 0; i < REMOTE_BUCKETS_MAX + 10; i += 1) await s.core.journeyRemote.press(`1.${i}`, { action: 'slide-next' });
    expect(s.core.journeyRemote.buckets.size).toBe(REMOTE_BUCKETS_MAX);
  });
});

describe('what the screens show (memory only)', () => {
  it('a kiosk reports while a phone watches; the phone reads every kiosk with the online count', async () => {
    const s = await setup();
    // Nobody watching yet: a kiosk is told so.
    expect((await s.poll(K1)).body.watch).toBe(false);
    const st = await s.state();
    expect(st.status).toBe(200);
    expect(st.body).toMatchObject({ online: 2, watchMs: JOURNEY_REMOTE_WATCH_MS, serverNow: '2026-10-14T23:00:00.000Z' });
    expect(st.body.kiosks.map((k) => [k.name, k.online, k.now])).toEqual([['Journey 1', true, null], ['Journey 2', true, null]]);
    // The first read after a quiet spell rings every kiosk so it reports at once (only the kiosks).
    const rang = s.frames.filter((f) => f.e === 'changed' && f.d.action === 'remote-watch');
    expect(rang.map((f) => f.d.id).sort()).toEqual([K1, K2]);
    s.frames.length = 0;
    s.tick(1500);
    await s.state();
    expect(s.frames).toHaveLength(0); // still watching: no second ring

    s.tick(500);
    const r = await s.poll(K1, { ...NOW_SLIDES, junk: 'dropped', title: 'Worldview\nhttps://x.example/video.mp4'.slice(0, 9) });
    expect(r.body.watch).toBe(true);
    const after = await s.state();
    const k1 = after.body.kiosks.find((k) => k.id === K1);
    // Stamped with the service's own clock, cleaned, unknown keys gone.
    expect(k1.now).toEqual({ ...NOW_SLIDES, at: '2026-10-14T23:00:02.000Z' });
    expect(after.body.kiosks.find((k) => k.id === K2).now).toBeNull();
  });

  it('junk is not kept, and the last good report stays', async () => {
    const s = await setup();
    await s.state();
    await s.poll(K1, NOW_SLIDES);
    await s.poll(K1, { view: 'dancing' });
    await s.poll(K1, 'nonsense');
    expect((await s.state()).body.kiosks[0].now.view).toBe('slides');
  });

  it('the watch flag ends 30 seconds after the phone last read', async () => {
    const s = await setup();
    await s.state();
    s.tick(JOURNEY_REMOTE_WATCH_MS - 1);
    expect((await s.poll(K1)).body.watch).toBe(true);
    s.tick(2);
    expect((await s.poll(K1)).body.watch).toBe(false);
    const hello = await s.call('POST', '/v1/screens/hello', { id: K1, kind: 'journey' }, s.kioskSession);
    expect(hello.body.watch).toBe(false);
    await s.state();
    expect((await s.call('POST', '/v1/screens/hello', { id: K1, kind: 'journey' }, s.kioskSession)).body.watch).toBe(true);
  });

  it('a kiosk polling counts as online without moving lastSeen in storage', async () => {
    const s = await setup();
    s.tick(10 * 60 * 1000); // both kiosks silent for ten minutes
    expect((await s.state()).body.online).toBe(0);
    await s.poll(K2);
    const st = await s.state();
    expect(st.body.online).toBe(1);
    expect(st.body.kiosks.find((k) => k.id === K2).online).toBe(true);
  });

  it('presses, polls, reports and state reads write NOTHING to storage', async () => {
    const s = await setup();
    const before = s.storage.writes.length;
    await s.state();
    await s.press('slide-next');
    await s.press('pick', { week: 3, choice: 'slides', force: true });
    await s.poll(K1, NOW_SLIDES);
    await s.poll(K2, { view: 'video', week: 5, title: 'Worldview', video: { t: 12.34, d: 900, paused: false, muted: true } });
    await s.state();
    s.tick(JOURNEY_REMOTE_TTL_MS * 3);
    await s.poll(K1);
    expect(s.storage.writes.slice(before)).toEqual([]);
    for (const key of s.storage.map.keys()) expect(key).not.toMatch(/remote|now/i);
  });

  it('a download command queued from /settings tells the kiosk to say hello', async () => {
    const s = await setup();
    expect((await s.poll(K1)).body.hello).toBe(false);
    await s.call('POST', `/v1/screens/${K1}/action`, { action: 'pause-downloads' }, s.phone);
    expect((await s.poll(K1)).body.hello).toBe(true);
    expect((await s.poll(K2)).body.hello).toBe(false);
    await s.call('POST', '/v1/screens/hello', { id: K1, kind: 'journey' }, s.kioskSession);
    expect((await s.poll(K1)).body.hello).toBe(false);
  });

  it('a forgotten kiosk leaves nothing behind; an unknown or malformed id is refused', async () => {
    const s = await setup();
    await s.state();
    await s.poll(K1, NOW_SLIDES);
    await s.press('slide-next');
    await s.call('DELETE', `/v1/screens/${K1}`, undefined, s.phone);
    expect(s.core.journeyRemote.reports.has(K1)).toBe(false);
    expect(s.core.journeyRemote.presses.has(K1)).toBe(false);
    expect((await s.poll(K1)).status).toBe(404);
    expect((await s.call('POST', '/v1/screens/now', { id: 'short' }, s.kioskSession)).status).toBe(400);
    expect((await s.call('POST', '/v1/screens/now', { id: '__proto__' }, s.kioskSession)).status).toBe(400);
  });
});

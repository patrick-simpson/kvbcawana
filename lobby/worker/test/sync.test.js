import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GLOBAL_MAX_FAILS,
  IP_LOCK_MS,
  IP_MAX_FAILS,
  SyncCore,
  buildDeck,
  buildSlidesChunks,
} from '../src/sync.js';
import { allowedOrigin } from '../src/index.js';
import { signInV2, v2Next } from './helpers.js';
import { importDisplayKey, openEnvelope } from '../../src/lib/envelope.js';
import { sanitizeSettings, sanitizeSlidesChunk } from '../../src/lib/eventSanitizers.js';

const CALENDAR_HTML = readFileSync(new URL('../../src/lib/__fixtures__/calendar-2026.html', import.meta.url), 'utf8');

function memoryStore() {
  const map = new Map();
  return {
    map,
    get: async (k) => (map.has(k) ? structuredClone(map.get(k)) : undefined),
    put: async (k, v) => {
      if (k && typeof k === 'object') for (const [a, b] of Object.entries(k)) map.set(a, structuredClone(b));
      else map.set(k, structuredClone(v));
    },
    delete: async (k) => map.delete(k),
  };
}

function setup({ env = {}, html = CALENDAR_HTML, start = Date.parse('2026-10-01T18:00:00Z') } = {}) {
  let t = start;
  const sent = [];
  const fetched = [];
  const storage = memoryStore();
  const core = new SyncCore({
    storage,
    env: { INITIAL_PASSPHRASE: 'kennebec', ...env },
    now: () => t,
    broadcast: (text) => { const f = JSON.parse(text); sent.push({ event: f.e, payload: f.d }); return 1; },
    fetchFn: async (url) => {
      fetched.push(String(url));
      return new Response(html, { status: 200 });
    },
  });
  const call = (method, path, body, token, ip = '10.0.0.1') => core.handle(new Request(`https://sync.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
  }), ip);
  // Passphrase v2, the only sign-in (helpers.js signInV2: the upgrade on a fresh store, authKey after).
  const login = async (passphrase = 'kennebec', ip = '10.0.0.1', extra = {}) => {
    const out = await signInV2(core, { passphrase, ip, extra });
    return { res: { status: out.status }, body: out.body, authKey: out.authKey };
  };
  return { core, storage, sent, fetched, call, login, tick: (ms) => { t += ms; }, now: () => t };
}

describe('login with the passphrase', () => {
  it('"kennebec" signs a screen in and hands it everything it needs', async () => {
    const s = setup();
    const { res, body } = await s.login('kennebec');
    expect(res.status).toBe(200);
    expect(body.session).toMatch(/^v1\.1\.\d+\.[A-Za-z0-9_-]+$/);
    expect(body.displayKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(body).not.toHaveProperty('pusher');
    expect(body.state).toMatchObject({ settings: null, slides: null, calendar: null });
    expect(body.state.kid).toMatch(/^[0-9a-f]{8}$/);
  });

  it('ignores case and surrounding spaces, the way people type on a TV remote', async () => {
    const s = setup();
    expect((await s.login('  Kennebec ')).res.status).toBe(200);
  });

  it('hands every screen the SAME display key', async () => {
    const s = setup();
    const a = await s.login();
    const b = await s.login();
    expect(a.body.displayKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(a.body.displayKey).toBe(b.body.displayKey);
  });

  it('the first login may seed the key the laptop already uses; later ones adopt it', async () => {
    const s = setup();
    const laptopKey = Buffer.alloc(32, 7).toString('base64');
    const first = await s.login('kennebec', undefined, { seedKey: laptopKey });
    expect(first.body.displayKey).toBe(laptopKey);
    const other = await s.login('kennebec', undefined, { seedKey: Buffer.alloc(32, 9).toString('base64') });
    expect(other.body.displayKey).toBe(laptopKey);
    // A wrong word seeds nothing.
    const t = setup();
    expect((await t.login('nope', undefined, { seedKey: laptopKey })).res.status).toBe(401);
    expect(await t.storage.get('displayKey')).toBeUndefined();
    // Junk is ignored and a fresh key is made.
    const u = setup();
    const junk = (await u.login('kennebec', undefined, { seedKey: 'short' })).body;
    expect(junk.displayKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(junk.displayKey).not.toBe('short');
  });

  it('refuses a wrong word and counts down the tries left', async () => {
    const s = setup();
    const { res, body } = await s.login('kenebec');
    expect(res.status).toBe(401);
    expect(body).toMatchObject({ reason: 'wrong', triesLeft: IP_MAX_FAILS - 1 });
    expect(body.displayKey).toBeUndefined();
  });

  it('locks one address out after five wrong tries, even for the right word, then lets it back', async () => {
    const s = setup();
    for (let i = 0; i < IP_MAX_FAILS; i++) await s.login('guess' + i);
    const locked = await s.login('kennebec');
    expect(locked.res.status).toBe(429);
    expect(locked.body.retryAfterSec).toBeGreaterThan(0);
    // Another address is not locked by this one.
    expect((await s.login('kennebec', '10.0.0.2')).res.status).toBe(200);
    s.tick(IP_LOCK_MS + 1);
    expect((await s.login('kennebec')).res.status).toBe(200);
  });

  it('locks logins for everyone after a burst of wrong tries from many addresses', async () => {
    const s = setup();
    for (let i = 0; i < GLOBAL_MAX_FAILS; i++) await s.login('guess', `10.1.${i}.1`);
    expect((await s.login('kennebec', '10.9.9.9')).res.status).toBe(429);
  });

  it('a right word clears that address\'s count', async () => {
    const s = setup();
    for (let i = 0; i < IP_MAX_FAILS - 1; i++) await s.login('nope');
    await s.login('kennebec');
    const { body } = await s.login('nope');
    expect(body.triesLeft).toBe(IP_MAX_FAILS - 1);
  });

  it('says it is not set up when it has no passphrase at all', async () => {
    const s = setup({ env: { INITIAL_PASSPHRASE: '' } });
    expect((await s.login('kennebec')).res.status).toBe(503);
  });

  it('keeps only a salted hash, never the word', async () => {
    const s = setup();
    expect((await s.login()).res.status).toBe(200);
    expect(JSON.stringify([...s.storage.map])).not.toMatch(/kennebec/i);
  });
});

describe('sessions', () => {
  it('everything but login, health and the calendar needs a session', async () => {
    const s = setup();
    for (const [m, p] of [['GET', '/v1/state'], ['PUT', '/v1/settings'], ['PUT', '/v1/slides'],
      ['PUT', '/v1/template'], ['PUT', '/v1/journey'], ['POST', '/v1/calendar/refresh'], ['POST', '/v1/passphrase']]) {
      const res = await s.call(m, p, {});
      expect(res.status, `${m} ${p}`).toBe(401);
    }
    expect((await s.call('GET', '/v1/health')).status).toBe(200);
  });

  it('rejects a forged or altered token', async () => {
    const s = setup();
    const { body } = await s.login();
    const [v, e, iat, sig] = body.session.split('.');
    expect((await s.call('GET', '/v1/state', undefined, `${v}.${e}.${Number(iat) + 1}.${sig}`)).status).toBe(401);
    expect((await s.call('GET', '/v1/state', undefined, 'v1.1.1.abc')).status).toBe(401);
    expect((await s.call('GET', '/v1/state', undefined, body.session)).status).toBe(200);
  });
});

describe('shared settings', () => {
  it('stores the allowlisted keys, seals a settings frame every screen can open, and orders it', async () => {
    const s = setup();
    const { body: login } = await s.login();
    const res = await s.call('PUT', '/v1/settings', {
      settings: { checkoutBoardNamesAbove: 7, audioMuted: true, pusherAppKey: 'x', bogus: 1 },
    }, login.session);
    const out = await res.json();
    expect(out).toMatchObject({ rev: 1, keyCount: 1, broadcast: true });

    const frame = s.sent.find((m) => m.event === 'settings');
    const opened = await openEnvelope(await importDisplayKey(login.displayKey), 'settings', frame.payload);
    expect(opened.ok).toBe(true);
    expect(sanitizeSettings(opened.payload)).toMatchObject({ rev: 1, settings: { checkoutBoardNamesAbove: 7 } });

    // A second change in the same millisecond still stamps strictly later.
    const again = await (await s.call('PUT', '/v1/settings', { settings: { showClock: false } }, login.session)).json();
    expect(Date.parse(again.publishedAt)).toBeGreaterThan(Date.parse(out.publishedAt));
    const state = await (await s.call('GET', '/v1/state', undefined, login.session)).json();
    expect(state.settings).toMatchObject({ rev: 2, settings: { showClock: false } });
  });
});

describe('slides', () => {
  const deck = [
    { id: 'a', text: 'Awana store next week', eyebrow: 'Heads up', theme: 'sky', durationSec: 8 },
    { id: 'v', type: 'video', videoId: 'local-1' },
    { text: '' },
  ];

  it('publishes text slides only, as chunks the screens\' sanitizer accepts', async () => {
    const s = setup();
    const { body: login } = await s.login();
    const out = await (await s.call('PUT', '/v1/slides', { slides: deck }, login.session)).json();
    expect(out).toMatchObject({ deckRev: 1, slideCount: 1, droppedCount: 2 });
    const chunks = s.sent.filter((m) => m.event === 'slides');
    expect(chunks).toHaveLength(1);
    const key = await importDisplayKey(login.displayKey);
    const opened = await openEnvelope(key, 'slides', chunks[0].payload);
    const safe = sanitizeSlidesChunk(opened.payload);
    expect(safe.slides).toEqual([expect.objectContaining({ id: 'a', text: 'Awana store next week', theme: 'sky' })]);
  });

  it('splits a big deck into chunks that each seal, and refuses one that cannot fit', () => {
    const big = Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, text: 'x'.repeat(500), eyebrow: 'y'.repeat(60), showFrom: '2026-10-01', showUntil: '2026-10-31', holdCheckIns: true }));
    const chunks = buildSlidesChunks(buildDeck(big), 1, '2026-10-01T00:00:00.000Z');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThanOrEqual(12);
    for (const c of chunks) expect(sanitizeSlidesChunk(c)).not.toBeNull();
  });

  it('an empty deck still publishes, so "nothing" reaches every screen', async () => {
    const s = setup();
    const { body: login } = await s.login();
    const out = await (await s.call('PUT', '/v1/slides', { slides: [] }, login.session)).json();
    expect(out.slideCount).toBe(0);
    expect(s.sent.filter((m) => m.event === 'slides')).toHaveLength(1);
  });
});

describe('template and Journey settings', () => {
  it('keeps only the template allowlist and rings the doorbell', async () => {
    const s = setup();
    const { body: login } = await s.login();
    const out = await (await s.call('PUT', '/v1/template', {
      config: { audioMuted: true, confettiLevel: 'reduced', pusherAppKey: 'steal', panicMode: true, checkoutBoardMode: 'always' },
    }, login.session)).json();
    expect(out.config).toEqual({ audioMuted: true, confettiLevel: 'reduced' });
    expect(s.sent.at(-1)).toMatchObject({ event: 'changed', payload: { what: 'template' } });
  });

  it('keeps Journey\'s room settings, never video quality', async () => {
    const s = setup();
    const { body: login } = await s.login();
    const out = await (await s.call('PUT', '/v1/journey', {
      settings: {
        captions: true, captionSize: '1.3', captionBackdrop: true, slidesAutoAdvanceSec: 30,
        slideExtras: { questions: false, takeaways: true, junk: true },
        slideNotes: { 12: { questions: ['  What is grace?  ', 'x'.repeat(200)], bogus: ['no'] }, nope: {} },
        playbackQuality: 'high', prepTranscriptMode: 'exact',
      },
    }, login.session)).json();
    expect(out.settings).toEqual({
      captions: true, captionSize: '1.3', captionBackdrop: true, slidesAutoAdvanceSec: 30,
      slideExtras: { questions: false, takeaways: true },
      slideNotes: { 12: { questions: ['What is grace?', 'x'.repeat(80)] } },
    });
    expect(s.sent.at(-1)).toMatchObject({ event: 'changed', payload: { what: 'journey' } });
  });
});

describe('guess counters', () => {
  it('the scheduled run forgets counters whose window is long over, and keeps live ones', async () => {
    const s = setup();
    s.storage.list = async ({ prefix }) => new Map([...s.storage.map].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)]));
    const t0 = s.now();
    await s.storage.put('fails:1.2.3.4', { count: 2, first: t0 - 3 * 3600000, until: 0 });
    await s.storage.put('fails:5.6.7.8', { count: 2, first: t0 - 60000, until: 0 });
    await s.storage.put('fails:9.9.9.9', { count: 5, first: t0 - 3 * 3600000, until: t0 + 60000 });
    expect(await s.core.pruneFails()).toBe(1);
    expect(s.storage.map.has('fails:1.2.3.4')).toBe(false);
    expect(s.storage.map.has('fails:5.6.7.8')).toBe(true);
    expect(s.storage.map.has('fails:9.9.9.9')).toBe(true);
  });
});

describe('the calendar', () => {
  it('Refresh reads the church page now, keeps it, and rings every screen', async () => {
    const s = setup();
    const { body: login } = await s.login();
    const res = await s.call('POST', '/v1/calendar/refresh', {}, login.session);
    const out = await res.json();
    expect(res.status).toBe(200);
    expect(out).toMatchObject({ changed: true });
    expect(out.clubCount).toBeGreaterThanOrEqual(5);
    expect(s.fetched).toEqual(['https://kvbchurch.twotimtwo.com/calendar/index']);
    expect(s.sent.at(-1)).toMatchObject({ event: 'changed', payload: { what: 'calendar' } });

    // Public, so a screen not yet signed in still gets club nights.
    const feed = await (await s.call('GET', '/v1/calendar')).json();
    expect(feed.events.length).toBe(out.eventCount);
    expect(feed.version).toBe(1);
  });

  it('an unchanged calendar moves only checkedAt, and rings nobody', async () => {
    const s = setup();
    const { body: login } = await s.login();
    const first = await (await s.call('POST', '/v1/calendar/refresh', {}, login.session)).json();
    s.tick(60000);
    const rings = s.sent.length;
    const second = await (await s.call('POST', '/v1/calendar/refresh', {}, login.session)).json();
    expect(second).toMatchObject({ changed: false, generatedAt: first.generatedAt });
    expect(second.checkedAt).not.toBe(first.checkedAt);
    expect(s.sent.length).toBe(rings);
  });

  it('a second Refresh within 30 s is answered without reading the page again', async () => {
    const s = setup();
    const { body: login } = await s.login();
    await s.call('POST', '/v1/calendar/refresh', {}, login.session);
    s.tick(5000);
    const again = await (await s.call('POST', '/v1/calendar/refresh', {}, login.session)).json();
    expect(again).toMatchObject({ changed: false, throttled: true });
    expect(s.fetched.length).toBe(1);
    s.tick(30000);
    await s.call('POST', '/v1/calendar/refresh', {}, login.session);
    expect(s.fetched.length).toBe(2);
  });

  it('a page that stops parsing keeps the last good calendar and says why', async () => {
    const s = setup();
    const { body: login } = await s.login();
    await s.call('POST', '/v1/calendar/refresh', {}, login.session);
    const broken = setup({ html: '<html><body>Redesigned!</body></html>' });
    broken.storage.map = s.storage.map;
    Object.assign(broken.storage, {
      get: s.storage.get, put: s.storage.put, delete: s.storage.delete,
    });
    broken.core.storage = s.storage;
    broken.tick(60000);
    const res = await broken.call('POST', '/v1/calendar/refresh', {}, login.session);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/club nights/);
    expect((await (await s.call('GET', '/v1/calendar')).json()).events.length).toBeGreaterThan(5);
  });

  it('a failed read does not overwrite a calendar stored while it was running', async () => {
    const s = setup();
    const { body: login } = await s.login();
    await s.call('POST', '/v1/calendar/refresh', {}, login.session);
    s.tick(60000);
    s.core.fetchFn = async () => {
      // A concurrent refresh lands a newer calendar while this read is in flight.
      const cur = await s.storage.get('calendar');
      await s.storage.put('calendar', { ...cur, generatedAt: '2030-01-01T00:00:00.000Z' });
      return new Response('<html><body>Redesigned!</body></html>', { status: 200 });
    };
    const res = await s.call('POST', '/v1/calendar/refresh', {}, login.session);
    expect(res.status).toBe(502);
    expect((await s.storage.get('calendar')).generatedAt).toBe('2030-01-01T00:00:00.000Z');
  });

  it('follows the shared calendarUrl when one is set', async () => {
    const s = setup();
    const { body: login } = await s.login();
    await s.call('PUT', '/v1/settings', { settings: { calendarUrl: 'https://example.org/cal' } }, login.session);
    await s.call('POST', '/v1/calendar/refresh', {}, login.session);
    expect(s.fetched.at(-1)).toBe('https://example.org/cal');
  });

  it('the scheduled run refreshes it with no one signed in', async () => {
    const s = setup();
    expect(await s.core.cron()).toBe(200);
    expect((await s.call('GET', '/v1/calendar')).status).toBe(200);
  });
});

describe('changing the passphrase', () => {
  it('needs the current word, signs every screen out and replaces the key', async () => {
    const s = setup();
    const { body: a, authKey } = await s.login();
    const { body: b } = await s.login();
    const { authKey: wrongKey } = await setup().login('wrong word');   // the key a wrong current word derives
    const bad = await s.call('POST', '/v1/passphrase', { currentAuthKey: wrongKey, next: await v2Next('moosehead') }, a.session);
    expect(bad.status).toBe(401);
    // the passphrase itself is no proof once a v2 verifier is stored
    expect((await s.call('POST', '/v1/passphrase', { current: 'kennebec', next: await v2Next('moosehead') }, a.session)).status).toBe(401);

    const res = await s.call('POST', '/v1/passphrase', { currentAuthKey: authKey, next: await v2Next('Moosehead') }, a.session);
    const out = await res.json();
    expect(res.status).toBe(200);
    expect(out.rotatedKey).toBe(true);
    expect(out.displayKey).not.toBe(a.displayKey);
    // The screen that changed it stays signed in; every other one is out.
    expect((await s.call('GET', '/v1/state', undefined, out.session)).status).toBe(200);
    expect((await s.call('GET', '/v1/state', undefined, b.session)).status).toBe(401);
    expect((await s.login('kennebec')).res.status).toBe(401);
    expect((await s.login('moosehead')).res.status).toBe(200);
  });

  it('refuses new sign-in values that are not the right shape, and the old shape (the new word itself)', async () => {
    const s = setup();
    const { body, authKey } = await s.login();
    const next = await v2Next('moosehead');
    const cheap = await s.call('POST', '/v1/passphrase', { currentAuthKey: authKey, next: { ...next, iter: 1000 } }, body.session);
    expect(cheap.status).toBe(400);
    expect((await cheap.json()).reason).toBe('bad-next');
    const old = await s.call('POST', '/v1/passphrase', { current: 'kennebec', next: 'moosehead' }, body.session);
    expect(old.status).toBe(400);
    expect((await old.json()).reason).toBe('legacy-off');
    expect((await s.login('kennebec')).res.status).toBe(200);   // nothing changed
  });

  it('INITIAL_PASSPHRASE only counts the first time', async () => {
    const s = setup();
    const { body, authKey } = await s.login();
    expect((await s.call('POST', '/v1/passphrase', { currentAuthKey: authKey, next: await v2Next('moosehead') }, body.session)).status).toBe(200);
    expect((await s.login('kennebec')).res.status).toBe(401);
    expect((await s.login('moosehead')).res.status).toBe(200);
  });
});

describe('requests', () => {
  it('refuses junk bodies and unknown routes plainly', async () => {
    const s = setup();
    const res = await s.core.handle(new Request('https://sync.test/v1/login', { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
    expect((await s.call('GET', '/v1/nope')).status).toBe(404);
  });

  it('allows only the family\'s own pages and localhost as browser origins', () => {
    // The retired github.io sites (archived repos) are no longer allowed.
    expect(allowedOrigin('https://patrick-simpson.github.io')).toBeNull();
    expect(allowedOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(allowedOrigin('https://awana.kvbchurch.org')).toBe('https://awana.kvbchurch.org');
    expect(allowedOrigin('https://kvbcawana.pages.dev')).toBe('https://kvbcawana.pages.dev');
    expect(allowedOrigin('https://evil.example')).toBeNull();
    expect(allowedOrigin('https://patrick-simpson.github.io.evil.example')).toBeNull();
    expect(allowedOrigin(null)).toBeNull();
  });

  it('the laptop relay is gone: its routes 404, and what it left in storage goes on the scheduled run', async () => {
    const s = setup();
    const { body: { session } } = await s.login();
    for (const [m, p] of [['POST', '/v1/relay'], ['GET', '/v1/relay/next'], ['POST', '/v1/relay/answer'], ['GET', '/v1/relay/result?id=abc'], ['POST', '/v1/cloud/checkin']]) {
      expect((await s.call(m, p, {}, session)).status).toBe(404);
    }
    await s.storage.put('relay:queue', [{ id: 'q1', path: '/phone/checkin', body: { name: 'Eli Stone' } }]);
    await s.storage.put('relay:held', [{ id: 'a1', at: s.now() }]);
    await s.storage.put('relay:ans:a1', { status: 200, body: { kids: [{ name: 'Mia Reed' }] } });
    await s.storage.put('relay:laptop', s.now());
    await s.storage.put('relay:busy', s.now());
    await s.storage.put('cloud:acts', [{ id: 'c1', at: s.now() }]);
    await s.storage.put('cloud:act:c1', { status: 'done' });
    await s.core.cron();
    expect([...s.storage.map.keys()].filter((k) => k.startsWith('relay:') || k.startsWith('cloud:act'))).toEqual([]);
  });
});


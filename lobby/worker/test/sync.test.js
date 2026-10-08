import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GLOBAL_MAX_FAILS,
  IP_LOCK_MS,
  IP_MAX_FAILS,
  SYNC_CHANNEL,
  SyncCore,
  buildDeck,
  buildSlidesChunks,
} from '../src/sync.js';
import { allowedOrigin } from '../src/index.js';
import { importDisplayKey, openEnvelope } from '../../src/lib/envelope.js';
import { sanitizeSettings, sanitizeSlidesChunk } from '../../src/lib/eventSanitizers.js';

const CALENDAR_HTML = readFileSync(new URL('../../src/lib/__fixtures__/calendar-2026.html', import.meta.url), 'utf8');

function memoryStore() {
  const map = new Map();
  return {
    map,
    get: async (k) => (map.has(k) ? structuredClone(map.get(k)) : undefined),
    put: async (k, v) => { map.set(k, structuredClone(v)); },
    delete: async (k) => map.delete(k),
  };
}

function setup({ env = {}, html = CALENDAR_HTML, start = Date.parse('2026-10-01T18:00:00Z'), publish } = {}) {
  let t = start;
  const sent = [];
  const fetched = [];
  const storage = memoryStore();
  const core = new SyncCore({
    storage,
    env: { INITIAL_PASSPHRASE: 'kennebec', PUSHER_KEY: 'pk', PUSHER_CLUSTER: 'us2', ...env },
    now: () => t,
    publish: publish || (async (channel, event, payload) => { sent.push({ channel, event, payload }); return { ok: true }; }),
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
  const login = async (passphrase = 'kennebec', ip) => {
    const res = await call('POST', '/v1/login', { passphrase }, undefined, ip);
    return { res, body: await res.json() };
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
    expect(body.pusher).toEqual({ key: 'pk', cluster: 'us2' });
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
    expect(a.body.displayKey).toBe(b.body.displayKey);
  });

  it('the first login may seed the key the laptop already uses; later ones adopt it', async () => {
    const s = setup();
    const laptopKey = Buffer.alloc(32, 7).toString('base64');
    const first = await s.call('POST', '/v1/login', { passphrase: 'kennebec', seedKey: laptopKey });
    expect((await first.json()).displayKey).toBe(laptopKey);
    const other = await s.call('POST', '/v1/login', { passphrase: 'kennebec', seedKey: Buffer.alloc(32, 9).toString('base64') });
    expect((await other.json()).displayKey).toBe(laptopKey);
    // A wrong word seeds nothing.
    const t = setup();
    await t.call('POST', '/v1/login', { passphrase: 'nope', seedKey: laptopKey });
    expect(await t.storage.get('displayKey')).toBeUndefined();
    // Junk is ignored and a fresh key is made.
    const u = setup();
    const junk = await (await u.call('POST', '/v1/login', { passphrase: 'kennebec', seedKey: 'short' })).json();
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
    await s.login();
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
  it('with Pusher retired (no secrets), a save still reports its broadcast: the live channel carried it', async () => {
    const s = setup({ publish: async () => ({ ok: false, error: 'pusher-not-configured' }) });
    const { body: login } = await s.login();
    const out = await (await s.call('PUT', '/v1/settings', { settings: { checkoutBoardNamesAbove: 7 } }, login.session)).json();
    expect(out.broadcast).toBe(true);
    const failing = setup({ publish: async () => ({ ok: false, status: 500, error: 'pusher-500' }) });
    const { body: login2 } = await failing.login();
    const out2 = await (await failing.call('PUT', '/v1/settings', { settings: { checkoutBoardNamesAbove: 7 } }, login2.session)).json();
    expect(out2.broadcast).toBe(false);
  });

  it('stores the allowlisted keys, seals a settings frame every screen can open, and orders it', async () => {
    const s = setup();
    const { body: login } = await s.login();
    const res = await s.call('PUT', '/v1/settings', {
      settings: { checkoutBoardNamesAbove: 7, audioMuted: true, pusherAppKey: 'x', bogus: 1 },
    }, login.session);
    const out = await res.json();
    expect(out).toMatchObject({ rev: 1, keyCount: 1, broadcast: true });

    const frame = s.sent.find((m) => m.event === 'settings');
    expect(frame.channel).toBe('awana-channel');
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
    expect(s.sent.at(-1)).toMatchObject({ channel: SYNC_CHANNEL, payload: { what: 'template' } });
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
    expect(s.sent.at(-1)).toMatchObject({ channel: SYNC_CHANNEL, payload: { what: 'journey' } });
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
    expect(s.sent.at(-1)).toMatchObject({ channel: SYNC_CHANNEL, payload: { what: 'calendar' } });

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
    const res = await broken.call('POST', '/v1/calendar/refresh', {}, login.session);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/club nights/);
    expect((await (await s.call('GET', '/v1/calendar')).json()).events.length).toBeGreaterThan(5);
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
    const { body: a } = await s.login();
    const { body: b } = await s.login();
    const bad = await s.call('POST', '/v1/passphrase', { current: 'wrong', next: 'moosehead' }, a.session);
    expect(bad.status).toBe(401);

    const res = await s.call('POST', '/v1/passphrase', { current: 'kennebec', next: 'Moosehead' }, a.session);
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

  it('refuses a new word that is too short', async () => {
    const s = setup();
    const { body } = await s.login();
    const res = await s.call('POST', '/v1/passphrase', { current: 'kennebec', next: 'abc' }, body.session);
    expect(res.status).toBe(400);
  });

  it('INITIAL_PASSPHRASE only counts the first time', async () => {
    const s = setup();
    const { body } = await s.login();
    await s.call('POST', '/v1/passphrase', { current: 'kennebec', next: 'moosehead' }, body.session);
    expect((await s.login('kennebec')).res.status).toBe(401);
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
    expect(allowedOrigin('https://patrick-simpson.github.io')).toBe('https://patrick-simpson.github.io');
    expect(allowedOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(allowedOrigin('https://awana.kvbchurch.org')).toBe('https://awana.kvbchurch.org');
    expect(allowedOrigin('https://kvbcawana.pages.dev')).toBe('https://kvbcawana.pages.dev');
    expect(allowedOrigin('https://evil.example')).toBeNull();
    expect(allowedOrigin('https://patrick-simpson.github.io.evil.example')).toBeNull();
    expect(allowedOrigin(null)).toBeNull();
  });
});

describe('the phone check-in relay (printer 7.9.0)', () => {
  it('the laptop\'s "I asked" stamp is written once per 15 s, not on every poll', async () => {
    const s = setup();
    const { body: { session } } = await s.login();
    const puts = [];
    const realPut = s.storage.put.bind(s.storage);
    s.storage.put = async (k, v) => { puts.push(k); return realPut(k, v); };
    for (let i = 0; i < 10; i++) { await s.call('GET', '/v1/relay/next', undefined, session); s.tick(1000); }
    expect(puts.filter((k) => k === 'relay:laptop')).toHaveLength(1);
    s.tick(15_000);
    await s.call('GET', '/v1/relay/next', undefined, session);
    expect(puts.filter((k) => k === 'relay:laptop')).toHaveLength(2);
    // and the page still sees the laptop as online throughout
    const r = await (await s.call('POST', '/v1/relay', { method: 'GET', path: '/touch/jam' }, session)).json();
    expect(r.laptopOnline).toBe(true);
  });

  it('a request the laptop TOOK lives past 45 s: its own timeout is 60 s (a jam reprint)', async () => {
    const s = setup();
    const { body: { session } } = await s.login();
    const { id } = await (await s.call('POST', '/v1/relay', { method: 'POST', path: '/jam-reprint', body: {} }, session)).json();
    await s.call('GET', '/v1/relay/next', undefined, session);   // taken at t
    s.tick(55_000);
    const r = await s.call('POST', '/v1/relay/answer', { id, status: 200, body: { success: true } }, session);
    expect(r.status).toBe(200);
    expect(await (await s.call('GET', `/v1/relay/result?id=${id}`, undefined, session)).json()).toMatchObject({ done: true, status: 200 });
    // an UNTAKEN request still goes at 45 s: the laptop was not there, and the
    // next poll (which purges) no longer offers it
    const { id: id2 } = await (await s.call('POST', '/v1/relay', { method: 'GET', path: '/touch/jam' }, session)).json();
    s.tick(46_000);
    expect((await (await s.call('GET', '/v1/relay/next', undefined, session)).json()).requests).toEqual([]);
    expect((await s.call('POST', '/v1/relay/answer', { id: id2, status: 200, body: {} }, session)).status).toBe(404);
  });

  it('a body too big to save is refused by its byte length', async () => {
    const s = setup();
    const login = await s.login();
    const big = 'ü'.repeat(70 * 1024);   // 70 K characters, 140 KB of UTF-8: over the cap in bytes, under it in UTF-16 units
    const r = await s.call('PUT', '/v1/settings', { settings: { note: big } }, login.body.session);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/too big/);
  });

  it('a page asks, the laptop takes it, answers, and the page collects the answer once', async () => {
    const s = setup();
    const { body: { session } } = await s.login();
    let r = await s.call('POST', '/v1/relay', { method: 'POST', path: '/phone/checkin', body: { name: 'Ava Stone', options: { Bible: true } } }, session);
    expect(r.status).toBe(200);
    const { id, laptopOnline } = await r.json();
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(laptopOnline).toBe(false);
    expect(await (await s.call('GET', `/v1/relay/result?id=${id}`, undefined, session)).json()).toEqual({ done: false, laptopOnline: false });
    r = await s.call('GET', '/v1/relay/next', undefined, session);
    const next = await r.json();
    expect(next.busy).toBe(true);
    expect(next.requests).toEqual([{ id, method: 'POST', path: '/phone/checkin', body: { name: 'Ava Stone', options: { Bible: true } } }]);
    expect((await (await s.call('GET', '/v1/relay/next', undefined, session)).json()).requests).toEqual([]);
    r = await s.call('POST', '/v1/relay/answer', { id, status: 200, body: { id: 'x', queued: true } }, session);
    expect(r.status).toBe(200);
    expect(await (await s.call('GET', `/v1/relay/result?id=${id}`, undefined, session)).json()).toEqual({ done: true, status: 200, body: { id: 'x', queued: true } });
    // deleted as it was read: names never sit here
    expect([...s.storage.map.keys()].filter((k) => k.startsWith('relay:ans:'))).toEqual([]);
  });

  it('only the phone page’s own calls can be relayed', async () => {
    const s = setup();
    const { body: { session } } = await s.login();
    for (const [method, path] of [['POST', '/config'], ['GET', '/history/today'], ['POST', '/phone/../config'], ['DELETE', '/phone/checkin'], ['POST', '/touch/context']]) {
      const r = await s.call('POST', '/v1/relay', { method, path, body: {} }, session);
      expect(r.status, `${method} ${path}`).toBe(400);
    }
    for (const [method, path] of [['POST', '/phone/roster'], ['GET', '/phone/status/0f8c1a2b-3c4d'], ['POST', '/jam-reprint'], ['GET', '/touch/jam']]) {
      const r = await s.call('POST', '/v1/relay', { method, path, body: {} }, session);
      expect(r.status, `${method} ${path}`).toBe(200);
    }
  });

  it('signed out: nothing can be asked, taken or read', async () => {
    const s = setup();
    for (const [m, p] of [['POST', '/v1/relay'], ['GET', '/v1/relay/next'], ['POST', '/v1/relay/answer'], ['GET', '/v1/relay/result?id=abc']]) {
      expect((await s.call(m, p, { method: 'POST', path: '/phone/roster' })).status, `${m} ${p}`).toBe(401);
    }
  });

  it('a laptop that never answers: the page hears so, and the request (a child’s name) is gone', async () => {
    const s = setup();
    const { body: { session } } = await s.login();
    const { id } = await (await s.call('POST', '/v1/relay', { method: 'POST', path: '/phone/checkin', body: { name: 'Eli Stone' } }, session)).json();
    s.tick(46 * 1000);
    const res = await (await s.call('GET', `/v1/relay/result?id=${id}`, undefined, session)).json();
    expect(res.done).toBe(true);
    expect(res.status).toBe(504);
    expect(res.body.error).toMatch(/not answering/);
    expect(JSON.stringify(await s.storage.get('relay:queue'))).not.toContain('Eli Stone');
  });

  it('an answer nobody collects is deleted after two minutes', async () => {
    const s = setup();
    const { body: { session } } = await s.login();
    const { id } = await (await s.call('POST', '/v1/relay', { method: 'POST', path: '/phone/roster', body: {} }, session)).json();
    await s.call('GET', '/v1/relay/next', undefined, session);
    await s.call('POST', '/v1/relay/answer', { id, status: 200, body: { kids: [{ name: 'Mia Reed' }] } }, session);
    s.tick(2 * 60 * 1000 + 1);
    await s.call('GET', '/v1/relay/next', undefined, session);
    expect(await s.storage.get(`relay:ans:${id}`)).toBeUndefined();
  });

  it('the laptop asks every second only while phones are busy, and says it is on', async () => {
    const s = setup();
    const { body: { session } } = await s.login();
    expect((await (await s.call('GET', '/v1/relay/next', undefined, session)).json()).busy).toBe(false);
    await s.call('POST', '/v1/relay', { method: 'POST', path: '/phone/tonight', body: {} }, session);
    const { laptopOnline } = await (await s.call('POST', '/v1/relay', { method: 'POST', path: '/phone/tonight', body: {} }, session)).json();
    expect(laptopOnline).toBe(true);
    s.tick(5 * 60 * 1000 + 1);
    expect((await (await s.call('GET', '/v1/relay/next', undefined, session)).json()).busy).toBe(false);
  });
});

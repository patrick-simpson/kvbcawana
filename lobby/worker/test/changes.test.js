// The change log (routes.md 10.5) and device identity (10.1): every write path
// logs who, when, which keys, before and after; Undo where it is cheap.
import { describe, expect, it } from 'vitest';
import { Changes, ENTRY_MAX_BYTES, LOG_MAX, canonical, diffKeys, signature } from '../src/changes.js';
import { deviceName, deviceOf } from '../src/device.js';
import { fakeClock, memoryStore } from './helpers.js';
import { rig } from './rig.js';

const PAGE = { 'X-Device': 'page_aaaaaaaaaaaaaaaa', 'X-Device-Name': encodeURIComponent('Patrick’s phone') };
const TV = 'tv_aaaaaaaaaaaaaaaaaaaa';

/** 15 long club lines: a `before` over 2 KB. */
const bigPhrases = (word) => Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`club number ${String(i).padStart(2, '0')} ${'x'.repeat(24)}`, `${word} ${'y'.repeat(70)}`]));

describe('the helpers', () => {
  it('canonical JSON ignores key order; diffKeys names changed keys with before/after (null = absent)', () => {
    expect(canonical({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(canonical({ a: [{ c: 2, d: 1 }], b: 1 }));
    expect(diffKeys({ a: 1, b: 2, c: 3 }, { a: 1, b: 5, d: 4 })).toEqual({ keys: ['b', 'c', 'd'], before: { b: 2, c: 3, d: null }, after: { b: 5, c: null, d: 4 } });
    expect(signature({ a: 1 })).toMatch(/^[0-9a-f]{8}$/);
    expect(signature({ a: 1 })).not.toBe(signature({ a: 2 }));
  });
});

describe('device identity (10.1)', () => {
  const lookup = { station: async (id) => (id === 'station-aaaaaaaa' ? { name: 'Desk laptop' } : null), screen: async (id) => (id === TV ? { name: 'Lobby left' } : null) };
  const req = (headers) => new Request('https://x/', { headers });

  it('a registered station wins, then a registered screen (by the registry name), then a page', async () => {
    expect(await deviceOf(req({ 'X-Station': 'station-aaaaaaaa', ...PAGE }), lookup)).toEqual({ kind: 'station', id: 'station-aaaaaaaa', name: 'Desk laptop' });
    expect(await deviceOf(req({ 'X-Device': TV, 'X-Device-Name': 'whatever' }), lookup)).toEqual({ kind: 'screen', id: TV, name: 'Lobby left' });
    expect(await deviceOf(req(PAGE), lookup)).toEqual({ kind: 'page', id: 'page_aaaaaaaaaaaaaaaa', name: 'Patrick’s phone' });
    expect(await deviceOf(req({ 'X-Station': 'station-unknown1' }), lookup)).toEqual({ kind: 'unknown', name: 'Unknown device' });
  });

  it('missing, malformed or hostile headers', async () => {
    expect(await deviceOf(req({}), lookup)).toEqual({ kind: 'unknown', name: 'Unknown device' });
    expect(await deviceOf(req({ 'X-Device': 'short' }), lookup)).toEqual({ kind: 'unknown', name: 'Unknown device' });
    expect(await deviceOf(req({ 'X-Device-Name': 'Home%20PC' }), lookup)).toEqual({ kind: 'page', name: 'Home PC' });
    expect(deviceName('%E0%A4%A')).toBe('');
    expect(deviceName(encodeURIComponent(`a\n\u0007b ${'z'.repeat(60)}`))).toHaveLength(40);
  });
});

describe('the ring (10.5 storage)', () => {
  it('numbers entries, keeps the last 200 in 10 buckets of 20, and nothing else', async () => {
    const storage = memoryStore();
    const c = new Changes({ storage, now: () => Date.parse('2026-10-12T12:00:00Z'), enabled: () => true });
    const device = { kind: 'page', name: 'Test' };
    const seqs = await Promise.all(Array.from({ length: 250 }, (_, i) => c.log({ device, what: 'shared', keys: [`k${i}`], before: { [`k${i}`]: i }, after: { [`k${i}`]: i + 1 } })));
    expect(seqs).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));   // concurrent appends: no number twice
    expect(await c.head()).toBe(250);
    expect([...storage.map.keys()].sort()).toEqual(['log:b0', 'log:b1', 'log:b2', 'log:b3', 'log:b4', 'log:b5', 'log:b6', 'log:b7', 'log:b8', 'log:b9', 'log:meta']);
    expect(storage.map.get('log:b2').base).toBe(240);   // entry 250 is in bucket floor(250/20) % 10 = 2, a new lap
    expect((await c.find(250)).entry.keys).toEqual(['k249']);
    expect((await c.find(60)).entry.seq).toBe(60);
    expect((await c.find(59)).status).toBe(410);
    expect((await c.find(251)).status).toBe(404);
    // Page through everything kept: 191 entries (60..250), newest first.
    const all = [];
    let before = null;
    for (;;) {
      const page = await c.list(before, 50);
      all.push(...page.entries.map((e) => e.seq));
      if (page.next === null) break;
      before = page.next;
    }
    expect(all[0]).toBe(250);
    expect(all.at(-1)).toBe(60);
    expect(all).toHaveLength(191);
    expect(LOG_MAX).toBe(200);
    // A restart reads the same ring.
    const again = new Changes({ storage, now: () => 0, enabled: () => true });
    expect((await again.list(null, 1)).entries[0].seq).toBe(250);
  });

  it('a big before goes to logv; a big after is stored as null with a signature; no entry is over 2 KB', async () => {
    const storage = memoryStore();
    const c = new Changes({ storage, now: () => 0, enabled: () => true });
    const device = { kind: 'page', name: 'Test' };
    const huge = { schedule: Array.from({ length: 60 }, (_, i) => ({ club: `Club ${i}`, room: 'r'.repeat(40) })) };
    const seq = await c.log({ device, what: 'church', keys: ['schedule'], before: huge, after: { schedule: [] } });
    const e = (await c.find(seq)).entry;
    expect(e.bigBefore).toBe(true);
    expect(e.before).toBeUndefined();
    expect(await c.bigBefore(seq)).toEqual(huge);
    const seq2 = await c.log({ device, what: 'church', keys: ['schedule'], before: { schedule: [] }, after: huge });
    const e2 = (await c.find(seq2)).entry;
    expect(e2.after).toBeNull();
    expect(e2.afterSig).toBe(signature(huge));
    for (const b of ['log:b0']) for (const x of storage.map.get(b).entries) expect(new TextEncoder().encode(JSON.stringify(x)).length).toBeLessThanOrEqual(ENTRY_MAX_BYTES);
    // logv's slot moves on after 20 more entries.
    for (let i = 0; i < 20; i += 1) await c.log({ device, what: 'church', keys: ['x'], before: huge, after: {} });
    expect(await c.bigBefore(seq)).toBeNull();
  });
});

describe('logging the writes', () => {
  it('PUT /v1/settings logs the changed keys with the device; no change, no entry', async () => {
    const r = await rig();
    expect((await r.call('PUT', '/v1/settings', { settings: { showClock: true, milestoneEvery: 50 } }, PAGE)).status).toBe(200);
    expect((await r.call('PUT', '/v1/settings', { settings: { showClock: true, milestoneEvery: 50 } }, PAGE)).status).toBe(200);
    expect((await r.call('PUT', '/v1/settings', { settings: { showClock: false, milestoneEvery: 50 } })).status).toBe(200);
    const res = await r.call('GET', '/v1/changes');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ head: 2, next: null, off: false });
    const [second, first] = res.body.entries;
    expect(first).toMatchObject({ seq: 1, what: 'shared', keys: ['milestoneEvery', 'showClock'], before: { milestoneEvery: null, showClock: null }, after: { milestoneEvery: 50, showClock: true }, undoable: true, device: { kind: 'page', id: 'page_aaaaaaaaaaaaaaaa', name: 'Patrick’s phone' } });
    expect(second).toMatchObject({ seq: 2, keys: ['showClock'], before: { showClock: true }, after: { showClock: false }, device: { kind: 'unknown', name: 'Unknown device' } });
    expect(second.at).toBe(new Date(r.clock.t).toISOString());
  });

  it('slides, template, Journey, passphrase, screens and stations each log what they may (never values they must not)', async () => {
    const r = await rig();
    await r.call('PUT', '/v1/slides', { slides: [{ text: 'Hi', theme: 'navy' }] }, PAGE);
    await r.call('PUT', '/v1/template', { config: { audioMuted: true } }, PAGE);
    await r.call('PUT', '/v1/journey', { settings: {} }, PAGE);
    await r.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' });
    await r.call('PUT', `/v1/screens/${TV}/settings`, { settings: { audioMuted: true } }, PAGE);
    await r.call('PUT', `/v1/screens/${TV}/name`, { name: 'Lobby left' }, PAGE);
    await r.call('PUT', `/v1/settings`, { settings: { showClock: true } }, { 'X-Device': TV });
    const st = await r.station();
    await r.call('DELETE', `/v1/stations/${st.body.stationId}`, undefined, PAGE);
    await r.call('DELETE', `/v1/screens/${TV}`, undefined, PAGE);
    const { entries } = (await r.call('GET', '/v1/changes?limit=50')).body;
    const by = Object.fromEntries(entries.map((e) => [`${e.what}${e.keys[0] ? `:${e.keys[0]}` : ''}`, e]));
    expect(by['slides:slides']).toMatchObject({ after: { slideCount: 1 }, undoable: false });
    expect(by['template:audioMuted']).toMatchObject({ undoable: false });
    expect(by['template:audioMuted'].before).toBeUndefined();
    expect(by['screen:audioMuted']).toMatchObject({ target: TV, before: { audioMuted: null }, after: { audioMuted: true }, undoable: true });
    expect(by['screen-name:name']).toMatchObject({ target: TV, before: { name: 'Lobby TV' }, after: { name: 'Lobby left' } });
    expect(by['shared:showClock'].device).toEqual({ kind: 'screen', id: TV, name: 'Lobby left' });
    expect(by['station:register']).toMatchObject({ target: st.body.stationId, after: { name: 'Desk laptop' }, undoable: false });
    expect(by['station:remove']).toMatchObject({ before: { name: 'Desk laptop' }, undoable: false });
    expect(by['screen-forget']).toMatchObject({ target: TV, undoable: false });
    expect(entries.some((e) => e.what === 'journey')).toBe(false);   // nothing changed: no entry
    // A passphrase change: no values at all.
    const pc = await r.call('POST', '/v1/passphrase', { current: 'kennebec', next: 'kennebec2' }, PAGE);
    expect(pc.status).toBe(200);
    r.session = pc.body.session;
    const last = (await r.call('GET', '/v1/changes?limit=1')).body.entries[0];
    expect(last).toMatchObject({ what: 'passphrase', keys: [], undoable: false });
    expect(JSON.stringify(last)).not.toMatch(/kennebec/);
  });

  it('a logging failure never fails the write it describes', async () => {
    const r = await rig();
    const put = r.storage.put;
    r.storage.put = async (k, v) => {
      if (k && typeof k === 'object' && 'log:meta' in k) throw new Error('disk full');
      return put(k, v);
    };
    const res = await r.call('PUT', '/v1/settings', { settings: { showClock: true } }, PAGE);
    expect(res.status).toBe(200);
    expect((await r.call('GET', '/v1/state')).body.settings.settings).toEqual({ showClock: true });
    r.storage.put = put;
  });

  it('CHANGE_LOG off: nothing is written, and the list says so', async () => {
    const r = await rig({ env: { CHANGE_LOG: 'off' } });
    await r.call('PUT', '/v1/settings', { settings: { showClock: true } }, PAGE);
    expect((await r.call('GET', '/v1/changes')).body).toEqual({ entries: [], next: null, head: 0, off: true });
    expect([...r.storage.map.keys()].some((k) => k.startsWith('log'))).toBe(false);
  });

  it('GET /v1/changes checks its query', async () => {
    const r = await rig();
    expect((await r.call('GET', '/v1/changes?limit=0')).status).toBe(400);
    expect((await r.call('GET', '/v1/changes?limit=51')).status).toBe(400);
    expect((await r.call('GET', '/v1/changes?before=x')).status).toBe(400);
    r.session = '';
    expect((await r.call('GET', '/v1/changes')).status).toBe(401);
    expect((await r.call('POST', '/v1/changes/1/undo')).status).toBe(401);
  });
});

describe('undo', () => {
  it('shared: back to before through the same path (sealed frame, new entry with undoOf, old one undoneBy)', async () => {
    const r = await rig();
    await r.call('PUT', '/v1/settings', { settings: { showClock: true, milestoneEvery: 50 } });
    await r.call('PUT', '/v1/settings', { settings: { showClock: false, milestoneEvery: 75 } });
    const frames = r.sent.length;
    const res = await r.call('POST', '/v1/changes/2/undo', undefined, PAGE);
    expect(res).toEqual({ status: 200, body: { ok: true, seq: 3 } });
    expect((await r.call('GET', '/v1/state')).body.settings.settings).toEqual({ showClock: true, milestoneEvery: 50 });
    expect(r.sent.slice(frames).map((f) => f.e)).toEqual(['settings']);
    const { entries } = (await r.call('GET', '/v1/changes')).body;
    expect(entries[0]).toMatchObject({ seq: 3, undoOf: 2, before: { milestoneEvery: 75, showClock: false }, after: { milestoneEvery: 50, showClock: true }, device: { kind: 'page' } });
    expect(entries[1]).toMatchObject({ seq: 2, undoneBy: 3 });
    expect(await r.call('POST', '/v1/changes/2/undo')).toMatchObject({ status: 409, body: { reason: 'already-undone', undoneBy: 3 } });
  });

  it('changed-since: a key that moved again is not undone, and names the keys', async () => {
    const r = await rig();
    await r.call('PUT', '/v1/settings', { settings: { showClock: true, milestoneEvery: 50 } });
    await r.call('PUT', '/v1/settings', { settings: { showClock: true, milestoneEvery: 60 } });
    expect(await r.call('POST', '/v1/changes/1/undo')).toMatchObject({ status: 409, body: { reason: 'changed-since', keys: ['milestoneEvery'] } });
    expect((await r.call('GET', '/v1/state')).body.settings.settings).toEqual({ showClock: true, milestoneEvery: 60 });
  });

  it('not-undoable, not-found and gone', async () => {
    const r = await rig();
    await r.call('PUT', '/v1/slides', { slides: [{ text: 'Hi', theme: 'navy' }] });
    expect(await r.call('POST', '/v1/changes/1/undo')).toMatchObject({ status: 409, body: { reason: 'not-undoable' } });
    expect(await r.call('POST', '/v1/changes/9/undo')).toMatchObject({ status: 404, body: { reason: 'not-found' } });
    expect(await r.call('POST', '/v1/changes/abc/undo')).toMatchObject({ status: 404 });
    for (let i = 0; i < 210; i += 1) await r.core.changes.log({ device: { kind: 'unknown', name: 'x' }, what: 'slides', keys: [], undoable: false });
    expect(await r.call('POST', '/v1/changes/1/undo')).toMatchObject({ status: 410, body: { reason: 'gone' } });
  });

  it('a big before (in logv) still undoes; once its slot moved on it is gone', async () => {
    const r = await rig();
    await r.call('PUT', '/v1/settings', { settings: { clubPhrases: bigPhrases('old') } });
    await r.call('PUT', '/v1/settings', { settings: { clubPhrases: bigPhrases('new') } });
    const e = (await r.call('GET', '/v1/changes?limit=1')).body.entries[0];
    expect(e.bigBefore).toBe(true);
    expect((await r.call('POST', `/v1/changes/${e.seq}/undo`)).status).toBe(200);
    expect(Object.values((await r.call('GET', '/v1/state')).body.settings.settings.clubPhrases)[0]).toMatch(/^old /);
    // Now the same, but 20 entries later the logv slot belongs to someone else.
    await r.call('PUT', '/v1/settings', { settings: { clubPhrases: bigPhrases('newer') } });
    const seq = (await r.call('GET', '/v1/changes?limit=1')).body.entries[0].seq;
    for (let i = 0; i < 20; i += 1) await r.core.changes.log({ device: { kind: 'unknown', name: 'x' }, what: 'church', keys: ['k'], before: { k: 'z'.repeat(3000) }, after: {} });
    expect(await r.call('POST', `/v1/changes/${seq}/undo`)).toMatchObject({ status: 410, body: { reason: 'gone' } });
  });

  it('a big after (kept only as a signature) still tells changed-since', async () => {
    const r = await rig();
    await r.call('PUT', '/v1/settings', { settings: { clubPhrases: bigPhrases('a') } });
    await r.call('PUT', '/v1/settings', { settings: { clubPhrases: bigPhrases('b') } });
    await r.call('PUT', '/v1/settings', { settings: { clubPhrases: bigPhrases('c') } });
    expect(await r.call('POST', '/v1/changes/2/undo')).toMatchObject({ status: 409, body: { reason: 'changed-since', keys: ['clubPhrases'] } });
  });

  it('screen settings and a screen name', async () => {
    const r = await rig();
    await r.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' });
    await r.call('PUT', `/v1/screens/${TV}/settings`, { settings: { audioMuted: true, keepScreenAwake: true } });
    await r.call('PUT', `/v1/screens/${TV}/settings`, { settings: { audioMuted: false, keepScreenAwake: true } });
    await r.call('PUT', `/v1/screens/${TV}/name`, { name: 'Lobby left' });
    const frames = r.sent.length;
    expect((await r.call('POST', '/v1/changes/2/undo')).status).toBe(200);
    expect((await r.call('GET', `/v1/screens/${TV}/settings`)).body.settings.settings).toEqual({ audioMuted: true, keepScreenAwake: true });
    expect(r.sent.slice(frames)).toEqual([{ e: 'changed', d: expect.objectContaining({ what: 'screen', id: TV }) }]);
    expect((await r.call('POST', '/v1/changes/3/undo')).status).toBe(200);
    expect((await r.call('GET', `/v1/screens/${TV}/settings`)).body.screen.name).toBe('Lobby TV');
    await r.call('DELETE', `/v1/screens/${TV}`);
    expect(await r.call('POST', '/v1/changes/1/undo')).toMatchObject({ status: 410, body: { reason: 'gone' } });
  });

  it('two presses of Undo at once run once', async () => {
    const r = await rig();
    await r.call('PUT', '/v1/settings', { settings: { showClock: true } });
    const [a, b] = await Promise.all([r.call('POST', '/v1/changes/1/undo'), r.call('POST', '/v1/changes/1/undo')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});

describe('the clock helper still works with the ring', () => {
  it('entries carry the clock', async () => {
    const clock = fakeClock();
    const c = new Changes({ storage: memoryStore(), now: clock.now, enabled: () => true });
    await c.log({ device: { kind: 'unknown', name: 'x' }, what: 'notice', keys: ['notice'], before: {}, after: {} });
    expect((await c.last()).at).toBe(new Date(clock.t).toISOString());
  });
});

// A notice to every screen (routes.md 10.4).
import { describe, expect, it } from 'vitest';
import { rig } from './rig.js';

const SUNDAY = Date.parse('2026-10-11T16:00:00Z');
const PAGE = { 'X-Device': 'page_aaaaaaaaaaaaaaaa', 'X-Device-Name': 'Home%20PC' };
const send = (r, body, headers = PAGE) => r.call('POST', '/v1/notice', { level: 'warn', message: 'Pickup is in the gym tonight', durationMin: 30, ...body }, headers);
const replayed = async (r) => (await r.core.replayFrames()).map((t) => JSON.parse(t)).filter((f) => f.e === 'notice');

describe('POST /v1/notice', () => {
  it('builds the frame, relays it to every screen, keeps it for late joiners, logs it', async () => {
    const r = await rig({ start: SUNDAY });
    const frames = r.sent.length;
    const res = await send(r, { message: '  Pickup <b>is</b>\n in the gym  ' });
    const at = new Date(r.clock.t).toISOString();
    const until = new Date(r.clock.t + 30 * 60 * 1000).toISOString();
    expect(res).toEqual({ status: 200, body: { ok: true, notice: { level: 'warn', message: 'Pickup is in the gym', at, durationSec: 1800 }, until, screens: 1 } });
    expect(r.sent.slice(frames)).toEqual([{ e: 'notice', d: { level: 'warn', message: 'Pickup is in the gym', at, durationSec: 1800 } }]);
    expect(r.storage.map.get('notice:current')).toEqual({ payload: res.body.notice, until, by: { kind: 'page', id: 'page_aaaaaaaaaaaaaaaa', name: 'Home PC' } });
    expect((await r.call('GET', '/v1/notice')).body).toEqual({ notice: { ...res.body.notice, until, by: { kind: 'page', id: 'page_aaaaaaaaaaaaaaaa', name: 'Home PC' } } });
    const e = (await r.call('GET', '/v1/changes?limit=1')).body.entries[0];
    expect(e).toMatchObject({ what: 'notice', keys: ['notice'], before: { notice: null }, after: { notice: { level: 'warn', message: 'Pickup is in the gym', at } }, undoable: true });
  });

  it('400 for an unknown level, an empty message or a bad duration; 503 with NOTICES off', async () => {
    const r = await rig({ start: SUNDAY });
    expect(await send(r, { level: 'panic' })).toMatchObject({ status: 400, body: { reason: 'bad-level' } });
    expect(await send(r, { message: ' <i></i> ' })).toMatchObject({ status: 400, body: { reason: 'no-message' } });
    expect(await send(r, { message: 42 })).toMatchObject({ status: 400 });
    for (const d of [4, 241, 30.5, '30', undefined]) expect(await send(r, { durationMin: d })).toMatchObject({ status: 400, body: { reason: 'bad-duration' } });
    expect(await send(r, { message: 'x'.repeat(300) })).toMatchObject({ status: 200, body: { notice: { message: 'x'.repeat(200) } } });
    await r.call('PUT', '/v1/switches', { name: 'NOTICES', value: 'off' });
    expect(await send(r, {})).toMatchObject({ status: 503, body: { reason: 'notices-off' } });
    // Taking one down still works with notices off.
    expect((await r.call('DELETE', '/v1/notice')).body).toEqual({ ok: true, cleared: true });
  });
});

describe('the gate and the replay', () => {
  it('drops the laptop\'s notice while the owner\'s is up, passes it after expiry', async () => {
    const r = await rig({ start: SUNDAY });
    await send(r, { durationMin: 5 });
    const laptop = { event: 'notice', payload: { level: 'info', message: 'From TwoTimTwo', at: new Date(r.clock.t).toISOString() } };
    expect(await r.call('POST', '/v1/publish', laptop)).toEqual({ status: 200, body: { ok: true, screens: 0, dropped: true, reason: 'owner-notice' } });
    expect((await replayed(r))[0].d.message).toBe('Pickup is in the gym tonight');
    r.clock.tick(5 * 60 * 1000 + 1);
    expect(await r.call('POST', '/v1/publish', laptop)).toEqual({ status: 200, body: { ok: true, screens: 1 } });
    expect(r.storage.map.has('notice:current')).toBe(false);
    expect((await replayed(r)).map((f) => f.d.message)).toEqual(['From TwoTimTwo']);   // the laptop's replays as before
  });

  it('replay rewrites durationSec to the seconds left, and drops an expired one', async () => {
    const r = await rig({ start: SUNDAY });
    await send(r, { durationMin: 15 });
    r.clock.tick(10 * 60 * 1000 + 500);
    expect((await replayed(r))[0].d).toMatchObject({ message: 'Pickup is in the gym tonight', durationSec: 300 });
    r.clock.tick(5 * 60 * 1000);
    expect(await replayed(r)).toEqual([]);
    expect(r.storage.map.has('live:notice')).toBe(false);
    expect(r.storage.map.has('notice:current')).toBe(false);
    expect((await r.call('GET', '/v1/notice')).body).toEqual({ notice: null });
  });

  it('a laptop notice with no owner notice replays untouched', async () => {
    const r = await rig({ start: SUNDAY });
    const payload = { level: 'critical', message: 'Lockdown drill', at: new Date(r.clock.t).toISOString() };
    await r.call('POST', '/v1/publish', { event: 'notice', payload });
    expect(await replayed(r)).toEqual([{ e: 'notice', d: payload }]);
  });
});

describe('DELETE /v1/notice (take it down)', () => {
  it('publishes the SAME text with durationSec 0, then forgets both copies', async () => {
    const r = await rig({ start: SUNDAY });
    await send(r, {});
    r.clock.tick(60 * 1000);
    const frames = r.sent.length;
    expect((await r.call('DELETE', '/v1/notice', undefined, PAGE)).body).toEqual({ ok: true, cleared: true });
    expect(r.sent.slice(frames)).toEqual([{ e: 'notice', d: { level: 'warn', message: 'Pickup is in the gym tonight', at: new Date(r.clock.t).toISOString(), durationSec: 0 } }]);
    expect(r.storage.map.has('live:notice')).toBe(false);
    expect(r.storage.map.has('notice:current')).toBe(false);
    expect(await replayed(r)).toEqual([]);
    expect((await r.call('DELETE', '/v1/notice')).body).toEqual({ ok: true, cleared: false });
    const e = (await r.call('GET', '/v1/changes?limit=1')).body.entries[0];
    expect(e).toMatchObject({ what: 'notice', before: { notice: { message: 'Pickup is in the gym tonight' } }, after: { notice: null }, undoable: false });
  });

  it('takes down a laptop notice too', async () => {
    const r = await rig({ start: SUNDAY });
    await r.call('POST', '/v1/publish', { event: 'notice', payload: { level: 'info', message: 'From TwoTimTwo', at: new Date(r.clock.t).toISOString() } });
    const frames = r.sent.length;
    expect((await r.call('DELETE', '/v1/notice')).body.cleared).toBe(true);
    expect(r.sent.slice(frames)[0].d).toMatchObject({ message: 'From TwoTimTwo', durationSec: 0 });
  });
});

describe('undo a notice = take it down', () => {
  it('happy, then changed-since once another notice replaced it', async () => {
    const r = await rig({ start: SUNDAY });
    await send(r, {});
    const seq = (await r.call('GET', '/v1/changes?limit=1')).body.entries[0].seq;
    const frames = r.sent.length;
    expect((await r.call('POST', `/v1/changes/${seq}/undo`)).status).toBe(200);
    expect(r.sent.slice(frames)[0].d.durationSec).toBe(0);
    expect(r.storage.map.has('notice:current')).toBe(false);
    await send(r, { message: 'First' });
    const s1 = (await r.call('GET', '/v1/changes?limit=1')).body.entries[0].seq;
    r.clock.tick(1000);
    await send(r, { message: 'Second' });
    expect(await r.call('POST', `/v1/changes/${s1}/undo`)).toMatchObject({ status: 409, body: { reason: 'changed-since', keys: ['notice'] } });
  });
});

import { describe, expect, it } from 'vitest';
import { SyncCore } from '../src/sync.js';
import { CAST_FILES_MAX, CAST_FILES_PER_HOUR, DESK } from '../src/cast.js';
import { bodyCapFor } from '../src/index.js';
import { memoryStore, signInV2 } from './helpers.js';
import { CLASSROOM_CLIP_PART_BYTES } from '../../shared/classroomRemote.js';

// The desk (owner 2026-11-09; src/routes.md 10.18 "The desk"): KVBC Awana's back-of-house
// "Cast control" window on the lobby computer, signed in with the computer's own session,
// always alongside the one phone presenter: never blocks a join, never refused `busy`,
// never let go by a join, leave, kick or reset; last press wins.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function setup() {
  let t = Date.parse('2026-11-09T21:00:00Z');
  const core = new SyncCore({
    storage: memoryStore(),
    env: { INITIAL_PASSPHRASE: 'kennebec' },
    now: () => t,
    broadcast: () => 1,
    liveScreens: () => new Set(),
  });
  const session = (await signInV2(core)).body.session;
  const raw = (method, path, body, { auth = session, cast = '' } = {}) => core.handle(new Request(`https://sync.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(cast ? { 'X-Cast-Token': cast } : {}) },
    body: body === undefined ? undefined : (body instanceof Uint8Array ? body : JSON.stringify(body)),
  }), '10.0.0.9');
  const call = async (...a) => { const res = await raw(...a); return { status: res.status, body: await res.json() }; };
  const { code } = (await call('POST', '/v1/cast/open', {})).body;
  const join = async () => (await call('POST', '/v1/cast/join', { code }, { auth: '' })).body.token;
  return { core, raw, call, code, join, tick: (ms) => { t += ms; } };
}
const textItem = (text) => ({ action: 'item', data: { item: { id: 'bplaceholder', kind: 'text', text } } });

describe('the desk: the lobby computer\'s own control, alongside the presenter', () => {
  it('needs the church sign-in, never a token; always sees the code and whether someone presents', async () => {
    const s = await setup();
    expect(DESK).toBe('desk');
    expect((await s.call('GET', '/v1/cast/desk/state', undefined, { auth: '' })).status).toBe(401);
    const token = await s.join();
    expect((await s.call('GET', '/v1/cast/desk/state', undefined, { auth: '', cast: token })).status).toBe(401);
    expect((await s.call('POST', '/v1/cast/desk/press', textItem('x'), { auth: '', cast: token })).status).toBe(401);
    const st = await s.call('GET', '/v1/cast/desk/state');
    expect(st.status).toBe(200);
    expect(st.body).toMatchObject({ code: s.code, presenter: true });
    expect(st.body.stage).toBeTruthy();
    await s.call('POST', '/v1/cast/kick', {});
    expect((await s.call('GET', '/v1/cast/desk/state')).body.presenter).toBe(false);
  });

  it('never blocks a phone, is never refused busy, and no join, leave, kick or reset stops it; last press wins', async () => {
    const s = await setup();
    expect((await s.call('POST', '/v1/cast/desk/press', textItem('From the desk'))).status).toBe(200);
    const token = await s.join();
    expect(token).toMatch(/^t/);
    expect((await s.call('POST', '/v1/cast/desk/press', textItem('Desk again'))).status).toBe(200);
    expect((await s.call('POST', '/v1/cast/press', textItem('Phone'), { auth: '', cast: token })).status).toBe(200);
    expect((await s.call('GET', '/v1/cast/desk/state')).body.stage.show.button.text).toBe('Phone');
    expect((await s.call('POST', '/v1/cast/desk/press', textItem('Desk last'))).status).toBe(200);
    expect((await s.call('GET', '/v1/cast/state', undefined, { auth: '', cast: token })).body.stage.show.button.text).toBe('Desk last');
    await s.call('POST', '/v1/cast/leave', {}, { auth: '', cast: token });
    expect((await s.call('POST', '/v1/cast/desk/press', textItem('a'))).status).toBe(200);
    // A second phone may join after the first left, the desk notwithstanding.
    expect(await s.join()).toMatch(/^t/);
    await s.call('POST', '/v1/cast/kick', {});
    expect((await s.call('POST', '/v1/cast/desk/press', textItem('b'))).status).toBe(200);
    await s.call('POST', '/v1/cast/reset', {});
    expect((await s.call('POST', '/v1/cast/desk/press', textItem('c'))).status).toBe(200);
    expect((await s.call('GET', '/v1/cast/desk/state')).body).toMatchObject({ code: s.code, presenter: false });
  });

  it('"Show the code on the TV" reveals it and lets nobody go', async () => {
    const s = await setup();
    const token = await s.join();
    s.tick(1000);
    expect((await s.call('POST', '/v1/cast/desk/reveal', {})).status).toBe(200);
    expect((await s.call('GET', '/v1/cast/screen')).body.revealAt).toBeGreaterThan(0);
    expect((await s.call('GET', '/v1/cast/state', undefined, { auth: '', cast: token })).status).toBe(200);
  });

  it('uploads and reads files under the room\'s caps, with an hourly allowance of its own', async () => {
    const s = await setup();
    const send = async () => {
      const start = await s.call('POST', '/v1/cast/desk/files', { type: 'image/png', bytes: PNG.length, name: 'a.png' });
      if (start.status !== 200) return start;
      await s.call('PUT', `/v1/cast/desk/files/${start.body.id}/0`, PNG);
      return s.call('POST', `/v1/cast/desk/files/${start.body.id}/done`, {});
    };
    const first = await send();
    expect(first.status).toBe(200);
    const read = await s.raw('GET', `/v1/cast/desk/files/${first.body.id}`);
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(PNG);
    for (let n = 1; n < CAST_FILES_PER_HOUR; n += 1) { expect((await send()).status).toBe(200); s.tick(10); }
    const over = await send();
    expect(over.status).toBe(429);
    expect(over.body.reason).toBe('too-many');
    expect([...(await s.core.storage.list({ prefix: 'castmeta:' })).values()].length).toBeLessThanOrEqual(CAST_FILES_MAX);
    // A presenter's allowance is its own: the desk's hour does not use it up.
    const token = await s.join();
    expect((await s.call('POST', '/v1/cast/files', { type: 'image/png', bytes: PNG.length, name: 'b.png' }, { auth: '', cast: token })).status).toBe(200);
  });

  it('its file parts get a presenter\'s edge cap; YouTube search and PowerPoint need the sign-in', async () => {
    expect(bodyCapFor('PUT', '/v1/cast/desk/files/fabcdefghijkl/0')).toBe(CLASSROOM_CLIP_PART_BYTES);
    expect(bodyCapFor('PUT', '/v1/cast/desk/convert/cabcdefghijklmnop/0')).toBe(bodyCapFor('PUT', '/v1/cast/convert/cabcdefghijklmnop/0'));
    const s = await setup();
    expect((await s.call('GET', '/v1/cast/desk/youtube?q=hymn', undefined, { auth: '' })).status).toBe(401);
    expect((await s.call('GET', '/v1/cast/desk/youtube?q=hymn')).body.reason).toBe('not-configured');
    expect((await s.call('POST', '/v1/cast/desk/convert', { bytes: 1000, name: 'a.pptx' }, { auth: '' })).status).toBe(401);
    expect((await s.call('POST', '/v1/cast/desk/convert', { bytes: 1000, name: 'a.pptx' })).body.reason).toBe('not-configured');
  });
});

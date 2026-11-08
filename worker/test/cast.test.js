import { describe, expect, it } from 'vitest';
import { SyncCore } from '../src/sync.js';
import { JOIN_FAILS_MAX, TOKEN_TTL_MS } from '../src/cast.js';
import { memoryStore, signInV2 } from './helpers.js';
import { CLASSROOM_FILE_PART_BYTES, fileLinkFrom, sanitizeClassroomPress, sanitizeSignal } from '../../shared/classroomRemote.js';

// Cast (src/routes.md 10.18, owner 2026-11-08): the lobby computer's AirServer-like
// screen opens a room and shows a code; a presenter joins with the code alone and puts
// things up (an item, a shared screen); opening or closing the room clears it all.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const SDP = 'v=0\r\no=- 46117 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';

async function setup() {
  let t = Date.parse('2026-11-08T21:00:00Z');
  const frames = [];
  const core = new SyncCore({
    storage: memoryStore(),
    env: { INITIAL_PASSPHRASE: 'kennebec' },
    now: () => t,
    broadcast: (text) => { frames.push(JSON.parse(text)); return 1; },
    liveScreens: () => new Set(),
  });
  const session = (await signInV2(core)).body.session;
  const raw = (method, path, body, { auth = session, cast = '', type = 'application/json' } = {}) => core.handle(new Request(`https://sync.test${path}`, {
    method,
    headers: { 'Content-Type': type, ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(cast ? { 'X-Cast-Token': cast } : {}) },
    body: body === undefined ? undefined : (body instanceof Uint8Array ? body : JSON.stringify(body)),
  }), '10.0.0.9');
  const call = async (...a) => { const res = await raw(...a); return { status: res.status, body: await res.json() }; };
  return { core, frames, session, raw, call, tick: (ms) => { t += ms; } };
}

describe('the shared rules Cast adds', () => {
  it('a Google Slides or Docs link is its PDF export; other links are unchanged', () => {
    expect(fileLinkFrom('https://docs.google.com/presentation/d/1AbCdEfGhIjKlMn/edit?usp=sharing')).toBe('https://docs.google.com/presentation/d/1AbCdEfGhIjKlMn/export/pdf');
    expect(fileLinkFrom('https://docs.google.com/document/d/1AbCdEfGhIjKlMn/view')).toBe('https://docs.google.com/document/d/1AbCdEfGhIjKlMn/export/pdf');
    expect(fileLinkFrom('https://example.org/a.pdf')).toBe('https://example.org/a.pdf');
  });

  it('an item press carries a cleaned item, never a screen; a signal is SDP text only', () => {
    expect(sanitizeClassroomPress('item', { item: { id: 'babcdefgh', kind: 'text', text: 'Welcome!' } })?.data?.item).toMatchObject({ kind: 'text', text: 'Welcome!' });
    expect(sanitizeClassroomPress('item', { item: { id: 'babcdefgh', kind: 'screen' } })).toBeNull();
    expect(sanitizeClassroomPress('item', { item: { id: 'babcdefgh', kind: 'video', youtube: 'nope' } })).toBeNull();
    expect(sanitizeSignal({ type: 'offer', id: 'babcdefgh', sdp: SDP })).toEqual({ type: 'offer', id: 'babcdefgh', sdp: SDP });
    expect(sanitizeSignal({ type: 'offer', id: 'babcdefgh', sdp: '<script>' })).toBeNull();
    expect(sanitizeSignal({ type: 'offer', id: 'babcdefgh', sdp: `v=0\u0000` })).toBeNull();
    expect(sanitizeSignal({ type: 'hello', id: 'babcdefgh', sdp: SDP })).toBeNull();
  });
});

describe('Cast: the code, the token, the room', () => {
  it('the screen opens a room with a six-digit code; the code alone joins; a wrong one is refused', async () => {
    const s = await setup();
    expect((await s.call('POST', '/v1/cast/join', { code: '123456' }, { auth: '' })).body.reason).toBe('off');
    const open = await s.call('POST', '/v1/cast/open', {});
    expect(open.body.code).toMatch(/^[1-9]\d{5}$/);
    expect((await s.call('GET', '/v1/cast/screen')).body.code).toBe(open.body.code);
    const wrong = String((Number(open.body.code) % 899999) + 100001);
    expect((await s.call('POST', '/v1/cast/join', { code: wrong }, { auth: '' })).status).toBe(403);
    const join = await s.call('POST', '/v1/cast/join', { code: open.body.code.replace(/(\d{3})/, '$1 ') }, { auth: '' });
    expect(join.status).toBe(200);
    expect(join.body.token).toMatch(/^t[a-z0-9]{28}$/);
    // The screen's routes need the church sign-in; a presenter's need the token.
    expect((await s.call('GET', '/v1/cast/screen', undefined, { auth: '' })).status).toBe(401);
    expect((await s.call('GET', '/v1/cast/state', undefined, { auth: '' })).status).toBe(401);
    expect((await s.call('GET', '/v1/cast/state', undefined, { auth: '', cast: join.body.token })).status).toBe(200);
    expect((await s.call('GET', '/v1/cast/state', undefined, { auth: '', cast: 'tnotarealtokenatallnotonexx' })).status).toBe(401);
  });

  it('too many wrong codes lock joining for the window', async () => {
    const s = await setup();
    const { code } = (await s.call('POST', '/v1/cast/open', {})).body;
    const wrong = code === '100000' ? '100001' : '100000';
    for (let i = 0; i < JOIN_FAILS_MAX; i += 1) await s.call('POST', '/v1/cast/join', { code: wrong }, { auth: '' });
    expect((await s.call('POST', '/v1/cast/join', { code }, { auth: '' })).status).toBe(429);
    s.tick(11 * 60 * 1000);
    expect((await s.call('POST', '/v1/cast/join', { code }, { auth: '' })).status).toBe(200);
  });

  it('a token lasts its time; a new code (or closing) ends every token and clears the screen and files', async () => {
    const s = await setup();
    let { code } = (await s.call('POST', '/v1/cast/open', {})).body;
    let { token } = (await s.call('POST', '/v1/cast/join', { code }, { auth: '' })).body;
    // Upload a picture and put it up.
    const start = await s.call('POST', '/v1/cast/files', { type: 'image/png', bytes: PNG.length, name: 'Welcome.png' }, { auth: '', cast: token });
    expect(start.status).toBe(200);
    expect((await s.call('PUT', `/v1/cast/files/${start.body.id}/0`, PNG, { auth: '', cast: token, type: 'application/octet-stream' })).status).toBe(200);
    expect((await s.call('POST', `/v1/cast/files/${start.body.id}/done`, {}, { auth: '', cast: token })).body.kind).toBe('image');
    const up = await s.call('POST', '/v1/cast/press', { action: 'item', data: { item: { id: 'bplaceholder', kind: 'image', file: start.body.id, type: 'image/png', title: 'Welcome' } } }, { auth: '', cast: token });
    expect(up.status).toBe(200);
    expect(s.frames.at(-1).d).toMatchObject({ what: 'cast' });
    const screen = await s.call('GET', '/v1/cast/screen');
    expect(screen.body.stage.show.button).toMatchObject({ kind: 'image', file: start.body.id });
    expect((await s.raw('GET', `/v1/cast/screen/files/${start.body.id}`)).status).toBe(200);
    // A new code: the old token is gone, so is the picture.
    ({ code } = (await s.call('POST', '/v1/cast/open', {})).body);
    expect((await s.call('GET', '/v1/cast/state', undefined, { auth: '', cast: token })).status).toBe(401);
    expect((await s.call('GET', '/v1/cast/screen')).body.stage.show).toBeNull();
    expect((await s.raw('GET', `/v1/cast/screen/files/${start.body.id}`)).status).toBe(404);
    ({ token } = (await s.call('POST', '/v1/cast/join', { code }, { auth: '' })).body);
    s.tick(TOKEN_TTL_MS + 1000);
    expect((await s.call('GET', '/v1/cast/state', undefined, { auth: '', cast: token })).status).toBe(401);
    await s.call('POST', '/v1/cast/close', {});
    expect((await s.call('GET', '/v1/cast/screen')).body.code).toBeNull();
    expect((await s.call('POST', '/v1/cast/join', { code }, { auth: '' })).body.reason).toBe('off');
  });

  it('a file must be this room\'s finished file to go up', async () => {
    const s = await setup();
    const { code } = (await s.call('POST', '/v1/cast/open', {})).body;
    const { token } = (await s.call('POST', '/v1/cast/join', { code }, { auth: '' })).body;
    const r = await s.call('POST', '/v1/cast/press', { action: 'item', data: { item: { id: 'bplaceholder', kind: 'pdf', file: 'fnotafileatallxx', type: 'application/pdf' } } }, { auth: '', cast: token });
    expect(r.body.reason).toBe('file-missing');
  });
});

describe('a screen share: the presenter offers, the screen answers', () => {
  it('offer and answer pass through memory only, for the share now up, and Back ends it', async () => {
    const s = await setup();
    const { code } = (await s.call('POST', '/v1/cast/open', {})).body;
    const { token } = (await s.call('POST', '/v1/cast/join', { code }, { auth: '' })).body;
    const share = await s.call('POST', '/v1/cast/press', { action: 'screen', data: { title: 'Pastor Dan\'s laptop' } }, { auth: '', cast: token });
    const id = share.body.button;
    expect(id).toMatch(/^b[a-z0-9]{10}$/);
    expect((await s.call('GET', '/v1/cast/screen')).body.stage.show.button).toEqual({ id, kind: 'screen', title: 'Pastor Dan\'s laptop' });
    // An answer before the offer, or for another share, is refused.
    expect((await s.call('POST', '/v1/cast/screen/signal', { signal: { type: 'answer', id, sdp: SDP } })).body.reason).toBe('no-offer');
    expect((await s.call('POST', '/v1/cast/signal', { signal: { type: 'offer', id: 'bsomethingelse', sdp: SDP } }, { auth: '', cast: token })).body.reason).toBe('ended');
    expect((await s.call('POST', '/v1/cast/signal', { signal: { type: 'offer', id, sdp: SDP } }, { auth: '', cast: token })).status).toBe(200);
    expect(s.frames.at(-1).d).toMatchObject({ what: 'cast', rtc: 'offer' });
    expect((await s.call('GET', '/v1/cast/screen/signal')).body.signal).toEqual({ type: 'offer', id, sdp: SDP });
    expect((await s.call('GET', `/v1/cast/signal?id=${id}`, undefined, { auth: '', cast: token })).body.signal).toBeNull();
    expect((await s.call('POST', '/v1/cast/screen/signal', { signal: { type: 'answer', id, sdp: SDP } })).status).toBe(200);
    expect((await s.call('GET', `/v1/cast/signal?id=${id}`, undefined, { auth: '', cast: token })).body.signal).toMatchObject({ type: 'answer', id });
    await s.call('POST', '/v1/cast/press', { action: 'back' }, { auth: '', cast: token });
    expect((await s.call('GET', '/v1/cast/screen/signal')).body.signal).toBeNull();
    expect((await s.call('GET', '/v1/cast/screen')).body.stage.show).toBeNull();
  });

  it('the Sparks remote can share a screen too (signed in)', async () => {
    const s = await setup();
    const share = await s.call('POST', '/v1/classroom/remote', { action: 'screen', data: {} });
    expect(share.body.button).toMatch(/^b/);
    expect((await s.call('POST', '/v1/classroom/signal', { signal: { type: 'offer', id: share.body.button, sdp: SDP } })).status).toBe(200);
    expect(s.frames.at(-1).d).toMatchObject({ what: 'classroom', rtc: 'offer' });
    expect((await s.call('GET', '/v1/classroom/signal?type=offer')).body.signal.type).toBe('offer');
    // The two rooms never share a share.
    expect((await s.call('GET', '/v1/cast/screen/signal')).body.signal).toBeNull();
  });
});

describe('file parts in the Cast room', () => {
  it('uses the same part size as the classroom', () => {
    expect(CLASSROOM_FILE_PART_BYTES).toBe(96 * 1024);
  });
});

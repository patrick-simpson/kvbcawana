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

  it('the screen can take an ended video down itself (Back only)', async () => {
    const s = await setup();
    const { code } = (await s.call('POST', '/v1/cast/open', {})).body;
    const { token } = (await s.call('POST', '/v1/cast/join', { code }, { auth: '' })).body;
    await s.call('POST', '/v1/cast/press', { action: 'item', data: { item: { id: 'bplaceholder', kind: 'video', youtube: 'dQw4w9WgXcQ' } } }, { auth: '', cast: token });
    expect((await s.call('GET', '/v1/cast/screen')).body.stage.show.button.kind).toBe('video');
    expect((await s.call('POST', '/v1/cast/screen/back', {})).status).toBe(200);
    expect((await s.call('GET', '/v1/cast/screen')).body.stage.show).toBeNull();
    expect((await s.call('POST', '/v1/cast/screen/back', {}, { auth: '' })).status).toBe(401);
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

// PowerPoint (owner 2026-11-08: "Support pptx upload and show a preview on the phone
// screen", the exact copy): the presenter uploads the PowerPoint scrambled, the Worker
// starts the GitHub job, the job fetches it with the machine token and sends back a
// PDF, which becomes a file of the room. The phone previews it (GET /v1/cast/files/:id)
// and jumps to a slide (page {to}).
describe('PowerPoint into slides', () => {
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 1, 2, 3]);
  const KEY = 'B'.repeat(43);

  async function convertSetup(env = { PRINT_DISPATCH_TOKEN: 'gh-token', HANDBOOK_TOKEN: 'machine' }) {
    let t = Date.parse('2026-11-08T21:00:00Z');
    const dispatched = [];
    let answer = 204;
    const core = new SyncCore({
      storage: memoryStore(),
      env: { INITIAL_PASSPHRASE: 'kennebec', ...env },
      now: () => t,
      fetchFn: async (url, init) => {
        if (String(url).startsWith('https://api.github.com/')) { dispatched.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(null, { status: answer }); }
        throw new Error(`unexpected fetch ${url}`);
      },
      broadcast: () => 1,
      liveScreens: () => new Set(),
    });
    const session = (await signInV2(core)).body.session;
    const raw = (method, path, body, { auth = session, cast = '' } = {}) => core.handle(new Request(`https://sync.test${path}`, {
      method,
      headers: { 'Content-Type': body instanceof Uint8Array ? 'application/octet-stream' : 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(cast ? { 'X-Cast-Token': cast } : {}) },
      body: body === undefined ? undefined : (body instanceof Uint8Array ? body : JSON.stringify(body)),
    }), '10.0.0.9');
    const call = async (...a) => { const res = await raw(...a); return { status: res.status, body: await res.json() }; };
    const { code } = (await call('POST', '/v1/cast/open', {})).body;
    const { token } = (await call('POST', '/v1/cast/join', { code }, { auth: '' })).body;
    const as = { auth: '', cast: token };
    const machine = { auth: 'machine' };
    return { core, raw, call, as, machine, dispatched, setAnswer: (s) => { answer = s; }, tick: (ms) => { t += ms; } };
  }

  /** Upload ct as a conversion and start it. */
  async function upload(s, ct, name = 'Easter talk.pptx') {
    const start = await s.call('POST', '/v1/cast/convert', { bytes: ct.length, name }, s.as);
    expect(start.status).toBe(200);
    const { id, parts, partBytes } = start.body;
    for (let n = 0; n < parts; n += 1) expect((await s.call('PUT', `/v1/cast/convert/${id}/${n}`, ct.subarray(n * partBytes, (n + 1) * partBytes), s.as)).status).toBe(200);
    return id;
  }

  it('upload, start the job, the job reads it, sends back the PDF: the page gets a file of the room', async () => {
    const s = await convertSetup();
    const ct = Uint8Array.from({ length: 100 * 1024 + 7 }, (_, i) => (i * 31 + 7) & 255);
    const id = await upload(s, ct);
    expect((await s.call('GET', `/v1/cast/convert/${id}`, undefined, s.as)).body.status).toBe('uploading');
    const go = await s.call('POST', `/v1/cast/convert/${id}/start`, { key: KEY }, s.as);
    expect(go.body.status).toBe('converting');
    expect(s.dispatched).toHaveLength(1);
    expect(s.dispatched[0].url).toContain('/actions/workflows/cast-convert.yml/dispatches');
    expect(s.dispatched[0].body).toEqual({ ref: 'main', inputs: { job: `${id}.${KEY}` } });
    // A second tap starts nothing more.
    await s.call('POST', `/v1/cast/convert/${id}/start`, { key: KEY }, s.as);
    expect(s.dispatched).toHaveLength(1);
    // The job's routes need the machine token, never a presenter's.
    expect((await s.raw('GET', `/v1/cast/convert/${id}/job`, undefined, s.as)).status).toBe(401);
    const job = await s.raw('GET', `/v1/cast/convert/${id}/job`, undefined, s.machine);
    expect(new Uint8Array(await job.arrayBuffer())).toEqual(ct);
    const res = await s.call('PUT', `/v1/cast/convert/${id}/result`, PDF, s.machine);
    expect(res.status).toBe(200);
    const st = (await s.call('GET', `/v1/cast/convert/${id}`, undefined, s.as)).body;
    expect(st).toMatchObject({ status: 'done', file: { kind: 'pdf', type: 'application/pdf', name: 'Easter talk', bytes: PDF.length } });
    // The ciphertext is gone; the PDF is the room's: the phone reads it, and it goes up.
    expect((await s.raw('GET', `/v1/cast/convert/${id}/job`, undefined, s.machine)).status).toBe(404);
    const file = await s.raw('GET', `/v1/cast/files/${st.file.id}`, undefined, s.as);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PDF);
    expect((await s.raw('GET', `/v1/cast/files/${st.file.id}`, undefined, { auth: '' })).status).toBe(401);
    const up = await s.call('POST', '/v1/cast/press', { action: 'item', data: { item: { id: 'bplaceholder', kind: 'pdf', file: st.file.id, type: 'application/pdf', title: 'Easter talk' } } }, s.as);
    expect(up.status).toBe(200);
  });

  it('the strip jumps straight to a slide (page {to}); Back/Next still step', async () => {
    const s = await convertSetup();
    const id = await upload(s, new Uint8Array(40));
    await s.call('POST', `/v1/cast/convert/${id}/start`, { key: KEY }, s.as);
    await s.call('PUT', `/v1/cast/convert/${id}/result`, PDF, s.machine);
    const { file } = (await s.call('GET', `/v1/cast/convert/${id}`, undefined, s.as)).body;
    await s.call('POST', '/v1/cast/press', { action: 'item', data: { item: { id: 'bplaceholder', kind: 'pdf', file: file.id, type: 'application/pdf' } } }, s.as);
    await s.call('POST', '/v1/cast/screen/now', { now: { view: 'pdf', button: (await s.call('GET', '/v1/cast/screen')).body.stage.show.button.id, page: 1, pages: 12 } });
    await s.call('POST', '/v1/cast/press', { action: 'page', data: { to: 7 } }, s.as);
    expect((await s.call('GET', '/v1/cast/screen')).body.stage.show.page).toBe(7);
    await s.call('POST', '/v1/cast/press', { action: 'page', data: { step: 1 } }, s.as);
    expect((await s.call('GET', '/v1/cast/screen')).body.stage.show.page).toBe(8);
    await s.call('POST', '/v1/cast/press', { action: 'page', data: { to: 40 } }, s.as);
    expect((await s.call('GET', '/v1/cast/screen')).body.stage.show.page).toBe(12);
    expect(sanitizeClassroomPress('page', { to: 0 })).toBeNull();
    expect(sanitizeClassroomPress('page', { to: 3 })).toEqual({ action: 'page', data: { to: 3 } });
  });

  it('a failed job says why; a result that is not a PDF fails; the ciphertext goes either way', async () => {
    const s = await convertSetup();
    const a = await upload(s, new Uint8Array(40));
    await s.call('POST', `/v1/cast/convert/${a}/start`, { key: KEY }, s.as);
    await s.call('POST', `/v1/cast/convert/${a}/failed`, { reason: 'type' }, s.machine);
    expect((await s.call('GET', `/v1/cast/convert/${a}`, undefined, s.as)).body).toMatchObject({ status: 'failed', error: 'type' });
    expect((await s.raw('GET', `/v1/cast/convert/${a}/job`, undefined, s.machine)).status).toBe(404);
    const b = await upload(s, new Uint8Array(40));
    await s.call('POST', `/v1/cast/convert/${b}/start`, { key: KEY }, s.as);
    expect((await s.call('PUT', `/v1/cast/convert/${b}/result`, PNG, s.machine)).status).toBe(400);
    expect((await s.call('GET', `/v1/cast/convert/${b}`, undefined, s.as)).body).toMatchObject({ status: 'failed', error: 'convert' });
  });

  it('not set up (no dispatch or machine token): the page is told to send a PDF', async () => {
    const s = await convertSetup({ HANDBOOK_TOKEN: 'machine' });
    const r = await s.call('POST', '/v1/cast/convert', { bytes: 100, name: 'a.pptx' }, s.as);
    expect(r.status).toBe(503);
    expect(r.body.reason).toBe('not-configured');
  });

  it('a GitHub refusal lets the page try again; too big, too many waiting and a new code are refused or cleared', async () => {
    const s = await convertSetup();
    expect((await s.call('POST', '/v1/cast/convert', { bytes: 41 * 1024 * 1024, name: 'big.pptx' }, s.as)).body.reason).toBe('too-big');
    const id = await upload(s, new Uint8Array(40));
    s.setAnswer(403);
    expect((await s.call('POST', `/v1/cast/convert/${id}/start`, { key: KEY }, s.as)).status).toBe(502);
    expect((await s.call('GET', `/v1/cast/convert/${id}`, undefined, s.as)).body.status).toBe('uploading');
    s.setAnswer(204);
    expect((await s.call('POST', `/v1/cast/convert/${id}/start`, { key: KEY }, s.as)).body.status).toBe('converting');
    await upload(s, new Uint8Array(40));
    await upload(s, new Uint8Array(40));
    expect((await s.call('POST', '/v1/cast/convert', { bytes: 40, name: 'x.pptx' }, s.as)).body.reason).toBe('busy');
    // A new code clears every conversion.
    await s.call('POST', '/v1/cast/open', {});
    expect((await s.raw('GET', `/v1/cast/convert/${id}/job`, undefined, s.machine)).status).toBe(404);
  });
});

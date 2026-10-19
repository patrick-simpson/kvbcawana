import { describe, expect, it } from 'vitest';
import { SyncCore } from '../src/sync.js';
import { FILE_PENDING_MS, sniffType } from '../src/classroom.js';
import { memoryStore, signInV2 } from './helpers.js';
import {
  CLASSROOM_CMD_TTL_MS, CLASSROOM_FILE_PART_BYTES, CLASSROOM_PREVIEW_MS, CLASSROOM_WATCH_MS,
  fileLinkFrom, sanitizeButtons, sanitizeClassroomPress, sanitizeStage, youtubeIdFrom, youtubeStartFrom,
} from '../../shared/classroomRemote.js';

// The downstairs classroom's Sparks remote (src/routes.md 10.13): one shared
// button list, files uploaded in parts or copied from a link, a stage the TV
// follows (rung on the doorbell), and the TV's report while a remote watches.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const pdfOf = (n) => { const b = new Uint8Array(n); b.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); for (let i = 8; i < n; i += 1) b[i] = i % 251; return b; };

async function setup({ fetchFn } = {}) {
  let t = Date.parse('2026-10-14T23:10:00Z');
  const frames = [];
  const storage = memoryStore();
  const core = new SyncCore({
    storage,
    env: { INITIAL_PASSPHRASE: 'kennebec' },
    now: () => t,
    fetchFn,
    broadcast: (text) => { frames.push(JSON.parse(text)); return 1; },
    liveScreens: () => new Set(),
  });
  const session = (await signInV2(core)).body.session;
  const raw = async (method, path, body, { token = session, type = 'application/json' } = {}) => core.handle(new Request(`https://sync.test${path}`, {
    method,
    headers: { 'Content-Type': type, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : (body instanceof Uint8Array ? body : JSON.stringify(body)),
  }), '10.0.0.1');
  const call = async (...a) => { const res = await raw(...a); return { status: res.status, body: await res.json() }; };
  const upload = async (bytes, type = 'application/pdf') => {
    const start = await call('POST', '/v1/classroom/files', { type, bytes: bytes.length, name: 'Lesson.pdf' });
    expect(start.status).toBe(200);
    for (let n = 0; n < start.body.parts; n += 1) {
      const r = await call('PUT', `/v1/classroom/files/${start.body.id}/${n}`, bytes.slice(n * CLASSROOM_FILE_PART_BYTES, (n + 1) * CLASSROOM_FILE_PART_BYTES), { type: 'application/octet-stream' });
      expect(r.status).toBe(200);
    }
    const done = await call('POST', `/v1/classroom/files/${start.body.id}/done`, {});
    return { id: start.body.id, done };
  };
  return { core, frames, storage, session, raw, call, upload, tick: (ms) => { t += ms; }, now: () => t };
}

const VIDEO = { id: 'bvideo01', title: 'Sparky Song', youtube: 'https://youtu.be/dQw4w9WgXcQ?t=42' };
const TEXT = { id: 'btext001', kind: 'text', title: 'Verse', heading: 'Memory verse', text: 'Love one another.\nJohn 13:34', look: 'board' };

describe('the shared rules', () => {
  it('finds the YouTube video in anything a leader pastes', () => {
    for (const s of ['dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ', 'youtube.com/watch?v=dQw4w9WgXcQ&t=5', 'https://m.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ']) {
      expect(youtubeIdFrom(s)).toBe('dQw4w9WgXcQ');
    }
    expect(youtubeIdFrom('https://vimeo.com/123')).toBe('');
    expect(youtubeIdFrom('https://youtube.com/watch?v=short')).toBe('');
    expect(youtubeStartFrom('https://youtu.be/dQw4w9WgXcQ?t=1m30s')).toBe(90);
    expect(youtubeStartFrom('https://youtu.be/dQw4w9WgXcQ')).toBe(0);
  });
  it('turns a Google Drive share link into its download, and refuses anything not https', () => {
    expect(fileLinkFrom('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing')).toBe('https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp');
    expect(fileLinkFrom('http://example.org/a.png')).toBe('');
    expect(fileLinkFrom('javascript:alert(1)')).toBe('');
  });
  it('caps the list at 4 videos and 8 others, drops junk and repeats', () => {
    const videos = Array.from({ length: 6 }, (_, i) => ({ id: `bvid000${i}`, youtube: 'dQw4w9WgXcQ' }));
    const items = Array.from({ length: 10 }, (_, i) => ({ id: `bitem00${i}`, kind: 'text', text: `Hi ${i}` }));
    const b = sanitizeButtons({ videos: [...videos, { id: 'bvid0000', youtube: 'dQw4w9WgXcQ' }, { id: 'x', youtube: 'dQw4w9WgXcQ' }], items: [{ id: 'bimg0001', kind: 'image', file: 'fnotreal' }, ...items] });
    expect(b.videos).toHaveLength(4);
    expect(b.items).toHaveLength(8);
    expect(b.items.every((i) => i.kind === 'text')).toBe(true);
    expect(sanitizeButtons({ items: [TEXT] }).items[0]).toEqual({ id: 'btext001', kind: 'text', title: 'Verse', heading: 'Memory verse', text: 'Love one another.\nJohn 13:34', look: 'board' });
  });
  it('takes only the presses it knows, never free text', () => {
    expect(sanitizeClassroomPress('show', { button: 'bvideo01', extra: 'x' })).toEqual({ action: 'show', data: { button: 'bvideo01' } });
    expect(sanitizeClassroomPress('video', { op: 'seek', by: 10 })).toEqual({ action: 'video', data: { op: 'seek', by: 10 } });
    expect(sanitizeClassroomPress('video', { op: 'seek', by: 300 })).toBe(null);
    expect(sanitizeClassroomPress('preview', { look: 'journey' })).toBe(null);
    expect(sanitizeClassroomPress('say', { text: 'hi' })).toBe(null);
    expect(sanitizeClassroomPress('sparky', { text: 'x' })).toEqual({ action: 'sparky' });
  });
  it('knows a picture or a PDF by its first bytes', () => {
    expect(sniffType(PNG)).toBe('image/png');
    expect(sniffType(pdfOf(20))).toBe('application/pdf');
    expect(sniffType(new TextEncoder().encode('<html>'))).toBe('');
  });
});

describe('the buttons (GET/PUT /v1/classroom/buttons)', () => {
  it('start empty, save with the right base, refuse a stale one, and need a sign-in', async () => {
    const s = await setup();
    expect((await s.call('GET', '/v1/classroom/buttons', undefined, { token: '' })).status).toBe(401);
    const first = await s.call('GET', '/v1/classroom/buttons');
    expect(first.body).toMatchObject({ rev: 0, buttons: { videos: [], items: [] } });
    const put = await s.call('PUT', '/v1/classroom/buttons', { baseRev: 0, buttons: { videos: [VIDEO], items: [TEXT] } });
    expect(put.status).toBe(200);
    expect(put.body.buttons.videos[0]).toEqual({ id: 'bvideo01', title: 'Sparky Song', youtube: 'dQw4w9WgXcQ', start: 0 });
    const stale = await s.call('PUT', '/v1/classroom/buttons', { baseRev: 0, buttons: { videos: [], items: [] } });
    expect(stale.status).toBe(409);
    expect(stale.body.reason).toBe('stale');
    expect((await s.call('GET', '/v1/classroom/buttons')).body.rev).toBe(1);
  });
});

describe('files (POST/PUT/GET /v1/classroom/files)', () => {
  it('an upload in parts comes back byte for byte, and a button can then name it', async () => {
    const s = await setup();
    const bytes = pdfOf(CLASSROOM_FILE_PART_BYTES * 2 + 1234);
    const { id, done } = await s.upload(bytes);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ ok: true, type: 'application/pdf', kind: 'pdf', bytes: bytes.length });
    const res = await s.raw('GET', `/v1/classroom/files/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    const put = await s.call('PUT', '/v1/classroom/buttons', { baseRev: 0, buttons: { videos: [], items: [{ id: 'bpdf0001', kind: 'pdf', title: 'Handbook page', file: id, type: 'application/pdf' }] } });
    expect(put.status).toBe(200);
  });

  it('refuses a file that is not what it says, parts out of order, too big, and a button naming an unfinished file', async () => {
    const s = await setup();
    const fake = await s.upload(new TextEncoder().encode('<html>not a pdf</html>'));
    expect(fake.done.status).toBe(400);
    expect(fake.done.body.reason).toBe('type');
    const start = await s.call('POST', '/v1/classroom/files', { type: 'application/pdf', bytes: CLASSROOM_FILE_PART_BYTES * 3 });
    expect((await s.call('PUT', `/v1/classroom/files/${start.body.id}/2`, new Uint8Array(CLASSROOM_FILE_PART_BYTES), { type: 'application/octet-stream' })).status).toBe(409);
    expect((await s.call('POST', '/v1/classroom/files', { type: 'application/pdf', bytes: 21 * 1024 * 1024 })).status).toBe(413);
    expect((await s.call('POST', '/v1/classroom/files', { type: 'text/html', bytes: 10 })).status).toBe(400);
    const put = await s.call('PUT', '/v1/classroom/buttons', { baseRev: 0, buttons: { videos: [], items: [{ id: 'bpdf0001', kind: 'pdf', file: start.body.id, type: 'application/pdf' }] } });
    expect(put.status).toBe(400);
    expect(put.body.reason).toBe('file-missing');
  });

  it('a file no button names is deleted when the list is saved (a fresh upload is kept an hour)', async () => {
    const s = await setup();
    const a = await s.upload(pdfOf(500));
    const b = await s.upload(PNG, 'image/png');
    await s.call('PUT', '/v1/classroom/buttons', { baseRev: 0, buttons: { videos: [], items: [{ id: 'bimg0001', kind: 'image', file: b.id, type: 'image/png' }] } });
    expect((await s.raw('GET', `/v1/classroom/files/${a.id}`)).status).toBe(404);
    expect((await s.raw('GET', `/v1/classroom/files/${b.id}`)).status).toBe(200);
    const pending = await s.call('POST', '/v1/classroom/files', { type: 'application/pdf', bytes: 100 });
    await s.call('PUT', '/v1/classroom/buttons', { baseRev: 1, buttons: { videos: [], items: [] } });
    expect([...s.storage.map.keys()].some((k) => k.startsWith(`cmeta:${pending.body.id}`))).toBe(true);
    expect([...s.storage.map.keys()].some((k) => k.includes(b.id))).toBe(false);
    s.tick(FILE_PENDING_MS + 1);
    await s.call('PUT', '/v1/classroom/buttons', { baseRev: 2, buttons: { videos: [], items: [] } });
    expect([...s.storage.map.keys()].filter((k) => k.startsWith('cmeta:') || k.startsWith('cpart:'))).toEqual([]);
  });

  it('copies a picture or PDF from a link (a Drive share link too), and refuses a web page', async () => {
    const asked = [];
    const fetchFn = async (url) => {
      asked.push(String(url));
      if (String(url).includes('page')) return new Response('<html>hi</html>', { headers: { 'content-type': 'text/html' } });
      return new Response(pdfOf(CLASSROOM_FILE_PART_BYTES + 10), { headers: { 'content-type': 'application/pdf' } });
    };
    const s = await setup({ fetchFn });
    const r = await s.call('POST', '/v1/classroom/files', { url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: 'pdf', type: 'application/pdf', bytes: CLASSROOM_FILE_PART_BYTES + 10 });
    expect(asked[0]).toBe('https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp');
    expect((await s.raw('GET', `/v1/classroom/files/${r.body.id}`)).status).toBe(200);
    const page = await s.call('POST', '/v1/classroom/files', { url: 'https://example.org/page' });
    expect(page.status).toBe(400);
    expect((await s.call('POST', '/v1/classroom/files', { url: 'http://example.org/a.png' })).status).toBe(400);
  });
});

describe('the stage (POST /v1/classroom/remote, GET /v1/classroom/stage)', () => {
  it('a press puts a copy of the button up, rings the doorbell, and Back takes it down', async () => {
    const s = await setup();
    await s.call('PUT', '/v1/classroom/buttons', { baseRev: 0, buttons: { videos: [VIDEO], items: [TEXT] } });
    const show = await s.call('POST', '/v1/classroom/remote', { action: 'show', data: { button: 'bvideo01' } });
    expect(show.status).toBe(200);
    expect(s.frames.at(-1)).toMatchObject({ d: { what: 'classroom', rev: 1 } });
    const st = await s.call('GET', '/v1/classroom/stage');
    expect(st.body.stage.show.button).toMatchObject({ id: 'bvideo01', kind: 'video', youtube: 'dQw4w9WgXcQ' });
    // Editing the list never changes what is up.
    await s.call('PUT', '/v1/classroom/buttons', { baseRev: 1, buttons: { videos: [], items: [] } });
    expect((await s.call('GET', '/v1/classroom/stage')).body.stage.show.button.title).toBe('Sparky Song');
    expect((await s.call('POST', '/v1/classroom/remote', { action: 'show', data: { button: 'bvideo01' } })).status).toBe(404);
    await s.call('POST', '/v1/classroom/remote', { action: 'back' });
    expect((await s.call('GET', '/v1/classroom/stage')).body.stage.show).toBe(null);
  });

  it('video commands need a video up, run once by id, and age out', async () => {
    const s = await setup();
    await s.call('PUT', '/v1/classroom/buttons', { baseRev: 0, buttons: { videos: [VIDEO], items: [TEXT] } });
    expect((await s.call('POST', '/v1/classroom/remote', { action: 'video', data: { op: 'toggle' } })).status).toBe(409);
    await s.call('POST', '/v1/classroom/remote', { action: 'show', data: { button: 'bvideo01' } });
    await s.call('POST', '/v1/classroom/remote', { action: 'video', data: { op: 'seek', by: -10 } });
    await s.call('POST', '/v1/classroom/remote', { action: 'sparky' });
    const st = (await s.call('GET', '/v1/classroom/stage')).body.stage;
    expect(st.cmds.map((c) => c.action)).toEqual(['video', 'sparky']);
    expect(new Set(st.cmds.map((c) => c.id)).size).toBe(2);
    s.tick(CLASSROOM_CMD_TTL_MS + 1);
    expect((await s.call('GET', '/v1/classroom/stage')).body.stage.cmds).toEqual([]);
  });

  it('a PDF turns pages within the count the screen reported', async () => {
    const s = await setup();
    const { id } = await s.upload(pdfOf(300));
    await s.call('PUT', '/v1/classroom/buttons', { baseRev: 0, buttons: { videos: [], items: [{ id: 'bpdf0001', kind: 'pdf', file: id, type: 'application/pdf' }] } });
    await s.call('POST', '/v1/classroom/remote', { action: 'show', data: { button: 'bpdf0001' } });
    await s.call('POST', '/v1/classroom/now', { now: { view: 'pdf', button: 'bpdf0001', page: 1, pages: 2 } });
    await s.call('POST', '/v1/classroom/remote', { action: 'page', data: { step: 1 } });
    const again = await s.call('POST', '/v1/classroom/remote', { action: 'page', data: { step: 1 } });
    expect(again.body.already).toBe(true);
    expect((await s.call('GET', '/v1/classroom/stage')).body.stage.show.page).toBe(2);
    await s.call('POST', '/v1/classroom/remote', { action: 'page', data: { step: -1 } });
    expect((await s.call('GET', '/v1/classroom/stage')).body.stage.show.page).toBe(1);
    // The shown file is kept while it is up, even after its button goes.
    await s.call('PUT', '/v1/classroom/buttons', { baseRev: 1, buttons: { videos: [], items: [] } });
    expect((await s.raw('GET', `/v1/classroom/files/${id}`)).status).toBe(200);
  });

  it('a /settings preview lasts a minute; the app\'s read does not count as the screen', async () => {
    const s = await setup();
    await s.call('POST', '/v1/classroom/remote', { action: 'preview', data: { look: 'cubbies' } });
    expect((await s.call('GET', '/v1/classroom/stage?from=app')).body.stage.preview).toMatchObject({ look: 'cubbies' });
    expect((await s.call('GET', '/v1/classroom/remote/state')).body.screenOnline).toBe(false);
    s.tick(CLASSROOM_PREVIEW_MS + 1);
    expect((await s.call('GET', '/v1/classroom/stage')).body.stage.preview).toBe(null);
    expect((await s.call('GET', '/v1/classroom/remote/state')).body.screenOnline).toBe(true);
  });

  it('the screen reports only while a remote watches; the first look rings it', async () => {
    const s = await setup();
    expect((await s.call('GET', '/v1/classroom/stage')).body.watch).toBe(false);
    const before = s.frames.length;
    const state = await s.call('GET', '/v1/classroom/remote/state');
    expect(state.status).toBe(200);
    expect(s.frames.length).toBe(before + 1);
    expect(s.frames.at(-1).d).toMatchObject({ what: 'classroom', watch: true });
    expect((await s.call('GET', '/v1/classroom/stage')).body.watch).toBe(true);
    await s.call('POST', '/v1/classroom/now', { now: { view: 'video', title: 'Sparky Song', video: { t: 12.4, d: 200, paused: false, volume: 80 } } });
    expect((await s.call('GET', '/v1/classroom/remote/state')).body.now).toMatchObject({ view: 'video', video: { t: 12, d: 200, volume: 80 } });
    expect(s.frames.length).toBe(before + 1);
    s.tick(CLASSROOM_WATCH_MS + 1);
    expect((await s.call('GET', '/v1/classroom/stage')).body.watch).toBe(false);
    expect((await s.call('POST', '/v1/classroom/now', { now: { view: 'nope' } })).status).toBe(400);
  });

  it('the stage is what the rules say even if storage holds junk', () => {
    expect(sanitizeStage({ rev: 3, show: { button: { kind: 'video', id: 'bvideo01', youtube: '<script>' }, at: 1 }, cmds: [{ id: 'x', action: 'say', at: 1 }] })).toEqual({ rev: 3, show: null, preview: null, cmds: [] });
  });
});

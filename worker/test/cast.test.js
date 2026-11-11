import { describe, expect, it } from 'vitest';
import { SyncCore } from '../src/sync.js';
import { CAST_BYTES_MAX, CAST_UPLOAD_QUIET_MS, CAST_CONVERTS_PER_HOUR, CAST_FILES_MAX, CAST_FILES_PER_HOUR, JOIN_FAILS_MAX, JOIN_NET_FAILS_MAX, TOKEN_TTL_MS } from '../src/cast.js';
import { memoryStore, signInV2 } from './helpers.js';
import { CLASSROOM_CLIP_PART_BYTES, CLASSROOM_FILE_PART_BYTES, fileLinkFrom, sanitizeButtons, sanitizeClassroomPress, sanitizeSignal } from '../../shared/classroomRemote.js';

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

describe('the tray\'s Show Cast code on an idle room (IP-20261111-07)', () => {
  it('rings the TV at once, so the code shows without waiting for its safety read', async () => {
    const s = await setup();
    const { code } = (await s.call('POST', '/v1/cast/open', {})).body;
    s.tick(1000);
    s.frames.length = 0;
    const reset = await s.call('POST', '/v1/cast/reset', {});
    expect(reset.body).toEqual({ ok: true, code });
    expect(s.frames.some((f) => f.e === 'changed' && f.d?.what === 'cast')).toBe(true);
    expect((await s.call('GET', '/v1/cast/screen')).body.revealAt).toBeGreaterThan(0);
  });
});

// Owner 2026-11-11: "All of those sound fantastic. Let's build them" (the Black button).
describe('Cast: Black', () => {
  const text = (words) => ({ action: 'item', data: { item: { id: 'bplaceholder', kind: 'text', text: words } } });
  const black = (on) => ({ action: 'black', data: { on } });
  async function joined() {
    const s = await setup();
    const { code } = (await s.call('POST', '/v1/cast/open', {})).body;
    const token = (await s.call('POST', '/v1/cast/join', { code }, { auth: '' })).body.token;
    const press = (body) => s.call('POST', '/v1/cast/press', body, { auth: '', cast: token });
    const stage = async () => (await s.call('GET', '/v1/cast/screen')).body.stage;
    return { ...s, code, token, press, stage };
  }

  it('black goes over what is up and rings the TV; Show again brings back exactly the same thing', async () => {
    const s = await joined();
    await s.press(text('Welcome'));
    const before = (await s.stage()).show;
    s.frames.length = 0;
    const on = await s.press(black(true));
    expect(on.status).toBe(200);
    expect(s.frames.some((f) => f.e === 'changed' && f.d?.what === 'cast')).toBe(true);
    let st = await s.stage();
    expect(st.black).toBe(true);
    expect(st.show).toEqual(before);
    // The presenter's own state says so too (what the pages draw from).
    expect((await s.call('GET', '/v1/cast/state', undefined, { auth: '', cast: s.token })).body.stage.black).toBe(true);
    expect((await s.call('GET', '/v1/cast/desk/state')).body.stage.black).toBe(true);
    // The same press again changes nothing (no new rev, no ring).
    s.frames.length = 0;
    const again = await s.press(black(true));
    expect(again.body).toMatchObject({ ok: true, already: true, rev: on.body.rev });
    expect(s.frames.length).toBe(0);
    const off = await s.press(black(false));
    expect(off.status).toBe(200);
    st = await s.stage();
    expect(st.black).toBeUndefined();
    expect(st.show).toEqual(before);
  });

  it('black works with nothing up, and from the desk; a press that does not say on or off is refused', async () => {
    const s = await joined();
    expect((await s.call('POST', '/v1/cast/desk/press', black(true))).status).toBe(200);
    const st = await s.stage();
    expect(st.black).toBe(true);
    expect(st.show).toBeNull();
    expect((await s.press({ action: 'black' })).status).toBe(400);
    expect((await s.press({ action: 'black', data: { on: 1 } })).status).toBe(400);
  });

  it('Back, a new thing going up, the tray reset and a new code all clear it', async () => {
    const s = await joined();
    await s.press(text('One'));
    await s.press(black(true));
    await s.press({ action: 'back' });
    expect((await s.stage()).black).toBeUndefined();
    await s.press(black(true));
    await s.press(text('Two'));
    let st = await s.stage();
    expect(st.black).toBeUndefined();
    expect(st.show.button.text).toBe('Two');
    await s.press(black(true));
    await s.press({ action: 'screen', data: {} });
    expect((await s.stage()).black).toBeUndefined();
    await s.press(black(true));
    await s.call('POST', '/v1/cast/reset', {});
    st = await s.stage();
    expect(st.black).toBeUndefined();
    expect(st.show).toBeNull();
    // Black with nothing up, then a new code (the TV page loading again).
    await s.call('POST', '/v1/cast/desk/press', black(true));
    expect((await s.stage()).black).toBe(true);
    await s.call('POST', '/v1/cast/open', {});
    expect((await s.stage()).black).toBeUndefined();
  });

  it('black is kept in storage with the stage (a restarted Worker still has it)', async () => {
    const s = await joined();
    await s.press(text('Kept'));
    await s.press(black(true));
    s.core.cast.engine.stageCache = null;
    const st = await s.stage();
    expect(st.black).toBe(true);
    expect(st.show.button.text).toBe('Kept');
  });

  it('a video under the black still takes its presses; slides keep their page', async () => {
    const s = await joined();
    await s.press({ action: 'item', data: { item: { id: 'bplaceholder', kind: 'video', youtube: 'dQw4w9WgXcQ' } } });
    await s.press(black(true));
    expect((await s.press({ action: 'video', data: { op: 'play' } })).status).toBe(200);
    const st = await s.stage();
    expect(st.black).toBe(true);
    expect(st.cmds.at(-1)).toMatchObject({ action: 'video', data: { op: 'play' } });
  });

  it('the desk asking for the code takes an idle black off (the code would be hidden); black over something stays', async () => {
    const s = await joined();
    await s.call('POST', '/v1/cast/desk/press', black(true));
    await s.call('POST', '/v1/cast/desk/reveal', {});
    expect((await s.stage()).black).toBeUndefined();
    await s.press(text('Up'));
    await s.press(black(true));
    await s.call('POST', '/v1/cast/desk/reveal', {});
    expect((await s.stage()).black).toBe(true);
  });

  it('the classroom room refuses it: its stage never goes black', async () => {
    const s = await setup();
    const r = await s.call('POST', '/v1/classroom/remote', black(true));
    expect(r.status).toBe(400);
    expect((await s.call('GET', '/v1/classroom/stage')).body.stage.black).toBeUndefined();
  });
});

// Owner 2026-11-11: the house slide (the church's logo and one optional line with nothing up).
describe('Cast: the house slide line', () => {
  it('is set at the desk with the computer\'s sign-in only, cleaned to one line of 60, and rings the TV', async () => {
    const s = await setup();
    const { code } = (await s.call('POST', '/v1/cast/open', {})).body;
    const token = (await s.call('POST', '/v1/cast/join', { code }, { auth: '' })).body.token;
    // Never a presenter's: no sign-in, or a token alone, is refused.
    expect((await s.call('PUT', '/v1/cast/desk/house', { line: 'x' }, { auth: '' })).status).toBe(401);
    expect((await s.call('PUT', '/v1/cast/desk/house', { line: 'x' }, { auth: '', cast: token })).status).toBe(401);
    expect((await s.call('GET', '/v1/cast/desk/house', undefined, { auth: '', cast: token })).status).toBe(401);
    // Nothing set yet: the logo alone, everywhere it is read.
    expect((await s.call('GET', '/v1/cast/desk/house')).body).toEqual({ ok: true, house: { line: '', savedAt: null } });
    expect((await s.call('GET', '/v1/cast/screen')).body.house).toEqual({ line: '' });
    s.frames.length = 0;
    const put = await s.call('PUT', '/v1/cast/desk/house', { line: '  Welcome\n to   Kennebec Valley  ' });
    expect(put.status).toBe(200);
    expect(put.body.house.line).toBe('Welcome to Kennebec Valley');
    expect(put.body.house.savedAt).toBe('2026-11-08T21:00:00.000Z');
    expect(s.frames.some((f) => f.e === 'changed' && f.d?.what === 'cast' && f.d?.house === true)).toBe(true);
    // The TV reads it with its one read; the desk with its state; a presenter's state has none.
    expect((await s.call('GET', '/v1/cast/screen')).body.house).toEqual({ line: 'Welcome to Kennebec Valley' });
    expect((await s.call('GET', '/v1/cast/desk/state')).body.house).toEqual({ line: 'Welcome to Kennebec Valley' });
    expect((await s.call('GET', '/v1/cast/state', undefined, { auth: '', cast: token })).body.house).toBeUndefined();
    expect((await s.call('PUT', '/v1/cast/desk/house', { line: 'y'.repeat(90) })).body.house.line).toHaveLength(60);
    // Not a line: refused, nothing changed.
    expect((await s.call('PUT', '/v1/cast/desk/house', { line: 7 })).status).toBe(400);
    expect((await s.call('PUT', '/v1/cast/desk/house', {})).status).toBe(400);
    expect((await s.call('GET', '/v1/cast/desk/house')).body.house.line).toHaveLength(60);
  });

  it('is the church\'s own: a reset, a new code, Cast off and on, and a restart all keep it; empty means the logo alone', async () => {
    const s = await setup();
    await s.call('POST', '/v1/cast/open', {});
    await s.call('PUT', '/v1/cast/desk/house', { line: 'Welcome' });
    await s.call('POST', '/v1/cast/reset', {});
    expect((await s.call('GET', '/v1/cast/screen')).body.house.line).toBe('Welcome');
    await s.call('POST', '/v1/cast/close', {});
    await s.call('POST', '/v1/cast/open', {});
    expect((await s.call('GET', '/v1/cast/screen')).body.house.line).toBe('Welcome');
    // Stored under its own key, in the cleaned shape.
    expect(await s.core.storage.get('cast:house')).toEqual({ line: 'Welcome', savedAt: '2026-11-08T21:00:00.000Z' });
    expect((await s.call('PUT', '/v1/cast/desk/house', { line: '   ' })).body.house.line).toBe('');
    expect((await s.call('GET', '/v1/cast/screen')).body.house).toEqual({ line: '' });
  });
});

// Owner 2026-11-11: a countdown and a clock, two more things to put up.
describe('Cast: a countdown and the clock', () => {
  const timer = (seconds, title) => ({ action: 'item', data: { item: { id: 'bplaceholder', kind: 'timer', seconds, ...(title === undefined ? {} : { title }) } } });
  const clock = { action: 'item', data: { item: { id: 'bplaceholder', kind: 'clock' } } };
  async function joined() {
    const s = await setup();
    const { code } = (await s.call('POST', '/v1/cast/open', {})).body;
    const token = (await s.call('POST', '/v1/cast/join', { code }, { auth: '' })).body.token;
    const press = (body) => s.call('POST', '/v1/cast/press', body, { auth: '', cast: token });
    const screen = async () => (await s.call('GET', '/v1/cast/screen')).body;
    return { ...s, token, press, screen };
  }
  const T0 = Date.parse('2026-11-08T21:00:00Z');

  it('a countdown ends by the Worker\'s clock, set when the press is taken, whatever the press said', async () => {
    const s = await joined();
    s.tick(7000);
    const r = await s.press({ action: 'item', data: { item: { id: 'bplaceholder', kind: 'timer', seconds: 300, title: ' Starting  in ', endsAt: 5 } } });
    expect(r.status).toBe(200);
    const body = await s.screen();
    expect(body.serverNow).toBe(T0 + 7000);
    expect(body.stage.show.button).toMatchObject({ kind: 'timer', seconds: 300, title: 'Starting in', endsAt: T0 + 7000 + 300000 });
    expect(body.stage.show.button.id).toBe(r.body.button);
    // The phone and the desk read the same moment (and the Worker's time to count from).
    const st = (await s.call('GET', '/v1/cast/state', undefined, { auth: '', cast: s.token })).body;
    expect(st.stage.show.button.endsAt).toBe(T0 + 307000);
    expect(st.serverNow).toBe(T0 + 7000);
    expect((await s.call('GET', '/v1/cast/desk/state')).body.stage.show.button.endsAt).toBe(T0 + 307000);
    // Stored with the stage; a new one replaces it and counts from its own press.
    s.core.cast.engine.stageCache = null;
    expect((await s.screen()).stage.show.button.endsAt).toBe(T0 + 307000);
    s.tick(60000);
    await s.call('POST', '/v1/cast/desk/press', timer(15));
    const next = (await s.screen()).stage.show.button;
    expect(next).toMatchObject({ kind: 'timer', seconds: 15, title: '', endsAt: T0 + 67000 + 15000 });
    // Past its end it simply stays up (0:00) until Back.
    s.tick(10 * 60 * 1000);
    expect((await s.screen()).stage.show.button.endsAt).toBe(T0 + 82000);
    await s.press({ action: 'back' });
    expect((await s.screen()).stage.show).toBeNull();
  });

  it('only 15 s to 60 min in steps of 15 s; anything else is not a press', async () => {
    const s = await joined();
    for (const seconds of [0, 10, 20, 3615, 7200, '300']) expect((await s.press(timer(seconds))).status).toBe(400);
    expect((await s.press(timer(3600))).status).toBe(200);
    expect((await s.press(timer(15))).status).toBe(200);
  });

  it('the clock goes up as an item with nothing in it; the video and page presses do not apply to either', async () => {
    const s = await joined();
    expect((await s.press(clock)).status).toBe(200);
    expect((await s.screen()).stage.show.button).toMatchObject({ kind: 'clock', title: '' });
    expect((await s.press({ action: 'video', data: { op: 'pause' } })).status).toBe(409);
    expect((await s.press({ action: 'page', data: { step: 1 } })).status).toBe(409);
    // Black covers it and shows it again like anything else.
    await s.press({ action: 'black', data: { on: true } });
    const st = (await s.screen()).stage;
    expect(st.black).toBe(true);
    expect(st.show.button.kind).toBe('clock');
  });

  it('the classroom room refuses both, and its button list never holds one', async () => {
    const s = await setup();
    for (const body of [timer(300), clock]) {
      const r = await s.call('POST', '/v1/classroom/remote', body);
      expect(r.status).toBe(400);
      expect(r.body.reason).toBe('not-here');
    }
    expect((await s.call('GET', '/v1/classroom/stage')).body.stage.show).toBeNull();
    const put = await s.call('PUT', '/v1/classroom/buttons', { baseRev: 0, buttons: { videos: [], items: [{ id: 'btimer0001', kind: 'timer', seconds: 300 }, { id: 'bclock0001', kind: 'clock' }] } });
    expect(put.body.buttons.items).toEqual([]);
  });
});

// Owner 2026-11-11: "Load several things before the event (a video, the slides, a picture)
// and tap through them in order" (the line-up).
describe('Cast: the line-up', () => {
  const text = (id, words) => ({ id, item: { id, kind: 'text', text: words } });
  async function joined() {
    const s = await setup();
    const { code } = (await s.call('POST', '/v1/cast/open', {})).body;
    const token = (await s.call('POST', '/v1/cast/join', { code }, { auth: '' })).body.token;
    const as = { auth: '', cast: token };
    const state = async () => (await s.call('GET', '/v1/cast/state', undefined, as)).body;
    const put = (baseRev, entries, opts = as) => s.call('PUT', '/v1/cast/lineup', { baseRev, entries }, opts);
    const show = (body, opts = as) => s.call('POST', '/v1/cast/lineup/show', body, opts);
    const screen = async () => (await s.call('GET', '/v1/cast/screen')).body;
    const uploadPng = async () => {
      const start = await s.call('POST', '/v1/cast/files', { type: 'image/png', bytes: PNG.length, name: 'Welcome.png' }, as);
      await s.call('PUT', `/v1/cast/files/${start.body.id}/0`, PNG, { ...as, type: 'application/octet-stream' });
      return (await s.call('POST', `/v1/cast/files/${start.body.id}/done`, {}, as)).body;
    };
    return { ...s, token, as, state, put, show, screen, uploadPng };
  }

  it('loading entries puts nothing on the TV; every state read carries the list', async () => {
    const s = await joined();
    const pic = await s.uploadPng();
    s.frames.length = 0;
    const r = await s.put(0, [text('bentryone1', 'Welcome'), { id: 'bentrytwo2', item: { id: 'bentrytwo2', kind: 'image', file: pic.id, type: 'image/png', title: 'Welcome' } }, { id: 'bentry0003', item: { id: 'bentry0003', kind: 'timer', seconds: 300, endsAt: 5 } }]);
    expect(r.status).toBe(200);
    expect(r.body.lineup).toMatchObject({ rev: 1, on: null, button: null });
    expect(r.body.lineup.entries.map((e) => e.item.kind)).toEqual(['text', 'image', 'timer']);
    expect('endsAt' in r.body.lineup.entries[2].item).toBe(false);
    // The TV shows nothing and is not rung (only the control pages read the line-up).
    expect((await s.screen()).stage.show).toBeNull();
    expect(s.frames.some((f) => f.e === 'changed' && f.d?.what === 'cast')).toBe(false);
    expect((await s.state()).lineup.entries).toHaveLength(3);
    expect((await s.call('GET', '/v1/cast/desk/state')).body.lineup.rev).toBe(1);
  });

  it('Next puts each entry up in order as an ordinary item press, and stops at the end', async () => {
    const s = await joined();
    await s.put(0, [text('bentryone1', 'One'), text('bentrytwo2', 'Two'), { id: 'bentry0003', item: { id: 'bentry0003', kind: 'timer', seconds: 60 } }]);
    const a = await s.show({ next: true });
    expect(a.status).toBe(200);
    expect((await s.screen()).stage.show.button).toMatchObject({ kind: 'text', text: 'One', id: a.body.button });
    expect(a.body.lineup).toMatchObject({ on: 'bentryone1', button: a.body.button });
    await s.show({ next: true });
    s.tick(4000);
    const c = await s.show({ next: true });
    // A countdown counts from when it went up.
    expect((await s.screen()).stage.show.button).toMatchObject({ kind: 'timer', endsAt: Date.parse('2026-11-08T21:00:00Z') + 4000 + 60000 });
    expect(c.body.lineup.on).toBe('bentry0003');
    const end = await s.show({ next: true });
    expect(end.status).toBe(409);
    expect(end.body.reason).toBe('end');
    // Black and Back behave as for any item; Next goes on from the entry shown last.
    await s.call('POST', '/v1/cast/press', { action: 'black', data: { on: true } }, s.as);
    const shown = await s.show({ id: 'bentryone1' });
    expect(shown.status).toBe(200);
    const st = (await s.screen()).stage;
    expect(st.black).toBeUndefined();
    expect(st.show.button.text).toBe('One');
    await s.call('POST', '/v1/cast/press', { action: 'back' }, s.as);
    expect((await s.state()).lineup).toMatchObject({ on: 'bentryone1' });
    await s.show({ next: true });
    expect((await s.screen()).stage.show.button.text).toBe('Two');
    expect((await s.show({ id: 'bnotthere1' })).status).toBe(404);
  });

  it('an edit from an older copy is 409 stale with the list as it is; the desk and the phone share one list', async () => {
    const s = await joined();
    expect((await s.put(0, [text('bentryone1', 'One')])).status).toBe(200);
    const stale = await s.put(0, [text('bentrytwo2', 'Two')]);
    expect(stale.status).toBe(409);
    expect(stale.body.reason).toBe('stale');
    expect(stale.body.lineup.entries.map((e) => e.id)).toEqual(['bentryone1']);
    // The desk edits the same list, with its own sign-in.
    const desk = await s.call('PUT', '/v1/cast/desk/lineup', { baseRev: 1, entries: [text('bentryone1', 'One'), text('bentrytwo2', 'Two')] });
    expect(desk.status).toBe(200);
    expect((await s.state()).lineup.entries.map((e) => e.id)).toEqual(['bentryone1', 'bentrytwo2']);
    const next = await s.call('POST', '/v1/cast/desk/lineup/show', { next: true });
    expect(next.body.lineup.on).toBe('bentryone1');
  });

  it('removing the entry shown last keeps Next going from where it was', async () => {
    const s = await joined();
    await s.put(0, [text('bentryone1', 'One'), text('bentrytwo2', 'Two'), text('bentry0003', 'Three')]);
    await s.show({ next: true });
    await s.show({ next: true });
    const r = await s.put(1, [text('bentryone1', 'One'), text('bentry0003', 'Three')]);
    expect(r.body.lineup.on).toBe('bentryone1');
    await s.show({ next: true });
    expect((await s.screen()).stage.show.button.text).toBe('Three');
    // Moved: Next follows the new order.
    const moved = await s.put(2, [text('bentry0003', 'Three'), text('bentryone1', 'One')]);
    expect(moved.body.lineup.on).toBe('bentry0003');
  });

  it('at most 12 entries, every one a real entry, every file a finished file of the room', async () => {
    const s = await joined();
    const many = Array.from({ length: 13 }, (_, i) => text(`bentry${String(i).padStart(4, '0')}`, `No. ${i}`));
    const full = await s.put(0, many);
    expect(full.status).toBe(400);
    expect(full.body.reason).toBe('full');
    expect((await s.put(0, many.slice(0, 12))).status).toBe(200);
    expect((await s.put(1, [text('bentryone1', 'One'), text('bentryone1', 'Again')])).body.reason).toBe('entry');
    expect((await s.put(1, [{ id: 'bentryone1', item: { id: 'bentryone1', kind: 'screen' } }])).body.reason).toBe('entry');
    const missing = await s.put(1, [{ id: 'bentryone1', item: { id: 'bentryone1', kind: 'image', file: 'fabcdefghijklmnop', type: 'image/png' } }]);
    expect(missing.body.reason).toBe('file-missing');
    expect((await s.state()).lineup.entries).toHaveLength(12);
  });

  it('a line-up file is never taken to make room, and a new code clears the line-up', async () => {
    const s = await joined();
    const pic = await s.uploadPng();
    await s.put(0, [{ id: 'bentryone1', item: { id: 'bentryone1', kind: 'image', file: pic.id, type: 'image/png' } }]);
    expect(await s.core.cast.lineupFiles()).toEqual(new Set([pic.id]));
    // Room for a file the size of the whole room: the line-up's picture stays.
    await s.core.cast.makeRoom(1);
    for (let i = 0; i < 12; i += 1) await s.uploadPng();
    expect(await s.core.cast.storage.get(`castmeta:${pic.id}`)).toMatchObject({ done: true });
    await s.call('POST', '/v1/cast/reset', {});
    const after = (await s.call('GET', '/v1/cast/desk/state')).body.lineup;
    expect(after).toMatchObject({ entries: [], on: null });
    await s.call('POST', '/v1/cast/open', {});
    expect((await s.call('GET', '/v1/cast/desk/state')).body.lineup.entries).toEqual([]);
  });
});

describe('Cast: one link copy at a time (IP-20261111-17)', () => {
  it('a second copy while one runs is 429 busy, counted against nothing; the next one after is fine', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const asked = [];
    const PDF = new TextEncoder().encode('%PDF-1.4\n' + 'x'.repeat(400));
    const core = new SyncCore({
      storage: memoryStore(),
      env: { INITIAL_PASSPHRASE: 'kennebec' },
      now: () => Date.parse('2026-11-08T21:00:00Z'),
      fetchFn: async (url) => {
        asked.push(String(url));
        if (String(url).includes('slow')) await gate;
        return new Response(PDF, { headers: { 'content-type': 'application/pdf' } });
      },
      broadcast: () => 1,
      liveScreens: () => new Set(),
    });
    const session = (await signInV2(core)).body.session;
    const call = async (path, body, headers) => {
      const res = await core.handle(new Request(`https://sync.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }), '10.0.0.9');
      return { status: res.status, body: await res.json() };
    };
    const { code } = (await call('/v1/cast/open', {}, { Authorization: `Bearer ${session}` })).body;
    const { token } = (await call('/v1/cast/join', { code }, {})).body;
    const cast = { 'X-Cast-Token': token };
    const first = call('/v1/cast/files', { url: 'https://a.example/slow.pdf' }, cast);
    while (!asked.length) await new Promise((r) => setTimeout(r, 0));
    const second = await call('/v1/cast/files', { url: 'https://a.example/b.pdf' }, cast);
    expect(second.status).toBe(429);
    expect(second.body.reason).toBe('busy');
    // The desk shares the room's one copy too.
    expect((await call('/v1/cast/desk/files', { url: 'https://a.example/c.pdf' }, { Authorization: `Bearer ${session}` })).body.reason).toBe('busy');
    expect(asked).toEqual(['https://a.example/slow.pdf']);
    release();
    expect((await first).status).toBe(200);
    expect((await call('/v1/cast/files', { url: 'https://a.example/d.pdf' }, cast)).status).toBe(200);
    expect([...core.cast.rates.values()].reduce((n, r) => n + r.files, 0)).toBe(2);   // the refused ones were not counted
  });
});

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

  // Security review 2026-11-09 (deliberately changed from "lock joining for everyone"):
  // one network is locked, the code rotates after JOIN_FAILS_MAX, the count is stored.
  it('too many wrong codes lock that network only; enough from anywhere rotate the code', async () => {
    const s = await setup();
    const { code } = (await s.call('POST', '/v1/cast/open', {})).body;
    const wrong = code === '100000' ? '100001' : '100000';
    const joinFrom = async (ip, c) => { const r = await s.core.handle(new Request('https://sync.test/v1/cast/join', { method: 'POST', body: JSON.stringify({ code: c }) }), ip); return { status: r.status, body: await r.json() }; };
    for (let i = 0; i < JOIN_NET_FAILS_MAX; i += 1) expect((await joinFrom('10.5.0.1', wrong)).body.reason).toBe('refused');
    // That network waits, even with the right code; another network does not.
    expect((await joinFrom('10.5.0.1', code)).status).toBe(429);
    // The count lives in storage (a deploy restarting the object does not reset it).
    expect((await s.core.storage.get('cast:fails')).n).toBe(JOIN_NET_FAILS_MAX);
    // Wrong codes from other networks up to JOIN_FAILS_MAX: the code changes and the TV is told.
    s.frames.length = 0;
    for (let i = JOIN_NET_FAILS_MAX; i < JOIN_FAILS_MAX; i += 1) await joinFrom(`10.6.${i}.1`, wrong);
    const fresh = (await s.call('GET', '/v1/cast/screen')).body.code;
    expect(fresh).toMatch(/^[1-9]\d{5}$/);
    expect(fresh).not.toBe(code);
    expect(s.frames.some((f) => f.e === 'changed' && f.d?.what === 'cast')).toBe(true);
    expect((await joinFrom('10.7.0.1', code)).body.reason).toBe('refused');
    expect((await joinFrom('10.7.0.1', fresh)).status).toBe(200);
    // After the window the locked network may try again.
    s.tick(11 * 60 * 1000);
    expect((await joinFrom('10.5.0.1', fresh)).body.reason).toBe('refused');   // right code, but someone presents
  });

  it('a busy room and a wrong code get the same answer', async () => {
    const s = await setup();
    const { code } = (await s.call('POST', '/v1/cast/open', {})).body;
    expect((await s.call('POST', '/v1/cast/join', { code }, { auth: '' })).status).toBe(200);
    const busy = await s.call('POST', '/v1/cast/join', { code }, { auth: '' });
    const wrong = await s.call('POST', '/v1/cast/join', { code: code === '100000' ? '100001' : '100000' }, { auth: '' });
    expect(busy).toEqual(wrong);
    expect(busy.status).toBe(403);
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
  it('a presenter may start only a few PowerPoints an hour (each one is a GitHub job and up to 40 MB)', async () => {
    const s = await convertSetup();
    for (let n = 0; n < CAST_CONVERTS_PER_HOUR; n += 1) {
      const start = await s.call('POST', '/v1/cast/convert', { bytes: 40, name: 'x.pptx' }, s.as);
      expect(start.status).toBe(200);
      await s.call('POST', `/v1/cast/convert/${start.body.id}/failed`, { reason: 'convert' }, s.machine);
    }
    const over = await s.call('POST', '/v1/cast/convert', { bytes: 40, name: 'x.pptx' }, s.as);
    expect(over.status).toBe(429);
    expect(over.body.reason).toBe('too-many');
    s.tick(61 * 60 * 1000);
    expect((await s.call('POST', '/v1/cast/convert', { bytes: 40, name: 'x.pptx' }, s.as)).status).toBe(200);
  });
});

// Owner 2026-11-08, later: one presenter at a time (refuse the second), Display code
// (leave with the TV back to its code) and the tray's reset, YouTube search, a Facebook
// video, an uploaded video (a clip, sent ten parts a request).
describe('one presenter, leave, reset, YouTube search, Facebook and uploaded videos', () => {
  async function room(env = { YOUTUBE_API_KEY: 'yt-key' }) {
    let t = Date.parse('2026-11-08T21:00:00Z');
    const asked = [];
    const core = new SyncCore({
      storage: memoryStore(),
      env: { INITIAL_PASSPHRASE: 'kennebec', ...env },
      now: () => t,
      fetchFn: async (url) => {
        const u = String(url);
        asked.push(u);
        if (u.startsWith('https://www.googleapis.com/youtube/v3/search')) {
          return Response.json({ items: [
            { id: { videoId: 'dQw4w9WgXcQ' }, snippet: { title: 'Jesus Loves Me &amp; You', channelTitle: 'Kids Church' } },
            { id: { videoId: 'bad' }, snippet: { title: 'x' } },
          ] });
        }
        if (u.startsWith('https://www.googleapis.com/youtube/v3/videos')) return Response.json({ items: [{ id: 'dQw4w9WgXcQ', contentDetails: { duration: 'PT3M33S' } }] });
        throw new Error(`unexpected fetch ${u}`);
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
    const join = async () => call('POST', '/v1/cast/join', { code }, { auth: '' });
    return { core, raw, call, code, join, asked, tick: (ms) => { t += ms; } };
  }

  it('a second phone is refused while the first presents; Disconnect or 30 quiet minutes frees the room', async () => {
    const s = await room();
    const first = await s.join();
    expect(first.status).toBe(200);
    const second = await s.join();
    expect(second.status).toBe(403);   // the same answer as a wrong code (security review 2026-11-09)
    expect(second.body.reason).toBe('refused');
    // Using the page keeps the room.
    s.tick(25 * 60 * 1000);
    await s.call('GET', '/v1/cast/state', undefined, { auth: '', cast: first.body.token });
    s.tick(25 * 60 * 1000);
    expect((await s.join()).status).toBe(403);
    // Disconnect frees it at once.
    expect((await s.call('POST', '/v1/cast/leave', {}, { auth: '', cast: first.body.token })).status).toBe(200);
    const third = await s.join();
    expect(third.status).toBe(200);
    expect((await s.call('GET', '/v1/cast/state', undefined, { auth: '', cast: first.body.token })).status).toBe(401);
    // Quiet for 30 minutes: the next one may join, and the quiet one is out.
    s.tick(31 * 60 * 1000);
    const fourth = await s.join();
    expect(fourth.status).toBe(200);
    expect((await s.call('GET', '/v1/cast/state', undefined, { auth: '', cast: third.body.token })).status).toBe(401);
  });

  it('Display code takes the TV back to its code and frees the room; the tray reset does it from the lobby computer', async () => {
    const s = await room();
    const a = (await s.join()).body.token;
    await s.call('POST', '/v1/cast/press', { action: 'item', data: { item: { id: 'bplaceholder', kind: 'text', text: 'Welcome' } } }, { auth: '', cast: a });
    expect((await s.call('GET', '/v1/cast/screen')).body.stage.show).not.toBeNull();
    await s.call('POST', '/v1/cast/leave', { takeDown: true }, { auth: '', cast: a });
    expect((await s.call('GET', '/v1/cast/screen')).body.stage.show).toBeNull();
    const b = (await s.join()).body.token;
    await s.call('POST', '/v1/cast/press', { action: 'item', data: { item: { id: 'bplaceholder', kind: 'text', text: 'Hello' } } }, { auth: '', cast: b });
    // The tray: needs the computer's sign-in; same code, nothing up, nobody connected.
    expect((await s.call('POST', '/v1/cast/reset', {}, { auth: '' })).status).toBe(401);
    const reset = await s.call('POST', '/v1/cast/reset', {});
    expect(reset.body).toEqual({ ok: true, code: s.code });
    const screen = (await s.call('GET', '/v1/cast/screen')).body;
    expect(screen.stage.show).toBeNull();
    expect(screen.code).toBe(s.code);
    expect((await s.call('GET', '/v1/cast/state', undefined, { auth: '', cast: b })).status).toBe(401);
    expect((await s.join()).status).toBe(200);
  });

  it('YouTube search: safe, embeddable, lengths, kept a while; not set up says so', async () => {
    const s = await room();
    const t = (await s.join()).body.token;
    const r = await s.call('GET', '/v1/cast/youtube?q=jesus%20loves%20me', undefined, { auth: '', cast: t });
    expect(r.body.results).toEqual([{ youtube: 'dQw4w9WgXcQ', title: 'Jesus Loves Me & You', channel: 'Kids Church', seconds: 213 }]);
    expect(s.asked[0]).toContain('safeSearch=strict');
    expect(s.asked[0]).toContain('videoEmbeddable=true');
    await s.call('GET', '/v1/cast/youtube?q=Jesus%20Loves%20Me', undefined, { auth: '', cast: t });
    expect(s.asked).toHaveLength(2);
    expect((await s.call('GET', '/v1/cast/youtube?q=x', undefined, { auth: '' })).status).toBe(401);
    const none = await room({});
    const t2 = (await none.join()).body.token;
    expect((await none.call('GET', '/v1/cast/youtube?q=x', undefined, { auth: '', cast: t2 })).body.reason).toBe('not-configured');
  });

  it('a Facebook video goes up and takes the video presses; a non-Facebook link is refused', async () => {
    const s = await room();
    const t = (await s.join()).body.token;
    const up = await s.call('POST', '/v1/cast/press', { action: 'item', data: { item: { id: 'bplaceholder', kind: 'facebook', href: 'https://m.facebook.com/watch/?v=123456789', title: 'Sunday' } } }, { auth: '', cast: t });
    expect(up.status).toBe(200);
    const shown = (await s.call('GET', '/v1/cast/screen')).body.stage.show.button;
    expect(shown).toMatchObject({ kind: 'facebook', href: 'https://www.facebook.com/watch/?v=123456789', title: 'Sunday' });
    expect((await s.call('POST', '/v1/cast/press', { action: 'video', data: { op: 'toggle' } }, { auth: '', cast: t })).status).toBe(200);
    expect((await s.call('POST', '/v1/cast/press', { action: 'item', data: { item: { id: 'bplaceholder', kind: 'facebook', href: 'https://evil.example/videos/123456' } } }, { auth: '', cast: t })).status).toBe(400);
  });

  it('an uploaded video: ten parts a request, read back whole, played with the video presses', { timeout: 20000 }, async () => {
    const s = await room();
    const t = (await s.join()).body.token;
    const size = 2 * CLASSROOM_CLIP_PART_BYTES + 12345;
    const clip = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) clip[i] = (i * 7 + 3) & 255;
    clip.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]); // an iPhone .mov's ftyp box
    const start = await s.call('POST', '/v1/cast/files', { type: 'video/mp4', bytes: size, name: 'Skit.mov' }, { auth: '', cast: t });
    expect(start.body).toMatchObject({ parts: 3, partBytes: CLASSROOM_CLIP_PART_BYTES });
    for (let n = 0; n < 3; n += 1) expect((await s.call('PUT', `/v1/cast/files/${start.body.id}/${n}`, clip.subarray(n * CLASSROOM_CLIP_PART_BYTES, (n + 1) * CLASSROOM_CLIP_PART_BYTES), { auth: '', cast: t })).status).toBe(200);
    const done = await s.call('POST', `/v1/cast/files/${start.body.id}/done`, {}, { auth: '', cast: t });
    expect(done.body).toMatchObject({ kind: 'clip', type: 'video/mp4', bytes: size });
    const back = await s.raw('GET', `/v1/cast/screen/files/${start.body.id}`);
    expect(Buffer.from(await back.arrayBuffer()).equals(Buffer.from(clip))).toBe(true);
    await s.call('POST', '/v1/cast/press', { action: 'item', data: { item: { id: 'bplaceholder', kind: 'clip', file: start.body.id, type: 'video/mp4', title: 'Skit' } } }, { auth: '', cast: t });
    expect((await s.call('POST', '/v1/cast/press', { action: 'video', data: { op: 'seek', by: 10 } }, { auth: '', cast: t })).status).toBe(200);
    // Too big, or a video that is not one.
    expect((await s.call('POST', '/v1/cast/files', { type: 'video/mp4', bytes: 201 * 1024 * 1024 }, { auth: '', cast: t })).body.reason).toBe('too-big');
    const fake = await s.call('POST', '/v1/cast/files', { type: 'video/mp4', bytes: 10 }, { auth: '', cast: t });
    await s.call('PUT', `/v1/cast/files/${fake.body.id}/0`, new Uint8Array(10), { auth: '', cast: t });
    expect((await s.call('POST', `/v1/cast/files/${fake.body.id}/done`, {}, { auth: '', cast: t })).body.reason).toBe('type');
  });

  it('the Sparks list takes at most three clips and no Facebook', () => {
    const clip = (n) => ({ id: `bclip${n}abc`, kind: 'clip', file: `fclipfileabc${n}`, type: 'video/mp4' });
    const out = sanitizeButtons({ items: [clip(1), clip(2), clip(3), clip(4), { id: 'bfacebook1', kind: 'facebook', href: 'https://fb.watch/abc/' }] });
    expect(out.items.map((i) => i.kind)).toEqual(['clip', 'clip', 'clip']);
  });

  it('the tray\'s Disconnect the presenter lets them go and leaves the TV as it is', async () => {
    const s = await room();
    const a = (await s.join()).body.token;
    await s.call('POST', '/v1/cast/press', { action: 'item', data: { item: { id: 'bplaceholder', kind: 'text', text: 'Welcome' } } }, { auth: '', cast: a });
    expect((await s.call('POST', '/v1/cast/kick', {}, { auth: '' })).status).toBe(401);
    expect((await s.call('POST', '/v1/cast/kick', {})).body).toEqual({ ok: true, disconnected: true });
    expect((await s.call('GET', '/v1/cast/state', undefined, { auth: '', cast: a })).status).toBe(401);
    expect((await s.call('GET', '/v1/cast/screen')).body.stage.show).not.toBeNull();
    expect((await s.join()).status).toBe(200);
  });
});

// A guest needs no passphrase, so what one code may cost is bounded (cast.js): at most
// CAST_FILES_MAX files and CAST_BYTES_MAX bytes in the room (the oldest finished files
// not on the TV make room), a few uploads per token an hour, a byte allowance per room.
describe('Cast: what a guest may keep in the room', () => {
  async function presenter() {
    const s = await setup();
    const { code } = (await s.call('POST', '/v1/cast/open', {})).body;
    const join = async () => (await s.call('POST', '/v1/cast/join', { code }, { auth: '' })).body.token;
    return { ...s, code, join };
  }
  async function sendPng(s, token) {
    const start = await s.call('POST', '/v1/cast/files', { type: 'image/png', bytes: PNG.length, name: 'a.png' }, { auth: '', cast: token });
    if (start.status !== 200) return start;
    await s.call('PUT', `/v1/cast/files/${start.body.id}/0`, PNG, { auth: '', cast: token });
    return s.call('POST', `/v1/cast/files/${start.body.id}/done`, {}, { auth: '', cast: token });
  }
  const files = async (s) => [...(await s.core.storage.list({ prefix: 'castmeta:' })).values()];

  it('a new file past the cap makes room by deleting the oldest one not on the TV', async () => {
    const s = await presenter();
    const t = await s.join();
    const ids = [];
    for (let n = 0; n < CAST_FILES_MAX; n += 1) { ids.push((await sendPng(s, t)).body.id); s.tick(1000); }
    // The first is on the TV, so the second is the one that goes.
    await s.call('POST', '/v1/cast/press', { action: 'item', data: { item: { id: 'bplaceholder', kind: 'image', file: ids[0], type: 'image/png' } } }, { auth: '', cast: t });
    const next = await sendPng(s, t);
    expect(next.status).toBe(200);
    const left = (await files(s)).map((m) => m.id);
    expect(left.length).toBe(CAST_FILES_MAX);
    expect(left).toContain(ids[0]);
    expect(left).not.toContain(ids[1]);
    expect((await s.raw('GET', `/v1/cast/screen/files/${ids[1]}`)).status).toBe(404);
  });

  it('refuses room-full when what is up and still uploading fills the room', async () => {
    const s = await presenter();
    const t = await s.join();
    const start = (bytes, type = 'video/mp4') => s.call('POST', '/v1/cast/files', { type, bytes }, { auth: '', cast: t });
    expect((await start(200 * 1024 * 1024)).status).toBe(200);
    expect((await start(20 * 1024 * 1024, 'application/pdf')).status).toBe(200);
    expect((await start(CAST_BYTES_MAX - 220 * 1024 * 1024, 'application/pdf')).status).toBe(200);
    const full = await start(1000, 'image/png');
    expect(full.status).toBe(413);
    expect(full.body.reason).toBe('room-full');
  });

  it("a dropped big upload gives its bytes back to the hour's allowance, so the retry gets in (IP-20261111-24)", async () => {
    const s = await presenter();
    const t = await s.join();
    const start = (bytes, type = 'video/mp4') => s.call('POST', '/v1/cast/files', { type, bytes }, { auth: '', cast: t });
    const big = 200 * 1024 * 1024;
    const first = await start(big);
    expect(first.status).toBe(200);
    // Still uploading: a second 200 MB would pass the hour's 300 MB.
    expect((await start(big)).body.reason).toBe('too-many');
    // The phone lost the Wi-Fi. A few quiet minutes later the retry is taken.
    s.tick(CAST_UPLOAD_QUIET_MS + 60 * 1000);
    const retry = await start(big);
    expect(retry.status).toBe(200);
    expect((await files(s)).map((m) => m.id)).toEqual([retry.body.id]);
    // The allowance now holds the retry alone: a third is still too much.
    expect((await start(big)).body.reason).toBe('too-many');
  });

  it('a dropped upload stops holding the room; one still sending parts keeps it (IP-20261111-06)', async () => {
    const s = await presenter();
    const t = await s.join();
    const start = (bytes, type = 'video/mp4') => s.call('POST', '/v1/cast/files', { type, bytes }, { auth: '', cast: t });
    const clip = await start(200 * 1024 * 1024);
    expect(clip.status).toBe(200);
    s.tick(CAST_UPLOAD_QUIET_MS + 60 * 1000);
    // The clip is slow but still going: a part arrives now.
    const part = new Uint8Array(clip.body.partBytes);
    expect((await s.call('PUT', `/v1/cast/files/${clip.body.id}/0`, part, { auth: '', cast: t, type: 'application/octet-stream' })).status).toBe(200);
    expect((await start(20 * 1024 * 1024, 'application/pdf')).status).toBe(200);
    expect((await start(CAST_BYTES_MAX - 220 * 1024 * 1024, 'application/pdf')).status).toBe(200);
    // Nothing is quiet long enough yet: full, and nothing was taken.
    expect((await start(1000, 'image/png')).body.reason).toBe('room-full');
    expect((await files(s)).map((m) => m.id)).toContain(clip.body.id);
    // The phone lost the Wi-Fi: no part for a while. The retry gets in.
    s.tick(CAST_UPLOAD_QUIET_MS + 60 * 1000);
    expect((await start(1000, 'image/png')).status).toBe(200);
    expect((await files(s)).map((m) => m.id)).not.toContain(clip.body.id);
    expect(await s.core.storage.get(`castpart:${clip.body.id}:0`)).toBeUndefined();
  });

  it('a dropped upload on the TV is never taken', async () => {
    const s = await presenter();
    const t = await s.join();
    for (let n = 0; n < CAST_FILES_MAX; n += 1) {
      expect((await s.call('POST', '/v1/cast/files', { type: 'image/png', bytes: 10 }, { auth: '', cast: t })).status).toBe(200);
    }
    const metas = await files(s);
    // Pretend the oldest is on the TV (a stage that names it).
    const stage = await s.core.cast.engine.stage();
    await s.core.cast.engine.saveStage({ ...stage, show: { button: { id: 'bonthetv01', kind: 'image', file: metas[0].id, type: 'image/png' }, at: 0, page: 1 } });
    s.tick(CAST_UPLOAD_QUIET_MS + 1000);
    expect((await s.call('POST', '/v1/cast/files', { type: 'image/png', bytes: 10 }, { auth: '', cast: t })).status).toBe(200);
    expect((await files(s)).map((m) => m.id)).toContain(metas[0].id);
  });

  it('a token may start only so many uploads an hour', async () => {
    const s = await presenter();
    const t = await s.join();
    for (let n = 0; n < CAST_FILES_PER_HOUR; n += 1) expect((await sendPng(s, t)).status).toBe(200);
    const over = await sendPng(s, t);
    expect(over.status).toBe(429);
    expect(over.body.reason).toBe('too-many');
    s.tick(61 * 60 * 1000);
    expect((await sendPng(s, t)).status).toBe(200);
  });

  it('the room has an hourly byte allowance that a new token does not reset', async () => {
    const s = await presenter();
    let t = await s.join();
    expect((await s.call('POST', '/v1/cast/files', { type: 'video/mp4', bytes: 200 * 1024 * 1024 }, { auth: '', cast: t })).status).toBe(200);
    await s.call('POST', '/v1/cast/leave', {}, { auth: '', cast: t });
    t = await s.join();
    const over = await s.call('POST', '/v1/cast/files', { type: 'video/mp4', bytes: 101 * 1024 * 1024 }, { auth: '', cast: t });
    expect(over.status).toBe(429);
    expect(over.body.reason).toBe('too-many');
  });
});

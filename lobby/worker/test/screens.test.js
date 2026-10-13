import { describe, expect, it } from 'vitest';
import { SyncCore } from '../src/sync.js';
import { ONLINE_MS, SCREENS_MAX, STALE_MS, freshActions, screenQueueKey, screenSettingsKey } from '../src/screens.js';
import { SHARED_KEYS } from '../../src/lib/sharedSettings.js';
import { SCREEN_ACTION_QUEUE_MAX, SCREEN_ACTION_TTL_MS, SCREEN_SPECS } from '../../src/lib/syncSpecs.js';

// The screen registry (ROADMAP.md#settings-page, phase 2): screens say hello, /settings
// lists them and edits each one's OWN settings through the kind's allowlist,
// and every change or action is a doorbell on the live channel for that one
// screen.

function memoryStore() {
  const map = new Map();
  return {
    map,
    get: async (k) => (map.has(k) ? structuredClone(map.get(k)) : undefined),
    put: async (k, v) => { map.set(k, structuredClone(v)); },
    delete: async (k) => map.delete(k),
  };
}

const TV = 'tv_aaaaaaaaaaaaaaaaaaaa';
const PJ = 'pj_bbbbbbbbbbbbbbbbbbbb';
const KIOSK = 'jk_cccccccccccccccccccc';

function setup({ start = Date.parse('2026-10-11T18:00:00Z') } = {}) {
  let t = start;
  const frames = [];
  const live = new Set();
  const storage = memoryStore();
  const core = new SyncCore({
    storage,
    env: { INITIAL_PASSPHRASE: 'kennebec' },
    now: () => t,
    broadcast: (text) => { frames.push(JSON.parse(text)); return 1; },
    liveScreens: () => live,
  });
  let session = '';
  const call = async (method, path, body, token = session) => {
    const res = await core.handle(new Request(`https://sync.test${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), '10.0.0.1');
    return { status: res.status, body: await res.json() };
  };
  const signIn = async () => {
    session = (await call('POST', '/v1/login', { passphrase: 'kennebec' }, '')).body.session;
  };
  return { core, storage, frames, live, call, signIn, tick: (ms) => { t += ms; } };
}

describe('saying hello', () => {
  it('needs a session, like every route but login', async () => {
    const s = setup();
    expect((await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' })).status).toBe(401);
    expect((await s.call('GET', '/v1/screens')).status).toBe(401);
    expect((await s.call('PUT', `/v1/screens/${TV}/settings`, { settings: {} })).status).toBe(401);
    expect((await s.call('POST', `/v1/screens/${TV}/action`, { action: 'reset-tally' })).status).toBe(401);
    expect((await s.call('DELETE', `/v1/screens/${TV}`)).status).toBe(401);
  });

  it('adds a new screen under its kind\'s name, and answers with its settings (none yet)', async () => {
    const s = setup();
    await s.signIn();
    const res = await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' });
    expect(res.status).toBe(200);
    expect(res.body.screen).toMatchObject({ id: TV, kind: 'lobby', name: 'Lobby TV', online: true, live: false });
    expect(res.body.settings).toBeNull();
    const named = await s.call('POST', '/v1/screens/hello', { id: PJ, kind: 'projector', name: '  Gym\nprojector  ' });
    expect(named.body.screen.name).toBe('Gym projector');
  });

  it('a hello never renames a known screen (a TV restarting cannot undo a name given on /settings)', async () => {
    const s = setup();
    await s.signIn();
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' });
    await s.call('PUT', `/v1/screens/${TV}/name`, { name: 'Front door' });
    const again = await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby', name: 'Lobby TV' });
    expect(again.body.screen.name).toBe('Front door');
  });

  it('refuses a bad id, an unknown kind, and an id that belongs to another kind', async () => {
    const s = setup();
    await s.signIn();
    expect((await s.call('POST', '/v1/screens/hello', { id: 'short', kind: 'lobby' })).status).toBe(400);
    expect((await s.call('POST', '/v1/screens/hello', { id: '../../etc/passwd/aaaaaaa', kind: 'lobby' })).status).toBe(400);
    expect((await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'toaster' })).status).toBe(400);
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' });
    expect((await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'projector' })).status).toBe(409);
  });

  it('writes lastSeen at most once a minute, but always answers fresh', async () => {
    const s = setup();
    await s.signIn();
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' });
    const first = (await s.storage.get('screens'))[TV].lastSeen;
    s.tick(20_000);
    const res = await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' });
    expect((await s.storage.get('screens'))[TV].lastSeen).toBe(first);
    expect(Date.parse(res.body.screen.lastSeen)).toBe(first + 20_000);
    s.tick(60_000);
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' });
    expect((await s.storage.get('screens'))[TV].lastSeen).toBe(first + 80_000);
  });
});

describe('the list', () => {
  it('names every screen, by kind then name, online while seen lately or on the live channel', async () => {
    const s = setup();
    await s.signIn();
    await s.call('POST', '/v1/screens/hello', { id: KIOSK, kind: 'journey' });
    await s.call('POST', '/v1/screens/hello', { id: PJ, kind: 'projector' });
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' });
    s.tick(ONLINE_MS + 1000);
    s.live.add(PJ);
    const { body } = await s.call('GET', '/v1/screens');
    expect(body.max).toBe(SCREENS_MAX);
    expect(body.screens.map((x) => [x.kind, x.online, x.live])).toEqual([
      ['lobby', false, false],
      ['projector', true, true],
      ['journey', false, false],
    ]);
  });

  it('keeps at most SCREENS_MAX, making room only by forgetting one silent for a month', async () => {
    const s = setup();
    await s.signIn();
    const id = (i) => `tv_${String(i).padStart(20, '0')}`;
    for (let i = 0; i < SCREENS_MAX; i += 1) await s.call('POST', '/v1/screens/hello', { id: id(i), kind: 'lobby' });
    expect((await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' })).status).toBe(409);
    await s.call('PUT', `/v1/screens/${id(0)}/settings`, { settings: { audioMuted: true } });
    s.tick(STALE_MS);
    // Everyone but screen 0 checks in again; screen 0 is the one to go.
    for (let i = 1; i < SCREENS_MAX; i += 1) await s.call('POST', '/v1/screens/hello', { id: id(i), kind: 'lobby' });
    expect((await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' })).status).toBe(200);
    const ids = (await s.call('GET', '/v1/screens')).body.screens.map((x) => x.id);
    expect(ids).toHaveLength(SCREENS_MAX);
    expect(ids).not.toContain(id(0));
    expect(s.storage.map.has(screenSettingsKey(id(0)))).toBe(false);
  });
});

describe('a screen\'s own settings', () => {
  it('keep only the kind\'s allowlist: never a shared key, a Pusher key, panic mode or the deck', async () => {
    const s = setup();
    await s.signIn();
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' });
    const res = await s.call('PUT', `/v1/screens/${TV}/settings`, {
      settings: {
        audioMuted: false,
        confettiLevel: 'reduced',
        cornerClub: 'sparks',
        showTonightTicker: true,
        backgroundSource: 'video',
        slideshowDelaySec: 9.6,
        // none of these
        pusherAppKey: 'stolen',
        pusherCluster: 'eu',
        panicMode: true,
        manualSlides: [{ text: 'hi' }],
        standardDisplayMs: 9000,
        checkoutBoardNamesAbove: 0,
        sharedThemeUrl: 'https://evil.example/theme.json',
        confettiLevel2: 'x',
        cornerClub2: 'sparks',
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({
      backgroundSource: 'video', slideshowDelaySec: 10, audioMuted: false, confettiLevel: 'reduced',
      cornerClub: 'sparks', showTonightTicker: true,
    });
    expect(res.body.dropped).toEqual(expect.arrayContaining(['pusherAppKey', 'panicMode', 'manualSlides', 'standardDisplayMs', 'checkoutBoardNamesAbove', 'sharedThemeUrl']));
    const got = await s.call('GET', `/v1/screens/${TV}/settings`);
    expect(got.body.settings).toEqual({ savedAt: res.body.savedAt, settings: res.body.settings });
    expect(got.body.screen).toMatchObject({ id: TV, name: 'Lobby TV' });
  });

  it('no kind\'s allowlist holds a shared key', () => {
    for (const spec of Object.values(SCREEN_SPECS)) {
      for (const key of Object.keys(spec)) expect(SHARED_KEYS, key).not.toContain(key);
      for (const key of ['pusherAppKey', 'pusherCluster', 'panicMode', 'manualSlides', 'sharedScheduleUrl', 'sharedThemeUrl']) {
        expect(spec, key).not.toHaveProperty(key);
      }
    }
  });

  it('per kind: the projector keeps its two switches, Journey its playback quality', async () => {
    const s = setup();
    await s.signIn();
    await s.call('POST', '/v1/screens/hello', { id: PJ, kind: 'projector' });
    await s.call('POST', '/v1/screens/hello', { id: KIOSK, kind: 'journey' });
    expect((await s.call('PUT', `/v1/screens/${PJ}/settings`, { settings: { lowPower: true, stingers: 'yes', audioMuted: true } })).body.settings)
      .toEqual({ lowPower: true });
    expect((await s.call('PUT', `/v1/screens/${KIOSK}/settings`, { settings: { playbackQuality: 'low', captions: true } })).body.settings)
      .toEqual({});
  });

  it('a KVBC Awana computer (v9) registers with its roles and display hours, and takes no actions', async () => {
    const s = setup();
    await s.signIn();
    const PC = 'pc_dddddddddddddddddddd';
    const hi = await s.call('POST', '/v1/screens/hello', { id: PC, kind: 'computer', name: 'Check-in laptop' });
    expect(hi.body.screen).toMatchObject({ kind: 'computer', name: 'Check-in laptop' });
    const res = await s.call('PUT', `/v1/screens/${PC}/settings`, {
      settings: { printRole: true, displayRole: false, displayFrom: '17:00', displayUntil: '25:00', audioMuted: true },
    });
    expect(res.body.settings).toEqual({ printRole: true, displayRole: false, displayFrom: '17:00' });
    expect((await s.call('POST', `/v1/screens/${PC}/action`, { action: 'reset-tally' })).status).toBe(400);
    expect((await s.call('GET', '/v1/screens')).body.screens.map((x) => x.kind)).toEqual(['computer']);
  });

  it('a computer holding a print-off says so in its hello, and the list shows it until a hello without one', async () => {
    const s = setup();
    await s.signIn();
    const PC = 'pc_eeeeeeeeeeeeeeeeeeee';
    await s.call('POST', '/v1/screens/hello', { id: PC, kind: 'computer', name: 'Check-in laptop' });
    const held = await s.call('POST', '/v1/screens/hello', {
      id: PC, kind: 'computer', pendingRoleChange: { printRole: false, displayRole: true, audioMuted: true, displayFrom: 'soon' },
    });
    expect(held.body.screen.pendingRoleChange).toEqual({ printRole: false, displayRole: true });
    expect((await s.call('GET', '/v1/screens')).body.screens[0].pendingRoleChange).toEqual({ printRole: false, displayRole: true });
    await s.call('POST', '/v1/screens/hello', { id: PC, kind: 'computer' });
    expect((await s.call('GET', '/v1/screens')).body.screens[0]).not.toHaveProperty('pendingRoleChange');
    // Never for another kind, and junk is no hold.
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby', pendingRoleChange: { printRole: false } });
    await s.call('POST', '/v1/screens/hello', { id: PC, kind: 'computer', pendingRoleChange: 'yes' });
    const list = (await s.call('GET', '/v1/screens')).body.screens;
    expect(list.some((x) => 'pendingRoleChange' in x)).toBe(false);
  });

  it('a Journey kiosk reports how its saved lessons are going, in one fixed shape', async () => {
    const s = setup();
    await s.signIn();
    const res = await s.call('POST', '/v1/screens/hello', {
      id: KIOSK, kind: 'journey', name: 'Journey kiosk',
      status: {
        lessons: {
          saved: 24, total: 63, bytesSaved: 12e9, bytesTotal: 9e9, downloading: 'yes', waiting: true, paused: false,
          percent: 142, currentWeek: 7.6, lastSavedAt: '2026-10-11T16:00:00Z', error: `Week 7\u0000 Leader Video:\n${'x'.repeat(300)}`,
          auto: true, url: 'https://cdn.example/x.mp4', names: ['Ada'],
        },
        extra: 'dropped',
      },
    });
    const lessons = res.body.screen.status.lessons;
    expect(Object.keys(res.body.screen.status)).toEqual(['lessons']);
    expect(lessons).toMatchObject({
      saved: 24, total: 63, bytesSaved: 9e9, bytesTotal: 9e9, downloading: false, waiting: true, paused: false,
      percent: 100, currentWeek: 7, lastSavedAt: '2026-10-11T16:00:00.000Z', auto: true,
    });
    expect(Object.keys(lessons).sort()).toEqual(['auto', 'bytesSaved', 'bytesTotal', 'currentWeek', 'downloading', 'error', 'known', 'lastSavedAt', 'leaders',
      'paused', 'percent', 'saved', 'supported', 'total', 'waiting']);
    expect(lessons).toMatchObject({ known: true, supported: true });
    expect(lessons.error.startsWith('Week 7 Leader Video: xxx')).toBe(true);
    expect(lessons.error.length).toBeLessThanOrEqual(120);
    expect(JSON.stringify(res.body)).not.toContain('cdn.example');
    expect((await s.call('GET', '/v1/screens')).body.screens[0].status).toEqual(res.body.screen.status);
  });

  it('lessons only from a Journey kiosk; junk is no status, and a hello without one keeps the last', async () => {
    const s = setup();
    await s.signIn();
    const status = { lessons: { saved: 3, total: 63, bytesSaved: 1, bytesTotal: 2, percent: 4 } };
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby', status });
    await s.call('POST', '/v1/screens/hello', { id: KIOSK, kind: 'journey', status: { lessons: { saved: 'lots' } } });
    let list = (await s.call('GET', '/v1/screens')).body.screens;
    expect(list.some((x) => 'status' in x)).toBe(false);
    expect((await s.storage.get('screens'))[TV]).not.toHaveProperty('status');
    await s.call('POST', '/v1/screens/hello', { id: KIOSK, kind: 'journey', status });
    s.tick(5 * 60_000);
    await s.call('POST', '/v1/screens/hello', { id: KIOSK, kind: 'journey' });
    list = (await s.call('GET', '/v1/screens')).body.screens;
    expect(list.find((x) => x.id === KIOSK).status.lessons).toMatchObject({ saved: 3, total: 63, error: null, currentWeek: null, lastSavedAt: null });
  });

  it('a kiosk that cannot save lessons, or has not looked yet, says so', async () => {
    const s = setup();
    await s.signIn();
    const res = await s.call('POST', '/v1/screens/hello', {
      id: KIOSK, kind: 'journey', status: { lessons: { saved: 0, total: 0, bytesSaved: 0, bytesTotal: 0, percent: 0, auto: false, known: false, supported: false } },
    });
    expect(res.body.screen.status.lessons).toMatchObject({ saved: 0, total: 0, known: false, supported: false, auto: false });
  });

  it('a computer reports its KVBC Awana version and update; a TV and a projector their page build', async () => {
    const PC = 'pc_ffffffffffffffffffff';
    const s = setup();
    await s.signIn();
    const PJ = 'pj_aaaaaaaaaaaaaaaaaaaa';
    const pc = await s.call('POST', '/v1/screens/hello', {
      id: PC, kind: 'computer',
      status: { app: { version: '9.4.0', update: { state: 'downloading', percent: 42.9, at: '2026-10-12T15:00:00Z', url: 'https://x' }, path: 'C:\\Users' }, lessons: {} },
    });
    expect(pc.body.screen.status).toEqual({ app: { version: '9.4.0', update: { state: 'downloading', percent: 42, at: '2026-10-12T15:00:00.000Z' } } });
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby', status: { page: { build: 'ABCDEF123456' } } });
    await s.call('POST', '/v1/screens/hello', { id: PJ, kind: 'projector', status: { page: { build: null } } });
    const list = (await s.call('GET', '/v1/screens')).body.screens;
    expect(list.find((x) => x.id === TV).status).toEqual({ page: { build: 'abcdef1' } });
    expect(list.find((x) => x.id === PJ).status).toEqual({ page: { build: null } });
    expect(list.find((x) => x.id === PC).status.app.version).toBe('9.4.0');
    // Another kind's shape, or junk, is ignored and the last one stays.
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby', status: { lessons: { saved: 1, total: 2 } } });
    await s.call('POST', '/v1/screens/hello', { id: PC, kind: 'computer', status: { app: { version: '9.4.0', update: { state: 'exploded' } } } });
    await s.call('POST', '/v1/screens/hello', { id: PC, kind: 'computer', status: { page: { build: 'abcdef1' } } });
    const again = (await s.call('GET', '/v1/screens')).body.screens;
    expect(again.find((x) => x.id === TV).status).toEqual({ page: { build: 'abcdef1' } });
    expect(again.find((x) => x.id === PC).status.app.update.state).toBe('downloading');
    expect((await s.storage.get('screens'))[TV].status).toEqual({ page: { build: 'abcdef1' } });
  });

  it("a computer's update reaches storage at once on a new state or ten points, else with the once-a-minute write", async () => {
    const PC = 'pc_gggggggggggggggggggg';
    const s = setup();
    await s.signIn();
    const app = (state, percent) => ({ app: { version: '9.4.0', update: { state, percent, at: '2026-10-12T15:00:00Z' } } });
    const stored = async () => (await s.storage.get('screens'))[PC].status?.app.update;
    await s.call('POST', '/v1/screens/hello', { id: PC, kind: 'computer', status: app('downloading', 10) });
    s.tick(10_000);
    await s.call('POST', '/v1/screens/hello', { id: PC, kind: 'computer', status: app('downloading', 15) });
    expect((await stored()).percent).toBe(10);
    expect((await s.call('GET', '/v1/screens')).body.screens[0].status.app.update.percent).toBe(15);
    s.tick(10_000);
    await s.call('POST', '/v1/screens/hello', { id: PC, kind: 'computer', status: app('downloading', 20) });
    expect((await stored()).percent).toBe(20);
    s.tick(1_000);
    await s.call('POST', '/v1/screens/hello', { id: PC, kind: 'computer', status: app('ready') });
    expect(await stored()).toMatchObject({ state: 'ready', percent: null });
    // A TV's build is the same at every hello: nothing written inside the minute.
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby', status: { page: { build: 'abcdef1' } } });
    const seen = (await s.storage.get('screens'))[TV].lastSeen;
    s.tick(20_000);
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby', status: { page: { build: 'abcdef1' } } });
    expect((await s.storage.get('screens'))[TV].lastSeen).toBe(seen);
    s.tick(1_000);
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby', status: { page: { build: 'bcdef12' } } });
    expect((await s.storage.get('screens'))[TV].status).toEqual({ page: { build: 'bcdef12' } });
  });

  it('a status reaches storage with the once-a-minute write, or at once when it moved enough to matter', async () => {
    const s = setup();
    await s.signIn();
    const at = (patch) => ({ lessons: { saved: 10, total: 63, bytesSaved: 4e9, bytesTotal: 9e9, downloading: true, paused: false, percent: 40, currentWeek: 7, auto: true, ...patch } });
    const stored = async () => (await s.storage.get('screens'))[KIOSK].status?.lessons;
    await s.call('POST', '/v1/screens/hello', { id: KIOSK, kind: 'journey', status: at({}) });
    expect((await stored()).percent).toBe(40);
    // A few points of progress inside the minute: the list is fresh, storage waits.
    s.tick(20_000);
    await s.call('POST', '/v1/screens/hello', { id: KIOSK, kind: 'journey', status: at({ percent: 45, bytesSaved: 4.2e9 }) });
    expect((await stored()).percent).toBe(40);
    expect((await s.call('GET', '/v1/screens')).body.screens[0].status.lessons.percent).toBe(45);
    // Ten points, a lesson saved, an error, a pause: written at once.
    s.tick(5_000);
    await s.call('POST', '/v1/screens/hello', { id: KIOSK, kind: 'journey', status: at({ percent: 50 }) });
    expect((await stored()).percent).toBe(50);
    for (const patch of [{ percent: 50, saved: 11 }, { percent: 50, saved: 11, error: 'Week 8 Student Video: the internet went away' }, { percent: 50, saved: 11, paused: true, downloading: false }]) {
      s.tick(1_000);
      await s.call('POST', '/v1/screens/hello', { id: KIOSK, kind: 'journey', status: at(patch) });
      expect(await stored()).toMatchObject(patch);
    }
    // After a restart (memory gone) the list still shows the last stored.
    s.core.screens.fresh.clear();
    expect((await s.call('GET', '/v1/screens')).body.screens[0].status.lessons).toMatchObject({ saved: 11, paused: true });
    // Forgotten: nothing of it is kept.
    await s.call('DELETE', `/v1/screens/${KIOSK}`);
    expect(s.core.screens.fresh.size).toBe(0);
  });

  it('a save rings that screen\'s doorbell on the live channel, stamped strictly after the last', async () => {
    const s = setup();
    await s.signIn();
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' });
    const a = await s.call('PUT', `/v1/screens/${TV}/settings`, { settings: { audioMuted: true } });
    const b = await s.call('PUT', `/v1/screens/${TV}/settings`, { settings: { audioMuted: false } });
    expect(Date.parse(b.body.savedAt)).toBeGreaterThan(Date.parse(a.body.savedAt));
    expect(s.frames.filter((f) => f.e === 'changed')).toEqual([
      { e: 'changed', d: { what: 'screen', id: TV, at: a.body.savedAt } },
      { e: 'changed', d: { what: 'screen', id: TV, at: b.body.savedAt } },
    ]);
  });

  it('an unknown screen has no settings to read or write', async () => {
    const s = setup();
    await s.signIn();
    expect((await s.call('GET', `/v1/screens/${TV}/settings`)).status).toBe(404);
    expect((await s.call('PUT', `/v1/screens/${TV}/settings`, { settings: { audioMuted: true } })).status).toBe(404);
    expect(s.storage.map.has(screenSettingsKey(TV))).toBe(false);
  });

  it('no path reaches an inherited name (a forged "__proto__" or "constructor" id)', async () => {
    const s = setup();
    await s.signIn();
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' });
    for (const id of ['__proto__', 'constructor', 'hasOwnProperty_____x']) {
      expect((await s.call('PUT', `/v1/screens/${id}/name`, { name: 'x' })).status).toBe(404);
      expect((await s.call('PUT', `/v1/screens/${id}/settings`, { settings: { audioMuted: true } })).status).toBe(404);
    }
    expect({}.name).toBeUndefined();
  });

  it('refuses a body with no settings object', async () => {
    const s = setup();
    await s.signIn();
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' });
    expect((await s.call('PUT', `/v1/screens/${TV}/settings`, { settings: [] })).status).toBe(400);
    expect((await s.call('PUT', `/v1/screens/${TV}/settings`, {})).status).toBe(400);
  });
});

describe('renaming and forgetting', () => {
  it('a name is one clean line, never empty', async () => {
    const s = setup();
    await s.signIn();
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' });
    expect((await s.call('PUT', `/v1/screens/${TV}/name`, { name: '   ' })).status).toBe(400);
    const res = await s.call('PUT', `/v1/screens/${TV}/name`, { name: `Front\u0000 door ${'x'.repeat(80)}` });
    expect(res.body.screen.name).toBe(`Front door ${'x'.repeat(29)}`);
    expect(s.frames.at(-1).d).toMatchObject({ what: 'screen', id: TV });
  });

  it('forgetting a screen drops it and its settings; it comes back fresh if it says hello again', async () => {
    const s = setup();
    await s.signIn();
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' });
    await s.call('PUT', `/v1/screens/${TV}/settings`, { settings: { audioMuted: true } });
    expect((await s.call('DELETE', `/v1/screens/${TV}`)).body).toEqual({ forgotten: true });
    expect((await s.call('GET', '/v1/screens')).body.screens).toEqual([]);
    expect((await s.call('DELETE', `/v1/screens/${TV}`)).body).toEqual({ forgotten: false });
    const back = await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' });
    expect(back.body.settings).toBeNull();
  });
});

describe('actions', () => {
  it('ring the one screen on the live channel, and say whether it was there to hear', async () => {
    const s = setup();
    await s.signIn();
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' });
    expect((await s.call('POST', `/v1/screens/${TV}/action`, { action: 'preview-checkin' })).body).toEqual({ ok: true, delivered: false });
    s.live.add(TV);
    expect((await s.call('POST', `/v1/screens/${TV}/action`, { action: 'board-demo', data: { names: ['Ada'] } })).body).toEqual({ ok: true, delivered: true });
    expect(s.frames.map((f) => f.d)).toEqual([
      { what: 'screen-action', id: TV, action: 'preview-checkin', at: expect.any(String) },
      // Data is dropped for every action but the projector's wall pick.
      { what: 'screen-action', id: TV, action: 'board-demo', at: expect.any(String) },
    ]);
  });

  it('only the kind\'s allowlisted actions, and a wall pick only in the projector\'s shape', async () => {
    const s = setup();
    await s.signIn();
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' });
    await s.call('POST', '/v1/screens/hello', { id: PJ, kind: 'projector' });
    await s.call('POST', '/v1/screens/hello', { id: KIOSK, kind: 'journey' });
    expect((await s.call('POST', `/v1/screens/${TV}/action`, { action: 'media-changed' })).status).toBe(400);
    expect((await s.call('POST', `/v1/screens/${TV}/action`, { action: 'select' })).status).toBe(400);
    expect((await s.call('POST', `/v1/screens/${KIOSK}/action`, { action: 'pick' })).status).toBe(400);
    expect((await s.call('POST', `/v1/screens/${PJ}/action`, { action: 'select', data: { type: 'window', index: 99 } })).status).toBe(400);
    expect((await s.call('POST', `/v1/screens/${PJ}/action`, { action: 'select', data: { type: 'window', index: 2, extra: 'x' } })).status).toBe(200);
    expect((await s.call('POST', `/v1/screens/${PJ}/action`, { action: 'resume' })).status).toBe(200);
    expect(s.frames.map((f) => f.d.data ?? null)).toEqual([{ type: 'window', index: 2 }, null]);
  });

  it('an action is never kept for a screen that connects later', async () => {
    const s = setup();
    await s.signIn();
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' });
    await s.call('POST', `/v1/screens/${TV}/action`, { action: 'reset-tally' });
    expect((await s.core.replayFrames()).some((f) => f.includes('screen-action'))).toBe(false);
  });
});

describe("a Journey kiosk's actions wait for its next hello (routes.md 10.8)", () => {
  const ACTIONS = ['start-downloads', 'pause-downloads', 'resume-downloads', 'stop-downloads', 'delete-downloads'];

  it('only the five download buttons, queued (not delivered), and rung for the embedded display to pass on', async () => {
    const s = setup();
    await s.signIn();
    await s.call('POST', '/v1/screens/hello', { id: KIOSK, kind: 'journey' });
    for (const bad of ['pick', 'preview-checkin', 'reset-tally', 'select', 'delete-everything', '']) {
      expect((await s.call('POST', `/v1/screens/${KIOSK}/action`, { action: bad })).status, bad).toBe(400);
    }
    expect(await s.storage.get(screenQueueKey(KIOSK))).toBeUndefined();
    const res = await s.call('POST', `/v1/screens/${KIOSK}/action`, { action: 'start-downloads', data: { weeks: [1, 2] } });
    expect(res.body).toEqual({ ok: true, delivered: false, queued: true });
    expect(s.frames.map((f) => f.d)).toEqual([{ what: 'screen-action', id: KIOSK, action: 'start-downloads', at: expect.any(String) }]);
    expect((await s.storage.get(screenQueueKey(KIOSK))).items).toEqual([{ action: 'start-downloads', at: expect.any(String) }]);
  });

  it('the next hello hands them over in order, ONCE; the hello after has none', async () => {
    const s = setup();
    await s.signIn();
    await s.call('POST', '/v1/screens/hello', { id: KIOSK, kind: 'journey' });
    await s.call('POST', `/v1/screens/${KIOSK}/action`, { action: 'pause-downloads' });
    s.tick(1000);
    await s.call('POST', `/v1/screens/${KIOSK}/action`, { action: 'delete-downloads' });
    const first = await s.call('POST', '/v1/screens/hello', { id: KIOSK, kind: 'journey' });
    expect(first.body.actions.map((a) => a.action)).toEqual(['pause-downloads', 'delete-downloads']);
    expect(await s.storage.get(screenQueueKey(KIOSK))).toBeUndefined();
    const second = await s.call('POST', '/v1/screens/hello', { id: KIOSK, kind: 'journey' });
    expect(second.body.actions).toEqual([]);
    // A TV's hello carries no actions field at all (its actions ride the live channel).
    expect((await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' })).body).not.toHaveProperty('actions');
  });

  it('bounded: at most five waiting, the sixth is refused (429) and nothing is lost', async () => {
    const s = setup();
    await s.signIn();
    await s.call('POST', '/v1/screens/hello', { id: KIOSK, kind: 'journey', name: 'Room 4 kiosk' });
    for (let i = 0; i < SCREEN_ACTION_QUEUE_MAX; i++) {
      expect((await s.call('POST', `/v1/screens/${KIOSK}/action`, { action: ACTIONS[i % ACTIONS.length] })).status).toBe(200);
    }
    const full = await s.call('POST', `/v1/screens/${KIOSK}/action`, { action: 'stop-downloads' });
    expect(full.status).toBe(429);
    expect(full.body.error).toMatch(/Room 4 kiosk has not picked up/);
    expect((await s.call('POST', '/v1/screens/hello', { id: KIOSK, kind: 'journey' })).body.actions).toHaveLength(SCREEN_ACTION_QUEUE_MAX);
    expect((await s.call('POST', `/v1/screens/${KIOSK}/action`, { action: 'stop-downloads' })).status).toBe(200);
  });

  it('a press older than ten minutes is dropped, both when queuing and when handing over', async () => {
    const s = setup();
    await s.signIn();
    await s.call('POST', '/v1/screens/hello', { id: KIOSK, kind: 'journey' });
    await s.call('POST', `/v1/screens/${KIOSK}/action`, { action: 'start-downloads' });
    s.tick(SCREEN_ACTION_TTL_MS + 1000);
    expect((await s.call('POST', '/v1/screens/hello', { id: KIOSK, kind: 'journey' })).body.actions).toEqual([]);
    expect(freshActions([{ action: 'stop-downloads', at: new Date(0).toISOString() }, { action: 'nope', at: new Date().toISOString() }, 'junk', null], 'journey', Date.now())).toEqual([]);
    expect(freshActions({ not: 'a list' }, 'journey', Date.now())).toEqual([]);
    // A stored item for another kind's action is not trusted either.
    const now = Date.now();
    expect(freshActions([{ action: 'reset-tally', at: new Date(now).toISOString() }], 'journey', now)).toEqual([]);
    expect(freshActions([{ action: 'reset-tally', at: new Date(now).toISOString() }], 'lobby', now)).toEqual([{ action: 'reset-tally', at: new Date(now).toISOString() }]);
  });

  it('forgetting the kiosk forgets what was waiting for it; a lobby TV never queues', async () => {
    const s = setup();
    await s.signIn();
    await s.call('POST', '/v1/screens/hello', { id: KIOSK, kind: 'journey' });
    await s.call('POST', '/v1/screens/hello', { id: TV, kind: 'lobby' });
    await s.call('POST', `/v1/screens/${KIOSK}/action`, { action: 'stop-downloads' });
    await s.call('DELETE', `/v1/screens/${KIOSK}`);
    expect(await s.storage.get(screenQueueKey(KIOSK))).toBeUndefined();
    await s.call('POST', `/v1/screens/${TV}/action`, { action: 'reset-tally' });
    expect(await s.storage.get(screenQueueKey(TV))).toBeUndefined();
  });

  it('its two own settings are the download switches, and the hello answer carries them', async () => {
    const s = setup();
    await s.signIn();
    await s.call('POST', '/v1/screens/hello', { id: KIOSK, kind: 'journey' });
    const put = await s.call('PUT', `/v1/screens/${KIOSK}/settings`, { settings: { downloadsAuto: false, downloadsLeader: 'yes', captions: true } });
    expect(put.body.settings).toEqual({ downloadsAuto: false });
    expect(put.body.dropped).toEqual(['downloadsLeader', 'captions']);
    expect((await s.call('POST', '/v1/screens/hello', { id: KIOSK, kind: 'journey' })).body.settings.settings).toEqual({ downloadsAuto: false });
  });
});

describe('the Journey room settings alone', () => {
  it('GET /v1/journey answers the room document (or null) behind a session, without the deck', async () => {
    const s = setup();
    expect((await s.call('GET', '/v1/journey')).status).toBe(401);
    await s.signIn();
    expect((await s.call('GET', '/v1/journey')).body).toEqual({ journey: null });
    const put = await s.call('PUT', '/v1/journey', { settings: { captions: true, captionSize: '1.3', slideExtras: { questions: false }, junk: 1 } });
    const got = (await s.call('GET', '/v1/journey')).body;
    expect(got).toEqual({ journey: { savedAt: put.body.savedAt, settings: { captions: true, captionSize: '1.3', slideExtras: { questions: false } } } });
    expect(got).not.toHaveProperty('slides');
  });
});

describe('routes', () => {
  it('anything else under /v1/screens is not found', async () => {
    const s = setup();
    await s.signIn();
    expect((await s.call('POST', '/v1/screens')).status).toBe(404);
    expect((await s.call('GET', '/v1/screens/hello')).status).toBe(404);
    expect((await s.call('GET', `/v1/screens/${TV}/secrets`)).status).toBe(404);
    expect((await s.call('PUT', `/v1/screens/${TV}`, {})).status).toBe(404);
  });
});

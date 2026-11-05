import { describe, expect, it } from 'vitest';
import { SyncCore } from '../src/sync.js';
import { SCORE_KEY } from '../src/scoreboard.js';
import { cleanBoard, clockReading } from '../../shared/scoreboard.js';
import { memoryStore, signInV2 } from './helpers.js';

// The game time scoreboard (src/routes.md 10.17): a session each, scores per
// club per night, the winner on End or a switch, a stopwatch on the Worker's
// clock, and a doorbell carrying the board on every change.

async function setup(start = '2026-11-04T23:10:00Z') {
  const storage = memoryStore();
  const frames = [];
  let now = Date.parse(start);
  const core = new SyncCore({
    storage,
    env: { INITIAL_PASSPHRASE: 'kennebec' },
    now: () => now,
    broadcast: (text) => { frames.push(JSON.parse(text)); return 1; },
    liveScreens: () => new Set(),
  });
  const session = (await signInV2(core)).body.session;
  const call = async (method, path, body, auth = session) => {
    const res = await core.handle(new Request(`https://sync.test${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), '10.0.0.1');
    return { status: res.status, body: await res.json() };
  };
  const rings = () => frames.filter((f) => f.e === 'changed' && f.d.what === 'scoreboard');
  return { core, storage, call, rings, tick: (ms) => { now += ms; }, setNow: (iso) => { now = Date.parse(iso); }, now: () => now };
}

const point = (s, club, team, delta = 1) => s.call('POST', '/v1/scoreboard/point', { club, team, delta });

describe('the game time scoreboard', () => {
  it('starts empty for tonight and needs the passphrase', async () => {
    const s = await setup();
    const a = await s.call('GET', '/v1/scoreboard');
    expect(a.status).toBe(200);
    expect(a.body.board.night).toBe('2026-11-04');
    expect(a.body.board.active).toBe(null);
    expect(a.body.board.scores.tnt).toMatchObject({ blue: 0, red: 0, yellow: 0, green: 0 });
    expect(a.body.board.setups.tnt).toBe('four');
    expect(a.body.serverNow).toBe(s.now());
    for (const [m, p, b] of [['GET', '/v1/scoreboard'], ['POST', '/v1/scoreboard/club', { club: 'tnt' }], ['POST', '/v1/scoreboard/point', { club: 'tnt', team: 'red', delta: 1 }], ['POST', '/v1/scoreboard/end', {}], ['POST', '/v1/scoreboard/clock', { op: 'clear' }]]) {
      expect((await s.call(m, p, b, null)).status).toBe(401);
    }
  });

  it('scores only the club that is up, never below 0, and keeps each club its own', async () => {
    const s = await setup();
    expect((await point(s, 'tnt', 'red')).body.reason).toBe('not-active');
    await s.call('POST', '/v1/scoreboard/club', { club: 'tnt' });
    await point(s, 'tnt', 'red');
    await point(s, 'tnt', 'red');
    await point(s, 'tnt', 'blue', -1);   // already 0: no change, no ring
    const sparksMiss = await point(s, 'sparks', 'blue');
    expect(sparksMiss.status).toBe(409);
    expect(sparksMiss.body.board.active).toBe('tnt');
    const b = (await s.call('GET', '/v1/scoreboard')).body.board;
    expect(b.scores.tnt).toMatchObject({ blue: 0, red: 2, yellow: 0, green: 0 });
    expect(b.scores.sparks).toMatchObject({ blue: 0, red: 0, yellow: 0, green: 0 });
    expect((await s.storage.get(SCORE_KEY)).scores.tnt.red).toBe(2);
    expect(s.rings().length).toBe(3);   // club + two points
  });

  it('two phones tapping at once both count', async () => {
    const s = await setup();
    await s.call('POST', '/v1/scoreboard/club', { club: 'sparks' });
    await Promise.all(Array.from({ length: 25 }, () => point(s, 'sparks', 'green')));
    expect((await s.call('GET', '/v1/scoreboard')).body.board.scores.sparks.green).toBe(25);
  });

  it('refuses anything that is not a club, a team or a single point', async () => {
    const s = await setup();
    await s.call('POST', '/v1/scoreboard/club', { club: 'tnt' });
    expect((await s.call('POST', '/v1/scoreboard/club', { club: 'trek' })).status).toBe(400);
    expect((await point(s, 'tnt', 'purple')).body.reason).toBe('not-playing');
    expect((await s.call('POST', '/v1/scoreboard/point', { club: 'tnt', team: 7, delta: 1 })).status).toBe(400);
    expect((await point(s, 'tnt', 'red', 5)).status).toBe(400);
  });

  it('End plays the winner and leaves the projector to its schedule; a switch plays the old club\'s winner first', async () => {
    const s = await setup();
    await s.call('POST', '/v1/scoreboard/club', { club: 'tnt' });
    await point(s, 'tnt', 'yellow');
    const sw = (await s.call('POST', '/v1/scoreboard/club', { club: 'sparks' })).body.board;
    expect(sw.active).toBe('sparks');
    expect(sw.finale).toMatchObject({ club: 'tnt', scores: { blue: 0, red: 0, yellow: 1, green: 0 } });
    const firstFinale = sw.finale.id;
    await point(s, 'sparks', 'blue');
    const end = (await s.call('POST', '/v1/scoreboard/end', {})).body.board;
    expect(end.active).toBe(null);
    expect(end.finale.club).toBe('sparks');
    expect(end.finale.id).toBeGreaterThan(firstFinale);
    // Flipping back keeps T&T's scores.
    const back = (await s.call('POST', '/v1/scoreboard/club', { club: 'tnt' })).body.board;
    expect(back.scores.tnt.yellow).toBe(1);
  });

  it('no winner screen for a game nobody scored in', async () => {
    const s = await setup();
    await s.call('POST', '/v1/scoreboard/club', { club: 'cubbies' });
    const b = (await s.call('POST', '/v1/scoreboard/end', {})).body.board;
    expect(b.active).toBe(null);
    expect(b.finale).toBe(null);
  });

  it('starts over the next night', async () => {
    const s = await setup();
    await s.call('POST', '/v1/scoreboard/club', { club: 'tnt' });
    await point(s, 'tnt', 'green');
    s.setNow('2026-11-12T00:10:00Z');   // 7:10 pm Eastern, Wednesday 2026-11-11
    const b = (await s.call('GET', '/v1/scoreboard')).body.board;
    expect(b.night).toBe('2026-11-11');
    expect(b.active).toBe(null);
    expect(b.scores.tnt.green).toBe(0);
  });

  it('every change rings the doorbell with the board itself (numbers only)', async () => {
    const s = await setup();
    await s.call('POST', '/v1/scoreboard/club', { club: 'tnt' });
    await point(s, 'tnt', 'blue');
    const last = s.rings().at(-1).d;
    expect(last.rev).toBe(last.board.rev);
    expect(cleanBoard(last.board)).toEqual(last.board);
    expect(last.board.scores.tnt.blue).toBe(1);
    expect(JSON.stringify(last)).not.toMatch(/[a-z]+@|first|name/i);
  });

  it('the stopwatch runs on the Worker\'s clock, pauses and resumes exactly', async () => {
    const s = await setup();
    const start = (await s.call('POST', '/v1/scoreboard/clock', { op: 'start', kind: 'stopwatch' })).body;
    expect(start.board.clock).toMatchObject({ kind: 'stopwatch', startedAt: s.now(), elapsedMs: 0 });
    s.tick(12345);
    const paused = (await s.call('POST', '/v1/scoreboard/clock', { op: 'pause' })).body.board.clock;
    expect(paused.elapsedMs).toBe(12345);
    expect(paused.startedAt).toBe(null);
    s.tick(60000);   // paused: nothing runs
    await s.call('POST', '/v1/scoreboard/clock', { op: 'resume' });
    s.tick(655);
    const b = (await s.call('GET', '/v1/scoreboard')).body;
    expect(clockReading(b.board.clock, b.serverNow).ms).toBe(13000);
    expect((await s.call('POST', '/v1/scoreboard/clock', { op: 'clear' })).body.board.clock).toBe(null);
  });

  it('the timer counts down to 0 and stays there; a finished timer cannot resume', async () => {
    const s = await setup();
    expect((await s.call('POST', '/v1/scoreboard/clock', { op: 'start', kind: 'timer', durationMs: 500 })).status).toBe(400);
    expect((await s.call('POST', '/v1/scoreboard/clock', { op: 'start', kind: 'timer', durationMs: 61 * 60000 })).status).toBe(400);
    await s.call('POST', '/v1/scoreboard/clock', { op: 'start', kind: 'timer', durationMs: 60000 });
    s.tick(45200);
    let b = (await s.call('GET', '/v1/scoreboard')).body;
    expect(clockReading(b.board.clock, b.serverNow)).toMatchObject({ ms: 14800, running: true, done: false });
    s.tick(20000);
    b = (await s.call('GET', '/v1/scoreboard')).body;
    expect(clockReading(b.board.clock, b.serverNow)).toMatchObject({ ms: 0, running: false, done: true });
    const paused = (await s.call('POST', '/v1/scoreboard/clock', { op: 'pause' })).body.board.clock;
    expect(paused.elapsedMs).toBe(60000);   // never past its length
    const resumed = (await s.call('POST', '/v1/scoreboard/clock', { op: 'resume' })).body.board.clock;
    expect(resumed.startedAt).toBe(null);
  });

  it('a clock works with no club up (any game time)', async () => {
    const s = await setup();
    const b = (await s.call('POST', '/v1/scoreboard/clock', { op: 'start', kind: 'stopwatch' })).body.board;
    expect(b.active).toBe(null);
    expect(b.clock.kind).toBe('stopwatch');
    expect((await s.call('POST', '/v1/scoreboard/clock', { op: 'pause' })).status).toBe(200);
    expect((await s.call('POST', '/v1/scoreboard/clock', { op: 'twist' })).status).toBe(400);
  });
});

describe('team setups (owner 2026-11-05: Boys vs Girls, Red vs Green, Blue vs Yellow, Leaders vs Kids)', () => {
  it('a setup is per club, scores only its own teams, and lasts the night', async () => {
    const s = await setup();
    await s.call('POST', '/v1/scoreboard/club', { club: 'tnt' });
    const b = (await s.call('POST', '/v1/scoreboard/setup', { club: 'tnt', setup: 'boys-girls', keep: false })).body.board;
    expect(b.setups).toEqual({ tnt: 'boys-girls', sparks: 'four', cubbies: 'four' });
    expect((await point(s, 'tnt', 'boys')).status).toBe(200);
    expect((await point(s, 'tnt', 'red')).body.reason).toBe('not-playing');
    expect((await s.call('POST', '/v1/scoreboard/setup', { club: 'tnt', setup: 'pink-purple' })).status).toBe(400);
    s.setNow('2026-11-12T00:10:00Z');
    expect((await s.call('GET', '/v1/scoreboard')).body.board.setups.tnt).toBe('four');
  });

  it('a new setup at 0 plays the old game\'s winner first; keep carries matching teams over', async () => {
    const s = await setup();
    await s.call('POST', '/v1/scoreboard/club', { club: 'sparks' });
    await point(s, 'sparks', 'red');
    await point(s, 'sparks', 'red');
    await point(s, 'sparks', 'green');
    const kept = (await s.call('POST', '/v1/scoreboard/setup', { club: 'sparks', setup: 'red-green', keep: true })).body.board;
    expect(kept.finale).toBe(null);
    expect([kept.scores.sparks.red, kept.scores.sparks.green]).toEqual([2, 1]);
    const fresh = (await s.call('POST', '/v1/scoreboard/setup', { club: 'sparks', setup: 'four', keep: false })).body.board;
    expect(fresh.finale).toMatchObject({ club: 'sparks', teams: ['red', 'green'] });
    expect(fresh.finale.scores.red).toBe(2);
    expect(fresh.scores.sparks).toMatchObject({ blue: 0, red: 0, yellow: 0, green: 0 });
    expect(fresh.active).toBe('sparks');
  });

  it('End on a two-team game names those two teams', async () => {
    const s = await setup();
    await s.call('POST', '/v1/scoreboard/club', { club: 'cubbies' });
    await s.call('POST', '/v1/scoreboard/setup', { club: 'cubbies', setup: 'leaders-kids', keep: false });
    await point(s, 'cubbies', 'kids');
    const b = (await s.call('POST', '/v1/scoreboard/end', {})).body.board;
    expect(b.finale.teams).toEqual(['leaders', 'kids']);
  });
});

describe('the sound switch (owner 2026-11-05: "add the sound switch")', () => {
  it('turns the projector\'s scoreboard sounds on and off, rings, and stays on the next night', async () => {
    const s = await setup();
    expect((await s.call('GET', '/v1/scoreboard')).body.board.sounds).toBe(false);
    const on = (await s.call('POST', '/v1/scoreboard/sounds', { on: true })).body.board;
    expect(on.sounds).toBe(true);
    expect(s.rings().at(-1).d.board.sounds).toBe(true);
    expect((await s.call('POST', '/v1/scoreboard/sounds', { on: 'yes' })).status).toBe(400);
    expect((await s.call('POST', '/v1/scoreboard/sounds', { on: true }, null)).status).toBe(401);
    s.setNow('2026-11-12T00:10:00Z');
    const next = (await s.call('GET', '/v1/scoreboard')).body.board;
    expect(next.night).toBe('2026-11-11');
    expect(next.sounds).toBe(true);
    expect((await s.call('POST', '/v1/scoreboard/sounds', { on: false })).body.board.sounds).toBe(false);
  });
});

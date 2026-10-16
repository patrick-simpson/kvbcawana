// Tonight's overview (routes.md 10.6), and the rules every new settings route keeps:
// no child's name or id in any answer, no key work in the new modules.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { windowNow } from '../src/overview.js';
import { plainWords } from './helpers.js';
import { kid, rig } from './rig.js';

const SUNDAY = Date.parse('2026-10-11T16:00:00Z');
const PROD = { CLOUD_PRINT: 'on', SINGLE_PUBLISHER: 'on', YM_CHECKOUT: 'on' };
const KIDS = [kid('7351922', 'Sparks', 'Zebedee Quillfeather'), kid('7351923', 'Trek', 'Ottoline Wrexham'), kid('7351924', 'Cubbies', 'Barnaby Fitzgibbon')];

describe('GET /v1/tonight/overview', () => {
  it('on a club night: counts, read, print, youth check-out, switches, notice, church, history, changes', async () => {
    const r = await rig({ env: PROD, kids: KIDS });
    const st = await r.station();
    await st.call('POST', '/v1/print/heartbeat', { printer: { state: 'ok' }, version: '9.3.0', churchRev: 0 });
    await r.core.watcher.tick();
    await r.call('POST', '/v1/notice', { level: 'info', message: 'Doors open at 6', durationMin: 60 });
    const res = await r.call('GET', '/v1/tonight/overview');
    expect(res.status).toBe(200);
    const o = res.body;
    expect(Object.keys(o)).toEqual(['at', 'night', 'clubNight', 'window', 'count', 'read', 'print', 'ym', 'switches', 'notice', 'church', 'history', 'changes', 'feeds']);
    expect(o).toMatchObject({ at: new Date(r.clock.t).toISOString(), night: '2026-10-14', clubNight: true, window: { open: true, opensInMin: 0, closesInMin: 180 } });
    expect(o.count).toMatchObject({ checkedIn: 3, checkedOut: 0, byClub: { Sparks: 1, Trek: 1, Cubbies: 1 }, enabled: true });
    expect(Object.keys(o.count)).toEqual(['source', 'checkedIn', 'checkedOut', 'byClub', 'reportAgeMs', 'enabled']);
    expect(o.read).toMatchObject({ mode: 'shadow', configured: true, lastError: null, watchIntervalSec: 30 });
    expect(Object.keys(o.read)).toEqual(['mode', 'configured', 'signedIn', 'lastReadAt', 'lastOkAt', 'lastError', 'loginBlockedForSec', 'watchIntervalSec']);
    expect(o.print).toMatchObject({ checkThePrinter: 0, stations: [{ stationId: 'station-aaaaaaaa', name: 'Desk laptop', printer: { state: 'ok' }, version: '9.3.0', churchRev: 0 }] });
    expect(o.print.claims).toEqual(expect.objectContaining({ queued: expect.any(Number) }));
    expect(Object.keys(o.ym)).toEqual(['enabled', 'due', 'checkedOut', 'failed', 'gaveUp', 'pending', 'lastError']);
    expect(o.switches.map((s) => s.name)).toEqual(['CLOUD_PRINT', 'SINGLE_PUBLISHER', 'YM_CHECKOUT', 'CHURCH_SETTINGS', 'NOTICES', 'CHANGE_LOG']);
    expect(o.notice).toEqual({ level: 'info', message: 'Doors open at 6', at: new Date(r.clock.t).toISOString(), until: new Date(r.clock.t + 3600000).toISOString(), by: { kind: 'unknown', name: 'Unknown device' } });
    expect(o.church).toEqual({ rev: 0, savedAt: null, seeded: false, paused: false });
    expect(o.history).toEqual({ db: false, pending: 0 });
    expect(o.changes).toMatchObject({ head: 2, last: { what: 'notice' } });
    expect(o.feeds).toEqual({ slipsHeld: 0, oldStations: [] });
  });

  it('on a Sunday: no window, counts from nothing, and the same shape', async () => {
    const r = await rig({ start: SUNDAY });
    const o = (await r.call('GET', '/v1/tonight/overview')).body;
    expect(o).toMatchObject({ night: '2026-10-11', clubNight: false, window: { open: false, closesInMin: null }, notice: null, changes: { head: 0, last: null } });
    expect(o.window.opensInMin).toBeGreaterThan(0);
  });

  it('a part that fails is null; the rest still answers', async () => {
    const r = await rig({ start: SUNDAY });
    r.core.ym.statusView = async () => { throw new Error('boom'); };
    const o = (await r.call('GET', '/v1/tonight/overview')).body;
    expect(o.ym).toBeNull();
    expect(o.church).toEqual({ rev: 0, savedAt: null, seeded: false, paused: false });
  });

  it('needs a session', async () => {
    const r = await rig({ start: SUNDAY });
    r.session = '';
    expect((await r.call('GET', '/v1/tonight/overview')).status).toBe(401);
  });

  it('windowNow closes at the club night\'s end plus grace', () => {
    expect(windowNow(Date.parse('2026-10-14T23:30:00Z')).window).toEqual({ open: true, opensInMin: 0, closesInMin: 90 });   // 7:30 pm EDT
    expect(windowNow(Date.parse('2026-10-15T01:30:00Z')).window.open).toBe(false);   // 9:30 pm
  });
});

describe('no child\'s name or id in any new route (names seeded everywhere they can be)', () => {
  it('overview, switches, church, notice, changes', async () => {
    const r = await rig({ env: PROD, kids: KIDS });
    const st = await r.station();
    await r.core.watcher.tick();   // the report: names into tonight's book (sealed), counts into the overview
    await r.core.friends.record({ name: 'Zebedee Quillfeather', club: 'Sparks', clubberId: '7351922', friendName: 'Percival' });
    await r.call('POST', '/v1/desk/checkin', await r.deskBody([st], { clubberId: '7351924' }));
    await st.call('PUT', '/v1/church/settings', { seed: true, settings: { labelFooter: 'KVBC', schedule: [{ club: 'Sparks', startTime: '18:00' }] } });
    await r.call('PUT', '/v1/church/settings', { baseRev: 1, settings: { lateGraceMin: 12 } });
    await r.call('PUT', '/v1/switches', { name: 'CLOUD_PRINT', value: 'off' });
    await r.call('POST', '/v1/notice', { level: 'warn', message: 'Pickup in the gym', durationMin: 15 });
    await r.call('PUT', '/v1/settings', { settings: { showClock: true } });
    const answers = [];
    for (const path of ['/v1/tonight/overview', '/v1/switches', '/v1/church/settings', '/v1/notice', '/v1/changes?limit=50']) {
      const res = await r.call('GET', path);
      expect(res.status).toBe(200);
      answers.push(JSON.stringify(res.body));
    }
    answers.push(JSON.stringify((await r.call('PUT', '/v1/switches', { name: 'CLOUD_PRINT', value: 'on', dryRun: true })).body));
    answers.push(JSON.stringify((await st.call('GET', '/v1/print/next')).body.church));
    const words = plainWords(['Zebedee', 'Quillfeather', 'Ottoline', 'Wrexham', 'Barnaby', 'Fitzgibbon', 'Percival', 'Kit', 'Tester', '7351922', '7351923', '7351924', '662']);
    for (const a of answers) expect(a).not.toMatch(words);
    // The count did see them, so the check is not vacuous.
    expect(JSON.parse(answers[0]).count.checkedIn).toBeGreaterThanOrEqual(3);
  });
});

describe('free plan: no key work in the new modules', () => {
  it('no crypto.subtle, no sealing helper, in any of them', () => {
    for (const f of ['device', 'switches', 'church', 'notice', 'changes', 'overview']) {
      const src = readFileSync(new URL(`../src/${f}.js`, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/crypto\.subtle|subtle\.|from '\.\/crypto\.js'|cloud-crypto|sealState|openState/);
    }
    const shared = readFileSync(new URL('../../shared/churchSettings.js', import.meta.url), 'utf8');
    expect(shared).not.toMatch(/crypto/);
  });
});

// Church settings (routes.md 10.3): the laptop's church-wide printing settings,
// seeded once by a station, edited from the settings page, applied by stations.
import { describe, expect, it } from 'vitest';
import { CHURCH_JSON_MAX } from '../../shared/churchSettings.js';
import { rig } from './rig.js';

const SUNDAY = Date.parse('2026-10-11T16:00:00Z');
const PROD = { CLOUD_PRINT: 'on', SINGLE_PUBLISHER: 'on', YM_CHECKOUT: 'on' };
const LAPTOP = {
  labelFooter: 'Kennebec Valley Baptist Church', trophyBand: true, enableDrivenCheckin: true, lateGraceMin: 10,
  pickupClubs: ['Puggles', 'Cubbies', 'Sparks', 'T&T'], seasonTheme: 'auto', barfNights: ['2026-10-21'],
  schedule: [{ club: 'Sparks', startTime: '18:00', location: 'Gym', room: '4' }],
  printerName: 'DYMO LabelWriter 450', checkinUrl: 'https://kvbc.twotimtwo.com/clubber/checkin',
};
const PAGE = { 'X-Device': 'page_aaaaaaaaaaaaaaaa', 'X-Device-Name': 'Home%20PC' };

async function seeded(env = PROD) {
  const r = await rig({ env, start: SUNDAY });
  const st = await r.station();
  const res = await st.call('PUT', '/v1/church/settings', { seed: true, settings: LAPTOP });
  return { r, st, res };
}

describe('before the seed', () => {
  it('GET answers rev 0 with no settings, the effective switches and their rev', async () => {
    const r = await rig({ env: PROD, start: SUNDAY });
    const res = await r.call('GET', '/v1/church/settings');
    expect(res).toEqual({ status: 200, body: {
      rev: 0, savedAt: null, by: null, seeded: false, paused: false, settings: null, switchesRev: 0,
      switches: { CLOUD_PRINT: 'on', SINGLE_PUBLISHER: 'on', YM_CHECKOUT: 'on', CHURCH_SETTINGS: 'on', NOTICES: 'on', CHANGE_LOG: 'on' },
    } });
  });

  it('an edit is refused not-seeded unless it starts from defaults', async () => {
    const r = await rig({ env: PROD, start: SUNDAY });
    expect(await r.call('PUT', '/v1/church/settings', { baseRev: 0, settings: { trophyBand: false } })).toMatchObject({ status: 409, body: { reason: 'not-seeded' } });
    const d = await r.call('PUT', '/v1/church/settings', { baseRev: 0, fromDefaults: true, settings: { trophyBand: false } }, PAGE);
    expect(d).toMatchObject({ status: 200, body: { ok: true, rev: 1, settings: { trophyBand: false } } });
    expect((await r.call('GET', '/v1/church/settings')).body).toMatchObject({ rev: 1, seeded: false, by: { kind: 'page', name: 'Home PC' } });
    // The station's seed comes too late: the doc exists.
    const st = await r.station();
    expect(await st.call('PUT', '/v1/church/settings', { seed: true, settings: LAPTOP })).toEqual({ status: 200, body: { already: true, rev: 1 } });
  });

  it('starting from defaults with nothing sent makes an empty doc', async () => {
    const r = await rig({ env: PROD, start: SUNDAY });
    expect(await r.call('PUT', '/v1/church/settings', { baseRev: 0, fromDefaults: true, settings: {} })).toMatchObject({ status: 200, body: { rev: 1, settings: {} } });
  });
});

describe('the seed', () => {
  it('first writer wins, only a registered station, only church keys', async () => {
    const { r, st, res } = await seeded();
    expect(res).toEqual({ status: 201, body: { rev: 1 } });
    const g = (await r.call('GET', '/v1/church/settings')).body;
    expect(g).toMatchObject({ rev: 1, seeded: true, by: { kind: 'station', id: 'station-aaaaaaaa', name: 'Desk laptop' } });
    const { printerName, checkinUrl, ...church } = LAPTOP;
    expect(printerName && checkinUrl).toBeTruthy();
    expect(g.settings).toEqual(church);
    expect(r.storage.map.get('church').seededBy).toEqual({ stationId: 'station-aaaaaaaa', name: 'Desk laptop', at: new Date(r.clock.t).toISOString() });
    // A second station (or the same one again) does not overwrite.
    const st2 = await r.station('station-bbbbbbbb', 'Spare laptop');
    expect(await st2.call('PUT', '/v1/church/settings', { seed: true, settings: { trophyBand: false } })).toEqual({ status: 200, body: { already: true, rev: 1 } });
    expect(await st.call('PUT', '/v1/church/settings', { seed: true, settings: {} })).toEqual({ status: 200, body: { already: true, rev: 1 } });
    // Not a station: refused.
    const plain = await rig({ env: PROD, start: SUNDAY });
    expect(await plain.call('PUT', '/v1/church/settings', { seed: true, settings: LAPTOP })).toMatchObject({ status: 403, body: { reason: 'unknown-station' } });
    // Logged, not undoable.
    const e = (await r.call('GET', '/v1/changes')).body.entries.find((x) => x.what === 'church');
    expect(e).toMatchObject({ undoable: false, device: { kind: 'station' } });
    expect(e.keys).toContain('labelFooter');
    expect((await r.call('POST', `/v1/changes/${e.seq}/undo`)).body.reason).toBe('not-undoable');
  });

  it('two seeds at once: one wins', async () => {
    const r = await rig({ env: PROD, start: SUNDAY });
    const a = await r.station();
    const b = await r.station('station-bbbbbbbb', 'Spare');
    const [x, y] = await Promise.all([
      a.call('PUT', '/v1/church/settings', { seed: true, settings: { labelFooter: 'A' } }),
      b.call('PUT', '/v1/church/settings', { seed: true, settings: { labelFooter: 'B' } }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 201]);
    expect(r.storage.map.get('church').rev).toBe(1);
  });
});

describe('editing', () => {
  it('merges the changed keys (null deletes), bumps rev, rings, logs before/after', async () => {
    const { r } = await seeded();
    const frames = r.sent.length;
    const res = await r.call('PUT', '/v1/church/settings', { baseRev: 1, settings: { labelFooter: 'KVBC', pickupClubs: null } }, PAGE);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, rev: 2 });
    expect(res.body.settings.labelFooter).toBe('KVBC');
    expect('pickupClubs' in res.body.settings).toBe(false);
    expect(res.body.settings.lateGraceMin).toBe(10);
    expect(r.sent.slice(frames)).toEqual([{ e: 'changed', d: { what: 'church', rev: 2 } }]);
    const e = (await r.call('GET', '/v1/changes?limit=1')).body.entries[0];
    expect(e).toMatchObject({ what: 'church', keys: ['labelFooter', 'pickupClubs'], before: { labelFooter: 'Kennebec Valley Baptist Church', pickupClubs: ['Puggles', 'Cubbies', 'Sparks', 'T&T'] }, after: { labelFooter: 'KVBC', pickupClubs: null }, undoable: true, device: { kind: 'page' } });
  });

  it('stale baseRev answers 409 with the current doc; nothing changes', async () => {
    const { r } = await seeded();
    await r.call('PUT', '/v1/church/settings', { baseRev: 1, settings: { trophyBand: false } });
    const s = await r.call('PUT', '/v1/church/settings', { baseRev: 1, settings: { trophyBand: true } });
    expect(s).toMatchObject({ status: 409, body: { reason: 'stale', rev: 2, settings: { trophyBand: false } } });
    expect(r.storage.map.get('church').settings.trophyBand).toBe(false);
  });

  it('400 when every key was dropped, 400 without baseRev, dropped named when some were', async () => {
    const { r } = await seeded();
    expect(await r.call('PUT', '/v1/church/settings', { baseRev: 1, settings: { printerName: 'x', lateGraceMin: 'ten' } })).toMatchObject({ status: 400, body: { reason: 'bad-settings', dropped: ['printerName', 'lateGraceMin'] } });
    expect(await r.call('PUT', '/v1/church/settings', { settings: { trophyBand: true } })).toMatchObject({ status: 400, body: { reason: 'bad-rev' } });
    expect(await r.call('PUT', '/v1/church/settings', { baseRev: 1, settings: [] })).toMatchObject({ status: 400 });
    const some = await r.call('PUT', '/v1/church/settings', { baseRev: 1, settings: { trophyBand: false, cupsMedia: 'w' } });
    expect(some).toMatchObject({ status: 200, body: { rev: 2, dropped: ['cupsMedia'] } });
  });

  it('413 over CHURCH_JSON_MAX', async () => {
    const { r } = await seeded();
    const huge = Array.from({ length: 60 }, (_, i) => ({ club: `${i}`.padEnd(30, 'c'), startTime: '18:00', location: 'l'.repeat(40), room: 'r'.repeat(40) }));
    const templates = Object.fromEntries(['default', 'puggles', 'cubbies', 'sparks', 'tnt', 'trek', 'journey'].map((k) => [k, { showIconPanel: false, showLastName: false, showClubLine: false, showGroupLine: false, showVisitorPill: false, showFooter: false, nameMaxPt: 30 }]));
    // A real document stays under the cap (the shared test proves it)...
    const ok = await r.call('PUT', '/v1/church/settings', { baseRev: 1, settings: { schedule: huge, labelTemplates: templates } });
    expect(ok.status).toBe(200);
    expect(new TextEncoder().encode(JSON.stringify(ok.body.settings)).length).toBeLessThan(CHURCH_JSON_MAX);
    // ...so a lower cap stands in for the refusal, edit and seed alike.
    r.core.church.max = 2000;
    expect(await r.call('PUT', '/v1/church/settings', { baseRev: 2, settings: { labelFooter: 'x' } })).toMatchObject({ status: 413, body: { reason: 'too-big' } });
    expect(r.storage.map.get('church').rev).toBe(2);
    const fresh = await rig({ env: PROD, start: SUNDAY });
    const st = await fresh.station();
    fresh.core.church.max = 100;
    expect(await st.call('PUT', '/v1/church/settings', { seed: true, settings: LAPTOP })).toMatchObject({ status: 413 });
    expect(fresh.storage.map.has('church')).toBe(false);
  });

  it('the same values again write nothing', async () => {
    const { r } = await seeded();
    const same = await r.call('PUT', '/v1/church/settings', { baseRev: 1, settings: { trophyBand: true } });
    expect(same.body).toMatchObject({ ok: true, rev: 1 });
  });

  it('CHURCH_SETTINGS off: paused, every write 503; GET still answers', async () => {
    const { r, st } = await seeded();
    await r.call('PUT', '/v1/switches', { name: 'CHURCH_SETTINGS', value: 'off' });
    expect((await r.call('GET', '/v1/church/settings')).body).toMatchObject({ paused: true, rev: 1, switches: { CHURCH_SETTINGS: 'off' }, switchesRev: 1 });
    expect(await r.call('PUT', '/v1/church/settings', { baseRev: 1, settings: { trophyBand: false } })).toMatchObject({ status: 503, body: { reason: 'church-off' } });
    expect(await st.call('PUT', '/v1/church/settings', { seed: true, settings: {} })).toMatchObject({ status: 503, body: { reason: 'church-off' } });
  });
});

describe('the remembered leaders (church key `leaders`)', () => {
  it('seeded with the laptop\'s leaders.json, remembered and forgotten from any phone, each change logged', async () => {
    const r = await rig({ env: PROD, start: SUNDAY });
    const st = await r.station();
    const ann = { firstName: 'Ann', lastName: 'Leader', clubName: 'Sparks', lastPrintedAt: 1760000000000, printCount: 4 };
    await st.call('PUT', '/v1/church/settings', { seed: true, settings: { ...LAPTOP, leaders: [ann] } });
    expect((await r.call('GET', '/v1/church/settings')).body.settings.leaders).toEqual([ann]);
    // A phone remembers a new leader: the whole list, newest first, with baseRev.
    const bo = { firstName: 'Bo', lastName: 'Helper', clubName: '', lastPrintedAt: 1760000500000, printCount: 1, phone: '555' };
    const put = await r.call('PUT', '/v1/church/settings', { baseRev: 1, settings: { leaders: [bo, ann] } }, PAGE);
    expect(put.body.settings.leaders).toEqual([{ firstName: 'Bo', lastName: 'Helper', clubName: '', lastPrintedAt: 1760000500000, printCount: 1 }, ann]);
    const e = (await r.call('GET', '/v1/changes?limit=1')).body.entries[0];
    expect(e).toMatchObject({ what: 'church', keys: ['leaders'], undoable: true, device: { kind: 'page' } });
    // Forget Ann.
    await r.call('PUT', '/v1/church/settings', { baseRev: 2, settings: { leaders: put.body.settings.leaders.slice(0, 1) } });
    expect(r.storage.map.get('church').settings.leaders.map((l) => l.firstName)).toEqual(['Bo']);
    // Undo the forget: Ann is back.
    const seq = (await r.call('GET', '/v1/changes?limit=1')).body.entries[0].seq;
    expect((await r.call('POST', `/v1/changes/${seq}/undo`)).status).toBe(200);
    expect(r.storage.map.get('church').settings.leaders.map((l) => l.firstName)).toEqual(['Bo', 'Ann']);
  });

  it('a full list of 80 leaders (the cap) fits, and its change log entry stays under 2 KB (before in logv)', async () => {
    const { r } = await seeded();
    const leaders = Array.from({ length: 80 }, (_, i) => ({ firstName: `Leader${i}`, lastName: 'Volunteer', clubName: 'T&T', lastPrintedAt: 1760000000000 + i, printCount: 2 }));
    expect((await r.call('PUT', '/v1/church/settings', { baseRev: 1, settings: { leaders } })).status).toBe(200);
    expect((await r.call('PUT', '/v1/church/settings', { baseRev: 2, settings: { leaders: leaders.slice(1) } })).status).toBe(200);
    const e = (await r.call('GET', '/v1/changes?limit=1')).body.entries[0];
    expect(e.bigBefore).toBe(true);
    expect(e.after).toBeNull();
    expect(new TextEncoder().encode(JSON.stringify(e)).length).toBeLessThanOrEqual(2048);
    expect((await r.call('POST', `/v1/changes/${e.seq}/undo`)).status).toBe(200);
    expect(r.storage.map.get('church').settings.leaders).toHaveLength(80);
  });
});

describe('the station learns of a change from GET /v1/print/next', () => {
  it('church: {rev, switchesRev}, moving with each edit and each flip', async () => {
    const { r, st } = await seeded();
    expect((await st.call('GET', '/v1/print/next')).body).toMatchObject({ jobs: [], church: { rev: 1, switchesRev: 0 } });
    await r.call('PUT', '/v1/church/settings', { baseRev: 1, settings: { lateGraceMin: 15 } });
    await r.call('PUT', '/v1/switches', { name: 'SINGLE_PUBLISHER', value: 'off' });
    expect((await st.call('GET', '/v1/print/next')).body.church).toEqual({ rev: 2, switchesRev: 1 });
  });
});

describe('undo a church change', () => {
  it('happy, changed-since, and church-off', async () => {
    const { r } = await seeded();
    await r.call('PUT', '/v1/church/settings', { baseRev: 1, settings: { labelFooter: 'KVBC', barfNights: null } });
    const seq = (await r.call('GET', '/v1/changes?limit=1')).body.entries[0].seq;
    expect((await r.call('POST', `/v1/changes/${seq}/undo`, undefined, PAGE)).status).toBe(200);
    const s = r.storage.map.get('church');
    expect(s.rev).toBe(3);
    expect(s.settings.labelFooter).toBe('Kennebec Valley Baptist Church');
    expect(s.settings.barfNights).toEqual(['2026-10-21']);
    expect((await r.call('GET', '/v1/changes?limit=1')).body.entries[0]).toMatchObject({ what: 'church', undoOf: seq });

    await r.call('PUT', '/v1/church/settings', { baseRev: 3, settings: { lateGraceMin: 20 } });
    const seq2 = (await r.call('GET', '/v1/changes?limit=1')).body.entries[0].seq;
    await r.call('PUT', '/v1/church/settings', { baseRev: 4, settings: { lateGraceMin: 25 } });
    expect(await r.call('POST', `/v1/changes/${seq2}/undo`)).toMatchObject({ status: 409, body: { reason: 'changed-since', keys: ['lateGraceMin'] } });

    const seq3 = (await r.call('GET', '/v1/changes?limit=1')).body.entries[0].seq;
    await r.call('PUT', '/v1/switches', { name: 'CHURCH_SETTINGS', value: 'off' });
    expect(await r.call('POST', `/v1/changes/${seq3}/undo`)).toMatchObject({ status: 503, body: { reason: 'church-off' } });
  });
});

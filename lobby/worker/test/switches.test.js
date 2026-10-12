// The runtime switches (routes.md 10.2): wrangler.toml's values are the defaults,
// a stored switch overrides one from the settings page, and every module reads the
// effective value within the same request.
import { describe, expect, it } from 'vitest';
import { SWITCH_NAMES, olderThan, switchWarnings } from '../src/switches.js';
import { SEEN_WRITE_MS } from '../src/stations.js';
import { rig } from './rig.js';

// Production today (wrangler.toml): all three online switches on.
const PROD = { CLOUD_PRINT: 'on', SINGLE_PUBLISHER: 'on', YM_CHECKOUT: 'on', SWITCHES_STORED: 'on' };
const SUNDAY = Date.parse('2026-10-11T16:00:00Z');   // no watch window
const PAGE = { 'X-Device': 'page_aaaaaaaaaaaaaaaa', 'X-Device-Name': 'Home%20PC' };

const valueOf = (body, name) => body.switches.find((s) => s.name === name);

describe('defaults', () => {
  it('follow wrangler.toml; with nothing stored nothing changes behaviour', async () => {
    const r = await rig({ env: PROD, start: SUNDAY });
    const res = await r.call('GET', '/v1/switches');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rev: 0, updatedAt: null, by: null, stored: true, stations: [] });
    expect(res.body.switches.map((s) => s.name)).toEqual([...SWITCH_NAMES]);
    for (const name of ['CLOUD_PRINT', 'SINGLE_PUBLISHER', 'YM_CHECKOUT']) {
      expect(valueOf(res.body, name)).toEqual({ name, group: 'online', value: 'on', default: 'on', source: 'default' });
    }
    for (const name of ['CHURCH_SETTINGS', 'NOTICES', 'CHANGE_LOG']) {
      expect(valueOf(res.body, name)).toEqual({ name, group: 'safety', value: 'on', default: 'on', source: 'default' });
    }
    expect(r.core.adopt.on).toBe(true);
    expect(r.core.singlePublisher).toBe(true);
    expect(r.core.ym.enabled).toBe(true);
  });

  it('an unset online var is off, an odd value is its fallback, a set safety var is honoured', async () => {
    const r = await rig({ env: { CLOUD_PRINT: undefined, SINGLE_PUBLISHER: 'shadow', NOTICES: 'off' }, start: SUNDAY });
    const b = (await r.call('GET', '/v1/switches')).body;
    expect(valueOf(b, 'CLOUD_PRINT').value).toBe('off');
    expect(valueOf(b, 'SINGLE_PUBLISHER').value).toBe('off');
    expect(valueOf(b, 'NOTICES')).toMatchObject({ value: 'off', default: 'off' });
    expect(r.core.adopt.on).toBe(false);
  });
});

describe('PUT /v1/switches', () => {
  it('a flip changes adopt.on / singlePublisher / ym.enabled in the same request, rings, and logs', async () => {
    const r = await rig({ env: PROD, start: SUNDAY });
    const frames = r.sent.length;
    const a = await r.call('PUT', '/v1/switches', { name: 'CLOUD_PRINT', value: 'off', rev: 0 }, PAGE);
    expect(a).toMatchObject({ status: 200, body: { ok: true, rev: 1, switch: { name: 'CLOUD_PRINT', value: 'off', default: 'on', source: 'worker' } } });
    expect(r.core.adopt.on).toBe(false);
    await r.call('PUT', '/v1/switches', { name: 'SINGLE_PUBLISHER', value: 'off' });
    expect(r.core.singlePublisher).toBe(false);
    expect(r.core.publisher.enabled()).toBe(false);
    await r.call('PUT', '/v1/switches', { name: 'YM_CHECKOUT', value: 'off' });
    expect(r.core.ym.enabled).toBe(false);
    expect(r.sent.slice(frames)).toEqual([1, 2, 3].map((rev) => ({ e: 'changed', d: { what: 'switches', rev } })));
    const stored = r.storage.map.get('switches');
    expect(stored).toMatchObject({ v: 1, rev: 3, values: { CLOUD_PRINT: 'off', SINGLE_PUBLISHER: 'off', YM_CHECKOUT: 'off' } });
    const log = (await r.call('GET', '/v1/changes')).body.entries;
    expect(log.at(-1)).toMatchObject({ what: 'switch', target: 'CLOUD_PRINT', keys: ['CLOUD_PRINT'], before: { CLOUD_PRINT: null }, after: { CLOUD_PRINT: 'off' }, undoable: true, device: { kind: 'page', name: 'Home PC' } });
    const g = (await r.call('GET', '/v1/switches')).body;
    expect(g.by).toEqual({ kind: 'unknown', name: 'Unknown device' });
    expect(g.updatedAt).toBe(new Date(r.clock.t).toISOString());
  });

  it('default deletes the stored value; the same value again writes nothing', async () => {
    const r = await rig({ env: PROD, start: SUNDAY });
    await r.call('PUT', '/v1/switches', { name: 'CLOUD_PRINT', value: 'off' });
    const again = await r.call('PUT', '/v1/switches', { name: 'CLOUD_PRINT', value: 'off' });
    expect(again.body).toMatchObject({ ok: true, rev: 1, warnings: [] });
    const back = await r.call('PUT', '/v1/switches', { name: 'CLOUD_PRINT', value: 'default' });
    expect(back.body).toMatchObject({ rev: 2, switch: { value: 'on', source: 'default' } });
    expect(r.storage.map.get('switches').values).toEqual({});
    expect(r.core.adopt.on).toBe(true);
  });

  it('refuses a bad name, a bad value and a stale rev', async () => {
    const r = await rig({ env: PROD, start: SUNDAY });
    expect(await r.call('PUT', '/v1/switches', { name: 'PANIC', value: 'on' })).toMatchObject({ status: 400, body: { reason: 'bad-name' } });
    expect(await r.call('PUT', '/v1/switches', { name: 'NOTICES', value: 'yes' })).toMatchObject({ status: 400, body: { reason: 'bad-value' } });
    await r.call('PUT', '/v1/switches', { name: 'NOTICES', value: 'off' });
    expect(await r.call('PUT', '/v1/switches', { name: 'NOTICES', value: 'on', rev: 0 })).toMatchObject({ status: 409, body: { reason: 'stale', rev: 1 } });
    expect(r.core.switches.value('NOTICES')).toBe('off');
    r.session = '';
    expect((await r.call('GET', '/v1/switches')).status).toBe(401);
    expect((await r.call('PUT', '/v1/switches', { name: 'NOTICES', value: 'on' })).status).toBe(401);
  });

  it('SWITCHES_STORED off: defaults only, and a PUT is refused', async () => {
    const r = await rig({ env: PROD, start: SUNDAY });
    await r.call('PUT', '/v1/switches', { name: 'CLOUD_PRINT', value: 'off' });
    r.core = new (r.core.constructor)({ storage: r.storage, env: { ...r.core.rawEnv, SWITCHES_STORED: 'off' }, now: r.clock.now, broadcast: () => 1 });
    const g = (await r.call('GET', '/v1/switches')).body;
    expect(g.stored).toBe(false);
    expect(valueOf(g, 'CLOUD_PRINT')).toMatchObject({ value: 'on', source: 'default' });
    expect(r.core.adopt.on).toBe(true);
    expect(await r.call('PUT', '/v1/switches', { name: 'CLOUD_PRINT', value: 'off' })).toMatchObject({ status: 409, body: { reason: 'stored-off' } });
  });

  it('a restarted object reloads the stored switches before its first alarm reads them', async () => {
    const r = await rig({ env: PROD });
    await r.call('PUT', '/v1/switches', { name: 'CLOUD_PRINT', value: 'off' });
    r.restart();
    expect(r.core.switches.doc.data).toBeNull();
    let seenInTick = null;
    const tick = r.core.watcher.tick.bind(r.core.watcher);
    r.core.watcher.tick = async () => { seenInTick = r.core.adopt.on; return tick(); };
    await r.core.alarm();
    expect(seenInTick).toBe(false);
    r.restart();
    await r.core.cron().catch(() => {});
    expect(r.core.adopt.on).toBe(false);
  });
});

describe('warnings', () => {
  it('olderThan', () => {
    expect(olderThan('9.2.1', '9.3.0')).toBe(true);
    expect(olderThan('9.3.0', '9.3.0')).toBe(false);
    expect(olderThan('10.0.0', '9.3.0')).toBe(false);
    expect(olderThan(undefined, '9.3.0')).toBe(true);
    expect(olderThan('9.3', '9.3.0')).toBe(true);
  });

  it('no-station, station-old, window-open and ym-tab-reload; a dry run writes nothing', async () => {
    const r = await rig({ env: PROD });   // Wednesday 6 pm: the watch window is open
    const dry = await r.call('PUT', '/v1/switches', { name: 'SINGLE_PUBLISHER', value: 'off', dryRun: true });
    expect(dry.body).toMatchObject({ ok: true, dryRun: true, rev: 0, switch: { value: 'off' }, warnings: ['no-station', 'window-open'] });
    expect(r.core.switches.value('SINGLE_PUBLISHER')).toBe('on');
    expect(r.storage.map.has('switches')).toBe(false);
    const st = await r.station();
    await st.call('POST', '/v1/print/heartbeat', { printer: { state: 'ok' } });   // a 9.2.x station: no version
    expect((await r.call('PUT', '/v1/switches', { name: 'SINGLE_PUBLISHER', value: 'off', dryRun: true })).body.warnings).toEqual(['station-old', 'window-open']);
    expect((await r.call('PUT', '/v1/switches', { name: 'CLOUD_PRINT', value: 'off', dryRun: true })).body.warnings).toEqual(['window-open']);
    await st.call('POST', '/v1/print/heartbeat', { version: '9.3.0', churchRev: 4 });
    const ym = await r.call('PUT', '/v1/switches', { name: 'YM_CHECKOUT', value: 'off' });
    expect(ym.body.warnings).toEqual(['window-open', 'ym-tab-reload']);
    // Turning it back on needs no tab reload; no change, no warning.
    expect((await r.call('PUT', '/v1/switches', { name: 'YM_CHECKOUT', value: 'on', dryRun: true })).body.warnings).toEqual(['window-open']);
    expect((await r.call('PUT', '/v1/switches', { name: 'YM_CHECKOUT', value: 'off', dryRun: true })).body.warnings).toEqual([]);
    // Two minutes of silence: no station.
    r.clock.tick(3 * 60 * 1000);
    expect(switchWarnings('CLOUD_PRINT', 'on', 'off', [{ lastSeenAt: new Date(r.clock.t - 3 * 60 * 1000).toISOString() }], r.clock.t)).toContain('no-station');
  });
});

describe('the station reports its version and applied church rev', () => {
  it('kept on the station record and listed; a changed value forces the write', async () => {
    const r = await rig({ env: PROD, start: SUNDAY });
    const st = await r.station();
    await st.call('POST', '/v1/print/heartbeat', { version: '9.3.0', churchRev: 2 });
    expect((await r.call('GET', '/v1/switches')).body.stations).toEqual([{ stationId: 'station-aaaaaaaa', name: 'Desk laptop', lastSeenAt: new Date(r.clock.t).toISOString(), version: '9.3.0', churchRev: 2 }]);
    r.clock.tick(5000);   // inside SEEN_WRITE_MS: only a changed value writes
    await st.call('POST', '/v1/print/heartbeat', { churchRev: 3 });
    expect(r.storage.map.get('stations').list[0]).toMatchObject({ version: '9.3.0', churchRev: 3 });
    await st.call('POST', '/v1/print/heartbeat', { version: 'nine', churchRev: -1 });
    expect(r.storage.map.get('stations').list[0]).toMatchObject({ version: '9.3.0', churchRev: 3 });
    expect(SEEN_WRITE_MS).toBeGreaterThan(5000);
    // Re-registering keeps them.
    await r.call('POST', '/v1/station/register', st.body);
    expect(r.storage.map.get('stations').list[0]).toMatchObject({ version: '9.3.0', churchRev: 3 });
  });
});

describe('undo a switch', () => {
  it('back to what it was, unless it moved since', async () => {
    const r = await rig({ env: PROD, start: SUNDAY });
    await r.call('PUT', '/v1/switches', { name: 'CLOUD_PRINT', value: 'off' });
    const seq = (await r.call('GET', '/v1/changes?limit=1')).body.entries[0].seq;
    expect((await r.call('POST', `/v1/changes/${seq}/undo`)).status).toBe(200);
    expect(r.core.switches.storedOf('CLOUD_PRINT')).toBeNull();
    expect(r.core.adopt.on).toBe(true);
    await r.call('PUT', '/v1/switches', { name: 'NOTICES', value: 'off' });
    await r.call('PUT', '/v1/switches', { name: 'NOTICES', value: 'on' });
    const first = (await r.call('GET', '/v1/changes?limit=2')).body.entries[1].seq;
    expect(await r.call('POST', `/v1/changes/${first}/undo`)).toMatchObject({ status: 409, body: { reason: 'changed-since', keys: ['NOTICES'] } });
  });
});

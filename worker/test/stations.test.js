// The registered print stations (stations.js).
import { describe, expect, it } from 'vitest';
import { STATIONS_MAX, Stations, cleanPrinter } from '../src/stations.js';
import { fakeClock, makeStation, memoryStore, sealJob } from './helpers.js';

function setup() {
  const clock = fakeClock();
  const storage = memoryStore();
  return { clock, storage, stations: new Stations({ storage, now: clock.now }) };
}

describe('registering a station (no pairing step)', () => {
  it('stores the key and lists it', async () => {
    const { stations } = setup();
    const a = await makeStation();
    const r = await stations.register(a.body);
    expect(r).toMatchObject({ ok: true, stations: 1, station: { stationId: a.body.stationId, kid: a.kid, lastSeenAt: null } });
    const list = await stations.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Desk laptop', pub: a.pub, printer: null });
  });

  it('the same station id replaces its own key, keeping when it first registered', async () => {
    const { stations, clock } = setup();
    const a = await makeStation();
    const first = await stations.register(a.body);
    clock.tick(60000);
    const b = await makeStation(a.body.stationId, 'Renamed');
    const second = await stations.register(b.body);
    expect(second.station.registeredAt).toBe(first.station.registeredAt);
    expect((await stations.list())).toHaveLength(1);
    expect((await stations.list())[0]).toMatchObject({ kid: b.kid, name: 'Renamed' });
  });

  it('refuses a bad id, a key that is not P-256, a kid that does not match, a shared key', async () => {
    const { stations } = setup();
    const a = await makeStation();
    expect((await stations.register({ ...a.body, stationId: 'x' })).status).toBe(400);
    expect((await stations.register({ ...a.body, pub: 'AAAA' })).status).toBe(400);
    expect((await stations.register({ ...a.body, kid: '0000000000000000' })).status).toBe(400);
    await stations.register(a.body);
    expect((await stations.register({ ...a.body, stationId: 'station-bbbbbbbb' })).status).toBe(409);
  });

  it('holds at most STATIONS_MAX', async () => {
    const { stations } = setup();
    for (let i = 0; i < STATIONS_MAX; i++) {
      expect((await stations.register((await makeStation(`station-${String(i).padStart(8, '0')}`)).body)).ok).toBe(true);
    }
    expect((await stations.register((await makeStation('station-overflow')).body)).status).toBe(409);
  });

  it('revokes a dead computer, and a restarted object still knows who is left', async () => {
    const { stations, storage, clock } = setup();
    const a = await makeStation('station-aaaaaaaa');
    const b = await makeStation('station-bbbbbbbb');
    await stations.register(a.body);
    await stations.register(b.body);
    expect(await stations.revoke('station-aaaaaaaa')).toMatchObject({ ok: true, stations: 1 });
    expect((await stations.revoke('station-aaaaaaaa')).ok).toBe(false);
    const again = new Stations({ storage, now: clock.now });
    expect((await again.list()).map((s) => s.stationId)).toEqual(['station-bbbbbbbb']);
  });

  it('keeps no name of a child and no private key: only what a station sends', async () => {
    const { stations, storage } = setup();
    await stations.register((await makeStation()).body);
    expect(JSON.stringify([...storage.map.entries()])).not.toMatch(/"d":|privateJwk/);
  });
});

describe('heartbeat bookkeeping', () => {
  it('notes lastSeenAt and the printer, writing through at most once a minute', async () => {
    const { stations, clock, storage } = setup();
    await stations.register((await makeStation()).body);
    let puts = 0;
    const put = storage.put;
    storage.put = async (...a) => { puts += 1; return put(...a); };
    await stations.touch('station-aaaaaaaa', { state: 'ok' });      // printer changed: a write
    await stations.touch('station-aaaaaaaa', { state: 'ok' });      // nothing new
    clock.tick(30000);
    await stations.touch('station-aaaaaaaa', { state: 'ok' });
    expect(puts).toBe(1);
    clock.tick(31000);
    await stations.touch('station-aaaaaaaa', { state: 'paper', detail: 'Out of labels' });
    expect(puts).toBe(2);
    expect((await stations.list())[0]).toMatchObject({ printer: { state: 'paper', detail: 'Out of labels' } });
    expect(await stations.touch('station-nope0000')).toBe(false);
  });

  it('keeps a printer report to fixed words and a short plain detail', () => {
    expect(cleanPrinter({ state: 'exploding', detail: 'x'.repeat(200) })).toEqual({ state: 'unknown', detail: 'x'.repeat(80) });
    expect(cleanPrinter('nope')).toBeNull();
  });
});

describe('checking a bundle against the stations', () => {
  it('passes a bundle sealed to every station, and only that', async () => {
    const { stations } = setup();
    const a = await makeStation('station-aaaaaaaa');
    const b = await makeStation('station-bbbbbbbb');
    await stations.register(a.body);
    await stations.register(b.body);
    await stations.load();
    const both = await sealJob([a, b], { name: 'x' });
    expect(stations.checkBundle(both.bundle, { night: '2026-10-14', kind: 'print-job', id: both.id })).toEqual({ ok: true });
    const onlyA = await sealJob([a], { name: 'x' });
    expect(stations.checkBundle(onlyA.bundle, { night: '2026-10-14', kind: 'print-job' })).toMatchObject({ ok: false, reason: 'stations-changed', status: 409 });
    const c = await makeStation('station-cccccccc');
    const withStranger = await sealJob([a, b, c], { name: 'x' });
    expect(stations.checkBundle(withStranger.bundle, { night: '2026-10-14', kind: 'print-job' })).toMatchObject({ reason: 'stations-changed' });
  });

  it('fails closed on anything that is not a bundle', async () => {
    const { stations } = setup();
    const a = await makeStation();
    await stations.register(a.body);
    await stations.load();
    const good = await sealJob([a], { name: 'x' });
    const expectJob = { night: '2026-10-14', kind: 'print-job' };
    expect(stations.checkBundle(null, expectJob).reason).toBe('unsealed');
    expect(stations.checkBundle({ ...good.bundle, night: '2026-10-15' }, expectJob).reason).toBe('unsealed');
    expect(stations.checkBundle({ ...good.bundle, kind: 'roster' }, expectJob).reason).toBe('unsealed');
    expect(stations.checkBundle({ ...good.bundle, to: [] }, expectJob).reason).toBe('unsealed');
    expect(stations.checkBundle({ ...good.bundle, to: [{ ...good.bundle.to[0], ct: 'AAAA' }] }, expectJob).reason).toBe('unsealed');
    expect(stations.checkBundle({ ...good.bundle, to: [good.bundle.to[0], good.bundle.to[0]] }, expectJob).reason).toBe('unsealed');
  });

  it('says no-stations when none are registered', async () => {
    const { stations } = setup();
    await stations.load();
    expect(stations.checkBundle({}, { night: '2026-10-14', kind: 'print-job' }).reason).toBe('no-stations');
  });
});

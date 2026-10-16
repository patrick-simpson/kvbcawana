// Online check-in P6: the Worker's history routes against a D1 stand-in that
// runs the real migrations (d1stub.js). The Worker never decrypts, so every
// seal and open here is the CLIENT's (shared/cloud-crypto.js).
import { beforeAll, describe, expect, it } from 'vitest';
import { History, validWrapped } from '../src/history.js';
import {
  createHistoryKey, keyRing, newRowId, openRow, rewrapPrivateKey, sealRow, unwrapPrivateKey,
} from '../../shared/cloud-crypto.js';
import { d1Stub } from './d1stub.js';

const NIGHT = '2026-10-14';
const PASS = 'kennebec river';
const NEW_PASS = 'a brand new word';

function memoryStorage() {
  const map = new Map();
  return {
    map,
    get: async (k) => (map.has(k) ? structuredClone(map.get(k)) : undefined),
    put: async (k, v) => {
      if (typeof k === 'object') for (const [a, b] of Object.entries(k)) map.set(a, structuredClone(b));
      else map.set(k, structuredClone(v));
    },
    delete: async (k) => map.delete(k),
    list: async ({ prefix = '', limit = Infinity } = {}) => new Map([...map].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, limit).map(([k, v]) => [k, structuredClone(v)])),
  };
}

let key;   // one key for the file: PBKDF2 is slow on purpose
beforeAll(async () => { key = await createHistoryKey(PASS); }, 60000);

async function setup({ db = d1Stub(), withKey = true } = {}) {
  const storage = memoryStorage();
  const env = db ? { HISTORY_DB: db } : {};
  const history = new History({ storage, env, now: () => Date.parse('2026-10-14T23:00:00Z') });
  const call = async (method, path, body) => {
    const url = new URL(`https://sync.test${path}`);
    const res = await history.handle(new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) }), url);
    return { status: res.status, body: await res.json() };
  };
  if (withKey) expect((await call('PUT', '/v1/history/key', { pub: key.pub, kid: key.kid, wrapped: key.wrapped })).status).toBe(201);
  return { history, storage, db, env, call };
}

async function sealed(record, { night = NIGHT, kind = 'checkin' } = {}) {
  const id = newRowId();
  const seal = await sealRow(key.pub, { id, night, kind, record });
  return { id, night, kind, ...seal };
}

describe('the history key', () => {
  it('first writer wins: 201, then 200 for the same key, 409 for another', async () => {
    const { call } = await setup({ withKey: false });
    expect((await call('GET', '/v1/history/key')).status).toBe(404);
    const body = { pub: key.pub, kid: key.kid, wrapped: key.wrapped };
    expect((await call('PUT', '/v1/history/key', body)).status).toBe(201);
    expect((await call('PUT', '/v1/history/key', body)).status).toBe(200);
    const other = await call('PUT', '/v1/history/key', { ...body, pub: `${'B'.repeat(86)}==`, kid: '0'.repeat(16) });
    expect([400, 409]).toContain(other.status);
    const got = await call('GET', '/v1/history/key');
    expect(got.body).toMatchObject({ pub: key.pub, kid: key.kid, prev: null });
    expect(validWrapped(got.body.wrapped)).toBe(true);
  });

  it('refuses a kid that is not the key\'s hash, and a malformed wrap', async () => {
    const { call } = await setup({ withKey: false });
    expect((await call('PUT', '/v1/history/key', { pub: key.pub, kid: '0'.repeat(16), wrapped: key.wrapped })).status).toBe(400);
    expect((await call('PUT', '/v1/history/key', { pub: key.pub, kid: key.kid, wrapped: { ...key.wrapped, iter: 5 } })).status).toBe(400);
  });
});

describe('rows go in sealed, and only sealed', () => {
  it('stores rows and counts, and never a plaintext name (asserted on the stored bytes)', async () => {
    const { call, db, storage } = await setup();
    const rows = [await sealed({ first: 'Zebediah', last: 'Quillfeather', club: 'Sparks', ts: 1 }), await sealed({ first: 'Marigold', last: 'Thistlewick', club: 'T&T', ts: 2 }, { kind: 'checkout' })];
    const summary = [{ night: NIGHT, club: 'Sparks', checkedIn: 1, checkedOut: 0, undone: 0, prints: 1 }];
    const res = await call('POST', '/v1/history/rows', { rows, summary });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stored: 2, duplicates: 0, pending: 0 });
    const everything = db.dump() + JSON.stringify([...storage.map]);
    for (const name of ['Zebediah', 'Quillfeather', 'Marigold', 'Thistlewick']) expect(everything).not.toContain(name);
    expect(db.query('SELECT COUNT(*) AS n FROM history_rows')[0].n).toBe(2);
    expect(db.query('SELECT checked_in AS c FROM night_summary WHERE club = ?', 'Sparks')[0].c).toBe(1);
  });

  it('refuses a plaintext row, a smuggled field, a wrong size or a wrong kid, storing NOTHING', async () => {
    const { call, db, storage } = await setup();
    const good = await sealed({ ts: 1 });
    const bad = [
      { ...good, ct: 'AAAA' },
      { ...good, kid: '0'.repeat(16) },
      { ...good, night: '2026-13-40' },
      { ...good, kind: 'Check In' },
      { id: good.id, night: NIGHT, kind: 'checkin', first: 'Ada', last: 'Lovelace' },
    ];
    for (const row of bad) {
      const res = await call('POST', '/v1/history/rows', { rows: [good, row] });
      expect(res.status, JSON.stringify(row).slice(0, 60)).toBe(400);
      expect(res.body.reason).toBe('unsealed');
    }
    expect(db.query('SELECT COUNT(*) AS n FROM history_rows')[0].n).toBe(0);
    expect([...storage.map.keys()].filter((k) => k.startsWith('hout:'))).toEqual([]);
    // extra plaintext fields on an otherwise valid row are dropped, never stored
    await call('POST', '/v1/history/rows', { rows: [{ ...good, first: 'Smuggled', note: 'Secretname' }] });
    expect(db.dump()).not.toContain('Smuggled');
    expect(db.dump()).not.toContain('Secretname');
  });

  it('a retried batch is harmless: rows once, the summary counted once', async () => {
    const { call, db } = await setup();
    const rows = [await sealed({ ts: 1 })];
    const body = { rows, summary: [{ night: NIGHT, club: 'Sparks', checkedIn: 3, checkedOut: 0, undone: 0, prints: 0 }] };
    expect((await call('POST', '/v1/history/rows', body)).status).toBe(200);
    const again = await call('POST', '/v1/history/rows', body);
    expect(again.body.duplicates).toBe(1);
    expect(db.query('SELECT COUNT(*) AS n FROM history_rows')[0].n).toBe(1);
    expect(db.query('SELECT checked_in AS c FROM night_summary')[0].c).toBe(3);
  });

  it('needs a history key first, and caps a batch', async () => {
    const { call } = await setup({ withKey: false });
    expect((await call('POST', '/v1/history/rows', { rows: [] })).status).toBe(409);
    const { call: call2 } = await setup();
    const one = await sealed({ ts: 1 });
    expect((await call2('POST', '/v1/history/rows', { rows: Array(101).fill(one) })).status).toBe(400);
  });
});

describe('D1 down, or not there yet', () => {
  it('the outbox survives a D1 outage and drains when D1 is back', async () => {
    const { call, db, history, storage } = await setup();
    db.down = true;
    const rows = [await sealed({ first: 'Pending', ts: 1 }), await sealed({ ts: 2 })];
    const res = await call('POST', '/v1/history/rows', { rows, summary: [{ night: NIGHT, club: 'Sparks', checkedIn: 2, checkedOut: 0, undone: 0, prints: 0 }] });
    expect(res.status).toBe(202);          // accepted, not an error: check-in never waits on D1
    expect(res.body.pending).toBe(1);
    expect([...storage.map.keys()].filter((k) => k.startsWith('hout:'))).toHaveLength(1);
    expect((await call('GET', `/v1/history/rows?night=${NIGHT}`)).status).toBe(500);   // reads fail honestly, writes never blocked
    db.down = false;
    const flushed = await history.flush();
    expect(flushed.pending).toBe(0);
    expect(db.query('SELECT COUNT(*) AS n FROM history_rows')[0].n).toBe(2);
    expect(db.query('SELECT checked_in AS c FROM night_summary')[0].c).toBe(2);
    expect((await call('GET', `/v1/history/rows?night=${NIGHT}`)).body.rows).toHaveLength(2);
  });

  it('a crash between the D1 write and the outbox delete does not double count', async () => {
    const { call, db, history, storage } = await setup();
    const body = { rows: [await sealed({ ts: 1 })], summary: [{ night: NIGHT, club: 'Sparks', checkedIn: 1, checkedOut: 0, undone: 0, prints: 0 }] };
    await call('POST', '/v1/history/rows', body);
    // The outbox is empty now; put the same entry back, as if the delete after the D1 write was lost.
    const id = db.query('SELECT id FROM applied_batches')[0].id;
    await storage.put(`hout:${id}`, { id, rows: body.rows, summary: body.summary });
    await history.flush();
    expect(db.query('SELECT checked_in AS c FROM night_summary')[0].c).toBe(1);
    expect([...storage.map.keys()].filter((n) => n.startsWith('hout:'))).toEqual([]);
  });

  it('without HISTORY_DB the outbox just holds the rows, and the routes say so', async () => {
    const { call, storage } = await setup({ db: null });
    const res = await call('POST', '/v1/history/rows', { rows: [await sealed({ ts: 1 })] });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ reason: 'history-off', queued: 1, pending: 1 });
    expect(res.body.message).toMatch(/not set up/);
    expect([...storage.map.keys()].some((k) => k.startsWith('hout:'))).toBe(true);
    for (const path of [`/v1/history/rows?night=${NIGHT}`, '/v1/history/nights', '/v1/history/summary']) {
      const r = await call('GET', path);
      expect(r.status).toBe(503);
      expect(r.body.reason).toBe('history-off');
    }
    expect((await call('GET', '/v1/history/status')).body).toEqual({ db: false, pending: 1 });
  });
});

describe('reading back, and the client opens it', () => {
  it('lists nights and rows, pages with after/next, and a client opens every row', async () => {
    const { call } = await setup();
    const records = [];
    const rows = [];
    for (let i = 0; i < 5; i++) { const rec = { first: `Kid${i}`, club: 'Sparks', ts: 1000 + i }; records.push(rec); rows.push(await sealed(rec)); }
    rows.push(await sealed({ ts: 5 }, { night: '2026-10-07' }));
    await call('POST', '/v1/history/rows', { rows, summary: [
      { night: NIGHT, club: 'Sparks', checkedIn: 5, checkedOut: 4, undone: 0, prints: 5 },
      { night: '2026-10-07', club: 'Sparks', checkedIn: 1, checkedOut: 1, undone: 0, prints: 1 },
    ] });
    expect((await call('GET', '/v1/history/nights')).body).toEqual([{ night: NIGHT, rows: 5, kinds: { checkin: 5 } }, { night: '2026-10-07', rows: 1, kinds: { checkin: 1 } }]);
    const sum = (await call('GET', `/v1/history/summary?from=${NIGHT}&to=${NIGHT}`)).body;
    expect(sum).toEqual([{ night: NIGHT, club: 'Sparks', checkedIn: 5, checkedOut: 4, undone: 0, prints: 5 }]);

    const first = (await call('GET', `/v1/history/rows?night=${NIGHT}&limit=3`)).body;
    expect(first.rows).toHaveLength(3);
    expect(first.next).toBe(first.rows[2].id);
    const rest = (await call('GET', `/v1/history/rows?night=${NIGHT}&limit=3&after=${first.next}`)).body;
    expect(rest.rows).toHaveLength(2);
    expect(rest.next).toBeNull();

    const pair = await unwrapPrivateKey(key.wrapped, PASS, key.pub);
    const ring = await keyRing(pair, key.pub);
    const opened = await Promise.all([...first.rows, ...rest.rows].map((r) => openRow(ring, r)));
    expect(opened.map((o) => o.first).sort()).toEqual(records.map((r) => r.first));
    expect((await call('GET', '/v1/history/rows')).status).toBe(400);
  });

  it('a wrong passphrase cannot open the key, so no row opens', async () => {
    expect(await unwrapPrivateKey(key.wrapped, 'not the word', key.pub)).toBeNull();
    expect(await unwrapPrivateKey(key.wrapped, PASS, key.pub)).not.toBeNull();
  });
});

describe('a passphrase change re-wraps the key and old rows stay readable', () => {
  it('writes the new wrap and keeps the old for 7 days, in one put', async () => {
    const { call, db, history, storage } = await setup();
    const row = await sealed({ first: 'Oldrow', ts: 1 });
    await call('POST', '/v1/history/rows', { rows: [row] });

    const next = await rewrapPrivateKey(key.wrapped, PASS, NEW_PASS, key.pub);
    expect(next).not.toBeNull();
    // fail closed: no wrap, or a malformed one, changes nothing
    expect((await history.rewrapWrites(undefined)).error.status).toBe(400);
    expect((await history.rewrapWrites({ ...next, ct: 'x' })).error.status).toBe(400);

    const { writes } = await history.rewrapWrites(next);
    expect(Object.keys(writes).sort()).toEqual(['history:wrapped', 'history:wrapped:prev']);
    await storage.put({ auth: { epoch: 2 }, ...writes });   // the integrator's ONE atomic put

    const got = (await call('GET', '/v1/history/key')).body;
    expect(got.wrapped).toEqual(next);
    expect(got.prev.wrapped).toEqual(key.wrapped);
    expect(got.prev.until).toBe(Date.parse('2026-10-14T23:00:00Z') + 7 * 24 * 3600 * 1000);

    // the NEW passphrase opens the history key (pub unchanged), and the OLD row still opens
    const ring = await keyRing(await unwrapPrivateKey(got.wrapped, NEW_PASS, got.pub), got.pub);
    const stored = (await call('GET', `/v1/history/rows?night=${NIGHT}`)).body.rows[0];
    expect((await openRow(ring, stored)).first).toBe('Oldrow');
    expect(await unwrapPrivateKey(got.wrapped, PASS, got.pub)).toBeNull();
    expect(db.dump()).not.toContain('Oldrow');

    // after 7 days the previous wrap is no longer offered
    const later = new History({ storage, env: { HISTORY_DB: db }, now: () => Date.parse('2026-10-22T00:00:00Z') });
    expect((await (await later.getKey()).json()).prev).toBeNull();
  });

  it('with no history key yet, a passphrase change needs no wrap', async () => {
    const { history } = await setup({ withKey: false });
    expect(await history.rewrapWrites(undefined)).toEqual({ writes: {} });
  });
});

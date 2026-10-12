// History inside the whole Worker (online check-in P6 wired by the integrator):
// the desk refuses a row not sealed to the current history key, a desk check-in /
// undo / check-out keeps the row the desk page sealed (the Worker never seals),
// D1 down never blocks a check-in and the outbox drains from cron() and alarm(),
// and the passphrase change re-wraps the history key in ONE atomic put.
import { beforeAll, describe, expect, it } from 'vitest';
import { createHistoryKey, newRowId, openRow, keyRing, rewrapPrivateKey, sealRow, unwrapPrivateKey } from '../../shared/cloud-crypto.js';
import { d1Stub } from './d1stub.js';
import { memoryStore } from './helpers.js';
import { NIGHT, kid, rig } from './rig.js';

const PASS = 'kennebec';
const NEW_PASS = 'a brand new word';
let key;
beforeAll(async () => { key = await createHistoryKey(PASS); }, 60000);

async function setup({ db = d1Stub(), withKey = true } = {}) {
  const storage = memoryStore();
  if (withKey) {
    await storage.put('history:pub', { pub: key.pub, kid: key.kid });
    await storage.put('history:wrapped', key.wrapped);
  }
  const t = await rig({ storage, env: db ? { HISTORY_DB: db } : {}, kids: [kid('662', 'Sparks', 'Kit Tester')] });
  const st = await t.station();
  return { t, st, db, storage };
}

async function sealed(kind, record, { night = NIGHT } = {}) {
  const id = newRowId();
  return { id, night, kind, ...(await sealRow(key.pub, { id, night, kind, record })) };
}

const deskBody = async (t, st, historyRow, extra = {}) => ({ ...(await t.deskBody([st])), historyRow, ...extra });

describe('the desk and history', () => {
  it('a desk check-in keeps the sealed row and counts the club, ciphertext only', async () => {
    const { t, st, db } = await setup();
    const row = await sealed('checkin', { ts: Date.now(), first: 'Kit', last: 'Tester', club: 'Sparks', clubberId: '662' });
    const res = await t.call('POST', '/v1/desk/checkin', await deskBody(t, st, row));
    expect(res.body).toMatchObject({ ok: true, history: 'hooked' });
    const stored = db.query('SELECT id, night, kind FROM history_rows');
    expect(stored).toEqual([{ id: row.id, night: NIGHT, kind: 'checkin' }]);
    expect(db.query('SELECT club, checked_in AS n FROM night_summary')).toEqual([{ club: 'Sparks', n: 1 }]);
    expect(db.dump()).not.toMatch(/Kit|Tester|662/);
    // a signed-in client reads it back and opens it with the history key
    const ring = await keyRing(await unwrapPrivateKey(key.wrapped, PASS, key.pub), key.pub);
    const got = (await t.call('GET', `/v1/history/rows?night=${NIGHT}`)).body.rows;
    expect(got).toHaveLength(1);
    expect(await openRow(ring, got[0])).toMatchObject({ first: 'Kit', clubberId: '662' });
  });

  it('a retried check-in (already claimed) stores no second row', async () => {
    const { t, st, db } = await setup();
    const row = await sealed('checkin', { first: 'Kit' });
    await t.call('POST', '/v1/desk/checkin', await deskBody(t, st, row));
    const again = await t.call('POST', '/v1/desk/checkin', await deskBody(t, st, await sealed('checkin', { first: 'Kit' })));
    expect(again.body.already).toBe(true);
    expect(db.query('SELECT id FROM history_rows')).toHaveLength(1);
  });

  it('refuses a row sealed to another key, and any row while no history key exists', async () => {
    const { t, st, db } = await setup();
    const other = await sealRow(key.pub, { id: newRowId(), night: NIGHT, kind: 'checkin', record: { a: 1 } });
    const wrongKid = { id: newRowId(), night: NIGHT, kind: 'checkin', ...other, kid: 'ffffffffffffffff' };
    const res = await t.call('POST', '/v1/desk/checkin', await deskBody(t, st, wrongKid));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ reason: 'unsealed', what: 'historyRow' });
    expect(db.query('SELECT id FROM history_rows')).toEqual([]);
    expect((await t.call('GET', '/v1/print/status')).body.claims.queued).toBe(0);   // nothing was claimed

    const none = await setup({ withKey: false });
    // the rig stores a stand-in key when none exists; remove it to be a Worker nobody has keyed yet
    await none.storage.delete('history:pub');
    const row = await sealed('checkin', { a: 1 });
    expect((await none.t.call('POST', '/v1/desk/checkin', await deskBody(none.t, none.st, row))).body).toMatchObject({ reason: 'unsealed' });
  });

  it('undo and check-out keep their rows too, with the summary counts', async () => {
    const { t, st, db } = await setup();
    await t.call('POST', '/v1/desk/checkin', await deskBody(t, st, await sealed('checkin', { first: 'Kit' })));
    const undo = await t.call('POST', '/v1/desk/undo', { night: NIGHT, clubberId: '662', club: 'Sparks', historyRow: await sealed('undo', { first: 'Kit' }) });
    expect(undo.body.ok).toBe(true);
    await t.call('POST', '/v1/desk/checkin', await deskBody(t, st, await sealed('checkin', { first: 'Kit' })));
    const out = await t.call('POST', '/v1/desk/checkout', { night: NIGHT, clubberId: '662', club: 'Sparks', historyRow: await sealed('checkout', { first: 'Kit' }) });
    expect(out.body.ok).toBe(true);
    expect(db.query('SELECT kind, COUNT(*) AS n FROM history_rows GROUP BY kind ORDER BY kind')).toEqual([
      { kind: 'checkin', n: 2 }, { kind: 'checkout', n: 1 }, { kind: 'undo', n: 1 },
    ]);
    expect(db.query('SELECT checked_in AS i, checked_out AS o, undone AS u FROM night_summary WHERE club = ?', 'Sparks')).toEqual([{ i: 2, o: 1, u: 1 }]);
  });

  it('D1 down never blocks a check-in; cron() and alarm() drain the outbox', async () => {
    const { t, st, db } = await setup();
    db.down = true;
    const res = await t.call('POST', '/v1/desk/checkin', await deskBody(t, st, await sealed('checkin', { first: 'Kit' })));
    expect(res.body.ok).toBe(true);
    expect((await t.call('GET', '/v1/history/status')).body.pending).toBe(1);
    db.down = false;
    await t.core.cron();
    expect((await t.call('GET', '/v1/history/status')).body.pending).toBe(0);
    expect(db.query('SELECT id FROM history_rows')).toHaveLength(1);

    db.down = true;
    await t.call('POST', '/v1/desk/undo', { night: NIGHT, clubberId: '662', club: 'Sparks', historyRow: await sealed('undo', { first: 'Kit' }) });
    db.down = false;
    expect((await t.call('GET', '/v1/history/status')).body.pending).toBe(1);
    await t.core.alarm();
    expect((await t.call('GET', '/v1/history/status')).body.pending).toBe(0);
    expect(db.query('SELECT id FROM history_rows')).toHaveLength(2);
  });

  it('no HISTORY_DB yet: the check-in works and its row waits in the outbox', async () => {
    const { t, st } = await setup({ db: null });
    const res = await t.call('POST', '/v1/desk/checkin', await deskBody(t, st, await sealed('checkin', { first: 'Kit' })));
    expect(res.body.ok).toBe(true);
    expect((await t.call('GET', '/v1/history/status')).body).toEqual({ db: false, pending: 1 });
  });
});

describe('the passphrase change re-wraps the history key in the one atomic put', () => {
  it('stores the new wrap and keeps the old one 7 days, in the same put as the new auth', async () => {
    const { t, storage } = await setup();
    const puts = [];
    const real = storage.put;
    storage.put = async (k, v) => { puts.push(k); return real(k, v); };
    const next = await rewrapPrivateKey(key.wrapped, PASS, NEW_PASS, key.pub);
    const res = await t.call('POST', '/v1/passphrase', { current: PASS, next: NEW_PASS, wrapped: next });
    expect(res.status).toBe(200);
    const one = puts.find((k) => k && typeof k === 'object' && 'auth' in k);
    expect(Object.keys(one).sort()).toEqual(['auth', 'history:wrapped', 'history:wrapped:prev']);
    expect((await storage.get('history:wrapped'))).toEqual(next);
    expect((await storage.get('history:wrapped:prev')).wrapped).toEqual(key.wrapped);
  }, 30000);

  it('with a history key and no wrap in the body, the passphrase does NOT change', async () => {
    const { t, storage } = await setup();
    const before = await storage.get('auth');
    const res = await t.call('POST', '/v1/passphrase', { current: PASS, next: NEW_PASS });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('wrap-missing');
    expect(await storage.get('auth')).toEqual(before);
    expect(await storage.get('history:wrapped')).toEqual(key.wrapped);
  });
});

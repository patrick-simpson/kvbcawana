import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createHistoryKey, newRowId, sealRow, unwrapPrivateKey } from '../../shared/cloud-crypto.js';
import { fetchNightRows, historyUnlocked, historyWrapLanded, lockHistory, rewrapHistoryKey, unlockHistory } from './historyCrypto.js';

const BASE = 'https://sync.test';
const SESSION = 'v1.1.1700000000000.settingspagesettingspagesettings';
const PASS = 'kennebec river';
const NEW = 'a brand new word';
const NIGHT = '2026-10-14';

let key;
let rows;
beforeAll(async () => {
  key = await createHistoryKey(PASS);
  rows = [];
  for (const [first, ts] of [['Zed', 2000], ['Ada', 1000]]) {
    const id = newRowId();
    rows.push({ id, night: NIGHT, kind: 'checkin', v: 1, ...(await sealRow(key.pub, { id, night: NIGHT, kind: 'checkin', record: { first, last: 'Tester', club: 'Sparks', ts } })) });
  }
}, 60000);

/** A stand-in Worker for the history key and rows routes. */
function worker({ wrapped = () => key.wrapped, has = true } = {}) {
  const calls = [];
  const fn = vi.fn(async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname + u.search, method: init.method || 'GET', body: init.body });
    const json = (b, status = 200) => ({ ok: status < 400, status, json: async () => b, text: async () => JSON.stringify(b) });
    if (u.pathname === '/v1/history/key') return has ? json({ pub: key.pub, kid: key.kid, wrapped: wrapped(), prev: null }) : json({ error: 'none' }, 404);
    if (u.pathname === '/v1/history/rows') return json({ rows, next: null });
    return json({}, 404);
  });
  return { fn, calls };
}

describe('unlocking the history', () => {
  it('opens with the right passphrase and never sends it anywhere', async () => {
    const w = worker();
    expect(await unlockHistory(BASE, SESSION, PASS, { fetchFn: w.fn })).toMatchObject({ ok: true, kid: key.kid });
    expect(historyUnlocked()).toBe(true);
    expect(JSON.stringify(w.calls)).not.toContain(PASS);
    lockHistory();
    expect(historyUnlocked()).toBe(false);
  });

  it('a wrong passphrase fails and nothing is held', async () => {
    const res = await unlockHistory(BASE, SESSION, 'not the word', { fetchFn: worker().fn });
    expect(res).toMatchObject({ ok: false, reason: 'wrong' });
    expect(historyUnlocked()).toBe(false);
  });

  it('says when there is no history yet, or the service is away', async () => {
    expect(await unlockHistory(BASE, SESSION, PASS, { fetchFn: worker({ has: false }).fn })).toMatchObject({ ok: false, reason: 'no-key' });
    expect(await unlockHistory(BASE, SESSION, PASS, { fetchFn: vi.fn(async () => { throw new Error('x'); }) })).toMatchObject({ ok: false, reason: 'unreachable' });
  });
});

describe('opening a night', () => {
  it('needs the key, then opens every row in time order and counts what will not open', async () => {
    const w = worker();
    expect(await fetchNightRows(BASE, SESSION, NIGHT, { fetchFn: w.fn })).toMatchObject({ ok: false, reason: 'locked' });
    await unlockHistory(BASE, SESSION, PASS, { fetchFn: w.fn });
    const res = await fetchNightRows(BASE, SESSION, NIGHT, { fetchFn: w.fn });
    expect(res.ok && res.rows.map((r) => r.record.first)).toEqual(['Ada', 'Zed']);
    rows = [...rows, { ...rows[0], id: newRowId() }];     // relabelled: its AAD no longer matches
    const again = await fetchNightRows(BASE, SESSION, NIGHT, { fetchFn: w.fn });
    expect(again.ok && again.unreadable).toBe(1);
    lockHistory();
  });

  it('keeps nothing in browser storage', async () => {
    const w = worker();
    await unlockHistory(BASE, SESSION, PASS, { fetchFn: w.fn });
    await fetchNightRows(BASE, SESSION, NIGHT, { fetchFn: w.fn });
    for (const store of [localStorage, sessionStorage]) {
      const all = JSON.stringify(Object.fromEntries(Object.keys(store).map((k) => [k, store.getItem(k)])));
      expect(all).not.toContain('Tester');
      expect(all).not.toContain(PASS);
    }
    lockHistory();
  });
});

describe('the passphrase change re-wrap', () => {
  it('re-wraps under the new word, proves it, and the new wrap opens the same key', async () => {
    const res = await rewrapHistoryKey(BASE, SESSION, PASS, NEW, { fetchFn: worker().fn });
    expect(res.ok).toBe(true);
    expect(await unwrapPrivateKey(res.wrapped, NEW, key.pub)).not.toBeNull();
    expect(await unwrapPrivateKey(res.wrapped, PASS, key.pub)).toBeNull();
  });

  it('a wrong current passphrase moves nothing; no history key means nothing to move', async () => {
    expect(await rewrapHistoryKey(BASE, SESSION, 'nope', NEW, { fetchFn: worker().fn })).toMatchObject({ ok: false, reason: 'wrong' });
    expect(await rewrapHistoryKey(BASE, SESSION, PASS, NEW, { fetchFn: worker({ has: false }).fn })).toEqual({ ok: true, wrapped: null });
    expect(await rewrapHistoryKey(BASE, SESSION, PASS, NEW, { fetchFn: vi.fn(async () => { throw new Error('x'); }) })).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('notices a service that ignored the new wrap', async () => {
    const res = await rewrapHistoryKey(BASE, SESSION, PASS, NEW, { fetchFn: worker().fn });
    expect(await historyWrapLanded(BASE, SESSION, res.wrapped, { fetchFn: worker().fn })).toBe(false);
    expect(await historyWrapLanded(BASE, SESSION, res.wrapped, { fetchFn: worker({ wrapped: () => res.wrapped }).fn })).toBe(true);
  });
});

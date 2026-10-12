import { describe, expect, it } from 'vitest';
import {
  RESEAL_MAX, TOOL_ROUTES, asStations, customRecord, leaderRecord, oneOffRecord, reprintRecord, sendToolJob, toolRecord,
} from './toolJobs.js';

const NOW = Date.parse('2026-10-14T22:30:00Z');
const st = (n) => ({ stationId: `s${n}`, name: `Laptop ${n}`, kid: `k${n}`, pub: `pub${n}` });

/** A scripted Worker: handlers by path, each may be a function of the call number. */
function world({ stations = [st(1)], reprint = () => ({ ok: true, status: 200, body: { ok: true } }), history = true } = {}) {
  const log = { calls: [], sealed: [], rows: [] };
  const deps = {
    now: () => NOW,
    uuid: () => '11111111-2222-3333-4444-555555555555',
    newId: (() => { let n = 0; return () => `id${(n += 1)}`; })(),
    seal: async (list, item) => { log.sealed.push({ list, item }); return { v: 1, id: item.id, to: list.map((s) => s.kid) }; },
    sealRow: async (pub, row) => { log.rows.push({ pub, row }); return { v: 1, kid: 'h', epk: 'e', iv: 'i', ct: 'c' }; },
    call: async (path, opts = {}) => {
      log.calls.push({ path, ...opts });
      if (path === '/v1/stations') return { ok: true, status: 200, body: stations, message: '' };
      if (path === '/v1/print/reprint') { const r = reprint(log.calls.filter((c) => c.path === path).length); return { message: r.ok ? '' : 'refused', ...r }; }
      if (path === '/v1/history/key') return history ? { ok: true, status: 200, body: { pub: 'histpub' }, message: '' } : { ok: false, status: 404, body: null, message: 'no' };
      if (path === '/v1/history/rows') return { ok: true, status: 200, body: { stored: 1 }, message: '' };
      return { ok: false, status: 404, body: null, message: 'nope' };
    },
  };
  return { deps, log };
}

describe('tool job records', () => {
  it('have the shapes the station runs, from the settings page', () => {
    expect(reprintRecord({ name: ' Maya Tester ', clubberId: '77' }, NOW)).toEqual({
      route: '/reprint', body: { name: 'Maya Tester', clubberId: '77' }, source: 'settings', at: '2026-10-14T22:30:00.000Z',
    });
    expect(reprintRecord({ name: 'Visitor' }, NOW).body.clubberId).toBeNull();
    expect(leaderRecord({ name: 'Pat Leader', clubName: 'Sparks' }, NOW)).toMatchObject({ route: '/print-leader', body: { name: 'Pat Leader', clubName: 'Sparks' } });
    expect(oneOffRecord({ firstName: 'Zed', clubName: 'Cubbies' }, NOW)).toMatchObject({ route: '/print-oneoff', body: { firstName: 'Zed', clubName: 'Cubbies' } });
    expect(customRecord('KITCHEN', NOW)).toMatchObject({ route: '/print-custom', body: { text: 'KITCHEN' } });
  });

  it('refuse a route no settings page may start', () => {
    expect(TOOL_ROUTES).toEqual(['/reprint', '/print-leader', '/print-oneoff', '/print-custom']);
    expect(() => toolRecord('/print', {})).toThrow();
  });

  it('only stations with a public key can be sealed to', () => {
    expect(asStations([st(1), { stationId: 'x' }, null])).toEqual([{ stationId: 's1', name: 'Laptop 1', kid: 'k1', publicKey: 'pub1' }]);
  });
});

describe('sendToolJob', () => {
  it('seals to every station in the browser and posts ONE reprint:<uuid> job', async () => {
    const { deps, log } = world({ stations: [st(1), st(2)] });
    const r = await sendToolJob(reprintRecord({ name: 'Maya Tester', clubberId: '77' }, NOW), { deps });
    expect(r).toMatchObject({ ok: true, jobId: 'reprint:11111111-2222-3333-4444-555555555555', existing: false, history: 'none' });
    expect(log.sealed).toHaveLength(1);
    expect(log.sealed[0].list.map((s) => s.stationId)).toEqual(['s1', 's2']);
    expect(log.sealed[0].item).toMatchObject({ night: '2026-10-14', kind: 'print-job' });
    const post = log.calls.find((c) => c.path === '/v1/print/reprint');
    expect(post.method).toBe('POST');
    expect(post.body.jobId).toBe(r.jobId);
    // the name is inside the sealed record, never in the posted body
    expect(JSON.stringify(post.body)).not.toContain('Maya');
  });

  it('says so when no printing computer is registered', async () => {
    const { deps, log } = world({ stations: [] });
    const r = await sendToolJob(customRecord('X', NOW), { deps });
    expect(r).toMatchObject({ ok: false, reason: 'no-station' });
    expect(log.calls.some((c) => c.path === '/v1/print/reprint')).toBe(false);
  });

  it('reseals on stations-changed with the new list, keeping one jobId', async () => {
    const { deps, log } = world({
      reprint: (n) => (n === 1
        ? { ok: false, status: 409, body: { reason: 'stations-changed', stations: [st(1), st(3)] } }
        : { ok: true, status: 200, body: { ok: true } }),
    });
    const r = await sendToolJob(customRecord('X', NOW), { deps });
    expect(r.ok).toBe(true);
    expect(log.sealed).toHaveLength(2);
    expect(log.sealed[1].list.map((s) => s.stationId)).toEqual(['s1', 's3']);
    const jobIds = log.calls.filter((c) => c.path === '/v1/print/reprint').map((c) => c.body.jobId);
    expect(new Set(jobIds).size).toBe(1);
  });

  it('gives up after three reseals', async () => {
    const { deps, log } = world({ reprint: () => ({ ok: false, status: 409, body: { reason: 'stations-changed', stations: [st(1)] } }) });
    const r = await sendToolJob(customRecord('X', NOW), { deps });
    expect(r).toMatchObject({ ok: false, reason: 'stations-changed' });
    expect(log.sealed).toHaveLength(RESEAL_MAX + 1);
  });

  it('a reprint stores a sealed history row beside it; a failure there never fails the print', async () => {
    const a = world();
    const ok = await sendToolJob(reprintRecord({ name: 'Maya Tester' }, NOW), { deps: a.deps, historyRow: { first: 'Maya', last: 'Tester', club: 'Sparks' } });
    expect(ok).toMatchObject({ ok: true, history: 'stored' });
    expect(a.log.rows[0].pub).toBe('histpub');
    expect(a.log.rows[0].row).toMatchObject({ kind: 'reprint', night: '2026-10-14', record: { first: 'Maya', source: 'settings' } });
    const rowPost = a.log.calls.find((c) => c.path === '/v1/history/rows');
    expect(JSON.stringify(rowPost.body)).not.toContain('Maya');
    const b = world({ history: false });
    expect(await sendToolJob(reprintRecord({ name: 'Maya' }, NOW), { deps: b.deps, historyRow: { first: 'Maya' } })).toMatchObject({ ok: true, history: 'failed' });
  });

  it('a refused job is reported, not thrown', async () => {
    const { deps } = world({ reprint: () => ({ ok: false, status: 400, body: { reason: 'unsealed' } }) });
    expect(await sendToolJob(customRecord('X', NOW), { deps })).toMatchObject({ ok: false, reason: 'refused' });
  });
});

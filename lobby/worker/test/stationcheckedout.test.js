// POST /v1/station/checked-out: the print station hands over the children checked out
// by hand on TwoTimTwo's Checkout page. They leave tonight's count and still-here list
// as at a desk check-out; other nights, a closed watch window, junk ids, ids already
// out and children whose desk claim was undone change nothing.
import { describe, expect, it } from 'vitest';
import { STILL_GAP_MS } from '../src/publisher.js';
import { NIGHT, kid, rig, row } from './rig.js';

const ON = { SINGLE_PUBLISHER: 'on' };
const people = [kid('1', 'Sparks', 'Ada Tester'), kid('2', 'Sparks', 'Bo Tester'), kid('3', 'Trek', 'Cy Tester'), kid('4', 'T&amp;T', 'Dee Tester')];
const PATH = '/v1/station/checked-out';

async function tonight() {
  const t = await rig({ env: ON, kids: people });
  const st = await t.station();
  await t.core.watcher.tick();
  const out = () => [...t.core.publisher.book.state(t.clock.t).checkedOut.ids].map(String).sort();
  const total = () => t.sent.filter((f) => f.e === 'tally').at(-1).d.total;
  return { t, st, out, total };
}

describe('POST /v1/station/checked-out', () => {
  it('refuses a caller that is not a registered station', async () => {
    const { t, st, out } = await tonight();
    const noStation = await t.call('POST', PATH, { date: NIGHT, clubberIds: ['1'] });
    expect([401, 403]).toContain(noStation.status);
    const unknown = await t.call('POST', PATH, { date: NIGHT, clubberIds: ['1'] }, { 'X-Station': 'station-unknown1' });
    expect([401, 403]).toContain(unknown.status);
    expect(out()).toEqual([]);
    expect((await st.call('POST', PATH, { date: NIGHT, clubberIds: [] })).status).toBe(200);
  });

  it('another night\'s date applies nothing (other-night)', async () => {
    const { t, st, out } = await tonight();
    for (const date of ['2026-10-13', '2026-10-15', undefined, 'x']) {
      expect((await st.call('POST', PATH, { date, clubberIds: ['1'] })).body).toEqual({ ok: true, applied: 0, reason: 'other-night' });
    }
    expect((await st.call('POST', PATH, { clubberIds: ['1'] })).body).toMatchObject({ applied: 0, reason: 'other-night' });
    expect(out()).toEqual([]);
    expect(t.clock.t).toBeGreaterThan(0);
  });

  it('outside the watch window applies nothing (window-closed)', async () => {
    const { t, st, out } = await tonight();
    t.clock.t = Date.parse('2026-10-14T12:00:00Z');   // 8 am Eastern, the same night's date
    expect((await st.call('POST', PATH, { date: NIGHT, clubberIds: ['1'] })).body).toEqual({ ok: true, applied: 0, reason: 'window-closed' });
    t.clock.t = Date.parse('2026-10-15T02:00:00Z');   // 10 pm: after the window, still the 14th
    expect((await st.call('POST', PATH, { date: NIGHT, clubberIds: ['1'] })).body).toEqual({ ok: true, applied: 0, reason: 'window-closed' });
    expect(out()).toEqual([]);
  });

  it('checks out a checked-in child: out of the book and the count, once only', async () => {
    const { t, st, out, total } = await tonight();
    expect(total()).toBe(4);
    t.clock.tick(STILL_GAP_MS + 1);
    const res = await st.call('POST', PATH, { date: NIGHT, clubberIds: ['1'] });
    expect(res).toMatchObject({ status: 200, body: { ok: true, applied: 1 } });
    expect(out()).toEqual(['1']);
    expect(total()).toBe(3);
    // the same list again, and a list with the child among others
    t.clock.tick(STILL_GAP_MS + 1);
    expect((await st.call('POST', PATH, { date: NIGHT, clubberIds: ['1'] })).body).toEqual({ ok: true, applied: 0 });
    expect((await st.call('POST', PATH, { date: NIGHT, clubberIds: ['1', 3] })).body).toEqual({ ok: true, applied: 1 });
    expect(out()).toEqual(['1', '3']);
    expect(total()).toBe(2);
  });

  it('ignores junk ids', async () => {
    const { t, st, out, total } = await tonight();
    const junk = ['', 'abc', '1a', '12 ', '-1', '1.5', '9'.repeat(21), null, {}, [], true];
    expect((await st.call('POST', PATH, { date: NIGHT, clubberIds: junk })).body).toEqual({ ok: true, applied: 0 });
    expect((await st.call('POST', PATH, { date: NIGHT, clubberIds: 'not-a-list' })).body).toEqual({ ok: true, applied: 0 });
    expect((await st.call('POST', PATH, { date: NIGHT })).body).toEqual({ ok: true, applied: 0 });
    expect(out()).toEqual([]);
    expect(total()).toBe(4);
    t.clock.tick(1);
    expect((await st.call('POST', PATH, { date: NIGHT, clubberIds: [...junk, '2'] })).body.applied).toBe(1);
    expect(out()).toEqual(['2']);
  });

  it('skips a child whose desk claim was undone', async () => {
    const { t, st, out } = await tonight();
    t.clock.tick(STILL_GAP_MS + 1);
    expect((await t.call('POST', '/v1/desk/checkin', await t.deskBody([st]))).body.ok).toBe(true);   // 662 at the desk
    t.clock.tick(STILL_GAP_MS + 1);
    expect((await t.call('POST', '/v1/desk/undo', { night: NIGHT, clubberId: '662', historyRow: row('undo') })).body.ok).toBe(true);
    t.clock.tick(STILL_GAP_MS + 1);
    expect((await st.call('POST', PATH, { date: NIGHT, clubberIds: ['662'] })).body).toEqual({ ok: true, applied: 0 });
    expect(out()).toEqual([]);
    // a child never seen at the desk is still taken off
    expect((await st.call('POST', PATH, { date: NIGHT, clubberIds: ['662', '4'] })).body).toEqual({ ok: true, applied: 1 });
    expect(out()).toEqual(['4']);
  });

  it('takes at most 500 ids from one list', async () => {
    const { st, out } = await tonight();
    const ids = Array.from({ length: 600 }, (_, i) => String(1000 + i));
    expect((await st.call('POST', PATH, { date: NIGHT, clubberIds: ids })).body.applied).toBe(500);
    expect(out()).toHaveLength(500);
  });
});

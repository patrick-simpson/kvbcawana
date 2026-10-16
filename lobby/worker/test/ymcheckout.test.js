// The youth check-out in the Worker (ymcheckout.js): the extension's ymSweep rules
// (7:15 pm to midnight on a club night, Trek and Journey only, the Checkout page's
// own POST accepted on exact "OK", 3 tries, a done list), the owner's pace (one
// post every 15 s), the one read clock, and tonight's count.
import { describe, expect, it } from 'vitest';
import { parseCheckoutPage } from '../src/twotimtwo.js';
import { READ_INTERVAL_MS, WATCH_INTERVAL_MS } from '../src/watcher.js';
import { YM_CHECKOUT_GAP_MS, YM_MAX_FAILS, YM_PAGE_MS, ymClubOf, ymDue } from '../src/ymcheckout.js';
import { checkoutPage } from './fixtures.js';
import { everything } from './helpers.js';
import { kid, rig } from './rig.js';

const ON = { YM_CHECKOUT: 'on' };
// Wednesday 2026-10-14 in the church's zone (EDT, UTC-4).
const AT = (hm, day = '2026-10-14') => {
  const [h, m, s = 0] = hm.split(':').map(Number);
  return Date.parse(`${day}T00:00:00Z`) + ((h + 4) * 3600 + m * 60 + s) * 1000;
};
const TREK = [kid('7001', 'Trek', 'Ann Trekker'), kid('7002', 'Journey', 'Bo Journeyer'), kid('7003', 'Trek', 'Cy Trekker')];
const YOUNGER = [kid('7101', 'Sparks', 'Dee Sparky'), kid('7102', 'T&T', 'Eve Tnt')];

/** Run the alarm as the Durable Object would, until `ms` from now. */
async function drive(t, ms) {
  const until = t.clock.t + ms;
  while (t.clock.t < until) {
    await t.core.alarm();
    if (!(t.alarm.at > t.clock.t)) throw new Error('the alarm did not move forward');
    t.clock.t = Math.min(t.alarm.at, until);
    if (t.clock.t >= until) break;
  }
}
const posted = (t) => t.posts.checkout.map((p) => p.get('clubber_id'));
const pageReads = (t) => t.reads.filter((r) => r.path === '/clubber/checkout');
const reportReads = (t) => t.reads.filter((r) => r.path === '/clubber/checkin_report');

describe('when and who', () => {
  it('is due on a club night from 7:15 pm until midnight, Eastern', () => {
    expect(ymDue(AT('19:14:59'))).toBe(false);
    expect(ymDue(AT('19:15'))).toBe(true);
    expect(ymDue(AT('23:59:59'))).toBe(true);
    expect(ymDue(AT('00:00', '2026-10-15'))).toBe(false);   // after midnight: Thursday
    expect(ymDue(AT('19:30', '2026-10-15'))).toBe(false);   // not a club night
    expect(ymDue(AT('19:30', '2026-10-13'))).toBe(false);
  });

  it('matches the extension\'s ymClubOf: Trek and Journey only', () => {
    expect(['Trek ', 'JOURNEY', 'Trek Club', 'Sparks ', 'T&T', 'Cubbies', ''].map(ymClubOf)).toEqual(['trek', 'journey', 'trek', '', '', '', '']);
  });

  it('reads the Checkout page\'s meeting, date and rows, never a name', () => {
    const p = parseCheckoutPage(checkoutPage({ calendarId: '412', rows: [{ id: '9', name: 'Zed Z', club: 'Trek' }] }));
    expect(p).toEqual({ calendarId: '412', date: '2026-10-14', rows: [{ clubberId: '9', club: 'Trek' }] });
    expect(parseCheckoutPage(checkoutPage({ title: 'Check In' }))).toBeNull();
    expect(parseCheckoutPage(checkoutPage({ calendarId: 'x' })).calendarId).toBe('');
  });
});

describe('the sweep', () => {
  it('posts nothing at 7:14, nor while YM_CHECKOUT is off (the page itself is read all club night for hand check-outs)', async () => {
    const early = await rig({ env: ON, kids: TREK, start: AT('19:13:30') });
    await drive(early, 30 * 1000);
    expect(posted(early)).toEqual([]);
    const off = await rig({ kids: TREK, start: AT('19:15') });
    await drive(off, 2 * 60 * 1000);
    expect(posted(off)).toEqual([]);
    expect(pageReads(off).length).toBeGreaterThan(0);   // club hours: hand check-outs are watched
    const late = await rig({ kids: TREK, start: AT('20:05') });
    await drive(late, 2 * 60 * 1000);
    expect(posted(late)).toEqual([]);
    expect(pageReads(late)).toEqual([]);   // past club hours with the sweep off: nothing
  });

  it('at 7:15 checks out each Trek and Journey child, ONE post every 15 s, with the page\'s meeting', async () => {
    const t = await rig({ env: ON, kids: [...YOUNGER, ...TREK], start: AT('19:15') });
    await drive(t, 3 * 60 * 1000);   // a sign-in first: three slots of the 5 s clock
    expect(posted(t)).toEqual(['7001', '7002', '7003']);
    const at = t.posts.checkoutAt;
    expect(at[1] - at[0]).toBe(YM_CHECKOUT_GAP_MS);
    expect(at[2] - at[1]).toBe(YM_CHECKOUT_GAP_MS);
    expect(t.posts.checkout.every((p) => p.get('calendar_id') === '368')).toBe(true);
    const s = (await t.call('GET', '/v1/cloud/status')).body.ymCheckout;
    expect(s).toMatchObject({ enabled: true, due: true, checkedOut: 3, failed: 0, gaveUp: 0, pending: 0, meeting: '2026-10-14' });
    expect(s.lastSweep).toBeTruthy();
    expect(JSON.stringify(s)).not.toMatch(/7001|Ann|Trekker/);
    // nobody twice: the report still lists them
    await drive(t, 3 * 60 * 1000);
    expect(posted(t)).toEqual(['7001', '7002', '7003']);
  });

  it('a restart keeps the done list and the 15 s pace', async () => {
    const t = await rig({ env: ON, kids: TREK, start: AT('19:15') });
    while (posted(t).length < 1) { await t.core.alarm(); t.clock.t = t.alarm.at; }
    const first = t.posts.checkoutAt[0];
    t.restart();
    await drive(t, 2 * 60 * 1000);
    expect(posted(t)).toEqual(['7001', '7002', '7003']);
    expect(t.posts.checkoutAt[1] - first).toBeGreaterThanOrEqual(YM_CHECKOUT_GAP_MS);
  });

  it('counts only an exact "OK"', async () => {
    const t = await rig({ env: ON, kids: [TREK[0]], start: AT('19:15') });
    t.faults.checkoutReply = '<html><body>OK</body></html>';
    while (posted(t).length < 1) { await t.core.alarm(); t.clock.t = t.alarm.at; }
    expect(posted(t)).toEqual(['7001']);
    t.faults.checkoutReply = ' OK\n';   // the extension trims too
    await drive(t, YM_CHECKOUT_GAP_MS);
    expect(posted(t)).toEqual(['7001', '7001']);
    await drive(t, 60 * 1000);
    expect(posted(t)).toHaveLength(2);
    expect((await t.call('GET', '/v1/cloud/status')).body.ymCheckout).toMatchObject({ checkedOut: 1, failed: 1 });
  });

  it('tries a refused child at most 3 times a night, each try 15 s after the last post', async () => {
    const t = await rig({ env: ON, kids: [TREK[0]], start: AT('19:15') });
    t.faults.checkout = 'refuse';
    await drive(t, 5 * 60 * 1000);
    expect(posted(t)).toEqual(['7001', '7001', '7001']);
    expect(YM_MAX_FAILS).toBe(3);
    expect(t.posts.checkoutAt[1] - t.posts.checkoutAt[0]).toBe(YM_CHECKOUT_GAP_MS);
    expect((await t.call('GET', '/v1/cloud/status')).body.ymCheckout).toMatchObject({ checkedOut: 0, failed: 3, gaveUp: 1, pending: 0, lastError: 'refused' });
  });

  it('a late arrival is checked out once the watcher\'s report lists them, and a Checkout-page row counts too', async () => {
    const t = await rig({ env: ON, kids: [TREK[0]], start: AT('19:15') });
    await drive(t, 2 * 60 * 1000);
    expect(posted(t)).toEqual(['7001']);
    t.night.kids.push(kid('7009', 'Journey', 'Late Comer'));
    t.night.out = [{ id: '7010', name: 'Page Only', club: 'Trek' }, { id: '7011', name: 'Small One', club: 'Sparks' }];
    await drive(t, 2 * 60 * 1000);   // the next report (30 s) and the next Checkout page (60 s)
    expect(posted(t)).toEqual(['7001', '7009', '7010']);
  });

  it('reads no report of its own: the Checkout page at most every 60 s, all reads 5 s apart', async () => {
    const run = async (env) => {
      const t = await rig({ env, kids: [...YOUNGER, ...TREK], start: AT('19:15') });
      await drive(t, 3 * 60 * 1000);
      return t;
    };
    const on = await run(ON);
    const off = await run({});
    expect(reportReads(on).length).toBe(reportReads(off).length);
    expect(reportReads(on).length).toBeLessThanOrEqual(3 * 60 * 1000 / WATCH_INTERVAL_MS + 1);
    const pages = pageReads(on).map((r) => r.at);
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.length).toBeLessThanOrEqual(3 * 60 * 1000 / YM_PAGE_MS + 1);
    for (let i = 1; i < pages.length; i++) expect(pages[i] - pages[i - 1]).toBeGreaterThanOrEqual(YM_PAGE_MS);
    const all = on.reads.map((r) => r.at);
    for (let i = 1; i < all.length; i++) expect(all[i] - all[i - 1]).toBeGreaterThanOrEqual(READ_INTERVAL_MS);
  });

  it('takes each child off tonight\'s count and the TVs\' tally (SINGLE_PUBLISHER on)', async () => {
    const t = await rig({ env: { ...ON, SINGLE_PUBLISHER: 'on' }, kids: [...YOUNGER, ...TREK], start: AT('19:14:40') });
    await drive(t, 15 * 1000);
    const tally = () => t.sent.filter((f) => f.e === 'tally').at(-1)?.d;
    expect(tally()).toMatchObject({ total: 5 });
    await drive(t, 2 * 60 * 1000);
    expect(posted(t)).toHaveLength(3);
    expect(tally()).toMatchObject({ total: 2 });
    expect(tally().counts.Trek || 0).toBe(0);
    expect((await t.call('GET', '/v1/desk/tonight')).body).toMatchObject({ checkedIn: 2 });
  });

  it('keeps no name and no clubber id in plain storage', async () => {
    const t = await rig({ env: ON, kids: TREK, start: AT('19:15') });
    t.night.out = [{ id: '7010', name: 'Page Only', club: 'Trek' }];
    await drive(t, 3 * 60 * 1000);
    expect(posted(t)).toContain('7010');
    const all = everything(t.storage);
    for (const s of ['7001', '7002', '7003', '7010', 'Ann', 'Trekker', 'Page Only']) expect(all).not.toContain(s);
  });

  it('runs on past the watch window from the last report, and stops at midnight', async () => {
    const six = ['7001', '7002', '7003', '7004', '7005', '7006'].map((id) => kid(id, 'Trek'));
    const t = await rig({ env: ON, kids: six, start: AT('20:59:00') });
    await drive(t, 3 * 60 * 1000);   // the window closes at 9:00
    expect(posted(t)).toEqual(['7001', '7002', '7003', '7004', '7005', '7006']);
    const lastReport = reportReads(t).at(-1).at;
    expect(lastReport).toBeLessThan(AT('21:00'));
    t.clock.t = AT('23:59:00');
    await drive(t, 2 * 60 * 1000);
    expect(pageReads(t).filter((r) => r.at >= AT('00:00', '2026-10-15'))).toEqual([]);
    expect(t.alarm.at - t.clock.t).toBeGreaterThan(60 * 60 * 1000);
  });
});

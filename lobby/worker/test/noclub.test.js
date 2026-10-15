// No club tonight (owner 2026-10-13), then TEST DAYS (owner 2026-10-15): a day
// that is not a club day (the shared club-night rule: the schedule, its special
// dates, the Worker's calendar; the whole local day in the church's zone) is a
// test day. The roster reads TwoTimTwo's page like any day and answers `testDay`
// {today, next, meeting}; desk check-in and undo are real (see testday.test.js);
// check-out and the BARF late-friend tools, the relayed phone check-in and
// POST /v1/cloud/checkin stay refused `no-club`. The print station's rehearsal
// mode makes the day a club day as before (no `testDay` while rehearsing).
import { describe, expect, it } from 'vitest';
import { clubDay } from '../src/clubday.js';
import { REHEARSAL_FRESH_MS } from '../src/publisher.js';
import { sealJob } from './helpers.js';
import { NIGHT, WED_6PM, kid, rig, row } from './rig.js';

const MON_836PM = Date.parse('2026-10-13T00:36:00Z');   // Monday 2026-10-12, 8:36 pm EDT (the owner's screenshot)
const MON = '2026-10-12';
const TUE_11PM = Date.parse('2026-10-14T03:00:00Z');    // Tuesday 2026-10-13, 11 pm EDT (already Wednesday in UTC)
const WED_7AM = Date.parse('2026-10-14T11:00:00Z');     // Wednesday, long before the 4:30 pm watch window
const WED_11PM = Date.parse('2026-10-15T03:00:00Z');    // Wednesday 11 pm EDT (already Thursday in UTC)

/** The calendar the Worker keeps (sync.js `calendar`): the season's Wednesdays, plus `extra` events. */
function feed(extra = [], { cancel = [] } = {}) {
  const events = [];
  for (let i = 0; i < 30; i++) {
    const date = new Date(Date.UTC(2026, 8, 2 + 7 * i, 12)).toISOString().slice(0, 10);   // Wednesdays from Sep 2
    events.push({ date, kind: 'club', title: 'Awana Clubs', ...(cancel.includes(date) ? { isCancelled: true } : {}) });
  }
  return { version: 2, generatedAt: '2026-10-01T10:00:00Z', checkedAt: '2026-10-01T10:00:00Z', sourceUrl: 'https://example.org/calendar', events: [...events, ...extra] };
}

/** Everything the rig saw go to TwoTimTwo: page reads and sign-ins, and the posts. */
function touched(t) {
  return t.reads.length + t.slots.length + t.posts.undo.length + t.posts.checkout.length + (t.checkinPosts || 0);
}
async function monday(opts = {}) {
  const t = await rig({ kids: [kid('662')], start: MON_836PM, ...opts });
  t.checkinPosts = 0;
  t.on.checkin = async () => { t.checkinPosts += 1; return 'ok'; };
  return t;
}

describe('the club-day rule (clubday.js)', () => {
  it('is the shared rule for the whole local day, in the church\'s zone', () => {
    expect(clubDay(MON_836PM, null)).toEqual({ club: false, today: MON, next: NIGHT });
    expect(clubDay(WED_7AM, null)).toEqual({ club: true, today: NIGHT, next: NIGHT });
    expect(clubDay(WED_6PM, null).club).toBe(true);
    // 11 pm Eastern is still the same church day, whatever the UTC date says
    expect(clubDay(TUE_11PM, null)).toEqual({ club: false, today: '2026-10-13', next: NIGHT });
    expect(clubDay(WED_11PM, null)).toEqual({ club: true, today: NIGHT, next: NIGHT });
    expect(clubDay(Date.parse('2026-10-15T04:01:00Z'), null)).toMatchObject({ club: false, today: '2026-10-15', next: '2026-10-21' });   // 12:01 am Thursday
  });

  it('a special no-club date is never a club day; a special meeting with its own windows is one', () => {
    const sched = { version: 1, timezone: 'America/New_York', meeting: { day: 3 }, specialDates: { [NIGHT]: { noClub: true }, [MON]: { windows: [{ start: '18:00', end: '20:00', kind: 'club' }] } } };
    expect(clubDay(WED_6PM, null, sched)).toEqual({ club: false, today: NIGHT, next: '2026-10-21' });
    expect(clubDay(MON_836PM, null, sched)).toMatchObject({ club: true, today: MON });
  });

  it('the calendar adds an extra club night, cancels one, and ends the season', () => {
    const extra = feed([{ date: MON, kind: 'club', title: 'Awana Clubs (extra night)' }]);
    expect(clubDay(MON_836PM, extra)).toMatchObject({ club: true, today: MON });
    const snow = feed([{ date: '2026-10-15', kind: 'club', title: 'Make-up night' }], { cancel: [NIGHT] });
    expect(clubDay(WED_6PM, snow)).toEqual({ club: false, today: NIGHT, next: '2026-10-15' });
    expect(clubDay(MON_836PM, snow)).toEqual({ club: false, today: MON, next: '2026-10-15' });
    // after the calendar's last event: past the season, no next club night known
    // (the season's last Wednesday is 2027-03-24; 2027-06-30 is a Wednesday in the summer)
    expect(clubDay(Date.parse('2027-06-30T22:00:00Z'), feed())).toEqual({ club: false, today: '2027-06-30', next: null });
  });
});

describe('GET /v1/desk/roster on a day with no club (a test day)', () => {
  it('reads the page like a club day and answers testDay {today, next, meeting} instead of noClub', async () => {
    const t = await monday();
    const res = await t.call('GET', '/v1/desk/roster');
    expect(res.status).toBe(200);
    expect(res.body.noClub).toBeUndefined();
    expect(res.body.testDay).toEqual({ today: MON, next: NIGHT, meeting: NIGHT });
    expect(res.body.kids.map((k) => k.clubberId)).toContain('662');
    expect(t.reads.some((r) => r.path === '/clubber/checkin')).toBe(true);
    // the roster is wanted like on a club day
    expect(t.core.desk.rosterAskedAt).toBe(MON_836PM);
    t.clock.tick(60 * 1000);
    const again = await t.call('GET', '/v1/desk/roster');
    expect(again.body.testDay).toMatchObject({ today: MON, next: NIGHT });
    expect(again.body.noClub).toBeUndefined();
  });

  it('a club day is unchanged: the check-in page is read, and the answer carries no testDay', async () => {
    const t = await rig({ kids: [kid('662')] });
    const res = await t.call('GET', '/v1/desk/roster');
    expect(res.status).toBe(200);
    expect(res.body.noClub).toBeUndefined();
    expect(res.body.testDay).toBeUndefined();
    expect(res.body.kids.map((k) => k.clubberId)).toContain('662');
    expect(t.reads.some((r) => r.path === '/clubber/checkin')).toBe(true);
  });

  it('the whole club day counts: 7 am and 11 pm Eastern on a Wednesday carry no testDay; 11 pm on Tuesday is a test day', async () => {
    for (const start of [WED_7AM, WED_11PM]) {
      const t = await rig({ kids: [kid('662')], start });
      const res = await t.call('GET', '/v1/desk/roster');
      expect(res.body.testDay).toBeUndefined();
      expect(t.reads.some((r) => r.path === '/clubber/checkin')).toBe(true);
    }
    const tue = await monday({ start: TUE_11PM });
    expect((await tue.call('GET', '/v1/desk/roster')).body.testDay).toMatchObject({ today: '2026-10-13', next: NIGHT });
  });

  it('a special no-club date in the schedule: a test day on a Wednesday, with the week after as next', async () => {
    const t = await rig({ kids: [kid('662')] });
    t.core.desk.schedule = { version: 1, timezone: 'America/New_York', meeting: { day: 3 }, specialDates: { [NIGHT]: { noClub: true } } };
    const res = await t.call('GET', '/v1/desk/roster');
    expect(res.body.testDay).toMatchObject({ today: NIGHT, next: '2026-10-21' });
    expect(res.body.noClub).toBeUndefined();
    expect(res.body.kids.map((k) => k.clubberId)).toContain('662');
  });

  it('an extra club night on the calendar reads the page on a Monday; a cancelled Wednesday is a test day', async () => {
    const t = await monday();
    await t.storage.put('calendar', feed([{ date: MON, kind: 'club', title: 'Awana Clubs (extra night)' }]));
    const res = await t.call('GET', '/v1/desk/roster');
    expect(res.body.testDay).toBeUndefined();
    expect(t.reads.some((r) => r.path === '/clubber/checkin')).toBe(true);

    const w = await rig({ kids: [kid('662')] });
    await w.storage.put('calendar', feed([], { cancel: [NIGHT] }));
    expect((await w.call('GET', '/v1/desk/roster')).body.testDay).toMatchObject({ today: NIGHT, next: '2026-10-21' });
  });
});

describe('rehearsal mode lets a rehearsal through', () => {
  it('while the print station says it is rehearsing, a Monday reads the roster as on a club night; off again when it stops saying so', async () => {
    const t = await monday();
    const st = await t.station();
    expect((await st.call('POST', '/v1/station/extras', { rehearsal: true })).status).toBe(200);
    const res = await t.call('GET', '/v1/desk/roster');
    expect(res.status).toBe(200);
    expect(res.body.testDay).toBeUndefined();
    expect(res.body.kids.map((k) => k.clubberId)).toContain('662');
    expect(t.reads.some((r) => r.path === '/clubber/checkin')).toBe(true);
    // the station disarms: a test day again, at once
    await st.call('POST', '/v1/station/extras', { rehearsal: false });
    expect((await t.call('GET', '/v1/desk/roster')).body.testDay).toMatchObject({ today: MON });
    // armed, then the laptop goes away still armed: it lapses after REHEARSAL_FRESH_MS
    await st.call('POST', '/v1/station/extras', { rehearsal: true });
    t.clock.tick(REHEARSAL_FRESH_MS - 1000);
    expect(t.core.publisher.rehearsing()).toBe(true);
    t.clock.tick(2000);
    expect((await t.call('GET', '/v1/desk/roster')).body.testDay).toMatchObject({ today: MON });
    // a restart forgets it until the station's next post (it posts at least every minute or two)
    await st.call('POST', '/v1/station/extras', { rehearsal: true });
    t.restart();
    expect((await t.call('GET', '/v1/desk/roster')).body.testDay).toMatchObject({ today: MON });
  });

  it('a desk check-in on a Monday goes through during a rehearsal', async () => {
    const t = await monday();
    const st = await t.station();
    await st.call('POST', '/v1/station/extras', { rehearsal: true });
    const { bundle } = await sealJob([st], { name: 'sealed' }, { night: MON });
    const res = await t.call('POST', '/v1/desk/checkin', { night: MON, clubberId: '662', items: {}, historyRow: row('checkin', MON), job: bundle });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, already: false });
    expect(t.checkinPosts).toBe(1);
  });
});

describe('desk writes on a day with no club', () => {
  it('check-out and a late BARF friend are refused no-club: no read, no claim, no job, no post', async () => {
    const t = await monday();
    const st = await t.station();
    const base = { night: MON, clubberId: '662', historyRow: row('checkin', MON) };
    const answers = [
      await t.call('POST', '/v1/desk/checkout', { ...base, historyRow: row('checkout', MON) }),
      await t.call('POST', '/v1/desk/barf-late', { ...base, friendName: 'Sam', historyRow: row('barf-friend', MON), tagJob: null }),
      await t.call('POST', '/v1/desk/barf-late', { night: MON, clubberId: '662', recheck: true, items: { Bible: true } }),
    ];
    for (const a of answers) {
      expect(a.status).toBe(409);
      expect(a.body).toEqual({ ok: false, reason: 'no-club', today: MON, next: NIGHT });
    }
    expect(touched(t)).toBe(0);
    await Promise.all([t.core.ledger.load(), t.core.printq.load()]);
    expect(t.core.ledger.peek(MON, await t.core.tags.identity(MON, '662'))).toBeUndefined();
    expect(Object.keys(t.core.printq.jobs())).toHaveLength(0);
    expect((await st.call('GET', '/v1/print/next?max=10')).body.jobs).toEqual([]);
  });

  it('the wrong-night refusal is unchanged and comes first', async () => {
    const t = await monday();
    const res = await t.call('POST', '/v1/desk/checkin', { night: NIGHT, clubberId: '662', items: {}, historyRow: row(), job: null });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, reason: 'wrong-night', night: MON });
  });
});

// The older cloud check-in path (code review 2026-10-13): the relayed phone
// check-in (/checkin/classic, CloudPhone.checkIn) and POST /v1/cloud/checkin
// both reach Watcher.checkIn, which reads TwoTimTwo's check-in page and posts.
// The same club-day rule (the watcher's, the desk's too) refuses them before
// any read or post; a rehearsal still goes through; and the client's own
// posts are refused on such a day, so no path can forget the rule.
describe('the older cloud check-in path on a day with no club', () => {
  /** The phone page's relayCall: hand over, then collect the answer (the laptop is off). */
  const relay = async (t, method, path, body) => {
    const sent = await t.call('POST', '/v1/relay', { method, path, body });
    return (await t.call('GET', `/v1/relay/result?id=${sent.body.id}`)).body;
  };

  it('POST /v1/cloud/checkin, preview or confirmed, is refused no-club: no read, no post', async () => {
    const t = await monday();
    for (const body of [{ clubberId: '662' }, { clubberId: '662', confirm: true }, { name: 'Kit Tester', confirm: true }]) {
      const res = await t.call('POST', '/v1/cloud/checkin', body);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: false, error: 'no-club', today: MON, next: NIGHT });
    }
    expect(touched(t)).toBe(0);
  });

  it('the relayed phone check-in (/checkin/classic) is refused no-club, in the page\'s words: no read, no post, no print job', async () => {
    const t = await monday();
    const ans = await relay(t, 'POST', '/phone/checkin', { name: 'Kit Tester', options: { Bible: true } });
    expect(ans).toMatchObject({ done: true, status: 200, body: { queued: true } });
    const status = await relay(t, 'GET', `/phone/status/${ans.body.id}`);
    expect(status.body).toEqual({ status: 'failed', detail: 'there is no club tonight. Check in at the desk on a club night.' });
    expect(touched(t)).toBe(0);
  });

  it('a club day is unchanged: POST /v1/cloud/checkin posts', async () => {
    const t = await rig({ kids: [kid('662')] });
    const res = await t.call('POST', '/v1/cloud/checkin', { clubberId: '662', confirm: true });
    expect(res.body).toMatchObject({ ok: true, checkedIn: true });
    expect(t.tt.checkins).toHaveLength(1);
  });

  it('during a rehearsal a Monday check-in through POST /v1/cloud/checkin goes through', async () => {
    const t = await monday();
    const st = await t.station();
    await st.call('POST', '/v1/station/extras', { rehearsal: true });
    const res = await t.call('POST', '/v1/cloud/checkin', { clubberId: '662', confirm: true });
    expect(res.body).toMatchObject({ ok: true, checkedIn: true });
    expect(t.checkinPosts).toBe(1);
  });

  it('the TwoTimTwo client itself refuses a check-in, undo or check-out post on such a day (no future path can forget)', async () => {
    const t = await monday();
    const client = t.core.watcher.clientFor();
    const c = { clubberId: '662', calendarId: '368', events: ['40'], name: 'Kit Tester' };
    expect(await client.checkIn(c, { desk: true })).toEqual({ ok: false, error: 'no-club' });
    expect(await client.undoCheckIn(c, { desk: true })).toEqual({ ok: false, error: 'no-club' });
    expect(await client.checkOut(c)).toEqual({ ok: false, error: 'no-club' });
    expect(touched(t)).toBe(0);
    // ...and lets them through on a club day
    const w = await rig({ kids: [kid('662')] });
    expect((await w.core.watcher.clientFor().checkOut(c)).ok).toBe(true);
  });
});

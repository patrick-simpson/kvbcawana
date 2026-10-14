// Who brought a friend (BARF Night, owner 2026-10-11): recorded from every
// check-in path, sealed at rest, reported grouped by club, and read once by
// the scheduled 6:30 pm email through a one-night link.
import { describe, expect, it } from 'vitest';
import { SyncCore } from '../src/sync.js';
import { friendsReport, friendClubOf, KEEP_DAYS } from '../src/friends.js';
import { HOUSEHOLD_CSV, fakeTwoTimTwo, page, table } from './fixtures.js';
import { leaks } from './noleak.js';

const BARF_6PM = Date.parse('2026-10-14T22:00:00Z');   // Wednesday, 6:00 pm EDT
const ENV = { CLOUD_CHECKIN: 'shadow', TWOTIMTWO_USERNAME: 'checkin@example.org', TWOTIMTWO_PASSWORD: 'right-pass', INITIAL_PASSPHRASE: 'kennebec' };
const CHECKIN = '<html><body><div class="clubbers">' +
  '<div class="clubber checkin-box girl" recid="191" club_id="3"><div class="name">Sophie Tester</div><div class="club"><img alt="T&amp;T "></div></div>' +
  '</div><form id="checkinForm"><input id="calendar_id" name="calendar_id" value="374">' +
  '<input class="event" name="events[]" value="40" clubs="1,2,3" automatic="1"><label>Attendance</label>' +
  '<input class="event" name="events[]" value="410" clubs="1,2,3"><label>Brought a friend</label>' +
  '</form></body></html>';

function memoryStore() {
  const map = new Map();
  return {
    map,
    get: async (k) => (map.has(k) ? structuredClone(map.get(k)) : undefined),
    put: async (k, v) => { map.set(k, structuredClone(v)); },
    delete: async (k) => map.delete(k),
  };
}

async function setup({ laptopOn = false } = {}) {
  let t = BARF_6PM;
  const tt = fakeTwoTimTwo({ checkin: () => CHECKIN, households: () => HOUSEHOLD_CSV, report: () => page(table('Sparks ', [])) });
  tt.checkinName = 'Sophie Tester';
  const storage = memoryStore();
  const core = new SyncCore({ storage, env: ENV, fetchFn: tt.fetchFn, now: () => t, sleep: async (ms) => { t += ms; } });
  const login = await core.handle(new Request('https://sync.test/v1/login', { method: 'POST', body: JSON.stringify({ passphrase: 'kennebec' }) }));
  const { session } = await login.json();
  const call = async (method, path, body, auth = true) => {
    const res = await core.handle(new Request(`https://sync.test${path}`, {
      method, headers: { ...(auth ? { Authorization: `Bearer ${session}` } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    }));
    return { status: res.status, body: await res.json() };
  };
  if (laptopOn) await call('GET', '/v1/relay/next');
  return { core, tt, storage, call, tick: (ms) => { t += ms; }, now: () => t };
}

describe('the report, grouped by club', () => {
  it('clubs youngest first, children by name, a missing name kept as blank', () => {
    const r = friendsReport([
      { name: 'Zoe Tester', club: 'Sparks', friendName: 'Ana' },
      { name: 'Al Tester', club: 'Trek', friendName: '' },
      { name: 'Bea Tester', club: 'Sparks', friendName: 'Cy' },
      { name: 'Dot Tester', club: 'Cubbies', friendName: 'Ed' },
    ], '2026-10-14');
    expect(r).toEqual({ date: '2026-10-14', total: 4, clubs: [
      { club: 'Cubbies', kids: [{ name: 'Dot Tester', friend: 'Ed' }] },
      { club: 'Sparks', kids: [{ name: 'Bea Tester', friend: 'Cy' }, { name: 'Zoe Tester', friend: 'Ana' }] },
      { club: 'Trek', kids: [{ name: 'Al Tester', friend: '' }] },
    ] });
  });
});

describe('recording who brought a friend', () => {
  it('the laptop records one (signed in), and the report shows it', async () => {
    const s = await setup();
    expect((await s.call('POST', '/v1/cloud/friend', { name: 'Kit Tester', club: 'Sparks', clubberId: '662', friendName: 'Maya' }, false)).status).toBe(401);
    expect((await s.call('POST', '/v1/cloud/friend', { name: 'Kit Tester', club: 'Sparks', clubberId: '662', friendName: 'Maya' })).body).toEqual({ ok: true });
    const r = await s.call('GET', '/v1/cloud/friends');
    expect(r.body).toEqual({ date: '2026-10-14', total: 1, clubs: [{ club: 'Sparks', kids: [{ name: 'Kit Tester', friend: 'Maya' }] }] });
  });

  it('a second record for the same child fills in a missing name, and never doubles them', async () => {
    const s = await setup();
    await s.call('POST', '/v1/cloud/friend', { name: 'Kit Tester', club: 'Sparks', clubberId: '662', friendName: '' });   // the desk box
    await s.call('POST', '/v1/cloud/friend', { name: 'Kit Tester', club: 'Sparks', clubberId: '662', friendName: 'Maya' });
    await s.call('POST', '/v1/cloud/friend', { name: 'Kit Tester', club: 'Sparks', clubberId: '662', friendName: 'Other' });
    const r = await s.call('GET', '/v1/cloud/friends');
    expect(r.body.total).toBe(1);
    expect(r.body.clubs[0].kids).toEqual([{ name: 'Kit Tester', friend: 'Maya' }]);
  });

  it('typed text is one clean line', async () => {
    const s = await setup();
    await s.call('POST', '/v1/cloud/friend', { name: 'Kit Tester', club: 'Sparks', friendName: '  <b>Ma\nya</b> ' + 'x'.repeat(40) });
    const kid = (await s.call('GET', '/v1/cloud/friends')).body.clubs[0].kids[0];
    expect(kid.friend).not.toMatch(/[<>\n]/);
    expect(kid.friend.length).toBeLessThanOrEqual(24);
  });

  it('names are sealed at rest: no child or friend readable in storage', async () => {
    const s = await setup();
    await s.call('POST', '/v1/cloud/friend', { name: 'Kit Uniquename', club: 'Sparks', friendName: 'Maya Otherone' });
    expect(leaks(JSON.stringify([...s.storage.map.values()]), ['Uniquename', 'Otherone', 'Kit', 'Maya'])).toEqual([]);
  });

  it('a cloud check-in with Brought a friend records it, and the laptop\'s print job carries it', async () => {
    const s = await setup({ laptopOn: true });
    const sent = await s.call('POST', '/v1/relay', { method: 'POST', path: '/phone/checkin', body: { name: 'Sophie Tester', options: { Friend: true, FriendName: ' Maya ' } } });
    expect(sent.status).toBe(200);
    expect(s.tt.checkins[0].getAll('events[]')).toEqual(['40', '410']);
    expect((await s.call('GET', '/v1/cloud/friends')).body.clubs).toEqual([{ club: 'T&T', kids: [{ name: 'Sophie Tester', friend: 'Maya' }] }]);
    const job = (await s.call('GET', '/v1/relay/next')).body.requests[0];
    expect(job).toMatchObject({ path: '/print', job: true, body: { name: 'Sophie Tester', cloud: true, friend: true, friendName: 'Maya' } });
  });

  it('without Brought a friend nothing is recorded and the job is as before', async () => {
    const s = await setup({ laptopOn: true });
    await s.call('POST', '/v1/relay', { method: 'POST', path: '/phone/checkin', body: { name: 'Sophie Tester', options: { FriendName: 'Maya' } } });
    expect((await s.call('GET', '/v1/cloud/friends')).body.total).toBe(0);
    expect((await s.call('GET', '/v1/relay/next')).body.requests[0].body).toEqual({ name: 'Sophie Tester', clubName: 'T&T', clubberId: '191', cloud: true });
  });
});

describe('the scheduled email\'s link', () => {
  it('opens that one night\'s report with no session, until noon the next day', async () => {
    const s = await setup();
    await s.call('POST', '/v1/cloud/friend', { name: 'Kit Tester', club: 'Sparks', friendName: 'Maya' });
    expect((await s.call('POST', '/v1/cloud/friends-link', { date: '2026-10-14' }, false)).status).toBe(401);
    const link = (await s.call('POST', '/v1/cloud/friends-link', { date: '2026-10-14' })).body;
    expect(link).toMatchObject({ date: '2026-10-14', until: '2026-10-15T16:00:00.000Z' });
    const r = await s.call('GET', `/v1/cloud/friends-report?token=${link.token}`, undefined, false);
    expect(r.body).toMatchObject({ date: '2026-10-14', total: 1 });
    expect((await s.call('GET', '/v1/cloud/friends-report?token=wrongwrongwrongwrongwrong', undefined, false)).status).toBe(404);
    expect(JSON.stringify([...s.storage.map.entries()])).not.toContain(link.token);
    s.tick(19 * 60 * 60 * 1000);   // 2026-10-15 17:00 UTC
    expect((await s.call('GET', `/v1/cloud/friends-report?token=${link.token}`, undefined, false)).status).toBe(404);
  });
});

describe('tidying up', () => {
  it(`a night's records go after ${KEEP_DAYS} days, and expired links with them`, async () => {
    const s = await setup();
    await s.call('POST', '/v1/cloud/friend', { name: 'Kit Tester', club: 'Sparks', friendName: 'Maya' });
    await s.call('POST', '/v1/cloud/friends-link', { date: '2026-10-14' });
    s.tick((KEEP_DAYS + 1) * 24 * 60 * 60 * 1000);
    await s.core.cron();
    expect([...s.storage.map.keys()].filter((k) => k.startsWith('friends:'))).toEqual(['friends:nights', 'friends:links']);
    expect((await s.call('GET', '/v1/cloud/friends?date=2026-10-14')).body.total).toBe(0);
  });
});

describe('BARF Bag labels', () => {
  it('each child, then their named friend, club by club, as one job for the laptop', async () => {
    const s = await setup({ laptopOn: true });
    await s.call('POST', '/v1/cloud/friend', { name: 'Zoe Tester', club: 'Sparks', friendName: 'Ana' });
    await s.call('POST', '/v1/cloud/friend', { name: 'Dot Tester', club: 'Cubbies', friendName: 'Ed' });
    await s.call('POST', '/v1/cloud/friend', { name: 'Al Tester', club: 'Trek', friendName: '' });
    expect((await s.call('POST', '/v1/cloud/barf-bags', {}, false)).status).toBe(401);
    const r = await s.call('POST', '/v1/cloud/barf-bags', {});
    expect(r.body).toEqual({ ok: true, labels: 5, kids: 3, friends: 2, unnamed: 1, date: '2026-10-14' });
    const job = (await s.call('GET', '/v1/relay/next')).body.requests[0];
    expect(job).toMatchObject({ path: '/print-barf-bags', job: true, body: { names: ['Dot Tester', 'Ed', 'Zoe Tester', 'Ana', 'Al Tester'] } });
    // Each bag also says what the label must show: a child's club, whose friend a friend is.
    expect(job.body.bags).toEqual([
      { name: 'Dot Tester', club: 'Cubbies' },
      { name: 'Ed', club: '', friendOf: 'Dot Tester' },
      { name: 'Zoe Tester', club: 'Sparks' },
      { name: 'Ana', club: '', friendOf: 'Zoe Tester' },
      { name: 'Al Tester', club: 'Trek' },
    ]);
  });

  it('says why when it cannot: nobody tonight, or the laptop is off', async () => {
    const s = await setup({ laptopOn: true });
    expect((await s.call('POST', '/v1/cloud/barf-bags', {})).body).toMatchObject({ ok: false, reason: 'none' });
    const off = await setup();
    await off.call('POST', '/v1/cloud/friend', { name: 'Zoe Tester', club: 'Sparks', friendName: 'Ana' });
    expect((await off.call('POST', '/v1/cloud/barf-bags', {})).body).toMatchObject({ ok: false, reason: 'laptop-off', kids: 1 });
    expect(off.storage.map.get('relay:queue') || []).toEqual([]);
  });
});

describe('the friend\'s club', () => {
  it('keeps only a club the page offers, under its table name', () => {
    expect(friendClubOf('cubbie')).toBe('Cubbies');
    expect(friendClubOf(' T&T ')).toBe('T&T');
    expect(friendClubOf('Sparks')).toBe('Sparks');
    expect(friendClubOf('<b>Hax</b>')).toBe('');
    expect(friendClubOf('')).toBe('');
    expect(friendClubOf(7)).toBe('');
  });
  it('goes on the report and on the friend\'s bag', async () => {
    const s = await setup();
    await s.call('POST', '/v1/cloud/friend', { name: 'Kit Tester', club: 'Sparks', clubberId: '662', friendName: 'Maya', friendClub: 'Cubbies' });
    const r = await s.call('GET', '/v1/cloud/friends');
    expect(r.body.clubs[0].kids[0]).toEqual({ name: 'Kit Tester', friend: 'Maya', friendClub: 'Cubbies' });
  });
});

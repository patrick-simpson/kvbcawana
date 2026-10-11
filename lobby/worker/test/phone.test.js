// Cloud check-in for the phone page: the Worker answers the page's check-in
// itself, tells the laptop to print, and serves the roster with the laptop off.
import { describe, expect, it } from 'vitest';
import { SyncCore } from '../src/sync.js';
import { itemsToSend } from '../src/twotimtwo.js';
import { itemClubs } from '../src/phone.js';
import { LAPTOP_ONLINE_MS } from '../src/relay.js';
import { HOUSEHOLD_CSV, fakeTwoTimTwo, page, table } from './fixtures.js';

const SUNDAY = Date.parse('2026-10-11T18:45:00Z');
const ENV = { CLOUD_CHECKIN: 'shadow', TWOTIMTWO_USERNAME: 'checkin@example.org', TWOTIMTWO_PASSWORD: 'right-pass', INITIAL_PASSPHRASE: 'kennebec' };

// Tonight's items as KVBC has them: Attendance (every club, automatic), Bible
// and Brought a friend (Sparks, T&T, Trek only).
const ITEMS = [
  { id: '40', clubs: ['4', '1', '2', '3', '6'], automatic: true, label: 'Attendance' },
  { id: '707', clubs: ['2', '3', '6'], automatic: false, label: 'Bible' },
  { id: '410', clubs: ['2', '3', '6'], automatic: false, label: 'Brought a friend' },
  { id: '900', clubs: ['2', '3', '6'], automatic: false, label: 'Uniform' },
];
const CHECKIN = '<html><body><div class="clubbers">' +
  '<div class="clubber checkin-box girl" recid="191" club_id="3"><div class="name">Sophie Tester</div><div class="club"><img alt="T&amp;T "></div></div>' +
  '<div class="clubber checkin-box boy" recid="192" club_id="1"><div class="name">Cal Tester</div><div class="club"><img alt="Cubbies "></div></div>' +
  '</div><form id="checkinForm"><input id="calendar_id" name="calendar_id" value="374">' +
  '<select name="date"><option value="2026-10-14" selected>Oct 14</option></select>' +
  ITEMS.map((e) => `<input class="event" name="events[]" value="${e.id}" clubs="${e.clubs.join(',')}"${e.automatic ? ' automatic="1"' : ''}><label>${e.label}</label>`).join('') +
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

async function setup({ laptopOn = false, env = ENV, report, households = () => HOUSEHOLD_CSV } = {}) {
  let t = SUNDAY;
  const tt = fakeTwoTimTwo({ checkin: () => CHECKIN, households, report: report || (() => page(table('Trek ', [{ id: 55, name: 'Tia Tester' }]))) });
  tt.checkinName = 'Sophie Tester';
  const storage = memoryStore();
  const core = new SyncCore({ storage, env, fetchFn: tt.fetchFn, now: () => t });
  const login = await core.handle(new Request('https://sync.test/v1/login', { method: 'POST', body: JSON.stringify({ passphrase: 'kennebec' }) }));
  const { session } = await login.json();
  const call = async (method, path, body) => {
    const res = await core.handle(new Request(`https://sync.test${path}`, {
      method, headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    }));
    return { status: res.status, body: await res.json() };
  };
  if (laptopOn) await call('GET', '/v1/relay/next');   // the laptop's poll marks it online
  // The page's own relayCall: hand over, then collect the answer.
  const relay = async (method, path, body) => {
    const sent = await call('POST', '/v1/relay', { method, path, body });
    const got = await call('GET', `/v1/relay/result?id=${sent.body.id}`);
    return got.body;
  };
  return { core, tt, storage, call, relay, tick: (ms) => { t += ms; } };
}

describe('which check-in items go with a child', () => {
  it('Attendance always; Bible and friend only when ticked; only for the child\'s club', () => {
    expect(itemsToSend(ITEMS, '3')).toEqual(['40']);
    expect(itemsToSend(ITEMS, '3', { Bible: true })).toEqual(['40', '707']);
    expect(itemsToSend(ITEMS, '3', { Bible: true, Friend: true })).toEqual(['40', '707', '410']);
    expect(itemsToSend(ITEMS, '3', { Friend: true })).toEqual(['40', '410']);
    // Cubbies have neither, so a tick sends nothing extra.
    expect(itemsToSend(ITEMS, '1', { Bible: true, Friend: true })).toEqual(['40']);
    // Not "true" is not ticked.
    expect(itemsToSend(ITEMS, '3', { Bible: 'yes', Friend: 1 })).toEqual(['40']);
  });

  it('the phone card offers Bible and friend for the clubs TwoTimTwo has them in', () => {
    expect(itemClubs(ITEMS)).toEqual({ bible: ['Sparks', 'T&T', 'Trek'], friend: ['Sparks', 'T&T', 'Trek'] });
  });
});

describe('the phone page\'s check-in, answered by the Worker', () => {
  it('checks in on TwoTimTwo with Bible and friend, and the page hears "done"', async () => {
    const s = await setup();
    const ans = await s.relay('POST', '/phone/checkin', { name: 'Sophie Tester', options: { Bible: true, Friend: true } });
    expect(ans).toMatchObject({ done: true, status: 200, body: { queued: true } });
    expect(s.tt.checkins).toHaveLength(1);
    expect(s.tt.checkins[0].get('clubber_id')).toBe('191');
    expect(s.tt.checkins[0].get('calendar_id')).toBe('374');
    expect(s.tt.checkins[0].getAll('events[]')).toEqual(['40', '707', '410']);
    const status = await s.relay('GET', `/phone/status/${ans.body.id}`);
    expect(status).toEqual({ done: true, status: 200, body: { status: 'done', detail: '' } });
  });

  it('a refusal says why, in the page\'s words', async () => {
    const s = await setup();
    s.tt.checkinReply = '<html><body>error</body></html>';
    const ans = await s.relay('POST', '/phone/checkin', { name: 'Sophie Tester', options: {} });
    const status = await s.relay('GET', `/phone/status/${ans.body.id}`);
    expect(status.body).toEqual({ status: 'failed', detail: 'TwoTimTwo did not record the check-in. Check in at the desk.' });
    const missing = await s.relay('POST', '/phone/checkin', { name: 'Nobody Here' });
    expect((await s.relay('GET', `/phone/status/${missing.body.id}`)).body.detail).toContain('not on TwoTimTwo’s check-in list');
  });

  it('with the laptop on, it is told to print the tag at once, as a job no page can send', async () => {
    const s = await setup({ laptopOn: true });
    await s.relay('POST', '/phone/checkin', { name: 'Sophie Tester', options: { Bible: true } });
    const next = await s.call('GET', '/v1/relay/next');
    expect(next.body.requests).toEqual([{ id: expect.stringMatching(/^[0-9a-f]{24}$/), method: 'POST', path: '/print', job: true,
      body: { name: 'Sophie Tester', clubName: 'T&T', clubberId: '191', cloud: true } }]);
    // A page cannot ask for a print itself: /print is not a phone route.
    expect((await s.call('POST', '/v1/relay', { method: 'POST', path: '/print', body: { name: 'X Y' } })).status).toBe(400);
  });

  it('with the laptop off, no print job waits for it', async () => {
    const s = await setup();
    await s.relay('POST', '/phone/checkin', { name: 'Sophie Tester' });
    expect(s.storage.map.get('relay:queue') || []).toEqual([]);
  });

  it('cloud check-in off: the check-in goes to the laptop as before', async () => {
    const s = await setup({ env: { ...ENV, CLOUD_CHECKIN: 'off' }, laptopOn: true });
    const sent = await s.call('POST', '/v1/relay', { method: 'POST', path: '/phone/checkin', body: { name: 'Sophie Tester' } });
    const next = await s.call('GET', '/v1/relay/next');
    expect(next.body.requests).toEqual([{ id: sent.body.id, method: 'POST', path: '/phone/checkin', body: { name: 'Sophie Tester' } }]);
    expect(s.tt.checkins).toHaveLength(0);
  });

  it('keeps no name in storage once the page has its answer', async () => {
    const s = await setup();
    const ans = await s.relay('POST', '/phone/checkin', { name: 'Sophie Tester' });
    await s.relay('GET', `/phone/status/${ans.body.id}`);
    expect(JSON.stringify([...s.storage.map.values()])).not.toMatch(/Sophie|Tester/);
  });
});

describe('the roster and tonight with the laptop off', () => {
  it('the roster comes from TwoTimTwo: the check-in page, plus today\'s report as checked in', async () => {
    const s = await setup();
    const ans = await s.relay('POST', '/phone/roster', {});
    expect(ans.status).toBe(200);
    expect(ans.body.kids).toEqual([
      { name: 'Sophie Tester', club: 'T&T', checkedIn: false, removedHere: false, inactive: false },
      { name: 'Cal Tester', club: 'Cubbies', checkedIn: false, removedHere: false, inactive: false },
      { name: 'Tia Tester', club: 'Trek', checkedIn: true, removedHere: false, inactive: false },
    ]);
    expect(ans.body.items).toEqual({ bible: ['Sparks', 'T&T', 'Trek'], friend: ['Sparks', 'T&T', 'Trek'] });
    expect(ans.body.households).toEqual([['Sophie Tester', 'Cal Tester'], ['Ann Smith', 'Ben Smith', 'Cy Smith']]);
  });

  it('tonight is today\'s report, in the laptop\'s shape', async () => {
    const s = await setup();
    const ans = await s.relay('POST', '/phone/tonight', {});
    expect(ans.body).toMatchObject({ date: '2026-10-11', checkedIn: 1, byClub: { Trek: 1 }, countSource: 'twotimtwo',
      entries: [{ key: 'id:55', firstName: 'Tia', lastName: 'Tester', clubName: 'Trek', clubberId: '55', checkedOut: false, visitor: false }] });
  });

  it('with the laptop on, both still come from the laptop (families, history)', async () => {
    const s = await setup({ laptopOn: true });
    await s.call('POST', '/v1/relay', { method: 'POST', path: '/phone/roster', body: {} });
    await s.call('POST', '/v1/relay', { method: 'POST', path: '/phone/tonight', body: {} });
    const next = await s.call('GET', '/v1/relay/next');
    expect(next.body.requests.map((r) => r.path)).toEqual(['/phone/roster', '/phone/tonight']);
  });

  it('a laptop that stopped asking counts as off after a minute', async () => {
    const s = await setup({ laptopOn: true });
    s.tick(LAPTOP_ONLINE_MS + 1000);
    const ans = await s.relay('POST', '/phone/roster', {});
    expect(ans.body.kids.length).toBe(3);
  });
});

describe('families on the roster (owner, 2026-10-11)', () => {
  // The laptop answers a roster through the relay, as phone-relay.js does.
  const laptopAnswers = async (s, body) => {
    const sent = await s.call('POST', '/v1/relay', { method: 'POST', path: '/phone/roster', body: {} });
    const next = await s.call('GET', '/v1/relay/next');
    await s.call('POST', '/v1/relay/answer', { id: next.body.requests[0].id, status: 200, body });
    return (await s.call('GET', `/v1/relay/result?id=${sent.body.id}`)).body;
  };
  const LAPTOP_ROSTER = { kids: [{ name: 'Sophie Tester', club: 'T&T', checkedIn: false }], households: [], items: { bible: [], friend: [] }, recent: { ready: true, names: [] } };

  it('a laptop that has not shared families gets TwoTimTwo\'s, and the Bible / friend clubs', async () => {
    const s = await setup({ laptopOn: true });
    const got = await laptopAnswers(s, LAPTOP_ROSTER);
    expect(got.status).toBe(200);
    expect(got.body.households).toEqual([['Sophie Tester', 'Cal Tester'], ['Ann Smith', 'Ben Smith', 'Cy Smith']]);
    expect(got.body.items).toEqual({ bible: ['Sparks', 'T&T', 'Trek'], friend: ['Sparks', 'T&T', 'Trek'] });
    expect(got.body.recent).toEqual({ ready: true, names: [] });   // the laptop's own, kept
  });

  it('families the laptop did share are kept as they are', async () => {
    const s = await setup({ laptopOn: true });
    const mine = { ...LAPTOP_ROSTER, households: [['A One', 'B One']], items: { bible: ['Sparks'], friend: [] } };
    const got = await laptopAnswers(s, mine);
    expect(got.body.households).toEqual([['A One', 'B One']]);
    expect(got.body.items).toEqual({ bible: ['Sparks'], friend: [] });
    expect(s.tt.calls.some((c) => c.path === '/household/csv')).toBe(false);
  });

  it('the export is read once per half hour, not per roster', async () => {
    const s = await setup();
    await s.relay('POST', '/phone/roster', {});
    await s.relay('POST', '/phone/roster', {});
    expect(s.tt.calls.filter((c) => c.path === '/household/csv')).toHaveLength(1);
  });

  it('no export (no permission, TwoTimTwo down): children one by one, nothing breaks', async () => {
    const s = await setup({ households: () => '<html><body>Not allowed</body></html>' });
    const ans = await s.relay('POST', '/phone/roster', {});
    expect(ans.status).toBe(200);
    expect(ans.body.households).toEqual([]);
    expect(ans.body.familiesError).toBe('households-unreadable');
    expect(ans.body.kids.length).toBe(3);
  });

  it('no address, phone or name reaches storage', async () => {
    const s = await setup({ laptopOn: true });
    await laptopAnswers(s, LAPTOP_ROSTER);
    await s.relay('POST', '/phone/roster', {});
    expect(JSON.stringify([...s.storage.map.values()])).not.toMatch(/Elm|555|Sophie|Smith|Pat Tester/);
  });
});

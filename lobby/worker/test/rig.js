// A whole Worker over a stand-in TwoTimTwo, for the online check-in tests:
// SyncCore + memory storage + a fake clock whose sleep moves time, a signed-in
// session, registered stations, and a TwoTimTwo whose report the test edits,
// whose check-in / undo / check-out posts it can break, and whose every data
// read is timed (the 5 s clock is checked against it).
import { newRowId } from '../../shared/cloud-crypto.js';
import { SyncCore } from '../src/sync.js';
import { CHECKIN_PAGE, fakeTwoTimTwo, page, table } from './fixtures.js';
import { fakeClock, makeStation, memoryStore, sealJob } from './helpers.js';

export const WED_6PM = Date.parse('2026-10-14T22:00:00Z');
export const NIGHT = '2026-10-14';
export const ENV = {
  CLOUD_CHECKIN: 'shadow', CLOUD_PRINT: 'on', TWOTIMTWO_USERNAME: 'checkin@example.org',
  TWOTIMTWO_PASSWORD: 'right-pass', INITIAL_PASSPHRASE: 'kennebec',
};

/** A sealed-looking history row (the Worker only checks its shape). */
export const row = (kind = 'checkin', night = NIGHT) => ({
  id: newRowId(), night, kind, v: 1, kid: '0123456789abcdef', epk: `BA${'A'.repeat(85)}=`, iv: 'A'.repeat(16), ct: 'A'.repeat(1388),
});

export async function rig({ env = {}, kids = [], households = null, start = WED_6PM, storage = memoryStore(), clock = fakeClock(start) } = {}) {
  const night = { kids: [...kids], count: null };
  const render = () => {
    const clubs = [...new Set(night.kids.map((k) => k.club))];
    return page(...clubs.map((club) => {
      const these = night.kids.filter((k) => k.club === club);
      return table(`${club} `, these.map((k) => ({ id: k.id, name: k.name, friend: k.friend })), { count: night.count ?? these.length });
    }), clubs.length ? '' : table('Sparks ', []));
  };
  const tt = fakeTwoTimTwo({ report: render, checkin: () => CHECKIN_PAGE, households });
  tt.checkinName = 'Kit Tester';
  const faults = { checkin: null, undo: null, checkout: null };
  /** When each data page was read: the clock's invariant. */
  const reads = [];
  const posts = { undo: [], checkout: [] };
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    if (method === 'GET' && !u.pathname.startsWith('/site/')) reads.push({ at: clock.t, path: u.pathname });
    const fault = (u.pathname === '/clubber/checkinclubber' && faults.checkin)
      || (u.pathname === '/clubber/checkinclubberundo' && faults.undo)
      || (u.pathname === '/clubber/checkout' && faults.checkout);
    if (fault === 'timeout') throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    if (u.pathname === '/clubber/checkinclubberundo' && method === 'POST') {
      posts.undo.push(new URLSearchParams(init.body));
      return new Response(fault === 'refuse' ? '<b>not checked in</b>' : '<b>(checkin undone)</b>', { status: 200 });
    }
    if (u.pathname === '/clubber/checkout' && method === 'POST') {
      posts.checkout.push(new URLSearchParams(init.body));
      return new Response(fault === 'refuse' ? 'no' : 'OK', { status: 200 });
    }
    if (fault === 'refuse') return new Response('<html><body>Something went wrong</body></html>', { status: 200 });
    return tt.fetchFn(url, init);
  };
  const alarm = { at: null };
  /** Every frame the Worker broadcast to the live screens: [{e, p}]. */
  const sent = [];
  const make = () => new SyncCore({
    storage, env: { ...ENV, ...env }, fetchFn, now: clock.now, sleep: clock.sleep,
    alarms: { set: (at) => { alarm.at = at; }, get: () => alarm.at },
    broadcast: (text) => { sent.push(JSON.parse(text)); return 1; },
  });
  const r = {
    clock, storage, tt, night, faults, reads, posts, alarm, sent, core: make(), session: '',
    /** A new object over the same storage: a Durable Object restart. */
    restart() { r.core = make(); r.wire(); return r.core; },
    wire() { r.watcher = r.core.watcher; },
    async call(method, path, body, headers = {}) {
      const res = await r.core.handle(new Request(`https://sync.test${path}`, {
        method, headers: { Authorization: `Bearer ${r.session}`, 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }));
      return { status: res.status, body: await res.json() };
    },
    /** As a registered station. */
    asStation(st) {
      return (method, path, body) => r.call(method, path, body, { 'X-Station': st.body.stationId });
    },
    async station(stationId = 'station-aaaaaaaa', name = 'Desk laptop') {
      const st = await makeStation(stationId, name);
      const res = await r.call('POST', '/v1/station/register', st.body);
      if (res.status !== 200) throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`);
      st.call = r.asStation(st);
      return st;
    },
    /** A desk check-in body, sealed to these stations. */
    async deskBody(stations, extra = {}) {
      const { bundle } = stations.length ? await sealJob(stations, { name: 'sealed' }, { night: NIGHT }) : { bundle: null };
      return { night: NIGHT, clubberId: '662', items: {}, historyRow: row(), job: bundle, ...extra };
    },
  };
  // A history key is stored (the desk refuses a row with no key to check its kid against):
  // a stand-in public value, since the Worker only compares the kid.
  if (!(await storage.get('history:pub'))) await storage.put('history:pub', { pub: 'A'.repeat(87), kid: '0123456789abcdef' });
  const login = await r.core.handle(new Request('https://sync.test/v1/login', { method: 'POST', body: JSON.stringify({ passphrase: 'kennebec' }) }));
  r.session = (await login.json()).session;
  r.wire();
  return r;
}

export const kid = (id, club = 'Sparks', name = `Kid${id} Tester`) => ({ id, name, club });

// The desk page's transport and sealing (site/desk/desk-transport.js) against a
// stand-in Worker that speaks routes.md and, like the real one, only checks
// shapes: every seal is the browser's, and the tests open them with the
// station's and the history key's own private keys to prove what is inside.
import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import * as cc from '../../lobby/shared/cloud-crypto.js';
import { createDesk, DeskError, HISTORY_PIN_STORAGE, printLabel, SESSION_STORAGE } from '../desk/desk-transport.js';

const PASS = 'kennebec';
const SESSION = 'v1.1.1760000000.abcdefghijklmnopqrstuvwxyz0123';
const NOW = Date.parse('2026-10-14T22:00:00Z');   // Wednesday 6 pm Eastern
const NIGHT = '2026-10-14';

let historyKey;   // {pub, kid, wrapped} from createHistoryKey
let ring;         // the history key's private ring, to open rows
const salt = cc.bytesToBase64(cc.randomBytes(16));

async function station(id) {
  const kp = await cc.generateKeyPair();
  return { stationId: id, name: id, pub: kp.publicKey, kid: kp.kid, ring: await cc.keyRing(await cc.importPrivateKey(kp.privateJwk), kp.publicKey) };
}
const asList = (stns) => stns.map(({ stationId, name, pub, kid }) => ({ stationId, name, pub, kid }));

before(async () => {
  historyKey = await cc.createHistoryKey(PASS);
  ring = await cc.keyRing(await cc.unwrapPrivateKey(historyKey.wrapped, PASS, historyKey.pub), historyKey.pub);
});

/** A stand-in Worker: routes.md's shapes, in memory. */
function worker({ stations = [], params = 'v2', history = 'login', legacy = false, upgrade = false, check } = {}) {
  const w = { calls: [], stations, historyKey: history === 'none' ? null : historyKey, busy: 0, expire: false, stationsChangedOnce: null, checkins: [], verifier: null };
  w.fetch = async (url, init = {}) => {
    const path = String(url).replace(/^\/api/, '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    w.calls.push({ method: init.method || 'GET', path, body, auth: init.headers && init.headers.Authorization });
    const json = (status, b, headers = {}) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', ...headers } });
    if (path === '/v1/auth/params') return params === 'v2' ? json(200, { v: 2, salt, iter: 600000, legacy, upgrade }) : json(404, { error: 'Not found.' });
    if (path === '/v1/login') {
      if (body.authKey) {
        const mine = await cc.deriveKeys(PASS, salt, 600000);
        if (body.authKey !== cc.bytesToBase64(mine.authKey)) return body.passphrase === PASS ? json(200, loginAnswer()) : json(401, { error: 'no' });
      } else if (cc.normalizePassphrase(body.passphrase) !== PASS) return json(401, { error: 'no' });
      return json(200, loginAnswer());
    }
    if (w.expire) return json(401, { error: 'signed out' });
    if (path === '/v1/history/key' && (init.method || 'GET') === 'GET') return w.historyKey ? json(200, { ...w.historyKey, prev: null }) : json(404, { error: 'none' });
    if (path === '/v1/history/key' && init.method === 'PUT') { w.historyKey = body; return json(201, { ok: true }); }
    if (path === '/v1/stations') return json(200, asList(w.stations));
    if (w.busy > 0 && path.startsWith('/v1/desk/')) { w.busy -= 1; return json(429, { ok: false, reason: 'read-busy', retryAfterMs: 4200 }); }
    if (w.stationsChangedOnce && path === '/v1/desk/checkin') {
      const next = w.stationsChangedOnce; w.stationsChangedOnce = null;
      w.stations = next;
      return json(409, { ok: false, reason: 'stations-changed', what: 'job', stations: asList(next) });
    }
    if (path === '/v1/desk/checkin' || path === '/v1/desk/undo' || path === '/v1/desk/checkout' || path === '/v1/print/reprint') {
      if (check) { const verdict = check(path, body, w); if (verdict) return verdict; }
      if (path === '/v1/desk/checkin') w.checkins.push(body);
      return json(200, path === '/v1/desk/checkin' ? { ok: true, already: false, jobId: body.job ? body.job.id : null, gen: 1, history: 'off' } : { ok: true });
    }
    return json(404, { error: 'Not found.' });
  };
  function loginAnswer() {
    return { session: SESSION, displayKey: 'x'.repeat(43) + '=', state: {}, history: w.historyKey ? { pub: w.historyKey.pub, kid: w.historyKey.kid, wrapped: w.historyKey.wrapped } : null };
  }
  return w;
}

function memoryStore() {
  const m = new Map();
  return { m, get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v), remove: (k) => m.delete(k) };
}
const make = (w, store = memoryStore()) => ({ desk: createDesk({ cc, fetch: w.fetch, store, now: () => NOW }), store });
const kid = { clubberId: '662', name: 'Kit Tester', club: 'Sparks' };

describe('sign-in, passphrase v2', () => {
  it('derives authKey in the browser, never sends or stores the passphrase, pins the proven history key', async () => {
    const w = worker();
    const { desk, store } = make(w);
    const r = await desk.signIn(PASS);
    assert.equal(r.history, true);
    const login = w.calls.find((c) => c.path === '/v1/login');
    assert.deepEqual(Object.keys(login.body), ['authKey']);
    assert.ok(!JSON.stringify(w.calls).includes(PASS));
    assert.ok(![...store.m.values()].some((v) => v.includes(PASS)));
    assert.equal(store.m.get(SESSION_STORAGE), SESSION);
    assert.equal(JSON.parse(store.m.get(HISTORY_PIN_STORAGE)).pub, historyKey.pub);
    assert.equal(desk.hasHistory, true);
  });

  it('a wrong passphrase is "wrong"; the first v2 client after the deploy upgrades with passphrase + authKey once', async () => {
    const { desk } = make(worker());
    await assert.rejects(desk.signIn('nope'), { code: 'wrong' });
    const w = worker({ legacy: true });
    const orig = w.fetch;
    w.fetch = async (url, init) => {   // no v2 verifier yet: a bare authKey is refused
      const body = init && init.body ? JSON.parse(init.body) : {};
      if (String(url).endsWith('/v1/login') && body.authKey && !body.passphrase) { w.calls.push({ path: '/v1/login', body }); return new Response(JSON.stringify({ reason: 'upgrade-needed' }), { status: 401 }); }
      return orig(url, init);
    };
    await make(w).desk.signIn(PASS);
    const logins = w.calls.filter((c) => c.path === '/v1/login');
    assert.equal(logins.length, 2);
    assert.deepEqual(Object.keys(logins[1].body).sort(), ['authKey', 'passphrase']);
  });

  it('when the Worker says an upgrade is due, the first sign-in is ONE login with the passphrase and its authKey', async () => {
    const w = worker({ legacy: true, upgrade: true });
    await make(w).desk.signIn(PASS);
    const logins = w.calls.filter((c) => c.path === '/v1/login');
    assert.equal(logins.length, 1);
    assert.deepEqual(Object.keys(logins[0].body).sort(), ['authKey', 'passphrase']);
  });

  it('a Worker without v2 yet gets today\'s login', async () => {
    const w = worker({ params: 'none' });
    await make(w).desk.signIn(PASS);
    assert.deepEqual(w.calls.find((c) => c.path === '/v1/login').body, { passphrase: PASS });
  });

  it('makes the history key when there is none (first writer wins) and proves it', async () => {
    const w = worker({ history: 'none' });
    const { desk } = make(w);
    await desk.signIn(PASS);
    assert.ok(w.historyKey && w.historyKey.pub);
    assert.equal(desk.hasHistory, true);
    assert.ok(await cc.unwrapPrivateKey(w.historyKey.wrapped, PASS, w.historyKey.pub));
  });

  it('refuses a history key that is not the one this device pinned, or does not open', async () => {
    const other = await cc.createHistoryKey(PASS);
    const store = memoryStore();
    store.set(HISTORY_PIN_STORAGE, JSON.stringify({ pub: other.pub, kid: other.kid }));
    await assert.rejects(make(worker(), store).desk.signIn(PASS), { code: 'history-mismatch' });
    const bad = worker();
    bad.historyKey = { ...historyKey, wrapped: { ...historyKey.wrapped, ct: historyKey.wrapped.ct.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) } };
    await assert.rejects(make(bad).desk.signIn(PASS), { code: 'history-mismatch' });
  });

  it('restore() takes up a session only with a pinned history key', async () => {
    const store = memoryStore();
    store.set(SESSION_STORAGE, SESSION);
    assert.equal(make(worker(), store).desk.restore(), 'need-passphrase');
    store.set(HISTORY_PIN_STORAGE, JSON.stringify({ pub: historyKey.pub, kid: historyKey.kid }));
    const { desk } = make(worker(), store);
    assert.equal(desk.restore(), 'ready');
    assert.equal(desk.signedIn, true);
    assert.equal(desk.hasHistory, true);
  });
});

describe('checking in', () => {
  it('seals the print job to every station and the history row to the history key; no name in clear for a clubber', async () => {
    const a = await station('station-aaaaaaaa');
    const b = await station('station-bbbbbbbb');
    const w = worker({ stations: [a, b] });
    const { desk } = make(w);
    await desk.signIn(PASS);
    const out = await desk.checkIn(kid, { bible: true, friend: true, friendName: '  Sam  ' });
    assert.equal(out.already, false);
    const post = w.checkins[0];
    assert.equal(post.night, NIGHT);
    assert.equal(post.clubberId, '662');
    assert.deepEqual(post.items, { Bible: true, Friend: true });
    const { job: _job, historyRow: _row, ...plainPost } = post;   // the sealed parts are random base64
    const wire = JSON.stringify(plainPost);
    assert.ok(!/Kit|Tester|Sam/.test(wire), 'no name or friend in clear');
    assert.equal(post.job.kind, 'print-job');
    assert.equal(post.job.night, NIGHT);
    assert.equal(post.job.to.length, 2);
    for (const s of [a, b]) {
      const job = await cc.openAsStation(s.ring, post.job);
      assert.deepEqual(job, { route: '/print', body: { name: 'Kit Tester', clubName: 'Sparks', clubberId: '662', friend: true, friendName: 'Sam' }, clubberId: '662', source: 'desk' });
    }
    assert.equal(post.historyRow.kind, 'checkin');
    assert.equal(post.historyRow.ct.length, 1388);
    assert.equal(post.historyRow.kid, historyKey.kid);
    const row = await cc.openRow(ring, post.historyRow);
    assert.deepEqual(row, { ts: Date.parse('2026-10-14T22:00:00.000Z'), first: 'Kit', last: 'Tester', club: 'Sparks', clubberId: '662', friend: true, friendFirst: 'Sam', source: 'desk' });
    assert.ok(!('allergies' in row) && !cc.hasMedicalKey(row));
  });

  it('a visitor sends first, last and club (the Worker hashes them) and no clubber id', async () => {
    const a = await station('station-aaaaaaaa');
    const w = worker({ stations: [a] });
    const { desk } = make(w);
    await desk.signIn(PASS);
    await desk.checkIn({ name: 'Mia Visitor Jones', club: 'Cubbies', visitor: true }, {});
    const post = w.checkins[0];
    assert.equal(post.clubberId, undefined);
    assert.deepEqual(post.visitor, { first: 'Mia', last: 'Visitor Jones', club: 'Cubbies' });
    assert.deepEqual(post.items, {});
    assert.deepEqual((await cc.openAsStation(a.ring, post.job)).body, { name: 'Mia Visitor Jones', clubName: 'Cubbies', visitor: true });
    assert.equal(post.historyRow.kind, 'visitor');
    const vrow = await cc.openRow(ring, post.historyRow);
    assert.deepEqual([vrow.first, vrow.last, vrow.clubberId], ['Mia', 'Visitor Jones', undefined]);
  });

  it('on 409 stations-changed it reseals to the list the Worker sends, so the new station can open the job', async () => {
    const a = await station('station-aaaaaaaa');
    const b = await station('station-bbbbbbbb');
    const w = worker({ stations: [a] });
    const { desk } = make(w);
    await desk.signIn(PASS);
    w.stationsChangedOnce = [a, b];
    const out = await desk.checkIn(kid, { bible: true });
    assert.equal(out.already, false);
    assert.equal(w.calls.filter((c) => c.path === '/v1/desk/checkin').length, 2);
    const post = w.checkins[0];
    assert.equal(post.job.to.length, 2);
    assert.equal((await cc.openAsStation(b.ring, post.job)).body.name, 'Kit Tester');
  });

  it('with no station registered the job is null and the row is still sealed', async () => {
    const w = worker({ stations: [] });
    const { desk } = make(w);
    await desk.signIn(PASS);
    await desk.checkIn(kid, {});
    assert.equal(w.checkins[0].job, null);
    assert.equal(w.checkins[0].historyRow.kind, 'checkin');
  });

  it('fails closed: no history key, nothing is posted', async () => {
    const w = worker({ history: 'none', stations: [] });
    w.fetch = ((orig) => async (url, init) => (String(url) === '/api/v1/history/key' && init.method === 'PUT' ? new Response('{}', { status: 404 }) : orig(url, init)))(w.fetch);
    const { desk } = make(w);
    await desk.signIn(PASS);
    assert.equal(desk.hasHistory, false);
    await assert.rejects(desk.checkIn(kid, {}), { code: 'no-history' });
    assert.equal(w.calls.filter((c) => c.path.startsWith('/v1/desk/')).length, 0);
  });

  it('fails closed when a seal cannot be made (a station key that is not a key): nothing is posted', async () => {
    const w = worker({ stations: [{ stationId: 'station-badbadbad', name: 'bad', pub: 'AAAA', kid: '0123456789abcdef' }] });
    const { desk } = make(w);
    await desk.signIn(PASS);
    await assert.rejects(desk.checkIn(kid, {}), { code: 'unsealed' });
    assert.equal(w.calls.filter((c) => c.path === '/v1/desk/checkin').length, 0);
  });

  it('the 429 is "busy" with the Worker\'s retryAfterMs; a 401 signs out; an unreachable Worker says so', async () => {
    const w = worker({ stations: [] });
    const { desk, store } = make(w);
    await desk.signIn(PASS);
    w.busy = 1;
    await assert.rejects(desk.checkIn(kid, {}), (e) => e instanceof DeskError && e.code === 'busy' && e.retryAfterMs === 4200 && /5s/.test(e.message));
    w.expire = true;
    await assert.rejects(desk.roster(), { code: 'signed-out' });
    assert.equal(store.m.get(SESSION_STORAGE), undefined);
    const down = createDesk({ cc, fetch: async () => { throw new TypeError('offline'); }, store: memoryStore(), now: () => NOW });
    await assert.rejects(down.signIn(PASS), { code: 'unreachable' });
  });

  it('words a refusal and an unsure answer', async () => {
    const w = worker({ stations: [], check: (path) => (path === '/v1/desk/checkin' ? new Response(JSON.stringify({ ok: false, reason: 'not-found' }), { status: 409 }) : null) });
    const { desk } = make(w);
    await desk.signIn(PASS);
    await assert.rejects(desk.checkIn(kid, {}), (e) => e.code === 'refused' && e.reason === 'not-found' && /does not list/.test(e.message));
    const w2 = worker({ stations: [], check: () => new Response(JSON.stringify({ ok: false, reason: 'unsure', retry: true }), { status: 504 }) });
    const d2 = make(w2).desk;
    await d2.signIn(PASS);
    await assert.rejects(d2.checkIn(kid, {}), { code: 'unsure' });
  });
});

describe('undo, check out and the one-off tag', () => {
  it('undo and check-out seal their own history rows, for a clubber and for a visitor', async () => {
    const w = worker({ stations: [] });
    const bodies = [];
    w.fetch = ((orig) => async (url, init) => { if (/desk\/(undo|checkout)/.test(String(url))) bodies.push([String(url), JSON.parse(init.body)]); return orig(url, init); })(w.fetch);
    const { desk } = make(w);
    await desk.signIn(PASS);
    await desk.undo(kid);
    await desk.checkout({ ...kid, clubberId: '700', name: 'Lu Tester' });
    await desk.undo({ name: 'Mia Jones', club: 'Cubbies', visitor: true });
    assert.equal(bodies[0][0], '/api/v1/desk/undo');
    assert.equal(bodies[0][1].clubberId, '662');
    assert.equal(bodies[0][1].historyRow.kind, 'undo');
    assert.equal(bodies[1][1].historyRow.kind, 'checkout');
    assert.deepEqual(await cc.openRow(ring, bodies[1][1].historyRow), { ts: Date.parse('2026-10-14T22:00:00.000Z'), first: 'Lu', last: 'Tester', club: 'Sparks', clubberId: '700', source: 'desk' });
    assert.equal(bodies[0][1].club, 'Sparks');
    assert.equal(bodies[1][1].club, 'Sparks');
    assert.deepEqual(bodies[2][1].visitor, { first: 'Mia', last: 'Jones', club: 'Cubbies' });
    { const { historyRow, ...plain } = bodies[1][1]; assert.ok(!/Lu|Tester/.test(JSON.stringify(plain)), 'no name in the clear (the sealed row is random base64)'); }
  });

  it('a one-off tag is a reprint job sealed to the stations, never a check-in', async () => {
    const a = await station('station-aaaaaaaa');
    const w = worker({ stations: [a] });
    const { desk } = make(w);
    await desk.signIn(PASS);
    const r = await desk.oneOffTag({ name: ' Ava ', club: 'Puggles' });
    assert.match(r.jobId, /^reprint:[0-9a-f-]{36}$/);
    const call = w.calls.find((c) => c.path === '/v1/print/reprint');
    assert.equal(call.body.jobId, r.jobId);
    assert.equal(call.body.bundle.kind, 'print-job');
    // exactly what the print role runs: the print server's own one-off route and its body
    assert.deepEqual(await cc.openAsStation(a.ring, call.body.bundle), { route: '/print-oneoff', body: { firstName: 'Ava', clubName: 'Puggles' }, source: 'desk', at: '2026-10-14T22:00:00.000Z' });
    await assert.rejects(desk.oneOffTag({ name: 'Ava', club: '' }), { reason: 'no-club' });
    assert.equal(w.calls.filter((c) => c.path === '/v1/desk/checkin').length, 0);
    const none = worker({ stations: [] });
    const d2 = make(none).desk;
    await d2.signIn(PASS);
    await assert.rejects(d2.oneOffTag({ name: 'Ava', club: 'Puggles' }), { code: 'no-station' });
  });
});

describe('the print status line', () => {
  const stations = (extra = {}) => [{ stationId: 's', name: 's', lastSeenAt: new Date(NOW - 10000).toISOString(), printer: { state: 'ok' }, ...extra }];
  it('says printed, queued, or check the printer', () => {
    assert.deepEqual(printLabel({ stations: stations(), queued: 0, leased: 0, claims: { printed: 7 } }, NOW), { kind: 'ok', text: 'Printed 7' });
    assert.deepEqual(printLabel({ stations: stations(), queued: 2, leased: 1, claims: { printed: 7 } }, NOW), { kind: 'queued', text: '3 labels queued' });
    assert.equal(printLabel({ stations: stations({ printer: { state: 'paper' } }) }, NOW).kind, 'check');
    assert.match(printLabel({ stations: stations({ printer: { state: 'paper' } }) }, NOW).text, /out of labels/);
    assert.equal(printLabel({ stations: stations(), checkThePrinter: ['abc'] }, NOW).kind, 'check');
    assert.equal(printLabel({ stations: stations(), dead: 1 }, NOW).kind, 'check');
    assert.equal(printLabel({ stations: [] }, NOW).kind, 'check');
    assert.equal(printLabel({ stations: stations({ lastSeenAt: new Date(NOW - 5 * 60000).toISOString() }), queued: 1 }, NOW).kind, 'check');
    assert.equal(printLabel(null, NOW).kind, 'unknown');
  });
});

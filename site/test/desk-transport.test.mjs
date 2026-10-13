// The check-in page's transport and sealing (site/checkin/desk-transport.js) against a
// stand-in Worker that speaks routes.md and, like the real one, only checks
// shapes: every seal is the browser's, and the tests open them with the
// station's and the history key's own private keys to prove what is inside.
import assert from 'node:assert/strict';
import { describe, it, before, mock } from 'node:test';
import * as cc from '../../lobby/shared/cloud-crypto.js';
import { mergeChurch, sanitizeChurch } from '../../lobby/shared/churchSettings.js';
import { createDesk, dayWords, DeskError, HISTORY_PIN_STORAGE, NO_CLUB_QUIPS, noClubWords, READ_TIMEOUT_MS, printLabel, SESSION_STORAGE } from '../checkin/desk-transport.js';

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
  const w = { calls: [], stations, historyKey: history === 'none' ? null : historyKey, busy: 0, expire: false, stationsChangedOnce: null, checkins: [], verifier: null, churchPuts: [], churchDropped: [] };
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
    if (path === '/v1/history/nights') return w.nights ? json(200, w.nights) : json(503, { reason: 'history-off' });
    if (path.startsWith('/v1/history/rows?')) {
      const q = new URL(`https://x${path}`).searchParams;
      const all = (w.rows && w.rows[q.get('night')]) || [];
      const start = q.get('after') ? all.findIndex((r) => r.id === q.get('after')) + 1 : 0;
      const page = all.slice(start, start + 2);   // two rows a page, so paging is exercised
      return json(200, { rows: page, next: start + 2 < all.length ? page.at(-1).id : null });
    }
    if (path === '/v1/church/settings') {
      if (!w.church) return json(404, { error: 'Not found.' });
      if (init.method === 'PUT') {
        w.churchPuts.push(body);
        if (body.baseRev !== w.church.rev) return json(409, { reason: 'stale', rev: w.church.rev, settings: w.church.settings });
        // what the Worker does (routes.md 10.3): the one allowlist, then the merge
        const { settings, dropped } = sanitizeChurch(body.settings);
        w.churchDropped.push(...dropped);
        w.church = { rev: w.church.rev + 1, settings: mergeChurch(w.church.settings, settings) };
        return json(200, { ok: true, rev: w.church.rev, settings: w.church.settings });
      }
      return json(200, { rev: w.church.rev, settings: w.church.settings, switches: {} });
    }
    if (w.busy > 0 && path.startsWith('/v1/desk/')) { w.busy -= 1; return json(429, { ok: false, reason: 'read-busy', retryAfterMs: 4200 }); }
    if (w.stationsChangedOnce && path === '/v1/desk/checkin') {
      const next = w.stationsChangedOnce; w.stationsChangedOnce = null;
      w.stations = next;
      return json(409, { ok: false, reason: 'stations-changed', what: 'job', stations: asList(next) });
    }
    if (path === '/v1/desk/barf') return w.barf ? json(200, w.barf) : json(404, { error: 'Not found.' });
    if (path === '/v1/desk/barf-late') {
      (w.barfPosts = w.barfPosts || []).push(body);
      if (check) { const verdict = check(path, body, w); if (verdict) return verdict; }
      return json(200, body.recheck ? { ok: true, checkedIn: true, items: body.items } : { ok: true, checkedIn: true, items: { Bible: true, Friend: true }, jobId: body.tagJob ? body.tagJob.jobId : null, history: 'kept' });
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
    const { job: _job, historyRow: _row, friendName, ...plainPost } = post;   // the sealed parts are random base64
    const wire = JSON.stringify(plainPost);
    assert.ok(!/Kit|Tester|Sam/.test(wire), 'no child\'s name in clear');
    assert.equal(friendName, 'Sam', 'the friend\'s first name alone, for the 6:30 BARF list (as the phone path sent it)');
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

  it('a leader tag and a custom label are reprint jobs on the print server\'s own routes, never a check-in', async () => {
    const a = await station('station-aaaaaaaa');
    const w = worker({ stations: [a] });
    const { desk } = make(w);
    await desk.signIn(PASS);
    await desk.leaderTag({ name: '  Pat   Leader ', club: 'Sparks' });
    await desk.customLabel({ text: ' KITCHEN ' + 'x'.repeat(80) });
    const [lead, custom] = w.calls.filter((c) => c.path === '/v1/print/reprint');
    assert.match(lead.body.jobId, /^reprint:/);
    assert.deepEqual(await cc.openAsStation(a.ring, lead.body.bundle), { route: '/print-leader', body: { name: 'Pat Leader', clubName: 'Sparks' }, source: 'desk', at: '2026-10-14T22:00:00.000Z' });
    const label = await cc.openAsStation(a.ring, custom.body.bundle);
    assert.equal(label.route, '/print-custom');
    assert.equal(label.body.text, `KITCHEN ${'x'.repeat(52)}`);
    await assert.rejects(desk.leaderTag({ name: ' ' }), { reason: 'no-name' });
    await assert.rejects(desk.customLabel({ text: '' }), { reason: 'no-text' });
    assert.equal(w.calls.filter((c) => c.path === '/v1/desk/checkin').length, 0);
    assert.ok(!JSON.stringify(lead.body).includes('Pat'), 'the leader\'s name rides only the sealed job');
  });

  it('without Brought a friend no friend\'s name is sent', async () => {
    const w = worker({ stations: [] });
    const { desk } = make(w);
    await desk.signIn(PASS);
    await desk.checkIn(kid, { bible: true, friend: false, friendName: 'Sam' });
    assert.ok(!('friendName' in w.checkins[0]));
  });
});

describe('a late BARF friend (routes.md 5.1)', () => {
  it('barfInfo: the Worker\'s answer, or null (no route: the button stays hidden)', async () => {
    const w = worker();
    const { desk } = make(w);
    await desk.signIn(PASS);
    assert.equal(await desk.barfInfo(), null);
    w.barf = { night: NIGHT, barfNight: true, friends: ['12'], tagRoute: '/print-barf-tag', stations: 1 };
    assert.deepEqual(await desk.barfInfo(), { barfNight: true, friends: ['12'], tagRoute: '/print-barf-tag', recheck: null });
    w.barf = { barfNight: null, tagRoute: 'nonsense' };
    assert.deepEqual(await desk.barfInfo(), { barfNight: null, friends: [], tagRoute: '/print-custom', recheck: null });
    // Children waiting to be checked in again after a redo that never took (kept across a reload).
    w.barf = { barfNight: true, friends: ['12'], tagRoute: '/print-barf-tag', recheck: [{ clubberId: '12', items: { Bible: true, Friend: true } }, { clubberId: 'x<' }, null] };
    assert.deepEqual((await desk.barfInfo()).recheck, [{ clubberId: '12', items: { Bible: true, Friend: true } }]);
  });

  it('seals the BARF tag to every station (its own route, or a custom label for an older station) and a barf-friend row; only the friend\'s first name in clear', async () => {
    const a = await station('station-aaaaaaaa');
    const w = worker({ stations: [a] });
    const { desk } = make(w);
    await desk.signIn(PASS);
    const out = await desk.barfLate(kid, '  <Sam>  ', '/print-barf-tag');
    assert.equal(out.checkedIn, true);
    const post = w.barfPosts[0];
    assert.equal(post.friendName, 'Sam');
    assert.equal(post.clubberId, '662');
    assert.match(post.tagJob.jobId, /^reprint:/);
    const { tagJob: _j, historyRow: _r, ...plain } = post;
    assert.ok(!/Kit|Tester/.test(JSON.stringify(plain)));
    const rec = await cc.openAsStation(a.ring, post.tagJob.bundle);
    assert.deepEqual([rec.route, rec.body], ['/print-barf-tag', { firstName: 'Kit', clubName: 'Sparks' }]);
    assert.equal(post.historyRow.kind, 'barf-friend');
    const row = await cc.openRow(ring, post.historyRow);
    assert.deepEqual([row.first, row.last, row.clubberId, row.friend, row.friendFirst], ['Kit', 'Tester', '662', true, 'Sam']);
    // A 9.3.0 station: a custom label it already runs.
    await desk.barfLate(kid, 'Sam', '/print-custom');
    const old = await cc.openAsStation(a.ring, w.barfPosts[1].tagJob.bundle);
    assert.deepEqual([old.route, old.body], ['/print-custom', { text: 'BARFED! Kit' }]);
  });

  it('a friend\'s name is required; a refusal is worded; the recheck sends the items back, nothing sealed', async () => {
    const w = worker({ check: (path, body) => (path === '/v1/desk/barf-late' && body.friendName === 'Max' ? new Response(JSON.stringify({ ok: false, reason: 'already-friend' }), { status: 409 }) : null) });
    const { desk } = make(w);
    await desk.signIn(PASS);
    await assert.rejects(desk.barfLate(kid, '   ', '/print-custom'), { code: 'refused', reason: 'no-friend-name' });
    await assert.rejects(desk.barfLate(kid, 'Max', '/print-custom'), (e) => e.code === 'refused' && /already has a friend/.test(e.message));
    const r = await desk.barfRecheck(kid, { Bible: true });
    assert.equal(r.checkedIn, true);
    assert.deepEqual(w.barfPosts.at(-1), { night: NIGHT, clubberId: '662', recheck: true, items: { Bible: true, Friend: true } });
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

/** One sealed history row, as the desk page or the laptop's import seals it. */
async function sealed(night, kind, record) {
  const id = cc.newRowId();
  return { id, night, kind, ...(await cc.sealRow(historyKey.pub, { id, night, kind, record })) };
}

describe('who was here the last two club nights (the history, opened in the browser)', () => {
  it('reads the last two earlier nights, opens every row with the key the sign-in unwrapped, and keeps an undo', async () => {
    const w = worker({ stations: [] });
    w.nights = [{ night: '2026-09-30', rows: 1 }, { night: '2026-10-07', rows: 4 }, { night: NIGHT, rows: 1 }, { night: '2026-09-23', rows: 1 }];
    w.rows = {
      '2026-10-07': [
        await sealed('2026-10-07', 'checkin', { ts: 1, first: 'Kit', last: 'Tester', club: 'Sparks', clubberId: '662', source: 'desk' }),
        await sealed('2026-10-07', 'checkin', { ts: 2, first: 'Lu', last: 'Undone', club: 'Sparks', clubberId: '700', source: 'desk' }),
        await sealed('2026-10-07', 'undo', { ts: 3, first: 'Lu', last: 'Undone', club: 'Sparks', clubberId: '700', source: 'desk' }),
        await sealed('2026-10-07', 'visitor', { ts: 4, first: 'Mia', last: 'Jones', club: 'Cubbies', source: 'desk' }),
        { id: 'AAAAAAAAAAAAAAAAAAAAAA', night: '2026-10-07', kind: 'checkin', v: 1, kid: 'x', epk: 'x', iv: 'x', ct: 'x' },
      ],
      '2026-09-30': [await sealed('2026-09-30', 'import-attendance', { k: 'x', name: 'Old Timer', dates: ['2026-09-30'] })],
      '2026-09-23': [await sealed('2026-09-23', 'checkin', { ts: 1, first: 'Too', last: 'Early', club: 'Sparks', clubberId: '9' })],
      [NIGHT]: [await sealed(NIGHT, 'checkin', { ts: 1, first: 'Tonight', last: 'Only', club: 'Sparks', clubberId: '8' })],
    };
    const { desk } = make(w);
    await desk.signIn(PASS);
    assert.equal(desk.canReadHistory, true);
    const got = await desk.recentAttendance();
    assert.deepEqual(got.nights, ['2026-10-07', '2026-09-30']);
    assert.deepEqual(got.names.sort(), ['Kit Tester', 'Mia Jones', 'Old Timer']);
    assert.deepEqual(got.ids, ['662']);
    assert.ok(w.calls.every((c) => !c.path.startsWith('/v1/desk/')), 'never a TwoTimTwo-backed route');
  });

  it('fails silent: a restored session has no key, history off or one earlier night is null', async () => {
    const w = worker({ stations: [] });
    const { desk, store } = make(w);
    await desk.signIn(PASS);
    assert.equal(await desk.recentAttendance(), null, 'history storage off (503)');
    w.nights = [{ night: '2026-10-07', rows: 1 }];
    w.rows = { '2026-10-07': [] };
    assert.equal(await desk.recentAttendance(), null, 'only one earlier night');
    const again = createDesk({ cc, fetch: w.fetch, store, now: () => NOW });
    assert.equal(again.restore(), 'ready');
    assert.equal(again.canReadHistory, false);
    assert.equal(await again.recentAttendance(), null);
    desk.signOut();
    assert.equal(desk.canReadHistory, false, 'sign-out forgets the key');
    assert.ok(!JSON.stringify([...store.m.entries()]).includes('privateKey'));
  });
});

describe('remembered leaders (the church settings `leaders`)', () => {
  it('no route yet (404): no list, and remembering writes nothing', async () => {
    const w = worker({ stations: [] });
    const { desk } = make(w);
    await desk.signIn(PASS);
    assert.equal(await desk.churchLeaders(), null);
    assert.equal(await desk.rememberLeader({ name: 'Pat Leader', club: 'Sparks' }), null);
    assert.equal(w.churchPuts.length, 0);
  });

  it('reads the list, adds a new leader in churchSettings.js\'s shape (names and club only), never twice, and forgets one', async () => {
    const w = worker({ stations: [] });
    w.church = { rev: 4, settings: sanitizeChurch({ labelFooter: 'Hi', leaders: [
      { firstName: 'Ann', lastName: 'Lead', clubName: 'Cubbies', lastPrintedAt: 1760000000000, printCount: 7 },
      { firstName: 'Bo', lastName: 'Helper', clubName: '' },
    ] }).settings };
    const { desk } = make(w);
    await desk.signIn(PASS);
    const read = (await desk.churchLeaders()).leaders;
    assert.deepEqual(read.map((l) => [l.firstName, l.lastName, l.clubName]), [['Ann', 'Lead', 'Cubbies'], ['Bo', 'Helper', '']]);
    const saved = await desk.rememberLeader({ name: ' Pat  Van Leader ', club: 'Sparks' });
    assert.equal(saved.rev, 5);
    const sent = w.churchPuts[0];
    assert.deepEqual(Object.keys(sent.settings), ['leaders'], 'only the leaders key is sent');
    assert.equal(sent.baseRev, 4);
    assert.deepEqual(sent.settings.leaders[0], { firstName: 'Ann', lastName: 'Lead', clubName: 'Cubbies', lastPrintedAt: 1760000000000, printCount: 7 }, 'a known leader goes back exactly as read');
    assert.deepEqual(sent.settings.leaders[2], { firstName: 'Pat', lastName: 'Van Leader', clubName: 'Sparks' }, 'the page sets no print stamps');
    assert.deepEqual(w.churchDropped, [], 'the real sanitizer keeps what the page sent');
    assert.deepEqual(sanitizeChurch(sent.settings).settings.leaders, w.church.settings.leaders);
    assert.deepEqual(w.church.settings.leaders[2], { firstName: 'Pat', lastName: 'Van Leader', clubName: 'Sparks', lastPrintedAt: 0, printCount: 1 });
    assert.equal(w.church.settings.labelFooter, 'Hi');
    await desk.rememberLeader({ name: 'PAT van leader' });
    assert.equal(w.churchPuts.length, 1, 'already remembered: nothing written');
    // someone else saved in between: the stale answer is read again and the edit made once more
    const fetchStale = w.fetch;
    let bumped = false;
    w.fetch = async (url, init) => {
      if (!bumped && init && init.method === 'PUT') { bumped = true; w.church = { ...w.church, rev: w.church.rev + 1 }; }
      return fetchStale(url, init);
    };
    const d2 = createDesk({ cc, fetch: w.fetch, store: memoryStore(), now: () => NOW });
    await d2.signIn(PASS);
    const forgot = await d2.forgetLeader({ firstName: 'bo', lastName: 'HELPER' });
    assert.ok(forgot && !forgot.leaders.some((l) => l.firstName === 'Bo'));
    assert.equal(w.churchPuts.length, 3, 'one stale PUT, one that landed');
    assert.deepEqual(w.church.settings.leaders.map((l) => l.firstName), ['Ann', 'Pat']);
  });

  it('a full list (80) takes no new name', async () => {
    const w = worker({ stations: [] });
    w.church = { rev: 1, settings: sanitizeChurch({ leaders: Array.from({ length: 90 }, (_, i) => ({ firstName: `L${i}`, lastName: 'X' })) }).settings };
    assert.equal(w.church.settings.leaders.length, 80);
    const { desk } = make(w);
    await desk.signIn(PASS);
    await desk.rememberLeader({ name: 'One More' });
    assert.equal(w.churchPuts.length, 0);
  });
});

describe('a read that never answers', () => {
  it('gives up after READ_TIMEOUT_MS as "unreachable", so the page asks again instead of waiting forever', async () => {
    // 60 s (owner 2026-10-13): after a Worker restart the roster's first read is a fresh
    // TwoTimTwo sign-in, about 45 s of spaced reads; 30 s abandoned it every time.
    assert.equal(READ_TIMEOUT_MS, 60 * 1000);
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const hung = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      const d = createDesk({ cc, fetch: hung, store: memoryStore(), now: () => NOW });
      const asked = d.roster();
      let settled = false;
      const outcome = asked.then(() => null, (e) => e).finally(() => { settled = true; });
      mock.timers.tick(45 * 1000);   // a cold sign-in is still being waited for
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(settled, false);
      mock.timers.tick(READ_TIMEOUT_MS - 45 * 1000);
      const err = await outcome;
      assert.ok(err instanceof DeskError);
      assert.equal(err.code, 'unreachable');
      assert.match(err.message, /did not answer in time/);
    } finally { mock.timers.reset(); }
  });
});

describe('no club tonight (routes.md 5: the roster\'s noClub answer, the writes\' 409 no-club)', () => {
  it('the roster answer passes through as it came: noClub, today, next, no children', async () => {
    const w = worker();
    const inner = w.fetch;
    w.fetch = async (url, init) => (String(url).endsWith('/v1/desk/roster')
      ? new Response(JSON.stringify({ noClub: true, today: '2026-10-12', next: NIGHT, readAt: '2026-10-13T00:36:00.000Z', kids: [], items: { bible: [], friend: [] } }), { status: 200 })
      : inner(url, init));
    const { desk } = make(w);
    await desk.signIn(PASS);
    const r = await desk.roster();
    assert.equal(r.noClub, true);
    assert.equal(r.next, NIGHT);
    assert.deepEqual(r.kids, []);
  });

  it('a check-in, undo, check-out or late BARF friend refused no-club is a DeskError \'no-club\' in plain words, with the next club night', async () => {
    const refusal = { ok: false, reason: 'no-club', today: '2026-10-12', next: NIGHT };
    const w = worker({ stations: [await station('st-1')], check: () => new Response(JSON.stringify(refusal), { status: 409 }) });
    const { desk } = make(w);
    await desk.signIn(PASS);
    for (const go of [() => desk.checkIn(kid, { bible: true }), () => desk.undo(kid), () => desk.checkout(kid), () => desk.barfLate(kid, 'Sam', '/print-barf-tag')]) {
      await assert.rejects(go(), (e) => e instanceof DeskError && e.code === 'no-club' && e.message === 'There is no club tonight.' && e.next === NIGHT && e.today === '2026-10-12');
    }
  });

  it('the note: "No club tonight", the next club night in American words, and a small line that stays put all day', () => {
    assert.deepEqual(noClubWords({ today: '2026-10-12', next: '2026-10-14' }), { title: 'No club tonight', next: 'Next club night: Wednesday, October 14', quip: noClubWords({ today: '2026-10-12' }).quip });
    assert.equal(noClubWords({ today: '2026-10-12', next: null }).next, '');
    assert.equal(noClubWords(null).title, 'No club tonight');
    assert.ok(NO_CLUB_QUIPS.includes(noClubWords({ today: '2026-10-12' }).quip));
    for (const q of NO_CLUB_QUIPS) assert.ok(q.length <= 60 && !/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(q), q);
    // the line changes from day to day, never between two polls of one day
    assert.equal(noClubWords({ today: '2026-10-12' }).quip, noClubWords({ today: '2026-10-12', next: '2026-10-14' }).quip);
    assert.ok(new Set(['2026-10-12', '2026-10-13', '2026-10-15', '2026-10-16', '2026-10-17'].map((d) => noClubWords({ today: d }).quip)).size > 1);
  });

  it('dates read as the church\'s own day, with the year only across New Year', () => {
    assert.equal(dayWords('2026-10-14'), 'Wednesday, October 14');
    assert.equal(dayWords('2027-01-06', '2026'), 'Wednesday, January 6, 2027');
    assert.equal(dayWords('2026-12-30', '2026'), 'Wednesday, December 30');
    assert.equal(noClubWords({ today: '2026-12-21', next: '2027-01-06' }).next, 'Next club night: Wednesday, January 6, 2027');
    for (const bad of ['', null, '2026-02-30', '14/10/2026', '2026-10-14T00:00']) assert.equal(dayWords(bad), '', String(bad));
  });
});

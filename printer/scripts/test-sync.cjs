#!/usr/bin/env node
// Tests for signing this computer in to the Awana sync service (the
// Awana-Check-in-Display repo's worker/): the sign-in route and who may call
// it, adopting the service's display key, the deck / settings rebroadcasts
// going quiet, publishes forwarded to the
// service, and a passphrase change elsewhere signing this computer out.
//
// The service is a stand-in on a patched global fetch; loopback requests to
// this server pass through untouched.
//
// Run: node scripts/test-sync.cjs

'use strict';

let __suiteFinished = false;
process.on('exit', (code) => {
  if (code === 0 && !__suiteFinished) {
    console.error('✗ Test suite terminated before completing (crash swallowed?) — failing.');
    process.exitCode = 1;
  }
});

const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.AWANA_TEST_PORT || require('./free-port.cjs')());
const BASE = `http://127.0.0.1:${PORT}`;
const SYNC = 'https://awana-sync.test.workers.dev';
const OLD_KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';
const SERVICE_KEY = Buffer.alloc(32, 9).toString('base64');
const V2_SALT = 'AAECAwQFBgcICQoLDA0ODw==';
const SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// The stand-in service.
const service = { calls: [], key: SERVICE_KEY, stateStatus: 200, publishStatus: 200 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith(SYNC)) return realFetch(url, init);
  const route = u.slice(SYNC.length);
  const body = init.body ? JSON.parse(init.body) : null;
  service.calls.push({ route, method: init.method || 'GET', body, auth: (init.headers || {}).Authorization || null });
  const reply = (status, b) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  if (route === '/v1/auth/params') return service.v2 ? reply(200, { v: 2, salt: V2_SALT, iter: 600000, legacy: true, upgrade: false }) : reply(404, {});
  if (route === '/v1/login' && body.authKey) {
    if (body.authKey !== service.v2Key || body.passphrase) return reply(401, { reason: 'wrong', triesLeft: 4 });
    return reply(200, { session: SESSION, displayKey: service.key, state: {}, history: null });
  }
  if (route === '/v1/login') {
    if (body.passphrase !== 'kennebec') return reply(401, { reason: 'wrong', triesLeft: 4 });
    return reply(200, { session: SESSION, displayKey: service.key, state: {} });
  }
  if (route === '/v1/state') return reply(service.stateStatus, {});
  if (route === '/v1/publish') { if (service.publishDelayMs) await new Promise((r) => setTimeout(r, service.publishDelayMs)); return reply(service.livePublishStatus || 200, { ok: true, screens: 2 }); }
  if (route === '/v1/slides') return reply(service.publishStatus, { deckRev: 5, publishedAt: '2026-10-01T18:00:00.000Z', slideCount: 1, droppedCount: 0 });
  if (route === '/v1/settings') return reply(service.publishStatus, { rev: 3, publishedAt: '2026-10-01T18:00:00.000Z', keyCount: 1 });
  return reply(404, {});
};

async function j(pathname, opts) {
  const res = await realFetch(BASE + pathname, opts);
  return { status: res.status, body: await res.json().catch(() => null) };
}
const post = (pathname, body, headers) => j(pathname, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(headers || {}) },
  body: JSON.stringify(body || {}),
});
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-sync-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    printerName: 'Fake',
    checkinUrl: 'https://example.com/checkin',
    displayKey: OLD_KEY,
  }, null, 2));
  process.env.AWANA_DATA_DIR = dataDir;
  process.env.AWANA_PORT = String(PORT);
  process.env.AWANA_BIND_HOST = '127.0.0.1';

  const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((resolve) => { if (listener.listening) return resolve(); listener.once('listening', resolve); });
  await settle(200);

  console.log('\nsync: before anyone signs in');
  {
    const h = await j('/health');
    check('/health says not signed in', h.body.sync && h.body.sync.signedIn === false && h.body.sync.url === null);
    check('nothing has talked to the service', service.calls.length === 0);
  }

  console.log('sync: who may sign this computer in');
  {
    const remote = await post('/config/sync-login', { passphrase: 'kennebec', url: SYNC }, { Origin: 'https://patrick-simpson.github.io' });
    check('not the display site', remote.status === 403);
    const bad = await post('/config/sync-login', { passphrase: 'kennebec', url: 'http://awana-sync.test.workers.dev' });
    check('https only', bad.status === 400);
    const empty = await post('/config/sync-login', { passphrase: '  ', url: SYNC });
    check('a passphrase is needed', empty.status === 400);
  }

  console.log('sync: signing in');
  {
    const wrong = await post('/config/sync-login', { passphrase: 'kenebec', url: SYNC });
    check('a wrong word is a 401 with the tries left', wrong.status === 401 && wrong.body.triesLeft === 4, JSON.stringify(wrong.body));
    const right = await post('/config/sync-login', { passphrase: '  Kennebec ', url: `${SYNC}/` });
    check('the right word signs in (case and spaces as a screen types them)', right.status === 200 && right.body.ok === true, JSON.stringify(right.body));
    const login = service.calls.filter((c) => c.route === '/v1/login').at(-1);
    check('it offered the key it already had, so older screens keep reading names', login.body.seedKey === OLD_KEY);
    check('and adopted the service\'s key', right.body.changedKey === true);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
    check('the key and the session are saved', onDisk.displayKey === SERVICE_KEY && onDisk.syncSession === SESSION && onDisk.syncUrl === SYNC);
    const h = await j('/health');
    check('/health: signed in, never the session', h.body.sync.signedIn === true && !JSON.stringify(h.body).includes(SESSION));
    const cfg = await j('/config', { headers: { Origin: 'https://patrick-simpson.github.io' } });
    check('the session is a secret: not in /config for anyone else', cfg.body && cfg.body.syncSession === undefined);
  }

  console.log('sync: signing in by passphrase v2 (the passphrase never leaves this computer)');
  {
    service.v2 = true;
    service.v2Key = await require('../print-server/cloud-crypto').deriveAuthKey('kennebec', V2_SALT, 600000);
    service.calls.length = 0;
    const wrong = await post('/config/sync-login', { passphrase: 'kenebec', url: SYNC });
    check('v2: a wrong word is a 401 with the tries left', wrong.status === 401 && wrong.body.triesLeft === 4, JSON.stringify(wrong.body));
    const right = await post('/config/sync-login', { passphrase: '  Kennebec ', url: SYNC });
    check('v2: the right word signs in', right.status === 200 && right.body.ok === true, JSON.stringify(right.body));
    const logins = service.calls.filter((c) => c.route === '/v1/login');
    const last = logins.at(-1).body;
    check('v2: it sent the authKey and the seed key, and no passphrase', Object.keys(last).sort().join() === 'authKey,seedKey', Object.keys(last).join());
    check('v2: the passphrase is nowhere on the wire', !JSON.stringify(service.calls).includes('ennebec'));
    check('v2: it asked for the params first', service.calls[0].route === '/v1/auth/params');
    service.v2 = false;
    service.calls.length = 0;
  }

  console.log('sync: every live frame also goes to the service, sealed, in order');
  {
    const events = require(path.join(__dirname, '..', 'print-server', 'events.js'));
    const before = service.calls.length;
    await events.publish('awana-channel', 'checkin', events.buildCheckin({ id: 'c1', firstName: 'Noah', lastName: 'Secret', club: 'Sparks' }) || { id: 'c1', firstName: 'Noah', club: 'Sparks', at: new Date().toISOString() });
    await events.publish('awana-channel', 'tally', { counts: { Sparks: 4 }, total: 4, at: new Date().toISOString() });
    await settle(150);
    const sent = service.calls.slice(before).filter((c) => c.route === '/v1/publish');
    check('two frames relayed, in order', sent.length === 2 && sent[0].body.event === 'checkin' && sent[1].body.event === 'tally', JSON.stringify(sent.map((c) => c.body.event)));
    check('with the session', sent.every((c) => c.auth === `Bearer ${SESSION}`));
    check('the check-in is sealed on the way (no name in the clear)', sent[0] && sent[0].body.payload.v === 1 && !JSON.stringify(sent[0].body).includes('Noah'));
    const alone = await events.publish('awana-channel', 'tally', { counts: {}, total: 0, at: new Date().toISOString() });
    check('signed in, the service is the path', alone === true);
  }

  console.log('sync: the relay queue has limits');
  {
    const events = require(path.join(__dirname, '..', 'print-server', 'events.js'));
    const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
    const now = () => new Date().toISOString();
    // A slow service and a burst of tallies: only the newest is sent, and
    // everyone who published hears how it fared.
    service.publishDelayMs = 120;
    let before = service.calls.length;
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => events.publish('awana-channel', 'tally', { counts: { Sparks: n }, total: n, at: now() })));
    service.publishDelayMs = 0;
    const tallies = service.calls.slice(before).filter((c) => c.route === '/v1/publish' && c.body.event === 'tally');
    check('a burst of five tallies behind a slow service sends two at most: the one in flight and the newest', tallies.length <= 2 && tallies[tallies.length - 1].body.payload.total === 5, JSON.stringify(tallies.map((c) => c.body.payload.total)));
    check('every publisher was answered, and with success', results.every((r) => r === true), JSON.stringify(results));
    // Check-ins are never coalesced: each child is greeted.
    before = service.calls.length;
    await Promise.all(['a', 'b', 'c'].map((id) => events.publish('awana-channel', 'checkin', { id, firstName: 'Kid', club: 'Sparks', at: now() })));
    check('three check-ins are three frames', service.calls.slice(before).filter((c) => c.body && c.body.event === 'checkin').length === 3);
    // The breaker: three outages in a row and the relay fails fast.
    service.livePublishStatus = 503;
    before = service.calls.length;
    for (let i = 0; i < 3; i++) await events.publish('awana-channel', 'checkin', { id: 'x' + i, firstName: 'Kid', club: 'Sparks', at: now() });
    const tried = service.calls.slice(before).filter((c) => c.route === '/v1/publish').length;
    const fast = await events.publish('awana-channel', 'checkin', { id: 'y', firstName: 'Kid', club: 'Sparks', at: now() });
    check('three failures try the service, the fourth frame fails fast without a call', tried === 3 && fast === false && service.calls.length === before + 3, `tried ${tried}, calls after ${service.calls.length - before}`);
    const health = await j('/health');
    const w = (health.body.warnings || []).find((x) => x && x.type === 'syncRelay');
    check('while the breaker is open /health says the sync service is not answering, as a {type, message} object', !!w && typeof w.message === 'string' && /sync service is not answering/.test(w.message) && /Labels still print/.test(w.message), JSON.stringify(health.body.warnings));
    service.livePublishStatus = 200;
    server.resetRelayForTest();
    const healthAfter = await j('/health');
    check('and the warning goes with the breaker', !(healthAfter.body.warnings || []).some((x) => x && x.type === 'syncRelay'));
    const back = await events.publish('awana-channel', 'tally', { counts: {}, total: 1, at: now() });
    check('closed again, frames flow', back === true);
    // 7.13.0: a tally that did not get through is sent again once the service
    // answers, instead of leaving the screens on the last number they had.
    service.livePublishStatus = 503;
    await events.publish('awana-channel', 'tally', { counts: { Sparks: 7 }, total: 7, at: now() });
    service.livePublishStatus = 200;
    before = service.calls.length;
    await settle(5600);
    const retried = service.calls.slice(before).filter((c) => c.route === '/v1/publish' && c.body.event === 'tally');
    check('a failed tally is sent again when the service is back', retried.length === 1 && retried[0].body.payload.total === 7, JSON.stringify(retried.map((c) => c.body.payload.total)));
    // ...but not once a newer one has got through.
    service.livePublishStatus = 503;
    await events.publish('awana-channel', 'tally', { counts: { Sparks: 8 }, total: 8, at: now() });
    service.livePublishStatus = 200;
    await events.publish('awana-channel', 'tally', { counts: { Sparks: 9 }, total: 9, at: now() });
    before = service.calls.length;
    await settle(5600);
    check('an owed tally a newer one overtook is not resent', !service.calls.slice(before).some((c) => c.route === '/v1/publish' && c.body.event === 'tally'));
    server.resetRelayForTest();
    const src = require('./server-source.cjs')();
    check('the queue is bounded and old check-ins are left to the recap', /RELAY_QUEUE_MAX = 50/.test(src) && /RELAY_CHECKIN_MAX_AGE_MS = 2 \* 60 \* 1000/.test(src) && /RELAY_BREAK_MS = 30 \* 1000/.test(src));
    check('one sign-in check at a time', /if \(signInCheck\) return signInCheck;/.test(src));
  }

  console.log('sync: publishes are forwarded to the service');
  {
    const mark = service.calls.length;
    const slides = await post('/api/lobby-slides', { slides: [{ text: 'Store next week' }] });
    check('the deck went to the service', slides.status === 200 && slides.body.viaSync === true && slides.body.deckRev === 5, JSON.stringify(slides.body));
    const call = service.calls.filter((c) => c.route === '/v1/slides').at(-1);
    check('with the session, as a PUT', call && call.method === 'PUT' && call.auth === `Bearer ${SESSION}`);
    const settings = await post('/api/display-settings', { settings: { showClock: false } });
    check('the shared settings too', settings.status === 200 && settings.body.viaSync === true && settings.body.rev === 3);
    await settle();
    check('nothing was rebroadcast from here', !service.calls.slice(mark).some((c) => c.route === '/v1/publish' && (c.body.event === 'slides' || c.body.event === 'settings')));
  }

  console.log('sync: a passphrase change elsewhere signs this computer out');
  {
    service.publishStatus = 401;
    service.stateStatus = 401;
    const r = await post('/api/lobby-slides', { slides: [{ text: 'x' }] });
    check('the publish says why it failed', r.status === 502 && /signed out/i.test(r.body.error));
    await settle(200);
    const h = await j('/health');
    check('/health: signed out, with the fix', h.body.sync.signedIn === false && h.body.sync.state === 'signed-out' && /Sign this computer in again/.test(h.body.sync.error));
    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
    check('the session is gone, the key kept', onDisk.syncSession === undefined && onDisk.displayKey === SERVICE_KEY);
    service.publishStatus = 200;
    service.stateStatus = 200;
  }

  console.log('sync: signing out');
  {
    await post('/config/sync-login', { passphrase: 'kennebec', url: SYNC });
    const out = await post('/config/sync-logout');
    check('signs out', out.status === 200 && (await j('/health')).body.sync.signedIn === false);
    const remote = await post('/config/sync-logout', {}, { Origin: 'https://patrick-simpson.github.io' });
    check('only from this computer', remote.status === 403);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  __suiteFinished = true;
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('suite crashed:', e);
  __suiteFinished = true;
  process.exit(1);
});

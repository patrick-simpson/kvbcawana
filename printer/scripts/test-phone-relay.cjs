#!/usr/bin/env node
// The phone check-in relay (7.9.0), end to end in one process: the sync
// service's relay (lobby/worker/src/relay.js, on an in-memory store), this
// print server, and phone-relay.js between them. A page's request goes in at
// the service, the laptop's loop collects it and runs it here, and the answer
// comes back out at the service, once.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const root = path.join(__dirname, '..');
const PORT = 34575;

(async () => {
  console.log('\nphone relay: the same routes on both sides');
  const relay = require(path.join(root, 'print-server', 'phone-relay.js'));
  {
    const worker = fs.readFileSync(path.join(root, '..', 'lobby', 'worker', 'src', 'relay.js'), 'utf8');
    const block = (src) => src.slice(src.indexOf('RELAY_ROUTES = Object.freeze(['), src.indexOf(']);', src.indexOf('RELAY_ROUTES = Object.freeze([')));
    check('the laptop runs exactly the routes the service relays', block(worker).length > 200 && block(worker) === block(fs.readFileSync(path.join(root, 'print-server', 'phone-relay.js'), 'utf8')));
    check('settings, history and the families never ride the relay',
      !relay.relayAllowed('POST', '/config') && !relay.relayAllowed('GET', '/history/today') && !relay.relayAllowed('POST', '/touch/context')
      && !relay.relayAllowed('POST', '/phone/../config') && relay.relayAllowed('POST', '/phone/checkin'));
  }

  // The service's relay (lobby/worker/src/relay.js, no packages needed), in
  // memory, behind the four routes sync.js gives it. Sign-in is the service's
  // own test (lobby/worker/test/sync.test.js); here any token but a bad one is in.
  const { Relay } = await import(path.join(root, '..', 'lobby', 'worker', 'src', 'relay.js'));
  const map = new Map();
  const storage = { get: async (k) => (map.has(k) ? structuredClone(map.get(k)) : undefined), put: async (k, v) => { map.set(k, structuredClone(v)); }, delete: async (k) => map.delete(k) };
  const q = new Relay(storage, () => Date.now());
  const session = 'v1.1.1.ok';
  const svc = async (method, p, body, s) => {
    if (s !== session) return { ok: false, status: 401, body: { error: 'signed out' } };
    const u = new URL(`https://sync.test${p}`);
    if (method === 'POST' && u.pathname === '/v1/relay') { const r = await q.enqueue(body); return r.ok ? { ok: true, status: 200, body: { id: r.id } } : { ok: false, status: r.status, body: r }; }
    if (method === 'GET' && u.pathname === '/v1/relay/next') return { ok: true, status: 200, body: await q.take() };
    if (method === 'POST' && u.pathname === '/v1/relay/answer') { const r = await q.answer(body); return { ok: r.ok, status: r.ok ? 200 : r.status, body: r }; }
    if (method === 'GET' && u.pathname === '/v1/relay/result') return { ok: true, status: 200, body: await q.result(u.searchParams.get('id')) };
    return { ok: false, status: 404, body: null };
  };
  const syncRequest = (base, p, { method = 'GET', body, session: s } = {}) => svc(method, p, body, s);

  // The print server, with a roster.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-relay-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ printerName: 'Fake' }));
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), 'First Name,Last Name,Club\nAva,Stone,Sparks\nEli,Stone,Cubbies\n');
  Object.assign(process.env, { AWANA_DATA_DIR: dataDir, AWANA_PORT: String(PORT), AWANA_BIND_HOST: '127.0.0.1', PRINTER_NAME: 'Fake' });
  const server = require(path.join(root, 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((r) => { if (listener.listening) return r(); listener.once('listening', r); });
  const localBase = `http://127.0.0.1:${PORT}`;

  console.log('\nphone relay: a page asks, the laptop answers');
  {
    // the page asks for the roster and to check Ava in with her Bible
    const a = (await svc('POST', '/v1/relay', { method: 'POST', path: '/phone/roster', body: {} }, session)).body.id;
    const b = (await svc('POST', '/v1/relay', { method: 'POST', path: '/phone/checkin', body: { name: 'Ava Stone', options: { Bible: true } } }, session)).body.id;
    const c = (await svc('POST', '/v1/relay', { method: 'GET', path: '/touch/jam' }, session)).body.id;
    let r = await svc('GET', `/v1/relay/result?id=${a}`, undefined, session);
    check('before the laptop asks, the page is told to wait', r.body.done === false, JSON.stringify(r.body));
    const once = await relay.relayOnce({ base: 'x', session, localBase, syncRequest });
    check('the laptop collects and answers all three, and keeps asking fast', once.ok && once.handled === 3 && once.busy, JSON.stringify(once));
    r = await svc('GET', `/v1/relay/result?id=${a}`, undefined, session);
    check('the roster comes back to the page', r.body.done && r.body.status === 200 && r.body.body.kids.length === 2, JSON.stringify(r.body).slice(0, 200));
    r = await svc('GET', `/v1/relay/result?id=${a}`, undefined, session);
    check('and only once (the answer is deleted as it is read)', r.body.done && r.body.status === 504, JSON.stringify(r.body));
    r = await svc('GET', `/v1/relay/result?id=${b}`, undefined, session);
    check('the check-in is queued for the check-in page', r.body.status === 200 && r.body.body.queued === true, JSON.stringify(r.body));
    const pending = await (await fetch(`${localBase}/pending-actions`)).json();
    const ava = (pending.actions || []).find((x) => x.name === 'Ava Stone');
    check('with her Bible ticked, as on the Wi-Fi', ava && ava.options && ava.options.Bible === true, JSON.stringify(pending));
    r = await svc('GET', `/v1/relay/result?id=${c}`, undefined, session);
    check('a GET (Printer jammed available?) works too', r.body.status === 200 && typeof r.body.body.available === 'boolean', JSON.stringify(r.body));
  }

  console.log('\nphone relay: the loop');
  {
    const r = await relay.relayOnce({ base: 'x', session: 'v1.1.1.nope', localBase, syncRequest });
    check('signed out: nothing runs', !r.ok && r.status === 401 && r.handled === 0, JSON.stringify(r));
    const src = fs.readFileSync(path.join(root, 'print-server', 'server.js'), 'utf8');
    check('the print server runs the loop only while signed in to the sync service',
      /phoneRelay\.startPhoneRelay\(\{\s*signedIn: \(\) => \(signedInToSync\(\) \? \{ base: config\.syncUrl, session: config\.syncSession \} : null\)/.test(src));
    check('it asks every second while phones are busy, every 20 s otherwise', relay.RELAY_BUSY_MS === 1000 && relay.RELAY_IDLE_MS === 20000);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

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
    const c = (await svc('POST', '/v1/relay', { method: 'GET', path: '/phone/status/0f8c1a2b-3c4d' }, session)).body.id;
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
    check('a GET (a check-in\'s status) is relayed and answered too', r.body.done === true && r.body.status === 404 && r.body.body.error === 'unknown action', JSON.stringify(r.body));
  }

  console.log('\nphone relay: a phone action is claimed before it is driven');
  {
    const pending = await (await fetch(`${localBase}/pending-actions`)).json();
    const ava = (pending.actions || []).find((x) => x.name === 'Ava Stone');
    check('(her check-in is pending for the check-in page)', !!ava, JSON.stringify(pending));
    let r = await fetch(`${localBase}/pending-actions/${ava.id}/claim`, { method: 'POST' });
    check('the first claim is granted, with its lease', r.status === 200 && (await r.json()).leaseMs === 90000);
    const again = await fetch(`${localBase}/pending-actions/${ava.id}/claim`, { method: 'POST' });
    check('a second claim (another tab, the next poll) is refused', again.status === 409 && (await again.json()).status === 'claimed');
    const hidden = await fetch(`${localBase}/pending-actions`, { signal: AbortSignal.timeout(700) }).then((x) => x.json()).catch(() => 'waiting');
    check('a claimed action is not handed out again: the poll waits for new ones instead of spinning', hidden === 'waiting' || !(hidden.actions || []).some((x) => x.id === ava.id), JSON.stringify(hidden));
    let st = await (await fetch(`${localBase}/phone/status/${ava.id}`)).json();
    check('the phone sees it as still in progress', st.status === 'claimed');
    r = await fetch(`${localBase}/pending-actions/${ava.id}/result`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) });
    st = await (await fetch(`${localBase}/phone/status/${ava.id}`)).json();
    check('and the result lands as before', r.status === 200 && st.status === 'done');
    const src = fs.readFileSync(path.join(root, 'print-server', 'server.js'), 'utf8');
    check('a claim never answered goes back to pending after 90 s', /PENDING_CLAIM_MS = 90 \* 1000/.test(src) && /a\.status === 'claimed' && now - a\.claimedAt > PENDING_CLAIM_MS[\s\S]{0,80}a\.status = 'pending'/.test(src));
  }

  console.log('\nphone relay: the driven check-in switch');
  {
    const cfg = (body) => fetch(`${localBase}/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    check('the switch can be turned off from this computer', (await cfg({ enableDrivenCheckin: false })).ok);
    const id = (await svc('POST', '/v1/relay', { method: 'POST', path: '/phone/checkin', body: { name: 'Eli Stone' } }, session)).body.id;
    await relay.relayOnce({ base: 'x', session, localBase, syncRequest });
    const r = await svc('GET', `/v1/relay/result?id=${id}`, undefined, session);
    check('with it off a phone check-in is refused at once, saying why', r.body.done && r.body.status === 409 && /turned off on the check-in laptop/.test(r.body.body && r.body.body.error), JSON.stringify(r.body));
    const pending = await (await fetch(`${localBase}/pending-actions`)).json();
    check('and nothing is queued for the check-in page', !(pending.actions || []).some((x) => x.name === 'Eli Stone'), JSON.stringify(pending));
    check('the switch goes back on', (await cfg({ enableDrivenCheckin: true })).ok);
  }

  console.log('\nphone relay: a few at a time');
  {
    // Five phones ask at once, and one slow answer (a reprint, say) must not
    // hold the other four: the laptop runs RELAY_PARALLEL at a time.
    let inFlight = 0, most = 0;
    const slowFetch = async (...args) => {
      inFlight++; most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 120));
      try { return await fetch(...args); } finally { inFlight--; }
    };
    for (let i = 0; i < 5; i++) await svc('POST', '/v1/relay', { method: 'GET', path: '/phone/status/0f8c1a2b-3c4d' }, session);
    const t0 = Date.now();
    const once = await relay.relayOnce({ base: 'x', session, localBase, syncRequest, fetchFn: slowFetch });
    const took = Date.now() - t0;
    check('all five are answered', once.ok && once.handled === 5, JSON.stringify(once));
    check('three at a time, no more', most === relay.RELAY_PARALLEL && relay.RELAY_PARALLEL === 3, `most in flight ${most}`);
    check('so five slow answers take two rounds, not five', took < 5 * 120, `${took} ms`);
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

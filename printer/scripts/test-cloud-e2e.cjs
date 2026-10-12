#!/usr/bin/env node
// Online check-in, end to end (ROADMAP.md#online-check-in): the sync Worker's
// real handlers run in this process (lobby/worker/src, over the Worker tests'
// stand-in TwoTimTwo, Durable Object storage and D1), and the REAL print-role
// modules talk to it through the same request shape the packaged app uses:
//
//   station-keys.js   makes the station key and opens the history key, registers
//   (a desk page)     seals a history row and a print job in "the browser" and posts the check-in
//   job-puller.js     leases the job, prints it on a stub printer, journals it, acks it
//   history-sync.js   writes the row for a TwoTimTwo-page check-in, reads attendance back
//
// What it proves: exactly ONE label per check-in, a duplicate (the watcher sees
// the same child on TwoTimTwo's report) prints nothing, an undo and a new
// check-in prints again with a higher gen, a lost ack never reprints (the
// journal, across an app restart and a lease that expired), the history stored
// is ciphertext only, and the lease routes the puller calls are the Worker's.
//
// P5 (the last section): the Worker as the ONE publisher, with the REAL print server behind
// the puller. A desk check-in and a TwoTimTwo-page check-in each print once and are greeted
// ONCE (the station's sealed `checkin`, sent with its job, birthday and all; the laptop's own
// greeting is dropped, and a replay of a greeting is dropped); a phone page check-in (a relay job)
// and an extension check-in are greeted once too, when the watcher's job meets their label
// (no second label, a LATE greeting only if none got through), the Worker's tally counts them,
// its sealed still-here list names them, and the station's season / pickup clubs reach it.
//
// The Worker is ESM and this is CommonJS, so it is loaded with import(). Its
// two runtime packages (linkedom, parse5) come from lobby/worker/node_modules
// (CI: `npm ci --omit=dev --prefix lobby/worker` before the printer's tests).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const root = path.join(__dirname, '..');
const worker = path.join(root, '..', 'lobby', 'worker');
const load = (...p) => import(pathToFileURL(path.join(worker, ...p)).href);
const cc = require(path.join(root, 'print-server', 'cloud-crypto.js'));
const { createStationKeys } = require(path.join(root, 'print-server', 'station-keys.js'));
const jp = require(path.join(root, 'print-server', 'job-puller.js'));
const hs = require(path.join(root, 'print-server', 'history-sync.js'));

const PASS = 'kennebec';
const BASE = 'https://sync.test';
const STATION = 'station-aaaaaaaa';
const fakeSafe = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`ENC:${Buffer.from(s).toString('base64')}`),
  decryptString: (b) => Buffer.from(b.toString().slice(4), 'base64').toString(),
};

(async () => {
  const { rig, NIGHT } = await load('test', 'rig.js');
  const { memoryStore, everything } = await load('test', 'helpers.js');
  const { d1Stub } = await load('test', 'd1stub.js');
  const { WATCH_INTERVAL_MS, SPILL_MS } = await load('src', 'watcher.js');

  const db = d1Stub();
  const storage = memoryStore();
  const t = await rig({ storage, env: { HISTORY_DB: db }, kids: [] });
  // The Worker has no history key yet: the first client makes it (as the desk page does at sign-in).
  const hkey = await cc.createHistoryKey(PASS);
  {
    const put = await t.call('PUT', '/v1/history/key', { pub: hkey.pub, kid: hkey.kid, wrapped: hkey.wrapped });
    // rig stores a stand-in key for tests that never need a real one: replace it before anything is sealed
    if (put.status === 409) { await storage.delete('history:pub'); await storage.delete('history:wrapped'); }
  }
  if (!(await storage.get('history:pub')) || (await storage.get('history:pub')).pub !== hkey.pub) {
    check('the first client stores the history key', (await t.call('PUT', '/v1/history/key', { pub: hkey.pub, kid: hkey.kid, wrapped: hkey.wrapped })).status === 201);
  }

  /** The packaged app's request, answered in process by the Worker. `net.down(path)` drops a call. */
  const net = { down: () => false, calls: [] };
  const request = async (base, p, { method = 'GET', body, session, station } = {}) => {
    net.calls.push({ method, p });
    if (net.down(p)) return { ok: false, status: 0, body: null };
    const headers = { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session}` } : {}), ...(station ? { 'X-Station': station } : {}) };
    const res = await t.core.handle(new Request(`${base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    let parsed = null;
    try { parsed = await res.json(); } catch { /* not JSON */ }
    return { ok: res.ok, status: res.status, body: parsed };
  };
  const signedIn = () => ({ base: BASE, session: t.session });

  // ── the station: keys, registration, the history key ─────────────────────
  console.log('\nthe station registers and opens the history key');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kvbc-e2e-'));
  const keys = createStationKeys({ dir, safeStorage: fakeSafe, request });
  const reg = await keys.register({ base: BASE, session: t.session, stationId: STATION, name: 'Check-in laptop' });
  check('station-keys registers with the Worker (no pairing step)', reg.ok === true && Array.isArray(reg.stations) && reg.stations.length === 1, JSON.stringify(reg));
  const unlocked = await keys.unlockHistory({ base: BASE, session: t.session, stationId: STATION, passphrase: PASS });
  check('and opens the wrapped history key with the passphrase', unlocked.ok === true && keys.historyPub() === hkey.pub, JSON.stringify(unlocked));

  // ── a stub printer behind the print server's /print ──────────────────────
  const prints = [];
  const printServer = async (url, init) => {
    const route = new URL(url).pathname;
    const body = JSON.parse(init.body);
    if (route === '/print') prints.push(body);
    return { status: 200, json: async () => ({ success: true }) };
  };
  const journalFile = path.join(dir, 'print-journal.json');
  const writer = hs.createHistoryWriter({ pub: () => keys.historyPub(), signedIn, request, stationId: () => STATION, log: () => {}, now: t.clock.now });
  const makePuller = () => jp.createJobPuller({
    signedIn, stationId: () => STATION, ring: () => keys.ring(), localBase: 'http://127.0.0.1:3456', request,
    journal: jp.createJournal(journalFile, t.clock.now), fetchFn: printServer, now: t.clock.now, log: () => {},
    onPrinted: async (info) => { const row = hs.rowForPrinted(info, t.clock.now); if (row) await writer.record(row.kind, row.record, row.night); },
  });
  let puller = makePuller();
  const printedFor = (id) => prints.filter((b) => String(b.clubberId) === String(id)).length;
  const status = async () => (await t.call('GET', '/v1/print/status')).body;

  // ── "the desk page": the REAL site/desk/desk-transport.js, signed in by passphrase v2 ──
  // It derives authKey, signs in (the one upgrade login the first time), proves the
  // history key, then seals the job and the row in "the browser" and posts.
  const esm = (...p) => import(pathToFileURL(path.join(root, '..', ...p)).href);
  const esmCc = await esm('lobby', 'shared', 'cloud-crypto.js');
  const { createDesk } = await esm('site', 'desk', 'desk-transport.js');
  const deskFetch = async (url, init = {}) => t.core.handle(new Request(`${BASE}${String(url).replace(/^\/api/, '')}`, init));
  const desk = createDesk({ cc: esmCc, fetch: deskFetch, now: t.clock.now });
  await desk.signIn(PASS);
  check('the desk page signs in with passphrase v2 and holds the history key', desk.signedIn === true && desk.hasHistory === true);
  check('and the Worker upgraded its stored verifier from that one sign-in', !!(await storage.get('auth')).v2.verifier);
  async function deskCheckIn(clubberId, first, last, club) {
    const out = await desk.checkIn({ clubberId, name: `${first} ${last}`, club }, {});
    return { out, jobId: out.jobId };
  }
  const WATCHER = async (ms) => { t.clock.tick(ms); await t.core.watcher.tick(); };
  await t.core.watcher.tick();   // the baseline read: nobody is here

  console.log('\na desk check-in prints exactly one label');
  const first = await deskCheckIn('662', 'Kit', 'Zyxelquill', 'Sparks');
  check('the desk check-in is accepted with a claim at gen 1 and a sealed job', first.out.already === false && first.out.gen === 1 && first.out.jobId === first.jobId && first.out.history === 'hooked', JSON.stringify(first.out));
  check('the claim is queued, one job waits, and the Worker holds only ciphertext for it', (await status()).claims.queued === 1 && (await status()).queued === 1);
  const r1 = await puller.tick();
  check('the real job puller leased it (GET /v1/print/next), opened it and printed it once', r1.handled === 1 && prints.length === 1 && printedFor('662') === 1, JSON.stringify(r1));
  check('the stub printer got the cloud tag the print server wants (cloud: true, gen 1, no regen)', prints[0].cloud === true && !prints[0].regen && prints[0].name === 'Kit Zyxelquill' && prints[0].clubName === 'Sparks' && prints[0].clubberId === '662', JSON.stringify(prints[0]));
  let s = await status();
  check('the ack (POST /v1/print/done) marked the job done and the claim printed', s.done === 1 && s.queued === 0 && s.leased === 0 && s.claims.printed === 1, JSON.stringify(s));
  check('the station was seen, its printer state noted', s.stations[0].stationId === STATION && s.stations[0].lastSeenAt);
  check('the puller called only the Worker\'s own canonical routes', net.calls.filter((c) => /\/v1\/print\//.test(c.p)).every((c) => /^\/v1\/print\/(next\?max=1|done|failed|heartbeat)$/.test(c.p)), JSON.stringify([...new Set(net.calls.map((c) => c.p))]));

  console.log('\na duplicate prints nothing');
  t.night.kids.push({ id: '662', club: 'Sparks', name: 'Kit Zyxelquill' });   // TwoTimTwo now lists the child the desk checked in
  await WATCHER(WATCH_INTERVAL_MS);
  await WATCHER(SPILL_MS);
  check('the watcher saw the child on the report and adopted nothing (the claim is already ours)', t.core.adopt.pending() === 0 && (await status()).claims.printed === 1 && (await status()).queued === 0);
  const dup = await deskCheckIn('662', 'Kit', 'Zyxelquill', 'Sparks');
  check('and a second desk checking the same child in is told "already", with no second job', dup.out.already === true && (await status()).queued === 0, JSON.stringify(dup.out));
  await puller.tick();
  check('so the puller finds nothing and the label count is still 1', prints.length === 1);

  console.log('\nan undo, then a new check-in, prints again with a higher gen');
  t.night.kids = t.night.kids.filter((k) => k.id !== '662');
  const undo = await desk.undo({ clubberId: '662', name: 'Kit Zyxelquill', club: 'Sparks' });
  check('the undo is accepted', undo.ok === true, JSON.stringify(undo));
  await WATCHER(WATCH_INTERVAL_MS);
  const second = await deskCheckIn('662', 'Kit', 'Zyxelquill', 'Sparks');
  check('the new check-in is a new claim: gen is higher than the first', second.out.already === false && second.out.gen > first.out.gen, JSON.stringify(second.out));
  const r2 = await puller.tick();
  check('and prints a second label, flagged as the next generation', r2.handled === 1 && printedFor('662') === 2 && prints[1].cloud === true && prints[1].regen === true && prints[1].name === 'Kit Zyxelquill', JSON.stringify(prints.map((b) => b.regen)));
  check('the journal holds one tag per generation', Object.keys(JSON.parse(fs.readFileSync(journalFile, 'utf8')).keys).filter((k) => k.includes(':662:')).length === 2);
  t.night.kids.push({ id: '662', club: 'Sparks', name: 'Kit Zyxelquill' });

  console.log('\na check-in made on TwoTimTwo\'s own page prints once, and the station writes its history row');
  t.night.kids.push({ id: '700', club: 'Cubbies', name: 'Ottoline Quillfeather' });
  await WATCHER(WATCH_INTERVAL_MS);
  await WATCHER(SPILL_MS);
  check('the watcher claimed it (source ttt) and sealed a job to the station', (await status()).claims.queued === 1 && t.core.adopt.pending() === 0, JSON.stringify(await status()));
  // The ack is lost: the label is printed, the Worker never hears of it.
  net.down = (p) => p === '/v1/print/done';
  const r3 = await puller.tick();
  check('it printed once, with the Worker\'s gen, though the ack could not get through', r3.handled === 1 && printedFor('700') === 1 && prints.at(-1).name === 'Ottoline Quillfeather' && prints.at(-1).cloud === true, JSON.stringify(prints.at(-1)));
  s = await status();
  check('the Worker still shows it leased (it never heard "done")', s.leased === 1 && s.done === 2, JSON.stringify(s));

  console.log('\na lost ack does not reprint');
  const journalState = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
  const lost = Object.values(journalState.jobs).find((j) => j.state === 'printed' && j.acked === false);
  check('the journal remembers it printed and unacked', !!lost);
  puller = makePuller();                                   // the app restarts: a new puller over the same journal file
  t.clock.tick(95 * 1000);                                 // the 90 s lease runs out: the Worker offers the job again
  const r4 = await puller.tick();
  check('after a restart and an expired lease the same job is offered again and NOT printed again', printedFor('700') === 1 && prints.length === 3, `${printedFor('700')} / ${prints.length} ${JSON.stringify(r4)}`);
  s = await status();
  check('the Worker still has the job leased again (the ack keeps failing)', s.done === 2 && s.leased === 1, JSON.stringify(s));
  net.down = () => false;
  await puller.tick();
  s = await status();
  check('when the network is back the ack goes through, as printed, and the job is done', s.done === 3 && s.leased === 0 && s.queued === 0 && s.claims.printed === 2 && s.checkThePrinter.length === 0, JSON.stringify(s));
  check('and the label count never moved', prints.length === 3);
  await puller.tick();
  check('an idle tick prints nothing more', prints.length === 3);

  console.log('\nhistory: ciphertext only in the Worker and D1, and the keys\' owner can read it');
  await writer.flush();
  const stored = db.query('SELECT kind, COUNT(*) AS n FROM history_rows GROUP BY kind ORDER BY kind');
  const byKind = Object.fromEntries(stored.map((r) => [r.kind, r.n]));
  check('desk rows (check-in x2, undo) and the station\'s row for the TwoTimTwo-page child are all kept', byKind.checkin === 3 && byKind.undo === 1, JSON.stringify(byKind));
  const everyByte = `${db.dump()}\n${everything(storage)}`;
  check('no name and no clubber id is in D1 or in the Durable Object\'s storage', !/Zyxelquill|Quillfeather|Ottoline|"662"|"700"/.test(everyByte));
  check('the night summary is plaintext counts by club (the desk\'s two check-ins and the undo)', JSON.stringify(db.query('SELECT club, checked_in AS i, undone AS u FROM night_summary ORDER BY club')) === JSON.stringify([{ club: 'Sparks', i: 2, u: 1 }]), JSON.stringify(db.query('SELECT * FROM night_summary')));
  const hring = await keys.historyRing();
  const rows = (await t.call('GET', `/v1/history/rows?night=${NIGHT}&limit=500`)).body.rows;
  const opened = [];
  for (const row of rows) opened.push({ kind: row.kind, ...(await cc.openRow(hring, row)) });
  const ttt = opened.find((r) => r.source === 'ttt');
  check('the history key opens every row; the station\'s TwoTimTwo-page row says who, where and when', opened.every((r) => r.first) && ttt && ttt.first === 'Ottoline' && ttt.last === 'Quillfeather' && ttt.club === 'Cubbies' && ttt.clubberId === '700' && typeof ttt.ts === 'number', JSON.stringify(ttt));
  check('a station key alone opens none of them', (await cc.openRow(await keys.ring(), rows[0])) === null);

  console.log('\nand the print role reads the attendance back from it (an undo takes a child out)');
  const merged = [];
  const reader = hs.createAttendanceReader({
    historyRing: () => keys.historyRing(), signedIn, request, stationId: () => STATION, merge: (e) => merged.push(...e), log: () => {}, now: t.clock.now,
  });
  // The reader only counts nights up to the church's today (a fixed test clock: 2026-10-14 is "today").
  const out = await reader.syncOnce();
  const byId = Object.fromEntries(merged.map((e) => [e.key, e]));
  check('the reader opened the night; the child checked in, undone and checked in again counts once; the TwoTimTwo-page child counts',
    out.ok && byId['id:662'] && byId['id:662'].dates.join() === NIGHT && byId['id:700'] && byId['id:700'].dates.join() === NIGHT, JSON.stringify({ out, merged }));

  // ── P5: the Worker is the one publisher; the real print server is the station ──
  console.log('\nthe one publisher: one greeting per check-in, the Worker\'s tally and still-here list');
  {
    const env = await import(pathToFileURL(path.join(root, '..', 'lobby', 'src', 'lib', 'envelope.js')).href);
    const { makeStation, sealJob } = await load('test', 'helpers.js');
    const { row: stubRow } = await load('test', 'rig.js');
    const storage2 = memoryStore();
    const t2 = await rig({ storage: storage2, env: { SINGLE_PUBLISHER: 'on', HISTORY_DB: d1Stub() }, kids: [] });
    {   // a real history key, as the first client makes it (the rig's stand-in is replaced before anything is sealed)
      const hk = await cc.createHistoryKey(PASS);
      await storage2.delete('history:pub'); await storage2.delete('history:wrapped');
      await t2.call('PUT', '/v1/history/key', { pub: hk.pub, kid: hk.kid, wrapped: hk.wrapped });
    }
    const st = await t2.station(STATION, 'Check-in laptop');
    await t2.core.watcher.tick();   // the baseline read: nobody is here

    // The real print server, with a stub powershell: the puller's /print goes to it over loopback.
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'kvbc-e2e-bin-'));
    const jobLog = path.join(bin, 'jobs.log');
    fs.writeFileSync(path.join(bin, 'powershell'), `#!/bin/sh\necho job >> ${jobLog}\nexit 0\n`, { mode: 0o755 });
    process.env.PATH = `${bin}:${process.env.PATH}`;
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kvbc-e2e-data-'));
    const today = new Date();
    fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({
      printerName: 'Fake', lateGraceMin: 24 * 60, syncUrl: BASE, syncSession: t2.session,
    }));
    fs.writeFileSync(path.join(data, 'clubbers.csv'), `Clubber ID,First Name,Last Name,Club,Birthdate\n662,Kit,Tester,Sparks,${today.getMonth() + 1}/${today.getDate()}/2016\n702,Ottoline,Quillfeather,Cubbies,3/3/2016\n`);
    Object.assign(process.env, { AWANA_DATA_DIR: data, AWANA_PORT: '34590', AWANA_BIND_HOST: '127.0.0.1', PRINTER_NAME: 'Fake' });
    const server = require(path.join(root, 'print-server', 'server.js'));
    const events = require(path.join(root, 'print-server', 'events.js'));
    const displayKey = await t2.core.displayKey();
    events.setDisplayKey(displayKey);
    const listener = server.startListening();
    await listener.ready;
    const real = globalThis.fetch;

    const request2 = async (base, p, { method = 'GET', body, session, station, headers: extra = {} } = {}) => {
      const headers = { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session}` } : {}), ...(station ? { 'X-Station': station } : {}), ...extra };
      const res = await t2.core.handle(new Request(`${base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
      let parsed = null;
      try { parsed = await res.json(); } catch { /* not JSON */ }
      return { ok: res.ok, status: res.status, body: parsed };
    };
    check('this computer is the print station', server.configureCloud({ stationId: STATION, ring: async () => st.ring, request: request2, start: false, journalFile: null }).ok === true);
    check('the station tells the Worker its season, rehearsal flag and pickup clubs', (await server.sendStationExtras(true)) === true
      && (await t2.call('GET', '/v1/publisher/status')).body.pickupClubs.join() === 'Puggles,Cubbies,Sparks,T&T');

    const puller2 = jp.createJobPuller({
      signedIn: () => ({ base: BASE, session: t2.session }), stationId: () => STATION, ring: async () => st.ring, localBase: 'http://127.0.0.1:34590',
      request: request2, journal: jp.createJournal(null, t2.clock.now), fetchFn: real, now: t2.clock.now, log: () => {},
    });
    const frames = (event) => t2.sent.filter((f) => f.e === event);
    const imported = await env.importDisplayKey(displayKey);
    const open = async (event, f) => (await env.openEnvelope(imported, event, f.d)).payload;
    const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

    // a desk check-in: the REAL desk page transport, signed in by passphrase v2 against this Worker
    const deskFetch2 = async (url, init = {}) => t2.core.handle(new Request(`${BASE}${String(url).replace(/^\/api/, '')}`, init));
    const desk2 = createDesk({ cc: esmCc, fetch: deskFetch2, now: t2.clock.now });
    await desk2.signIn(PASS);
    check('the desk page signs in by v2 on the single-publisher Worker', desk2.signedIn === true);
    t2.night.kids.push({ id: '662', club: 'Sparks', name: 'Kit Tester' });
    const deskOut = await desk2.checkIn({ clubberId: '662', name: 'Kit Tester', club: 'Sparks' }, {});
    const jobId = deskOut.jobId;
    check('the desk check-in is accepted', deskOut.already === false && typeof jobId === 'string' && jobId.length > 0, JSON.stringify(deskOut));
    check('the Worker\'s tally already counts the child (the desk ticks it before the next read)', frames('tally').at(-1).d.total === 1);
    check('and greets nobody itself', frames('checkin').length === 0);
    const r1 = await puller2.tick();
    await settle();
    check('the real print server printed one label for the job', r1.handled === 1 && fs.readFileSync(jobLog, 'utf8').trim().split('\n').length === 1, JSON.stringify(r1));
    check('and exactly ONE greeting reached the screens, sealed (no name on the wire)', frames('checkin').length === 1 && env.isEnvelope(frames('checkin')[0].d) && !('firstName' in frames('checkin')[0].d), String(frames('checkin').length));
    const g1 = await open('checkin', frames('checkin')[0]);
    check('with what only the station knows: the child, the club and the birthday week', g1.firstName === 'Kit' && g1.club === 'Sparks' && g1.isBirthday === true && g1.isFirstTimer === false && typeof g1.id === 'string', JSON.stringify(g1));

    // a replay: the same greeting again (a retry, a second station) is dropped by the Worker
    const { seal } = await load('src', 'crypto.js');
    const replay = await server.sendGreeting(await seal(displayKey, 'checkin', events.buildCheckin({ firstName: 'Kit', club: 'Sparks' })), jobId);
    await settle();
    check('a second greeting for the same job is answered dropped and reaches nobody', replay === true && frames('checkin').length === 1, `${replay} ${frames('checkin').length}`);

    // a check-in made on TwoTimTwo's own page
    t2.night.kids.push({ id: '702', club: 'Cubbies', name: 'Ottoline Quillfeather' });
    t2.clock.tick(WATCH_INTERVAL_MS);
    await t2.core.watcher.tick();
    t2.clock.tick(SPILL_MS);
    await t2.core.watcher.tick();
    const r2 = await puller2.tick();
    await settle();
    check('the TwoTimTwo-page child is printed once, and greeted once more (two check-ins, two greetings)', r2.handled === 1 && frames('checkin').length === 2, `${JSON.stringify(r2)} ${frames('checkin').length}`);
    const g2 = await open('checkin', frames('checkin')[1]);
    check('and that greeting names them', g2.firstName === 'Ottoline' && g2.club === 'Cubbies', JSON.stringify(g2));
    await puller2.tick();
    await settle();
    check('an idle tick greets nobody again', frames('checkin').length === 2);

    // the phone page: the Worker checks the child in on TwoTimTwo and hands the station a relay
    // job (no print-queue job), the station prints and greets naming the child; then the
    // watcher (CLOUD_PRINT) finds the child on the report and makes a job, which meets the label
    const labels = () => fs.readFileSync(jobLog, 'utf8').trim().split('\n').length;
    const local = (p, body) => real(`http://127.0.0.1:34590${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    const beforePhone = labels();
    const phonePrint = await local('/print', { name: 'Pip Phonely', clubName: 'Sparks', clubberId: '703', cloud: true });
    await settle();
    check('a phone page check-in (the relay job, no print job) prints once and is greeted once', phonePrint.success === true && labels() === beforePhone + 1 && frames('checkin').length === 3, `${JSON.stringify(phonePrint)} ${frames('checkin').length}`);
    check('and that greeting names them', (await open('checkin', frames('checkin')[2])).firstName === 'Pip');
    t2.night.kids.push({ id: '703', club: 'Sparks', name: 'Pip Phonely' });
    t2.clock.tick(WATCH_INTERVAL_MS); await t2.core.watcher.tick();
    t2.clock.tick(SPILL_MS); await t2.core.watcher.tick();
    const r3 = await puller2.tick();
    await settle();
    check('the watcher\'s job for that child prints no second label and greets nobody twice', r3.handled === 1 && labels() === beforePhone + 1 && frames('checkin').length === 3, `${JSON.stringify(r3)} ${labels()} ${frames('checkin').length}`);

    // the extension (the fallback): its greeting never reached the screens (here: printed while
    // this computer was not yet the station, its plain relay unreachable); then the watcher's job
    // meets the label and greets LATE, once, with the printer's own event
    server.stopCloud();
    const extPrint = await local('/print', { name: 'Rue Extensia', clubName: 'Cubbies', clubberId: '704' });
    await settle();
    server.configureCloud({ stationId: STATION, ring: async () => st.ring, request: request2, start: false, journalFile: null });
    check('an extension check-in prints, and no greeting reached the screens yet', extPrint.success === true && labels() === beforePhone + 2 && frames('checkin').length === 3, `${JSON.stringify(extPrint)} ${frames('checkin').length}`);
    t2.night.kids.push({ id: '704', club: 'Cubbies', name: 'Rue Extensia' });
    t2.clock.tick(WATCH_INTERVAL_MS); await t2.core.watcher.tick();
    t2.clock.tick(SPILL_MS); await t2.core.watcher.tick();
    const r4 = await puller2.tick();
    await settle();
    check('the watcher\'s job prints no second label but greets the child, once', r4.handled === 1 && labels() === beforePhone + 2 && frames('checkin').length === 4, `${JSON.stringify(r4)} ${labels()} ${frames('checkin').length}`);
    check('with the greeting the printer made for that label', (await open('checkin', frames('checkin')[3])).firstName === 'Rue');
    await puller2.tick();
    await settle();
    check('an idle tick greets nobody again', frames('checkin').length === 4);

    // the Worker's own tally, ticker and still-here list
    t2.clock.tick(WATCH_INTERVAL_MS);
    await t2.core.watcher.tick();
    const tally = frames('tally').at(-1).d;
    check('the tally counts every child, by club, in the printer\'s shape', tally.total === 4 && tally.counts.Sparks === 2 && tally.counts.Cubbies === 2 && typeof tally.at === 'string', JSON.stringify(tally));
    check('the ticker says four checked in', frames('tonight').at(-1).d.checkedIn === 4);
    const still = await open('checkout', frames('checkout').at(-1));
    check('the sealed still-here list names them: first name and club', still.entries.map((e) => `${e.firstName}/${e.club}`).sort().join() === 'Kit/Sparks,Ottoline/Cubbies,Pip/Sparks,Rue/Cubbies', JSON.stringify(still));
    check('the count is the shared module\'s (GET /v1/desk/tonight)', (await t2.call('GET', '/v1/desk/tonight')).body.checkedIn === 4);
    const plainFrames = JSON.stringify(t2.sent.filter((f) => f.e === 'tally' || f.e === 'tonight'));
    check('and no name or id of a child is readable in the Worker\'s storage, and none is on a plaintext frame', !/Tester|Quillfeather|Ottoline|Phonely|Extensia|"662"|"702"|"703"|"704"/.test(everything(t2.storage)) && !/Tester|Quillfeather|Ottoline|Kit|Pip|Rue/.test(plainFrames));
    check('the Worker\'s tally and the printer\'s builder agree on the shape', JSON.stringify(Object.keys(tally).sort()) === JSON.stringify(Object.keys(events.buildTally({ Sparks: 1, Cubbies: 1 }, 2, { season: server.currentScreenSeason() })).sort()));
    check('and so do the ticker\'s and the list\'s', JSON.stringify(Object.keys(frames('tonight').at(-1).d).sort()) === JSON.stringify(Object.keys(events.buildTonight({ checkedIn: 2 })).sort())
      && JSON.stringify(Object.keys(still).sort()) === JSON.stringify(Object.keys(events.buildCheckout([{ firstName: 'Kit', club: 'Sparks' }], 2)).sort()));
    server.stopCloud();
    listener.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

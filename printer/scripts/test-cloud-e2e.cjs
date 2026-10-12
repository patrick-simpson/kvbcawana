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

  // ── "the desk page": seals in the browser, then posts ────────────────────
  const stationsNow = async () => (await t.call('GET', '/v1/stations')).body.map((s) => ({ publicKey: s.pub }));
  async function sealedRow(kind, record) {
    const id = cc.newRowId();
    return { id, night: NIGHT, kind, ...(await cc.sealRow(hkey.pub, { id, night: NIGHT, kind, record })) };
  }
  async function deskCheckIn(clubberId, first, last, club) {
    const jobId = cc.newRowId();
    const job = await cc.sealForStations(await stationsNow(), {
      id: jobId, night: NIGHT, kind: 'print-job',
      record: { route: '/print', body: { firstName: first, lastName: last, clubName: club, clubberId }, clubberId, source: 'desk' },
    });
    const res = await t.call('POST', '/v1/desk/checkin', {
      night: NIGHT, clubberId, items: {}, job,
      historyRow: await sealedRow('checkin', { ts: t.clock.t, first, last, club, clubberId, source: 'desk' }),
    });
    return { res, jobId };
  }
  const WATCHER = async (ms) => { t.clock.tick(ms); await t.core.watcher.tick(); };
  await t.core.watcher.tick();   // the baseline read: nobody is here

  console.log('\na desk check-in prints exactly one label');
  const first = await deskCheckIn('662', 'Kit', 'Zyxelquill', 'Sparks');
  check('the desk check-in is accepted with a claim at gen 1 and a sealed job', first.res.body.ok === true && first.res.body.gen === 1 && first.res.body.jobId === first.jobId && first.res.body.history === 'hooked', JSON.stringify(first.res.body));
  check('the claim is queued, one job waits, and the Worker holds only ciphertext for it', (await status()).claims.queued === 1 && (await status()).queued === 1);
  const r1 = await puller.tick();
  check('the real job puller leased it (GET /v1/print/next), opened it and printed it once', r1.handled === 1 && prints.length === 1 && printedFor('662') === 1, JSON.stringify(r1));
  check('the stub printer got the cloud tag the print server wants (cloud: true, gen 1, no regen)', prints[0].cloud === true && !prints[0].regen && prints[0].firstName === 'Kit' && prints[0].clubName === 'Sparks', JSON.stringify(prints[0]));
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
  check('and a second desk checking the same child in is told "already", with no second job', dup.res.body.already === true && (await status()).queued === 0, JSON.stringify(dup.res.body));
  await puller.tick();
  check('so the puller finds nothing and the label count is still 1', prints.length === 1);

  console.log('\nan undo, then a new check-in, prints again with a higher gen');
  t.night.kids = t.night.kids.filter((k) => k.id !== '662');
  const undo = await t.call('POST', '/v1/desk/undo', { night: NIGHT, clubberId: '662', club: 'Sparks', historyRow: await sealedRow('undo', { ts: t.clock.t, first: 'Kit', last: 'Zyxelquill', clubberId: '662', source: 'desk' }) });
  check('the undo is accepted', undo.body.ok === true, JSON.stringify(undo.body));
  await WATCHER(WATCH_INTERVAL_MS);
  const second = await deskCheckIn('662', 'Kit', 'Zyxelquill', 'Sparks');
  check('the new check-in is a new claim: gen is higher than the first', second.res.body.ok === true && second.res.body.gen > first.res.body.gen, JSON.stringify(second.res.body));
  const r2 = await puller.tick();
  check('and prints a second label, flagged as the next generation', r2.handled === 1 && printedFor('662') === 2 && prints[1].cloud === true && prints[1].regen === true, JSON.stringify(prints.map((b) => b.regen)));
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

  console.log(`\n${passed} passed, ${failed} failed`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

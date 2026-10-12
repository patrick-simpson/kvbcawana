#!/usr/bin/env node
// The church settings from the sync Worker (docs/SETTINGS-OVERHAUL.md section 4;
// wire: lobby/worker/src/routes.md section 10.3), on the REAL print server with a
// stub powershell and a stand-in Worker that speaks GET/PUT /v1/church/settings.
// What it must do:
//   * an empty doc is seeded by a STATION only, with config.json's church part and
//     nothing else (no printer, no secret), first writer wins;
//   * a newer rev is applied: config.json written once, atomically, with a .bak, and
//     the live config with it; a key the doc lacks keeps config.json's; a key the doc
//     dropped goes back to its default;
//   * a pickup list change reaches the still-here list and the station's extras, a
//     season change the extras and the tally (when this station publishes it);
//   * a value the print server's own cleaner refuses keeps config.json's and is a
//     /health warning;
//   * offline, the last applied values print (config.json is the fallback);
//   * `paused` (CHURCH_SETTINGS off) and config.json `churchSync: false` stop applying;
//   * the timing: 5 s after sign-in, on the lease's signal, every 60 s off-station.
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
const PORT = Number(process.env.AWANA_TEST_PORT || require('./free-port.cjs')());
const SYNC = 'https://awana-sync.test.workers.dev';
const SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';
const SWITCHES_ON = { CLOUD_PRINT: 'on', SINGLE_PUBLISHER: 'on', YM_CHECKOUT: 'on', CHURCH_SETTINGS: 'on', NOTICES: 'on', CHANGE_LOG: 'on' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The Worker's church route, in memory (routes.md 10.3). */
function makeWorker() {
  const w = { doc: null, rev: 0, paused: false, switches: { ...SWITCHES_ON }, switchesRev: 1, calls: [], down: false, seedWhenAsked: null };
  w.answer = (method, body, station) => {
    w.calls.push({ method, body, station });
    if (w.down) return { ok: false, status: 0, body: null };
    if (method === 'GET') {
      return { ok: true, status: 200, body: { rev: w.rev, savedAt: null, by: null, seeded: w.rev > 0, paused: w.paused, settings: w.rev ? w.doc : null, switches: { ...w.switches }, switchesRev: w.switchesRev } };
    }
    if (method === 'PUT' && body && body.seed === true) {
      if (!station) return { ok: false, status: 403, body: { error: 'station only' } };
      if (w.seedWhenAsked) { w.seedWhenAsked(); w.seedWhenAsked = null; }
      if (w.rev > 0) return { ok: true, status: 200, body: { already: true, rev: w.rev } };
      w.rev = 1; w.doc = { ...body.settings };
      return { ok: true, status: 201, body: { rev: 1 } };
    }
    if (method === 'PUT' && body && body.baseRev !== undefined) {   // the edit route
      w.edits = (w.edits || 0) + 1;
      if (body.baseRev !== w.rev) return { ok: false, status: 409, body: { reason: 'stale', rev: w.rev, settings: w.doc } };
      w.doc = { ...w.doc, ...body.settings }; w.rev++;
      return { ok: true, status: 200, body: { ok: true, rev: w.rev, settings: { ...w.doc } } };
    }
    return { ok: false, status: 400, body: null };
  };
  return w;
}

(async () => {
  // ── the pure module: precedence, seeding, timing ──────────────────────────
  const { createChurchSync, seedFrom } = require(path.join(root, 'print-server', 'church-sync.js'));
  console.log('\nchurch-sync.js on its own');
  {
    const seed = seedFrom({ printerName: 'DYMO', displayKey: 'k', syncSession: 's', labelFooter: 'KVBC', trophyBand: false, schedule: [], pickupClubs: ['Sparks'] }, { barfNights: ['2026-10-14'] });
    check('the seed is config.json\'s church part only: no printer, no secret; the default schedule is not sent; BARF nights from church-config.json',
      JSON.stringify(seed) === JSON.stringify({ labelFooter: 'KVBC', trophyBand: false, pickupClubs: ['Sparks'], barfNights: ['2026-10-14'] }), JSON.stringify(seed));
    check('config.json\'s own BARF nights win over church-config.json\'s', JSON.stringify(seedFrom({ barfNights: [] }, { barfNights: ['2026-10-14'] }).barfNights) === '[]');

    let t = 1000;
    const w = makeWorker();
    const patches = [];
    let station = false;
    let signed = true;
    let local = false;
    let saved = null;
    const sync = createChurchSync({
      signedIn: () => (signed ? { base: SYNC, session: SESSION } : null),
      request: async (b, p, o) => w.answer(o.method, o.body, o.station),
      isStation: () => station, stationId: () => (station ? 'station-aaaaaaaa' : null),
      readConfig: () => ({ labelFooter: 'Laptop', connectCardGreeting: 'Hi', printerName: 'X' }),
      churchConfig: () => ({}), localOff: () => local,
      applyPatch: (patch, deletes) => { patches.push({ patch, deletes }); return { errors: [], changed: Object.keys(patch), pickupChanged: false, seasonChanged: false }; },
      saveApplied: (s) => { saved = s; }, now: () => t,
    });
    check('not a station: an empty doc is left empty (only a station seeds)', (await sync.syncNow()) === 'not-seeded' && !w.calls.some((c) => c.method === 'PUT') && sync.status().source === 'config');
    check('the switches are kept in memory from the first answer', sync.switches().SINGLE_PUBLISHER === 'on');
    station = true;
    check('a station seeds it', (await sync.syncNow()) === 'seeded' && w.rev === 1 && w.calls.at(-1).station === 'station-aaaaaaaa'
      && JSON.stringify(w.doc) === JSON.stringify({ labelFooter: 'Laptop', connectCardGreeting: 'Hi' }), JSON.stringify(w.doc));
    check('and counts rev 1 as applied with no write (config.json already holds those values)', sync.appliedRev() === 1 && patches.length === 0 && saved.rev === 1 && sync.status().source === 'worker');
    w.rev = 2; w.doc = { labelFooter: 'Owner', lateGraceMin: 20 };
    check('a newer rev is applied: the doc\'s keys win, a key it dropped since goes back to its default', (await sync.syncNow()) === 'applied'
      && JSON.stringify(patches.at(-1)) === JSON.stringify({ patch: { labelFooter: 'Owner', lateGraceMin: 20 }, deletes: ['connectCardGreeting'] }), JSON.stringify(patches.at(-1)));
    check('the same rev again changes nothing', (await sync.syncNow()) === 'current' && patches.length === 1);
    w.rev = 3; w.doc = { labelFooter: 'Owner', lateGraceMin: 20, seasonTheme: 'summer' };
    await sync.syncNow();
    check('a value the shared allowlist refuses is not sent to config.json, and is a warning', !('seasonTheme' in patches.at(-1).patch) && sync.warnings()[0].type === 'church-settings' && /seasonTheme/.test(sync.warnings()[0].message), JSON.stringify(sync.warnings()));
    w.paused = true; w.rev = 4; w.doc = { labelFooter: 'Paused' };
    check('paused: nothing applied, config.json alone', (await sync.syncNow()) === 'paused' && patches.length === 2 && sync.status().paused === true && sync.status().source === 'config' && !sync.managed());
    w.paused = false; local = true;
    check('churchSync: false in config.json: nothing applied', (await sync.syncNow()) === 'local-off' && patches.length === 2 && !sync.managed());
    local = false;
    w.down = true;
    check('the Worker unreachable: nothing applied, nothing thrown', (await sync.syncNow()) === 'error' && patches.length === 2 && sync.lastError() === 'unreachable');
    w.down = false;

    // The lease's signal: fetch only when the doc or the switches moved.
    const before = w.calls.length;
    await sync.syncNow();   // applies rev 4
    const n = w.calls.length;
    sync.onChurch(4, 1);
    await sleep(10);
    check('the lease naming the applied rev and switches asks nothing', w.calls.length === n && n === before + 1);
    w.switches.SINGLE_PUBLISHER = 'off'; w.switchesRev = 2;
    sync.onChurch(4, 2);
    await sleep(10);
    check('a switches rev that moved fetches at once, and the new switch value is kept', w.calls.length === n + 1 && sync.switches().SINGLE_PUBLISHER === 'off');
    w.rev = 5; w.doc = { labelFooter: 'Five' };
    sync.onChurch(5, 2);
    sync.onChurch(5, 2);
    await sleep(10);
    check('a doc rev that moved fetches and applies (two signals at once are one fetch, or one more)', sync.appliedRev() === 5 && w.calls.length <= n + 3 && patches.at(-1).patch.labelFooter === 'Five');

    // The loop: 5 s after sign-in, then every 60 s when not a station (a station waits for the lease).
    signed = false;
    check('signed out: the loop asks nothing', sync.tick() === null);
    signed = true;
    t = 100000;
    check('...nor in the first 5 s after signing in', sync.tick() === null);
    t += 5000;
    const c0 = w.calls.length;
    await sync.tick();
    check('5 s after sign-in: one fetch', w.calls.length === c0 + 1);
    t += 30000;
    check('a station does not poll (the lease says when)', sync.tick() === null);
    station = false;
    t += 30000;
    await sync.tick();
    check('a computer that is not a station asks every 60 s', w.calls.length === c0 + 2);

    // A second station seeding the same empty doc: first writer wins, the other applies its copy.
    const w2 = makeWorker();
    const patches2 = [];
    const other = createChurchSync({
      signedIn: () => ({ base: SYNC, session: SESSION }), request: async (b, p, o) => w2.answer(o.method, o.body, o.station),
      isStation: () => true, stationId: () => 'station-bbbbbbbb', readConfig: () => ({ labelFooter: 'Mine' }),
      applyPatch: (patch, deletes) => { patches2.push({ patch, deletes }); return { errors: [], changed: [], pickupChanged: false, seasonChanged: false }; },
    });
    w2.seedWhenAsked = () => { w2.rev = 1; w2.doc = { labelFooter: 'Theirs' }; };
    check('a seed that loses the race fetches the winner\'s doc and applies it', (await other.syncNow()) === 'applied' && patches2[0].patch.labelFooter === 'Theirs' && other.appliedRev() === 1, JSON.stringify(patches2));

    // A write that fails is retried on the next lease, and is a warning.
    const w3 = makeWorker();
    w3.rev = 2; w3.doc = { labelFooter: 'X' };
    let fail = true;
    const broken = createChurchSync({
      signedIn: () => ({ base: SYNC, session: SESSION }), request: async (b, p, o) => w3.answer(o.method, o.body, o.station),
      isStation: () => true, stationId: () => 'station-cccccccc', readConfig: () => ({}),
      applyPatch: () => { if (fail) throw new Error('disk full'); return { errors: [], changed: ['labelFooter'], pickupChanged: false, seasonChanged: false }; },
    });
    check('a config.json write that fails is not counted as applied, and says so on /health', (await broken.syncNow()) === 'write-failed' && broken.appliedRev() === 0 && /disk full/.test(broken.warnings()[0].message));
    fail = false;
    broken.onChurch(2, 1);
    await sleep(10);
    check('...and the next lease tries again', broken.appliedRev() === 2 && broken.warnings().length === 0);
  }

  // ── the real print server ─────────────────────────────────────────────────
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-churchbin-'));
  const jobLog = path.join(binDir, 'jobs.log');
  fs.writeFileSync(path.join(binDir, 'powershell'), `#!/bin/sh\necho job >> ${jobLog}\nexit 0\n`, { mode: 0o755 });
  process.env.PATH = `${binDir}:${process.env.PATH}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-church-'));
  const configFile = path.join(dataDir, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify({
    printerName: 'Fake', lateGraceMin: 24 * 60, labelFooter: 'Laptop footer', connectCardGreeting: 'Welcome!',
    pickupClubs: ['Sparks'], schedule: [{ club: 'Sparks', startTime: '18:30', location: 'Gym', room: '4' }],
    displayKey: Buffer.alloc(32, 7).toString('base64'), syncUrl: SYNC, syncSession: SESSION,
  }, null, 2));
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), 'Clubber ID,First Name,Last Name,Club\n1,Ava,Stone,Sparks\n2,Eli,Stone,Cubbies\n');
  Object.assign(process.env, { AWANA_DATA_DIR: dataDir, AWANA_PORT: String(PORT), AWANA_BIND_HOST: '127.0.0.1', PRINTER_NAME: 'Fake' });

  const w = makeWorker();
  const published = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (!u.startsWith(SYNC)) return realFetch(url, init);
    const p = u.slice(SYNC.length);
    if (p === '/v1/church/settings') {
      const body = init && init.body ? JSON.parse(init.body) : undefined;
      const r = w.answer((init && init.method) || 'GET', body, null);
      return r.status === 0 ? Promise.reject(new Error('offline')) : new Response(JSON.stringify(r.body), { status: r.status });
    }
    if (p === '/v1/publish') { try { published.push(JSON.parse(init.body).event); } catch { /* not JSON */ } return new Response('{"ok":true}', { status: 200 }); }
    return new Response('{}', { status: 200 });
  };
  const server = require(path.join(root, 'print-server', 'server.js'));
  const listener = server.startListening();
  await listener.ready;
  server.stopChurchSync();   // this suite drives it by hand
  const base = `http://127.0.0.1:${PORT}`;
  const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const health = async () => (await fetch(`${base}/health`)).json();
  const disk = () => JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const live = require(path.join(root, 'print-server', 'server', 'config.js'));
  const sync = server.churchSync;

  console.log('\nthe print server: not a station');
  {
    check('an empty doc: nothing is seeded by a computer that is not a station', (await sync.syncNow()) === 'not-seeded' && !w.calls.some((c) => c.method === 'PUT'));
    const h = await health();
    check('/health: church {rev 0, source config}', h.church && h.church.rev === 0 && h.church.source === 'config' && h.church.paused === false, JSON.stringify(h.church));
  }

  console.log('\nthe print server as a station: the first-run seed');
  const stationCalls = [];
  const stationRequest = async (b, p, o) => {
    stationCalls.push({ p, ...o });
    if (p === '/v1/church/settings') return w.answer(o.method || 'GET', o.body, o.station);
    if (p.startsWith('/v1/print/next')) return { ok: true, status: 200, body: { jobs: [], leaseMs: 90000, church: { rev: w.rev, switchesRev: w.switchesRev } } };
    return { ok: true, status: 200, body: { ok: true } };
  };
  // A remembered leader on this laptop before 9.3.0: the seed carries the list.
  fs.writeFileSync(path.join(dataDir, 'leaders.json'), JSON.stringify([{ key: 'pat simpson', firstName: 'Pat', lastName: 'Simpson', clubName: 'Sparks', lastPrintedAt: Date.now() - 86400000, printCount: 3 }]));
  const reconfigure = () => server.configureCloud({ stationId: 'station-aaaaaaaa', ring: async () => null, request: stationRequest, start: false, journalFile: null });
  check('this computer is a station', reconfigure().ok === true);
  {
    const mtime = fs.statSync(configFile).mtimeMs;
    check('a station seeds the empty doc', (await sync.syncNow()) === 'seeded' && w.rev === 1);
    const put = w.calls.find((c) => c.method === 'PUT');
    check('as the station, with seed: true', put && put.station === 'station-aaaaaaaa' && put.body.seed === true);
    check('with config.json\'s church part: its schedule, footer, greeting, pickup list, late grace, BARF nights from church-config.json',
      put.body.settings.labelFooter === 'Laptop footer' && put.body.settings.connectCardGreeting === 'Welcome!' && JSON.stringify(put.body.settings.pickupClubs) === '["Sparks"]'
      && put.body.settings.schedule.length === 1 && put.body.settings.lateGraceMin === 120 && Array.isArray(put.body.settings.barfNights), JSON.stringify(put.body.settings));
    check('and the remembered leaders (leaders.json), names and counts only', JSON.stringify(put.body.settings.leaders) === JSON.stringify([{ firstName: 'Pat', lastName: 'Simpson', clubName: 'Sparks', lastPrintedAt: put.body.settings.leaders[0].lastPrintedAt, printCount: 3 }]), JSON.stringify(put.body.settings.leaders));
    check('and NOTHING else: no printer, no key, no session', !/Fake|syncSession|displayKey|printerName|oWr6n92/.test(JSON.stringify(put.body)), JSON.stringify(put.body));
    check('config.json is not rewritten by the seed', fs.statSync(configFile).mtimeMs === mtime);
    const appliedFile = JSON.parse(fs.readFileSync(path.join(dataDir, 'church-applied.json'), 'utf8'));
    check('church-applied.json records rev 1', appliedFile.rev === 1 && typeof appliedFile.appliedAt === 'string');
    check('/health: source worker', (await health()).church.source === 'worker');
  }

  console.log('\nan edit on the page reaches config.json');
  {
    const before = fs.readFileSync(configFile, 'utf8');
    stationCalls.length = 0;
    published.length = 0;
    w.rev = 2;
    w.doc = { ...w.doc, labelFooter: 'From the page', pickupClubs: ['Sparks', 'Cubbies'], seasonTheme: 'christmas' };
    delete w.doc.connectCardGreeting;
    sync.onChurch(2, 1);
    await sleep(150);
    const d = disk();
    check('applied: the new values are in config.json', sync.appliedRev() === 2 && d.labelFooter === 'From the page' && JSON.stringify(d.pickupClubs) === '["Cubbies","Sparks"]' && d.seasonTheme === 'christmas', JSON.stringify(d));
    check('written atomically, the replaced file kept as config.json.bak', fs.readFileSync(configFile + '.bak', 'utf8') === before && !fs.existsSync(configFile + '.tmp'));
    check('and the live config follows (no restart)', live.config.labelFooter === 'From the page' && live.config.seasonTheme === 'christmas');
    check('a key the doc dropped since the last apply goes back to its default', !('connectCardGreeting' in d) && !('connectCardGreeting' in live.config));
    check('the per-laptop keys and the secrets are untouched', d.printerName === 'Fake' && d.syncSession === SESSION && typeof d.displayKey === 'string');
    const extras = stationCalls.filter((c) => c.p === '/v1/station/extras');
    check('the pickup list and the season reach the Worker as the station\'s extras', extras.some((c) => JSON.stringify(c.body.pickupClubs) === '["Cubbies","Sparks"]' && c.body.season === 'christmas'), JSON.stringify(stationCalls.map((c) => c.p)));
    check('with SINGLE_PUBLISHER on the station publishes no tally of its own', !published.includes('tally'), JSON.stringify(published));
    const p = await post('/print', { name: 'Ava Stone', clubName: 'Sparks', clubberId: '1' });
    check('and the next label prints with the new values', p.status === 200 && p.body.success === true, JSON.stringify(p.body));
  }

  console.log('\nprecedence: a key the doc never had keeps config.json\'s');
  {
    const r = await post('/config', { trophyBand: false });   // the extension / this computer's own write: never refused
    check('this computer\'s own write saves', r.status === 200 && disk().trophyBand === false);
    w.rev = 3; w.doc = { ...w.doc, labelFooter: 'Rev 3' };
    await sync.syncNow();
    check('a later apply leaves it alone (the doc has no trophyBand)', disk().trophyBand === false && disk().labelFooter === 'Rev 3');
  }

  console.log('\na value the print server refuses keeps config.json\'s, and /health says so');
  {
    w.rev = 4; w.doc = { ...w.doc, seasonTheme: 'midsummer', lateGraceMin: 15 };
    await sync.syncNow();
    const h = await health();
    const warn = h.warnings.find((x) => x.type === 'church-settings');
    check('the refused key keeps its value, the rest applies', disk().seasonTheme === 'christmas' && disk().lateGraceMin === 15, JSON.stringify(disk()));
    check('a {type, message} warning names it', warn && typeof warn.message === 'string' && /seasonTheme/.test(warn.message), JSON.stringify(h.warnings));
    w.rev = 5; w.doc = { ...w.doc, seasonTheme: 'fall' };
    await sync.syncNow();
    check('and it clears when the doc is good again', disk().seasonTheme === 'fall' && !(await health()).warnings.some((x) => x.type === 'church-settings'));
  }

  console.log('\nthe season reaches the tally when this station publishes it (SINGLE_PUBLISHER off)');
  {
    published.length = 0;
    w.switches.SINGLE_PUBLISHER = 'off'; w.switchesRev = 2;
    w.rev = 6; w.doc = { ...w.doc, seasonTheme: 'winter' };
    await sync.syncNow();
    await sleep(150);
    check('a season change publishes a tally at once', published.includes('tally'), JSON.stringify(published));
    w.switches.SINGLE_PUBLISHER = 'on'; w.switchesRev = 3;
    await sync.syncNow();
  }

  console.log('\noffline: the last applied values print');
  {
    w.down = true;
    w.rev = 7; w.doc = { ...w.doc, labelFooter: 'Never arrives' };
    check('the Worker unreachable: nothing applied, nothing thrown', (await sync.syncNow()) === 'error' && disk().labelFooter === 'Rev 3');
    const p = await post('/print', { name: 'Eli Stone', clubName: 'Cubbies', clubberId: '2' });
    check('printing goes on from config.json', p.status === 200 && p.body.success === true && live.config.labelFooter === 'Rev 3', JSON.stringify(p.body));
    w.down = false;
  }

  console.log('\npaused and churchSync: false stop applying');
  {
    w.paused = true;
    check('paused: nothing applied', (await sync.syncNow()) === 'paused' && disk().labelFooter === 'Rev 3' && (await health()).church.paused === true);
    w.paused = false;
    await post('/config', { churchSync: false });   // not a POST /config key: has no effect
    const cfg = disk(); cfg.churchSync = false; fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2));
    server.applySavedConfig(cfg);
    check('config.json churchSync: false: nothing applied', (await sync.syncNow()) === 'local-off' && disk().labelFooter === 'Rev 3' && (await health()).church.source === 'config');
    delete cfg.churchSync; fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2));
    server.applySavedConfig(cfg);
    check('and on again, the newest doc applies', (await sync.syncNow()) === 'applied' && disk().labelFooter === 'Never arrives');
  }

  console.log('\nthe station\'s lease and heartbeat (the wiring)');
  {
    stationCalls.length = 0;
    w.rev = 8; w.doc = { ...w.doc, labelFooter: 'From the lease' };
    await live.cloudStation.puller.tick();
    await sleep(150);
    const pkg = require(path.join(root, 'print-server', 'package.json'));
    const hb = stationCalls.find((c) => c.p === '/v1/print/heartbeat');
    check('the heartbeat carries the app version and the applied church rev', hb && hb.body.version === pkg.version && hb.body.churchRev === 7, JSON.stringify(hb && hb.body));
    check('the lease\'s church field (rev 8) makes the station fetch and apply within the tick', sync.appliedRev() === 8 && disk().labelFooter === 'From the lease', JSON.stringify(stationCalls.map((c) => c.p)));
    stationCalls.length = 0;
    await live.cloudStation.puller.tick();
    await sleep(50);
    check('a lease naming the applied rev asks for nothing more', !stationCalls.some((c) => c.p === '/v1/church/settings'), JSON.stringify(stationCalls.map((c) => c.p)));
  }

  console.log('\nthe remembered leaders are a church setting (owner, 2026-10-12)');
  {
    const leadersFile = path.join(dataDir, 'leaders.json');
    const local = () => JSON.parse(fs.readFileSync(leadersFile, 'utf8'));
    const names = (list) => list.map((l) => `${l.firstName} ${l.lastName}`).sort().join();
    const patLocal = local().find((l) => l.firstName === 'Pat');
    // Another device added a leader; the Worker's copy of Pat is older than this laptop's.
    w.rev++; w.doc = { ...w.doc, leaders: [{ firstName: 'Pat', lastName: 'Simpson', clubName: 'Sparks', lastPrintedAt: 1000, printCount: 1 }, { firstName: 'Lee', lastName: 'Ader', clubName: 'Cubbies', lastPrintedAt: Date.now() - 1000, printCount: 2 }] };
    await sync.syncNow();
    const after = local();
    check('the Worker\'s list is applied over the local one, written through to leaders.json', names(after) === 'Lee Ader,Pat Simpson', JSON.stringify(after));
    check('a leader both hold keeps the newer last print and the larger count', after.find((l) => l.firstName === 'Pat').lastPrintedAt === patLocal.lastPrintedAt && after.find((l) => l.firstName === 'Pat').printCount === 3);
    const chips = await (await fetch(`${base}/leaders`)).json();
    check('the chips (GET /leaders) show both', names(chips.leaders) === 'Lee Ader,Pat Simpson', JSON.stringify(chips));
    check('config.json never holds the leaders', !('leaders' in disk()));

    const edits = w.edits || 0;
    const revBefore = w.rev;
    const p1 = await post('/print-leader', { firstName: 'Max', lastName: 'Newman', clubName: 'Trek' });
    await sleep(150);
    check('a leader tag with a NEW name prints', p1.status === 200 && p1.body.success === true, JSON.stringify(p1.body));
    check('...and adds them to the Worker\'s list through the edit route (baseRev), keeping the others', w.edits === edits + 1 && w.rev === revBefore + 1
      && names(w.doc.leaders) === 'Lee Ader,Max Newman,Pat Simpson', JSON.stringify(w.doc.leaders));
    check('...counted as applied (this computer already holds it): no second fetch needed', sync.appliedRev() === w.rev);
    const p2 = await post('/print-leader', { firstName: 'Max', lastName: 'Newman', clubName: 'Trek', printerName: '' });
    await sleep(150);
    check('a name already remembered is not sent again', p2.status === 200 && w.edits === edits + 1);

    // A race: someone else saved the doc a moment before this laptop's add.
    w.rev++; w.doc = { ...w.doc, labelFooter: 'Changed elsewhere' };
    await post('/print-leader', { firstName: 'Ana', lastName: 'Race', clubName: 'Sparks' });
    await sleep(200);
    check('a stale base is read again (the other change applied) and the add tried again: both land', names(w.doc.leaders) === 'Ana Race,Lee Ader,Max Newman,Pat Simpson'
      && w.doc.labelFooter === 'Changed elsewhere' && disk().labelFooter === 'Changed elsewhere', JSON.stringify(w.doc));

    // No internet: the tag prints, the name is kept here, and reaches the Worker later.
    w.down = true;
    const p3 = await post('/print-leader', { firstName: 'Ola', lastName: 'Offline', clubName: 'Sparks' });
    await sleep(150);
    check('offline: the leader tag prints and the name is remembered here', p3.body.success === true && names(local()).includes('Ola Offline'));
    w.down = false;
    w.rev++; w.doc = { ...w.doc, labelFooter: 'Back online' };
    await sync.syncNow();
    check('an apply that lands before the add keeps the pending name', names(local()).includes('Ola Offline'));
    await sleep(200);
    check('...and the add is tried again then, and lands', names(w.doc.leaders).includes('Ola Offline'), JSON.stringify(w.doc.leaders));

    // A forget elsewhere is a forget here; a forget here is a forget there.
    w.rev++; w.doc = { ...w.doc, leaders: w.doc.leaders.filter((l) => l.firstName !== 'Lee') };
    await sync.syncNow();
    check('a leader the Worker\'s list no longer holds is forgotten here', !names(local()).includes('Lee Ader'));
    const f = await post('/leaders/forget', { key: 'ana race' });
    await sleep(150);
    check('the × here forgets them in the Worker\'s list too', f.body.removed === true && !names(w.doc.leaders).includes('Ana Race') && !names(local()).includes('Ana Race'), JSON.stringify(w.doc.leaders));
  }

  globalThis.fetch = realFetch;
  server.stopCloud();
  console.log(`\n${passed} passed, ${failed} failed`);
  listener.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

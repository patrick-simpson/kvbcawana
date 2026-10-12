#!/usr/bin/env node
// Online check-in P5: the PRINT STATION makes the greeting. With the Worker as the
// one publisher (SINGLE_PUBLISHER), the laptop's own `checkin` frames are dropped;
// the one that gets through is the station's, sent to POST /v1/publish with the
// print job it printed (`X-Station`, `X-Job`), so a child is greeted once, with
// everything only this computer knows (birthday, first-timer, milestone).
// Here the REAL print server runs with a stub powershell and a stand-in Worker
// request; what it must do:
//   * a job's /print (cloud: true, cloudJob: <jobId>) greets through the job route,
//     sealed (the name is not in the frame), with the printer's own flags;
//   * a /print with no job (the phone page's relay job, the extension) greets as the
//     station too, naming the child (`greet: {clubberId}` or a visitor's name and club)
//     so the Worker can greet each child once;
//   * a job that meets a label already printed prints nothing and greets LATE with the
//     same event (same id) and its job: the Worker drops it if the child was greeted;
//   * a refusal (4xx: the Worker already greeted this job) is not retried, an
//     unreachable Worker is, three times;
//   * the station tells the Worker its season, rehearsal flag and pickup clubs.
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
const PORT = 34588;
const JOB_A = 'A'.repeat(22);
const JOB_B = 'B'.repeat(22);
const JOB_C = 'C'.repeat(22);

(async () => {
  const env = await import(pathToFileURL(path.join(root, '..', 'lobby', 'src', 'lib', 'envelope.js')).href);
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-greetbin-'));
  fs.writeFileSync(path.join(binDir, 'powershell'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.PATH = `${binDir}:${process.env.PATH}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-greet-'));
  const today = new Date();
  const bday = `${today.getMonth() + 1}/${today.getDate()}/2016`;
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    printerName: 'Fake', lateGraceMin: 24 * 60, pickupClubs: ['Sparks', 'Trek'],
    syncUrl: 'https://awana-sync.test.workers.dev', syncSession: 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc',
  }));
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), `Clubber ID,First Name,Last Name,Club,Birthdate\n1,Ava,Stone,Sparks,${bday}\n2,Eli,Stone,Cubbies,3/3/2016\n3,Mia,Lee,T&T,3/3/2016\n`);
  Object.assign(process.env, { AWANA_DATA_DIR: dataDir, AWANA_PORT: String(PORT), AWANA_BIND_HOST: '127.0.0.1', PRINTER_NAME: 'Fake' });
  const server = require(path.join(root, 'print-server', 'server.js'));
  const events = require(path.join(root, 'print-server', 'events.js'));
  const key = Buffer.alloc(32, 7).toString('base64');
  events.setDisplayKey(key);
  const listener = server.startListening();
  await listener.ready;
  const base = `http://127.0.0.1:${PORT}`;
  const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

  // The stand-in Worker for the station's own requests, and a stub for every other call to the
  // sync service (the laptop's plain relay): it records what the laptop would publish and says 503.
  const calls = [];
  const plain = [];
  let answer = { ok: true, status: 200, body: { ok: true } };
  const request = async (b, p, o) => { calls.push({ p, ...o }); return typeof answer === 'function' ? answer(p, o) : answer; };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://awana-sync.test.workers.dev')) {
      try { plain.push(JSON.parse(init.body).event); } catch { /* not a publish */ }
      return new Response('{}', { status: 503 });
    }
    return realFetch(url, init);
  };

  console.log('\nthe station greets with the job it printed');
  const cfg = server.configureCloud({ stationId: 'station-aaaaaaaa', ring: async () => null, request, start: false, journalFile: null });
  check('this computer is a station', cfg.ok === true, JSON.stringify(cfg));
  const fresh = () => { calls.length = 0; };
  const greetingsSeen = {};
  const greetings = () => calls.filter((c) => c.p === '/v1/publish');

  {
    fresh();
    const r = await post('/print', { name: 'Ava Stone', clubName: 'Sparks', clubberId: '1', cloud: true, cloudJob: JOB_A });
    check('the job prints', r.status === 200 && r.body.success === true, JSON.stringify(r));
    await new Promise((resolve) => setTimeout(resolve, 50));
    check('and the station sent ONE frame to the Worker, to /v1/publish, as the station, naming the job', greetings().length === 1
      && greetings()[0].station === 'station-aaaaaaaa' && greetings()[0].headers['X-Job'] === JOB_A && greetings()[0].method === 'POST', JSON.stringify(calls));
    const frame = greetings()[0] && greetings()[0].body;
    check('a sealed checkin (no name in it)', frame && frame.event === 'checkin' && env.isEnvelope(frame.payload) && !JSON.stringify(frame).includes('Ava'), JSON.stringify(frame).slice(0, 200));
    const opened = await env.openEnvelope(await env.importDisplayKey(key), 'checkin', frame.payload);
    greetingsSeen.A = opened.payload;
    check('it opens with the display key: first name, club, the birthday this week', opened.ok && opened.payload.firstName === 'Ava' && opened.payload.club === 'Sparks' && opened.payload.isBirthday === true && opened.payload.isFirstTimer === false, JSON.stringify(opened));
    check('and it is not sent through the laptop\'s own relay queue', plain.length === 0, JSON.stringify(plain));
  }

  console.log('\na first-timer');
  {
    fresh();
    await post('/print', { name: 'Zoe New', clubName: 'Cubbies', visitor: true, cloud: true, cloudJob: JOB_B });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const opened = await env.openEnvelope(await env.importDisplayKey(key), 'checkin', greetings()[0].body.payload);
    check('the greeting says first-timer (the laptop\'s own rule, on the station)', opened.ok && opened.payload.isFirstTimer === true && opened.payload.firstName === 'Zoe', JSON.stringify(opened));
  }

  console.log('\na job that meets a label already printed greets late, with the same event; a job-less print names its child');
  {
    const k = await env.importDisplayKey(key);
    fresh();
    const first = greetingsSeen.A;
    const again = await post('/print', { name: 'Ava Stone', clubName: 'Sparks', clubberId: '1', cloud: true, cloudJob: JOB_A });
    check('the duplicate prints nothing', again.body.duplicate === true, JSON.stringify(again));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const late = greetings()[0];
    const lateOpened = late && await env.openEnvelope(k, 'checkin', late.body.payload);
    check('and sends ONE late greeting as the station, with its job, the SAME event (a screen that showed it drops it)', greetings().length === 1
      && late.body.late === true && late.headers['X-Job'] === JOB_A && late.station === 'station-aaaaaaaa'
      && lateOpened.ok && lateOpened.payload.id === first.id && lateOpened.payload.isBirthday === true, JSON.stringify({ calls, first, lateOpened }));
    fresh();
    const own = await post('/print', { name: 'Mia Lee', clubName: 'T&T', clubberId: '3' });
    check('a /print with no job prints as ever', own.body.success === true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    check('and the station greets naming the child (no job), never through the laptop\'s plain relay', greetings().length === 1 && !greetings()[0].headers
      && JSON.stringify(greetings()[0].body.greet) === JSON.stringify({ clubberId: '3' }) && !greetings()[0].body.late && !plain.includes('checkin'), JSON.stringify({ calls, plain }));
    fresh();
    await post('/print', { name: 'Kay Visitor', clubName: 'Sparks', visitor: true });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const v = greetings().find((c) => c.body.greet && c.body.greet.name === 'Kay Visitor');
    check('a visitor with no clubber id is named by name and club', v && v.body.greet.club === 'Sparks' && !JSON.stringify(v.body.payload).includes('Kay'), JSON.stringify(calls.map((c) => c.body && c.body.greet)));
    fresh();
    const bad = await post('/print', { name: 'Eli Stone', clubName: 'Cubbies', clubberId: '2', cloud: true, cloudJob: 'not a job id' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    check('a job id that is not a job id is ignored (the child is named instead)', bad.body.success === true && greetings().length === 1 && !greetings()[0].headers
      && greetings()[0].body.greet.clubberId === '2', JSON.stringify(calls));
  }

  console.log('\nretries: a refusal is an answer, an unreachable Worker is tried again');
  {
    fresh();
    const sent = await server.sendGreeting({ v: 1 }, JOB_C);
    check('sent', sent === true && greetings().length === 1);
    fresh();
    answer = { ok: true, status: 200, body: { ok: true, dropped: true, reason: 'already-greeted' } };
    check('a dropped answer (already greeted) is a success and is not repeated', (await server.sendGreeting({ v: 1 }, JOB_C)) === true && greetings().length === 1);
    fresh();
    answer = { ok: false, status: 400, body: { error: 'no' } };
    check('a 4xx is not retried', (await server.sendGreeting({ v: 1 }, JOB_C)) === false && greetings().length === 1);
    fresh();
    answer = { ok: false, status: 0, body: null };
    const t0 = Date.now();
    const down = await server.sendGreeting({ v: 1 }, JOB_C);
    check('an unreachable Worker is tried three times, then given up on', down === false && greetings().length === 3 && Date.now() - t0 >= 2900, `${greetings().length} ${Date.now() - t0}`);
    answer = { ok: true, status: 200, body: { ok: true } };
  }

  console.log('\nthe station tells the Worker what only this computer knows');
  {
    fresh();
    const ok = await server.sendStationExtras(true);
    const extras = calls.find((c) => c.p === '/v1/station/extras');
    check('POST /v1/station/extras as the station with the season, the rehearsal flag and the pickup clubs', ok === true && extras && extras.station === 'station-aaaaaaaa'
      && typeof extras.body.season === 'string' && extras.body.rehearsal === false && JSON.stringify(extras.body.pickupClubs) === JSON.stringify(['Sparks', 'Trek']), JSON.stringify(extras));
    fresh();
    await server.sendStationExtras();
    check('and not again inside the minute while nothing changed', calls.length === 0);
    const saved = await post('/config', { pickupClubs: ['Cubbies'] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    check('a changed pickup list is sent at once', saved.status === 200 && calls.some((c) => c.p === '/v1/station/extras' && JSON.stringify(c.body.pickupClubs) === JSON.stringify(['Cubbies'])), JSON.stringify(calls.map((c) => c.p)));
  }

  console.log('\nonly a station greets this way');
  {
    server.stopCloud();
    fresh();
    await post('/print', { name: 'Eli Stone', clubName: 'Cubbies', clubberId: '2', cloud: true, cloudJob: JOB_B });
    await new Promise((resolve) => setTimeout(resolve, 50));
    check('with no station role the job route is never used', greetings().length === 0);
  }

  globalThis.fetch = realFetch;
  console.log(`\n${passed} passed, ${failed} failed`);
  listener.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

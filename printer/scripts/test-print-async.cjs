#!/usr/bin/env node
// The print path off the event loop: while a label prints, the server still
// answers, and two labels never reach the printer at once.
//
// Until 7.11.1 every PowerShell call was execSync with Atomics.wait between
// retries: a hung driver blocked the whole process (every request, the
// extension's long poll, the Electron tray) for up to about a minute, and
// /health blocked a few seconds every minute probing the spooler.
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
const PORT = 34584;

(async () => {
  const SRC = fs.readFileSync(path.join(root, 'print-server', 'server.js'), 'utf8');
  console.log('\nprint path: nothing synchronous is left');
  check('no execSync in the print server', !/\bexecSync\(/.test(SRC));
  check('the only Atomics.wait left is the config rename retry (a rare error path)', (SRC.match(/Atomics\.wait\(/g) || []).length === 1 && /renameWithRetrySync[\s\S]{0,400}Atomics\.wait/.test(SRC));
  check('every PowerShell goes through runPowerShell, with no shell', /execFile\('powershell', \['-NoProfile', '-ExecutionPolicy', 'Bypass', \.\.\.args\]/.test(SRC) && !/powershell -NoProfile/.test(SRC.replace(/\/\/[^\n]*/g, '')));

  console.log('\nhealth: the printer probes run from a timer, and /health never waits on a stale cache');
  check('a timer keeps the probe cache warm', /function startPrinterCheckTimer\(\)[\s\S]*setInterval\(\(\) => \{ checkPrinterWarnings\(\)\.catch/.test(SRC) && /startPrinterCheckTimer\(\);/.test(SRC.slice(SRC.indexOf('function startClubNightTimers'))));
  check('a stale cache is handed back while one refresh runs in the background', /if \(cachedPrinterCheck\.checkedAt === 0\) return printerCheckInFlight;\s*return cachedPrinterCheck\.warnings;/.test(SRC));
  check('never two probes at once', /if \(!printerCheckInFlight\) \{\s*printerCheckInFlight = probePrinterWarnings\(now\)\.finally/.test(SRC));

  // A stub powershell that takes half a second per job and logs each one.
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-psbin-'));
  const jobLog = path.join(binDir, 'jobs.log');
  fs.writeFileSync(path.join(binDir, 'powershell'), `#!/bin/sh\necho "start $(date +%s%N)" >> ${jobLog}\nsleep 0.5\necho "end $(date +%s%N)" >> ${jobLog}\nexit 0\n`, { mode: 0o755 });
  process.env.PATH = `${binDir}:${process.env.PATH}`;

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-async-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ printerName: 'Fake' }));
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), 'First Name,Last Name,Club\nAva,Stone,Sparks\nEli,Stone,Cubbies\nMia,Lee,T&T\n');
  Object.assign(process.env, { AWANA_DATA_DIR: dataDir, AWANA_PORT: String(PORT), AWANA_BIND_HOST: '127.0.0.1', PRINTER_NAME: 'Fake' });
  const server = require(path.join(root, 'print-server', 'server.js'));
  const listener = server.startListening();
  await listener.ready;
  const base = `http://127.0.0.1:${PORT}`;
  const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

  console.log('\nprint path: the server answers while a label prints');
  {
    // Three children at once: three half-second print jobs.
    const t0 = Date.now();
    const prints = Promise.all([
      post('/print', { name: 'Ava Stone', clubberId: '1', clubName: 'Sparks' }),
      post('/print', { name: 'Eli Stone', clubberId: '2', clubName: 'Cubbies' }),
      post('/print', { name: 'Mia Lee', clubberId: '3', clubName: 'T&T' }),
    ]);
    await new Promise((r) => setTimeout(r, 150));
    // Meanwhile: the event loop ticks, and /health answers at once.
    let ticks = 0;
    const ticker = setInterval(() => { ticks += 1; }, 20);
    const h0 = Date.now();
    const health = await fetch(`${base}/health`).then((r) => r.status);
    const healthMs = Date.now() - h0;
    await new Promise((r) => setTimeout(r, 400));
    clearInterval(ticker);
    check('/health answers in well under a print\'s time while three labels are queued', health === 200 && healthMs < 300, `${healthMs} ms`);
    check('the event loop kept ticking during the prints', ticks >= 10, String(ticks));
    const results = await prints;
    const total = Date.now() - t0;
    check('all three labels printed', results.every((r) => r.status === 200 && r.body && r.body.success === true), JSON.stringify(results.map((r) => r.status)));
    check('one at a time: three half-second jobs took at least 1.4 s together', total >= 1400, `${total} ms`);
    const log = fs.readFileSync(jobLog, 'utf8').trim().split('\n');
    const starts = log.filter((l) => l.startsWith('start')).map((l) => Number(l.split(' ')[1]));
    const ends = log.filter((l) => l.startsWith('end')).map((l) => Number(l.split(' ')[1]));
    check('three jobs reached the printer', starts.length === 3 && ends.length === 3, log.join(' | '));
    const overlapping = starts.slice(1).some((st, i) => st < ends[i]);
    check('and no job started before the one before it had finished', !overlapping);
  }

  console.log('\nroutes: a rejected async handler is a 500 at once, never a hang');
  {
    // A route that rejects, placed where the real ones are (before the JSON
    // error handler, which Express 4 only reaches for errors passed to next).
    server.app.get('/__test-reject', async () => { throw new Error('boom'); });
    const stack = server.app._router.stack;
    const layer = stack.pop();
    const errAt = stack.findIndex((l) => l.handle && l.handle.length === 4);
    stack.splice(errAt, 0, layer);
    const t0 = Date.now();
    const r = await fetch(`${base}/__test-reject`, { signal: AbortSignal.timeout(5000) }).then(async (x) => ({ status: x.status, body: await x.json().catch(() => null) })).catch((e) => ({ status: 0, body: String(e) }));
    check('the client hears 500 as JSON', r.status === 500 && r.body && r.body.error === 'Internal server error', JSON.stringify(r));
    check('within the moment, not after a timeout', Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
    const src = fs.readFileSync(path.join(__dirname, '..', 'print-server', 'server.js'), 'utf8');
    check('every async route is wrapped at registration', /h\.constructor\.name === 'AsyncFunction'\s*\?\s*\(req, res, next\) => h\(req, res, next\)\.catch\(next\)/.test(src));
    check('label enrichment fails open to a basic label', /Enrichment failed for '\$\{firstName\} \$\{lastName\}'/.test(src) && /Step-up check failed/.test(src) && /Late routing failed/.test(src));
  }

  await server.stopListening();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

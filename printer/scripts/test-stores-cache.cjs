#!/usr/bin/env node
// The print server's stores stay in memory — plain Node, zero deps.
//
// print-history.json and attendance.json were read from disk and parsed on
// nearly every request (the print path several times, the dashboard every
// 15 s, every phone every 12 s), and clubbers.csv was re-parsed and its
// names logged on every print. Each is now held in memory and re-read only
// when the file on disk is not the one last read or written.
//
// Run: node scripts/test-stores-cache.cjs

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
const PORT = 34586;

(async () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-psbin-'));
  fs.writeFileSync(path.join(binDir, 'powershell'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-stores-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ printerName: 'Fake' }));
  const csvFile = path.join(dataDir, 'clubbers.csv');
  fs.writeFileSync(csvFile, 'First Name,Last Name,Club\nAva,Stone,Sparks\nEli,Stone,Sparks\n');
  Object.assign(process.env, { AWANA_DATA_DIR: dataDir, AWANA_PORT: String(PORT), AWANA_BIND_HOST: '127.0.0.1', PRINTER_NAME: 'Fake' });

  // Count what the server reads from disk: fs is one module instance.
  const reads = { history: 0, ledger: 0, csv: 0 };
  const realRead = fs.readFileSync;
  fs.readFileSync = function counted(p, ...rest) {
    const name = typeof p === 'string' ? path.basename(p) : '';
    if (name === 'print-history.json') reads.history++;
    if (name === 'attendance.json') reads.ledger++;
    if (name === 'clubbers.csv') reads.csv++;
    return realRead.call(this, p, ...rest);
  };
  const logs = [];
  const realLog = console.log;
  console.log = (...a) => { logs.push(a.join(' ')); realLog(...a); };

  const server = require(path.join(root, 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((r) => { if (listener.listening) return r(); listener.once('listening', r); });
  const base = `http://127.0.0.1:${PORT}`;
  const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const get = (p) => fetch(`${base}${p}`).then((r) => r.json());
  const snapshot = () => ({ ...reads });

  console.log('\nstores: the history and the ledger are read once, not per request');
  {
    let r = await post('/print', { name: 'Ava Stone', clubberId: '1', clubName: 'Sparks' });
    check('(a check-in printed)', r.status === 200 && r.body.success, JSON.stringify(r));
    const before = snapshot();
    for (let i = 0; i < 5; i++) { await get('/history/today'); await get('/stats/tonight'); await post('/phone/tonight', {}); }
    await get('/attendance-audit').catch(() => null);
    const after = snapshot();
    check('fifteen dashboard and phone requests read print-history.json from disk zero times', after.history === before.history, `${after.history - before.history} reads`);
    check('and attendance.json zero times', after.ledger === before.ledger, `${after.ledger - before.ledger} reads`);
    r = await post('/print', { name: 'Eli Stone', clubberId: '2', clubName: 'Sparks' });
    const rows = await get('/history/today');
    check('a new check-in is in the history at once', rows.length === 2 && rows[0].firstName === 'Eli', JSON.stringify(rows.map((x) => x.firstName)));
  }

  console.log('\nstores: a file changed on disk by someone else is picked up');
  {
    const historyFile = path.join(dataDir, 'print-history.json');
    const rows = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    await new Promise((r) => setTimeout(r, 20));
    fs.writeFileSync(historyFile, JSON.stringify(rows.slice(1)));   // the operator deleted a row by hand
    const seen = await get('/history/today');
    check('the hand-edited history is what the server serves', seen.length === 1 && seen[0].firstName === 'Ava', JSON.stringify(seen.map((x) => x.firstName)));
    const ledgerFile = path.join(dataDir, 'attendance.json');
    const ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
    const key = Object.keys(ledger)[0];
    ledger[key].dates = ['2026-09-02', ...ledger[key].dates];   // a night earlier this season
    await new Promise((r) => setTimeout(r, 20));
    fs.writeFileSync(ledgerFile, JSON.stringify(ledger));
    const att = server.recordAttendance ? server.recordAttendance('Ava', 'Stone', '1') : null;
    check('a hand-edited ledger is what the server counts', att && att.seasonCount === 2, JSON.stringify(att));
  }

  await server.stopListening();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

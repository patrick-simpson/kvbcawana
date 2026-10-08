#!/usr/bin/env node
// The phone's roster (/phone/roster) says who is already checked in, so the
// phone never offers them again. It must agree with the count every screen
// shows (authoritativeTonight), not only with what this printer printed:
// 2026-10-08, the Trek & Journey page offered children checked in at the desk
// or on TwoTimTwo itself, whose rows here were missing, failed, name-only or
// spelled with a double space.
//
// Run: node scripts/test-phone-roster.cjs

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

const PORT = 34791;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-roster-'));
const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-roster-bin-'));
fs.writeFileSync(path.join(binDir, 'powershell'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;

fs.writeFileSync(path.join(dataDir, 'clubbers.csv'),
  'ClubberID,FirstName,LastName,Club\n'
  + '4821,Ava,Stone,Trek\n'
  + '9003,Rigel,Tester,Journey\n'
  + '9004,Sirius,Tester,Trek\n'
  + '9005,Lyra,Tester,Journey\n'
  + '9006,Mira Jane,Quinn,Trek\n'
  + '9007,Otto,Vale,Journey\n'
  + '9008,Nova,Waits,Trek\n'
  + '9009,Pax,Gone,Journey\n');
fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ printerName: 'Fake' }, null, 2));
const now = Date.now();
const row = (r, mins) => Object.assign({ clubName: 'Trek', printer: 'Fake', success: true,
  timestamp: new Date(now - mins * 60000).toISOString() }, r);
// Newest first, as loadHistory() serves it.
fs.writeFileSync(path.join(dataDir, 'print-history.json'), JSON.stringify([
  row({ firstName: 'Mira  Jane', lastName: 'Quinn', clubberId: null }, 4),                // double space
  row({ firstName: 'Lyra', lastName: 'Tester', clubberId: null }, 5),                     // no id
  row({ firstName: 'Rigel', lastName: 'Tester', clubberId: '9003', success: false }, 6),  // print failed
  row({ firstName: 'Ava', lastName: 'Stone', clubberId: '4821' }, 7),
  row({ firstName: 'Otto', lastName: 'Vale', clubberId: '9007' }, 8),
]));
Object.assign(process.env, { AWANA_DATA_DIR: dataDir, AWANA_PORT: String(PORT), AWANA_BIND_HOST: '127.0.0.1', PRINTER_NAME: 'Fake' });

const origLog = console.log;
console.log = () => {};
const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
console.log = origLog;

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
const j = async (p, body) => {
  const r = await fetch(BASE + p, body === undefined
    ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const roster = async () => {
  const out = {};
  (await j('/phone/roster', {})).body.kids.forEach((k) => { out[k.name] = k.checkedIn; });
  return out;
};

async function main() {
  console.log = () => {};
  const listener = server.startListening();
  await new Promise((r) => (listener.listening ? r() : listener.once('listening', r)));
  console.log = origLog;

  console.log('/phone/roster — history only (no report yet)');
  {
    const r = await roster();
    check('a printed child is checked in', r['Ava Stone'] === true);
    check('a name-only row counts', r['Lyra Tester'] === true);
    check('a row with a double space still matches the roster name', r['Mira Jane Quinn'] === true);
    check('a failed print is not a check-in', r['Rigel Tester'] === false);
    check('a child nobody checked in is still to come', r['Nova Waits'] === false);
  }

  console.log('/phone/roster — with TwoTimTwo\'s report (the count\'s source)');
  {
    const rep = await j('/feed/checkin-report', { ok: true, entries: [
      { clubberId: '4821', name: 'Ava Stone', club: 'Trek' },
      { clubberId: '9005', name: 'Lyra Tester', club: 'Journey' },
      { clubberId: '9003', name: 'Rigel Tester', club: 'Journey' },
      { clubberId: '9004', name: 'Sirius Tester', club: 'Trek' },
      { clubberId: '9006', name: 'Mira Jane Quinn', club: 'Trek' },
      { clubberId: '9007', name: 'Otto Vale', club: 'Journey' },
      { clubberId: '9009', name: 'Pax Gone', club: 'Journey' },
    ] });
    check('the report is applied', rep.status === 200 && rep.body.applied === true, JSON.stringify(rep.body));
    const r = await roster();
    check('checked in on TwoTimTwo itself (no row here) reads checked in', r['Sirius Tester'] === true);
    check('a failed print the report lists reads checked in', r['Rigel Tester'] === true);
    check('a name-only row stays checked in after the report', r['Lyra Tester'] === true);
    check('a child off the report and the history is still to come', r['Nova Waits'] === false);
    const tonight = await j('/phone/tonight', {});
    const offered = Object.keys(r).filter((n) => r[n] === false);
    check('roster and count agree: everyone the count reads is checked in on the roster',
      tonight.body.checkedIn === Object.keys(r).length - offered.length, `count ${tonight.body.checkedIn}, offered ${offered.join(', ')}`);
  }

  console.log('/phone/roster — checked out tonight still came');
  {
    const date = new Date(now).toLocaleDateString('en-CA');
    const co = await j('/feed/checked-out', { date, clubberIds: ['9009'] });
    check('the check-out is applied', co.status === 200 && co.body.ok === true, JSON.stringify(co.body));
    const r = await roster();
    check('a child checked out tonight (report only) is not offered again', r['Pax Gone'] === true);
  }

  listener.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  __suiteFinished = true;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  __suiteFinished = true;
  process.exit(1);
});

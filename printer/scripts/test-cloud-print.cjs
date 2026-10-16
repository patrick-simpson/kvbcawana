#!/usr/bin/env node
// Cloud check-in (8.0.0): the sync service checks a child in on TwoTimTwo and
// asks this laptop for the tag (POST /print with cloud: true). A later print
// for the same child that is not that job (another path, another key) must
// not give them a second tag tonight; printedTonightFor() is the backstop the
// station's job puller relies on. A stub powershell counts the jobs that
// reach the printer.
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

(async () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-cloudbin-'));
  const jobLog = path.join(binDir, 'jobs.log');
  fs.writeFileSync(path.join(binDir, 'powershell'), `#!/bin/sh\necho job >> ${jobLog}\nexit 0\n`, { mode: 0o755 });
  process.env.PATH = `${binDir}:${process.env.PATH}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-cloud-'));
  // lateGraceMin a whole day: no drop-off tags, whatever the clock says.
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ printerName: 'Fake', lateGraceMin: 24 * 60 }));
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), 'Clubber ID,First Name,Last Name,Club\n1,Ava,Stone,Sparks\n2,Eli,Stone,Cubbies\n3,Mia,Lee,T&T\n');
  Object.assign(process.env, { AWANA_DATA_DIR: dataDir, AWANA_PORT: String(PORT), AWANA_BIND_HOST: '127.0.0.1', PRINTER_NAME: 'Fake' });
  const server = require(path.join(root, 'print-server', 'server.js'));
  const listener = server.startListening();
  await listener.ready;
  const base = `http://127.0.0.1:${PORT}`;
  const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const jobs = () => (fs.existsSync(jobLog) ? fs.readFileSync(jobLog, 'utf8').trim().split('\n').filter(Boolean).length : 0);

  console.log('\ncloud check-in: one tag a night');
  {
    let r = await post('/print', { name: 'Ava Stone', clubName: 'Sparks', clubberId: '1', cloud: true });
    check('the service\'s job prints the tag', r.status === 200 && r.body.success === true && !r.body.duplicate && jobs() === 1, JSON.stringify(r));
    const history = await (await fetch(`${base}/history`)).json();
    check('and it is in tonight\'s history', history.some((h) => h.firstName === 'Ava' && h.success), JSON.stringify(history).slice(0, 200));
    // A later print by name alone (a different duplicate key).
    r = await post('/print', { name: 'Ava Stone', clubName: 'Sparks' });
    check('a later print by name is refused', r.body.duplicate === true && jobs() === 1, JSON.stringify(r));
    r = await post('/print', { name: 'Ava Stone', clubName: 'Sparks', clubberId: '1' });
    check('and by id', r.body.duplicate === true && jobs() === 1, JSON.stringify(r));
    // BARF night 2026-10-14: a page sorted by last name sent "Stone, Ava"; it printed again.
    r = await post('/print', { name: 'Stone, Ava', clubName: 'Sparks' });
    check('"Stone, Ava" (Sort by: Last Name) is the same child: refused', r.body.duplicate === true && jobs() === 1, JSON.stringify(r));
  }

  console.log('\ncloud check-in: a child the laptop already printed');
  {
    let r = await post('/print', { name: 'Eli Stone', clubName: 'Cubbies' });
    check('the laptop prints Eli as ever', r.body.success === true && !r.body.duplicate && jobs() === 2, JSON.stringify(r));
    r = await post('/print', { name: 'Eli Stone', clubName: 'Cubbies', clubberId: '2', cloud: true });
    check('a cloud job for him is refused (no second tag)', r.body.duplicate === true && jobs() === 2, JSON.stringify(r));
  }

  console.log('\ncloud check-in: undone, then checked in again');
  {
    // Her row marked undone in the history file (the test's stand-in for an undo).
    const file = path.join(dataDir, 'print-history.json');
    const rows = JSON.parse(fs.readFileSync(file, 'utf8')).map((h) => (h.firstName === 'Ava' ? { ...h, undone: true, undoneAt: new Date().toISOString(), undoneBy: 'twotimtwo' } : h));
    fs.writeFileSync(file, JSON.stringify(rows, null, 2));
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(file, later, later);
    check('(her row is undone)', rows.some((h) => h.firstName === 'Ava' && h.undone));
    // The tag rule no longer holds her back (the 45 s double-tap window, which
    // is older and still applies, would refuse a re-print this fast).
    check('her undone tag no longer counts as tonight\'s', server.printedTonightFor('Ava', 'Stone', '1', true) === false
      && server.printedTonightFor('Ava', 'Stone', null, false) === false);
    check('Eli\'s still does, for a cloud job', server.printedTonightFor('Eli', 'Stone', '2', true) === true);
  }

  console.log('\ncloud check-in: nobody else is affected');
  {
    const r = await post('/print', { name: 'Mia Lee', clubName: 'T&T', clubberId: '3' });
    check('a child with no cloud check-in prints as ever', r.body.success === true && !r.body.duplicate && jobs() === 3, JSON.stringify(r));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  listener.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

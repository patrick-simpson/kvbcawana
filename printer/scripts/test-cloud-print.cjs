#!/usr/bin/env node
// Cloud check-in (8.0.0): the sync service checks a child in on TwoTimTwo and
// asks this laptop for the tag (POST /print with cloud: true). The extension,
// which did not drive that check-in, finds the child later and asks again;
// the child must get ONE tag tonight, not two. A stub powershell counts the
// jobs that reach the printer.
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
    // The extension finds her later, by name alone (a different duplicate key).
    r = await post('/print', { name: 'Ava Stone', clubName: 'Sparks' });
    check('the extension\'s later print by name is refused', r.body.duplicate === true && jobs() === 1, JSON.stringify(r));
    r = await post('/print', { name: 'Ava Stone', clubName: 'Sparks', clubberId: '1' });
    check('and by id', r.body.duplicate === true && jobs() === 1, JSON.stringify(r));
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
    const u = await post('/phone/undo', { firstName: 'Ava', lastName: 'Stone', clubberId: '1' });
    check('Remove marks her undone', u.status === 200 && u.body.ok === true, JSON.stringify(u));
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

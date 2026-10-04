#!/usr/bin/env node
// The print server's duplicate guard under overlap — plain Node, zero deps.
//
// recordPrint() runs only after the label is out, so a second request for the
// same child that arrived while the first was still printing used to pass the
// 45 s window test too, and both printed (the extension's retry at 38 s behind
// a slow driver, two detection paths, a double tap). The key is now claimed at
// the check and released when the print settles.
//
// Run: node scripts/test-print-dedup.cjs

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
const PORT = 34581;

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-dedup-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ printerName: 'Fake' }));
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), 'First Name,Last Name,Club\nAva,Stone,Sparks\n');
  Object.assign(process.env, { AWANA_DATA_DIR: dataDir, AWANA_PORT: String(PORT), AWANA_BIND_HOST: '127.0.0.1', PRINTER_NAME: 'Fake' });
  const server = require(path.join(root, 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((r) => { if (listener.listening) return r(); listener.once('listening', r); });
  const base = `http://127.0.0.1:${PORT}`;
  const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

  // A club image served slowly: the print path awaits its download before
  // rendering, which is the asynchronous window the real overlaps live in
  // (the print call itself is synchronous here, so a second request cannot
  // even be read while it runs; on the laptop it is the same).
  const http = require('http');
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const slow = http.createServer((req, res) => { setTimeout(() => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG); }, 1500); });
  await new Promise((r) => slow.listen(0, '127.0.0.1', r));
  const img = (n) => `http://127.0.0.1:${slow.address().port}/club-${n}.png`;

  console.log('\nduplicate guard: the key is claimed while the print is under way');
  {
    const first = post('/print', { name: 'Ava Stone', clubberId: '4821', clubName: 'Sparks', clubImageData: img(1) });
    await new Promise((r) => setTimeout(r, 300));
    const second = await post('/print', { name: 'Ava Stone', clubberId: '4821', clubName: 'Sparks', clubImageData: img(1) });
    check('a second request for the same child while the first is printing is a duplicate, not a second label',
      second.status === 200 && second.body && second.body.duplicate === true, JSON.stringify(second));
    const other = await post('/print', { name: 'Eli Stone', clubberId: '4822', clubName: 'Cubbies' });
    check('a different child is not held up by it', !(other.body && other.body.duplicate), JSON.stringify(other));
    const r1 = await first;
    check('the first request itself settled (here: no printer, so it failed)', r1.status === 500, JSON.stringify(r1));
    // The print failed, so nothing was recorded and the claim is released:
    // the child's next label is not a "duplicate" of a label that never printed.
    const third = await post('/print', { name: 'Ava Stone', clubberId: '4821', clubName: 'Sparks' });
    check('once it has settled without printing, the next request is tried again', !(third.body && third.body.duplicate), JSON.stringify(third));
  }
  slow.close();

  console.log('\nduplicate guard: every guarded print claims and releases its key');
  {
    const src = fs.readFileSync(path.join(root, 'print-server', 'server.js'), 'utf8');
    const claims = (src.match(/claimPrint\(dupKey\)/g) || []).length;
    const releases = (src.match(/releasePrint\(dupKey\)/g) || []).length;
    check('four guarded prints (check-in, award, leader, custom), each claiming', claims === 4, String(claims));
    check('and each releasing in its finally', releases === 4, String(releases));
    check('the in-flight claim is tested before the 45 s window', /printsInFlight\.get\(nameKey\)[\s\S]*recentPrints\.get\(nameKey\)/.test(src.slice(src.indexOf('function isDuplicatePrint'), src.indexOf('function claimPrint'))));
  }

  console.log('\nduplicate guard: a stale claim expires');
  check('a claim is never honoured past two minutes', /IN_FLIGHT_MAX_MS = 2 \* 60 \* 1000/.test(fs.readFileSync(path.join(root, 'print-server', 'server.js'), 'utf8')));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

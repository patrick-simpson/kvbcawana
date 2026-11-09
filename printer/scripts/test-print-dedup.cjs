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
const PORT = Number(process.env.AWANA_TEST_PORT || require('./free-port.cjs')());

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-dedup-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ printerName: 'Fake' }));
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), 'First Name,Last Name,Club\nAva,Stone,Sparks\n');
  Object.assign(process.env, { AWANA_DATA_DIR: dataDir, AWANA_PORT: String(PORT), AWANA_BIND_HOST: '127.0.0.1', PRINTER_NAME: 'Fake' });
  // A stand-in printer that always fails (as the missing one did), and, with a `slow`
  // file beside it, takes 0.8 s doing it: the asynchronous window a real overlap lives in.
  // (Until 10.14.0 the window was a slowly served club image URL; URLs are never
  // fetched now.)
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-dedup-bin-'));
  fs.writeFileSync(path.join(binDir, 'powershell'), `#!/bin/sh\nif [ -f "${binDir}/slow" ]; then sleep 0.8; fi\necho "no printer" >&2\nexit 1\n`, { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
  const server = require(path.join(root, 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((r) => { if (listener.listening) return r(); listener.once('listening', r); });
  const base = `http://127.0.0.1:${PORT}`;
  const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

  const http = require('http');
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

  console.log('\nduplicate guard: the key is claimed while the print is under way');
  {
    fs.writeFileSync(path.join(binDir, 'slow'), '');
    const first = post('/print', { name: 'Ava Stone', clubberId: '4821', clubName: 'Sparks' });
    await new Promise((r) => setTimeout(r, 300));
    const second = await post('/print', { name: 'Ava Stone', clubberId: '4821', clubName: 'Sparks' });
    check('a second request for the same child while the first is printing is a duplicate, not a second label',
      second.status === 200 && second.body && second.body.duplicate === true, JSON.stringify(second));
    const other = await post('/print', { name: 'Eli Stone', clubberId: '4822', clubName: 'Cubbies' });
    check('a different child is not held up by it', !(other.body && other.body.duplicate), JSON.stringify(other));
    const r1 = await first;
    fs.unlinkSync(path.join(binDir, 'slow'));
    check('the first request itself settled (here: no printer, so it failed)', r1.status === 500, JSON.stringify(r1));
    // The print failed, so nothing was recorded and the claim is released:
    // the child's next label is not a "duplicate" of a label that never printed.
    const third = await post('/print', { name: 'Ava Stone', clubberId: '4821', clubName: 'Sparks' });
    check('once it has settled without printing, the next request is tried again', !(third.body && third.body.duplicate), JSON.stringify(third));
  }
  console.log('\nclub image: a URL in a job body is never fetched (10.14.0, no SSRF)');
  {
    let hits = 0;
    const target = http.createServer((req, res) => { hits++; res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG); });
    await new Promise((r) => target.listen(0, '127.0.0.1', r));
    const at = (p) => `http://127.0.0.1:${target.address().port}${p}`;
    const rs = await Promise.all([
      post('/print', { name: 'Ivy Stone', clubberId: '5001', clubName: 'Sparks', clubImageData: at('/club.png') }),
      post('/print', { name: 'Jon Stone', clubberId: '5002', clubName: 'Sparks', clubImageData: 'https://169.254.169.254/latest/meta-data/' }),
      post('/print', { name: 'Kai Stone', clubberId: '5003', clubName: 'Sparks', clubImageData: 'data:text/html;base64,PGh0bWw+' }),
      post('/print', { name: 'Lia Stone', clubberId: '5004', clubName: 'Sparks', clubImageData: 'data:image/png;base64,' + PNG.toString('base64') }),
    ]);
    check('a URL, a metadata address, a non-image data URL and an inline PNG each let the print go on (here: to the failing printer)',
      rs.every((r) => r.status === 500 && r.body && !/image|icon/i.test(r.body.error || '')), JSON.stringify(rs.map((r) => [r.status, r.body && r.body.error])));
    check('the URL was never requested', hits === 0, `${hits} request(s)`);
    const images = require(path.join(root, 'print-server', 'server', 'images.js'));
    check('an inline PNG resolves to its bytes', (await images.resolveImageBuffer('data:image/png;base64,' + PNG.toString('base64'))).equals(PNG));
    check('an http URL resolves to nothing', (await images.resolveImageBuffer(at('/club.png'))) === null && hits === 0);
    check('a data URL that is not an image resolves to nothing', (await images.resolveImageBuffer('data:text/plain;base64,aGk=')) === null);
    const src = require('./server-source.cjs')();
    check('the print server has no http(s) client for images', !/require\('https?'\)/.test(fs.readFileSync(path.join(root, 'print-server', 'server', 'images.js'), 'utf8')));
    check('a label prints without its icon rather than fail (the icon is decoration)', /console\.log\(`\[icon\] Could not load club image: \$\{e\.message\}`\);\s*\}\s*return null;/.test(src));
    target.close();
  }

  console.log('\nduplicate guard: every guarded print claims and releases its key');
  {
    const src = require('./server-source.cjs')();
    const claims = (src.match(/claimPrint\(dupKey\)/g) || []).length;
    const releases = (src.match(/releasePrint\(dupKey\)/g) || []).length;
    check('five guarded prints (check-in, award, leader, custom, one-off), each claiming', claims === 5, String(claims));
    check('and each releasing in its finally', releases === 5, String(releases));
    check('the in-flight claim is tested before the 45 s window', /printsInFlight\.get\(nameKey\)[\s\S]*recentPrints\.get\(nameKey\)/.test(src.slice(src.indexOf('function isDuplicatePrint'), src.indexOf('function claimPrint'))));
  }

  console.log('\nduplicate guard: a stale claim expires');
  check('a claim is never honoured past two minutes', /IN_FLIGHT_MAX_MS = 2 \* 60 \* 1000/.test(require('./server-source.cjs')()));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

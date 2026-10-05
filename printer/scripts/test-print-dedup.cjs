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

  console.log('\nclub image download: whatever the URL answers, the label is not held hostage');
  {
    let open = 0;
    const odd = http.createServer((req, res) => {
      open++;
      res.on('close', () => { open--; });
      if (req.url === '/missing.png') { res.writeHead(404); res.end('gone'); return; }
      if (req.url === '/page.png') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>login</html>'); return; }
      if (req.url === '/declared-huge.png') { res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(50 * 1024 * 1024) }); res.write(PNG); return; }
      if (req.url === '/endless.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        const chunk = Buffer.alloc(256 * 1024);
        const pump = () => { if (res.destroyed) return; if (res.write(chunk)) setImmediate(pump); else res.once('drain', pump); };
        pump();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG);
    });
    await new Promise((r) => odd.listen(0, '127.0.0.1', r));
    const at = (p) => `http://127.0.0.1:${odd.address().port}${p}`;
    const t0 = Date.now();
    const rs = await Promise.all([
      post('/print', { name: 'Ivy Stone', clubberId: '5001', clubName: 'Sparks', clubImageData: at('/missing.png') }),
      post('/print', { name: 'Jon Stone', clubberId: '5002', clubName: 'Sparks', clubImageData: at('/page.png') }),
      post('/print', { name: 'Kai Stone', clubberId: '5003', clubName: 'Sparks', clubImageData: at('/declared-huge.png') }),
      post('/print', { name: 'Lia Stone', clubberId: '5004', clubName: 'Sparks', clubImageData: at('/endless.png') }),
    ]);
    const took = Date.now() - t0;
    check('a 404, an HTML page, a declared-huge file and an endless stream each let the print go on (here: to the missing printer)',
      rs.every((r) => r.status === 500 && r.body && !/image|icon/i.test(r.body.error || '')), JSON.stringify(rs.map((r) => [r.status, r.body && r.body.error])));
    check('none of them waited on the download past its 4 s timeout plus the retry', took < 12000, `${took} ms`);
    const mem = process.memoryUsage().heapUsed;
    check('the endless stream was cut off at the 2 MB cap, not buffered', mem < 400 * 1024 * 1024, `${Math.round(mem / 1048576)} MB heap`);
    await new Promise((r) => setTimeout(r, 200));
    check('every upstream connection was drained or destroyed', open === 0, `${open} still open`);
    const src = fs.readFileSync(path.join(root, 'print-server', 'server.js'), 'utf8');
    check('non-200 answers close the socket, not leave it to the agent', /res\.statusCode !== 200\) \{[\s\S]{0,200}?req\.destroy\(\);/.test(src));
    check('a label prints without its icon rather than fail (the icon is decoration)', /console\.log\(`\[icon\] Could not load club image: \$\{e\.message\}`\);\s*\}\s*return null;/.test(src));
    odd.close();
  }

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

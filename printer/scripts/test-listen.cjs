#!/usr/bin/env node
// startListening() as the Electron shell sees it: `.ready` says when the
// server is really bound (whichever retry got there) or why it never will be,
// and stopListening() closes the server that is actually listening.
'use strict';
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const root = path.join(__dirname, '..');
const PORT = 34583;

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-listen-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ printerName: 'Fake' }));
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), 'First Name,Last Name,Club\n');
  Object.assign(process.env, { AWANA_DATA_DIR: dataDir, AWANA_PORT: String(PORT), AWANA_BIND_HOST: '127.0.0.1', PRINTER_NAME: 'Fake' });
  const server = require(path.join(root, 'print-server', 'server.js'));
  const health = () => fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.ok).catch(() => false);

  console.log('\nlisten: the port is taken, then freed during the retries');
  {
    const squatter = net.createServer();
    await new Promise((r) => squatter.listen(PORT, '127.0.0.1', r));
    const first = server.startListening();
    check('startListening() still returns the first attempt\'s server (the tests wait on it)', typeof first.on === 'function' && !first.listening);
    check('and carries a ready promise', first.ready instanceof Promise);
    let resolved = null;
    first.ready.then((s) => { resolved = s; }, () => { resolved = 'rejected'; });
    await new Promise((r) => setTimeout(r, 500));
    check('while the port is taken it is not ready', resolved === null);
    // The squatter leaves before the second attempt (2 s after the first).
    await new Promise((r) => squatter.close(r));
    const live = await first.ready;
    check('ready resolves with the server that bound: the RETRY, not the first object', live && live !== first && live.listening === true);
    check('and the server answers', await health());
    await server.stopListening();
    check('stopListening() closes the server that is actually listening', !(await health()) && live.listening === false);
  }

  console.log('\nlisten: the port stays taken');
  {
    const squatter = net.createServer();
    await new Promise((r) => squatter.listen(PORT, '127.0.0.1', r));
    const first = server.startListening();
    let err = null;
    try { await first.ready; } catch (e) { err = e; }
    check('ready rejects after the last attempt, saying what to do', err && /still in use after 5 attempts/.test(err.message) && /reboot/.test(err.message), err && err.message);
    await new Promise((r) => squatter.close(r));
  }

  console.log('\nlisten: a plain start');
  {
    const first = server.startListening();
    const live = await first.ready;
    check('ready resolves with the first server when it binds at once', live === first && live.listening);
    check('it answers', await health());
    await server.stopListening();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

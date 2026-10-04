#!/usr/bin/env node
// The print server's config.json: written atomically, recovered when damaged.
//
// config.json holds the PIN, the display key, the sync sign-in and the
// schedule. It was written in place by four routes, so a crash mid-write left
// a truncated file that read as "no config"; the Electron wizard then merged
// over {} and the secrets were gone. Now every write keeps a .bak, a damaged
// read restores it, and a damaged file with no backup is moved aside.
//
// Run: node scripts/test-config-file.cjs

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
const PORT = 34582;

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-config-'));
  const cfg = path.join(dataDir, 'config.json');
  fs.writeFileSync(cfg, JSON.stringify({ printerName: 'Fake', phonePin: '2468', displayKey: 'key-one', lateGraceMin: 10 }));
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), 'First Name,Last Name,Club\nAva,Stone,Sparks\n');
  Object.assign(process.env, { AWANA_DATA_DIR: dataDir, AWANA_PORT: String(PORT), AWANA_BIND_HOST: '127.0.0.1', PRINTER_NAME: 'Fake' });
  const server = require(path.join(root, 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((r) => { if (listener.listening) return r(); listener.once('listening', r); });
  const base = `http://127.0.0.1:${PORT}`;
  const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const get = (p) => fetch(`${base}${p}`).then((r) => r.json());
  const onDisk = () => JSON.parse(fs.readFileSync(cfg, 'utf8'));

  console.log('\nconfig.json: every write is atomic and keeps a backup');
  {
    const r = await post('/config', { lateGraceMin: 15 });
    check('a settings save goes through', r.status === 200, JSON.stringify(r));
    check('the file holds the new value and the old secrets', onDisk().lateGraceMin === 15 && onDisk().phonePin === '2468' && onDisk().displayKey === 'key-one');
    check('no .tmp is left behind', !fs.existsSync(`${cfg}.tmp`));
    const bak = JSON.parse(fs.readFileSync(`${cfg}.bak`, 'utf8'));
    check('the file it replaced is kept as config.json.bak', bak.lateGraceMin === 10 && bak.phonePin === '2468', JSON.stringify(bak));
    const r2 = await post('/config/schedule', { schedule: [{ club: 'Sparks', time: '18:30', room: 'Hall' }] });
    check('the schedule route writes the same way', r2.status === 200 && onDisk().schedule.length === 1 && JSON.parse(fs.readFileSync(`${cfg}.bak`, 'utf8')).lateGraceMin === 15, JSON.stringify(r2));
  }

  console.log('\nconfig.json: a damaged file is restored from the backup');
  {
    const good = onDisk();
    fs.writeFileSync(cfg, JSON.stringify(good).slice(0, 40));   // a power cut mid-write
    const saved = await get('/config');
    check('GET /config answers the backup, not an empty config', saved.phonePin === undefined ? false : true && saved.lateGraceMin === 15, JSON.stringify(saved).slice(0, 200));
    check('the backup was copied back into place', onDisk().lateGraceMin === 15 && onDisk().displayKey === 'key-one');
    const health = await get('/health');
    const w = (health.warnings || []).find((x) => x && x.type === 'configDamaged');
    check('/health says so, as a {type, message} warning', !!w && /restored from config\.json\.bak/.test(w.message), JSON.stringify(health.warnings));
    const r = await post('/config', { lateGraceMin: 20 });
    check('a save merges over the restored config: the secrets survive', r.status === 200 && onDisk().phonePin === '2468' && onDisk().displayKey === 'key-one' && onDisk().lateGraceMin === 20, JSON.stringify(onDisk()));
    const health2 = await get('/health');
    check('and the notice stays up until a restart, so it is seen', (health2.warnings || []).some((x) => x && x.type === 'configDamaged'));
  }

  console.log('\nconfig.json: damaged with no usable backup, it is moved aside, never written over');
  {
    fs.writeFileSync(cfg, '{ "phonePin": "2468", "displayKey": "key-o');
    fs.writeFileSync(`${cfg}.bak`, 'also { broken');
    const r = await post('/config', { lateGraceMin: 25 });
    check('the save still goes through', r.status === 200, JSON.stringify(r));
    const aside = fs.readdirSync(dataDir).filter((n) => /^config\.json\.damaged-/.test(n));
    check('the damaged file is kept under another name', aside.length === 1 && /"phonePin": "2468"/.test(fs.readFileSync(path.join(dataDir, aside[0]), 'utf8')), JSON.stringify(aside));
    check('the new file holds only what was saved', onDisk().lateGraceMin === 25 && onDisk().phonePin === undefined);
    const health = await get('/health');
    const w = (health.warnings || []).find((x) => x && x.type === 'configDamaged');
    check('/health names the file to copy the PIN and keys back from', !!w && /must be set again/.test(w.message) && w.message.includes(aside[0]), JSON.stringify(w));
  }

  console.log('\ndata files: a save that fails is a dashboard warning until one succeeds');
  {
    // A folder where the file should be: the rename over it fails, as a full
    // disk or a locked folder would make it fail.
    const bufferFile = path.join(dataDir, 'events-buffer.json');
    try { fs.unlinkSync(bufferFile); } catch (_) { /* may not exist yet */ }
    fs.mkdirSync(bufferFile);
    const r = await post('/reset-tonight', { confirm: true });
    check('the route still answers', r.status === 200, JSON.stringify(r));
    let health = await get('/health');
    let w = (health.warnings || []).find((x) => x && x.type === 'dataSave');
    check('/health warns, as a {type, message} object, naming the file', !!w && typeof w.message === 'string' && w.message.includes('events-buffer.json'), JSON.stringify(health.warnings));
    check('and says labels still print', !!w && /Labels still print/.test(w.message));
    check('no .tmp is left behind', !fs.existsSync(`${bufferFile}.tmp`));
    fs.rmdirSync(bufferFile);
    await post('/reset-tonight', { confirm: true });
    health = await get('/health');
    w = (health.warnings || []).find((x) => x && x.type === 'dataSave');
    check('the next good save clears it', !w, JSON.stringify(health.warnings));
    check('and the file is there', fs.existsSync(bufferFile) && fs.statSync(bufferFile).isFile());
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

#!/usr/bin/env node
// Club logos in the print history: once each, by hash — plain Node, zero deps.
//
// Every history row used to carry its club's logo as a base64 PNG, so a
// 200-row file was megabytes, re-read on nearly every request and rewritten on
// every check-in. A row now names the logo by hash and the logo lives once in
// club-icons.json; rows written before this (with the blob inline) still
// reprint with their icon, and the dashboard, which never used the blob, no
// longer receives it.
//
// Run: node scripts/test-history-icons.cjs

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
const PORT = 34585;

(async () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-psbin-'));
  fs.writeFileSync(path.join(binDir, 'powershell'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-icons-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ printerName: 'Fake' }));
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), 'First Name,Last Name,Club\nAva,Stone,Sparks\nEli,Stone,Sparks\nMia,Stone,Cubbies\n');
  Object.assign(process.env, { AWANA_DATA_DIR: dataDir, AWANA_PORT: String(PORT), AWANA_BIND_HOST: '127.0.0.1', PRINTER_NAME: 'Fake' });
  const server = require(path.join(root, 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((r) => { if (listener.listening) return r(); listener.once('listening', r); });
  const base = `http://127.0.0.1:${PORT}`;
  const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const get = (p) => fetch(`${base}${p}`).then((r) => r.json());
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const PNG2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhQGAWjR9awAAAABJRU5ErkJggg==';
  const historyFile = path.join(dataDir, 'print-history.json');
  const iconsFile = path.join(dataDir, 'club-icons.json');

  console.log('\nhistory icons: one logo, however many children wear it');
  {
    let r = await post('/print', { name: 'Ava Stone', clubberId: '1', clubName: 'Sparks', clubImageData: PNG });
    check('(a Sparks check-in printed)', r.status === 200 && r.body.success, JSON.stringify(r));
    r = await post('/print', { name: 'Eli Stone', clubberId: '2', clubName: 'Sparks', clubImageData: PNG });
    r = await post('/print', { name: 'Mia Stone', clubberId: '3', clubName: 'Cubbies', clubImageData: PNG2 });
    const raw = fs.readFileSync(historyFile, 'utf8');
    check('print-history.json carries no image bytes', !raw.includes('data:image'), `${raw.length} bytes`);
    const rows = JSON.parse(raw);
    check('each row names its logo by hash', rows.length === 3 && rows.every((x) => typeof x.clubIcon === 'string' && x.clubIcon.length === 20), JSON.stringify(rows.map((x) => x.clubIcon)));
    check('two Sparks rows share one hash, Cubbies has its own', rows[1].clubIcon === rows[2].clubIcon && rows[0].clubIcon !== rows[1].clubIcon);
    const icons = JSON.parse(fs.readFileSync(iconsFile, 'utf8'));
    check('club-icons.json holds exactly the two logos', Object.keys(icons).length === 2 && Object.values(icons).sort().join() === [PNG, PNG2].sort().join());
    check('a row resolves back to the very image it printed with', server.historyClubImage(rows[0]) === PNG2 && server.historyClubImage(rows[1]) === PNG);
  }

  console.log('\nhistory icons: the dashboard gets rows without blobs, and reprints still have their icon');
  {
    // An old-style row, written by a version that inlined the blob.
    const rows = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    rows.push({ firstName: 'Old', lastName: 'Row', clubName: 'Sparks', clubImageData: PNG, printer: 'Fake', success: true, clubberId: '9', timestamp: new Date().toISOString() });
    fs.writeFileSync(historyFile, JSON.stringify(rows));
    const today = await get('/history/today');
    check('/history/today sends every row', today.length === 4, String(today.length));
    check('and none of them carries the blob, old or new', today.every((x) => !('clubImageData' in x)) && JSON.stringify(today).includes('clubIcon'), JSON.stringify(today).slice(0, 200));
    const all = await get('/history');
    check('/history too', all.every((x) => !('clubImageData' in x)));
    check('the old row still resolves to its inline image', server.historyClubImage(rows[3]) === PNG);
    const r = await post('/reprint', { index: 3 });
    check('and reprints', r.status === 200 && r.body && r.body.success !== false, JSON.stringify(r));
    const after = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    check('the reprint’s own row is written the new way (hash, no blob)', after[0].firstName === 'Old' && after[0].clubIcon && !after[0].clubImageData, JSON.stringify(after[0]).slice(0, 160));
    check('a URL logo still rides in the row itself (it is small)', (await post('/print', { name: 'Url Kid', clubberId: '7', clubName: 'Sparks', clubImageData: 'http://127.0.0.1:9/none.png' })).status >= 200
      && JSON.parse(fs.readFileSync(historyFile, 'utf8'))[0].clubImageData === 'http://127.0.0.1:9/none.png');
  }

  await server.stopListening();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

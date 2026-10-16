#!/usr/bin/env node
// The home page's labels (owner, 2026-10-16: the showcase shows the REAL thing): one
// label per made-up child of the showcase's club (site/showcase/stub.js KIDS), drawn by
// the print server's own renderer through /preview (generateLabel(), 1200x600, 4x2 in
// at 300 dpi), enriched from a made-up roster as a night's roster is, then halved to
// 600x300 for the page. Writes printer/public/showcase/labels/<first>.png (committed;
// rerun when the label's look changes): node scripts/showcase-labels.cjs
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const OUT = path.join(__dirname, '..', 'public', 'showcase', 'labels');
fs.mkdirSync(OUT, { recursive: true });

// The showcase's club, as site/showcase/stub.js lists it. A few carry a detail a
// label shows (an allergy, a handbook group, no photo); nobody's birthday, so the
// committed files never go stale.
const KIDS = [
  ['Ava', 'Linden', 'Puggles', ''], ['Mia', 'Rourke', 'Puggles', 'dairy'], ['Ella', 'Marchetti', 'Puggles', ''],
  ['Leo', 'Castellan', 'Cubbies', ''], ['Ezra', 'Holloway', 'Cubbies', ''], ['Ruby', 'Ashford', 'Cubbies', 'peanuts'],
  ['Maya', 'Brightwater', 'Sparks', 'peanuts'], ['Owen', 'Pemberly', 'Sparks', ''], ['Ivy', 'Calloway', 'Sparks', ''], ['Jude', 'Winslow', 'Sparks', ''],
  ['Noah', 'Fairbanks', 'T&T', ''], ['Lucy', 'Ambrose', 'T&T', ''], ['Eli', 'Thornbury', 'T&T', 'tree nuts'], ['Nora', 'Whitcombe', 'T&T', ''],
  ['Sophia', 'Hartwell', 'Trek', ''], ['Caleb', 'Moreland', 'Trek', ''],
];

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-showcase-'));
process.env.AWANA_DATA_DIR = dataDir;
fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), [
  'FirstName,LastName,Birthdate,Allergies,HandbookGroup,MedRelease',
  ...KIDS.map(([f, l, , allergy]) => `${f},${l},3/9/2016,${allergy},,Yes`),
].join('\n'));

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

async function main() {
  const { app } = require('../print-server/server.js');
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [firstName, lastName, clubName] of KIDS) {
      const res = await get(`${base}/preview?${new URLSearchParams({ firstName, lastName, clubName })}`);
      if (res.status !== 200 || res.body.readUInt32BE(16) !== 1200) throw new Error(`${firstName}: /preview answered ${res.status}`);
      const full = path.join(dataDir, `${firstName}.png`);
      fs.writeFileSync(full, res.body);
      const dest = path.join(OUT, `${firstName.toLowerCase()}.png`);
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', full, '-vf', 'scale=600:300:flags=lanczos', '-pix_fmt', 'gray', dest]);
      console.log(`  ${path.relative(path.join(__dirname, '..'), dest)} (${fs.statSync(dest).size} bytes)`);
    }
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

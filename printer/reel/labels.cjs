#!/usr/bin/env node
// Real labels for the reel, drawn by the print server's own renderer: the same
// /preview route the dashboard uses (generateLabel(), 1200x600, 4x2 in at
// 300 dpi), enriched from a made-up roster exactly as a night's roster is.
// Writes reel/.work/labels/<n>.png. Usage: node reel/labels.cjs
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const OUT = path.join(__dirname, '.work', 'labels');
fs.mkdirSync(OUT, { recursive: true });

// A made-up roster. Birthdays are placed in the current week, so the cake
// prints whenever the reel is rebuilt.
const today = new Date();
const thisWeek = (offsetDays, year) => {
  const d = new Date(today.getTime() + offsetDays * 86400000);
  return `${d.getMonth() + 1}/${d.getDate()}/${year}`;
};
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-reel-'));
process.env.AWANA_DATA_DIR = dataDir;
fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), [
  'FirstName,LastName,Birthdate,Allergies,HandbookGroup,MedRelease',
  `Maya,Brightwater,${thisWeek(0, today.getFullYear() - 7)},peanuts,,Yes`,
  'Noah,Fairbanks,3/9/2016,,T&T Ultimate Adventure,No',
  'Ella,Marchetti,6/21/2023,dairy,,Yes',
  'Leo,Castellan,1/30/2021,,HoneyComb,Yes',
  'Sophia,Hartwell,8/14/2013,,,Yes',
  'Owen,Pemberly,11/2/2018,,Sparks Blue,Yes',
].join('\n'));

const LABELS = [
  { file: '1-maya.png', q: { firstName: 'Maya', lastName: 'Brightwater', clubName: 'Sparks' } },
  { file: '2-noah.png', q: { firstName: 'Noah', lastName: 'Fairbanks', clubName: 'T&T' } },
  { file: '3-ella.png', q: { firstName: 'Ella', lastName: 'Marchetti', clubName: 'Puggles' } },
  { file: '4-leo.png', q: { firstName: 'Leo', lastName: 'Castellan', clubName: 'Cubbies' } },
  { file: '5-sophia.png', q: { firstName: 'Sophia', lastName: 'Hartwell', clubName: 'Trek' } },
  { file: '6-owen.png', q: { firstName: 'Owen', lastName: 'Pemberly', clubName: 'Sparks' } },
];

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
    for (const { file, q } of LABELS) {
      const res = await get(`${base}/preview?${new URLSearchParams(q)}`);
      if (res.status !== 200 || res.body.readUInt32BE(16) !== 1200) throw new Error(`${file}: /preview answered ${res.status}`);
      fs.writeFileSync(path.join(OUT, file), res.body);
      console.log(`  ${file}`);
    }
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  // The print server leaves timers of its own once loaded; this script is done.
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

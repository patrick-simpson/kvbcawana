// Builds public/src/schedule.js (what the kiosk loads, one classic script) by
// concatenating src/schedule/*.js in filename order, byte for byte. There is no
// wrapper, no renaming and no minifying, so the result is exactly the one big
// script it used to be: shared top-level let/const state, hoisted functions and
// the order things run in all behave the same. Edit src/schedule/, then run
// `npm run build` here. test/schedule-build.test.mjs fails if the committed
// output is stale. Usage: node scripts/build-schedule.mjs [--check]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const partsDir = path.join(root, 'src', 'schedule');
const outFile = path.join(root, 'public', 'src', 'schedule.js');

export function buildSchedule() {
  const parts = readdirSync(partsDir).filter((f) => f.endsWith('.js')).sort();
  if (!parts.length) throw new Error('no parts in src/schedule/');
  return parts.map((f) => {
    const text = readFileSync(path.join(partsDir, f), 'utf8');
    if (!text.endsWith('\n')) throw new Error(`${f} must end with a newline`);
    return text;
  }).join('');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const built = buildSchedule();
  if (process.argv.includes('--check')) {
    if (readFileSync(outFile, 'utf8') !== built) {
      console.error('public/src/schedule.js is stale: run `npm run build` in journey/');
      process.exit(1);
    }
  } else writeFileSync(outFile, built);
}

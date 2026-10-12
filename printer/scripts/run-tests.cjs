'use strict';
// `npm test`: every suite in scripts/ (and the Electron app's node:test files),
// a few at a time. The suites no longer share a TCP port (each one asks
// scripts/free-port.cjs for its own) or any file, so they are independent.
//
//   npm test                    4 at a time (or fewer on a machine with fewer cores)
//   npm test -- --jobs=2        another width; TEST_JOBS=2 does the same
//   npm test -- --serial        one after another, output live, stop at the first
//                               failure: what the old `&&` chain did. TEST_SERIAL=1
//                               does the same. Use it to read one suite's output
//                               or to rule parallelism out of a failure.
//
// Side by side, each suite's output is held and printed whole when it ends, so
// the log reads one suite at a time; every suite runs even if another failed,
// and the summary names the ones that did.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');

// [script (scripts/<name>.cjs), seconds it takes alone]: the seconds only order
// the parallel run (longest first, so the last suite is not a long one);
// --serial runs them in this order.
const SUITES = [
  ['test-contracts', 3],
  ['test-server-helpers', 5],
  ['test-extension-identity', 2],
  ['test-extension-checkin', 5],
  ['test-extension-queue', 5],
  ['test-extension-leader', 5],
  ['test-extension-feeds', 5],
  ['test-config-store', 5],
  ['test-config-file', 5],
  ['test-extension-sync', 5],
  ['test-server-security', 10],
  ['test-server-demo', 10],
  ['test-connect-card', 10],
  ['test-label-templates', 10],
  ['test-envelope', 3],
  ['test-cloud-crypto', 3],
  ['test-server-realtime', 48],
  ['test-lobby-slides', 10],
  ['test-display-settings', 10],
  ['test-settings-page', 10],
  ['test-sync', 13],
  ['test-leaders', 10],
  ['test-custom-label', 10],
  ['test-tonight-count', 7],
  ['test-tonight-shared', 3],
  ['test-reconcile', 10],
  ['test-report-parse', 5],
  ['test-replay-night', 10],
  ['test-checkout-parser', 5],
  ['test-attendance-audit', 10],
  ['test-brand-kit', 10],
  ['test-dashboard-chrome', 5],
  ['test-touch-search', 5],
  ['test-chrome-restart', 5],
  ['test-phone-touch', 10],
  ['test-phone-relay', 27],
  ['test-phone-undo', 10],
  ['test-phone-roster', 10],
  ['test-label-printer', 8],
  ['test-cups', 5],
  ['test-cups-server', 10],
  ['test-pickup-board', 16],
  ['test-print-dedup', 7],
  ['test-cloud-print', 10],
  ['test-station-keys', 5],
  ['test-job-puller', 10],
  ['test-cloud-e2e', 10],
  ['test-station-greeting', 10],
  ['test-church-sync', 5],
  ['test-barf', 10],
  ['test-listen', 22],
  ['test-print-async', 10],
  ['test-history-icons', 10],
  ['test-stores-cache', 10],
  ['test-label-golden', 13],
  ['test-about-page', 5],
];
const tasks = [
  { name: 'electron-app/test', args: ['--test', 'electron-app/test/*.test.cjs'], secs: 5 },
  ...SUITES.map(([n, secs]) => ({ name: n, args: [path.join('scripts', n + '.cjs')], secs })),
];
// Order matters in --serial only for the electron-app tests, which ran second.
const serialOrder = [tasks[1], tasks[0], ...tasks.slice(2)];

// A suite added to scripts/ but not here would silently never run.
const onDisk = fs.readdirSync(__dirname).filter((f) => /^test-.*\.cjs$/.test(f)).map((f) => f.replace(/\.cjs$/, ''));
const missing = onDisk.filter((n) => !SUITES.some(([s]) => s === n));
if (missing.length) {
  console.error('scripts/run-tests.cjs does not list: ' + missing.join(', '));
  process.exit(1);
}

const argv = process.argv.slice(2);
const flag = (name) => { const a = argv.find((x) => x.startsWith('--' + name + '=')); return a ? a.split('=')[1] : undefined; };
const serial = argv.includes('--serial') || /^(1|true)$/i.test(process.env.TEST_SERIAL || '');
const jobs = serial ? 1 : Math.max(1, Number(flag('jobs') || process.env.TEST_JOBS) || Math.min(4, os.cpus().length));

function run(task, live) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    // One fixed port for every suite is what the parallel run exists to avoid.
    if (!live) delete env.AWANA_TEST_PORT;
    const started = Date.now();
    const child = spawn(process.execPath, task.args, { cwd: root, env, stdio: live ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    if (!live) { child.stdout.on('data', (d) => chunks.push(d)); child.stderr.on('data', (d) => chunks.push(d)); }
    child.on('error', (e) => resolve({ task, code: 1, out: String(e), secs: 0 }));
    child.on('close', (code, signal) => resolve({ task, code: code === null ? 1 : code, signal, out: Buffer.concat(chunks).toString('utf8'), secs: (Date.now() - started) / 1000 }));
  });
}

async function main() {
  const t0 = Date.now();
  const results = [];
  if (serial) {
    for (const task of serialOrder) {
      console.log(`\n── ${task.name} ──`);
      const r = await run(task, true);
      results.push(r);
      if (r.code !== 0) break; // the old `&&` chain stopped here
    }
  } else {
    const queue = [...tasks].sort((a, b) => b.secs - a.secs);
    const worker = async () => {
      for (let task = queue.shift(); task; task = queue.shift()) {
        const r = await run(task, false);
        results.push(r);
        console.log(`\n── ${task.name} (${r.secs.toFixed(1)}s${r.code === 0 ? '' : ', FAILED'}) ──\n${r.out.replace(/\n+$/, '')}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, worker));
  }
  const failed = results.filter((r) => r.code !== 0);
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  const slow = [...results].sort((a, b) => b.secs - a.secs).slice(0, 3).map((r) => `${r.task.name} ${r.secs.toFixed(0)}s`).join(', ');
  console.log(`\n== ${results.length - failed.length}/${serial ? serialOrder.length : tasks.length} suites passed in ${wall}s (${serial ? 'serial' : jobs + ' at a time'}); slowest: ${slow}`);
  if (failed.length) {
    console.log('== FAILED: ' + failed.map((r) => `${r.task.name} (exit ${r.code}${r.signal ? ', ' + r.signal : ''})`).join(', '));
    process.exit(1);
  }
}

main();

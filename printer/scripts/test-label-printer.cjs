#!/usr/bin/env node
// The one printer: the 4x2 label printer (the club's D450), its backup, and
// the late arrival's drop-off label. The receipt-printer trial (Star / Rongta)
// was removed on 2026-10-08 (owner: "never again").
//
// WHAT THIS GUARDS
//
// * A label prints on the name tag printer; when that fails and a backup is
//   set, it prints on the backup and /health says so as a {type, message}
//   object; with no backup (or a backup that is the same printer) the print
//   fails loudly, and the failure is recorded as it always was.
// * A config left over from the receipt trial never sends a label to the
//   receipt printer: its keys are ignored, a backup that named the Star is not
//   used, and the next save drops them all. The trial's routes are gone.
// * A late child gets a plain name tag (no "Go to:" line) and the family ONE
//   drop-off label listing every child of the household and where their club
//   is right now, printed on the label printer, once per family per night.
// * One reprint run at a time.
//
// Run: node scripts/test-label-printer.cjs

'use strict';

let __suiteFinished = false;
process.on('exit', (code) => {
  if (code === 0 && !__suiteFinished) {
    console.error('✗ Test suite terminated before completing (crash swallowed?) — failing.');
    process.exitCode = 1;
  }
});

const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.AWANA_TEST_PORT || 34612);
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-label-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-label-bin-'));
  const spoolLog = path.join(binDir, 'spool.log');
  // A fake Windows: a print script naming the printer "Broken" fails (twice,
  // so printImage's retry fails too); any other print script is one job on
  // the printer it names, logged. Every other PowerShell call succeeds.
  fs.writeFileSync(path.join(binDir, 'powershell'), `#!/bin/sh
if [ -f "${binDir}/slow" ]; then sleep 1; fi
f=""
for a in "$@"; do case "$a" in *.ps1) f="$a";; esac; done
if [ -n "$f" ] && grep -q 'PrintDocument' "$f" 2>/dev/null; then
  if grep -q "PrinterName = 'Broken'" "$f"; then echo "printer error" >&2; exit 1; fi
  name=$(sed -n "s/.*PrinterName = '\\([^']*\\)'.*/\\1/p" "$f" | head -1)
  echo "job \${name:-default}" >> ${spoolLog}
fi
exit 0
`, { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
  const jobs = () => { try { return fs.readFileSync(spoolLog, 'utf8').split('\n').filter(Boolean); } catch { return []; } };

  const cfgPath = path.join(dataDir, 'config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ printerName: 'Fake' }, null, 2));
  Object.assign(process.env, { AWANA_DATA_DIR: dataDir, AWANA_PORT: String(PORT), AWANA_BIND_HOST: '127.0.0.1', PRINTER_NAME: 'Fake' });

  const origLog = console.log; const origWarn = console.warn; const origErr = console.error;
  console.log = () => {}; console.warn = () => {};
  const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((resolve) => { if (listener.listening) return resolve(); listener.once('listening', resolve); });
  console.error = (...a) => { if (String(a[0]).startsWith('  ✗')) origErr(...a); };

  const post = async (p, body) => {
    const res = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const health = async () => (await fetch(BASE + '/health')).json();
  const useConfig = (extra, drop = []) => {
    const c = { ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')), ...extra };
    drop.forEach((k) => delete c[k]);
    fs.writeFileSync(cfgPath, JSON.stringify(c, null, 2));
    server.applySavedConfig(c);
  };

  origLog('label printer: the name tag printer and its backup');
  {
    let n = jobs().length;
    let r = await post('/print-custom', { text: 'One' });
    check('a label prints on the name tag printer', r.status === 200 && jobs().length === n + 1 && jobs()[n] === 'job Fake', `${r.status} ${JSON.stringify(jobs())}`);

    server.setPrinterName('Broken');
    useConfig({ printerName: 'Broken', backupPrinterName: 'Fake' });
    n = jobs().length;
    r = await post('/print-custom', { text: 'Two' });
    check('a failed print goes to the backup printer', r.status === 200 && jobs().length === n + 1 && jobs()[n] === 'job Fake', `${r.status} ${JSON.stringify(r.body)}`);
    let h = await health();
    const fb = (h.warnings || []).find((w) => w && w.type === 'printerFallback');
    check('and /health says so as a {type, message} object', fb && typeof fb.message === 'string' && /"Fake"/.test(fb.message), JSON.stringify(h.warnings));

    useConfig({ backupPrinterName: '' });
    n = jobs().length;
    r = await post('/print-custom', { text: 'Three' });
    check('no backup: nothing prints and the print fails loudly', r.status === 500 && jobs().length === n, `${r.status} ${JSON.stringify(r.body)}`);

    useConfig({ backupPrinterName: 'broken' });
    r = await post('/print-custom', { text: 'Four' });
    check('a backup that is the same printer is no backup', r.status === 500 && jobs().length === n, `${r.status}`);

    server.setPrinterName('Fake');
    useConfig({ printerName: 'Fake', backupPrinterName: '' });
    r = await post('/print-custom', { text: 'Five' });
    h = await health();
    check('a good print clears the fallback warning', r.status === 200 && !(h.warnings || []).some((w) => w && w.type === 'printerFallback'), JSON.stringify(h.warnings));

    r = await post('/config', { backupPrinterName: 'x" ; calc' });
    check('a backup printer name with shell characters is refused', r.status === 400);
  }

  origLog('label printer: nothing is left of the receipt-printer trial');
  {
    useConfig({ printerType: 'receipt-usb', receiptPrinterName: 'Star TSP100 Cutter', backupPrinterName: 'star tsp100 cutter',
      receiptHost: '192.168.1.50', receiptPort: 9100, receiptDots: 576, receiptCut: 'partial' });
    const n = jobs().length;
    let r = await post('/print-custom', { text: 'Old config' });
    check('a receipt-trial config prints on the label printer', r.status === 200 && jobs()[n] === 'job Fake', JSON.stringify(jobs().slice(n)));
    check('a backup that named the receipt printer is not used', server.backupPrinter() === '');
    const h = await health();
    check('/health no longer reports a receipt printer', !('receiptPrinter' in h) && !(h.warnings || []).some((w) => w && /^receipt/.test(w.type)), JSON.stringify(h.warnings));
    r = await post('/config', { backupPrinterName: 'Star TSP100 Cutter' });
    const saved = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    check('the next save drops every receipt key', r.status === 200 && server.RETIRED_PRINTER_KEYS.every((k) => !(k in saved)), JSON.stringify(saved));
    check('and the backup that named the receipt printer with them', saved.backupPrinterName === '', JSON.stringify(saved.backupPrinterName));
    r = await post('/config', { printerType: 'receipt', receiptHost: '10.0.0.9' });
    const again = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    check('an old dashboard posting receipt fields saves, and they go nowhere', r.status === 200 && !('printerType' in again) && !('receiptHost' in again), JSON.stringify(again));
    for (const [m, p] of [['POST', '/receipt/test'], ['POST', '/receipt/discover'], ['POST', '/jam-reprint'], ['GET', '/touch/jam']]) {
      const res = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'POST' ? '{}' : undefined });
      check(`${m} ${p} is gone`, res.status === 404, String(res.status));
    }
    const pv = await fetch(BASE + '/preview?firstName=Ava&lastName=Stone&clubName=Sparks');
    check('the preview is the 4x2 label', pv.headers.get('x-tag-printer') === 'label' && pv.headers.get('x-tag-size') === '4.00x2.00', `${pv.status} ${pv.headers.get('x-tag-printer')}`);
  }

  origLog('label printer: the setup warnings');
  {
    const w = server.printerSetupWarnings;
    const types = (list) => list.map((x) => x.type).join(',');
    check('no printer chosen says labels go to the default printer', types(w('', null)) === 'printerUnset' && /default printer/.test(w('', null)[0].message));
    check('a healthy D450 says nothing', types(w('Phomemo D450', [{ Name: 'Phomemo D450', PrinterStatus: 0 }])) === '');
    check('a missing printer is printerNotFound', types(w('Phomemo D450', [{ Name: 'Microsoft Print to PDF', PrinterStatus: 0 }])) === 'printerNotFound');
    check('an offline D450 is printerOffline, worded for a volunteer',
      types(w('Phomemo D450', [{ Name: 'Phomemo D450', PrinterStatus: 8 }])) === 'printerOffline'
      && /USB cable and power/.test(w('Phomemo D450', [{ Name: 'Phomemo D450', PrinterStatus: 8 }])[0].message));
    check('out of labels and paused are printerOffline too',
      [5, 1].every((st) => types(w('D450', [{ Name: 'D450', PrinterStatus: st }])) === 'printerOffline'));
    check('a failed query is printerCheckFailed, never "fine"', types(w('D450', null)) === 'printerCheckFailed');
    check('a receipt-looking name is said out loud',
      ['Star TSP100 Cutter (TSP143)', 'RONGTA 80mm Series Printer', 'POS-80 Receipt'].every((n) => w(n, [{ Name: n, PrinterStatus: 0 }]).some((x) => x.type === 'printerLooksLikeReceipt')));
    check('and a label printer\'s name is not', !['Phomemo D450', 'Zebra ZD421', 'DYMO LabelWriter 450'].some((n) => w(n, [{ Name: n, PrinterStatus: 0 }]).length));
  }

  origLog('label printer: the drop-off label for a late arrival');
  {
    const at = new Date(); at.setHours(18, 42, 0, 0);
    fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), 'First Name,Last Name,Club\nBobby,Kwik,Sparks\nElla,Kwik,T&T\nHal,Kwik,Cubbies\nSolo,Kid,Trek\n');
    let r = await post('/touch/context', { households: [['Bobby Kwik', 'Ella Kwik', 'Hal Kwik']], items: { bible: [], friend: [] } });
    check('(the laptop shares the households)', r.status === 200 && r.body.households === 1, JSON.stringify(r.body));
    const tag = server.dropOffTagFor('Bobby', 'Kwik', 'Sparks', at);
    check('the drop-off label lists the whole household, each with where their club is now',
      tag && tag.title === 'Drop-off locations at 6:42 PM' && JSON.stringify(tag.lines.map((l) => [l.first, l.place, l.activity])) ===
      JSON.stringify([['Bobby', 'Fellowship Hall', 'Games'], ['Ella', 'Child Discipleship Wing', 'Large Group'], ['Hal', 'Large Classroom', 'Large Group']]), JSON.stringify(tag));
    check('one per family per night: a brother or sister after that gets none', server.dropOffTagFor('Ella', 'Kwik', 'T&T', at) === null);
    const solo = server.dropOffTagFor('Solo', 'Kid', 'Trek', at);
    check('a child the household list does not place is a family of one', solo && solo.lines.length === 1 && solo.lines[0].place === 'Youth Building', JSON.stringify(solo));
    const png = await server.generateDropOffTag(tag);
    const { loadImage } = require(path.join(__dirname, '..', 'print-server', 'node_modules', '@napi-rs/canvas'));
    const img = await loadImage(fs.readFileSync(png.pngPath));
    check('it is drawn on the 4x2 label page', img.width === 1200 && img.height === 600, `${img.width}x${img.height}`);
    fs.unlinkSync(png.pngPath);

    const src = fs.readFileSync(path.join(__dirname, '..', 'print-server', 'server.js'), 'utf8');
    check('a late child\'s name tag carries no "Go to:" line (the drop-off label replaces it)',
      /const dropOffInstead = !!goTo;/.test(src) && !/extras\.goToLine = goTo/.test(src));

    // End to end: a late check-in (every club "started" at midnight).
    useConfig({ schedule: [{ club: 'Trek', startTime: '00:00', location: 'Games', room: 'Gym' }], lateGraceMin: 0 });
    if (new Date().getHours() || new Date().getMinutes()) {
      fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), 'First Name,Last Name,Club\nTess,Late,Trek\nTom,Late,Trek\n');
      await post('/touch/context', { households: [['Tess Late', 'Tom Late']], items: { bible: [], friend: [] } });
      let n = jobs().length;
      r = await post('/print', { firstName: 'Tess', lastName: 'Late', clubName: 'Trek' });
      check('a late child: the name tag, then the family\'s drop-off label, both on the label printer',
        r.status === 200 && jobs().length === n + 2 && jobs().slice(n).every((j) => j === 'job Fake'), `${r.status} ${JSON.stringify(jobs().slice(n))}`);
      n = jobs().length;
      r = await post('/print', { firstName: 'Tom', lastName: 'Late', clubName: 'Trek' });
      check('the brother after her: his name tag only', r.status === 200 && jobs().length === n + 1, `${r.status} ${jobs().length - n}`);
    }
    useConfig({}, ['schedule', 'lateGraceMin']);
    r = await post('/print', { firstName: 'Ana', lastName: 'Early', clubName: 'Sparks' });
    check('(a check-in with no schedule prints one label)', r.status === 200);
  }

  origLog('label printer: one reprint run at a time');
  {
    fs.writeFileSync(path.join(binDir, 'slow'), '');
    const range = { fromTs: new Date(Date.now() - 10 * 60000).toISOString(), toTs: new Date().toISOString(), confirm: true };
    const first = post('/reprint-range', range);
    await new Promise((done) => setTimeout(done, 300));
    const second = await post('/reprint-range', range);
    check('a second range reprint while the first prints is refused with 409 and told how far it got',
      second.status === 409 && /already running \(\d+ of \d+ printed\)/.test(second.body && second.body.error), JSON.stringify(second));
    const r = await first;
    check('the first run finishes', r.status === 200 && r.body.printed.length > 0, JSON.stringify(r.body));
    fs.unlinkSync(path.join(binDir, 'slow'));
  }

  listener.close();
  console.log = origLog;
  console.log(`\n${passed} passed, ${failed} failed`);
  __suiteFinished = true;
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

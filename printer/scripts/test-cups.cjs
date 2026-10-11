// The Linux print path (print-server/cups.js): the Raspberry Pi print station
// in CLOUD-CHECKIN.md prints the same label PNG through CUPS. The parsers are
// checked on lpstat's real wording, and the runners against stand-in `lp` /
// `lpstat` programs on PATH, so the arguments a real print would get are
// exactly the ones checked here. No printer needed.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const cups = require('../print-server/cups');

const LPSTAT = [
  'printer DYMO_LabelWriter_450 is idle.  enabled since Sun 11 Oct 2026 04:12:10 PM EDT',
  '\tForm mounted:',
  '\tAlerts: none',
  'printer Backup_450 disabled since Sun 11 Oct 2026 04:00:00 PM EDT -',
  '\tPaused',
  '\tAlerts: paused',
  'printer Out_Of_Labels now printing Out_Of_Labels-3.  enabled since Sun 11 Oct 2026 04:12:10 PM EDT',
  '\tAlerts: media-empty-error',
  'printer Unplugged is idle.  enabled since Sun 11 Oct 2026 04:12:10 PM EDT',
  '\tAlerts: offline-report',
  'system default destination: DYMO_LabelWriter_450',
].join('\n');

async function main() {
  console.log('\ncups: lpstat');
  {
    const { printers, defaultName } = cups.parseLpstat(LPSTAT);
    check('every printer is read', printers.map((p) => p.name).join(',') === 'DYMO_LabelWriter_450,Backup_450,Out_Of_Labels,Unplugged', JSON.stringify(printers));
    check('the system default is known', defaultName === 'DYMO_LabelWriter_450' && printers[0].isDefault && !printers[1].isDefault);
    check('a ready printer is status 0', printers[0].status === 0 && printers[0].enabled);
    check('a paused (disabled) printer is status 1, as Windows says "paused"', printers[1].status === 1 && !printers[1].enabled);
    check('out of labels is status 5', printers[2].status === 5);
    check('offline is status 8', printers[3].status === 8);
    check('no printers and no default', cups.parseLpstat('no system default destination\n').printers.length === 0
      && cups.parseLpstat('no system default destination\n').defaultName === null);
  }

  console.log('\ncups: lp arguments');
  {
    const args = cups.lpArgs('/tmp/label.png', 'DYMO_LabelWriter_450');
    check('the queue, one copy, the 30256 roll, scaled onto the label, then the file',
      JSON.stringify(args) === JSON.stringify(['-d', 'DYMO_LabelWriter_450', '-n', '1', '-o', 'media=w167h288', '-o', 'fit-to-page', '--', '/tmp/label.png']),
      JSON.stringify(args));
    check('another roll from config', cups.lpArgs('/tmp/l.png', 'Q', { media: 'w79h252' }).includes('media=w79h252'));
    check('a bad media name falls back to the default', cups.lpArgs('/tmp/l.png', 'Q', { media: 'x; rm -rf /' }).includes('media=w167h288'));
    check('no name prints on the system default', cups.lpArgs('/tmp/l.png', '')[0] === '-n');
    let threw = false;
    try { cups.lpArgs('/tmp/l.png', 'DYMO LabelWriter 450'); } catch { threw = true; }
    check('a Windows-style name with spaces is refused, never passed on', threw);
    check('queue names', cups.isCupsQueueName('DYMO_LabelWriter_450') && !cups.isCupsQueueName('a/b')
      && !cups.isCupsQueueName('') && !cups.isCupsQueueName('-x y'));
    check('the job id is read from lp\'s answer', cups.parseLpRequestId('request id is DYMO_LabelWriter_450-12 (1 file(s))\n') === 'DYMO_LabelWriter_450-12'
      && cups.parseLpRequestId('') === null);
  }

  console.log('\ncups: the runners, against stand-in lp and lpstat');
  {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'cups-bin-'));
    const log = path.join(bin, 'args.log');
    fs.writeFileSync(path.join(bin, 'lp'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\necho "request id is DYMO_LabelWriter_450-7 (1 file(s))"\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'lpstat'), `#!/bin/sh\ncat <<'EOF'\n${LPSTAT}\nEOF\n`, { mode: 0o755 });
    const oldPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
    try {
      const id = await cups.cupsPrint('/tmp/label.png', 'DYMO_LabelWriter_450', {});
      check('a print returns the CUPS job id', id === 'DYMO_LabelWriter_450-7', id);
      const got = fs.readFileSync(log, 'utf8').trim().split('\n');
      check('lp got exactly the checked arguments, one per argv slot', got.join(' ') === cups.lpArgs('/tmp/label.png', 'DYMO_LabelWriter_450').join(' '), got.join(' '));
      const listed = await cups.cupsPrinters();
      check('the printer list comes from lpstat', listed && listed.printers.length === 4 && listed.defaultName === 'DYMO_LabelWriter_450');

      fs.writeFileSync(path.join(bin, 'lp'), '#!/bin/sh\necho "lp: The printer or class does not exist." >&2\nexit 1\n', { mode: 0o755 });
      let err = null;
      try { await cups.cupsPrint('/tmp/label.png', 'Nope', {}); } catch (e) { err = e; }
      check('a refusal rejects with CUPS\'s own words', err && /does not exist/.test(err.message), err && err.message);

      fs.unlinkSync(path.join(bin, 'lpstat'));
      process.env.PATH = bin;   // no lpstat anywhere
      check('no CUPS at all reads as "cannot ask" (null), never as no printers', (await cups.cupsPrinters()) === null);
    } finally {
      process.env.PATH = oldPath;
      fs.rmSync(bin, { recursive: true, force: true });
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

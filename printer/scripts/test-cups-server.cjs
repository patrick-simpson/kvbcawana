// The print server as the Raspberry Pi print station runs it
// (AWANA_PRINT_BACKEND=cups, ROADMAP.md#cloud-check-in): a label goes to CUPS's `lp`,
// the printer list and the /health printer warnings come from `lpstat`.
// Stand-in `lp` / `lpstat` programs on PATH record what they were given, so
// this is the real server, the real renderer and the real arguments; only the
// printer is missing. test-cups.cjs covers cups.js's parsers on their own.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const PORT = Number(process.env.AWANA_TEST_PORT || 34597);
const BASE = `http://127.0.0.1:${PORT}`;
const QUEUE = 'DYMO_LabelWriter_450';

async function j(pathname, opts) {
  const res = await fetch(BASE + pathname, opts);
  return { status: res.status, body: await res.json().catch(() => null) };
}
const post = (pathname, body) => j(pathname, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
});

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-cups-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-cups-bin-'));
  const argsLog = path.join(binDir, 'lp-args.log');
  const pngSeen = path.join(binDir, 'png-seen');
  const lpstatText = path.join(binDir, 'lpstat.txt');

  // lp: record its arguments, check the file it was handed is a PNG, answer
  // like CUPS. lpstat: whatever lpstat.txt says right now.
  fs.writeFileSync(path.join(binDir, 'lp'), [
    '#!/bin/sh',
    `printf '%s\\n' "$@" > '${argsLog}'`,
    'for last; do :; done',
    `head -c 8 "$last" | od -An -c | tr -d ' \\n' > '${pngSeen}'`,
    `echo "request id is ${QUEUE}-41 (1 file(s))"`,
  ].join('\n') + '\n', { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, 'lpstat'), `#!/bin/sh\ncat '${lpstatText}'\n`, { mode: 0o755 });
  // And no powershell: the station must never reach for it.
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
  const setLpstat = (alerts) => fs.writeFileSync(lpstatText, [
    `printer ${QUEUE} is idle.  enabled since Sun 11 Oct 2026 04:12:10 PM EDT`,
    `\tAlerts: ${alerts}`,
    `system default destination: ${QUEUE}`,
  ].join('\n') + '\n');
  setLpstat('none');

  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    printerName: QUEUE,
    checkinUrl: 'https://example.com/checkin',
  }, null, 2));
  process.env.AWANA_DATA_DIR = dataDir;
  process.env.AWANA_PORT = String(PORT);
  process.env.AWANA_BIND_HOST = '127.0.0.1';
  process.env.AWANA_PRINT_BACKEND = 'cups';
  process.env.PRINTER_NAME = QUEUE;   // the station's service sets it, as the launcher does

  const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((resolve) => {
    if (listener.listening) return resolve();
    listener.once('listening', resolve);
  });

  try {
    console.log('\ncups station: a label prints through lp');
    {
      const r = await post('/print-custom', { text: 'Test label' });
      check('the print succeeds', r.status === 200 && r.body && r.body.success !== false, JSON.stringify(r.body));
      const args = fs.existsSync(argsLog) ? fs.readFileSync(argsLog, 'utf8').trim().split('\n') : [];
      check('lp was asked for the chosen queue, one copy, the label roll, scaled to fit',
        args.slice(0, 8).join(' ') === `-d ${QUEUE} -n 1 -o media=w167h288 -o fit-to-page`, args.join(' '));
      check('and handed a PNG (the same renderer the laptop uses)',
        fs.existsSync(pngSeen) && fs.readFileSync(pngSeen, 'utf8').includes('PNG'), fs.existsSync(pngSeen) ? fs.readFileSync(pngSeen, 'utf8') : 'no file');
    }

    console.log('\ncups station: the printer list and its state');
    {
      const r = await j('/printers');
      check('/printers lists the CUPS queues, the default marked',
        r.status === 200 && r.body.printers.length === 1 && r.body.printers[0].name === QUEUE && r.body.printers[0].isWindowsDefault === true,
        JSON.stringify(r.body));
      const h = await j('/health');
      const types = (h.body && h.body.warnings || []).map((w) => w.type);
      check('a ready printer raises no printer warning',
        !types.some((t) => /^printer/.test(t)), types.join(','));
    }

    console.log(`\n${passed} passed, ${failed} failed`);
  } finally {
    listener.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

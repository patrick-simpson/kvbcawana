#!/usr/bin/env node
// The warm print helper (print-server/print-helper.js, owner 2026-10-15: "during
// peak times printouts can go fast"): ONE PowerShell prints label after label
// instead of a new PowerShell per label.
//
// WHAT THIS GUARDS
//
// * One helper process serves many labels; each answer is matched to its own
//   request (an answer naming another label is never taken for this one).
// * Fail safe before a label is handed over: a helper that will not start, says
//   no handshake, or has died prints the label the old way (a PowerShell of its
//   own), quickly, and the helper rests then starts again.
// * "ERR" is a definite failure, retried once after 750 ms as before, then the
//   backup printer as before.
// * After a label is handed over, no answer (it died, timed out, or said
//   something that is not the protocol) is an UNKNOWN outcome: never printed
//   again (no retry, no old way, no backup printer), and /print says
//   outcomeUnknown so the station's job journal never re-runs it.
// * The helper goes with stopListening(), and never keeps Node alive.
//
// The stand-in `powershell` below speaks the helper protocol when it is given
// the helper script, and logs one "spawn" line for an old-way print.
//
// Run: node scripts/test-print-helper.cjs
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
const { spawnSync } = require('child_process');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const root = path.join(__dirname, '..');
const PORT = Number(process.env.AWANA_TEST_PORT || require('./free-port.cjs')());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The stand-in: `handshake` says how it starts (ok, exit, none, garble); each line of
// `modes` says how it answers the next label (ok, err, die, hang, garble, wrongid).
function writeStub(binDir, D) {
  fs.writeFileSync(path.join(binDir, 'powershell'), `#!/bin/sh
D='${D}'
case "$*" in
  *-helper-*)
    echo "start $$" >> "$D/log"
    hs=$(cat "$D/handshake" 2>/dev/null)
    case "$hs" in
      exit) exit 0 ;;
      none) exec sleep 30 ;;
      garble) echo "Windows PowerShell"; exec sleep 30 ;;
    esac
    echo "AWANA-PRINT-HELPER READY 1"
    while IFS= read -r line; do
      id=$(printf '%s\\n' "$line" | sed -n 's/^{"id":"\\([^"]*\\)".*/\\1/p')
      mode=$(head -n 1 "$D/modes" 2>/dev/null); sed -i '1d' "$D/modes" 2>/dev/null
      echo "helper $$ $line" >> "$D/log"
      case "$mode" in
        err) echo "$id ERR The printer is out of labels" ;;
        die) exit 3 ;;
        hang) exec sleep 30 ;;
        garble) echo "PrintDocument?" ;;
        wrongid) echo "999 OK" ;;
        *) echo "$id OK" ;;
      esac
    done
    echo "eof $$" >> "$D/log"
    ;;
  *) echo "spawn $*" >> "$D/log" ;;
esac
exit 0
`, { mode: 0o755 });
}

(async () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-helperbin-'));
  const D = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-helperctl-'));
  writeStub(binDir, D);
  const logFile = path.join(D, 'log');
  const setHandshake = (v) => fs.writeFileSync(path.join(D, 'handshake'), v);
  const setModes = (...m) => fs.writeFileSync(path.join(D, 'modes'), m.length ? m.join('\n') + '\n' : '');
  const resetLog = () => fs.writeFileSync(logFile, '');
  const logLines = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean) : []);
  const count = (prefix) => logLines().filter((l) => l.startsWith(prefix)).length;
  setHandshake('ok'); setModes(); resetLog();

  process.env.PATH = `${binDir}:${process.env.PATH}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-helper-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ printerName: 'Fake', backupPrinterName: 'Backup', lateGraceMin: 24 * 60 }));
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), 'Clubber ID,First Name,Last Name,Club\n1,Ava,Stone,Sparks\n2,Eli,Stone,Cubbies\n');
  Object.assign(process.env, { AWANA_DATA_DIR: dataDir, AWANA_PORT: String(PORT), AWANA_BIND_HOST: '127.0.0.1', PRINTER_NAME: 'Fake', AWANA_PRINT_HELPER: '1' });
  const server = require(path.join(root, 'print-server', 'server.js'));
  const printing = require(path.join(root, 'print-server', 'server', 'printing.js'));
  const ph = require(path.join(root, 'print-server', 'print-helper.js'));
  const helper = printing.printHelper;
  // waitReadyMs: these checks let a label wait for the starting helper; the app never does (below).
  const FAST = { startMs: 1500, labelMs: 1500, backoffMinMs: 300, backoffMaxMs: 1000, waitReadyMs: 1500 };
  helper._setOptionsForTests(FAST);
  const fresh = () => helper._setOptionsForTests({ resetRest: true });
  const png = (n) => path.join(os.tmpdir(), `awana-test-label-${n}.png`);
  const settle = async (p) => { try { return { ok: true, value: await p }; } catch (e) { return { ok: false, e }; } };

  console.log('\nthe helper script prints exactly as the one-shot script does');
  {
    check('same paper, margins and drawing as the old script', /PaperSize\("Label", 400, 200\)/.test(ph.HELPER_PS)
      && /Margins\(0,0,0,0\)/.test(ph.HELPER_PS)
      && /DrawImage\(\$img, 0, 0, \$e\.PageBounds\.Width, \$e\.PageBounds\.Height\)/.test(ph.HELPER_PS));
    check('the printer named per label (none = the default printer, as before)', /if \(\$req\.printer\) \{ \$pd\.PrinterSettings\.PrinterName = \[string\]\$req\.printer \}/.test(ph.HELPER_PS));
    check('a handshake line once System.Drawing is loaded', ph.HELPER_PS.indexOf('Add-Type -AssemblyName System.Drawing') < ph.HELPER_PS.indexOf(ph.READY_LINE));
    const src = fs.readFileSync(path.join(root, 'print-server', 'print-helper.js'), 'utf8');
    check('started without a shell, hidden, its handles unref\'d', /spawnFn\('powershell', \['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath\]/.test(src)
      && !/shell:\s*true/.test(src) && /windowsHide: true/.test(src) && /child\.unref\(\)/.test(src));
    check('requests are ASCII only (a non-ASCII path is \\u-escaped)', ph.asciiJson({ path: 'C:\\Users\\Zoë\\a.png' }) === '{"path":"C:\\\\Users\\\\Zo\\u00eb\\\\a.png"}', ph.asciiJson({ path: 'C:\\Users\\Zoë\\a.png' }));
    check('on by default only on Windows; AWANA_PRINT_HELPER=1 / 0 forces it', /env === '1' \|\| process\.platform === 'win32'/.test(fs.readFileSync(path.join(root, 'print-server', 'server', 'printing.js'), 'utf8')));
  }

  console.log('\none helper process serves many labels');
  {
    resetLog(); setModes();
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) await printing.printLabel(png(i), 'Fake');
    const ms = Date.now() - t0;
    const lines = logLines();
    check('one helper started', count('start') === 1, lines.join(' | '));
    check('five labels, all through it, none the old way', count('helper') === 5 && count('spawn') === 0, lines.join(' | '));
    const pids = new Set(lines.filter((l) => l.startsWith('helper')).map((l) => l.split(' ')[1]));
    check('the same process for every label', pids.size === 1);
    const reqs = lines.filter((l) => l.startsWith('helper')).map((l) => JSON.parse(l.split(' ').slice(2).join(' ')));
    check('each request names its label and its printer', reqs.every((r, i) => r.path === png(i) && r.printer === 'Fake'), JSON.stringify(reqs[0]));
    check('each request has its own id', new Set(reqs.map((r) => r.id)).size === 5);
    check('quick (no PowerShell start-up per label)', ms < 3000, `${ms} ms`);
    check('the status says it is running', helper.status().running === true && helper.status().printed >= 5, JSON.stringify(helper.status()));
    resetLog();
    await printing.printLabel(path.join(os.tmpdir(), 'Zoë-label.png'), 'Fake');
    const line = logLines().find((l) => l.startsWith('helper')) || '';
    check('a non-ASCII path crosses the pipe escaped', /Zo\\u00eb-label\.png/.test(line) && !/ë/.test(line), line);
  }

  console.log('\nthe app never makes a label wait for a helper that is still starting (waitReadyMs 0)');
  {
    helper.stop();
    await new Promise((r) => setTimeout(r, 200));
    helper._setOptionsForTests({ waitReadyMs: 0, resetRest: true });
    resetLog(); setModes();
    const t0 = Date.now();
    await printing.printLabel(png('cold'), 'Fake');
    const ms = Date.now() - t0;
    check('the first label does not wait: it prints the old way while the helper starts', count('spawn') === 1 && count('helper') === 0, logLines().join(' | '));
    check('and the helper was started meanwhile', count('start') === 1, logLines().join(' | '));
    check('quickly', ms < 1500, `${ms} ms`);
    await new Promise((r) => setTimeout(r, 500));
    resetLog();
    await printing.printLabel(png('warm'), 'Fake');
    check('once it is ready, the next label goes through it', count('helper') === 1 && count('spawn') === 0, logLines().join(' | '));
    helper.stop();
    await new Promise((r) => setTimeout(r, 200));
    helper._setOptionsForTests({ resetRest: true });
    resetLog();
    helper.warm();
    await new Promise((r) => setTimeout(r, 500));
    await printing.printLabel(png('warmed'), 'Fake');
    check('warm() (the print server\'s start-up) has it ready before the first label', count('start') === 1 && count('helper') === 1 && count('spawn') === 0, logLines().join(' | '));
    check('the server starts it at start-up', /\$printing\.printHelper\.warm\(\)/.test(fs.readFileSync(path.join(root, 'print-server', 'server', 'lifecycle.js'), 'utf8')));
    helper._setOptionsForTests(FAST);
    fresh();
  }

  console.log('\nan answer is matched to its own request');
  {
    resetLog(); setModes('wrongid');
    const r = await settle(printing.printLabel(png('w'), 'Fake'));
    check('an answer naming another label is not this label\'s success', !r.ok && r.e.printOutcomeUnknown === true, r.ok ? 'printed' : r.e.message);
    check('and the label is not printed again (no retry, no old way, no backup)', count('helper') === 1 && count('spawn') === 0, logLines().join(' | '));
    fresh();
  }

  console.log('\nERR is a definite failure: retried once after 750 ms, then the backup printer, as before');
  {
    resetLog(); setModes('err', 'ok');
    const t0 = Date.now();
    const r = await settle(printing.printLabel(png('e1'), 'Fake'));
    const ms = Date.now() - t0;
    check('the second try prints it', r.ok && r.value.via === 'label', r.ok ? JSON.stringify(r.value) : r.e.message);
    const pidsE = new Set(logLines().filter((l) => l.startsWith('helper')).map((l) => l.split(' ')[1]));
    check('two requests to the same helper, after the 750 ms pause', count('helper') === 2 && pidsE.size === 1 && count('spawn') === 0 && ms >= 700, `${count('helper')} requests, ${ms} ms`);
    resetLog(); setModes('err', 'err', 'ok');
    const b = await settle(printing.printLabel(png('e2'), 'Fake'));
    const reqs = logLines().filter((l) => l.startsWith('helper')).map((l) => JSON.parse(l.split(' ').slice(2).join(' ')));
    check('two failures go to the backup printer', b.ok && b.value.via === 'fallback' && b.value.printer === 'Backup', b.ok ? JSON.stringify(b.value) : b.e.message);
    check('the backup print went through the helper too', reqs.length === 3 && reqs[2].printer === 'Backup' && count('spawn') === 0, JSON.stringify(reqs.map((x) => x.printer)));
    printing.printerFallbackWarnings();
    await printing.printLabel(png('e3'), 'Fake');   // a good print clears the backup warning
    resetLog(); setModes('err', 'err');
    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ printerName: 'Fake', lateGraceMin: 24 * 60 }));
    require(path.join(root, 'print-server', 'server', 'config.js')).config.backupPrinterName = '';
    const c = await settle(printing.printLabel(png('e4'), 'Fake'));
    check('with no backup, the ERR message reaches the caller', !c.ok && /out of labels/.test(c.e.message) && !c.e.printOutcomeUnknown, c.ok ? 'printed' : c.e.message);
    check('and the helper is still the one serving', helper.status().running === true);
    require(path.join(root, 'print-server', 'server', 'config.js')).config.backupPrinterName = 'Backup';
  }

  console.log('\na helper that will not start: the label prints the old way, quickly');
  {
    helper.stop(); await sleep(100);
    for (const hs of ['exit', 'garble']) {
      fresh(); resetLog(); setHandshake(hs); setModes();
      const t0 = Date.now();
      const r = await settle(printing.printLabel(png('s'), 'Fake'));
      const ms = Date.now() - t0;
      check(`handshake "${hs}": printed the old way`, r.ok && count('spawn') === 1 && count('helper') === 0, logLines().join(' | '));
      check(`handshake "${hs}": without waiting out the start-up limit`, ms < 1000, `${ms} ms`);
    }
    fresh(); resetLog(); setHandshake('none');
    const t0 = Date.now();
    const r = await settle(printing.printLabel(png('n'), 'Fake'));
    const ms = Date.now() - t0;
    check('no handshake at all: the old way once the start-up limit passes', r.ok && count('spawn') === 1 && ms >= 1400 && ms < 4000, `${ms} ms`);
    // Resting: the next labels go straight to the old way, no new helper.
    resetLog(); setHandshake('ok');
    const t1 = Date.now();
    for (let i = 0; i < 3; i++) await printing.printLabel(png(`r${i}`), 'Fake');
    check('while it rests, labels go the old way at once (no start attempt)', count('start') === 0 && count('spawn') === 3 && Date.now() - t1 < 1000, logLines().join(' | '));
    check('the status says it rests', helper.status().resting === true);
    await sleep(FAST.backoffMaxMs + 100);
    resetLog();
    await printing.printLabel(png('back'), 'Fake');
    check('after the rest it starts again and serves', count('start') === 1 && count('helper') === 1 && count('spawn') === 0, logLines().join(' | '));
  }

  console.log('\na stand-in that does not speak the protocol (`exit 0`, as in the other suites)');
  {
    helper.stop(); await sleep(100); fresh();
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-plainbin-'));
    const plainLog = path.join(plain, 'jobs.log');
    fs.writeFileSync(path.join(plain, 'powershell'), `#!/bin/sh\necho job >> ${plainLog}\nexit 0\n`, { mode: 0o755 });
    const savedPath = process.env.PATH;
    process.env.PATH = `${plain}:${savedPath}`;
    const t0 = Date.now();
    for (let i = 0; i < 4; i++) await printing.printLabel(png(`p${i}`), 'Fake');
    const ms = Date.now() - t0;
    process.env.PATH = savedPath;
    const jobs = fs.readFileSync(plainLog, 'utf8').trim().split('\n').length;
    check('every label printed (one start attempt, then the old way)', jobs === 5, `${jobs} runs`);
    check('in well under a second', ms < 1000, `${ms} ms`);
  }

  console.log('\nunknown outcome: the helper took the label and never answered');
  {
    for (const mode of ['die', 'hang', 'garble']) {
      fresh(); setHandshake('ok'); helper.stop(); await sleep(100);
      await printing.printLabel(png('warm'), 'Fake');   // a helper is running
      resetLog(); setModes(mode);
      const t0 = Date.now();
      const r = await settle(printing.printLabel(png(mode), 'Fake'));
      const ms = Date.now() - t0;
      check(`${mode}: the caller hears it may have printed`, !r.ok && r.e.printOutcomeUnknown === true && /may or may not have printed/.test(r.e.message), r.ok ? 'printed' : r.e.message);
      check(`${mode}: never printed again (one request, no retry, no old way, no backup)`, count('helper') === 1 && count('spawn') === 0, logLines().join(' | '));
      if (mode === 'hang') check('hang: given up at the per-label limit', ms >= 1400 && ms < 3000, `${ms} ms`);
      await sleep(50);
      check(`${mode}: the helper rests afterwards`, helper.status().resting === true && helper.status().running === false);
    }
    // The next label after the rest: a new helper.
    await sleep(FAST.backoffMaxMs + 100);
    resetLog(); setModes();
    await printing.printLabel(png('after'), 'Fake');
    check('the next label after the rest starts a new helper', count('start') === 1 && count('helper') === 1, logLines().join(' | '));
  }

  console.log('\n/print: an unknown outcome is never a refusal a station job could re-run');
  {
    const listener = server.startListening();
    await listener.ready;
    const post = (p, body) => fetch(`http://127.0.0.1:${PORT}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(async (x) => ({ status: x.status, body: await x.json().catch(() => null) }));
    fresh(); resetLog(); setModes();
    const ok = await post('/print', { firstName: 'Ava', lastName: 'Stone', clubName: 'Sparks', clubberId: '1' });
    check('a /print through the helper', ok.status === 200 && ok.body && ok.body.success === true && count('helper') === 1 && count('spawn') === 0, JSON.stringify(ok) + logLines().join(' | '));
    resetLog(); setModes('die');
    const r = await post('/print', { firstName: 'Eli', lastName: 'Stone', clubName: 'Cubbies', clubberId: '2' });
    check('answers 500 with outcomeUnknown (job-puller.js: already-spooled, CHECK THE PRINTER)', r.status === 500 && r.body && r.body.outcomeUnknown === true, JSON.stringify(r));
    check('and the label went to the printer once', count('helper') === 1 && count('spawn') === 0, logLines().join(' | '));
    const cfg = require(path.join(root, 'print-server', 'server', 'config.js')).config;
    await sleep(FAST.backoffMaxMs + 100); fresh();
    cfg.backupPrinterName = '';
    resetLog(); setModes('err', 'err');
    const custom = await post('/print-custom', { text: 'Snack table' });
    check('a definite failure (ERR twice, no backup) is a plain refusal, no such flag', custom.status === 500 && custom.body && custom.body.outcomeUnknown === undefined, JSON.stringify(custom));
    resetLog(); setModes('die');
    const custom2 = await post('/print-custom', { text: 'Coat rack' });
    check('/print-custom says outcomeUnknown too (every job route does)', custom2.status === 500 && custom2.body && custom2.body.outcomeUnknown === true, JSON.stringify(custom2));
    cfg.backupPrinterName = 'Backup';

    console.log('\nthe helper goes with the server');
    await sleep(FAST.backoffMaxMs + 100); fresh(); resetLog(); setModes();
    await printing.printLabel(png('last'), 'Fake');
    const pid = helper.pid;
    check('a helper is running', Number.isInteger(pid));
    await server.stopListening();
    await sleep(300);
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    check('stopListening() ends it (it reads to the end of its input and exits)', !alive && count('eof') === 1, logLines().join(' | '));
  }

  console.log('\nnever keeps Node alive');
  {
    const script = `
      process.env.PATH = ${JSON.stringify(`${binDir}:${process.env.PATH}`)};
      Object.assign(process.env, { AWANA_DATA_DIR: ${JSON.stringify(dataDir)}, PRINTER_NAME: 'Fake', AWANA_PRINT_HELPER: '1' });
      const printing = require(${JSON.stringify(path.join(root, 'print-server', 'server', 'printing.js'))});
      require(${JSON.stringify(path.join(root, 'print-server', 'server.js'))});
      printing.printHelper._setOptionsForTests({ waitReadyMs: 3000 });   // this label goes through the helper
      printing.printLabel('/tmp/x.png', 'Fake').then(() => console.log('PRINTED ' + printing.printHelper.status().printed));
    `;
    resetLog(); setModes(); setHandshake('ok');
    const t0 = Date.now();
    const out = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 15000 });
    const ms = Date.now() - t0;
    check('a process that printed through the helper exits by itself', out.status === 0 && /PRINTED 1/.test(out.stdout), `status ${out.status} ${out.signal || ''} ${String(out.stderr).slice(-300)}`);
    check('promptly (no idle helper holding it)', ms < 10000, `${ms} ms`);
  }

  __suiteFinished = true;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

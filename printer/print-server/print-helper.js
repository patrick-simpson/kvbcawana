'use strict';
// The warm print helper (owner 2026-10-15: "during peak times printouts can go fast").
//
// Until now every label started its own Windows PowerShell (runPowerShell(['-File', ...])
// in server/printing.js) and paid PowerShell's start-up and `Add-Type System.Drawing`
// for each one. The helper is ONE PowerShell, started on the first label and kept
// running, that prints label after label with the same System.Drawing code (the same
// 400 x 200 paper, zero margins, the image drawn to the page bounds).
//
// Protocol (one line each way, ASCII only):
//   helper -> us   READY_LINE once, after Add-Type (the start-up handshake)
//   us -> helper   {"id":"7","path":"C:\\...\\awana-print-....png","printer":"Name"}
//                  (non-ASCII escaped as \uXXXX, so no code page can mangle a path)
//   helper -> us   "7 OK"  or  "7 ERR <message>"
//
// FAIL SAFE. The helper only ever makes printing faster, never less sure:
//   * Before a request is written (disabled, resting after a failure, will not start,
//     no handshake within startMs, exited, a write that failed) the answer is
//     'unavailable' and the caller prints that label the old way (a PowerShell of
//     its own). Nothing reached a printer, so nothing can come out twice.
//   * "<id> ERR ..." is a definite failure, the same as the old script exiting with an
//     error: the caller's one retry and the backup printer apply as before.
//   * After a request is written, NO answer (the helper died, took longer than
//     labelMs, or answered something that is not the protocol) means the label MAY be
//     in the spooler. That is an UNKNOWN outcome: the error carries
//     `printOutcomeUnknown`, and nobody prints that label again on their own: not the
//     retry, not the backup printer, not the old path, not a re-leased station job
//     (the route says `outcomeUnknown` and job-puller.js treats it as a print with no
//     answer: already-spooled, CHECK THE PRINTER). A label that came out twice is
//     worse than one that did not come out (job-puller.js, AT MOST ONCE, owner).
//   * Any failure kills the helper and rests it (backoffMinMs doubling to backoffMaxMs,
//     reset by the next good label); the next label after the rest starts a new one.
//
// Requests are one at a time (the printer chain, withPrinter, already runs one job at
// a time); the ids are still checked so a late or stray answer can never be taken for
// another label's. The child's handles are unref'd: the helper never keeps Node alive.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const READY_LINE = 'AWANA-PRINT-HELPER READY 1';
const START_MS = 10 * 1000;          // PowerShell + Add-Type on a slow laptop, cold
const LABEL_MS = 15 * 1000;          // the old per-label limit (runPowerShell's timeout)
const BACKOFF_MIN_MS = 30 * 1000;
const BACKOFF_MAX_MS = 10 * 60 * 1000;
const IDLE_MS = 30 * 60 * 1000;      // a quiet half hour: let the process go (the next label starts one)
const STOP_GRACE_MS = 20 * 1000;     // stop(): a label being printed is let finish first

// The helper itself. The PrintPage handler reads the path from the document (as the
// one-shot script does) because outer variables are not reliably in scope in it.
const HELPER_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
[Console]::Out.WriteLine('${READY_LINE}')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq '') { continue }
  $id = '-'
  try {
    $req = $line | ConvertFrom-Json
    $id = [string]$req.id
    $pd = New-Object System.Drawing.Printing.PrintDocument
    try {
      if ($req.printer) { $pd.PrinterSettings.PrinterName = [string]$req.printer }
      $pd.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize("Label", 400, 200)
      $pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0,0,0,0)
      $pd | Add-Member -NotePropertyName LabelImagePath -NotePropertyValue ([string]$req.path)
      $pd.add_PrintPage({
        param($sender, $e)
        $img = [System.Drawing.Image]::FromFile($sender.LabelImagePath)
        try { $e.Graphics.DrawImage($img, 0, 0, $e.PageBounds.Width, $e.PageBounds.Height) }
        finally { $img.Dispose() }
      })
      $pd.Print()
    } finally { $pd.Dispose() }
    [Console]::Out.WriteLine("$id OK")
  } catch {
    $msg = [regex]::Replace([string]$_.Exception.Message, '[^\\x20-\\x7E]+', ' ')
    [Console]::Out.WriteLine("$id ERR $msg")
  }
  [Console]::Out.Flush()
}
`.trim();

/** JSON with every non-ASCII character escaped: the pipe carries ASCII only. */
const asciiJson = (v) => JSON.stringify(v).replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

function helperError(message, props) {
  return Object.assign(new Error(message), props);
}

/**
 * @param {{
 *   enabled?: () => boolean,
 *   spawnFn?: typeof spawn,
 *   log?: (m: string) => void,
 *   now?: () => number,
 *   startMs?: number, labelMs?: number, backoffMinMs?: number, backoffMaxMs?: number, idleMs?: number,
 *   tmpDir?: () => string,
 * }} [o]
 */
function createPrintHelper(o = {}) {
  const opts = {
    startMs: START_MS, labelMs: LABEL_MS, backoffMinMs: BACKOFF_MIN_MS, backoffMaxMs: BACKOFF_MAX_MS, idleMs: IDLE_MS,
  };
  const set = (x) => { for (const k of Object.keys(opts)) if (Number.isFinite(x[k]) && x[k] >= 0) opts[k] = x[k]; };
  set(o);
  const log = o.log || ((m) => console.log(m));
  const now = o.now || Date.now;
  const spawnFn = o.spawnFn || spawn;
  const enabled = o.enabled || (() => true);
  const tmpDir = o.tmpDir || (() => os.tmpdir());

  let proc = null;          // the running helper: { child, ready: Promise<boolean>, pending, buf, alive }
  let restUntil = 0;        // resting after a failure until then
  let failures = 0;         // in a row, for the back-off
  let seq = 0;
  let idleTimer = null;
  const stats = { started: 0, printed: 0, errors: 0, unknown: 0, fallbacks: 0, lastProblem: '' };

  function rest(reason) {
    failures += 1;
    const ms = Math.min(opts.backoffMaxMs, opts.backoffMinMs * 2 ** Math.min(failures - 1, 16));
    restUntil = now() + ms;
    stats.lastProblem = String(reason || '').slice(0, 200);
    log(`[print-helper] ${reason}: printing each label on its own PowerShell for ${Math.round(ms / 1000)} s`);
  }

  function kill(p) {
    if (!p) return;
    p.alive = false;
    if (proc === p) proc = null;
    try { p.child.stdin.destroy(); } catch { /* gone */ }
    try { p.child.kill(); } catch { /* gone */ }
  }

  function armIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (!proc || !opts.idleMs) return;
    idleTimer = setTimeout(() => { idleTimer = null; if (proc && !proc.pending) stop(); }, opts.idleMs);
    if (idleTimer.unref) idleTimer.unref();
  }

  // The answer line for the request in flight, or a protocol problem.
  function onLine(p, raw) {
    const line = raw.replace(/\r$/, '');
    if (!p.readySeen) {
      if (line === READY_LINE) { p.readySeen = true; p.onReady(true); }
      else if (line.trim()) { p.onReady(false, `no handshake (it said "${line.slice(0, 60)}")`); }
      return;
    }
    const req = p.pending;
    if (!req) {
      if (line.trim()) log(`[print-helper] ignored a line while idle: ${line.slice(0, 80)}`);
      return;
    }
    const m = /^(\S+) (OK|ERR)(?: (.*))?$/.exec(line);
    if (!m || m[1] !== req.id) {
      if (!line.trim()) return;
      req.settle('garbled', `answered "${line.slice(0, 80)}"`);
      return;
    }
    req.settle(m[2] === 'OK' ? 'ok' : 'err', (m[3] || 'the print failed').trim());
  }

  function start() {
    const scriptPath = path.join(tmpDir(), `awana-print-${Date.now()}-helper-${Math.random().toString(36).slice(2, 8)}.ps1`);
    try { fs.writeFileSync(scriptPath, HELPER_PS, 'utf8'); } catch (e) { rest(`could not write the helper script (${e.message})`); return null; }
    const unlink = () => fs.unlink(scriptPath, () => {});
    let child;
    try {
      child = spawnFn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],   // no shell: nothing in a path is ever interpreted
      });
    } catch (e) { unlink(); rest(`could not start (${e.message})`); return null; }
    stats.started += 1;
    const p = { child, alive: true, readySeen: false, pending: null, buf: '', stderr: '' };
    p.ready = new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => p.onReady(false, `no handshake within ${opts.startMs} ms`), opts.startMs);
      p.onReady = (ok, why) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unlink();   // parsed by now (or never will be)
        if (!ok) { kill(p); rest(`the helper did not start: ${why}`); }
        resolve(ok);
      };
    });
    child.on('error', (e) => { if (p.onReady) p.onReady(false, e.message); onGone(p, e.message); });
    child.on('exit', (code, signal) => {
      const why = `exited (${signal || code})`;
      if (!p.readySeen) p.onReady(false, why);
      onGone(p, why);
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      p.buf += d;
      let i;
      while ((i = p.buf.indexOf('\n')) !== -1) {
        const line = p.buf.slice(0, i);
        p.buf = p.buf.slice(i + 1);
        onLine(p, line);
      }
      if (p.buf.length > 64 * 1024) p.buf = '';   // a helper that never ends a line is not speaking the protocol
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { p.stderr = (p.stderr + d).slice(-2000); });
    child.stdin.on('error', () => { /* EPIPE: the write's own callback says so */ });
    // Never keep the Node process alive for the helper's sake.
    try { child.unref(); } catch { /* fine */ }
    for (const s of [child.stdin, child.stdout, child.stderr]) { try { if (s && s.unref) s.unref(); } catch { /* fine */ } }
    return p;
  }

  function onGone(p, why) {
    const was = p.alive;
    p.alive = false;
    if (proc === p) proc = null;
    if (p.pending) p.pending.settle('gone', why);
    else if (was && p.readySeen && !p.stopping) rest(`the helper ${why}`);
  }

  /**
   * One label. Resolves 'printed', or 'unavailable' (nothing was sent: print it the
   * old way). Rejects with an error: `helperErr` (a definite failure, like the old
   * script's) or `printOutcomeUnknown` (it may have printed: never print it again).
   */
  async function print(imagePath, printerName) {
    if (!enabled() || now() < restUntil) return 'unavailable';
    if (!proc || !proc.alive) { proc = start(); if (!proc) return 'unavailable'; }
    const p = proc;
    if (!(await p.ready) || !p.alive || p.pending || p.stopping) { stats.fallbacks += 1; return 'unavailable'; }

    const id = String(++seq);
    const outcome = await new Promise((resolve) => {
      let writeErr = null;
      let writeDone = false;
      let settled = null;
      const finish = () => {
        if (!settled || !writeDone) return;   // a failed write decides whether it was ever delivered
        p.pending = null;
        resolve({ ...settled, writeErr });
      };
      const timer = setTimeout(() => req.settle('timeout', `gave no answer within ${opts.labelMs} ms`), opts.labelMs);
      const req = {
        id,
        settle(kind, detail) {
          if (settled) return;
          settled = { kind, detail };
          clearTimeout(timer);
          // A write whose callback never comes counts as delivered (the cautious reading).
          if (!writeDone) { const t = setTimeout(() => { writeDone = true; finish(); }, 2000); if (t.unref) t.unref(); }
          finish();
        },
      };
      p.pending = req;
      try {
        p.child.stdin.write(asciiJson({ id, path: String(imagePath), printer: String(printerName || '') }) + '\n', (e) => {
          if (writeDone) return;
          writeErr = e || null;
          writeDone = true;
          if (e) req.settle('gone', `the request could not be written (${e.message})`);
          finish();
        });
      } catch (e) {
        writeErr = e;
        writeDone = true;
        req.settle('gone', `the request could not be written (${e.message})`);
      }
    });

    if (outcome.kind === 'ok') {
      failures = 0;
      stats.printed += 1;
      armIdle();
      return 'printed';
    }
    if (outcome.kind === 'err') {
      stats.errors += 1;
      armIdle();
      throw helperError(outcome.detail, { helperErr: true });
    }
    // Everything else is the helper failing. Kill it and let it rest.
    kill(p);
    if (outcome.writeErr) {
      // Never delivered (the pipe was closed): nothing can have printed.
      rest(`the helper ${outcome.detail}`);
      stats.fallbacks += 1;
      return 'unavailable';
    }
    stats.unknown += 1;
    rest(`the helper ${outcome.detail} while printing a label`);
    throw helperError(
      `The label printer helper ${outcome.detail}: the label may or may not have printed. Check the printer before printing it again.`,
      { printOutcomeUnknown: true },
    );
  }

  /** Let the helper go: a label being printed finishes first (it reads to the end of its input). */
  function stop() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    const p = proc;
    proc = null;
    if (!p) return;
    p.stopping = true;
    try { p.child.stdin.end(); } catch { /* gone */ }
    const t = setTimeout(() => kill(p), p.pending ? opts.labelMs + STOP_GRACE_MS : STOP_GRACE_MS);
    if (t.unref) t.unref();
  }

  function status() {
    return {
      running: !!(proc && proc.alive && proc.readySeen), resting: now() < restUntil,
      ...stats,
    };
  }

  return {
    print, stop, status,
    /** Tests: shorter limits, and forget a rest. */
    _setOptionsForTests(x) { set(x || {}); if (x && x.resetRest) { restUntil = 0; failures = 0; } },
    get pid() { return proc && proc.child ? proc.child.pid : null; },
  };
}

module.exports = { createPrintHelper, READY_LINE, HELPER_PS, START_MS, LABEL_MS, BACKOFF_MIN_MS, BACKOFF_MAX_MS, asciiJson };

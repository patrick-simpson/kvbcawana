// The downstairs classroom's black board (owner 2026-10-18): when a leader
// lifts a pen from the SMART Board's tray, SMART Ink puts its toolbar up, and
// the classroom page (classroom/public/src/app.js, event 'awana:pen-lifted')
// turns the screen black to write on until the next scheduled screen.
//
// A web page cannot see the pen tray, so this computer watches for it: ONE
// Windows PowerShell, started while the classroom screen is open, lists the
// visible windows of SMART Ink's processes twice a second and prints a line
// only when that list changes. More visible SMART Ink windows than before =
// a pen came up (penLifted). Every change is written to display.log (process
// names, window titles and classes, sizes; nothing else), so the first test
// at the board shows what SMART Ink on that computer actually does.
//
// Fail safe: no PowerShell, no SMART Ink, or a helper that dies only means no
// automatic board (the page's pen button and a pen touching the board still
// work). The helper is restarted with a growing rest, and its handles are
// unref'd so it never keeps the app alive.
'use strict';

const { spawn: realSpawn } = require('child_process');

const READY_LINE = 'AWANA-PEN-WATCH READY 1';
const POLL_MS = 500;
const RETRY_MIN_MS = 5 * 1000;
const RETRY_MAX_MS = 5 * 60 * 1000;
// SMART Ink's own processes (SMARTInk.exe and its helpers).
const PROCESS_PATTERN = '^SMART ?Ink';

const WATCH_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class AwanaPenWindows {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  public static List<string> Visible(HashSet<uint> pids) {
    var list = new List<string>();
    EnumWindows((h, l) => {
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (!pids.Contains(pid) || !IsWindowVisible(h)) return true;
      RECT r;
      if (!GetWindowRect(h, out r) || r.R - r.L <= 0 || r.B - r.T <= 0) return true;
      var t = new StringBuilder(128); GetWindowText(h, t, 128);
      var c = new StringBuilder(128); GetClassName(h, c, 128);
      list.Add(t.ToString() + "|" + c.ToString() + "|" + (r.R - r.L) + "x" + (r.B - r.T));
      return true;
    }, IntPtr.Zero);
    list.Sort();
    return list;
  }
}
"@
[Console]::Out.WriteLine('${READY_LINE}')
[Console]::Out.Flush()
$last = $null
while ($true) {
  $procs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '${PROCESS_PATTERN}' })
  $pids = New-Object 'System.Collections.Generic.HashSet[uint32]'
  foreach ($p in $procs) { [void]$pids.Add([uint32]$p.Id) }
  $names = @($procs | ForEach-Object { $_.ProcessName } | Sort-Object -Unique)
  $wins = @([AwanaPenWindows]::Visible($pids))
  $line = 'STATE ' + (ConvertTo-Json -Compress -InputObject @{ procs = $names; windows = $wins })
  if ($line -ne $last) { $last = $line; [Console]::Out.WriteLine($line); [Console]::Out.Flush() }
  Start-Sleep -Milliseconds ${POLL_MS}
}
`;

/**
 * One line from the helper, or null when it is not a state line.
 * @param {string} line
 * @returns {{ procs: string[], windows: string[] } | null}
 */
function parseState(line) {
  if (typeof line !== 'string' || !line.startsWith('STATE ')) return null;
  let v;
  try { v = JSON.parse(line.slice(6)); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const list = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]).filter((s) => typeof s === 'string').map((s) => s.slice(0, 300));
  return { procs: list(v.procs), windows: list(v.windows) };
}

/** A pen came up: SMART Ink shows more windows than it did (its toolbar). */
function penLifted(before, after) {
  if (!after) return false;
  return after.windows.length > (before ? before.windows.length : 0);
}

/**
 * @param {{ onLift: () => void, log: (...parts: any[]) => void, spawn?: typeof realSpawn, platform?: string }} opts
 */
function createPenWatch(opts) {
  const spawn = opts.spawn || realSpawn;
  const platform = opts.platform || process.platform;
  let child = null;
  let wanted = false;
  let state = null;
  let retryMs = RETRY_MIN_MS;
  let retryTimer = null;

  function start() {
    if (wanted || platform !== 'win32') return;
    wanted = true;
    run();
  }

  function run() {
    if (!wanted || child) return;
    state = null;
    let buf = '';
    let ready = false;
    try {
      const encoded = Buffer.from(WATCH_PS, 'utf16le').toString('base64');
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      opts.log('pen watch could not start', err);
      child = null;
      rest();
      return;
    }
    const me = child;
    me.unref?.();
    me.stdout?.unref?.();
    me.stderr?.unref?.();
    me.stdout?.setEncoding?.('utf8');
    me.stdout?.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line === READY_LINE) { ready = true; retryMs = RETRY_MIN_MS; opts.log('pen watch: watching for SMART Ink'); continue; }
        const next = parseState(line);
        if (!next) continue;
        const lifted = penLifted(state, next);
        opts.log('pen watch: SMART Ink', { processes: next.procs, windows: next.windows, lifted });
        state = next;
        if (lifted) { try { opts.onLift(); } catch (err) { opts.log('pen watch: page not told', err); } }
      }
    });
    me.stderr?.on('data', (chunk) => opts.log('pen watch said:', String(chunk).slice(0, 500)));
    me.on('error', (err) => opts.log('pen watch failed', err));
    me.on('exit', (code) => {
      if (child === me) child = null;
      if (!wanted) return;
      opts.log('pen watch stopped', { code, ready });
      rest();
    });
  }

  function rest() {
    if (!wanted) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { retryTimer = null; run(); }, retryMs);
    retryTimer.unref?.();
    retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
  }

  function stop() {
    wanted = false;
    clearTimeout(retryTimer);
    retryTimer = null;
    state = null;
    if (child) { try { child.kill(); } catch { /* gone already */ } child = null; }
  }

  return { start, stop, isRunning: () => Boolean(child) };
}

module.exports = { createPenWatch, parseState, penLifted, READY_LINE, WATCH_PS, PROCESS_PATTERN };

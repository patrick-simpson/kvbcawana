// The downstairs classroom's SMART Ink, cleared on the clock (owner
// 2026-10-19: "the Awana app should clear the smart ink 10 seconds before
// [the opening], and clear it at each clean half hour mark during club").
//
// SMART Ink draws its ink in its own window over every other one, so a page
// cannot wipe it: pen marks left on the board would sit on top of the opening
// ceremony (the classroom shows the game time projector from 10 seconds before
// it starts) or carry over into the next club's time. On a club night this
// computer (the classroom screen only, Windows only) restarts SMART Ink, which
// takes every pen mark with it, at:
//
//   - 10 seconds before the opening ceremony starts (the schedule's opening
//     slideshow, else the meeting start), and
//   - every half hour on the half hour after that, while the classroom's
//     hours last (with its 18:30-20:00 hours: 6:30, 7:00 and 7:30).
//
// Restarting is the one clear SMART Ink allows from outside: ONE hidden
// PowerShell stops its processes and starts its program again (the path the
// running copy came from, else its usual install folder). Its toolbar is gone
// for a few seconds; the pen watch (pen-watch.js) is hushed meanwhile so the
// toolbar coming back is never taken for a lifted pen. Everything is logged
// to display.log. Fail safe: no SMART Ink running = nothing to clear, and a
// clear that fails only leaves the ink where it was.
'use strict';

const { spawn: realSpawn } = require('child_process');
const { zonedParts } = require('./clubNight');

const EARLY_S = 10;
const HALF_HOUR_S = 30 * 60;
/** How long the pen watch ignores SMART Ink's windows after a restart. */
const HUSH_MS = 30 * 1000;
/** A clock jump longer than this (a PC waking from sleep) clears nothing late. */
const MAX_STEP_S = 90;
const DONE_LINE = 'AWANA-INK';

const CLEAR_PS = `
$ErrorActionPreference = 'Continue'
$procs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^SMART ?Ink' })
if ($procs.Count -eq 0) { [Console]::Out.WriteLine('${DONE_LINE} NONE'); exit 0 }
$main = @($procs | Where-Object { $_.ProcessName -match '^SMART ?Ink$' })
if ($main.Count -eq 0) { $main = $procs }
$paths = @($main | ForEach-Object { try { $_.Path } catch { $null } } | Where-Object { $_ } | Sort-Object -Unique)
if ($paths.Count -eq 0) {
  $known = Join-Path \${env:ProgramFiles(x86)} 'SMART Technologies\\SMART Ink\\SMARTInk.exe'
  if (Test-Path $known) { $paths = @($known) }
}
$names = @($procs | ForEach-Object { $_.ProcessName } | Sort-Object -Unique)
$procs | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800
$left = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^SMART ?Ink' }).Count
foreach ($p in $paths) { try { Start-Process -FilePath $p } catch { [Console]::Out.WriteLine('${DONE_LINE} START-FAILED ' + $p) } }
[Console]::Out.WriteLine('${DONE_LINE} CLEARED ' + (ConvertTo-Json -Compress -InputObject @{ stopped = $names; stillRunning = $left; started = $paths }))
`;

const toMin = (hm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Tonight's opening, minutes after midnight: the schedule's opening slideshow
 * (a special date's own windows first), else the meeting's start.
 * @param {any} schedule  @param {string} dateKey
 * @returns {number | null}
 */
function openingMinute(schedule, dateKey) {
  const special = schedule?.specialDates?.[dateKey];
  const windows = Array.isArray(special?.windows) && special.windows.length ? special.windows : schedule?.windows;
  const opening = Array.isArray(windows) ? windows.find((w) => w && w.kind === 'slideshow' && w.deck === 'opening') : null;
  const at = toMin(opening?.start);
  if (at != null) return at;
  return toMin(schedule?.meeting?.start);
}

/**
 * The seconds after midnight to clear at tonight: 10 s before the opening,
 * then each half hour on the half hour after it, before `closeMin`.
 * @param {any} schedule  @param {string} dateKey  @param {number} closeMin
 * @returns {number[]}
 */
function inkClearMarks(schedule, dateKey, closeMin) {
  const open = openingMinute(schedule, dateKey);
  if (open == null) return [];
  const marks = [open * 60 - EARLY_S];
  for (let s = (Math.floor(open / 30) + 1) * HALF_HOUR_S; s < closeMin * 60; s += HALF_HOUR_S) marks.push(s);
  return marks;
}

/**
 * The mark passed between two readings of the clock, or null. Readings on
 * different days, or further apart than MAX_STEP_S, pass none.
 * @param {number[]} marks  @param {{ dateKey: string, sec: number } | null} last  @param {{ dateKey: string, sec: number }} next
 */
function markPassed(marks, last, next) {
  if (!last || last.dateKey !== next.dateKey) return null;
  if (next.sec <= last.sec || next.sec - last.sec > MAX_STEP_S) return null;
  const hit = marks.find((m) => m > last.sec && m <= next.sec);
  return hit === undefined ? null : hit;
}

/** The church's wall clock, to the second. */
function clockAt(now, timeZone) {
  const { dateKey, minutes } = zonedParts(now, timeZone);
  return { dateKey, sec: minutes * 60 + now.getUTCSeconds() };
}

/**
 * @param {{
 *   log: (...parts: any[]) => void,
 *   onClear?: () => void,
 *   spawn?: typeof realSpawn, platform?: string,
 * }} opts  onClear runs as the restart starts (the pen watch is hushed there)
 */
function createInkClear(opts) {
  const spawn = opts.spawn || realSpawn;
  const platform = opts.platform || process.platform;
  let last = null;
  let busy = false;

  /** Restarts SMART Ink now (Windows only; one at a time). */
  function clear(why) {
    if (platform !== 'win32' || busy) return false;
    busy = true;
    try { opts.onClear?.(); } catch { /* the clear still runs */ }
    let child;
    try {
      const encoded = Buffer.from(CLEAR_PS, 'utf16le').toString('base64');
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      busy = false;
      opts.log('SMART Ink clear could not start', err);
      return false;
    }
    opts.log('SMART Ink clear', why);
    child.unref?.();
    child.stdout?.unref?.();
    child.stderr?.unref?.();
    child.stdout?.setEncoding?.('utf8');
    child.stdout?.on('data', (chunk) => {
      for (const line of String(chunk).split('\n').map((s) => s.trim()).filter(Boolean)) {
        if (line.startsWith(DONE_LINE)) opts.log('SMART Ink clear:', line.slice(DONE_LINE.length + 1));
      }
    });
    child.stderr?.on('data', (chunk) => opts.log('SMART Ink clear said:', String(chunk).slice(0, 500)));
    child.on('error', (err) => { busy = false; opts.log('SMART Ink clear failed', err); });
    child.on('exit', () => { busy = false; });
    return true;
  }

  /**
   * One look at the clock (every second): clears when a mark has just passed
   * on a club night.
   * @param {Date} now  @param {{ schedule: any, timeZone: string, clubNight: boolean, closeMin: number }} night
   */
  function tick(now, night) {
    const next = clockAt(now, night.timeZone);
    const prev = last;
    last = next;
    if (!night.clubNight) return null;
    const mark = markPassed(inkClearMarks(night.schedule, next.dateKey, night.closeMin), prev, next);
    if (mark == null) return null;
    const hh = Math.floor(mark / 3600);
    const mm = Math.floor((mark % 3600) / 60);
    const ss = mark % 60;
    clear(`at ${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`);
    return mark;
  }

  return { tick, clear };
}

module.exports = { createInkClear, inkClearMarks, markPassed, openingMinute, clockAt, CLEAR_PS, HUSH_MS, EARLY_S };

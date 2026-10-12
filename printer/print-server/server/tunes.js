'use strict';
// Musical printer.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const fs    = require('fs');
const $config = lazy('./config');
const $images = lazy('./images');
const $printing = lazy('./printing');

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  buildTuneTspl: { enumerable: true, get: () => buildTuneTspl },
  lastTune: { enumerable: true, get: () => lastTune },
  nextTuneName: { enumerable: true, get: () => nextTuneName },
  playTuneIfEnabled: { enumerable: true, get: () => playTuneIfEnabled },
  TUNE_NAMES: { enumerable: true, get: () => TUNE_NAMES },
  TUNE_ROTATION: { enumerable: true, get: () => TUNE_ROTATION },
});

// ── Musical printer (#11/#12) ─────────────────────────────────────────────────
// A thermal label printer is a stepper motor with a paper supply, and stepper
// pitch tracks step rate: vary the feed SPEED and the motor sings. TSPL-family
// printers (the club's Phomemo/Omezizy D450-class speaks it over USB) accept
// per-command SPEED changes, so a "tune" is a sequence of SPEED+FEED pairs sent
// as RAW bytes past the Windows driver, ending in one fast BACKFEED that
// returns the media to (near) its start — a final swoop note that also keeps
// stock use at zero-ish.
//
// Hard rules: the raw path NEVER touches normal label printing (its own temp
// file, its own PowerShell script, failures logged and swallowed), and the
// whole feature sits behind config.musicalPrinter — off by default, because
// raw bytes at an unknown printer model are a party trick, not a guarantee.
const TUNES = {
  // [speed ips, seconds] per note. Pitch tracks speed; duration is
  // feed-length/speed. Speeds stay in the D450-class's 1–6 range.
  arpeggio:    [[2, 0.18], [3, 0.18], [4, 0.18], [6, 0.28]],
  charge:      [[3, 0.14], [4, 0.14], [5, 0.14], [6, 0.22], [5, 0.14], [6, 0.30]],
  westminster: [[5, 0.22], [3, 0.22], [4, 0.22], [2, 0.34], [2, 0.22], [4, 0.22], [5, 0.22], [3, 0.34]],
  // "Hap-py birth-day to you" — G G A G C B mapped onto the motor's low
  // speeds (1 1 2 1 3 2) so the whole phrase fits the feed cap: low speed =
  // fewer dots per second of sound, which is what buys six notes.
  birthday:    [[1, 0.15], [1, 0.15], [2, 0.22], [1, 0.22], [3, 0.17], [2, 0.22]],
};
const TUNE_NAMES = Object.keys(TUNES);
// The per-label rotation deliberately excludes 'birthday' — that one is
// reserved for a birthday kid's label, so hearing it MEANS something.
const TUNE_ROTATION = ['arpeggio', 'charge', 'westminster'];
const TSPL_DPI = 203;                 // D450-class print head
const TUNE_MAX_FEED_DOTS = 400;       // hard cap ≈ 2in of forward feed

// Cycle tunes per LABEL (operator request — was per day): every print gets
// the next tune in rotation, so a batch of siblings plays a little medley.
let tuneCursor = 0;
function nextTuneName() {
  const name = TUNE_ROTATION[tuneCursor % TUNE_ROTATION.length];
  tuneCursor++;
  return name;
}

// Compile a tune to a TSPL program. Pure and exported: the byte stream is the
// unit-testable artifact, since nobody wants CI to need a singing printer.
function buildTuneTspl(tuneName) {
  const notes = TUNES[tuneName] || TUNES.arpeggio;
  const lines = [];
  let totalDots = 0;
  for (const [speed, seconds] of notes) {
    let dots = Math.max(8, Math.round(speed * TSPL_DPI * seconds));
    if (totalDots + dots > TUNE_MAX_FEED_DOTS) dots = TUNE_MAX_FEED_DOTS - totalDots;
    if (dots <= 0) break;
    lines.push(`SPEED ${speed}`);
    lines.push(`FEED ${dots}`);
    totalDots += dots;
  }
  // The return swoop: fast backfeed of everything we fed, so the label stock
  // ends (near) where it started. Printers that refuse long backfeeds just
  // creep forward a little — the operator's cue to turn the toggle off.
  lines.push('SPEED 6');
  lines.push(`BACKFEED ${totalDots}`);
  return lines.join('\r\n') + '\r\n';
}

// Send raw bytes to a named printer via winspool's RAW datatype — the escape
// hatch past the GDI driver. Same PowerShell/temp-file discipline as
// printImage(); the printer name is validated (isSafePrinterName) at the
// endpoint, single quotes escaped here.
function sendRawToPrinter(bytes, printerName) {
  return $printing.withPrinter(() => sendRawToPrinterNow(bytes, printerName));
}

async function sendRawToPrinterNow(bytes, printerName) {
  const binPath = $images.tmpFilePath('awana-tune', 'bin');
  fs.writeFileSync(binPath, bytes);
  const safeBin = binPath.replace(/'/g, "''");
  const safePrinter = (printerName || '').replace(/'/g, "''");
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RawPrint {
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string printer, out IntPtr h, IntPtr pd);
  [DllImport("winspool.Drv")] public static extern bool ClosePrinter(IntPtr h);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DOCINFOA {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr h, int level, ref DOCINFOA di);
  [DllImport("winspool.Drv")] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv")] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv")] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv")] public static extern bool WritePrinter(IntPtr h, byte[] bytes, int count, out int written);
}
"@
$bytes = [System.IO.File]::ReadAllBytes('${safeBin}')
$h = [IntPtr]::Zero
if (-not [RawPrint]::OpenPrinter('${safePrinter}', [ref]$h, [IntPtr]::Zero)) { throw ('OpenPrinter failed for ''${safePrinter}'', Win32 error ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
try {
  $di = New-Object RawPrint+DOCINFOA
  $di.pDocName = 'Club Label Printer tune'
  $di.pDataType = 'RAW'
  if (-not [RawPrint]::StartDocPrinter($h, 1, [ref]$di)) { throw ('StartDocPrinter (RAW) failed, Win32 error ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
  [RawPrint]::StartPagePrinter($h) | Out-Null
  $written = 0
  if (-not [RawPrint]::WritePrinter($h, $bytes, $bytes.Length, [ref]$written)) { throw ('WritePrinter failed, Win32 error ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
  if ($written -ne $bytes.Length) { throw ('WritePrinter wrote ' + $written + ' of ' + $bytes.Length + ' bytes') }
  [RawPrint]::EndPagePrinter($h) | Out-Null
  [RawPrint]::EndDocPrinter($h) | Out-Null
} finally { [RawPrint]::ClosePrinter($h) | Out-Null }
`.trim();
  const psPath = $images.tmpFilePath('awana-tune', 'ps1');
  try {
    fs.writeFileSync(psPath, ps, 'utf8');
    await $printing.runPowerShell(['-File', psPath], { timeout: 15000 });
  } finally {
    fs.unlink(psPath, () => {});
    fs.unlink(binPath, () => {});
  }
}

// Play a tune if (and only if) the toggle is on. Never throws: the chirp is
// garnish, and garnish must never delay or fail a label. One quick retry
// (spooler hiccups are transient), and the outcome — success or the exact
// Win32 error — is kept for /health so "it just prints normal" is
// diagnosable from the dashboard instead of invisible.
let lastTune = null; // { ok, tune, printer, error?, at }
async function playTuneIfEnabled(printerName, tuneName) {
  if ($config.config.musicalPrinter !== true) return false;
  const name = TUNE_NAMES.includes(tuneName) ? tuneName : nextTuneName();
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await sendRawToPrinter(Buffer.from(buildTuneTspl(name), 'ascii'), printerName);
      lastTune = { ok: true, tune: name, printer: String(printerName || ''), at: new Date().toISOString() };
      console.log(`[tune] Played '${name}' on ${printerName || 'default printer'}`);
      return true;
    } catch (e) {
      if (attempt === 1) {
        await $printing.sleep(400);   // a breather before the one retry
        continue;
      }
      lastTune = {
        ok: false, tune: name, printer: String(printerName || ''),
        error: String(e.message || e).slice(0, 200), at: new Date().toISOString(),
      };
      console.warn('[tune] Tune failed after retry (non-critical):', e.message);
      return false;
    }
  }
  return false;
}

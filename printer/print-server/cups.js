'use strict';
// Printing on Linux, through CUPS: the print station half of CLOUD-CHECKIN.md
// (a Raspberry Pi at church with the label printer on USB). Windows keeps its
// PowerShell path in server.js untouched; on Linux the same label PNG goes to
// `lp`, and the printer list and its state come from `lpstat`.
//
// Pure parsers first (tested in scripts/test-cups.cjs without a printer), then
// two thin runners. Every command is execFile with an argument array: no shell,
// so a printer name can never become a command.

const { execFile } = require('child_process');

// The DYMO LabelWriter 450's 4 x 2-5/16 in shipping label (30256) as the DYMO
// CUPS driver names it. config.cupsMedia overrides it for another roll; check
// the first test label on a new station before a club night.
const DEFAULT_CUPS_MEDIA = 'w167h288';

// A CUPS queue name: no spaces, slashes or '#', at most 127 bytes (CUPS's own
// rule). Anything else is refused before it reaches `lp`.
function isCupsQueueName(name) {
  const s = String(name == null ? '' : name);
  return s.length > 0 && s.length <= 127 && /^[^\s/#\\'"]+$/.test(s) && !/[\x00-\x1f\x7f]/.test(s);
}

// A media keyword: letters, digits, dots, underscores, dashes.
function isMediaKeyword(media) {
  return typeof media === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(media);
}

/**
 * The `lp` arguments for one label. The PNG is scaled onto the label
 * (fit-to-page); CUPS's image filter turns it to match the label's feed.
 * @param {string} imagePath
 * @param {string} [printerName]  '' means the system default queue
 * @param {{ media?: string }} [opts]
 * @returns {string[]}
 */
function lpArgs(imagePath, printerName, opts = {}) {
  const media = isMediaKeyword(opts.media) ? opts.media : DEFAULT_CUPS_MEDIA;
  const args = [];
  if (printerName) {
    if (!isCupsQueueName(printerName)) throw new Error(`Not a printer name CUPS accepts: "${printerName}"`);
    args.push('-d', printerName);
  }
  args.push('-n', '1', '-o', `media=${media}`, '-o', 'fit-to-page', '--', imagePath);
  return args;
}

/** "request id is DYMO_LabelWriter_450-12 (1 file(s))" → "DYMO_LabelWriter_450-12" */
function parseLpRequestId(stdout) {
  const m = /request id is (\S+)/.exec(String(stdout || ''));
  return m ? m[1] : null;
}

// What CUPS says about a printer, in the numbers server.js's
// printerSetupWarnings() already reads from Windows' Get-Printer
// (PRINTER_STATUS_PROBLEMS): 0 fine, 1 paused, 4 jam, 5 out of labels,
// 8 offline.
const ALERT_STATUS = [
  [/media-empty|media-needed/, 5],
  [/media-jam/, 4],
  [/offline|connecting-to-device|cups-missing-filter/, 8],
];

/**
 * `lpstat -l -p -d` → the printers, the system default, and each one's state.
 * @param {string} text
 * @returns {{ printers: Array<{ name: string, enabled: boolean, isDefault: boolean, status: number }>, defaultName: string|null }}
 */
function parseLpstat(text) {
  const lines = String(text || '').split(/\r?\n/);
  const printers = [];
  let defaultName = null;
  let current = null;
  for (const line of lines) {
    const p = /^printer (\S+) (?:is |now |disabled)(.*)$/.exec(line);
    if (p) {
      const enabled = !/disabled/.test(line);
      current = { name: p[1], enabled, isDefault: false, status: enabled ? 0 : 1 };
      printers.push(current);
      continue;
    }
    const d = /^system default destination: (\S+)/.exec(line);
    if (d) { defaultName = d[1]; current = null; continue; }
    const alerts = /^\s+Alerts:\s*(.*)$/.exec(line);
    if (alerts && current) {
      for (const [re, status] of ALERT_STATUS) {
        if (re.test(alerts[1])) { current.status = Math.max(current.status, status); break; }
      }
    }
  }
  for (const p of printers) p.isDefault = p.name === defaultName;
  return { printers, defaultName };
}

/** @returns {Promise<string>} */
function run(cmd, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || err.message || err).trim().split('\n')[0];
        reject(new Error(`${cmd}: ${msg}`));
        return;
      }
      resolve(String(stdout || ''));
    });
  });
}

/**
 * Print one label PNG. Resolves the CUPS job id; rejects when `lp` refuses it.
 * @param {string} imagePath @param {string} printerName @param {{ media?: string }} [opts]
 */
async function cupsPrint(imagePath, printerName, opts = {}) {
  const out = await run('lp', lpArgs(imagePath, printerName, opts), 15000);
  const id = parseLpRequestId(out);
  if (!id) throw new Error(`lp: no job id in its answer (${out.trim().slice(0, 120)})`);
  return id;
}

/** The installed printers and their state, or null if CUPS cannot be asked. */
async function cupsPrinters() {
  try {
    return parseLpstat(await run('lpstat', ['-l', '-p', '-d'], 8000));
  } catch {
    return null;
  }
}

module.exports = {
  DEFAULT_CUPS_MEDIA,
  isCupsQueueName,
  isMediaKeyword,
  lpArgs,
  parseLpRequestId,
  parseLpstat,
  cupsPrint,
  cupsPrinters,
};

// The tail of this computer's display log, for its row on
// awana.kvbchurch.org/settings (owner 2026-10-22: the owner, away from church,
// needed to see what SMART Ink did when a pen came up; worker/src/routes.md
// 10.7a). device-sync.js sends it after a hello when it changed.
//
// Scrubbed before it leaves the computer: the Windows user folder
// (C:\Users\<name>\ becomes C:\Users\…\) and any session, passphrase or
// Bearer value. Nothing in the display log names a child.
'use strict';

const fs = require('fs');

/** As many lines as the Worker keeps (SCREEN_LOG_LINES_MAX). */
const LINES = 100;
/** Each file is read from its end, at most this much. */
const READ_BYTES = 64 * 1024;

/** One line with the private parts taken out. @param {string} line */
function scrubLine(line) {
  return String(line)
    // C:\Users\Name\..., C:/Users/Name/..., and the JSON spelling C:\\Users\\Name\\...
    // (a name with a space runs to the next slash; one with no slash after it, to the next space)
    .replace(/([A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/))(?:[^\\/"'\n]+?(?=[\\/])|[^\\/"'\s]+)/gi, '$1…')
    .replace(/((?:session|passphrase|authKey|token)=)[^&\s"']+/gi, '$1…')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, '$1…');
}

/** The last `bytes` of a file as lines (the first, likely cut, dropped when the file is longer). */
function lastLines(file, bytes = READ_BYTES) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split(/\r?\n/);
    if (start > 0) lines.shift();
    return lines.filter((l) => l.trim());
  } catch {
    return [];
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ }
  }
}

/**
 * The newest `n` lines of `file`, reaching into `file.1` (the log rolls over at
 * 1 MB) when the new file is short. Scrubbed. [] when there is no log.
 * @param {string} file @param {number} [n]
 * @returns {string[]}
 */
function readLogTail(file, n = LINES) {
  let lines = lastLines(file);
  if (lines.length < n) lines = [...lastLines(`${file}.1`), ...lines];
  return lines.slice(-n).map(scrubLine);
}

module.exports = { LINES, READ_BYTES, scrubLine, readLogTail };

// Restart Chrome after an update (owner, 7.4.1): "once there's a new version,
// everything needs to restart. Chrome browser, print server, etc." The app's
// own update already restarts it and the print server inside it; this is
// Chrome's half. It runs on the first launch after an update, once the new
// extension files are on disk, so the Chrome that comes back loads them.
//
// Chrome is closed outright (every window, owner's choice) and reopened on the
// check-in page only. Closed with /F, Chrome would offer "Restore pages?" on
// the way back, so it is reopened with --hide-crash-restore-bubble. If Chrome
// is not installed where Windows puts it, the check-in page opens in the
// default browser instead.
//
// Kept free of Electron so scripts/test-chrome-restart.cjs can drive it with
// fakes for tasklist, taskkill and the launch.
'use strict';

const path = require('path');

function chromeCandidates(env) {
  const e = env || {};
  const out = [];
  for (const base of [e.ProgramFiles, e['ProgramFiles(x86)'], e.LOCALAPPDATA, e.ProgramW6432]) {
    if (base) out.push(path.win32.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  return [...new Set(out)];
}

function chromeArgs(url) {
  return ['--hide-crash-restore-bubble', '--new-window', url];
}

function isChromeRunning(execFileSync) {
  try {
    const out = String(execFileSync('tasklist', ['/FI', 'IMAGENAME eq chrome.exe', '/NH'], { timeout: 10000, windowsHide: true }));
    return /chrome\.exe/i.test(out);
  } catch {
    return false;
  }
}

/**
 * @param {object} o
 * @param {string} o.url            the check-in page (already judged safe)
 * @param {Function} o.execFileSync child_process.execFileSync
 * @param {Function} o.spawn        child_process.spawn
 * @param {Function} o.existsSync   fs.existsSync
 * @param {Function} o.openExternal fallback when Chrome is not found
 * @param {Function} o.sleep        ms → Promise
 * @param {object}   [o.env]        process.env
 * @param {string}   [o.platform]   process.platform
 * @param {Function} [o.log]
 * @returns {Promise<{ok: boolean, closed: boolean, launched: string}>}
 */
async function restartChrome(o) {
  const log = o.log || (() => {});
  if ((o.platform || process.platform) !== 'win32') return { ok: false, closed: false, launched: 'not-windows' };
  let closed = false;
  if (isChromeRunning(o.execFileSync)) {
    try {
      o.execFileSync('taskkill', ['/IM', 'chrome.exe', '/T', '/F'], { timeout: 15000, windowsHide: true });
    } catch (e) {
      log(`[chrome] taskkill: ${e && e.message}`);
    }
    for (let i = 0; i < 20 && isChromeRunning(o.execFileSync); i++) await o.sleep(500);
    closed = !isChromeRunning(o.execFileSync);
    log(closed ? '[chrome] Closed Chrome' : '[chrome] Chrome did not close; opening the check-in page anyway');
  }
  const exe = chromeCandidates(o.env || process.env).find(p => o.existsSync(p));
  if (exe) {
    try {
      const child = o.spawn(exe, chromeArgs(o.url), { detached: true, stdio: 'ignore', windowsHide: false });
      if (child && child.unref) child.unref();
      log(`[chrome] Reopened Chrome on ${o.url}`);
      return { ok: true, closed, launched: 'chrome' };
    } catch (e) {
      log(`[chrome] Launch failed: ${e && e.message}`);
    }
  }
  await o.openExternal(o.url);
  return { ok: true, closed, launched: 'default-browser' };
}

module.exports = { restartChrome, chromeCandidates, chromeArgs, isChromeRunning };

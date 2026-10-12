// Removing "Awana Lobby Display" once its hand-off is applied (KVBC Awana
// v9, ROADMAP.md#kvbc-awana-one-app). Windows only, packaged only; main.js calls it on every
// start until handoff.done.json says it is gone, so a removal that failed
// (the PC shut down mid-way, the uninstaller was locked) is tried again.
//
// How it is found, strongest first:
//   1. its uninstall entry: electron-builder's per-user NSIS installer writes
//      HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<GUID>, where
//      the GUID is UUID v5 of its appId (org.kvbc.awana-lobby-display) in
//      electron-builder's namespace: OLD_APP_GUID below, computed with
//      builder-util-runtime's UUID.v5 and pinned by test/old-app.test.cjs.
//      Its QuietUninstallString is the uninstaller with "/currentuser /S";
//   2. its known install folder: %LOCALAPPDATA%\Programs\awana-lobby-display
//      (the folder is package.json's "name"), "Uninstall Awana Lobby
//      Display.exe" in it;
//   3. the folder of the .exe the hand-off says it ran from.
// The NSIS uninstaller copies itself to a temp folder and returns at once,
// so success is judged afterwards: the entry gone and the .exe gone.
// Its login item (Electron writes HKCU\...\Run under the app's
// AppUserModelId, org.kvbc.awana-lobby-display) is removed either way (the
// bridge release leaves it in place, so a failed install still comes back at
// the next sign-in). Its userData
// (%APPDATA%\Awana Lobby Display) is left alone: the uninstaller keeps it too,
// and it is the only copy of what the hand-off carried over.
'use strict';

const path = require('path');

const OLD_APP_GUID = 'fb4f7b93-33d6-55b2-a7fe-6244a2d4f44d';
const OLD_APP_ID = 'org.kvbc.awana-lobby-display';
const OLD_EXE = 'Awana Lobby Display.exe';
const OLD_UNINSTALLER = 'Uninstall Awana Lobby Display.exe';
const OLD_INSTALL_DIR_NAME = 'awana-lobby-display';
const UNINSTALL_KEY = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${OLD_APP_GUID}`;
const RUN_KEYS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
];

/** Splits a Windows command line: a quoted or bare program, then its arguments. */
function splitCommandLine(line) {
  const s = String(line || '').trim();
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

/** A `reg query /v` value out of reg.exe's text output, or null. */
function parseRegValue(stdout, name) {
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const m = /^\s*(.+?)\s{2,}REG_\w+\s{2,}(.*)$/.exec(line);
    if (m && m[1].trim().toLowerCase() === name.toLowerCase()) return m[2].trim();
  }
  return null;
}

/** The uninstaller to run: { exe, args } from the strongest source found, or null. */
async function findUninstaller({ run, exists, env = process.env, fromExe = null }) {
  const r = await run('reg', ['query', UNINSTALL_KEY, '/v', 'QuietUninstallString']);
  const quiet = r.code === 0 ? parseRegValue(r.stdout, 'QuietUninstallString') : null;
  if (quiet) {
    const [exe, ...args] = splitCommandLine(quiet);
    if (exe && /\.exe$/i.test(exe)) return { exe, args: args.length ? args : ['/currentuser', '/S'], source: 'registry' };
  }
  const dirs = [];
  if (env.LOCALAPPDATA) dirs.push(path.win32.join(env.LOCALAPPDATA, 'Programs', OLD_INSTALL_DIR_NAME));
  if (fromExe) dirs.push(path.win32.dirname(fromExe));
  for (const dir of dirs) {
    const exe = path.win32.join(dir, OLD_UNINSTALLER);
    if (exists(exe)) return { exe, args: ['/currentuser', '/S'], source: 'folder' };
  }
  return null;
}

/** Whether the old app's process is still running (tasklist). */
async function oldAppRunning(run) {
  const r = await run('tasklist', ['/FI', `IMAGENAME eq ${OLD_EXE}`, '/NH']);
  return r.code === 0 && String(r.stdout || '').toLowerCase().includes(OLD_EXE.toLowerCase());
}

/**
 * Removes the old app. Never throws. `run(cmd, args)` resolves
 * { code, stdout } (main.js wraps execFile with windowsHide), `exists(path)`
 * and `sleep(ms)` are injected for the tests.
 * @returns {Promise<{ removed: boolean, source?: string, reason?: string, loginItem: boolean }>}
 */
async function removeOldApp({ run, exists, sleep, env = process.env, fromExe = null, log = () => {} }) {
  const result = { removed: false, loginItem: false };
  try {
    // Its login item first: whatever happens below, it must not start again
    // beside KVBC Awana at the next sign-in.
    let loginItem = true;
    for (const key of RUN_KEYS) {
      const q = await run('reg', ['query', key, '/v', OLD_APP_ID]);
      if (q.code !== 0) continue; // no such value
      const d = await run('reg', ['delete', key, '/v', OLD_APP_ID, '/f']);
      if (d.code !== 0) loginItem = false;
    }
    result.loginItem = loginItem;

    // The bridge quits right after it starts the installer; give it a moment.
    for (let i = 0; i < 30 && await oldAppRunning(run); i++) await sleep(2000);
    if (await oldAppRunning(run)) {
      await run('taskkill', ['/IM', OLD_EXE, '/F']);
      await sleep(2000);
    }

    const uninstaller = await findUninstaller({ run, exists, env, fromExe });
    if (!uninstaller) {
      // Nothing to run: it is gone already (removed by hand, or a second
      // start after a removal that worked).
      const stillListed = (await run('reg', ['query', UNINSTALL_KEY])).code === 0;
      return { ...result, removed: !stillListed, reason: stillListed ? 'listed, but its uninstaller is missing' : 'not installed' };
    }
    log(`[old-app] Removing Awana Lobby Display (${uninstaller.source}): ${uninstaller.exe}`);
    await run(uninstaller.exe, uninstaller.args);
    for (let i = 0; i < 60; i++) {
      const listed = (await run('reg', ['query', UNINSTALL_KEY])).code === 0;
      if (!listed && !exists(uninstaller.exe)) return { ...result, removed: true, source: uninstaller.source };
      await sleep(2000);
    }
    return { ...result, removed: false, source: uninstaller.source, reason: 'still installed two minutes after its uninstaller ran' };
  } catch (e) {
    return { ...result, removed: false, reason: e && e.message ? e.message : String(e) };
  }
}

module.exports = {
  OLD_APP_GUID,
  OLD_APP_ID,
  UNINSTALL_KEY,
  RUN_KEYS,
  splitCommandLine,
  parseRegValue,
  findUninstaller,
  removeOldApp,
};

// Retire the Chrome extension (KVBC Awana 10.0.0, owner 2026-10-16).
//
// Up to 9.x the app copied its bundled Chrome extension into one folder under
// userData (%APPDATA%\awana-label-printer\chrome-extension) on every launch,
// and the check-in laptop's Chrome loads that folder UNPACKED. 10.0.0 ships no
// extension: the sync Worker and this app do its work. Chrome, though, keeps
// loading whatever is in that folder, and nobody is at the laptop to remove it
// from chrome://extensions. So on every launch this module NEUTERS the folder:
//
//   * manifest.json becomes a stub: the same name, this app's version,
//     manifest v3, and nothing else (no content_scripts, no host_permissions,
//     no background, no permissions, no popup). Chrome loads an extension
//     that does nothing.
//   * every other file in the folder is deleted (the old prune), so no 9.x
//     code is left on disk for anything to load.
//
// It returns `retired` only on the launch that replaced a real manifest; main.js
// then restarts Chrome once (src/chrome-restart.js, the old restart-on-update
// path) so the running 9.x code stops by itself. Every later launch finds the
// stub and answers `current` (or `cleaned` if a leftover file had to go or a
// later 10.x version number was written, which does not restart Chrome again). A folder that does not exist is left alone:
// no Chrome loads it, and creating one would only invite somebody to.
//
// Deliberately Electron-free so electron-app/test/extension-stub.test.cjs can
// drive it with a temp directory, same reasoning as config-store.js.
'use strict';

const fs = require('fs');
const path = require('path');

// The name the 9.x extension carried; used when the folder's own manifest
// cannot be read, so Chrome's list still shows the same entry.
const EXTENSION_NAME = 'KVBC Kids Check-in Extension';
const DESCRIPTION = 'Retired in KVBC Awana 10.0.0: it does nothing. Check-in is at awana.kvbchurch.org/checkin. You may remove it from chrome://extensions.';

/** The stub manifest, exactly as it is written (stable text, so a re-run can compare it). */
function stubManifest({ name, version }) {
  return JSON.stringify({
    manifest_version: 3,
    name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 75) : EXTENSION_NAME,
    version,
    description: DESCRIPTION,
  }, null, 2) + '\n';
}

/** Relative paths of every regular file under `dir` (symlinks skipped, never followed), sorted. */
function listFiles(dir, prefix = '', out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) { out.push(rel); continue; }   // removed as a link, never followed
    if (entry.isDirectory()) listFiles(path.join(dir, entry.name), rel, out);
    else out.push(rel);
  }
  return out.sort();
}

/** Empty sub-folders left once their files are gone, deepest first (the folder itself stays). */
function removeEmptyDirs(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const sub = path.join(dir, entry.name);
    removeEmptyDirs(sub);
    try { fs.rmdirSync(sub); } catch { /* not empty: leave it */ }
  }
}

function readManifest(dir) {
  try {
    return { text: fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8') };
  } catch {
    return { text: null };
  }
}

/** A manifest this module wrote (any version): nothing in it runs. */
function isStub(text) {
  try {
    const m = JSON.parse(text);
    return !!m && m.description === DESCRIPTION && !m.content_scripts && !m.background && !m.host_permissions && !m.permissions;
  } catch {
    return false;
  }
}

function manifestName(text) {
  try {
    const name = JSON.parse(text).name;
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

/** temp file in the same folder + rename: Chrome may have this very folder loaded. */
function writeFileAtomic(destPath, text) {
  const tmp = `${destPath}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, destPath);
}

/**
 * Neuter the managed extension folder.
 *
 * @param {{targetDir: string, version: string}} o  version = this app's (`app.getVersion()`)
 * @returns {{action: 'retired'|'cleaned'|'current'|'absent'|'skipped'|'failed',
 *            version: string|null, targetDir: string|null, removed: number, error?: string}}
 *   retired  the folder held a real (9.x) manifest; it now holds only the stub.
 *            The caller restarts Chrome once.
 *   cleaned  a stub (perhaps of another version) or no manifest was there; the
 *            stub was (re)written and/or leftover files were deleted. No restart.
 *   current  only the stub is there; nothing touched.
 *   absent   no folder; nothing written.
 *   skipped  called without a folder or a version.
 *   failed   writing or deleting threw; `error` says why. The next launch tries again.
 */
function retireExtension({ targetDir, version } = {}) {
  const result = { action: 'skipped', version: null, targetDir: targetDir || null, removed: 0 };
  if (!targetDir || typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    result.error = 'targetDir and an X.Y.Z version are required';
    return result;
  }
  let stat = null;
  try { stat = fs.lstatSync(targetDir); } catch { /* absent */ }
  if (!stat) return { ...result, action: 'absent' };
  if (!stat.isDirectory()) return { ...result, action: 'failed', error: 'the extension path is not a folder' };

  const before = readManifest(targetDir);
  const wanted = stubManifest({ name: manifestName(before.text), version });
  const manifestIsStub = before.text === wanted;
  // Only replacing a REAL extension's manifest restarts Chrome: a stub from an
  // earlier 10.x launch (another version number) or a folder with no manifest
  // at all (Chrome could not load it anyway) is just rewritten.
  const realBefore = before.text !== null && !isStub(before.text);
  let removed = 0;
  try {
    // The stub first: from this moment nothing in the folder names a script,
    // so a delete that fails half way leaves an extension that does nothing.
    if (!manifestIsStub) writeFileAtomic(path.join(targetDir, 'manifest.json'), wanted);
    for (const rel of listFiles(targetDir)) {
      if (rel === 'manifest.json') continue;
      fs.rmSync(path.join(targetDir, rel), { force: true });
      removed++;
    }
    removeEmptyDirs(targetDir);
  } catch (e) {
    return { ...result, action: 'failed', version: manifestIsStub ? version : null, removed, error: e && e.message ? e.message : String(e) };
  }
  return {
    action: realBefore ? 'retired' : (manifestIsStub && !removed ? 'current' : 'cleaned'),
    version,
    targetDir,
    removed,
  };
}

module.exports = { retireExtension, stubManifest, listFiles, EXTENSION_NAME };

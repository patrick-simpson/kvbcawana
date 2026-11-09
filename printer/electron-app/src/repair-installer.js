'use strict';
// The repair installer's integrity check. main.js downloads the full installer
// when an update left the app broken and then runs it, so before it runs, its
// sha512 must match the one the update feed names (the same feed the updater
// reads: awana.kvbchurch.org/updates/printer/latest.yml). A file that does not
// match is deleted and never run. No Electron: pure functions plus a streaming
// hash, tested in test/repair-installer.test.cjs.

const crypto = require('crypto');
const fs = require('fs');

const FEED_URL = 'https://awana.kvbchurch.org/updates/printer/latest.yml';

// A sha512 digest in base64 is 88 characters ending in "==".
const SHA512_RE = /^[A-Za-z0-9+/]{86}==$/;

const unquote = (s) => s.trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');

/**
 * The sha512 the feed (latest.yml) names for its installer: the top-level
 * `sha512` line (not the one nested under `files:`). Null when it is missing
 * or not a well-formed base64 sha512.
 * @param {string} text
 * @returns {string | null}
 */
function parseFeedSha512(text) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^sha512:\s*(.+)$/.exec(line);
    if (m) {
      const value = unquote(m[1]);
      return SHA512_RE.test(value) ? value : null;
    }
  }
  return null;
}

/**
 * Whether a computed digest equals the feed's, compared in constant time.
 * @param {string | null} expected  base64 sha512 from the feed
 * @param {string} actual           base64 sha512 of the file
 * @returns {boolean}
 */
function digestsMatch(expected, actual) {
  if (!expected || !SHA512_RE.test(expected) || !SHA512_RE.test(actual || '')) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

/**
 * base64 sha512 of a file, streamed (the installer is ~245 MB).
 * @param {string} file
 * @returns {Promise<string>}
 */
function sha512OfFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('base64')));
  });
}

/**
 * Check a downloaded installer against the feed's sha512. Resolves
 * `{ ok: true }` or `{ ok: false, reason }` (a plain phrase for the dialog);
 * never rejects. A feed without a usable sha512 is a refusal too.
 * @param {string} file
 * @param {string} feedText
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function verifyInstaller(file, feedText) {
  const expected = parseFeedSha512(feedText);
  if (!expected) return { ok: false, reason: 'the update feed does not give a checksum for the installer' };
  let actual;
  try { actual = await sha512OfFile(file); } catch (e) { return { ok: false, reason: 'the downloaded installer could not be read (' + ((e && e.message) || e) + ')' }; }
  if (!digestsMatch(expected, actual)) return { ok: false, reason: 'the downloaded installer does not match the checksum in the update feed' };
  return { ok: true };
}

// ── Where the installer is written (10.14.0) ──────────────────────────────────
// Never a fixed name in the shared temp folder (another program could put its own file
// there first, or swap it between the check and the run): a fresh folder of its own
// (mkdtemp) and a random file name in it, created exclusively (flag 'wx'). The folder is
// deleted when the run fails, and on a later start once the installer has finished.
const path = require('path');
const REPAIR_DIR_PREFIX = 'kvbc-awana-repair-';

/** A new private folder and a random installer path in it. @param {string} tmpDir */
function makeRepairPath(tmpDir) {
  const dir = fs.mkdtempSync(path.join(tmpDir, REPAIR_DIR_PREFIX));
  const file = path.join(dir, `KVBC-Awana-Setup-${crypto.randomBytes(8).toString('hex')}.exe`);
  return { dir, file };
}

/** Delete a repair folder and what is in it. Never throws. @param {string} dir */
function removeRepairDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still in use: a later start sweeps it */ }
}

/**
 * Delete repair folders older than `maxAgeMs` (an installer that ran has long finished).
 * Returns how many went. Never throws.
 * @param {string} tmpDir @param {number} [now] @param {number} [maxAgeMs]
 */
function sweepRepairDirs(tmpDir, now = Date.now(), maxAgeMs = 60 * 60 * 1000) {
  let removed = 0;
  let names = [];
  try { names = fs.readdirSync(tmpDir); } catch { return 0; }
  for (const name of names) {
    if (!name.startsWith(REPAIR_DIR_PREFIX)) continue;
    const dir = path.join(tmpDir, name);
    try {
      const st = fs.lstatSync(dir);
      if (!st.isDirectory() || now - st.mtimeMs < maxAgeMs) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      removed += 1;
    } catch { /* locked or gone */ }
  }
  return removed;
}

module.exports = {
  FEED_URL, parseFeedSha512, digestsMatch, sha512OfFile, verifyInstaller,
  REPAIR_DIR_PREFIX, makeRepairPath, removeRepairDir, sweepRepairDirs,
};

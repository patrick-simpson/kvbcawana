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

module.exports = { FEED_URL, parseFeedSha512, digestsMatch, sha512OfFile, verifyInstaller };

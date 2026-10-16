'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseFeedSha512, digestsMatch, sha512OfFile, verifyInstaller, FEED_URL } = require('../src/repair-installer');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-installer-'));
const file = path.join(dir, 'KVBC-Awana-Setup.exe');
fs.writeFileSync(file, 'pretend installer bytes');
const good = crypto.createHash('sha512').update('pretend installer bytes').digest('base64');
const other = crypto.createHash('sha512').update('something else').digest('base64');
const feed = (sha) => `version: 9.6.0
files:
  - url: https://example.invalid/KVBC-Awana-Setup.exe
    sha512: ${other}
    size: 1
path: https://example.invalid/KVBC-Awana-Setup.exe
sha512: ${sha}
releaseDate: '2026-10-15T11:34:40.844Z'
`;

describe('the repair installer check', () => {
  it('reads the feed from the site, the one the updater uses', () => {
    assert.equal(FEED_URL, 'https://awana.kvbchurch.org/updates/printer/latest.yml');
  });
  it('takes the top-level sha512, not the one under files', () => {
    assert.equal(parseFeedSha512(feed(good)), good);
    assert.equal(parseFeedSha512(feed(`'${good}'`)), good);
  });
  it('refuses a feed with no usable sha512', () => {
    assert.equal(parseFeedSha512(''), null);
    assert.equal(parseFeedSha512('version: 9.6.0\n'), null);
    assert.equal(parseFeedSha512('sha512: short\n'), null);
    assert.equal(parseFeedSha512(null), null);
  });
  it('compares digests exactly', () => {
    assert.ok(digestsMatch(good, good));
    assert.ok(!digestsMatch(good, other));
    assert.ok(!digestsMatch(null, good));
    assert.ok(!digestsMatch(good, ''));
  });
  it('hashes a file the way the feed writes it', async () => {
    assert.equal(await sha512OfFile(file), good);
  });
  it('passes a matching installer', async () => {
    assert.deepEqual(await verifyInstaller(file, feed(good)), { ok: true });
  });
  it('refuses a mismatch, a missing checksum and an unreadable file', async () => {
    const bad = await verifyInstaller(file, feed(other));
    assert.equal(bad.ok, false);
    assert.match(bad.reason, /does not match/);
    assert.equal((await verifyInstaller(file, 'version: 9.6.0\n')).ok, false);
    const gone = await verifyInstaller(path.join(dir, 'nope.exe'), feed(good));
    assert.equal(gone.ok, false);
    assert.match(gone.reason, /could not be read/);
  });
});

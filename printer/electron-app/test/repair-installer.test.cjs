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

describe('where the repair installer is written (10.14.0)', () => {
  const { makeRepairPath, removeRepairDir, sweepRepairDirs, REPAIR_DIR_PREFIX } = require('../src/repair-installer');
  it('a fresh private folder and a random file name each time, never the old fixed name', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-where-'));
    const a = makeRepairPath(tmp);
    const b = makeRepairPath(tmp);
    assert.notEqual(a.dir, b.dir);
    assert.notEqual(path.basename(a.file), path.basename(b.file));
    assert.ok(path.basename(a.dir).startsWith(REPAIR_DIR_PREFIX));
    assert.equal(path.dirname(a.file), a.dir);
    assert.match(path.basename(a.file), /^KVBC-Awana-Setup-[0-9a-f]{16}\.exe$/);
    assert.ok(fs.statSync(a.dir).isDirectory());
    removeRepairDir(a.dir);
    assert.ok(!fs.existsSync(a.dir));
  });
  it('sweeps only its own folders once they are old', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-sweep-'));
    const old = makeRepairPath(tmp);
    fs.writeFileSync(old.file, 'x');
    const fresh = makeRepairPath(tmp);
    fs.mkdirSync(path.join(tmp, 'someone-else'));
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(old.dir, past, past);
    assert.equal(sweepRepairDirs(tmp), 1);
    assert.ok(!fs.existsSync(old.dir));
    assert.ok(fs.existsSync(fresh.dir));
    assert.ok(fs.existsSync(path.join(tmp, 'someone-else')));
  });
});

describe('main.js writes and runs the installer safely (10.14.0)', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const i = main.indexOf('function downloadRepairInstaller');
  const fn = main.slice(i, main.indexOf('function probeServer', i));
  it('no fixed temp name; exclusive create in its own folder', () => {
    assert.ok(!main.includes("path.join(os.tmpdir(), 'KVBC-Awana-Setup.exe')"));
    assert.match(fn, /repairInstaller\.makeRepairPath\(os\.tmpdir\(\)\)/);
    assert.match(fn, /fs\.createWriteStream\(dest, \{ flags: 'wx' \}\)/);
  });
  it('the bytes as they arrived and the file on disk right before opening both match the feed', () => {
    assert.match(fn, /streamHash\.update\(chunk\)/);
    assert.ok(fn.indexOf('digestsMatch') < fn.indexOf('verifyInstaller(dest, feedText)'));
    assert.ok(fn.indexOf('verifyInstaller(dest, feedText)') < fn.indexOf('shell.openPath(dest)'));
  });
  it('a failure deletes the folder, and a later start sweeps an old one', () => {
    assert.match(fn, /repairInstaller\.removeRepairDir\(where\.dir\)/);
    assert.match(main, /repairInstaller\.sweepRepairDirs\(os\.tmpdir\(\)\);/);
  });
});

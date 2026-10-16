'use strict';
// KVBC Awana 10.0.0 retires the Chrome extension: src/extension-sync.js turns
// the folder the check-in laptop's Chrome loads unpacked into a stub that does
// nothing, and main.js restarts Chrome once so the 9.x code stops running.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { retireExtension, stubManifest, EXTENSION_NAME } = require('../src/extension-sync');

const OLD_MANIFEST = {
  manifest_version: 3,
  name: 'KVBC Kids Check-in Extension',
  version: '9.6.0',
  permissions: ['storage'],
  host_permissions: ['http://localhost:3456/*'],
  action: { default_popup: 'popup.html', default_icon: 'icon128.png' },
  background: { service_worker: 'background.js' },
  content_scripts: [{ matches: ['*://*.twotimtwo.com/*'], js: ['feeds.js', 'content.js', 'touch.js'], run_at: 'document_idle' }],
  icons: { 128: 'icon128.png' },
};

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kvbc-ext-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function write9x(target) {
  fs.mkdirSync(path.join(target, 'icons'), { recursive: true });
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(OLD_MANIFEST));
  for (const f of ['content.js', 'feeds.js', 'touch.js', 'background.js', 'popup.html', 'popup.js', 'options.html', 'options.js', 'icon128.png', 'README.md', 'content.js.tmp', 'icons/x.png']) {
    fs.writeFileSync(path.join(target, f), 'old code');
  }
}
const files = (target) => fs.readdirSync(target, { recursive: true }).map(String).sort();
const manifest = (target) => JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'));

describe('the Chrome extension stub', () => {
  it('replaces a 9.x extension with a manifest that runs nothing, and says to restart Chrome', () => {
    const target = path.join(dir, 'chrome-extension');
    write9x(target);
    const r = retireExtension({ targetDir: target, version: '10.0.0' });
    assert.equal(r.action, 'retired');
    assert.equal(r.version, '10.0.0');
    assert.deepEqual(files(target), ['manifest.json'], 'every other file and folder is gone');
    const m = manifest(target);
    assert.equal(m.manifest_version, 3);
    assert.equal(m.name, OLD_MANIFEST.name, 'the same name, so Chrome lists the same entry');
    assert.equal(m.version, '10.0.0');
    for (const key of ['content_scripts', 'host_permissions', 'background', 'permissions', 'action', 'options_ui', 'icons']) {
      assert.equal(key in m, false, key);
    }
    assert.match(m.description, /awana\.kvbchurch\.org\/checkin/);
  });

  it('runs on every launch, but restarts Chrome only once', () => {
    const target = path.join(dir, 'chrome-extension');
    write9x(target);
    assert.equal(retireExtension({ targetDir: target, version: '10.0.0' }).action, 'retired');
    assert.equal(retireExtension({ targetDir: target, version: '10.0.0' }).action, 'current');
    // A file that turns up again (an old copy, a stray .tmp) is deleted, without a restart.
    fs.writeFileSync(path.join(target, 'content.js'), 'old code');
    const again = retireExtension({ targetDir: target, version: '10.0.0' });
    assert.equal(again.action, 'cleaned');
    assert.equal(again.removed, 1);
    assert.deepEqual(files(target), ['manifest.json']);
    // A later 10.x writes its own version into the stub, still without a restart.
    const later = retireExtension({ targetDir: target, version: '10.0.1' });
    assert.equal(later.action, 'cleaned');
    assert.equal(manifest(target).version, '10.0.1');
  });

  it('never creates the folder, and a folder with no manifest gets the stub without a restart', () => {
    const missing = path.join(dir, 'never-there');
    assert.equal(retireExtension({ targetDir: missing, version: '10.0.0' }).action, 'absent');
    assert.equal(fs.existsSync(missing), false);

    const bare = path.join(dir, 'bare');
    fs.mkdirSync(bare);
    fs.writeFileSync(path.join(bare, 'content.js'), 'old code');
    const r = retireExtension({ targetDir: bare, version: '10.0.0' });
    assert.equal(r.action, 'cleaned');
    assert.deepEqual(files(bare), ['manifest.json']);
    assert.equal(manifest(bare).name, EXTENSION_NAME);
  });

  it('a damaged manifest is still replaced', () => {
    const target = path.join(dir, 'chrome-extension');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'manifest.json'), '{ not json');
    fs.writeFileSync(path.join(target, 'content.js'), 'old code');
    const r = retireExtension({ targetDir: target, version: '10.0.0' });
    assert.equal(r.action, 'retired');
    assert.equal(manifest(target).name, EXTENSION_NAME);
    assert.deepEqual(files(target), ['manifest.json']);
  });

  it('a link inside the folder is removed, never followed', () => {
    const target = path.join(dir, 'chrome-extension');
    write9x(target);
    const outside = path.join(dir, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'not ours');
    try { fs.symlinkSync(outside, path.join(target, 'link')); } catch { return; }   // no symlinks here (Windows without the right)
    retireExtension({ targetDir: target, version: '10.0.0' });
    assert.deepEqual(files(target), ['manifest.json']);
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'not ours');
  });

  it('refuses without a folder or a version, and a file in the folder\'s place is a failure', () => {
    assert.equal(retireExtension({}).action, 'skipped');
    assert.equal(retireExtension({ targetDir: dir, version: 'dev' }).action, 'skipped');
    const file = path.join(dir, 'a-file');
    fs.writeFileSync(file, 'x');
    assert.equal(retireExtension({ targetDir: file, version: '10.0.0' }).action, 'failed');
  });

  it('the stub text is stable, so a re-run can tell it is current', () => {
    assert.equal(stubManifest({ name: 'X', version: '10.0.0' }), stubManifest({ name: 'X', version: '10.0.0' }));
  });
});

describe('main.js wires the stub', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

  it('neuters the folder on every launch of the print role, with this app\'s version', () => {
    assert.match(main, /extensionSync\.retireExtension\(\{ targetDir: EXTENSION_DIR, version: app\.getVersion\(\) \}\)/);
    const start = main.indexOf('async function startPrintRole(');
    assert.ok(start > 0 && main.indexOf('retireBundledExtension();', start) > start);
  });

  it('restarts Chrome only on the launch that retired a real extension', () => {
    assert.match(main, /extensionState\.action === 'retired'/);
    assert.match(main, /chromeRestart\.restartChrome\(/);
  });

  it('ships no extension and offers no extension folder', () => {
    assert.equal(JSON.stringify(pkg.build.extraResources).includes('chrome-extension'), false);
    assert.equal(main.includes('Open Chrome extension folder'), false);
    assert.equal(main.includes('setExtensionInfo'), false);
    assert.equal(main.includes("'get-extension-info'"), false);
  });
});

// /tools/handbook-form: the unlisted setup aid (site/tools/handbook-form/index.html,
// worker/src/routes.md 10.11). It skips search engines, fetches nothing from another
// host, reads the sync session the settings page saved, calls the Worker's route
// through this site's /api with it, and is linked from nowhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(SITE);
const page = readFileSync(path.join(SITE, 'tools', 'handbook-form', 'index.html'), 'utf8');
const build = readFileSync(path.join(SITE, 'build.mjs'), 'utf8');

test('the page skips search engines and fetches nothing from another host', () => {
  assert.match(page, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(page, /<title>Handbook Form<\/title>/);
  assert.ok(!/https?:\/\//i.test(page), 'no absolute URL');
  assert.ok(!/<script[^>]*\bsrc=/i.test(page), 'no external script');
});

test('it reads the settings page\'s session and calls the route through /api with it', () => {
  const syncService = readFileSync(path.join(ROOT, 'lobby', 'src', 'lib', 'syncService.js'), 'utf8');
  assert.match(syncService, /SYNC_SESSION_STORAGE = 'awanaSyncSession\.v1'/);
  assert.match(page, /'awanaSyncSession\.v1'/);
  assert.match(page, /fetch\('\/api\/v1\/print\/handbook-form'/);
  assert.match(page, /Authorization: 'Bearer ' \+ s/);
  assert.match(page, /Sign in at awana\.kvbchurch\.org\/settings first, then reload this page\./);
});

test('the build publishes it with noindex headers', () => {
  assert.match(build, /cpSync\(path\.join\(ROOT, 'site', 'tools', 'handbook-form', 'index\.html'\)/);
  assert.match(build, /'\/tools\/\*',\s*'  Cache-Control: no-cache',\s*'  X-Robots-Tag: noindex, nofollow',/);
});

test('nothing links to it', () => {
  const skip = new Set(['node_modules', 'dist', '.git', 'test', 'tools']);
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(html|tsx?|jsx?|mjs|md)$/.test(name) && /href="[^"]*tools\/handbook-form/.test(readFileSync(p, 'utf8'))) hits.push(p);
    }
  };
  for (const d of ['site', 'printer', 'lobby/src', 'journey/public', 'classroom/public']) {
    if (existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));
  }
  assert.deepEqual(hits, []);
});

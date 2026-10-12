// /checkin/classic: the relayed phone page exactly as it was on 2026-10-12, kept
// reachable for Wednesday 2026-10-14 only (ROADMAP.md#online-check-in). DELETE this
// test with site/checkin/classic.html and its block in site/build.mjs after 10/14.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// SHA-256 of printer/print-server/public/phone.html at commit 5a8e436 (2026-10-12),
// the page /checkin served before the merge: the copy is never edited.
const FROZEN = 'cfc0a3c3b652f69b19de4b1bb778ed2118144ddbbe5c53db35e9c7cac0e617a4';

test('the classic page is the frozen copy of the old /checkin, unchanged', () => {
  const src = readFileSync(path.join(SITE, 'checkin', 'classic.html'));
  assert.equal(createHash('sha256').update(src).digest('hex'), FROZEN);
});

test('site/build.mjs serves it at /checkin/classic (and /classic/ym), relayed like the old /checkin, with a delete-after date', () => {
  const build = readFileSync(path.join(SITE, 'build.mjs'), 'utf8');
  assert.match(build, /path\.join\(ROOT, 'site', 'checkin', 'classic\.html'\)/);
  assert.match(build, /DELETE after 10\/14/);
  const dist = path.join(SITE, 'dist', 'checkin', 'classic');
  if (!existsSync(dist)) return; // the CI site job builds first; a bare checkout has no dist
  const page = readFileSync(path.join(dist, 'index.html'), 'utf8');
  assert.match(page, /window\.AWANA_RELAY = '\/api'/);
  assert.ok(!page.includes('"/brand/'), 'the kit is the /checkin/brand/ copy');
  const ym = readFileSync(path.join(dist, 'ym', 'index.html'), 'utf8');
  assert.match(ym, /window\.AWANA_ONLY_CLUBS = \['trek', 'journey'\]; window\.AWANA_SIMPLE = true;/);
  // What it loads at run time is still shipped beside the new page.
  for (const f of ['sync-protocol.js', 'cloud-crypto.js', 'brand/fonts.css']) assert.ok(existsSync(path.join(SITE, 'dist', 'checkin', f)), f);
});

// The whole site stays out of search engines (owner, 2026-10-16): robots.txt keeps
// every crawler out of everything, and every response carries noindex, nofollow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = readFileSync(path.join(SITE, 'build.mjs'), 'utf8');

test('the build writes a robots.txt that keeps every crawler out of the whole site', () => {
  assert.match(build, /writeFileSync\(path\.join\(OUT, 'robots\.txt'\), 'User-agent: \*\\nDisallow: \/\\n'\);/);
});

test('every response says noindex, nofollow (the first _headers rule matches every path)', () => {
  assert.match(build, /writeFileSync\(path\.join\(OUT, '_headers'\), \[\s*'\/\*',\s*'  X-Robots-Tag: noindex, nofollow',/);
});

test('a built site has both', { skip: !existsSync(path.join(SITE, 'dist', '_headers')) && 'site/dist is not built' }, () => {
  assert.equal(readFileSync(path.join(SITE, 'dist', 'robots.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n');
  assert.match(readFileSync(path.join(SITE, 'dist', '_headers'), 'utf8'), /^\/\*\n  X-Robots-Tag: noindex, nofollow\n/);
});

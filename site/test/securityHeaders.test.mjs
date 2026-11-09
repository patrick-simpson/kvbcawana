// The site's security headers (2026-11-09; site/lib/securityHeaders.js, written into
// _headers by site/build.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_HEADERS } from '../lib/securityHeaders.js';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(SITE, '..');
const build = readFileSync(path.join(SITE, 'build.mjs'), 'utf8');
const DIST_HEADERS = path.join(SITE, 'dist', '_headers');

/** The header lines of one _headers rule. @param {string} text @param {string} rule */
function ruleLines(text, rule) {
  const lines = text.split('\n');
  const at = lines.indexOf(rule);
  if (at < 0) return null;
  const out = [];
  for (let i = at + 1; i < lines.length && lines[i].startsWith('  '); i += 1) out.push(lines[i].trim());
  return out;
}

test('every path: nosniff, a strict referrer, and framed only by this site', () => {
  assert.deepEqual([...SITE_HEADERS], [
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    "  Content-Security-Policy: frame-ancestors 'self'",
  ]);
  // In the first rule, right after noindex (noindex.test.mjs pins the first line).
  assert.match(build, /'\/\*',\n  '  X-Robots-Tag: noindex, nofollow',\n(?:  \/\/.*\n)*  \.\.\.SITE_HEADERS,\n/);
});

test('every frame on the site shows a page of this same site', () => {
  // Who frames whom: frame-ancestors 'self' must not break any of them.
  const journey = readFileSync(path.join(ROOT, 'journey', 'public', 'index.html'), 'utf8');
  assert.match(journey, /id="checkin-frame"\n\s*src="\.\.\/lobby\/"/);
  const classroom = readFileSync(path.join(ROOT, 'classroom', 'public', 'index.html'), 'utf8');
  assert.match(classroom, /<iframe id="lobby"[^>]*src="\.\.\/lobby\/\?club=sparks"/);
  const twin = readFileSync(path.join(ROOT, 'printer', 'components', 'home', 'Twin.tsx'), 'utf8');
  const src = twin.match(/const SRC: Record<TwinKind, string> = \{([^}]*)\}/);
  assert.ok(src, 'Twin.tsx SRC table');
  const urls = [...src[1].matchAll(/:\s*'([^']*)'/g)].map((m) => m[1]);
  assert.ok(urls.length > 0);
  for (const url of urls) assert.match(url, /^\/[^/]/, `${url} is a path on this site`);
});

test('a built site carries them on every path', { skip: !existsSync(DIST_HEADERS) && 'site/dist is not built' }, () => {
  const all = ruleLines(readFileSync(DIST_HEADERS, 'utf8'), '/*');
  for (const line of SITE_HEADERS) assert.ok(all.includes(line.trim()), line);
});

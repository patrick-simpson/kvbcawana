// The site's security headers (2026-11-09; site/lib/securityHeaders.js, written into
// _headers by site/build.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { SITE_HEADERS, inlineScriptHashes, tvPagePolicy } from '../lib/securityHeaders.js';

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

// The two TV pages that hold the session and show what strangers put up.
const sha = (t) => createHash('sha256').update(t, 'utf8').digest('base64');
const directives = (policy) => Object.fromEntries(policy.split('; ').map((d) => { const [k, ...v] = d.split(' '); return [k, v]; }));

test('the TV pages\' policy names every script source and never allows inline or eval', () => {
  const p = directives(tvPagePolicy({ origin: 'https://awana.kvbchurch.org', scriptHashes: [`'sha256-${sha('x')}'`] }));
  assert.deepEqual(p['script-src'], ["'self'", 'https://cdnjs.cloudflare.com', 'https://www.youtube.com', `'sha256-${sha('x')}'`]);
  assert.deepEqual(p['default-src'], ["'self'"]);
  assert.deepEqual(p['object-src'], ["'none'"]);
  assert.deepEqual(p['base-uri'], ["'none'"]);
  assert.deepEqual(p['frame-ancestors'], ["'self'"]);
  assert.deepEqual(p['worker-src'], ["'self'", 'blob:']);
  assert.deepEqual(p['connect-src'], ["'self'", 'https://awana.kvbchurch.org', 'wss://awana.kvbchurch.org', 'https://cdnjs.cloudflare.com']);
  assert.deepEqual(p['frame-src'], ["'self'", 'https://www.youtube-nocookie.com', 'https://www.youtube.com']);
  assert.ok(!p['script-src'].includes("'unsafe-inline'") && !p['script-src'].includes("'unsafe-eval'"));
  const all = tvPagePolicy({ origin: 'https://awana.kvbchurch.org', facebook: true });
  assert.doesNotMatch(all, /unsafe-eval|connect\.facebook\.net/);
  // Cast alone frames Facebook's plain player.
  assert.deepEqual(directives(all)['frame-src'], ["'self'", 'https://www.youtube-nocookie.com', 'https://www.youtube.com', 'https://www.facebook.com']);
  assert.throws(() => tvPagePolicy({ origin: 'http://awana.kvbchurch.org' }));
  assert.throws(() => tvPagePolicy({ origin: 'https://awana.kvbchurch.org', scriptHashes: ["'unsafe-inline'"] }));
});

test('inline scripts are allowed by their exact fingerprint (the classroom\'s configure-mode line)', () => {
  const html = readFileSync(path.join(ROOT, 'classroom', 'public', 'index.html'), 'utf8');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(inline.length, 1);
  assert.deepEqual(inlineScriptHashes(html, sha), [`'sha256-${sha(inline[0])}'`]);
  assert.deepEqual(inlineScriptHashes('<script type="module" src="a.js"></script><script src="b.js"></script>', sha), []);
});

test('the build gives the classroom and the Cast screen the TV policy', () => {
  assert.match(build, /const CLASSROOM_CSP = tvPolicy\(path\.join\(OUT, 'classroom'\), false\);/);
  assert.match(build, /const CAST_SCREEN_CSP = tvPolicy\(path\.join\(OUT, 'cast', 'screen'\), true\);/);
  assert.match(build, /'\/classroom\/\*',\n(?:  '.*',\n)*  `  Content-Security-Policy: \$\{CLASSROOM_CSP\}`,/);
  assert.match(build, /'\/cast\/screen\/\*',\n  `  Content-Security-Policy: \$\{CAST_SCREEN_CSP\}`,/);
});

test('a built site carries the TV policy with the built pages\' own fingerprints', { skip: !existsSync(DIST_HEADERS) && 'site/dist is not built' }, () => {
  const text = readFileSync(DIST_HEADERS, 'utf8');
  const csp = (rule) => (ruleLines(text, rule) || []).find((l) => l.startsWith('Content-Security-Policy: '))?.slice(25);
  const classroom = csp('/classroom/*');
  const cast = csp('/cast/screen/*');
  assert.ok(classroom && cast);
  const built = readFileSync(path.join(SITE, 'dist', 'classroom', 'index.html'), 'utf8');
  const hashes = inlineScriptHashes(built, sha);
  assert.ok(hashes.length >= 1);
  for (const h of hashes) assert.ok(directives(classroom)['script-src'].includes(h), h);
  assert.ok(!directives(classroom)['frame-src'].includes('https://www.facebook.com'));
  assert.ok(directives(cast)['frame-src'].includes('https://www.facebook.com'));
});

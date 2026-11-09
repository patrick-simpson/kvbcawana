// Cast's own site (owner 2026-11-09): https://cast.kvbchurch.org, the Cloudflare Pages
// project kvbc-cast (site/cast-site/), built by site/build.mjs into site/dist-cast: the
// presenter page at /, the TV page at /screen/, its own headers, and /api through the
// same SYNC binding as the main site. Only /api may invoke a Function (the free plan's
// daily requests: CLAUDE.md "Daily request budget").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { SITE_HEADERS, inlineScriptHashes } from '../lib/securityHeaders.js';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(SITE, '..');
const read = (...p) => readFileSync(path.join(SITE, ...p), 'utf8');
const build = read('build.mjs');
const DIST = path.join(SITE, 'dist-cast');
const built = existsSync(path.join(DIST, '_headers'));

/** The header lines of one _headers rule. @param {string} text @param {string} rule */
function ruleLines(text, rule) {
  const lines = text.split('\n');
  const at = lines.indexOf(rule);
  if (at < 0) return null;
  const out = [];
  for (let i = at + 1; i < lines.length && lines[i].startsWith('  '); i += 1) out.push(lines[i].trim());
  return out;
}
const directives = (policy) => Object.fromEntries(policy.split('; ').map((d) => { const [k, ...v] = d.split(' '); return [k, v]; }));

test('the project: kvbc-cast, published from dist-cast, /api through the SYNC binding', () => {
  const toml = read('cast-site', 'wrangler.toml');
  assert.match(toml, /^name = "kvbc-cast"$/m);
  assert.match(toml, /^pages_build_output_dir = "\.\.\/dist-cast"$/m);
  assert.match(toml, /\[\[services\]\]\nbinding = "SYNC"\nservice = "awana-sync"/);
  // The main site's binding is the same Worker.
  assert.match(read('wrangler.toml'), /\[\[services\]\]\nbinding = "SYNC"\nservice = "awana-sync"/);
  // One Function, the main site's proxy reused (never a second copy to drift).
  const fn = read('cast-site', 'functions', 'api', '[[path]].js');
  assert.match(fn, /export \{ onRequest \} from '\.\.\/\.\.\/\.\.\/functions\/api\/\[\[path\]\]\.js';/);
  const functions = readdirSync(path.join(SITE, 'cast-site', 'functions'), { recursive: true }).map(String).filter((f) => f.endsWith('.js'));
  assert.deepEqual(functions, [path.join('api', '[[path]].js')]);
});

test('the build writes dist-cast with the Cast pages at its root', () => {
  assert.match(build, /const CAST_ORIGIN = 'https:\/\/cast\.kvbchurch\.org';/);
  assert.match(build, /const CAST_OUT = path\.join\(ROOT, 'site', 'dist-cast'\);/);
  assert.match(build, /const out = CAST_OUT;/);
  assert.ok(!/path\.join\(OUT, 'cast'\)/.test(build), 'the main site builds no /cast copy');
  assert.match(build, /origin: CAST_ORIGIN,\n  facebook: true,/);
  assert.match(build, /'\/screen\/\*',\n(?:  '.*',\n)*  `  Content-Security-Policy: \$\{CAST_TV_CSP\}`,/);
  assert.match(build, /include: \['\/api', '\/api\/\*'\], exclude: \[\]/);
  // The desk (owner 2026-11-09): its own copy and policy.
  assert.match(build, /for \(const f of \['index\.html', 'desk\.js'\]\) cpSync\(path\.join\(src, 'desk', f\), path\.join\(out, 'desk', f\)\);/);
  assert.match(build, /'\/desk\/\*',\n(?:  '.*',\n)*  `  Content-Security-Policy: \$\{CAST_DESK_CSP\}`,/);
});

test('a built Cast site: the pages at / and /screen/, nothing of the main site', { skip: !built && 'site/dist-cast is not built' }, () => {
  for (const f of ['index.html', 'app.js', 'controls.js', 'logic.js', 'preview.js', 'qr.js', 'desk/index.html', 'desk/desk.js', 'shared/classroomRemote.js', 'shared/screenShare.js', 'screen/index.html', 'screen/screen.js', 'church/church.css', 'church/kvbc-logo.png', 'church/fonts/Jost-Variable.ttf', 'robots.txt']) {
    assert.ok(existsSync(path.join(DIST, f)), f);
  }
  for (const f of ['lobby', 'cast', 'journey', 'checkin', 'classroom']) assert.ok(!existsSync(path.join(DIST, f)), `${f} is the main site's`);
  assert.equal(readFileSync(path.join(DIST, 'screen', 'screen.js'), 'utf8'), read('cast', 'screen', 'screen.js'));
  assert.equal(readFileSync(path.join(DIST, 'shared', 'screenShare.js'), 'utf8'), readFileSync(path.join(ROOT, 'shared', 'screenShare.js'), 'utf8'));
  assert.equal(readFileSync(path.join(DIST, 'robots.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n');
});

test('a built Cast site: only /api invokes a Function', { skip: !built && 'site/dist-cast is not built' }, () => {
  assert.deepEqual(JSON.parse(readFileSync(path.join(DIST, '_routes.json'), 'utf8')), { version: 1, include: ['/api', '/api/*'], exclude: [] });
  assert.equal(readFileSync(path.join(DIST, '_redirects'), 'utf8'), '/cast / 301\n/cast/* /:splat 301\n');
});

test('a built Cast site: noindex and the security headers everywhere, the TV policy on /screen/*', { skip: !built && 'site/dist-cast is not built' }, () => {
  const text = readFileSync(path.join(DIST, '_headers'), 'utf8');
  const all = ruleLines(text, '/*');
  assert.equal(all[0], 'X-Robots-Tag: noindex, nofollow');
  for (const line of SITE_HEADERS) assert.ok(all.includes(line.trim()), line);
  const tv = ruleLines(text, '/screen/*');
  const csp = tv.find((l) => l.startsWith('Content-Security-Policy: ')).slice(25);
  const d = directives(csp);
  assert.ok(!d['script-src'].includes("'unsafe-inline'") && !d['script-src'].includes("'unsafe-eval'"));
  assert.deepEqual(d['connect-src'], ["'self'", 'https://cast.kvbchurch.org', 'wss://cast.kvbchurch.org', 'https://cdnjs.cloudflare.com']);
  assert.ok(d['frame-src'].includes('https://www.facebook.com'));
  assert.deepEqual(d['frame-ancestors'], ["'self'"]);
  // Every inline script of the built TV page is allowed by its fingerprint.
  const sha = (t) => createHash('sha256').update(t, 'utf8').digest('base64');
  for (const h of inlineScriptHashes(readFileSync(path.join(DIST, 'screen', 'index.html'), 'utf8'), sha)) assert.ok(d['script-src'].includes(h), h);
});

test('a built Cast site: the desk has the script-limiting policy, YouTube thumbnails, no Facebook', { skip: !built && 'site/dist-cast is not built' }, () => {
  const text = readFileSync(path.join(DIST, '_headers'), 'utf8');
  const csp = ruleLines(text, '/desk/*').find((l) => l.startsWith('Content-Security-Policy: ')).slice(25);
  const d = directives(csp);
  assert.ok(!d['script-src'].includes("'unsafe-inline'") && !d['script-src'].includes("'unsafe-eval'"));
  assert.deepEqual(d['img-src'], ["'self'", 'data:', 'blob:', 'https://i.ytimg.com']);
  assert.ok(!d['frame-src'].includes('https://www.facebook.com'));
  assert.deepEqual(d['connect-src'], ["'self'", 'https://cast.kvbchurch.org', 'wss://cast.kvbchurch.org', 'https://cdnjs.cloudflare.com']);
  // The TV's own policy names no YouTube thumbnails.
  const tv = directives(ruleLines(text, '/screen/*').find((l) => l.startsWith('Content-Security-Policy: ')).slice(25));
  assert.deepEqual(tv['img-src'], ["'self'", 'data:', 'blob:']);
});

#!/usr/bin/env node
// Builds the one site into site/dist:
//
//   /            the Club Label Printer's public site (printer/, built at base /)
//   /lobby/      the lobby signage (lobby/ build; countdown.html is the projector)
//   /projector   a redirect to /lobby/countdown.html
//   /journey/    the Journey kiosk (journey/public, build-stamped)
//   /api/*       the sync Worker, through site/functions (not built here)
//
// Each app is built exactly as its own deploy built it, so nothing inside an
// app changes for being here; only where it lands. SITE_ORIGIN (a repository
// variable; https://kvbcawana.pages.dev until switch day, then
// https://awana.kvbchurch.org) is written into the lobby's shared/sync.json so
// the screens find the Worker at their own /api.
//
// Usage: node site/build.mjs   (after npm ci in lobby/ and printer/)
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'site', 'dist');
const ORIGIN = (process.env.SITE_ORIGIN || 'https://kvbcawana.pages.dev').replace(/\/+$/, '');
const BUILD_ID = process.env.GITHUB_SHA || execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();

if (!/^https:\/\/[a-z0-9.-]+$/i.test(ORIGIN)) throw new Error(`SITE_ORIGIN must be an https origin, got ${ORIGIN}`);

const run = (cmd, cwd, env = {}) => {
  console.log(`\n$ (${path.relative(ROOT, cwd) || '.'}) ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// The printer's public site at the root.
run('npm run build', path.join(ROOT, 'printer'), { SITE_BASE: '/' });
cpSync(path.join(ROOT, 'printer', 'dist'), OUT, { recursive: true });

// The lobby and the projector.
run('npm run build', path.join(ROOT, 'lobby'));
cpSync(path.join(ROOT, 'lobby', 'dist'), path.join(OUT, 'lobby'), { recursive: true });
writeFileSync(path.join(OUT, 'lobby', 'shared', 'sync.json'), `${JSON.stringify({ url: `${ORIGIN}/api` }, null, 2)}\n`);

// Journey: its static public/, stamped like its own deploy stamps it.
const journeyOut = path.join(OUT, 'journey');
cpSync(path.join(ROOT, 'journey', 'public'), journeyOut, { recursive: true });
run(`node scripts/stamp-build.mjs ${BUILD_ID} ${JSON.stringify(journeyOut)}`, path.join(ROOT, 'journey'));

// Pretty addresses, and HTML / JSON never cached at the edge, so a deploy
// and a calendar change reach the screens at once (Cloudflare Pages honours
// _headers; the apps' service workers already go network-first for both).
writeFileSync(path.join(OUT, '_redirects'), [
  // Pages serves foo.html at /foo (and 308s the .html form there).
  '/projector /lobby/countdown 302',
  '/projector/ /lobby/countdown 302',
  '',
].join('\n'));
writeFileSync(path.join(OUT, '_headers'), [
  '/*.html',
  '  Cache-Control: no-cache',
  '/*.json',
  '  Cache-Control: no-cache',
  '/',
  '  Cache-Control: no-cache',
  '/lobby/',
  '  Cache-Control: no-cache',
  '/journey/',
  '  Cache-Control: no-cache',
  '',
].join('\n'));

for (const must of ['index.html', 'lobby/index.html', 'lobby/countdown.html', 'journey/index.html', 'lobby/shared/sync.json']) {
  if (!existsSync(path.join(OUT, must))) throw new Error(`site build is missing ${must}`);
}
console.log(`\n✓ site/dist built for ${ORIGIN} (build ${BUILD_ID.slice(0, 7)})`);

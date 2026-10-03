#!/usr/bin/env node
// Builds the one site into site/dist:
//
//   /            the Club Label Printer's public site (printer/, built at base /)
//   /lobby/      the lobby signage (lobby/ build; countdown.html is the projector)
//   /projector   a redirect to /lobby/countdown.html
//   /journey/    the Journey kiosk (journey/public, build-stamped)
//   /checkin     the phone check-in, online (the print app's phone page, relayed)
//   /api/*       the sync Worker, through site/functions (not built here)
//
// Each app is built exactly as its own deploy built it, so nothing inside an
// app changes for being here; only where it lands. SITE_ORIGIN (a repository
// variable; https://kvbcawana.pages.dev until switch day, then
// https://awana.kvbchurch.org) is written into the lobby's shared/sync.json so
// the screens find the Worker at their own /api.
//
// Usage: node site/build.mjs   (after npm ci in lobby/ and printer/)
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

// The phone check-in, online (printer 7.9.0): the print app's own phone page,
// with its brand kit beside it, signed in with the sync passphrase and every
// call relayed to the check-in laptop through /api (lobby/worker/src/relay.js).
// It carries no roster: names arrive only through the relay, from the laptop.
{
  const checkinOut = path.join(OUT, 'checkin');
  const PHONE_PUBLIC = path.join(ROOT, 'printer', 'print-server', 'public');
  mkdirSync(checkinOut, { recursive: true });
  cpSync(path.join(PHONE_PUBLIC, 'brand'), path.join(checkinOut, 'brand'), { recursive: true });
  const page = readFileSync(path.join(PHONE_PUBLIC, 'phone.html'), 'utf8');
  const online = page
    .replaceAll('"/brand/', '"/checkin/brand/')
    .replace('<script>\n// ── The touch check-in', `<script>window.AWANA_RELAY = '/api';</script>\n<script>\n// ── The touch check-in`);
  if (online === page || !online.includes("window.AWANA_RELAY = '/api'") || online.includes('"/brand/')) {
    throw new Error('site/build.mjs: phone.html no longer has the shape /checkin expects');
  }
  writeFileSync(path.join(checkinOut, 'index.html'), online);
  // The youth leaders' page (7.10.0): Trek and Journey only, check-in only.
  const ym = online.replace("<script>window.AWANA_RELAY = '/api';</script>\n",
    "<script>window.AWANA_RELAY = '/api';</script>\n<script>window.AWANA_ONLY_CLUBS = ['trek', 'journey']; window.AWANA_SIMPLE = true;</script>\n");
  if (ym === online) throw new Error('site/build.mjs: could not mark /checkin/ym');
  mkdirSync(path.join(checkinOut, 'ym'), { recursive: true });
  writeFileSync(path.join(checkinOut, 'ym', 'index.html'), ym);
}

// The Electron apps' auto-update feeds (site/updates/printer/latest.yml and
// site/updates/lobby/lobby.yml), written by the release workflows. Always
// present, so a missing feed is a 404 rather than a build failure.
mkdirSync(path.join(ROOT, 'site', 'updates'), { recursive: true });
cpSync(path.join(ROOT, 'site', 'updates'), path.join(OUT, 'updates'), { recursive: true });

// Pretty addresses, and HTML / JSON never cached at the edge, so a deploy
// and a calendar change reach the screens at once (Cloudflare Pages honours
// _headers; the apps' service workers already go network-first for both).
// Stable download links (the Install Guide, the extension popup, the sound
// room card): the newest installer each update feed names, else the releases
// page until the first release from this repo.
const RELEASES = 'https://github.com/patrick-simpson/kvbcawana/releases';
const newestInstaller = (feed) => {
  const file = path.join(ROOT, 'site', 'updates', feed);
  if (!existsSync(file)) return RELEASES;
  const m = /^\s*(?:-\s+)?url:\s*(https:\/\/\S+\.exe)\s*$/m.exec(readFileSync(file, 'utf8'));
  return m ? m[1] : RELEASES;
};
writeFileSync(path.join(OUT, '_redirects'), [
  `/download/club-label-printer ${newestInstaller('printer/latest.yml')} 302`,
  `/download/lobby-display ${newestInstaller('lobby/lobby.yml')} 302`,
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
  '/updates/*',
  '  Cache-Control: no-cache',
  '',
].join('\n'));

// Videos are never uploaded to Pages, whose static files ignore Range requests
// (measured 2026-10-03: every request answered 200 with the whole file), so a
// <video> could not seek or resume mid-lesson. site/functions/journey/[[path]].js
// streams them instead, on this origin, with Range passed through:
//   /journey/videos/<file>.mp4  the picker's lesson videos, from the
//                               journey-videos-v2 release (pi-encode.mjs keeps
//                               every one under 25 MiB);
//   any other journey/public .mp4, and any file over Pages' 25 MiB limit,
//                               from GitHub's copy of THIS commit, so it always
//                               matches the files deployed beside it.
// Only files committed under journey/public can be served that way; anything
// else that big is a build output, and fails the build rather than the deploy.
const REPO = process.env.GITHUB_REPOSITORY || 'patrick-simpson/kvbcawana';
const VIDEO_PREFIXES = { '/journey/videos/': `https://github.com/${REPO}/releases/download/journey-videos-v2/` };
const PAGES_FILE_MAX = 25 * 1024 * 1024;
const largeFiles = {};
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
for (const file of walk(OUT)) {
  if (statSync(file).size < PAGES_FILE_MAX && !file.endsWith('.mp4')) continue;
  const sitePath = '/' + path.relative(OUT, file).split(path.sep).join('/');
  if (!sitePath.startsWith('/journey/')) throw new Error(`${sitePath} is over 25 MiB, and only journey/public files can be served from the repo`);
  const repoPath = `journey/public/${sitePath.slice('/journey/'.length)}`;
  if (!existsSync(path.join(ROOT, repoPath))) throw new Error(`${sitePath} is over 25 MiB and is not a file in the repo`);
  largeFiles[sitePath] = `https://raw.githubusercontent.com/${REPO}/${BUILD_ID}/${repoPath}`;
  rmSync(file);
  console.log(`  ${sitePath} (${(statSync(path.join(ROOT, repoPath)).size / 1048576).toFixed(1)} MiB): streamed from the repo, not uploaded`);
}
writeFileSync(path.join(ROOT, 'site', 'lib', 'large-files.generated.js'),
  `// Written by site/build.mjs for build ${BUILD_ID}; not committed.\nexport const LARGE_FILES = ${JSON.stringify(largeFiles, null, 2)};\nexport const LARGE_PREFIXES = ${JSON.stringify(VIDEO_PREFIXES, null, 2)};\n`);

for (const must of ['index.html', 'lobby/index.html', 'lobby/countdown.html', 'journey/index.html', 'lobby/shared/sync.json']) {
  if (!existsSync(path.join(OUT, must))) throw new Error(`site build is missing ${must}`);
}
console.log(`\n✓ site/dist built for ${ORIGIN} (build ${BUILD_ID.slice(0, 7)})`);

#!/usr/bin/env node
// Builds the one site into site/dist:
//
//   /            the family's one public page (printer/, built at base /): the
//                label printer, the lobby signage (#lobby) and the Journey kiosk (#journey)
//   /reel/       that page's film (printer/public/reel; its videos are streamed
//                by site/functions/reel, see "Videos" below)
//   /lobby/      the lobby signage (lobby/ build; countdown.html is the projector)
//   /settings    a redirect to /lobby/settings.html, one settings page (ROADMAP.md#settings-page)
//   /journey/    the Journey kiosk (journey/public, build-stamped)
//   /checkin     the phone check-in, online (the print app's phone page, relayed)
//   /desk        the desk check-in (site/desk/; ROADMAP.md#online-check-in P3): its own
//                page and transport, the touch check-in's search injected, every seal
//                made in the browser (lobby/shared/cloud-crypto.js is copied beside it)
//   /api/*       the sync Worker, through site/functions (not built here)
//
// Each app is built exactly as its own deploy built it, so nothing inside an
// app changes for being here; only where it lands. SITE_ORIGIN (a repository
// variable; https://kvbcawana.pages.dev until switch day, then
// https://awana.kvbchurch.org) is written into the lobby's shared/sync.json so
// the screens find the Worker at their own /api.
//
// Usage: node site/build.mjs   (after npm ci in lobby/ and printer/)
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadRedirects } from './lib/downloads.js';
import { REPO_FOLDERS, mustStream, repoPathFor } from './lib/largeFiles.js';
import { pageRedirects } from './lib/redirects.js';
import { buildDeskPage } from './desk/desk-page.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'site', 'dist');

// A 40-hex id for a folder: every file's path and bytes, in sorted order (the
// shape of a commit SHA, which is what stamp-build.mjs and the kiosk's poll
// expect). Generated files that are never committed are left out so a build
// of the same sources is the same id.
function hashTree(dir) {
  const h = createHash('sha1');
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (name === 'version.json') continue;
      h.update(path.relative(dir, p)).update('\0').update(readFileSync(p)).update('\0');
    }
  };
  walk(dir);
  return h.digest('hex');
}
const ORIGIN = (process.env.SITE_ORIGIN || 'https://kvbcawana.pages.dev').replace(/\/+$/, '');
const BUILD_ID = process.env.GITHUB_SHA || execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();

if (!/^https:\/\/[a-z0-9.-]+$/i.test(ORIGIN)) throw new Error(`SITE_ORIGIN must be an https origin, got ${ORIGIN}`);

const run = (cmd, cwd, env = {}) => {
  console.log(`\n$ (${path.relative(ROOT, cwd) || '.'}) ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// The brand kit and the sync modules have one canonical copy each; the apps get theirs
// here (Journey's public/brand and public/src/shared, the print server's public/brand
// for /checkin) before anything below reads them.
// Journey's build id (hashTree below) covers them, so a kit change reloads the kiosks.
run('node scripts/family-assets.mjs all', ROOT);

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
// Journey's build id is a hash of ITS OWN files, not the monorepo commit: the
// kiosk reloads itself when its build id changes, and stamped with the commit
// every push to any app (the nightly bots' feed commits included) reloaded
// every idle kiosk and dropped the embedded lobby's socket for nothing.
const journeyBuild = hashTree(path.join(ROOT, 'journey', 'public'));
run(`node scripts/stamp-build.mjs ${journeyBuild} ${JSON.stringify(journeyOut)}`, path.join(ROOT, 'journey'));

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
  // Passphrase v2: the page signs in with an authKey it derives itself (the canonical shared modules, byte for byte).
  for (const f of ['sync-protocol.js', 'cloud-crypto.js']) cpSync(path.join(ROOT, 'lobby', 'shared', f), path.join(checkinOut, f));
  // The youth leaders' page (7.10.0): Trek and Journey only, check-in only.
  const ym = online.replace("<script>window.AWANA_RELAY = '/api';</script>\n",
    "<script>window.AWANA_RELAY = '/api';</script>\n<script>window.AWANA_ONLY_CLUBS = ['trek', 'journey']; window.AWANA_SIMPLE = true;</script>\n");
  if (ym === online) throw new Error('site/build.mjs: could not mark /checkin/ym');
  mkdirSync(path.join(checkinOut, 'ym'), { recursive: true });
  writeFileSync(path.join(checkinOut, 'ym', 'index.html'), ym);
}

// /checkin/classic (and /checkin/classic/ym): the relayed phone page exactly as it
// was on 2026-10-12, a frozen copy (site/checkin/classic.html, byte for byte that
// day's printer/print-server/public/phone.html) made into a page the same way
// /checkin was. A fallback for Wednesday 2026-10-14 ONLY: DELETE after 10/14
// (this block, site/checkin/classic.html and its test; ROADMAP.md#online-check-in).
{
  const classicOut = path.join(OUT, 'checkin', 'classic');
  const page = readFileSync(path.join(ROOT, 'site', 'checkin', 'classic.html'), 'utf8');
  const online = page
    .replaceAll('"/brand/', '"/checkin/brand/')
    .replace('<script>\n// ── The touch check-in', `<script>window.AWANA_RELAY = '/api';</script>\n<script>\n// ── The touch check-in`);
  const ym = online.replace("<script>window.AWANA_RELAY = '/api';</script>\n",
    "<script>window.AWANA_RELAY = '/api';</script>\n<script>window.AWANA_ONLY_CLUBS = ['trek', 'journey']; window.AWANA_SIMPLE = true;</script>\n");
  if (online === page || ym === online || online.includes('"/brand/')) throw new Error('site/build.mjs: site/checkin/classic.html lost its shape');
  mkdirSync(path.join(classicOut, 'ym'), { recursive: true });
  writeFileSync(path.join(classicOut, 'index.html'), online);
  writeFileSync(path.join(classicOut, 'ym', 'index.html'), ym);
}

// The desk check-in (ROADMAP.md#online-check-in P3): site/desk/ is the page and its
// transport, the touch check-in's search and family grouping come from the print
// app's phone page (desk-page.mjs), and the cloud crypto is the canonical
// lobby/shared/cloud-crypto.js, copied beside it (the lobby build ships no .js from
// shared/). The brand kit is the lobby's, already at /lobby/shared/brand. No /desk/ym:
// the youth leaders check in on /checkin/ym, and a Trek/Journey-only desk would be
// a filter on this page, not a second page, when it is wanted.
{
  const deskOut = path.join(OUT, 'desk');
  mkdirSync(deskOut, { recursive: true });
  writeFileSync(path.join(deskOut, 'index.html'), buildDeskPage());
  cpSync(path.join(ROOT, 'site', 'desk', 'desk.js'), path.join(deskOut, 'desk.js'));
  cpSync(path.join(ROOT, 'site', 'checkin', 'desk-transport.js'), path.join(deskOut, 'desk-transport.js'));
  cpSync(path.join(ROOT, 'lobby', 'shared', 'cloud-crypto.js'), path.join(deskOut, 'cloud-crypto.js'));
  if (!existsSync(path.join(OUT, 'lobby', 'shared', 'brand', 'fonts.css'))) throw new Error('site/build.mjs: /desk reads the lobby brand kit, which is missing');
}

// The Electron apps' auto-update feeds (site/updates/printer/latest.yml and
// site/updates/lobby/lobby.yml), written by the release workflows. Always
// present, so a missing feed is a 404 rather than a build failure.
mkdirSync(path.join(ROOT, 'site', 'updates'), { recursive: true });
cpSync(path.join(ROOT, 'site', 'updates'), path.join(OUT, 'updates'), { recursive: true });

// The Club Label Printer's release notes, for the lobby's Settings → Setup →
// Release notes (owner, 2026-10-11): printer/changes.md as it is.
mkdirSync(path.join(OUT, 'release-notes'), { recursive: true });
cpSync(path.join(ROOT, 'printer', 'changes.md'), path.join(OUT, 'release-notes', 'printer.md'));

// Pretty addresses, and HTML / JSON never cached at the edge, so a deploy
// and a calendar change reach the screens at once (Cloudflare Pages honours
// _headers; the apps' service workers already go network-first for both).
// Stable download links (the Install Guide, the extension popup, the
// signage's KVBC Awana card): the newest installer each update feed names,
// else the releases page until the first release from this repo
// (site/lib/downloads.js; /download/kvbc-awana and /download/club-label-printer
// are the same app since 9.0.0).
const RELEASES = 'https://github.com/patrick-simpson/kvbcawana/releases';
const readFeed = (feed) => {
  const file = path.join(ROOT, 'site', 'updates', feed);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};
writeFileSync(path.join(OUT, '_redirects'), [
  ...downloadRedirects(readFeed, RELEASES),
  // The lobby's and Journey's about pages are sections of the home page now.
  ...pageRedirects(),
  // Pages serves foo.html at /foo (and 308s the .html form there).
  // The one settings page for every screen (ROADMAP.md#settings-page).
  '/settings /lobby/settings 302',
  '/settings/ /lobby/settings 302',
  '',
].join('\n'));
writeFileSync(path.join(OUT, '_headers'), [
  // Vite names every built asset by its content hash (main-DVTDSuLn.js), so a
  // changed file is a new URL and the old one can be kept for good. Pages'
  // default for them was max-age=0: every TV revalidated every script and
  // font on every load. Journey's files are not hashed (they carry ?v=) and
  // keep the default.
  '/assets/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '/lobby/assets/*',
  '  Cache-Control: public, max-age=31536000, immutable',
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
  '/desk/*',
  '  Cache-Control: no-cache',
  '/updates/*',
  '  Cache-Control: no-cache',
  '/release-notes/*',
  '  Content-Type: text/markdown; charset=utf-8',
  '  Cache-Control: no-cache',
  '',
].join('\n'));

// Videos are never uploaded to Pages, whose static files ignore Range requests
// (measured 2026-10-03: every request answered 200 with the whole file), so a
// <video> could not seek or resume mid-lesson (and Safari will not play one at
// all). Functions stream them instead, on this origin, with Range passed through
// (site/lib/largeFiles.js says which, site/lib/proxyLarge.js how):
//   /journey/videos/<file>.mp4  the picker's lesson videos, from the
//                               journey-videos-v2 release (pi-encode.mjs keeps
//                               every one under 25 MiB; functions/journey);
//   any other journey/public video, the home page's film under /reel/
//   (printer/public/reel, functions/reel), and any file over Pages' 25 MiB
//   limit, from GitHub's copy of THIS commit, so it always matches the files
//   deployed beside it.
// Only files committed under those folders can be served that way; anything
// else that big is a build output, and fails the build rather than the deploy.
const REPO = process.env.GITHUB_REPOSITORY || 'patrick-simpson/kvbcawana';
const VIDEO_PREFIXES = { '/journey/videos/': `https://github.com/${REPO}/releases/download/journey-videos-v2/` };
const largeFiles = {};
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
for (const file of walk(OUT)) {
  const sitePath = '/' + path.relative(OUT, file).split(path.sep).join('/');
  if (!mustStream(sitePath, statSync(file).size)) continue;
  const repoPath = repoPathFor(sitePath);
  if (!repoPath) throw new Error(`${sitePath} is a video or over 25 MiB, and only files committed under ${Object.values(REPO_FOLDERS).join(' or ')} can be served from the repo`);
  if (!existsSync(path.join(ROOT, repoPath))) throw new Error(`${sitePath} is a video or over 25 MiB and is not a file in the repo (${repoPath})`);
  largeFiles[sitePath] = `https://raw.githubusercontent.com/${REPO}/${BUILD_ID}/${repoPath}`;
  rmSync(file);
  console.log(`  ${sitePath} (${(statSync(path.join(ROOT, repoPath)).size / 1048576).toFixed(1)} MiB): streamed from the repo, not uploaded`);
}
// Pages invokes a Function for every request under a folder that has one
// (functions/journey, functions/api) unless _routes.json says otherwise, so
// without it every static Journey request (the page, its scripts, the brand
// kit, schedule.json) went through the Function and fell through to the file:
// an invocation counted against the daily quota and a hop added to a kiosk on
// a Pi, for nothing. Only the paths a Function actually answers are routed to
// one: the sync Worker under /api, the lesson videos, and the large files
// streamed from the repo. Everything else is a plain static file.
writeFileSync(path.join(OUT, '_routes.json'), `${JSON.stringify({
  version: 1,
  include: ['/api', '/api/*', ...Object.keys(VIDEO_PREFIXES).map((p) => `${p}*`), ...Object.keys(largeFiles).sort()],
  exclude: [],
}, null, 2)}\n`);
writeFileSync(path.join(ROOT, 'site', 'lib', 'large-files.generated.js'),
  `// Written by site/build.mjs for build ${BUILD_ID}; not committed.\nexport const LARGE_FILES = ${JSON.stringify(largeFiles, null, 2)};\nexport const LARGE_PREFIXES = ${JSON.stringify(VIDEO_PREFIXES, null, 2)};\n`);

for (const must of ['index.html', 'lobby/index.html', 'lobby/countdown.html', 'lobby/settings.html', 'journey/index.html', 'lobby/shared/sync.json', 'desk/index.html', 'desk/desk.js', 'desk/desk-transport.js', 'desk/cloud-crypto.js', 'checkin/sync-protocol.js', 'checkin/cloud-crypto.js', 'checkin/classic/index.html', 'checkin/classic/ym/index.html']) {
  if (!existsSync(path.join(OUT, must))) throw new Error(`site build is missing ${must}`);
}
console.log(`\n✓ site/dist built for ${ORIGIN} (build ${BUILD_ID.slice(0, 7)})`);

#!/usr/bin/env node
// The family's shared files, checked in one place.
//
//   contract / envelope vectors   ONE copy each, printer/*.json: the lobby's tests read
//                                 them in place (the lobby mirrors went 2026-10-16)
//   shared modules                shared/*.js (the sync protocol and the cloud crypto
//                                 among them)  ->  generated CommonJS copies for the packaged
//                                 Windows app (scripts/shared-copies.mjs lists them; committed,
//                                 checked for drift). The cloud crypto's vectors,
//                                 shared/cloud-vectors.json, have ONE copy: the printer's
//                                 test reads it in place.
//
//   the brand kit                 canonical shared/brand/
//                                 NOT mirrored in git any more: each app gets its own copy at
//                                 build time (scripts/family-assets.mjs), so every screen still
//                                 holds a full local copy at runtime. Here: the copies exist and
//                                 match, git ignores them and tracks none, and every consumer's
//                                 build still makes them.
//
// Run `node scripts/family-assets.mjs` first when the copies have not been made.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAssets, COPIES } from './family-assets.mjs';
import { drift as sharedDrift } from './shared-copies.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const problems = [];

// The generated copies exist and match the canonical files.
problems.push(...checkAssets(Object.keys(COPIES)));

// ...are ignored, and git tracks none of them.
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
for (const { kit } of Object.values(COPIES)) {
  if (!kit) continue;
  const tracked = git('ls-files', '--', kit);
  if (tracked) problems.push(`${kit} is generated, but git tracks ${tracked.split('\n').length} file(s) in it (git rm --cached; it is in .gitignore)`);
  try { git('check-ignore', '-q', `${kit}/tokens.css`); }
  catch { problems.push(`${kit} is not gitignored`); }
}

// ...and every consumer's build makes them first.
const pkgStep = (file, script, app) => {
  const cmd = JSON.parse(readFileSync(path.join(ROOT, file), 'utf8')).scripts?.[script] ?? '';
  if (!cmd.includes(`family-assets.mjs ${app}`)) problems.push(`${file} script "${script}" does not run scripts/family-assets.mjs ${app}`);
};
const textStep = (file, re, what) => {
  if (!re.test(readFileSync(path.join(ROOT, file), 'utf8'))) problems.push(`${file} no longer ${what}`);
};
pkgStep('journey/package.json', 'pretest', 'journey');
pkgStep('printer/package.json', 'pretest', 'printer');
pkgStep('printer/electron-app/package.json', 'prebuild:renderer', 'printer');
pkgStep('printer/electron-app/package.json', 'predev', 'printer');
pkgStep('printer/electron-app/package.json', 'pretest', 'printer');
pkgStep('printer/print-server/package.json', 'prestart', 'printer');
textStep('site/build.mjs', /family-assets\.mjs all/, 'makes the family copies before it builds');
textStep('.github/workflows/release-app.yml', /family-assets\.mjs printer/, 'makes the brand kit copy before the printer installer is built');
textStep('.github/workflows/ci.yml', /family-assets\.mjs/, 'runs the copy step in the copies job');

// The committed CommonJS copies (sync protocol and cloud crypto among them) are
// compared with what the generator would write now, not byte for byte with the source.
for (const d of sharedDrift()) problems.push(`${d.dest} differs from what ${d.src} generates (run node scripts/family-assets.mjs)`);

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  console.error('Brand kit and every generated copy: change the canonical file, then run node scripts/family-assets.mjs.');
  process.exit(1);
}
console.log('✓ the brand kit copies are generated, ignored and match their canonical files; the generated shared-module copies match shared');

#!/usr/bin/env node
// The family's shared files, checked in one place.
//
//   contract / envelope vectors   printer/  ->  lobby/src/lib/__fixtures__/
//                                 still committed, byte-identical mirrors (canonical first)
//
//   shared modules                lobby/shared/*.js  ->  generated copies for the packaged apps
//                                 (scripts/shared-copies.mjs lists them; committed, checked for drift)
//
//   the brand kit                 canonical lobby/shared/brand/
//   family.css                    canonical printer/styles/family.css
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
function same(canonical, copy) {
  const a = path.join(ROOT, canonical);
  const b = path.join(ROOT, copy);
  if (!existsSync(b)) { problems.push(`${copy} is missing (canonical: ${canonical})`); return; }
  if (!readFileSync(a).equals(readFileSync(b))) problems.push(`${copy} differs from ${canonical}`);
}

same('printer/contract-vectors.json', 'lobby/src/lib/__fixtures__/contract-vectors.json');
same('printer/envelope-vectors.json', 'lobby/src/lib/__fixtures__/envelope-vectors.json');

// The generated copies exist and match the canonical files.
problems.push(...checkAssets(Object.keys(COPIES)));

// ...are ignored, and git tracks none of them.
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
for (const { kit, css } of Object.values(COPIES)) {
  for (const p of [kit, css].filter(Boolean)) {
    const tracked = git('ls-files', '--', p);
    if (tracked) problems.push(`${p} is generated, but git tracks ${tracked.split('\n').length} file(s) in it (git rm --cached; it is in .gitignore)`);
    try { git('check-ignore', '-q', p.endsWith('.css') ? p : `${p}/tokens.css`); }
    catch { problems.push(`${p} is not gitignored`); }
  }
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
pkgStep('lobby/package.json', 'prebuild', 'lobby');
pkgStep('lobby/package.json', 'predev', 'lobby');
pkgStep('printer/package.json', 'pretest', 'printer');
pkgStep('printer/electron-app/package.json', 'prebuild:renderer', 'printer');
pkgStep('printer/electron-app/package.json', 'predev', 'printer');
pkgStep('printer/electron-app/package.json', 'pretest', 'printer');
pkgStep('printer/print-server/package.json', 'prestart', 'printer');
textStep('site/build.mjs', /family-assets\.mjs all/, 'makes the family copies before it builds');
textStep('.github/workflows/release-app.yml', /family-assets\.mjs printer/, 'makes the brand kit copy before the printer installer is built');
textStep('.github/workflows/ci.yml', /family-assets\.mjs/, 'runs the copy step in the copies job');

for (const d of sharedDrift()) problems.push(`${d.dest} differs from what ${d.src} generates (run node scripts/shared-copies.mjs)`);

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  console.error('Vectors: change the canonical file, then copy it over the other (never the other way round).');
  console.error('Brand kit and family.css: change the canonical file, then run node scripts/family-assets.mjs.');
  process.exit(1);
}
console.log('✓ contract and envelope vectors match; the brand kit and family.css copies are generated, ignored and match their canonical files; the generated shared-module copies match lobby/shared');

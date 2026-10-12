#!/usr/bin/env node
// The family's shared files, kept once and copied where each screen needs them.
//
//   the brand kit   canonical lobby/shared/brand/       -> journey/public/brand/,
//                                                          printer/print-server/public/brand/
//   sync modules    canonical lobby/shared/sync-protocol.js and cloud-crypto.js
//                                                       -> journey/public/src/shared/ (the kiosk's
//                                                          passphrase v2 sign-in imports them, byte for byte)
//
// (family.css is no longer copied: the site bundles printer/styles/family.css
// itself, and no lobby or Journey file loads it.)
//
// The copies are build output: gitignored, never edited, never committed. Each
// screen still holds a FULL local copy at runtime (Journey's Pi kiosk, the print
// server and the Windows installer work offline; nothing fetches another app's
// files), because every build that serves or packages an app runs this first:
//
//   node scripts/family-assets.mjs <journey|printer|all>   copy (writes only what differs)
//   node scripts/family-assets.mjs --check [app ...]       verify the copies exist and match
//
// wired into each app's npm scripts (pretest, prestart), into site/build.mjs and
// into release-app.yml. Canonical files change in place; the copies follow on
// the next run.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const KIT = 'lobby/shared/brand';
// ES modules the Journey kiosk loads at sign-in (public/src/sync.js).
export const JOURNEY_MODULES = ['sync-protocol.js', 'cloud-crypto.js'];
// What each app holds a copy of. Paths are repo-relative.
export const COPIES = {
  journey: { kit: 'journey/public/brand', modules: 'journey/public/src/shared' },
  printer: { kit: 'printer/print-server/public/brand' },
};

const abs = (p) => path.join(ROOT, p);

/* Every file under dir, as sorted forward-slash paths relative to it. */
export function listFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(path.join(dir, rel)).sort()) {
      const child = rel ? `${rel}/${name}` : name;
      if (statSync(path.join(dir, child)).isDirectory()) walk(child);
      else out.push(child);
    }
  };
  walk('');
  return out;
}

const sameBytes = (a, b) => existsSync(b) && readFileSync(a).equals(readFileSync(b));

function syncTree(from, to) {
  const want = listFiles(from);
  const have = existsSync(to) ? listFiles(to) : [];
  let changed = 0;
  for (const rel of have) {
    if (!want.includes(rel)) { rmSync(path.join(to, rel)); changed += 1; }
  }
  for (const rel of want) {
    const dest = path.join(to, rel);
    if (sameBytes(path.join(from, rel), dest)) continue;
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(from, rel), dest);
    changed += 1;
  }
  return changed;
}

function pairs(apps) {
  const out = [];
  for (const app of apps) {
    const c = COPIES[app];
    if (!c) throw new Error(`family-assets: unknown app "${app}" (journey, printer, lobby or all)`);
    if (c.kit) out.push({ kind: 'dir', from: KIT, to: c.kit });
    if (c.modules) for (const name of JOURNEY_MODULES) out.push({ kind: 'file', from: `lobby/shared/${name}`, to: `${c.modules}/${name}` });
  }
  return out;
}

/* Copy the shared files into the given apps; returns how many files changed. */
export function copyAssets(apps) {
  let changed = 0;
  for (const p of pairs(apps)) {
    if (!existsSync(abs(p.from))) throw new Error(`family-assets: the canonical ${p.from} is missing`);
    if (p.kind === 'dir') {
      if (!existsSync(path.join(abs(p.from), 'tokens.css'))) throw new Error(`family-assets: ${p.from} is not the brand kit (no tokens.css)`);
      changed += syncTree(abs(p.from), abs(p.to));
    } else if (!sameBytes(abs(p.from), abs(p.to))) {
      mkdirSync(path.dirname(abs(p.to)), { recursive: true });
      copyFileSync(abs(p.from), abs(p.to));
      changed += 1;
    }
  }
  return changed;
}

/* Problems with the copies (empty when every one exists and matches), as lines. */
export function checkAssets(apps) {
  const problems = [];
  for (const p of pairs(apps)) {
    if (p.kind === 'file') {
      if (!existsSync(abs(p.to))) problems.push(`${p.to} is missing: run node scripts/family-assets.mjs`);
      else if (!sameBytes(abs(p.from), abs(p.to))) problems.push(`${p.to} differs from ${p.from}: run node scripts/family-assets.mjs`);
      continue;
    }
    if (!existsSync(abs(p.to))) { problems.push(`${p.to}/ is missing: run node scripts/family-assets.mjs`); continue; }
    const want = listFiles(abs(p.from));
    const have = listFiles(abs(p.to));
    for (const rel of want) {
      if (!have.includes(rel)) problems.push(`${p.to}/${rel} is missing`);
      else if (!sameBytes(path.join(abs(p.from), rel), path.join(abs(p.to), rel))) problems.push(`${p.to}/${rel} differs from ${p.from}/${rel}`);
    }
    for (const rel of have) if (!want.includes(rel)) problems.push(`${p.to}/${rel} is not in the kit ${p.from}/`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  let apps = args.filter((a) => !a.startsWith('--'));
  if (!apps.length || apps.includes('all')) apps = Object.keys(COPIES);
  try {
    if (check) {
      const problems = checkAssets(apps);
      if (problems.length) {
        console.error(`✗ ${problems.length} problem(s) with the generated copies:\n  ${problems.join('\n  ')}`);
        process.exit(1);
      }
      console.log(`✓ the brand kit and shared module copies exist and match their canonical files (${apps.join(', ')})`);
    } else {
      const n = copyAssets(apps);
      if (n) console.log(`family-assets: ${n} file(s) updated for ${apps.join(', ')}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

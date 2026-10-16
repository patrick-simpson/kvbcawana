#!/usr/bin/env node
// Generated copies of lobby/shared/*.js, for the readers that cannot import
// them: the ONE table of committed generated copies (the sync protocol and the
// cloud crypto joined it from their own generators, 2026-10-16). The lobby's
// Vite build imports the shared modules directly; the
// KVBC Awana app and the print server ship in an installer that contains only
// printer/, so it carries a generated CommonJS copy of the modules it uses
// (the old sound room app, lobby/desktop, took an ES module copy until it was
// retired on 2026-10-16; the 'esm' format is kept for a future reader). The shared source is the one place to edit:
//
//   node scripts/family-assets.mjs          the one command: rewrites these copies
//                                           and makes every build-time copy
//   node scripts/shared-copies.mjs          rewrite only these copies
//   node scripts/shared-copies.mjs --check  fail when any copy has drifted
//                                           (scripts/check-mirrors.mjs runs this)
//
// A shared module declares its exports as `export const NAME` /
// `export function NAME` / `export async function NAME` only, and may import only another shared module of
// this table by a relative `import { a, b } from './x.js';` (nothing else), so
// the CommonJS form is a mechanical rewrite: that import becomes a
// `require()` of the other module's generated copy in the same folder.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** [shared source, copy, format] */
export const COPIES = [
  ['lobby/shared/clubNight.js', 'printer/electron-app/src/display/clubNight.js', 'cjs'],
  ['lobby/shared/clubs.js', 'printer/print-server/clubTable.js', 'cjs'],
  ['lobby/shared/text.js', 'printer/print-server/textClean.js', 'cjs'],
  ['lobby/shared/tonight.js', 'printer/print-server/tonight.js', 'cjs'],
  ['lobby/shared/pickup.js', 'printer/print-server/pickup.js', 'cjs'],
  ['lobby/shared/churchSettings.js', 'printer/print-server/churchSettings.js', 'cjs'],
  ['lobby/shared/sync-protocol.js', 'printer/print-server/sync-protocol.js', 'cjs'],
  ['lobby/shared/cloud-crypto.js', 'printer/print-server/cloud-crypto.js', 'cjs'],
];

export function render(source, format, src) {
  const note = `// GENERATED from ${src} by scripts/shared-copies.mjs: do not edit; edit the source and run\n// \`node scripts/family-assets.mjs\`. scripts/check-mirrors.mjs fails when this copy drifts.\n`;
  if (format === 'esm') return note + source;
  if (/^export\s+(default|\{|\*)/m.test(source)) {
    throw new Error(`${src}: a shared module may only use export const / export function`);
  }
  // `import { a, b } from './x.js';` of another module in this table -> its generated copy.
  const importRe = /^import\s+\{([^}]*)\}\s+from\s+'\.\/([A-Za-z0-9_-]+\.js)';[ \t]*$/gm;
  let body = source.replace(importRe, (_m, imported, file) => {
    const hit = COPIES.find(([from, , fmt]) => fmt === 'cjs' && path.basename(from) === file);
    if (!hit) throw new Error(`${src}: imports ./${file}, which is not a generated shared module`);
    return `const {${imported}} = require('./${path.basename(hit[1], '.js')}');`;
  });
  if (/^\s*import\s/m.test(body)) throw new Error(`${src}: a shared module may import only another shared module by a relative named import`);
  const names = [];
  body = body.replace(/^export (const|function|async function) ([A-Za-z0-9_$]+)/gm, (_m, kind, name) => { names.push(name); return `${kind} ${name}`; });
  if (/^\s*export\b/m.test(body)) throw new Error(`${src}: has an export this generator does not understand`);
  return `${note}'use strict';\n${body.replace(/\n*$/, '\n')}\nmodule.exports = {\n  ${names.join(',\n  ')},\n};\n`;
}

export function expected() {
  return COPIES.map(([src, dest, format]) => ({
    src, dest, text: render(readFileSync(path.join(ROOT, src), 'utf8'), format, src),
  }));
}

/** The copies that differ from what the sources generate. */
export function drift() {
  return expected().filter(({ dest, text }) => {
    const p = path.join(ROOT, dest);
    return !existsSync(p) || readFileSync(p, 'utf8') !== text;
  });
}

/** Rewrite the copies that drifted; returns how many changed. */
export function writeCopies() {
  const bad = drift();
  for (const { dest, text } of bad) writeFileSync(path.join(ROOT, dest), text);
  return bad.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const bad = drift();
    if (bad.length) {
      console.error(bad.map((b) => `${b.dest} differs from what ${b.src} generates`).join('\n'));
      process.exit(1);
    }
    console.log(`${COPIES.length} generated copies match their shared sources`);
  } else {
    console.log(`wrote ${writeCopies()} changed generated copies`);
  }
}

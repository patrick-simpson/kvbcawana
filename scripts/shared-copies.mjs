#!/usr/bin/env node
// Generated copies of lobby/shared/*.js, for the readers that cannot import
// them. The lobby's Vite build imports the shared modules directly; the two
// Electron apps and the print server ship in installers that contain only
// their own folder, so each carries a generated copy of the modules it uses
// (an ES module for lobby/desktop, which is `"type": "module"`; CommonJS for
// printer/, which is not). The shared source is the one place to edit:
//
//   node scripts/shared-copies.mjs          rewrite the copies
//   node scripts/shared-copies.mjs --check  fail when any copy has drifted
//                                           (scripts/check-mirrors.mjs runs this)
//
// A shared module must be self-contained (no imports) and declare its
// exports as `export const NAME` / `export function NAME` only, so the
// CommonJS form is a mechanical rewrite.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** [shared source, copy, format] */
export const COPIES = [
  ['lobby/shared/clubNight.js', 'lobby/desktop/src/clubNight.js', 'esm'],
  ['lobby/shared/clubNight.js', 'printer/electron-app/src/display/clubNight.js', 'cjs'],
  ['lobby/shared/clubs.js', 'printer/print-server/clubTable.js', 'cjs'],
  ['lobby/shared/text.js', 'printer/print-server/textClean.js', 'cjs'],
  ['lobby/shared/tonight.js', 'printer/print-server/tonight.js', 'cjs'],
];

export function render(source, format, src) {
  const note = `// GENERATED from ${src} by scripts/shared-copies.mjs: do not edit; edit the source and run\n// \`node scripts/shared-copies.mjs\`. scripts/check-mirrors.mjs fails when this copy drifts.\n`;
  if (format === 'esm') return note + source;
  if (/^\s*import\s/m.test(source) || /^export\s+(default|\{|\*)/m.test(source)) {
    throw new Error(`${src}: a shared module may only use export const / export function and no imports`);
  }
  const names = [];
  const body = source.replace(/^export (const|function) ([A-Za-z0-9_$]+)/gm, (_m, kind, name) => { names.push(name); return `${kind} ${name}`; });
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const bad = drift();
    if (bad.length) {
      console.error(bad.map((b) => `${b.dest} differs from what ${b.src} generates`).join('\n'));
      process.exit(1);
    }
    console.log(`${COPIES.length} generated copies match their shared sources`);
  } else {
    for (const { dest, text } of expected()) writeFileSync(path.join(ROOT, dest), text);
    console.log(`wrote ${COPIES.length} generated copies`);
  }
}

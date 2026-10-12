#!/usr/bin/env node
// Generates printer/print-server/cloud-crypto.js, the CommonJS copy of online
// check-in's client cryptography (lobby/shared/cloud-crypto.js, canonical).
// The print server and the KVBC Awana app are CommonJS and ship
// print-server/*.js as a resource of the packaged Windows app, which has no
// lobby/ folder, so they cannot import the shared ES module at run time.
//
//   node scripts/gen-cloud-crypto.mjs           write the copy
//   node scripts/check-mirrors.mjs              (CI) fails if the copy is stale
//
// The shared file is plain JavaScript made of top-level `export function` /
// `export async function` / `export const` declarations; this turns them into
// `exports`. Anything else exported (a default export, a re-export, a class)
// or any import is refused rather than guessed at.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE = 'lobby/shared/cloud-crypto.js';
export const TARGET = 'printer/print-server/cloud-crypto.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** @param {string} source the canonical ES module text */
export function toCommonJs(source) {
  const names = [];
  let body = source.replace(/^export\s+(async\s+function\s+(\w+)|function\s+(\w+)|const\s+(\w+))/gm, (_all, rest, a, f, c) => {
    names.push(a || f || c);
    return rest;
  });
  if (/^\s*export\b/m.test(body)) throw new Error(`${SOURCE} has an export this generator does not understand`);
  if (/^\s*import\b/m.test(body)) throw new Error(`${SOURCE} must stay dependency-free (no imports)`);
  body = body.replace(/^\/\/ @ts-check\n/, '');
  const banner = [
    `// GENERATED from ${SOURCE} by scripts/gen-cloud-crypto.mjs. DO NOT EDIT:`,
    '// change the canonical file, then run the generator (scripts/check-mirrors.mjs',
    '// fails CI when this copy is stale). CommonJS because the print server and the',
    '// packaged Windows app cannot import the shared ES module.',
    "'use strict';",
    '',
  ].join('\n');
  return `${banner}${body.replace(/\s+$/, '')}\n\nmodule.exports = {\n${names.map((n) => `  ${n},`).join('\n')}\n};\n`;
}

export function expectedCopy() {
  return toCommonJs(readFileSync(path.join(ROOT, SOURCE), 'utf8'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(path.join(ROOT, TARGET), expectedCopy());
  console.log(`wrote ${TARGET}`);
}

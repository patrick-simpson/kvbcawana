#!/usr/bin/env node
// The family's copies, checked in one place. Before the merge each was a
// byte-identical mirror in another repo, compared over the network by that
// repo's CI; here both sides sit in one checkout, so a drift fails the same
// push that causes it. Canonical side first in every pair.
//
//   contract / envelope vectors   printer/  ->  lobby/src/lib/__fixtures__/
//   the brand kit                 lobby/shared/brand/  ->  journey/public/brand/,
//                                                          printer/print-server/public/brand/
//   family.css                    printer/styles/  ->  lobby/public/, journey/public/
//   the sync protocol             lobby/shared/sync-protocol.js  ->  a GENERATED CommonJS
//                                 copy, printer/print-server/sync-protocol.js
//                                 (scripts/gen-sync-protocol.mjs; the packaged Windows app
//                                 cannot import the ES module)
//
// Until the one-site build serves a single copy of each (step 2), the copies
// stay, and this keeps them honest.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE as SYNC_PROTOCOL_SOURCE, TARGET as SYNC_PROTOCOL_COPY, expectedCopy } from './gen-sync-protocol.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (p) => path.relative(ROOT, p);

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const problems = [];
function same(canonical, copy) {
  const a = path.join(ROOT, canonical);
  const b = path.join(ROOT, copy);
  if (!existsSync(b)) { problems.push(`${copy} is missing (canonical: ${canonical})`); return; }
  if (!readFileSync(a).equals(readFileSync(b))) problems.push(`${copy} differs from ${canonical}`);
}
function sameTree(canonical, copy) {
  const a = path.join(ROOT, canonical);
  const b = path.join(ROOT, copy);
  const left = new Set(files(a).map((f) => path.relative(a, f)));
  const right = new Set(files(b).map((f) => path.relative(b, f)));
  for (const f of left) {
    if (!right.has(f)) problems.push(`${copy}/${f} is missing (canonical: ${canonical}/${f})`);
    else same(path.join(canonical, f), path.join(copy, f));
  }
  for (const f of right) if (!left.has(f)) problems.push(`${copy}/${f} is not in the canonical kit ${canonical}/`);
}

same('printer/contract-vectors.json', 'lobby/src/lib/__fixtures__/contract-vectors.json');
same('printer/envelope-vectors.json', 'lobby/src/lib/__fixtures__/envelope-vectors.json');
sameTree('lobby/shared/brand', 'journey/public/brand');
sameTree('lobby/shared/brand', 'printer/print-server/public/brand');
same('printer/styles/family.css', 'lobby/public/family.css');
same('printer/styles/family.css', 'journey/public/family.css');

// The sync protocol's CommonJS copy is generated, so it is compared with what
// the generator would write now, not byte-for-byte with the source.
{
  const copy = path.join(ROOT, SYNC_PROTOCOL_COPY);
  if (!existsSync(copy)) problems.push(`${SYNC_PROTOCOL_COPY} is missing (generate it from ${SYNC_PROTOCOL_SOURCE}: node scripts/gen-sync-protocol.mjs)`);
  else if (readFileSync(copy, 'utf8') !== expectedCopy()) problems.push(`${SYNC_PROTOCOL_COPY} is stale (run: node scripts/gen-sync-protocol.mjs)`);
}

if (problems.length) {
  console.error(`✗ ${problems.length} copy problem(s):\n  ${problems.join('\n  ')}`);
  console.error('Change the canonical file, then copy it over the others (never the other way round); the sync protocol copy is regenerated, not copied.');
  process.exit(1);
}
console.log('✓ contract vectors, envelope vectors, the brand kit, family.css and the sync protocol copy match across the three apps');

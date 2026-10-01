// Guards the mirrored fixtures. Their canonical copies live in the printer repo
// (Print-TwoTimTwo-Labels — the sole publisher); this repo carries byte-identical
// mirrors that its tests run against. Drift is created by a *printer-repo* push,
// which this repo's push-triggered CI never sees — hence the weekly cron in
// ci.yml.
//
// Two files are mirrored, and they fail differently if they drift:
//
//   contract-vectors.json  — the payload shapes. Drift means the sanitizers stop
//                            matching what the publisher actually sends.
//   envelope-vectors.json  — the sealed-envelope framing plus interop test
//                            vectors. Drift means this repo can no longer OPEN
//                            what the printer seals, so every welcome banner
//                            silently stops. There is no partial failure here:
//                            either the framing agrees or no name ever renders.
//
// Network trouble (offline runner, raw.githubusercontent outage, moved file)
// warns and exits 0: this check must never block a club-night redeploy of the
// live signage site. A successful fetch that doesn't byte-match exits 1.
//
// ONE EXPECTED FAILURE WORTH RECOGNISING: it compares against the printer repo's
// `main`, so during a coordinated two-repo change this fails until the PRINTER
// side merges. That is the check working, not a false alarm — CONTRACT.md is
// explicit that canonical changes land in the printer repo first. The fix is
// merge order, never editing the mirror to match a `main` that is behind. The
// message below says so, because "drifted" on its own sends people to the wrong
// remedy.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const RAW_BASE =
  'https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main';

const MIRRORS = [
  {
    name: 'contract-vectors.json',
    consequence:
      'the sanitizers would stop matching what the publisher sends',
  },
  {
    name: 'envelope-vectors.json',
    consequence:
      'this repo could no longer decrypt check-ins, so every welcome banner would silently stop',
  },
];

let drifted = 0;
let skipped = 0;

for (const { name, consequence } of MIRRORS) {
  const url = `${RAW_BASE}/${name}`;
  const mirrorPath = fileURLToPath(
    new URL(`../src/lib/__fixtures__/${name}`, import.meta.url),
  );

  let canonical;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    canonical = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.warn(
      `⚠ Could not fetch the canonical ${name} (${err.message}).\n` +
        `  ${url}\n` +
        '  Skipping this one — if the canonical file moved, update RAW_BASE in\n' +
        '  scripts/check-contract-drift.mjs.',
    );
    skipped++;
    continue;
  }

  let mirror;
  try {
    mirror = await readFile(mirrorPath);
  } catch {
    // A MISSING mirror is drift, not a skip: the canonical copy exists, so this
    // repo is simply not carrying a file its tests need.
    console.error(
      `✗ ${name} is missing from src/lib/__fixtures__/ but exists upstream.\n` +
        `  Without it, ${consequence}.\n` +
        `    curl -fsSL ${url} -o src/lib/__fixtures__/${name}`,
    );
    drifted++;
    continue;
  }

  if (canonical.equals(mirror)) {
    console.log(`✓ ${name} matches the canonical copy byte-for-byte.`);
    continue;
  }

  console.error(
    `✗ ${name} has drifted from the canonical copy.\n` +
      `  Consequence if shipped: ${consequence}.\n` +
      `  canonical: ${url}\n` +
      `  mirror:    src/lib/__fixtures__/${name}\n` +
      '  If you are landing a coordinated change across both repos, this is\n' +
      '  EXPECTED until the printer-side PR merges — the canonical copy lands\n' +
      '  there first. Merge that PR, then re-run this job. Do NOT "fix" it by\n' +
      '  editing the mirror to match a main branch that is behind.\n' +
      '  Otherwise, re-mirror byte-identically (see CONTRACT.md):\n' +
      `    curl -fsSL ${url} \\\n` +
      `      -o src/lib/__fixtures__/${name}\n` +
      '  then re-run: npm test',
  );
  drifted++;
}

if (drifted) process.exit(1);
if (skipped === MIRRORS.length) process.exit(0);
process.exit(0);

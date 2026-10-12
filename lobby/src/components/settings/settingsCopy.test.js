import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// The stale-wording rule (docs/SETTINGS-OVERHAUL.md section 3, "Stale
// wording"): the settings page speaks of "the check-in laptop" (the computer)
// and "KVBC Awana" (the app), never of the retired dashboard, the Club Label
// Printer, the print server or "shared settings". Comments are excluded: this
// is about what a person reads.

// vitest runs from the lobby folder.
const ROOT = join(process.cwd(), 'src');
const STALE = /dashboard|Club Label Printer|print server|shared settings/i;

/** Every source file whose strings a person can read. */
function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(jsx?|mjs)$/.test(name) && !/\.test\.jsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** The source with its comments taken out (block, JSX and line comments). */
export function withoutComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

const SOURCES = [
  ...files(join(ROOT, 'components', 'settings')),
  join(ROOT, 'components/SettingsPanel.jsx'),
  join(ROOT, 'components/RemoteScreenPanel.jsx'),
];

describe('settings copy: no stale words (comments excluded)', () => {
  it('finds the files it is meant to scan', () => {
    expect(SOURCES.length).toBeGreaterThan(20);
  });

  for (const file of SOURCES) {
    it(relative(ROOT, file), () => {
      const code = withoutComments(readFileSync(file, 'utf8'));
      const hit = code.split('\n').map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => STALE.test(l));
      expect(hit.map(({ n, l }) => `${n}: ${l.trim()}`)).toEqual([]);
    });
  }

  it('the comment stripper leaves strings and URLs alone', () => {
    expect(withoutComments("const a = 'x'; // the dashboard\nconst b = 'https://example.org/dashboard';")).toContain("'https://example.org/dashboard'");
    expect(withoutComments('/* print server */ const c = 1;')).not.toMatch(/print server/);
  });

  it('no section path names an old section the owner would hunt for', () => {
    const OLD = /Settings → (Setup|Slides|Screen & corner|Laptop|Status)\b|→ Laptop →|Setup → /;
    const hits = [];
    for (const file of SOURCES) {
      if (/(StatusSection|SetupSection|SlidesSection|ScreenSection|laptop)\.jsx$|SettingsPanel\.jsx$/.test(file)) continue;   // the classic rail's own files name its own sections
      const code = withoutComments(readFileSync(file, 'utf8'));
      code.split('\n').forEach((l, i) => { if (OLD.test(l)) hits.push(`${relative(ROOT, file)}:${i + 1}`); });
    }
    expect(hits).toEqual([]);
  });
});

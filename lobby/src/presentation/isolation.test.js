import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The presentation page's isolation rule (CLAUDE.md, "The presentation
// page"): src/presentation/ may import from the signage app ONLY the files
// listed below. The family's shared/ folder (schedule, theme, slides and the
// brand kit) belongs to every app and is always allowed. Tests are exempt
// (a test may reach across to pin two copies of one thing together).

const ROOT = resolve(__dirname, '../..');
const PRESENTATION = __dirname;

const ALLOWED = new Set([
  'src/hooks/useSocket.js',
  'src/hooks/useConfig.js',
  'src/hooks/useWakeLock.js',
  'src/hooks/useBuildReload.js',
  'src/lib/buildReload.js',
  'src/lib/reloadLedger.js',
  'src/lib/weather.js',
  'src/lib/skins.js',
  'src/components/BirthdayArt.jsx',
  'src/hooks/useDisplayLogin.js',
  'src/hooks/useDisplayKey.js',
  'src/lib/displayKey.js',
  'src/lib/envelope.js',
  'src/lib/configureRelay.js',
]);

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = resolve(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const sources = walk(PRESENTATION).filter((f) => /\.(jsx?|css)$/.test(f) && !/\.test\.jsx?$/.test(f));

/** Every relative import / @import in a file, resolved to a repo path. */
function importsOf(file) {
  const text = readFileSync(file, 'utf8');
  const specs = [
    ...text.matchAll(/(?:^|\n)\s*import\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/g),
    ...text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g),
    ...text.matchAll(/@import\s+["']([^"']+)["']/g),
  ].map((m) => m[1]);
  return specs
    .filter((s) => s.startsWith('.'))
    .map((s) => relative(ROOT, resolve(dirname(file), s.split('?')[0])).replaceAll('\\', '/'));
}

describe('presentation isolation rule', () => {
  it('found the presentation sources (canary)', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it('imports from outside src/presentation only the allowlist, or shared/', () => {
    const offenders = [];
    for (const file of sources) {
      for (const target of importsOf(file)) {
        if (target.startsWith('src/presentation/')) continue;
        if (target.startsWith('shared/')) continue;
        if (target === 'countdown.html') continue;
        if (!ALLOWED.has(target)) offenders.push(`${relative(ROOT, file)} → ${target}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never reaches for the lobby\'s brand primitives (the projector draws its own)', () => {
    for (const file of sources) {
      for (const target of importsOf(file)) {
        expect(target.startsWith('src/components/brand/'), `${file} → ${target}`).toBe(false);
        expect(target, file).not.toBe('src/lib/brand.js');
        expect(target, file).not.toBe('src/lib/motion.jsx');
      }
    }
  });
});

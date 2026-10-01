import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// CLAUDE.md, "Embedding on weaker hardware": every signage component must
// animate through M (src/lib/motion.jsx), never framer-motion's `motion`
// directly, or it silently keeps animating under ?lowPower=1 on the Pi Zero
// embed. The rebrand adds a lot of new animated components; this makes the
// rule a failing test instead of a line to remember.

const SRC = resolve(__dirname, '..');

/** @param {string} dir @returns {string[]} */
function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      // The projector page has its own motion rules (CLAUDE.md, "The
      // presentation page"), and fixtures are data.
      return name === 'presentation' || name === '__fixtures__' ? [] : sourceFiles(path);
    }
    return /\.(jsx?|tsx?)$/.test(name) && !/\.test\.[jt]sx?$/.test(name) ? [path] : [];
  });
}

/** Every named binding a file imports from framer-motion, plus namespace imports. */
function framerImports(text) {
  const found = [];
  const re = /import\s+([^;]*?)\s+from\s+['"]framer-motion['"]/g;
  for (const m of text.matchAll(re)) {
    const clause = m[1];
    if (/\*\s+as\s+/.test(clause)) found.push('*');
    const named = clause.match(/\{([^}]*)\}/)?.[1] ?? '';
    for (const part of named.split(',')) {
      const imported = part.trim().split(/\s+as\s+/)[0];
      if (imported) found.push(imported);
    }
    // A default import (`import fm from 'framer-motion'`) is the namespace too.
    if (/^[A-Za-z_$][\w$]*\s*(,|$)/.test(clause.trim())) found.push('default');
  }
  return found;
}

// framer-motion exports that animate on their own and so would dodge the
// zero-animation guarantee. AnimatePresence, MotionConfig and the hooks
// only orchestrate what M elements do, which is why they stay allowed.
const FORBIDDEN = new Set(['motion', 'm', 'animate', 'useAnimate', 'useAnimation', 'useAnimationControls', '*', 'default']);

describe('signage animates only through M (src/lib/motion.jsx)', () => {
  const files = sourceFiles(SRC);

  it('finds the signage sources', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('no signage file but motion.jsx imports an animating framer-motion export', () => {
    const offenders = files
      .filter((f) => relative(SRC, f) !== join('lib', 'motion.jsx'))
      .flatMap((f) => framerImports(readFileSync(f, 'utf8'))
        .filter((name) => FORBIDDEN.has(name))
        .map((name) => `${relative(SRC, f)}: ${name}`));
    expect(offenders).toEqual([]);
  });

  it('the scanner itself recognises every import form it guards against', () => {
    expect(framerImports("import { motion } from 'framer-motion';")).toEqual(['motion']);
    expect(framerImports("import { AnimatePresence, motion as m2 } from \"framer-motion\";")).toEqual(['AnimatePresence', 'motion']);
    expect(framerImports("import * as fm from 'framer-motion';")).toEqual(['*']);
    expect(framerImports("import fm, { MotionConfig } from 'framer-motion';")).toEqual(['MotionConfig', 'default']);
    expect(framerImports("import {\n  AnimatePresence,\n  useAnimate,\n} from 'framer-motion';")).toEqual(['AnimatePresence', 'useAnimate']);
  });
});

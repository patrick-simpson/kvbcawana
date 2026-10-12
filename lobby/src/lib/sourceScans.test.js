import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import tokens from '../../shared/brand/tokens.json';
import { PRESS, releaseEasing } from './squish.js';


// ── app.css: the soft squish, spelled in CSS as squish.js spells it ──

// The soft squish has one physics (src/lib/squish.js) and two spellings of it:
// the keyframe lists the lobby's M elements land with, and app.css's operator
// presses and panel entrances. This pins the CSS half to the JS half, the way
// brandKit.test.js pins tokens.css to tokens.json: every --squish-* number on
// :root, and every literal linear() easing, which must be the spring's own.

const css = readFileSync(resolve(__dirname, '../styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The kit's pop curve, as CSS: every spring's fallback. */
const POP = `cubic-bezier(${tokens.motion.curves.pop.join(', ')})`;
const KIT_CURVES = Object.values(tokens.motion.curves).map((c) => `cubic-bezier(${c.join(', ')})`);

/** Every `--squish-*` custom property declared on a :root rule, name to value. */
function rootSquish() {
  const found = {};
  for (const m of css.matchAll(/(^|\})\s*:root\s*\{([^}]*)\}/g)) {
    for (const d of m[2].matchAll(/(--squish-[\w-]+)\s*:\s*([^;]+);/g)) found[d[1]] = d[2].trim();
  }
  return found;
}

/** Every rule body as its declarations, in order: [{ prop, value }]. */
function declarationBlocks() {
  return [...css.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1].split(';')
    .map((d) => d.trim()).filter(Boolean)
    .map((d) => {
      const at = d.indexOf(':');
      return { prop: d.slice(0, at).trim(), value: d.slice(at + 1).trim() };
    }));
}

describe('app.css spells the soft squish the way src/lib/squish.js does', () => {
  it('its --squish-* numbers are PRESS\'s, and nothing else rides on :root', () => {
    expect(rootSquish()).toEqual({
      '--squish-press': `${PRESS.ms}ms`,
      '--squish-release': `${PRESS.releaseMs}ms`,
      '--squish-press-x': String(PRESS.scaleX),
      '--squish-press-y': String(PRESS.scaleY),
      '--squish-gear-x': String(PRESS.gear.scaleX),
      '--squish-gear-y': String(PRESS.gear.scaleY),
      '--squish-tab-x': String(PRESS.tab.scaleX),
      '--squish-tab-y': String(PRESS.tab.scaleY),
      '--squish-tile-x': String(PRESS.tile.scaleX),
      '--squish-tile-y': String(PRESS.tile.scaleY),
      '--squish-box': String(PRESS.box.scaleX),
    });
    // The checkbox squishes evenly: one number serves both axes.
    expect(PRESS.box.scaleX).toBe(PRESS.box.scaleY);
  });

  it('every linear() easing is the spring\'s own release, character for character', () => {
    const easings = [...css.matchAll(/linear\([^)]*\)/g)].map((m) => m[0]);
    expect(easings.length).toBeGreaterThanOrEqual(4); // the presses, the gear, the check, the entrances
    for (const e of easings) expect(e).toBe(releaseEasing());
  });

  it('each spring is written out literally, right after a cubic-bezier fallback of the same property', () => {
    for (const block of declarationBlocks()) {
      block.forEach(({ prop, value }, i) => {
        if (!value.includes('linear(')) return;
        // Behind var() an unreadable linear() would leave the property unset
        // instead of falling back, so the declaration carries no var() at all.
        expect(value, prop).not.toMatch(/var\(/);
        const fallback = block[i - 1];
        expect(fallback?.prop, `${prop}'s fallback`).toBe(prop);
        expect(fallback.value).toBe(value.replaceAll(releaseEasing(), POP));
        // Any other curve in the list is one of the kit's four, spelled out.
        for (const curve of value.match(/cubic-bezier\([^)]*\)/g) ?? []) expect(KIT_CURVES).toContain(curve);
      });
    }
  });

  it('every spring runs for --squish-release, the release PRESS times', () => {
    const springs = declarationBlocks().filter((block) => block.some(({ value }) => value.includes('linear(')));
    expect(springs.length).toBeGreaterThanOrEqual(4);
    for (const block of springs) {
      const duration = block.find(({ prop }) => prop === 'transition-duration' || prop === 'animation');
      expect(duration?.value, JSON.stringify(block)).toMatch(/var\(--squish-release\)/);
    }
  });
});

// ── app.css: zero animation reaches the pseudo-elements, and the presses stop ──

// ?lowPower=1 means ZERO animation (CLAUDE.md). Plain CSS is stopped by one
// blanket rule on `.zero-animation-mode`, deliberately a blanket rule so a
// future animation is covered with nothing to remember. But `*` matches
// ELEMENTS only, and neither `animation` nor `transition` is inherited, so a
// transition declared on a pseudo-element (the panels' kit checkbox pops its
// check on a ::before) kept playing on the Pi. This pins the blanket rule and
// fails any rule that animates a pseudo-element the blanket rule does not name.


/**
 * Flatten a stylesheet into { selector, body } rules, descending into
 * @media / @supports / @container blocks and skipping @keyframes and the
 * like. Comments are stripped first; declarations never contain braces.
 * @param {string} text
 */
function rules(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  /** @type {Array<{ selector: string, body: string, media: string }>} */
  const out = [];
  let i = 0;
  /** @param {number} end @param {string} [media] the @media block a rule sits in, if any */
  const walk = (end, media = '') => {
    while (i < end) {
      const open = src.indexOf('{', i);
      if (open < 0 || open >= end) return;
      const head = src.slice(i, open).replace(/^[\s\S]*;/, '').trim();
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth) {
        if (src[j] === '{') depth += 1;
        else if (src[j] === '}') depth -= 1;
        j += 1;
      }
      const close = j - 1;
      if (head.startsWith('@media') || head.startsWith('@supports') || head.startsWith('@container')) {
        i = open + 1;
        walk(close, head.startsWith('@media') ? head.replace(/\s+/g, ' ') : media);
      } else if (!head.startsWith('@')) {
        out.push({ selector: head, body: src.slice(open + 1, close), media });
      }
      i = close + 1;
    }
  };
  walk(src.length);
  return out;
}

const selectorsOf = (rule) => rule.selector.split(',').map((s) => s.trim().replace(/\s+/g, ' '));

/** Does this declaration block start an animation or a timed transition? */
function animates(body) {
  return body.split(';').some((decl) => {
    const m = decl.match(/^\s*(animation|animation-name|animation-duration|transition|transition-duration)\s*:\s*(.+?)\s*$/i);
    return Boolean(m) && !/^(none|0m?s|initial|unset|inherit)(\s*!important)?$/i.test(m[2]);
  });
}

/** The pseudo-elements a selector ends on, normalised (`:before` → `::before`). */
function pseudoElementsOf(selector) {
  const found = selector.match(/::[a-z-]+(\([^)]*\))?|:(before|after|first-line|first-letter)\b/gi) || [];
  return found.map((p) => (p.startsWith('::') ? p : `:${p}`).toLowerCase());
}

/** The blanket kill switch: the rule whose selector list names `.zero-animation-mode *`. */
function blanketRule(all) {
  return all.find((r) => selectorsOf(r).includes('.zero-animation-mode *'));
}

/**
 * Every pseudo-element some rule animates that the blanket rule does not
 * reach, as `selector (pseudo)` strings.
 * @param {string} text
 */
function uncoveredPseudoAnimations(text) {
  const all = rules(text);
  const blanket = blanketRule(all);
  const named = new Set(blanket ? selectorsOf(blanket) : []);
  const misses = [];
  for (const rule of all) {
    if (rule === blanket || !animates(rule.body)) continue;
    for (const sel of selectorsOf(rule)) {
      for (const pseudo of pseudoElementsOf(sel)) {
        if (!named.has(`.zero-animation-mode *${pseudo}`)) misses.push(`${sel} (${pseudo})`);
      }
    }
  }
  return misses;
}

describe('zero-animation mode reaches pseudo-elements (app.css)', () => {
  it('the blanket rule stops animations and transitions on elements and their ::before / ::after', () => {
    const blanket = blanketRule(rules(css));
    expect(blanket).toBeDefined();
    const sels = selectorsOf(/** @type {{ selector: string, body: string }} */ (blanket));
    expect(sels).toEqual(expect.arrayContaining([
      '.zero-animation-mode',
      '.zero-animation-mode *',
      '.zero-animation-mode *::before',
      '.zero-animation-mode *::after',
    ]));
    expect(blanket?.body).toMatch(/animation:\s*none\s*!important/);
    expect(blanket?.body).toMatch(/transition:\s*none\s*!important/);
  });

  it('no rule animates a pseudo-element the blanket rule does not name', () => {
    expect(uncoveredPseudoAnimations(css)).toEqual([]);
  });

  it('the scan itself catches a pseudo-element transition the blanket rule misses', () => {
    const sheet = `
      .panel input::before { scale: 0; transition: scale 200ms ease; }
      .tip::marker { animation: blink 1s infinite; }
      .calm::after { transition: none; }
      @media (prefers-reduced-motion: reduce) { .panel input::before { transition: none; } }
      .zero-animation-mode, .zero-animation-mode * { animation: none !important; transition: none !important; }
    `;
    expect(uncoveredPseudoAnimations(sheet)).toEqual([
      '.panel input::before (::before)',
      '.tip::marker (::marker)',
    ]);
    const covered = sheet.replace(
      '.zero-animation-mode * {',
      '.zero-animation-mode *, .zero-animation-mode *::before, .zero-animation-mode *::marker {',
    );
    expect(uncoveredPseudoAnimations(covered)).toEqual([]);
  });
});

// The soft squish's presses (app.css, "The soft squish: operator presses")
// squash a control on :active through the individual `scale`. The blanket rule
// above stops their spring, but not the squash itself: a press on the Pi, or
// under the OS's reduced motion, must be the flat 2px sink it always was. So
// every press rule needs a `scale: none` twin in both kill switches, written
// with the press's own selector (or it loses on specificity).
describe('the soft squish\'s presses stop in both kill switches (app.css)', () => {
  const all = rules(css);
  const REDUCED = '@media (prefers-reduced-motion: reduce)';
  /** A declaration's value in a rule body, or undefined. */
  const valueOf = (body, prop) => body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))?.[1].trim();
  const presses = all
    .filter((r) => !r.media && (valueOf(r.body, 'scale') !== undefined || valueOf(r.body, 'translate') !== undefined))
    .flatMap(selectorsOf)
    .filter((sel) => /:active$/.test(sel) && !sel.startsWith('.zero-animation-mode'));
  /** Does some rule (in `media`, or in none) give `sel` the declaration `scale: none`? */
  const stills = (sel, media) => all.some((r) => r.media === media && selectorsOf(r).includes(sel) && valueOf(r.body, 'scale') === 'none');

  it('finds the presses: the pills, the debug tiles, the tabs\' own rail, the gear and the checkbox', () => {
    expect(presses).toEqual(expect.arrayContaining([
      '.panel button:not(:disabled):active',
      '.debug button:not(:disabled):active',
      '.settings-gear:active',
      ".panel input[type='checkbox']:not(:disabled):active",
    ]));
  });

  it('every press has scale: none under the OS\'s reduced motion', () => {
    expect(presses.filter((sel) => !stills(sel, REDUCED))).toEqual([]);
  });

  it('every press has scale: none under zero animation', () => {
    expect(presses.filter((sel) => !stills(`.zero-animation-mode ${sel}`, ''))).toEqual([]);
  });

  it('neither kill switch takes away the sink: the press is still the flat 2px it always was', () => {
    for (const r of all.filter((x) => valueOf(x.body, 'scale') === 'none')) expect(valueOf(r.body, 'translate')).toBeUndefined();
    const pill = all.find((r) => !r.media && selectorsOf(r).includes('.panel button') && valueOf(r.body, '--squish-sink'));
    expect(valueOf(pill.body, '--squish-sink')).toBe('0 2px');
  });

  it('no press moves `transform`, which April Fools owns', () => {
    for (const r of all.filter((x) => selectorsOf(x).some((sel) => /:active$/.test(sel)))) expect(valueOf(r.body, 'transform')).toBeUndefined();
  });

  // April Fools turns the gear, the backdrop, the debug panel and the first-run
  // card 180deg with `transform`, about their origin: a squish that moved the
  // origin would swing them off their place, and one on `transform` would
  // undo the joke's escape hatch.
  it('the surfaces April Fools turns keep their origin, and their entrances animate only translate, scale and opacity', () => {
    const turned = /\.(settings-gear|panel-backdrop|debug|setup-card)(?![\w-])/;
    const subject = (sel) => sel.split(/\s+|>|\+|~/).filter(Boolean).at(-1) ?? '';
    const moved = all.filter((r) => valueOf(r.body, 'transform-origin') && selectorsOf(r).some((sel) => turned.test(subject(sel))));
    expect(moved.map((r) => r.selector)).toEqual([]);
    const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const name of ['panel-enter']) {
      const block = src.match(new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?\\})\\s*\\}`))?.[1];
      expect(block, name).toBeDefined();
      expect(block).not.toMatch(/(^|[;{\s])transform\s*:/);
    }
  });
});

// ── signage sources: animation goes through M, never framer-motion directly ──

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

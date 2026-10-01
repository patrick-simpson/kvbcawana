import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import tokens from '../../shared/brand/tokens.json';
import { PRESS, releaseEasing } from './squish.js';

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

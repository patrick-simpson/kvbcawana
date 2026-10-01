import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// The fall promo posters are recreations of printed art and stay exactly as
// printed (CLAUDE.md, "Season promo slides"), so the brand kit's font swap
// must never reach them, and their faces must never leak back into the
// rebranded lobby. app.css gives each side its own tokens; this pins the
// border between them.

// app.css plus every per-poster stylesheet it @imports (src/styles/promos/).
const PROMO_DIR = resolve(__dirname, '../styles/promos');
const css = [
  readFileSync(resolve(__dirname, '../styles/app.css'), 'utf8'),
  ...readdirSync(PROMO_DIR).filter((f) => f.endsWith('.css')).sort()
    .map((f) => readFileSync(resolve(PROMO_DIR, f), 'utf8')),
].join('\n');

/**
 * Flatten a stylesheet into { selector, body } rules, descending into
 * @media / @supports blocks. Comments are stripped first; declarations
 * never contain braces in this file.
 * @param {string} text
 */
function rules(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  /** @type {Array<{ selector: string, body: string }>} */
  const out = [];
  let i = 0;
  const walk = (end) => {
    while (i < end) {
      const open = src.indexOf('{', i);
      if (open < 0 || open >= end) return;
      // Drop any bare statements (@import …;) sitting before the selector.
      const head = src.slice(i, open).replace(/^[\s\S]*;/, '').trim();
      // Find the matching close brace.
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
        walk(close);
      } else if (!head.startsWith('@')) {
        out.push({ selector: head, body: src.slice(open + 1, close) });
      }
      i = close + 1;
    }
  };
  walk(src.length);
  return out;
}

const ALL = rules(css);
const BRAND_FONT = /var\(--font-(display|shout|body|condensed|hand)\)/;
const PROMO_FONT = /var\(--(promo-font-[a-z]+|font-poster)\)/;
const selectors = (r) => r.selector.split(',').map((s) => s.trim());
const isPromo = (sel) => /(^|[\s>+~])\.promo[-_a-zA-Z]*/.test(sel);

describe('promo font isolation (app.css + styles/promos/)', () => {
  it('parses the stylesheet into a plausible number of rules', () => {
    expect(ALL.length).toBeGreaterThan(300);
    expect(ALL.some((r) => r.selector === '.promo-headline')).toBe(true);
  });

  it('no promo rule sets its type in a brand-kit voice', () => {
    const leaks = ALL.filter((r) => selectors(r).every(isPromo) && BRAND_FONT.test(r.body)).map((r) => r.selector);
    expect(leaks).toEqual([]);
  });

  it('no rule outside the posters uses a poster face', () => {
    const leaks = ALL.filter((r) => selectors(r).some((s) => !isPromo(s)) && PROMO_FONT.test(r.body))
      .map((r) => r.selector)
      // The token definitions themselves live on :root.
      .filter((s) => s !== ':root');
    expect(leaks).toEqual([]);
  });

  it('the poster root pins its own body face and synthesized-bold behaviour', () => {
    const root = ALL.find((r) => r.selector === '.promo-slide');
    expect(root?.body).toMatch(/font-family:\s*var\(--promo-font-body\)/);
    expect(root?.body).toMatch(/font-synthesis-weight:\s*auto/);
  });

  it('the poster tokens still name the faces the posters were drawn in', () => {
    const root = ALL.find((r) => r.selector === ':root' && /--promo-font-display/.test(r.body));
    expect(root?.body).toMatch(/--promo-font-display:\s*'Baloo 2 Variable'/);
    expect(root?.body).toMatch(/--promo-font-condensed:\s*'Oswald Variable'/);
    expect(root?.body).toMatch(/--promo-font-body:\s*'Nunito Variable'/);
    expect(root?.body).toMatch(/--font-poster:\s*'Lilita One'/);
  });

  it('the lobby speaks the three brand voices', () => {
    const root = ALL.find((r) => r.selector === ':root' && /--font-display/.test(r.body));
    expect(root?.body).toMatch(/--font-shout:\s*'Paytone One', 'Baloo 2 Variable'/);
    expect(root?.body).toMatch(/--font-display:\s*'Shout Fit', 'Baloo 2 Variable'/);
    expect(root?.body).toMatch(/--font-body:\s*'Figtree Variable'/);
    expect(root?.body).toMatch(/--font-condensed:\s*'Londrina Solid'/);
    // Galindo is gone from every rule (the comments may still tell its story).
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/galindo/i);
  });
});

/** Each @font-face in a stylesheet, as { family, descriptors }. */
function fontFaces(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...src.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => {
    const d = Object.fromEntries(body.split(';').map((line) => line.trim()).filter(Boolean).map((line) => {
      const at = line.indexOf(':');
      return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/\s+/g, ' ')];
    }));
    return { family: d['font-family'].replace(/['"]/g, ''), d };
  });
}

describe('the shout face (app.css)', () => {
  const faces = fontFaces(css);
  const shout = faces.find((f) => f.family === 'Paytone One');
  const fit = faces.find((f) => f.family === 'Shout Fit');
  const main = readFileSync(resolve(__dirname, '../main.jsx'), 'utf8');

  it('is Paytone One from the kit\'s own full files: never a subset under its reserved name', () => {
    for (const face of [shout, fit]) {
      expect(face.d.src).toBe(
        "url('../../shared/brand/fonts/paytone-one-full-400-normal.woff2') format('woff2'), url('../../shared/brand/fonts/PaytoneOne-Regular.ttf') format('truetype')",
      );
      // One file covers every letter it draws: no subset split.
      expect(face.d['unicode-range']).toBeUndefined();
    }
    expect(faces.filter((f) => /paytone/i.test(f.family))).toHaveLength(1);
    expect(main).not.toMatch(/@fontsource\/(galindo|paytone)/);
    expect(css).not.toMatch(/@fontsource\/(galindo|paytone)/);
  });

  it('the old-footprint alias is the same face at 88%, and only the alias is scaled', () => {
    expect(fit.d['size-adjust']).toBe('88%');
    expect(shout.d['size-adjust']).toBeUndefined();
  });

  it('both seat the caps where the fits\' line-box arithmetic assumes (SHOUT_BOX)', async () => {
    const { SHOUT_BOX } = await import('./brand.js');
    for (const face of [shout, fit]) {
      expect(parseFloat(face.d['ascent-override']) / 100).toBeCloseTo(SHOUT_BOX.ascent, 6);
      expect(parseFloat(face.d['descent-override']) / 100).toBeCloseTo(SHOUT_BOX.descent, 6);
      expect(face.d['line-gap-override']).toBe('0%');
    }
    // The content box keeps the font's own height (hhea 1.113 + 0.283).
    expect(SHOUT_BOX.ascent + SHOUT_BOX.descent).toBeCloseTo(1.396, 3);
  });
});

describe('the label face (app.css)', () => {
  const faces = fontFaces(css);
  const label = faces.filter((f) => f.family === 'Londrina Solid');
  const main = readFileSync(resolve(__dirname, '../main.jsx'), 'utf8');

  it('is Londrina Solid from the kit\'s own full files: never a subset under its reserved name', () => {
    // Exactly one @font-face: a second (say a latin cut by unicode-range) would
    // be a Modified Version carrying the reserved name "Londrina Solid".
    expect(label).toHaveLength(1);
    expect(label[0].d.src).toBe(
      "url('../../shared/brand/fonts/londrina-solid-full-400-normal.woff2') format('woff2'), url('../../shared/brand/fonts/LondrinaSolid-Regular.ttf') format('truetype')",
    );
    expect(label[0].d['unicode-range']).toBeUndefined();
    expect(main).not.toMatch(/@fontsource\/londrina/);
    expect(css).not.toMatch(/@fontsource\/londrina/);
  });

  it('is the 400 cut only: declaring the Black would let any font-weight 700+ rule pick it', () => {
    expect(label[0].d['font-weight']).toBe('400');
    expect(label[0].d['font-style']).toBe('normal');
    expect(css).not.toMatch(/londrina-solid-full-900|LondrinaSolid-Black/);
    // ...and no synthesized bold is smeared over the 400 cut when a rule asks for one.
    expect(ALL.find((r) => r.selector === ':root' && /--font-display/.test(r.body))?.body).toMatch(/font-synthesis-weight:\s*none/);
  });
});

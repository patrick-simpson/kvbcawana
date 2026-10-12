// The brand kit mirror and the page's use of it.
//
// public/brand/ is a generated, gitignored copy of lobby/shared/brand/ (the
// canonical kit; scripts/family-assets.mjs makes it, `npm test` runs that
// first), so the kiosk never depends on another site or the network for its
// own fonts and colours. These tests are the drift check: the copy must match
// the kit file for file, the page must
// load only self-hosted brand assets, style.css's fallbacks and baked art must
// agree with the kit, and the flat look outside the motion block (one
// keyframe, no blur) is pinned rather than remembered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAssets, KIT, listFiles, ROOT } from '../../scripts/family-assets.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC = path.join(REPO, 'public');
const read = (rel) => readFileSync(path.join(PUBLIC, rel), 'utf8');
const kitFiles = listFiles(path.join(ROOT, KIT));
const html = read('index.html');
const styleCss = read('src/style.css');

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/* { selector, body } for every plain rule, including the ones inside @media. */
function rules(css) {
  return [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim(),
    body: m[2],
  }));
}

/* Splits on commas that are not inside parentheses. */
function splitTop(value, sep = ',') {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

test('public/brand/ and public/src/shared/ are exactly the canonical files, file for file', () => {
  assert.deepEqual(
    checkAssets(['journey']),
    [],
    'they are generated copies: run `npm run assets` (npm test does) rather than editing them by hand'
  );
});

test('the mirror carries everything this page loads, fonts with their licences', () => {
  for (const rel of [
    'tokens.css',
    'tokens.json',
    'fonts.css',
    'logos/journey-white.svg',
    'logos/trek-white.svg',
    'fonts/paytone-one-full-400-normal.woff2',
    'fonts/PaytoneOne-Regular.ttf',
    'fonts/londrina-solid-full-400-normal.woff2',
    'fonts/LondrinaSolid-Regular.ttf',
    'fonts/figtree-latin-wght-normal.woff2',
    'fonts/OFL-PaytoneOne.txt',
    'fonts/OFL-LondrinaSolid.txt',
    'fonts/OFL-Figtree.txt',
  ]) {
    assert.ok(kitFiles.includes(rel), `${rel} is in the kit`);
  }
  // Every font the kit's sheet names is really there.
  for (const m of read('brand/fonts.css').matchAll(/url\((['"]?)([^'")?]+)\1\)/g)) {
    assert.ok(existsSync(path.join(PUBLIC, 'brand', m[2])), `brand/${m[2]} exists`);
  }
});

/* The sfnt table directory's OS/2 table, for the two numbers the fit rests on. */
function os2(ttf) {
  const tables = ttf.readUInt16BE(4);
  for (let i = 0; i < tables; i += 1) {
    const rec = 12 + i * 16;
    if (ttf.toString('latin1', rec, rec + 4) === 'OS/2') {
      const at = ttf.readUInt32BE(rec + 8);
      return { capHeight: ttf.readInt16BE(at + 88), sTypoAscender: ttf.readInt16BE(at + 68) };
    }
  }
  throw new Error('no OS/2 table');
}
const unitsPerEm = (ttf) => {
  const tables = ttf.readUInt16BE(4);
  for (let i = 0; i < tables; i += 1) {
    const rec = 12 + i * 16;
    if (ttf.toString('latin1', rec, rec + 4) === 'head') return ttf.readUInt16BE(ttf.readUInt32BE(rec + 8) + 18);
  }
  throw new Error('no head table');
};

test('the shout is Paytone One, whole, and Galindo is gone from everything the page reaches', () => {
  // Owner decision 2026-09-29: Galindo "looks too much like SpongeBob".
  assert.deepEqual(
    kitFiles.filter((rel) => /galindo/i.test(rel)),
    [],
    'no Galindo file in the mirror'
  );
  assert.deepEqual(readdirSync(path.join(PUBLIC, 'brand', 'fonts')).filter((f) => /galindo/i.test(f)), []);
  // (style.css's comments say why the sizes are fitted, and so name it; what
  // may not is a rule, a font load or a page.)
  for (const rel of ['index.html', 'src/style.css', 'src/schedule.js', 'brand/fonts.css', 'brand/tokens.css']) {
    const text = rel.endsWith('.css') ? stripComments(read(rel)) : read(rel);
    assert.doesNotMatch(text, /galindo/i, `${rel} does not name Galindo`);
  }
  // The stylesheet's own stack and the kit's tokens both lead with Paytone One.
  assert.match(read('brand/tokens.css'), /--brand-font-display:\s*'Paytone One',/);
  assert.match(styleCss, /--jr-font-shout:\s*var\(--brand-font-display,\s*'Paytone One',/);
  const faces = [...read('brand/fonts.css').matchAll(/@font-face\s*\{[^}]*font-family:\s*'Paytone One'[^}]*\}/g)];
  assert.equal(faces.length, 1, 'one @font-face for the shout');
  assert.match(faces[0][0], /paytone-one-full-400-normal\.woff2'\)\s*format\('woff2'\)/);
  assert.match(faces[0][0], /PaytoneOne-Regular\.ttf'\)\s*format\('truetype'\)/);
});

test('the shout font is the unmodified whole font, in the TTF and in the WOFF2', () => {
  // The OFL reserves the name "Paytone One", so a subset or a re-encode under
  // that name is a licence problem, and a hand-edited mirror would hide it.
  // The copy is checked against the kit above; this pins what the kit
  // must have put there (the canonical repo's own test decodes the WOFF2 table
  // by table). Both files are read whole, never trimmed to latin.
  const dir = path.join(PUBLIC, 'brand', 'fonts');
  const ttf = readFileSync(path.join(dir, 'PaytoneOne-Regular.ttf'));
  assert.equal(ttf.length, 114648);
  assert.equal(
    createHash('sha256').update(ttf).digest('hex'),
    '1c07073b0b578199b54c7866d55e2b631d285e8aa4bb4fbc08809d980cd49b14',
    'the TTF is upstream google/fonts ofl/paytoneone, Version 1.002, byte for byte'
  );
  const woff2 = readFileSync(path.join(dir, 'paytone-one-full-400-normal.woff2'));
  assert.equal(woff2.toString('latin1', 0, 4), 'wOF2');
  assert.equal(woff2.readUInt32BE(8), woff2.length, 'the header knows its own length');
  assert.equal(woff2.readUInt16BE(12), ttf.readUInt16BE(4), 'every table of the TTF, none dropped');
  assert.equal(woff2.readUInt32BE(16), ttf.length, 'it expands to exactly the whole TTF');
  const licence = readFileSync(path.join(dir, 'OFL-PaytoneOne.txt'), 'utf8');
  assert.match(licence, /Reserved Font Names? "?'?Paytone/i);
  assert.match(licence, /SIL OPEN FONT LICENSE Version 1\.1/i);
});

test('every shout size keeps the caps as tall as the Galindo it was tuned on', () => {
  // Galindo's H stood .725 em tall; Paytone One's stands .688. The shout sizes
  // in style.css were drawn for the first, so each is multiplied by
  // --jr-shout-fit. The number must follow the font that ships: swap the shout
  // again and this fails until the fit (and the lift) are measured afresh.
  const GALINDO_CAP_EM = 0.725;
  const ttf = readFileSync(path.join(PUBLIC, 'brand', 'fonts', 'PaytoneOne-Regular.ttf'));
  const cap = os2(ttf).capHeight / unitsPerEm(ttf);
  assert.equal(cap, 0.688);
  const fit = parseFloat(styleCss.match(/--jr-shout-fit:\s*([\d.]+)\s*;/)[1]);
  assert.ok(
    Math.abs(fit * cap - GALINDO_CAP_EM) < 0.01,
    `--jr-shout-fit ${fit} x ${cap} em is within 1% of ${GALINDO_CAP_EM} em`
  );

  // Every rule that sets the shout face scales its size by the fit, so a new
  // shout rule cannot quietly draw its caps 5% short.
  const shoutRules = rules(styleCss).filter((r) => /font-family:\s*var\(--jr-font-shout\)/.test(r.body));
  assert.ok(shoutRules.length >= 5, 'the placeholder, splash, loading, caption and settings rules');
  for (const { selector, body } of shoutRules) {
    const size = body.match(/font-size:\s*([^;]+);/);
    assert.ok(size, `${selector} sets a size`);
    assert.match(size[1], /var\(--jr-shout-fit\)/, `${selector}'s shout size carries the fit`);
  }
});

test('the headlines stacked over other lines sit on the cap line the design was drawn with', () => {
  // Paytone One's ascent (1.113 em) is far above its caps (.688 em), where
  // Galindo's was .983 em over .725, so at one line-height its caps sit about
  // .15 em lower in the box. Lifted by --jr-shout-lift, on paint alone: `top`
  // on a relative box moves nothing else and clips nothing.
  const lift = styleCss.match(/--jr-shout-lift:\s*(-\d*\.?\d+em)\s*;/);
  assert.ok(lift, 'a negative em lift');
  for (const id of ['#journey-splash-title', '#caption-prompt-q', '#journey-loading-text']) {
    const rule = rules(styleCss).find((r) => r.selector === id);
    assert.ok(rule, `${id} has its rule`);
    assert.match(rule.body, /position:\s*relative/, `${id} is a relative box`);
    assert.match(rule.body, /top:\s*var\(--jr-shout-lift\)/, `${id} carries the lift`);
  }
});

test('the page links the kit and loads nothing from the network', () => {
  const links = [...html.matchAll(/<link\b[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  // The kit's three drawn faces are preloaded first (self-hosted, deployed
  // copies; test/stamp-build.test.mjs pins their URLs to the font sheet's).
  const preloads = [...html.matchAll(/<link\b[^>]*rel="preload"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(preloads.length, 3);
  for (const href of preloads) {
    assert.match(href, /^brand\/fonts\/[\w-]+\.woff2$/);
    assert.ok(existsSync(path.join(PUBLIC, href)), `${href} exists`);
  }
  assert.deepEqual(links, [...preloads, 'brand/tokens.css', 'brand/fonts.css', 'src/style.css']);
  for (const src of [...html.matchAll(/<(?:img|script)\b[^>]*src="([^"]+)"/g)].map((m) => m[1])) {
    assert.doesNotMatch(src, /^(https?:)?\/\//, `${src} is self-hosted`);
    assert.ok(existsSync(path.join(PUBLIC, src)), `${src} exists`);
  }
  // Nothing is cross-origin any more: the one site serves the Check-in
  // Display beside this page, at ../lobby/.
  const external = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(external, []);
  assert.match(html, /<iframe\b[^>]*src="\.\.\/lobby\/"/);

  for (const [name, css] of [
    ['style.css', styleCss],
    ['brand/fonts.css', read('brand/fonts.css')],
    ['brand/tokens.css', read('brand/tokens.css')],
  ]) {
    assert.doesNotMatch(stripComments(css), /@import|url\(\s*['"]?(https?:)?\/\//, `${name} fetches nothing remote`);
  }
});

test("every kit fallback in style.css is the kit's own value", () => {
  const tokens = Object.fromEntries(
    [...read('brand/tokens.css').matchAll(/(--brand-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()])
  );
  const norm = (v) => v.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim().toLowerCase();
  const uses = [...stripComments(styleCss).matchAll(/var\((--brand-[\w-]+),\s*((?:[^()]|\([^()]*\))+)\)/g)];
  assert.ok(uses.length >= 10, 'style.css reads the kit through its tokens');
  for (const [, name, fallback] of uses) {
    assert.ok(name in tokens, `${name} is a kit token`);
    assert.equal(norm(fallback), norm(tokens[name]), `${name}'s fallback matches tokens.css`);
  }
});

test("the baked art is the kit's own shapes, path for path", () => {
  const kitPaths = new Set();
  for (const rel of kitFiles) {
    if (!/^(shapes|doodles)\/.*\.svg$/.test(rel)) continue;
    for (const m of read(`brand/${rel}`).matchAll(/\sd="([^"]+)"/g)) kitPaths.add(m[1]);
  }
  const baked = [...styleCss.matchAll(/\sd='([^']+)'/g)].map((m) => m[1]);
  assert.ok(baked.length >= 8, 'the wave, the tab and the doodles are all baked in');
  for (const d of baked) assert.ok(kitPaths.has(d), `baked path ${d.slice(0, 24)}… is in the kit`);
  // Journey's own wave and tab, not another club's; and on Trek's small
  // group card, Trek's wave and tab and the kit's stepped chip.
  for (const rel of [
    'shapes/wave-journey.svg',
    'shapes/tab-c-journey.svg',
    'shapes/wave-trek.svg',
    'shapes/tab-c-trek.svg',
    'shapes/chip-plate.svg',
    'shapes/chip-keyline.svg',
  ]) {
    const d = read(`brand/${rel}`).match(/\sd="([^"]+)"/)[1];
    assert.ok(baked.includes(d), `${rel} is on the page`);
  }
});

test("the colours that were never Journey's are gone", () => {
  // The old kiosk borrowed a red from Awana's general palette and a gold that
  // is not in Journey's palette, and set everything in system type.
  for (const hex of ['#c8102e', '#e8123a', '#a00d25', '#ff2e52', '#f2b705', '#f0b429', '#ff6b83']) {
    assert.equal(styleCss.toLowerCase().includes(hex), false, `${hex} is gone`);
  }
  const systemType = rules(styleCss).filter(
    (r) => /font-family:\s*system-ui/.test(r.body) && !r.selector.includes('#slide-template')
  );
  assert.deepEqual(systemType.map((r) => r.selector), [], 'every face comes from the kit');
});

// Awana's deck as it stood before the kit (8f37f60), declaration for
// declaration: the black pillarbox, the 4:3 stage, the slide images and the
// generated TEMPLATE slide, whose type reproduces the deck's (Calibri/Carlito,
// the deck's own sizes and soft shadow). The kit dresses the controls around
// the deck, never the deck, so a change here is a change to Awana's slides and
// has to be made on purpose, in this table as well as in style.css.
const AWANA_DECK = {
  '#slides-view': [
    'position: absolute',
    'inset: 0',
    'z-index: 6',
    'display: flex',
    'align-items: center',
    'justify-content: center',
    'background: #000000',
  ],
  '#slide-stage': [
    'position: relative',
    'width: min(100vw, calc(100vh * 4 / 3))',
    'height: min(100vh, calc(100vw * 3 / 4))',
    // Added on purpose 2026-10-12: the stage clips the slide-change drift
    // (24-motion.js) so it never slides over the pillarbox; at rest nothing
    // in the stage reaches its edges, so the deck looks exactly as before.
    'overflow: hidden',
    'background: #000000',
    'cursor: pointer',
    'user-select: none',
    '-webkit-user-select: none',
  ],
  '#slide-image': ['display: block', 'width: 100%', 'height: 100%', 'object-fit: contain'],
  '#slide-template': [
    'position: absolute',
    'inset: 0',
    'background-size: cover',
    'background-position: center',
    'color: #ffffff',
    'font-family: Calibri, Carlito, system-ui, sans-serif',
    'display: flex',
    'flex-direction: column',
    'padding: calc(min(100vh, 75vw) * 0.055) calc(min(100vw, 133.33vh) * 0.07) calc(min(100vh, 75vw) * 0.05)',
    'text-shadow: 0 2px 8px rgba(0, 0, 0, 0.35)',
  ],
  '#slide-template-heading': [
    'flex: none',
    'text-align: center',
    'font-weight: 400',
    'font-size: calc(min(100vh, 75vw) * 0.105)',
    'line-height: 1.15',
    'margin-bottom: calc(min(100vh, 75vw) * 0.07)',
  ],
  '#slide-template-bullets': [
    'flex: 1',
    'min-height: 0',
    'list-style: none',
    'margin: 0',
    'padding: 0 0 0 calc(min(100vw, 133.33vh) * 0.02)',
    'font-size: calc(min(100vh, 75vw) * 0.052)',
    'line-height: 1.28',
    'display: flex',
    'flex-direction: column',
    'gap: calc(min(100vh, 75vw) * 0.045)',
  ],
  '#slide-template-bullets li': ['position: relative', 'padding-left: 1.1em'],
  '#slide-template-bullets li::before': ["content: '\\2022'", 'position: absolute', 'left: 0'],
};

test("Awana's deck keeps its own look, the template slide's type included", () => {
  const declarations = (body) =>
    body
      .split(';')
      .map((d) => d.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  // Every rule that names the deck's elements, wherever it sits (a second
  // rule for #slide-template-heading, or one inside a media query, counts).
  const deck = rules(styleCss).filter((r) => /#slides-view|#slide-(?:stage|image|template)/.test(r.selector));
  assert.deepEqual(
    deck.map((r) => r.selector),
    Object.keys(AWANA_DECK),
    'no other rule reaches into the deck'
  );
  for (const { selector, body } of deck) {
    assert.deepEqual(declarations(body), AWANA_DECK[selector], `${selector} is exactly as Awana's deck has it`);
  }
  // The slide transitions (24-motion.js) animate the deck's layers from
  // script and leave every declaration above alone; the one stylesheet rule
  // they add is the heading's words as boxes, with motion on only, changing
  // nothing else about the type.
  const words = rules(styleCss).filter((r) => /\.jm-word/.test(r.selector));
  assert.deepEqual(
    words.map((r) => [r.selector, declarations(r.body)]),
    [['html.motion-full .jm-word', ['display: inline-block']]]
  );
});

/* style.css split where a reduced-motion page stops matching: the one motion
   block (`@media (prefers-reduced-motion: no-preference) { html.motion-full
   ... }`, whose class 24-motion.js sets outside configure mode and reduced
   motion) and everything else. Found by brace matching, so nothing hides in it unseen. */
const MOTION_OPEN = '@media (prefers-reduced-motion: no-preference) {';
function splitMotionBlock(css) {
  const start = css.indexOf(MOTION_OPEN);
  assert.notEqual(start, -1, 'the motion block exists');
  assert.equal(css.indexOf(MOTION_OPEN, start + 1), -1, 'one motion block');
  let depth = 0;
  let end = start + MOTION_OPEN.length - 1;
  for (; end < css.length; end += 1) {
    if (css[end] === '{') depth += 1;
    if (css[end] === '}') depth -= 1;
    if (depth === 0) break;
  }
  return { still: css.slice(0, start) + css.slice(end + 1), motion: css.slice(start + MOTION_OPEN.length, end) };
}

test('the flat look: one keyframe outside the motion block, no filters, no gradients, no blur', () => {
  const css = stripComments(styleCss);
  // What a reduced-motion page can match is everything outside the motion
  // block: there the splash's opacity pulse is the only keyframe and the
  // only animation.
  const { still } = splitMotionBlock(css);
  assert.deepEqual([...still.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]), ['journey-splash-pulse']);
  for (const m of still.matchAll(/animation(?:-name)?\s*:\s*([^;]+);/g)) {
    assert.match(m[1], /^journey-splash-pulse\b/, 'the pulse is the only animation');
  }
  assert.doesNotMatch(still, /motion-full|\bjm-/, 'nothing outside the block names the motion');
  // The property itself, prefixed or not (Chromium still honours
  // -webkit-filter), in any case: CSS property names ignore it.
  assert.doesNotMatch(css, /(^|[\s;{])(-[a-z]+-)?filter\s*:/i, 'no filters');
  assert.doesNotMatch(css, /backdrop-filter/i, 'no backdrop blur');
  assert.doesNotMatch(css, /gradient\(/i, 'flat fills only');

  // Every shadow is a hard offset (zero blur). The one exception is Awana's
  // own template slide, whose soft text shadow copies the deck.
  for (const { selector, body } of rules(styleCss)) {
    for (const m of body.matchAll(/(?:box|text)-shadow\s*:\s*([^;]+)/g)) {
      if (m[1].trim() === 'none') continue;
      for (const shadow of splitTop(m[1])) {
        const lengths = splitTop(shadow, ' ').filter((t) => /^-?[\d.]+[a-z%]*$/.test(t));
        const blur = lengths[2] || '0';
        if (selector === '#slide-template') continue;
        assert.equal(parseFloat(blur), 0, `${selector}: "${shadow}" has no blur`);
      }
    }
  }
});

test("the motion is fenced: html.motion-full only, cheap properties only", () => {
  const { motion } = splitMotionBlock(stripComments(styleCss));
  // Every rule in the block (keyframe steps aside) needs html.motion-full, so
  // a page without the class (configure mode, reduced motion) matches none
  // of them.
  const step = /^(from|to|\d+(\.\d+)?%)(\s*,\s*(from|to|\d+(\.\d+)?%))*$/;
  const selectors = rules(motion).map((r) => r.selector).filter((sel) => !step.test(sel));
  assert.ok(selectors.length > 20);
  for (const sel of selectors) {
    for (const one of splitTop(sel)) assert.match(one, /^html\.motion-full\b/, `${one} is scoped to html.motion-full`);
  }
  // Its keyframes are its own (jm-) and move only transform, opacity and
  // clip-path; its animations name only them; no transitions.
  const names = [...motion.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  assert.ok(names.length > 5);
  for (const name of names) assert.match(name, /^jm-/);
  for (const block of motion.matchAll(/@keyframes\s+[\w-]+\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
    for (const frame of block[1].matchAll(/\{([^{}]*)\}/g)) {
      for (const decl of frame[1].split(';').map((d) => d.trim()).filter(Boolean)) {
        assert.match(decl, /^(transform|opacity|clip-path|animation-timing-function)\s*:/, `keyframes move only cheap properties: ${decl}`);
      }
    }
  }
  for (const m of motion.matchAll(/animation(?:-name)?\s*:\s*([^;]+);/g)) {
    const name = m[1].trim().match(/^[\w-]+/)[0];
    assert.ok(names.includes(name), `${m[1]} names one of the block's own keyframes`);
  }
  assert.doesNotMatch(motion, /transition\s*:/, 'entrances are keyframes, never transitions');
});

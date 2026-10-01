import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chipGeometry } from './brand.js';

// public/about.html is the plain-language page for church leadership. It is a
// static file outside the Vite graph, so nothing else would notice if its
// screen recreations drifted from the screens. Owner decision 2026-09-29:
// Galindo "looks too much like SpongeBob", and every screen moved to Paytone
// One; this page kept loading Galindo from Google Fonts until the live smoke
// check found it. These pin the page to the kit (CLAUDE.md, "About page").

const ROOT = resolve(__dirname, '../..');
const html = readFileSync(resolve(ROOT, 'public/about.html'), 'utf8');
// What the browser actually acts on: the story a comment tells is allowed.
const live = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const style = live.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';

describe('the about page wears the family kit\'s faces', () => {
  it('names neither Galindo nor Lilita One anywhere it is drawn or requested', () => {
    expect(live).not.toMatch(/galindo/i);
    // The projector retired Lilita One with the rebrand; only the fall
    // posters keep it, and this page draws no poster.
    expect(live).not.toMatch(/lilita/i);
  });

  it('asks Google Fonts only for its editorial faces, never a brand face', () => {
    const families = [...live.matchAll(/fonts\.googleapis\.com\/css2\?([^"']+)/g)]
      .flatMap(([, query]) => [...query.replace(/&amp;/g, '&').matchAll(/family=([^:&@]+)/g)].map((m) => m[1]));
    expect(families.sort()).toEqual(['Fraunces', 'IBM+Plex+Mono', 'Source+Sans+3']);
  });

  it('loads Paytone One, Londrina Solid and Figtree from the kit\'s own fonts.css', () => {
    expect(live).toMatch(/<link[^>]+rel="stylesheet"[^>]+href="shared\/brand\/fonts\.css"/);
    const fontsCss = readFileSync(resolve(ROOT, 'shared/brand/fonts.css'), 'utf8');
    for (const family of ['Paytone One', 'Londrina Solid', 'Figtree']) {
      expect(fontsCss).toContain(`font-family: '${family}'`);
    }
    // Every file the sheet names is really in the kit the build copies to /shared/.
    for (const [, file] of fontsCss.matchAll(/url\('([^']+)'\)/g)) {
      expect(existsSync(resolve(ROOT, 'shared/brand', file)), file).toBe(true);
    }
  });

  it('names the three voices once, on :root, shout first', () => {
    const token = (name) => style.match(new RegExp(`--cid-${name}:\\s*([^;]+);`))?.[1] ?? '';
    expect(token('shout')).toMatch(/^"Paytone One"/);
    expect(token('label')).toMatch(/^"Londrina Solid"/);
    expect(token('read')).toMatch(/^"Figtree"/);
    expect(style).not.toMatch(/--cid-poster/);
  });

  it('spells no family in a rule but the three voices and their fallbacks', () => {
    const allowed = new Set([
      'Paytone One', 'Arial Rounded MT Bold', 'Londrina Solid', 'Arial Narrow', 'Figtree', 'Segoe UI',
    ]);
    // Any declaration that can name a family: the three tokens, font, font-family.
    const named = [...style.matchAll(/(?:--cid-(?:shout|label|read)|font(?:-family)?)\s*:[^;}]+/g)]
      .flatMap(([decl]) => [...decl.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
    expect(new Set(named)).toEqual(allowed);
  });

  it('never asks a one-weight face for a bold it does not have', () => {
    expect(style).toMatch(/\.cid-scr\s*\{[^}]*font-synthesis-weight:\s*none/);
    // The lobby headline is 400, as on the real screens.
    expect(style).toMatch(/\.cid-slide__text\s*\{[^}]*font:\s*400\b/);
  });
});

// The block above pins the css2 request's family list, but a brand face could
// reach the page by any other road: the v1 API (css?family=Paytone+One), a
// third-party mirror, a preload of a woff2, an @import, a page-local
// @font-face. Paytone One's and Londrina's licenses reserve their names, so
// the only copy this page may draw is the kit's own full file. So the test
// lists everything the page fetches from another host and allows exactly one
// thing: the Google stylesheet for the editorial faces (and its preconnects).
describe('nothing but the editorial Google stylesheet comes from another host', () => {
  const attr = (tag, name) => {
    const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    return (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim();
  };
  const links = [...live.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => ({ rel: attr(tag, 'rel').toLowerCase(), href: attr(tag, 'href') }));
  // Absolute (https://x) or protocol-relative (//x), whatever the scheme.
  const isExternal = (url) => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url);
  const isEditorialSheet = (l) => l.rel === 'stylesheet' && /^https:\/\/fonts\.googleapis\.com\/css2\?/.test(l.href);
  const isGooglePreconnect = (l) => l.rel === 'preconnect'
    && ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(l.href);

  it('every <link> to another host is that one stylesheet or a Google preconnect', () => {
    const stray = links.filter((l) => isExternal(l.href) && !isEditorialSheet(l) && !isGooglePreconnect(l));
    expect(stray).toEqual([]);
    expect(links.filter(isEditorialSheet)).toHaveLength(1);
  });

  it('no @import, no page-local @font-face, no url() to another host', () => {
    expect(live).not.toMatch(/@import\b/i);
    expect(live).not.toMatch(/@font-face\b/i);
    const urls = [...live.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)].map((m) => (m[1] ?? m[2] ?? m[3]).trim());
    expect(urls.filter(isExternal)).toEqual([]);
  });

  it('no address on the page names a brand face', () => {
    const addresses = live.match(/(?:https?:)?\/\/[^\s"'<>)]+/gi) ?? [];
    expect(addresses.length).toBeGreaterThan(0);
    expect(addresses.filter((a) => /paytone|londrina|figtree|galindo|lilita/i.test(a))).toEqual([]);
  });
});

describe('the stepped chips are the lobby\'s own geometry around Paytone One\'s widths', () => {
  const chips = [...live.matchAll(/<svg class="cid-step"[\s\S]*?<\/svg>/g)].map(([svg]) => {
    const texts = [...svg.matchAll(/<text [^>]*font-size="([^"]+)" textLength="([^"]+)"[^>]*>([^<]*)<\/text>/g)]
      .map(([, size, width, text]) => ({ size: Number(size), width: Number(width), text }));
    return { svg, plate: svg.match(/class="cid-step__plate" d="([^"]+)"/)?.[1] ?? '', texts };
  });
  const nums = (d) => d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  // The proportions live in brand.js; a 1-em label and value read them back.
  const unit = chipGeometry(1, 1);

  it('the page carries the four chips its screens show', () => {
    expect(chips.map((c) => c.texts.map((t) => t.text).join(' '))).toEqual([
      'CLEAR SKIES 58°', 'WAITING 3', 'RIGHT NOW 8:05', 'RIGHT NOW 8:05',
    ]);
  });

  it.each([0, 1, 2, 3])('chip %i draws the label and value at the current sizes on a plate that hugs them', (i) => {
    const { plate, texts } = chips[i];
    const [label, value] = texts;
    expect(label.size).toBe(unit.label.size);
    expect(value.size).toBe(unit.value.size);
    // Rebuild the plate from the widths the text is pinned to.
    const g = chipGeometry(label.width / unit.label.size, value.width / unit.value.size);
    const got = nums(plate);
    const want = nums(g.d);
    expect(got.length).toBe(want.length);
    got.forEach((n, k) => expect(Math.abs(n - want[k])).toBeLessThan(0.003));
  });
});

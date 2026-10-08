import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HOST_CONTROL, hostClearancePx, isEmbedded } from './embed.js';

// Embedded in the Journey kiosk's iframe, Journey keeps its two buttons in one
// column in the bottom-right corner, and the signage keeps what it draws
// there out of it (src/lib/embed.js). The geometry is spelled twice, once
// there for the name fit and once in app.css for everything CSS lays out;
// this pins the two to each other and to Journey's buttons, that the
// top-right is left alone, and that none of it can reach a standalone screen.

const css = readFileSync(resolve(__dirname, '../styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every { selector, body } rule in the sheet, @media blocks flattened. */
function rules(src) {
  const out = [];
  let i = 0;
  const walk = (end) => {
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
      if (head.startsWith('@media') || head.startsWith('@supports')) {
        i = open + 1;
        walk(j - 1);
      } else if (!head.startsWith('@')) {
        out.push({ selector: head.replace(/\s+/g, ' '), body: src.slice(open + 1, j - 1) });
      }
      i = j;
    }
  };
  walk(src.length);
  return out;
}
const ALL = rules(css);
const decl = (body, prop) => body.match(new RegExp(`(?:^|;)\\s*${prop.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+)`))?.[1].replace(/\s+/g, ' ').trim();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isEmbedded', () => {
  it('is false for a page that is its own top window (jsdom, a TV, the projector)', () => {
    expect(isEmbedded()).toBe(false);
  });

  it('is true inside another page\'s frame', () => {
    vi.stubGlobal('top', { name: 'the Journey kiosk' });
    expect(isEmbedded()).toBe(true);
  });

  it('counts a browser that refuses to answer as framed', () => {
    const spy = vi.spyOn(window, 'top', 'get').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(isEmbedded()).toBe(true);
    spy.mockRestore();
  });
});

describe('hostClearancePx: Journey\'s corner column, plus the gap', () => {
  // Journey-Display public/src/style.css: #toggle-btn (and #settings-btn
  // stacked above it while this display shows) are 48px wide, right:
  // max(3vw, 24px).
  it.each([
    [640, 24 + 48 + 8],
    [592, 24 + 48 + 8],
    [1280, 38.4 + 48 + 8],
    [1920, 57.6 + 48 + 8],
  ])('at %i wide the host reaches %fpx in from the right edge', (vw, x) => {
    expect(hostClearancePx(vw)).toBeCloseTo(x, 6);
  });

  it('is Journey\'s geometry: 48px buttons, 3% of the width or 24px in, 8px of air', () => {
    expect(HOST_CONTROL).toEqual({ edgePct: 3, edgeMinPx: 24, sizePx: 48, gapPx: 8 });
  });
});

describe('app.css spells the same geometry, embedded only', () => {
  const root = ALL.find((r) => r.selector === 'html.embedded');
  const { edgePct, edgeMinPx, sizePx, gapPx } = HOST_CONTROL;

  it('defines the clearance from HOST_CONTROL', () => {
    expect(root).toBeTruthy();
    expect(decl(root.body, '--host-clear-x')).toBe(`calc(max(${edgePct}vw, ${edgeMinPx}px) + ${sizePx}px + ${gapPx}px)`);
  });

  // What steps LEFT out of the host's column: the bottom corner chip, the
  // ticker with it, and the check-in's name column.
  it.each([
    ['html.embedded .corner-bottom'],
    ['html.embedded .tonight-ticker'],
    ['html.embedded .checkin__copy'],
  ])('%s moves its right edge by the host\'s clearance', (selector) => {
    const rule = ALL.find((r) => r.selector === selector);
    expect(rule, selector).toBeTruthy();
    expect(decl(rule.body, 'right')).toContain('var(--host-clear-x)');
  });

  it('keeps the standalone insets as the floor, so embedding only ever moves chrome inward', () => {
    const bottom = decl(ALL.find((r) => r.selector === 'html.embedded .corner-bottom').body, 'right');
    expect(bottom).toBe(`max(${decl(ALL.find((r) => r.selector === '.corner-bottom').body, 'right')}, var(--host-clear-x))`);
    const copy = decl(ALL.find((r) => r.selector === 'html.embedded .checkin__copy').body, 'right');
    expect(copy).toBe(`max(${decl(ALL.find((r) => r.selector === '.checkin__copy').body, 'right')}, var(--host-clear-x))`);
  });

  // The top-right is this page's own: the band beside it and a raised
  // headline under it leave its stack no room to move, and Journey keeps
  // its buttons out of it (its test/corner-buttons.test.mjs).
  it('leaves the top-right stack alone', () => {
    const embedded = ALL.filter((r) => /html\.embedded/.test(r.selector));
    for (const r of embedded) expect(r.selector).not.toMatch(/corner-stack|corner-top|status-dot|sticker-chip/);
  });

  it('never reaches a standalone screen: every rule that reads the clearance is scoped to html.embedded', () => {
    const readers = ALL.filter((r) => /--host-clear-/.test(r.body));
    expect(readers.length).toBeGreaterThanOrEqual(4);
    for (const r of readers) {
      for (const sel of r.selector.split(',')) expect(sel.trim(), r.selector).toMatch(/^html\.embedded\b/);
    }
  });
});

describe('app.css: the operator\'s panels and a wrapped ticker keep out of the column too', () => {
  const rule = (selector, prop) => ALL.find((r) => r.selector === selector && (!prop || decl(r.body, prop)));
  const rem = (v) => Number(/^([\d.]+)rem$/.exec(v)?.[1]);

  // Settings and the slide editor centre on .panel-backdrop at 94-96vw, so
  // on a small screen (the Pi's 640x480, 800x480, 1024x768) their action row
  // ran under the host's column: a click on the right end of SAVE landed on
  // the host's gear and opened ITS panel, and Settings stayed open unsaved.
  it('Settings and the slide editor centre in the room left of the column', () => {
    const backdrop = rule('html.embedded .panel-backdrop');
    expect(backdrop).toBeTruthy();
    expect(decl(backdrop.body, 'padding-right')).toBe('var(--host-clear-x)');
    // An auto track grows to the panel's own width, and the panel with it.
    expect(decl(backdrop.body, 'grid-template-columns')).toBe('minmax(0, 1fr)');
    expect(decl(rule('html.embedded .panel--tabbed').body, 'max-width')).toBe('100%');
  });

  // Parked top-left, it ran under the host's toggle at 640 wide (its Close
  // button among it). Its cap counts the furthest in it is ever parked.
  it('the debug panel ends short of the column wherever it is parked', () => {
    const max = decl(rule('html.embedded .debug').body, 'max-width');
    const m = /^calc\(100% - ([\d.]+rem) - var\(--host-clear-x\)\)$/.exec(max);
    expect(m, max).toBeTruthy();
    const lefts = ALL.filter((r) => r.selector === '.debug').map((r) => decl(r.body, 'left')).filter(Boolean);
    expect(lefts.length).toBeGreaterThanOrEqual(2); // 1.5rem, and 0.75rem on a small screen
    for (const left of lefts) expect(rem(left)).toBeLessThanOrEqual(rem(m[1]));
  });

  it('the first-run card ends short of the column (90vw of a phone ran under it)', () => {
    // Both of its layouts: the strip (right of the gear, short of the corner
    // chip) and, under 640px, the card stacked above the gear.
    const own = ALL.filter((r) => r.selector === '.panel.setup-card' && decl(r.body, 'right')).map((r) => decl(r.body, 'right'));
    expect(own).toEqual(['calc(19.2 * var(--u))', 'var(--safe-inset)']);
    const embedded = ALL.filter((r) => r.selector === 'html.embedded .panel.setup-card');
    expect(embedded.map((r) => decl(r.body, 'right'))).toEqual([`max(${own[0]}, var(--host-clear-x))`, 'var(--host-clear-x)']);
    // Its edge, not a max-width: margin-inline centres the card, so a
    // narrower one would only move its right edge half as far.
    for (const r of embedded) expect(decl(r.body, 'max-width')).toBeFalsy();
  });

  // The pickup board's strip ends a gap short of the corner chip; embedded,
  // the chip steps left of the host's column, so the strip's edge moves with
  // it by exactly the chip's shift (owner, 2026-10-07: the board in the foot).
  it('the pickup board\'s strip ends short of the corner chip wherever the chip has gone', () => {
    const own = decl(rule('.checkout-region, .checkout-leaves', 'right').body, 'right');
    expect(own).toBe('calc(19.2 * var(--u))');
    const chip = decl(rule('html.embedded .corner-bottom').body, 'right');
    expect(chip).toBe('max(calc(2.6 * min(1vw, 1.7778vh)), var(--host-clear-x))');
    // 19.2u standalone is the chip's 2.6u plus 16.6u; embedded, the chip's own
    // right edge plus the same 16.6u.
    expect(decl(rule('html.embedded .checkout-region, html.embedded .checkout-leaves').body, 'right'))
      .toBe('calc(max(2.6 * var(--u), var(--host-clear-x)) + 16.6 * var(--u))');
    // The Settings preview draws a TV, not this screen: it keeps the TV's edge.
    expect(decl(rule('html.embedded .board-preview .checkout-region').body, 'right')).toBe(own);
  });

  // Centred between the gear and the widest chip, the widest night is still
  // wider than that room on a portrait phone (390x844: 226px in 174px), and it
  // ran 26px under the shifted clock chip. It is capped to exactly the room
  // its centring counts, and wraps into rows instead.
  it('the ticker is capped to the room between the gear and the widest corner chip, and wraps into it', () => {
    const ticker = rule('html.embedded .tonight-ticker');
    const max = decl(ticker.body, 'max-width');
    const right = decl(ticker.body, 'right');
    expect(max).toContain('100% - var(--host-clear-x)');
    // ...less the ticker's own stat gap on each side, so it never touches either.
    expect(max).toMatch(/- 1\.6 \* var\(--u\) \)$/);
    expect(decl(rule('.tonight-ticker', 'position').body, 'gap')).toBe('calc(0.8 * var(--u))');
    for (const term of ['15.3 * var(--u)', 'var(--safe-inset)', 'max(52px, 2.9 * var(--u))']) {
      expect(right, term).toContain(term);
      expect(max, term).toContain(term);
    }
    // ...and never wider than it is standalone.
    expect(max).toContain(decl(rule('.tonight-ticker', 'position').body, 'max-width').replace(/^calc\((.*)\)$/, '$1'));
    expect(decl(ticker.body, 'flex-wrap')).toBe('wrap');
  });
});

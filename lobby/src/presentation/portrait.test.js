import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMING_UP, COMING_UP_PORTRAIT, comingUpLayout } from './views/Slide.jsx';
import { PLEDGE_FIT, PLEDGE_FIT_PORTRAIT, fitPledge } from './lib/pledgeFit.js';
import { AWANA_PLEDGE_TEXT, US_PLEDGE_TEXT } from './config.js';
import { PORTRAIT_QUERY } from './lib/touch.js';
import { chipGeometry, inkEm, measureEm, wrapRows } from './lib/chip.js';

// Upright on a phone or tablet the projector's frame is 9:16 (index.css's
// portrait block, gated on lib/touch.js PORTRAIT_QUERY): u stays 1% of the
// frame's width and the frame is 177.78u tall. The components lay out from
// portrait tables that restate that block; these pin the two together, as
// Slide.test.jsx pins the 16:9 tables to the rules above it.

const css = readFileSync(resolve(__dirname, 'index.css'), 'utf8');
const portrait = (() => {
  const at = css.indexOf(`@media ${PORTRAIT_QUERY} {`);
  if (at < 0) throw new Error('no portrait block in index.css');
  return css.slice(at);
})();
/** An indented rule's declarations inside the portrait block. */
const rule = (selector) => {
  const esc = selector.replace(/[.()>:[\]]/g, (c) => `\\${c}`);
  const m = portrait.match(new RegExp(`\\n  ${esc}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no ${selector} rule in the portrait block`);
  return m[1];
};
const u = (n) => `calc\\(${n} \\* var\\(--u\\)\\)`;

describe('the portrait frame', () => {
  it('is 9:16 on the same unit, so every width fit holds', () => {
    expect(portrait).toMatch(/--u: min\(1vw, 0\.5625vh\);/);
    expect(portrait).toMatch(/--u: min\(1vw, 0\.5625svh\);/);
    expect(rule('.pj-frame')).toMatch(new RegExp(`height: ${u(COMING_UP_PORTRAIT.frame)};`));
    expect(COMING_UP_PORTRAIT.frame).toBeCloseTo((100 * 16) / 9, 1);
  });

  it('lays the Upcoming Awana Nights out on the numbers the portrait block uses', () => {
    expect(rule('.pj-slide:has(> .pj-chip-row)')).toMatch(new RegExp(`top: ${u(COMING_UP_PORTRAIT.top)};`));
    expect(rule('.pj-chip-row')).toMatch(new RegExp(`gap: ${u(COMING_UP_PORTRAIT.gapY)} ${u(COMING_UP_PORTRAIT.gapX)};`));
    expect(COMING_UP_PORTRAIT.bottom).toBeLessThan(COMING_UP_PORTRAIT.frame);
    // The same widths as the wall's: only the heights changed.
    expect(COMING_UP_PORTRAIT.row).toBeLessThanOrEqual(100);
    expect(COMING_UP.frame).toBe(56.25);
  });

  it('fits five long nights inside the column', () => {
    const chips = Array.from({ length: 5 }, (_, i) => ({ label: `WED OCT ${i + 1}`, value: 'Bring a Friend Night - Posters due' }));
    const { listTopU, sizeU, count } = comingUpLayout('Upcoming Awana Nights', chips, COMING_UP_PORTRAIT);
    expect(count).toBe(5);
    expect(sizeU).toBeGreaterThanOrEqual(COMING_UP_PORTRAIT.minU);
    const w = chips.map(({ label, value }) => chipGeometry(measureEm(label), measureEm(value), inkEm(value)).width * sizeU);
    const h = chipGeometry(measureEm(chips[0].label), measureEm(chips[0].value), inkEm(chips[0].value)).height * sizeU;
    const rows = wrapRows(w, COMING_UP_PORTRAIT.row, COMING_UP_PORTRAIT.gapX);
    expect(listTopU + rows * h + (rows - 1) * COMING_UP_PORTRAIT.gapY).toBeLessThanOrEqual(COMING_UP_PORTRAIT.bottom + 1e-6);
  });

  it('sets both pledges bigger than the wall does, inside the column', () => {
    for (const body of [US_PLEDGE_TEXT, AWANA_PLEDGE_TEXT]) {
      const wall = fitPledge(body);
      const tall = fitPledge(body, undefined, PLEDGE_FIT_PORTRAIT);
      expect(tall.bodyU).toBeGreaterThan(wall.bodyU);
      expect(tall.topU).toBeGreaterThanOrEqual(PLEDGE_FIT_PORTRAIT.top);
      expect(tall.topU + tall.heightU).toBeLessThanOrEqual(PLEDGE_FIT_PORTRAIT.bottom + 1e-6);
    }
    // The wall's own table is untouched.
    expect(fitPledge(US_PLEDGE_TEXT, undefined, PLEDGE_FIT)).toEqual(fitPledge(US_PLEDGE_TEXT));
  });

  it('keeps a slide\'s words clear of the controls and the note at the bottom', () => {
    expect(PLEDGE_FIT_PORTRAIT.bottom).toBeLessThanOrEqual(COMING_UP_PORTRAIT.bottom);
    expect(COMING_UP_PORTRAIT.bottom).toBeLessThanOrEqual(122);
  });
});

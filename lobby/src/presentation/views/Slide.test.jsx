import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { COMING_UP, Slide } from './Slide.jsx';
import { wrapRows } from '../lib/chip.js';

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
/** The declarations of one rule in index.css. */
const rule = (selector) => {
  const m = css.match(new RegExp(`(?:^|\\n)${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no ${selector} rule in index.css`);
  return m[1];
};
/** "calc(3.2 * var(--u))" -> 3.2 */
const units = (length) => {
  const m = String(length).match(/^calc\(([0-9.]+) \* var\(--u\)\)$/);
  if (!m) throw new Error(`not a unit length: ${length}`);
  return Number(m[1]);
};

const COMING_UP_SLIDE = { id: 'coming-up', layout: 'coming-up', title: 'Upcoming Awana Nights' };
const night = (day, title, isSpecial = !/awana meeting/i.test(title)) => ({
  date: new Date(`2026-${day}T12:00:00`),
  title,
  isSpecial,
  daysUntil: 0,
});

/**
 * Lay the rendered slide out the way the browser does (jsdom has no layout):
 * the slide block's top, the headline's line, the list's margin, then the
 * chips at their rendered sizes, wrapped as flex-wrap wraps them. Returns
 * where the last row ends and the widest chip, in projector units.
 */
function layOut(container) {
  const head = units(container.querySelector('.pj-headline').style.fontSize);
  const row = container.querySelector('.pj-chip-row');
  const chips = [...row.querySelectorAll('.pj-chip')].map((chip) => {
    const size = units(chip.style.fontSize);
    return { w: parseFloat(chip.style.width) * size, h: parseFloat(chip.style.height) * size };
  });
  const rows = wrapRows(chips.map((c) => c.w), units(row.style.maxWidth), COMING_UP.gapX);
  const listTop = COMING_UP.top + head * COMING_UP.headlineLine + units(row.style.marginTop);
  return {
    count: chips.length,
    bottom: listTop + rows * chips[0].h + (rows - 1) * COMING_UP.gapY,
    widest: Math.max(...chips.map((c) => c.w)),
  };
}

describe('the Upcoming Awana Nights slide', () => {
  afterEach(cleanup);

  // A run of nights shaped like the feed the church publishes
  // (public/calendar-feed.json): most weeks carry a long special title, and a
  // long title takes a row to itself. At a fixed 3.2u the fourth row fell off
  // the bottom of the wall.
  it('fits a run of nights like the church\'s feed (three long names, two short) inside the wall', () => {
    const events = [
      night('09-30', 'Awana meeting (Making Bookmarks)', true),
      night('10-07', 'Awana meeting (Making Bookmarks)', true),
      night('10-14', 'Bring a Friend Night - Posters due'),
      night('10-21', 'Awana meeting'),
      night('10-28', 'Awana meeting'),
    ];
    const { container } = render(<Slide slide={COMING_UP_SLIDE} now={new Date('2026-09-30T19:31:00')} events={events} />);
    const out = layOut(container);
    expect(out.count).toBe(5);
    expect(out.bottom).toBeLessThanOrEqual(COMING_UP.bottom);
    expect(out.widest).toBeLessThanOrEqual(COMING_UP.row);
  });

  it('five long names end inside the wall too, never below the size floor', () => {
    const events = ['09-30', '10-07', '10-14', '10-21', '10-28'].map((d) => night(d, 'Bring a Friend Night - Posters due'));
    const { container } = render(<Slide slide={COMING_UP_SLIDE} now={new Date('2026-09-30T19:31:00')} events={events} />);
    const out = layOut(container);
    expect(out.count).toBeGreaterThan(0);
    expect(out.bottom).toBeLessThanOrEqual(COMING_UP.bottom);
    expect(out.widest).toBeLessThanOrEqual(COMING_UP.row);
    const size = units(container.querySelector('.pj-chip').style.fontSize);
    expect(size).toBeGreaterThanOrEqual(COMING_UP.minU);
    // The soonest nights are the ones kept.
    expect(container.querySelector('.pj-chip').getAttribute('aria-label')).toMatch(/SEP 30/);
  });

  it('short names keep the full-size chips', () => {
    const events = [night('09-30', 'Awana'), night('10-07', 'Awana')];
    const { container } = render(<Slide slide={COMING_UP_SLIDE} now={new Date('2026-09-30T19:31:00')} events={events} />);
    expect(units(container.querySelector('.pj-chip').style.fontSize)).toBe(COMING_UP.maxU);
  });

  it('lays out on the numbers index.css actually uses', () => {
    expect(rule('.pj-slide')).toMatch(new RegExp(`top: calc\\(${COMING_UP.top} \\* var\\(--u\\)\\);`));
    expect(rule('.pj-frame')).toMatch(new RegExp(`height: calc\\(${COMING_UP.frame} \\* var\\(--u\\)\\);`));
    expect(rule('.pj-chip-row')).toMatch(
      new RegExp(`gap: calc\\(${COMING_UP.gapY} \\* var\\(--u\\)\\) calc\\(${COMING_UP.gapX} \\* var\\(--u\\)\\);`),
    );
    expect(rule('.pj-headline')).toMatch(new RegExp(`line-height: ${COMING_UP.headlineLine};`));
    expect(COMING_UP.bottom).toBeLessThan(COMING_UP.frame);
  });
});

import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZeroAnimationContext } from '../lib/motion.jsx';
import { getClubPalette } from '../lib/clubs.js';
import { bookMilestoneCopy } from '../lib/milestones.js';
import { firstOfNightCopy } from '../lib/firstOfNight.js';
import { bandRoom, fitShout, plateChrome } from '../lib/overlayFit.js';
import { PLATE, SHOUT_BOX } from '../lib/brand.js';
import MilestoneToast, { LINE, toastBox, toastFit, toastFor } from './MilestoneToast.jsx';

const css = readFileSync(resolve(__dirname, '../styles/app.css'), 'utf8');

afterEach(cleanup);
const still = (ui) => render(<ZeroAnimationContext.Provider value>{ui}</ZeroAnimationContext.Provider>);

// Paytone One's ink per letter, in em (fontTools; the boxes the canvas reports
// on a real screen, as src/lib/inkCanvas.test.js fakes them): caps stand
// 0.688, Á and É's accents reach 1.045, Ễ's stacked marks 1.161, and Ș's
// comma hangs to -0.351.
const UP = { Á: 1.045, É: 1.045, Ễ: 1.161 };
const DOWN = { Ș: 0.351, Ț: 0.351 };
const paytoneInk = (text) => {
  const letters = [...String(text).normalize('NFC')];
  return {
    ascent: Math.max(...letters.map((ch) => UP[ch] || 0.688)),
    descent: Math.max(...letters.map((ch) => DOWN[ch] || 0.016)),
  };
};

// The plate as StepPlate draws it, in u from the block's top edge (the
// keyline's centre): its padding, the keyline, and the fill printed DROP
// below it, so the room's background shows between the two (brand.js PLATE).
const PAD = 0.6;
const PILL = 1.45 * 2.05;
const KEYLINE = PILL * PLATE.keyline;
const DROP = PILL * PLATE.offsetY;
// Where the caps' baseline sits in a line box at LINE.lineHeight, em.
const ABOVE = (SHOUT_BOX.ascent - SHOUT_BOX.descent + LINE.lineHeight) / 2;

/** The rows' ink on the block, in u from its top edge, and the block's height. */
function onPlate(rows, fit, inkOf = paytoneInk) {
  let top = PAD + fit.padTop;
  const out = rows.map((row, i) => {
    top += (fit.rise[i] || 0) * fit.size;
    const ink = inkOf(row.toUpperCase());
    const baseline = top + ABOVE * fit.size;
    top += LINE.lineHeight * fit.size;
    return { top: baseline - ink.ascent * fit.size, bottom: baseline + (ink.descent + LINE.shadow) * fit.size };
  });
  return { rows: out, height: top + fit.padBottom + PAD };
}

describe('toastFor', () => {
  it('keeps every kind\'s own copy and its e2e class', () => {
    expect(toastFor({ kind: 'club', club: 'Sparks', count: 20 })).toMatchObject({
      label: 'Sparks', line: '20 kids strong!', className: 'milestone-toast club-milestone', tone: 'club',
    });
    expect(toastFor({ kind: 'kid', firstName: 'Ava', club: 'Sparks', count: 10 })).toMatchObject({
      label: 'Ava’s', line: '10th club night!', className: 'milestone-toast kid-milestone', tone: 'club',
    });
    expect(toastFor({ kind: 'tally', count: 25 })).toMatchObject({
      label: 'Checked in tonight', line: '25 kids!', className: 'milestone-toast', tone: 'hot',
    });
    expect(toastFor({ kind: 'night', count: 100, label: 'Triple digits', headline: '100 kids tonight!' })).toMatchObject({
      label: 'Triple digits', line: '100 kids tonight!', className: 'milestone-toast night-milestone', tone: 'hot', big: true,
    });
    expect(toastFor({ kind: 'books', count: 5, ...bookMilestoneCopy(5) })).toMatchObject({
      label: 'Handbooks', className: 'milestone-toast night-milestone handbook-milestone books-milestone', tone: 'handbook',
    });
    expect(toastFor({ kind: 'awards', count: 10, label: 'Awards earned', headline: '10 awards earned tonight!' }).className)
      .toBe('milestone-toast night-milestone handbook-milestone awards-milestone');
    expect(toastFor({ kind: 'first', firstName: 'Ava', count: 1, ...firstOfNightCopy('Ava') })).toMatchObject({
      label: 'Doors are open', line: 'Ava is first in tonight!', className: 'milestone-toast first-milestone', big: true,
    });
  });
});

describe('MilestoneToast', () => {
  it('renders nothing without a celebration', () => {
    const { container } = still(<MilestoneToast celebration={null} club={null} />);
    expect(container.querySelector('.milestone-toast')).toBeNull();
  });

  it('a club milestone wears the club\'s colour and wordmark, never the mascot', () => {
    const club = getClubPalette('Sparks');
    const { container } = still(<MilestoneToast celebration={{ kind: 'club', club: 'Sparks', count: 20 }} club={club} />);
    const toast = container.querySelector('.milestone-toast.club-milestone');
    expect(toast.textContent).toContain('20 kids strong!');
    expect(toast.classList.contains('milestone-toast--club')).toBe(true);
    expect(toast.querySelector('.club-logo')).not.toBeNull();
    // The label is the kit chip's Londrina pill.
    expect(toast.querySelector('.step-plate__label.milestone-label').textContent).toBe('Sparks');
  });

  it('a room-wide one has no wordmark and sits on the hot plate', () => {
    const { container } = still(<MilestoneToast celebration={{ kind: 'tally', count: 25 }} club={null} />);
    const toast = container.querySelector('.milestone-toast');
    expect(toast.classList.contains('milestone-toast--hot')).toBe(true);
    expect(toast.querySelector('.club-logo')).toBeNull();
  });

  it('a 40-character first name takes two lines inside the band, under the flag strip too', () => {
    const name = 'Maximilian-Alexander Jonathan-Christophe';
    expect(name).toHaveLength(40);
    const line = firstOfNightCopy(name).headline;
    const fit = toastFit(line, { compact: true });
    expect(fit.fits).toBe(true);
    expect(fit.lines).toHaveLength(2);
    expect(fit.lines.join(' ')).toBe(line);
  });

  it('a line too long even for two is handed to the browser to wrap, never set unbroken', () => {
    const headline = 'Supercalifragilisticexpialidocious-supercalifragilistic!';
    expect(toastFit(headline).fits).toBe(false);
    const { container } = still(<MilestoneToast celebration={{ kind: 'night', count: 100, label: 'Triple digits', headline }} club={null} />);
    const line = container.querySelector('.milestone-count');
    // Unbroken lines (white-space: nowrap) would run the plate past its 50u.
    expect(line.classList.contains('milestone-count--wrap')).toBe(true);
    expect(line.querySelectorAll('.milestone-count__line')).toHaveLength(0);
    expect(line.textContent).toBe(headline);
  });

  it('fits every line to end where the band ends, under the flag strip too, marks and all', () => {
    const lines = [
      '20 kids strong!', '100 kids tonight!', 'Maximilian-Alexander Jonathan is first in tonight!', 'Ava is first in tonight!',
      'Maximilián is first in tonight!', 'Nguyễn is first in tonight!', 'Ștefan is first in tonight!',
      'Ștefan-Alexandru Élodie-Nguyễn is first in tonight!',
    ];
    for (const ink of [undefined, paytoneInk]) {
      for (const compact of [false, true]) {
        for (const text of lines) {
          const f = toastFit(text, { compact }, undefined, ink);
          if (!f.fits) continue;
          const rise = f.rise.reduce((a, r) => a + r, 0) * f.size;
          const reach = plateChrome(1.45) + 1.2 + f.lines.length * f.size * LINE.lineHeight + f.padTop + f.padBottom + rise;
          // Less the plate's out-of-register spill below its box (0.3u).
          expect(reach, `${text}${compact ? ' (compact)' : ''}`).toBeLessThanOrEqual(bandRoom(compact) - 0.3 + 1e-9);
        }
      }
    }
  });

  it('holds stage 4b-2\'s cap heights in Paytone One: its Galindo sizes times 1.057, its line height over it', () => {
    const galindo = { max: 3, min: 2, twoLineMax: 2.2, twoLineMin: 1.4 };
    for (const [k, v] of Object.entries(galindo)) expect(Math.abs(LINE[k] - v * 1.057), k).toBeLessThanOrEqual(0.05);
    expect(Math.abs(LINE.lineHeight - 1.02 / 1.057)).toBeLessThanOrEqual(0.01);
    // The line box the fit counts is the one app.css draws.
    const rule = css.match(/\.milestone-toast \.milestone-count \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(new RegExp(`line-height: ${LINE.lineHeight};`));
    expect(rule).toMatch(new RegExp(`--toast-line, calc\\(${LINE.max} \\* var\\(--u\\)\\)`));
  });

  it('a long first name breaks into two lines that still read as one sentence', () => {
    const c = { kind: 'first', firstName: 'Maximilian-Alexander Jonathan', count: 1, ...firstOfNightCopy('Maximilian-Alexander Jonathan') };
    const { container } = still(<MilestoneToast celebration={c} club={null} />);
    const line = container.querySelector('.milestone-count');
    expect(line.classList.contains('milestone-count--two')).toBe(true);
    expect(line.querySelectorAll('.milestone-count__line')).toHaveLength(2);
    expect(line.textContent).toBe('Maximilian-Alexander Jonathan is first in tonight!');
  });
});

// Paytone One draws its marks far past its caps; the recheck of the font swap
// found MAXIMILIÁN's accent across the block's top keyline, NGUYỄN's tilde
// through the pill's, and ȘTEFAN's comma shadow on the bottom one.
describe('the line\'s marks stay on the plate (toastBox)', () => {
  const gap = (size) => LINE.markGap * size;
  const bare = (size) => ({ size, padTop: 0, padBottom: 0, rise: [0, 0] });

  it('gives plain caps no room, so an ordinary line never moves', () => {
    for (const size of [1.5, 2.1, 2.7, 3.2]) {
      expect(toastBox(['Bartholomew is first in tonight!'], paytoneInk, size)).toEqual({ padTop: 0, padBottom: 0, rise: [0] });
      expect(toastBox(['Anna-Sophia Kristensen', 'is first in tonight!'], paytoneInk, size)).toEqual({ padTop: 0, padBottom: 0, rise: [0, 0] });
    }
  });

  it('lands an accent that crossed the top keyline on the fill, just clear of its edge', () => {
    for (const [text, size] of [['Maximilián is first in tonight!', 2.7], ['Nguyễn is first in tonight!', 3.1], ['José is first in tonight!', 3.2]]) {
      // Unpadded, the mark reaches past the keyline and over the room's background.
      expect(onPlate([text], bare(size)).rows[0].top, text).toBeLessThan(0);
      const box = toastBox([text], paytoneInk, size);
      expect(box.padBottom).toBe(0);
      const { rows } = onPlate([text], { size, ...box });
      expect(rows[0].top, text).toBeGreaterThanOrEqual(DROP + gap(size) - 1e-3);
      // ... and by that much, not more.
      expect(rows[0].top, text).toBeLessThan(DROP + gap(size) + 0.01);
    }
  });

  it('keeps a hanging comma and its shadow off the bottom keyline', () => {
    const size = 3.1;
    const text = 'Ștefan is first in tonight!';
    const unpadded = onPlate([text], bare(size));
    expect(unpadded.rows[0].bottom).toBeGreaterThan(unpadded.height - KEYLINE / 2);
    const box = toastBox([text], paytoneInk, size);
    expect(box.padTop).toBe(0);
    const drawn = onPlate([text], { size, ...box });
    expect(drawn.rows[0].bottom).toBeLessThanOrEqual(drawn.height - KEYLINE / 2 - gap(size) + 1e-3);
  });

  it('opens only the row a lower row\'s marks would crowd', () => {
    const size = 2.2;
    const rows = ['Ștefan-Alexandru', 'Élodie is first in tonight!'];
    expect(onPlate(rows, bare(size)).rows[1].top).toBeLessThan(onPlate(rows, bare(size)).rows[0].bottom);
    const box = toastBox(rows, paytoneInk, size);
    expect(box.rise[0]).toBe(0);
    const drawn = onPlate(rows, { size, ...box });
    expect(drawn.rows[1].top - drawn.rows[0].bottom).toBeGreaterThanOrEqual(gap(size) - 1e-3);
  });
});

describe('toastFit, with the line\'s ink measured', () => {
  const room = (compact) => bandRoom(compact) - plateChrome(1.45) - 1.2 - 0.3;
  const reach = (f, rows) => rows * f.size * LINE.lineHeight + f.padTop + f.padBottom + f.rise.reduce((a, r) => a + r, 0) * f.size;

  it('gives a marked name room and keeps its size, where the band has room for both', () => {
    const plain = toastFit('Maximilian is first in tonight!', {}, undefined, paytoneInk);
    const marked = toastFit('Maximilián is first in tonight!', {}, undefined, paytoneInk);
    expect(plain).toMatchObject({ padTop: 0, padBottom: 0, rise: [0] });
    expect(marked.padTop).toBeGreaterThan(0);
    expect({ size: marked.size, lines: marked.lines }).toEqual({ size: plain.size, lines: ['Maximilián is first in tonight!'] });
  });

  it('under the flag strip, sets a marked line as large as the band still allows', () => {
    const plain = toastFit('Nguyen is first in tonight!', { compact: true }, undefined, paytoneInk);
    const marked = toastFit('Nguyễn is first in tonight!', { compact: true }, undefined, paytoneInk);
    expect(marked.fits).toBe(true);
    expect(marked.size).toBeLessThan(plain.size);
    expect(reach(marked, 1)).toBeLessThanOrEqual(room(true) + 1e-9);
    // A tenth larger would have run past the band's bottom.
    const larger = marked.size + 0.1;
    expect(reach({ size: larger, ...toastBox([marked.lines[0]], paytoneInk, larger) }, 1)).toBeGreaterThan(room(true));
  });

  it('leaves a plain line\'s fit exactly as the width set it', () => {
    for (const compact of [false, true]) {
      for (const text of ['Bartholomew is first in tonight!', '20 kids strong!', 'Maximilian-Alexander Jonathan is first in tonight!']) {
        const f = toastFit(text, { compact }, undefined, paytoneInk);
        expect(f.padTop + f.padBottom + f.rise.reduce((a, r) => a + r, 0), text).toBe(0);
        const { size, lines, fits } = fitShout(text, {
          width: 50 - 1.45 * 2.05 * 0.73 - 2.4,
          max: Math.min(LINE.max, Math.floor((room(compact) / LINE.lineHeight) * 10 + 1e-9) / 10),
          min: LINE.min,
          twoLineMax: Math.min(LINE.twoLineMax, Math.floor((room(compact) / (2 * LINE.lineHeight)) * 10 + 1e-9) / 10),
          twoLineMin: LINE.twoLineMin,
        });
        expect({ size: f.size, lines: f.lines, fits: f.fits }, text).toEqual({ size, lines, fits });
      }
    }
  });

  it('pads a marked line on the page, opens a marked lower row, and leaves a plain line alone', () => {
    const first = (firstName) => still(
      <MilestoneToast celebration={{ kind: 'first', firstName, count: 1, ...firstOfNightCopy(firstName) }} club={null} />,
    ).container.querySelector('.milestone-count');
    // jsdom has no canvas, so the ink is markExtents' estimate from the marks.
    const accent = first('Maximilián');
    expect(accent.style.paddingTop).toMatch(/^calc\([\d.]+ \* var\(--u\)\)$/);
    expect(accent.style.paddingBottom).toBe('');
    cleanup();
    expect(first('Ștefan').style.paddingBottom).toMatch(/^calc\([\d.]+ \* var\(--u\)\)$/);
    cleanup();
    const plain = first('Maximilian');
    expect(plain.getAttribute('style') ?? '').not.toMatch(/padding/);
    cleanup();
    const headline = 'Maximilian-Alexander Jonathan Élodie!';
    const two = still(<MilestoneToast celebration={{ kind: 'night', count: 100, label: 'Triple digits', headline }} club={null} />)
      .container.querySelectorAll('.milestone-count__line');
    expect([...two].map((l) => l.textContent)).toEqual(['Maximilian-Alexander', ' Jonathan Élodie!']);
    expect(two[0].style.marginTop).toBe('');
    expect(two[1].style.marginTop).toMatch(/^[\d.]+em$/);
  });
});

describe('the toast plate', () => {
  // jsdom has no layout: give the plate's boxes a size so StepPlate draws.
  const sizes = { 'step-plate': [400, 120], 'step-plate__label': [80, 30], 'step-plate__body': [340, 95] };
  const pick = (el, i) => {
    const key = Object.keys(sizes).find((k) => el.classList?.contains(k));
    return key ? sizes[key][i] : 0;
  };
  let saved;
  beforeAll(() => {
    saved = {
      w: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
      h: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
    };
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return pick(this, 0); } });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return pick(this, 1); } });
  });
  afterAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', saved.w);
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', saved.h);
  });
  const fill = (ui) => still(ui).container.querySelector('.milestone-toast .step-plate__fill').style.fill;
  // The colour as the DOM spells it back (jsdom turns #hex into rgb()).
  const norm = (c) => { const el = document.createElement('i'); el.style.fill = c; return el.style.fill; };

  it('is the club\'s own colour for a club or one child, hot for the room, blue for handbooks', () => {
    const sparks = getClubPalette('Sparks');
    expect(fill(<MilestoneToast celebration={{ kind: 'club', club: 'Sparks', count: 20 }} club={sparks} />)).toBe(norm(sparks.primary));
    cleanup();
    const tnt = getClubPalette('T&T');
    expect(fill(<MilestoneToast celebration={{ kind: 'kid', firstName: 'Ava', club: 'T&T', count: 10 }} club={tnt} />)).toBe(norm(tnt.primary));
    cleanup();
    expect(fill(<MilestoneToast celebration={{ kind: 'tally', count: 25 }} club={null} />)).toBe('var(--brand-hot)');
    cleanup();
    expect(fill(<MilestoneToast celebration={{ kind: 'books', count: 5, ...bookMilestoneCopy(5) }} club={null} />)).toBe('var(--brand-blue)');
  });
});

describe('the toast in the band', () => {
  const opacity = (el) => Number(el.style.opacity === '' ? 1 : el.style.opacity);

  it('with a band notice up, waits out the notice\'s exit before it lands', async () => {
    const c = { kind: 'tally', count: 25 };
    const held = render(<MilestoneToast celebration={c} club={null} afterNotice />);
    const plain = render(<MilestoneToast celebration={{ ...c, count: 26 }} club={null} />);
    const toasts = () => [held, plain].map((r) => r.container.querySelector('.milestone-toast'));
    await new Promise((r) => setTimeout(r, 160));
    const [a, b] = toasts();
    expect(opacity(a)).toBeLessThan(0.05);
    expect(opacity(b)).toBeGreaterThan(0.2);
    await waitFor(() => expect(opacity(toasts()[0])).toBe(1), { timeout: 2000 });
  });

  it('drops below a critical notice that keeps the band', () => {
    const c = { kind: 'tally', count: 25 };
    const { container } = still(<MilestoneToast celebration={c} club={null} below />);
    expect(container.querySelector('.milestone-toast').classList.contains('milestone-toast--below')).toBe(true);
  });
});

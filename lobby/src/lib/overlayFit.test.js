import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FOOT_CHIP, FOOT_FLOOR_PX, NAME_CHIP_CLEAR, NAME_CHIP_TEXT, OVERLAY, balanceLines, bandRoom, bandTop, boardPlacement,
  fitFoot, fitParagraph, fitShout, footHeight, footRange, lobbyRoom, moreLabel, nameChipSeat, plateChrome, setupUp,
  waitingLabel, wrapLines,
} from './overlayFit.js';
import { LAYOUT } from './lobbyFrame.js';
import { PLATE, SHOUT_BOX } from './brand.js';
import {
  BOARD_ANONYMOUS, BOARD_EMPTY, BOARD_HIDDEN, BOARD_NAMES, BOARD_STALE,
} from './checkoutBoard.js';

const css = readFileSync(resolve(__dirname, '../styles/app.css'), 'utf8');

// A fixed, readable measure: every character 0.6em, a space 0.3em. The fits
// are pure in their measure, so the numbers below are exact.
const mono = (text) => [...text].reduce((w, ch) => w + (ch === ' ' ? 0.3 : 0.6), 0);
const measure = (text) => mono(text);

describe('the overlay bands', () => {
  it('keep the top band above the highest the slide copy can rise', () => {
    expect(OVERLAY.band.bottom).toBeLessThan(LAYOUT.safeTop);
    // With the flag tab hanging, the band starts under it and still has room.
    const flagged = OVERLAY.flags.height + OVERLAY.flags.gap;
    expect(flagged).toBeLessThan(OVERLAY.band.bottom);
  });

  it('keep the band between the corner tab (24u) and the top-right stack (~78u)', () => {
    const left = 50 - OVERLAY.band.width / 2;
    const right = 50 + OVERLAY.band.width / 2;
    expect(left).toBeGreaterThanOrEqual(24);
    expect(right).toBeLessThanOrEqual(78);
  });

  it('keep the critical notice\'s takeover region inside the copy box, above the house waves', () => {
    expect(OVERLAY.centre.top).toBeGreaterThan(OVERLAY.band.bottom);
    expect(OVERLAY.centre.bottom).toBeLessThanOrEqual(46.5);
  });

  it('start the band where app.css starts it, under the flag strip while one hangs', () => {
    expect(bandTop(false)).toBe(OVERLAY.band.top);
    expect(bandTop(true)).toBeCloseTo(OVERLAY.flags.height + OVERLAY.flags.gap, 9);
    const top = (rule) => Number(new RegExp(`${rule}\\s*\\{[^}]*--band-top:\\s*calc\\(([\\d.]+) \\* var\\(--u\\)\\)`).exec(css)?.[1]);
    expect(top('\\.stage')).toBeCloseTo(bandTop(false), 9);
    expect(top('\\.stage\\.has-flags')).toBeCloseTo(bandTop(true), 9);
    expect(bandRoom(true)).toBeLessThan(bandRoom(false));
  });

  it('keep the flag strip between the corner tab and the top-right stack', () => {
    expect(OVERLAY.flags.width).toBeLessThanOrEqual(78 - 24);
    expect(css).toMatch(new RegExp(`\\.top-flags \\{[^}]*max-width: calc\\(${OVERLAY.flags.width} \\* var\\(--u\\)\\)`));
  });

  it('seat the pickup board in the first-run card\'s strip: under the copy\'s lowest line, between the gear and the corner chip', () => {
    // One seat, two tenants (owner, 2026-10-07: the list takes the bottom of
    // the screen, never the announcements above it).
    expect(OVERLAY.foot).toBe(OVERLAY.setup);
    expect(OVERLAY.foot.top).toBeGreaterThanOrEqual(LAYOUT.safeBottom);
    // The "has checked out" banners (.checkout-leaves) share the rule.
    const rule = /^\.checkout-region,\n\.checkout-leaves \{([^}]*)\}/m.exec(css)?.[1] ?? '';
    expect(rule).not.toBe('');
    // The strip's top is 45u down the 16:9 box, which is centred on the
    // stage: 45 - 28.125 under its middle, so a 4:3 screen's extra height
    // below the box is the strip's too.
    expect(rule).toMatch(new RegExp(`top: calc\\(50% \\+ ${OVERLAY.foot.top - 56.25 / 2} \\* var\\(--u\\)\\)`));
    // Its floor is the corner chip's own line, 1.8u off the bottom ...
    expect(rule).toMatch(new RegExp(`bottom: calc\\(${OVERLAY.foot.bottom} \\* var\\(--u\\)\\)`));
    expect(css).toMatch(new RegExp(`\\.corner-bottom \\{[^}]*bottom: calc\\(${OVERLAY.foot.bottom} \\* min\\(1vw, 1\\.7778vh\\)\\)`));
    // ... and it runs from a gap past the gear to a gap short of the chip,
    // exactly as the first-run card does.
    expect(rule).toMatch(new RegExp(`right: calc\\(${100 - OVERLAY.foot.chipLeft + OVERLAY.foot.gap} \\* var\\(--u\\)\\)`));
    expect(rule).toMatch(new RegExp(`left: calc\\(var\\(--safe-inset\\) \\+ max\\(46px, calc\\(2\\.9 \\* var\\(--u\\)\\)\\) \\+ calc\\(${OVERLAY.foot.gap} \\* var\\(--u\\)\\)\\)`));
    const card = /^\.panel\.setup-card \{([^}]*)\}/m.exec(css)?.[1] ?? '';
    for (const prop of ['left', 'right', 'max-width']) {
      const decl = (body) => new RegExp(`\\n\\s*${prop}: ([^;]+);`).exec(body)?.[1];
      expect(decl(rule), prop).toBe(decl(card));
    }
    // Nothing the board draws reaches above the strip: the card is held to it.
    expect(/\n\.checkout-board \{([^}]*)\}/.exec(css)?.[1]).toMatch(/max-height: 100%;/);
  });

  it('never let a critical notice in the middle and the board in the foot meet', () => {
    expect(OVERLAY.centre.bottom).toBeGreaterThan(OVERLAY.foot.top);
    // The takeover card is centred in the middle and three shouted lines at
    // most (~22u with its plate), so it ends ~6u above the strip.
    const mid = (OVERLAY.centre.top + OVERLAY.centre.bottom) / 2;
    expect(mid + 22 / 2).toBeLessThan(OVERLAY.foot.top);
  });

  it('keep the first-run card\'s seat under the copy\'s lowest line, between the gear and the corner chip', () => {
    // Nothing the slide copy draws comes below LAYOUT.safeBottom, so a card
    // that stays under it can never cover a headline, whatever the size.
    expect(OVERLAY.setup.top).toBeGreaterThanOrEqual(LAYOUT.safeBottom);
    // The card's own rule, at the start of a line: html.embedded's and the
    // phone's also end in `.panel.setup-card {`.
    const rule = /^\.panel\.setup-card \{([^}]*)\}/m.exec(css)?.[1] ?? '';
    // Its right edge stops a gap short of the corner chip (which starts at
    // chipLeft, the number the ticker's room is measured to) ...
    expect(rule).toMatch(new RegExp(`right: calc\\(${100 - OVERLAY.setup.chipLeft + OVERLAY.setup.gap} \\* var\\(--u\\)\\)`));
    // ... its left edge a gap past the gear's ...
    expect(rule).toMatch(new RegExp(`left: calc\\(var\\(--safe-inset\\) \\+ max\\(46px, calc\\(2\\.9 \\* var\\(--u\\)\\)\\) \\+ calc\\(${OVERLAY.setup.gap} \\* var\\(--u\\)\\)\\)`));
    // ... and it rides the chip's own line, 1.8u off the bottom.
    expect(rule).toMatch(/bottom: calc\(1\.8 \* var\(--u\)\)/);
    expect(css).toMatch(/\.corner-bottom \{[^}]*bottom: calc\(1\.8 \* min\(1vw, 1\.7778vh\)\)/);
    // The strip that leaves (56.25u - 45u) is what the card's columns are made for.
    expect(56.25 - OVERLAY.setup.top).toBeGreaterThan(9);
  });

  it('let the status sticker stand only as tall as keeps the chip under it above a raised row', () => {
    // stack top ~1.4u + sticker + 0.9u gap + the ~6.4u weather chip, by 14u.
    expect(1.41 + OVERLAY.stack.stickerMax + 0.9 + 6.42).toBeLessThanOrEqual(14);
  });

  it('measure the plate the way app.css draws it', () => {
    expect(plateChrome(1)).toBeCloseTo(2.05 * (1 - 0.087), 9);
    expect(css).toMatch(/--plate-pill: calc\(2\.05 \* var\(--plate-label, 1rem\)\)/);
    // The kit's PLATE is the same pill: its Londrina label keeps the catalog
    // chip's ratio, whatever size the SVG chip draws its shouted label at.
    expect(PLATE.pillPerLabel).toBeCloseTo(2.05, 2);
  });
});

describe('the step-plate label size', () => {
  it('is never declared on the plate itself, so each overlay\'s own size reaches its label', () => {
    // A declaration on .step-plate beats the one it inherits from the notice,
    // the toast or the sticker, and every label renders at 1rem.
    const plate = /\.step-plate \{([^}]*)\}/g;
    let m;
    const bodies = [];
    while ((m = plate.exec(css))) bodies.push(m[1]);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(body).not.toMatch(/--plate-label\s*:/);
    for (const owner of ['.status-dot', '.milestone-toast', '.notice-banner--critical']) {
      const esc = owner.replace(/[.-]/g, (c) => `\\${c}`);
      expect(css).toMatch(new RegExp(`${esc} \\{[^}]*--plate-label:`));
    }
  });
});

describe('who holds which part of the room', () => {
  it('the board, whenever it shows anything, has the foot and never the middle', () => {
    // Owner, 2026-10-07: "The still remaining kids list should just take the
    // bottom of the screen. It shouldn't take over all of the announcements."
    for (const state of [BOARD_NAMES, BOARD_ANONYMOUS, BOARD_STALE, BOARD_EMPTY]) {
      expect(boardPlacement(state)).toBe('foot');
      const room = lobbyRoom({ boardState: state });
      expect(room).toEqual({ board: 'foot', banner: null, critical: null, copyAside: false, toastBelow: false });
    }
    expect(boardPlacement(BOARD_HIDDEN)).toBeNull();
    expect(boardPlacement(undefined)).toBeNull();
  });

  it('a critical notice takes the middle, the pickup list or not, and the copy steps aside for it alone', () => {
    expect(lobbyRoom({ criticalLive: true, boardState: BOARD_HIDDEN }))
      .toEqual({ board: null, banner: null, critical: 'centre', copyAside: true, toastBelow: false });
    // Over a live list it stays in its own place; the board keeps the foot.
    for (const state of [BOARD_NAMES, BOARD_ANONYMOUS, BOARD_STALE]) {
      expect(lobbyRoom({ criticalLive: true, boardState: state }))
        .toEqual({ board: 'foot', banner: null, critical: 'centre', copyAside: true, toastBelow: false });
    }
  });

  it('nothing about the board holds the celebrations back any more', () => {
    for (const criticalLive of [false, true]) {
      const room = lobbyRoom({ criticalLive, boardState: BOARD_NAMES });
      expect(room).not.toHaveProperty('holdCelebrations');
      expect(room.toastBelow).toBe(false);
    }
  });

  it('on an OBS feed there is no board and the alert keeps to the band, with a toast below it', () => {
    expect(lobbyRoom({ overlay: true, criticalLive: true, boardState: BOARD_NAMES }))
      .toEqual({ board: null, banner: null, critical: 'band', copyAside: false, toastBelow: true });
    expect(lobbyRoom({ overlay: true, boardState: BOARD_NAMES }).critical).toBeNull();
  });

  it('a "has checked out" banner borrows the foot from the board, and gives it back', () => {
    expect(lobbyRoom({ boardState: BOARD_NAMES, leaveUp: true }))
      .toEqual({ board: null, banner: 'foot', critical: null, copyAside: false, toastBelow: false });
    expect(lobbyRoom({ boardState: BOARD_NAMES, leaveUp: false }).board).toBe('foot');
    // A name at the door outranks it too, and an OBS feed never shows one.
    expect(lobbyRoom({ boardState: BOARD_NAMES, leaveUp: true, checkInUp: true })).toMatchObject({ board: null, banner: null });
    expect(lobbyRoom({ overlay: true, leaveUp: true }).banner).toBeNull();
    // It moves nothing else: a critical notice keeps the middle.
    expect(lobbyRoom({ criticalLive: true, leaveUp: true }).critical).toBe('centre');
    // The first-run card gives it the seat.
    expect(setupUp({ due: true, room: lobbyRoom({ leaveUp: true }) })).toBe(false);
  });

  it('a name at the door outranks the pickup list, and moves nothing else', () => {
    expect(lobbyRoom({ checkInUp: true, boardState: BOARD_NAMES }))
      .toEqual({ board: null, banner: null, critical: null, copyAside: false, toastBelow: false });
    expect(lobbyRoom({ checkInUp: true, criticalLive: true, boardState: BOARD_NAMES }).critical).toBe('centre');
  });
});

describe('the first-run card\'s seat (setupUp)', () => {
  const room = (over = {}) => lobbyRoom({ boardState: BOARD_HIDDEN, ...over });

  it('is up on an ordinary lobby, and only while the screen is still due for setup', () => {
    expect(setupUp({ due: true, room: room() })).toBe(true);
    expect(setupUp({ due: false, room: room() })).toBe(false);
    expect(setupUp({ room: room() })).toBe(false);
  });

  it('is never on an OBS feed or over an open panel', () => {
    expect(setupUp({ due: true, overlay: true, room: room({ overlay: true }) })).toBe(false);
    expect(setupUp({ due: true, panelOpen: true, room: room() })).toBe(false);
  });

  it('gives way to a name, and to a poster or a marked slide (their own moment)', () => {
    expect(setupUp({ due: true, checkInUp: true, room: room({ checkInUp: true }) })).toBe(false);
    expect(setupUp({ due: true, held: true, room: room() })).toBe(false);
  });

  it('gives way to a critical notice in the middle and to whatever holds the foot', () => {
    expect(setupUp({ due: true, room: room({ criticalLive: true }) })).toBe(false);
    // The pickup board shares its seat, whatever it shows ...
    for (const state of [BOARD_NAMES, BOARD_ANONYMOUS, BOARD_STALE, BOARD_EMPTY]) {
      expect(setupUp({ due: true, room: room({ boardState: state }) }), state).toBe(false);
    }
    // ... and the tonight strip on the waves there, while it has counts to show.
    expect(setupUp({ due: true, ticker: true, room: room() })).toBe(false);
    expect(setupUp({ due: true, ticker: false, room: room() })).toBe(true);
  });

  it('a critical notice that keeps to the top band leaves the card its seat', () => {
    expect(setupUp({ due: true, room: { board: null, critical: 'band' } })).toBe(true);
  });
});

describe('fitShout', () => {
  it('sets a short line on one line at the largest size', () => {
    const f = fitShout('10 kids strong!', { width: 40, max: 3, min: 2 }, measure);
    expect(f).toEqual({ size: 3, lines: ['10 kids strong!'], fits: true });
  });

  it('steps a longer line down, on the step, until it fits', () => {
    // PRETEND PAL IS FIRST: 17 letters and 3 spaces, 11.1em; 30u / 11.1 = 2.70.
    const f = fitShout('Pretend Pal is first', { width: 30, max: 3, min: 2 }, measure);
    expect(f.lines).toHaveLength(1);
    expect(f.size).toBeCloseTo(2.7, 5);
    expect(measure(f.lines[0].toUpperCase()) * f.size).toBeLessThanOrEqual(30 + 1e-9);
  });

  it('picks the most balanced split even when several reach the two-line cap', () => {
    // Every split of these lines reaches the 2.2u cap at 40u; the balanced one
    // keeps the name whole on the first line and the plate narrowest.
    const f = fitShout('Anna-Sophia Kristensen is first in tonight!', { width: 40, max: 3, min: 2, twoLineMax: 2.2 }, measure);
    expect(f).toEqual({ size: 2.2, lines: ['Anna-Sophia Kristensen', 'is first in tonight!'], fits: true });
  });

  it('goes down to twoLineMin for two lines, and says when even that is too wide', () => {
    const text = 'Maximilian-Alexander Jonathan-Christophe is first in tonight!';
    const small = fitShout(text, { width: 40, max: 3, min: 2, twoLineMax: 2.2, twoLineMin: 1.4 }, measure);
    expect(small.fits).toBe(true);
    expect(small.size).toBeGreaterThanOrEqual(1.4);
    expect(small.size).toBeLessThan(2);
    for (const l of small.lines) expect(measure(l.toUpperCase()) * small.size).toBeLessThanOrEqual(40 + 1e-9);
    const tight = fitShout(text, { width: 20, max: 3, min: 2, twoLineMax: 2.2, twoLineMin: 1.4 }, measure);
    expect(tight).toMatchObject({ size: 1.4, fits: false });
  });

  it('breaks into the two most balanced lines once one line would go below min', () => {
    const text = 'Maximilian-Alexander Jonathan is first in tonight!';
    const f = fitShout(text, { width: 40, max: 3, min: 2, twoLineMax: 2.2 }, measure);
    expect(f.lines).toHaveLength(2);
    expect(f.lines.join(' ')).toBe(text);
    expect(f.size).toBeLessThanOrEqual(2.2);
    expect(f.size).toBeGreaterThanOrEqual(2);
    for (const l of f.lines) expect(measure(l.toUpperCase()) * f.size).toBeLessThanOrEqual(40 + 1e-9);
  });

  it('never goes below min, and says when it could not fit', () => {
    const f = fitShout('Supercalifragilisticexpialidocious', { width: 10, max: 3, min: 2 }, measure);
    expect(f.size).toBe(2);
    expect(f.fits).toBe(false);
  });
});

describe('wrapLines / balanceLines', () => {
  const text = 'Bring your Bible next week for double shares and a friend too';

  it('wraps greedily inside the width', () => {
    const lines = wrapLines(text, 1, 20, 'body', measure);
    expect(lines.join(' ')).toBe(text);
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(20);
  });

  it('balances into the same number of lines with a shorter longest line', () => {
    const greedy = wrapLines(text, 1, 20, 'body', measure);
    const balanced = balanceLines(text, greedy.length, 1, 'body', measure);
    expect(balanced).toHaveLength(greedy.length);
    expect(balanced.join(' ')).toBe(text);
    const longest = (ls) => Math.max(...ls.map((l) => measure(l)));
    expect(longest(balanced)).toBeLessThanOrEqual(longest(greedy));
  });

  it('moves words down off a greedy first line, so no line is longer than it must be', () => {
    // Greedy fills the first line and strands one short word on the second.
    const t = 'xxxxxxxxxx yyyyyyyyyy z';
    const greedy = wrapLines(t, 1, 13, 'body', measure);
    expect(greedy).toEqual(['xxxxxxxxxx yyyyyyyyyy', 'z']);
    const balanced = balanceLines(t, 2, 1, 'body', measure);
    expect(balanced).toEqual(['xxxxxxxxxx', 'yyyyyyyyyy z']);
    const longest = (ls) => Math.max(...ls.map((l) => measure(l)));
    expect(longest(balanced)).toBeLessThan(longest(greedy));
    for (const l of balanced) expect(measure(l)).toBeLessThanOrEqual(13);
  });

  it('never balances a line wider than the greedy wrap allowed', () => {
    const t = 'Supercalifragilistic expialidocious a b c d';
    const f = fitParagraph(t, { width: 20, max: 1, min: 1, maxLines: 3 }, measure);
    expect(f.hug).toBe(true);
    for (const l of f.text) expect(measure(l)).toBeLessThanOrEqual(20 + 1e-9);
    expect(f.text.join(' ')).toBe(t);
  });

  it('copes with empty text and one line', () => {
    expect(wrapLines('', 1, 10, 'body', measure)).toEqual([]);
    expect(balanceLines('', 2, 1, 'body', measure)).toEqual([]);
    expect(balanceLines('one two', 1, 1, 'body', measure)).toEqual(['one two']);
  });
});

describe('fitParagraph', () => {
  it('keeps the largest size that fits the line budget', () => {
    const f = fitParagraph('Doors close at 6:15 tonight.', { width: 46, max: 2.1, min: 1.3, maxLines: 2 }, measure);
    expect(f).toMatchObject({ size: 2.1, lines: 1, fits: true, hug: true });
    expect(f.text).toEqual(['Doors close at 6:15 tonight.']);
  });

  it('steps a 200-character message down, and says so when even min needs more lines', () => {
    const long = 'Parents: pick-up tonight moves to the gym doors on the north side because of the parking lot work. Please drive around the back and wait in the loop — volunteers in orange will walk each child out.';
    const f = fitParagraph(long, { width: 46, max: 2.1, min: 1.3, maxLines: 2 }, measure);
    expect(f.size).toBe(1.3);
    expect(f.fits).toBe(false);
    expect(f.lines).toBeGreaterThan(2);
    expect(f.text.join(' ')).toBe(long);
  });

  it('with a height, stacks its lines inside it', () => {
    const long = 'Parents: pick-up tonight moves to the gym doors on the north side because of the parking lot work. Please drive around the back and wait in the loop — volunteers in orange will walk each child out.';
    for (const height of [3.6, 5.2]) {
      const f = fitParagraph(long, { width: 46, max: 2.1, min: 0.8, maxLines: 3, height, lineHeight: 1.2 }, measure);
      expect(f.fits).toBe(true);
      expect(f.lines * f.size * 1.2).toBeLessThanOrEqual(height + 1e-9);
    }
    const roomy = fitParagraph(long, { width: 46, max: 2.1, min: 0.8, maxLines: 3, height: 5.2, lineHeight: 1.2 }, measure);
    const tight = fitParagraph(long, { width: 46, max: 2.1, min: 0.8, maxLines: 3, height: 3.6, lineHeight: 1.2 }, measure);
    expect(tight.size).toBeLessThan(roomy.size);
  });

  it('hands the wrapping back to the browser for a word wider than the line', () => {
    const f = fitParagraph('see https://example.org/a/very/long/path/that/will/not/fit', { width: 10, max: 2, min: 1.3, maxLines: 2 }, measure);
    expect(f.hug).toBe(false);
  });
});

// Stage 4b-2 sized the overlays' shouts for Galindo; Paytone One's caps
// stand 5.7% shorter at one size (its figures 5%), so each shout is that
// much larger and each line height that much tighter (CLAUDE.md, the brand
// kit), which holds the caps' height and every box around them.
describe('the overlays\' shouts hold stage 4b-2\'s cap heights in Paytone One', () => {
  /** @param {string} selector */
  const body = (selector) => css.match(new RegExp(`\\n${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? '';
  const u = (rule) => Number(rule.match(/font-size: calc\(([\d.]+) \* var\(--u\)\)/)?.[1]);
  const lh = (rule) => Number(rule.match(/line-height: ([\d.]+);/)?.[1]);

  it('the ticker\'s figures: 2.2u at 1 in Galindo', () => {
    const rule = body('.tonight-ticker-value');
    expect(Math.abs(u(rule) - 2.2 * 1.05)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(lh(rule) - 1 / 1.05)).toBeLessThanOrEqual(0.005);
  });

  it('the pickup board\'s count: Paytone One\'s figures at 1 / 1.05', () => {
    // Sized afresh for the foot (2026-10-07), in em of the strip's words.
    expect(Math.abs(lh(body('.checkout-count')) - 1 / 1.05)).toBeLessThanOrEqual(0.005);
  });

  it('the pickup board\'s names: drawn NAME_CHIP_TEXT x the chip\'s size, the pill as it was', () => {
    expect(NAME_CHIP_TEXT).toBe(1.057);
    const rule = body('.checkout-name__chip');
    expect(rule).toMatch(new RegExp(`font-size: ${NAME_CHIP_TEXT}em;`));
    expect(rule).toMatch(new RegExp(`height: calc\\(1\\.75em / ${NAME_CHIP_TEXT}\\);`));
    // The line and its padding give way to a mark's seat (nameChipSeat) inside
    // the same pill; unset, the seat is 0 and the rule is the one it was.
    expect(rule).toMatch(new RegExp(`line-height: calc\\(1\\.75em / ${NAME_CHIP_TEXT} - 2 \\* var\\(--seat, 0em\\)\\);`));
    expect(rule).toMatch(new RegExp(`padding: calc\\(2 \\* var\\(--seat, 0em\\)\\) calc\\(0\\.65em / ${NAME_CHIP_TEXT}\\) 0;`));
  });
});

// A name chip is a pill 1.75 / NAME_CHIP_TEXT em tall at that line height, so
// its baseline hangs ~1.09em under the top. Paytone One's capitals carry
// their marks up to it (É at 1.045em) or through it (Ấ 1.183em) and onto the
// white card; the seat moves such a name down inside the same pill.
describe('a name chip\'s seat (nameChipSeat)', () => {
  const height = 1.75 / NAME_CHIP_TEXT;
  const above = (SHOUT_BOX.ascent - SHOUT_BOX.descent + height) / 2;
  const SHADOW = 0.06;
  // Paytone One's real ink (fontTools), em.
  const ink = { plain: [0.703, 0.016], lower: [0.984, 0.212], comma: [0.703, 0.351], É: [1.045, 0.016], Ễ: [1.161, 0.016], Ấ: [1.183, 0.016], both: [1.183, 0.351] };
  const of = (k) => ({ ascent: ink[k][0], descent: ink[k][1] });
  const inkTop = (k) => above + nameChipSeat(of(k)) - of(k).ascent;
  const inkBottom = (k) => above + nameChipSeat(of(k)) + of(k).descent + SHADOW;

  it('leaves plain names, lowercase marks and a hanging comma where they were', () => {
    for (const k of ['plain', 'lower', 'comma']) expect(nameChipSeat(of(k)), k).toBe(0);
  });

  it('drops a capital\'s mark just clear of the pill\'s top, and no further', () => {
    for (const k of ['É', 'Ễ', 'Ấ']) {
      // Unseated, it reaches within the clear space of the edge, or past it.
      expect(above - of(k).ascent, k).toBeLessThan(NAME_CHIP_CLEAR);
      expect(inkTop(k), k).toBeGreaterThanOrEqual(NAME_CHIP_CLEAR - 1e-3);
      expect(inkTop(k), k).toBeLessThan(NAME_CHIP_CLEAR + 0.002);
      expect(inkBottom(k), k).toBeLessThanOrEqual(height - NAME_CHIP_CLEAR);
    }
  });

  it('never drops a name so far that its comma and shadow reach the bottom', () => {
    expect(nameChipSeat(of('both'))).toBeGreaterThan(0);
    expect(inkBottom('both')).toBeLessThanOrEqual(height - NAME_CHIP_CLEAR + 1e-9);
  });
});


// The pickup board in the foot (owner, 2026-10-07): every club's plate and
// chips in one run that wraps across the strip, sized to the run's box, with
// "+N more" where even the smallest readable chips cannot hold everyone.
describe('the pickup board in the foot (fitFoot)', () => {
  const mono = (text) => [...text].reduce((w, ch) => w + (ch === ' ' ? 0.3 : 0.6), 0);
  const kids = (n, name = 'Kid') => Array.from({ length: n }, (_, i) => `${name}${String(i).padStart(2, '0')}`);
  const CLUBS = ['Puggles', 'Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey'];

  it('models a wrapping row the way flex lays it out', () => {
    // Three 10-wide pieces in 25: two rows; in 32 (two gaps of 0.45 at s 1): one.
    expect(footHeight([10, 10, 10], 1, 25)).toBeCloseTo(2 * FOOT_CHIP.row + FOOT_CHIP.gap, 9);
    expect(footHeight([10, 10, 10], 1, 31)).toBeCloseTo(FOOT_CHIP.row, 9);
    expect(footHeight([10, 10, 10], 1, 30.85)).toBeGreaterThan(FOOT_CHIP.row);
    expect(footHeight([], 1, 10)).toBe(0);
  });

  it('counts a plate as its mark (or name) and "N waiting", and a chip at the size it draws its name', () => {
    // One club with one name: the plate and the chip side by side exactly when
    // the run is as wide as both and a gap.
    const s = 2;
    const label = (t) => (mono(t.toUpperCase()) + FOOT_CHIP.plate.track * t.length) * FOOT_CHIP.plate.label * s;
    const plate = FOOT_CHIP.plate.pad * s + FOOT_CHIP.plate.mark * s + FOOT_CHIP.plate.gap * s + label(waitingLabel(1));
    const chip = mono('Maximilian') * NAME_CHIP_TEXT * s + FOOT_CHIP.pad * s;
    const width = plate + FOOT_CHIP.gap * s + chip;
    const one = [{ club: 'Sparks', names: ['Maximilian'], mark: true }];
    expect(fitFoot(one, { width, height: FOOT_CHIP.row * s, max: s, min: 1 }, mono)).toEqual({ size: s, hidden: [0], fits: true });
    expect(fitFoot(one, { width: width - 0.05, height: FOOT_CHIP.row * s, max: s, min: 1 }, mono).size).toBeLessThan(s);
    // Without a mark, the plate carries the club's name instead.
    const named = [{ club: 'Guests', names: ['Ava'] }];
    const wide = fitFoot(named, { width: 1000, height: FOOT_CHIP.row * s, max: s, min: 1 }, mono);
    expect(wide).toEqual({ size: s, hidden: [0], fits: true });
  });

  it('takes the largest size that fits, stepping down as the list grows', () => {
    // Two clubs of three: two rows at 1.8 (2 x 1.75 + 0.45, x 1.8 = 7.11).
    const box = { width: 60, height: 7.2, max: 1.8, min: 0.5, step: 0.05 };
    const few = fitFoot(CLUBS.slice(0, 2).map((club) => ({ club, names: kids(3), mark: true })), box, mono);
    expect(few).toEqual({ size: 1.8, hidden: [0, 0], fits: true });
    const many = fitFoot(CLUBS.map((club) => ({ club, names: kids(8), mark: true })), box, mono);
    expect(many.fits).toBe(true);
    expect(many.hidden).toEqual([0, 0, 0, 0, 0, 0]);
    expect(many.size).toBeLessThan(few.size);
  });

  it('where the smallest size cannot hold them, puts the longest club\'s last names behind "+N more", plates kept', () => {
    const groups = [
      { club: 'Sparks', names: kids(30), mark: true },
      { club: 'T&T', names: kids(4), mark: true },
    ];
    const box = { width: 40, height: 4, max: 1, min: 0.8, step: 0.05 };
    const fit = fitFoot(groups, box, mono);
    expect(fit.fits).toBe(true);
    expect(fit.size).toBe(0.8);
    expect(fit.hidden[0]).toBeGreaterThan(0);
    // The short club keeps its names while the long one has more to give.
    expect(fit.hidden[1]).toBeLessThanOrEqual(fit.hidden[0]);
    expect(moreLabel(fit.hidden[0])).toBe(`+${fit.hidden[0]} more`);
  });

  it('says so when even the plates cannot fit a box far too small for any list', () => {
    const groups = CLUBS.map((club) => ({ club, names: kids(10), mark: true }));
    const fit = fitFoot(groups, { width: 5, height: 1, max: 1, min: 0.5 }, mono);
    expect(fit.fits).toBe(false);
    expect(fit.hidden).toEqual(groups.map((g) => g.names.length));
  });

  it('sizes the chips from the run\'s height: two rows at most, a twelfth at least, and a floor in px', () => {
    const r = footRange(140, FOOT_FLOOR_PX);
    expect(r.max).toBeCloseTo(140 / (2 * FOOT_CHIP.row + FOOT_CHIP.gap), 9);
    expect(r.min).toBeCloseTo(140 / 12, 9);
    expect(footRange(90, FOOT_FLOOR_PX).min).toBe(FOOT_FLOOR_PX);
    // A miniature TV keeps its proportions.
    expect(footRange(36).min).toBeCloseTo(3, 9);
    // A run too short for two rows of the floor still gets one size.
    const tiny = footRange(20, FOOT_FLOOR_PX);
    expect(tiny.min).toBe(tiny.max);
  });

  // The strip and the card in px, from app.css (.checkout-region and
  // .checkout-board--list): the run is what is left of the strip after the
  // card's padding, the tab (its padding and a title at most 7em of 0.9em),
  // the column gap, and the count line under it. Measured with jsdom's rough
  // widths (0.7em a Paytone letter, wider than the real face), so a run that
  // fits here has room to spare on a TV.
  const run = (w, h) => {
    const u = Math.min(w / 100, (h * 1.7778) / 100);
    const safe = Math.max(24, (2.5 * Math.min(w, h)) / 100);
    const left = safe + Math.max(46, 2.9 * u) + 1.2 * u;
    const width = Math.min(w - left - 19.2 * u, 80 * u);
    const height = h / 2 - 18.675 * u;
    const em = Math.max(11, 0.95 * u);
    const tab = (1 + 2.6 + 7 * 0.9) * em;
    return { strip: { width, height }, width: width - 0.9 * em - 0.9 * em - tab, height: height - 0.85 * em - 0.3 * em - 1.4 * em };
  };
  // The printer sends at most 60 entries (sanitizeCheckout): here ten in each
  // club, of ordinary first-name lengths, and then of long ones.
  const ORDINARY = ['Sophia', 'Oliver', 'Amelia', 'Lucas', 'Harper', 'Mason', 'Evelyn', 'Logan', 'Abigail', 'Elijah'];
  const LONG = ['Alexander', 'Charlotte', 'Benjamin', 'Isabella', 'Theodore', 'Penelope', 'Sebastian', 'Josephine', 'Nathaniel', 'Gabriella'];
  const sixty = (names) => CLUBS.map((club) => ({ club, names: [...names].sort(), mark: club !== 'Journey' }));

  for (const [w, h] of [[1920, 1080], [3840, 2160], [1280, 720], [640, 480]]) {
    for (const [kind, names] of [['ordinary', ORDINARY], ['long', LONG]]) {
      it(`holds the 60-entry cap (${kind} names) at ${w}x${h}: never past the run's box, never under the floor, nobody uncounted`, () => {
        const box = run(w, h);
        // The strip is the same ~9.45u everywhere 16:9, ~120px on the Pi.
        expect(box.strip.height).toBeGreaterThan(100);
        const groups = sixty(names);
        const range = footRange(box.height, FOOT_FLOOR_PX);
        const fit = fitFoot(groups, { width: box.width, height: box.height, ...range, step: 0.25 });
        expect(fit.fits).toBe(true);
        expect(fit.size).toBeGreaterThanOrEqual(FOOT_FLOOR_PX);
        // Every club keeps its plate (counting all ten), and what it shows and
        // what stands behind its "+N more" add up to its ten.
        for (const n of fit.hidden) {
          expect(n).toBeGreaterThanOrEqual(0);
          expect(n).toBeLessThanOrEqual(10);
        }
        // A 1080p or 4K TV names all sixty ordinary names, even measured this
        // wide; a long-named night or a smaller screen says "+N more".
        if (w >= 1920 && kind === 'ordinary') expect(fit.hidden).toEqual([0, 0, 0, 0, 0, 0]);
      });
    }
  }
});

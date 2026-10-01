import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  NAME_CHIP_CLEAR, NAME_CHIP_TEXT, OVERLAY, balanceLines, fitColumns, bandRoom, bandTop, boardPlacement, boardRowsHeight,
  fitBoard, fitParagraph, fitShout, lobbyRoom, nameChipSeat, plateChrome, setupUp, wrapLines,
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

  it('keep the takeover region inside the copy box, above the house waves', () => {
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

  it('keep the foot between the copy\'s lowest line and the ticker', () => {
    // 16:9: the stage is 56.25u tall; the card is at most ~5u tall.
    expect(56.25 - OVERLAY.foot.bottom - 5).toBeGreaterThanOrEqual(LAYOUT.safeBottom);
    expect(OVERLAY.foot.width).toBeLessThanOrEqual(80 - 20);
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
  const live = [BOARD_NAMES, BOARD_ANONYMOUS];
  it('the board takes the middle only for a live list at pickup time', () => {
    for (const pickup of [true, false]) {
      for (const state of live) {
        expect(boardPlacement(state, pickup)).toBe(pickup ? 'centre' : 'foot');
      }
      // A stale or empty board is never the room's focus: it has nothing live to list.
      expect(boardPlacement(BOARD_STALE, pickup)).toBe('foot');
      expect(boardPlacement(BOARD_EMPTY, pickup)).toBe('foot');
      expect(boardPlacement(BOARD_HIDDEN, pickup)).toBeNull();
    }
  });

  it('a stale board on a non-club day sits at the foot and leaves the slides alone', () => {
    const room = lobbyRoom({ boardState: BOARD_STALE, pickup: false });
    expect(room).toMatchObject({ board: 'foot', copyAside: false, critical: null });
  });

  it('a critical notice takes the middle, unless the pickup board holds it', () => {
    expect(lobbyRoom({ criticalLive: true, boardState: BOARD_HIDDEN, pickup: false }))
      .toEqual({ board: null, critical: 'centre', copyAside: true, holdCelebrations: false, toastBelow: false });
    // Beside a board at the foot, the middle is still the notice's.
    expect(lobbyRoom({ criticalLive: true, boardState: BOARD_STALE, pickup: false }))
      .toMatchObject({ board: 'foot', critical: 'centre', copyAside: true, holdCelebrations: false });
    // Over the pickup list it keeps to the band, both stay whole, and the
    // celebrations wait: the band is taken and the board is right below it.
    expect(lobbyRoom({ criticalLive: true, boardState: BOARD_NAMES, pickup: true }))
      .toEqual({ board: 'centre', critical: 'band', copyAside: true, holdCelebrations: true, toastBelow: false });
  });

  it('on an OBS feed there is no board and the alert keeps to the band, with a toast below it', () => {
    expect(lobbyRoom({ overlay: true, criticalLive: true, boardState: BOARD_NAMES, pickup: true }))
      .toEqual({ board: null, critical: 'band', copyAside: false, holdCelebrations: false, toastBelow: true });
    expect(lobbyRoom({ overlay: true, boardState: BOARD_NAMES, pickup: true }).critical).toBeNull();
  });

  it('a name at the door outranks the pickup list', () => {
    expect(lobbyRoom({ checkInUp: true, boardState: BOARD_NAMES, pickup: true }))
      .toMatchObject({ board: null, copyAside: false });
  });

  // A late arrival at pickup time hides the board for its run, but the board
  // still owns the middle: a critical notice stays in the band (it used to
  // jump over the WELCOME kicker for the run and back), and the celebrations
  // keep waiting, so no toast comes up only to be hidden when the run ends.
  it('a check-in run at pickup time leaves a critical notice in the band', () => {
    const before = lobbyRoom({ criticalLive: true, boardState: BOARD_NAMES, pickup: true });
    const during = lobbyRoom({ criticalLive: true, checkInUp: true, boardState: BOARD_NAMES, pickup: true });
    expect(before).toMatchObject({ board: 'centre', critical: 'band', holdCelebrations: true });
    expect(during).toEqual({ board: null, critical: 'band', copyAside: false, holdCelebrations: true, toastBelow: false });
    // With no board seated, a run changes nothing about the notice either.
    expect(lobbyRoom({ criticalLive: true, checkInUp: true, boardState: BOARD_HIDDEN, pickup: false }).critical)
      .toBe(lobbyRoom({ criticalLive: true, boardState: BOARD_HIDDEN, pickup: false }).critical);
  });
});

describe('the first-run card\'s seat (setupUp)', () => {
  const room = (over = {}) => lobbyRoom({ boardState: BOARD_HIDDEN, pickup: false, ...over });

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

  it('gives way to whatever holds the middle or the foot of the room', () => {
    // A critical notice in the middle, the pickup list in the middle at pickup time ...
    expect(setupUp({ due: true, room: room({ criticalLive: true }) })).toBe(false);
    expect(setupUp({ due: true, room: room({ boardState: BOARD_NAMES, pickup: true }) })).toBe(false);
    // ... the board's one-line card at the foot, in the strip the card would take ...
    expect(setupUp({ due: true, room: room({ boardState: BOARD_STALE, pickup: false }) })).toBe(false);
    // ... and the tonight strip on the waves there, while it has counts to show.
    expect(setupUp({ due: true, ticker: true, room: room() })).toBe(false);
    expect(setupUp({ due: true, ticker: false, room: room() })).toBe(true);
  });

  it('a critical notice that keeps to the top band leaves the card its seat, unless a list holds the middle', () => {
    // On an OBS feed the notice always keeps to the band (the card is never
    // there anyway); over a live pickup list it does too, and the list still
    // holds the room, so the card waits for the list, not for the notice.
    const overList = room({ criticalLive: true, boardState: BOARD_NAMES, pickup: true });
    expect(overList.critical).toBe('band');
    expect(overList.board).toBe('centre');
    expect(setupUp({ due: true, room: overList })).toBe(false);
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

describe('the pickup board fit', () => {
  const groups = [
    { club: 'Sparks', names: ['Ava', 'Liam', 'Maximilian', 'Sophia'] },
    { club: 'T&T', names: ['Noah', 'Mia'] },
  ];

  it('grows with the name size and with more names', () => {
    expect(boardRowsHeight(groups, 2, 60, measure)).toBeGreaterThan(boardRowsHeight(groups, 1, 60, measure));
    const more = [{ club: 'Sparks', names: Array(40).fill('Charlotte') }];
    expect(boardRowsHeight(more, 1.5, 60, measure)).toBeGreaterThan(boardRowsHeight(groups, 1.5, 60, measure));
  });

  it('picks the largest size that fits, and the floor when nothing does', () => {
    const f = fitBoard(groups, { width: 60, height: 20, max: 2.1, min: 1 }, measure);
    expect(f).toEqual({ size: 2.1, fits: true });
    const sixty = [{ club: 'Sparks', names: Array(60).fill('Isabella-Rose') }];
    const g = fitBoard(sixty, { width: 60, height: 20, max: 2.1, min: 1 }, measure);
    expect(g.size).toBeLessThan(2.1);
    expect(boardRowsHeight(sixty, g.size, 60, measure) <= 20 || g.fits === false).toBe(true);
    const h = fitBoard(sixty, { width: 20, height: 5, max: 2.1, min: 1 }, measure);
    expect(h).toEqual({ size: 1, fits: false });
  });

  it('counts each name at the size its chip draws it, in a pill that keeps its size', () => {
    // One name: its club's label and its chip, on one row.
    const one = [{ club: '', names: ['Maximilian'] }];
    const x = 0.34; // the empty label's trailing room, per unit of size
    const row = (s) => x * s + 0.45 * s + measure('Maximilian') * NAME_CHIP_TEXT * s + 1.3 * s;
    const s = 2;
    // Just wide enough for the chip at its drawn size: one row; a hair less: two.
    expect(boardRowsHeight(one, s, row(s), measure)).toBeCloseTo(1.75 * s, 9);
    expect(boardRowsHeight(one, s, row(s) - 0.05, measure)).toBeGreaterThan(1.75 * s);
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

  it('the pickup board\'s count: 2.5u (1.8u at the foot) at 1 in Galindo', () => {
    const rule = body('.checkout-count');
    expect(Math.abs(u(rule) - 2.5 * 1.05)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(lh(rule) - 1 / 1.05)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(u(body('.checkout-board--foot .checkout-count')) - 1.8 * 1.05)).toBeLessThanOrEqual(0.01);
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

describe('the pickup board columns (fitColumns)', () => {
  // A fixed-width face: every character 0.6em, so the arithmetic is plain.
  const mono = (text) => text.length * 0.6;
  const box = { width: 65.4, height: 23.6, head: 6, gap: 1.2, max: 2.6, min: 1 };
  const club = (name, n) => ({ club: name, names: Array.from({ length: n }, (_, i) => `Kid${String(i).padStart(2, '0')}`) });

  it('a few names per club take the largest size, one column each', () => {
    const fit = fitColumns([club('Sparks', 3), club('T&T', 2)], box, mono);
    expect(fit).toEqual({ size: 2.6, split: [1, 1], fits: true });
  });

  it('more clubs or longer names step the size down until the widest fits its column', () => {
    const six = ['Puggles', 'Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey'].map((n) => club(n, 3));
    const fit = fitColumns(six, box, mono);
    expect(fit.fits).toBe(true);
    const colW = (box.width - box.gap * 5) / 6;
    expect(mono('Kid00') * NAME_CHIP_TEXT * fit.size + 1.3 * fit.size).toBeLessThanOrEqual(colW + 1e-9);
    expect(fit.size).toBeLessThan(2.6);
  });

  it('a long club splits into side-by-side sub-columns before it shrinks to nothing', () => {
    const fit = fitColumns([club('Sparks', 24), club('T&T', 2)], box, mono);
    expect(fit.fits).toBe(true);
    expect(fit.split[0]).toBeGreaterThan(1);
    expect(fit.split[1]).toBe(1);
    // Every sub-column's rows fit under the head.
    const rowsFit = Math.floor((box.height - box.head + 0.4 * fit.size) / (2.15 * fit.size));
    expect(Math.ceil(24 / fit.split[0])).toBeLessThanOrEqual(rowsFit);
  });

  it('says when even the smallest size cannot hold a huge board', () => {
    const huge = ['Puggles', 'Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey'].map((n) => club(n, 60));
    const fit = fitColumns(huge, box, mono);
    expect(fit.fits).toBe(false);
    expect(fit.size).toBe(1);
    expect(fit.split.every((n) => n <= 3)).toBe(true);
  });
});

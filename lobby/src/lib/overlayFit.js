// @ts-check
// Where the lobby's overlays go, and how big their words can be (rebrand
// stage 4b-2). Pure: a layout table, and fits that turn text into sizes by
// measuring it in the face that will draw it (lobbyFrame's measureText), so
// a long name or a 200-character notice steps down instead of spilling out
// of its band. The components only render the result.
//
// Every length is in u, 1% of a 16:9 stage's width (min(1vw, 1.7778vh)),
// the unit the lobby scene, the corner chips and the check-in moment use.

import { SHOUT_BOX } from './brand.js';
import { measureText } from './lobbyFrame.js';
import { BOARD_ANONYMOUS, BOARD_EMPTY, BOARD_NAMES, BOARD_STALE } from './checkoutBoard.js';

/** @typedef {import('./lobbyFrame.js').Face} Face */
/** @typedef {(text: string, face: Face) => number} Measure */

/* ── The layout ───────────────────────────────────────────────────── */

/**
 * The overlay bands, measured against the lobby's own furniture:
 *
 *  - the corner tab fills 0-24u across the top-left (its fat end reaches
 *    ~22u for the first 10u down); the top-right stack (the status sticker
 *    over the weather chip) starts at ~78u with the sticker's longest
 *    wording, ~88u without it;
 *  - the slide copy starts at 15.1u and only ever rises to 11u (lobbyFrame
 *    LAYOUT.safeTop), and ends by 45u;
 *  - the house waves' crests sit at ~46.5-48u; the tonight ticker's chips
 *    ride the waves up to ~5u off the bottom; the corner chip bottom-right
 *    starts at ~80u; the gear bottom-left ends at ~4u;
 *  - the check-in wave is the bottom 29.25u (52% of the 16:9 box).
 *
 * `band`: the top-centre strip between the corner tab and the top-right
 * stack, above the highest the copy can rise. Notices and milestone toasts
 * take turns in it, one at a time, and every plate in it is fitted to END
 * by `band.bottom` (bandRoom). `flags` is the demo / rehearsal / simplified
 * strip that hangs from the top edge above it; while it hangs, the band
 * starts under it (bandTop) and has that much less height.
 *
 * `centre`: the copy's own region, for the one thing that takes the room over
 * while it is up, a critical notice; the copy steps back behind it the way it
 * does for a name. Nothing else takes the middle: the pickup board stopped
 * doing so on 2026-10-07 (it has the foot, below).
 *
 * `stack.stickerMax`: how tall the status sticker may stand before the chip
 * stacked under it would reach a raised headline.
 *
 * `foot`: the strip under the copy's lowest line (`top`: LAYOUT.safeBottom, 45u
 * down the 16:9 box, down to the corner chip's own line, `bottom` 1.8u off the
 * bottom edge), from a `gap` past the gear's right edge to a `gap` short of
 * the corner chip's left edge (`chipLeft`, ~82u, the number the ticker's room
 * is measured to). Nothing the lobby draws on a slide comes below `top`, so
 * whatever stays in the strip can never cover copy. Two things take turns in
 * it (app.css `.checkout-region`, `.setup-card`):
 *
 *  - the pickup board, whenever it is on (owner, 2026-10-07: "The still
 *    remaining kids list should just take the bottom of the screen. It
 *    shouldn't take over all of the announcements."): at pickup time the whole
 *    strip, its names wrapping across it (fitFoot), and otherwise a one-line
 *    card on the strip's floor; the slides above carry on as normal;
 *  - the first-run card (`setup`, the same seat), which yields to the board.
 *    It used to stand above the gear, 25u wide and 25u tall, which is inside
 *    the copy's own box at every size: it hid the start of a headline at 720p
 *    and the chip row at 1080p. It lays its words out in columns to fit the
 *    ~11u the strip leaves.
 */
const FOOT = { top: 45, bottom: 1.8, gap: 1.2, chipLeft: 82 };
export const OVERLAY = {
  band: { top: 1.4, width: 50, bottom: 10.4 },
  flags: { height: 2.5, gap: 0.6, width: 54 },
  centre: { top: 12, bottom: 46, width: 70 },
  foot: FOOT,
  setup: FOOT,
  // The top-right stack: the status sticker, then the weather chip (~6.4u
  // tall, 0.9u under it) from ~1.4u down. The chip must end by 14u, where a
  // raised row wider than 45u starts (lobbyFrame), so a sticker taller than
  // this sends the weather out of the rotation (App's stickerTall).
  stack: { stickerMax: 5.2 },
};

/**
 * Where the band starts: under the flag strip while one hangs. app.css's
 * `--band-top` carries the same two values (.stage / .stage.has-flags).
 * @param {boolean} [flags]
 */
export function bandTop(flags = false) {
  return flags ? OVERLAY.flags.height + OVERLAY.flags.gap : OVERLAY.band.top;
}

/**
 * How much height a plate in the band has, top to `band.bottom`.
 * @param {boolean} [flags]
 */
export function bandRoom(flags = false) {
  return OVERLAY.band.bottom - bandTop(flags);
}

/**
 * The stepped plate's height above its block's content, for a label of
 * `label` u: the pill (2.05 x the label's size) less the block's tuck up
 * under it (0.087 of the pill), the numbers app.css `.step-plate` uses.
 * @param {number} label
 */
export function plateChrome(label) {
  return 2.05 * label * (1 - 0.087);
}

/* ── Who holds which part of the room ────────────────────────────── */

/**
 * Where the pickup board goes, given the decision decideBoard made (that
 * decision, what it may show and whether it may name anyone, is not this
 * function's business; this only decides WHERE).
 *
 *  - 'foot': whenever it shows anything (names, the anonymous line, a stale or
 *    empty board). It has the strip under the copy (OVERLAY.foot) and never
 *    the middle: at pickup time its names wrap across the whole strip, the
 *    rest of the time it is a one-line card on the strip's floor (what it
 *    lists is CheckoutBoard's `pickup`). The slides above carry on as normal
 *    either way: a stale card on a Tuesday must never blank the lobby, and
 *    since 2026-10-07 neither may the list at pickup time (owner: it
 *    "shouldn't take over all of the announcements"). Until then a live list
 *    at pickup time took the centre and the copy stepped aside behind it.
 *  - null: hidden.
 *
 * @param {string | undefined} state  the BoardDecision's state
 * @returns {'foot' | null}
 */
export function boardPlacement(state) {
  return state === BOARD_NAMES || state === BOARD_ANONYMOUS || state === BOARD_STALE || state === BOARD_EMPTY
    ? 'foot'
    : null;
}

/**
 * Who holds which part of the lobby right now. Pure, so every rule about two
 * overlays meeting is tested rather than eyeballed; App renders the answer.
 *
 *  - The board: boardPlacement, never on an OBS feed and never while a name
 *    is up (a child at the door outranks the pickup list).
 *  - A "has checked out" banner (`leaveUp`: one is waiting its turn) takes
 *    the foot in the board's place while it is up, under the same two rules;
 *    the board comes back when it goes.
 *  - A critical notice takes the centre, except on an OBS feed (no slide
 *    behind it), where it takes the top band. The board in the foot changes
 *    nothing about it: the two never meet (the centre ends above the strip).
 *  - The copy steps aside only for a critical notice in the centre.
 *  - A toast never shares the band with a critical notice: on a feed it drops
 *    below the notice. Nothing else holds the celebrations back here (a held
 *    slide does, in App).
 *
 * @param {{
 *   overlay?: boolean,
 *   criticalLive?: boolean,
 *   boardState?: string,
 *   checkInUp?: boolean,
 *   leaveUp?: boolean,
 * }} s
 */
export function lobbyRoom({ overlay = false, criticalLive = false, boardState, checkInUp = false, leaveUp = false }) {
  // A "has checked out" banner borrows the foot from the board while it is up
  // (owner, 2026-10-08), and the board comes back after it.
  /** @type {'foot' | null} */
  const banner = overlay || checkInUp || !leaveUp ? null : 'foot';
  /** @type {'foot' | null} */
  const board = overlay || checkInUp || banner ? null : boardPlacement(boardState);
  /** @type {'centre' | 'band' | null} */
  const critical = !criticalLive ? null : overlay ? 'band' : 'centre';
  return {
    board,
    banner,
    critical,
    copyAside: critical === 'centre',
    toastBelow: critical === 'band',
  };
}

/**
 * Whether the first-run card has the foot of the room right now. `due` is
 * the card's own judgement (unconfigured and not dismissed: SetupCard's
 * `useSetupCard`); this decides only whether the room has space for it.
 * Pure, like lobbyRoom, so the rules are tested rather than eyeballed.
 *
 *  - Never on an OBS feed (operator chrome never reaches one), and never
 *    over an open panel, which has its own backdrop.
 *  - A name outranks it: the check-in wave rises through the bottom of the
 *    room, exactly where the card stands. `checkInUp` is "a name is on
 *    screen", and that holds from the run's first frame to its last: the
 *    child on screen, the run's exit still playing, the gap after it (never
 *    shorter than the exit) and a quiet beat (SETUP_CARD_QUIET_MS) on top,
 *    so names a few seconds apart do not have the card popping in between
 *    them. A caller that passed only "a child is on screen" put the card
 *    back over the name it was leaving.
 *  - A held slide (a promo poster, a marked slide) is its own moment and
 *    the chrome steps aside for it, so does the card. `held` is judged by
 *    what the room sees: from the moment the slide is chosen until the
 *    stinger has cleared after it (App lingers the flag by STINGER_SEC).
 *  - Whatever holds the middle of the room (a critical notice) or the foot
 *    (the pickup board, whatever it shows, or a "has checked out" banner,
 *    in the card's own seat; the
 *    tonight strip while it has counts to show) has the room: the card
 *    waits. Content over instructions, every time: the card is a prompt for
 *    one volunteer, and these are what the lobby is showing.
 *
 * `room` is lobbyRoom's answer for the same moment; `ticker` says the
 * tonight strip is up (TonightTicker.jsx tickerRows).
 *
 * @param {{
 *   due?: boolean,
 *   overlay?: boolean,
 *   panelOpen?: boolean,
 *   checkInUp?: boolean,
 *   held?: boolean,
 *   ticker?: boolean,
 *   room?: { board?: 'foot' | null, banner?: 'foot' | null, critical?: 'centre' | 'band' | null },
 * }} s
 * @returns {boolean}
 */
export function setupUp({ due = false, overlay = false, panelOpen = false, checkInUp = false, held = false, ticker = false, room = {} }) {
  if (!due || overlay || panelOpen || checkInUp || held || ticker) return false;
  return room.board == null && room.banner == null && room.critical !== 'centre';
}

/* ── One shouted line (a toast) ──────────────────────────────────── */

/**
 * The largest size (on `step`) at which `text` fits `width`, shouted in
 * Paytone One caps: one line if it can be read at `min` or more, else the most
 * balanced two-line break (the split whose longer line is shortest, which is
 * also the one that can be set largest) at up to `twoLineMax`, and no smaller
 * than `twoLineMin`. `fits` false means even that is too wide: the caller
 * must let the line wrap (a 40-character first name), never set it unbroken.
 *
 * @param {string} text
 * @param {{ width: number, max: number, min: number, step?: number, twoLineMax?: number, twoLineMin?: number }} box
 * @param {Measure} [measure]
 * @returns {{ size: number, lines: string[], fits: boolean }}
 */
export function fitShout(text, {
  width, max, min, step = 0.1, twoLineMax = max, twoLineMin = Math.min(min, twoLineMax),
}, measure = measureText) {
  const clean = String(text ?? '').trim().replace(/\s+/g, ' ');
  const caps = clean.toUpperCase();
  const one = measure(caps, 'shout');
  const sizeFor = (/** @type {number} */ em, /** @type {number} */ hi) => {
    if (em <= 0) return hi;
    const s = Math.floor((width / em) / step) * step;
    return Math.min(hi, Number(s.toFixed(3)));
  };
  const s1 = sizeFor(one, max);
  if (s1 >= min) return { size: s1, lines: [clean], fits: true };

  const words = clean.split(' ');
  if (words.length > 1) {
    let best = /** @type {{ em: number, lines: string[] } | null} */ (null);
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' ');
      const b = words.slice(i).join(' ');
      const em = Math.max(measure(a.toUpperCase(), 'shout'), measure(b.toUpperCase(), 'shout'));
      if (!best || em < best.em) best = { em, lines: [a, b] };
    }
    if (best) {
      const size = sizeFor(best.em, twoLineMax);
      return size >= twoLineMin
        ? { size, lines: best.lines, fits: true }
        : { size: twoLineMin, lines: best.lines, fits: false };
    }
  }
  return { size: min, lines: [clean], fits: false };
}

/* ── A paragraph (a notice) ──────────────────────────────────────── */

/**
 * Greedy word wrap of `text` at `size` into lines no wider than `width`,
 * measured in `face`. A single word wider than the line takes a line of its
 * own (CSS then breaks it, which only a pasted URL ever needs).
 *
 * @param {string} text
 * @param {number} size
 * @param {number} width
 * @param {Face} face
 * @param {Measure} [measure]
 * @returns {string[]}
 */
export function wrapLines(text, size, width, face, measure = measureText) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const space = measure(' ', face) * size || 0.28 * size;
  /** @type {string[]} */
  const lines = [];
  let line = '';
  let w = 0;
  for (const word of words) {
    const ww = measure(word, face) * size;
    if (line && w + space + ww > width) {
      lines.push(line);
      line = word;
      w = ww;
    } else {
      w = line ? w + space + ww : ww;
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The same words in the same number of lines as the greedy wrap, broken so
 * the longest line is as short as it can be (a small min-max partition over
 * the words), so a plate built around the text hugs it instead of running
 * the full width with a short last line.
 *
 * @param {string} text
 * @param {number} count  how many lines
 * @param {number} size
 * @param {Face} face
 * @param {Measure} [measure]
 * @returns {string[]}
 */
export function balanceLines(text, count, size, face, measure = measureText) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const n = words.length;
  const k = Math.max(1, Math.min(count, n));
  if (n === 0) return [];
  if (k === 1) return [words.join(' ')];
  const space = measure(' ', face) * size || 0.28 * size;
  const w = words.map((word) => measure(word, face) * size);
  // span(i, j): the width of words i..j-1 on one line.
  const pre = [0];
  for (let i = 0; i < n; i++) pre.push(pre[i] + w[i]);
  const span = (/** @type {number} */ i, /** @type {number} */ j) => pre[j] - pre[i] + space * (j - i - 1);
  // best[l][j]: the least possible longest line setting the first j words in l lines.
  const best = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(Infinity));
  const cut = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(0));
  best[0][0] = 0;
  for (let l = 1; l <= k; l++) {
    for (let j = l; j <= n; j++) {
      for (let i = l - 1; i < j; i++) {
        const v = Math.max(best[l - 1][i], span(i, j));
        if (v < best[l][j]) { best[l][j] = v; cut[l][j] = i; }
      }
    }
  }
  /** @type {string[]} */
  const lines = [];
  let j = n;
  for (let l = k; l >= 1; l--) {
    const i = cut[l][j];
    lines.unshift(words.slice(i, j).join(' '));
    j = i;
  }
  return lines;
}

/**
 * The largest size (on `step`, from `max` down to `min`) at which `text`
 * wraps into at most `maxLines` lines of `width`, and those lines, balanced.
 * With a `height` (u), the lines must also stack inside it at `lineHeight`,
 * so a plate in the band ends where the band ends. At `min` it may take more
 * lines than that (the caller's box grows); `fits` says which happened.
 * `hug` says every line was measured to fit, so the caller may set them
 * unbroken and let its plate hug the longest; a word wider than the whole
 * line (a pasted URL) turns it off, and the caller lets the browser wrap
 * instead.
 *
 * @param {string} text
 * @param {{ width: number, max: number, min: number, maxLines: number, step?: number, face?: Face, height?: number, lineHeight?: number }} box
 * @param {Measure} [measure]
 * @returns {{ size: number, lines: number, fits: boolean, text: string[], hug: boolean }}
 */
export function fitParagraph(text, {
  width, max, min, maxLines, step = 0.1, face = 'body', height = Infinity, lineHeight = 1.2,
}, measure = measureText) {
  const done = (/** @type {number} */ size, /** @type {number} */ count, /** @type {boolean} */ fits) => {
    const lines = balanceLines(text, count, size, face, measure);
    const hug = lines.every((l) => measure(l, face) * size <= width + 1e-6);
    return { size: Number(size.toFixed(3)), lines: count, fits, text: lines, hug };
  };
  for (let s = max; s >= min - 1e-9; s = Number((s - step).toFixed(3))) {
    const lines = wrapLines(text, s, width, face, measure).length;
    if (lines <= maxLines && lines * s * lineHeight <= height + 1e-9) return done(s, lines, true);
  }
  return done(min, wrapLines(text, min, width, face, measure).length, false);
}

/* ── The pickup board's name chips ───────────────────────────────── */

/**
 * The name's size inside its chip, per unit of the chip's size (the fit's
 * `s`, app.css --name-size). The chips were drawn around Galindo's caps;
 * Paytone One's stand 5.7% shorter at one size, so the name is drawn that
 * much larger in a pill that keeps its size (app.css .checkout-name__chip
 * carries the same number).
 */
export const NAME_CHIP_TEXT = 1.057;

/**
 * The least clear space a name's ink keeps from its chip's edges, em. More
 * than the kit's 0.06em: the pill has no keyline, so its edge meets the white
 * card, which swallows a white mark that reaches it, and at 720p Chromium
 * paints a small accent up to a pixel above its outline (measured on the
 * board's 28px names), which 0.06em (1.7px there) did not survive.
 */
export const NAME_CHIP_CLEAR = 0.1;
/** The name's hard shadow (app.css .checkout-name__chip text-shadow), em. */
const NAME_CHIP_SHADOW = 0.06;

/**
 * How far a name sits below its chip's own line, in em of the name (the
 * chip's font size; app.css .checkout-name__chip's `--seat`). The pill is
 * 1.75 / NAME_CHIP_TEXT em tall at that line height, which hangs the
 * baseline ~1.09em under its top and ~0.566em over its bottom: plain names,
 * lowercase marks and a hanging comma (Ștefan) all sit well inside, but
 * Paytone One's capitals carry their marks tall (É and Á to 1.045em, Ễ
 * 1.161em, Ấ 1.183em), up to or through the pill's top edge and onto the
 * white card. So a name whose ink (inkEm / measureInk: em above and below its
 * baseline) would come within `NAME_CHIP_CLEAR` of the top moves down just far
 * enough, never so far that its lowest ink and shadow come within the same of
 * the bottom (the rule a chip's value follows, brand.js valueSeat). The pill
 * keeps its size; a plain name gets 0 and sits exactly where it did.
 * @param {{ ascent: number, descent: number }} ink
 * @returns {number}
 */
export function nameChipSeat(ink) {
  const height = 1.75 / NAME_CHIP_TEXT;
  const above = (SHOUT_BOX.ascent - SHOUT_BOX.descent + height) / 2;
  const need = ink.ascent + NAME_CHIP_CLEAR - above;
  if (!(need > 0)) return 0;
  const spare = height - above - (Math.max(0, ink.descent) + NAME_CHIP_SHADOW + NAME_CHIP_CLEAR);
  // Rounded to the room's side: up for the mark's need, down for what is spare.
  const drop = Math.min(Math.ceil(need * 1000 - 1e-6), Math.floor(spare * 1000 + 1e-6)) / 1000;
  return drop > 0 ? drop : 0;
}

/**
 * The foot board's pieces, per unit of the chip size `s` (the name's font
 * size before NAME_CHIP_TEXT; app.css `--name-size`, every rule below in em of
 * it): a name chip is its name drawn NAME_CHIP_TEXT x s plus `pad` of padding
 * and `row` tall; chips and rows stand `gap` apart. A club's plate is as tall
 * as a chip: `plate.pad` of padding in all, then the club's white mark (a box
 * at most `plate.mark` wide) or its name, `plate.gap`, and "N WAITING", both
 * in Londrina caps at `plate.label` with `plate.track` of tracking per letter.
 * A "+N more" chip is a name chip whose name is "+N more".
 */
export const FOOT_CHIP = {
  row: 1.75,
  gap: 0.45,
  pad: 1.3,
  plate: { pad: 1.1, mark: 2.6, gap: 0.35, label: 0.72, track: 0.06 },
};

/**
 * The least a name chip may be on a real screen, px (the name is drawn
 * NAME_CHIP_TEXT x it): smaller than this a lobby cannot read it, and
 * fitFoot puts names behind "+N more" instead.
 */
export const FOOT_FLOOR_PX = 10;

/**
 * The chip sizes a run `height` tall may use: at most two rows of the
 * largest chips (a short list is big), never smaller than a twelfth of its
 * height, nor than `floor` (FOOT_FLOOR_PX on a real screen, in px; 0 for a TV
 * drawn in miniature, which keeps its proportions instead).
 * @param {number} height
 * @param {number} [floor]
 * @returns {{ max: number, min: number }}
 */
export function footRange(height, floor = 0) {
  const max = height / (2 * FOOT_CHIP.row + FOOT_CHIP.gap);
  return { max, min: Math.min(max, Math.max(floor, height / 12)) };
}

/** The words a club's plate counts with, and a trimmed club's last chip. */
export const waitingLabel = (/** @type {number} */ n) => `${n} waiting`;
export const moreLabel = (/** @type {number} */ n) => `+${n} more`;

/**
 * The widths of the pieces of the foot board's one wrapping run, in the
 * order they stand: per club its plate, its shown names (the first, by the
 * order given, which is alphabetical), and a "+N more" chip when `hidden` of
 * them do not fit. Each is capped at the run's `width` (a chip that long is
 * cut short with an ellipsis, app.css).
 *
 * @param {{ club: string, names: string[], mark?: boolean }[]} groups
 * @param {number[]} hidden  per club, how many of its names stand behind "+N more"
 * @param {number} s
 * @param {number} width
 * @param {Measure} measure
 * @returns {number[]}
 */
function footPieces(groups, hidden, s, width, measure) {
  const { pad, plate } = FOOT_CHIP;
  const label = (/** @type {string} */ text) => {
    const caps = text.toUpperCase();
    return (measure(caps, 'label') + plate.track * [...caps].length) * plate.label * s;
  };
  const chip = (/** @type {string} */ text) => Math.min(width, measure(text, 'shout') * NAME_CHIP_TEXT * s + pad * s);
  /** @type {number[]} */
  const out = [];
  groups.forEach((g, i) => {
    const head = g.mark ? plate.mark * s : label(String(g.club || ''));
    out.push(Math.min(width, plate.pad * s + head + plate.gap * s + label(waitingLabel(g.names.length))));
    const shown = g.names.length - (hidden[i] || 0);
    for (let j = 0; j < shown; j += 1) out.push(chip(g.names[j]));
    if (hidden[i]) out.push(chip(moreLabel(hidden[i])));
  });
  return out;
}

/**
 * How tall a run of pieces stands at chip size `s` when it wraps inside
 * `width` (rows `FOOT_CHIP.row` tall, `FOOT_CHIP.gap` apart either way), the
 * way a wrapping flex row lays them out.
 * @param {number[]} pieces
 * @param {number} s
 * @param {number} width
 */
export function footHeight(pieces, s, width) {
  if (!pieces.length) return 0;
  const gap = FOOT_CHIP.gap * s;
  let rows = 1;
  let x = 0;
  for (const w of pieces) {
    if (x > 0 && x + gap + w > width + 1e-9) {
      rows += 1;
      x = w;
    } else {
      x += (x > 0 ? gap : 0) + w;
    }
  }
  return rows * FOOT_CHIP.row * s + (rows - 1) * gap;
}

/**
 * The pickup board's names in the foot (owner, 2026-10-07: the list takes the
 * bottom of the screen, never the announcements above it): every club's plate
 * and name chips in one run that wraps across the strip. The largest chip size
 * (on `step`, from `max` down to `min`) at which the whole run fits `width` x
 * `height`; where even `min` cannot hold it, names come off the longest club
 * first, one at a time (the last alphabetically), into a "+N more" chip at
 * that club's end, until it fits. Every club keeps its plate, which still
 * counts all of its children, so nobody is ever silently left off. `fits` is false only
 * when even the plates and their "+N more" chips cannot fit (a box far too
 * small for any list), and the run is then cut by the box. Units are the
 * caller's (u, or px), the same for every number.
 *
 * @param {{ club: string, names: string[], mark?: boolean }[]} groups  clubs in order, names sorted; `mark`: the plate shows the club's mark
 * @param {{ width: number, height: number, max: number, min: number, step?: number }} box
 * @param {Measure} [measure]
 * @returns {{ size: number, hidden: number[], fits: boolean }}
 */
export function fitFoot(groups, { width, height, max, min, step = 0.05 }, measure = measureText) {
  const none = groups.map(() => 0);
  const fitsAt = (/** @type {number} */ s, /** @type {number[]} */ hidden) =>
    footHeight(footPieces(groups, hidden, s, width, measure), s, width) <= height + 1e-9;
  const top = Math.max(min, max);
  const stepAt = step > 0 ? step : 0.05;
  for (let s = top; s >= min - 1e-9; s = Number((s - stepAt).toFixed(4))) {
    if (fitsAt(s, none)) return { size: Number(s.toFixed(3)), hidden: none, fits: true };
  }
  const hidden = [...none];
  while (!fitsAt(min, hidden)) {
    let pick = -1;
    groups.forEach((g, i) => {
      const shown = g.names.length - hidden[i];
      if (shown > 0 && (pick === -1 || shown >= groups[pick].names.length - hidden[pick])) pick = i;
    });
    if (pick === -1) return { size: Number(min.toFixed(3)), hidden, fits: false };
    hidden[pick] += 1;
  }
  return { size: Number(min.toFixed(3)), hidden, fits: true };
}

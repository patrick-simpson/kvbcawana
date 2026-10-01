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
 * `centre`: the copy's own region, for the two things that take the room
 * over while they are up (a critical notice, and the pickup board while it
 * is the room's focus: see boardPlacement); the copy steps back behind them
 * the way it does for a name.
 *
 * `stack.stickerMax`: how tall the status sticker may stand before the chip
 * stacked under it would reach a raised headline.
 *
 * `foot`: the pickup board's small spot when it is NOT the room's focus (a
 * stale or empty board, or one outside pickup time): bottom-centre, between
 * the copy's lowest line and the ticker, beside the slides rather than
 * over them.
 *
 * `setup`: the first-run card's seat (SetupCard.jsx, app.css `.setup-card`):
 * the strip under the copy's lowest line (`top`: LAYOUT.safeBottom, 45u
 * down the 16:9 box), from the gear's right edge to the corner chip's left
 * edge (`chipLeft`, ~82u, the number the ticker's room is measured to), a
 * `gap` clear of each. It used to stand above the gear, 25u wide and 25u
 * tall, which is inside the copy's own box at every size: it hid the start
 * of a headline at 720p and the chip row at 1080p. Nothing the lobby draws
 * on a slide comes below `top`, so a card that stays under it can never
 * cover copy; it lays its words out in columns to fit the 11u that leaves.
 */
export const OVERLAY = {
  band: { top: 1.4, width: 50, bottom: 10.4 },
  flags: { height: 2.5, gap: 0.6, width: 54 },
  centre: { top: 12, bottom: 46, width: 70 },
  foot: { bottom: 5.6, width: 56 },
  setup: { top: 45, gap: 1.2, chipLeft: 82 },
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
 * function's business; this only decides WHERE and how much room it takes).
 *
 *  - 'centre': it is the room's focus: a live list (names, or the
 *    anonymous "almost everyone") while the room is being picked up (the
 *    pickup window, checkoutBoard.js pickupNow). It takes the middle and the
 *    slide copy steps aside.
 *  - 'foot': it is on, but the room is not being picked up (an "always"
 *    board during the program), or it has nothing live to list (stale,
 *    empty). A one-line card in the foot beside the slides, which keep
 *    playing: a stale card on a Tuesday must never blank the lobby.
 *  - null: hidden.
 *
 * @param {string | undefined} state  the BoardDecision's state
 * @param {boolean} pickup  whether the room is being picked up right now
 * @returns {'centre' | 'foot' | null}
 */
export function boardPlacement(state, pickup) {
  if (state === BOARD_NAMES || state === BOARD_ANONYMOUS) {
    return pickup ? 'centre' : 'foot';
  }
  if (state === BOARD_STALE || state === BOARD_EMPTY) return 'foot';
  return null;
}

/**
 * Who holds which part of the lobby right now. Pure, so every rule about two
 * overlays meeting is tested rather than eyeballed; App renders the answer.
 *
 *  - The board: boardPlacement, never on an OBS feed and never while a name
 *    is up (a child at the door outranks the pickup list).
 *  - A critical notice takes the centre, except where the centre is not its
 *    to take: on an OBS feed (no slide behind it) and while the pickup board
 *    holds the centre (both must stay whole). There it takes the top band.
 *  - The copy steps aside for whichever holds the centre.
 *  - A toast never shares the band with a critical notice: on a feed it drops
 *    below the notice; over the pickup board there is no room below, so the
 *    celebrations wait (and one already up steps aside) until one of the two
 *    goes.
 *
 * @param {{
 *   overlay?: boolean,
 *   criticalLive?: boolean,
 *   boardState?: string,
 *   pickup?: boolean,
 *   checkInUp?: boolean,
 * }} s
 */
export function lobbyRoom({ overlay = false, criticalLive = false, boardState, pickup = false, checkInUp = false }) {
  // Where the board sits, whether or not a check-in run is hiding it right
  // now. The notice's seat and the celebration hold follow the SEAT, so a late
  // arrival at pickup time does not throw a band notice into the middle for
  // the length of the run (and over the WELCOME kicker), nor let a queued
  // toast up only to hide it again when the run ends.
  const seat = overlay ? null : boardPlacement(boardState, pickup);
  const board = checkInUp ? null : seat;
  /** @type {'centre' | 'band' | null} */
  const critical = !criticalLive ? null : overlay || seat === 'centre' ? 'band' : 'centre';
  const holdCelebrations = critical === 'band' && seat === 'centre';
  return {
    board,
    critical,
    copyAside: board === 'centre' || critical === 'centre',
    holdCelebrations,
    toastBelow: critical === 'band' && !holdCelebrations,
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
 *  - Whatever holds the middle of the room (the pickup list, a critical
 *    notice) or the foot (the pickup board's one-line card, the tonight
 *    strip while it has counts to show) has the room: the card waits, as
 *    the celebrations do. Content over instructions, every time: the card is
 *    a prompt for one volunteer, and these are what the lobby is showing.
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
 *   room?: { board?: 'centre' | 'foot' | null, critical?: 'centre' | 'band' | null },
 * }} s
 * @returns {boolean}
 */
export function setupUp({ due = false, overlay = false, panelOpen = false, checkInUp = false, held = false, ticker = false, room = {} }) {
  if (!due || overlay || panelOpen || checkInUp || held || ticker) return false;
  return room.board == null && room.critical !== 'centre';
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
 * The board's chips at chip size `s` (the name's font size, u): each club is
 * a run of chips (the club's own label chip, then one chip per name) that
 * wraps inside `width`. Returns how tall the run of rows is, so the fit can
 * pick the largest size that keeps the whole board inside its region.
 *
 * Chip metrics are the CSS's (app.css `.checkout-*`): a name chip is its
 * text (drawn at NAME_CHIP_TEXT x s) plus 1.3 x s of padding, a club's
 * label its Londrina caps at 0.62 x s plus 0.34 x s after it, chips
 * 0.45 x s apart, rows 1.75 x s tall and 0.45 x s apart, and 0.7 x s
 * between clubs.
 *
 * @param {{ club: string, names: string[] }[]} groups
 * @param {number} s
 * @param {number} width
 * @param {Measure} [measure]
 */
export function boardRowsHeight(groups, s, width, measure = measureText) {
  const gap = 0.45 * s;
  const rowH = 1.75 * s;
  let rows = 0;
  for (const g of groups) {
    let x = measure(String(g.club || '').toUpperCase(), 'label') * 0.62 * s + 0.34 * s;
    rows += 1;
    for (const name of g.names) {
      const w = Math.min(width, measure(name, 'shout') * NAME_CHIP_TEXT * s + 1.3 * s);
      if (x + gap + w > width) {
        rows += 1;
        x = w;
      } else {
        x += gap + w;
      }
    }
  }
  const clubGaps = Math.max(0, groups.length - 1) * 0.7 * s;
  return rows * rowH + Math.max(0, rows - groups.length) * gap + clubGaps;
}

/**
 * The largest name size (on `step`) at which every club's chips fit inside
 * `height` x `width`; `min` if even that overflows (the board then scrolls
 * nothing and simply runs long, which only a 60-name board could make it).
 *
 * @param {{ club: string, names: string[] }[]} groups
 * @param {{ width: number, height: number, max: number, min: number, step?: number }} box
 * @param {Measure} [measure]
 * @returns {{ size: number, fits: boolean }}
 */
export function fitBoard(groups, { width, height, max, min, step = 0.05 }, measure = measureText) {
  for (let s = max; s >= min - 1e-9; s = Number((s - step).toFixed(3))) {
    if (boardRowsHeight(groups, s, width, measure) <= height) return { size: Number(s.toFixed(3)), fits: true };
  }
  return { size: min, fits: false };
}

/**
 * The pickup board's columns, one per club with children waiting: the largest
 * name size (on `step`) at which every column fits `height` under its `head`,
 * each name one chip on a row of its own, alphabetical. A club with more names
 * than one column holds at that size splits into two (then three) side by side
 * inside its column, which needs the room for its widest name in each; the
 * size steps down until every column fits, or stops at `min` with
 * `fits: false`. Returns the size and how many sub-columns each club takes.
 * Chip widths are the name in Paytone One at NAME_CHIP_TEXT x the size plus
 * 1.3 of padding, as boardRowsHeight models them; rows are 1.75 tall with a
 * 0.4 gap.
 *
 * @param {{ club: string, names: string[] }[]} groups
 * @param {{ width: number, height: number, head: number, gap: number, max: number, min: number, step?: number }} box
 * @param {Measure} [measure]
 * @returns {{ size: number, split: number[], fits: boolean }}
 */
export function fitColumns(groups, { width, height, head, gap, max, min, step = 0.05 }, measure = measureText) {
  const n = Math.max(1, groups.length);
  const colW = (width - gap * (n - 1)) / n;
  const widest = groups.map((g) => Math.max(0, ...g.names.map((name) => measure(name, 'shout') * NAME_CHIP_TEXT)));
  /** @param {number} s */
  const tryAt = (s) => {
    const rowH = 1.75 * s;
    const rowGap = 0.4 * s;
    const rowsFit = Math.max(1, Math.floor((height - head + rowGap) / (rowH + rowGap)));
    const split = [];
    for (let i = 0; i < groups.length; i += 1) {
      const sub = Math.ceil(groups[i].names.length / rowsFit);
      const subW = (colW - 0.5 * s * (sub - 1)) / sub;
      if (sub > 3 || widest[i] * s + 1.3 * s > subW) return null;
      split.push(sub);
    }
    return split;
  };
  for (let s = max; s >= min - 1e-9; s = Number((s - step).toFixed(3))) {
    const split = tryAt(s);
    if (split) return { size: Number(s.toFixed(3)), split, fits: true };
  }
  const rowH = 1.75 * min;
  const rowsFit = Math.max(1, Math.floor((height - head + 0.4 * min) / (rowH + 0.4 * min)));
  return { size: min, split: groups.map((g) => Math.min(3, Math.ceil(g.names.length / rowsFit))), fits: false };
}

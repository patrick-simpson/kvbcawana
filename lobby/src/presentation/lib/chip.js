// @ts-check
// The stepped chip's geometry for the projector: the catalog's two-tier
// lockup (p.63 "GRADES / 9-12"), a small label on a pill over a big value on
// a block that steps out beneath it. The projector may not import the lobby's
// src/lib/brand.js (the isolation rule), so this is its own copy of the same
// proportions; chip.test.js checks the two agree, so they cannot drift.
//
// Pure functions only. StepChip.jsx draws with them. So is the shout's ink
// (inkEm, inkOverflow): the same copy of the lobby's, for Headline.jsx.

import tokens from '../../../shared/brand/tokens.json';

// Proportions measured off the catalog's own chip, in units of the chip's
// size (1em): the value is drawn at valueSize, the label at labelSize (~0.56
// of the value). The plate was drawn around Galindo's caps; Paytone One's
// are 5.7% shorter at one size, so both texts are drawn that much larger and
// keep their cap heights in an unchanged plate.
const CHIP = {
  valueSize: 1.06,
  labelSize: 0.59,
  pillHeight: 1.15,
  pillPad: 0.42,
  pillMin: 2.2,
  blockLeft: 0.84,
  blockTop: 1.05,
  blockHeight: 1.38,
  blockPad: 0.5,
  step: 0.5,
  radiusBR: 0.39,
  radiusBL: 0.27,
  // The least room between the value's ink and its block's top and bottom
  // edges (the white keyline), in em.
  valueClear: 0.06,
};

/**
 * Where the value's text sits in its block, and at what size, given its ink
 * (inkEm): centred as the catalog draws it, unless a mark over or under its
 * capitals (É, Ș) would come within CHIP.valueClear of the block's keyline;
 * then it moves just far enough the other way, and a value with marks both
 * above and below that the block cannot hold at full size is drawn as large
 * as the block allows. The lobby's valueSeat (src/lib/brand.js), copied.
 * @param {{ ascent: number, descent: number } | null | undefined} ink
 * @returns {{ y: number, size: number }}
 */
function valueSeat(ink) {
  const y = CHIP.blockTop + CHIP.blockHeight / 2 + 0.03;
  const size = CHIP.valueSize;
  if (!ink) return { y, size };
  const ascent = Math.max(0, ink.ascent);
  const descent = Math.max(0, ink.descent);
  const top = CHIP.blockTop + CHIP.valueClear;
  const bottom = CHIP.blockTop + CHIP.blockHeight - CHIP.valueClear;
  // SVG's central baseline sits this far (em) above the alphabetic one.
  const drop = (SHOUT_BOX.ascent - SHOUT_BOX.descent) / 2;
  const natural = y + drop * size;
  if (natural - ascent * size >= top && natural + descent * size <= bottom) return { y, size };
  const s = Math.min(size, Math.floor(((bottom - top) / (ascent + descent)) * 1000) / 1000);
  const baseline = Math.min(Math.max(y + drop * s, top + ascent * s), bottom - descent * s);
  return { y: baseline - drop * s, size: s };
}

/**
 * Geometry for one chip, built around its own text so nothing can spill off
 * the plate. Widths are advance widths in em of a 1em font (see measureEm).
 * `valueInk` is the value's ink (inkEm), so its marks keep off the keyline.
 * @param {number} labelEm
 * @param {number} valueEm
 * @param {{ ascent: number, descent: number } | null} [valueInk]
 */
export function chipGeometry(labelEm, valueEm, valueInk = null) {
  const seat = valueSeat(valueInk);
  const lw = Math.max(0, labelEm) * CHIP.labelSize;
  const vw = Math.max(0, valueEm) * seat.size;
  const H1 = CHIP.pillHeight;
  const r1 = H1 / 2;
  const W1 = Math.max(lw + CHIP.pillPad * 2, CHIP.pillMin);
  const bx0 = CHIP.blockLeft;
  const by0 = CHIP.blockTop;
  const by1 = by0 + CHIP.blockHeight;
  let bx1 = bx0 + vw + CHIP.blockPad * 2;
  // The value block always steps out past the label pill: that step is the
  // chip's whole silhouette.
  if (bx1 < W1 + CHIP.step) bx1 = W1 + CHIP.step;
  const rBR = CHIP.radiusBR;
  const rBL = CHIP.radiusBL;
  /** @param {number} v */
  const n = (v) => Number(v.toFixed(3));
  const d = [
    `M${n(r1)},0`, `L${n(W1 - r1)},0`, `A${n(r1)},${n(r1)} 0 0 1 ${n(W1)},${n(r1)}`,
    `L${n(W1)},${n(by0)}`, `L${n(bx1)},${n(by0)}`, `L${n(bx1)},${n(by1 - rBR)}`,
    `A${rBR},${rBR} 0 0 1 ${n(bx1 - rBR)},${n(by1)}`, `L${n(bx0 + rBL)},${n(by1)}`,
    `A${rBL},${rBL} 0 0 1 ${n(bx0)},${n(by1 - rBL)}`, `L${n(bx0)},${n(H1)}`, `L${n(r1)},${n(H1)}`,
    `A${n(r1)},${n(r1)} 0 0 1 0,${n(r1)}`, `A${n(r1)},${n(r1)} 0 0 1 ${n(r1)},0`, 'Z',
  ].join(' ');
  return {
    d,
    label: { x: W1 / 2, y: H1 / 2 + 0.02, size: CHIP.labelSize, width: lw },
    value: { x: (bx0 + bx1) / 2, y: seat.y, size: seat.size, width: vw },
    // Room for the plate's out-of-register offset (below and right).
    width: bx1 + 0.2,
    height: by1 + 0.14,
  };
}

/**
 * A rough advance width for when no canvas is available (tests).
 * @param {string} text
 */
const ROUGH = (text) => [...text].reduce((w, ch) => w + (ch === ' ' || ch === ':' || ch === '.' ? 0.3 : 0.64), 0);

/** @type {OffscreenCanvasRenderingContext2D | null | undefined} */
let ctx;

/** The rest of --font-display's stack (index.css), so a canvas measures what the page draws. */
const SHOUT_FALLBACK = '"Baloo 2 Variable", "Arial Rounded MT Bold", sans-serif';

/**
 * The advance width of `text` in em of the shout face (the kit's display
 * face, Paytone One), measured on an OffscreenCanvas where there is one,
 * else a per-character estimate. The chip also pins each text to its
 * measured width with SVG textLength, so a face that loads late can
 * squeeze, never spill.
 * @param {string} text
 * @param {string} [family]
 */
export function measureEm(text, family = tokens.fonts.display) {
  if (ctx === undefined) {
    try {
      ctx = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d') : null;
    } catch {
      ctx = null;
    }
  }
  if (!ctx) return ROUGH(text);
  ctx.font = `100px "${family}", ${SHOUT_FALLBACK}`;
  const w = ctx.measureText(text).width / 100;
  return Number.isFinite(w) && w > 0 ? w : ROUGH(text);
}

/* ── The shout's marks (the lobby's src/lib/brand.js, copied) ────── */

/**
 * Where the shout's caps sit in a line box, in em: index.css's
 * ascent-override / descent-override for Paytone One (kit.test.js pins them).
 */
export const SHOUT_BOX = { ascent: 0.96, descent: 0.436 };

/** @param {number} n */
const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * How far a line of shouted text reaches past its line box at line-height
 * `lineHeight`, in em, above and below: 0 for plain caps, more for a tall
 * mark (É reaches 1.045em, Ễ 1.161em, Ș's comma -0.351em).
 * @param {{ ascent: number, descent: number }} ink
 * @param {number} lineHeight
 * @param {number} [gap]
 * @returns {{ top: number, bottom: number }}
 */
export function inkOverflow(ink, lineHeight, gap = 0) {
  const above = (SHOUT_BOX.ascent - SHOUT_BOX.descent + lineHeight) / 2;
  const below = lineHeight - above;
  return {
    top: Math.max(0, round3(ink.ascent + gap - above)),
    bottom: Math.max(0, round3(ink.descent + gap - below)),
  };
}

// Combining marks that hang below the letter; every other one stands above.
const BELOW = /[\u0316-\u0319\u031C-\u0333\u0339-\u033C\u0345\u0347-\u0349\u034D\u034E\u0353-\u0356\u0359\u035A]/u;

/**
 * A text's ink above and below its baseline in em, from its marks alone
 * (no canvas): caps reach `cap`, a mark above 0.35em more and each stacked
 * one 0.12em, a mark below hangs 0.36em.
 * @param {string} text
 * @param {number} [cap]
 * @returns {{ ascent: number, descent: number }}
 */
export function markExtents(text, cap = 0.7) {
  let above = 0;
  let below = false;
  for (const ch of String(text).normalize('NFD').split(/(?=\P{M})/u)) {
    const marks = ch.match(/\p{M}/gu) ?? [];
    const low = marks.filter((m) => BELOW.test(m)).length;
    above = Math.max(above, marks.length - low);
    if (low) below = true;
  }
  return { ascent: round3(cap + (above ? 0.35 + 0.12 * (above - 1) : 0)), descent: below ? 0.36 : 0.02 };
}

/**
 * The ink of `text` above and below its baseline, in em of the shout face:
 * measured on the canvas, else estimated from its marks.
 * @param {string} text
 * @param {string} [family]
 * @returns {{ ascent: number, descent: number }}
 */
export function inkEm(text, family = tokens.fonts.display) {
  if (ctx === undefined) measureEm('', family);
  if (ctx) {
    ctx.font = `100px "${family}", ${SHOUT_FALLBACK}`;
    const m = ctx.measureText(text);
    const ascent = m.actualBoundingBoxAscent / 100;
    const descent = m.actualBoundingBoxDescent / 100;
    if (Number.isFinite(ascent) && Number.isFinite(descent) && ascent > 0) {
      return { ascent: round3(ascent), descent: round3(Math.max(0, descent)) };
    }
  }
  return markExtents(text);
}

/**
 * The widest a value can get while it counts: every digit swapped for a
 * zero (Paytone One's widest figure, 0.679em), so a chip carrying a ticking number is
 * sized once for the whole count instead of twitching every second.
 * @param {string} value
 */
export function widestDigits(value) {
  return value.replace(/[0-9]/g, '0');
}

/**
 * The size (in projector units: the value's font size) at which ONE chip
 * stands no wider than `widthU`, never above `maxU`. A chip's plate grows
 * with its value, so a free-typed value (the church's 60-character meeting
 * theme) would otherwise run off both edges of the wall.
 * @param {string} label
 * @param {string} value
 * @param {{ maxU: number, widthU: number }} fit
 */
export function fitChipU(label, value, { maxU, widthU }) {
  const width = chipGeometry(measureEm(label.toUpperCase()), measureEm(value), inkEm(value)).width;
  return Math.min(maxU, widthU / width);
}

/**
 * How many rows chips `widths` wide make on lines `row` wide with `gap`
 * between neighbours: first fit, in order, which is how CSS flex-wrap
 * breaks a row. Any one unit for all three.
 * @param {number[]} widths
 * @param {number} row
 * @param {number} gap
 */
export function wrapRows(widths, row, gap) {
  let rows = 0;
  let line = 0;
  for (const w of widths) {
    if (rows === 0 || line + gap + w > row) {
      rows += 1;
      line = w;
    } else {
      line += gap + w;
    }
  }
  return rows;
}

/** A chip's height in em of its size, whatever its text. */
export const CHIP_HEIGHT_EM = chipGeometry(0, 0).height;

/**
 * Layout slack against the browser's sub-pixel rounding: the row is taken
 * as this much (in units) narrower than it is, so the browser never breaks a
 * line the fit did not expect.
 */
const ROW_SLACK_U = 0.25;

/**
 * Fit a wrapping list of chips (`widthsEm`: each chip's width in em of its
 * value's size, see chipGeometry) inside a box `rowU` wide and `heightU`
 * tall, all at one size: the largest size up to `maxU` at which every chip
 * fits the row and the wrapped rows fit the height. Below `minU` a list
 * stops shrinking and drops chips from its end instead, so a room reading
 * from the back never gets type smaller than that; a single chip left alone
 * shrinks as far as it must, since dropping it would leave nothing.
 * @param {number[]} widthsEm
 * @param {{ maxU: number, minU: number, rowU: number, heightU: number, gapXU: number, gapYU: number }} box
 * @returns {{ sizeU: number, count: number }} the size, and how many chips (from the start) are shown
 */
export function fitChipList(widthsEm, { maxU, minU, rowU, heightU, gapXU, gapYU }) {
  const row = rowU - ROW_SLACK_U;
  /** @param {number[]} list @param {number} s */
  const fits = (list, s) => {
    if (list.some((w) => w * s > row)) return false;
    const rows = wrapRows(list.map((w) => w * s), row, gapXU);
    return rows * CHIP_HEIGHT_EM * s + (rows - 1) * gapYU <= heightU;
  };
  for (let count = widthsEm.length; count >= 1; count--) {
    const list = widthsEm.slice(0, count);
    if (fits(list, maxU)) return { sizeU: maxU, count };
    const floor = count === 1 ? 0 : minU;
    if (!fits(list, floor)) continue;
    // Fewer rows can only come from smaller chips, so the fit is monotone:
    // bisect between a size that fits and one that does not.
    let lo = floor;
    let hi = maxU;
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (fits(list, mid)) lo = mid;
      else hi = mid;
    }
    return { sizeU: lo, count };
  }
  return { sizeU: maxU, count: 0 };
}

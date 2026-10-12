// @ts-check
// The stepped chip for the projector: the catalog's two-tier lockup (p.63
// "GRADES / 9-12"), a small label on a pill over a big value on a block that
// steps out beneath it. The geometry and the shout's ink (chipGeometry,
// measureEm, inkEm, inkOverflow, markExtents, SHOUT_BOX) are
// shared/chipGeometry.js, the one copy the lobby's chips draw with too; the
// projector may read shared/ (the isolation rule), and chip.test.js pins it.
// What is here is the projector's own: the fits for a ticking value and for
// a wrapping list of chips.
//
// Pure functions only. StepChip.jsx draws with them.

import { chipGeometry as sharedChipGeometry, inkEm, measureEm } from '../../../shared/chipGeometry.js';

export { SHOUT_BOX, inkEm, inkOverflow, markExtents, measureEm } from '../../../shared/chipGeometry.js';

/**
 * Geometry for one chip, built around its own text so nothing can spill off
 * the plate. Widths are advance widths in em of a 1em font (see measureEm).
 * `valueInk` is the value's ink (inkEm), so its marks keep off the keyline.
 * The projector's chip carries no glyph, so the shared geometry's `icon` (the
 * lobby's weather chip) is left off.
 * @param {number} labelEm
 * @param {number} valueEm
 * @param {{ ascent: number, descent: number } | null} [valueInk]
 */
export function chipGeometry(labelEm, valueEm, valueInk = null) {
  const { icon: _icon, ...geometry } = sharedChipGeometry(labelEm, valueEm, 0, valueInk);
  return geometry;
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

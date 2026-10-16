// @ts-check
// The lobby's handle on the shared brand kit (shared/brand/, see its
// README): the motion table, the stepped chip's geometry and the catalog
// shapes, all read from the kit itself (the first two through shared/motion.js
// and shared/chipGeometry.js) so there is one copy of each.
//
// Pure data and pure functions only. The components that draw with them
// live in src/components/brand/.

import tokens from '../../../shared/brand/tokens.json';
import { CHIP, SHOUT_BOX } from '../../../shared/chipGeometry.js';
import { BEAT, DUR, EASE, beats } from '../../../shared/motion.js';
import waveSvg from '../../../shared/brand/shapes/wave-journey.svg?raw';
import tabSvg from '../../../shared/brand/shapes/tab-c-journey.svg?raw';
import starburstSvg from '../../../shared/brand/shapes/starburst.svg?raw';
import tipBlobSvg from '../../../shared/brand/shapes/tip-blob.svg?raw';
import sparkleSvg from '../../../shared/brand/doodles/sparkle-4pt.svg?raw';
import sparkleXSvg from '../../../shared/brand/doodles/sparkle-4pt-x.svg?raw';
import dotSvg from '../../../shared/brand/doodles/dot.svg?raw';
import ringSvg from '../../../shared/brand/doodles/ring.svg?raw';
import squiggleSvg from '../../../shared/brand/doodles/squiggle-wave.svg?raw';
import zigzagSvg from '../../../shared/brand/doodles/zigzag.svg?raw';
import loopSvg from '../../../shared/brand/doodles/loop.svg?raw';

/* ── Motion: one rhythm, four curves ─────────────────────────────── */

// The table itself (one beat, four curves, the kit's durations) is
// shared/motion.js, which the projector reads too.
export { BEAT, DUR, EASE, beats };

/* ── The stepped chip and the shout's ink ─────────────────────────── */

// Their geometry and measurement are shared/chipGeometry.js, which the
// projector's chip reads too; the plate below is the lobby's own.
export { SHOUT_BOX, chipGeometry, inkEm, inkOverflow, markExtents, measureEm } from '../../../shared/chipGeometry.js';

/** @param {number} n */
const round3 = (n) => Math.round(n * 1000) / 1000;

/* ── Shapes, straight out of the kit's SVG files ─────────────────── */

/**
 * Pull the viewBox and the path data out of one of the kit's single-shape
 * SVGs. The kit files are plain `<svg viewBox><path d/></svg>`; a file that
 * isn't would throw here at import, which fails the build rather than a
 * screen.
 * @param {string} svg
 * @param {string} name
 * @returns {{ viewBox: string, d: string, stroked: boolean }}
 */
export function parseShape(svg, name) {
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
  const d = svg.match(/\sd="([^"]+)"/)?.[1];
  if (!viewBox || !d) throw new Error(`brand kit shape ${name} is not a single-path SVG`);
  return { viewBox, d, stroked: /fill="none"/.test(svg) };
}

export const SHAPES = {
  wave: parseShape(waveSvg, 'wave'),
  tab: parseShape(tabSvg, 'tab'),
  starburst: parseShape(starburstSvg, 'starburst'),
  tipBlob: parseShape(tipBlobSvg, 'tip-blob'),
};

export const DOODLES = {
  sparkle: parseShape(sparkleSvg, 'sparkle'),
  sparkleX: parseShape(sparkleXSvg, 'sparkle-x'),
  dot: parseShape(dotSvg, 'dot'),
  ring: parseShape(ringSvg, 'ring'),
  squiggle: parseShape(squiggleSvg, 'squiggle'),
  zigzag: parseShape(zigzagSvg, 'zigzag'),
  loop: parseShape(loopSvg, 'loop'),
};

/** @typedef {keyof typeof DOODLES} DoodleKind */

/* ── The stepped plate: the chip's silhouette around any content ──── */

/**
 * The stepped chip's proportions, in units of its label pill's height, for
 * plates whose content is not one line of text: the status sticker, a
 * notice, a milestone toast. Same silhouette as chipGeometry's (a label pill
 * over a wider block that steps out to its right, printed out of register
 * with a white keyline), so every overlay on the lobby reads as one family
 * with the corner chips.
 */
export const PLATE = {
  /** The pill's height per unit of its label's font size. */
  pillPerLabel: CHIP.pillHeight / CHIP.plateLabel,
  /** Where the block's left edge sits, under the pill. */
  inset: CHIP.blockLeft / CHIP.pillHeight,
  /** Where the block's top edge sits, just above the pill's foot. */
  top: CHIP.blockTop / CHIP.pillHeight,
  /** The least the block steps out past the pill. */
  step: CHIP.step / CHIP.pillHeight,
  radiusBR: CHIP.radiusBR / CHIP.pillHeight,
  radiusBL: CHIP.radiusBL / CHIP.pillHeight,
  /** The plate's out-of-register offset, right and down. */
  offsetX: 0.12 / CHIP.pillHeight,
  offsetY: 0.07 / CHIP.pillHeight,
  keyline: 0.045 / CHIP.pillHeight,
};

/**
 * The outline of a stepped plate measured off real boxes (px): the label
 * pill at the top-left and the block under it. With no pill (`pillW` 0) it
 * is the block alone with the chip's corners. Pure, so a test can pin the
 * silhouette without a layout engine.
 *
 * @param {{ pillW: number, pillH: number, left: number, top: number, width: number, height: number }} box
 *   `left`/`top` are the block's top-left corner; `width`/`height` the whole plate's
 * @returns {string} an SVG path
 */
export function plateOutline({ pillW, pillH, left, top, width, height }) {
  /** @param {number} v */
  const n = (v) => Number((Number.isFinite(v) ? v : 0).toFixed(2));
  const W = Math.max(0, width);
  const H = Math.max(0, height);
  if (!(pillW > 0 && pillH > 0)) {
    const r = Math.min(H / 2, W / 2, Math.max(4, H * 0.28));
    return [
      `M${n(r)},0`, `L${n(W - r)},0`, `A${n(r)},${n(r)} 0 0 1 ${n(W)},${n(r)}`,
      `L${n(W)},${n(H - r)}`, `A${n(r)},${n(r)} 0 0 1 ${n(W - r)},${n(H)}`,
      `L${n(r)},${n(H)}`, `A${n(r)},${n(r)} 0 0 1 0,${n(H - r)}`,
      `L0,${n(r)}`, `A${n(r)},${n(r)} 0 0 1 ${n(r)},0`, 'Z',
    ].join(' ');
  }
  const r1 = pillH / 2;
  const bx0 = Math.max(r1, Math.min(left, pillW));
  const by0 = Math.max(r1, Math.min(top, pillH));
  // The block always reaches past the pill, whatever the boxes say.
  const bx1 = Math.max(W, pillW + PLATE.step * pillH);
  const by1 = Math.max(H, by0 + pillH * 0.6);
  const rBR = Math.min(PLATE.radiusBR * pillH, (by1 - by0) / 2);
  const rBL = Math.min(PLATE.radiusBL * pillH, (by1 - by0) / 2);
  return [
    `M${n(r1)},0`, `L${n(pillW - r1)},0`, `A${n(r1)},${n(r1)} 0 0 1 ${n(pillW)},${n(r1)}`,
    `L${n(pillW)},${n(by0)}`, `L${n(bx1)},${n(by0)}`, `L${n(bx1)},${n(by1 - rBR)}`,
    `A${n(rBR)},${n(rBR)} 0 0 1 ${n(bx1 - rBR)},${n(by1)}`, `L${n(bx0 + rBL)},${n(by1)}`,
    `A${n(rBL)},${n(rBL)} 0 0 1 ${n(bx0)},${n(by1 - rBL)}`, `L${n(bx0)},${n(pillH)}`, `L${n(r1)},${n(pillH)}`,
    `A${n(r1)},${n(r1)} 0 0 1 0,${n(r1)}`, `A${n(r1)},${n(r1)} 0 0 1 ${n(r1)},0`, 'Z',
  ].join(' ');
}

/**
 * Where a line of shouted text's baseline sits below the top of its box, in
 * em, at line-height `lineHeight`: the pivot a soft squish (src/lib/squish.js)
 * squashes type onto, as `--squish-baseline`. Squashed about its middle a
 * letter looks like it floats; about its baseline it sits down.
 * @param {number} lineHeight
 */
export const shoutBaseline = (lineHeight) => round3((SHOUT_BOX.ascent - SHOUT_BOX.descent + lineHeight) / 2);

/* ── Club colors from the kit ────────────────────────────────────── */

export const BRAND_CLUBS = tokens.clubs;
export const HOUSE = tokens.house;

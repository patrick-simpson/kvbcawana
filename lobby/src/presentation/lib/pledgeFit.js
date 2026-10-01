// @ts-check
// The pledges, as big as the wall allows (owner, 2026-09-30: "make the pledge
// of allegiance and the awana pledge text a lot larger"; "as big as fits").
// The room says them together from across a gym, so they are the one slide
// where the read voice fills the frame: the largest size at which the title
// and the whole pledge fit between the Awana mark and the bottom margin band,
// measured in the face that draws them, never guessed. Pure; the slide asks
// for it again whenever a web font lands (useFontsReady).

/** Everything in u (1% of the widest 16:9 frame; the frame is 100 x 56.25). */
export const PLEDGE_FIT = Object.freeze({
  /** Below the Awana mark (it ends about 7u down) and the slide clock. */
  top: 11,
  /** Above the bottom margin band (51.75u), where the setup note and the ESC toast live. */
  bottom: 51,
  /** 6u margins, clear of the mark's side and the next-slide click zone. */
  widthU: 88,
  maxU: 6.6,
  /** Today's size before this change: never smaller than that. */
  minU: 3,
  /** Big type wants less leading than a paragraph (.pj-body is 1.32). */
  lineHeight: 1.2,
  /** The title rides with the words: this much of the body size, between 2.6u and 4.4u. */
  kickerRatio: 0.72,
  kickerMinU: 2.6,
  kickerMaxU: 4.4,
  /** Title to words, as a share of the body size. */
  gapRatio: 0.5,
  step: 0.05,
});

/**
 * The same fit on a phone or tablet held upright (lib/touch.js): the frame is
 * 100 x 177.78u there, so the pledge has a tall column below the mark and the
 * slide clock (which stands at the top, centred, clear of the corners) and
 * above the controls and the setup note at the bottom.
 */
export const PLEDGE_FIT_PORTRAIT = Object.freeze({
  ...PLEDGE_FIT,
  top: 24,
  bottom: 122,
  widthU: 88,
  maxU: 9.5,
  minU: 4.4,
  kickerMinU: 4.4,
  kickerMaxU: 6.4,
});

const WEIGHT = 600; // .pj-body
const FAMILY = '"Figtree Variable", "Figtree", "Segoe UI", system-ui, sans-serif';

/** @type {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined} */
let ctx;

/**
 * A word's width in em in the read voice. With no canvas (jsdom), a rough
 * Figtree estimate: the slide measures again once fonts are ready in a
 * browser, and a rough guess only ever errs toward a smaller size.
 * @param {string} text
 */
export function measureReadEm(text) {
  if (ctx === undefined) {
    try {
      ctx = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d') : null;
    } catch {
      ctx = null;
    }
  }
  if (ctx) {
    ctx.font = `${WEIGHT} 100px ${FAMILY}`;
    const w = ctx.measureText(text).width / 100;
    if (Number.isFinite(w) && w > 0) return w;
  }
  return text.length * 0.56;
}

/**
 * How many rows `words` take at `sizeU` in a `widthU` measure. Greedy, which
 * gives the browser's row count; `text-wrap: balance` only evens the rows
 * out, it never adds one.
 * @param {number[]} wordsEm
 * @param {number} spaceEm
 * @param {number} sizeU
 * @param {number} widthU
 */
export function rowsAt(wordsEm, spaceEm, sizeU, widthU) {
  const limit = widthU / sizeU;
  let rows = 1;
  let run = 0;
  for (const w of wordsEm) {
    if (run === 0) run = w;
    else if (run + spaceEm + w <= limit + 1e-9) run += spaceEm + w;
    else {
      rows += 1;
      run = w;
    }
  }
  return rows;
}

/**
 * The pledge's sizes, as big as fits.
 * @param {string} body
 * @param {(text: string) => number} [measure] a word's width in em
 * @param {typeof PLEDGE_FIT} [f] the frame's table (PLEDGE_FIT_PORTRAIT upright on touch)
 * @returns {{ bodyU: number, kickerU: number, gapU: number, rows: number, heightU: number, topU: number, widthU: number, lineHeight: number }}
 */
export function fitPledge(body, measure = measureReadEm, f = PLEDGE_FIT) {
  const words = String(body).trim().split(/\s+/).filter(Boolean);
  const wordsEm = words.map((w) => measure(w));
  const spaceEm = measure('a a') - 2 * measure('a') || 0.25;
  const room = f.bottom - f.top;
  const shape = (/** @type {number} */ bodyU) => {
    const kickerU = Math.min(f.kickerMaxU, Math.max(f.kickerMinU, bodyU * f.kickerRatio));
    const gapU = bodyU * f.gapRatio;
    const rows = rowsAt(wordsEm, spaceEm, bodyU, f.widthU);
    return { bodyU, kickerU, gapU, rows, heightU: kickerU + gapU + rows * f.lineHeight * bodyU };
  };
  let best = shape(f.minU);
  // A word wider than the measure would overflow at any size: shrink it to fit first.
  const widest = Math.max(0, ...wordsEm);
  const cap = widest > 0 ? Math.min(f.maxU, f.widthU / widest) : f.maxU;
  for (let s = Math.round(cap / f.step) * f.step; s >= f.minU - 1e-9; s -= f.step) {
    const size = Math.round(s * 100) / 100;
    const c = shape(size);
    if (c.heightU <= room + 1e-9) {
      best = c;
      break;
    }
  }
  const round = (/** @type {number} */ n) => Math.round(n * 1000) / 1000;
  return {
    bodyU: round(best.bodyU),
    kickerU: round(best.kickerU),
    gapU: round(best.gapU),
    rows: best.rows,
    heightU: round(best.heightU),
    // Centred in the band, so a short pledge sits in the middle, not at the top.
    topU: round(f.top + Math.max(0, (room - best.heightU) / 2)),
    widthU: f.widthU,
    lineHeight: f.lineHeight,
  };
}

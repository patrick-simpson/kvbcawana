// @ts-check
// The size search every signage text fit shares: try a size, keep the first
// that fits, step down. Pure. The two walks below differ in how they round on
// purpose, because each fit's output was pinned to its own arithmetic (a step
// of 0.1 summed in floats drifts, and rounding at a different digit changes
// the last decimal of a size the screens draw); do not unify them.
// The projector (src/presentation/) keeps its own loops: it may import only
// the isolation allowlist.

/**
 * The sizes from `max` down to `min` (inclusive, within 1e-9), each rounded
 * to 0.01 after a plain subtraction of `step` (the lobby frame's ladder).
 * @param {number} max
 * @param {number} min
 * @param {number} step
 * @returns {number[]}
 */
export function sizeLadder(max, min, step) {
  const out = [];
  for (let s = max; s >= min - 1e-9; s -= step) out.push(Math.round(s * 100) / 100);
  return out;
}

/**
 * The sizes from `max` down to `min` (inclusive, within 1e-9), the running
 * size rounded to `digits` decimals at every step so it never drifts (the
 * overlay fits' walk). Lazy: a fit that returns early costs nothing more.
 * @param {number} max
 * @param {number} min
 * @param {number} step
 * @param {number} digits
 * @returns {Generator<number>}
 */
export function* stepDown(max, min, step, digits) {
  for (let s = max; s >= min - 1e-9; s = Number((s - step).toFixed(digits))) yield s;
}

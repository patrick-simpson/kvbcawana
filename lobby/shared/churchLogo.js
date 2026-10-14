// @ts-check
// The church's own logo (owner 2026-10-13: "KVBC Awana", traced from the
// church's artwork into shared/brand/logos/kvbc-awana-*.svg) as data a screen
// can draw inline: its viewBox and one path per line, so the lines can arrive
// one after another and then stay perfectly still. Pure and import-free, so
// the signage and the projector (which may import only from shared/) read the
// same rules.
//
// The rules (brand README, awana.kvbchurch.org/logo/):
//   - ONE solid colour, chosen by the field: white on colour or dark, ink
//     (#231F20) on light. Never two colours, an outline, a shadow, a gradient
//     or a stretch.
//   - full (church line, Awana Clubs, tagline) only where the tagline reads,
//     two-line (no tagline) everywhere else, stacked (four lines) where a
//     space is tall and narrow or too small for two-line. "BAPTIST CHURCH" is
//     a thin weight, so each has a smallest width (MIN_WIDTH_PX, CSS px).
//   - it arrives ONCE (church line, then Awana Clubs, then the tagline) and
//     then never moves; the check-in moment and the promos never animate it.

/** The three versions, as the kit names their files. */
export const LOGO_VARIANTS = Object.freeze(['full', 'two-line', 'stacked']);

/** The two colours the logo comes in. */
export const LOGO_INK = '#231F20';
export const LOGO_WHITE = '#FFFFFF';

/** Smallest width (CSS px) at which the church line still reads, per version. */
export const MIN_WIDTH_PX = Object.freeze({ full: 520, 'two-line': 260, stacked: 130 });

/** Width over height of each version's viewBox. */
export const ASPECT = Object.freeze({ full: 1910 / 487, 'two-line': 1910 / 403, stacked: 1034 / 805 });

/** Each line's class in the kit's files, in the order the lines arrive. */
export const LOGO_PARTS = Object.freeze(['church', 'awana', 'tagline']);

/**
 * When each line lands (seconds after the logo appears) and how long it takes,
 * from the approved logo sheet: the church line, then Awana Clubs, then the
 * tagline, about 1.2 s in all.
 */
export const LOGO_ARRIVAL = Object.freeze({
  church: Object.freeze({ at: 0, dur: 0.52 }),
  awana: Object.freeze({ at: 0.2, dur: 0.64 }),
  tagline: Object.freeze({ at: 0.56, dur: 0.52 }),
});

/**
 * The version that fits a width: the biggest one whose smallest width it
 * reaches, never one below its smallest. `allowFull` false keeps the tagline
 * out (a corner never carries it). Below every minimum, stacked: the most
 * legible for its width.
 * @param {number} widthPx
 * @param {{ allowFull?: boolean }} [opts]
 * @returns {'full' | 'two-line' | 'stacked'}
 */
export function logoFor(widthPx, { allowFull = false } = {}) {
  if (allowFull && widthPx >= MIN_WIDTH_PX.full) return 'full';
  if (widthPx >= MIN_WIDTH_PX['two-line']) return 'two-line';
  return 'stacked';
}

/**
 * Read one of the kit's kvbc-awana SVGs (as text) into what an inline drawing
 * needs. A file that is not the kit's shape (a viewBox, one path per line,
 * classes kvbc-church / kvbc-awana / kvbc-tagline) throws, which fails the
 * build or the test rather than a screen.
 * @param {string} svg
 * @returns {{ viewBox: string, label: string, parts: Array<{ part: 'church' | 'awana' | 'tagline', d: string }> }}
 */
export function parseChurchLogo(svg) {
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
  const label = svg.match(/aria-label="([^"]+)"/)?.[1] || 'Kennebec Valley Baptist Church Awana Clubs';
  /** @type {Array<{ part: 'church' | 'awana' | 'tagline', d: string }>} */
  const parts = [];
  for (const m of svg.matchAll(/<path\b([^>]*)\/?>/g)) {
    const attrs = m[1];
    const d = attrs.match(/\sd="([^"]+)"/)?.[1];
    const cls = attrs.match(/class="kvbc-(church|awana|tagline)"/)?.[1];
    if (!d || !cls) throw new Error('the church logo has a path that is not one of its lines');
    parts.push({ part: /** @type {'church' | 'awana' | 'tagline'} */ (cls), d });
  }
  if (!viewBox || !parts.some((p) => p.part === 'church') || !parts.some((p) => p.part === 'awana')) {
    throw new Error('the church logo is missing its viewBox, church line or Awana Clubs line');
  }
  parts.sort((a, b) => LOGO_PARTS.indexOf(a.part) - LOGO_PARTS.indexOf(b.part));
  return { viewBox, label, parts };
}

/** How many numbers each SVG path command takes. */
const PATH_ARGS = Object.freeze({ m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 });

/**
 * One line of the logo split into its letters (the flagship's bouncy letters,
 * owner 2026-10-13): each closed sub-path of the traced line, its counters
 * (the hole of an "a" or a "b", a sub-path that sits inside another's x-range)
 * kept with the letter they belong to, left to right. Each letter's `d`
 * starts with an absolute moveto, so it draws in place on its own, and with
 * the line's even-odd fill its holes stay holes. `x0`/`x1` are its left and
 * right edges in the logo's own units. Pure: the kit's file stays the one
 * drawing; this only cuts it up.
 * @param {string} d one path's data
 * @returns {Array<{ d: string, x0: number, x1: number }>}
 */
export function logoLetters(d) {
  const toks = d.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  /** @type {Array<{ out: string[], x0: number, x1: number }>} */
  const subs = [];
  /** @type {{ out: string[], x0: number, x1: number } | null} */
  let cur = null;
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = '';
  const isCmd = (/** @type {string} */ t) => /^[A-Za-z]$/.test(t);
  /** @param {number} x */
  const see = (x) => {
    if (!cur) throw new Error('logoLetters: a path must start with a moveto');
    cur.x0 = Math.min(cur.x0, x);
    cur.x1 = Math.max(cur.x1, x);
  };
  while (i < toks.length) {
    if (isCmd(toks[i])) cmd = toks[i++];
    const lc = cmd.toLowerCase();
    const rel = cmd !== cmd.toUpperCase();
    if (!(lc in PATH_ARGS)) throw new Error(`logoLetters: unknown path command ${cmd}`);
    if (lc === 'z') {
      if (!cur) throw new Error('logoLetters: a path must start with a moveto');
      cur.out.push('z');
      cx = sx;
      cy = sy;
      continue;
    }
    const a = [];
    for (let k = 0; k < PATH_ARGS[/** @type {keyof typeof PATH_ARGS} */ (lc)]; k += 1) a.push(Number(toks[i++]));
    if (a.some((n) => !Number.isFinite(n))) throw new Error('logoLetters: a path command is short of numbers');
    if (lc === 'm') {
      const x = (rel ? cx : 0) + a[0];
      const y = (rel ? cy : 0) + a[1];
      cur = { out: [`M${Math.round(x * 1000) / 1000} ${Math.round(y * 1000) / 1000}`], x0: x, x1: x };
      subs.push(cur);
      cx = x; cy = y; sx = x; sy = y;
      // Numbers after a moveto are line-tos, in the moveto's own sense.
      cmd = rel ? 'l' : 'L';
      continue;
    }
    if (!cur) throw new Error('logoLetters: a path must start with a moveto');
    cur.out.push(cmd + a.join(' '));
    if (lc === 'h') { cx = (rel ? cx : 0) + a[0]; see(cx); } else if (lc === 'v') {
      cy = (rel ? cy : 0) + a[0];
    } else if (lc === 'a') {
      cx = (rel ? cx : 0) + a[5]; cy = (rel ? cy : 0) + a[6]; see(cx);
    } else {
      // Control points and the end point: a curve never strays outside them.
      let ex = cx;
      let ey = cy;
      for (let k = 0; k < a.length; k += 2) {
        ex = (rel ? cx : 0) + a[k];
        ey = (rel ? cy : 0) + a[k + 1];
        see(ex);
      }
      cx = ex; cy = ey;
    }
  }
  // Widest first, so a counter always finds the letter it sits in.
  const byWidth = [...subs].sort((p, q) => (q.x1 - q.x0) - (p.x1 - p.x0));
  /** @type {Array<{ parts: string[], x0: number, x1: number }>} */
  const letters = [];
  for (const s of byWidth) {
    const home = letters.find((l) => s.x0 >= l.x0 - 0.5 && s.x1 <= l.x1 + 0.5);
    if (home) home.parts.push(s.out.join(''));
    else letters.push({ parts: [s.out.join('')], x0: s.x0, x1: s.x1 });
  }
  return letters
    .sort((p, q) => p.x0 - q.x0)
    .map((l) => ({ d: l.parts.join(''), x0: Math.round(l.x0 * 10) / 10, x1: Math.round(l.x1 * 10) / 10 }));
}

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

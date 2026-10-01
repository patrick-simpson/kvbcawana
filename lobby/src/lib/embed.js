// @ts-check
// Running inside another page's frame: the Journey Display kiosk, which shows
// this display full-screen in an iframe outside its 6:30-7:15 lesson window.
//
// The host floats its own always-visible controls OVER the frame, and nothing
// in this page can paint over a parent's element. The two agree on where they
// go: while this display is up, Journey keeps both of its round 48px buttons
// in ONE column in the bottom-right corner (the view toggle, and its settings
// gear stacked 8px above it), max(3vw, 24px) in from the right edge, the
// toggle max(3vh, 24px) up from the bottom. Every other corner is this
// page's own. Embedded, the signage keeps everything it draws down there out
// of that column, 8px clear: the corner chip (the time, tonight's tally, the
// WAITING chip), the tonight ticker beside it, a long child's name, and the
// operator's panels (Settings, the slide editor, the debug panel and the
// first-run card), which reach the right edge on a small screen.
// See CLAUDE.md, "Embedded, the bottom-right corner belongs to the host".
//
// The column's inner edge is the one number this page needs, and it is
// written down twice on purpose: here (for the name fit, which sizes type in
// JS) and as the html.embedded custom property in app.css (for everything
// laid out by CSS). src/lib/embed.test.js fails if the two drift; Journey's
// own test/corner-buttons.test.mjs fails if its buttons leave the column.
// Standalone (window.self === window.top) none of it applies, and the page
// is laid out exactly as it always was.

/**
 * Whether this page is inside another page's frame: the same test the
 * double-click fullscreen hand-off uses. Read at call time (not cached at
 * import), so a test can stub `window.top`. A browser that refuses to answer
 * is treated as framed, which only ever moves chrome inward.
 * @returns {boolean}
 */
export function isEmbedded() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * The host's corner column (Journey's #toggle-btn, with #settings-btn above
 * it while this display shows):
 *   edgePct   inset from the right edge, as a percentage of the viewport width
 *   edgeMinPx ... but never less than this
 *   sizePx    the buttons' width (and height)
 *   gapPx     the air this page leaves between that column and its own chrome
 */
export const HOST_CONTROL = Object.freeze({ edgePct: 3, edgeMinPx: 24, sizePx: 48, gapPx: 8 });

/**
 * How far in from the right edge the host's column reaches, gap included, in
 * px, for a viewport `vw` px wide. This frame fills the host's viewport, so
 * its own viewport is the host's.
 * @param {number} vw
 * @returns {number}
 */
export function hostClearancePx(vw) {
  const { edgePct, edgeMinPx, sizePx, gapPx } = HOST_CONTROL;
  return Math.max((edgePct * vw) / 100, edgeMinPx) + sizePx + gapPx;
}

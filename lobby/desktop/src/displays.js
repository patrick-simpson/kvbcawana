// @ts-check
// Finding the remembered monitor again. Pure: main.js passes it
// screen.getAllDisplays() and the saved choice.
//
// Windows can renumber a display's id when cables move or a driver updates,
// so the match is layered, strongest first:
//   1. the same id AND the same label (the monitor's own name);
//   2. the one display with that label (a TV keeps its name when its id
//      moves); two with the same name are told apart by position and size;
//   3. the same id, when the label is unknown on either side;
//   4. the one display with the same position and resolution.
// Anything ambiguous is "not found": the app then opens windowed on the main
// screen (owner's choice) rather than guess and cover an operator's monitor.

/**
 * @typedef {{ id: number, label?: string, bounds: { x: number, y: number, width: number, height: number } }} DisplayLike
 * @typedef {{ id: number, label: string, bounds: { x: number, y: number, width: number, height: number } }} SavedDisplay
 */

/**
 * @param {DisplayLike} d
 * @returns {SavedDisplay}
 */
export function rememberDisplay(d) {
  return { id: d.id, label: typeof d.label === 'string' ? d.label : '', bounds: { ...d.bounds } };
}

/**
 * @param {DisplayLike[]} displays
 * @param {SavedDisplay | null | undefined} saved
 * @returns {DisplayLike | null}
 */
export function findDisplay(displays, saved) {
  if (!saved || !Array.isArray(displays) || !displays.length) return null;
  const label = saved.label || '';
  const labelOf = (/** @type {DisplayLike} */ d) => (typeof d.label === 'string' ? d.label : '');

  const exact = displays.find((d) => d.id === saved.id && label && labelOf(d) === label);
  if (exact) return exact;

  if (label) {
    const named = displays.filter((d) => labelOf(d) === label);
    if (named.length === 1) return named[0];
    // Two monitors with one name ("Generic PnP Monitor" twice) and neither
    // with the saved id: their position and size tell them apart, or nothing
    // does and it would be a guess.
    if (named.length > 1) return pickByBounds(named, saved.bounds);
  }

  const byId = displays.find((d) => d.id === saved.id && (!label || !labelOf(d)));
  if (byId) return byId;

  return pickByBounds(displays, saved.bounds);
}

/**
 * @param {DisplayLike[]} displays
 * @param {SavedDisplay['bounds'] | undefined} b
 * @returns {DisplayLike | null}
 */
function pickByBounds(displays, b) {
  if (!b) return null;
  const same = displays.filter((d) => d.bounds.x === b.x && d.bounds.y === b.y
    && d.bounds.width === b.width && d.bounds.height === b.height);
  return same.length === 1 ? same[0] : null;
}

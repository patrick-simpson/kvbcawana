// A plaintext name, id or address in sealed storage is a leak; a short run of the same
// letters inside random base64, hex or a hash is not. Matching the bare words flaked CI
// (about 1% of runs each: 'Kit', 'Elm', '662'), so a word only counts when it stands
// alone: not touching another letter, digit or base64 character.
const BASE64 = 'A-Za-z0-9+/_-';
const esc = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Which of `words` stand alone in `text`.
 * @param {string} text @param {string[]} words @param {{ ignoreCase?: boolean }} [opts]
 * @returns {string[]}
 */
export function leaks(text, words, { ignoreCase = false } = {}) {
  return words.filter((w) => new RegExp(`(?<![${BASE64}])${esc(w)}(?![${BASE64}])`, ignoreCase ? 'i' : '').test(text));
}

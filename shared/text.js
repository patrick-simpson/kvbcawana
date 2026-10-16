// @ts-check
// THE text cleaner, at the trust boundary. Every name, club, id and note that
// crosses the wire or lands in a stored file passes through one of its callers,
// each with its own limit; this is the one place the clean-up is spelled.
//
//   - lobby/src/lib/eventSanitizers.js: cleanString (a string or nothing,
//     trimmed, bounded) and plainText (the notice's markup-free copy);
//   - printer/print-server/events.js: cleanName and plainText (the same, but
//     it coerces what is not a string, as it always did);
//   - printer/print-server/security.js: stripControlChars and
//     sanitizeStoredText (control characters out, trimmed, bounded);
//   - printer/print-server/server.js: cleanFriendName (one line, no control
//     characters or angle brackets, 24 characters).
//
// The limits stay with their callers (NAME_MAX, STORED_NAME_MAX, the friend's
// 24): this module has none of its own. The contract and envelope vectors and
// every sanitizer test pin the result. See shared/README.md for how each
// app loads it (the print server through a generated copy).

/**
 * A C0 control character (tab and newline included) or DEL.
 * Expressed as char-code checks rather than regex escapes: a mangled \x1f in a
 * character class fails silently in the direction of accepting too much.
 * @param {number} code
 * @returns {boolean}
 */
export function isControlCharCode(code) {
  return code < 0x20 || code === 0x7f;
}

/**
 * `value` as text with every control character replaced by `replacement`
 * (a space by default; '' deletes them). null and undefined are ''.
 * @param {unknown} value
 * @param {string} [replacement]
 * @returns {string}
 */
export function stripControlChars(value, replacement) {
  const s = String(value == null ? '' : value);
  const fill = replacement === undefined ? ' ' : replacement;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    out += isControlCharCode(s.charCodeAt(i)) ? fill : s[i];
  }
  return out;
}

/**
 * One clean, bounded line of text. In order: take the string (anything else is
 * '' unless `coerce`, which reads it as String(value), null as ''); replace
 * control characters with `control` when given; drop `<` and `>` when `angle`;
 * collapse every run of whitespace to one space when `collapse`; trim; cut to
 * `max` characters.
 *
 * @param {unknown} value
 * @param {number} max
 * @param {{ coerce?: boolean, control?: string, angle?: boolean, collapse?: boolean }} [opts]
 * @returns {string}
 */
export function cleanText(value, max, opts = {}) {
  let s;
  if (typeof value === 'string') s = value;
  else if (opts.coerce) s = String(value == null ? '' : value);
  else return '';
  if (opts.control !== undefined) s = stripControlChars(s, opts.control);
  if (opts.angle) s = s.replace(/[<>]/g, '');
  if (opts.collapse) s = s.replace(/\s+/g, ' ');
  return s.trim().slice(0, max);
}

/**
 * Bounded plain text for free-text display copy: strips anything
 * markup-shaped and collapses whitespace (the newlines a textarea allows), so
 * it can neither inject markup nor blow up a fixed-height banner. Anything
 * that is not a string is '' unless `coerce`.
 *
 * @param {unknown} value
 * @param {number} max
 * @param {{ coerce?: boolean }} [opts]
 * @returns {string}
 */
export function plainText(value, max, opts = {}) {
  let s;
  if (typeof value === 'string') s = value;
  else if (opts.coerce) s = String(value == null ? '' : value);
  else return '';
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

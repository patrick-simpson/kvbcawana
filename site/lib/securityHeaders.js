// The site's security headers, written into Cloudflare Pages' _headers by
// site/build.mjs (2026-11-09).
//
// Every path (the `/*` rule):
// - X-Content-Type-Options: nosniff: a browser never guesses a file's type, so an
//   uploaded or mistyped file can never run as a script or a stylesheet.
// - Referrer-Policy: strict-origin-when-cross-origin: another site sees only
//   https://awana.kvbchurch.org, never the page's path or query.
// - Content-Security-Policy: frame-ancestors 'self': only this site may frame a
//   page. Journey (the lobby), the classroom (the lobby) and the home page's
//   showcase twins frame only pages of this same origin; nothing else frames us.

/** The `/*` rule's header lines, as _headers wants them (two spaces in). */
export const SITE_HEADERS = Object.freeze([
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  "  Content-Security-Policy: frame-ancestors 'self'",
]);

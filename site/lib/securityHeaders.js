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

// The two TV pages that hold the church session (localStorage awanaSyncSession.v1)
// AND show what a stranger with a code or a remote puts up: the Cast screen
// (/cast/screen/) and the downstairs classroom (/classroom/, its Sparks remote
// under it too). Their own Content-Security-Policy says exactly which scripts
// may run, so nothing put up on them can ever run script on the page:
// - scripts: this site, pdf.js and qrcode-generator from cdnjs (loaded with
//   their integrity fingerprints), YouTube's IFrame API (www.youtube.com), and
//   each inline script of the page by its sha256 (the classroom's configure-mode
//   line); never 'unsafe-inline' or 'unsafe-eval' (pdf.js runs with eval off);
// - pdf.js's worker from a blob: URL (fetched with its fingerprint); pictures,
//   PDFs and clips read with the session into blob: URLs;
// - frames: this site (the classroom's lobby), YouTube's players
//   (youtube-nocookie.com, youtube.com), and on Cast Facebook's plain iframe
//   player (www.facebook.com/plugins/video.php, never its SDK);
// - connections: this site and the sync service (sync.json's `${origin}/api`,
//   https and its live channel wss), and cdnjs (the worker's fetch).
// Pages joins it with the `/*` rule's frame-ancestors policy by a comma: two
// policies, each enforced, so frame-ancestors is written here too.

const CDNJS = 'https://cdnjs.cloudflare.com';

/** The sha256 source of every inline <script> in a page, as CSP wants it. @param {string} html @param {(text: string) => string} sha256b64 */
export function inlineScriptHashes(html, sha256b64) {
  const out = [];
  for (const m of html.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const h = `'sha256-${sha256b64(m[1])}'`;
    if (!out.includes(h)) out.push(h);
  }
  return out;
}

/**
 * The TV pages' Content-Security-Policy.
 * @param {{ origin: string, scriptHashes?: string[], facebook?: boolean, images?: string[] }} o
 *   origin = the site's https origin (where sync.json points the service); images = other
 *   https origins pictures may come from (the Cast desk: YouTube's search thumbnails).
 */
export function tvPagePolicy({ origin, scriptHashes = [], facebook = false, images = [] }) {
  const u = new URL(origin);
  if (u.protocol !== 'https:' || u.origin !== origin) throw new Error(`tvPagePolicy: origin must be a bare https origin, got ${origin}`);
  for (const h of scriptHashes) if (!/^'sha256-[A-Za-z0-9+/]{43}='$/.test(h)) throw new Error(`tvPagePolicy: bad script hash ${h}`);
  for (const i of images) if (!/^https:\/\/[a-z0-9.-]+$/.test(i)) throw new Error(`tvPagePolicy: images must be bare https origins, got ${i}`);
  return [
    "default-src 'self'",
    ['script-src', "'self'", CDNJS, 'https://www.youtube.com', ...scriptHashes].join(' '),
    "style-src 'self' 'unsafe-inline'",
    ['img-src', "'self'", 'data:', 'blob:', ...images].join(' '),
    "font-src 'self' data:",
    "media-src 'self' blob:",
    `connect-src 'self' ${u.origin} wss://${u.host} ${CDNJS}`,
    "worker-src 'self' blob:",
    ['frame-src', "'self'", 'https://www.youtube-nocookie.com', 'https://www.youtube.com', ...(facebook ? ['https://www.facebook.com'] : [])].join(' '),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ');
}

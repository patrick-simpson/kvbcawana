// Videos, and any file too big for Cloudflare Pages (25 MiB a file), are left
// out of the upload by site/build.mjs and served from here instead, because
// Pages' static files ignore Range and a <video> must be able to seek. Each is
// streamed from GitHub (the Journey lesson videos from their release; this
// week's lesson from the repo at the SAME commit the site was built from, so
// it always matches the JSON deployed beside it), with Range passed through,
// on the site's own origin, so a page's Cache API fetch and its <video> work
// exactly as they did when the file was a static asset.

const TYPES = { mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', zip: 'application/zip', pdf: 'application/pdf' };
// What a video player and a cache need from the upstream answer, and no more.
const PASS_BACK = ['Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified'];
// What a browser sends to ask "is my copy still good?" or "resume this copy":
// passed up, so a revalidation is a 304 and not another whole video.
const PASS_UP = ['Range', 'If-None-Match', 'If-Modified-Since', 'If-Range'];

// A file under a prefix is one plain name: letters, digits, dot, dash,
// underscore, ending .mp4. Nothing else can reach the upstream folder.
const PREFIX_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.mp4$/;

/** The upstream URL for `pathname`, from the exact map or a prefix, or null. */
export function upstreamFor(pathname, files, prefixes = {}) {
  if (Object.prototype.hasOwnProperty.call(files, pathname)) return files[pathname];
  for (const [prefix, base] of Object.entries(prefixes)) {
    if (!pathname.startsWith(prefix)) continue;
    const name = pathname.slice(prefix.length);
    if (PREFIX_FILE.test(name) && !name.includes('..')) return base + name;
  }
  return null;
}

/**
 * @param {Request} request
 * @param {Record<string, string>} files  site path -> upstream URL
 * @param {typeof fetch} [fetchFn]
 * @param {Record<string, string>} [prefixes]  site folder -> upstream folder
 * @returns {Promise<Response | null>} null when the path is none of these
 */
export async function proxyLarge(request, files, fetchFn = fetch, prefixes = {}) {
  const url = new URL(request.url);
  const target = upstreamFor(url.pathname, files, prefixes);
  if (!target) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const headers = new Headers();
  for (const h of PASS_UP) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  let upstream;
  try {
    upstream = await fetchFn(target, { method: request.method, headers });
  } catch {
    return new Response('The file could not be fetched right now', { status: 502, headers: { 'Retry-After': '30', 'Cache-Control': 'no-store' } });
  }
  const out = new Headers();
  for (const h of PASS_BACK) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  // Like the HTML and JSON: always asked again, so next week's file is never
  // masked by this week's (the kiosk keys its own cache by transcode time).
  out.set('Cache-Control', 'no-cache');
  if (upstream.status === 304) return new Response(null, { status: 304, headers: out });
  if (upstream.status === 416) return new Response('Range not satisfiable', { status: 416, headers: out });
  if (upstream.status === 404) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (upstream.status !== 200 && upstream.status !== 206) {
    // GitHub is rate-limiting shared egress, or is down: say so, never
    // "not found", which a kiosk could keep for a week as the file being gone.
    const status = upstream.status === 429 ? 503 : 502;
    const retry = upstream.headers.get('Retry-After') || '30';
    return new Response('The file could not be fetched right now', { status, headers: { 'Retry-After': retry, 'Cache-Control': 'no-store' } });
  }
  const ext = url.pathname.split('.').pop().toLowerCase();
  out.set('Content-Type', TYPES[ext] || 'application/octet-stream');
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: out });
}

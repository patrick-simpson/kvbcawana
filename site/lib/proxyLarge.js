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
  const range = request.headers.get('Range');
  if (range) headers.set('Range', range);
  const upstream = await fetchFn(target, { method: request.method, headers });
  if (upstream.status !== 200 && upstream.status !== 206) {
    return new Response('Not found', { status: upstream.status === 416 ? 416 : 404 });
  }
  const out = new Headers();
  for (const h of PASS_BACK) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  const ext = url.pathname.split('.').pop().toLowerCase();
  out.set('Content-Type', TYPES[ext] || 'application/octet-stream');
  // Like the HTML and JSON: always asked again, so next week's file is never
  // masked by this week's (the kiosk keys its own cache by transcode time).
  out.set('Cache-Control', 'no-cache');
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: out });
}

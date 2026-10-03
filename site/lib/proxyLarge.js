// Files too big for Cloudflare Pages (25 MiB a file) are left out of the
// upload by site/build.mjs and served from here instead: streamed from
// GitHub's copy of the SAME commit the site was built from (so the file always
// matches the JSON deployed beside it), on the site's own origin, so a page's
// Cache API fetch and <video> work exactly as they did when the file was a
// static asset. The one today is the Journey kiosk's weekly lesson transcode.

const TYPES = { mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', zip: 'application/zip', pdf: 'application/pdf' };
// What a video player and a cache need from the upstream answer, and no more.
const PASS_BACK = ['Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified'];

/**
 * @param {Request} request
 * @param {Record<string, string>} files  site path -> upstream URL
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<Response | null>} null when the path is not one of `files`
 */
export async function proxyLarge(request, files, fetchFn = fetch) {
  const url = new URL(request.url);
  const target = Object.prototype.hasOwnProperty.call(files, url.pathname) ? files[url.pathname] : null;
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

// /api/* on the one site is the sync Worker (lobby/worker/), reached through
// the SYNC service binding (site/wrangler.toml). The Worker's routes are
// /v1/..., so /api/v1/login becomes /v1/login. Everything else about the
// request (method, headers, CF-Connecting-IP for the guess limits, body)
// passes through untouched.
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/';
  return env.SYNC.fetch(new Request(url, request));
}

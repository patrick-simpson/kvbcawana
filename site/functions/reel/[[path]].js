// /reel/* is the home page's film (printer/public/reel, made by printer/reel/).
// Its videos must seek, and Safari plays a video only from a server that
// answers Range, which Pages' static files do not: so they are left out of the
// upload by site/build.mjs and streamed by proxyLarge (site/lib/proxyLarge.js)
// from GitHub's copy of the commit the site was built from, with Range passed
// through. Anything else here (the poster) falls through to the static file.
import { proxyLarge } from '../../lib/proxyLarge.js';
import { LARGE_FILES } from '../../lib/large-files.generated.js';

export async function onRequest(context) {
  return (await proxyLarge(context.request, LARGE_FILES, fetch)) || context.next();
}

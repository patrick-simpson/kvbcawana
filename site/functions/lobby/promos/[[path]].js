// /lobby/promos/* holds the lobby's promo videos (lobby/public/promos: the
// Awana Grand Prix, made by video/grand-prix/), played in the season promo
// slot (lobby/src/components/promos/GrandPrixPromo.jsx). A <video> asks for
// byte ranges, and Safari plays a video only from a server that answers them,
// which Pages' static files do not: so the video is left out of the upload by
// site/build.mjs and streamed by proxyLarge (site/lib/proxyLarge.js) from
// GitHub's copy of the commit the site was built from, with Range passed
// through. _routes.json sends only the streamed file here; anything else (the
// end card's still, grand-prix-end.jpg) is a plain static file.
import { proxyLarge } from '../../../lib/proxyLarge.js';
import { LARGE_FILES } from '../../../lib/large-files.generated.js';

export async function onRequest(context) {
  return (await proxyLarge(context.request, LARGE_FILES, fetch)) || context.next();
}

// /lobby/intro/* is the lobby's 3D intro (lobby/public/intro, made by
// video/awana-intro/), played by the flagship slide now and then
// (lobby/src/components/FlagshipIntro.jsx). A <video> asks for byte ranges,
// and Safari plays a video only from a server that answers them, which Pages'
// static files do not: so it is left out of the upload by site/build.mjs and
// streamed by proxyLarge (site/lib/proxyLarge.js) from GitHub's copy of the
// commit the site was built from, with Range passed through. _routes.json
// sends only the streamed file here; anything else falls through.
import { proxyLarge } from '../../../lib/proxyLarge.js';
import { LARGE_FILES } from '../../../lib/large-files.generated.js';

export async function onRequest(context) {
  return (await proxyLarge(context.request, LARGE_FILES, fetch)) || context.next();
}

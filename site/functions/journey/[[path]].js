// /journey/* is the kiosk's static files; its videos (which must seek, and
// Pages' static files ignore Range) and anything too big for Pages are served
// by proxyLarge (site/lib/proxyLarge.js) from the map site/build.mjs writes for
// each build. Anything else falls through to the static file.
import { proxyLarge } from '../../lib/proxyLarge.js';
import { LARGE_FILES, LARGE_PREFIXES } from '../../lib/large-files.generated.js';

export async function onRequest(context) {
  return (await proxyLarge(context.request, LARGE_FILES, fetch, LARGE_PREFIXES)) || context.next();
}

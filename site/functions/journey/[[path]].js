// /journey/* is the kiosk's static files; the few too big for Pages are served
// by proxyLarge (site/lib/proxyLarge.js) from the map site/build.mjs writes for
// each build. Anything else falls through to the static file.
import { proxyLarge } from '../../lib/proxyLarge.js';
import { LARGE_FILES } from '../../lib/large-files.generated.js';

export async function onRequest(context) {
  return (await proxyLarge(context.request, LARGE_FILES)) || context.next();
}

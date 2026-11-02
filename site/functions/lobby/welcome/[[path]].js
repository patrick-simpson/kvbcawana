// /lobby/welcome/* is the opening ceremony's films (lobby/public/welcome, made
// by video/grand-welcome/): the projector's grand welcome film
// (lobby/src/presentation/views/GrandWelcome.jsx) and the other screens'
// see-through lead-in (lobby/src/components/CeremonyLeadIn.jsx). A <video>
// asks for byte ranges, and Safari plays a video only from a server that
// answers them, which Pages' static files do not: so they are left out of the
// upload by site/build.mjs and streamed by proxyLarge (site/lib/proxyLarge.js)
// from GitHub's copy of the commit the site was built from, with Range passed
// through. _routes.json sends only the streamed files here; anything else
// (the stills) falls through.
import { proxyLarge } from '../../../lib/proxyLarge.js';
import { LARGE_FILES } from '../../../lib/large-files.generated.js';

export async function onRequest(context) {
  return (await proxyLarge(context.request, LARGE_FILES, fetch)) || context.next();
}

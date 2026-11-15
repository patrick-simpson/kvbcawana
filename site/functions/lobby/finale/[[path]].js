// /lobby/finale/* holds the game time scoreboard's winner films (lobby/public/finale:
// trophy, stadium and takeover, made by video/score-finale/finale.py), played on the
// projector when a game ends (lobby/src/presentation/components/FinaleFilm.jsx). A
// <video> asks for byte ranges, which Pages' static files do not answer, so the films
// are left out of the upload by site/build.mjs and streamed by proxyLarge
// (site/lib/proxyLarge.js) from GitHub's copy of the commit the site was built from.
import { proxyLarge } from '../../../lib/proxyLarge.js';
import { LARGE_FILES } from '../../../lib/large-files.generated.js';

export async function onRequest(context) {
  return (await proxyLarge(context.request, LARGE_FILES, fetch)) || context.next();
}

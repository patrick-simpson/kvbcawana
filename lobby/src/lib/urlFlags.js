// URL flags for embedding the display inside other systems — an OBS
// browser source, ProPresenter web page, vMix, an iframe on a weaker
// device, etc.
//
//   ?overlay=1            transparent stage, banners + confetti only
//   ?chroma=00b140        solid key color instead of transparency
//                         (implies overlay mode)
//   ?passphrase=... (or ?p=)  sign in to the sync service's live channel
//                         (read by src/hooks/useSync.js, not here).
//                         An old link that still carries Pusher's ?key= and
//                         ?cluster= just has them ignored.
//   ?lowPower=1           forces confetti off and reduced motion on,
//                         regardless of this device's saved Settings.
//                         For embedding on hardware too weak to animate
//                         smoothly (e.g. the Journey Display kiosk's
//                         Raspberry Pi Zero) WITHOUT changing what any
//                         other, more powerful device defaults to —
//                         confettiLevel/reduceMotion's own defaults stay
//                         full-strength for every direct/standalone visit.
//
//   ?club=sparks          ONE club's lobby (the downstairs classroom, owner
//                         2026-10-17: classroom/ frames ../lobby/?club=sparks
//                         for 7:30-8:00): the pickup board lists only that
//                         club's children, only that club's check-ins are
//                         welcomed, the corner club count is that club's and
//                         the chime stays off, for this URL only (saved
//                         Settings and every default are untouched). (Framed,
//                         with or without it, every sanitized check-in is
//                         handed UP to the host page: lib/embed.js
//                         hostCheckin.) An id from CLUB_FLAG_IDS; anything
//                         else = no flag.
//
// Example OBS browser source URL:
//   https://awana.kvbchurch.org/lobby/?overlay=1&passphrase=…
// lib/clubs.js CORNER_CLUB_IDS, written out (this file imports nothing;
// urlFlags.test.js pins the two lists equal).
export const CLUB_FLAG_IDS = Object.freeze(['puggles', 'cubbies', 'sparks', 'tnt', 'trek', 'journey']);

export function parseUrlFlags(search = window.location.search) {
  const params = new URLSearchParams(search);

  const overlayParam = (params.get('overlay') || '').toLowerCase();
  const chromaRaw = (params.get('chroma') || '').replace(/^#/, '');
  const chroma = /^[0-9a-fA-F]{6}$/.test(chromaRaw) ? `#${chromaRaw.toLowerCase()}` : null;

  const lowPowerParam = (params.get('lowPower') || '').toLowerCase();
  const lowPower = ['1', 'true', 'yes'].includes(lowPowerParam);

  // ?config=<https-url>: fetch a JSON of config overrides at startup —
  // central management for a fleet of displays. Precedence stays
  // defaults < remote config < this device's saved overrides < ?lowPower.
  const configRaw = (params.get('config') || '').trim();
  let configUrl = null;
  try {
    if (configRaw) {
      const u = new URL(configRaw);
      if (u.protocol === 'https:' || u.protocol === 'http:') configUrl = u.href;
    }
  } catch { /* malformed — ignore */ }

  const clubRaw = (params.get('club') || '').trim().toLowerCase();
  const club = CLUB_FLAG_IDS.includes(clubRaw) ? clubRaw : null;

  return {
    club,
    overlay: ['1', 'true', 'yes'].includes(overlayParam) || chroma !== null,
    chroma,
    configUrl,
    lowPower,
  };
}

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
// Example OBS browser source URL:
//   https://awana.kvbchurch.org/lobby/?overlay=1&passphrase=…
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

  return {
    overlay: ['1', 'true', 'yes'].includes(overlayParam) || chroma !== null,
    chroma,
    configUrl,
    lowPower,
  };
}

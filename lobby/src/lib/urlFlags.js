// URL flags for embedding the display inside other systems — an OBS
// browser source, ProPresenter web page, vMix, an iframe on a weaker
// device, etc.
//
//   ?overlay=1            transparent stage, banners + confetti only
//   ?chroma=00b140        solid key color instead of transparency
//                         (implies overlay mode)
//   ?key=...&cluster=us2  Pusher app key/cluster, so an embedded browser
//                         with no localStorage access can still connect.
//                         The key is Pusher's PUBLIC subscribe key —
//                         safe to put in a URL.
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
//   https://…/Awana-Check-in-Display/?overlay=1&key=abc123&cluster=us2
export function parseUrlFlags(search = window.location.search) {
  const params = new URLSearchParams(search);

  const overlayParam = (params.get('overlay') || '').toLowerCase();
  const chromaRaw = (params.get('chroma') || '').replace(/^#/, '');
  const chroma = /^[0-9a-fA-F]{6}$/.test(chromaRaw) ? `#${chromaRaw.toLowerCase()}` : null;

  const key = (params.get('key') || '').trim();
  const cluster = (params.get('cluster') || '').trim();

  const lowPowerParam = (params.get('lowPower') || '').toLowerCase();
  const lowPower = ['1', 'true', 'yes'].includes(lowPowerParam);

  // ?config=<https-url>: fetch a JSON of config overrides at startup —
  // central management for a fleet of displays. Precedence stays
  // defaults < remote config < this device's saved overrides < ?key/?lowPower.
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
    pusherAppKey: key || null,
    pusherCluster: cluster || null,
    configUrl,
    lowPower,
  };
}

// The presentation page's pure rules (no DOM, no network): site/presentation/app.js
// draws with them; site/test/presentation.test.mjs pins them.

/** The helper put inside every deck frame: tells the page which slide is up, takes "go to". */
export const FRAME_HELPER = `<script>(function(){
  var P = window.parent; if (!P || P === window) return;
  function idx(){ var n = parseInt((location.hash || '#1').slice(1), 10); return isNaN(n) ? 0 : n - 1; }
  function tell(){ P.postMessage({ type: 'awana-deck:at', index: idx() }, location.origin === 'null' ? '*' : location.origin); }
  var rs = history.replaceState;
  history.replaceState = function(){ var r = rs.apply(history, arguments); tell(); return r; };
  addEventListener('hashchange', tell);
  addEventListener('message', function(e){
    if (e.source !== P) return;
    var d = e.data || {};
    if (d.type === 'awana-deck:go' && d.index >= 0) { var h = '#' + (d.index + 1); if (location.hash !== h) location.hash = h; }
  });
  tell();
})();</script>`;

/** The deck's own chrome a presentation screen hides: the help toast, the theme button, the notes panel, the overview. */
const HIDE = '#help,#theme,#notes,#overview,#tip,.nav{display:none!important}';
/** A preview is a still picture: no transitions or animations. */
const STILL = '*,*::before,*::after{transition:none!important;animation:none!important}';

/**
 * The deck, ready for a frame on this page.
 * @param {string} html @param {{ still?: boolean, start?: number }} [opts]
 */
export function frameHtml(html, opts = {}) {
  const css = `<style data-awana-presentation>${HIDE}${opts.still ? STILL : ''}</style>`;
  let out = String(html);
  out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, `${css}</head>`) : css + out;
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${FRAME_HELPER}</body>`) : out + FRAME_HELPER;
  return out;
}

/**
 * What the deck says about its slides: titles, kickers and speaker notes, read
 * from its own `<script id="payload" type="application/json">` (AwanaReports
 * build_deck.py). Never throws: a deck it cannot read is `{ slides: [] }`.
 * @param {string} html
 * @returns {{ title: string, slides: { title: string, kicker: string, notes: string }[] }}
 */
export function deckOutline(html) {
  const s = String(html || '');
  const title = (/<title>([^<]*)<\/title>/i.exec(s)?.[1] || '').trim();
  const m = /<script[^>]*id=["']payload["'][^>]*>([\s\S]*?)<\/script>/i.exec(s);
  if (!m) return { title, slides: [] };
  try {
    const d = JSON.parse(m[1]);
    const list = Array.isArray(d?.slides) ? d.slides : [];
    return {
      title,
      slides: list.map((x) => ({
        title: typeof x?.title === 'string' ? x.title : '',
        kicker: typeof x?.kicker === 'string' ? x.kicker : '',
        notes: typeof x?.notes === 'string' ? x.notes : '',
      })),
    };
  } catch {
    return { title, slides: [] };
  }
}

/** Keep an index on the deck. @param {number} i @param {number} count */
export function clampSlide(i, count) {
  if (!Number.isInteger(i) || i < 0) return 0;
  return count > 0 ? Math.min(i, count - 1) : i;
}

/**
 * A key on a presentation screen: +1, -1, 'first', 'last', or null.
 * Presentation clickers send PageDown / PageUp (and some send b or . for blank).
 * @param {string} key
 */
export function keyStep(key) {
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].includes(key)) return 1;
  if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(key)) return -1;
  if (key === 'Home') return 'first';
  if (key === 'End') return 'last';
  return null;
}

/** A tap on the TV: the left quarter goes back, the right quarter on, the middle nothing. @param {number} x @param {number} width */
export function tapStep(x, width) {
  if (!(width > 0)) return 0;
  if (x <= width * 0.25) return -1;
  if (x >= width * 0.75) return 1;
  return 0;
}

/** Elapsed time as m:ss or h:mm:ss. @param {number} ms */
export function elapsed(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** "Updated Thursday, Nov 5" from the deck's builtAt, in Eastern time. @param {string|null} iso */
export function builtWords(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return '';
  return `Numbers from ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric' }).format(t)}`;
}

/**
 * Which view: the TV (`?screen=tv`, KVBC Awana's TV window) or the presenter
 * view (everything else: the app's Settings window `?configure=1`, a laptop, a phone).
 * @param {string} search
 */
export function modeOf(search) {
  const q = new URLSearchParams(search || '');
  return q.get('screen') === 'tv' ? 'tv' : 'presenter';
}

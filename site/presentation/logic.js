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

/**
 * Speaker notes on this device? A PHONE only (owner 2026-11-01: "On my phone I
 * should be able to see notes but no where else"): a touch screen whose short
 * side is phone-sized. Never the lobby computer's Settings window (`configure`),
 * a laptop, a tablet or the TV.
 * @param {{ configure: boolean, coarse: boolean, screenW: number, screenH: number }} d
 */
export function notesHere({ configure, coarse, screenW, screenH }) {
  if (configure || !coarse) return false;
  const short = Math.min(screenW, screenH);
  return short > 0 && short <= 600;
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

// When the presentation follows the other devices (owner 2026-11-03: "Presentation
// should only check for things on Sunday nights"; 5-9 PM Eastern). Outside it the
// page makes no calls at all: no socket, no poll, a press is not sent. Windows of one
// browser still follow each other (BroadcastChannel), so the lobby computer's
// Settings window still drives its TV.
export const FOLLOW_WINDOW = Object.freeze({ day: 0, from: 17 * 60, until: 21 * 60, zone: 'America/New_York' });

/** Eastern weekday (0 = Sunday) and minutes past midnight. @param {Date} d */
function easternClock(d) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: FOLLOW_WINDOW.zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map((p) => [p.type, p.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { day, mins: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Is the presentation following other devices now? @param {Date} [d] */
export function followingNow(d = new Date()) {
  const { day, mins } = easternClock(d);
  return day === FOLLOW_WINDOW.day && mins >= FOLLOW_WINDOW.from && mins < FOLLOW_WINDOW.until;
}

/** Milliseconds until the window's next edge (open or close), at most an hour. @param {Date} [d] */
export function msToNextEdge(d = new Date()) {
  const { mins } = easternClock(d);
  const secs = d.getUTCSeconds() * 1000 + d.getUTCMilliseconds();
  const edges = [FOLLOW_WINDOW.from, FOLLOW_WINDOW.until].map((e) => ((e - mins + 1440) % 1440 || 1440) * 60000 - secs);
  return Math.max(1000, Math.min(60 * 60 * 1000, ...edges));
}

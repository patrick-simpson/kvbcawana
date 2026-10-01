// @ts-check
// Self-updating pages: the pure half of "pick up a new deploy on your own".
//
// A lobby screen or a projector can run for weeks without anyone touching it,
// so a deploy nobody walks over to is a deploy nobody sees. Every build stamps
// ONE hash into two places (the serviceWorker() plugin in vite.config.js): a
// `<meta name="awana-build">` tag in both HTML entries, and `version.json`
// beside them. A running page polls version.json, notices its own stamp is
// older, and reloads itself once the room is not watching anything.
//
// Everything here is pure or takes its fetch as an argument, so both pages
// share one copy of the rules and the rules can be tested without a browser.
// That is also why the presentation page may import this file directly (it is
// on the isolation allowlist in CLAUDE.md) instead of growing a second copy.

/** The meta tag both HTML entries carry. Absent in dev, which makes the poller inert. */
export const BUILD_META_NAME = 'awana-build';

/**
 * Query parameter both probes carry. It busts every cache between here and the
 * origin, and src/sw.js keys off it to stay out of the way entirely: an answer
 * served from a cache would pin the screen to the build it already has.
 */
export const BUILD_PROBE_PARAM = 'awanaBuild';

/**
 * How far out the next meeting has to be before the projector counts as idle.
 * Club starts at 18:00, so this is "before 17:30" on a club night, and every
 * other day of the week. Inside it the countdown is the show and a reload
 * would blank the wall in front of a filling room.
 */
export const COUNTDOWN_IDLE_MS = 30 * 60 * 1000;

const META_RE = new RegExp(`<meta[^>]*name=["']${BUILD_META_NAME}["'][^>]*>`, 'i');
const CONTENT_RE = /content=["']([^"']*)["']/i;

/** @param {Document} [doc] */
function activeDocument(doc) {
  if (doc) return doc;
  return typeof document === 'undefined' ? null : document;
}

/**
 * The build hash this page was served as, read from its own meta tag.
 * Null means "no stamp", which is the dev server and any build older than
 * this feature: callers must treat that as "never update", never as a change.
 * @param {Document} [doc]
 * @returns {string|null}
 */
export function pageBuild(doc) {
  const d = activeDocument(doc);
  const content = d?.querySelector(`meta[name="${BUILD_META_NAME}"]`)?.getAttribute('content');
  const build = content?.trim();
  return build ? build : null;
}

/**
 * The build hash carried by a freshly fetched HTML document, as text.
 * @param {string|null} html
 * @returns {string|null}
 */
export function buildFromHtml(html) {
  if (typeof html !== 'string') return null;
  const tag = html.match(META_RE);
  if (!tag) return null;
  const build = tag[0].match(CONTENT_RE)?.[1]?.trim();
  return build ? build : null;
}

/**
 * The build hash named by a version.json body.
 *
 * Anything unexpected is null, i.e. "no news": in the hermetic e2e run there
 * is no version.json at all, and a captive portal can answer any URL with a
 * login page. Neither may ever read as a new build.
 * @param {string|null} text
 * @returns {string|null}
 */
export function parseVersion(text) {
  if (typeof text !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const build = parsed.build;
  return typeof build === 'string' && build.trim() ? build.trim() : null;
}

/**
 * A probe URL: the path plus the marker query (see BUILD_PROBE_PARAM).
 * @param {string} path
 * @param {number} [stamp]
 * @returns {string}
 */
export function probeUrl(path, stamp = Date.now()) {
  return `${path}${path.includes('?') ? '&' : '?'}${BUILD_PROBE_PARAM}=${stamp}`;
}

/**
 * Fetch a probe as text, or null for anything that is not a clean answer.
 *
 * Every failure mode collapses to null on purpose. A 404, a timeout, a dead
 * network and an unparsable body are all "no news", and no news must leave the
 * screen exactly as it is.
 * @param {string} url
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number}} [options]
 * @returns {Promise<string|null>}
 */
export async function fetchProbe(url, options = {}) {
  const { fetchImpl, timeoutMs = 5000 } = options;
  const call = fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!call) return null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await call(url, { cache: 'no-store', signal: controller?.signal });
    if (!res || !res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/**
 * Is the projector showing something a room is watching?
 *
 * Shutdown ("see you next week", four hours to an empty room) is always safe,
 * and so is a countdown still more than COUNTDOWN_IDLE_MS out. A game window,
 * a slideshow and the last half hour of the countdown never are.
 * @param {{mode: string, target?: Date}|null} state The resolved AppState (src/presentation/types.js).
 * @param {number} [now]
 * @returns {boolean}
 */
export function projectorIdle(state, now = Date.now()) {
  if (!state) return false;
  if (state.mode === 'SHUTDOWN') return true;
  if (state.mode !== 'COUNTDOWN') return false;
  const target = state.target;
  if (!(target instanceof Date) || Number.isNaN(target.getTime())) return false;
  return target.getTime() - now > COUNTDOWN_IDLE_MS;
}

/**
 * Is somebody typing right now? A reload would eat the words mid-sentence,
 * so this holds the page whatever else it is doing.
 * @param {Document} [doc]
 * @returns {boolean}
 */
export function isTyping(doc) {
  const el = activeDocument(doc)?.activeElement;
  if (!el) return false;
  if (/** @type {any} */ (el).isContentEditable === true) return true;
  // jsdom does not implement isContentEditable, so read the attribute too.
  if (el.closest('[contenteditable=""], [contenteditable="true"]')) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** The one place the page actually reloads, so tests can stub exactly this. */
export function reloadPage() {
  window.location.reload();
}

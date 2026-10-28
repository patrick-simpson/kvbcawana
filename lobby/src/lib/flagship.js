// @ts-check
// The flagship slide: one permanent, built-in welcome, the church's own logo
// huge in the middle of the screen (owner 2026-10-13: "a super fun, joyful
// animation of the logo"), that leads every pass through the typed slideshow.
//
// It is not stored, published or editable, and has no setting; only the
// clock (flagshipOnAir) takes it off, during Wednesday club: like the calendar slides and the
// promo slot it is derived (here, a constant) and added at the head of the
// deck the slideshow rotates, so an operator's own slides, a published deck
// and the calendar's auto-slides all come after it. Unlike a promo it never
// HOLDS check-ins (holdsCheckIns is false for it): names play over it like
// over any typed slide, and it steps back for them.

export const FLAGSHIP_ID = 'flagship_welcome';

/** How long it holds; its beat sheet (FlagshipSlide.jsx) is written against this. */
export const FLAGSHIP_DURATION_SEC = 10;

export const FLAGSHIP_SLIDE = Object.freeze({
  id: FLAGSHIP_ID,
  type: 'flagship',
  durationSec: FLAGSHIP_DURATION_SEC,
});

/**
 * @param {any} slide
 * @returns {boolean}
 */
export function isFlagshipSlide(slide) {
  return slide?.type === 'flagship';
}

/**
 * The flagship is off the air during club itself: Wednesdays from 6:30 pm up
 * to (not including) 8:30 pm, local time (owner, 2026-09-29). Outside that
 * window it is always in the rotation.
 *
 * @param {Date} [now]
 * @returns {boolean}
 */
export function flagshipOnAir(now = new Date()) {
  if (now.getDay() !== 3) return true;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return !(minutes >= 18 * 60 + 30 && minutes < 20 * 60 + 30);
}

/**
 * The deck with the flagship slide first (unless it is off the air). Any flagship already in it (there
 * should never be one: nothing else makes them, and the wire's slide
 * allowlist drops the type) is dropped so it can only ever appear once.
 *
 * @template T
 * @param {T[] | null | undefined} deck
 * @param {boolean} [onAir]  flagshipOnAir(now); false leaves it out.
 * @returns {Array<T | typeof FLAGSHIP_SLIDE>}
 */
export function withFlagship(deck, onAir = true) {
  const rest = (deck || []).filter((s) => !isFlagshipSlide(s));
  return onAir ? [FLAGSHIP_SLIDE, ...rest] : rest;
}

/**
 * The three ways the logo arrives (owner 2026-10-13: "one of each on each
 * load, mix it up"), in the order a screen plays them:
 *   bounce  Awana Clubs bounces in letter by letter, club-colour doodles pop;
 *   pop     the whole logo pops up from small, with a confetti burst;
 *   parade  the six club colours march up behind it, back to the sky.
 */
export const FLAGSHIP_STYLES = Object.freeze(['bounce', 'pop', 'parade']);

/**
 * The two wordings (owner 2026-10-13): `glad` is the logo with "We're so glad
 * you're here!" under it; `welcome` is "Welcome to" over the logo, nothing
 * under it. Both use the full logo, tagline and all.
 */
export const FLAGSHIP_VERSIONS = Object.freeze(['glad', 'welcome']);

/** The one line each wording adds, exactly as the owner wrote it. */
export const FLAGSHIP_LINES = Object.freeze({
  glad: 'We\u2019re so glad you\u2019re here!',
  welcome: 'Welcome to',
});

const LOGO_NAME = 'Kennebec Valley Baptist Church Awana Clubs. Strengthening the next generation of lifelong disciples for Christ';

/**
 * The slide's one spoken label (it is role="img"): the logo's own words, and
 * the line the wording adds, in reading order.
 * @param {'glad' | 'welcome'} version
 */
export function flagshipLabel(version) {
  return version === 'welcome'
    ? `${FLAGSHIP_LINES.welcome} ${LOGO_NAME}`
    : `${LOGO_NAME}. ${FLAGSHIP_LINES.glad}`;
}

/**
 * The style and wording for the n-th showing on a screen: the styles take
 * turns and so do the wordings, so neither repeats back to back, and six
 * showings in a row play every pairing once.
 * @param {number} n
 * @returns {{ style: 'bounce' | 'pop' | 'parade', version: 'glad' | 'welcome' }}
 */
export function flagshipPick(n) {
  const i = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  return {
    style: /** @type {'bounce' | 'pop' | 'parade'} */ (FLAGSHIP_STYLES[i % FLAGSHIP_STYLES.length]),
    version: /** @type {'glad' | 'welcome'} */ (FLAGSHIP_VERSIONS[i % FLAGSHIP_VERSIONS.length]),
  };
}

/** Where a screen keeps its place in the rotation (this screen only, never shared). */
export const FLAGSHIP_TURN_KEY = 'awanaFlagshipTurn.v1';

/** The turn in memory, for a browser whose storage throws or forgets. */
let memoryTurn = 0;

/**
 * The pick for the showing about to start, and the screen moves on one: its
 * place is kept in localStorage (so a reload carries on with the next one),
 * in memory when storage is not there. Never throws.
 * @param {{ getItem(k: string): string | null, setItem(k: string, v: string): void } | null} [store]
 */
export function nextFlagshipPick(store = defaultStore()) {
  let n = memoryTurn;
  try {
    const saved = Number.parseInt(store?.getItem(FLAGSHIP_TURN_KEY) ?? '', 10);
    if (Number.isFinite(saved) && saved >= 0) n = saved;
  } catch { /* storage refused: the memory turn carries on */ }
  // Six showings play every pairing; wrap there so the number stays small.
  const next = (n + 1) % (FLAGSHIP_STYLES.length * FLAGSHIP_VERSIONS.length);
  memoryTurn = next;
  try {
    store?.setItem(FLAGSHIP_TURN_KEY, String(next));
  } catch { /* storage refused: the memory turn carries on */ }
  return flagshipPick(n);
}

function defaultStore() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

// ── The 3D intro (owner 2026-10-27) ─────────────────────────────────────
// Now and then a showing of the flagship carries on into the 15 s 3D intro
// video (video/awana-intro/: Blender, rendered from the brand kit). Its first
// and last frames ARE this slide in its bounce style with the glad line, at
// rest (measured off the lobby by video/awana-intro/tools/measure-lobby.mjs),
// so the showing plays that pick, settles, and the video takes over on an
// identical frame; at its end it hands back the same way and the deck moves
// on. FlagshipIntro.jsx plays it.

/** One pass in this many plays the intro (the second pass, then every fourth). */
export const FLAGSHIP_INTRO_EVERY = 4;

/** The video, beside the lobby's own files (lobby/public/intro/; streamed by site/functions on the site). */
export const FLAGSHIP_INTRO_SRC = './intro/awana-intro.mp4';

/**
 * The showing the video begins and ends on.
 * @type {Readonly<{ style: 'bounce', version: 'glad' }>}
 */
export const FLAGSHIP_INTRO_PICK = Object.freeze({ style: 'bounce', version: 'glad' });

/**
 * Its timing, in seconds. `lead`: the video starts this long into the
 * showing, once the slide is at rest. `fade`: each hand-over (video in, the
 * scene's tab and waves out, and back). `homeAt`: the video's own time from
 * which it is the lobby again (its world has flattened back), when the tab
 * and waves take back over. `tail`: the slide holds this long after the
 * video ends. `waitMax`: a video not ready this long after `lead` is skipped
 * (the showing ends like any other, at FLAGSHIP_DURATION_SEC). `stall`: a
 * video stuck this long mid-play is let go.
 */
export const FLAGSHIP_INTRO = Object.freeze({ lead: 4, fade: 0.15, homeAt: 14.2, tail: 1, waitMax: 6, stall: 6 });

/**
 * Is this pass (the deck's `lap`) one that plays the intro?
 * @param {number} lap
 */
export function flagshipIntroLap(lap) {
  return Number.isInteger(lap) && lap % FLAGSHIP_INTRO_EVERY === 1;
}

/**
 * Can a screen this size show it seamlessly? The video is 16:9 and is the
 * slide as a 16:9 screen draws it, with the FULL logo (a 16:9 screen under
 * 722px wide draws the two-line logo, flagship.css). Any other shape keeps
 * the plain flagship.
 * @param {number} width
 * @param {number} height
 */
export function introFits(width, height) {
  return width >= 722 && height > 0 && Math.abs(width / height - 16 / 9) <= 0.03;
}

/** Test seam: forget the memory turn. */
export function resetFlagshipTurn() {
  memoryTurn = 0;
}

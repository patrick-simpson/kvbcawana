import confetti from 'canvas-confetti';
import { DOODLES } from './brand.js';

// Every burst respects prefers-reduced-motion (canvas-confetti no-ops the
// call entirely), keeping the display comfortable on low-power signage
// sticks and for motion-sensitive viewers.
const BASE = { disableForReducedMotion: true };

// During a check-in rush banners (and their confetti) fire back-to-back;
// thinning the particles keeps the animation at 60fps on cheap hardware.
let loadFactor = 1;
export function setConfettiLoad(bursting) {
  loadFactor = bursting ? 0.5 : 1;
}

// Operator-tunable room-wide intensity (Settings → Screen & corner):
// 'full' 1×, 'reduced' 0.5×, 'off' skips every burst entirely.
let levelFactor = 1;
export function setConfettiLevel(level) {
  levelFactor = level === 'off' ? 0 : level === 'reduced' ? 0.5 : 1;
}
const off = () => levelFactor === 0;
const scaled = (count) => Math.max(1, Math.round(count * loadFactor * levelFactor));

// ── Season-shaped confetti (#340) ────────────────────────────────────────────
// The skin already dresses the room for the season (src/lib/skins.js); these
// let the room-wide bursts wear it too — red-and-green stars at Christmas,
// white circles on a snow day, amber squares in autumn.
//
// Shapes are canvas-confetti's BUILT-IN names only. The installed build
// (1.9.4) does also export shapeFromPath/shapeFromText, but both rasterize
// through a live 2d canvas (and shapeFromText through a font that a kiosk
// Raspberry Pi may not even have — the emoji-font lesson from the Journey
// kiosk), and neither is needed for the seasons we actually dress. So this
// list is the whole vocabulary: 1.9.4 draws 'circle' and 'star' specially and
// EVERY other value as a square, so an unknown name is silently a square —
// which is why unknown shapes are dropped here and skins.test.js cross-checks
// every table entry against this list.
export const CONFETTI_SHAPES = ['square', 'circle', 'star'];

/** @type {{ colors: string[], shapes: string[] } | null} */
let skinProfile = null;

/**
 * Adopt (or clear) the active skin's confetti profile.
 *
 * Module-level, like setConfettiLevel/setConfettiLoad, and set from App.jsx in
 * an effect keyed on the resolved skin. Anything malformed — a non-object, a
 * colours string, an unknown shape name — is dropped rather than thrown, so a
 * bad table entry or a future shared-theme override costs the season's
 * particles, never the burst.
 *
 * @param {{ colors?: unknown, shapes?: unknown } | null | undefined} profile
 */
export function setConfettiSkin(profile) {
  const raw = profile && typeof profile === 'object' ? profile : null;
  const colors = Array.isArray(raw?.colors)
    ? raw.colors.filter((c) => typeof c === 'string' && c.trim() !== '')
    : [];
  const shapes = Array.isArray(raw?.shapes)
    ? raw.shapes.filter((s) => CONFETTI_SHAPES.includes(s))
    : [];
  skinProfile = (colors.length || shapes.length) ? { colors, shapes } : null;
}

const skinColors = () => (skinProfile && skinProfile.colors.length ? skinProfile.colors : null);
const skinShapes = () => (skinProfile && skinProfile.shapes.length ? skinProfile.shapes : null);

// ── The catalog's own confetti (rebrand stage 3) ─────────────────────────────
// The 2026-27 catalog scatters four-point sparkles and dots, never squares or
// five-point stars, so the bursts throw the brand kit's own sparkle
// (shared/brand/doodles/sparkle-4pt.svg) and circles. The sparkle is a path
// shape, built ONCE with an explicit matrix: that skips shapeFromPath's
// pixel-scan for the path's bounds (the live-canvas rasterizing the season
// note above avoids), so what remains is one Path2D the library transforms
// per particle. Anywhere paths are unsupported (canvas-confetti throws) it
// falls back to the built-in star, and the Pi Zero embed never gets here at
// all (?lowPower=1 forces confettiLevel 'off').
/** @type {object | null | undefined} */
let sparkleShape;
function brandShapes() {
  if (sparkleShape === undefined) {
    try {
      const [x, y, w, h] = DOODLES.sparkle.viewBox.split(/\s+/).map(Number);
      const k = 10 / Math.max(w, h);
      sparkleShape = confetti.shapeFromPath({
        path: DOODLES.sparkle.d,
        matrix: [k, 0, 0, k, -(x + w / 2) * k, -(y + h / 2) * k],
      });
    } catch {
      sparkleShape = null;
    }
  }
  return sparkleShape ? [sparkleShape, 'circle'] : ['star', 'circle'];
}
/** Test seam: forget the built sparkle so the next burst rebuilds it. */
export function resetConfettiShapes() {
  sparkleShape = undefined;
}

// The house palette, straight from the brand kit (shared/brand/tokens.json
// `house`): Awana orange and sunflower, white, the hot sticker red-orange and
// Awana blue, plus T&T green for a little more spread. Used for milestones
// that belong to the whole room (a night threshold, the every-Nth toast)
// rather than to one club.
const MILESTONE_COLORS = ['#FAA41D', '#FCB614', '#FFFFFF', '#F15A28', '#4C72B8', '#58BD79'];

// A birthday and a first-timer burst from the hot sticker, in warm brand
// colours that read on any club's wave.
const BIRTHDAY_COLORS = ['#FFFFFF', '#FCB614', '#FFE8C2', '#F15A28', '#FAA41D'];
const FIRST_TIMER_COLORS = ['#FFFFFF', '#FCB614', '#FFE8C2', '#FAA41D'];

// Where the check-in moment's sticker sits on a 16:9 stage (6u from the
// right edge, its centre 28u up a 56.25u-tall stage). The moment passes the
// sticker's measured centre instead; this is only the fallback for when it
// cannot (no layout, e.g. a crashed or already-gone moment).
const STICKER_ORIGIN = { x: 0.87, y: 0.5 };
const unit = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
/** @param {{ x?: number, y?: number } | undefined} origin */
const stickerOrigin = (origin) => (origin && unit(origin.x) && unit(origin.y)
  ? { x: origin.x, y: origin.y }
  : STICKER_ORIGIN);

/**
 * Standard celebration: two low side cannons of sparkles and dots in the
 * child's club colours, timed by the check-in moment to land with the name.
 * @param {string[]} [colors]
 */
export function fireStandard(colors) {
  if (off()) return;
  const defaults = { ...BASE, spread: 58, ticks: 170, gravity: 0.95, scalar: 1.05, colors, shapes: brandShapes() };
  confetti({ ...defaults, particleCount: scaled(64), angle: 60, origin: { x: 0, y: 0.78 } });
  confetti({ ...defaults, particleCount: scaled(64), angle: 120, origin: { x: 1, y: 0.78 } });
}

/**
 * Birthday: a burst of sparkles and dots out of the HAPPY BIRTHDAY sticker,
 * then side cannons for a second and a half.
 * @param {string[]} [clubColors]
 * @param {{ x: number, y: number }} [origin]  the sticker's centre, 0..1 of the viewport
 */
export function fireBirthday(clubColors, origin) {
  if (off()) return;
  // The season dresses the room, so it dresses this burst too (#340); with no
  // skin profile it is the warm sticker palette, with the child's club
  // colours mixed in when the moment passes them.
  const colors = skinColors()
    ?? (Array.isArray(clubColors) && clubColors.length ? [...BIRTHDAY_COLORS, ...clubColors] : BIRTHDAY_COLORS);
  const shapes = skinShapes() ?? brandShapes();
  const end = Date.now() + 1500;
  // The pop out of the sticker first: it is what the eye is on.
  confetti({
    ...BASE,
    particleCount: scaled(120), spread: 110, startVelocity: 34, ticks: 230,
    origin: stickerOrigin(origin), angle: 110, colors, shapes, scalar: 1.25,
  });
  setTimeout(() => {
    (function frame() {
      confetti({
        ...BASE,
        particleCount: scaled(5), angle: 60, spread: 70,
        origin: { x: 0, y: 0.7 }, colors, shapes, scalar: 1.1,
      });
      confetti({
        ...BASE,
        particleCount: scaled(5), angle: 120, spread: 70,
        origin: { x: 1, y: 0.7 }, colors, shapes, scalar: 1.1,
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }, 200);
}

/**
 * First-timer: a gentle shower of sparkles out of the NEW! sticker, drifting
 * down slowly, then a soft second puff.
 * @param {{ x: number, y: number }} [origin]  the sticker's centre, 0..1 of the viewport
 */
export function fireFirstTimer(origin) {
  if (off()) return;
  const colors = FIRST_TIMER_COLORS;
  const shapes = brandShapes();
  const from = stickerOrigin(origin);
  confetti({
    ...BASE,
    particleCount: scaled(110), spread: 130, startVelocity: 30, ticks: 260,
    origin: from, angle: 115, colors, shapes, scalar: 1.25,
    gravity: 0.6,
  });
  setTimeout(() => {
    confetti({
      ...BASE,
      particleCount: scaled(36), spread: 360, startVelocity: 14, ticks: 200,
      origin: from, colors, shapes, scalar: 1.0,
    });
  }, 500);
}

// Tally milestone (every Nth check-in): a big room-wide moment in Awana
// gold and club colors, bigger than any single kid's banner burst.
/**
 * Room-wide milestone burst.
 *
 * `big` escalates it for a named night threshold (the 100th kid) so that reads
 * as an occasion rather than another routine every-25 toast. It only scales the
 * existing burst — it does NOT bypass `scaled()` or `off()`, so the rush
 * throttle, the operator's confetti-level setting and reduced-motion all still
 * win. A milestone is never a reason to override someone's accessibility
 * preference.
 *
 * `colors` tints the WHOLE burst — every wave, not just the first — so a
 * club's own milestone can burst in its own colors (#332). Omitted (or
 * empty, e.g. a malformed shared-theme override) it falls back to the active
 * skin's seasonal palette (#340), and then to the house MILESTONE_COLORS.
 *
 * That order is the standing rule, not a coincidence: the skin dresses the
 * ROOM, so it colours the room-wide night/tally milestones — but a club's own
 * milestone keeps the club's colours even at Christmas.
 *
 * @param {{ big?: boolean, colors?: string[] }} [opts]
 */
export function fireMilestone(opts) {
  if (off()) return;
  const big = !!(opts && opts.big);
  const colors = (opts && Array.isArray(opts.colors) && opts.colors.length)
    ? opts.colors
    : skinColors() ?? MILESTONE_COLORS;
  confetti({
    ...BASE,
    particleCount: scaled(big ? 260 : 160),
    spread: big ? 150 : 120,
    startVelocity: big ? 52 : 45,
    ticks: big ? 340 : 280,
    origin: { x: 0.5, y: 0.65 }, colors, scalar: big ? 1.5 : 1.3,
    shapes: skinShapes() ?? brandShapes(),
  });
  setTimeout(() => {
    const cannons = { ...BASE, spread: 70, ticks: 220, colors, scalar: 1.15, shapes: skinShapes() ?? brandShapes() };
    const n = scaled(big ? 110 : 70);
    confetti({ ...cannons, particleCount: n, angle: 60, origin: { x: 0, y: 0.85 } });
    confetti({ ...cannons, particleCount: n, angle: 120, origin: { x: 1, y: 0.85 } });
  }, 250);
  // A big milestone gets a second wave so it visibly outlasts a normal one.
  if (big) {
    setTimeout(() => {
      confetti({
        ...BASE,
        particleCount: scaled(120), spread: 130, startVelocity: 40, ticks: 260,
        origin: { x: 0.5, y: 0.5 }, colors, scalar: 1.4, shapes: skinShapes() ?? brandShapes(),
      });
    }, 700);
  }
}

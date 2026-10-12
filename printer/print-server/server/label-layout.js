'use strict';
// Label geometry constants.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.


// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  BH: { enumerable: true, get: () => BH },
  BW: { enumerable: true, get: () => BW },
  BX: { enumerable: true, get: () => BX },
  BY: { enumerable: true, get: () => BY },
  CORNER: { enumerable: true, get: () => CORNER },
  DIVIDER_X: { enumerable: true, get: () => DIVIDER_X },
  ICON_COL_W: { enumerable: true, get: () => ICON_COL_W },
  ICON_WAVE_MAX_DX: { enumerable: true, get: () => ICON_WAVE_MAX_DX },
  NAME_INK_TOP: { enumerable: true, get: () => NAME_INK_TOP },
  NAME_LIFT_BRAND: { enumerable: true, get: () => NAME_LIFT_BRAND },
  NAME_LINE_H_BRAND: { enumerable: true, get: () => NAME_LINE_H_BRAND },
  NAME_ROOM_SHRINK_MAX: { enumerable: true, get: () => NAME_ROOM_SHRINK_MAX },
  NO_PHOTO_BAR_W: { enumerable: true, get: () => NO_PHOTO_BAR_W },
  NO_PHOTO_CUT: { enumerable: true, get: () => NO_PHOTO_CUT },
  PAGE_H: { enumerable: true, get: () => PAGE_H },
  PAGE_W: { enumerable: true, get: () => PAGE_W },
  TEXT_W: { enumerable: true, get: () => TEXT_W },
  TEXT_X: { enumerable: true, get: () => TEXT_X },
  traceIconWave: { enumerable: true, get: () => traceIconWave },
});

// ── Label geometry (1 pt = 1/72 inch) ────────────────────────────────────────
const PAGE_W  = 4 * 72;  // 288 pt
const PAGE_H  = 2 * 72;  // 144 pt
const INSET   = 6;        // badge margin from page edge
const BX = INSET, BY = INSET;
const BW = PAGE_W - INSET * 2;   // badge width  (276 pt)
const BH = PAGE_H - INSET * 2;   // badge height (132 pt)
const CORNER = 12;

// Columns (when icon is present)
const ICON_COL_W  = 84;                // left icon zone width
const DIVIDER_X   = BX + ICON_COL_W;
const TEXT_X      = DIVIDER_X + 8;    // right text zone start
const TEXT_W      = BX + BW - TEXT_X; // right text zone width

// No-photo edge bar (owner, 2026-10-02): a child who may not be photographed
// gets a solid bar down the label's right edge as well as the crossed-out
// camera, so a photographer spots it at a glance, from across a room or in a
// viewfinder, without reading the icon row. 1/8 inch, top to bottom, flush
// with the paper's edge, in the label's ink (black, or white on an inverted
// label, where black would vanish). Everything else on the label keeps
// NO_PHOTO_BAR_GAP clear of it: the badge's content edge moves in by
// NO_PHOTO_CUT.
const NO_PHOTO_BAR_W   = 9;   // 1/8 inch
const NO_PHOTO_BAR_GAP = 4;
const NO_PHOTO_CUT     = (BX + BW) - (PAGE_W - NO_PHOTO_BAR_W - NO_PHOTO_BAR_GAP);  // 7 pt

// The first name in the kit's shout face (Paytone One), as multiples of its
// size. Where the ink lands is measured off the canvas at a 'top' baseline (the
// line's origin is the top of the em box the canvas picks for it):
//   Paytone One   ascenders 0.20, capitals 0.26, baseline 0.96, g j p q y to 1.16
//   Galindo       ascenders 0.09, capitals 0.11, baseline 0.84,           to 1.15
//   the old faces the whole line inside the box (1.0)
// So Paytone's ink sits about 0.15 lower in its box than Galindo's did, and
// its descenders are shallower. The name is drawn NAME_LIFT_BRAND above the
// box's top, which puts the capitals back where Galindo's were (0.11), and the
// line box then runs to just past the deepest ordinary descender
// (1.16 - 0.15 = 1.01) with a little air, so the last name below it keeps the
// same gap it always had. The old Windows faces keep neither number: they
// draw where they always did.
const NAME_LINE_H_BRAND = 1.06;
const NAME_LIFT_BRAND = 0.15;
// How close to the paper's top edge the first name's ink may rise, in pt. A
// mark that stands above the capitals (É, Ấ) needs room above the name; the
// block only pays for the part of that room the paper above it cannot give
// (see the name block in generateLabel). 4 pt is as close as 6.17.0 ever
// printed a name (Galindo's É), so it is a margin already proven on the paper.
const NAME_INK_TOP = 4;
// The most, in pt, a name gives up BELOW its 18 pt floor so that the room a mark
// above it or a comma below it asks for does not add to the crowding at the
// bottom of the label (see the height-fit in generateLabel).
const NAME_ROOM_SHRINK_MAX = 4;

// The icon column's right edge: the catalog's wave instead of a ruled line. A
// slow, slightly irregular S sampled from the approved mockup — [fraction of
// the badge height, offset in pt from DIVIDER_X] — drawn as one smooth curve
// through the points (Catmull-Rom as cubic Béziers). The mockup's swing is
// about ±1.3 pt; it is drawn half as deep again so it still reads as a wave on
// a 300 dpi thermal print, and it never comes within 6 pt of the text column.
const ICON_WAVE = Object.freeze([
  [0, -1.5], [0.13, 0.3], [0.30, -1.35], [0.48, 1.65], [0.70, -0.3], [0.86, 1.95], [1, -0.9],
]);
const ICON_WAVE_MAX_DX = Math.max(...ICON_WAVE.map(([, dx]) => Math.abs(dx)));
// Adds the edge from the top of the badge to the bottom to the current path;
// `start` begins a new subpath there, otherwise the edge continues the path.
function traceIconWave(ctx, top, height, start) {
  const pts = ICON_WAVE.map(([t, dx]) => [DIVIDER_X + dx, top + t * height]);
  if (start) ctx.moveTo(pts[0][0], pts[0][1]);
  else ctx.lineTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    ctx.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
      p2[0], p2[1]);
  }
}

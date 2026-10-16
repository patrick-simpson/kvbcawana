'use strict';
// The club list, label fonts and type, free-text label sizing.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const brand = require('../brand');
const { CLUB_TABLE, clubKeyByLabel } = require('../clubTable');
const $labelLayout = lazy('./label-layout');
const $images = lazy('./images');

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  CLUB_DISPLAY_NAMES: { enumerable: true, get: () => CLUB_DISPLAY_NAMES },
  CLUB_LIST: { enumerable: true, get: () => CLUB_LIST },
  CUSTOM_TEXT_MAX_CHARS: { enumerable: true, get: () => CUSTOM_TEXT_MAX_CHARS },
  fitCustomLabelText: { enumerable: true, get: () => fitCustomLabelText },
  labelType: { enumerable: true, get: () => labelType },
  splitCustomTextInTwo: { enumerable: true, get: () => splitCustomTextInTwo },
});

// ── The one club list every dropdown reads ────────────────────────────────────
// Display names for the clubs above, in club order, served by GET /clubs and
// consumed by the settings page (until 10.0.0 also the Chrome extension's panel).
//
// There used to be five hardcoded copies of this list across those three
// surfaces, and they drifted: the extension's walk-in guest dropdown was the
// one that never got Journey, so a Journey walk-in could only be printed with
// the wrong club or none. Keys are clubKey() values, so anything the label
// renderer can style (monogram + font) is offerable and nothing else is —
// test-server-helpers.cjs asserts these two tables stay in step.
const CLUB_DISPLAY_NAMES = Object.fromEntries(CLUB_TABLE.map((c) => [c.key, c.name]));
const CLUB_LIST = Object.keys($images.CLUB_MONOGRAM).map((k) => CLUB_DISPLAY_NAMES[k]);

// ── The fonts labels printed in before the brand kit ─────────────────────────
// Each club used to get its own Windows system font. They are no longer what a
// label is set in (the kit's fonts are, below), but they are what it FALLS
// BACK to, text by text, whenever a kit font did not load or cannot draw the
// characters in front of it, so a broken install prints exactly the label it
// printed before the kit existed. Keep them as they were.
function getClubFontFamily(clubName) {
  const n = (clubName || '').toLowerCase();
  if (n.includes('puggle'))                          return "'Comic Sans MS', cursive, sans-serif";
  if (n.includes('cubbie'))                          return "'Comic Sans MS', cursive, sans-serif";
  if (n.includes('spark'))                           return "'Trebuchet MS', Arial, sans-serif";
  if (n.includes('t&t') || n.includes('t & t') || n.includes('truth and training'))
                                                     return "'Arial Black', 'Arial Bold', Arial, sans-serif";
  if (n.includes('trek'))                            return "Georgia, 'Times New Roman', serif";
  if (n.includes('journey'))                         return "'Palatino Linotype', Palatino, Georgia, serif";
  return "Helvetica, Arial, sans-serif";
}

// ── Label type: the kit's three voices, with the old fonts behind them ───────
// Every piece of text on a label is set in one voice. Paytone One shouts (the
// first name, the monogram, a custom label), Londrina Solid labels (the club line,
// the VISITOR/LEADER pill, the trophy chip, the step-up callout, the TEST band)
// and Figtree is read (the last name and every small line). The same files are
// on every PC because they ship in the installer, so a label looks the same at
// every church; they used to be whichever Windows font each club happened to
// map to.
//
// `legacy` is the exact CSS font style the pre-kit code asked for, in the old
// family (getClubFontFamily, or `legacyFamily`). It is what prints when the kit
// font did not load (brand.fontReady) and, text by text, for characters the kit
// font does not have: the canvas does not borrow missing glyphs from the system
// fonts the way a browser does, it leaves a hole.
//
// `whole: true` voices never mix faces inside one string: a name the brand font
// cannot fully draw ("Дима" in Paytone One, which has no Cyrillic) prints
// entirely in the old font, as it did before, instead of as a name with one
// letter in another typeface. (Paytone One does draw Ș Ț and every Vietnamese
// letter, which its predecessor Galindo did not, so those names now print in
// the kit; Figtree still lacks the precomposed Vietnamese letters, so a last
// name like "Nguyễn" still falls back on its own.) A
// custom label is the same big line, and as often as not a person's or a
// room's name in the congregation's own language, so it is whole too. A custom
// label that wraps is still ONE piece of text, so its face is decided once from
// all of it (labelType's `pinned`), never per wrapped line: a missing letter
// in one half must not print the other half in a different typeface. Other
// voices split into runs at WORD boundaries (brand.splitRuns), so
// "⭐ 10th club night tonight!" keeps Figtree for the words and the star comes
// from the old stack, as it always did, and a word the kit font lacks a letter
// of prints whole in the old stack rather than changing face mid-word.
//
// `wght` is Figtree's weight axis. Figtree ships as one variable font and the
// canvas ignores a CSS weight for it (it draws the default Light instance and
// fakes anything heavier), so the weight goes through fontVariationSettings.
//
// CLUB FACES (owner 2026-10-12). Puggles and Cubbies set EVERY line in Comic
// Neue, Trek and Journey in Playfair Display (brand.CLUB_FACES, keyed by club
// key; Sparks, T&T, no club and an unknown club keep the voices above). Each
// role's `tier` says which of the club set's three weights it takes: `shout`
// the first name and the monogram, `bold` the club line, group, "Go to",
// pills, chips and bands, `regular` the rest, as in the approved previews.
// The club face goes IN FRONT of the role's voice, so a label falls back in
// steps: a word the club face cannot draw (Comic Neue has no Vietnamese or
// Ș, Playfair no Greek) goes to the stock voice, and only a word that cannot
// draw either goes to the old Windows face; a `whole` role makes the same
// choice for the whole string. A club whose face did not load (brand.clubFaces
// is then null) prints exactly the stock label. A label with no club of its
// own (custom, BARF, drop-off) passes '' and is stock.
const LEGACY_SANS = 'Helvetica, Arial, sans-serif';
const LABEL_VOICES = Object.freeze({
  name:      { family: 'Paytone One',          legacy: 'bold', whole: true, tier: 'shout' },
  monogram:  { family: 'Paytone One',          legacy: 'bold', whole: true, tier: 'shout' },
  custom:    { family: 'Paytone One',          legacy: 'bold', legacyFamily: LEGACY_SANS, whole: true, tier: 'shout' },
  last:      { family: 'Figtree', wght: 500,   legacy: '',     whole: true, tier: 'regular' },
  hint:      { family: 'Figtree', wght: 500,   legacy: 'italic', tier: 'regular' },
  group:     { family: 'Figtree', wght: 600,   legacy: 'italic', tier: 'bold' },
  goTo:      { family: 'Figtree', wght: 700,   legacy: 'bold', tier: 'bold' },
  milestone: { family: 'Figtree', wght: 500,   legacy: '', tier: 'regular' },
  footer:    { family: 'Figtree', wght: 400,   legacy: 'italic', tier: 'regular' },
  age:       { family: 'Figtree', wght: 600,   legacy: '', tier: 'regular' },
  club:      { family: 'Londrina Solid',       legacy: 'italic bold', tier: 'bold' },
  stepUp:    { family: 'Londrina Solid Black', legacy: 'bold', tier: 'bold' },
  pill:      { family: 'Londrina Solid Black', legacy: 'bold', tier: 'bold' },
  band:      { family: 'Londrina Solid Black', legacy: 'bold', tier: 'bold' },
  test:      { family: 'Londrina Solid Black', legacy: 'bold', legacyFamily: LEGACY_SANS, tier: 'bold' },
});

// The first name's line box per club face, measured once at a 'top' baseline
// (label-layout.js NAME_CAP_TOP, NAME_BOX_AIR): keyed by family and weight;
// null when the face measured nonsense (then the stock constants are used).
const nameBoxes = new Map();
// Room, in em, a club face's ink is given past its measured bounds (inkReach).
const CLUB_INK_PAD = 0.045;

// The type helpers for one label, bound to its club's old family. Every helper
// takes (ctx, role, size, text): measure, fill (honouring ctx.textAlign and
// ctx.textBaseline like fillText), truncate (with an ellipsis) and fit (the
// largest even size from max down to min that fits, else min — the same ladder
// the pre-kit fitFontSize used).
//
// `pinned` is { role: wholeText } for text that reaches the canvas in PIECES
// but is one thing to read (a custom label wrapped onto two lines). For a
// pinned role the face is decided once, here, from the whole text (the kit face
// only if it loaded and draws every character of all of it), and every measure,
// fit, truncate and fill of that role then uses that one face whatever piece it
// is handed. Deciding per piece is how one half of a wrapped label came out in
// the kit's face and the other in Helvetica.
function labelType(clubName, pinned = {}) {
  const clubFamily = getClubFontFamily(clubName);
  const clubSet = brand.clubFaces(clubKeyByLabel(clubName));
  const stock = (role) => LABEL_VOICES[role] || LABEL_VOICES.last;
  // The faces a role may be set in, best first, each a whole voice (family,
  // weight, and the role's legacy style behind it): the club's face, then the
  // stock voice. Only faces that loaded are listed.
  const faces = (role) => {
    const v = stock(role);
    const out = [];
    const c = clubSet && clubSet[v.tier];
    if (c) out.push({ ...v, family: c.family, wght: c.wght });
    if (brand.fontReady(v.family)) out.push(v);
    return out;
  };
  // The first face that draws every character of `s`, else null (old face).
  const wholeFace = (role, s) => faces(role).find((f) => brand.fontCovers(f.family, s)) || null;
  const pinnedFace = new Map();
  for (const [role, whole] of Object.entries(pinned || {})) {
    pinnedFace.set(role, wholeFace(role, whole));
  }
  // Runs of `text`, each with the face it prints in (`face`, null for the old
  // Windows face).
  const runsOf = (role, text) => {
    const v = stock(role);
    const s = String(text == null ? '' : text);
    if (pinnedFace.has(role)) return [{ text: s, face: pinnedFace.get(role) }];
    const list = faces(role);
    if (!list.length) return [{ text: s, face: null }];
    if (v.whole) return [{ text: s, face: wholeFace(role, s) }];
    return brand.splitRuns(list.map((f) => f.family), s)
      .map((r) => ({ text: r.text, face: list.find((f) => f.family === r.family) || null }));
  };
  const use = (ctx, role, size, face) => {
    const v = stock(role);
    const fallback = v.legacyFamily || clubFamily;
    ctx.font = face
      ? `${size}px "${face.family}", ${fallback}`
      : `${v.legacy ? v.legacy + ' ' : ''}${size}px ${fallback}`;
    // Always set, so no weight leaks from one run into the next face.
    ctx.fontVariationSettings = face && face.wght ? `"wght" ${face.wght}` : 'normal';
  };
  const measure = (ctx, role, size, text) => {
    let w = 0;
    for (const r of runsOf(role, text)) { use(ctx, role, size, r.face); w += ctx.measureText(r.text).width; }
    return w;
  };
  const fill = (ctx, role, size, text, x, y) => {
    const runs = runsOf(role, text);
    if (runs.length === 1) {
      use(ctx, role, size, runs[0].face);
      ctx.fillText(runs[0].text, x, y);
      return;
    }
    // Mixed faces: lay the runs out left to right on ONE alphabetic baseline,
    // the one the lead (first kit) face would sit on at (x, y) — each face's
    // own 'top' or 'middle' sits at a different height, so anchoring runs
    // separately would step the line.
    const align = ctx.textAlign;
    const baseline = ctx.textBaseline;
    const widths = runs.map((r) => { use(ctx, role, size, r.face); return ctx.measureText(r.text).width; });
    const total = widths.reduce((a, b) => a + b, 0);
    let left = align === 'center' ? x - total / 2
      : (align === 'right' || align === 'end') ? x - total : x;
    const lead = runs.find((r) => r.face) || runs[0];
    use(ctx, role, size, lead.face);
    let yAlpha = y;
    if (baseline !== 'alphabetic') {
      const below = ctx.measureText(lead.text).actualBoundingBoxDescent;
      ctx.textBaseline = 'alphabetic';
      yAlpha = y + (below - ctx.measureText(lead.text).actualBoundingBoxDescent);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    runs.forEach((r, i) => {
      use(ctx, role, size, r.face);
      ctx.fillText(r.text, left, yAlpha);
      left += widths[i];
    });
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
  };
  const truncate = (ctx, role, size, text, maxWidth) => {
    const s = String(text == null ? '' : text);
    if (measure(ctx, role, size, s) <= maxWidth) return s;
    // By code point, so an emoji in a name is dropped whole, never halved.
    const chars = Array.from(s);
    while (chars.length > 0 && measure(ctx, role, size, chars.join('') + '…') > maxWidth) chars.pop();
    return chars.join('') + '…';
  };
  const fit = (ctx, role, text, maxWidth, maxSize, minSize) => {
    for (let size = maxSize; size >= minSize; size -= 2) {
      if (measure(ctx, role, size, text) <= maxWidth) return size;
    }
    return minSize;
  };
  // True when this text would print in a kit face, the stock voice's or the
  // club's (for layout decisions that depend on the face's shape, like the
  // name's descender room).
  const inBrand = (role, text) => runsOf(role, text).some((r) => r.face);
  // How far the ink of `text` reaches above and below the origin of a line
  // drawn with a 'top' baseline (or the given one; 'alphabetic' is the line's
  // baseline itself), as a multiple of the size ({ above, below }, `above`
  // positive UP, so an accented capital that rises past the top of the em box
  // is positive and an ordinary word is negative). null unless the whole text
  // prints in ONE kit face: the old Windows faces keep their ink inside the box
  // and were laid out without this. Measured off the canvas at 100 px and
  // scaled (outlines scale exactly), in the face the text prints in, so it is
  // the shipped font's own answer, glyph by glyph: in Paytone One a plain name
  // reaches 0.20 down from the origin, "Émile" is 0.09 above it, "Ștefan"
  // hangs 1.31 below it.
  const inkReach = (ctx, role, text, at = 'top') => {
    const runs = runsOf(role, text);
    if (runs.length !== 1 || !runs[0].face || !runs[0].text) return null;
    const baseline = ctx.textBaseline;
    ctx.textBaseline = at;
    use(ctx, role, 100, runs[0].face);
    const m = ctx.measureText(runs[0].text);
    ctx.textBaseline = baseline;
    // A club face is unhinted (the rasteriser autohints it), and at label
    // sizes its marks print up to 0.045 em past the outline's bounds (measured
    // at 16 to 46 pt, 1-bit), so it is given that room on both sides; the
    // stock shout's numbers are its own, as they always were.
    const pad = runs[0].face.family === stock(role).family ? 0 : CLUB_INK_PAD;
    const above = m.actualBoundingBoxAscent / 100 + pad;
    const below = m.actualBoundingBoxDescent / 100 + pad;
    return Number.isFinite(above) && Number.isFinite(below) ? { above, below } : null;
  };
  // How far to move a line drawn with a 'middle' baseline so that the CAPITAL
  // block sits on the line's centre, as a multiple of the size; 0 unless the
  // text prints in a kit face. The canvas puts 'middle' at the centre of the
  // em box, and a face's capitals are not centred in that: Galindo's stood
  // 0.09 above it, Paytone One's 0.06 below. Capitals, not the string's own
  // ink, so two lines of one label keep one baseline whatever they contain;
  // the lead face's capitals, so each club face is centred on its own.
  const capCentre = (ctx, role, text) => {
    const lead = runsOf(role, text).find((r) => r.face);
    if (!lead) return 0;
    const baseline = ctx.textBaseline;
    ctx.textBaseline = 'middle';
    use(ctx, role, 100, lead.face);
    // A monogram is a few letters alone in a disc, and a club face's capitals
    // are not all capital-sized (Playfair Display's J hangs below the line),
    // so in a club face it centres on its own ink. The stock shout keeps the
    // capitals it was laid out on.
    const own = role === 'monogram' && lead.face.family !== stock(role).family;
    const m = ctx.measureText(own ? lead.text : 'H');
    ctx.textBaseline = baseline;
    const shift = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 200;
    return Number.isFinite(shift) ? shift : 0;
  };
  // The first name's line box in the face `text` prints in: { lift, lineH }
  // as multiples of the size (label-layout.js NAME_LIFT_BRAND), or null when
  // it prints in the old faces or mixes faces (the box is then the size
  // itself, as it always was). The stock shout keeps the constants; a club
  // face is measured once (see nameBoxes).
  const nameBox = (ctx, role, text) => {
    const runs = runsOf(role, text);
    if (runs.length !== 1 || !runs[0].face) return null;
    const face = runs[0].face;
    if (face.family === stock(role).family) {
      return { lift: $labelLayout.NAME_LIFT_BRAND, lineH: $labelLayout.NAME_LINE_H_BRAND };
    }
    const key = `${face.family}|${face.wght || ''}`;
    if (!nameBoxes.has(key)) {
      const baseline = ctx.textBaseline;
      ctx.textBaseline = 'top';
      use(ctx, role, 100, face);
      const capTop = -ctx.measureText('H').actualBoundingBoxAscent / 100;
      const bottom = ctx.measureText('gjpqy').actualBoundingBoxDescent / 100;
      ctx.textBaseline = baseline;
      let box = null;
      if (Number.isFinite(capTop) && Number.isFinite(bottom) && bottom > capTop) {
        const lift = capTop - $labelLayout.NAME_CAP_TOP;
        box = { lift, lineH: bottom - lift + $labelLayout.NAME_BOX_AIR };
      }
      nameBoxes.set(key, box);
    }
    return nameBoxes.get(key) || { lift: $labelLayout.NAME_LIFT_BRAND, lineH: $labelLayout.NAME_LINE_H_BRAND };
  };
  return { measure, fill, truncate, fit, inBrand, inkReach, capCentre, nameBox };
}

// ── Free-text label sizing (POST /print-custom) ──────────────────────────────
// A custom label is ONE line of operator text on an otherwise empty 4x2 label.
// It has no roster row behind it and no fixed vocabulary, so it cannot use the
// name block's ceilings: "VOLUNTEER" wants to be huge and "Wednesday Kitchen
// Team, Room 4" wants to be small, and both have to look deliberate. It is set
// in the name's voice (Paytone One, falling back to bold Helvetica/Arial).
const CUSTOM_TEXT_MAX_CHARS = 60;
const CUSTOM_TEXT_MAX_PT    = 56;
const CUSTOM_TEXT_MIN_PT    = 14;
const CUSTOM_TEXT_LINE_H    = 1.15;
// Clear paper kept between one line's lowest ink and the next line's highest,
// as a multiple of the size, when the kit face's own marks set the line pitch.
const CUSTOM_TEXT_INK_GAP   = 0.06;
const CUSTOM_TEXT_MARGIN_X  = 18;   // comfortable, not flush to the die-cut edge
const CUSTOM_TEXT_MARGIN_Y  = 16;

// Two lines out of one, broken at the space nearest the middle so the halves
// are balanced. A single unbroken token (a long room code) splits by
// character rather than overflowing the label.
function splitCustomTextInTwo(text) {
  const mid = Math.floor(text.length / 2);
  let at = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ' ') continue;
    if (at < 0 || Math.abs(i - mid) < Math.abs(at - mid)) at = i;
  }
  if (at < 0) return [text.slice(0, mid), text.slice(mid)];
  return [text.slice(0, at), text.slice(at + 1)];
}

// The distance between the baselines of a custom label's lines, as a multiple
// of the size. CUSTOM_TEXT_LINE_H is what the old bold sans needs. The kit's
// face draws marks far outside its line: a stacked Vietnamese capital (Ấ, Ế,
// Ắ) rises 1.19-1.22 em above its baseline, more than that pitch, and a dot
// below a vowel (ạ) or the tail of a g or y hangs 0.20-0.27 em under the line
// above it. So when the whole label prints in the kit face the pitch is also
// what the two lines' own ink needs, lowest ink of the line above plus highest
// of the line below plus CUSTOM_TEXT_INK_GAP, never less than the stock pitch.
// Measured off the canvas (inkReach), for the lines as they are set. A label
// in the old faces keeps CUSTOM_TEXT_LINE_H exactly.
function customLineH(ctx, type, lines) {
  let h = CUSTOM_TEXT_LINE_H;
  for (let i = 1; i < lines.length; i++) {
    const upper = type.inkReach(ctx, 'custom', lines[i - 1], 'alphabetic');
    const lower = type.inkReach(ctx, 'custom', lines[i], 'alphabetic');
    if (upper && lower) h = Math.max(h, upper.below + lower.above + CUSTOM_TEXT_INK_GAP);
  }
  return h;
}

// Start large and shrink. Only once the floor is reached does it wrap to two
// lines, because one big line reads across a room and two small ones do not.
// Returns { lines, size, lineH } in points, lineH being the baseline pitch as a
// multiple of the size (see customLineH); the height test uses it, so a pitch
// the marks widen makes the text smaller instead of running lines together.
//
// `type` must have the label's text pinned (labelType('', { custom: text })),
// so both lines, the fit and the clip measure in the one face the whole text
// gets; the default does exactly that.
function fitCustomLabelText(ctx, text, type = labelType('', { custom: text })) {
  const maxW = $labelLayout.PAGE_W - CUSTOM_TEXT_MARGIN_X * 2;
  const maxH = $labelLayout.PAGE_H - CUSTOM_TEXT_MARGIN_Y * 2;
  const fits = (lines, size, lineH) => {
    if (lines.length * size * lineH > maxH) return false;
    return lines.every((l) => type.measure(ctx, 'custom', size, l) <= maxW);
  };
  for (let size = CUSTOM_TEXT_MAX_PT; size >= CUSTOM_TEXT_MIN_PT; size--) {
    if (fits([text], size, CUSTOM_TEXT_LINE_H)) return { lines: [text], size, lineH: CUSTOM_TEXT_LINE_H };
  }
  const two = splitCustomTextInTwo(text);
  const twoH = customLineH(ctx, type, two);
  for (let size = CUSTOM_TEXT_MAX_PT; size >= CUSTOM_TEXT_MIN_PT; size--) {
    if (fits(two, size, twoH)) return { lines: two, size, lineH: twoH };
  }
  // Pathological input (60 characters with no space in them). Clip rather than
  // bleed off the die-cut edge: a label that runs off the paper is unreadable,
  // an ellipsis is merely shortened.
  const clipped = two.map((l) => type.truncate(ctx, 'custom', CUSTOM_TEXT_MIN_PT, l, maxW));
  return { lines: clipped, size: CUSTOM_TEXT_MIN_PT, lineH: customLineH(ctx, type, clipped) };
}

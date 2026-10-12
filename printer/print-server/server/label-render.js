'use strict';
// Drawing a label as a PNG, the thermal club mark.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const brand = require('../brand');
const crypto = require('crypto');
const fs    = require('fs');
const $labelLayout = lazy('./label-layout');
const $eligibility = lazy('./eligibility');
const $images = lazy('./images');
const $labelType = lazy('./label-type');

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  generateLabel: { enumerable: true, get: () => generateLabel },
  prepareLogoForThermal: { enumerable: true, get: () => prepareLogoForThermal },
  PX_H: { enumerable: true, get: () => PX_H },
  PX_W: { enumerable: true, get: () => PX_W },
  SCALE: { enumerable: true, get: () => SCALE },
  thermalClubMark: { enumerable: true, get: () => thermalClubMark },
});

// ── Draw a rounded rectangle on canvas ───────────────────────────────────────
function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ── Generate the label as a PNG ──────────────────────────────────────────────
// Returns the path to a temporary PNG file (caller must delete it).
const DPI = 300;
const PX_W = Math.round(4 * DPI);  // 1200 px
const PX_H = Math.round(2 * DPI);  // 600 px
const SCALE = DPI / 72;            // convert pt → px

// ── Prepare a club logo for 1-bit thermal output ──────────────────────────────
// A thermal printer has exactly two tones, so the driver dithers everything
// else — and dithering destroys light colors. The real failure that motivated
// this: one church's Puggles club image on TwoTimTwo is a custom upload, a
// light-cyan wordmark. Drawn as-is, the cyan dithered to (almost) nothing and
// the printed label showed only the duckling's dark eyes and beak — a tiny
// unreadable speck floating in the icon zone.
//
// So logos are converted to what the printer can actually say:
//
//   * INK   = a pixel that is opaque enough AND far enough from white. The
//     distance test is per-channel (Chebyshev), so light-but-saturated colors
//     — cyan, yellow, pink — count as ink even though their gray luminance is
//     high. That is the whole point: luminance is exactly the measure the
//     dither uses to erase them. The threshold sits at 64 so a pale wash
//     (#d0d0d0 card backgrounds and lighter) reads as PAPER, not ink — at 40
//     a pale-gray card came back as a featureless black slab that swallowed
//     the artwork inside it.
//   * Ink renders as ONE solid color. Where the source's antialiasing lives in
//     the ALPHA channel (transparent-background PNG, the extension's capture
//     format) the edge alpha is preserved and edges stay smooth like text;
//     where the source is opaque (JPEG, PNG flattened on white) the edge is
//     hard-thresholded, which is what the 1-bit printer would do to it anyway.
//     The color follows the label's palette: black on a normal label, WHITE on
//     an inverted one — the inverted icon panel is near-black, and near-black
//     prints as black, so black ink there is an invisible logo. (Both review
//     lenses caught exactly that on the first-timer label.)
//   * The result is CROPPED to the ink's bounding box, so an asset with big
//     transparent or white margins scales by its artwork, not its canvas.
//
// White-on-dark logos survive: the dark field is ink, the white lettering
// stays white. A logo with NO ink at all (all-white, all-transparent, or
// undecodable) returns null and the caller falls back to the club mark (and
// past that the monogram badge) — the icon zone never silently disappears.
// The kit's official club marks go through this same converter.
//
// POST /label (the extension's Print Dialog mode) is the surface that shows
// this output before paper. GET /preview takes no image parameter, so the
// dashboard preview always renders the club mark.
const LOGO_INK_ALPHA = 64;        // out of 255 — below this a pixel is "air"
const LOGO_INK_WHITE_DIST = 64;   // max(255-r,255-g,255-b) at or above this is ink
const LOGO_MAX_DECODE_SIDE = 2048; // bound on the scan canvas (see sniff below for decode)

// PNG dimensions live in the IHDR chunk at a fixed offset, readable without
// decoding a single pixel. loadImage() decodes at natural size, and PNG
// compresses flat color at extreme ratios — a small buffer can decode to a
// bitmap large enough to hurt, and this runs on the check-in path. Non-PNG
// formats skip the sniff (JPEG can't reach PNG's compression ratios and the
// buffer itself is already size-capped upstream); the scan canvas below is
// bounded regardless.
function pngDimensions(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;   // not PNG magic
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
const LOGO_MAX_SOURCE_SIDE = 8192;  // refuse to DECODE anything bigger

// Prepared once per logo and ink. A club's logo is the same bytes on every
// label of the night (and the kit's marks never change), yet each print
// decoded it, scanned it and cropped it again. Keyed by the bytes' hash, not
// the buffer, because every request arrives with its own Buffer; the result
// is only ever read (drawImage), so one shared canvas is safe.
const LOGO_PREP_MAX = 24;
const logoPrepCache = new Map();   // sha256(bytes) + ink → prepared logo (or null)
async function prepareLogoForThermal(clubImageBuffer, { ink = [0, 0, 0] } = {}) {
  if (!clubImageBuffer) return null;
  const key = `${crypto.createHash('sha256').update(clubImageBuffer).digest('hex')}:${ink.join(',')}`;
  if (logoPrepCache.has(key)) return logoPrepCache.get(key);
  const prepared = await prepareLogoForThermalNow(clubImageBuffer, { ink });
  if (logoPrepCache.size >= LOGO_PREP_MAX) logoPrepCache.delete(logoPrepCache.keys().next().value);
  logoPrepCache.set(key, prepared);
  return prepared;
}
async function prepareLogoForThermalNow(clubImageBuffer, { ink = [0, 0, 0] } = {}) {
  if (!clubImageBuffer) return null;
  const sniffed = Buffer.isBuffer(clubImageBuffer) ? pngDimensions(clubImageBuffer) : null;
  if (sniffed && Math.max(sniffed.width, sniffed.height) > LOGO_MAX_SOURCE_SIDE) {
    console.log(`[icon] Club image claims ${sniffed.width}x${sniffed.height}px — refusing to decode it`);
    return null;
  }
  let img;
  try {
    img = await loadImage(clubImageBuffer);
  } catch {
    return null;                   // undecodable — caller falls back to monogram
  }
  if (!img.width || !img.height) return null;

  // Scan at a bounded size regardless of what decoded. Downscaling before the
  // scan costs nothing visually — the icon zone is ~317 device px.
  const scanScale = Math.min(1, LOGO_MAX_DECODE_SIDE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scanScale));
  const h = Math.max(1, Math.round(img.height * scanScale));
  const scan = createCanvas(w, h);
  const sctx = scan.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(img, 0, 0, w, h);

  const data = sctx.getImageData(0, 0, w, h);
  const px = data.data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let yPix = 0; yPix < h; yPix++) {
    for (let xPix = 0; xPix < w; xPix++) {
      const i = (yPix * w + xPix) * 4;
      const a = px[i + 3];
      const whiteDist = Math.max(255 - px[i], 255 - px[i + 1], 255 - px[i + 2]);
      if (a >= LOGO_INK_ALPHA && whiteDist >= LOGO_INK_WHITE_DIST) {
        // Ink: one solid color, original alpha (keeps antialiased edges smooth).
        px[i] = ink[0]; px[i + 1] = ink[1]; px[i + 2] = ink[2];
        if (xPix < minX) minX = xPix;
        if (xPix > maxX) maxX = xPix;
        if (yPix < minY) minY = yPix;
        if (yPix > maxY) maxY = yPix;
      } else {
        px[i + 3] = 0;             // air: fully transparent
      }
    }
  }
  if (maxX < 0) return null;       // no ink anywhere — monogram is the better label

  sctx.putImageData(data, 0, 0);

  // Crop to the ink plus a 1px breath so an antialiased edge is never shaved.
  const cx = Math.max(0, minX - 1);
  const cy = Math.max(0, minY - 1);
  const cw = Math.min(w, maxX + 2) - cx;
  const ch = Math.min(h, maxY + 2) - cy;
  const out = createCanvas(cw, ch);
  out.getContext('2d').drawImage(scan, cx, cy, cw, ch, 0, 0, cw, ch);
  // width/height are scan-space (what the canvas holds); sourceWidth/Height
  // undo the scan downscale so the caller's too-small gate measures the
  // artwork's TRUE resolution — otherwise identical artwork passed or failed
  // depending on how much empty canvas happened to surround it.
  return {
    canvas: out, width: cw, height: ch,
    sourceWidth: Math.round(cw / scanScale), sourceHeight: Math.round(ch / scanScale),
  };
}

// The official club mark, rasterised and put through the thermal converter
// once per club and ink colour, then reused: the result is deterministic, and
// decoding the SVG and scanning it costs ~30 ms a label on a fast PC. Dropped
// whenever the brand kit reloads. null when the club has no mark or it would
// not draw (reported to the kit, so /health says so) — the caller then falls
// back to the monogram.
const thermalMarkCache = new Map();   // `${key}|${white}` -> prepared raster
let thermalMarkCacheGen = -1;
async function thermalClubMark(key, inkWhite) {
  if (thermalMarkCacheGen !== brand.kitGeneration()) {
    thermalMarkCache.clear();
    thermalMarkCacheGen = brand.kitGeneration();
  }
  const cacheKey = `${key}|${inkWhite ? 'white' : 'black'}`;
  if (thermalMarkCache.has(cacheKey)) return thermalMarkCache.get(cacheKey);
  const svg = brand.clubMarkSvg(key);
  if (!svg) return null;
  const gen = brand.kitGeneration();
  const mark = await prepareLogoForThermal(svg, { ink: inkWhite ? [255, 255, 255] : [0, 0, 0] });
  if (!mark) {
    brand.markFailed(key, 'decoded to no printable ink');
    return null;
  }
  // Only cache what was made from the kit that is still loaded.
  if (gen === brand.kitGeneration()) thermalMarkCache.set(cacheKey, mark);
  return mark;
}

// Render one 4x2in label to a PNG.
//
// ONE OPTIONS OBJECT, not fourteen positional parameters. The old signature was
// `generateLabel(firstName, lastName, clubName, clubImageBuffer, allergyTokens,
// handbookGroup, isBirthday, isVisitor, stepUp, stepUpNextClub, awanaShares,
// noPhoto, testBanner, extras)`, and reading a call site meant counting commas
// to find out whether the seventh `false` was isBirthday or stepUp. Two of the
// callers had already drifted: /reprint silently passed nothing for visitor,
// stepUp, awanaShares, goToLine and milestoneLine because history never stored
// them, and the connect card used to smuggle its greeting through
// `handbookGroup`, silently inheriting that field's 30-character truncation —
// fixed since by the first-class `greeting` field below.
//
// The conversion is byte-identical by construction — every default below
// matches the old parameter default — and the 18 golden-image baselines are the
// proof. They compare pixels, so a mis-mapped argument would show up as a diff
// rather than as a plausible-looking label.
//
// @param {object} input
async function generateLabel(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    // Loud rather than mysterious: a leftover positional caller would otherwise
    // render a label with a first name and nothing else, which prints and looks
    // almost right — the worst possible failure for a safety artifact.
    throw new TypeError('generateLabel() takes a single options object');
  }
  let {
    firstName, lastName, clubName, clubImageBuffer,
    allergyTokens = [], handbookGroup = '', isBirthday = false, birthdayAge = null,
    isVisitor = false,
    stepUp = false, stepUpNextClub = '', awanaShares = null, noPhoto = false,
    testBanner = false, footerText = '', greeting = '', template = null,
    streakCount = null, isNewKid = false, middleInitial = '', nameHint = '',
    extras = {}, isLeader = false,
    customText = '',
  } = input;
  // (`season` and `collectibleIndex` were inputs until the 2026-27 rebrand took
  // the seasonal motif and the collectible icon off the label. A stale caller
  // that still passes them is simply not read.)
  // Coerce the text inputs before anything calls .trim() on them. A client
  // that posts `clubName: null` (explicit null defeats the default parameter)
  // would otherwise throw deep inside layout and turn a printable label into
  // a 500 + recorded print failure.
  firstName     = String(firstName == null ? '' : firstName);
  lastName      = String(lastName  == null ? '' : lastName);
  clubName      = String(clubName  == null ? '' : clubName);
  allergyTokens = Array.isArray(allergyTokens) ? allergyTokens : [];
  handbookGroup = (handbookGroup || '').trim();
  footerText    = String(footerText == null ? '' : footerText).trim();
  // First-class greeting slot (connect cards). It renders on the same line the
  // handbook group uses, but is NOT subject to that field's 30-character cap —
  // the cap exists because a group name past 30 chars is roster noise, whereas
  // a greeting is deliberate operator copy that just needs to fit the width.
  greeting      = String(greeting == null ? '' : greeting).trim();
  // Free-text label: coerced here like every other text input, so an explicit
  // null or a number can never reach the layout maths below.
  customText    = String(customText == null ? '' : customText).trim();
  // Per-club template (#1): a constrained set of layout switches, resolved by
  // the CALLER (labelTemplateFor) and passed in — the renderer never reads
  // config. Every switch defaults to "on" and the name ceiling to 48, so a
  // missing, partial, or malformed template renders byte-identically to no
  // template at all: a broken saved template degrades to the stock label,
  // it never blocks a child's print.
  const tpl = (template && typeof template === 'object' && !Array.isArray(template)) ? template : {};
  const tplOn = (key) => tpl[key] !== false;
  const tplNameMax = (() => {
    const n = Math.round(Number(tpl.nameMaxPt));
    return (Number.isFinite(n) && n >= 18 && n <= 48) ? n : 48;
  })();
  isBirthday    = !!isBirthday;
  stepUp        = !!stepUp;
  noPhoto       = !!noPhoto;
  isLeader      = !!isLeader;
  // null / undefined / non-finite → no badge. Negative numbers are coerced
  // to nothing as well so a malformed payload doesn't print "🪙 -3".
  if (awanaShares !== null && awanaShares !== undefined) {
    const n = Number(awanaShares);
    awanaShares = (Number.isFinite(n) && n >= 0) ? Math.floor(n) : null;
  }
  // Birthday age (#291): the age a kid turns this week, printed beside the
  // cake. Same coercion discipline as awanaShares — a malformed birth year
  // must never print "Turning NaN". 1–21 is the plausible club range; anything
  // else (0, negative, 22+, a string, Infinity, an object) degrades to no line
  // at all, i.e. to exactly today's plain cake.
  if (birthdayAge !== null && birthdayAge !== undefined) {
    const n = Number(birthdayAge);
    birthdayAge = (Number.isFinite(n) && n >= 1 && n <= 21) ? Math.floor(n) : null;
  }
  // Streak flame (#14): same coercion discipline as awanaShares — a malformed
  // value must never print "🔥 NaN".
  if (streakCount !== null && streakCount !== undefined) {
    const n = Number(streakCount);
    streakCount = (Number.isFinite(n) && n >= 0) ? Math.floor(n) : null;
  }
  isNewKid = !!isNewKid;
  // Twin-safe fields (#13): a single initial and one short hint line, bounded
  // here so a malformed caller can't reshape the name block.
  middleInitial = String(middleInitial == null ? '' : middleInitial).trim().slice(0, 1).toUpperCase();
  nameHint      = String(nameHint == null ? '' : nameHint).trim().slice(0, 16);

  // Step-up labels are inverted (black bg, light text) and replace the
  // handbook-group line with "Stepping up to <next club>" so volunteers
  // and parents can spot graduating kids at a glance. First-timer labels
  // can borrow the same inverted palette (extras.inverted) so a visitor
  // pops out of a stack of white labels — palette only, the icon panel
  // and text lines keep their normal behavior.
  // Both palettes are thermal-first: a 1-bit printer collapses everything to
  // black or white, so every tone here is either near-black or near-white —
  // no mid-grays that would dither into speckle.
  const COLOR = (stepUp || (extras && extras.inverted)) ? {
    bg: '#000000',
    name: '#ffffff',
    last: '#e5e7eb',
    club: '#cbd5e1',
    group: '#fbbf24',                // amber draws the eye on black
    sep: '#e5e7eb',
    iconBg: '#1f2937',
    iconDivider: '#3f3f46',
    iconPlaceholder: '#d4d4d8',
    visitorBg: '#ffffff',
    visitorText: '#000000'
  } : {
    bg: '#ffffff',
    name: '#000000',
    last: '#111111',
    club: '#000000',
    group: '#333333',
    sep: '#333333',
    iconBg: '#f4f4f4',
    iconDivider: '#bbbbbb',
    iconPlaceholder: '#888888',
    visitorBg: '#000000',
    visitorText: '#ffffff'
  };

  const pngPath = $images.tmpFilePath('awana', 'png');

  // ── Free-text label (POST /print-custom) ──────────────────────────────────
  // One auto-sized line of operator text, centered, black on white, and
  // NOTHING else: no badge outline, no icon panel, no club line, no greeting,
  // no footer, no safety icons, no wordmark. A custom label has no child
  // behind it, so anything that looks like a check-in label would be a lie on
  // a safety artifact.
  //
  // It returns BEFORE all the layout below rather than switching a dozen
  // elements off one at a time, so an element added to the stock label later
  // is absent here automatically, with nothing to remember.
  //
  // No TEST band either, even in rehearsal: the band means "this is not a real
  // check-in", and a custom label never was one in any mode.
  if (customText) {
    const cvs = createCanvas(PX_W, PX_H);
    const cctx = cvs.getContext('2d');
    cctx.scale(SCALE, SCALE);
    cctx.fillStyle = '#ffffff';
    cctx.fillRect(0, 0, $labelLayout.PAGE_W, $labelLayout.PAGE_H);
    // Pinned to the WHOLE text: one face for every line, decided before the
    // text is wrapped (see labelType).
    const customType = $labelType.labelType('', { custom: customText });
    const layout = $labelType.fitCustomLabelText(cctx, customText, customType);
    cctx.fillStyle = '#000000';
    cctx.textAlign = 'center';
    cctx.textBaseline = 'middle';
    const lineH = layout.size * layout.lineH;
    // 'middle' is the centre of the em box, not of the capitals; the kit face
    // is moved so the capitals sit on the label's centre (see capCentre).
    const capShift = customType.capCentre(cctx, 'custom', customText) * layout.size;
    const firstY = $labelLayout.PAGE_H / 2 - ((layout.lines.length - 1) * lineH) / 2 + capShift;
    layout.lines.forEach((line, i) =>
      customType.fill(cctx, 'custom', layout.size, line, $labelLayout.PAGE_W / 2, firstY + i * lineH));
    const customBuffer = cvs.toBuffer('image/png');
    fs.writeFileSync(pngPath, customBuffer);
    return { pngPath, buffer: customBuffer };
  }

  const canvas = createCanvas(PX_W, PX_H);
  const ctx = canvas.getContext('2d');
  // The kit's voices for this label, each with the club's old font behind it.
  const type = $labelType.labelType(clubName);

  // Scale all drawing from points to pixels
  ctx.scale(SCALE, SCALE);

  // Background
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, $labelLayout.PAGE_W, $labelLayout.PAGE_H);

  // On step-up labels, drop the club icon entirely — the kid is leaving
  // that club, and the wider text area makes the message more obvious.
  // Otherwise the icon panel exists for any recognized club: it shows the
  // real TwoTimTwo club logo when the client supplied one, the official
  // one-colour club mark from the brand kit when it did not (or the logo was
  // unusable), and the letter monogram as the last resort, so the icon zone
  // never silently disappears.
  const hasLogo     = !stepUp && !!clubImageBuffer && tplOn('showIconPanel');
  const hasEmblem   = !stepUp && !hasLogo && !!$images.CLUB_MONOGRAM[$eligibility.clubKey(clubName)] && tplOn('showIconPanel');
  const hasIcon     = hasLogo || hasEmblem;
  // A no-photo label's content stops short of its edge bar: `bw` is the
  // badge's width for everything drawn on it (the outline and the icon
  // panel's clip keep the full BW; the bar covers that end of them).
  const barCut  = noPhoto ? $labelLayout.NO_PHOTO_CUT : 0;
  const bw      = $labelLayout.BW - barCut;
  const textX   = hasIcon ? $labelLayout.TEXT_X : $labelLayout.BX + 10;
  const textW   = hasIcon ? $labelLayout.TEXT_W - barCut : bw - 20;

  // ── Badge border (no outline) ─────────────────────────────────────────────
  roundedRect(ctx, $labelLayout.BX, $labelLayout.BY, $labelLayout.BW, $labelLayout.BH, $labelLayout.CORNER);

  // ── Left icon panel ───────────────────────────────────────────────────────
  // Tracked OUTSIDE the panel block: the text area below prints the club name
  // only when neither a real logo nor the official mark made it onto the
  // label, and a supplied-but-rejected logo (too small, undecodable) must count
  // as "no logo" there too.
  let logoDrawn = false;
  let markDrawn = false;
  if (hasIcon) {
    // The column's right edge is the catalog's wave, not a ruled line: filled
    // in the panel tone, and traced once more in the old divider's hairline so
    // the edge still exists on paper (the pale fill all but vanishes on a
    // thermal head).
    ctx.save();
    roundedRect(ctx, $labelLayout.BX, $labelLayout.BY, $labelLayout.BW, $labelLayout.BH, $labelLayout.CORNER);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo($labelLayout.BX, $labelLayout.BY);
    $labelLayout.traceIconWave(ctx, $labelLayout.BY, $labelLayout.BH, false);
    ctx.lineTo($labelLayout.BX, $labelLayout.BY + $labelLayout.BH);
    ctx.closePath();
    ctx.fillStyle = COLOR.iconBg;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect($labelLayout.BX, $labelLayout.BY + 12, $labelLayout.ICON_COL_W + $labelLayout.ICON_WAVE_MAX_DX + 2, $labelLayout.BH - 24);
    ctx.clip();
    ctx.beginPath();
    $labelLayout.traceIconWave(ctx, $labelLayout.BY, $labelLayout.BH, true);
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = COLOR.iconDivider;
    ctx.stroke();
    ctx.restore();

    // Club icon image (76×76 pt max, centred in the icon zone)
    const iconSize = 76;
    const iconX = $labelLayout.BX + ($labelLayout.ICON_COL_W - iconSize) / 2;
    const iconY = $labelLayout.BY + ($labelLayout.BH - iconSize) / 2;
    // Ink follows the palette: on an inverted label the icon panel prints
    // black, so the art must be white there or it vanishes into its own
    // background.
    const inkWhite = Boolean(extras && extras.inverted);
    const ink = inkWhite ? [255, 255, 255] : [0, 0, 0];
    // Preserve aspect ratio within the 76pt square. Post-crop this is the
    // aspect of the ARTWORK — a wordmark on a padded square canvas used to fit
    // by its padding and shrink the art; now it fits by the art itself.
    const drawArt = (art) => {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const aspect = art.width / art.height;
      let drawW = iconSize, drawH = iconSize;
      if (aspect > 1) { drawH = iconSize / aspect; }
      else { drawW = iconSize * aspect; }
      const dx = iconX + (iconSize - drawW) / 2;
      const dy = iconY + (iconSize - drawH) / 2;
      ctx.drawImage(art.canvas, dx, dy, drawW, drawH);
    };
    if (hasLogo) {
      // Crop to the artwork and binarize for thermal — see
      // prepareLogoForThermal. A null result (undecodable, or no ink at all)
      // falls through to the official mark below.
      const logo = await prepareLogoForThermal(clubImageBuffer, { ink });
      if (logo) {
        // The icon zone is 76pt ≈ 317 device px at 300 DPI. A logo whose
        // ARTWORK (post-crop — a small graphic on a big padded canvas no
        // longer gets credit for the padding) is much smaller than that
        // (the pre-5.5 extension captured club images at 64×64) would be
        // upscaled 4–5×, and the thermal printer then dithers the blurry
        // antialiased edges into speckle — the printed result is
        // recognisably worse than no logo at all. Below half the target
        // resolution, the vector mark (or the solid-ink monogram) is the
        // better label: skip the image and fall through to it.
        const targetPx = iconSize * SCALE;
        if (Math.max(logo.sourceWidth, logo.sourceHeight) >= targetPx / 2) {
          drawArt(logo);
          logoDrawn = true;
        } else {
          console.log(`[icon] Club artwork is ${logo.sourceWidth}x${logo.sourceHeight}px after cropping — too small for a ${Math.round(targetPx)}px icon zone, using the club mark instead`);
        }
      }
    }
    if (!logoDrawn) {
      // The official one-colour club mark (brand kit, logos/*-black.svg):
      // vector, so it rasterises crisply at icon size, and put through the
      // SAME thermal converter as a downloaded logo (cropped to its ink, one
      // solid ink colour, re-inked white on an inverted label). Fails open: a
      // missing or undecodable mark falls through to the monogram.
      const key = $eligibility.clubKey(clubName);
      const mark = await thermalClubMark(key, inkWhite);
      if (mark) {
        drawArt(mark);
        markDrawn = true;
      }
    }
    if (!logoDrawn && !markDrawn) {
      // Monogram badge, the last resort: solid disc + club initials in the
      // shout voice. Solid ink stays crisp on thermal output where a
      // grayscale logo placeholder would just dither away.
      const monogram = $images.CLUB_MONOGRAM[$eligibility.clubKey(clubName)] || '?';
      const cx = $labelLayout.BX + $labelLayout.ICON_COL_W / 2;
      const cy = $labelLayout.BY + $labelLayout.BH / 2;
      const radius = 28;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = COLOR.name;
      ctx.fill();
      const mSize = type.fit(ctx, 'monogram', monogram, radius * 1.5, 30, 12);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = COLOR.bg;
      // The kit face is centred on its capitals; the old face keeps the
      // 1 pt nudge it always had.
      const mCentre = type.inBrand('monogram', monogram)
        ? cy + type.capCentre(ctx, 'monogram', monogram) * mSize
        : cy + 1;
      type.fill(ctx, 'monogram', mSize, monogram, cx, mCentre);
      ctx.textBaseline = 'top';  // restore default used by the text area
    }
  }

  // ── Text area ─────────────────────────────────────────────────────────────
  // On step-up labels, the handbook group line is replaced with the
  // "Stepping up to <next club>" callout — always show that line.
  const stepUpGroupText = stepUp ? ('Stepping up to ' + (stepUpNextClub || 'next club')) : '';
  const hasLast  = lastName.trim().length > 0 && tplOn('showLastName');
  // A real logo or the official mark self-identifies the club, so the text
  // line is redundant; a monogram badge is only initials, so keep the club
  // name printed too. logoDrawn/markDrawn, not hasLogo: a supplied logo that
  // was rejected (too small to print cleanly, failed to decode) fell back to
  // the mark, or to the monogram, and the label must then carry the club name
  // in text like any other monogram label.
  const hasClub  = clubName.trim().length > 0 && !logoDrawn && !markDrawn && tplOn('showClubLine');
  // The step-up callout and a connect-card greeting always show — a template
  // only suppresses the roster-derived handbook-group line.
  const hasGroup = stepUp ? !!stepUpGroupText
    : (greeting.length > 0 || (handbookGroup.length > 0 && tplOn('showGroupLine')));
  const hasAllergy = allergyTokens.length > 0;
  // The trophy band (#293) takes the footer's slot rather than adding a fourth
  // bottom-left line: the stack tops out at three before it crowds the name
  // block, and the operator footer is branding while the band is the news.
  const hasFooter = footerText.length > 0 && tplOn('showFooter') && !(extras && extras.trophyBand);

  // Reserve room for the bottom band: right side is the coin/cake/allergy icon
  // row, left side is the goTo/milestone/footer stack. 20pt covers the icon row
  // or one text line; each additional bottom-left line stacks 13pt higher. The
  // goTo/milestone lines used to skip this reservation as "rare and short", but
  // the moment two bottom lines coexist (a connect card's schedule line over a
  // footer) the centered block sat right on top of them.
  const hasIconRowGlyphs = hasAllergy || isBirthday || awanaShares != null || noPhoto || streakCount != null || isNewKid;
  const bottomLineCount = ((extras && extras.trophyBand) ? 1 : 0)
    + ((extras && extras.goToLine) ? 1 : 0)
    + ((extras && extras.milestoneLine) ? 1 : 0)
    + (hasFooter ? 1 : 0);
  const ALLERGY_STRIP_H = Math.max(
    hasIconRowGlyphs ? 20 : 0,
    bottomLineCount > 0 ? 7 + bottomLineCount * 13 : 0
  );

  // Birthday age line (#291): a few words beside the cake, so the icon becomes
  // a conversation instead of a silent glyph. Gated on isBirthday a SECOND time
  // here — the age is an annotation ON the cake, never a standalone line, so a
  // caller passing birthdayAge with isBirthday:false renders byte-identically
  // to no age at all.
  const AGE_TEXT_SIZE = 10;
  const ageFull  = (isBirthday && birthdayAge != null) ? `Turning ${birthdayAge} this week!` : '';
  const ageShort = ageFull ? `Turning ${birthdayAge}!` : '';
  // How much of the bottom band the right-anchored icon row may occupy before
  // it would run into the icon panel (or the badge's left padding when there
  // is none). 178pt with a panel present.
  const ICON_ROW_MAX_W = ($labelLayout.BX + bw - 6) - (hasIcon ? $labelLayout.TEXT_X : $labelLayout.BX + 8);

  // Twin-safe (#13): the middle initial rides the first-name line so the
  // width fit below accounts for it; the birth-month hint is its own small
  // line under the last name.
  const displayFirst = middleInitial ? `${firstName} ${middleInitial}.` : firstName;
  const hasHint = nameHint.length > 0;

  // Font sizes (in pt)
  const NAME_FLOOR_PT = 18;
  let fs1 = type.fit(ctx, 'name', displayFirst, textW, tplNameMax, NAME_FLOOR_PT);
  const fs2 = 20;
  const fs3 = 12;
  const fs4 = 10;
  const fs5 = 9;
  const GAP = 4;
  const SEP = 9;
  // The first name's box, as multiples of its size. The old Windows faces keep
  // their descenders inside the em box, so the box was the size itself (1.0)
  // and the line was drawn at its top. The kit's face is drawn NAME_LIFT_BRAND
  // above the top of its box (see the constants) and has a box of its own.
  // Beyond that, the name's own ink is measured, so a glyph that reaches past
  // the box makes room instead of being clipped by the paper's edge above or
  // printed over the last name below: an accented capital (É, Ấ) rises past
  // the top, and the comma of Ș and Ț, or a cedilla or ogonek, hangs past the
  // bottom. An ordinary name reaches neither, so those two are 0 and the
  // layout is the same for every plain name.
  const nameBrand = type.inBrand('name', displayFirst);
  const nameLineH = nameBrand ? $labelLayout.NAME_LINE_H_BRAND : 1;
  const nameLift = nameBrand ? $labelLayout.NAME_LIFT_BRAND : 0;
  const reach = nameBrand ? type.inkReach(ctx, 'name', displayFirst) : null;
  const nameRoomAbove = reach ? Math.max(0, nameLift + reach.above) : 0;
  const nameRoomBelow = reach ? Math.max(0, reach.below - nameLift - nameLineH) : 0;
  // The box the block is built from is the line and the room below it. The room
  // ABOVE is not part of it: the paper above the block gives some of it for
  // free, and only what it cannot give is charged to the block (accentCharge).
  const nameBoxH = nameLineH + nameRoomBelow;
  // Block tops never go above BY + 2, and the ink may rise to NAME_INK_TOP, so
  // that much of a rising mark's room is already there.
  const ACCENT_FREE = $labelLayout.BY + 2 - $labelLayout.NAME_INK_TOP;
  const accentCharge = (size) => Math.max(0, nameRoomAbove * size - ACCENT_FREE);

  let blockH = fs1 * nameBoxH;
  if (hasLast)     blockH += GAP + fs2;
  if (hasHint)     blockH += 2 + fs5;
  if (hasClub)     blockH += SEP + fs3;
  if (hasGroup)    blockH += GAP + fs4;
  // Birthday no longer consumes vertical space in the centered text block —
  // it renders as a 🍰 emoji in the bottom-right corner alongside allergies.

  const usableH = $labelLayout.BH - ALLERGY_STRIP_H;
  // Height-fit: a crowded label (name + last + club + group over a stacked
  // bottom band) shrinks the FIRST NAME rather than descending into the band —
  // blockH is linear in fs1 (slope nameBoxH), so the overflow maps straight
  // onto the size reduction. Floor of 18 matches the width fit's floor; past
  // that, the clamp on y below keeps the block on the badge and any residual
  // crowding lands at the bottom, where it degrades legibility instead of
  // clipping the name.
  //
  // A rising mark's room is charged to the block only beyond what the paper
  // above gives free (accentCharge), so the block is piecewise linear in fs1:
  // the room costs nameRoomAbove per pt of size while it is charged and
  // nothing once it fits in the free margin. An ordinary name has no room
  // above, no charge, and the fit is exactly the one it always was.
  // How much smaller the name must be for the block, and the charge, to fit in
  // `room`.
  const reduceFor = (room) => {
    const over = blockH + accentCharge(fs1) - room;
    if (!(over > 0)) return 0;
    const charged = nameRoomAbove * fs1 > ACCENT_FREE;
    const reduce = over / (nameBoxH + (charged ? nameRoomAbove : 0));
    // Shrinking far enough to bring the mark inside the free margin drops the
    // charge before the overflow is gone: from there on the slope is the box's
    // alone, so it is worked out without the charge.
    return charged && nameRoomAbove * (fs1 - reduce) < ACCENT_FREE
      ? (blockH - room) / nameBoxH
      : reduce;
  };
  {
    const reduce = Math.min(reduceFor(usableH), fs1 - NAME_FLOOR_PT);
    if (reduce > 0) { fs1 -= reduce; blockH -= reduce * nameBoxH; }
  }
  // ...and past the floor, room the name asks for must not make the crowding
  // at the bottom worse than an ordinary name's already is. An ordinary name
  // sits on the floor and leaves what it leaves; a name with a mark above or a
  // comma below asks for more, and the extra used to land on the bottom band
  // (a step-up callout printed over the trophy chip). So it gives that much
  // back in size instead, a few pt under the floor at most.
  if (nameRoomAbove > 0 || nameRoomBelow > 0) {
    const rest = blockH - fs1 * nameBoxH;
    const ordinaryLeftover = Math.max(0, NAME_FLOOR_PT * nameLineH + rest - usableH);
    const more = Math.min(reduceFor(usableH + ordinaryLeftover), $labelLayout.NAME_ROOM_SHRINK_MAX);
    if (more > 0) { fs1 -= more; blockH -= more * nameBoxH; }
  }

  const centerY = $labelLayout.BY + usableH / 2;
  // The top of the first name's line box. The block is centred as if its whole
  // room above were part of it (so a label with space to spare is laid out as
  // it always was) but never higher than the charge allows: the ink of a rising
  // mark stays NAME_INK_TOP or more from the paper's top edge.
  const roomAbovePt = nameRoomAbove * fs1;
  let y = Math.max($labelLayout.BY + 2 + accentCharge(fs1), centerY - blockH / 2 + roomAbovePt / 2);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const textCenterX = textX + textW / 2;

  // ── First name ────────────────────────────────────────────────────────────
  const safeFirst = type.truncate(ctx, 'name', fs1, displayFirst, textW);
  ctx.fillStyle = COLOR.name;
  type.fill(ctx, 'name', fs1, safeFirst, textCenterX, y - nameLift * fs1);
  y += fs1 * nameBoxH;

  // ── Last name ─────────────────────────────────────────────────────────────
  if (hasLast) {
    y += GAP;
    const safeLast = type.truncate(ctx, 'last', fs2, lastName, textW);
    ctx.fillStyle = COLOR.last;
    type.fill(ctx, 'last', fs2, safeLast, textCenterX, y);
    y += fs2;
  }

  // ── Twin hint (#13) ───────────────────────────────────────────────────────
  // A whisper under the name — "b. Mar" — only present when two active roster
  // kids share this exact name and no middle initial could split them.
  if (hasHint) {
    y += 2;
    ctx.fillStyle = COLOR.club;
    type.fill(ctx, 'hint', fs5, type.truncate(ctx, 'hint', fs5, nameHint, textW), textCenterX, y);
    y += fs5;
  }

  // ── Club name with separator ──────────────────────────────────────────────
  if (hasClub) {
    y += 4;
    // Solid 1pt rule — gradients dither to noise on thermal output
    const sepMargin = textW * 0.1;
    ctx.beginPath();
    ctx.moveTo(textX + sepMargin, y + 0.5);
    ctx.lineTo(textX + textW - sepMargin, y + 0.5);
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLOR.sep;
    ctx.stroke();
    y += 5;
    const safeClub = type.truncate(ctx, 'club', fs3, clubName, textW);
    ctx.fillStyle = COLOR.club;
    type.fill(ctx, 'club', fs3, safeClub, textCenterX, y);
    y += fs3;
  }

  // ── Handbook group / step-up callout ──────────────────────────────────────
  if (hasGroup) {
    y += GAP;
    let groupStr = stepUp
      ? stepUpGroupText
      : greeting
        ? greeting   // width-fitted by type.truncate below, no 30-char cap
        : (handbookGroup.length > 30 ? handbookGroup.slice(0, 29) + '…' : handbookGroup);
    const groupRole = stepUp ? 'stepUp' : 'group';
    // The bottom-right icon row is right-anchored on the same band this line
    // occupies, so a centered group ran straight under the icons — the handbook
    // group is what sends a child to the right table, so it must stay readable.
    // Reserve the icon row's width on the right and centre what's left.
    const iconCount = allergyTokens.length + (isBirthday ? 1 : 0) +
      (noPhoto ? 1 : 0) + (awanaShares != null ? 1 : 0) + (streakCount != null ? 1 : 0) +
      (isNewKid ? 1 : 0);
    // The age words (#291) sit in that same right-anchored row and are much
    // wider than an icon slot (~89pt, roughly 3.5 slots), so they have to be
    // measured rather than estimated — otherwise the handbook group runs
    // straight under them, the exact collision this reservation exists for.
    const iconReserve = iconCount > 0 ? iconCount * 25 + 10 : 0;
    let ageReserve = 0;
    if (ageFull) {
      // Bounded by what is actually LEFT of the band: when the icons alone
      // already fill it, the ladder below will drop the words, and reserving
      // for text that never gets drawn would truncate this line for nothing.
      ageReserve = Math.max(0, Math.min(
        type.measure(ctx, 'age', AGE_TEXT_SIZE, ageFull) + 3, ICON_ROW_MAX_W - iconReserve));
    }
    const reservedRight = iconReserve + ageReserve;
    const groupMaxW = Math.max(40, textW - reservedRight);
    const groupCenterX = textCenterX - reservedRight / 2;
    groupStr = type.truncate(ctx, groupRole, fs4, groupStr, groupMaxW);
    ctx.fillStyle = COLOR.group;
    type.fill(ctx, groupRole, fs4, groupStr, groupCenterX, y);
    y += fs4;
  }

  // ── Visitor / leader badge ────────────────────────────────────────────────
  // Same top-right pill, one string swap. The LEADER pill is the identity of a
  // leader name tag, not a decoration, so it is not subject to the per-club
  // template's showVisitorPill switch.
  const pillText = isLeader ? 'LEADER' : ((isVisitor && tplOn('showVisitorPill')) ? 'VISITOR' : '');
  if (pillText) {
    const vText = pillText;
    const vWidth = type.measure(ctx, 'pill', fs5, vText);
    const vPad = 4;
    const vX = $labelLayout.BX + bw - vPad - vWidth - 8;
    const vY = $labelLayout.BY + vPad;
    // Rounded pill background — invert on step-up so it stays readable
    ctx.fillStyle = COLOR.visitorBg;
    roundedRect(ctx, vX - vPad, vY - 1, vWidth + vPad * 2, fs5 + 4, 4);
    ctx.fill();
    ctx.fillStyle = COLOR.visitorText;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    type.fill(ctx, 'pill', fs5, vText, vX, vY + 1);
    // Reset alignment
    ctx.textAlign = 'center';
  }

  // ── Bottom-right row: coin shares · cake birthday · allergy icons ─────────
  // Icons only along the bottom edge — no words. Allergens render as emoji
  // glyphs, sized up so they stay recognizable on 1-bit thermal output.
  // Where the icon row begins (its leftmost pixel) — the bottom-left text lines
  // below truncate against THIS, not a guessed fraction of the badge, so a wide
  // allergy row and a footer can share the band without colliding. Defaults to
  // the badge's right padding edge when there is no icon row at all.
  let iconRowLeftX = $labelLayout.BX + bw - 8;
  if (hasIconRowGlyphs) {
    const EMOJI_SIZE         = 16;
    const ALLERGY_EMOJI_SIZE = 22;
    const BDAY_EMOJI_SIZE    = 26;
    const EMOJI_FONT_STACK = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    const PAD     = 6;
    const SPACING = 3;
    // The icons are emoji in the system's emoji font, exactly as before the
    // kit; no kit font weight may leak into them.
    const useEmoji = (size) => {
      ctx.font = `${size}px ${EMOJI_FONT_STACK}`;
      ctx.fontVariationSettings = 'normal';
    };

    // Build ordered glyph list, leftmost first:
    //   coin-emoji + N (shares)  ->  cake (birthday)  ->  allergy icons
    const glyphs = [];
    if (awanaShares != null) {
      // Coin emoji (U+1FA99) + space + ASCII digits. The font stack
      // falls back to sans-serif for the digits, no extra font wiring.
      glyphs.push({ ch: '🪙 ' + awanaShares, size: EMOJI_SIZE });
    }
    if (streakCount != null) {
      // Flame + attendance streak (#14) - same coin-badge pattern.
      glyphs.push({ ch: '🔥 ' + streakCount, size: EMOJI_SIZE });
    }
    if (isNewKid) {
      // Sparkle (#15): the kid's first two club weeks, so leaders learn the
      // new names fast. Subtle by design - no text, small glyph.
      glyphs.push({ ch: '✨', size: EMOJI_SIZE });
    }
    let ageGlyph = null;
    if (isBirthday) {
      glyphs.push({ ch: '🍰', size: BDAY_EMOJI_SIZE });
      if (ageFull) {
        // Right of the cake (#291), so the allergy/no-photo safety icons keep
        // their familiar right-edge positions and the row reads "🍰 Turning 7
        // this week!". Set in the label's read voice, not the emoji stack —
        // that would rasterise the words with whatever fallback it reaches.
        ageGlyph = { ch: ageFull, size: AGE_TEXT_SIZE, words: true };
        glyphs.push(ageGlyph);
      }
    }
    allergyTokens.forEach(function(t) {
      glyphs.push({ ch: $eligibility.ALLERGY_EMOJI[t] || '⚠', size: ALLERGY_EMOJI_SIZE });
    });
    if (noPhoto) {
      // Camera emoji with a slash drawn over it — "do not photograph".
      glyphs.push({ ch: '📷', size: ALLERGY_EMOJI_SIZE, slash: true });
    }

    // Measure each glyph under its own font so we can right-anchor the row.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let totalW = 0;
    glyphs.forEach(function(g, i) {
      if (g.words) {
        g.w = type.measure(ctx, 'age', g.size, g.ch);
      } else {
        useEmoji(g.size);
        g.w = ctx.measureText(g.ch).width;
      }
      totalW += g.w;
      if (i < glyphs.length - 1) totalW += SPACING;
    });

    // Width ladder for the age words (#291): full string, then a short form,
    // then nothing. The CAKE never goes, and neither does any allergy or
    // no-photo glyph — those are safety content. Only the words yield, so a
    // crowded label degrades to exactly today's icon row.
    if (ageGlyph && totalW > ICON_ROW_MAX_W) {
      const shortW = type.measure(ctx, 'age', ageGlyph.size, ageShort);
      if (totalW - ageGlyph.w + shortW <= ICON_ROW_MAX_W) {
        totalW += shortW - ageGlyph.w;
        ageGlyph.ch = ageShort;
        ageGlyph.w = shortW;
      } else {
        // The age is never the only glyph — the cake is always beside it — so
        // dropping it always removes exactly one SPACING as well.
        totalW -= ageGlyph.w + SPACING;
        glyphs.splice(glyphs.indexOf(ageGlyph), 1);
        ageGlyph = null;
      }
    }

    let ex = $labelLayout.BX + bw - PAD - totalW;
    iconRowLeftX = ex;
    const ey = $labelLayout.BY + $labelLayout.BH - PAD;  // shared baseline along the bottom padding line
    glyphs.forEach(function(g) {
      ctx.fillStyle = COLOR.name;  // share digits must stay light on step-up
      if (g.words) {
        type.fill(ctx, 'age', g.size, g.ch, ex, ey);
      } else {
        useEmoji(g.size);
        ctx.fillText(g.ch, ex, ey);
      }
      if (g.slash) {
        // Diagonal bar corner-to-corner across the glyph box
        ctx.save();
        ctx.strokeStyle = COLOR.name;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ex + 1, ey + 1);
        ctx.lineTo(ex + g.w - 1, ey - g.size + 3);
        ctx.stroke();
        ctx.restore();
      }
      ex += g.w + SPACING;
    });

    // Reset text state for any subsequent drawing
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
  }

  // ── Routing / milestone lines (bottom-left, above the icon row) ──────────
  // goToLine: late check-in routing from the group schedule ("Go to: Music,
  // Room 4"). milestoneLine: attendance milestones ("10th club night!").
  // Anchored bottom-left so they never collide with the bottom-right icons.
  const extraLines = [];
  // trophyBand (#293): "Finished Sparks Wingrunner", drawn as an inverse chip
  // so the room notices it from across the lobby. Pushed FIRST so the reversed
  // draw below puts it highest in the stack, closest to the name.
  if (extras && extras.trophyBand) extraLines.push({ text: String(extras.trophyBand).slice(0, 48), role: 'band', band: true });
  if (extras && extras.goToLine) extraLines.push({ text: String(extras.goToLine).slice(0, 48), role: 'goTo' });
  if (extras && extras.milestoneLine) extraLines.push({ text: String(extras.milestoneLine).slice(0, 48), role: 'milestone' });
  // Operator-configured footer (#8: church name, a verse, service times) —
  // pushed last so the reversed draw below puts it at the very bottom, under
  // any routing/milestone lines. Its own lighter weight so it reads as
  // branding, not routing (it was italic in the old fonts).
  if (hasFooter) extraLines.push({ text: footerText.slice(0, 48), role: 'footer' });
  if (extraLines.length) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const lineX = hasIcon ? $labelLayout.DIVIDER_X + 8 : $labelLayout.BX + 8;
    // Truncate against where the bottom-right icon row actually begins (or the
    // badge edge when there is none) rather than a guessed fraction of the
    // badge — the old flat 55% cap both wasted half the band on icon-less
    // labels and still collided under a five-allergy icon row. The 40pt floor
    // keeps at least a word visible against a pathologically wide row.
    const maxW = Math.max(40, iconRowLeftX - lineX - 4);
    let ly = $labelLayout.BY + $labelLayout.BH - 6;
    for (const line of extraLines.reverse()) {
      // The band reuses the visitor pill's inverse pair, so it stays readable
      // on an inverted (first-timer / award) label as well as a white one.
      const drawn = type.truncate(ctx, line.role, 10, line.text, line.band ? maxW - 8 : maxW);
      if (line.band) {
        const bandW = type.measure(ctx, line.role, 10, drawn);
        ctx.fillStyle = COLOR.visitorBg;
        roundedRect(ctx, lineX - 3, ly - 9, bandW + 6, 12, 3);
        ctx.fill();
        ctx.fillStyle = COLOR.visitorText;
      } else {
        ctx.fillStyle = COLOR.group;
      }
      type.fill(ctx, line.role, 10, drawn, lineX, ly);
      ly -= 13;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
  }

  // ── No-photo edge bar ─────────────────────────────────────────────────────
  // Drawn after the content (nothing reaches it; this is belt and braces) and
  // before the TEST band, which must stay readable across the whole label.
  if (noPhoto) {
    ctx.fillStyle = COLOR.name;
    ctx.fillRect($labelLayout.PAGE_W - $labelLayout.NO_PHOTO_BAR_W, 0, $labelLayout.NO_PHOTO_BAR_W, $labelLayout.PAGE_H);
  }

  // ── TEST overlay (canary labels) ──────────────────────────────────────────
  // A bold diagonal band so a canary print can never be mistaken for a real
  // check-in label. Solid black band + white text stays crisp on 1-bit
  // thermal output.
  if (testBanner) {
    ctx.save();
    ctx.translate($labelLayout.PAGE_W / 2, $labelLayout.PAGE_H / 2);
    ctx.rotate(-0.18);
    const bandW = $labelLayout.PAGE_W * 1.2;
    const bandH = 30;
    ctx.fillStyle = COLOR.name;
    ctx.fillRect(-bandW / 2, -bandH / 2, bandW, bandH);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLOR.bg;
    type.fill(ctx, 'test', 20, 'TEST — NOT A CHECK-IN', 0, 1);
    ctx.restore();
    ctx.textBaseline = 'top';
  }

  // Write PNG
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(pngPath, buffer);
  return { pngPath, buffer };
}

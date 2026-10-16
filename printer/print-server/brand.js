// The Awana 2026-27 catalog brand kit, as the label renderer uses it.
//
// print-server/public/brand/ is a generated copy of the one canonical kit in
// shared/brand/ (scripts/family-assets.mjs makes it before every test,
// start and build; it is not committed), checked by scripts/test-brand-kit.cjs. It ships
// inside the installer because electron-builder's extraResources already
// copies print-server/public/**.
//
// Two kinds of asset come out of it, and BOTH FAIL OPEN to what the label
// printed before the kit existed. A child at the door always gets a label:
//
//   * FONTS. Paytone One (the shout: the first name), Londrina Solid (the label
//     voice: pills, chips, the club line) and Figtree (the read: everything
//     else) are registered with the canvas library once, at require time. A
//     font whose file is missing, unreadable or refused by the canvas is
//     recorded as failed and the renderer sets that text in the Windows font it
//     used before (server.js keeps those stacks). A font that DID load is still
//     only used for a string whose every character it actually draws: the
//     canvas does not fall back glyph by glyph to the system fonts the way a
//     browser does, so "Дима" set in Paytone One (which has no Cyrillic) prints
//     four holes. The character map of each TTF is read here, and
//     fontCovers()/splitRuns() are how the renderer asks. A file cut short or
//     corrupted is refused before it reaches the canvas (fontFileProblem):
//     the canvas would register it and then draw every glyph empty. Four
//     clubs set their labels in a face of their own (CLUB_FACES: Comic Neue,
//     Playfair Display), with the three voices behind it.
//
//   * CLUB MARKS. The official one-colour marks (logos/*-black.svg) are the
//     icon column's fallback when TwoTimTwo's own club image cannot be fetched.
//     clubMarkSvg() hands back the SVG re-sized so the canvas rasterises it
//     crisply at icon size (an SVG decodes at its intrinsic size, which for
//     these marks is under 90 px wide); server.js then puts it through the same
//     thermal converter as a downloaded logo. A missing or undecodable mark
//     returns null and the renderer draws the letter monogram, as it always has.
//
// status() is what /health reports, as data and as {type, message} warnings.
//
// loadBrandKit(dir) is both the production entry point (called once below with
// the shipped kit) and the test seam: the golden suite points it at a folder
// with the fonts or the marks removed to render the fail-open labels, then
// points it back. Registration with the canvas is process-global and cannot be
// taken back, so a kit that "failed" only stops the RENDERER from asking for
// those families; the typefaces themselves stay registered, which is harmless
// because the fallback stacks never name them.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { GlobalFonts } = require('@napi-rs/canvas');
const { CLUB_TABLE } = require('./clubTable');

const DEFAULT_BRAND_DIR = path.join(__dirname, 'public', 'brand');

// Registered under these family names (the alias makes the name ours, not
// whatever the file's own name table says). Londrina's Black cut gets its own
// family rather than weight 900 of "Londrina Solid": the canvas resolves both
// weights of one registered family to the same face, measured.
const FONT_FILES = Object.freeze([
  { family: 'Paytone One',          file: 'PaytoneOne-Regular.ttf' },
  { family: 'Londrina Solid',       file: 'LondrinaSolid-Regular.ttf' },
  { family: 'Londrina Solid Black', file: 'LondrinaSolid-Black.ttf' },
  { family: 'Figtree',              file: 'Figtree-Variable.ttf' },
  // The club faces (owner 2026-10-12): labels only, never a screen.
  { family: 'Comic Neue',           file: 'ComicNeue-Regular.ttf' },
  { family: 'Comic Neue Bold',      file: 'ComicNeue-Bold.ttf' },
  { family: 'Playfair Display',     file: 'PlayfairDisplay-Variable.ttf' },
]);

// Clubs whose labels are set in a face of their own rather than the kit's
// three voices (owner 2026-10-12, from previews he approved): Puggles and
// Cubbies in Comic Neue, Trek and Journey in Playfair Display; Sparks and T&T
// keep the stock voices. Keyed by club key, like MARK_ROTATE, so the renderer
// names no club. Each set gives the face for the label's three weights of
// text: `shout` (the first name, the monogram), `bold` (the club line, the
// handbook group, "Go to", the pills, chips and bands) and `regular` (the last
// name and every other small line). Playfair Display ships as one variable
// font, so its weight travels as `wght` (fontVariationSettings, as Figtree's
// does; measured: the canvas draws and measures each weight); Comic Neue's two
// cuts are two families, like Londrina's.
//
// A set is used only while EVERY family in it loaded (clubFaces): a club whose
// face is missing or damaged prints its whole label in the stock voices, never
// half in one face and half in the other. A character the club face lacks
// (Comic Neue has no Vietnamese, Ș, Ğ, İ or Cyrillic; Playfair Display no
// Greek) falls back word by word to the stock voice and then to the old
// Windows face (labelType in server/label-type.js).
const comicNeue = () => Object.freeze({
  shout:   Object.freeze({ family: 'Comic Neue Bold' }),
  bold:    Object.freeze({ family: 'Comic Neue Bold' }),
  regular: Object.freeze({ family: 'Comic Neue' }),
});
const playfairDisplay = () => Object.freeze({
  shout:   Object.freeze({ family: 'Playfair Display', wght: 800 }),
  bold:    Object.freeze({ family: 'Playfair Display', wght: 700 }),
  regular: Object.freeze({ family: 'Playfair Display', wght: 400 }),
});
const CLUB_FACES = Object.freeze({
  puggle:  comicNeue(),
  cubbie:  comicNeue(),
  trek:    playfairDisplay(),
  journey: playfairDisplay(),
});

// Keyed by server.js's clubKey(). One colour, black, because the label prints
// black on a thermal printer; the converter re-inks it white on an inverted
// label.
const MARK_FILES = Object.freeze(Object.fromEntries(CLUB_TABLE.map((c) => [c.key, `${c.mark}-black.svg`])));

// Clubs whose mark prints SIDEWAYS on the label: rotated 90 degrees
// counter-clockwise (reads bottom to top) so a wide wordmark fills the tall
// icon panel instead of shrinking to a thin strip. Owner's choice 2026-10-12;
// T&T stays upright. Only the kit mark turns: the supplied image and the
// monogram fallbacks stay upright.
const MARK_ROTATE = Object.freeze({ puggle: true, cubbie: true, spark: true, trek: true, journey: true });

// How the warnings name them to an operator.
const MARK_NAMES = Object.freeze(Object.fromEntries(CLUB_TABLE.map((c) => [c.key, c.name])));

// The long side, in pixels, a mark is rasterised at. The icon zone is 76 pt,
// about 317 device px at 300 dpi; twice that gives the downscale real pixels
// to work with and clears the renderer's too-small gate (half the zone) by a
// wide margin.
const MARK_RASTER_LONG_SIDE = 768;

// A kit font file or mark bigger than this is not the kit (the real files are
// under 100 KB); refuse it rather than parse or decode it.
const MAX_ASSET_BYTES = 4 * 1024 * 1024;

// ── Is this font file whole? ──────────────────────────────────────────────────
// The canvas accepts far less than a whole font. A TTF cut short anywhere past
// its first few tables (an interrupted update half-copies files, and the kit
// lives beside the app under resources/) still registers, still reports the
// family as present, and still has the character map read below, so it looks
// loaded, and then every glyph draws EMPTY: the child's first name, a custom
// label, the TEST band, all blank on paper while /health says the fonts are
// fine. Measured with the kit's shout font (then Galindo) cut to anywhere from
// ~10% to ~60% of its length. The canvas cannot fall back from a face it thinks
// it has, so the only safe place to catch it is here, before registration.
//
// So check the file the way the format lets you: a real sfnt header, a table
// directory that fits, every table inside the file, the tables a TrueType or
// CFF face cannot draw without, every table's own checksum (the head table's
// computed with its checkSumAdjustment field zeroed, as the spec defines it)
// and the whole-file checkSumAdjustment. The kit's fonts carry correct
// checksums (any single changed byte fails one of them), and a font that did
// not would fail loudly in scripts/test-brand-kit.cjs at import time, never
// silently at the door. Returns null for a whole font, else the reason.
const SFNT_VERSIONS = new Set([0x00010000, 0x74727565 /* 'true' */, 0x4F54544F /* 'OTTO' */]);
const REQUIRED_TABLES = ['head', 'hhea', 'maxp', 'cmap', 'hmtx'];
function tableChecksum(buf, offset, length, skipFrom = -1) {
  let sum = 0;
  const end = offset + length;
  for (let i = offset; i < end; i += 4) {
    let word = 0;
    for (let k = 0; k < 4; k++) {
      const at = i + k;
      // Past the end counts as zero padding; so does the field the head
      // table's checksum excludes.
      const byte = at < end && !(at >= skipFrom && at < skipFrom + 4) ? buf[at] : 0;
      word = word * 256 + byte;
    }
    sum = (sum + word) >>> 0;
  }
  return sum;
}
function fontFileProblem(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return 'not a font file';
  if (!SFNT_VERSIONS.has(buf.readUInt32BE(0))) return 'not a font file';
  const numTables = buf.readUInt16BE(4);
  if (numTables === 0 || 12 + numTables * 16 > buf.length) return 'damaged font file';
  const tables = new Map();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = buf.toString('latin1', rec, rec + 4);
    const checksum = buf.readUInt32BE(rec + 4);
    const offset = buf.readUInt32BE(rec + 8);
    const length = buf.readUInt32BE(rec + 12);
    if (offset + length > buf.length) return 'damaged font file';
    const skip = tag === 'head' ? offset + 8 : -1;   // head.checkSumAdjustment
    if (tag === 'head' && length < 12) return 'damaged font file';
    if (tableChecksum(buf, offset, length, skip) !== checksum) return 'damaged font file';
    tables.set(tag, { offset, length });
  }
  if (!REQUIRED_TABLES.every((t) => tables.has(t))) return 'damaged font file';
  const outlines = (tables.has('glyf') && tables.has('loca')) || tables.has('CFF ') || tables.has('CFF2');
  if (!outlines) return 'damaged font file';
  // And the whole file, which covers what no table checksum does: the table
  // directory itself (a renamed table) and the padding between tables.
  const adjustAt = tables.get('head').offset + 8;
  const whole = tableChecksum(buf, 0, buf.length, adjustAt);
  if (((0xB1B0AFBA - whole) >>> 0) !== buf.readUInt32BE(adjustAt)) return 'damaged font file';
  return null;
}

// ── TrueType character maps ───────────────────────────────────────────────────
// Just enough of the 'cmap' table to answer "does this font draw this
// character?": the Unicode subtables in format 4 (the BMP) and format 12 (the
// full range). Returns a sorted array of [first, last] code point ranges, or
// null when the table cannot be read — the caller treats that font as failed,
// because a font we cannot check is a font that might print holes.
function readCmapRanges(buf) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
    const numTables = buf.readUInt16BE(4);
    let cmap = -1;
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      if (rec + 16 > buf.length) return null;
      if (buf.toString('latin1', rec, rec + 4) === 'cmap') cmap = buf.readUInt32BE(rec + 8);
    }
    if (cmap < 0 || cmap + 4 > buf.length) return null;
    const subtables = [];
    const count = buf.readUInt16BE(cmap + 2);
    for (let i = 0; i < count; i++) {
      const r = cmap + 4 + i * 8;
      const platform = buf.readUInt16BE(r);
      const encoding = buf.readUInt16BE(r + 2);
      const at = cmap + buf.readUInt32BE(r + 4);
      if (at + 2 > buf.length) continue;
      subtables.push({ platform, encoding, at, format: buf.readUInt16BE(at) });
    }
    // Preference: a full-range Unicode map, then a BMP one.
    const unicode = (s) => s.platform === 0 || (s.platform === 3 && (s.encoding === 1 || s.encoding === 10));
    const pick = subtables.find((s) => unicode(s) && s.format === 12)
      || subtables.find((s) => unicode(s) && s.format === 4);
    if (!pick) return null;
    const ranges = [];
    const add = (a, b) => {
      const last = ranges[ranges.length - 1];
      if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
      else ranges.push([a, b]);
    };
    if (pick.format === 12) {
      const groups = buf.readUInt32BE(pick.at + 12);
      for (let g = 0; g < groups; g++) {
        const o = pick.at + 16 + g * 12;
        const start = buf.readUInt32BE(o);
        const end = buf.readUInt32BE(o + 4);
        const glyph = buf.readUInt32BE(o + 8);
        // glyph 0 is .notdef: a group that starts there maps its first code
        // point to nothing.
        const first = glyph === 0 ? start + 1 : start;
        if (end >= first) add(first, end);
      }
    } else {
      const segX2 = buf.readUInt16BE(pick.at + 6);
      const seg = segX2 / 2;
      const endAt = pick.at + 14;
      const startAt = endAt + segX2 + 2;
      const deltaAt = startAt + segX2;
      const rangeAt = deltaAt + segX2;
      for (let i = 0; i < seg; i++) {
        const end = buf.readUInt16BE(endAt + i * 2);
        const start = buf.readUInt16BE(startAt + i * 2);
        const delta = buf.readUInt16BE(deltaAt + i * 2);
        const rangeOffsetPos = rangeAt + i * 2;
        const rangeOffset = buf.readUInt16BE(rangeOffsetPos);
        if (start === 0xFFFF) continue;
        let runStart = -1;
        for (let c = start; c <= end; c++) {
          let glyph;
          if (rangeOffset === 0) {
            glyph = (c + delta) & 0xFFFF;
          } else {
            const addr = rangeOffsetPos + rangeOffset + (c - start) * 2;
            glyph = addr + 2 <= buf.length ? buf.readUInt16BE(addr) : 0;
            if (glyph !== 0) glyph = (glyph + delta) & 0xFFFF;
          }
          if (glyph !== 0) {
            if (runStart < 0) runStart = c;
          } else if (runStart >= 0) {
            add(runStart, c - 1);
            runStart = -1;
          }
        }
        if (runStart >= 0) add(runStart, end);
      }
    }
    ranges.sort((a, b) => a[0] - b[0]);
    return ranges.length ? ranges : null;
  } catch {
    return null;
  }
}

function rangesHave(ranges, cp) {
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < ranges[mid][0]) hi = mid - 1;
    else if (cp > ranges[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}

// ── SVG sizing ────────────────────────────────────────────────────────────────
// The canvas decodes an SVG at the size its root element declares. Rewrite the
// root's width/height (keeping, or adding, a viewBox so the drawing scales with
// them) so the mark rasterises at `longSide` px on its long side. null for
// anything that is not an SVG with a readable size.
function svgAtSize(svgText, longSide) {
  if (typeof svgText !== 'string') return null;
  const m = svgText.match(/<svg\b[^>]*>/i);
  if (!m) return null;
  const tag = m[0];
  const attr = (name) => {
    const a = tag.match(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+)(?:px)?\\s*["']`, 'i'));
    return a ? parseFloat(a[1]) : NaN;
  };
  let w = attr('width');
  let h = attr('height');
  const vb = tag.match(/\sviewBox\s*=\s*["']\s*([-0-9.]+)[\s,]+([-0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)\s*["']/i);
  if (!(w > 0 && h > 0) && vb) { w = parseFloat(vb[3]); h = parseFloat(vb[4]); }
  if (!(w > 0 && h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  const k = longSide / Math.max(w, h);
  let root = tag
    .replace(/\swidth\s*=\s*["'][^"']*["']/i, '')
    .replace(/\sheight\s*=\s*["'][^"']*["']/i, '');
  if (!vb) root = root.replace(/^<svg\b/i, `<svg viewBox="0 0 ${w} ${h}"`);
  root = root.replace(/^<svg\b/i, `<svg width="${(w * k).toFixed(3)}" height="${(h * k).toFixed(3)}"`);
  return svgText.replace(tag, root);
}

// ── State ─────────────────────────────────────────────────────────────────────
// Registration is process-global, so the same bytes are registered once no
// matter how often loadBrandKit runs (sha256 → the canvas's FontKey).
const registeredFonts = new Map();

let kit = emptyKit(DEFAULT_BRAND_DIR);

function emptyKit(dir) {
  return {
    dir,
    fonts: new Map(),   // family -> { ok, reason, ranges }
    marks: new Map(),   // clubKey -> { ok, reason, svg: Buffer|null }
  };
}

function readAsset(file) {
  let st;
  try { st = fs.statSync(file); } catch { return { error: 'file missing' }; }
  if (!st.isFile()) return { error: 'not a file' };
  if (st.size === 0) return { error: 'empty file' };
  if (st.size > MAX_ASSET_BYTES) return { error: 'file too large' };
  try { return { buf: fs.readFileSync(file) }; } catch (e) { return { error: `unreadable (${e.code || 'error'})` }; }
}

function loadFont(dir, { family, file }) {
  const got = readAsset(path.join(dir, 'fonts', file));
  if (got.error) return { ok: false, reason: got.error, ranges: null };
  // Before anything reaches the canvas: a damaged file registered is a face
  // that draws nothing, and it cannot be taken back.
  const problem = fontFileProblem(got.buf);
  if (problem) return { ok: false, reason: problem, ranges: null };
  const ranges = readCmapRanges(got.buf);
  if (!ranges) return { ok: false, reason: 'no readable character map', ranges: null };
  const hash = crypto.createHash('sha256').update(got.buf).digest('hex');
  let key = registeredFonts.get(hash);
  if (!key) {
    try { key = GlobalFonts.register(got.buf, family); } catch { key = null; }
    if (!key) return { ok: false, reason: 'the canvas refused the font', ranges: null };
    registeredFonts.set(hash, key);
  }
  if (!GlobalFonts.has(family)) return { ok: false, reason: 'not visible to the canvas', ranges: null };
  return { ok: true, reason: '', ranges };
}

function loadMark(dir, file) {
  const got = readAsset(path.join(dir, 'logos', file));
  if (got.error) return { ok: false, reason: got.error, svg: null };
  const sized = svgAtSize(got.buf.toString('utf8'), MARK_RASTER_LONG_SIDE);
  if (!sized) return { ok: false, reason: 'not an SVG with a size', svg: null };
  return { ok: true, reason: '', svg: Buffer.from(sized, 'utf8') };
}

// (Re)load the kit from `dir`. Never throws: every failure is recorded and
// reported, and the renderer falls back for exactly the pieces that failed.
function loadBrandKit(dir = DEFAULT_BRAND_DIR) {
  const next = emptyKit(dir);
  for (const f of FONT_FILES) {
    let r;
    try { r = loadFont(dir, f); } catch (e) { r = { ok: false, reason: 'error while loading', ranges: null }; }
    next.fonts.set(f.family, r);
  }
  for (const [key, file] of Object.entries(MARK_FILES)) {
    let r;
    try { r = loadMark(dir, file); } catch (e) { r = { ok: false, reason: 'error while loading', svg: null }; }
    next.marks.set(key, r);
  }
  kit = next;
  generation++;
  return status();
}

// Bumped by every loadBrandKit, so a caller caching something derived from
// the kit (server.js keeps each mark's thermal-converted raster) knows when
// to drop it.
let generation = 0;
function kitGeneration() { return generation; }

// ── Queries the renderer makes ────────────────────────────────────────────────
function fontReady(family) {
  const f = kit.fonts.get(family);
  return !!(f && f.ok);
}

// True when `family` loaded and draws every character of `text`.
function fontCovers(family, text) {
  const f = kit.fonts.get(family);
  if (!f || !f.ok) return false;
  for (const ch of String(text == null ? '' : text)) {
    if (!rangesHave(f.ranges, ch.codePointAt(0))) return false;
  }
  return true;
}

// User-perceived characters, so a run boundary never separates a letter from
// its combining accent, or an emoji from its variation selector / ZWJ partner
// (either would print the halves in two different faces, apart). Intl.Segmenter
// where the runtime has it (Node 16+, Electron's Node); otherwise marks,
// joiners and selectors are glued to the character before them.
const segmenter = (typeof Intl === 'object' && typeof Intl.Segmenter === 'function')
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;
function graphemes(s) {
  if (segmenter) return Array.from(segmenter.segment(s), (g) => g.segment);
  const out = [];
  for (const ch of s) {
    if (out.length && /[\p{M}\u200D\uFE00-\uFE0F]/u.test(ch)) out[out.length - 1] += ch;
    else if (out.length && out[out.length - 1].endsWith('\u200D')) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

// Words, for the run split below: a face never changes in the middle of a
// word. A word is a run of graphemes that each start with a letter, mark or
// digit (an apostrophe between two of them stays inside: "O’Brien",
// "We're"). A space, a punctuation mark, a symbol or an emoji (anything drawn
// with an emoji selector or a keycap) is a unit of its own, so the milestone
// line's star still comes apart from the words beside it.
const WORD_GRAPHEME = /^[\p{L}\p{M}\p{N}]/u;
const EMOJI_PRESENTATION = /[\uFE0F\u20E3]/u;
const IN_WORD_APOSTROPHE = /^['\u2019]$/u;
function wordUnits(s) {
  const gs = graphemes(s);
  const wordy = (g) => g !== undefined && WORD_GRAPHEME.test(g) && !EMOJI_PRESENTATION.test(g);
  const units = [];
  let word = '';
  for (let i = 0; i < gs.length; i++) {
    const g = gs[i];
    if (wordy(g) || (word && IN_WORD_APOSTROPHE.test(g) && wordy(gs[i + 1]))) { word += g; continue; }
    if (word) { units.push(word); word = ''; }
    units.push(g);
  }
  if (word) units.push(word);
  return units;
}

// `text` cut into runs the brand font draws ({brand: true}) and runs it does
// not ({brand: false}), in order, adjacent runs of a kind merged. The unit of
// the decision is the WORD (wordUnits): a word with any character the font
// cannot draw goes to the old face whole, because "Nguyễn" printed as a
// kit-font word with one Arial letter inside it reads as a misprint, not as a
// name. A character counts as drawable only when every code point in it is in
// the font's own character map: the shaper can sometimes build a missing
// accented letter out of a base and a combining mark, but that is not
// something to rely on for a child's name. One run of the whole string when
// the font is not ready, so a caller can always just iterate.
//
// `family` may also be a list in order of preference (a club's face, then the
// stock voice behind it): each word then goes to the FIRST family that draws
// all of it, and every run names it (`family`, null for none; `brand` is
// whether there is one). Families that did not load are skipped.
function splitRuns(family, text) {
  const s = String(text == null ? '' : text);
  const list = (Array.isArray(family) ? family : [family])
    .map((name) => ({ name, f: kit.fonts.get(name) }))
    .filter(({ f }) => f && f.ok);
  if (!list.length) return [{ text: s, brand: false, family: null }];
  const draws = (f, unit) => {
    for (const ch of unit) {
      if (!rangesHave(f.ranges, ch.codePointAt(0))) return false;
    }
    return true;
  };
  const runs = [];
  for (const unit of wordUnits(s)) {
    const pick = list.find(({ f }) => draws(f, unit));
    const name = pick ? pick.name : null;
    const last = runs[runs.length - 1];
    if (last && last.family === name) last.text += unit;
    else runs.push({ text: unit, brand: !!name, family: name });
  }
  return runs.length ? runs : [{ text: s, brand: true, family: list[0].name }];
}

// The club's own face set (CLUB_FACES) while every family in it loaded, else
// null: the label is then set in the stock voices.
function clubFaces(clubKey) {
  const set = Object.prototype.hasOwnProperty.call(CLUB_FACES, clubKey) ? CLUB_FACES[clubKey] : null;
  if (!set) return null;
  return Object.values(set).every((v) => fontReady(v.family)) ? set : null;
}

// The mark's SVG, sized for rasterising, or null (no mark for this club, or
// it failed to load). A Buffer copy each time: the caller hands it to the
// canvas decoder and must never be able to mutate the cached one.
function clubMarkSvg(clubKey) {
  const m = kit.marks.get(clubKey);
  return m && m.ok && m.svg ? Buffer.from(m.svg) : null;
}

// The renderer calls this when a mark that loaded here then failed to decode
// or came back with no ink, so /health tells the truth about what prints.
function markFailed(clubKey, reason) {
  const m = kit.marks.get(clubKey);
  if (!m || !m.ok) return;
  kit.marks.set(clubKey, { ok: false, reason: String(reason || 'could not be drawn'), svg: null });
  generation++;
  console.warn(`[brand] Club mark for ${MARK_NAMES[clubKey] || clubKey} could not be drawn (${reason}); labels use the letter monogram instead`);
}

// ── What /health reports ──────────────────────────────────────────────────────
// Families and club keys plus a short reason — never a path: in the packaged
// app the kit lives under the operator's Windows profile, and /health is
// CORS-readable from the check-in site.
function status() {
  const fonts = { loaded: [], failed: [], reasons: {} };
  for (const f of FONT_FILES) {
    const r = kit.fonts.get(f.family);
    if (r && r.ok) fonts.loaded.push(f.family);
    else { fonts.failed.push(f.family); fonts.reasons[f.family] = r ? r.reason : 'not loaded'; }
  }
  const marks = { loaded: [], failed: [], reasons: {} };
  for (const key of Object.keys(MARK_FILES)) {
    const r = kit.marks.get(key);
    if (r && r.ok) marks.loaded.push(key);
    else { marks.failed.push(key); marks.reasons[key] = r ? r.reason : 'not loaded'; }
  }
  return { fonts, marks };
}

// {type, message} warnings for /health (the dashboard renders w.message, so a
// bare string would paint an empty box). Empty when the kit is whole.
function warnings() {
  const st = status();
  const out = [];
  if (st.fonts.failed.length) {
    const list = st.fonts.failed.map((f) => `${f} (${st.fonts.reasons[f]})`).join(', ');
    out.push({
      type: 'brandFonts',
      message: `Label fonts did not load: ${list}. Labels still print, with the older Windows fonts for that text (a club whose own face did not load prints in the standard label fonts). Reinstall or update Club Label Printer to restore them.`,
    });
  }
  if (st.marks.failed.length) {
    const list = st.marks.failed.map((k) => `${MARK_NAMES[k] || k} (${st.marks.reasons[k]})`).join(', ');
    out.push({
      type: 'brandMarks',
      message: `Official club marks did not load: ${list}. When TwoTimTwo's club image cannot be fetched, those labels print the club's letter badge instead. Reinstall or update Club Label Printer to restore them.`,
    });
  }
  return out;
}

// Load the shipped kit now, so the first label of the night is already in the
// brand fonts. Synchronous file reads only: no timers, no sockets, nothing
// that would make a bare require() of the server hold the process open.
{
  const st = loadBrandKit(DEFAULT_BRAND_DIR);
  if (st.fonts.failed.length || st.marks.failed.length) {
    console.warn(`[brand] Brand kit incomplete — fonts failed: ${st.fonts.failed.join(', ') || 'none'}; club marks failed: ${st.marks.failed.join(', ') || 'none'}. Labels print with the fallbacks.`);
  } else {
    console.log(`[brand] Label fonts loaded (${st.fonts.loaded.join(', ')}) and ${st.marks.loaded.length} club marks`);
  }
}

module.exports = {
  DEFAULT_BRAND_DIR, FONT_FILES, CLUB_FACES, MARK_FILES, MARK_ROTATE, MARK_RASTER_LONG_SIDE,
  loadBrandKit, status, warnings,
  fontReady, fontCovers, splitRuns, clubFaces, clubMarkSvg, markFailed, kitGeneration,
  // Pure helpers, exported for unit tests.
  readCmapRanges, svgAtSize, fontFileProblem,
};

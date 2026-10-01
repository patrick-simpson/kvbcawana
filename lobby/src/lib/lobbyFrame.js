// @ts-check
// The lobby's copy frame (rebrand stage 4b): what a slide says and how big it
// can say it. Pure: a slide goes in, a frame model comes out, and the fit
// turns that model into sizes and line breaks by measuring the words in the
// faces that will draw them. The components only render the result.
//
// Every length here is in u: 1% of a 16:9 stage's width, which on a TV is
// min(1vw, 1.7778vh) and in the slide editor's 1600x900 thumbnail frame is
// 16px. The copy is laid out on a 100u x 56.25u box (centred on screens that
// are not 16:9), so a slide fits the same way on every screen and in every
// thumbnail.

import { chipGeometry, inkOverflow, markExtents } from './brand.js';

/* ── The layout box ──────────────────────────────────────────────── */

/**
 * Where the copy may go, measured off the approved mockup's renders (its
 * .slide-c sits at 14.6u, and its kicker's line box puts the letters half a
 * unit lower than ours, so ours starts at 15.1u to land on the same pixels). The
 * block starts at `top` and only rises (to `safeTop`) when it would otherwise
 * reach past `safeBottom`, which clears the house waves' crest (the
 * sunflower wave peaks at ~46.7u at the left edge, the orange at ~48u at the
 * right) and the bottom corner chip (from ~46.5u).
 *
 * Above `clearTop` sit the corner tab's fat end (from the left edge to
 * ~16.3u, down to ~11.5u) and the top-right stack (the status sticker over
 * the weather chip, from ~73.6u across with the widest label, "Thunderstorm
 * with hail"). The stack is sized partly in px and rem, so in u it reaches
 * further down the smaller the screen: measured, 10.7u at 3840x2160, 11.1u
 * at 1920x1080, 12.8u at 1366x768 and 13.2u at 1280x720, the smallest 16:9
 * TV the lobby is sized for (a 4:3 screen has a band above the 16:9 box). So
 * a row may rise above `clearTop` only if it is no wider than `clearWidth`,
 * centred between the two; a block whose top row is wider stops at
 * `clearTop` (below it the tab is under 3.1u wide and the stack has ended).
 *
 * `measure` is the shouted headline's preferred line length (the mockup's
 * longest line, THE GYM DOORS, runs 63.5u at 7.2u); `width` is the widest any
 * line may ever run.
 */
export const LAYOUT = {
  top: 15.1, safeTop: 11, clearTop: 14, clearWidth: 45, safeBottom: 45, width: 84, measure: 68,
};

/**
 * The kicker: Londrina Solid, tracked caps, one line when it can be.
 * `gap` puts the headline's caps where the mockup's are (its kicker-to-caps
 * distance). Below `min` a long kicker wraps to two balanced lines instead of
 * shrinking further, and only shrinks past `min` when even two lines are too
 * wide: it never runs wider than LAYOUT.width. Two lines get a little leading
 * (`wrappedLineHeight`); one sits on the mockup's line box.
 */
export const KICKER = { size: 2.3, min: 1.6, gap: 1.9, tracking: 0.07, lineHeight: 1, wrappedLineHeight: 1.15 };

/**
 * The shouted headline: Paytone One at true size, uppercase, with a hard
 * offset shadow of 0.058em (.44u at 7.6u). Sized to hold the approved
 * mockup's CAP HEIGHTS, not its font sizes: the mockup was drawn in Galindo
 * (7.2u, line-height .98), whose caps stand 5.7% taller at the same size
 * (a mean cap top of 0.730em against Paytone One's 0.691em), so every size
 * here is the mockup's times 1.057, rounded: 7.2u → 7.6u, 6u → 6.3u, 5u →
 * 5.3u, lg's 5.8u → 6.1u, and the line height .98 → .93, which keeps the
 * mockup's row pitch (7.07u at 7.6u against its 7.06u). Paytone One is also
 * 5% narrower per unit of cap height on most words (THE GYM DOORS, the
 * mockup's longest line, runs 60.4u at 7.6u against its 63.5u), so the
 * measure and the box keep their numbers.
 *
 * `lineHeight` is the row pitch of plain caps. A mark that stands above a
 * capital or hangs below one (JOSÉ, NGUYỄN, ȘTEFAN) reaches far past a caps
 * row at .93 (É to 1.045em, Ș's comma to -0.351em), so the row it would
 * crowd gets the extra room its measured ink needs (`shoutBox`): its marks
 * never touch the row above or below, the kicker, or the chip, the other rows
 * keep their pitch, and the fit counts the extra room. `markGap` is the least
 * clear space left between a mark and the ink it would otherwise meet.
 *
 * `ceiling` is the largest size a slide's textSize allows; below `min` a
 * headline is no longer a shout, and the frame falls back to the read layout.
 * So does any headline in a script that stacks its marks above and below the
 * letter (STACKED).
 */
export const SHOUT = {
  max: 7.6,
  min: 5.3,
  /** The smallest size still set to the preferred measure before a line may run the full width. */
  measured: 6.3,
  step: 0.1,
  lineHeight: 0.93,
  /** At the measure a shout may take three lines; at the full width, two. */
  maxLines: 3,
  wideLines: 2,
  shadow: 0.058,
  markGap: 0.06,
  /** @type {Record<string, number>} */
  ceiling: { auto: 7.6, xl: 7.6, lg: 6.1 },
};

/**
 * The read layout, for text too long to shout: Figtree (the kit's reading
 * voice) in the sentence case the operator typed, balanced lines, set in the
 * theme's dark reading ink rather than white-on-sky (a paragraph needs the
 * contrast a shout gets from its offset shadow). Every line lands as one
 * piece instead of word by word.
 *
 * `floor` is the smallest size the operator's own line breaks are kept at;
 * below it the lines run on, separated by `joiner`. A word wider than the
 * whole line (a pasted URL) is cut across rows of its own, but only when it
 * would not fit whole even at `wordFloor`: it keeps the largest size that
 * fits rather than shrinking the whole slide to a hairline, and the page
 * draws exactly the pieces the fit cut. `last` is the
 * size below which nothing ever goes; the fit only gets near it for a frame
 * no operator can type (a full slide under a two-line kicker, a chip and a
 * supporting line).
 */
export const READ = {
  max: 4.2, floor: 1.5, wordFloor: 2.4, last: 0.2, step: 0.1, lineHeight: 1.22, width: 76, shadow: 0, joiner: ' ·',
};

/**
 * Where a word too wide for any line is cut: a hair short of the line. The
 * page draws the fit's own pieces, one per row (SlideCopy), rather than
 * letting the browser wrap the word its own way (it prefers to break after a
 * hyphen, and so needed more rows than the fit counted, down behind the house
 * waves); the slack is only there so a piece drawn in the shaped face
 * (kerning, ligatures) never runs wider than the line it was measured for.
 */
const BREAK_SLACK = 0.97;

/** The supporting line under the headline (a special night's note, the book nudge). */
export const SUB = { size: 2.6, min: 2, step: 0.1, lineHeight: 1.2, gap: 1.4, width: 64, maxLines: 3 };

/** The stepped chip under it all ("WED / SEP 30"), 3.6u under the caps as in the mockup. */
export const CHIP = { size: 3.6, gap: 1.8 };

/* ── Themes, in the kit palette ──────────────────────────────────── */

/**
 * The five operator themes, re-expressed in the brand kit: a flat field with
 * tone-on-tone clouds (field darker, cloud lighter, like the studio sky), a
 * doodle colour, and the copy's colours. Values are kit tokens wherever the
 * kit has one; the few literals are the shades between two tokens that the
 * kit does not name (a lavender field between the Journey tint and Journey,
 * a navy shadow under the night sky). The headline's hard shadow changes per
 * theme where the Awana-blue one would vanish (night) or clash (the rest).
 *
 * @type {Record<string, { field: string, cloud: string, doodle: string, kicker: string, face: string, shadow: string, sub: string }>}
 */
export const LOBBY_THEMES = {
  // The studio sky: the approved mockup, exactly.
  sky: {
    field: 'var(--brand-sky)',
    cloud: 'var(--brand-cloud)',
    doodle: '#fff',
    kicker: 'var(--brand-blue-deep)',
    face: '#fff',
    shadow: 'var(--brand-blue)',
    sub: 'var(--brand-blue-deep)',
  },
  // Warm apricot under a cream sky; the headline burns hot orange so it
  // still reads on a light warm field.
  sunset: {
    field: '#FFD493',
    cloud: 'var(--brand-cream)',
    doodle: '#fff',
    kicker: 'var(--brand-hot-deep)',
    face: 'var(--brand-hot)',
    shadow: 'var(--brand-hot-deep)',
    sub: 'var(--brand-hot-deep)',
  },
  // The deep house blue after dark, cream starlight, a navy shadow.
  night: {
    field: 'var(--brand-blue-deep)',
    cloud: '#3F64AA',
    doodle: 'var(--brand-cream)',
    kicker: 'var(--brand-sun)',
    face: '#fff',
    shadow: '#1B2D5C',
    sub: 'var(--brand-cream)',
  },
  // T&T's green, pale.
  meadow: {
    field: '#B4DCBE',
    cloud: 'var(--brand-tnt-tint)',
    doodle: '#fff',
    kicker: 'var(--brand-trek-deep)',
    face: '#fff',
    shadow: 'var(--brand-tnt-deep)',
    sub: 'var(--brand-trek-deep)',
  },
  // The 2026-27 catalog cover's soft lavender, in Journey's colours.
  lavender: {
    field: '#C8BCDE',
    cloud: 'var(--brand-journey-tint)',
    doodle: '#fff',
    kicker: 'var(--brand-journey-ink)',
    face: '#fff',
    shadow: 'var(--brand-journey)',
    sub: 'var(--brand-journey-ink)',
  },
};

/** @param {string | null | undefined} theme */
export function lobbyTheme(theme) {
  return LOBBY_THEMES[theme ?? ''] ? /** @type {string} */ (theme) : 'sky';
}

/* ── Measuring ───────────────────────────────────────────────────── */

/** @typedef {'shout' | 'read' | 'label' | 'body'} Face */

/**
 * The canvas font for each face, matching the CSS stacks that draw them
 * (--font-shout, --font-body at 800 and 700, --font-condensed). The shout's
 * stack falls back to Baloo 2 for Devanagari, as the CSS does.
 * @type {Record<Face, string>}
 */
const FONTS = {
  shout: '400 100px "Paytone One", "Baloo 2 Variable", "Arial Rounded MT Bold", sans-serif',
  read: '800 100px "Figtree Variable", Figtree, "Segoe UI", system-ui, sans-serif',
  label: '400 100px "Londrina Solid", "Arial Narrow", sans-serif',
  body: '700 100px "Figtree Variable", Figtree, "Segoe UI", system-ui, sans-serif',
};

/**
 * Per-character estimates for when there is no canvas (jsdom, SSR): a
 * little wide on purpose, so an estimate never promises a fit the real face
 * would break.
 * @type {Record<Face, number>}
 */
const ROUGH = { shout: 0.7, read: 0.58, label: 0.46, body: 0.56 };

/** Letters that set a full em wide (ideographs, kana, Hangul, full-width forms). */
const FULL_WIDTH = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303F\uFF01-\uFF60]/u;

/** @type {OffscreenCanvasRenderingContext2D | null | undefined} */
let ctx;

/**
 * The advance width of `text` in em in one of the lobby's faces, measured on
 * an OffscreenCanvas (every screen we run on has one), else estimated.
 * @param {string} text
 * @param {Face} face
 * @returns {number}
 */
export function measureText(text, face) {
  if (ctx === undefined) {
    try {
      ctx = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d') : null;
    } catch {
      ctx = null;
    }
  }
  if (ctx) {
    ctx.font = FONTS[face];
    const w = ctx.measureText(text).width / 100;
    if (Number.isFinite(w) && w > 0) return w;
  }
  return [...text].reduce((w, ch) => w + (ch === ' ' ? 0.3 : FULL_WIDTH.test(ch) ? 1.05 : ROUGH[face]), 0);
}


/**
 * How far `text`'s ink reaches above and below its baseline, in em of one of
 * the lobby's faces: measured on the canvas (the real outlines, whatever face
 * in the stack draws each letter), else estimated from its marks.
 * @param {string} text
 * @param {Face} face
 * @returns {{ ascent: number, descent: number }}
 */
export function measureInk(text, face) {
  if (ctx === undefined) measureText('', face);
  if (ctx) {
    ctx.font = FONTS[face];
    const m = ctx.measureText(text);
    const ascent = m.actualBoundingBoxAscent / 100;
    const descent = m.actualBoundingBoxDescent / 100;
    if (Number.isFinite(ascent) && Number.isFinite(descent) && ascent > 0) return { ascent, descent: Math.max(0, descent) };
  }
  return markExtents(text);
}

/** @typedef {(text: string, face: Face) => number} Measure */
/** @typedef {(text: string, face: Face) => { ascent: number, descent: number }} MeasureInk */

/* ── The frame model ─────────────────────────────────────────────── */

/**
 * @typedef {{ label: string, value: string }} ChipText
 * @typedef {{
 *   kicker: string,
 *   headline: string,
 *   sub: string,
 *   chip: ChipText | null,
 *   textSize: string,
 * }} Frame
 */

/** @param {unknown} v */
const clean = (v) => (typeof v === 'string' ? v.replace(/[ \t]+/g, ' ').trim() : '');

/**
 * What one slide says, in the frame's terms: the kicker (a typed slide's
 * eyebrow), the headline (its text), an optional supporting line and an
 * optional stepped chip. A calendar slide carries a `frame` of its own
 * (src/lib/calendarLogic.js) that moves its date into the chip; a typed slide
 * never can, because sanitizeSlides keeps only the fields it knows.
 *
 * @param {any} slide
 * @returns {Frame}
 */
export function slideFrame(slide) {
  const own = slide && typeof slide.frame === 'object' && slide.frame ? slide.frame : null;
  const chip = own?.chip && own.chip.label && own.chip.value
    ? { label: String(own.chip.label), value: String(own.chip.value) }
    : null;
  return {
    kicker: clean(slide?.eyebrow),
    headline: String((own ? own.headline : slide?.text) ?? '').trim(),
    sub: clean(own ? own.sub : slide?.subtext),
    chip,
    // A calendar frame is sized for its own short headline; the textSize it
    // carries was chosen for the old frame, where the date sat in the text.
    textSize: own ? 'auto' : String(slide?.textSize ?? 'auto'),
  };
}


/* ── Words ───────────────────────────────────────────────────────── */

/**
 * One unbreakable piece of copy, and whether the source had a space (or a
 * line break) before it. Lines only ever break between tokens; a token with
 * `space: false` joins the one before it with nothing, as the words of a
 * Chinese, Japanese or Thai sentence do (those scripts put no spaces between
 * words, so splitting on spaces alone made a whole sentence one "word").
 * @typedef {{ text: string, space: boolean }} Token
 */

/**
 * Scripts that stack vowel and tone marks above and below the letter: Thai,
 * Lao, Khmer, Myanmar and Tibetan, and the Brahmic scripts of India and Sri
 * Lanka, Devanagari among them. None has a letter in Paytone One, and at a
 * caps line height the marks of one row reach into the next: Thai in the
 * fallback face, and Devanagari even in Baloo 2, the shout's own fallback,
 * which draws it (the u-matra under the bha of "प्रभु" runs through the
 * i-matra's loop over "ति" on the row below, 0.17em deep). They read instead,
 * at the read layout's 1.22.
 */
const STACKED = /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}]/u;

// Scripts a line may break inside with no dictionary (UAX #14 class ID)…
const IDEOGRAPHIC = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
// …and those that need one to find their words (class SA).
const DICTIONARY = /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/** @param {'word' | 'grapheme'} granularity */
function segmenter(granularity) {
  try {
    return typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity }) : null;
  } catch {
    return null;
  }
}
const WORD_SEGMENTER = segmenter('word');
const GRAPHEME_SEGMENTER = segmenter('grapheme');

/**
 * The user-perceived characters of `text` (a flag or an accented letter is
 * one), which is where a word too wide for any line may be cut.
 * @param {string} text
 * @returns {string[]}
 */
export function graphemes(text) {
  return GRAPHEME_SEGMENTER ? Array.from(GRAPHEME_SEGMENTER.segment(text), (g) => g.segment) : [...text];
}

/**
 * Where one space-free run may break: between the words of a script written
 * without spaces, and nowhere else, so "Pick-up", "tonight!" and a URL stay
 * whole. Punctuation rides with the word before it (an opening bracket or
 * quote with the word after), so no line starts with "。" or ends with "「".
 * Without Intl.Segmenter, Han and kana still break between characters and a
 * Thai run stays whole (it then breaks only as a word too wide for its line).
 *
 * @param {string} run
 * @param {Intl.Segmenter | null} [words]
 * @returns {string[]}
 */
export function splitRun(run, words = WORD_SEGMENTER) {
  /** @param {string} ch */
  const breaks = (ch) => IDEOGRAPHIC.test(ch) || (words !== null && DICTIONARY.test(ch));
  const chars = [...run];
  if (!chars.some(breaks)) return [run];
  const parts = words ? Array.from(words.segment(run), (s) => s.segment) : graphemes(run);
  /** @type {string[]} */
  const merged = [];
  for (const part of parts) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && !breaks([...prev].pop() ?? '') && !breaks([...part][0] ?? '')) merged[merged.length - 1] = prev + part;
    else merged.push(part);
  }
  /** @type {string[]} */
  const out = [];
  let opening = '';
  for (const part of merged) {
    if (/[\p{L}\p{N}]/u.test(part)) {
      out.push(opening + part);
      opening = '';
      continue;
    }
    // Punctuation, a mark at a time: closing marks join the word before,
    // opening ones (and anything after them) wait for the word after.
    for (const ch of part) {
      if (opening || /[\p{Ps}\p{Pi}]/u.test(ch)) opening += ch;
      else if (out.length) out[out.length - 1] += ch;
      else opening += ch;
    }
  }
  if (opening) {
    if (out.length) out[out.length - 1] += opening;
    else out.push(opening);
  }
  return out;
}

/**
 * The operator's text as paragraphs (their own line breaks) of tokens.
 * @param {string} text
 * @returns {Token[][]}
 */
export function tokenize(text) {
  /** @type {Token[][]} */
  const paras = [];
  for (const line of String(text ?? '').split(/\n+/)) {
    /** @type {Token[]} */
    const tokens = [];
    for (const word of line.split(/\s+/)) {
      if (word) splitRun(word).forEach((piece, i) => tokens.push({ text: piece, space: i === 0 }));
    }
    if (tokens.length) paras.push(tokens);
  }
  return paras;
}

/**
 * @param {string} text
 * @returns {string[][]} paragraphs (the operator's own line breaks) of tokens
 */
export function paragraphs(text) {
  return tokenize(text).map((p) => p.map((t) => t.text));
}

/**
 * Tokens `from`..`to`-1 as the text they read as on one line.
 * @param {Token[]} tokens
 * @param {number} [from]
 * @param {number} [to]
 */
export function joinTokens(tokens, from = 0, to = tokens.length) {
  let out = '';
  for (let i = from; i < to; i += 1) out += (i > from && tokens[i].space ? ' ' : '') + tokens[i].text;
  return out;
}

/* ── Direction ───────────────────────────────────────────────────── */

// Letters of the right-to-left scripts: Hebrew, Arabic, Syriac, Thaana, N'Ko,
// Samaritan, Mandaic and their presentation forms, and the historic and
// African right-to-left blocks of the supplementary planes.
const RTL_LETTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;

/**
 * Which way one token reads, from its first strong character (the rule
 * dir="auto" uses): 'rtl', 'ltr', 'num' for a number with no letters, or null
 * for punctuation and symbols, which take their direction from around them.
 * @param {string} text
 * @returns {'ltr' | 'rtl' | 'num' | null}
 */
export function tokenDirection(text) {
  let num = false;
  for (const ch of text) {
    if (ch === '\u200E') return 'ltr';
    if (ch === '\u200F' || ch === '\u061C') return 'rtl';
    if (/\p{L}/u.test(ch)) return RTL_LETTER.test(ch) ? 'rtl' : 'ltr';
    if (/\p{N}/u.test(ch)) num = true;
  }
  return num ? 'num' : null;
}

/**
 * The headline's direction and its runs against it, token by token.
 *
 * Every headline token is its own box (SlideCopy), and the bidi algorithm
 * sees a box as one neutral object: left alone, a Hebrew phrase in an English
 * sentence, or English in a Hebrew one, would lay its words out in the
 * paragraph's order, reversed for its reader. So the page isolates each run
 * of two or more tokens that read against the paragraph, in the run's own
 * direction (bidiIsolates). The runs follow the bidi algorithm's own rules at
 * the level of tokens: the paragraph takes the direction of its first strong
 * token; a number reads with the text before it; a token of punctuation
 * between two tokens of one direction takes it, and otherwise the paragraph's.
 *
 * It depends on the words alone (the READ.joiner a run-on list gains is
 * punctuation, which changes no token's direction), never on the fit, so a
 * refit never moves a token into or out of a run.
 *
 * @param {Array<{ text: string }>} tokens
 * @returns {{ dir: 'ltr' | 'rtl', runs: Array<{ from: number, to: number, dir: 'ltr' | 'rtl' }> }}
 *   runs: tokens `from`..`to`-1, in order, none overlapping
 */
export function bidiRuns(tokens) {
  const types = tokens.map((t) => tokenDirection(t.text));
  /** @type {'ltr' | 'rtl'} */
  const dir = /** @type {any} */ (types.find((d) => d === 'ltr' || d === 'rtl')) ?? 'ltr';
  let strong = dir;
  /** @type {Array<'ltr' | 'rtl' | null>} */
  const resolved = types.map((d) => {
    if (d === 'ltr' || d === 'rtl') strong = d;
    return d === null ? null : strong;
  });
  for (let i = 0; i < resolved.length;) {
    if (resolved[i] !== null) { i += 1; continue; }
    let j = i;
    while (j < resolved.length && resolved[j] === null) j += 1;
    const before = i > 0 ? resolved[i - 1] : dir;
    const after = j < resolved.length ? resolved[j] : dir;
    resolved.fill(before === after ? before : dir, i, j);
    i = j;
  }
  /** @type {Array<{ from: number, to: number, dir: 'ltr' | 'rtl' }>} */
  const runs = [];
  for (let i = 0; i < resolved.length;) {
    if (resolved[i] === dir) { i += 1; continue; }
    let j = i;
    while (j < resolved.length && resolved[j] !== dir) j += 1;
    runs.push({ from: i, to: j, dir: dir === 'ltr' ? 'rtl' : 'ltr' });
    i = j;
  }
  return { dir, runs };
}

// A character the bidi algorithm places by the text around it rather than by
// itself: anything but a letter, a digit, a combining mark or a direction
// mark (punctuation, quotes, brackets, symbols, emoji, READ.joiner).
const NEUTRAL = /[^\p{L}\p{N}\p{M}\u200E\u200F\u061C]/u;
// The signs a number carries as its own (50%, $5, 30°): the bidi algorithm
// reads them as part of the number, never as neutrals beside it.
const NUMBER_SIGN = /[#%°‰‱′″‴\p{Sc}\u066A]/u;
const DIGIT = /\p{Nd}/u;

/**
 * One token as [lead, core, trail]: the neutral characters before its first
 * letter or digit, the rest, and the neutrals after its last. A token of
 * neutrals alone is all core.
 * @param {string} text
 * @returns {[string, string, string]}
 */
export function edgeNeutrals(text) {
  const chars = [...text];
  let a = 0;
  while (a < chars.length && NEUTRAL.test(chars[a])) a += 1;
  if (a === chars.length) return ['', text, ''];
  let b = chars.length;
  while (b > a && NEUTRAL.test(chars[b - 1])) b -= 1;
  if (DIGIT.test(chars[a])) while (a > 0 && NUMBER_SIGN.test(chars[a - 1])) a -= 1;
  if (DIGIT.test(chars[b - 1])) while (b < chars.length && NUMBER_SIGN.test(chars[b])) b += 1;
  return [chars.slice(0, a).join(''), chars.slice(a, b).join(''), chars.slice(b).join('')];
}

/**
 * The runs the page isolates in a <bdi dir> of their own, and the neutrals
 * each leaves outside it.
 *
 * Inside the <bdi> every word's box takes the run's direction, and a box lays
 * out its own punctuation by its own direction. Between two words of the run
 * that is right: the plain bidi algorithm puts the comma in "שבת, שלום" on the
 * run's side too. But the neutrals at the run's two edges sit between the run
 * and the headline, and there the algorithm gives them the headline's
 * direction: "Say שלום, friends!" keeps its comma after the Hebrew, and
 * "مرحبا بكم في Awana!" its "!" at the end of the Arabic sentence. So the
 * first word's leading neutrals and the last word's trailing ones (quotes, a
 * comma, a full stop, READ.joiner's dot) are drawn outside the <bdi>, in the
 * headline's own direction.
 *
 * A run of one token is not isolated at all: a single box already places
 * itself in the headline's order whatever it holds, and inside, in the
 * headline's direction, it lays its letters and punctuation out as the plain
 * algorithm would ("שלום," after "Say", "ל-Awana" as typed).
 *
 * Its runs are bidiRuns', so they come from the words alone; the neutrals
 * follow the tokens it is given, so in a run-on list a run's `trail` carries
 * READ.joiner. The page keeps a slot for both edges of every run in every fit
 * (SlideCopy), so a refit only changes what they hold.
 *
 * @param {Array<{ text: string }>} tokens
 * @returns {Array<{ from: number, to: number, dir: 'ltr' | 'rtl', lead: string, trail: string }>}
 *   lead: the part of token `from`'s text drawn before the <bdi>;
 *   trail: the part of token `to`-1's drawn after it
 */
export function bidiIsolates(tokens) {
  return bidiRuns(tokens).runs
    .filter((run) => run.to - run.from > 1)
    .map((run) => ({ ...run, lead: edgeNeutrals(tokens[run.from].text)[0], trail: edgeNeutrals(tokens[run.to - 1].text)[2] }));
}

/* ── Line breaking ───────────────────────────────────────────────── */

/**
 * Split one paragraph into exactly `k` lines so the longest is as short as
 * possible (the balanced break a poster setter would make: MAKING /
 * BOOKMARKS, BRING YOUR / HANDBOOK). Never inside a token.
 * @param {number[]} widths each token's width
 * @param {number | number[]} gaps the gap before each token (a space, or 0 for a token that joins), or one width for every gap
 * @param {number} k
 * @returns {{ max: number, breaks: number[] }} breaks: index of each line's first token
 */
export function balancedBreaks(widths, gaps, k) {
  const n = widths.length;
  const lines = Math.max(1, Math.min(k, n));
  /** @param {number} i */
  const gap = (i) => (typeof gaps === 'number' ? gaps : gaps[i] ?? 0);
  const prefix = [0];
  const gapped = [0];
  for (let i = 0; i < n; i += 1) {
    prefix.push(prefix[i] + widths[i]);
    gapped.push(gapped[i] + (i > 0 ? gap(i) : 0));
  }
  /** @param {number} i @param {number} j tokens i..j-1 */
  const span = (i, j) => prefix[j] - prefix[i] + gapped[j] - gapped[i + 1];
  // best[l][j]: the least possible longest line setting tokens 0..j-1 in l lines.
  const best = Array.from({ length: lines + 1 }, () => new Array(n + 1).fill(Infinity));
  const from = Array.from({ length: lines + 1 }, () => new Array(n + 1).fill(0));
  best[0][0] = 0;
  for (let l = 1; l <= lines; l += 1) {
    for (let j = l; j <= n; j += 1) {
      for (let i = l - 1; i < j; i += 1) {
        const cost = Math.max(best[l - 1][i], span(i, j));
        if (cost < best[l][j]) {
          best[l][j] = cost;
          from[l][j] = i;
        }
      }
    }
  }
  const breaks = [];
  for (let l = lines, j = n; l > 0; l -= 1) {
    const i = from[l][j];
    breaks.unshift(i);
    j = i;
  }
  return { max: best[lines][n], breaks };
}

/**
 * The fewest balanced lines that keep every line of one paragraph within
 * `limit`, as each line's first token, or null when a single token is wider
 * than that or it would take more than `maxLines`.
 * @param {number[]} widths
 * @param {number[]} gaps
 * @param {number} limit
 * @param {number} maxLines
 */
function fewestLines(widths, gaps, limit, maxLines) {
  if (Math.max(...widths) > limit) return null;
  // No line can be shorter than an even share of the words: skip the
  // (quadratic) balancing for any count that could never fit, which is every
  // count for a long paragraph.
  const total = widths.reduce((a, b) => a + b, 0);
  for (let k = 1; k <= Math.min(maxLines, widths.length); k += 1) {
    if (total / k > limit) continue;
    const { max, breaks } = balancedBreaks(widths, gaps, k);
    if (max <= limit) return breaks;
  }
  return null;
}

/**
 * Greedy fill (as a browser would wrap) then balanced (as text-wrap: balance
 * would): find how many lines a greedy fill needs, then the narrowest width
 * that still takes no more. A token wider than the limit gets lines of its
 * own (the caller cuts it) and is reported in `wide`.
 * @param {number[]} widths
 * @param {number[]} gaps
 * @param {number} limit
 * @returns {{ starts: number[], wide: number[] }} starts: each line's first token
 */
function wrapBalanced(widths, gaps, limit) {
  const n = widths.length;
  /** @param {number} w */
  const greedy = (w) => {
    /** @type {number[]} */
    const starts = [];
    let run = -1;
    for (let i = 0; i < n; i += 1) {
      if (widths[i] > limit) {
        starts.push(i);
        run = -1;
      } else if (run < 0 || run + gaps[i] + widths[i] > w) {
        starts.push(i);
        run = widths[i];
      } else {
        run += gaps[i] + widths[i];
      }
    }
    return starts;
  };
  const lines = greedy(limit).length;
  let lo = Math.max(0, ...widths.filter((w) => w <= limit));
  let hi = limit;
  if (lo < hi) {
    for (let step = 0; step < 18; step += 1) {
      const mid = (lo + hi) / 2;
      if (greedy(mid).length <= lines) hi = mid;
      else lo = mid;
    }
  }
  const wide = [];
  for (let i = 0; i < n; i += 1) if (widths[i] > limit) wide.push(i);
  return { starts: greedy(lo < limit ? hi : limit), wide };
}

/**
 * Cut one token too wide for any line into pieces that fit, between its
 * characters, greedily. Each piece is one row on the page, exactly as cut
 * here, so the rows the fit counts are the rows the room sees.
 * @param {string[]} chars its graphemes
 * @param {number[]} widths each grapheme's width
 * @param {number} limit
 */
function cutToken(chars, widths, limit) {
  const pieces = [];
  let piece = '';
  let run = 0;
  chars.forEach((ch, i) => {
    if (piece && run + widths[i] > limit * BREAK_SLACK) {
      pieces.push(piece);
      piece = '';
      run = 0;
    }
    piece += ch;
    run += widths[i];
  });
  if (piece) pieces.push(piece);
  return pieces;
}

/**
 * The measured tokens of one or more paragraphs in one face, ready to be
 * laid out at any size.
 * @typedef {{
 *   paras: Token[][],
 *   widths: number[][],
 *   gaps: number[][],
 *   cut: (p: number, i: number, limit: number) => string[],
 * }} Measured
 */

/**
 * @param {Token[][]} paras
 * @param {Face} face
 * @param {Measure} measure
 * @param {(text: string) => string} [cased]
 * @returns {Measured}
 */
function measured(paras, face, measure, cased = (t) => t) {
  const space = measure(' ', face) || 0.25;
  /** @type {Map<string, { chars: string[], widths: number[] }>} */
  const glyphs = new Map();
  return {
    paras,
    widths: paras.map((p) => p.map((t) => measure(cased(t.text), face))),
    gaps: paras.map((p) => p.map((t, i) => (i > 0 && t.space ? space : 0))),
    cut(p, i, limit) {
      const text = paras[p][i].text;
      let g = glyphs.get(text);
      if (!g) {
        const chars = graphemes(text);
        g = { chars, widths: chars.map((ch) => measure(cased(ch), face)) };
        glyphs.set(text, g);
      }
      return cutToken(g.chars, g.widths, limit);
    },
  };
}

/**
 * One layout of measured paragraphs at one width: each paragraph starts a
 * new row, rows are balanced, and a token wider than `limit` fills rows of
 * its own, cut between its characters.
 * @param {Measured} m
 * @param {number} limit
 */
function layRows(m, limit) {
  /** @type {Array<{ start: number, text: string }>} */
  const rows = [];
  /** @type {number[]} */
  const wide = [];
  let offset = 0;
  m.paras.forEach((tokens, p) => {
    const laid = wrapBalanced(m.widths[p], m.gaps[p], limit);
    laid.starts.forEach((start, r) => {
      if (m.widths[p][start] > limit) {
        for (const text of m.cut(p, start, limit)) rows.push({ start: start + offset, text });
      } else {
        rows.push({ start: start + offset, text: joinTokens(tokens, start, laid.starts[r + 1] ?? tokens.length) });
      }
    });
    wide.push(...laid.wide.map((i) => i + offset));
    offset += tokens.length;
  });
  return { rows, wide };
}

/**
 * @param {Token[]} tokens
 * @param {number[]} starts
 */
function rowTexts(tokens, starts) {
  return starts.map((start, r) => joinTokens(tokens, start, starts[r + 1] ?? tokens.length));
}

/* ── The fit ─────────────────────────────────────────────────────── */

/**
 * The fitted headline. `tokens` is every token in order (as displayed: a
 * run-on list carries its separators); `lines` is each row's text and
 * `starts` the token each row starts with. A token in `wide` is wider than
 * any line and fills the rows that repeat its index, cut between its
 * characters. `joined`: the operator's line breaks could not all fit, so the
 * lines run on, separated by READ.joiner. `rise` (em, one per row) is the
 * extra room a row's marks need above it, on top of the line height (0 for
 * plain caps, which is every row of nearly every slide); `padBottom` (em) is
 * the room below the last row: the shout's shadow, and a mark's that hangs.
 * @typedef {{
 *   mode: 'shout' | 'read',
 *   size: number,
 *   lineHeight: number,
 *   rise: number[],
 *   padBottom: number,
 *   tokens: Token[],
 *   lines: string[],
 *   starts: number[],
 *   wide: number[],
 *   joined: boolean,
 * }} HeadlineFit
 *
 * @typedef {{
 *   top: number,
 *   height: number,
 *   kicker: { text: string, size: number, lines: string[], lineHeight: number } | null,
 *   headline: HeadlineFit,
 *   sub: { size: number, lines: string[] } | null,
 *   chip: { label: string, value: string, size: number, height: number } | null,
 * }} FrameFit
 */

/** @param {number} max @param {number} min @param {number} step */
function sizes(max, min, step) {
  const out = [];
  for (let s = max; s >= min - 1e-9; s -= step) out.push(Math.round(s * 100) / 100);
  return out;
}

/**
 * The kicker: one line at its size if it fits the layout's width, else
 * shrunk to fit down to KICKER.min, else two balanced lines, shrunk only as
 * far as it takes for the longer of them to fit. Never wider than
 * LAYOUT.width, whatever the operator typed.
 * @param {string} text
 * @param {Measure} measure
 */
function fitKicker(text, measure) {
  const tokens = tokenize(text).flat();
  /** @param {string} t */
  const em = (t) => measure(t.toUpperCase(), 'label') + KICKER.tracking * [...t].length;
  const widths = tokens.map((t) => em(t.text));
  const space = em(' ');
  const gaps = tokens.map((t, i) => (i > 0 && t.space ? space : 0));
  let set = balancedBreaks(widths, gaps, 1);
  let size = Math.min(KICKER.size, LAYOUT.width / set.max);
  if (size < KICKER.min && tokens.length > 1) {
    set = balancedBreaks(widths, gaps, 2);
    size = Math.min(KICKER.size, LAYOUT.width / set.max);
  }
  const lines = rowTexts(tokens, set.breaks);
  return { text, size, lines, lineHeight: lines.length > 1 ? KICKER.wrappedLineHeight : KICKER.lineHeight };
}

/**
 * Fit a frame to the lobby: the kicker to the layout's width, the supporting
 * line and the chip at their own sizes, and the headline to whatever height
 * is left, as big as it will go.
 *
 * The headline is shouted (uppercase Paytone One) when it can be: first with
 * up to three lines no longer than the mockup's measure (68u) from 7.6u down
 * to 6.3u, then with up to two lines at the full width (84u) from 7.6u down
 * to 5.3u, taking the first size that fits, with the room its marks need. Words are measured in the real face and
 * never broken. Text that cannot shout at 5.3u is read instead (sentence case
 * Figtree, 4.2u down to 1.5u, balanced lines of at most 76u, in the theme's
 * reading ink), and so is any slide set to "md" and any headline in a script
 * that stacks its marks (STACKED). Explicit "xl" and "lg" cap
 * the shouted size. The operator's line breaks are kept down to 1.5u; below
 * that the lines run on, separated by a dot. Whatever the text, the block
 * never reaches past LAYOUT.safeBottom, never runs wider than LAYOUT.width,
 * and a row wider than LAYOUT.clearWidth never rises above LAYOUT.clearTop.
 *
 * @param {Frame} frame
 * @param {Measure} [measure]
 * @param {MeasureInk} [ink]
 * @returns {FrameFit}
 */
export function fitFrame(frame, measure = measureText, ink = measureInk) {
  const kicker = frame.kicker ? fitKicker(frame.kicker, measure) : null;
  const kickerH = kicker ? kicker.lines.length * kicker.size * kicker.lineHeight + KICKER.gap : 0;

  // Chip: fixed size, its height from the kit's own geometry.
  let chip = null;
  if (frame.chip) {
    const g = chipGeometry(measure(frame.chip.label, 'shout'), measure(frame.chip.value, 'shout'));
    chip = { ...frame.chip, size: CHIP.size, height: g.height * CHIP.size };
  }
  const chipH = chip ? CHIP.gap + chip.height : 0;

  // Supporting line: body face, a few balanced lines.
  let sub = null;
  if (frame.sub) {
    const m = measured([tokenize(frame.sub).flat()], 'body', measure);
    for (const s of sizes(SUB.size, SUB.min, SUB.step)) {
      const { rows } = layRows(m, SUB.width / s);
      sub = { size: s, lines: rows.map((r) => r.text) };
      if (rows.length <= SUB.maxLines) break;
    }
  }
  const subH = sub ? SUB.gap + sub.lines.length * sub.size * SUB.lineHeight : 0;
  const paras = tokenize(frame.headline);

  /** @param {number} safeTop */
  const layout = (safeTop) => {
    const room = LAYOUT.safeBottom - safeTop - kickerH - chipH - subH;
    const headline = fitHeadline(paras, frame.textSize, room, measure, ink, Boolean(kicker));
    const headH = headline.lines.length
      ? (headline.lines.length * headline.lineHeight + sum(headline.rise) + headline.padBottom) * headline.size
      : 0;
    const height = kickerH + headH + subH + chipH - (kicker && !headH ? KICKER.gap : 0);
    const top = Math.max(safeTop, Math.min(LAYOUT.top, LAYOUT.safeBottom - height));
    return { top, height, kicker, headline, sub, chip };
  };

  const fit = layout(LAYOUT.safeTop);
  return crowdsTheCorners(fit, measure) ? layout(LAYOUT.clearTop) : fit;
}

/**
 * Whether any row of a fitted block starts above LAYOUT.clearTop and is
 * wider than LAYOUT.clearWidth, where it would run into the corner tab or
 * the top-right stack.
 * @param {FrameFit} fit
 * @param {Measure} measure
 */
function crowdsTheCorners(fit, measure) {
  if (fit.top >= LAYOUT.clearTop - 1e-9) return false;
  /** @type {Array<[number, number]>} each row's height and width, top down */
  const rows = [];
  if (fit.kicker) {
    const { size, lines, lineHeight } = fit.kicker;
    lines.forEach((line, i) => rows.push([
      size * lineHeight + (i === lines.length - 1 ? KICKER.gap : 0),
      (measure(line.toUpperCase(), 'label') + KICKER.tracking * [...line].length) * size,
    ]));
  }
  const h = fit.headline;
  // A row starts at the top of its marks' room.
  h.lines.forEach((line, i) => {
    rows.push([h.size * (h.lineHeight + (h.rise[i] ?? 0)), measure(h.mode === 'shout' ? line.toUpperCase() : line, h.mode) * h.size]);
  });
  let y = fit.top;
  for (const [height, width] of rows) {
    if (y >= LAYOUT.clearTop - 1e-9) return false;
    if (width > LAYOUT.clearWidth) return true;
    y += height;
  }
  return false;
}

/**
 * @param {Token[][]} paras
 * @param {string} textSize
 * @param {number} room the height left for the headline, in u
 * @param {Measure} measure
 * @param {MeasureInk} ink
 * @param {boolean} kicker whether a kicker sits above it
 * @returns {HeadlineFit}
 */
function fitHeadline(paras, textSize, room, measure, ink, kicker) {
  const tokens = paras.flat();
  if (!tokens.length) {
    return {
      mode: 'shout', size: SHOUT.max, lineHeight: SHOUT.lineHeight, rise: [], padBottom: SHOUT.shadow, tokens, lines: [], starts: [], wide: [], joined: false,
    };
  }
  const shouts = textSize !== 'md' && !tokens.some((t) => STACKED.test(t.text));
  return (shouts && fitShout(paras, textSize, room, measure, ink, kicker)) || fitRead(paras, room, measure);
}

/** @param {number[]} list */
const sum = (list) => list.reduce((a, b) => a + b, 0);

/**
 * The room a shouted headline's marks need, in em. Plain caps sit at
 * SHOUT.lineHeight with the shadow's own room below and nothing else. A mark
 * above a capital, or below one (É, Ễ, Ș, Ç), reaches well past a caps row,
 * so the row it would crowd gets exactly the extra room it needs (`rise`,
 * per row, which the page sets as a top margin on that row's words, so each
 * row keeps its own pitch and an accent on one row never spreads the rest):
 * - between two rows, enough that the lower row's marks clear the upper
 *   row's ink and shadow by SHOUT.markGap;
 * - above the first row, enough that its marks stay inside the headline's
 *   box, less the kicker's gap when there is a kicker (a mark may rise into
 *   that gap, never to within SHOUT.markGap of the kicker);
 * - below the last row, the shadow's room or a hanging mark's, whichever is
 *   deeper (`padBottom`).
 * @param {string[]} lines each row's text, as shouted
 * @param {(text: string) => { ascent: number, descent: number }} inkOf
 * @param {number} size the headline's size, in u
 * @param {boolean} kicker whether a kicker sits KICKER.gap above it
 * @returns {{ lineHeight: number, rise: number[], padBottom: number }}
 */
export function shoutBox(lines, inkOf, size, kicker) {
  const lineHeight = SHOUT.lineHeight;
  const inks = lines.map((line) => inkOf(line));
  if (!inks.length) return { lineHeight, rise: [], padBottom: SHOUT.shadow };
  /** @param {number} n */
  const up = (n) => Math.max(0, Math.ceil(n * 1000 - 1e-6) / 1000);
  const room = kicker ? Math.max(0, KICKER.gap / size - SHOUT.markGap) : 0;
  const rise = inks.map((ink, i) => (i === 0
    ? up(inkOverflow(ink, lineHeight).top - room)
    : up(inks[i - 1].descent + SHOUT.shadow + SHOUT.markGap + ink.ascent - lineHeight)));
  // The shadow hangs below the last row's ink, marks and all.
  const last = inks[inks.length - 1];
  const bottom = inkOverflow({ ascent: 0, descent: last.descent + SHOUT.shadow }, lineHeight).bottom;
  return { lineHeight, rise, padBottom: Math.max(SHOUT.shadow, bottom) };
}

/**
 * @param {Token[][]} paras
 * @param {string} textSize
 * @param {number} room
 * @param {Measure} measure
 * @param {MeasureInk} ink
 * @param {boolean} kicker
 * @returns {HeadlineFit | null}
 */
function fitShout(paras, textSize, room, measure, ink, kicker) {
  const ceiling = SHOUT.ceiling[textSize] ?? SHOUT.max;
  const m = measured(paras, 'shout', measure, (t) => t.toUpperCase());
  /** @type {Map<string, { ascent: number, descent: number }>} */
  const inks = new Map();
  /** @param {string} line */
  const inkOf = (line) => {
    const text = line.toUpperCase();
    let got = inks.get(text);
    if (!got) {
      got = ink(text, 'shout');
      inks.set(text, got);
    }
    return got;
  };
  // First at the mockup's measure, down to `measured`; only then the full
  // width, down to `min`. A long headline would rather step down a little
  // than run edge to edge. Three lines only at the measure: three full-width
  // lines of caps are a wall, and a headline that long reads better in the
  // read layout.
  const passes = [
    ...sizes(ceiling, Math.min(ceiling, SHOUT.measured), SHOUT.step).map((s) => [s, LAYOUT.measure, SHOUT.maxLines]),
    ...sizes(ceiling, SHOUT.min, SHOUT.step).map((s) => [s, LAYOUT.width, SHOUT.wideLines]),
  ];
  for (const [s, limit, most] of passes) {
    if (s * SHOUT.lineHeight * paras.length > room) continue;
    const em = limit / s - SHOUT.shadow;
    /** @type {number[]} */
    const starts = [];
    let offset = 0;
    let complete = true;
    for (let p = 0; p < paras.length && complete; p += 1) {
      const breaks = fewestLines(m.widths[p], m.gaps[p], em, most);
      if (breaks) starts.push(...breaks.map((b) => b + offset));
      else complete = false;
      offset += paras[p].length;
    }
    if (!complete || starts.length > most) continue;
    const tokens = paras.flat();
    const lines = rowTexts(tokens, starts);
    const box = shoutBox(lines, inkOf, s, kicker);
    if ((starts.length * box.lineHeight + sum(box.rise) + box.padBottom) * s <= room) {
      return { mode: 'shout', size: s, ...box, tokens, lines, starts, wide: [], joined: false };
    }
  }
  return null;
}

/**
 * The read layout at every size from `max` down to `min`: the first size
 * that fits without cutting a word, unless a word is wider than a whole
 * line even at READ.wordFloor, in which case the largest size that fits
 * with that word cut across rows of its own.
 * @param {Measured} m
 * @param {number} room
 * @param {number} max
 * @param {number} min
 */
function readFit(m, room, max, min) {
  /** @type {null | { size: number, rows: Array<{ start: number, text: string }>, wide: number[] }} */
  let cut = null;
  for (const s of sizes(max, min, READ.step)) {
    const { rows, wide } = layRows(m, READ.width / s - READ.shadow);
    const fits = rows.length * s * READ.lineHeight + s * READ.shadow <= room + 1e-9;
    if (fits && !wide.length) return { size: s, rows, wide };
    if (fits && !cut) cut = { size: s, rows, wide };
    if (cut && wide.length && s <= READ.wordFloor + 1e-9) return cut;
  }
  return cut;
}

/**
 * @param {Token[][]} paras
 * @param {number} room
 * @param {Measure} measure
 * @returns {HeadlineFit}
 */
function fitRead(paras, room, measure) {
  /**
   * @param {Token[][]} ps
   * @param {boolean} joined
   * @param {{ size: number, rows: Array<{ start: number, text: string }>, wide: number[] }} r
   * @returns {HeadlineFit}
   */
  const done = (ps, joined, r) => ({
    mode: 'read',
    size: r.size,
    lineHeight: READ.lineHeight,
    rise: r.rows.map(() => 0),
    padBottom: READ.shadow,
    tokens: ps.flat(),
    lines: r.rows.map((row) => row.text),
    starts: r.rows.map((row) => row.start),
    wide: r.wide,
    joined,
  });

  const kept = readFit(measured(paras, 'read', measure), room, READ.max, READ.floor);
  if (kept) return done(paras, false, kept);

  // The operator's breaks cannot all fit at a readable size (a list of
  // twenty names, one per line): run the lines on, a dot between each, so
  // the block still fits instead of running down behind the house waves.
  const joined = paras.length > 1;
  const run = joined
    ? [paras.flatMap((p, i) => p.map((t, j) => (i < paras.length - 1 && j === p.length - 1 ? { ...t, text: t.text + READ.joiner } : t)))]
    : paras;
  const m = measured(run, 'read', measure);
  const ran = readFit(m, room, READ.max, READ.floor) ?? readFit(m, room, READ.floor - READ.step, READ.last);
  if (ran) return done(run, joined, ran);
  // No frame an operator can type gets here: the smallest there is.
  return done(run, joined, { size: READ.last, ...layRows(m, READ.width / READ.last) });
}

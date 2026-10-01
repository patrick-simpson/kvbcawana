import { createElement, Fragment, useMemo, useState } from 'react';
import { M } from '../lib/motion.jsx';
import { EASE, shoutBaseline } from '../lib/brand.js';
import { useFontsReady } from '../hooks/useFontsReady.js';
import StepChip from './brand/StepChip.jsx';
import { CHIP, KICKER, READ, SUB, bidiIsolates, fitFrame, LOBBY_THEMES, lobbyTheme } from '../lib/lobbyFrame.js';
import {
  HANDOFF, copyBeats, entranceHold, exitDelay, holdThenLand, holdThenLeave, vanishAtSwap, wordLanding,
} from '../lib/lobbyMotion.js';
import { squishLand, withSquish } from '../lib/squish.js';

/** A length in the lobby's unit (see src/lib/lobbyFrame.js). */
const u = (n) => `calc(${n} * var(--u))`;

// The fit measures words in these faces, and a face the browser has not
// fetched yet measures as its fallback. Web fonts load on first use, so ask
// for all four as soon as the lobby is imported: the first slide is then
// fitted in the real faces instead of refitting a beat later.
if (typeof document !== 'undefined' && document.fonts?.load) {
  for (const font of ['400 1em "Paytone One"', '800 1em "Figtree Variable"', '700 1em "Figtree Variable"', '400 1em "Londrina Solid"']) {
    document.fonts.load(font).catch(() => {});
  }
}

/**
 * One piece of copy that lands and leaves on its own beat. `still` (the slide
 * editor's thumbnails) renders the plain element at rest; otherwise it is an
 * M element whose entrance is one "hold, then land" keyframe list, fixed at
 * mount, and whose exit is a variant AnimatePresence resolves with its
 * `custom` (true: the stinger is covering the change).
 */
function Piece({ tag = 'span', still, enter, leave, children, ...rest }) {
  if (still) return createElement(tag, rest, children);
  const Tag = M[tag];
  return (
    <Tag
      {...rest}
      initial={enter.initial}
      animate={enter.animate}
      transition={enter.transition}
      variants={leave}
      exit="leave"
    >
      {children}
    </Tag>
  );
}

/**
 * A headline token's own style: a word too wide for any line is held inside
 * the read layout's width, and a word on a row whose marks need room above it
 * carries that room (em) as a top margin.
 * @param {boolean} wide
 * @param {number} rise
 */
function wordStyle(wide, rise) {
  if (!wide && !rise) return undefined;
  return { ...(wide ? { maxWidth: u(READ.width) } : null), ...(rise ? { marginTop: `${rise}em` } : null) };
}

/** Lift away (a hand-off) or wait for the wave and go (a wipe). */
function leaveFor(i, n) {
  return {
    leave: (wipe) => (wipe
      ? vanishAtSwap({ opacity: 1 }, { opacity: 0 })
      : holdThenLeave(exitDelay(i, n), HANDOFF.exit, { opacity: 1, y: '0em' }, { opacity: 0, y: '-0.5em' }, EASE.exit)),
  };
}

/**
 * Where the headline needs a <br>: at every row's first token, except where
 * a word too wide for any line (set as a block of its own) already ends or
 * starts the row.
 * @param {import('../lib/lobbyFrame.js').HeadlineFit} h
 */
function rowBreaks(h) {
  const wide = new Set(h.wide);
  return new Set(h.starts.filter((t) => t > 0 && !wide.has(t) && !wide.has(t - 1)));
}

/**
 * The lobby's copy frame, from the approved mockup: a kicker in Londrina
 * Solid, the headline in true-size Paytone One with a hard offset shadow, an
 * optional supporting line and an optional stepped chip, centred on the
 * upper middle of the 16:9 stage box. Sizes and line breaks come from the
 * pure fit (src/lib/lobbyFrame.js), measured in the real faces and redone
 * when a web font finishes loading.
 *
 * A refit never replays anything. Every headline token is one element in
 * both layouts (the shout and the read), keyed by its place in the text,
 * with the rows split by <br>; and the beat sheet (when each piece lands,
 * and from where) is fixed when the copy first appears. So a face that lands
 * late (a cold cache, a slow church network) only re-lays the same elements
 * out: nothing that has started landing disappears and lands again. Holding
 * the entrance for the fonts instead would still need this for a face that
 * lands after any timeout, and would hold every slide on a slow network.
 *
 * On a hand-off the incoming copy mounts beside the outgoing one and holds
 * invisible until the outgoing words have lifted clear (`via` decides how
 * long); then the kicker lands, the words land one by one (a read layout row
 * by row) and the chip pops last. Every colour rides on the copy itself, so
 * an outgoing slide never repaints in the incoming slide's theme mid-exit.
 * The copy's own direction comes from its text (dir="auto"), so a Hebrew or
 * Arabic headline's words run right to left; and because the bidi algorithm
 * sees each word's box as one neutral object, every run of two or more words
 * that reads against the headline (a Hebrew phrase in English, English in
 * Hebrew) sits in a <bdi> of its own direction (bidiIsolates), so its words
 * keep their order, with the punctuation at its two edges drawn outside it,
 * in the headline's direction, as plain text would place it. The runs come
 * from the words alone, so a refit never moves a word into or out of one, and
 * both of a run's edge slots are there in every fit: a refit that runs a list
 * on (READ.joiner) or draws a long word whole only changes the slots' text.
 *
 * @param {{
 *   frame: import('../lib/lobbyFrame.js').Frame,
 *   theme?: string,
 *   via?: import('../lib/lobbyMotion.js').Via,
 *   still?: boolean,
 *   slide?: boolean,
 *   sizeClass?: string,
 *   className?: string,
 * }} props
 *
 * `slide` marks a slide's copy (the slideshow and the editor's thumbnails)
 * with the typed-slide class names the rest of the app already looks for
 * (manual-slide-eyebrow / -text / -subtext); the idle placeholder is not a
 * slide and never carries them.
 */
export default function SlideCopy({ frame, theme = 'sky', via = 'boot', still = false, slide = false, sizeClass = '', className = '' }) {
  const loads = useFontsReady();
  const { kicker, headline, sub, chip, textSize } = frame;
  const chipLabel = chip?.label ?? '';
  const chipValue = chip?.value ?? '';
  const fit = useMemo(() => {
    void loads; // re-measure once the real faces have loaded
    return fitFrame({
      kicker, headline, sub, textSize,
      chip: chipLabel && chipValue ? { label: chipLabel, value: chipValue } : null,
    });
  }, [kicker, headline, sub, textSize, chipLabel, chipValue, loads]);

  // How long this copy waits before it lands, and then the whole beat sheet,
  // fixed when the copy first appears. Only an edit to the words themselves
  // (the editor saving the slide on screen) writes a new one.
  const [hold] = useState(() => entranceHold(via));
  const words = JSON.stringify([kicker, headline, sub, chipLabel, chipValue]);
  const [sheet, setSheet] = useState(() => ({ words, mode: fit.headline.mode, beats: copyBeats(fit, hold) }));
  let { mode: landing, beats } = sheet;
  if (sheet.words !== words) {
    landing = fit.headline.mode;
    beats = copyBeats(fit, hold);
    setSheet({ words, mode: landing, beats });
  }

  const t = LOBBY_THEMES[lobbyTheme(theme)];
  const h = fit.headline;
  const breaks = rowBreaks(h);
  const wide = new Set(h.wide);
  const leave = (beat) => leaveFor(beat.index, beats.pieces);
  const tokenBeat = (i) => beats.tokens[i] ?? beats.tokens[beats.tokens.length - 1] ?? { index: 0, at: hold };
  const runs = new Map(bidiIsolates(h.tokens).map((run) => [run.from, run]));
  // The row each token sits on, for a row whose marks need room above it
  // (the fit's `rise`): its words carry that room as a top margin, which
  // lifts that one line box and no other.
  const riseOf = (i) => {
    let r = 0;
    while (r + 1 < h.starts.length && h.starts[r + 1] <= i) r += 1;
    return h.rise?.[r] ?? 0;
  };
  // The text each token's own element draws: all of it, bar the neutrals at a
  // run's edges, which are drawn outside its <bdi> (edge). A word too wide for
  // any line keeps them: it is a block of rows of its own, and a piece drawn
  // after it would start a row the fit never counted.
  const own = h.tokens.map((t) => t.text);
  for (const run of runs.values()) {
    if (run.lead && !wide.has(run.from)) own[run.from] = own[run.from].slice(run.lead.length);
    if (run.trail && !wide.has(run.to - 1)) own[run.to - 1] = own[run.to - 1].slice(0, -run.trail.length);
  }
  // A shouted word squashes onto its baseline as it lands (src/lib/squish.js);
  // a read word only lands. Decided by the beat sheet's `landing` and timed by
  // its beat alone, never by the fit, so a refit never re-targets (and so
  // never replays) a word.
  const land = (i) => wordLanding(tokenBeat(i).at, HANDOFF.word, landing);
  const kickerAt = beats.kicker?.at ?? hold;
  const chipAt = beats.chip?.at ?? hold;

  /** Token `i`'s own element: always the last child of its fragment, so a refit never remounts it. */
  const word = (i) => (
    <Piece
      still={still}
      className={`lobby-word${wide.has(i) ? ' lobby-word--wide' : ''}`}
      style={wordStyle(wide.has(i), riseOf(i))}
      enter={land(i)}
      leave={leave(tokenBeat(i))}
    >
      {/* A word too wide for any line is drawn as the pieces the fit cut,
          one per row, so the page never needs a row the fit did not count. */}
      {wide.has(i)
        ? h.lines.filter((_, r) => h.starts[r] === i).map((piece, k) => <Fragment key={k}>{k > 0 && <br />}{piece}</Fragment>)
        : own[i]}
    </Piece>
  );
  /**
   * The neutrals at a run's edge, outside its <bdi>, so they take the
   * headline's direction as plain text would; they land and leave on their
   * word's beat. The space READ.joiner starts with stays plain text beside
   * them: a box of its own would drop it.
   *
   * What sits there depends on the fit (READ.joiner only in a run-on list,
   * nothing beside a word too wide for any line), but the slot does not: every
   * run has both, in every fit, and a refit only changes their text, because a
   * slot a refit mounted would land all over again. An empty one draws
   * nothing (app.css).
   */
  const edge = (i, text) => {
    const shown = wide.has(i) ? '' : text;
    return (
      <Fragment>
        {/^\s/u.test(shown) && ' '}
        <Piece still={still} className="lobby-punct" enter={land(i)} leave={leave(tokenBeat(i))}>{shown.trimStart()}</Piece>
      </Fragment>
    );
  };
  const space = (i) => i > 0 && h.tokens[i].space && ' ';
  const rowBreak = (i) => breaks.has(i) && <br />;
  /** The headline's children: each token, or a run of tokens against the headline's direction in a <bdi>. */
  const headlineWords = [];
  for (let i = 0; i < h.tokens.length;) {
    const run = runs.get(i);
    if (!run) {
      headlineWords.push(<Fragment key={i}>{space(i)}{rowBreak(i)}{word(i)}</Fragment>);
      i += 1;
      continue;
    }
    // The space and any row break before the run stay outside it, so they
    // sit between it and the word before, whichever way the run reads; so do
    // the neutrals at its two edges.
    const inside = [];
    for (let j = run.from; j < run.to; j += 1) {
      inside.push(<Fragment key={j}>{j > run.from && space(j)}{j > run.from && rowBreak(j)}{word(j)}</Fragment>);
    }
    headlineWords.push(
      <Fragment key={`run${run.from}`}>
        {space(i)}
        {rowBreak(i)}
        {edge(run.from, run.lead)}
        <bdi className="lobby-run" dir={run.dir}>{inside}</bdi>
        {edge(run.to - 1, run.trail)}
      </Fragment>,
    );
    i = run.to;
  }

  return (
    <div
      className={`lobby-copy ${className}`.trim()}
      style={{
        top: u(fit.top),
        '--lobby-kicker': t.kicker,
        '--lobby-face': t.face,
        '--lobby-shadow': t.shadow,
        '--lobby-sub': t.sub,
      }}
    >
      {fit.kicker && (
        <Piece
          tag="div"
          still={still}
          dir="auto"
          className={`lobby-kicker${slide ? ' manual-slide-eyebrow' : ''}`}
          style={{ fontSize: u(fit.kicker.size), lineHeight: fit.kicker.lineHeight, marginBottom: h.lines.length ? u(KICKER.gap) : 0 }}
          enter={withSquish(
            holdThenLand(kickerAt, HANDOFF.kicker, { opacity: 0, y: '0.52em' }, { opacity: 1, y: '0em' }, EASE.settle),
            squishLand(kickerAt, 'kicker', HANDOFF.kicker, 'settle'),
          )}
          leave={leave(beats.kicker ?? { index: 0 })}
        >
          {fit.kicker.lines.map((line, i) => <Fragment key={i}>{i > 0 && <br />}{line}</Fragment>)}
        </Piece>
      )}

      {h.lines.length > 0 && (
        <p
          dir="auto"
          className={`lobby-headline lobby-headline--${h.mode}${slide ? ` manual-slide-text ${sizeClass}` : ''}`.trim()}
          style={{ fontSize: u(h.size), lineHeight: h.lineHeight, paddingBottom: `${h.padBottom}em`, '--squish-baseline': `${shoutBaseline(h.lineHeight)}em` }}
          data-rows={h.lines.length}
        >
          {/* One element per token in both layouts, keyed by its place in
              the text, and always last in its fragment: a refit that moves
              a word to another row, or from the shout to the read layout,
              keeps the same element, so it never replays its entrance. */}
          {headlineWords}
        </p>
      )}

      {fit.sub && (
        <Piece
          tag="p"
          still={still}
          dir="auto"
          className={`lobby-sub${slide ? ' manual-slide-subtext' : ''}`}
          style={{ fontSize: u(fit.sub.size), marginTop: u(SUB.gap) }}
          enter={holdThenLand(beats.sub?.at ?? hold, HANDOFF.word, { opacity: 0, y: '0.4em' }, { opacity: 1, y: '0em' }, EASE.settle)}
          leave={leave(beats.sub ?? { index: 0 })}
        >
          {fit.sub.lines.map((l, i) => <span key={i} className="lobby-sub__line">{i > 0 && ' '}{l}</span>)}
        </Piece>
      )}

      {fit.chip && (
        <div className="lobby-chip-row" style={{ marginTop: u(CHIP.gap) }}>
          <Piece
            tag="div"
            still={still}
            className="lobby-chip"
            style={{ fontSize: u(fit.chip.size) }}
            enter={withSquish(
              holdThenLand(chipAt, HANDOFF.chip, { opacity: 0, scale: 0.4, rotate: -8 }, { opacity: 1, scale: 1, rotate: 0 }, EASE.pop),
              squishLand(chipAt, 'chip', HANDOFF.chip, 'pop'),
            )}
            leave={leave(beats.chip ?? { index: 0 })}
          >
            <StepChip label={fit.chip.label} value={fit.chip.value} size="1em" />
          </Piece>
        </div>
      )}
    </div>
  );
}

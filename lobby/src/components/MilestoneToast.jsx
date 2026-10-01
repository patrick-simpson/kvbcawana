import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { M } from '../lib/motion.jsx';
import { DUR, EASE, PLATE, beats, inkOverflow } from '../lib/brand.js';
import { measureInk, measureText } from '../lib/lobbyFrame.js';
import { holdThenLand } from '../lib/lobbyMotion.js';
import { squishLand, withSquish } from '../lib/squish.js';
import { isBigMilestone, ordinalNight } from '../lib/milestones.js';
import { OVERLAY, bandRoom, fitShout, plateChrome } from '../lib/overlayFit.js';
import { useFontsReady } from '../hooks/useFontsReady.js';
import StepPlate from './brand/StepPlate.jsx';
import DoodleCluster from './brand/DoodleCluster.jsx';
import ClubBadge from './ClubBadge.jsx';

/**
 * One celebration at a time (useCelebrationQueue), as a kit chip in the top
 * band: the catalog's stepped chip with a Londrina kicker on its pill and a
 * Paytone One line on its block, three sparkles popping on its shoulder. It sits
 * between the corner tab and the top-right stack, above the highest the
 * slide copy can rise, so it never covers the headline, and far above the
 * check-in wave, so it never covers a name (src/lib/overlayFit.js OVERLAY).
 *
 * The plate says what kind of moment it is:
 *   - a club's own milestone, or one child's Nth night: the club's colour,
 *     carrying the club's white wordmark (#332; the events e2e pins it);
 *   - the room's attendance (the doors opening, a night threshold, the
 *     every-Nth tally): the kit's one hot colour, the catalog's "this is
 *     special";
 *   - handbook progress (books, awards): Awana blue, so "10 books" reads
 *     apart from "100 kids" at a glance.
 * On a seasonal night the room-wide plates wear the skin (an echo of the
 * plate in --skin-a behind it, sparkles in --skin-b; app.css), and a club's
 * plate keeps the club's colours, the same rule the confetti follows.
 *
 * The line is fitted to the band by measurement (toastFit): one line from
 * 3.2u down to 2.1u, then the two most balanced lines, sized so the plate still
 * ends where the band ends; a first name too long even for that wraps
 * inside the band rather than running out of it. Its ink is measured too
 * (toastBox), so a mark over or under a capital ("MAXIMILIÁN", "NGUYỄN",
 * "ȘTEFAN") stays on the plate, clear of its keylines. `compact` is the band
 * with the flag strip hanging over it.
 *
 * The band is one at a time. With a band notice up (`afterNotice`) the toast
 * holds out of sight until the notice has lifted away, then pops; the notice
 * waits for the toast's exit in turn (NoticeBanner). A critical notice never
 * moves, so on an OBS feed, where it keeps to the band, the toast drops below
 * it (`below`); over the pickup board there is no room below, so App holds
 * the queue and a toast already up steps aside (`yielding`).
 */

// Band geometry for the fit, in u (app.css .milestone-toast carries the same).
const LABEL = 1.45;
const PAD_X = 1.2;
// The block's padding above and below the line (app.css .milestone-body).
const PAD = 0.6;
const PAD_Y = PAD * 2;
const LOGO = 7.4;
// Stage 4b-2 set the line in Galindo (3u down to 2u, two lines 2.2u down to
// 1.4u, at 1.02); Paytone One's caps stand 5.7% shorter at one size, so each
// size is that times 1.057 and the line height 1.02 / 1.057 (app.css
// .milestone-count carries it), which holds the caps and the plate.
// `shadow` is the line's hard offset shadow (its text-shadow, 0.05em), which
// hangs below a mark as it does below the caps; `markGap` the least clear
// space a mark keeps from the plate's edge or the row above (the kit's 0.06em,
// SHOUT.markGap and the chip's valueClear).
export const LINE = { max: 3.2, min: 2.1, twoLineMax: 2.3, twoLineMin: 1.5, lineHeight: 0.97, shadow: 0.05, markGap: 0.06 };
// The plate's out-of-register offset and keyline reach a little past its box.
const PLATE_SPILL = 0.3;

/** The pill's inset under the block, per the kit's chip (brand.js PLATE). */
const INSET = LABEL * 2.05 * 0.73;

// StepPlate draws the keyline centred on the block's edges and prints the fill
// out of register, `DROP` below them (both from the pill's height, brand.js
// PLATE): along the block's top, right of the pill, the room's own background
// shows between the keyline and the fill.
const PILL = LABEL * 2.05;
const KEYLINE = PILL * PLATE.keyline;
const DROP = PILL * PLATE.offsetY;

/**
 * The room the line's marks need on the plate. Plain caps sit well inside the
 * block's padding and get none, so nothing moves for them. Paytone One draws
 * the marks over and under its capitals tall (Á and É to 1.045em, Ễ 1.161em,
 * Ș's comma to -0.351em, where the line box at 0.97 runs from 0.747em to
 * -0.223em), and a mark past the padding would cross the keyline, so:
 * - `padTop` (u): above the line, enough that the first row's ink stays on the
 *   fill, LINE.markGap below its top edge (which sits DROP under the keyline);
 * - `padBottom` (u): below it, enough that the last row's ink and its shadow
 *   keep LINE.markGap off the bottom keyline's inner edge;
 * - `rise` (em, per row): between two rows, enough that the lower row's marks
 *   clear the upper row's ink and shadow (shoutBox's rule for the lobby).
 * The page sets them as the line's padding and the row's top margin.
 * @param {string[]} lines each row's text, as written (it is shouted here)
 * @param {(text: string) => { ascent: number, descent: number }} inkOf the shout's ink, em
 * @param {number} size the line's size, u
 * @returns {{ padTop: number, padBottom: number, rise: number[] }}
 */
export function toastBox(lines, inkOf, size) {
  const inks = lines.map((line) => inkOf(String(line).toUpperCase()));
  if (!inks.length) return { padTop: 0, padBottom: 0, rise: [] };
  /** @param {number} n */
  const up = (n) => (n > 0 ? Math.ceil(n * 1000 - 1e-6) / 1000 : 0);
  const gap = LINE.markGap * size;
  const last = inks[inks.length - 1];
  const over = inkOverflow(inks[0], LINE.lineHeight).top * size;
  const under = inkOverflow({ ascent: 0, descent: last.descent + LINE.shadow }, LINE.lineHeight).bottom * size;
  return {
    padTop: up(over + DROP + gap - PAD),
    padBottom: up(under + KEYLINE / 2 + gap - PAD),
    rise: inks.map((ink, i) => (i === 0 ? 0
      : up(inks[i - 1].descent + LINE.shadow + LINE.markGap + ink.ascent - LINE.lineHeight))),
  };
}

/**
 * The line's fit for one toast. Pure and exported for tests: it never lets
 * the plate end below the band's bottom (bandRoom) while the line can still
 * be read at twoLineMin, counting the room its marks need (toastBox); a line
 * whose marks need more than the band has left is set as large as the room
 * allows on the same rows (the rule a chip's value follows, brand.js
 * valueSeat), so a plain line's size never changes.
 * @param {string} line
 * @param {{ compact?: boolean, logo?: boolean }} [opts]
 * @param {(text: string, face: import('../lib/lobbyFrame.js').Face) => number} [measure]
 * @param {(text: string, face: import('../lib/lobbyFrame.js').Face) => { ascent: number, descent: number }} [ink]
 */
export function toastFit(line, { compact = false, logo = false } = {}, measure = measureText, ink = measureInk) {
  const width = OVERLAY.band.width - INSET - PAD_X * 2 - (logo ? LOGO + 1 : 0);
  const room = bandRoom(compact) - plateChrome(LABEL) - PAD_Y - PLATE_SPILL;
  const tenth = (/** @type {number} */ v) => Math.floor(v * 10 + 1e-9) / 10;
  const fit = fitShout(line, {
    width,
    max: Math.min(LINE.max, tenth(room / LINE.lineHeight)),
    min: LINE.min,
    twoLineMax: Math.min(LINE.twoLineMax, tenth(room / (2 * LINE.lineHeight))),
    twoLineMin: LINE.twoLineMin,
  }, measure);
  // The rows the page sets: the fit's two, or the whole line left to wrap.
  const rows = fit.fits && fit.lines.length > 1 ? fit.lines : [String(line ?? '')];
  const inkOf = (/** @type {string} */ text) => ink(text, 'shout');
  const height = (/** @type {number} */ s, /** @type {{ padTop: number, padBottom: number, rise: number[] }} */ b) => (
    rows.length * s * LINE.lineHeight + b.padTop + b.padBottom + b.rise.reduce((a, r) => a + r, 0) * s);
  let size = fit.size;
  let box = toastBox(rows, inkOf, size);
  while (fit.fits && size > 0.5 && height(size, box) > room + 1e-9) {
    size = Number((size - 0.1).toFixed(3));
    box = toastBox(rows, inkOf, size);
  }
  return { ...fit, size, ...box };
}

/**
 * The words and the look for one celebration. Pure and exported for tests.
 * @param {any} c the celebration (useCelebrationQueue's current item)
 */
export function toastFor(c) {
  const kind = c.kind;
  const ofClub = kind === 'club' || kind === 'kid';
  const label = kind === 'club' ? c.club
    : kind === 'kid' ? `${c.firstName}’s`
      : c.label ? c.label
        : 'Checked in tonight';
  const line = kind === 'club' ? `${c.count} kids strong!`
    : kind === 'kid' ? `${ordinalNight(c.count)} club night!`
      : c.headline ? c.headline
        : `${c.count} kids!`;
  const className = kind === 'club' ? 'milestone-toast club-milestone'
    : kind === 'night' ? 'milestone-toast night-milestone'
      : kind === 'kid' ? 'milestone-toast kid-milestone'
        // Handbook progress (#358) is a room-wide occasion like a night
        // threshold, in its own colour so the room can tell "ten books"
        // from "a hundred kids".
        : kind === 'books' || kind === 'awards'
          ? `milestone-toast night-milestone handbook-milestone ${kind}-milestone`
          // The night's opening moment (#335).
          : kind === 'first' ? 'milestone-toast first-milestone'
            : 'milestone-toast';
  const tone = ofClub ? 'club' : kind === 'books' || kind === 'awards' ? 'handbook' : 'hot';
  return { label, line, className, tone, big: kind === 'first' || isBigMilestone(c.count) };
}

const SPARKLES = [
  { kind: 'sparkle', x: 'calc(100% - 1.2 * var(--u))', y: 'calc(-1.4 * var(--u))', size: 'calc(2.4 * var(--u))' },
  { kind: 'dot', x: 'calc(100% + 1.1 * var(--u))', y: 'calc(-0.2 * var(--u))', size: 'calc(0.9 * var(--u))' },
  { kind: 'sparkleX', x: 'calc(100% + 0.5 * var(--u))', y: 'calc(1.6 * var(--u))', size: 'calc(1.5 * var(--u))', rotate: 12 },
];

/**
 * @param {{
 *   celebration: any,
 *   club: any,
 *   compact?: boolean,
 *   below?: boolean,
 *   yielding?: boolean,
 *   afterNotice?: boolean,
 * }} props
 */
export default function MilestoneToast({ celebration, club, compact = false, below = false, yielding = false, afterNotice = false }) {
  useFontsReady();
  return (
    <AnimatePresence>
      {celebration != null && (
        <Toast
          key={`celebration-${celebration.kind}-${celebration.club ?? ''}-${celebration.firstName ?? ''}-${celebration.count}`}
          celebration={celebration}
          club={club}
          compact={compact}
          below={below}
          yielding={yielding}
          afterNotice={afterNotice}
        />
      )}
    </AnimatePresence>
  );
}

const FROM = { opacity: 0, y: '-35%', scale: 0.85 };
const TO = { opacity: 1, y: '0%', scale: 1 };
const AWAY = { opacity: 0, y: '-30%', scale: 0.96, transition: { duration: DUR.exit, ease: EASE.exit } };
// Stepping aside for a band notice: AWAY, with the squish's two axes sent
// home on AWAY's own timing, in case the notice takes the band mid-squish.
const YIELD = { ...AWAY, scaleX: 1, scaleY: 1 };

function Toast({ celebration, club, compact, below, yielding, afterNotice }) {
  const t = toastFor(celebration);
  const logo = t.tone === 'club' && club?.logo;
  const fit = toastFit(t.line, { compact: compact && !below, logo: Boolean(logo) });
  // The beat sheet is fixed when the toast appears: with a band notice up
  // it waits out the notice's exit, so the two never share the band. The
  // plate squashes at its pop's peak, hanging from the band (the soft squish,
  // src/lib/squish.js), unless it carries a club's wordmark: official art is
  // never scaled out of proportion.
  const [beat] = useState(() => {
    const hold = afterNotice ? DUR.exit : 0;
    return {
      hold,
      plate: withSquish(holdThenLand(hold, DUR.pop, FROM, TO, EASE.pop), logo ? null : squishLand(hold, 'plate', DUR.pop, 'pop')),
      line: holdThenLand(hold + beats(1.5), DUR.settle, { opacity: 0, y: '0.35em' }, { opacity: 1, y: '0em' }, EASE.settle),
    };
  });
  const plate = t.tone === 'club' ? (club?.primary || 'var(--brand-orange)')
    : t.tone === 'handbook' ? 'var(--brand-blue)'
      : 'var(--brand-hot)';
  const style = {
    '--toast-line': `calc(${fit.size} * var(--u))`,
    ...(t.tone === 'club' && club ? { '--club-deep': club.deep || 'rgba(3, 4, 4, 0.35)' } : null),
  };
  const lines = fit.lines.length > 1 && fit.fits;
  // Room for a mark (toastBox): only a line with one gets any.
  const pad = {
    ...(fit.padTop ? { paddingTop: `calc(${fit.padTop} * var(--u))` } : null),
    ...(fit.padBottom ? { paddingBottom: `calc(${fit.padBottom} * var(--u))` } : null),
  };
  return (
    <M.div
      className={`${t.className} milestone-toast--${t.tone}${t.big ? ' milestone-toast--big' : ''}${below ? ' milestone-toast--below' : ''}${compact && !below ? ' milestone-toast--compact' : ''}`}
      style={style}
      initial={beat.plate.initial}
      animate={yielding ? YIELD : { ...beat.plate.animate, transition: beat.plate.transition }}
      exit={AWAY}
    >
      <StepPlate
        label={t.label}
        plate={plate}
        labelClassName="milestone-label"
        bodyClassName="milestone-body"
      >
        {/* The club's own wordmark. `rawName` is deliberately NOT passed: an
            unknown club would otherwise render ClubBadge's title pill,
            duplicating the label. The wrapper supplies the variant
            orchestration ClubBadge's own variants expect. */}
        {logo && (
          <M.span className="milestone-badge" initial="hidden" animate="show">
            <ClubBadge club={club} />
          </M.span>
        )}
        <M.span
          className={`milestone-count${lines ? ' milestone-count--two' : ''}${fit.fits ? '' : ' milestone-count--wrap'}`}
          style={pad}
          initial={beat.line.initial}
          animate={beat.line.animate}
          transition={beat.line.transition}
        >
          {/* Two lines keep a real space between them, so the toast's text
              still reads as one sentence to anything that reads it. A line
              too long for even two (fits false) is left to wrap. */}
          {lines
            ? fit.lines.map((l, i) => (
              <span key={i} className="milestone-count__line" style={fit.rise[i] ? { marginTop: `${fit.rise[i]}em` } : undefined}>
                {i ? ' ' : ''}{l}
              </span>
            ))
            : t.line}
        </M.span>
      </StepPlate>
      <DoodleCluster className="milestone-doodles" items={SPARKLES} color="var(--toast-doodle, #fff)" delay={beat.hold + beats(3)} twinkle />
    </M.div>
  );
}

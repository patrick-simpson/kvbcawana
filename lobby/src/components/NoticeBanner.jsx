import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { M } from '../lib/motion.jsx';
import { DUR, EASE } from '../lib/brand.js';
import { holdThenLand } from '../lib/lobbyMotion.js';
import { squishLand, withSquish } from '../lib/squish.js';
import { isFresh, stampOf } from '../lib/freshness.js';
import { NOTICE_MAX_AGE_MS } from '../lib/constants.js';
import { OVERLAY, bandRoom, fitParagraph, plateChrome } from '../lib/overlayFit.js';
import { useFontsReady } from '../hooks/useFontsReady.js';
import StepPlate from './brand/StepPlate.jsx';

// Same coarse cadence as TonightTicker — expiry is measured in hours,
// so a 30s re-check is more than fine-grained enough.
export const NOTICE_CHECK_MS = 30000;

const EYEBROW = { critical: 'Attention', warn: 'Notice', info: 'FYI' };

// The fits, in u (app.css sizes the plates to match). A band notice reads in
// Figtree at up to 2.1u; a critical notice in the band shouts Figtree 800 at
// up to 2.4u; both are fitted to END by the band's bottom (bandRoom), so a
// 200-character message steps down, not onto the headline. The takeover
// card shouts Figtree 800 at up to 4.6u over three lines of the centre.
const BAND = { label: 1.25, padX: 1.1, padY: 1.15, lineHeight: 1.2, max: 2.1, min: 0.9, maxLines: 3, face: /** @type {const} */ ('body') };
const BAND_CRITICAL = { label: 1.4, padX: 1.1, padY: 1.15, lineHeight: 1.15, max: 2.4, min: 0.9, maxLines: 3, face: /** @type {const} */ ('read') };
const TAKEOVER = { label: 2, padX: 2, max: 4.6, min: 2.2, maxLines: 3 };
const inset = (label) => label * 2.05 * 0.73;
// The plate's out-of-register offset and keyline reach a little past its box.
const PLATE_SPILL = 0.3;

/**
 * Is this notice on screen at `now`? The one rule, shared by the banner and by
 * App's takeover class, and judged on ONE clock (App's, passed down as `now`),
 * so the slide copy can never step aside for a notice that has gone, or come
 * back under one that is still up.
 * @param {any} notice
 * @param {number} now
 */
export function noticeShowing(notice, now) {
  return Boolean(notice?.message) && isFresh(stampOf(notice), NOTICE_MAX_AGE_MS, now);
}

/**
 * The message size for a level and a place, by measurement. Pure and
 * exported for tests. `compact`: the flag strip hangs over the band.
 * `place`: where a critical notice sits ('centre', the takeover, or 'band').
 * @param {string} level
 * @param {string} message
 * @param {{ compact?: boolean, place?: 'centre' | 'band' }} [opts]
 */
export function noticeFit(level, message, { compact = false, place = 'centre' } = {}) {
  if (level === 'critical' && place === 'centre') {
    const width = OVERLAY.centre.width - inset(TAKEOVER.label) - TAKEOVER.padX * 2;
    return fitParagraph(message, { width, max: TAKEOVER.max, min: TAKEOVER.min, maxLines: TAKEOVER.maxLines, face: 'read' });
  }
  const g = level === 'critical' ? BAND_CRITICAL : BAND;
  const width = OVERLAY.band.width - inset(g.label) - g.padX * 2;
  const height = bandRoom(compact) - plateChrome(g.label) - g.padY - PLATE_SPILL;
  return fitParagraph(message, {
    width, max: g.max, min: g.min, maxLines: g.maxLines, face: g.face, height, lineHeight: g.lineHeight,
  });
}

/**
 * Church-authored announcement banner for the `onNotice` broadcast
 * ('info' | 'warn' | 'critical'). One component, three weights, so the
 * severity is always rendered consistently instead of leaving each
 * caller to reinvent "how urgent does this look". All three are the kit's
 * stepped chip (the corner chips' shape, StepPlate): a Londrina label on the
 * pill ("FYI", "NOTICE", "ATTENTION"), the message in Figtree on the block.
 *
 *   - info / warn — in the top band, between the corner tab and the
 *     top-right stack and above the highest the slide copy can rise (see
 *     src/lib/overlayFit.js OVERLAY), so it never sits on the tab, the
 *     stack or the headline at any screen shape. Info is the quiet
 *     charcoal chip; warn is sunflower. A milestone toast borrows the band
 *     while it is up (`yielding`): the notice lifts out of the way, and comes
 *     back only once the toast has left (a hold as long as the toast's
 *     exit), so the two are never in the band together.
 *   - critical — a takeover (`place` 'centre'): the hot chip, big, in the
 *     middle of the room, and the slide copy steps back behind it (App sets
 *     the stage class) the way it does for a name. At the app's highest
 *     z-index, above even an active check-in: "CLUB CANCELLED TONIGHT" must
 *     never lose the fight with a birthday banner for a parent's attention.
 *     Where the centre is not its to take (an OBS overlay feed, which has
 *     no slide behind it: src/lib/overlayFit.js lobbyRoom) it
 *     sits in the top band instead (`place` 'band'), fitted to end where the
 *     band ends. It never yields.
 *
 * `message` is bounded plain text by the sanitizer (src/lib/eventSanitizers.js)
 * before it ever reaches this component, but it is rendered here as an
 * ordinary React text child — never `dangerouslySetInnerHTML` — so the
 * render path itself can't reopen a markup-injection hole even if a
 * future change to the sanitizer slipped. Its size comes from measuring it
 * (noticeFit), so the 200-character maximum steps down instead of spilling.
 *
 * Expires on its own after NOTICE_MAX_AGE_MS so a forgotten cancellation
 * notice can't haunt the screen into next week's club night. `now` is the
 * clock that judges it (App's); without one the banner keeps its own.
 *
 * @param {{ notice: any, now?: number, yielding?: boolean, compact?: boolean, place?: 'centre' | 'band' }} props
 */
export default function NoticeBanner({ notice, now, yielding = false, compact = false, place = 'centre' }) {
  useFontsReady();
  const [ownNow, setOwnNow] = useState(() => Date.now());
  const ownClock = now == null;
  useEffect(() => {
    if (!ownClock) return undefined;
    const interval = setInterval(() => setOwnNow(Date.now()), NOTICE_CHECK_MS);
    return () => clearInterval(interval);
  }, [ownClock]);

  const show = noticeShowing(notice, now ?? ownNow);
  const level = show ? notice.level : null;
  const critical = level === 'critical';
  const inBand = critical && place === 'band';
  const fit = show ? noticeFit(level, notice.message, { compact, place: inBand ? 'band' : 'centre' }) : null;
  // Only a band notice ever steps aside; a critical one never yields.
  const away = yielding && !critical;

  return (
    <AnimatePresence>
      {show && (
        <Notice
          key={`${notice.at}-${notice.level}`}
          level={level}
          message={notice.message}
          fit={fit}
          away={away}
          inBand={inBand}
        />
      )}
    </AnimatePresence>
  );
}

const ENTER = { opacity: 1, y: '0%', scale: 1, transition: { duration: DUR.pop, ease: EASE.pop } };
const LEAVE = { opacity: 0, y: '-60%', scale: 1, transition: { duration: DUR.exit, ease: EASE.exit } };
// Coming back after a toast: hold out of sight for as long as the toast
// takes to leave (its exit is DUR.exit on the same slow-start curve), then
// pop back. Keyframes rather than a delay (see holdThenLand); the last one is
// the resting notice, which is what ?lowPower=1 shows.
const BACK = (() => {
  const b = holdThenLand(DUR.exit, DUR.pop, { opacity: 0, y: '-60%', scale: 1 }, { opacity: 1, y: '0%', scale: 1 }, EASE.pop);
  return { ...b.animate, transition: b.transition };
})();
// An info or warn notice lands with a plate's soft squish (src/lib/squish.js),
// hanging from the band, both on the way in and on the way back; stepping
// aside sends the squish's two axes home on its own timing. A critical notice
// keeps the three targets above exactly: a cancellation does not bounce.
const SQUISHED = {
  enter: withSquish(ENTER, squishLand(0, 'plate', DUR.pop, 'pop')),
  leave: { ...LEAVE, scaleX: 1, scaleY: 1 },
  back: withSquish(BACK, squishLand(DUR.exit, 'plate', DUR.pop, 'pop')),
};
const PLAIN = { enter: ENTER, leave: LEAVE, back: BACK };

function Notice({ level, message, fit, away, inBand }) {
  const critical = level === 'critical';
  // Once this notice has stepped aside for a toast, its way back waits for
  // the toast to clear (BACK) rather than popping in over it.
  const [hasYielded, setHasYielded] = useState(false);
  if (away && !hasYielded) setHasYielded(true);
  const targets = critical ? PLAIN : SQUISHED;
  const target = away ? targets.leave : hasYielded ? targets.back : targets.enter;
  return (
    <M.div
      className={`notice-banner notice-banner--${level}${inBand ? ' is-band' : ''}`}
      role={critical ? 'alert' : 'status'}
      aria-live={critical ? 'assertive' : 'polite'}
      style={{ '--notice-size': `calc(${fit.size} * var(--u))` }}
      initial={{ opacity: 0, y: critical && !inBand ? '8%' : '-40%', scale: critical && !inBand ? 0.92 : 1 }}
      animate={target}
      exit={{ opacity: 0, y: '-30%', transition: { duration: DUR.exit, ease: EASE.exit } }}
    >
      <StepPlate
        label={EYEBROW[level]}
        labelClassName="notice-banner-eyebrow"
        bodyClassName="notice-banner-body"
        plate={critical ? 'var(--brand-hot)' : level === 'warn' ? 'var(--brand-sun)' : undefined}
      >
        {/* The measured lines, set unbroken so the plate hugs the longest
            (like a stepped chip built around its own text); a word too
            wide for any line hands the wrapping back to the browser.
            Each line is a text child: a space between them keeps the
            message reading as one sentence. */}
        <span className={`notice-banner-message${fit.hug ? ' is-set' : ''}`}>
          {fit.hug
            ? fit.text.map((line, i) => <span key={i} className="notice-banner-line">{i ? ' ' : ''}{line}</span>)
            : message}
        </span>
      </StepPlate>
    </M.div>
  );
}

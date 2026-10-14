import React, { useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import { LOGO_ARRIVAL, MIN_WIDTH_PX, parseChurchLogo } from '../../../shared/churchLogo.js';
import fullSvg from '../../../shared/brand/logos/kvbc-awana-full.svg?raw';
import twoLineSvg from '../../../shared/brand/logos/kvbc-awana-two-line.svg?raw';
import { DUR, EASE } from '../lib/motion-tokens.js';
import { useLowPower } from '../hooks/useLowPower.js';

/**
 * Where the logo sits, in projector units (1u = 1% of a 16:9 frame's
 * width). The same on every view: top-left, like a broadcast logo. `width`
 * is the two-line logo's; it never draws under its smallest legible width
 * (MIN_WIDTH_PX, shared/churchLogo.js), so a 720p or 4:3 wall gets it at
 * 260px rather than smaller. The shutdown screen, where there is room, swaps
 * in the full logo (`fullWidth`, at least 520px) as the night's sign-off.
 */
export const MARK_PLACEMENT = { left: 3.2, top: 2.6, width: 15, fullWidth: 27.1 };

/** The logo lands a beat after the view under it has started to come up. */
const ARRIVE_HOLD = 0.35;

const LOGOS = { full: parseChurchLogo(fullSvg), 'two-line': parseChurchLogo(twoLineSvg) };

/**
 * A wall with room for the full logo over the shutdown's kicker: 1600x900 and
 * up. On a 720p or 4:3 wall (or a phone) its 520px would crowd the words, so
 * the two-line logo simply stays.
 */
const FULL_ROOM_QUERY = '(min-width: 1600px) and (min-height: 900px)';
const subscribeRoom = (onChange) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const list = window.matchMedia(FULL_ROOM_QUERY);
  list.addEventListener?.('change', onChange);
  return () => list.removeEventListener?.('change', onChange);
};
const roomNow = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(FULL_ROOM_QUERY).matches;
const noRoom = () => false;

/**
 * One line landing on its beat, as the logo sheet draws it: up from just
 * below its place, a whisper of squash onto its foot, then still. A single
 * keyframe list ("hold, then land"), never `initial` plus a delay, and its
 * last values are the line at rest.
 * @param {'church' | 'awana' | 'tagline'} part
 * @param {number} hold seconds before the logo starts
 */
export function lineLanding(part, hold = 0) {
  const { at, dur } = LOGO_ARRIVAL[part];
  const start = hold + at;
  const total = start + dur;
  const land = start / total;
  const impact = (start + dur * 0.6) / total;
  return {
    initial: { opacity: 0, y: '45%', scaleX: 1, scaleY: 0.92 },
    animate: {
      opacity: [0, 0, 1, 1],
      y: ['45%', '45%', '0%', '0%'],
      scaleX: [1, 1, 1.012, 1],
      scaleY: [0.92, 0.92, 0.985, 1],
    },
    transition: { duration: total, times: [0, land, impact, 1], ease: ['linear', EASE.settle, EASE.settle] },
  };
}

/**
 * The church's logo (owner 2026-10-13; it replaced the Awana Clubs mark), top
 * left, white on the black wall: rendered once at the top of the page
 * (App.jsx), outside every view and slide, so no slide change or view
 * crossfade ever moves it. It arrives ONCE when the page loads (the church
 * line, then Awana Clubs, then on the shutdown screen the tagline) and after
 * that never moves; it only fades away (on the settle curve) for a
 * deliberately bare wall: the opening's closing blackout and the shutdown
 * screen's idle blackout. Under ?vr=1, reduced motion or the low-power switch
 * it is simply there.
 *
 * Drawn inline from the kit's own file (shared/brand/logos/), in one colour.
 *
 * @param {{ hidden?: boolean, full?: boolean }} props
 */
export const ChurchMark = ({ hidden = false, full = false }) => {
  const still = useLowPower();
  const room = useSyncExternalStore(subscribeRoom, roomNow, noRoom);
  const variant = full && room ? 'full' : 'two-line';
  const logo = LOGOS[variant];
  const base = MARK_PLACEMENT;
  const width = variant === 'full'
    ? `max(calc(${base.fullWidth} * var(--u)), ${MIN_WIDTH_PX.full}px)`
    // Upright on a phone or tablet the portrait block at the end of index.css
    // sets the three custom properties for a tall frame; everywhere else they
    // fall back to MARK_PLACEMENT.
    : `max(calc(var(--pj-mark-width, ${base.width}) * var(--u)), ${MIN_WIDTH_PX['two-line']}px)`;
  return (
    <motion.div
      data-awana-mark
      data-logo={variant}
      className="pj-mark"
      style={{
        left: `calc(var(--pj-mark-left, ${base.left}) * var(--u))`,
        top: `calc(var(--pj-mark-top, ${base.top}) * var(--u))`,
        width,
      }}
      initial={false}
      animate={{ opacity: hidden ? 0 : 1 }}
      transition={{ duration: DUR.settle, ease: EASE.settle }}
    >
      <svg key={variant} className="pj-mark__logo" viewBox={logo.viewBox} role="img" aria-label={logo.label} focusable="false" data-arrive={still ? 'no' : 'once'}>
        <g fill="currentColor" fillRule="evenodd">
          {logo.parts.map((p) => (still
            ? <path key={p.part} className={`kvbc-${p.part}`} d={p.d} />
            : (
              <motion.path
                key={p.part}
                className={`kvbc-${p.part}`}
                d={p.d}
                style={{ originX: 0.5, originY: 1 }}
                {...lineLanding(p.part, ARRIVE_HOLD)}
              />
            )))}
        </g>
      </svg>
    </motion.div>
  );
};

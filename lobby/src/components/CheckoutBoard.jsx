import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { M } from '../lib/motion.jsx';
import { DUR, EASE, SHAPES } from '../lib/brand.js';
import { getAllClubs, getClubPalette } from '../lib/clubs.js';
import { FOOT_FLOOR_PX, fitFoot, footRange, moreLabel, nameChipSeat, waitingLabel } from '../lib/overlayFit.js';
import { measureInk } from '../lib/lobbyFrame.js';
import { useFontsReady } from '../hooks/useFontsReady.js';
import {
  BOARD_ANONYMOUS,
  BOARD_EMPTY,
  BOARD_NAMES,
  BOARD_STALE,
  groupByClub,
} from '../lib/checkoutBoard.js';

// Who is still waiting to be picked up.
//
// All of the "should this be visible at all" judgement lives in
// src/lib/checkoutBoard.js as a pure, heavily-tested function — this component
// only renders the decision it is handed. That split is deliberate: the
// visibility rules are the safety-relevant part of this feature, and they should
// not be tangled up with JSX.
//
// The wording here matters as much as the logic. The list comes from whether
// volunteers PERFORMED checkout in TwoTimTwo, not from whether children actually
// left, so it can be freshly and confidently wrong during a pickup rush. Every
// string below is chosen so a volunteer reads it as "who has not been checked
// out yet" and never as "the building is clear" — because acting on the second
// meaning when the first is what we know is how a child gets left behind.
//
// The look (rebrand stage 4b-2) is the kit's card, the printer dashboard's: a
// white card with a hard offset shadow and a house-blue tab carrying its title
// (the kit's wavy tab on the one-line card), the count in Paytone One. WHERE it goes is always the foot (src/lib/overlayFit.js
// OVERLAY.foot, boardPlacement): the strip under the copy's lowest line, from
// the gear to the corner chip, the first-run card's seat. The slides above it
// carry on as normal (owner, 2026-10-07: "The still remaining kids list should
// just take the bottom of the screen. It shouldn't take over all of the
// announcements."; until then a live list at pickup time took the middle and
// the copy stepped aside behind it).
//
//  - A names board fills the strip: the tab at the left end, its title over
//    the honest count line, then every club's plate (its white mark, "N
//    waiting") followed by its names as chips in its colour, alphabetical, in
//    one run that wraps across the strip (fitFoot sizes the chips to the
//    strip's measured box). Where even the smallest chips cannot hold
//    everyone, a club's last names stand behind a "+N more" chip; its plate and
//    the count line still say the whole number.
//  - A stale or empty board, or the anonymous line, is a one-line card on the
//    strip's floor, in the same words.
//
// It only ever shows at pickup time (from 7:30 pm by itself, since 2026-10-08:
// checkoutBoard.js decideBoard), so there is no longer a count-line-only
// version of a names board for the program hours.

/**
 * The fit's box when the strip has not been measured (no layout: jsdom, or a
 * frame before the ResizeObserver's first answer), in u: the run's room on a
 * 1920x1080 screen (the strip, 75u x 9.45u there, less the tab and the
 * card's padding).
 */
const FALLBACK = { width: 65, height: 8.7 };

/**
 * The run's own box, measured (px), while `active`: a ResizeObserver re-reads
 * it when the screen or the card changes and applies it before the frame is
 * painted (flushSync), as useTallerThan does. The box comes from the card's
 * grid, never from the chips in it, so a new fit never resizes it. Null
 * without layout.
 * @param {{ current: HTMLElement | null }} ref
 * @param {boolean} active
 * @returns {{ width: number, height: number } | null}
 */
function useRunBox(ref, active) {
  const [box, setBox] = useState(/** @type {{ width: number, height: number } | null} */ (null));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      flushSync(() => setBox((old) => {
        if (!(width > 0 && height > 0)) return null;
        return old && old.width === width && old.height === height ? old : { width, height };
      }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, active]);
  return active ? box : null;
}

/**
 * @param {object} props
 * @param {{state: string, reason?: string, ageMin?: number}} props.decision
 * @param {{entries: {firstName: string, club: string}[], printed?: number}|null} props.checkout
 * @param {boolean} [props.calm] Panic/simplified mode — no entrance animation.
 *   OS-level reduced-motion is already handled globally by App's
 *   <MotionConfig reducedMotion="user">, so this only covers the operator's own
 *   "simplified mode" switch.
 * @param {boolean} [props.demo] a sample board (Settings' preview and demo):
 *   it says so on its card and its count line, so it can never pass for a real list
 * @param {boolean} [props.preview] drawn in Settings' miniature TV: no floor
 *   in px on the chips' size
 */
export default function CheckoutBoard({ decision, checkout, calm, demo = false, preview = false }) {
  useFontsReady();
  const state = decision?.state;
  const shown = state === BOARD_NAMES || state === BOARD_ANONYMOUS
    || state === BOARD_EMPTY || state === BOARD_STALE;
  const listed = state === BOARD_NAMES;
  const runRef = useRef(/** @type {HTMLUListElement | null} */ (null));
  const box = useRunBox(runRef, listed);
  if (!shown) return null;

  const entries = checkout?.entries || [];
  const count = entries.length;
  const clubs = listed
    ? groupByClub(entries, getAllClubs()).map((g) => {
      const club = getClubPalette(g.club);
      return { ...g, palette: club, mark: Boolean(club.logo) };
    })
    : [];
  let fit = null;
  let nameSize;
  if (listed && box) {
    // Measured, in px: the chips' range from the run's height (footRange),
    // with a floor a lobby can read, except in Settings' miniature TV.
    const range = footRange(box.height, preview ? 0 : FOOT_FLOOR_PX);
    fit = fitFoot(clubs, { ...box, ...range, step: 0.25 });
    nameSize = `${fit.size}px`;
  } else if (listed) {
    fit = fitFoot(clubs, { ...FALLBACK, ...footRange(FALLBACK.height), step: 0.01 });
    nameSize = `calc(${fit.size} * var(--u))`;
  }

  const anim = calm
    ? {}
    : {
        initial: { opacity: 0, y: '6%', scale: 0.96 },
        animate: { opacity: 1, y: '0%', scale: 1 },
        transition: { duration: DUR.settle, ease: EASE.settle },
      };

  const tab = (/** @type {import('react').ReactNode} */ more = null) => (
    <div className="checkout-tab">
      <svg viewBox={SHAPES.tab.viewBox} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d={SHAPES.tab.d} fill="currentColor" />
      </svg>
      <h2 className="checkout-title">Still to be picked up</h2>
      {more}
    </div>
  );
  const demoTag = demo && <span className="checkout-demo">Demo · sample names</span>;
  const countLine = state === BOARD_NAMES && (
    <p className="checkout-foot">
      {/* "not checked out yet", never "still in the building" — the data
          cannot support the stronger claim, and the weaker one is what a
          volunteer needs to act on anyway. */}
      <span className="checkout-count">{count}</span> not checked out yet
      {typeof checkout?.printed === 'number' && ` · ${checkout.printed} labels printed tonight`}
      {!demo && decision.ageMin > 1 && ` · updated ${decision.ageMin} min ago`}
      {demo && ' · a demo, not real children'}
    </p>
  );

  return (
    // Keyed on what it shows, so moving between the one line and the list
    // lands the card afresh rather than stretching it across the strip.
    <div key={listed ? 'list' : 'line'} className="checkout-region">
      <M.section
        className={`checkout-board ${state} checkout-board--${listed ? 'list' : 'line'}${demo ? ' checkout-board--demo' : ''}`}
        aria-live="polite"
        style={listed ? { '--name-size': nameSize } : undefined}
        {...anim}
      >
        {listed ? (
          <>
            {/* The tab carries the count line under its title, so the run
                has the strip's whole height. */}
            {tab(<div className="checkout-meta">{countLine}{demoTag}</div>)}
            <ul className="checkout-run" ref={runRef}>
              {/* Every club in one run, youngest to oldest, each led by its
                  own plate (its white mark and how many are waiting) so a
                  parent finds their child's club at a glance, then each name
                  a chip in the club's colour, alphabetical. Quiet, no
                  springs: this is a reference list a volunteer scans. */}
              {clubs.map((g, i) => {
                const hidden = fit.hidden[i] || 0;
                const names = hidden ? g.names.slice(0, g.names.length - hidden) : g.names;
                return (
                  <li
                    key={g.club}
                    className="checkout-club"
                    style={{ '--club': g.palette.primary, '--club-deep': g.palette.deep || g.palette.primary }}
                  >
                    <span className="checkout-plate">
                      {g.mark
                        ? <img className="checkout-plate__mark" src={g.palette.logo} alt={g.palette.name || g.club} draggable="false" />
                        : <span className="checkout-plate__name">{g.club}</span>}
                      <span className="checkout-plate__count">{waitingLabel(g.names.length)}</span>
                    </span>
                    <span className="checkout-names">
                      {names.map((name, j) => (
                        // A real separator between chips, so the list still
                        // reads (and copies) as "Demo Kid · Sample Star".
                        <span key={`${name}-${j}`} className="checkout-name">
                          {j ? <span className="checkout-sep"> · </span> : null}
                          <NameChip name={name} />
                        </span>
                      ))}
                      {hidden > 0 && (
                        <span className="checkout-name">
                          {names.length ? <span className="checkout-sep"> · </span> : null}
                          <span className="checkout-more">{moreLabel(hidden)}</span>
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <>
            {tab()}
            {demoTag}

            {state === BOARD_EMPTY && (
              <p className="checkout-line good">
                Everyone has been checked out. Thanks for a great night!
              </p>
            )}

            {state === BOARD_ANONYMOUS && (
              // Deliberately no names and no exact number. At this point in the
              // evening a count of one or two, on a public wall, is a statement about
              // specific unattended children — and their first names were already on
              // this same screen earlier tonight.
              <p className="checkout-line">
                Almost everyone has been picked up. Please see the check-in desk.
              </p>
            )}

            {state === BOARD_STALE && (
              <p className="checkout-line warn">
                This list stopped updating about {decision.ageMin} min ago
                {' '}— please check with the check-in desk rather than relying on it.
              </p>
            )}
          </>
        )}
      </M.section>
    </div>
  );
}

/**
 * One name on the board, in its club's colour. A capital that carries a tall
 * mark ("Élodie", "Ấn") sits just low enough in its pill that the mark stays
 * on it (overlayFit.js nameChipSeat, from the name's measured ink); a plain
 * name sits where it always did.
 * @param {{ name: string }} props
 */
function NameChip({ name }) {
  const seat = nameChipSeat(measureInk(name, 'shout'));
  return (
    <span className="checkout-name__chip" style={seat ? { '--seat': `${seat}em` } : undefined}>{name}</span>
  );
}

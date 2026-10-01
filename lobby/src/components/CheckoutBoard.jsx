import { M } from '../lib/motion.jsx';
import { DUR, EASE, SHAPES, beats } from '../lib/brand.js';
import { getAllClubs, getClubPalette } from '../lib/clubs.js';
import { OVERLAY, fitColumns, nameChipSeat } from '../lib/overlayFit.js';
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
// The look (rebrand stage 4b-2) is the kit's card, the printer dashboard's:
// a white card with a hard offset shadow and a wavy corner tab carrying its
// title, the count in Paytone One. Since 2026-10-01 the list is one column per
// club (its plate, "N waiting", then its names as chips in its colour). WHERE it
// goes is src/lib/overlayFit.js boardPlacement, handed in as `placement`:
//
//  - 'centre' while it is the room's focus (a live list during pickup time):
//    it takes the middle of the room and the slide copy steps back behind it
//    (App's `board-up` stage class), as it does for a name. Reserving room for
//    up to sixty names would shrink every slide all evening.
//  - 'foot' the rest of the time it is on (a stale or empty board, or an
//    "always" board while the program is running): a one-line card at the
//    foot, beside the slides, which keep playing. It says the same things,
//    in the same words; a live list there is its count line, because a
//    partial list must never pass for the whole one, and the names are for
//    pickup, when the board comes back to the middle.

// The columns' fit, in u: the card's inner width (70u less 2 x 2.2u of
// padding), and the height left in the centre region after the tab (4.7u),
// the foot (~3.9u) and the bottom padding (1.6u) (app.css); each column's
// head (the club's plate: its mark and "N waiting") is 6u of it, and the
// columns stand 1.2u apart (owner, 2026-10-01: columns by club, so a parent
// looks under their child's club).
const COLUMNS = {
  width: OVERLAY.centre.width - 4.6,
  height: OVERLAY.centre.bottom - OVERLAY.centre.top - 10.4,
  head: 6,
  gap: 1.2,
  max: 2.6,
  min: 1,
};

/**
 * @param {object} props
 * @param {{state: string, reason?: string, ageMin?: number}} props.decision
 * @param {{entries: {firstName: string, club: string}[], printed?: number}|null} props.checkout
 * @param {boolean} [props.calm] Panic/simplified mode — no entrance animation.
 *   OS-level reduced-motion is already handled globally by App's
 *   <MotionConfig reducedMotion="user">, so this only covers the operator's own
 *   "simplified mode" switch.
 * @param {'centre' | 'foot'} [props.placement] where it goes (boardPlacement)
 * @param {boolean} [props.demo] a sample board (Settings' preview and demo):
 *   it says so on its tab and its foot, so it can never pass for a real list
 */
export default function CheckoutBoard({ decision, checkout, calm, placement = 'centre', demo = false }) {
  useFontsReady();
  const state = decision?.state;
  if (state !== BOARD_NAMES && state !== BOARD_ANONYMOUS
      && state !== BOARD_EMPTY && state !== BOARD_STALE) {
    return null;
  }

  const foot = placement === 'foot';
  const entries = checkout?.entries || [];
  const listed = state === BOARD_NAMES && !foot;
  const groups = listed ? groupByClub(entries, getAllClubs()) : [];
  const count = entries.length;
  const fit = listed ? fitColumns(groups, COLUMNS) : null;

  const anim = calm
    ? {}
    : {
        initial: { opacity: 0, y: '6%', scale: 0.96 },
        animate: { opacity: 1, y: '0%', scale: 1 },
        transition: { duration: DUR.settle, ease: EASE.settle },
      };

  return (
    // Keyed on the placement, so moving between the foot and the middle
    // lands the card afresh rather than sliding it across the slide.
    <div key={placement} className={`checkout-region${foot ? ' checkout-region--foot' : ''}`}>
      <M.section
        className={`checkout-board ${state}${foot ? ' checkout-board--foot' : ''}${demo ? ' checkout-board--demo' : ''}`}
        aria-live="polite"
        style={fit ? { '--name-size': `calc(${fit.size} * var(--u))`, '--columns': groups.length } : undefined}
        {...anim}
      >
        <div className="checkout-tab">
          <svg viewBox={SHAPES.tab.viewBox} preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path d={SHAPES.tab.d} fill="currentColor" />
          </svg>
          <h2 className="checkout-title">Still to be picked up</h2>
        </div>
        {demo && <span className="checkout-demo">Demo · sample names</span>}

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

        {listed && (
          <ul className="checkout-columns">
            {/* One column per club, youngest to oldest, each headed by the
                club's own plate (its white mark and how many are waiting) so
                a parent finds their child's club at a glance, and each name
                a chip in the club's colour, alphabetical. A long club splits
                into side-by-side sub-columns (fit.split). Quiet, no springs:
                this is a reference list a volunteer scans. */}
            {groups.map((g, i) => {
              const club = getClubPalette(g.club);
              return (
                <M.li
                  key={g.club}
                  className="checkout-column"
                  style={{ '--club': club.primary, '--club-deep': club.deep || club.primary, '--split': fit.split[i] }}
                  initial={calm ? false : { opacity: 0, y: '0.5em' }}
                  animate={{ opacity: 1, y: '0em' }}
                  transition={{ duration: DUR.settle, delay: beats(1 + i * 0.7), ease: EASE.settle }}
                >
                  <div className="checkout-column__head">
                    {club.logo
                      ? <img className="checkout-column__mark" src={club.logo} alt={club.name || g.club} draggable="false" />
                      : <span className="checkout-column__name">{g.club}</span>}
                    <span className="checkout-column__count">{g.names.length} waiting</span>
                  </div>
                  <span className="checkout-names">
                    {g.names.map((name, j) => (
                      // A real separator between chips, so the list still
                      // reads (and copies) as "Demo Kid · Sample Star".
                      <span key={`${name}-${j}`} className="checkout-name">
                        {j ? <span className="checkout-sep"> · </span> : null}
                        <NameChip name={name} />
                      </span>
                    ))}
                  </span>
                </M.li>
              );
            })}
          </ul>
        )}

        {state === BOARD_NAMES && (
          <p className="checkout-foot">
            {/* "not checked out yet", never "still in the building" — the data
                cannot support the stronger claim, and the weaker one is what a
                volunteer needs to act on anyway. */}
            <span className="checkout-count">{count}</span> not checked out yet
            {typeof checkout?.printed === 'number' && ` · ${checkout.printed} labels printed tonight`}
            {!demo && decision.ageMin > 1 && ` · updated ${decision.ageMin} min ago`}
            {demo && ' · a demo, not real children'}
          </p>
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

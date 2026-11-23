import { M } from '../../lib/motion.jsx';
import { keyframes, landsAt, EASE_SLAM, EASE_OUT } from './kit.jsx';
import LOGO_WHITE from '../../../../shared/brand/logos/kvbc-awana-two-line-white.svg';

// ─────────────────────────────────────────────────────────────
// Backwards Night (owner 2026-11-23): Wednesday, January 13, 2027, shown from
// the club night a week before through the night itself (src/lib/promos.js).
// The words are the owner's pick: BACKWARDS NIGHT · WED JAN 13 · "Come
// backwards and you might win shares!" (shares are handed out at random to
// kids who show off the theme).
//
// Everything about it is the wrong way round: the house waves hang from the
// TOP, the corner tab sits top RIGHT, the headline's hard shadow falls to the
// LEFT, every piece arrives the way it would normally leave, and the headline
// lands spelled backwards (SDRAWKCAB / THGIN, its letters last one first),
// holds so kids try to read it, then each letter spins round into BACKWARDS
// NIGHT. The lobby's own kit (Paytone One shout), so every class is
// `.backwards-promo*`, never `.promo-*` (src/lib/promoFonts.test.js). Flat:
// hard offsets only, no gradient, blur or glow.
//
// Beat sheet (seconds into the 12 s hold):
//   0.0  a ◀◀ chip blinks top left (a tape rewinding), gone by 1.7.
//   0.15 the sun and orange waves drop in from above, in place by 0.75.
//   0.5  the corner tab slides in from the right edge, in by 1.0.
//   0.9  SDRAWKCAB / THGIN land letter by letter, LAST letter first, by ~2.4.
//   4.2  each backwards letter spins away (left to right, 0.05 s apart) as its
//        readable twin spins in: BACKWARDS NIGHT by ~5.5.
//   5.9  the WED JAN 13 chip pops on; 6.5 the shares line drops in from above;
//   7.1  three gold coins pop beside it. Still to the end of the hold.
//
// The LAST keyframe of every piece is the finished poster (the readable
// headline; the backwards one gone), the frame ?lowPower=1 / zero animation
// shows.
// ─────────────────────────────────────────────────────────────

export const DETAILS = Object.freeze({ default: Object.freeze([]) });
export const BACKWARDS_LABEL = 'Backwards Night, Wednesday January 13. Come backwards and you might win shares!';

const LINES = Object.freeze(['Backwards', 'Night']);
const reverse = (s) => [...s].reverse().join('');
const LETTER_GAP = 0.06;
const SPIN_AT = 4.2;
const SPIN_GAP = 0.05;

const COUNT = LINES.reduce((sum, line) => sum + line.length, 0);
/** Where each line's letters start in reading order (both lines one sequence). */
const STARTS = LINES.map((_, li) => LINES.slice(0, li).reduce((sum, line) => sum + line.length, 0));

const REWIND = keyframes([
  [0, { opacity: 0 }], [0.05, { opacity: 1 }], [0.4, { opacity: 0.3 }], [0.75, { opacity: 1 }],
  [1.1, { opacity: 0.3 }], [1.45, { opacity: 1 }], [1.7, { opacity: 0 }],
], 'linear');
const WAVES = landsAt(0.15, 0.6, { opacity: [0, 1], y: ['-100%', '0%'] }, EASE_OUT);
const TAB = landsAt(0.5, 0.5, { opacity: [0, 1], x: ['100%', '0%'] }, EASE_OUT);
const CHIP = landsAt(5.9, 0.4, { opacity: [0, 1], scale: [0.4, 1.06, 1] }, EASE_SLAM);
const LINE = landsAt(6.5, 0.45, { opacity: [0, 1], y: ['-0.8em', '0em'] }, EASE_OUT);
const COINS = [7.1, 7.25, 7.4].map((at) => landsAt(at, 0.35, { opacity: [0, 1], scale: [0.3, 1] }, EASE_SLAM));

/** The backwards letter `n` (reading order of the BACKWARDS text): lands, holds, spins away. */
function backLetter(n) {
  const land = 0.9 + (COUNT - 1 - n) * LETTER_GAP;   // last letter first
  const out = SPIN_AT + n * SPIN_GAP;
  return keyframes([
    [0, { opacity: 0, x: '-0.6em', rotateY: 0 }],
    [land, { opacity: 0, x: '-0.6em', rotateY: 0 }],
    [land + 0.3, { opacity: 1, x: '0em', rotateY: 0 }],
    [out, { opacity: 1, x: '0em', rotateY: 0 }],
    [out + 0.22, { opacity: 0, x: '0em', rotateY: 90 }],
  ], EASE_OUT);
}
/** The readable letter `n`: spins in as its backwards twin spins away. */
function frontLetter(n) {
  const at = SPIN_AT + n * SPIN_GAP + 0.2;
  return landsAt(at, 0.3, { opacity: [0, 1], rotateY: [-90, 0] }, EASE_OUT);
}

function Coin() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="17" className="backwards-promo__coin-face" />
      <circle cx="20" cy="20" r="11" className="backwards-promo__coin-ring" />
    </svg>
  );
}

export default function BackwardsPromo() {
  // Each line is two whole rows stacked in one place: the backwards spelling
  // (its own natural spacing) and the readable one. Letter n of each row spins
  // at the same moment, so the word turns round from left to right.
  return (
    <div className="promo-slide promo-slide--backwards backwards-promo" role="img" aria-label={BACKWARDS_LABEL}>
      <M.div className="backwards-promo__waves" aria-hidden="true" {...WAVES}>
        <svg className="backwards-promo__wave backwards-promo__wave--sun" viewBox="0 0 1920 300" preserveAspectRatio="none">
          <path d="M0 0 H1920 V170 C1600 250 1280 120 960 180 S320 260 0 160 Z" />
        </svg>
        <svg className="backwards-promo__wave backwards-promo__wave--orange" viewBox="0 0 1920 300" preserveAspectRatio="none">
          <path d="M0 0 H1920 V95 C1560 170 1240 60 900 110 S300 175 0 90 Z" />
        </svg>
      </M.div>

      <M.div className="backwards-promo__tab" aria-hidden="true" {...TAB}>
        <img className="backwards-promo__logo" src={LOGO_WHITE} alt="" draggable="false" />
      </M.div>

      <M.div className="backwards-promo__rewind" aria-hidden="true" {...REWIND}>◀◀</M.div>

      <div className="backwards-promo__stage" aria-hidden="true">
        <div className="backwards-promo__headline">
          {LINES.map((line, li) => {
            const front = [...line.toUpperCase()];
            const back = [...reverse(line.toUpperCase())];
            const first = STARTS[li];
            return (
              <div key={line} className="backwards-promo__line">
                <div className="backwards-promo__row backwards-promo__row--back">
                  {back.map((ch, i) => (
                    <M.span key={i} className="backwards-promo__letter backwards-promo__letter--back" {...backLetter(first + i)}>{ch}</M.span>
                  ))}
                </div>
                <div className="backwards-promo__row">
                  {front.map((ch, i) => (
                    <M.span key={i} className="backwards-promo__letter" {...frontLetter(first + i)}>{ch}</M.span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <M.div className="backwards-promo__chip" {...CHIP}>Wed Jan 13</M.div>
        <div className="backwards-promo__foot">
          <M.p className="backwards-promo__shares" {...LINE}>Come backwards and you might win shares!</M.p>
          <div className="backwards-promo__coins">
            {COINS.map((c, i) => <M.span key={i} className="backwards-promo__coin" {...c}><Coin /></M.span>)}
          </div>
        </div>
      </div>
    </div>
  );
}

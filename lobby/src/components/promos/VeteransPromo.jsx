import { M } from '../../lib/motion.jsx';
import { landsAt, EASE_SLAM, EASE_OUT } from './kit.jsx';
import LOGO_WHITE from '../../../../shared/brand/logos/kvbc-awana-two-line-white.svg';

// ─────────────────────────────────────────────────────────────
// Veterans Day: "Thank you, veterans." (owner 2026-11-10: no subtitle; it airs
// double time on Wednesday, November 11 and not after.) Which days it shows,
// and its second showing that day, are decided in the pure src/lib/promos.js;
// this is only the art.
//
// Not a printed poster, so it wears the lobby's own kit (Paytone One shout,
// Londrina Solid label), never the posters' faces: every class is
// `.veterans*`, not `.promo-*` (src/lib/promoFonts.test.js). Flat: hard
// offsets only, no gradient, blur or glow. Quiet: nothing loops, nothing
// bounces, no confetti.
//
// Beat sheet (seconds into the 10 s hold):
//   0.0  three bands of the flag's colours rise along the foot (white, red,
//        navy, 0.08 s apart), in place by 0.6.
//   0.4  the navy corner tab, with the church's logo, drops in; down by 0.9.
//   0.8  the kicker "Veterans Day · Wednesday, November 11" fades up.
//   0.9  THANK YOU, then 1.0 VETERANS land, in place by 1.4.
//   1.6  the three white stars pop in one at a time (1.6, 1.8, 2.0), all in
//        place by 2.4.
//        Then everything is still, to the end of the hold.
//
// The LAST keyframe of every piece is the finished poster, the frame
// ?lowPower=1 / zero animation shows.
// ─────────────────────────────────────────────────────────────

export const DETAILS = Object.freeze({ default: Object.freeze([]) });

const KICKER = 'Veterans Day · Wednesday, November 11';
const HEADLINE = Object.freeze(['Thank you,', 'veterans']);
export const VETERANS_LABEL = 'Veterans Day, Wednesday, November 11. Thank you, veterans.';

// A five-point star on a 100 x 100 grid.
const STAR = '50,0 61.76,33.82 97.55,34.55 69.02,56.18 79.39,90.45 50,70 20.61,90.45 30.98,56.18 2.45,34.55 38.24,33.82';
// Left and top in u (1u = 1% of the 16:9 stage), size in u, tilt in degrees.
const STARS = Object.freeze([
  { x: 75, y: 6.25, size: 12, tilt: 10, at: 1.6 },
  { x: 88.5, y: 17.2, size: 6.25, tilt: -12, at: 1.8 },
  { x: 78.1, y: 20.8, size: 4.06, tilt: 18, at: 2.0 },
]);

// The three bands, back to front, each a full-width wave on a 1920 x 420 grid.
const BANDS = Object.freeze([
  { name: 'white', d: 'M0 215 C320 120 560 290 900 215 S1500 100 1920 200 V420 H0Z', at: 0 },
  { name: 'red', d: 'M0 270 C380 170 620 350 980 270 S1560 170 1920 260 V420 H0Z', at: 0.08 },
  { name: 'navy', d: 'M0 362 C400 290 700 420 1040 360 S1600 300 1920 356 V420 H0Z', at: 0.16 },
]);

const RISE = (at) => landsAt(at, 0.45, { opacity: [0, 1], y: ['40%', '0%'] }, EASE_OUT);
const TAB = landsAt(0.4, 0.5, { opacity: [0, 1], y: ['-100%', '0%'] }, EASE_OUT);
const KICKER_IN = landsAt(0.8, 0.4, { opacity: [0, 1], y: ['0.5em', '0em'] }, EASE_OUT);
const LINE_IN = [0.9, 1.0].map((at) => landsAt(at, 0.4, { opacity: [0, 1], y: ['0.35em', '0em'] }, EASE_SLAM));

export default function VeteransPromo() {
  return (
    <div className="promo-slide promo-slide--veterans veterans" role="img" aria-label={VETERANS_LABEL}>
      <div className="veterans__waves" aria-hidden="true">
        {BANDS.map((b) => (
          <M.svg
            key={b.name}
            className={`veterans__band veterans__band--${b.name}`}
            viewBox="0 0 1920 420"
            preserveAspectRatio="none"
            {...RISE(b.at)}
          >
            <path d={b.d} />
          </M.svg>
        ))}
      </div>

      <M.div className="veterans__tab" aria-hidden="true" {...TAB}>
        <img className="veterans__logo" src={LOGO_WHITE} alt="" draggable="false" />
      </M.div>

      <div className="veterans__stage" aria-hidden="true">
        <div className="veterans__copy">
          <M.div className="veterans__kicker" {...KICKER_IN}>{KICKER}</M.div>
          <div className="veterans__headline">
            {HEADLINE.map((line, i) => (
              <M.div key={line} className="veterans__line" {...LINE_IN[i]}>{line}</M.div>
            ))}
          </div>
        </div>
        {STARS.map((s) => (
          <M.div
            key={s.x}
            className="veterans__star"
            style={{ left: `calc(var(--u) * ${s.x})`, top: `calc(var(--u) * ${s.y})`, width: `calc(var(--u) * ${s.size})`, height: `calc(var(--u) * ${s.size})` }}
            {...landsAt(s.at, 0.4, { opacity: [0, 1], scale: [0.4, 1] }, EASE_SLAM)}
          >
            <svg viewBox="0 0 100 100" style={{ rotate: `${s.tilt}deg` }}><polygon points={STAR} /></svg>
          </M.div>
        ))}
      </div>
    </div>
  );
}

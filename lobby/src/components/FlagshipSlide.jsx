import { M } from '../lib/motion.jsx';
import DoodleCluster from './brand/DoodleCluster.jsx';
import { landsAt, keyframes, EASE_SLAM, EASE_OUT, EASE_INOUT } from './promos/kit.jsx';
import { squishLand, withSquish } from '../lib/squish.js';

// ─────────────────────────────────────────────────────────────
// The flagship slide: the catalog's welcome page as a 10 second title
// sequence, and the first slide of every pass through the deck.
//
// Beat sheet (seconds into the 10 s hold):
//   0.0  the studio sky is already up; two clouds drift in from the sides.
//        (The orange corner tab and the house waves along the foot are the
//        scene's own chrome, the same on every slide: not drawn here.)
//   1.3  WELCOME assembles letter by letter, each letter springing up from
//        below its mask with a little tilt, stretching as it rises and
//        squashing onto its baseline as it drops back (the soft squish);
//        2.1 TO AWANA! does the same, a beat behind.
//   3.9  sparkles and dots land round the headline.
//   6.4  a bright band sweeps once across both headline rows, and the frame
//        holds.
//
// Rules (CLAUDE.md, "Season promo slides" and zero animation): every animated
// element is M.*, every beat is a keyframe list that holds and then lands
// (landsAt / keyframes from the promo kit), never `initial` plus a long
// delay, and the LAST keyframe of everything is the finished slide, which is
// what ?lowPower=1 freezes on. The sheen and the hops end invisible / at rest.
// Check-ins play OVER this slide and it steps back for them (app.css).
// ─────────────────────────────────────────────────────────────

const ROWS = Object.freeze(['Welcome', 'to Awana!']);

/** A letter's landing: it springs past its line at half its run and drops back. */
const LETTER_SEC = 0.6;
/**
 * Where that drop lands, as a share of the run: the second half is the slam
 * curve again, 88% home 30% of the way through it. The soft squish
 * (src/lib/squish.js) is composed onto landsAt's own keyframes, which the
 * promo posters share and which stay exactly as they are.
 */
export const LETTER_IMPACT = 0.65;

/** One headline row: each letter its own beat. */
function Row({ text, startAt, row }) {
  let n = 0;
  return (
    <div className={`flagship-row flagship-row--${row}`} aria-hidden="true">
      {text.split(' ').map((word, w) => (
        <span className="flagship-word" key={`${word}-${w}`}>
          {[...word].map((ch) => {
            const i = n;
            n += 1;
            const at = startAt + i * 0.055;
            return (
              <span className="flagship-mask" key={`${ch}-${i}`}>
                <M.span
                  className="flagship-letter"
                  {...withSquish(landsAt(at, LETTER_SEC, {
                    y: ['112%', '-9%', '0%'],
                    rotate: [i % 2 ? 9 : -9, i % 2 ? -3 : 3, 0],
                    opacity: [0, 1, 1],
                  }, EASE_SLAM), squishLand(at, 'text', LETTER_SEC, LETTER_IMPACT))}
                >
                  {ch}
                </M.span>
              </span>
            );
          })}
        </span>
      ))}
    </div>
  );
}

/** The bright band that crosses the headline once, ending off to the right, unseen. */
function Sheen() {
  return (
    <M.div
      className="flagship-sheen"
      aria-hidden="true"
      {...keyframes([
        [0, { x: '-60%', opacity: 0 }],
        [6.4, { x: '-60%', opacity: 0 }],
        [6.5, { x: '-60%', opacity: 1 }],
        [7.3, { x: '160%', opacity: 1 }],
        [7.4, { x: '160%', opacity: 0 }],
        [10, { x: '160%', opacity: 0 }],
      ], EASE_INOUT)}
    />
  );
}

const DOODLES_LEFT = [
  { kind: 'sparkle', x: '4%', y: '10%', size: 'calc(3.6 * var(--u))', rotate: -8 },
  { kind: 'dot', x: '24%', y: '2%', size: 'calc(1.1 * var(--u))' },
  { kind: 'squiggle', x: '0%', y: '58%', size: 'calc(5 * var(--u))', rotate: 12 },
];
const DOODLES_RIGHT = [
  { kind: 'sparkleX', x: '78%', y: '6%', size: 'calc(3.2 * var(--u))' },
  { kind: 'ring', x: '92%', y: '44%', size: 'calc(1.6 * var(--u))' },
  { kind: 'zigzag', x: '70%', y: '62%', size: 'calc(5 * var(--u))', rotate: -6 },
];

/**
 * The flagship welcome slide, full-bleed behind the check-in moment.
 */
export default function FlagshipSlide() {
  return (
    <div className="flagship" role="img" aria-label="Welcome to Awana!">
      <div className="flagship-clouds" aria-hidden="true">
        <M.i className="flagship-cloud flagship-cloud--a" {...landsAt(0, 1.4, { x: ['-30%', '0%'], opacity: [0, 1] }, EASE_OUT)} />
        <M.i className="flagship-cloud flagship-cloud--b" {...landsAt(0.15, 1.4, { x: ['30%', '0%'], opacity: [0, 1] }, EASE_OUT)} />
      </div>

      <div className="flagship-copy">
        <div className="flagship-title">
          <Row text={ROWS[0]} startAt={1.3} row={0} />
          <Row text={ROWS[1]} startAt={2.1} row={1} />
          <Sheen />
        </div>
      </div>

      {/* The wrapper holds them unseen until their beat (a keyframe list, not
          a long delay), so the cluster's own pop-in can run from its start. */}
      <M.div className="flagship-doodle-slot flagship-doodle-slot--left" aria-hidden="true" {...landsAt(3.9, 0.2, { opacity: [0, 1] }, 'linear')}>
        <DoodleCluster items={DOODLES_LEFT} color="var(--brand-blue)" className="flagship-doodles" />
      </M.div>
      <M.div className="flagship-doodle-slot flagship-doodle-slot--right" aria-hidden="true" {...landsAt(4.0, 0.2, { opacity: [0, 1] }, 'linear')}>
        <DoodleCluster items={DOODLES_RIGHT} color="var(--brand-sun)" className="flagship-doodles" />
      </M.div>
    </div>
  );
}

import { M } from '../lib/motion.jsx';
import { BRAND_CLUBS } from '../lib/brand.js';
import { keyframes } from './promos/kit.jsx';
import { MIRROR_SWITCH_MS } from '../lib/ceremonyMirror.js';

// "Switching to the opening ceremony" (owner 2026-10-22: a five-second card
// before every screen turns over to the gym projector, ten seconds before
// 6:00). Beat sheet, seconds from the card's start (MIRROR_SWITCH_MS = 5 s):
//   0.00-0.90  the six club bands wipe in from the left, youngest first, a beat apart
//   0.80-1.25  the white plate pops up on the bands
//   1.00-1.40  SWITCHING TO, then OPENING CEREMONY, land
//   1.40-5.00  the bar under the words fills: the projector is coming
// The last keyframe of every piece is the finished card (what zero animation
// shows): bands across, plate up, words in, bar full. No sound.

const CLUB_ORDER = ['puggles', 'cubbies', 'sparks', 'tnt', 'trek', 'journey'];
const END = MIRROR_SWITCH_MS / 1000;

const band = (i) => keyframes([
  [0, { scaleX: 0 }],
  [i * 0.12, { scaleX: 0 }],
  [i * 0.12 + 0.3, { scaleX: 1 }],
  [END, { scaleX: 1 }],
]);
const plate = keyframes([
  [0, { opacity: 0, scale: 0.6, y: '3vh' }],
  [0.8, { opacity: 0, scale: 0.6, y: '3vh' }],
  [1.25, { opacity: 1, scale: 1, y: '0vh' }],
  [END, { opacity: 1, scale: 1, y: '0vh' }],
]);
const word = (at) => keyframes([
  [0, { opacity: 0, y: '1.4vh' }],
  [at, { opacity: 0, y: '1.4vh' }],
  [at + 0.3, { opacity: 1, y: '0vh' }],
  [END, { opacity: 1, y: '0vh' }],
]);
const bar = keyframes([
  [0, { scaleX: 0 }],
  [1.4, { scaleX: 0 }],
  [END, { scaleX: 1 }],
], 'linear');

/** The five-second card the screens show before they copy the gym projector. */
export function MirrorSwitching() {
  return (
    <div className="mirror-switch" data-testid="mirror-switching" role="status">
      <div className="mirror-switch__bands" aria-hidden="true">
        {CLUB_ORDER.map((id, i) => (
          <M.span key={id} className="mirror-switch__band" style={{ background: BRAND_CLUBS[id].primary }} {...band(i)} />
        ))}
      </div>
      <M.div className="mirror-switch__plate" {...plate}>
        <M.p className="mirror-switch__kicker" {...word(1.0)}>Switching to</M.p>
        <M.p className="mirror-switch__title" {...word(1.15)}>Opening ceremony</M.p>
        <span className="mirror-switch__track" aria-hidden="true">
          <M.span className="mirror-switch__bar" {...bar} />
        </span>
      </M.div>
    </div>
  );
}

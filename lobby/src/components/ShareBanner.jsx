import { M } from '../lib/motion.jsx';
import { EASE } from '../lib/brand.js';
import { useBw } from '../hooks/useBackwards.js';
import { shareWords } from '../../../shared/shareBanner.js';

// The share banner (owner 2026-11-23; words and timing shared/shareBanner.js):
// shares the owner hands out from /tools/shares, shown in the bottom third. A
// sun-gold plate rises from the foot with an ink hard edge, three gold coins pop
// on its left, the names land in the shout face and "got 3 shares!" under them.
// Flat like the kit: hard offsets, no gradient or blur. Its last keyframe is the
// plate at rest (the M rule); App takes it down after SHARE_BANNER_MS. Words
// spelled backwards on Backwards Night.

const PLATE = { initial: { y: '110%' }, animate: { y: '0%' }, transition: { duration: 0.55, ease: EASE.pop } };
const coin = (i) => ({
  initial: { scale: 0, rotate: -40 },
  animate: { scale: 1, rotate: 0 },
  transition: { delay: 0.35 + i * 0.12, duration: 0.4, ease: EASE.pop },
});
const words = (delay) => ({ initial: { opacity: 0, y: '0.4em' }, animate: { opacity: 1, y: '0em' }, transition: { delay, duration: 0.35, ease: EASE.settle } });

/** @param {{ gift: { kids: { firstName: string, club: string }[], shares: number } }} props */
export default function ShareBanner({ gift }) {
  const bw = useBw();
  const w = shareWords(gift);
  return (
    <M.div className="share-banner" role="status" aria-label={`${w.names} ${w.line}`} {...PLATE} exit={{ y: '110%', transition: { duration: 0.35, ease: EASE.exit } }}>
      <div className="share-banner__coins" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <M.svg key={i} className="share-banner__coin" viewBox="0 0 40 40" {...coin(i)}>
            <circle cx="20" cy="20" r="17" className="share-banner__coin-face" />
            <circle cx="20" cy="20" r="11" className="share-banner__coin-ring" />
          </M.svg>
        ))}
      </div>
      <div className="share-banner__copy">
        <M.div className="share-banner__names" {...words(0.3)}>{bw(w.names)}</M.div>
        <M.div className="share-banner__line" {...words(0.5)}>{bw(w.line)}</M.div>
      </div>
    </M.div>
  );
}

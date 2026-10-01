import { useReducedMotion } from 'framer-motion';
import { M } from '../lib/motion.jsx';

/**
 * The club identity on a banner: the club's mascot sticker (for the
 * three clubs that have one) tumbling in beside the white-knockout
 * wordmark (catalog extractions, plus custom catalog-style builds for
 * Trek and Journey). Unknown clubs fall back to a styled title pill so
 * a typo in the check-in system still looks intentional. Everything
 * pops in like stickers being slapped on (low damping for a visible
 * wobble), then floats gently for as long as the banner is up — unless
 * the viewer prefers reduced M.
 */
const logoPop = {
  hidden: { opacity: 0, scale: 0.3, rotate: -12 },
  show: { opacity: 1, scale: 1, rotate: 0, transition: { type: 'spring', stiffness: 260, damping: 12 } },
};

// The mascot tumbles in a beat after the wordmark, like a second
// sticker slapped on the band.
const mascotPop = {
  hidden: { opacity: 0, scale: 0.2, rotate: 24 },
  show: {
    opacity: 1,
    scale: 1,
    rotate: -6,
    transition: { type: 'spring', stiffness: 240, damping: 11, delay: 0.18 },
  },
};

export default function ClubBadge({ club, rawName }) {
  const reduced = useReducedMotion();
  const title = club.name || rawName || '';
  if (!club.logo && !title) return null;

  return (
    <M.span className="club-logo-slot" variants={logoPop}>
      {club.mascot && (
        <M.span className="club-mascot" variants={mascotPop}>
          <M.img
            src={club.mascot}
            alt=""
            animate={reduced ? undefined : { y: [0, -6, 0], rotate: [0, 4, 0] }}
            transition={{ duration: 3.8, delay: 0.6, repeat: Infinity, ease: 'easeInOut' }}
          />
        </M.span>
      )}
      {club.logo ? (
        <M.img
          className="club-logo"
          src={club.logo}
          alt={`${title || 'Club'} logo`}
          animate={reduced ? undefined : { y: [0, -7, 0], rotate: [-1.5, 1.5, -1.5] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
        />
      ) : (
        <span className="club-title-fallback">{title}</span>
      )}
    </M.span>
  );
}

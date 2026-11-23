import React from 'react';
import { motion } from 'framer-motion';
import { backwardsText } from '../../../../shared/backwards.js';
import { shareWords } from '../../../../shared/shareBanner.js';
import { BackwardsContext } from '../../hooks/useBackwards.js';

// The share banner on the projector (owner 2026-11-23; the lobby's twin is
// src/components/ShareBanner.jsx, the words and timing shared/shareBanner.js):
// a sun-gold plate rising into the wall's bottom third, three coins, the names
// and the amount. Flat; the wall's black stays everywhere else. Low power: no
// motion, the plate at rest.

/** @param {{ gift: { kids: { firstName: string }[], shares: number }, still?: boolean }} props */
export const ShareBanner = ({ gift, still = false }) => {
  const backwards = React.useContext(BackwardsContext);
  const w = shareWords(gift);
  const say = (t) => (backwards ? backwardsText(t) : t);
  const pop = (i) => (still ? {} : { initial: { scale: 0, rotate: -40 }, animate: { scale: 1, rotate: 0, transition: { delay: 0.35 + i * 0.12, duration: 0.4 } } });
  return (
    <motion.div
      className="pj-share"
      role="status"
      aria-label={`${w.names} ${w.line}`}
      initial={still ? false : { y: '110%' }}
      animate={{ y: '0%', transition: { duration: 0.55, ease: [0.34, 1.56, 0.64, 1] } }}
      exit={still ? undefined : { y: '110%', transition: { duration: 0.35 } }}
    >
      <div className="pj-share__coins" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <motion.svg key={i} viewBox="0 0 40 40" className="pj-share__coin" {...pop(i)}>
            <circle cx="20" cy="20" r="17" fill="#FFD54A" stroke="#231F20" strokeWidth="2.5" />
            <circle cx="20" cy="20" r="11" fill="none" stroke="#FAA41D" strokeWidth="3" />
          </motion.svg>
        ))}
      </div>
      <div className="pj-share__copy">
        <div className="pj-share__names">{say(w.names)}</div>
        <div className="pj-share__line">{say(w.line)}</div>
      </div>
    </motion.div>
  );
};

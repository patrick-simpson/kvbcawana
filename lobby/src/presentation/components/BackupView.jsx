import React from 'react';
import { motion } from 'framer-motion';
import awanaMark from '../../../../shared/brand/logos/awana-clubs-black.svg?url';
import { AWANA_PLEDGE_TEXT, US_PLEDGE_TEXT } from '../config.js';
import { DUR, EASE } from '../lib/motion-tokens.js';
import { HOUSE } from '../lib/kit.js';
import { Kicker } from './Kicker.jsx';
import { Words } from './Words.jsx';

/**
 * The opening-ceremony remote's backups (owner 2026-10-19: "The actual flags
 * are a backup only"): the remote's Next and Back move the slides, and these
 * three buttons put one screen over whatever is up until the remote takes it
 * down (App.jsx, `backup` / `backup-end`; Escape too). A flag stands beside
 * its pledge (owner: "Flag beside the pledge"); the verse stands alone.
 */

/** 2 Timothy 2:15, King James Version (public domain). */
export const VERSE_TEXT = 'Study to shew thyself approved unto God, a workman that needeth not to be ashamed, rightly dividing the word of truth.';
export const VERSE_REFERENCE = '2 Timothy 2:15 KJV';

// ── The American flag, drawn to its official proportions (4 U.S.C. 1;
// Executive Order 10834): hoist 1, fly 1.9, 13 stripes, a canton seven
// stripes deep and 0.76 long holding 50 stars of diameter 0.0616 in nine
// rows (6 and 5 alternating) on a 0.054 x 0.063 grid. Old Glory Red and Blue.
const FLAG = { fly: 1.9, canton: { w: 0.76, h: 7 / 13 }, star: 0.0616, gridX: 0.063, gridY: 0.054 };
const OLD_GLORY_RED = '#B22234';
const OLD_GLORY_BLUE = '#3C3B6E';

/** A five-pointed star's path, point up, centred on (cx, cy). */
const starPath = (cx, cy, r) => {
  const inner = r * 0.381966; // a regular star's inner radius
  const pts = [];
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : inner;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(4)} ${(cy + rr * Math.sin(a)).toFixed(4)}`);
  }
  return `M${pts.join('L')}Z`;
};

/** The 50 stars' centres (rows 0..8; even rows take even columns, odd rows odd). */
export const flagStars = () => {
  const out = [];
  for (let row = 0; row < 9; row += 1) {
    for (let col = row % 2; col < 11; col += 2) out.push([FLAG.gridX * (col + 1), FLAG.gridY * (row + 1)]);
  }
  return out;
};

const STARS_PATH = flagStars().map(([x, y]) => starPath(x, y, FLAG.star / 2)).join('');

export const UsFlag = () => (
  <svg className="pj-backup__flag" viewBox={`0 0 ${FLAG.fly} 1`} role="img" aria-label="The flag of the United States of America">
    {Array.from({ length: 13 }, (_, i) => (
      <rect key={i} x="0" y={i / 13} width={FLAG.fly} height={1 / 13 + 0.0005} fill={i % 2 === 0 ? OLD_GLORY_RED : '#FFFFFF'} />
    ))}
    <rect x="0" y="0" width={FLAG.canton.w} height={FLAG.canton.h} fill={OLD_GLORY_BLUE} />
    <path d={STARS_PATH} fill="#FFFFFF" />
  </svg>
);

/**
 * The Awana flag. Awana publishes no drawing of it, so until the owner sends
 * a photo of the church's own flag this is a stand-in: the official Awana
 * Clubs mark, whole and unaltered, on a white flag field (one swap here when
 * the photo arrives).
 */
export const AwanaFlag = () => (
  <div className="pj-backup__flag pj-backup__flag--awana" role="img" aria-label="The Awana flag">
    <img src={awanaMark} alt="" />
  </div>
);

const SCREENS = {
  'us-flag': { kicker: 'Pledge of Allegiance', text: US_PLEDGE_TEXT, color: HOUSE.orange, Flag: UsFlag },
  'awana-flag': { kicker: 'Awana Pledge', text: AWANA_PLEDGE_TEXT, color: HOUSE.orange, Flag: AwanaFlag },
  verse: { kicker: VERSE_REFERENCE, text: VERSE_TEXT, color: HOUSE.orange, Flag: null },
};

/** @param {{ what: 'us-flag' | 'awana-flag' | 'verse' }} props */
export const BackupView = ({ what }) => {
  const screen = SCREENS[what];
  if (!screen) return null;
  const { Flag } = screen;
  return (
    <motion.div
      className="pj-backup"
      data-backup={what}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: DUR.mode, ease: EASE.settle } }}
      exit={{ opacity: 0, transition: { duration: DUR.mode / 2, ease: EASE.exit } }}
    >
      <div className="pj-frame">
        <div className={Flag ? 'pj-backup__row' : 'pj-backup__row pj-backup__row--verse'}>
          {Flag && (
            <motion.div
              className="pj-backup__flag-box"
              initial={{ opacity: 0, x: '-6%' }}
              animate={{ opacity: 1, x: 0, transition: { duration: DUR.settle, ease: EASE.settle, delay: 0.1 } }}
            >
              <Flag />
            </motion.div>
          )}
          <div className="pj-backup__words">
            <Kicker color={screen.color} size="calc(2.6 * var(--u))">{screen.kicker}</Kicker>
            <p className="pj-body pj-backup__text"><Words text={screen.text} /></p>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

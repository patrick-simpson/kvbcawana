import React from 'react';
import { motion } from 'framer-motion';
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
 * The Awana flag, drawn from a photo of the church's own flag (owner
 * 2026-10-19: "Redraw it crisp"; the photo was too small to put on a wall):
 * a red field, the blue globe with its white grid ring, the AWANA and CLUBS
 * scroll banners in gold, and the three-tongued flame rising out of its
 * maroon chevron. Flat colour, hard outlines, 3:2 like the flag.
 */
const AWANA_RED = '#D52B30';
const AWANA_GOLD = '#F8C33A';
const AWANA_GOLD_DEEP = '#E2A12E';
const AWANA_MAROON = '#6B1E2B';
const AWANA_SKY = '#8ACDEB';
const AWANA_GRID = '#2161A8';
const AWANA_LETTER = '#C8252C';

/** One scroll banner: a white keyline, the gold strip, a thin maroon edge. */
const Banner = ({ x, y, w, h }) => (
  <>
    <rect x={x - 2.2} y={y - 2.2} width={w + 4.4} height={h + 4.4} rx={4} fill="#FFFFFF" />
    <rect x={x} y={y} width={w} height={h} rx={3} fill={AWANA_GOLD} stroke={AWANA_MAROON} strokeWidth={0.9} />
  </>
);

export const AwanaFlag = () => (
  <svg className="pj-backup__flag pj-backup__flag--awana" viewBox="0 0 300 200" role="img" aria-label="The Awana flag">
    <defs>
      <clipPath id="pj-awana-globe"><circle cx="149" cy="96" r="52" /></clipPath>
    </defs>
    <rect width="300" height="200" fill={AWANA_RED} />
    {/* The globe: maroon edge, white ring, sky with a blue grid. */}
    <circle cx="149" cy="96" r="56.5" fill="#FFFFFF" stroke={AWANA_MAROON} strokeWidth="1.2" />
    <circle cx="149" cy="96" r="52" fill={AWANA_SKY} />
    <g clipPath="url(#pj-awana-globe)" fill="none" stroke={AWANA_GRID} strokeWidth="1.7">
      <line x1="149" y1="40" x2="149" y2="152" />
      <ellipse cx="149" cy="96" rx="20" ry="52" />
      <ellipse cx="149" cy="96" rx="38" ry="52" />
      <path d="M95,96 H203 M97,76 Q149,72 201,76 M97,116 Q149,120 201,116 M104,58 Q149,54 194,58 M104,134 Q149,138 194,134" />
    </g>
    {/* AWANA, its tail folded under the right end. */}
    <path d="M96,114 L124,114 L124,127 L101,132 Z" fill={AWANA_GOLD_DEEP} stroke="#FFFFFF" strokeWidth="2.6" strokeLinejoin="round" />
    <path d="M96,114 L124,114 L124,127 L101,132 Z" fill={AWANA_GOLD_DEEP} stroke={AWANA_MAROON} strokeWidth="0.9" strokeLinejoin="round" />
    <Banner x={24} y={76} w={102} h={39} />
    <text x="75" y="104" textAnchor="middle" fontFamily="Figtree, Arial, sans-serif" fontWeight="800" fontSize="19" letterSpacing="0.6" fill={AWANA_LETTER}>AWANA</text>
    {/* CLUBS, tucked behind the flame. */}
    <Banner x={190} y={91} w={92} h={40} />
    <text x="246" y="119" textAnchor="middle" fontFamily="Figtree, Arial, sans-serif" fontWeight="800" fontSize="18" letterSpacing="0.4" fill={AWANA_LETTER}>CLUBS</text>
    {/* The chevron the flame rises from. */}
    <path d="M176,98 L215,137 L176,176 L137,137 Z" fill={AWANA_MAROON} stroke="#FFFFFF" strokeWidth="3" strokeLinejoin="round" />
    <path d="M150,141 L176,167 L202,141" fill="none" stroke="#FFFFFF" strokeWidth="1.4" strokeLinejoin="round" />
    {/* The flame: gold, red, gold, each tongue leaning as it rises. */}
    <g stroke={AWANA_MAROON} strokeWidth="1.3" strokeLinejoin="round">
      <path d="M160,158 C145,140 149,114 159,99 C165,90 166,84 166,76 C177,92 173,104 167,116 C161,128 163,144 160,158 Z" fill={AWANA_GOLD} />
      <path d="M176,162 C158,138 166,110 176,94 C182,83 186,70 186,56 C199,76 195,96 187,110 C180,124 181,146 176,162 Z" fill={AWANA_RED} />
      <path d="M190,158 C176,138 184,112 192,98 C197,88 197,80 197,70 C208,88 206,104 200,116 C194,128 195,144 190,158 Z" fill={AWANA_GOLD} />
    </g>
  </svg>
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

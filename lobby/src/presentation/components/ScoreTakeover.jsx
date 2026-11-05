import React from 'react';
import { motion } from 'framer-motion';
import { SCORE_TEAMS, SCORE_TEAM_COLORS, SCORE_TEAM_WORDS } from '../../../../shared/scoreboard.js';
import { EASE } from '../lib/motion-tokens.js';

/**
 * A point on the wall (owner 2026-11-05: "Big takeover"): the team's colour
 * wipes the whole wall out of its own corner, "RED +1!" slams in with the soft
 * squish, its new total rides a white pill under it, and white kit sparkles pop
 * round it. About 1.5 s (TAKEOVER_MS, the caller's timer), then it lifts away.
 *
 * Points within COMBINE_MS of each other share ONE takeover (owner: "Combine
 * them"): the wall splits into slanted bands, one per team, "RED +1" in each.
 *
 * `still` (low power / reduced motion): no wipe, no slam, no sparkles: the
 * finished card, held, then gone.
 *
 * @param {{ hits: {team: string, gained: number}[], scores: Record<string, number>, teams?: readonly string[], still: boolean }} props
 */
export const ScoreTakeover = ({ hits, scores, teams = SCORE_TEAMS, still }) => {
  const one = hits.length === 1;
  const origin = one ? originOf(hits[0].team, teams) : '50% 50%';
  return (
    <motion.div
      className="pj-take"
      data-teams={hits.map((h) => h.team).join(' ')}
      role="status"
      aria-label={hits.map((h) => `${SCORE_TEAM_WORDS[h.team]} plus ${h.gained}`).join(', ')}
      initial={still ? { opacity: 1 } : { clipPath: `circle(0% at ${origin})` }}
      animate={{ clipPath: `circle(150% at ${origin})`, opacity: 1, transition: still ? { duration: 0 } : { duration: 0.42, ease: EASE.wipe } }}
      exit={{ opacity: 0, scale: still ? 1 : 1.04, transition: { duration: still ? 0 : 0.22, ease: EASE.exit } }}
    >
      {hits.map((h, i) => (
        <Band key={h.team} hit={h} total={scores[h.team]} index={i} count={hits.length} still={still} />
      ))}
      {!still && one && <Sparkles color={SCORE_TEAM_COLORS[hits[0].team].ink === '#FFFFFF' ? '#FFFFFF' : '#231F20'} />}
    </motion.div>
  );
};

/** Where the team's plate sits (the wipe starts there): a corner of the 2 x 2, or a side of the two halves. */
const CORNERS = ['0% 0%', '100% 0%', '0% 100%', '100% 100%'];
const SIDES = ['0% 50%', '100% 50%'];
function originOf(team, teams) {
  const i = Math.max(0, teams.indexOf(team));
  return (teams.length === 2 ? SIDES : CORNERS)[i] || '50% 50%';
}

/** The slant between bands, as a share of the wall's width. */
const SLANT = 0.08;

const Band = ({ hit, total, index, count, still }) => {
  const c = SCORE_TEAM_COLORS[hit.team];
  const w = 1 / count;
  const x0 = index * w;
  const x1 = (index + 1) * w;
  const pct = (v) => `${(v * 100).toFixed(2)}%`;
  // A slanted band: its left edge leans one way, the right the same way, the
  // wall's own edges straight.
  const clip = count === 1
    ? undefined
    : `polygon(${pct(index === 0 ? 0 : x0 + SLANT / 2)} 0, ${pct(index === count - 1 ? 1 : x1 + SLANT / 2)} 0, ${pct(index === count - 1 ? 1 : x1 - SLANT / 2)} 100%, ${pct(index === 0 ? 0 : x0 - SLANT / 2)} 100%)`;
  const word = `${SCORE_TEAM_WORDS[hit.team]} +${hit.gained}${count === 1 ? '!' : ''}`;
  const size = count === 1 ? 19 : count === 2 ? 10.5 : count === 3 ? 7 : 5.2;
  const centre = (x0 + x1) / 2;
  return (
    <div className="pj-take__band" style={{ background: c.fill, clipPath: clip, '--team-deep': c.deep, '--team-ink': c.ink }}>
      <div className="pj-take__copy" style={{ left: `${(centre * 100).toFixed(2)}%` }}>
        <motion.div
          className="pj-take__word"
          style={{ fontSize: `calc(${size} * var(--u))` }}
          initial={still ? false : { scale: 2.4, opacity: 0, rotate: -4 }}
          animate={still ? undefined : {
            scale: [2.4, 0.9, 1.04, 1],
            scaleY: [1, 1, 0.9, 1],
            opacity: [0, 1, 1, 1],
            rotate: [-4, 0, 0, 0],
            transition: { duration: 0.6, times: [0, 0.45, 0.72, 1], ease: 'easeOut', delay: 0.12 },
          }}
        >
          {word}
        </motion.div>
        <motion.div
          className="pj-take__total"
          style={{ fontSize: `calc(${count === 1 ? 4 : 2.6} * var(--u))` }}
          initial={still ? false : { y: 30, opacity: 0 }}
          animate={still ? undefined : { y: 0, opacity: 1, transition: { delay: 0.38, type: 'spring', stiffness: 420, damping: 20 } }}
        >
          {total} {total === 1 ? 'POINT' : 'POINTS'}
        </motion.div>
      </div>
    </div>
  );
};

/** The kit's four-point sparkle, popped round the word (fixed places: never random on the wall). */
const SPARKS = [
  { x: 14, y: 17, s: 7.8, r: 10, d: 0.18 },
  { x: 81, y: 13, s: 5.7, r: -15, d: 0.26 },
  { x: 86, y: 74, s: 8.9, r: 20, d: 0.22 },
  { x: 12, y: 75, s: 4.7, r: 0, d: 0.3 },
  { x: 66, y: 82, s: 3.6, r: 30, d: 0.34 },
  { x: 30, y: 9, s: 3.2, r: 12, d: 0.38 },
];
const SPARKLE_PATH = 'M8.25,4.75L11.26,5.74C11.82,5.91 11.82,6.70 11.26,6.88L8.25,7.86C8.06,7.92 7.92,8.06 7.86,8.25L6.88,11.26C6.70,11.82 5.92,11.82 5.73,11.26L4.75,8.25C4.69,8.06 4.55,7.92 4.37,7.86L1.36,6.88C0.80,6.70 0.80,5.91 1.36,5.74L4.37,4.75C4.55,4.69 4.69,4.55 4.75,4.37L5.73,1.35C5.92,0.80 6.70,0.80 6.88,1.35L7.86,4.37C7.92,4.55 8.06,4.69 8.25,4.75';

const Sparkles = ({ color }) => (
  <>
    {SPARKS.map((p, i) => (
      <motion.svg
        key={i}
        className="pj-take__sparkle"
        viewBox="0 0 12.61 12.61"
        aria-hidden="true"
        style={{ left: `${p.x}%`, top: `${p.y}%`, width: `calc(${p.s} * var(--u))`, color }}
        initial={{ scale: 0, rotate: p.r - 90, opacity: 1 }}
        animate={{ scale: [0, 1.3, 1], rotate: p.r, transition: { duration: 0.5, delay: p.d, ease: EASE.pop } }}
      >
        <path fill="currentColor" d={SPARKLE_PATH} />
      </motion.svg>
    ))}
  </>
);

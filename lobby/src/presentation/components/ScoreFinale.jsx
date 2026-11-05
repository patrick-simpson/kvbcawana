import React from 'react';
import { motion } from 'framer-motion';
import { SCORE_CLUB_WORDS, SCORE_TEAMS, SCORE_TEAM_COLORS, SCORE_TEAM_WORDS, winnerOf } from '../../../../shared/scoreboard.js';
import { EASE } from '../lib/motion-tokens.js';

/**
 * The winner (owner 2026-11-05: "Winner, then schedule"; ties "Share the win"):
 * after End, or a switch to another club, the winning team's colour floods the
 * wall with "<TEAM> WINS!" over the four final scores, the winner's plate
 * lifted and keylined; a tie splits the wall into the tied teams' colours with
 * "IT'S A TIE!". Held FINALE_MS (the caller's timer) over whatever comes next.
 *
 * @param {{ club: string, scores: Record<string, number>, still: boolean }} props
 */
export const ScoreFinale = ({ club, scores, still }) => {
  const w = winnerOf(scores);
  const teams = w.teams.length ? w.teams : SCORE_TEAMS.slice(0, 1);
  const ink = !w.tie && SCORE_TEAM_COLORS[teams[0]].ink !== '#FFFFFF' ? 'ink' : 'white';
  const head = w.tie ? "IT'S A TIE!" : `${SCORE_TEAM_WORDS[teams[0]]} WINS!`;
  return (
    <motion.div
      className="pj-finale"
      data-ink={ink}
      data-winners={w.teams.join(' ')}
      role="status"
      aria-label={`${SCORE_CLUB_WORDS[club]} final: ${head}`}
      initial={still ? { opacity: 1 } : { clipPath: 'circle(0% at 50% 50%)' }}
      animate={{ clipPath: 'circle(150% at 50% 50%)', opacity: 1, transition: still ? { duration: 0 } : { duration: 0.64, ease: EASE.wipe } }}
      exit={{ opacity: 0, transition: { duration: still ? 0 : 0.4, ease: EASE.exit } }}
    >
      <div className="pj-finale__field" aria-hidden="true">
        {teams.map((t) => (
          <span key={t} style={{ background: SCORE_TEAM_COLORS[t].fill }} />
        ))}
      </div>
      <div className="pj-frame pj-finale__frame">
        <motion.p
          className="pj-finale__kick"
          initial={still ? false : { opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0, transition: { delay: 0.35, duration: 0.4, ease: EASE.settle } }}
        >
          {SCORE_CLUB_WORDS[club]} · Final
        </motion.p>
        <motion.p
          className="pj-finale__head"
          style={{ '--offset': w.tie ? '#231F20' : ink === 'ink' ? '#FFFFFF' : SCORE_TEAM_COLORS[teams[0]].deep }}
          initial={still ? false : { scale: 2.2, opacity: 0 }}
          animate={still ? undefined : { scale: [2.2, 0.92, 1.03, 1], scaleY: [1, 1, 0.92, 1], opacity: [0, 1, 1, 1], transition: { duration: 0.75, times: [0, 0.5, 0.75, 1], delay: 0.45 } }}
        >
          {head}
        </motion.p>
        <div className="pj-finale__row">
          {SCORE_TEAMS.map((t, i) => {
            const c = SCORE_TEAM_COLORS[t];
            const won = w.teams.includes(t);
            return (
              <motion.div
                key={t}
                className="pj-finale__chip"
                data-won={won ? '1' : '0'}
                style={{ '--team': c.fill, '--team-deep': c.deep, '--team-ink': c.ink }}
                initial={still ? false : { opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: won ? -12 : 0, transition: { delay: 0.9 + i * 0.08, type: 'spring', stiffness: 320, damping: 20 } }}
              >
                <span className="pj-finale__name">{SCORE_TEAM_WORDS[t]}</span>
                <span className="pj-finale__num">{scores[t]}</span>
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
};

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CLUBS } from '../config.js';
import { THEME, artUrl } from '../lib/shared-config.js';
import { StepChip } from '../components/StepChip.jsx';
import { ScoreClock } from '../components/ScoreClock.jsx';
import { ScoreTakeover } from '../components/ScoreTakeover.jsx';
import { useLowPower } from '../hooks/useLowPower.js';
import { useBirthdays } from '../hooks/useBirthdays.js';
import { birthdaysThisWeek, listNames } from '../lib/birthdays.js';
import { secondsUntil, windowEnd } from '../lib/schedule.js';
import { WARNING_LABELS, WARNING_STINGER_INTENSITY, warningFor } from '../lib/gameWarning.js';
import { WARNING_TONES } from '../lib/kit.js';
import { DUR, EASE } from '../lib/motion-tokens.js';
import { playStinger, playTones } from '../lib/stingers.js';
import { BirthdayChip, countForClub, formatLeft } from './GameTimeView.jsx';
import {
  COMBINE_MS,
  SCORE_TEAMS,
  SCORE_TEAM_CHIMES,
  SCORE_TEAM_COLORS,
  SCORE_TEAM_WORDS,
  TAKEOVER_MS,
  leaderOf,
  pointsGained,
} from '../../../../shared/scoreboard.js';

/**
 * The game time scoreboard on the wall (owner 2026-11-05; approved mockup):
 * the four teams as big plates in the phone's own 2 x 2 (blue top-left, red
 * top-right, yellow bottom-left, green bottom-right), each a giant number, the
 * leader tagged LEADING; everything else small along the bottom (the club
 * marks, the game clock, the checked-in counts, the week's birthdays).
 *
 * - In: the game clock drops from the middle into the strip as the plates
 *   slam in from their corners ("the timer on the screen should animate into
 *   scoring mode").
 * - A point: the team's colour takes the whole wall with "RED +1!" and its
 *   total (components/ScoreTakeover.jsx); points within COMBINE_MS share one
 *   takeover, split. A short chime per point. A removed point ticks down quietly.
 * - The stopwatch / timer (when the phone runs one) takes the middle and the
 *   plates shrink to a row across the top.
 * - The game clock leaves the strip once time is up; its warnings (WRAP IT UP,
 *   LINE UP NOW) and their stingers stay in the strip.
 *
 * Low power (switch or OS reduced motion): no slams, wipes or pops, the
 * takeover still shows (it is the news), held, then gone.
 *
 * @param {{
 *   now: Date,
 *   club: 'tnt'|'sparks'|'cubbies',
 *   scores: Record<string, number>,
 *   teams?: readonly string[],
 *   clock: any,
 *   serverNow: () => number,
 *   windows: any[],
 *   tally: any,
 * }} props
 */
export const ScoringView = ({ now, club, scores, teams = SCORE_TEAMS, clock, serverNow, windows, tally }) => {
  const lowPower = useLowPower();
  const info = CLUBS[club];
  const gameWindow = useMemo(
    () => (windows || []).find((w) => w.kind === 'game' && Array.isArray(w.clubs) && w.clubs.includes(club)) || null,
    [windows, club],
  );
  const clubIds = gameWindow ? gameWindow.clubs : [club];
  const endsAt = gameWindow ? windowEnd(gameWindow, now) : null;
  const seconds = endsAt ? secondsUntil(endsAt, now) : 0;
  const timeUp = !endsAt || seconds <= 0;
  const warning = timeUp ? 'none' : warningFor(seconds);
  const tone = WARNING_TONES[warning];

  // The warnings' stingers, as the game clock plays them (never on a re-render).
  const announced = useRef(warning);
  useEffect(() => {
    if (warning === announced.current) return;
    announced.current = warning;
    const intensity = WARNING_STINGER_INTENSITY[warning];
    if (intensity != null) playStinger(intensity);
  }, [warning]);

  // ── Points: a takeover per point (or a shared one), a chime each ──
  const [takeover, setTakeover] = useState(/** @type {null | {id: number, hits: {team: string, gained: number}[], startedAt: number}} */ (null));
  const prev = useRef(scores);
  const ids = useRef(0);
  useEffect(() => {
    const gained = pointsGained(prev.current, scores, teams);
    prev.current = scores;
    if (!gained.length) return;
    gained.forEach((g, i) => {
      const [a, b] = SCORE_TEAM_CHIMES[g.team];
      playTones([{ freq: a, at: i * 0.05, len: 0.18 }, { freq: b, at: i * 0.05 + 0.08, len: 0.32 }]);
    });
    const t = performance.now();
    setTakeover((cur) => {
      if (cur && t - cur.startedAt < COMBINE_MS) {
        // Combine: the teams so far, each with its total gain in this burst.
        const hits = cur.hits.map((h) => ({ ...h }));
        for (const g of gained) {
          const same = hits.find((h) => h.team === g.team);
          if (same) same.gained += g.gained;
          else hits.push(g);
        }
        hits.sort((x, y) => teams.indexOf(x.team) - teams.indexOf(y.team));
        return { id: cur.id, hits, startedAt: cur.startedAt, last: t };
      }
      ids.current += 1;
      return { id: ids.current, hits: gained, startedAt: t, last: t };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores]);
  useEffect(() => {
    if (!takeover) return undefined;
    const timer = window.setTimeout(() => setTakeover(null), TAKEOVER_MS + (takeover.last - takeover.startedAt));
    return () => window.clearTimeout(timer);
  }, [takeover]);

  const leader = leaderOf(scores, teams);
  const compact = Boolean(clock);

  // The strip's game clock drops in from the middle of the wall.
  const u = useFrameUnit();
  const dropFrom = lowPower ? false : { y: -26 * u, scale: 3.2, opacity: 0 };

  const roster = useBirthdays();
  const celebrants = birthdaysThisWeek(roster, now).filter((b) => clubIds.includes(b.club));
  const tallyFresh = tally != null && now.getTime() - tally.at.getTime() < 10 * 60 * 1000;
  const counts = clubIds
    .map((id) => ({ club: CLUBS[id], count: tallyFresh ? countForClub(tally, id) : null }))
    .filter((c) => c.club && c.count !== null);
  const endTimeStr = endsAt ? endsAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }) : '';

  return (
    <div className="w-full h-full relative overflow-hidden" style={{ background: '#000000' }} data-scoring={club}>
      <div className="pj-frame pj-score" data-compact={compact ? '1' : '0'} data-count={teams.length}>
        <div className="pj-score__grid">
          {teams.map((team, i) => (
            <TeamPlate key={team} team={team} score={scores[team]} index={i} count={teams.length} leading={leader === team} compact={compact} still={lowPower} />
          ))}
        </div>

        <AnimatePresence>
          {clock && (
            <motion.div
              key={`clock-${clock.id}`}
              className="pj-score__clock"
              initial={lowPower ? false : { opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1, transition: { duration: DUR.pop, ease: EASE.pop } }}
              exit={{ opacity: 0, scale: 0.85, transition: { duration: DUR.exit, ease: EASE.exit } }}
            >
              <ScoreClock clock={clock} serverNow={serverNow} accent={info.color} size="calc(19 * var(--u))" />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="pj-score__strip">
          <span className="pj-score__marks">
            {clubIds.map((id) => <SmallMark key={id} club={CLUBS[id]} />)}
          </span>
          <AnimatePresence initial={false}>
            {!timeUp && (
              <motion.span
                key="game-clock"
                className="inline-block pj-score__gameclock"
                initial={dropFrom}
                animate={{ y: 0, scale: 1, opacity: 1, transition: { duration: 0.9, ease: EASE.settle, delay: 0.15 } }}
                exit={{ opacity: 0, scale: 0.8, transition: { duration: DUR.exit, ease: EASE.exit } }}
                data-warning={warning !== 'none' ? warning : undefined}
              >
                <StepChip
                  label={warning === 'none' ? `Game ends ${endTimeStr}` : WARNING_LABELS[warning]}
                  value={formatLeft(seconds)}
                  size="calc(2.4 * var(--u))"
                  plate={tone?.plate ?? info.deep}
                />
              </motion.span>
            )}
          </AnimatePresence>
          <span className="flex-1" />
          {counts.map(({ club: c, count }) => (
            <motion.span key={`${c.id}-${count}`} className="inline-block" initial={lowPower ? false : { scale: 1.2 }} animate={{ scale: 1, transition: { duration: DUR.pop, ease: EASE.pop } }}>
              <StepChip label={counts.length > 1 ? c.name : 'Checked in'} value={count} size="calc(2.4 * var(--u))" plate={c.deep} />
            </motion.span>
          ))}
          {celebrants.length > 0 && (
            <BirthdayChip names={listNames(celebrants.map((b) => b.name))} still={lowPower} chipSize="calc(2.4 * var(--u))" maxWidthU={34} />
          )}
        </div>
      </div>

      <AnimatePresence>
        {takeover && <ScoreTakeover key={takeover.id} hits={takeover.hits} scores={scores} teams={teams} still={lowPower} />}
      </AnimatePresence>
    </div>
  );
};

/** Where the plates fly in from: the 2 x 2's corners (blue, red, yellow, green), or the two halves' sides. */
const FROM = {
  4: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 }],
  2: [{ x: -1, y: 0 }, { x: 1, y: 0 }],
};

/**
 * One team: its plate in its colour with a hard offset in its shade and a white
 * keyline out of register (the kit's stepped look), the name in Londrina caps,
 * the score in Paytone. A new score slams in; a lower one swaps quietly.
 */
const TeamPlate = ({ team, score, index, count, leading, compact, still }) => {
  const c = SCORE_TEAM_COLORS[team];
  const from = (FROM[count] || FROM[4])[index] || { x: 0, y: 1 };
  // Up or down since the last render (adjusted during render, never in an effect).
  const [seen, setSeen] = useState({ score, up: false });
  if (seen.score !== score) setSeen({ score, up: score > seen.score });
  const up = seen.up;
  const u = useFrameUnit();
  return (
    <motion.div
      layout={!still}
      className="pj-score__team"
      data-team={team}
      style={{ '--team': c.fill, '--team-deep': c.deep, '--team-ink': c.ink }}
      initial={still ? false : { opacity: 0, x: from.x * 30 * u, y: from.y * 18 * u, scale: 0.55, rotate: from.x * from.y * 6 }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 19, mass: 1, delay: still ? 0 : 0.05 * index, layout: { duration: 0.55, ease: EASE.settle } }}
    >
      <motion.span layout={still ? false : 'position'} className="pj-score__name">{SCORE_TEAM_WORDS[team]}</motion.span>
      <AnimatePresence>
        {leading && !compact && (
          <motion.span
            className="pj-score__lead"
            initial={still ? false : { opacity: 0, scale: 0.4, rotate: -8 }}
            animate={{ opacity: 1, scale: 1, rotate: 0, transition: { type: 'spring', stiffness: 380, damping: 18 } }}
            exit={{ opacity: 0, scale: 0.6, transition: { duration: DUR.exit } }}
          >
            Leading
          </motion.span>
        )}
      </AnimatePresence>
      <motion.span layout={still ? false : 'position'} className="pj-score__num-box">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={score}
            className="pj-score__num"
            initial={still || !up ? { opacity: 0 } : { opacity: 0, scale: 1.7, y: -4 * u }}
            animate={{ opacity: 1, scale: 1, y: 0, transition: up && !still ? { type: 'spring', stiffness: 520, damping: 16 } : { duration: 0.15 } }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
          >
            {score}
          </motion.span>
        </AnimatePresence>
      </motion.span>
    </motion.div>
  );
};

/** A club's white mark, small, for the strip (its name in its colour if the mark cannot load). */
const SmallMark = ({ club }) => {
  const [failed, setFailed] = useState(false);
  const art = THEME.clubs[club.id]?.art ?? {};
  const logo = art.logoWhite ?? art.logo;
  if (!logo || failed) return <span className="pj-score__markword" style={{ color: club.color }}>{club.name}</span>;
  return <img className="pj-score__mark" src={artUrl(logo)} alt={club.name} draggable={false} onError={() => setFailed(true)} />;
};

/** One projector unit (1% of the 16:9 frame's width) in px, for motion offsets. */
export function useFrameUnit() {
  const read = () => (typeof window === 'undefined' ? 19.2 : Math.min(window.innerWidth, (window.innerHeight * 16) / 9) / 100);
  const [u, setU] = useState(read);
  useLayoutEffect(() => {
    const on = () => setU(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return u;
}

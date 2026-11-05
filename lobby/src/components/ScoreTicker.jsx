import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { M } from '../lib/motion.jsx';
import { DUR, EASE, beats } from '../lib/brand.js';
import { holdThenLand } from '../lib/lobbyMotion.js';
import { squishBump, squishLand, withSquish } from '../lib/squish.js';
import { getClubPalette } from '../lib/clubs.js';
import schedule from '../../../shared/schedule.json';
import {
  SCORE_CLUB_WORDS, SCORE_TEAM_COLORS, SCORE_TEAM_WORDS,
  clockFace, clockReading, gameClockWords, pointsGained,
} from '../../../shared/scoreboard.js';

// The lobby's score bar (owner 2026-11-05, option A of three mockups: "a
// lower third ... it needs to all animate really nicely and look super
// professional"). A broadcast ticker along the bottom of the lobby while a
// club is up on the game time scoreboard: the club's block (mark, GAME TIME), one chip per team in the phone's order, and a clock (the game
// clock, or the stopwatch / timer while one runs). What it shows is the pure
// scoreTickerView (src/lib/scoreTicker.js).
//
// Beat sheet (seconds; the kit's beat is 0.1 s):
//   rise    0 - 0.52   the bar rises out of the foot (settle)
//   club    0.2        the club's mark and words land (settle)
//   chips   0.3 + 0.1n each team's chip pops in, squashing onto the bar
//   clock   0.3 + 0.1n the clock lands after the last chip
//   point   0 - 0.46   the chip bumps (1.12) and its number pops, a white ring
//                      flashes round it (0.9 s), "+1" rises over it and goes
//                      (1.1 s), and a band in the team's colour sweeps the
//                      bar left to right (0.64 s)
//   leave   0 - 0.28   the bar drops out of frame (a name, a held slide, the
//                      pickup board; it rises again after)
// Every transient piece's last keyframe is gone (off the bar or invisible),
// so zero animation shows the bar at rest with the new numbers.
// No sound: the chimes are the gym's (the projector), never the lobby's.

/** A count that changes pops in place and squashes as it lands (the tonight strip's pop). */
const VALUE_POP = withSquish(
  holdThenLand(0, DUR.pop, { scale: 1.3, opacity: 0.6 }, { scale: 1, opacity: 1 }, EASE.pop),
  squishBump('figure'),
);

/** The game clock's words re-read once a second; the stopwatch draws per frame. */
const GAME_CLOCK_TICK_MS = 1000;

/**
 * One team's chip. `bump` counts this team's points seen on screen (0 = none
 * yet): each new one replays the chip's bump, its ring and its "+N".
 */
function TeamChip({ team, value, index, bump, gained, won, final }) {
  const colors = SCORE_TEAM_COLORS[team];
  // Points from before this chip mounted (the bar rising again after a name)
  // are already in its number: only a point seen while it is up bumps it.
  const [since] = useState(bump);
  const hit = bump > since ? bump : 0;
  const [enter] = useState(() => withSquish(
    holdThenLand(beats(3 + index), DUR.pop, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1 }, EASE.pop),
    squishLand(beats(3 + index), 'chip', DUR.pop, 'pop'),
  ));
  return (
    <M.div
      className="score-ticker__team"
      data-team={team}
      data-won={won ? '1' : undefined}
      data-final={final ? '1' : undefined}
      style={{ '--team': colors.fill, '--team-deep': colors.deep, '--team-ink': colors.ink }}
      initial={enter.initial}
      animate={enter.animate}
      transition={enter.transition}
    >
      <M.span
        key={`face-${hit}`}
        className="score-ticker__face"
        initial={hit ? { scale: 1 } : false}
        animate={hit ? { scale: [1, 1.12, 1] } : { scale: 1 }}
        transition={{ duration: DUR.pop, times: [0, 0.35, 1], ease: [EASE.pop, EASE.settle] }}
      >
        <span className="score-ticker__word">{SCORE_TEAM_WORDS[team]}</span>
        <M.span
          key={`v-${value}`}
          className="score-ticker__num"
          initial={hit ? VALUE_POP.initial : false}
          animate={VALUE_POP.animate}
          transition={VALUE_POP.transition}
        >
          {value}
        </M.span>
      </M.span>
      {hit > 0 && (
        <>
          <M.span
            key={`ring-${hit}`}
            className="score-ticker__ring"
            aria-hidden="true"
            initial={{ opacity: 0, scale: 1 }}
            animate={{ opacity: [0, 1, 1, 0], scale: [1, 1.06, 1.06, 1.14] }}
            transition={{ duration: 0.9, times: [0, 0.12, 0.6, 1], ease: 'easeOut' }}
          />
          <M.span
            key={`plus-${hit}`}
            className="score-ticker__plus"
            aria-hidden="true"
            initial={{ opacity: 0, y: '60%', scale: 0.6 }}
            animate={{ opacity: [0, 1, 1, 0], y: ['60%', '0%', '0%', '-50%'], scale: [0.6, 1.1, 1, 1] }}
            transition={{ duration: 1.1, times: [0, 0.22, 0.75, 1], ease: [EASE.pop, 'linear', EASE.exit] }}
          >
            +{gained}
          </M.span>
        </>
      )}
    </M.div>
  );
}

/**
 * The clock slot: the stopwatch or timer while one is on (drawn per animation
 * frame on the Worker's clock, written only when its text changes), else the
 * club's game clock ("GAME ENDS 6:30 · 12:41"), or the finale's winner.
 */
function ClockSlot({ view, clock, serverNow, index }) {
  const [enter] = useState(() => holdThenLand(beats(3 + index), DUR.settle, { opacity: 0, x: 24 }, { opacity: 1, x: 0 }, EASE.settle));
  const [now, setNow] = useState(() => new Date());
  const mainRef = useRef(/** @type {HTMLElement | null} */ (null));
  const tenthRef = useRef(/** @type {HTMLElement | null} */ (null));
  const labelRef = useRef(/** @type {HTMLElement | null} */ (null));
  const running = clock && !view.final;

  useEffect(() => {
    if (running) return undefined;
    const t = window.setInterval(() => setNow(new Date()), GAME_CLOCK_TICK_MS);
    return () => window.clearInterval(t);
  }, [running]);

  useEffect(() => {
    if (!running) return undefined;
    let raf = 0;
    let last = '';
    const draw = () => {
      const r = clockReading(clock, serverNow());
      if (r) {
        const face = clockFace(r.ms, r.kind);
        const label = r.kind === 'stopwatch' ? 'Stopwatch' : r.done ? 'Timer' : 'Time left';
        const text = r.done ? `TIME!|${label}` : `${face.main}.${face.tenth}|${label}`;
        if (text !== last) {
          last = text;
          if (mainRef.current) mainRef.current.textContent = r.done ? 'TIME!' : face.main;
          if (tenthRef.current) tenthRef.current.textContent = r.done ? '' : `.${face.tenth}`;
          if (labelRef.current) labelRef.current.textContent = label;
        }
      }
      raf = window.requestAnimationFrame(draw);
    };
    draw();
    return () => window.cancelAnimationFrame(raf);
  }, [running, clock, serverNow]);

  let label;
  let value;
  if (view.final) {
    label = view.won.length > 1 ? "It's a tie" : view.won.length === 1 ? 'Winner' : 'Final';
    value = view.won.length ? view.won.map((t) => SCORE_TEAM_WORDS[t]).join(' + ') : 'No score';
  } else if (!running) {
    const words = gameClockWords(schedule, view.club, now);
    label = words.left ? words.label : 'Game time';
    value = words.left || (words.label === "Time's up" ? "TIME'S UP" : words.label.replace(/^Game time /, ''));
  }

  return (
    <M.div
      className="score-ticker__clock"
      data-kind={running ? clock.kind : view.final ? 'final' : 'game'}
      initial={enter.initial}
      animate={enter.animate}
      transition={enter.transition}
    >
      {running ? (
        <>
          <span className="score-ticker__clock-label" ref={labelRef} />
          <span className="score-ticker__clock-value"><span ref={mainRef} /><small ref={tenthRef} /></span>
        </>
      ) : (
        <>
          <span className="score-ticker__clock-label">{label}</span>
          <span className="score-ticker__clock-value">{value}</span>
        </>
      )}
    </M.div>
  );
}

/**
 * The team-colour band across the bar on a point. Only a point seen while the
 * bar is up sweeps (the bar rising again does not replay the last one).
 * @param {{ sweep: null | {id: number, team: string} }} props
 */
function Sweep({ sweep }) {
  const [since] = useState(sweep ? sweep.id : 0);
  if (!sweep || sweep.id <= since) return null;
  return (
    <M.span
      key={`sweep-${sweep.id}`}
      className="score-ticker__sweep"
      style={{ background: SCORE_TEAM_COLORS[sweep.team]?.fill }}
      initial={{ x: '-110%' }}
      animate={{ x: ['-110%', '160%'] }}
      transition={{ duration: DUR.wipe, ease: EASE.wipe }}
    />
  );
}

/**
 * The bar. `view` is scoreTickerView's answer (null = none), `active` the
 * room's say (false while a name, a held slide or the pickup board has the
 * foot: it drops away and rises again after).
 * @param {{
 *   view: ReturnType<typeof import('../lib/scoreTicker.js').scoreTickerView>,
 *   active: boolean,
 *   clock: any,
 *   serverNow: () => number,
 * }} props
 */
export default function ScoreTicker({ view, active, clock, serverNow }) {
  // Points seen on screen, per team, and the last sweep: a point arriving
  // while the bar is down shows as its new number when the bar comes back.
  const [hits, setHits] = useState(/** @type {{key: string, scores: any, bumps: Record<string, number>, gained: Record<string, number>, sweep: null | {id: number, team: string}}} */ ({
    key: '', scores: null, bumps: {}, gained: {}, sweep: null,
  }));
  const key = view ? `${view.club}|${view.teams.join(',')}|${view.final ? 'final' : 'live'}` : '';
  const shown = active && view != null;
  if (view && (hits.key !== key || hits.scores !== view.scores)) {
    // Adjust state during render (the React docs' pattern): a new club, setup
    // or finale starts quiet; a new reading of the same game bumps the teams
    // that gained, only while the bar can be seen.
    const same = hits.key === key;
    const gained = same && shown && !view.final ? pointsGained(hits.scores, view.scores, view.teams) : [];
    const bumps = same ? { ...hits.bumps } : {};
    const gainedBy = same ? { ...hits.gained } : {};
    let sweep = same ? hits.sweep : null;
    for (const g of gained) {
      bumps[g.team] = (bumps[g.team] || 0) + 1;
      gainedBy[g.team] = g.gained;
      sweep = { id: (sweep?.id || 0) + 1, team: g.team };
    }
    setHits({ key, scores: view.scores, bumps, gained: gainedBy, sweep });
  }

  const palette = view ? getClubPalette(view.club) : null;
  const [enter] = useState(() => holdThenLand(beats(2), DUR.settle, { opacity: 0, y: 12 }, { opacity: 1, y: 0 }, EASE.settle));

  return (
    <AnimatePresence mode="wait">
      {shown && (
        <M.div
          key={`score-ticker-${view.club}`}
          className="score-ticker"
          data-final={view.final ? '1' : undefined}
          data-count={view.teams.length}
          role="status"
          aria-live="off"
          aria-label={`${SCORE_CLUB_WORDS[view.club] || ''} game time: ${view.teams.map((t) => `${SCORE_TEAM_WORDS[t]} ${view.scores[t]}`).join(', ')}`}
          initial={{ y: '160%' }}
          animate={{ y: '0%', transition: { duration: DUR.settle, ease: EASE.settle } }}
          exit={{ y: '160%', transition: { duration: DUR.exit, ease: EASE.exit } }}
        >
          <div className="score-ticker__sweepclip" aria-hidden="true">
            <Sweep sweep={hits.sweep} />
          </div>
          <div className="score-ticker__club" style={{ '--club': palette?.deep || '#231F20' }}>
            <M.span className="score-ticker__club-inner" initial={enter.initial} animate={enter.animate} transition={enter.transition}>
              {palette?.logo
                ? <img className="score-ticker__mark" src={palette.logo} alt={SCORE_CLUB_WORDS[view.club] || ''} />
                : <span className="score-ticker__markword">{SCORE_CLUB_WORDS[view.club]}</span>}
              <span className="score-ticker__title">Game time</span>
              {/* Owner 2026-11-05: no LIVE tag; the pill is only for the final. */}
              {view.final && <span className="score-ticker__live" data-final="1">Final</span>}
            </M.span>
          </div>
          <div className="score-ticker__teams">
            {view.teams.map((t, i) => (
              <TeamChip
                key={t}
                team={t}
                index={i}
                value={view.scores[t]}
                bump={hits.key === key ? hits.bumps[t] || 0 : 0}
                gained={hits.gained[t] || 1}
                won={view.won.includes(t)}
                final={view.final}
              />
            ))}
          </div>
          <ClockSlot view={view} clock={clock} serverNow={serverNow} index={view.teams.length} />
        </M.div>
      )}
    </AnimatePresence>
  );
}

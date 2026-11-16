import React, { useEffect, useId, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  FINALE_MS, SCORE_CLUB_WORDS, SCORE_TEAMS, SCORE_TEAM_COLORS, SCORE_TEAM_WORDS, finaleFilmColors, finaleFilmFor, winnerOf,
} from '../../../../shared/scoreboard.js';
import { ScoreFinale } from './ScoreFinale.jsx';
import { boom, drumroll, fanfare, whooshSound } from '../lib/scoreSounds.js';
import { ConfettiBurst } from './ConfettiBurst.jsx';
import { EASE } from '../lib/motion-tokens.js';

/** Not playing this long after it appears, or stalled this long: the flat winner screen instead. */
export const FILM_WAIT_MS = 3500;
export const FILM_STALL_MS = 3000;
/** The colour cover holds at least this long before it opens onto the film. */
export const FILM_COVER_MIN_MS = 650;
/** The cover closes over the film this long before the finale ends (FINALE_MS). */
export const FILM_OUTRO_MS = 800;
/** The drumroll starts this long before WINS! lands. */
export const DRUMROLL_S = 1.7;
/**
 * The hold's payoffs (owner 2026-11-15, "as epic as possible": the scores used to sit still
 * for ten seconds): the winner's colour bursts again with a ring, confetti in its colours
 * and a boom, this long after the scores land, and again at FINALE_BURST2_S into the film.
 */
export const FINALE_BURST_AFTER_S = 3;
export const FINALE_BURST2_S = 16.5;

/**
 * A colour lifted toward white until it reads on the film's black (a dark ink, the blue,
 * vanished into it). Pure: '#RRGGBB' in and out.
 */
export function liftInk(hex, min = 0.3) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  if (lum >= min) return hex;
  const k = Math.min(0.5, (min - lum) / Math.max(1e-6, 1 - lum));
  return `#${c.map((v) => Math.round((v + (1 - v) * k) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** A winner film's address (lobby/public/finale/, made by video/score-finale/finale.py). */
export const filmSrc = (id) => `./finale/${id}.mp4`;

/**
 * The colour matrix that paints a three-ink film (video/score-finale/finale.py): its red
 * channel becomes `team`, its green white, its blue `deep`. For an SVG feColorMatrix, in
 * sRGB (the film was mixed that way).
 * @param {string} team @param {string} deep
 */
export function inkMatrix(team, deep) {
  const c = (h) => [1, 3, 5].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(4));
  const [tr, tg, tb] = c(team), [dr, dg, db] = c(deep);
  return `${tr} 1 ${dr} 0 0  ${tg} 1 ${dg} 0 0  ${tb} 1 ${db} 0 0  0 0 0 1 0`;
}

const IRIS_OPEN = 'circle(150% at 50% 50%)';
const IRIS_SHUT = 'circle(0% at 50% 50%)';
/** A slanted edge sweeping left to right (the takeovers' slant): all on, then all off the right side. */
const SLANT_ON = 'polygon(-8% 0%, 112% 0%, 112% 100%, -16% 100%)';
const SLANT_OFF = 'polygon(120% 0%, 140% 0%, 140% 100%, 112% 100%)';

/**
 * The winner, epic (owner 2026-11-15: "make epic animations. Use blender where it makes
 * sense"; picked: 3D for the finale only, 20 seconds, one film coloured live, "one of
 * each, and each night a different one plays"). Tonight's film (finaleFilmFor) plays
 * full screen, painted in the winner's colours (a tie: both teams'); at the film's own
 * big moment "<TEAM> WINS!" slams in over it with a flash and a fanfare, then the scores.
 *
 * The way in and out (owner 2026-11-15: "Make sure all the transitions to and from all of
 * these, including the 3d animations are epic and smooth"):
 * - In: the winner's colour bursts out of the middle of the wall over the scoreboard with
 *   a white ring and a whoosh (`cover`), and holds while the film loads (never black);
 *   once the film is playing (and FILM_COVER_MIN_MS has passed) the film punches through
 *   the colour from the middle, its own ring on the edge, as the camera pushes in (`film`).
 * - Out: FILM_OUTRO_MS before the end the colour bursts out again over the film, the
 *   words lifting away (`out`); then the whole layer sweeps off to the right on a slant
 *   onto whatever is next (the schedule, or the next club's GAME ON!, which waited for it).
 *
 * Never a black wall: low power, an error, a film that does not start within
 * FILM_WAIT_MS or stalls for FILM_STALL_MS, and the flat winner screen (ScoreFinale)
 * plays instead, with the same words: out of the colour cover with no seam when the film
 * never started, over the stopped film with its own wipe when it stalled.
 *
 * @param {{ club: string, scores: Record<string, number>, teams?: readonly string[], night: string, still: boolean, sounds?: boolean }} props
 */
export const FinaleFilm = ({ club, scores, teams: playing = SCORE_TEAMS, night, still, sounds = false }) => {
  const film = finaleFilmFor(night);
  const w = winnerOf(scores, playing);
  const winners = w.teams.length ? w.teams : playing.slice(0, 1);
  const film0 = finaleFilmColors(winners);
  const colors = { team: liftInk(film0.team), deep: w.tie ? liftInk(film0.deep) : film0.deep };
  const head = w.tie ? "IT'S A TIE!" : `${SCORE_TEAM_WORDS[winners[0]]} WINS!`;
  const filterId = `pj-ink-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const video = useRef(/** @type {HTMLVideoElement|null} */ (null));
  // 'none', 'early' (never played: the flat screen out of the cover) or 'late' (stalled: over the film).
  const [failed, setFailed] = useState(still ? 'early' : 'none');
  const [phase, setPhase] = useState(/** @type {'cover'|'film'|'out'} */ ('cover'));
  const [beat, setBeat] = useState(0);   // 0 the film alone, 1 the words, 2 the scores
  const [bursts, setBursts] = useState(0);   // the hold's payoffs so far
  const played = useRef(false);
  const rolled = useRef(false);
  const burstsRef = useRef(0);
  const soundsRef = useRef(sounds);
  useEffect(() => { soundsRef.current = sounds; }, [sounds]);

  // The whoosh as the colour bursts in, and the outro's cover closing in before the end.
  useEffect(() => {
    if (still) return undefined;
    whooshSound(sounds);
    const out = window.setTimeout(() => { setPhase('out'); whooshSound(sounds); }, FINALE_MS - FILM_OUTRO_MS);
    return () => window.clearTimeout(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (failed !== 'none') return undefined;
    const v = video.current;
    if (!v) return undefined;
    const born = performance.now();
    let lastT = -1, lastMove = born, reveal = 0;
    const give = () => setFailed(played.current ? 'late' : 'early');
    const wait = window.setTimeout(() => { if (!played.current) give(); }, FILM_WAIT_MS);
    const watch = window.setInterval(() => {
      if (!played.current || v.ended) return;
      if (v.currentTime !== lastT) { lastT = v.currentTime; lastMove = performance.now(); return; }
      if (performance.now() - lastMove > FILM_STALL_MS) give();
    }, 500);
    const onPlaying = () => {
      if (played.current) return;
      played.current = true;
      reveal = window.setTimeout(() => setPhase((p) => (p === 'cover' ? 'film' : p)), Math.max(0, FILM_COVER_MIN_MS - (performance.now() - born)));
    };
    const onTime = () => {
      const t = v.currentTime;
      setBeat(t >= film.scores ? 2 : t >= film.head ? 1 : 0);
      if (!rolled.current && t >= film.head - DRUMROLL_S && t < film.head) { rolled.current = true; drumroll(soundsRef.current, Math.max(0.4, film.head - t)); }
      const due = (t >= film.scores + FINALE_BURST_AFTER_S ? 1 : 0) + (t >= FINALE_BURST2_S ? 1 : 0);
      if (due > burstsRef.current) { burstsRef.current = due; setBursts(due); boom(soundsRef.current); }
    };
    v.addEventListener('playing', onPlaying);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('error', give);
    v.play()?.catch?.(() => give());
    return () => {
      window.clearTimeout(wait); window.clearTimeout(reveal); window.clearInterval(watch);
      v.removeEventListener('playing', onPlaying); v.removeEventListener('timeupdate', onTime); v.removeEventListener('error', give);
    };
  }, [failed, film]);

  // The fanfare lands with the words.
  const sounded = useRef(false);
  useEffect(() => {
    if (failed === 'none' && beat >= 1 && !sounded.current) { sounded.current = true; fanfare(sounds); }
  }, [beat, sounds, failed]);

  // Never started: the flat winner screen, opening straight out of the same colour (no wipe of its own).
  if (failed === 'early') return <ScoreFinale club={club} scores={scores} teams={playing} still={still} covered={!still} />;

  const ink = SCORE_TEAM_COLORS[winners[0]]?.ink === '#FFFFFF' || w.tie ? 'white' : 'ink';
  const leaving = phase === 'out';
  return (
    <motion.div
      className="pj-film"
      data-film={film.id}
      data-phase={phase}
      data-winners={w.teams.join(' ')}
      role="status"
      aria-label={`${SCORE_CLUB_WORDS[club]} final: ${head}`}
      initial={{ clipPath: IRIS_SHUT }}
      animate={{ clipPath: IRIS_OPEN, transition: { duration: 0.5, ease: EASE.wipe } }}
      exit={{ clipPath: [SLANT_ON, SLANT_OFF], transition: { duration: 0.55, ease: EASE.wipe } }}
    >
      {/* The winner's colour: over the scoreboard as it bursts in, under the film once it
          punches through, and over the film's end. */}
      <motion.div
        className="pj-film__cover"
        aria-hidden="true"
        style={{ zIndex: leaving ? 3 : 0 }}
        initial={{ clipPath: IRIS_OPEN }}
        animate={phase === 'film'
          ? { clipPath: IRIS_SHUT, transition: { delay: 0.9, duration: 0 } }
          : { clipPath: IRIS_OPEN, transition: { duration: 0.5, ease: EASE.wipe } }}
      >
        <div className="pj-finale__field">
          {winners.map((t) => <span key={t} style={{ background: SCORE_TEAM_COLORS[t].fill }} />)}
        </div>
      </motion.div>
      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={inkMatrix(colors.team, colors.deep)} />
        </filter>
      </svg>
      {/* The film's own first seconds are dark: the winner's colour glows over them and
          clears as the film comes up to its big moment. */}
      {phase !== 'cover' && (
        <motion.div
          className="pj-film__glow"
          aria-hidden="true"
          style={{ background: `radial-gradient(ellipse at 50% 60%, ${colors.team} 0%, ${colors.deep} 55%, #000000 100%)` }}
          initial={{ opacity: 0.6 }}
          animate={{ opacity: [0.6, 0.35, 0], transition: { duration: Math.max(1, film.head - 0.4), times: [0, 0.4, 1], ease: 'easeIn' } }}
        />
      )}
      <motion.div
        className="pj-film__reel"
        initial={{ clipPath: IRIS_SHUT }}
        animate={{ clipPath: phase === 'cover' ? IRIS_SHUT : IRIS_OPEN, transition: { duration: 0.75, ease: EASE.wipe } }}
      >
        <motion.video
          ref={video}
          className="pj-film__video"
          src={filmSrc(film.id)}
          muted
          playsInline
          preload="auto"
          style={{ filter: `url(#${filterId})` }}
          initial={{ scale: 1.25 }}
          animate={phase === 'cover' ? { scale: 1.25 } : leaving
            ? { scale: 1.08, transition: { duration: FILM_OUTRO_MS / 1000, ease: 'easeIn' } }
            // in from the burst, then a slow push all through the hold (never a still frame)
            : { scale: [1.25, 1, 1.12], transition: { duration: 20, times: [0, 0.09, 1], ease: ['easeOut', 'linear'] } }}
        />
      </motion.div>
      {failed === 'none' && beat >= 1 && (
        <motion.div
          className="pj-film__flash"
          aria-hidden="true"
          initial={{ opacity: 0.85 }}
          animate={{ opacity: 0, transition: { duration: 0.55, ease: 'easeOut' } }}
        />
      )}
      {failed === 'none' && bursts > 0 && !leaving && (
        <React.Fragment key={`burst-${bursts}`}>
          <motion.div className="pj-film__flash" aria-hidden="true" style={{ background: colors.team }} initial={{ opacity: 0.6 }} animate={{ opacity: 0, transition: { duration: 0.7, ease: 'easeOut' } }} />
          <motion.div className="pj-film__ring" aria-hidden="true" style={{ zIndex: 4 }} initial={{ scale: 0, opacity: 1 }} animate={{ scale: 1, opacity: 0, transition: { duration: 0.9, ease: EASE.wipe } }} />
          <ConfettiBurst colors={[colors.team, '#FFFFFF', colors.deep]} scale={2.4} />
        </React.Fragment>
      )}
      {failed === 'none' && (
        <div className="pj-frame pj-film__frame" data-ink={ink} data-tie={w.tie ? '1' : undefined}>
          {beat >= 1 && (
            <>
              <motion.p
                className="pj-finale__kick pj-film__kick"
                initial={{ opacity: 0, y: -20 }}
                animate={leaving ? { opacity: 0, y: -30, transition: { duration: 0.3 } } : { opacity: 1, y: 0, transition: { delay: 0.15, duration: 0.4 } }}
              >
                {SCORE_CLUB_WORDS[club]} · Final
              </motion.p>
              <motion.p
                key={`head-${bursts}`}
                className="pj-finale__head pj-film__head"
                style={{ '--offset': colors.deep, '--offset2': colors.team }}
                initial={bursts > 0 ? false : { scale: 3.2, opacity: 0, rotate: -6 }}
                animate={leaving
                  ? { scale: 1.5, opacity: 0, rotate: 0, transition: { duration: 0.4, ease: 'easeIn' } }
                  : bursts > 0
                    // each payoff kicks the words again
                    ? { scale: [1, 1.16, 0.97, 1], opacity: 1, rotate: [0, -2, 0, 0], transition: { duration: 0.55, times: [0, 0.35, 0.7, 1] } }
                    : { scale: [3.2, 0.88, 1.06, 1], opacity: [0, 1, 1, 1], rotate: [-6, 0, 0, 0], transition: { duration: 0.7, times: [0, 0.45, 0.72, 1] } }}
              >
                {head}
              </motion.p>
            </>
          )}
          {beat >= 2 && (
            <div className="pj-finale__row pj-film__row">
              {playing.map((t, i) => {
                const c = SCORE_TEAM_COLORS[t];
                const won = w.teams.includes(t);
                return (
                  <motion.div
                    key={t}
                    className="pj-finale__chip"
                    data-won={won ? '1' : '0'}
                    style={{ '--team': c.fill, '--team-deep': c.deep, '--team-ink': c.ink }}
                    initial={{ opacity: 0, y: 40 }}
                    animate={leaving
                      ? { opacity: 0, y: 60, transition: { duration: 0.3, delay: i * 0.04, ease: 'easeIn' } }
                      : { opacity: 1, y: won ? -12 : 0, transition: { delay: i * 0.08, type: 'spring', stiffness: 320, damping: 20 } }}
                  >
                    <span className="pj-finale__name">{SCORE_TEAM_WORDS[t]}</span>
                    <span className="pj-finale__num"><CountUp to={scores[t]} delay={0.15 + i * 0.08} /></span>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {/* A white ring rides each burst's edge: the colour in, the film through, the colour back. */}
      <motion.div
        key={`ring-${phase}`}
        style={{ zIndex: 4 }}
        className="pj-film__ring"
        aria-hidden="true"
        initial={{ scale: 0, opacity: 1 }}
        animate={{ scale: 1, opacity: 0, transition: { duration: 0.7, ease: EASE.wipe } }}
      />
      {failed === 'late' && <ScoreFinale club={club} scores={scores} teams={playing} still={false} />}
    </motion.div>
  );
};

/** A final score counting up from 0 as its chip lands (about a second; the last frame is the score). */
const CountUp = ({ to, delay = 0 }) => {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now() + delay * 1000;
    const step = (now) => {
      const k = Math.min(1, Math.max(0, (now - t0) / 900));
      setN(Math.round(to * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, delay]);
  return n;
};

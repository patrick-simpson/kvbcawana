import React, { useEffect, useId, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  SCORE_CLUB_WORDS, SCORE_TEAMS, SCORE_TEAM_COLORS, SCORE_TEAM_WORDS, finaleFilmColors, finaleFilmFor, winnerOf,
} from '../../../../shared/scoreboard.js';
import { ScoreFinale } from './ScoreFinale.jsx';
import { fanfare } from '../lib/scoreSounds.js';

/** Not playing this long after it appears, or stalled this long: the flat winner screen instead. */
export const FILM_WAIT_MS = 3500;
export const FILM_STALL_MS = 3000;

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

/**
 * The winner, epic (owner 2026-11-15: "make epic animations. Use blender where it makes
 * sense"; picked: 3D for the finale only, 20 seconds, one film coloured live, "one of
 * each, and each night a different one plays"). Tonight's film (finaleFilmFor) plays
 * full screen, painted in the winner's colours (a tie: both teams'); at the film's own
 * big moment "<TEAM> WINS!" slams in over it with a fanfare, then the final scores.
 *
 * Never a black wall: low power, an error, a film that does not start within
 * FILM_WAIT_MS or stalls for FILM_STALL_MS, and the flat winner screen (ScoreFinale)
 * plays instead, with the same words.
 *
 * @param {{ club: string, scores: Record<string, number>, teams?: readonly string[], night: string, still: boolean, sounds?: boolean }} props
 */
export const FinaleFilm = ({ club, scores, teams: playing = SCORE_TEAMS, night, still, sounds = false }) => {
  const film = finaleFilmFor(night);
  const w = winnerOf(scores, playing);
  const winners = w.teams.length ? w.teams : playing.slice(0, 1);
  const colors = finaleFilmColors(winners);
  const head = w.tie ? "IT'S A TIE!" : `${SCORE_TEAM_WORDS[winners[0]]} WINS!`;
  const filterId = `pj-ink-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const video = useRef(/** @type {HTMLVideoElement|null} */ (null));
  const [failed, setFailed] = useState(still);
  const [beat, setBeat] = useState(0);   // 0 the film alone, 1 the words, 2 the scores
  const played = useRef(false);

  useEffect(() => {
    if (failed) return undefined;
    const v = video.current;
    if (!v) return undefined;
    let lastT = -1, lastMove = performance.now();
    const give = () => setFailed(true);
    const wait = window.setTimeout(() => { if (!played.current) give(); }, FILM_WAIT_MS);
    const watch = window.setInterval(() => {
      if (!played.current || v.ended) return;
      if (v.currentTime !== lastT) { lastT = v.currentTime; lastMove = performance.now(); return; }
      if (performance.now() - lastMove > FILM_STALL_MS) give();
    }, 500);
    const onPlaying = () => { played.current = true; };
    const onTime = () => {
      const t = v.currentTime;
      setBeat(t >= film.scores ? 2 : t >= film.head ? 1 : 0);
    };
    v.addEventListener('playing', onPlaying);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('error', give);
    v.play()?.catch?.(() => give());
    return () => {
      window.clearTimeout(wait); window.clearInterval(watch);
      v.removeEventListener('playing', onPlaying); v.removeEventListener('timeupdate', onTime); v.removeEventListener('error', give);
    };
  }, [failed, film]);

  // The fanfare lands with the words.
  const sounded = useRef(false);
  useEffect(() => {
    if (beat >= 1 && !sounded.current) { sounded.current = true; fanfare(sounds); }
  }, [beat, sounds]);

  if (failed) return <ScoreFinale club={club} scores={scores} teams={playing} still={still} />;

  const ink = SCORE_TEAM_COLORS[winners[0]]?.ink === '#FFFFFF' || w.tie ? 'white' : 'ink';
  return (
    <motion.div
      className="pj-film"
      data-film={film.id}
      data-winners={w.teams.join(' ')}
      role="status"
      aria-label={`${SCORE_CLUB_WORDS[club]} final: ${head}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.35 } }}
      exit={{ opacity: 0, transition: { duration: 0.5 } }}
    >
      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={inkMatrix(colors.team, colors.deep)} />
        </filter>
      </svg>
      <video
        ref={video}
        className="pj-film__video"
        src={filmSrc(film.id)}
        muted
        playsInline
        preload="auto"
        style={{ filter: `url(#${filterId})` }}
      />
      <div className="pj-frame pj-film__frame" data-ink={ink}>
        {beat >= 1 && (
          <>
            <motion.p
              className="pj-finale__kick pj-film__kick"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 0.15, duration: 0.4 } }}
            >
              {SCORE_CLUB_WORDS[club]} · Final
            </motion.p>
            <motion.p
              className="pj-finale__head pj-film__head"
              style={{ '--offset': colors.deep }}
              initial={{ scale: 3.2, opacity: 0, rotate: -6 }}
              animate={{ scale: [3.2, 0.88, 1.06, 1], opacity: [0, 1, 1, 1], rotate: [-6, 0, 0, 0], transition: { duration: 0.7, times: [0, 0.45, 0.72, 1] } }}
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
                  animate={{ opacity: 1, y: won ? -12 : 0, transition: { delay: i * 0.08, type: 'spring', stiffness: 320, damping: 20 } }}
                >
                  <span className="pj-finale__name">{SCORE_TEAM_WORDS[t]}</span>
                  <span className="pj-finale__num">{scores[t]}</span>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
};

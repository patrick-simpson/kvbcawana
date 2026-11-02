import React, { useEffect, useRef, useState } from 'react';
import { useLowPower } from '../hooks/useLowPower.js';
import { FILM, filmSrc } from '../lib/grandWelcomeFilm.js';

/**
 * The grand welcome (owner 2026-10-19: "an epic welcome to Awana opening
 * animation"; since 2026-11-01 the 3D film, video/grand-welcome/ and its
 * BRIEF.md). The opening deck's first slide (config.js, id `welcome`, 20 s),
 * so it plays the moment the schedule turns to the ceremony, and again
 * whenever a leader steps back to it. The film, by the second: the
 * countdown's "0:00" alone on black; the six club ribbons trace its zeros and
 * peel off; they race round the room, weave into one knot, and burst into
 * starlight; WELCOME TO lands over the church's full logo; each club's light
 * delivers its mark to its plate, youngest first; a held moment (a few
 * sparkles spell 2 Tim 2:15); a fade to black, the US Pledge slide's own
 * first frame.
 *
 * It owns its slide's end: `onEnd` when the film ends (SlideshowView's timer
 * is only a cap, FILM.sec + FILM.grace). The first frame shows the instant it
 * lands (the poster, the countdown's own picture; App.jsx cuts to it). The
 * low-power switch (and OS reduced motion) shows the film's landed frame,
 * still, for FILM.sec: the M rule's finished frame. A film that can't play
 * (an error, not playing within FILM.waitMs, stalled FILM.stallMs) gives way
 * to the same still for the rest of the slide: never black, never a wedge.
 * Silent, muted. The corner logo steps aside while it is up (SlideshowView
 * reports it bare): the film draws the church's full logo itself.
 */

export const GRAND_WELCOME_SEC = FILM.sec;

/** @param {{ onEnd?: () => void }} props */
export const GrandWelcome = ({ onEnd }) => {
  const lowPower = useLowPower();
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const still = lowPower || failed;
  const video = useRef(/** @type {HTMLVideoElement | null} */ (null));
  const played = useRef(false);
  const endRef = useRef(onEnd);
  useEffect(() => {
    endRef.current = onEnd;
  });

  // Start it, and give up on it (the still) if it won't play.
  useEffect(() => {
    if (lowPower) return undefined;
    const v = video.current;
    if (!v) return undefined;
    v.muted = true;
    const p = v.play?.();
    if (p && typeof p.catch === 'function') p.catch(() => setFailed(true));
    const t = setTimeout(() => setFailed((f) => f || !played.current), FILM.waitMs);
    return () => clearTimeout(t);
  }, [lowPower]);

  // A stall mid-film: the still.
  const stall = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const clearStall = () => {
    if (stall.current) clearTimeout(stall.current);
    stall.current = null;
  };
  useEffect(() => clearStall, []);

  // The still holds for the film's length, then the slide moves on.
  useEffect(() => {
    if (!lowPower) return undefined;
    const t = setTimeout(() => endRef.current?.(), FILM.sec * 1000);
    return () => clearTimeout(t);
  }, [lowPower]);

  return (
    <div
      className="pj-grand-film"
      role="img"
      aria-label="Welcome to Kennebec Valley Baptist Church Awana Clubs"
      data-grand-welcome={still ? 'still' : playing ? 'playing' : 'loading'}
    >
      {!lowPower && !failed && (
        <video
          ref={video}
          className="pj-grand-film__video"
          src={filmSrc()}
          poster={FILM.first}
          muted
          playsInline
          preload="auto"
          onPlaying={() => { clearStall(); played.current = true; setPlaying(true); }}
          onWaiting={() => {
            clearStall();
            stall.current = setTimeout(() => setFailed(true), FILM.stallMs);
          }}
          onError={() => setFailed(true)}
          onEnded={() => endRef.current?.()}
        />
      )}
      {still && <img className="pj-grand-film__still" src={FILM.still} alt="" />}
    </div>
  );
};

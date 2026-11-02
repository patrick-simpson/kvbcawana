import { useContext, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { ZeroAnimationContext } from '../lib/motion.jsx';

// The opening ceremony's lead-in (owner 2026-11-01, video/grand-welcome/
// BRIEF.md "The lead-in"; replaced the 2026-10-22 "Switching to opening
// ceremony" card in the same five seconds, lib/ceremonyMirror.js
// MIRROR_SWITCH_MS): one shared 3D film for the lobby TV, Journey and the
// classroom (both embed this lobby, which runs the mirror). It is
// SEE-THROUGH (VP9 WebM with alpha): six club-colour edges race across the
// screen pulling black in behind them, over whatever the screen is showing,
// OPENING CEREMONY lands and steps away, and its last frame is pure black,
// where the screen's copy of the gym projector (its countdown, on black)
// takes over. Made by video/grand-welcome/grand_welcome.py --lead-in --final.
//
// Mounted with the hidden mirror (two minutes early) so the film is loaded
// by the time it plays; it plays from the start each time `playing` turns on.
// Zero animation (the M rule) and OS reduced motion show its card at rest (a
// still, the words on black); so does a film that can't play. Silent.

export const LEAD_IN = Object.freeze({
  src: './welcome/opening-lead-in.webm',
  still: './welcome/opening-lead-in-still.png',
});

/** @param {{ playing: boolean }} props */
export function CeremonyLeadIn({ playing }) {
  const zero = useContext(ZeroAnimationContext);
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const still = zero || reduced || failed;
  const video = useRef(/** @type {HTMLVideoElement | null} */ (null));

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (playing) {
      v.muted = true;
      try { v.currentTime = 0; } catch { /* not loaded yet: it starts at 0 anyway */ }
      const p = v.play?.();
      if (p && typeof p.catch === 'function') p.catch(() => setFailed(true));
    } else {
      v.pause?.();
    }
  }, [playing]);

  return (
    <div
      className="ceremony-lead-in"
      data-testid="ceremony-lead-in"
      data-playing={playing ? '1' : '0'}
      role={playing ? 'status' : undefined}
      aria-label={playing ? 'Opening ceremony' : undefined}
      aria-hidden={!playing}
    >
      {!zero && !reduced && !failed && (
        <video
          ref={video}
          className="ceremony-lead-in__video"
          src={LEAD_IN.src}
          muted
          playsInline
          preload="auto"
          onError={() => setFailed(true)}
        />
      )}
      {playing && still && <img className="ceremony-lead-in__still" src={LEAD_IN.still} alt="" />}
    </div>
  );
}

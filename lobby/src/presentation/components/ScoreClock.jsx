import React, { useEffect, useRef } from 'react';
import { clockFace, clockReading } from '../../../../shared/scoreboard.js';
import { playTones } from '../lib/stingers.js';

/**
 * The scoreboard's stopwatch / countdown timer, big (owner 2026-11-05: "a high
 * quality stopwatch / timer ... sync up on the screen and needs to be extremely
 * accurate").
 *
 * The reading is the WORKER's clock (`serverNow`, hooks/useScoreboard.js), so
 * the wall and the leader's phone agree. Drawn once per animation frame by
 * writing the figures straight into the DOM (no React render per frame): the
 * tenth changes on the frame it is due. Tabular figures in fixed cells, so the
 * digits never shuffle. A timer at 0 reads TIME! in hot and sounds the buzzer
 * once per run (when the operator armed the projector's sounds).
 *
 * @param {{
 *   clock: NonNullable<ReturnType<typeof import('../../../../shared/scoreboard.js').cleanClock>>,
 *   serverNow: () => number,
 *   accent: string,
 *   size: string,
 * }} props
 */
export const ScoreClock = ({ clock, serverNow, accent, size }) => {
  const mainRef = useRef(/** @type {HTMLSpanElement|null} */ (null));
  const tenthRef = useRef(/** @type {HTMLSpanElement|null} */ (null));
  const barRef = useRef(/** @type {HTMLSpanElement|null} */ (null));
  const rootRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const buzzed = useRef(/** @type {number|null} */ (null));

  useEffect(() => {
    let raf = 0;
    let lastMain = '';
    let lastTenth = '';
    let lastState = '';
    const draw = () => {
      const r = clockReading(clock, serverNow());
      if (r) {
        const face = clockFace(r.ms, r.kind);
        const [mins, secs] = splitMain(face.main);
        const html = `${mins}<span class="pj-score-clock__colon" style="color:${accent}">:</span>${secs}`;
        if (html !== lastMain && mainRef.current) { mainRef.current.innerHTML = html; lastMain = html; }
        if (face.tenth !== lastTenth && tenthRef.current) { tenthRef.current.textContent = `.${face.tenth}`; lastTenth = face.tenth; }
        if (barRef.current && r.durationMs) barRef.current.style.transform = `scaleX(${(r.ms / r.durationMs).toFixed(4)})`;
        const state = r.done ? 'done' : r.running ? 'running' : 'paused';
        if (state !== lastState && rootRef.current) { rootRef.current.dataset.state = state; lastState = state; }
        if (r.done && buzzed.current !== clock.id) {
          buzzed.current = clock.id;
          buzz();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    // A screen that opens on an already finished timer does not buzz.
    const first = clockReading(clock, serverNow());
    if (first?.done && buzzed.current === null) buzzed.current = clock.id;
    draw();
    return () => cancelAnimationFrame(raf);
  }, [clock, serverNow, accent]);

  const label = clock.kind === 'timer' ? 'Timer' : 'Stopwatch';
  return (
    <div ref={rootRef} className="pj-score-clock" data-kind={clock.kind} data-state="running" style={{ '--pj-clock-size': size }}>
      <span className="pj-score-clock__kick">
        <span className="pj-score-clock__word">{label}</span>
        <span className="pj-score-clock__paused" aria-hidden="true">Paused</span>
        <span className="pj-score-clock__done" aria-hidden="true">Time!</span>
      </span>
      <div className="pj-score-clock__figures" role="timer" aria-label={label}>
        <span ref={mainRef} className="pj-score-clock__main" />
        <span ref={tenthRef} className="pj-score-clock__tenth" style={{ color: accent }} />
      </div>
      {clock.kind === 'timer' && (
        <span className="pj-score-clock__bar" aria-hidden="true">
          <span ref={barRef} className="pj-score-clock__fill" />
        </span>
      )}
    </div>
  );
};

/** '1:23' -> ['1', '23']; '1:02:03' -> ['1:02', '03'] (the last colon takes the accent). */
function splitMain(main) {
  const i = main.lastIndexOf(':');
  return [main.slice(0, i), main.slice(i + 1)];
}

/** The game-show buzzer: two low square blasts. */
export function buzz() {
  playTones([
    { freq: 196, at: 0, len: 0.42, type: 'square' },
    { freq: 147, at: 0, len: 0.42, type: 'square' },
    { freq: 196, at: 0.5, len: 0.6, type: 'square' },
    { freq: 147, at: 0.5, len: 0.6, type: 'square' },
  ], 0.09);
}

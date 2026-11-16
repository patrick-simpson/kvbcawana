import React, { useEffect, useRef } from 'react';
import { clockFace, clockReading } from '../../../../shared/scoreboard.js';
import { playTones } from '../lib/stingers.js';
import { tick } from '../lib/scoreSounds.js';

/** A running timer's last stretch (owner 2026-11-15: "as epic as possible"): red figures, a pulse each second, rings, a tick. */
export const URGENT_MS = 10000;

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
 * The last URGENT_MS of a running timer build to it: the figures turn the kit's hot red
 * and thump once a second (`data-urgent`, its `data-beat` flipping each second so the CSS
 * pulse restarts), two rings pulse out behind them, the bar glows, and a tick sounds each
 * second, higher and harder for the last three (`data-final`). `still` (low power) keeps
 * the colour and the ticks, no thump or rings.
 *
 * @param {{
 *   clock: NonNullable<ReturnType<typeof import('../../../../shared/scoreboard.js').cleanClock>>,
 *   serverNow: () => number,
 *   accent: string,
 *   size: string,
 *   sounds?: boolean,
 * }} props
 */
export const ScoreClock = ({ clock, serverNow, accent, size, sounds = false, onDone, still = false }) => {
  const mainRef = useRef(/** @type {HTMLSpanElement|null} */ (null));
  const tenthRef = useRef(/** @type {HTMLSpanElement|null} */ (null));
  const barRef = useRef(/** @type {HTMLSpanElement|null} */ (null));
  const rootRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const buzzed = useRef(/** @type {number|null} */ (null));
  const soundsRef = useRef(sounds);
  useEffect(() => { soundsRef.current = sounds; }, [sounds]);
  // The wall's TIME! moment (ScoringView), called once per timer, with the buzzer.
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    let raf = 0;
    let lastMain = '';
    let lastTenth = '';
    let lastState = '';
    let lastSecond = -1;
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
        // The last ten seconds of a running timer: red, a thump and a tick each second.
        const urgent = clock.kind === 'timer' && r.running && !r.done && r.ms <= URGENT_MS;
        const second = urgent ? Math.ceil(r.ms / 1000) : -1;
        if (second !== lastSecond && rootRef.current) {
          const el = rootRef.current;
          if (urgent) {
            el.dataset.urgent = '1';
            el.dataset.beat = String(second % 2);
            if (second <= 3) el.dataset.final = '1'; else delete el.dataset.final;
            if (lastSecond !== -1 || r.ms % 1000 > 900) tick(second, soundsRef.current);
          } else {
            delete el.dataset.urgent; delete el.dataset.beat; delete el.dataset.final;
          }
          lastSecond = second;
        }
        if (r.done && buzzed.current !== clock.id) {
          buzzed.current = clock.id;
          buzz(soundsRef.current);
          if (clock.kind === 'timer') doneRef.current?.();
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
    <div ref={rootRef} className="pj-score-clock" data-kind={clock.kind} data-state="running" data-still={still ? '1' : undefined} style={{ '--pj-clock-size': size }}>
      {clock.kind === 'timer' && !still && (
        <span className="pj-score-clock__rings" aria-hidden="true"><span /><span /></span>
      )}
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

/** The game-show buzzer: two low square blasts and a long horn (a gym is loud), with a noise rasp. */
export function buzz(force = false) {
  playTones([
    { freq: 196, at: 0, len: 0.42, type: 'square' },
    { freq: 147, at: 0, len: 0.42, type: 'square' },
    { freq: 196, at: 0.5, len: 0.42, type: 'square' },
    { freq: 147, at: 0.5, len: 0.42, type: 'square' },
    { freq: 196, at: 1.0, len: 1.3, type: 'square' },
    { freq: 147, at: 1.0, len: 1.3, type: 'square' },
    { freq: 98, at: 1.0, len: 1.3, type: 'sawtooth' },
    { freq: 300, at: 0, len: 2.3, type: 'noise', q: 1.5, vol: 0.5 },
  ], 0.16, { force });
}

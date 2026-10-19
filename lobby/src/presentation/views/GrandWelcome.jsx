import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { parseChurchLogo } from '../../../../shared/churchLogo.js';
import fullSvg from '../../../../shared/brand/logos/kvbc-awana-full.svg?raw';
import puggles from '../../../../shared/brand/logos/puggles-white.svg?url';
import cubbies from '../../../../shared/brand/logos/cubbies-white.svg?url';
import sparks from '../../../../shared/brand/logos/sparks-white.svg?url';
import tnt from '../../../../shared/brand/logos/tnt-white.svg?url';
import trek from '../../../../shared/brand/logos/trek-white.svg?url';
import journey from '../../../../shared/brand/logos/journey-white.svg?url';
import { lineLanding } from '../components/ChurchMark.jsx';
import { ConfettiBurst } from '../components/ConfettiBurst.jsx';
import { Kicker } from '../components/Kicker.jsx';
import { useLowPower } from '../hooks/useLowPower.js';
import { CLUB_ORDER, KIT_CLUBS } from '../lib/kit.js';
import { EASE } from '../lib/motion-tokens.js';

/**
 * The grand welcome (owner 2026-10-19: "an epic welcome to Awana opening
 * animation", on the projector at 6:00 sharp, 15 s, silent). The opening
 * deck's first slide (config.js, id `welcome`, 15 s), so it plays the moment
 * the schedule turns to the ceremony, and again whenever a leader steps back
 * to it. Beat sheet, seconds from the slide landing:
 *
 *   (every beat below starts LEAD + the slide's hold after it mounts)
 *   0.00  six club bands race across the black wall, youngest first, and are
 *         gone off the far side by 2.2 (the letters drop in behind them)
 *   1.10  WELCOME drops in letter by letter (0.08 apart), each squashing onto
 *         its foot, white with a hard offset in a club colour
 *   2.15  TO pops in under it, and the night ("Wednesday night") over it
 *   2.55  the church's full logo builds line by line (the logo sheet's own
 *         arrival: church line, Awana Clubs, tagline)
 *   4.20  the six club marks pop in a row under it, 0.2 apart
 *   5.70  club-colour confetti bursts from the middle
 *   ~6.5  everything at rest; it holds still to the end
 *
 * Every piece's last keyframe is its resting place (the bands' rest is off
 * the wall), so the low-power switch, reduced motion and ?vr=1 (which also
 * skips the bands and the confetti) show the finished frame. The corner logo
 * steps aside while it is up (SlideshowView reports it bare): never two
 * church logos at once. One colour, white, never an outline or a shadow on
 * the logo; club marks whole, never recoloured.
 */

export const GRAND_WELCOME_SEC = 15;
export const BEATS = Object.freeze({ bands: 0, letters: 1.1, letterGap: 0.08, to: 2.15, logo: 2.55, marks: 4.2, markGap: 0.2, confetti: 5.7 });
/** Every beat waits this long past the slide's own hold: the view under it (the countdown at 6:00) is still crossfading away. */
export const LEAD = 0.7;

const LOGO = parseChurchLogo(fullSvg);
const MARKS = { puggles, cubbies, sparks, tnt, trek, journey };
const WORD = 'WELCOME';
const color = (i) => KIT_CLUBS[CLUB_ORDER[i % CLUB_ORDER.length]].primary;

/** One piece holding hidden until `at`, then landing; last keyframe = rest. */
const land = (at, dur, from, ease = EASE.settle) => {
  const total = at + dur;
  const keys = Object.keys(from);
  const rest = { opacity: 1, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1 };
  /** @type {Record<string, any>} */
  const animate = {};
  for (const k of keys) animate[k] = [from[k], from[k], rest[k]];
  return { initial: from, animate, transition: { duration: total, times: [0, at / total, 1], ease: ['linear', ease] } };
};

/** A letter: drops from above, squashes onto its foot, springs back to rest. */
const letterDrop = (at) => {
  const dur = 0.62;
  const total = at + dur;
  const t = (s) => (at + s) / total;
  return {
    initial: { opacity: 0, y: '-70%', scaleX: 1, scaleY: 1 },
    animate: {
      opacity: [0, 0, 1, 1, 1, 1],
      y: ['-70%', '-70%', '0%', '0%', '0%', '0%'],
      scaleX: [1, 1, 1, 1.12, 0.97, 1],
      scaleY: [1, 1, 1.08, 0.82, 1.03, 1],
    },
    transition: { duration: total, times: [0, t(0), t(0.24), t(0.34), t(0.48), 1], ease: 'easeOut' },
  };
};

/** A mark: pops from small on a short overshoot. */
const markPop = (at) => {
  const dur = 0.5;
  const total = at + dur;
  const t = (s) => (at + s) / total;
  return {
    initial: { opacity: 0, scale: 0.3 },
    animate: { opacity: [0, 0, 1, 1, 1], scale: [0.3, 0.3, 1.16, 0.96, 1] },
    transition: { duration: total, times: [0, t(0), t(0.26), t(0.38), 1], ease: 'easeOut' },
  };
};

/** One band: the full height of the wall, racing left to right and off. */
const bandRun = (i, lead) => ({
  initial: { x: '-130%' },
  animate: { x: ['-130%', '620%'] },
  transition: { duration: 1.6, delay: lead + BEATS.bands + i * 0.12, ease: [0.65, 0, 0.35, 1] },
});

/** @param {{ now?: Date, hold?: number }} props */
export const GrandWelcome = ({ now, hold = 0 }) => {
  const lead = LEAD + hold;
  const still = useLowPower();
  const [confetti, setConfetti] = useState(false);
  useEffect(() => {
    if (still) return undefined;
    const t = setTimeout(() => setConfetti(true), (lead + BEATS.confetti) * 1000);
    return () => clearTimeout(t);
  }, [still, lead]);
  const m = (props) => (still ? {} : props);
  const night = `${(now ?? new Date()).toLocaleDateString([], { weekday: 'long' })} night`;

  return (
    <div className="pj-grand" role="img" aria-label="Welcome to Awana" data-grand-welcome={still ? 'still' : 'moving'}>
      {!still && (
        <div className="pj-grand__bands" aria-hidden="true">
          {CLUB_ORDER.map((id, i) => (
            <motion.span key={id} className="pj-grand__band" style={{ background: KIT_CLUBS[id].primary, skewX: -14 }} {...bandRun(i, lead)} />
          ))}
        </div>
      )}
      <div className="pj-frame">
        <motion.div className="pj-grand__kicker" {...m(land(lead + BEATS.to, 0.4, { opacity: 0, y: '40%' }))}>
          <Kicker size="calc(2.4 * var(--u))">{night}</Kicker>
        </motion.div>
        <p className="pj-grand__word" aria-hidden="true">
          {[...WORD].map((ch, i) => (
            <motion.span
              key={i}
              className="pj-grand__letter"
              style={{ originY: 1 }}
              {...m(letterDrop(lead + BEATS.letters + i * BEATS.letterGap))}
            >
              <span style={{ textShadow: `0.07em 0.07em 0 ${color(i)}` }}>{ch}</span>
            </motion.span>
          ))}
        </p>
        <motion.p className="pj-grand__to" aria-hidden="true" {...m(land(lead + BEATS.to, 0.42, { opacity: 0, scale: 0.4 }))}>to</motion.p>
        <svg className="pj-grand__logo" viewBox={LOGO.viewBox} aria-hidden="true" focusable="false">
          <g fill="#FFFFFF" fillRule="evenodd">
            {LOGO.parts.map((p) => (still
              ? <path key={p.part} d={p.d} />
              : <motion.path key={p.part} d={p.d} style={{ originX: 0.5, originY: 1 }} {...lineLanding(p.part, lead + BEATS.logo)} />))}
          </g>
        </svg>
        <div className="pj-grand__marks" aria-hidden="true">
          {CLUB_ORDER.map((id, i) => (
            <motion.img key={id} src={MARKS[id]} alt="" className="pj-grand__mark" {...m(markPop(lead + BEATS.marks + i * BEATS.markGap))} />
          ))}
        </div>
      </div>
      {confetti && <ConfettiBurst />}
    </div>
  );
};

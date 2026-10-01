import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ScreenFrame } from '../components/ScreenFrame.jsx';
import { WeatherScene } from '../components/WeatherScene.jsx';
import { ParticleField } from '../components/ParticleField.jsx';
import { SparkleDoodles } from '../components/SparkleDoodles.jsx';
import { BigTimer } from '../components/BigTimer.jsx';
import { EventChips } from '../components/EventChips.jsx';
import { Kicker } from '../components/Kicker.jsx';
import { StepChip } from '../components/StepChip.jsx';
import { HOUSE } from '../lib/kit.js';
import { fitChipU } from '../lib/chip.js';
import { useFontsReady } from '../hooks/useFontsReady.js';
import { secondsUntil } from '../lib/schedule.js';
import { playStinger } from '../lib/stingers.js';
import { useKeydown } from '../hooks/useKeydown.js';
import { useWeather } from '../hooks/useWeather.js';
import { useCalendarEvents } from '../hooks/useCalendarEvents.js';
import { usePortrait, useTouch } from '../lib/touch.js';
import { DUR, EASE } from '../lib/motion-tokens.js';

// The five remaining-time marks that sound the optional chime. There is
// deliberately NO on-screen badge any more — the operator asked for the
// popup that read "5 MINUTES!" to be gone from the projector (2026-09).
// The chime is a SEPARATE opt-in feature (off by default, armed from
// QuickNav, which advertises it as "Chimes at 1hr/30/10/5/1min"), so
// these times and the 1-vs-0.5 intensity split must stay exactly as they
// were: removing the visual must not change whether or when audio fires.
const STINGER_TIMES = [3600, 1800, 600, 300, 60];

/**
 * The week-long countdown to Wednesday 6:00 PM, flattened to type on the
 * bare black wall (the approved mockup): a Londrina kicker, Paytone One figures
 * with Awana-orange colons, and under them only what the week needs (the
 * next meeting's day while it is still a day or more out, the church's
 * theme for it as a stepped chip, special nights as plain lines). The
 * Awana Clubs mark rides above every view (App.jsx). Time flows in via the
 * single app clock — this view owns no timers of its own.
 * `onSkip` is the operator skip (Space / click) — jumps to the opening
 * ceremony. `theme` is the church-authored meeting theme from a fresh
 * `schedule` broadcast (hooks/useRealtime.js, lib/scheduleAdvisory.js
 * `advisoryTitle`) — purely informational, shown only while present.
 */
export const CountdownView = ({ now, target, theme, onSkip }) => {
  const seconds = secondsUntil(target, now);
  const weather = useWeather();
  const events = useCalendarEvents();

  const soundedStingers = useRef(new Set());

  useEffect(() => {
    if (STINGER_TIMES.includes(seconds) && !soundedStingers.current.has(seconds)) {
      soundedStingers.current.add(seconds);
      // Optional synthesized chime (QuickNav toggle, off by default);
      // the final minute gets the big three-note version.
      playStinger(seconds <= 60 ? 1 : 0.5);
    }
  }, [seconds]);

  useKeydown((e) => {
    if (['Space', 'ArrowRight', 'PageDown'].includes(e.code)) {
      e.preventDefault();
      onSkip();
    }
  });

  // On a phone or tablet the clock is the biggest thing under a finger, and a
  // skip is a fifteen-minute override of the evening: the first tap only asks
  // (a toast, like the slideshow's Exit), a second within 3 s skips. On the
  // PC one click on it skips, as it always has.
  const touch = useTouch();
  const [skipArmed, setSkipArmed] = useState(false);
  useEffect(() => {
    if (!skipArmed) return undefined;
    const timer = setTimeout(() => setSkipArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [skipArmed]);
  const tapSkip = () => {
    if (skipArmed) onSkip();
    else setSkipArmed(true);
  };

  const isShaking = seconds > 0 && seconds <= 10;

  const targetTimeStr = target.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <ScreenFrame
      shake={isShaking}
      layers={
        <>
          <WeatherScene weather={weather} />
          <ParticleField />
          <SparkleDoodles seed={3} count={14} />
        </>
      }
    >
      <div className="pj-frame pj-countdown">
        <Kicker color="#FFFFFF" size="var(--pj-countdown-kicker, calc(3.2 * var(--u)))" style={{ letterSpacing: '0.12em', marginRight: '-0.12em' }}>
          Awana begins in
        </Kicker>

        <div style={{ marginTop: 'var(--pj-countdown-gap, calc(0.6 * var(--u)))' }}>
          <BigTimer seconds={seconds} accent={HOUSE.orange} urgencyEnabled onClick={touch ? tapSkip : onSkip} touch={touch} />
        </div>

        {seconds >= 24 * 3600 && (
          <p className="pj-body" style={{ fontSize: 'var(--pj-countdown-next, calc(2.4 * var(--u)))', color: 'rgb(255 255 255 / 0.72)', fontWeight: 500 }}>
            Next meeting · Wednesday · {targetTimeStr}
          </p>
        )}

        {theme && (
          <div style={{ marginTop: 'calc(1.6 * var(--u))' }}>
            <ThemeChip theme={theme} />
          </div>
        )}

        <EventChips events={events} />
      </div>

      {/* Touch: the skip's question. data-pj-bottom-overlay: it stands on the
          bottom band, so the first-run setup note gives way while it is up. */}
      <AnimatePresence>
        {touch && skipArmed && (
          <motion.div
            className="absolute left-1/2 z-50"
            data-pj-bottom-overlay
            data-skip-toast
            style={{ bottom: 'var(--pj-toast-bottom, calc(3 * var(--u)))', x: '-50%' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, transition: { duration: DUR.pop, ease: EASE.pop } }}
            exit={{ opacity: 0, y: 12, transition: { duration: DUR.exit, ease: EASE.exit } }}
          >
            <StepChip label="Start the opening" value="Tap the clock again" size="var(--pj-toast-size, calc(2.2 * var(--u)))" plate={HOUSE.hot} />
          </motion.div>
        )}
      </AnimatePresence>
    </ScreenFrame>
  );
};

/**
 * The THIS WEEK chip's fit: its mockup size, shrinking only as far as a long
 * theme needs to stay inside `widthU` of the wall. The theme is the church's
 * own calendar title, up to 60 characters on the wire (TITLE_MAX in
 * src/lib/eventSanitizers.js), and a chip's plate grows with its value.
 */
export const THEME_CHIP = { label: 'This week', maxU: 2.6, widthU: 90 };
/** Upright on a phone or tablet (lib/touch.js): the same width, a bigger chip. */
export const THEME_CHIP_PORTRAIT = { ...THEME_CHIP, maxU: 4.6 };

const ThemeChip = ({ theme }) => {
  // The fit measures the theme: measure again once the faces land.
  useFontsReady();
  const fit = usePortrait() ? THEME_CHIP_PORTRAIT : THEME_CHIP;
  const sizeU = Math.floor(fitChipU(fit.label, theme, fit) * 1000) / 1000;
  return (
    <StepChip label={fit.label} value={theme} size={`calc(${sizeU} * var(--u))`} plate={HOUSE.blueDeep} />
  );
};

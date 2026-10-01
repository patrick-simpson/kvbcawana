import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CHURCH } from '../church.config.js';
import { secondsUntil } from '../lib/schedule.js';
import { HOUSE } from '../lib/kit.js';
import { DUR, EASE } from '../lib/motion-tokens.js';
import { StepChip } from './StepChip.jsx';

/**
 * Watchdog warning (bottom-center, like the ESC toast): appears in the final
 * `warningSec` seconds of a QuickNav override, counting down to auto-resume
 * with a "Stay" escape hatch. In the kit: a stepped chip ("BACK TO SCHEDULE
 * IN / 42s", sized once for its widest count so it never twitches as it
 * ticks) beside the one hot button, popping in and leaving faster.
 */
export const ResumePill = ({ now, resumeAt, onStay }) => {
  const seconds = resumeAt ? secondsUntil(resumeAt, now) : null;
  const visible = seconds !== null && seconds <= CHURCH.watchdog.warningSec;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="absolute left-1/2 z-50 flex items-center"
          data-resume-pill
          // Stands on the bottom band: the first-run setup note gives way
          // while it is up (index.css).
          data-pj-bottom-overlay
          style={{ bottom: 'var(--pj-resume-bottom, calc(2.4 * var(--u)))', gap: 'calc(1.2 * var(--u))', x: '-50%' }}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0, transition: { duration: DUR.pop, ease: EASE.pop } }}
          exit={{ opacity: 0, y: 16, transition: { duration: DUR.exit, ease: EASE.exit } }}
        >
          <StepChip
            label="Back to schedule in"
            value={`${seconds}s`}
            fitValue={`${String(CHURCH.watchdog.warningSec).replace(/[0-9]/g, '0')}s`}
            size="var(--pj-resume-size, calc(2 * var(--u)))"
            plate={HOUSE.blueDeep}
          />
          {/* On a phone or tablet, index.css's touch block makes Stay a
              finger's size (the custom properties fall back to the PC's). */}
          <button
            onClick={onStay}
            className="pj-hot-button"
            style={{ fontSize: 'var(--pj-stay-size, calc(1.5 * var(--u)))', padding: '0.6em 1.4em' }}
          >
            Stay
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

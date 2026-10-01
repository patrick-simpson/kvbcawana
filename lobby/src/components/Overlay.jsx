import { AnimatePresence } from 'framer-motion';
import CheckInMoment from './CheckInMoment.jsx';

/**
 * Transparent layer over the background that hosts the check-in moment.
 *
 * Keyed on the queue's `run`, not the child: one continuous stretch of
 * arrivals is one mounted moment, so during a rush the wave stays up and
 * each next child flips in (see useCheckInQueue). `mode="wait"` lets a
 * finished run drop fully away before the next one rises.
 *
 * `birthdayRibbon` is the "Birthday this Friday!" label from
 * src/lib/birthdayWeek.js, or null; src/lib/checkInMoment.js decides where
 * it shows (it replaces the birthday tagline, and rides a plain welcome).
 */
export default function Overlay({ currentEvent, run = 0, step = 0, audioEnabled, clubPhrases, birthdayRibbon }) {
  return (
    <div className="overlay">
      <AnimatePresence mode="wait">
        {currentEvent && (
          <CheckInMoment
            key={run}
            event={currentEvent}
            step={step}
            audioEnabled={audioEnabled}
            clubPhrases={clubPhrases}
            ribbon={birthdayRibbon}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

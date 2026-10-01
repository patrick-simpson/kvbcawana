import React from 'react';
import { motion } from 'framer-motion';
import { HOUSE } from '../lib/kit.js';
import { DUR, EASE } from '../lib/motion-tokens.js';
import { holdThen } from '../lib/landing.js';

function formatDays(days) {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days <= 7) return `in ${days} days`;
  const weeks = Math.round(days / 7);
  return `in ${weeks} week${weeks > 1 ? 's' : ''}`;
}

/**
 * Upcoming theme nights as plain lines in the label voice — no pill, glow,
 * or emoji, matching the countdown's flattened-to-type treatment: the
 * night's name in white, when it is in Awana orange.
 */
export const EventChips = ({ events }) => {
  const special = events.filter((e) => e.isSpecial).slice(0, 4);
  if (special.length === 0) return null;

  return (
    // data-live: content depends on the real calendar/wall clock, so
    // visual-regression tests mask this region (e2e/countdown.visual.spec.js).
    <div className="flex flex-col items-center" style={{ marginTop: 'var(--pj-event-top, calc(2.4 * var(--u)))', gap: 'var(--pj-event-gap, calc(0.9 * var(--u)))' }} data-live>
      {special.map((event, idx) => (
        <motion.p
          key={`${event.title}-${event.daysUntil}`}
          className="pj-kicker text-center whitespace-nowrap"
          style={{ fontSize: 'var(--pj-event-size, calc(2.2 * var(--u)))', letterSpacing: '0.08em', marginRight: '-0.08em', color: '#FFFFFF' }}
          initial={{ opacity: 0, y: 12 }}
          animate={holdThen(0.2 + idx * 0.1, DUR.settle, { opacity: 0, y: 12 }, { opacity: 1, y: 0 }, EASE.settle)}
        >
          {event.title}
          <span style={{ color: HOUSE.orange }}> · {formatDays(event.daysUntil)}</span>
        </motion.p>
      ))}
    </div>
  );
};

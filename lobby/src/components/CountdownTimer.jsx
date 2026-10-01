import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { M } from '../lib/motion.jsx';
import { localDateStr } from '../lib/calendarLogic.js';

/**
 * Semi-transparent corner timer counting down to the configured HH:MM.
 * If that time has already passed today, it targets the same time tomorrow.
 * When the calendar is loaded, `clubDates` (the non-cancelled club-night
 * date keys) gates the timer to nights club actually meets — otherwise a
 * display left running over summer break claims club starts tomorrow.
 * When it reaches zero it elegantly fades out and stays hidden until
 * the target rolls over to a future time.
 */
export default function CountdownTimer({ targetTime, clubDates = null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const result = resolveTarget(targetTime, now, clubDates);
  const remaining = result ? result.ms - now : 0;
  const visible = result !== null && remaining > 0;

  return (
    <AnimatePresence>
      {visible && (
        <M.div
          key="countdown"
          className="countdown"
          // Sticker tilt rides framer-motion's transform (a CSS rotate
          // would be clobbered the moment y animates).
          style={{ rotate: -0.8 }}
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.6 } }}
          exit={{ opacity: 0, y: 20, transition: { duration: 0.8 } }}
        >
          <span className="label">Club starts in</span>
          <span className="time">{formatRemaining(remaining)}</span>
          {result.isTomorrow && <span className="tomorrow-label">Tomorrow</span>}
        </M.div>
      )}
    </AnimatePresence>
  );
}

export function resolveTarget(hhmm, now, clubDates = null) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const min = Number(match[2]);
  if (hour < 0 || hour > 23 || min < 0 || min > 59) return null;

  const d = new Date(now);
  d.setHours(hour, min, 0, 0);
  const isTomorrow = d.getTime() <= now;
  // If we're already past today's target, count down to tomorrow's.
  if (isTomorrow) d.setDate(d.getDate() + 1);
  // With a loaded calendar, only count down to real club nights.
  if (Array.isArray(clubDates) && !clubDates.includes(localDateStr(d))) return null;
  return { ms: d.getTime(), isTomorrow };
}

export function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

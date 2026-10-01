import React from 'react';
import { DigitReel } from './DigitReel.jsx';
import { HOUSE, URGENT_COLOR } from '../lib/kit.js';

export { URGENT_COLOR };

/**
 * The huge projector timer, flattened to type: Paytone One's tabular
 * figures in fixed cells (see DigitReel), the colons in an accent colour (Awana orange on the
 * countdown, the club's colour on game time), the colon pulse, the final
 * minute's urgency (the kit's hot red-orange and two pulse rings), and the
 * click-to-skip affordance. Owns the d/h/m/s decomposition.
 *
 * `size` is the figures' font size (a CSS length); `daysSize` is used when
 * the count is still a day or more out, which reads "6d 23h 30m".
 *
 * `touch` (a phone or tablet, lib/touch.js) drops the mouse's affordances, the
 * "Click to skip" tooltip and the hint that appears on hover: a finger can
 * read neither, and the caller asks its own question instead (CountdownView).
 */
export const BigTimer = ({
  seconds,
  color = '#FFFFFF',
  accent = HOUSE.orange,
  urgencyEnabled = false,
  warnColor,
  size = 'var(--text-timer)',
  daysSize = 'var(--text-timer-days)',
  onClick,
  touch = false,
}) => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const isUrgent = urgencyEnabled && seconds > 0 && seconds < 60;
  // `warnColor` is the caller's own urgency treatment (the game screen's
  // wrap-up warning): it recolours the figures and the colons and nothing
  // else; the pulse rings stay tied to `urgencyEnabled`.
  const override = isUrgent ? URGENT_COLOR : warnColor;
  const figure = override ?? color;
  const mark = override ?? accent;

  const unit = (label) => (
    <span className="pj-timer__unit" style={{ color: mark }}>
      {label}
    </span>
  );

  const colon = (
    <span className="pj-timer__colon" style={{ color: mark }}>:</span>
  );

  const reels = (text, prefix) =>
    text.split('').map((d, i) => <DigitReel key={`${prefix}${i}`} value={d} />);

  return (
    <div
      className="cursor-pointer group/timer relative flex items-center justify-center select-none"
      onClick={onClick}
      title={onClick && !touch ? 'Click to skip' : undefined}
      data-timer
    >
      {isUrgent && (
        <>
          <div
            className="absolute inset-[-8%] rounded-full animate-pulse-ring border-2"
            style={{ borderColor: URGENT_COLOR }}
          />
          <div
            className="absolute inset-[-8%] rounded-full animate-pulse-ring border-2"
            style={{ borderColor: URGENT_COLOR, animationDelay: '0.7s' }}
          />
        </>
      )}

      {days > 0 ? (
        <div className="pj-timer flex items-baseline" style={{ fontSize: daysSize, color: figure }}>
          {reels(String(days), 'd')}
          {unit('d')}
          {reels(String(hours).padStart(2, '0'), 'h')}
          {unit('h')}
          {reels(String(minutes).padStart(2, '0'), 'm')}
          {unit('m')}
        </div>
      ) : (
        <div className="pj-timer flex items-center" style={{ fontSize: size, color: figure }}>
          {hours > 0 && (
            <>
              {reels(String(hours), 'h')}
              {colon}
            </>
          )}
          {reels(String(minutes).padStart(hours > 0 ? 2 : 1, '0'), 'm')}
          {colon}
          {reels(String(secs).padStart(2, '0'), 's')}
        </div>
      )}

      {onClick && !touch && (
        <span
          className="pj-kicker absolute -bottom-8 right-0 text-white/0 group-hover/timer:text-white/40 transition-colors"
          style={{ fontSize: 'clamp(0.8rem, 1vw, 1.2rem)' }}
        >
          Click to skip →
        </span>
      )}
    </div>
  );
};

import { M } from '../lib/motion.jsx';
import { DUR, EASE, DOODLES } from '../lib/brand.js';
import { squishLand, withSquish } from '../lib/squish.js';
import StepPlate from './brand/StepPlate.jsx';

/**
 * A kit chip for content that is more than one value: the catalog's stepped
 * chip (the corner chips' shape, see StepPlate) with a Londrina label on its
 * pill tier and the content on the block beneath. The status sticker (the
 * "SIGNAL" chip in App's corner stack) is the one on the lobby.
 *
 * The root is an M.div so the pop-in rides framer-motion (a pop on the
 * kit's curve, a beat after it mounts), and `tilt` rides framer-motion's
 * rotate rather than a CSS transform the two would fight over. `...rest`
 * forwards role / aria-* straight to the root, so consumers keep their
 * accessibility contracts; `rootRef` reaches the root (App measures the
 * status sticker's height with it). `sparkle` perches one kit sparkle on the plate's
 * shoulder, winking now and then; its loop ends at full size, which is
 * where ?lowPower=1 freezes it.
 *
 * The pop squashes lightly at its peak (the soft squish, src/lib/squish.js):
 * it is a problem indicator, so a plate's squish, not a sticker's. Scale only:
 * the plate's outline and App's height check read offset boxes and a
 * ResizeObserver, which a transform never moves.
 */
const pop = {
  hidden: { opacity: 0, scale: 0.6 },
  show: withSquish(
    { opacity: 1, scale: 1, transition: { duration: DUR.pop, ease: EASE.pop } },
    squishLand(0, 'plate', DUR.pop, 'pop'),
  ),
};

const SPARK = DOODLES.sparkle;

export default function StickerChip({
  label,
  tilt = 0,
  sparkle = false,
  sparkleDelay = 0,
  plate,
  className = '',
  rootRef,
  children,
  ...rest
}) {
  return (
    <M.div
      ref={rootRef}
      className={`sticker-chip ${className}`.trim()}
      style={{ rotate: tilt }}
      variants={pop}
      initial="hidden"
      animate="show"
      {...rest}
    >
      <StepPlate
        label={label || null}
        plate={plate}
        labelClassName="sticker-chip-label"
        labelProps={{ 'aria-hidden': true }}
        bodyClassName="sticker-chip-body"
      >
        {children}
      </StepPlate>
      {sparkle && (
        <M.span
          className="sticker-chip-spark"
          aria-hidden
          animate={{ scale: [1, 1, 0.55, 1], rotate: [0, 0, 24, 0] }}
          transition={{
            duration: 8,
            delay: sparkleDelay,
            times: [0, 0.82, 0.91, 1],
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        >
          <svg viewBox={SPARK.viewBox} focusable="false"><path d={SPARK.d} fill="currentColor" /></svg>
        </M.span>
      )}
    </M.div>
  );
}

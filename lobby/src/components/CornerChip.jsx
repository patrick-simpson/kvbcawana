import { AnimatePresence } from 'framer-motion';
import { M } from '../lib/motion.jsx';
import { DUR, EASE } from '../lib/brand.js';
import { holdThenLand } from '../lib/lobbyMotion.js';
import { squishLand, withSquish } from '../lib/squish.js';
import StepChip from './brand/StepChip.jsx';
import WeatherGlyph from './WeatherGlyph.jsx';

/**
 * The corner's one item as a catalog stepped chip ("RIGHT NOW / 7:56",
 * "TONIGHT / 23", "CLOUDY / 58°"), for one corner. App renders one of these
 * per corner and hands both the same `item`; each shows it only when the
 * item belongs to its corner, so exactly one chip is ever up.
 *
 * Keyed on the load count, so every slide load lands the chip afresh (a pop
 * on the brand's curve, a beat after the slide), and the previous one lifts
 * away. Hidden (a slide that holds check-ins) it simply leaves. A note (the
 * tally's "synced with the check-in desk") is part of the frozen snapshot, so
 * it stays with the number it explains; `showNote` is the Settings opt-out for
 * that correction note only, applied at render so turning it off hides one
 * already up. The pickup count's "not checked out yet" always shows: it is
 * what the number means. The weather
 * carries its sky doodle (WeatherGlyph) at the head of its value block.
 *
 * @param {{
 *   item: import('../lib/cornerInfo.js').CornerSnapshot | null,
 *   corner: 'top' | 'bottom',
 *   loads: number,
 *   hidden?: boolean,
 *   showNote?: boolean,
 *   size?: string,
 * }} props
 */
/**
 * A beat after the slide loads, the chip pops on the kit's curve and squashes
 * at the pop's peak (the soft squish, src/lib/squish.js). One keyframe list,
 * never `initial` plus a delay, and the same for every load, so nothing ever
 * needs freezing: each load is a fresh key.
 */
const ENTER = withSquish(
  holdThenLand(0.3, DUR.pop, { opacity: 0, scale: 0.6, rotate: -6 }, { opacity: 1, scale: 1, rotate: 0 }, EASE.pop),
  squishLand(0.3, 'chip', DUR.pop, 'pop'),
);

export default function CornerChip({ item, corner, loads, hidden = false, showNote = true, size }) {
  const show = !hidden && item && item.corner === corner;
  return (
    <AnimatePresence>
      {show && (
        <M.div
          key={`${item.id}-${loads}`}
          className={`corner-chip corner-chip--${corner} corner-chip--${item.id}`}
          role="status"
          aria-label={item.spoken}
          initial={ENTER.initial}
          animate={ENTER.animate}
          exit={{ opacity: 0, scale: 0.9, transition: { duration: DUR.exit, ease: EASE.exit } }}
          transition={ENTER.transition}
        >
          <StepChip
            label={item.label.toUpperCase()}
            value={item.value}
            size={size}
            icon={item.glyph ? <WeatherGlyph kind={item.glyph} /> : null}
          />
          {item.note && (showNote || !item.correction) && <span className="corner-chip__note">{item.note}</span>}
        </M.div>
      )}
    </AnimatePresence>
  );
}

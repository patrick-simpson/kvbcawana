import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { M } from '../lib/motion.jsx';
import { DUR, EASE, beats } from '../lib/brand.js';
import { isFresh } from '../lib/freshness.js';
import { TONIGHT_STALE_MS } from '../lib/constants.js';
import { holdThenLand } from '../lib/lobbyMotion.js';
import { squishBump, squishLand, withSquish } from '../lib/squish.js';

// How often the ticker re-checks its own freshness against the clock.
// Coarse on purpose — this only has to notice a quiet print server within a
// minute or two, not animate a face.
const FRESHNESS_CHECK_MS = 30000;

/**
 * A count that changes pops in place (the corner chips' little pop) and
 * squashes as it lands, up and down only: a figure keeps its width.
 */
const VALUE_POP = withSquish(
  holdThenLand(0, DUR.pop, { scale: 1.3, opacity: 0.6 }, { scale: 1, opacity: 1 }, EASE.pop),
  squishBump('figure'),
);

/**
 * One stat pill: it pops in on its own beat (one per row, in order) and
 * squashes at the pop's peak, sitting down onto the wave (the soft squish,
 * src/lib/squish.js). Fixed when the pill first appears: a row that turns up
 * later shifts the others' places, and as keyframes a new beat would be a new
 * target, so a pill that had already landed would land again.
 */
function Stat({ index, value, label }) {
  const [enter] = useState(() => withSquish(
    holdThenLand(beats(index), DUR.pop, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1 }, EASE.pop),
    squishLand(beats(index), 'chip', DUR.pop, 'pop'),
  ));
  return (
    <M.span
      className="tonight-ticker-stat"
      initial={enter.initial}
      animate={enter.animate}
      transition={enter.transition}
    >
      {/* Remounting on every value change gives each count the
          same little pop the corner chips land with. */}
      <M.span
        key={value}
        className="tonight-ticker-value"
        initial={VALUE_POP.initial}
        animate={VALUE_POP.animate}
        transition={VALUE_POP.transition}
      >
        {value}
      </M.span>
      <span className="tonight-ticker-label">{label}</span>
    </M.span>
  );
}

const ROW_SPECS = [
  { key: 'checkedIn', label: 'checked in' },
  { key: 'booksCompleted', label: 'books finished' },
  { key: 'awardsEarned', label: 'awards earned' },
  { key: 'friendsBrought', label: 'friends brought' },
];

/**
 * Pure + exported for tests: which stat rows are worth showing. A zero
 * count reads as a sad "0 awards earned" rather than as information, so
 * it's left out entirely instead of rendered — early in the night that
 * may mean every row is empty, in which case there's nothing to show yet.
 */
export function tonightRows(tonight) {
  if (!tonight) return [];
  return ROW_SPECS
    .map((spec) => ({ ...spec, value: tonight[spec.key] }))
    .filter((row) => Number.isFinite(row.value) && row.value > 0);
}

/**
 * The rows the strip would draw at `now`: none until a broadcast has arrived,
 * none once the feed has gone stale (TONIGHT_STALE_MS), and only the stats
 * worth showing (tonightRows). Pure, so App can ask the same question the
 * strip does: is anything of tonight's on the lobby right now?
 */
export function tickerRows(tonight, now) {
  return isFresh(tonight?.at, TONIGHT_STALE_MS, now) ? tonightRows(tonight) : [];
}

/**
 * Lobby "tonight" stat strip fed by the printer's `onTonight` broadcast
 * — aggregate counts across every club (checked in, books finished,
 * awards earned, friends brought).
 *
 * Drawn as the kit's count chips (the printer dashboard's club chips: a
 * pill, white Londrina caps, a Paytone One number), sitting on the house waves
 * bottom-centre between the settings gear and the corner chip. These four
 * counts are the whole room's, not one club's, so they wear the house blue:
 * club colour on this screen always means that club.
 *
 * This joins the stage as a persistent low-profile strip rather than
 * another item in the corner rotation (src/lib/cornerInfo.js), which holds
 * one operator-configured item (clock/tally/weather) at a time: these four
 * counts read best together as a single glanceable row, and they're driven
 * by the realtime feed rather than a Settings toggle. Breaking them into
 * four rotation slots would crowd out the clock and weather the operator
 * asked for. A quiet strip of its own keeps both simple.
 *
 * `active` (false while a check-in banner holds the stage) unmounts it
 * via AnimatePresence instead of leaning on z-index alone — a clean dip
 * out and back, and no strip sitting inertly behind a birthday banner.
 * Hidden entirely until the first broadcast arrives, and again once the
 * feed goes stale (TONIGHT_STALE_MS) — a frozen "63 checked in" from an
 * hour ago is worse than showing nothing. It holds the foot of the lobby:
 * the first-run card waits for it (src/lib/overlayFit.js setupUp), never the
 * other way round, since these counts are what the room is looking at.
 */
export default function TonightTicker({ tonight, active, now: clock }) {
  const [own, setOwn] = useState(() => Date.now());
  useEffect(() => {
    // A caller that needs to know whether the strip is up (App gives the first-run
    // card the foot when it is not) keeps the clock itself and hands it in, so the
    // two never disagree at the staleness edge.
    if (clock !== undefined) return undefined;
    const interval = setInterval(() => setOwn(Date.now()), FRESHNESS_CHECK_MS);
    return () => clearInterval(interval);
  }, [clock]);
  const now = clock ?? own;

  const rows = tickerRows(tonight, now);
  const show = active && rows.length > 0;

  return (
    <AnimatePresence>
      {show && (
        <M.div
          key="tonight-ticker"
          className="tonight-ticker"
          aria-live="off"
          initial={{ opacity: 0, y: '120%' }}
          animate={{ opacity: 1, y: '0%', transition: { duration: DUR.settle, ease: EASE.settle } }}
          exit={{ opacity: 0, y: '120%', transition: { duration: DUR.exit, ease: EASE.exit } }}
        >
          {rows.map((row, i) => <Stat key={row.key} index={i} value={row.value} label={row.label} />)}
        </M.div>
      )}
    </AnimatePresence>
  );
}

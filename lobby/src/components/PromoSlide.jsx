import ContestPromo, { DETAILS as CONTEST_DETAILS } from './promos/ContestPromo.jsx';
import FriendPromo, { DETAILS as FRIEND_DETAILS } from './promos/FriendPromo.jsx';
import BarfEpicPromo, { DETAILS as BARF_EPIC_DETAILS } from './promos/BarfEpicPromo.jsx';
import ParentsPromo, { DETAILS as PARENTS_DETAILS } from './promos/ParentsPromo.jsx';
import SnowAlertsPromo, { DETAILS as SNOW_ALERTS_DETAILS } from './promos/SnowAlertsPromo.jsx';
import FinalistsPromo, { DETAILS as FINALISTS_DETAILS } from './promos/FinalistsPromo.jsx';
import GrandPrixPromo, { DETAILS as GRAND_PRIX_DETAILS } from './promos/GrandPrixPromo.jsx';

export { RotatingDetail, splatPath, landsAt, keyframes } from './promos/kit.jsx';

// ─────────────────────────────────────────────────────────────
// The fall 2026 event promos: four 15 second showreel pieces, one per
// poster (the DEFEND poster contest, BARF Night, the BARF Night slime cut
// and Parents' Night), each one a full motion-design sequence that lands
// on its own finished printed poster. Which one shows, when, and what its
// countdown says is decided in the pure src/lib/promos.js; each poster's
// art lives in its own file under ./promos/, built from ./promos/kit.jsx.
// This file is only the index. The snow-alerts slide (Nov to Mar, the
// text-message sign-up) rides the same slot on its own cadence and wears the
// lobby's kit rather than a poster's faces; see src/lib/snowAlerts.js. The
// Awana Grand Prix (January to race day, 2027) is a video, not a showreel,
// that ends on the lobby's own screen (./promos/GrandPrixPromo.jsx).
// ─────────────────────────────────────────────────────────────

// Every line each poster says in its one rotating detail slot, in order.
// Each poster owns its own table (next to its art), and this is the one
// place they are gathered, so tests and detailsFor see them all.
export const PROMO_DETAILS = Object.freeze({
  contest: CONTEST_DETAILS,
  friend: FRIEND_DETAILS,
  barfEpic: BARF_EPIC_DETAILS,
  parents: PARENTS_DETAILS,
  snowAlerts: SNOW_ALERTS_DETAILS,
  finalists: FINALISTS_DETAILS,
  grandPrix: GRAND_PRIX_DETAILS,
});

const NO_DETAILS = Object.freeze([]);

/**
 * Which set of lines a promo descriptor gets. Tonight wins over
 * afterContest: on Parents' Night itself both are true and the room is
 * standing in front of the posters.
 *
 * @param {{ kind?: string, tonight?: boolean, afterContest?: boolean }|null|undefined} promo
 * @returns {ReadonlyArray<string>}
 */
export function detailsFor(promo) {
  const table = promo && PROMO_DETAILS[promo.kind];
  if (!table) return NO_DETAILS;
  if (promo.tonight && table.tonight) return table.tonight;
  if (promo.afterContest && table.afterContest) return table.afterContest;
  return table.default;
}

const SCENES = {
  contest: ContestPromo,
  friend: FriendPromo,
  barfEpic: BarfEpicPromo,
  parents: ParentsPromo,
  snowAlerts: SnowAlertsPromo,
  finalists: FinalistsPromo,
  grandPrix: GrandPrixPromo,
};

/**
 * One promo, full-bleed behind the check-in banners. `promo` is a
 * descriptor from buildPromoSlot(); an unknown kind renders nothing
 * rather than a broken frame, the same "missing data shows nothing"
 * rule the rest of the background follows.
 *
 * The rest is for a promo that ends on the lobby itself (`exit:
 * 'seamless'`, GrandPrixPromo) and is ignored by the showreels: `still` (no
 * motion: show the finished poster), `lead` (seconds before it starts: the
 * stinger's swap), `enter` (it came in on an ordinary change over the lobby
 * itself, `enter: 'seamless'`: appear once the scene in `theme` is at rest),
 * `onScene` (the scene behind it to rest, its chrome home or handed over to
 * it) and `onFinished` (it has ended its showing).
 *
 * @param {{
 *   promo: any,
 *   still?: boolean,
 *   lead?: number,
 *   enter?: boolean,
 *   theme?: string,
 *   onScene?: (state: { rest: boolean, home: boolean, shown: boolean }) => void,
 *   onFinished?: () => void,
 * }} props
 */
export default function PromoSlide({ promo, still, lead, enter, theme, onScene, onFinished }) {
  const Scene = promo && SCENES[promo.kind];
  if (!Scene) return null;
  return <Scene promo={promo} lines={detailsFor(promo)} still={still} lead={lead} enter={enter} theme={theme} onScene={onScene} onFinished={onFinished} />;
}

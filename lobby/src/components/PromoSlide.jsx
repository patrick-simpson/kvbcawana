import SnowAlertsPromo, { DETAILS as SNOW_ALERTS_DETAILS } from './promos/SnowAlertsPromo.jsx';
import GrandPrixPromo, { DETAILS as GRAND_PRIX_DETAILS } from './promos/GrandPrixPromo.jsx';
import VeteransPromo, { DETAILS as VETERANS_DETAILS } from './promos/VeteransPromo.jsx';

// ─────────────────────────────────────────────────────────────
// The season promos. Which one shows, when, and what its countdown says is
// decided in the pure src/lib/promos.js; each poster's art lives in its own
// file under ./promos/, built from ./promos/kit.jsx. This file is only the
// index. The fall 2026 posters (the DEFEND poster contest, BARF Night, its
// slime cut, Parents' Night and the poster finalists) were removed on
// 2026-11-10 after their dates passed; git history has them. What is here
// now: the snow-alerts slide (Nov to Mar, the text-message sign-up) rides the
// same slot on its own cadence and wears the lobby's kit rather than a
// poster's faces; see src/lib/snowAlerts.js. The Awana Grand Prix (January
// to race day, 2027) is a video, not a showreel, that ends on the lobby's own
// screen (./promos/GrandPrixPromo.jsx). The Veterans Day poster (Wednesday,
// November 11, 2026 only, twice per pass) is a quiet 10 seconds in the
// lobby's kit (./promos/VeteransPromo.jsx).
// ─────────────────────────────────────────────────────────────

// The detail lines each promo carries (the words of its end card), in order.
// Each poster owns its own table (next to its art), and this is the one
// place they are gathered, so tests and detailsFor see them all.
export const PROMO_DETAILS = Object.freeze({
  snowAlerts: SNOW_ALERTS_DETAILS,
  grandPrix: GRAND_PRIX_DETAILS,
  veterans: VETERANS_DETAILS,
});

const NO_DETAILS = Object.freeze([]);

/**
 * Which set of lines a promo descriptor gets: the table's `tonight` lines on
 * its night when it has them, else its `default` lines. `tables` is only a
 * seam for tests (no promo today has a `tonight` set).
 *
 * @param {{ kind?: string, tonight?: boolean }|null|undefined} promo
 * @param {Record<string, any>} [tables]
 * @returns {ReadonlyArray<string>}
 */
export function detailsFor(promo, tables = PROMO_DETAILS) {
  const table = promo && tables[promo.kind];
  if (!table) return NO_DETAILS;
  if (promo.tonight && table.tonight) return table.tonight;
  return table.default;
}

const SCENES = {
  snowAlerts: SnowAlertsPromo,
  grandPrix: GrandPrixPromo,
  veterans: VeteransPromo,
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

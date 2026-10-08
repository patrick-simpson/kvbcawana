import { AnimatePresence } from 'framer-motion';
import { M } from '../lib/motion.jsx';
import { DUR, EASE } from '../lib/brand.js';
import { getClubPalette } from '../lib/clubs.js';
import { leaveText } from '../lib/checkoutLeaves.js';

// "<First name> has checked out" (owner, 2026-10-08): one child at a time, in
// the foot of the lobby, in place of the still-here list (App hands the foot
// to whichever is up: src/lib/overlayFit.js lobbyRoom's `banner`). WHAT may be
// said is src/lib/checkoutLeaves.js (fresh lists only, a name only while the
// list is long enough to name); WHEN is useCheckoutBanners. This only draws
// it: a named child's banner is the club's colour with its white mark, like
// the check-in moment it echoes; "A child" and "and N more" are the house
// blue, with no club, because a club beside "a child" late in the evening is
// half a name. Every piece is M.*, so under ?lowPower=1 it simply appears and
// goes.

/**
 * @param {{ item: (import('../lib/checkoutLeaves.js').LeaveItem & { id: number }) | null, calm?: boolean }} props
 */
export default function CheckoutBanner({ item, calm = false }) {
  return (
    <div className="checkout-leaves">
      <AnimatePresence mode="wait">
        {item && <Banner key={item.id} item={item} calm={calm} />}
      </AnimatePresence>
    </div>
  );
}

/** @param {{ item: import('../lib/checkoutLeaves.js').LeaveItem, calm: boolean }} props */
function Banner({ item, calm }) {
  const club = item.kind === 'name' ? getClubPalette(item.club) : null;
  const motion = calm
    ? {}
    : {
        initial: { opacity: 0, y: '40%' },
        animate: { opacity: 1, y: '0%', transition: { duration: DUR.settle, ease: EASE.settle } },
        exit: { opacity: 0, y: '30%', transition: { duration: DUR.exit, ease: EASE.exit } },
      };
  return (
    <M.div
      className={`checkout-leave checkout-leave--${item.kind}`}
      role="status"
      style={club ? { '--club': club.primary, '--club-deep': club.deep || club.primary } : undefined}
      {...motion}
    >
      {club?.logo
        ? <img className="checkout-leave__mark" src={club.logo} alt={club.name || item.club} draggable="false" />
        : club && <span className="checkout-leave__club">{item.club}</span>}
      <span className="checkout-leave__text">{leaveText(item)}</span>
    </M.div>
  );
}

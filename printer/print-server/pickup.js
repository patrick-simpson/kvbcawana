// The lobby's "still here" list (7.16.0, owner 2026-10-08) — pure helpers.
//
// At 7:30 pm each club night the lobby screens show the children not yet
// picked up, then "<name> has checked out" as each one leaves. TwoTimTwo's own
// Checkout page lists nobody at KVBC (check-out tracking is off there), so the
// print server builds the list itself from tonight's count (server.js
// tonightHereNow(), the same identities authoritativeTonight() counts) and
// publishes it as the existing `checkout` event. This module holds the parts
// that need no server state: the shared "Clubs on the pickup list" setting
// (config.json `pickupClubs`) and the list's composition.
//
// PRIVACY: the list leaves the process only through events.buildCheckout()
// (first name + club, nothing else) in a sealed `checkout` frame, exactly as
// the old scraped board did.

'use strict';

// Every club the setting can name, in the order the dashboard shows them.
const PICKUP_CLUBS = Object.freeze(['Puggles', 'Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey']);
// Trek and Journey leave on their own at 7:15 (the extension's youth
// check-out), so they are off the pickup list unless someone ticks them.
const PICKUP_DEFAULT = Object.freeze(['Puggles', 'Cubbies', 'Sparks', 'T&T']);

// The same club reading as server.js clubKey(): a crest's alt text, a
// schedule row or a history row's clubName all land on one key.
function pickupClubKey(name) {
  const n = String(name == null ? '' : name).replace(/&amp;/gi, '&').trim().toLowerCase();
  if (!n) return null;
  if (n.includes('puggle')) return 'puggle';
  if (n.includes('cubbie')) return 'cubbie';
  if (n.includes('spark')) return 'spark';
  if (n.includes('trek')) return 'trek';
  if (n.includes('journey')) return 'journey';
  if (n.includes('t&t') || n.includes('t & t') || n === 'tnt' || n === 't t') return 't&t';
  return null;
}

const CANONICAL_BY_KEY = new Map(PICKUP_CLUBS.map((c) => [pickupClubKey(c), c]));

/**
 * Validate a `pickupClubs` value from POST /config.
 * null (or undefined) means "back to the default": the key is removed.
 * Otherwise an array of club names, each one of PICKUP_CLUBS (any spelling
 * pickupClubKey() reads), stored canonical, deduplicated, in display order.
 * An empty array is allowed: nobody's club is on the list.
 * @returns {{ok:true, value:string[]|null} | {ok:false, reason:string}}
 */
function normalizePickupClubs(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (!Array.isArray(raw)) return { ok: false, reason: 'pickupClubs must be a list of club names' };
  if (raw.length > 20) return { ok: false, reason: 'pickupClubs has too many entries' };
  const keys = new Set();
  for (const item of raw) {
    if (typeof item !== 'string') return { ok: false, reason: 'pickupClubs must be a list of club names' };
    const key = pickupClubKey(item);
    if (!key) return { ok: false, reason: `Unknown club on the pickup list: ${item.slice(0, 30)}` };
    keys.add(key);
  }
  return { ok: true, value: PICKUP_CLUBS.filter((c) => keys.has(pickupClubKey(c))) };
}

/** The clubs on the pickup list right now: the saved setting, or the default. */
function pickupClubsOf(config) {
  const saved = config && config.pickupClubs;
  if (saved === undefined || saved === null) return PICKUP_DEFAULT.slice();
  const n = normalizePickupClubs(saved);
  return n.ok && n.value ? n.value : PICKUP_DEFAULT.slice();
}

/**
 * Is a child of this club on the list? A child whose club cannot be read
 * ("No club", a walk-in printed before the roster knew them) is listed while
 * any club is ticked: at pickup it is better to show a child who has gone
 * than to leave off one who is still here.
 */
function onPickupList(club, clubs) {
  if (!Array.isArray(clubs) || !clubs.length) return false;
  const key = pickupClubKey(club);
  if (!key) return true;
  return clubs.some((c) => pickupClubKey(c) === key);
}

/**
 * The still-here list from tonight's "here now" children
 * ([{firstName, club}], one per child, as server.js tonightHereNow() gives
 * them): only the ticked clubs, nameless children dropped, sorted by first
 * name then club, capped at `max`. First name + club only.
 */
function buildStillHere(children, clubs, max) {
  const out = [];
  (Array.isArray(children) ? children : []).forEach((c) => {
    const firstName = String((c && c.firstName) || '').trim();
    if (!firstName) return;
    const club = String((c && c.club) || '').replace(/&amp;/gi, '&').trim();
    if (!onPickupList(club, clubs)) return;
    out.push({ firstName, club: CANONICAL_BY_KEY.get(pickupClubKey(club)) || club });
  });
  out.sort((a, b) => a.firstName.localeCompare(b.firstName, 'en', { sensitivity: 'base' })
    || a.club.localeCompare(b.club));
  return Number.isInteger(max) && max >= 0 ? out.slice(0, max) : out;
}

module.exports = {
  PICKUP_CLUBS,
  PICKUP_DEFAULT,
  pickupClubKey,
  normalizePickupClubs,
  pickupClubsOf,
  onPickupList,
  buildStillHere,
};

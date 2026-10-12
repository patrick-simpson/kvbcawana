// Club identity data — colors, official logos and mascot art. Colors and
// the white-knockout wordmarks come from the Awana Clubs 2026–27 catalog
// via the shared brand kit (shared/brand/, see its README): every mark is
// vector, so it stays sharp at any TV size, and white because banners sit
// on the club's own color. Puggles is blue by the owner's decision, not
// the orange its catalog page uses. These baked values are what a screen
// shows before shared/theme.json loads (and if it never does); theme.json
// carries the same catalog values and wins field by field once fetched.
// The Cubbies/Sparks/Puggles/T&T mascot stickers are club-supplied art (the
// PNGs in src/assets/clubs/, no script makes them); the white marks come from
// the catalog via scripts/brand/extract-catalog-brand.py. Lookup is
// case-insensitive and alias-aware; unknown or missing clubs fall back to
// the warm Awana-orange default so a typo in the check-in system still
// produces a joyful banner. Trek and Journey have no mascot characters
// (mascot: null).

import pugglesLogo from '../../shared/brand/logos/puggles-white.svg';
import cubbiesLogo from '../../shared/brand/logos/cubbies-white.svg';
import sparksLogo from '../../shared/brand/logos/sparks-white.svg';
import tntLogo from '../../shared/brand/logos/tnt-white.svg';
import trekLogo from '../../shared/brand/logos/trek-white.svg';
import journeyLogo from '../../shared/brand/logos/journey-white.svg';
import pugglesMascot from '../assets/clubs/puggles-mascot.png';
import cubbiesMascot from '../assets/clubs/cubbies-mascot.png';
import sparksMascot from '../assets/clubs/sparks-mascot.png';
import tntMascot from '../assets/clubs/tnt-mascot.png';
import { CLUB_TABLE, clubIdByAlias } from '../../shared/clubs.js';

// Each club's art, by id. Everything else about a club (name, colors, spellings)
// is the one table in shared/clubs.js, which the print server reads too.
const ART = {
  puggles: { logo: pugglesLogo, mascot: pugglesMascot },
  cubbies: { logo: cubbiesLogo, mascot: cubbiesMascot },
  sparks: { logo: sparksLogo, mascot: sparksMascot },
  't&t': { logo: tntLogo, mascot: tntMascot },
  trek: { logo: trekLogo, mascot: null },
  journey: { logo: journeyLogo, mascot: null },
};

const CLUBS = Object.fromEntries(CLUB_TABLE.map((c) => [c.id, {
  name: c.name,
  logo: ART[c.id].logo,
  mascot: ART[c.id].mascot,
  primary: c.primary,
  deep: c.deep,
  accent: c.accent,
  confetti: [...c.confetti],
}]));

const DEFAULT_CLUB = {
  name: '',
  logo: null,
  mascot: null,
  primary: '#FAA41D',
  deep: '#C97A08',
  accent: '#FFE8C2',
  confetti: ['#FAA41D', '#FCB614', '#FFFFFF'],
};

// Shared-theme overrides (#3): merged field-by-field over the baked
// values by applyClubOverrides(), so call sites are unchanged and a
// partial theme (color only, no art) still works. theme.json keys the
// clubs slightly differently ('tnt') — normalize here.
const THEME_KEY_MAP = { tnt: 't&t' };
let clubOverrides = {};
let aliasOverrides = {};

export function applyClubOverrides(overrides) {
  clubOverrides = {};
  aliasOverrides = {};
  if (!overrides || typeof overrides !== 'object') return;
  for (const [rawKey, o] of Object.entries(overrides)) {
    const key = THEME_KEY_MAP[rawKey] || rawKey;
    if (!CLUBS[key] || !o) continue;
    const merged = {};
    if (o.primary) merged.primary = o.primary;
    if (o.deep) merged.deep = o.deep;
    if (o.accent) merged.accent = o.accent;
    if (Array.isArray(o.confetti) && o.confetti.length) merged.confetti = o.confetti;
    if (o.logoUrl) merged.logo = o.logoUrl;
    clubOverrides[key] = merged;
    for (const alias of o.aliases || []) aliasOverrides[alias] = key;
  }
}

export function getClubPalette(clubName) {
  if (!clubName || typeof clubName !== 'string') return DEFAULT_CLUB;
  const canonical = clubIdByAlias(clubName, aliasOverrides);
  const base = CLUBS[canonical];
  if (!base) return DEFAULT_CLUB;
  const override = clubOverrides[canonical];
  return override ? { ...base, ...override } : base;
}

/**
 * A club's canonical key ('sparks', 't&t', ...) from any spelling the system
 * uses: a display name ("T&T", "Sparks"), an id ('tnt'), an alias ("Truth &
 * Training") or a theme alias. Null for a name no club answers to.
 * @param {unknown} name
 * @returns {string | null}
 */
export function clubKey(name) {
  if (!name || typeof name !== 'string') return null;
  const canonical = clubIdByAlias(name, aliasOverrides);
  return CLUBS[canonical] ? canonical : null;
}

/**
 * The ids the per-screen club count (Settings → Screen & corner → This TV →
 * "Club count (upper right)") offers, youngest club first, as theme.json keys
 * them.
 */
export const CORNER_CLUB_IDS = ['puggles', 'cubbies', 'sparks', 'tnt', 'trek', 'journey'];

/**
 * One club's count from a tally's per-club `counts` (keyed by display name,
 * "Sparks", "T&T"; since printer 7.15.0 a "here now" count, children checked
 * out already taken off), matched by clubKey so any spelling of the club
 * counts. Null when the tally has no entry for it (or no tally yet).
 * @param {Record<string, number> | null | undefined} counts
 * @param {string} club  an id or any name the club answers to
 * @returns {number | null}
 */
export function countForClub(counts, club) {
  const want = clubKey(club);
  if (!want || !counts || typeof counts !== 'object') return null;
  let found = null;
  for (const [name, n] of Object.entries(counts)) {
    if (clubKey(name) === want && Number.isFinite(n)) found = (found ?? 0) + n;
  }
  return found;
}

export function getAllClubs() {
  // Used by the debug panel's "Trigger Every Club" button.
  return Object.values(CLUBS).map((c) => c.name);
}

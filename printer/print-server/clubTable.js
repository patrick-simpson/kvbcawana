// GENERATED from lobby/shared/clubs.js by scripts/shared-copies.mjs: do not edit; edit the source and run
// `node scripts/shared-copies.mjs`. scripts/check-mirrors.mjs fails when this copy drifts.
'use strict';
// @ts-check
// THE club table: every club's id, display name, spellings, colors, mark name
// and label monogram, once. Two readers, two matchers, ONE table:
//
//   - the lobby (lobby/src/lib/clubs.js, through Vite) finds a club by an
//     EXACT, case-insensitive spelling (clubIdByAlias): a display name, an id
//     or a listed alias, plus the aliases theme.json adds at runtime. It adds
//     the art (logo, mascot) to the table's colors.
//   - the print server (printer/print-server/server.js, through its generated
//     copy print-server/clubTable.js) finds a club by SUBSTRING in the text a
//     label or a check-in page carries (clubKeyByLabel: "Sparks - Room 4",
//     "AWANA Cubbies"), which is on purpose: that text is free-form. Its
//     keys are the singular `key` (puggle, cubbie, spark) the label code,
//     the saved templates and the history were always filed under; brand.js
//     takes its mark files and the warnings' names from the same rows.
//
// Neither matcher may change what the other answers, and no spelling may move
// from one to the other: the label goldens (printer/scripts/test-label-golden.cjs)
// and lobby/src/lib/clubs.test.js pin both. Colors are the Awana 2026-27
// catalog's (shared/brand/tokens.json; Puggles is blue by the owner's call).
//
// Self-contained: see lobby/shared/README.md for how each app loads it.

/**
 * @typedef {{
 *   id: string, key: string, name: string, aliases: string[], mark: string, monogram: string,
 *   primary: string, deep: string, accent: string, confetti: string[],
 * }} ClubRow
 */

/** Youngest club first. @type {ReadonlyArray<Readonly<ClubRow>>} */
const CLUB_TABLE = Object.freeze([
  {
    id: 'puggles', key: 'puggle', name: 'Puggles', aliases: ['puggle'], mark: 'puggles', monogram: 'P',
    primary: '#1DB6D9', deep: '#1A627C', accent: '#BCDCEE', confetti: ['#1DB6D9', '#BCDCEE', '#FCB614', '#FFFFFF'],
  },
  {
    id: 'cubbies', key: 'cubbie', name: 'Cubbies', aliases: ['cubbie'], mark: 'cubbies', monogram: 'C',
    primary: '#4C72B8', deep: '#2F4F8A', accent: '#C4DDF3', confetti: ['#4C72B8', '#C4DDF3', '#F15A28', '#FFFFFF'],
  },
  {
    id: 'sparks', key: 'spark', name: 'Sparks', aliases: ['spark'], mark: 'sparks', monogram: 'S',
    primary: '#F04A4B', deep: '#B82B32', accent: '#FDDACF', confetti: ['#F04A4B', '#FCB614', '#FFFFFF'],
  },
  {
    id: 't&t', key: 't&t', name: 'T&T', aliases: ['truth & training', 'truth and training', 'tnt', 't & t'], mark: 'tnt', monogram: 'T&T',
    primary: '#58BD79', deep: '#2F8A4E', accent: '#D0E9D5', confetti: ['#58BD79', '#D0E9D5', '#FFFFFF'],
  },
  {
    id: 'trek', key: 'trek', name: 'Trek', aliases: [], mark: 'trek', monogram: 'TR',
    primary: '#047E71', deep: '#02554C', accent: '#CCEAEC', confetti: ['#047E71', '#CCEAEC', '#FFFFFF'],
  },
  {
    id: 'journey', key: 'journey', name: 'Journey', aliases: [], mark: 'journey', monogram: 'J',
    primary: '#8A649D', deep: '#56467F', accent: '#DED5EA', confetti: ['#8A649D', '#DED5EA', '#FCB614', '#FFFFFF'],
  },
]);

/**
 * The spellings the check-in system might send, each to its club's id. A plain
 * object on purpose: the lobby's lookup has always read it as one.
 * @type {Record<string, string>}
 */
const CLUB_ALIASES = {};
for (const club of CLUB_TABLE) for (const alias of club.aliases) CLUB_ALIASES[alias] = club.id;

/**
 * The lobby's matcher: a club's id from an EXACT spelling (trimmed, lower
 * case): an alias in the table, else one of `extraAliases` (theme.json's),
 * else the text itself, which the caller checks against its own club ids.
 * @param {string} name
 * @param {Record<string, string>} [extraAliases]
 * @returns {string}
 */
function clubIdByAlias(name, extraAliases = {}) {
  const key = name.trim().toLowerCase();
  return CLUB_ALIASES[key] || extraAliases[key] || key;
}

/**
 * The print server's matcher: a club's `key` from the free text a label,
 * a crest's alt text or a schedule row carries, by SUBSTRING (the text is
 * not a clean name): "Sparks - Room 4" is a spark. Null for text no club is in.
 * @param {unknown} clubName
 * @returns {string | null}
 */
function clubKeyByLabel(clubName) {
  const n = String(clubName || '').trim().toLowerCase();
  if (!n) return null;
  if (n.includes('puggle')) return 'puggle';
  if (n.includes('cubbie')) return 'cubbie';
  if (n.includes('spark')) return 'spark';
  if (n.includes('trek')) return 'trek';
  if (n.includes('journey')) return 'journey';
  if (n.includes('t&t') || n.includes('t & t') || n === 'tnt' || n === 't t') return 't&t';
  return null;
}

module.exports = {
  CLUB_TABLE,
  CLUB_ALIASES,
  clubIdByAlias,
  clubKeyByLabel,
};

// Hand out shares: the page's pure parts (tests: site/test/shares.test.mjs).

/** The clubs youngest first; anything else after them, alphabetical. */
export const CLUB_ORDER = Object.freeze(['Puggles', 'Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey']);
/** A club's kit key, for its plate colour. @param {string} club */
export function clubKey(club) {
  const c = String(club || '').toLowerCase();
  if (c.includes('pug')) return 'puggles';
  if (c.includes('cub')) return 'cubbies';
  if (c.includes('spark')) return 'sparks';
  if (c.includes('t&t') || c.includes('tnt') || c.includes('truth')) return 'tnt';
  if (c.includes('trek')) return 'trek';
  if (c.includes('journey')) return 'journey';
  return '';
}

/**
 * Tonight's children by club, youngest club first, each by first then last name.
 * @param {{ id: string, first: string, last: string, club: string, given?: number }[]} kids
 */
export function byClub(kids) {
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  for (const k of kids || []) {
    const club = String(k.club || 'No club');
    if (!groups.has(club)) groups.set(club, []);
    groups.get(club).push(k);
  }
  const rank = (c) => { const i = CLUB_ORDER.findIndex((x) => clubKey(x) === clubKey(c) && clubKey(c)); return i < 0 ? 99 : i; };
  return [...groups.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([club, list]) => ({
      club,
      key: clubKey(club),
      kids: list.slice().sort((a, b) => `${a.first} ${a.last}`.localeCompare(`${b.first} ${b.last}`)),
    }));
}

/** The reason written in TwoTimTwo, by tonight's theme. @param {{ backwards?: boolean }} night */
export function defaultWhy(night) {
  return night && night.backwards ? 'Backwards Night' : 'Awana club night';
}

/** The confirm line. @param {number} kids @param {number} shares */
export function confirmWords(kids, shares) {
  const each = `${shares} share${shares === 1 ? '' : 's'}`;
  return `Give ${each} to ${kids} child${kids === 1 ? '' : 'ren'}? TwoTimTwo has no undo.`;
}

/** One child's result line. @param {any} r */
export function resultWords(r) {
  if (!r) return '';
  if (r.outcome === 'given') return r.repeat ? 'Already given' : `+${r.shares} given${Number.isInteger(r.balance) ? ` · now ${r.balance}` : ''}`;
  if (r.outcome === 'unknown') return 'Not sure it went in: look in TwoTimTwo (never tried twice)';
  if (r.outcome === 'refused') return 'TwoTimTwo would not take it';
  if (r.reason === 'no-meeting-tonight') return 'TwoTimTwo has no meeting tonight';
  if (r.reason === 'no-permission') return 'The service\'s TwoTimTwo login may not give shares';
  if (r.reason === 'read-busy') return 'TwoTimTwo is busy: try again in a moment';
  return 'Could not reach TwoTimTwo: try again';
}

/** A batch key: one Give press. */
export function batchKey() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

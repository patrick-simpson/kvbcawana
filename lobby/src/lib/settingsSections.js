// @ts-check
// The Settings panel's sections: what they are called, the order the rail
// lists them in, and which one the panel opens on. Pure, so the choice is
// tested rather than eyeballed (settingsSections.test.js).
//
// Since 2026-10-12 (docs/SETTINGS-OVERHAUL.md section 1) the rail is seven
// sections; since the reorganize (2026-10-13, docs/SETTINGS-OVERHAUL.md
// "Reorganize") eight, with Journey, in the order a volunteer reaches for them
// on a club night: what is happening tonight, the printing (reprints and name
// tags first), the screens and what they show, then what is set once (Journey,
// history) and the account. The old eight-plus-three rail (?rail=classic) was
// removed 2026-10-16; its tab ids still resolve through LEGACY_TABS.

/** @typedef {'tonight' | 'printing' | 'screens' | 'show' | 'look' | 'journey' | 'history' | 'account'} SectionId */

/** @type {{ id: SectionId, label: string, blurb: string }[]} */
export const SECTIONS = [
  { id: 'tonight', label: 'Tonight', blurb: 'Live count, problems, notice to screens' },
  { id: 'printing', label: 'Printing', blurb: 'Reprints, name tags, labels, schedule' },
  { id: 'screens', label: 'Screens', blurb: 'Every TV, projector, kiosk and computer' },
  { id: 'show', label: 'What screens show', blurb: 'Welcomes, celebrations, pickup, corner' },
  { id: 'look', label: 'Slides & look', blurb: 'Slides, calendar, background, season' },
  { id: 'journey', label: 'Journey', blurb: 'Captions, teaching slides, saved lessons' },
  { id: 'history', label: 'History', blurb: 'Trends, past nights, import' },
  { id: 'account', label: 'Account & app', blurb: 'Sign-in, passphrase, the Windows app' },
];

/** @type {Record<string, { id: SectionId, label: string, blurb: string }>} */
const BY_ID = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));
const pick = (/** @type {SectionId[]} */ ids) => ids.map((id) => BY_ID[id]);

const TV_SECTIONS = pick(['tonight', 'show', 'look', 'account']);
const REMOTE_SECTIONS = pick(['tonight', 'show', 'look']);

/**
 * The sections a surface lists.
 * @param {boolean} page true on awana.kvbchurch.org/settings
 * @param {{ remote?: boolean }} [opts] remote: a screen opened from the page's Screens
 */
export function sectionsFor(page, { remote = false } = {}) {
  if (remote) return REMOTE_SECTIONS;
  return page ? SECTIONS : TV_SECTIONS;
}

// The old tab ids (the removed classic rail's, and the first two-pane redesign's): a
// caller (or a link in old copy) asking for one lands on the section that now
// holds its controls.
/** @type {Record<string, SectionId>} */
export const LEGACY_TABS = {
  status: 'tonight',
  checkins: 'show',
  slides: 'look',
  screen: 'show',
  celebrations: 'show',
  pickup: 'show',
  setup: 'account',
  laptop: 'printing',
  connection: 'account',
  background: 'look',
  banners: 'show',
  display: 'show',
  calendar: 'look',
};

/**
 * Normalise a requested section id (new or legacy) to a real one, or null.
 * @param {unknown} id
 * @returns {SectionId | null}
 */
export function resolveSection(id) {
  if (typeof id !== 'string') return null;
  if (id in BY_ID) return /** @type {SectionId} */ (id);
  return LEGACY_TABS[id] ?? null;
}

/**
 * Which section the panel opens on.
 *  - an explicit request (the first-run card, the slide editor's return) wins;
 *  - the settings page: Account & app until signed in (nothing there reaches a
 *    screen without it), else Tonight;
 *  - a TV that cannot work yet (not signed in, or no key for the names) opens
 *    on Account & app, where the fix is;
 *  - anything else wrong opens on Tonight, where the problem is explained;
 *  - otherwise What screens show, the section changed most often.
 * @param {unknown} requested
 * @param {{ status?: string, keyed?: boolean, problems?: number, page?: boolean, signedIn?: boolean }} state
 * @returns {SectionId}
 */
export function openingSection(requested, { status, keyed = false, problems = 0, page = false, signedIn = false } = {}) {
  const asked = resolveSection(requested);
  if (asked) return asked;
  if (page) return signedIn ? 'tonight' : 'account';
  if (status === 'off' || (status === 'connected' && !keyed)) return 'account';
  if (problems > 0 || status === 'disconnected') return 'tonight';
  return 'show';
}

/** Plain words for the program phase (src/lib/schedule.js). */
export const PHASE_WORDS = {
  off: 'No club tonight',
  countdown: 'Before club',
  ceremony: 'Opening ceremony',
  'game-time': 'Game time',
  closing: 'Closing',
  shutdown: 'After club (pickup)',
};

/**
 * @param {string | null | undefined} phase
 * @returns {string}
 */
export function phaseWords(phase) {
  if (!phase) return '';
  return /** @type {Record<string, string>} */ (PHASE_WORDS)[phase] ?? phase;
}

/**
 * The TV preview's focus after the pointer or keyboard moved into a card:
 * the SAME object when nothing changed, so React skips the render (a pointer
 * moving inside one card fires this on every move).
 * @param {{ section: string, focus: string }} prev
 * @param {string} section
 * @param {string} focus
 */
export function nextFocusState(prev, section, focus) {
  return prev.section === section && prev.focus === focus ? prev : { section, focus };
}

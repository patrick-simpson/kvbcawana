// @ts-check
// The Settings panel's sections: what they are called, the order the rail
// lists them in, and which one the panel opens on. Pure, so the choice is
// tested rather than eyeballed (settingsSections.test.js).
//
// Everyday sections first (what a volunteer reaches for on a club night),
// then the ones set once, then setup and tools.

/** @typedef {'status' | 'checkins' | 'slides' | 'screen' | 'celebrations' | 'pickup' | 'look' | 'setup' | 'laptop' | 'screens' | 'history'} SectionId */

/** @type {{ id: SectionId, label: string, blurb: string }[]} */
export const SECTIONS = [
  { id: 'status', label: 'Status', blurb: 'Connection, tonight, problems' },
  { id: 'checkins', label: 'Check-ins', blurb: 'Welcome banners, sound, club lines' },
  { id: 'slides', label: 'Slides', blurb: 'What plays behind the names' },
  { id: 'screen', label: 'Screen & corner', blurb: 'Clock, counter, weather, this TV' },
  { id: 'celebrations', label: 'Celebrations', blurb: 'Milestones, books, awards' },
  { id: 'pickup', label: 'Pickup board', blurb: "Who's not checked out yet" },
  { id: 'look', label: 'Look & season', blurb: 'Night skins, weather effects' },
  { id: 'setup', label: 'Setup', blurb: 'Connect this screen, keys, tools' },
];

// The settings page's own sections: they are about other devices, so a
// screen's own Settings, and a screen opened from the page, never list them.
// Screens (ROADMAP.md#settings-page phase 2): every registered screen, right after Status.
/** @type {{ id: SectionId, label: string, blurb: string }} */
export const SCREENS_SECTION = { id: 'screens', label: 'Screens', blurb: 'Every TV, projector and kiosk' };
// Laptop (ROADMAP.md#settings-page phase 3): the check-in laptop's printer, labels,
// schedule and diagnostics, reached through localhost, just before Setup.
/** @type {{ id: SectionId, label: string, blurb: string }} */
export const LAPTOP_SECTION = { id: 'laptop', label: 'Laptop', blurb: 'Printer, labels, schedule, diagnostics' };
// History (ROADMAP.md#online-check-in, P6): past nights, trends, sealed rows
// opened in the browser. Settings page only, right after Laptop.
/** @type {{ id: SectionId, label: string, blurb: string }} */
export const HISTORY_SECTION = { id: 'history', label: 'History', blurb: 'Past nights, trends, export' };

/**
 * The sections a surface lists.
 * @param {boolean} page true on awana.kvbchurch.org/settings
 * @param {{ remote?: boolean }} [opts] remote: a screen opened from the page's Screens
 */
export function sectionsFor(page, { remote = false } = {}) {
  if (!page || remote) return SECTIONS;
  return [SECTIONS[0], SCREENS_SECTION, ...SECTIONS.slice(1, -1), LAPTOP_SECTION, HISTORY_SECTION, SECTIONS[SECTIONS.length - 1]];
}

const IDS = new Set([...SECTIONS, SCREENS_SECTION, LAPTOP_SECTION, HISTORY_SECTION].map((s) => s.id));

// The old tab ids, from before the two-pane redesign: a caller (or a link in
// old copy) asking for one lands on the section that now holds its controls.
/** @type {Record<string, SectionId>} */
export const LEGACY_TABS = {
  connection: 'setup',
  background: 'slides',
  banners: 'checkins',
  display: 'screen',
  calendar: 'slides',
};

/**
 * Normalise a requested section id (new or legacy) to a real one, or null.
 * @param {unknown} id
 * @returns {SectionId | null}
 */
export function resolveSection(id) {
  if (typeof id !== 'string') return null;
  if (IDS.has(/** @type {SectionId} */ (id))) return /** @type {SectionId} */ (id);
  return LEGACY_TABS[id] ?? null;
}

/**
 * Which section the panel opens on.
 *  - an explicit request (the first-run card, the slide editor's return) wins;
 *  - a screen that cannot work yet (not signed in, or no key for the names)
 *    opens on Setup, where the fix is;
 *  - anything else wrong opens on Status, where the problem is explained;
 *  - otherwise Check-ins, the section changed most often.
 * @param {unknown} requested
 * @param {{ status?: string, keyed?: boolean, problems?: number }} state
 * @returns {SectionId}
 */
export function openingSection(requested, { status, keyed = false, problems = 0 } = {}) {
  const asked = resolveSection(requested);
  if (asked) return asked;
  if (status === 'off' || (status === 'connected' && !keyed)) return 'setup';
  if (problems > 0 || status === 'disconnected') return 'status';
  return 'checkins';
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

// @ts-check
// The Settings panel's sections: what they are called, the order the rail
// lists them in, and which one the panel opens on. Pure, so the choice is
// tested rather than eyeballed (settingsSections.test.js).
//
// Since 2026-10-12 (docs/SETTINGS-OVERHAUL.md section 1) the rail is seven
// sections. The old eight-plus-three rail is still here, behind ?rail=classic
// (or localStorage awanaSettingsRail.v1 = 'classic'), for the release after
// the overhaul only; it is deleted the release after that.
//
// Everyday sections first (what an owner reaches for on a club night), then
// the ones set once, then the account.

/** @typedef {'tonight' | 'screens' | 'show' | 'look' | 'printing' | 'history' | 'account'} SectionId */
/** @typedef {'status' | 'checkins' | 'slides' | 'screen' | 'celebrations' | 'pickup' | 'look' | 'setup' | 'laptop' | 'screens' | 'history'} ClassicSectionId */

/** @type {{ id: SectionId, label: string, blurb: string }[]} */
export const SECTIONS = [
  { id: 'tonight', label: 'Tonight', blurb: 'Live count, printer, switches, notice' },
  { id: 'screens', label: 'Screens', blurb: 'Every TV, projector, kiosk, computer' },
  { id: 'show', label: 'What screens show', blurb: 'Welcomes, celebrations, pickup, corner' },
  { id: 'look', label: 'Slides & look', blurb: 'Slides, calendar, background, season' },
  { id: 'printing', label: 'Printing', blurb: 'Labels, name tags, schedule, BARF Night' },
  { id: 'history', label: 'History', blurb: 'Trends, nights, import' },
  { id: 'account', label: 'Account & app', blurb: 'Sign-in, passphrase, KVBC Awana' },
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

// The old tab ids (the classic rail's, and the first two-pane redesign's): a
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

// ── The classic rail (?rail=classic): this release only ─────────────────────

/** @type {{ id: ClassicSectionId, label: string, blurb: string }[]} */
export const CLASSIC_SECTIONS = [
  { id: 'status', label: 'Status', blurb: 'Connection, tonight, problems' },
  { id: 'checkins', label: 'Check-ins', blurb: 'Welcome banners, sound, club lines' },
  { id: 'slides', label: 'Slides', blurb: 'What plays behind the names' },
  { id: 'screen', label: 'Screen & corner', blurb: 'Clock, counter, weather, this TV' },
  { id: 'celebrations', label: 'Celebrations', blurb: 'Milestones, books, awards' },
  { id: 'pickup', label: 'Pickup board', blurb: "Who's not checked out yet" },
  { id: 'look', label: 'Look & season', blurb: 'Night skins, weather effects' },
  { id: 'setup', label: 'Setup', blurb: 'Connect this screen, keys, tools' },
];
/** @type {{ id: ClassicSectionId, label: string, blurb: string }} */
export const CLASSIC_SCREENS_SECTION = { id: 'screens', label: 'Screens', blurb: 'Every TV, projector and kiosk' };
/** @type {{ id: ClassicSectionId, label: string, blurb: string }} */
export const CLASSIC_LAPTOP_SECTION = { id: 'laptop', label: 'Laptop', blurb: 'Printer, labels, schedule, diagnostics' };
/** @type {{ id: ClassicSectionId, label: string, blurb: string }} */
export const CLASSIC_HISTORY_SECTION = { id: 'history', label: 'History', blurb: 'Past nights, trends, export' };

/**
 * @param {boolean} page @param {{ remote?: boolean }} [opts]
 */
export function classicSectionsFor(page, { remote = false } = {}) {
  if (!page || remote) return CLASSIC_SECTIONS;
  return [CLASSIC_SECTIONS[0], CLASSIC_SCREENS_SECTION, ...CLASSIC_SECTIONS.slice(1, -1), CLASSIC_LAPTOP_SECTION, CLASSIC_HISTORY_SECTION, CLASSIC_SECTIONS[CLASSIC_SECTIONS.length - 1]];
}

const CLASSIC_IDS = new Set([...CLASSIC_SECTIONS, CLASSIC_SCREENS_SECTION, CLASSIC_LAPTOP_SECTION, CLASSIC_HISTORY_SECTION].map((s) => s.id));
// (and the new rail's ids, so a caller that speaks the new names still lands somewhere sensible)
/** @type {Record<string, ClassicSectionId>} */
const CLASSIC_LEGACY = {
  connection: 'setup', background: 'slides', banners: 'checkins', display: 'screen', calendar: 'slides',
  tonight: 'status', show: 'checkins', account: 'setup', printing: 'laptop',
};

/**
 * @param {unknown} id
 * @returns {ClassicSectionId | null}
 */
export function resolveClassicSection(id) {
  if (typeof id !== 'string') return null;
  if (CLASSIC_IDS.has(/** @type {ClassicSectionId} */ (id))) return /** @type {ClassicSectionId} */ (id);
  return CLASSIC_LEGACY[id] ?? null;
}

/**
 * The classic rail's opening choice (Setup when it cannot work, Status when
 * anything is wrong, else Check-ins).
 * @param {unknown} requested
 * @param {{ status?: string, keyed?: boolean, problems?: number }} state
 * @returns {ClassicSectionId}
 */
export function classicOpeningSection(requested, { status, keyed = false, problems = 0 } = {}) {
  const asked = resolveClassicSection(requested);
  if (asked) return asked;
  if (status === 'off' || (status === 'connected' && !keyed)) return 'setup';
  if (problems > 0 || status === 'disconnected') return 'status';
  return 'checkins';
}

export const RAIL_STORAGE = 'awanaSettingsRail.v1';

/**
 * Which rail to draw: 'classic' by ?rail=classic, or a viewer who chose it
 * once (localStorage, a per-viewer convenience: any failure means the new rail).
 * ?rail=new forgets the choice.
 * @param {string} [search]
 * @returns {'classic' | 'new'}
 */
export function railMode(search = typeof window !== 'undefined' ? window.location.search : '') {
  let asked = null;
  try { asked = new URLSearchParams(search).get('rail'); } catch { /* none */ }
  if (asked === 'classic') {
    try { localStorage.setItem(RAIL_STORAGE, 'classic'); } catch { /* per-visit only */ }
    return 'classic';
  }
  if (asked === 'new') {
    try { localStorage.removeItem(RAIL_STORAGE); } catch { /* ignore */ }
    return 'new';
  }
  try { if (localStorage.getItem(RAIL_STORAGE) === 'classic') return 'classic'; } catch { /* the new rail */ }
  return 'new';
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

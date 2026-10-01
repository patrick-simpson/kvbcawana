// @ts-check
// Seasonal night skins — the single source of truth.
//
// A "skin" dresses the room for the season. It used to be two CSS custom
// properties (`--skin-a` / `--skin-b`) touching three small surfaces, with the
// id list duplicated in four places (here, the config validators, the Settings
// dropdown, and the CSS) so adding one season meant editing five files. Now one
// table carries the id, the accent pair, the scene theme, and any calendar
// title that should select it.
//
// Layering, deliberately (see also lib/weather.js):
//   • The SEASON picks the scene theme — the background gradient, waves and
//     doodles behind everything.
//   • The WEATHER only adds atmosphere on top (a cool/dim modifier), so a VBS
//     skin stays VBS on a wet night instead of silently disappearing.
//   • Club colours are never touched. Banners keep their catalog colour, per
//     the standing rule: the skin dresses the room, not the kids.
//   • The optional `confetti` profile follows the same rule (#340): it dresses
//     the ROOM-wide bursts (the milestone toast, a birthday) in the season's
//     colours and shapes, and a club's own milestone still bursts in that
//     club's colours — see fireMilestone in lib/confetti.js.

/**
 * @typedef {Object} Skin
 * @property {string} a Accent A (`--skin-a`).
 * @property {string} b Accent B (`--skin-b`).
 * @property {string} scene A key of CatalogScene THEMES.
 * @property {ReadonlyArray<string>} [titles] Lowercase calendar-title keywords
 *   that select this skin (see skinForCalendarTitle).
 * @property {string} label Human label for the Settings dropdown.
 * @property {{ colors: ReadonlyArray<string>, shapes: ReadonlyArray<string> }} [confetti]
 *   Season-shaped confetti for the room-wide bursts (see
 *   setConfettiSkin in lib/confetti.js). Shapes are canvas-confetti's
 *   BUILT-IN names only — the list lives in confetti.js's
 *   CONFETTI_SHAPES and skins.test.js cross-checks every entry against
 *   it, so a typo fails the suite instead of silently rendering squares.
 */

/** @type {Record<string, Skin>} */
export const SKIN_TABLE = {
  autumn:       { a: '#d97706', b: '#7c2d12', scene: 'sunset',   label: 'Autumn',
    confetti: { colors: ['#d97706', '#b45309', '#7c2d12', '#fbbf24'], shapes: ['square'] } },
  harvest:      { a: '#b45309', b: '#4d7c0f', scene: 'sunset',   label: 'Harvest',
    confetti: { colors: ['#b45309', '#4d7c0f', '#d97706', '#fde68a'], shapes: ['square'] } },
  thanksgiving: { a: '#b45309', b: '#7c2d12', scene: 'sunset',   label: 'Thanksgiving', titles: ['thanksgiving', 'harvest festival'],
    confetti: { colors: ['#b45309', '#7c2d12', '#d97706', '#fef3c7'], shapes: ['square'] } },
  christmas:    { a: '#dc2626', b: '#14532d', scene: 'night',    label: 'Christmas',    titles: ['christmas', 'nativity', 'advent'],
    confetti: { colors: ['#dc2626', '#14532d', '#ffffff', '#f59e0b'], shapes: ['star'] } },
  snowday:      { a: '#38bdf8', b: '#e0f2fe', scene: 'lavender', label: 'Snow day',
    confetti: { colors: ['#ffffff', '#e0f2fe', '#38bdf8', '#bae6fd'], shapes: ['circle'] } },
  spring:       { a: '#22c55e', b: '#f472b6', scene: 'meadow',   label: 'Spring',
    confetti: { colors: ['#22c55e', '#f472b6', '#fde68a', '#ffffff'], shapes: ['circle', 'square'] } },
  easter:       { a: '#a78bfa', b: '#fde68a', scene: 'lavender', label: 'Easter',       titles: ['easter', 'resurrection'],
    confetti: { colors: ['#a78bfa', '#fde68a', '#f9a8d4', '#ffffff'], shapes: ['circle'] } },
  summer:       { a: '#0ea5e9', b: '#fbbf24', scene: 'sky',      label: 'Summer',
    confetti: { colors: ['#0ea5e9', '#fbbf24', '#ffffff', '#22d3ee'], shapes: ['circle', 'star'] } },
  vbs:          { a: '#f97316', b: '#0ea5e9', scene: 'sky',      label: 'VBS',          titles: ['vbs', 'vacation bible school'],
    confetti: { colors: ['#f97316', '#0ea5e9', '#facc15', '#22c55e', '#ec4899'], shapes: ['star', 'circle', 'square'] } },
  // Keywords are deliberately SPECIFIC. Generic words ("kickoff", "first
  // night") collide with other seasons — a "VBS Kickoff Night" resolved to
  // back-to-school before they were removed — and an ambiguous skin is worse
  // than none, because nobody can predict what the screen will do.
  backtoschool: { a: '#2563eb', b: '#f59e0b', scene: 'meadow',   label: 'Back to school', titles: ['back to school', 'back-to-school'],
    confetti: { colors: ['#2563eb', '#f59e0b', '#ffffff', '#ef4444'], shapes: ['square', 'circle'] } },
};

/**
 * Every valid `nightTheme` value. 'none' and 'auto' are modes, not skins.
 * @type {ReadonlyArray<string>}
 */
export const SKINS = ['none', ...Object.keys(SKIN_TABLE)];

/** Values the config validator and the Settings dropdown accept. */
export const NIGHT_THEME_VALUES = ['none', 'auto', ...Object.keys(SKIN_TABLE)];

/**
 * Options for the Settings dropdown, so the UI can't drift from the table.
 * @returns {Array<{ value: string, label: string }>}
 */
export function skinOptions() {
  return [
    { value: 'none', label: 'None' },
    { value: 'auto', label: 'Auto (by season & calendar)' },
    ...Object.entries(SKIN_TABLE).map(([value, s]) => ({ value, label: s.label })),
  ];
}

// Month fallback for 'auto' when the calendar says nothing special. Indexed
// Jan–Dec. Note November is `thanksgiving` rather than `harvest` now that the
// season exists; the two are visually close by design.
const MONTH_SKINS = [
  'snowday',      // Jan
  'snowday',      // Feb
  'spring',       // Mar
  'spring',       // Apr
  'spring',       // May
  'summer',       // Jun
  'summer',       // Jul
  'backtoschool', // Aug
  'autumn',       // Sep
  'autumn',       // Oct
  'thanksgiving', // Nov
  'christmas',    // Dec
];

/**
 * The skin 'auto' falls back to on `date` when the calendar offers nothing.
 * @param {Date} [date]
 * @returns {string}
 */
export function autoSkin(date = new Date()) {
  return MONTH_SKINS[date.getMonth()] ?? 'none';
}

/**
 * Match a church calendar title to a skin.
 *
 * This is why 'auto' needed more than a month table: Thanksgiving floats to the
 * fourth Thursday, Easter is lunar, and VBS / back-to-school are whenever the
 * church schedules them. None of those can be expressed by month — but they are
 * all already written down in the calendar feed whose titles the slide builder
 * parses, so the screen can dress itself from the schedule you already keep.
 *
 * Longest keyword wins, so "vacation bible school" beats a stray "school".
 *
 * @param {string|null|undefined} title
 * @returns {string|null} A skin id, or null when nothing matches.
 */
export function skinForCalendarTitle(title) {
  if (!title || typeof title !== 'string') return null;
  const hay = title.toLowerCase();
  /** @type {{ id: string, len: number }|null} */
  let best = null;
  for (const [id, skin] of Object.entries(SKIN_TABLE)) {
    for (const keyword of skin.titles ?? []) {
      if (hay.includes(keyword) && (!best || keyword.length > best.len)) {
        best = { id, len: keyword.length };
      }
    }
  }
  return best ? best.id : null;
}

/**
 * Resolve a configured `nightTheme` to the skin actually applied.
 *
 * @param {string} nightTheme The config value ('none' | 'auto' | a skin id).
 * @param {Date} [date]
 * @param {string|null} [calendarTitle] Tonight's calendar title, when known.
 * @returns {string} A skin id, or 'none'.
 */
export function resolveSkin(nightTheme, date = new Date(), calendarTitle = null, printerSeason = null) {
  if (nightTheme === 'auto') {
    // Unified theming (#18): the printer's season broadcast (an optional
    // plaintext field on every tally) outranks our own guessing — it is the
    // operator's one explicit cross-app choice, so screens match labels.
    // A skin the broadcast can't map to falls through to the usual chain.
    return skinForPrinterSeason(printerSeason)
      ?? skinForCalendarTitle(calendarTitle)
      ?? autoSkin(date);
  }
  return SKINS.includes(nightTheme) ? nightTheme : 'none';
}

/**
 * The printer's eight label seasons, mapped onto this app's skin ids.
 * Kept total: every season the printer can broadcast lands on a real skin,
 * pinned by test against the printer's SEASON_KEYS list.
 * @type {Record<string, string>}
 */
export const PRINTER_SEASON_TO_SKIN = {
  'back-to-school': 'backtoschool',
  'fall': 'autumn',
  'thanksgiving': 'thanksgiving',
  'christmas': 'christmas',
  'winter': 'snowday',
  'spring': 'spring',
  'easter': 'easter',
  'vbs-summer': 'vbs',
};

/**
 * @param {string|null|undefined} season
 * @returns {string|null}
 */
export function skinForPrinterSeason(season) {
  if (!season || typeof season !== 'string') return null;
  return PRINTER_SEASON_TO_SKIN[season] ?? null;
}

/**
 * The scene theme a skin should paint behind everything.
 *
 * Returns null for 'none' so the caller keeps its own default rather than
 * having one imposed here.
 *
 * @param {string} skin
 * @returns {string|null} A CatalogScene THEMES key.
 */
export function sceneForSkin(skin) {
  return SKIN_TABLE[skin]?.scene ?? null;
}

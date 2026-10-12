// @ts-check
// The ONE Season control (docs/SETTINGS-OVERHAUL.md 2.4): a single select that
// used to exist twice (Look & season, and Laptop → Club night → Screen season).
// Two writes, no wire change:
//   shared settings (SHARED_SPEC) `nightTheme` + `followPrinterTheme`
//   church settings `seasonTheme` (what the label tally's `season` says)
// The select's value is derived from `nightTheme` alone.

import { PRINTER_SEASON_TO_SKIN, SKIN_TABLE, autoSkin, resolveSkin, skinForCalendarTitle, skinOptions } from './skins.js';

/** The church-document half for a pinned skin: the printer season that dresses to it, else 'off'. @type {Record<string, string>} */
const SKIN_TO_PRINTER_SEASON = Object.fromEntries(Object.entries(PRINTER_SEASON_TO_SKIN).map(([season, skin]) => [skin, season]));

/** The options of the one select, in order: Auto, None, then every skin in SKIN_TABLE. */
export function seasonOptions() {
  return [
    { value: 'auto', label: 'Auto (follow the calendar)' },
    { value: 'none', label: 'None (classic)' },
    ...skinOptions().filter((o) => o.value !== 'none' && o.value !== 'auto'),
  ];
}

/** @param {unknown} nightTheme @returns {string} a value of the select */
export function seasonChoice(nightTheme) {
  if (nightTheme === 'auto') return 'auto';
  if (typeof nightTheme === 'string' && nightTheme in SKIN_TABLE) return nightTheme;
  return 'none';
}

/**
 * The two halves of one press.
 * @param {string} choice a value of the select
 * @returns {{ shared: Record<string, unknown>, church: { seasonTheme: string } }}
 */
export function seasonWrites(choice) {
  if (choice === 'auto') return { shared: { nightTheme: 'auto', followPrinterTheme: true }, church: { seasonTheme: 'auto' } };
  if (choice === 'none') return { shared: { nightTheme: 'none' }, church: { seasonTheme: 'off' } };
  return { shared: { nightTheme: choice }, church: { seasonTheme: SKIN_TO_PRINTER_SEASON[choice] || 'off' } };
}

/**
 * "Tonight: Autumn (from the month)".
 * @param {unknown} nightTheme @param {string} today YYYY-MM-DD @param {string | null} [tonightTitle]
 */
export function seasonLine(nightTheme, today, tonightTitle = null) {
  const date = new Date(`${today}T12:00:00`);
  const skin = resolveSkin(String(nightTheme), date, tonightTitle);
  const name = skin === 'none' ? 'the classic look' : (SKIN_TABLE[skin]?.label || skin);
  let why = 'you picked it';
  if (nightTheme === 'auto') why = skinForCalendarTitle(tonightTitle) ? 'from tonight’s calendar title' : skin === autoSkin(date) ? 'from the month' : 'from the label printer’s season';
  if (nightTheme === 'none') why = 'no season is dressing the screens';
  return `Tonight: ${name} (${why})`;
}

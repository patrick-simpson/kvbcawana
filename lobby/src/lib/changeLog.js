// @ts-check
// The change log's words (routes.md 10.5): one entry in, a plain-English line
// out. Values come only from allowlists on the Worker, so showing a key name
// here shows nothing about a child; this file still never prints a value it
// does not know how to say (a `before` / `after` is summarised by its keys).

/** @typedef {{ seq: number, at: string | number, device?: { kind?: string, id?: string, name?: string }, what: string, target?: string,
 *   keys?: string[], before?: Record<string, unknown> | null, after?: Record<string, unknown> | null, undoable?: boolean,
 *   undoOf?: number, undoneBy?: number }} Entry */

/** The kinds the filter offers (the Worker's `what` words, grouped). */
export const CHANGE_KINDS = [
  { id: 'all', label: 'Everything', whats: null },
  { id: 'settings', label: 'Settings', whats: ['shared', 'church', 'screen', 'screen-name', 'screen-forget'] },
  { id: 'switch', label: 'Switches', whats: ['switch'] },
  { id: 'notice', label: 'Notices', whats: ['notice'] },
  { id: 'content', label: 'Slides and templates', whats: ['slides', 'template', 'journey'] },
  { id: 'account', label: 'Account and printing computers', whats: ['passphrase', 'station'] },
];

const WHAT_WORDS = /** @type {Record<string, string>} */ ({
  shared: 'church-wide screen settings',
  church: 'printing settings',
  switch: 'a switch',
  notice: 'the notice',
  screen: 'a screen’s own settings',
  'screen-name': 'a screen’s name',
  'screen-forget': 'a screen (removed)',
  slides: 'the published slides',
  template: 'the new-screen template',
  journey: 'the Journey lesson',
  passphrase: 'the passphrase',
  station: 'a printing computer',
});

const SWITCH_WORDS = /** @type {Record<string, string>} */ ({
  CLOUD_PRINT: 'Print TwoTimTwo-page check-ins',
  SINGLE_PUBLISHER: 'The service runs the count and pickup list',
  YM_CHECKOUT: 'Automatic Trek and Journey check-out',
  CHURCH_SETTINGS: 'Printing settings from the settings page',
  NOTICES: 'Notices',
  CHANGE_LOG: 'The change log',
});

/** "standardDisplayMs" → "standard display ms". @param {string} key */
export function keyWords(key) {
  return String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

/** @param {string | number} at @param {number} [now] */
export function whenWords(at, now = Date.now()) {
  const t = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const sameDay = d.toDateString() === new Date(now).toDateString();
  return d.toLocaleString([], sameDay ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/**
 * @param {Entry} e
 * @returns {{ who: string, what: string, detail: string, undone: boolean, isUndo: boolean }}
 */
export function describeChange(e) {
  const who = e.device?.name || 'An unknown device';
  let what = WHAT_WORDS[e.what] || e.what;
  if (e.what === 'switch' && e.target) what = `the switch “${SWITCH_WORDS[e.target] || e.target}”`;
  const keys = Array.isArray(e.keys) ? e.keys.slice(0, 6).map(keyWords) : [];
  const more = Array.isArray(e.keys) && e.keys.length > 6 ? `, and ${e.keys.length - 6} more` : '';
  let detail = keys.length ? `${keys.join(', ')}${more}` : '';
  if (e.what === 'switch' && e.after && typeof e.after === 'object') {
    const v = Object.values(e.after)[0];
    if (v === 'on' || v === 'off') detail = `now ${v}`;
  }
  if (e.what === 'notice') detail = e.after ? 'sent' : 'taken down';
  return { who, what, detail, undone: e.undoneBy != null, isUndo: e.undoOf != null };
}

/**
 * @param {Entry[]} entries @param {string} kind a CHANGE_KINDS id
 */
export function filterChanges(entries, kind) {
  const k = CHANGE_KINDS.find((x) => x.id === kind);
  if (!k || !k.whats) return entries;
  const whats = k.whats;
  return entries.filter((e) => whats.includes(e.what));
}

/** Can the Undo button be offered? @param {Entry} e */
export function canUndo(e) {
  return e.undoable === true && e.undoneBy == null && e.undoOf == null;
}

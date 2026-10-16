// @ts-check
// THE definition of "who is here tonight" (ROADMAP.md#online-check-in, P5): ONE
// source, imported by the sync Worker (worker/src/tonight.js) and run by
// the print server through a generated CommonJS copy
// (printer/print-server/tonight.js, scripts/shared-copies.mjs). It is the pure
// core of what used to be print-server/server.js's authoritativeTonight() and
// tonightHereNow(), moved here unchanged in behaviour, so the two publishers
// can never disagree about a count: there is no port and no parity copy.
//
// Self-contained on purpose (no imports; `export const` / `export function`
// only), because the print server's copy is made mechanically. Everything the
// rules need from the outside is passed IN, never read from a global:
//   - the day rule (`dayOf(ms)` -> 'YYYY-MM-DD' in the church's local time:
//     the printer's machine clock, the Worker's America/New_York),
//   - the night's rows, the last APPLIED report and the checked-out marks.
//
// THE RULES (each one came from a bug; CLAUDE.md "Tonight's count"):
//   * a report is the floor while it is fresh (REPORT_FRESH_MS) and from tonight;
//     otherwise the night's own rows are the count (`source: 'history'`);
//   * ONLY an applied report is ever passed in: a PARTIAL one (fewer children
//     parsed than its own Count: footers, `reportIsPartial`) or one the
//     mass-undo guard refused (`massUndoRefused`: more than half the room gone
//     in one pass) is the caller's to drop BEFORE it reaches this module;
//   * a person's removal (`undone` with `undoneBy`) beats the report;
//   * unregistered visitors do not count while a report is fresh;
//   * one child is never two: identities match on the clubber id AND the name,
//     but two different ids are two children whatever the names say;
//   * checked out tonight (by id, or by name for an id-less child) is off every
//     count, report or history.

/** Two 5-minute extension polls plus slack (the Worker reads about every 10 s; still inside it). */
export const REPORT_FRESH_MS = 12 * 60 * 1000;

/** @param {unknown} name */
/**
 * A child's name as "First Last". TwoTimTwo's "Sort by: Last Name" shows
 * "Simpson, Micah" (owner 2026-10-15: on BARF night labels printed again,
 * "Last, First", because the name did not match the one already printed).
 * "Smith, Jr." stays as it is. The extension's firstLast() keeps the same rule.
 * @param {unknown} text
 */
export function firstLast(text) {
  const s = String(text == null ? '' : text).trim().replace(/\s+/g, ' ');
  const m = /^([^,]+),\s*([^,]+)$/.exec(s);
  if (!m || /^(jr|sr|ii|iii|iv|v)\.?$/i.test(m[2].trim())) return s;
  return `${m[2].trim()} ${m[1].trim()}`;
}

export const normalizedName = (name) => firstLast(name).toLowerCase();

/**
 * The club name as it should be displayed, from whichever side supplied it.
 * `&amp;` is decoded because the report's club comes out of a crest's alt
 * attribute and a raw entity would make T&T a club of its own.
 * @param {unknown} raw
 */
export const displayClub = (raw) => String(raw == null ? '' : raw).replace(/&amp;/gi, '&').trim();

/**
 * Splits a free-typed "First Last" into its parts; everything after the first
 * token is the last name (middle names, suffixes and hyphenated pairs stay put).
 * @param {unknown} name
 */
export function splitFullName(name) {
  const parts = firstLast(name).split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '' };
}

/**
 * The dedup key for "one row per child" aggregations. Prefers the id so two
 * same-named children stay two children; falls back to the name.
 * @param {any} row
 */
export function historyIdentityKey(row) {
  const id = row && row.clubberId != null ? String(row.clubberId).trim() : '';
  if (id) return `id:${id}`;
  return `name:${`${(row && row.firstName) || ''} ${(row && row.lastName) || ''}`.toLowerCase().trim()}`;
}

/**
 * Same identity key, computed from a checkin_report entry ({ clubberId, name,
 * club }) instead of a history row, so the two can be compared directly.
 * Whitespace is collapsed (not just trimmed): the report's name sits between
 * two links in TwoTimTwo's own markup and can come back with padding.
 * @param {any} entry
 */
export function reportEntryIdentityKey(entry) {
  const id = entry && entry.clubberId != null ? String(entry.clubberId).trim() : '';
  if (id) return `id:${id}`;
  const name = String((entry && entry.name) || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `name:${name}`;
}

/**
 * EVERY key one identity could be filed under, id first. historyIdentityKey()
 * answers with the single canonical key; this answers with all of them, which
 * is what lets a report entry (always id-bearing) find a walk-in's name row.
 * @param {any} row
 * @returns {string[]}
 */
export function identityKeysOfRow(row) {
  const keys = [];
  const id = row && row.clubberId != null ? String(row.clubberId).trim() : '';
  if (id) keys.push(`id:${id}`);
  const name = normalizedName(`${(row && row.firstName) || ''} ${(row && row.lastName) || ''}`);
  if (name) keys.push(`name:${name}`);
  return keys;
}

/** @param {any} entry @returns {string[]} */
export function identityKeysOfReportEntry(entry) {
  const keys = [];
  const id = entry && entry.clubberId != null ? String(entry.clubberId).trim() : '';
  if (id) keys.push(`id:${id}`);
  const name = normalizedName(entry && entry.name);
  if (name) keys.push(`name:${name}`);
  return keys;
}

/**
 * One child per clubber id, plus one per id-less name.
 * @param {any} entries
 */
export function distinctReportChildren(entries) {
  const keys = new Set();
  (Array.isArray(entries) ? entries : []).forEach((e) => {
    const id = e && e.clubberId != null ? String(e.clubberId).trim() : '';
    const name = normalizedName(e && e.name);
    if (id) keys.add(`id:${id}`); else if (name) keys.add(`name:${name}`);
  });
  return keys.size;
}

/**
 * A report whose own footers list more children than the parse found.
 * @param {any} payload {entries, declared}
 */
export function reportIsPartial(payload) {
  return Boolean(payload) && Number.isInteger(payload.declared)
    && distinctReportChildren(payload.entries) < payload.declared;
}

/**
 * The mass-undo guard: a pass that would mark MORE THAN HALF of tonight's
 * checked-in children undone is far more consistent with a broken or partial
 * scrape (wrong table, filtered view, login bounce mid-parse) than with a
 * real mass walkout, so the WHOLE pass is refused.
 * @param {number} toUndo @param {number} checkedInBefore
 */
export function massUndoRefused(toUndo, checkedInBefore) {
  return checkedInBefore > 0 && toUndo > checkedInBefore / 2;
}

/**
 * Tonight's rows out of a night's history (newest first): `entries` is every
 * successful check-in row of the day (reprints included), `active` one row per
 * child identity, newest wins, undone rows dropped, an id row preferred over a
 * name row for the same person.
 *
 * @param {any[]} history newest first
 * @param {string} today YYYY-MM-DD
 * @param {{ onDay: (timestamp: any, today: string) => boolean, isNonCheckin?: (row: any) => boolean }} rules
 * @returns {{ date: string, entries: any[], active: any[] }}
 */
export function tonightRows(history, today, rules) {
  const isNon = rules.isNonCheckin || (() => false);
  const entries = history.filter((e) => e && rules.onDay(e.timestamp, today) && e.success !== false && !isNon(e));
  const seen = new Set();
  const active = [];
  for (const e of entries) {
    if (!`${e.firstName || ''} ${e.lastName || ''}`.trim()) continue;
    // Keyed on the clubber id when the row has one, so two children who share a
    // name count as two. Older rows without an id keep the name key.
    const key = historyIdentityKey(e);
    // The FIRST row seen per identity is the newest. Marking `seen` BEFORE the
    // undone check stops an older duplicate row from reviving a status the
    // newest row has already settled: "latest record wins", deterministically.
    if (seen.has(key)) continue;
    seen.add(key);
    if (e.undone) continue;
    active.push(e);
  }
  // Two keys, one child: the same kid can leave BOTH an `id:` row and a `name:`
  // row on one night. Collapse them, preferring the `id:` row.
  const fullNameOf = (/** @type {any} */ e) => `${e.firstName || ''} ${e.lastName || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
  const namesWithAnId = new Set();
  for (const e of active) {
    if (historyIdentityKey(e).startsWith('id:')) namesWithAnId.add(fullNameOf(e));
  }
  const deduped = namesWithAnId.size
    ? active.filter((e) => historyIdentityKey(e).startsWith('id:') || !namesWithAnId.has(fullNameOf(e)))
    : active;
  return { date: today, entries, active: deduped };
}

/**
 * @typedef {{ date: string, entries: any[], active: any[] }} TonightRows
 * @typedef {{ at: number, entries: any[] }} AppliedReport
 * @typedef {{ date: string|null, ids: Set<string>, names?: Set<string> }} CheckedOut
 * @typedef {{ tonight: TonightRows, report: AppliedReport|null, checkedOut: CheckedOut,
 *   dayOf: (ms: number) => string }} TonightState
 */

/**
 * WHO is here now tonight: one entry per child, by the rules of the count
 * (above). authoritativeTonight() counts these; the still-here list names them.
 * A report entry may carry `firstName` (the Worker holds first names only);
 * without one the first word of its `name` is used, as the printer always did.
 *
 * @param {TonightState} state
 * @param {number} now ms
 * @returns {{source:'report'|'history', at:number|null, ageMs:number|null,
 *            children:Array<{keys:string[], club:string, firstName:string}>,
 *            checkedOut:number}}
 */
export function tonightHereNow(state, now) {
  const { tonight, report: rep, checkedOut, dayOf } = state;
  // Checked out tonight: off every count, report or history. By clubber id; a
  // child with no id can be marked by name.
  const sameNight = checkedOut.date === tonight.date;
  const outIds = sameNight ? checkedOut.ids : new Set();
  const outNames = sameNight && checkedOut.names ? checkedOut.names : new Set();
  const isOut = (/** @type {string[]} */ keys) => keys.some((k) => (k.startsWith('id:') && outIds.has(k.slice(3)))
    || (k.startsWith('name:') && outNames.has(k.slice(5))));
  const fromHistory = () => {
    /** @type {{keys: string[], club: string, firstName: string}[]} */
    const children = [];
    let out = 0;
    tonight.active.forEach((e) => {
      const keys = identityKeysOfRow(e);
      if (isOut(keys)) { out += 1; return; }
      children.push({ keys, club: displayClub(e.clubName), firstName: String(e.firstName || '').trim() });
    });
    return { source: /** @type {const} */ ('history'), at: null, ageMs: null, children, checkedOut: out };
  };

  if (!rep) return fromHistory();
  const ageMs = now - rep.at;
  // A report from the future (a clock jump) is not fresh, it is broken.
  if (ageMs < 0 || ageMs > REPORT_FRESH_MS) return fromHistory();
  if (dayOf(rep.at) !== tonight.date) return fromHistory();

  // Identities a PERSON took off tonight, and the club (and first name) each
  // identity's rows were printed under. Both read the newest row per
  // identity, the same row every other consumer treats as current.
  const suppressed = new Set();
  const clubByKey = new Map();
  const firstByKey = new Map();
  const seen = new Set();
  for (const e of tonight.entries) {
    if (!`${e.firstName || ''} ${e.lastName || ''}`.trim()) continue;
    const canonical = historyIdentityKey(e);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const keys = identityKeysOfRow(e);
    const club = displayClub(e.clubName);
    const first = String(e.firstName || '').trim();
    keys.forEach((k) => {
      if (club && !clubByKey.has(k)) clubByKey.set(k, club);
      if (first && !firstByKey.has(k)) firstByKey.set(k, first);
      if (e.undone && e.undoneBy) suppressed.add(k);
    });
  }

  /** @type {Map<string, {keys: Set<string>, club: string, firstName: string}>} */
  const byKey = new Map();
  /** @type {{keys: Set<string>, club: string, firstName: string}[]} */
  const slots = [];
  const left = new Set();
  const add = (/** @type {string[]} */ keys, /** @type {string} */ club, /** @type {string} */ firstName) => {
    if (!keys.length) return;
    if (keys.some((k) => suppressed.has(k))) return;
    if (isOut(keys)) { left.add(keys.find((k) => k.startsWith('id:')) || keys[0]); return; }
    // Two different TwoTimTwo ids are two different children, whatever their
    // names say: a name match only joins an entry to a slot that has no id, or
    // the same one. (A shared bogus "name" merged every child with the same
    // report summary into one: 11 checked in read as 2, 2026-10-07.)
    const id = keys.find((k) => k.startsWith('id:'));
    /** @type {{keys: Set<string>, club: string, firstName: string}|null} */
    let slot = null;
    for (const k of keys) {
      const hit = byKey.get(k);
      if (!hit) continue;
      const hitId = [...hit.keys].find((x) => x.startsWith('id:'));
      if (id && hitId && hitId !== id) continue;
      slot = hit;
      break;
    }
    if (!slot) { slot = { keys: new Set(), club: '', firstName: '' }; slots.push(slot); }
    if (!slot.club && club) slot.club = club;
    if (!slot.firstName && firstName) slot.firstName = firstName;
    keys.forEach((k) => { /** @type {any} */ (slot).keys.add(k); byKey.set(k, /** @type {any} */ (slot)); });
  };

  // The report is the floor.
  (Array.isArray(rep.entries) ? rep.entries : []).forEach((entry) => {
    const first = entry && typeof entry.firstName === 'string' && entry.firstName.trim()
      ? entry.firstName.trim() : splitFullName(entry && entry.name).firstName;
    add(identityKeysOfReportEntry(entry), displayClub(entry && entry.club), first);
  });
  // Plus everyone who checked in since it was taken. Visitors excluded: they
  // have no TwoTimTwo record, so the next report would silently drop them and
  // the count would go backwards on screen.
  tonight.active.forEach((row) => {
    if (row.visitor) return;
    const at = Date.parse(row.timestamp);
    if (!Number.isFinite(at) || at <= rep.at) return;
    add(identityKeysOfRow(row), displayClub(row.clubName), String(row.firstName || '').trim());
  });

  const children = slots.map((slot) => {
    let club = slot.club;
    let firstName = '';
    for (const k of slot.keys) {
      if (!club && clubByKey.has(k)) club = clubByKey.get(k);
      // The name this printer printed beats the report's first word ("Mary
      // Kate" prints as Mary Kate; the report's split would say Mary).
      if (!firstName && firstByKey.has(k)) firstName = firstByKey.get(k);
    }
    return { keys: [...slot.keys], club: club || '', firstName: firstName || slot.firstName };
  });

  return { source: /** @type {const} */ ('report'), at: rep.at, ageMs, children, checkedOut: left.size };
}

/**
 * THE one function every surface asks "how many children are here tonight".
 * Pure, so both modes are unit-tested without a socket, a scrape or a clock.
 *
 * @param {TonightState} state
 * @param {number} now ms
 * @returns {{source:'report'|'history', at:number|null, ageMs:number|null,
 *            checkedIn:number, checkedOut:number, byClub:Record<string, number>}}
 */
export function authoritativeTonight(state, now) {
  const here = tonightHereNow(state, now);
  /** @type {Record<string, number>} */
  const byClub = {};
  here.children.forEach((c) => {
    const name = c.club || 'No club';
    byClub[name] = (byClub[name] || 0) + 1;
  });
  return { source: here.source, at: here.at, ageMs: here.ageMs, checkedIn: here.children.length, checkedOut: here.checkedOut, byClub };
}

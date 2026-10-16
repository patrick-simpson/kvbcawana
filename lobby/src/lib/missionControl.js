// @ts-check
// Mission control's pure half (docs/SETTINGS-OVERHAUL.md section 5): the
// settings page's Tonight card. Two inputs, and nothing else:
//   - the Worker's overview (GET /v1/tonight/overview, polled): counts, codes,
//     times and station names, never a child;
//   - the live channel's check-in frames, decrypted in THIS browser by
//     useSocket and already reduced by sanitizeCheckin / sanitizeRecap.
//
// PRIVACY (CLAUDE.md "Privacy invariant"): the check-in ring keeps a
// first name, a club, a time and an id, for five children at most, in React
// state only. It is never stored, never sent anywhere, and `clear` empties it
// (sign-out, and the page hidden for MISSION_HIDDEN_CLEAR_MS). The reducer
// copies fields by name, so a payload that somehow carried more could not
// leak it through here.

/** How many recent check-ins mission control shows. */
export const MISSION_RING = 5;
/** The page forgets the ring after being hidden this long. */
export const MISSION_HIDDEN_CLEAR_MS = 30 * 60 * 1000;
/** A station that has not applied the church settings after this long is called out. */
export const CHURCH_APPLY_GRACE_MS = 2 * 60 * 1000;
/** No station heartbeat in this long, with the watch window open, is a problem. */
export const STATION_GONE_MS = 2 * 60 * 1000;

/**
 * @typedef {{ id: string, firstName: string, club: string, at: number, oneOff: boolean }} Seen
 * @typedef {{ recent: Seen[], tally: { counts: Record<string, number>, total: number, at: number } | null }} MissionState
 */

/** @returns {MissionState} */
export function initialMission() { return { recent: [], tally: null }; }

/** @param {unknown} x @returns {Seen | null} */
function seenFrom(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = /** @type {Record<string, unknown>} */ (x);
  if (typeof o.firstName !== 'string' || !o.firstName) return null;
  const at = typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : Date.now();
  const club = typeof o.club === 'string' ? o.club : '';
  const id = typeof o.id === 'string' && o.id ? o.id : `${o.firstName}|${club}|${at}`;
  return { id, firstName: o.firstName, club, at, oneOff: o.oneOff === true };
}

/** @param {Seen[]} list @param {Seen[]} add */
function merge(list, add) {
  const byId = new Map(list.map((s) => [s.id, s]));
  for (const s of add) if (!byId.has(s.id)) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => b.at - a.at).slice(0, MISSION_RING);
}

/**
 * @param {MissionState} state
 * @param {{ type: 'checkin' | 'recap' | 'tally' | 'clear', payload?: any }} action
 * @returns {MissionState}
 */
export function reduceMission(state, action) {
  switch (action.type) {
    case 'checkin': {
      const s = seenFrom(action.payload);
      return s ? { ...state, recent: merge(state.recent, [s]) } : state;
    }
    case 'recap': {
      const entries = Array.isArray(action.payload?.entries) ? action.payload.entries : [];
      const add = entries.map(seenFrom).filter((/** @type {Seen | null} */ s) => s !== null);
      return add.length ? { ...state, recent: merge(state.recent, add) } : state;
    }
    case 'tally': {
      const p = action.payload;
      if (!p || typeof p.at !== 'number' || !p.counts || typeof p.counts !== 'object') return state;
      if (state.tally && state.tally.at > p.at) return state;
      /** @type {Record<string, number>} */
      const counts = {};
      for (const [club, n] of Object.entries(p.counts)) if (typeof n === 'number' && Number.isFinite(n)) counts[club] = n;
      const total = typeof p.total === 'number' ? p.total : Object.values(counts).reduce((a, b) => a + b, 0);
      return { ...state, tally: { counts, total, at: p.at } };
    }
    case 'clear':
      return initialMission();
    default:
      return state;
  }
}

/** @param {unknown} at ISO string or epoch ms @returns {number | null} */
export function atMs(at) {
  if (typeof at === 'number' && Number.isFinite(at)) return at;
  if (typeof at === 'string') { const t = Date.parse(at); return Number.isFinite(t) ? t : null; }
  return null;
}

/**
 * The running count: the overview's authoritative one, ticked between polls by
 * the live `tally` frame, whichever is newer.
 * @param {any} overview @param {MissionState['tally']} tally
 * @returns {{ total: number, byClub: Record<string, number>, source: string, reportAgeMs: number | null } | null}
 */
export function runningCount(overview, tally) {
  const c = overview?.count;
  const ovAt = atMs(overview?.at);
  if (tally && (!c || (ovAt !== null && tally.at > ovAt))) {
    return { total: tally.total, byClub: tally.counts, source: 'live tally', reportAgeMs: Math.max(0, Date.now() - tally.at) };
  }
  if (!c) return null;
  const byClub = c.byClub && typeof c.byClub === 'object' ? c.byClub : {};
  const total = Number.isFinite(c.checkedIn) ? c.checkedIn : Object.values(byClub).reduce((a, b) => a + (Number(b) || 0), 0);
  return { total, byClub, source: String(c.source || ''), reportAgeMs: Number.isFinite(c.reportAgeMs) ? c.reportAgeMs : null };
}

/**
 * Everything the overview says is wrong, in plain words. Pure.
 * @param {any} overview
 * @param {number} [now]
 * @returns {{ id: string, text: string, tone: 'bad' | 'warn' }[]}
 */
export function alertsFrom(overview, now = Date.now()) {
  if (!overview || typeof overview !== 'object') return [];
  /** @type {{ id: string, text: string, tone: 'bad' | 'warn' }[]} */
  const out = [];
  const print = overview.print || {};
  /** @type {any[]} */
  const stations = Array.isArray(print.stations) ? print.stations : [];
  const checks = Array.isArray(print.checkThePrinter) ? print.checkThePrinter.length : Number(print.checkThePrinter) || 0;
  if (checks > 0) out.push({ id: 'check-printer', tone: 'bad', text: `CHECK THE PRINTER: ${checks} label${checks === 1 ? '' : 's'} may not have come out. Look at it, then press “I looked at it” on the check-in laptop.` });
  /** @type {number[]} */
  const seen = stations.map((/** @type {any} */ s) => atMs(s.lastSeenAt)).filter((/** @type {number | null} */ t) => t !== null);
  if (overview.window?.open && !seen.some((t) => now - t <= STATION_GONE_MS)) {
    out.push({ id: 'no-station', tone: 'bad', text: 'No printing computer has been heard from in 2 minutes, and check-in is open. Is the check-in laptop on, with KVBC Awana running?' });
  }
  const read = overview.read || {};
  if (read.loginBlockedForSec > 0) out.push({ id: 'ttt-blocked', tone: 'bad', text: `TwoTimTwo refused the sign-in, so the service is waiting ${Math.max(1, Math.ceil(read.loginBlockedForSec / 60))} min before it tries again.` });
  else if (read.lastError && !oldReadError(read, now)) out.push({ id: 'ttt-error', tone: 'warn', text: `The last read of TwoTimTwo failed: ${readErrorWords(read.lastError)}.` });
  if (print.dead > 0) out.push({ id: 'dead-jobs', tone: 'bad', text: `${print.dead} label${print.dead === 1 ? '' : 's'} could not be printed after several tries.` });
  const ym = overview.ym;
  if (ym && (ym.failed > 0 || ym.gaveUp > 0)) out.push({ id: 'ym', tone: 'warn', text: `Trek and Journey check-out: ${(ym.failed || 0) + (ym.gaveUp || 0)} did not go through.` });
  // Award slips the Worker only marks while a station still on an old app prints its own (stationfeeds.js hand-over).
  const feeds = overview.feeds;
  const oldOnes = feeds && Array.isArray(feeds.oldStations) ? feeds.oldStations.map((/** @type {any} */ s) => String(s?.name || 'unnamed')) : [];
  if (feeds && feeds.slipsHeld > 0 && oldOnes.length) {
    const who = oldOnes.length === 1 ? `station ${oldOnes[0]} is` : `stations ${oldOnes.join(', ')} are`;
    out.push({ id: 'slips-held', tone: 'warn', text: `Award slips are waiting: ${who} on an old app. Its Chrome extension prints them; update it to KVBC Awana 10.0.0 so the service prints them.` });
  }
  if (overview.history?.pending > 0) out.push({ id: 'history', tone: 'warn', text: `${overview.history.pending} saved-history batch${overview.history.pending === 1 ? ' is' : 'es are'} still waiting to be stored.` });
  const church = overview.church;
  const savedAt = atMs(church?.savedAt);
  if (church && church.rev > 0 && savedAt !== null && now - savedAt > CHURCH_APPLY_GRACE_MS) {
    const behind = stations.filter((/** @type {any} */ s) => Number.isFinite(s.churchRev) && s.churchRev < church.rev);
    if (behind.length) out.push({ id: 'church-behind', tone: 'warn', text: `${behind.map((/** @type {any} */ s) => s.name).join(', ')} has not picked up the latest printing settings yet.` });
  }
  return out;
}

/** "3 min ago" style age for a time. @param {unknown} at @param {number} [now] */
export function agoWords(at, now = Date.now()) {
  const t = atMs(at);
  if (t === null) return 'never';
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** "in 12 min" style time left until a moment. @param {unknown} at @param {number} [now] */
export function untilWords(at, now = Date.now()) {
  const t = atMs(at);
  if (t === null) return 'later';
  const min = Math.round((t - now) / 60000);
  if (min <= 0) return 'now';
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `in ${h} h${m ? ` ${m} min` : ''}`;
}

/** A failed read older than this is an earlier night's, told as history, never as a problem now. */
export const READ_ERROR_OLD_MS = 12 * 60 * 60 * 1000;

/** The Worker's read error codes in a few plain words (the full sentences: syncService.js). */
const READ_ERROR_WORDS = {
  'report-unreadable': 'the report page did not look like the report',
  'signed-out': 'TwoTimTwo would not show the report',
  'login-refused': 'TwoTimTwo refused the sign-in',
  'twotimtwo-down': 'TwoTimTwo was not answering properly',
  timeout: 'TwoTimTwo took too long to answer',
  network: 'TwoTimTwo could not be reached',
  'off-site-redirect': 'TwoTimTwo sent the service to another website',
};

/** @param {unknown} code */
function readErrorWords(code) {
  return READ_ERROR_WORDS[/** @type {keyof typeof READ_ERROR_WORDS} */ (String(code))] || String(code).slice(0, 40);
}

/** Is the last read's failure from an earlier night? @param {any} read @param {number} now */
function oldReadError(read, now) {
  const t = atMs(read.lastReadAt);
  return t !== null && now - t > READ_ERROR_OLD_MS;
}

/** The TwoTimTwo read as one word and a line. @param {any} read @param {number} [now] */
export function readWords(read, now = Date.now()) {
  if (!read || !read.configured) return { tone: 'warn', text: 'Not set up: the service has no TwoTimTwo user yet.' };
  if (read.loginBlockedForSec > 0) return { tone: 'bad', text: 'Blocked: TwoTimTwo refused the sign-in.' };
  if (read.lastError && oldReadError(read, now)) {
    return { tone: 'ok', text: `No read since ${agoWords(read.lastReadAt, now)} (that one failed: ${readErrorWords(read.lastError)}). It reads again on the next club night.` };
  }
  if (read.lastError) return { tone: 'warn', text: `The read ${agoWords(read.lastReadAt, now)} failed: ${readErrorWords(read.lastError)}.` };
  if (!read.signedIn) return { tone: 'warn', text: 'Signed out of TwoTimTwo.' };
  return { tone: 'ok', text: read.lastOkAt ? `OK, read ${agoWords(read.lastOkAt)}` : 'Signed in, no read yet.' };
}

/** The youth check-out line. @param {any} ym */
export function ymWords(ym) {
  if (!ym) return null;
  if (!ym.enabled) return 'Off (switch it on under Online check-in).';
  const bits = [`${ym.checkedOut || 0} checked out`];
  if (ym.pending > 0) bits.push(`${ym.pending} pending`);
  if (ym.failed > 0 || ym.gaveUp > 0) bits.push(`${(ym.failed || 0) + (ym.gaveUp || 0)} failed`);
  return bits.join(', ');
}

/** The overview poll's pace: 10 s open and visible, 60 s otherwise; it stops after 3 failures in a row. */
export const OVERVIEW_POLL_MS = 10_000;
export const OVERVIEW_SLOW_POLL_MS = 60_000;
export const OVERVIEW_MAX_FAILURES = 3;

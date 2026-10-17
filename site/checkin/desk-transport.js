// The check-in page's transport (awana.kvbchurch.org/checkin, the page is
// printer/print-server/public/phone.html): everything that talks to the sync
// Worker's desk routes, and everything that seals, in ONE small module
// (ROADMAP.md#online-check-in; it was the /desk page's). No DOM and no globals:
// the page hands it `fetch`, a storage object and the cloud-crypto module
// (shared/cloud-crypto.js, the canonical copy), so Node tests run it as it
// is. The routes are worker/src/routes.md; when the Worker's contract
// moves, this is the only file that follows.
//
// THE RULES it keeps (routes.md "Rules every route keeps"):
//   - Free-CPU. Every key derivation and every seal is HERE, in the browser:
//     the passphrase becomes an authKey (passphrase v2) and is never sent once
//     the Worker is on v2, never stored; the print job is sealed to the
//     registered stations (sealForStations) and the history row to the history
//     key (sealRow) before anything is posted. The Worker validates and stores.
//   - Names go to the Worker in clear only inside the check-in the Worker must
//     post to TwoTimTwo (the clubber id; a visitor's name, which it hashes), and
//     a Brought-a-friend friend's FIRST name for the 6:30 BARF list (friends.js,
//     what the phone path always sent). The sealed job and the sealed row carry
//     the rest.
//   - Fail closed. No history key, or a seal that cannot be made, posts NOTHING.
//   - The Worker's read clock (one TwoTimTwo read every 15 s, every reader
//     combined, while the laptop's extension tab still reads; a roster request
//     queues up to 20 s for its turn, and a check-in, undo or check-out reads
//     nothing once the Worker holds tonight's check-in page). A 429 is a
//     DeskError 'busy' with `retryAfterMs`; the page shows "busy, try again in
//     Ns" and does not hammer. The roster and families answers carry
//     `familiesAt` (when the Worker's household list was read): a page that
//     sees it move asks for the families again.
//   - A stations-changed 409 (a station registered or left while we sealed) is
//     answered by resealing to the list the Worker sends back, up to RESEAL_MAX.

/** Where the Worker lives on this site. */
export const DESK_API = '/api';
/** The sync session's slot: the screens' and /settings' own (lobby/src/lib/syncService.js). */
export const SESSION_STORAGE = 'awanaSyncSession.v1';
/** This device's pinned, passphrase-verified history key {pub, kid}: a Worker that swaps it is refused. */
export const HISTORY_PIN_STORAGE = 'awanaDeskHistoryKey.v1';
/** A stations-changed answer is resealed at most this many times. */
export const RESEAL_MAX = 3;
/** The most remembered leaders (church settings `leaders`, shared/churchSettings.js). */
export const LEADERS_MAX = 80;
/**
 * A read waits this long before the page gives up and asks again. The Worker
 * queues a roster request up to 20 s for its turn, and after a Worker restart
 * its first read is a fresh TwoTimTwo sign-in, about 45 s of spaced reads on
 * the one read clock: 30 s abandoned it every time (owner 2026-10-13).
 */
export const READ_TIMEOUT_MS = 60 * 1000;
/** A station not heard from for this long means "check the printer". */
export const STATION_QUIET_MS = 2 * 60 * 1000;

const SESSION_RE = /^v1\.\d+\.\d+\.[A-Za-z0-9_-]{20,}$/;

/**
 * Every failure the page words, as one error with a fixed `code`:
 * 'wrong' 'locked' 'unreachable' 'signed-out' 'busy' 'no-history' 'history-mismatch'
 * 'unsealed' 'no-station' 'wrong-night' 'no-club' 'unsure' 'refused' 'hiccup' 'http'.
 * 'hiccup' is a 500/502/503 that is not one of the Worker's own refusals (no
 * `reason`: a restart, a crash, the edge): nothing the Worker decided, so the page
 * may send a check-in again (the claim makes that safe, routes.md 5).
 */
export class DeskError extends Error {
  /** @param {string} code @param {string} message @param {Record<string, any>} [extra] */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'DeskError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/** The Worker's reasons for a refusal, in words a volunteer can act on. @param {string} reason */
export function refusalWords(reason) {
  switch (reason) {
    case 'not-found': return 'TwoTimTwo does not list that child tonight.';
    case 'no-attendance-item': return 'TwoTimTwo has no attendance item for that club tonight.';
    case 'superseded': return 'Someone else checked that child in a moment ago.';
    case 'not-configured': return 'The check-in service is not set up to read TwoTimTwo yet.';
    case 'twotimtwo-unreadable': return 'TwoTimTwo could not be read. Try again, or check in on TwoTimTwo itself.';
    case 'unsealed': return 'The label or the record could not be sealed, so nothing was sent.';
    case 'already-friend': return 'That child already has a friend recorded tonight.';
    case 'not-barf-night': return 'Tonight is not a BARF night.';
    case 'not-on-report': return 'TwoTimTwo does not show that child checked in yet. Try again in a moment.';
    case 'no-friend-item': return 'TwoTimTwo has no Brought a friend item for that club tonight.';
    case 'busy': return 'That child is being checked in right now. Try again in a moment.';
    case 'not-checked-in-again': return 'TwoTimTwo did not take the check-in again (after their BARF friend). Try again, or check them in on TwoTimTwo itself.';
    case 'no-club': return 'There is no club tonight.';
    default: return `TwoTimTwo or the service refused it (${reason}).`;
  }
}

/**
 * The print status in one line for the desk's footer. Pure.
 * @param {any} status GET /v1/print/status (or null before it has answered)
 * @param {number} nowMs
 * @returns {{ kind: 'ok'|'queued'|'check'|'unknown', text: string }}
 */
export function printLabel(status, nowMs) {
  if (!status || typeof status !== 'object') return { kind: 'unknown', text: 'Printer status unknown' };
  const stations = Array.isArray(status.stations) ? status.stations : [];
  if (!stations.length) return { kind: 'check', text: 'No print station is set up: check the printer computer' };
  const bad = stations.find((/** @type {any} */ s) => s && s.printer && ['offline', 'error', 'paper'].includes(s.printer.state));
  if (bad) return { kind: 'check', text: `Check the printer (${bad.printer.state === 'paper' ? 'out of labels' : bad.printer.state})` };
  if ((status.checkThePrinter || []).length) return { kind: 'check', text: 'Check the printer: a label may not have come out' };
  if (status.dead > 0) return { kind: 'check', text: 'Check the printer: a label could not print' };
  const seen = stations.map((/** @type {any} */ s) => Date.parse(s.lastSeenAt || '')).filter(Number.isFinite);
  const waiting = (status.queued || 0) + (status.leased || 0) + (status.pendingToSeal || 0);
  if (!seen.length || nowMs - Math.max(...seen) > STATION_QUIET_MS) {
    return waiting
      ? { kind: 'check', text: `Check the printer computer: ${waiting} label${waiting === 1 ? '' : 's'} waiting` }
      : { kind: 'check', text: 'The print computer has not answered lately' };
  }
  if (waiting) return { kind: 'queued', text: `${waiting} label${waiting === 1 ? '' : 's'} queued` };
  const printed = status.claims && Number.isFinite(status.claims.printed) ? status.claims.printed : status.done || 0;
  return { kind: 'ok', text: printed ? `Printed ${printed}` : 'Printer ready' };
}

/** The small line under "No club tonight": kind and tiny, one per day (the owner likes a little humour). */
export const NO_CLUB_QUIPS = Object.freeze([
  'The name tags are taking a well-earned nap.',
  'The game cones are resting up for the next one.',
  'Even the label printer gets a night off.',
  'The crayons are catching up on their sleep.',
  'The check-in desk is putting its feet up.',
]);

/**
 * A church date (YYYY-MM-DD, already the church's own day) in American words:
 * "Wednesday, October 14", with the year only when it is not `thisYear`'s. ''
 * for anything that is not a real date. Pure.
 * @param {unknown} key @param {string} [thisYear] YYYY
 */
export function dayWords(key, thisYear) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return '';
  // Noon UTC of that date reads as that same date: the key is already the church's day.
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== key) return '';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...(thisYear && thisYear !== m[1] ? { year: 'numeric' } : {}), timeZone: 'UTC' });
}

/**
 * What the page shows on a day with no club (the roster's `{noClub: true, today,
 * next}` answer, routes.md 5): a title, the next club night when the Worker knows
 * one ('' otherwise), and the day's small line. Pure.
 * @param {{ today?: unknown, next?: unknown }|null} answer
 * @returns {{ title: string, next: string, quip: string }}
 */
export function noClubWords(answer) {
  const a = answer || {};
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(a.today || '')) ? String(a.today) : '';
  const next = dayWords(a.next, today.slice(0, 4) || undefined);
  const seed = today.split('').reduce((n, c) => n + (Number(c) || 0), 0);
  return { title: 'No club tonight', next: next ? `Next club night: ${next}` : '', quip: NO_CLUB_QUIPS[seed % NO_CLUB_QUIPS.length] };
}

/**
 * @param {{ cc: any, fetch: typeof fetch, store?: { get(k: string): string|null, set(k: string, v: string): void, remove(k: string): void },
 *   base?: string, now?: () => number }} deps
 */
export function createDesk({ cc, fetch: fetchFn, store, base = DESK_API, now = Date.now }) {
  const mem = new Map();
  const kv = store || {
    get: (/** @type {string} */ k) => mem.get(k) ?? null,
    set: (/** @type {string} */ k, /** @type {string} */ v) => { mem.set(k, v); },
    remove: (/** @type {string} */ k) => { mem.delete(k); },
  };
  const read = (/** @type {string} */ k) => { try { return kv.get(k); } catch { return null; } };
  const write = (/** @type {string} */ k, /** @type {string|null} */ v) => {
    try { if (v == null) kv.remove(k); else kv.set(k, v); } catch { /* a private window: the sign-in lasts this tab */ }
  };

  /** @type {string} */
  let session = '';
  /** @type {{ pub: string, kid: string }|null} */
  let history = null;
  /** @type {{ stationId: string, name: string, kid: string, publicKey: string }[]|null} */
  let stations = null;
  /**
   * The history key's private half, opened at a passphrase sign-in: NON-extractable,
   * held in this closure's memory only (never storage; a reload or sign-out forgets
   * it). Only recentAttendance() reads with it. A restored session has none.
   * @type {{ privateKey: CryptoKey, publicKey: string, kid: string }|null}
   */
  let ring = null;

  const pinned = () => {
    try {
      const p = JSON.parse(read(HISTORY_PIN_STORAGE) || 'null');
      return p && typeof p.pub === 'string' && typeof p.kid === 'string' ? { pub: p.pub, kid: p.kid } : null;
    } catch { return null; }
  };
  const saveSession = (/** @type {string} */ s) => { session = s; write(SESSION_STORAGE, s || null); };

  /**
   * One request. Returns {status, body}; throws only DeskError for the failures
   * every call words the same way (unreachable, signed out, busy).
   * `signal`: the caller's own abort (the page gives up on a check-in nobody answered
   * for a minute, after asking the roster whether it landed); an abort is 'unreachable'
   * with `aborted: true`.
   * @param {string} method @param {string} path @param {unknown} [body] @param {{ auth?: boolean, timeoutMs?: number, signal?: AbortSignal|null }} [opts]
   * @returns {Promise<{ status: number, body: any }>}
   */
  async function request(method, path, body, opts = {}) {
    /** @type {Record<string, string>} */
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.auth !== false && session) headers.Authorization = `Bearer ${session}`;
    let res;
    // A read that never answers (a phone's connection can stall without failing)
    // gives up after READ_TIMEOUT_MS so the page asks again. Only reads: a
    // check-in that was sent must never be reported as lost on a timer.
    const timer = opts.timeoutMs && typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = timer ? setTimeout(() => timer.abort(), opts.timeoutMs) : null;
    const signal = timer ? timer.signal : opts.signal || null;
    if (opts.signal && opts.signal.aborted) throw new DeskError('unreachable', 'The check-in service did not answer in time.', { aborted: true });
    try {
      res = await fetchFn(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', ...(signal ? { signal } : {}) });
    } catch {
      if (timer && timer.signal.aborted) throw new DeskError('unreachable', 'The check-in service did not answer in time.');
      if (opts.signal && opts.signal.aborted) throw new DeskError('unreachable', 'The check-in service did not answer in time.', { aborted: true });
      throw new DeskError('unreachable', 'No internet connection to the check-in service.');
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    /** @type {any} */
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (res.status === 401 && opts.auth !== false) {
      saveSession('');
      throw new DeskError('signed-out', 'Signed out (the passphrase changed?). Type it again.');
    }
    if (res.status === 429 && opts.auth !== false) {
      const header = Number(res.headers && res.headers.get && res.headers.get('Retry-After'));
      const retryAfterMs = Number(data && data.retryAfterMs) || (Number.isFinite(header) && header > 0 ? header * 1000 : 15000);
      throw new DeskError('busy', `TwoTimTwo was just read. Try again in ${Math.max(1, Math.ceil(retryAfterMs / 1000))}s.`, { retryAfterMs });
    }
    return { status: res.status, body: data };
  }

  // ── sign-in (passphrase v2, routes.md section 1) ────────────────────────────

  /**
   * Sign in with the church passphrase. Derives authKey in the browser (the
   * passphrase is sent only for the one-time v2 upgrade routes.md allows; the
   * old passphrase-only login is gone, owner 2026-10-16), unwraps the history key to prove it is
   * ours, pins it, and keeps the session in the screens' own slot. The
   * passphrase itself is never stored.
   * @param {string} passphrase
   */
  async function signIn(passphrase) {
    const typed = cc.normalizePassphrase(passphrase);
    if (!typed) throw new DeskError('wrong', 'Type the passphrase.');
    const params = await request('GET', '/v1/auth/params', undefined, { auth: false });
    if (!(params.status === 200 && params.body && params.body.v === 2)) {
      // No v2 sign-in values (a Worker older than v2, or a failed call): there is no other sign-in, so nothing is sent.
      throw new DeskError('http', params.status === 404
        ? 'The check-in service is older than this page and cannot sign it in. Ask for the service to be updated.'
        : (params.body && params.body.error) || `The check-in service answered HTTP ${params.status}.`);
    }
    const { authKey } = await cc.deriveKeys(passphrase, params.body.salt, params.body.iter);
    const key = cc.bytesToBase64(authKey);
    // While the Worker stores no v2 verifier (`upgrade`), the first client sends the passphrase once, with its authKey.
    /** @type {{ status: number, body: any }} */
    let login = await request('POST', '/v1/login', params.body.upgrade ? { passphrase: typed, authKey: key } : { authKey: key }, { auth: false });
    if (login.status === 401 && login.body && login.body.reason === 'upgrade-needed') login = await request('POST', '/v1/login', { passphrase: typed, authKey: key }, { auth: false });
    if (login.status === 401) throw new DeskError('wrong', 'That is not the passphrase.');
    if (login.status === 429) throw new DeskError('locked', 'Too many wrong tries. Wait a little, then try again.', { retryAfterSec: Number(login.body && login.body.retryAfterSec) || 900 });
    if (login.status !== 200 || !login.body || !SESSION_RE.test(login.body.session)) {
      throw new DeskError('http', (login.body && login.body.error) || `The check-in service answered HTTP ${login.status}.`);
    }
    saveSession(login.body.session);
    stations = null;
    await settleHistory(passphrase, login.body.history);
    return { history: !!history };
  }

  /**
   * The history key: from the login answer or GET /v1/history/key; made here
   * when there is none (first writer wins). Proven by unwrapping it with the
   * passphrase, then pinned; a pub that differs from the pinned one is refused.
   * @param {string} passphrase @param {any} fromLogin
   */
  async function settleHistory(passphrase, fromLogin) {
    let key = fromLogin && fromLogin.pub ? fromLogin : null;
    if (!key) {
      const got = await request('GET', '/v1/history/key');
      key = got.status === 200 && got.body && got.body.pub ? got.body : null;
      if (!key && got.status === 404) {
        const made = await cc.createHistoryKey(passphrase);
        const put = await request('PUT', '/v1/history/key', made);
        if (put.status === 201 || put.status === 200) key = made;
        else if (put.status === 409) {
          const again = await request('GET', '/v1/history/key');
          key = again.status === 200 && again.body && again.body.pub ? again.body : null;
        }
      }
    }
    if (!key) { history = null; return; }   // a Worker with no history routes yet: check-ins stay off (fail closed)
    const pin = pinned();
    if (pin && pin.pub !== key.pub) throw new DeskError('history-mismatch', 'The history key is not the one this computer trusts. Ask the owner before checking anyone in.');
    const opened = await cc.unwrapPrivateKey(key.wrapped, passphrase, key.pub);
    if (!opened) throw new DeskError('history-mismatch', 'The history key does not open with this passphrase. Ask the owner before checking anyone in.');
    history = { pub: key.pub, kid: key.kid || (await cc.kidOf(key.pub)) };
    ring = await cc.keyRing(opened, key.pub).catch(() => null);
    write(HISTORY_PIN_STORAGE, JSON.stringify(history));
  }

  /**
   * Take up a session already in this browser (the screens', /settings'). It
   * can check in only once this device has verified the history key (a
   * passphrase sign-in did, once): 'ready', or 'need-passphrase'.
   * @returns {'ready'|'need-passphrase'}
   */
  function restore() {
    const s = String(read(SESSION_STORAGE) || '').trim();
    if (!SESSION_RE.test(s)) return 'need-passphrase';
    const pin = pinned();
    if (!pin) return 'need-passphrase';
    session = s;
    history = pin;
    return 'ready';
  }

  function signOut() { saveSession(''); history = null; stations = null; ring = null; }

  // ── reads ───────────────────────────────────────────────────────────────────

  /** @param {{ status: number, body: any }} r */
  function httpError(r) {
    const err = httpErrorOf(r);
    // An early label is out though TwoTimTwo did not take the check-in (routes.md 5,
    // "Early labels"): the page retries, and a retry never prints a second label.
    if (r.body && r.body.printed === true) err.printed = true;
    return err;
  }
  /** @param {{ status: number, body: any }} r */
  function httpErrorOf(r) {
    const reason = r.body && typeof r.body.reason === 'string' ? r.body.reason : '';
    if (r.status === 504 || reason === 'unsure') return new DeskError('unsure', 'TwoTimTwo did not answer in time. Check TwoTimTwo before trying again.');
    if (reason === 'wrong-night') return new DeskError('wrong-night', 'The service says it is a different club night than this computer thinks.', { night: r.body.night });
    // A day with no club (routes.md 5, "No club tonight"): nothing was read, claimed or posted.
    if (reason === 'no-club') return new DeskError('no-club', refusalWords('no-club'), { today: r.body.today ?? null, next: r.body.next ?? null });
    if (reason === 'unsealed') return new DeskError('unsealed', refusalWords('unsealed'), { what: r.body.what });
    // Not the Worker's own refusal (it always names a reason): a restart or a crash mid-request.
    if (!reason && (r.status === 500 || r.status === 502 || r.status === 503)) {
      return new DeskError('hiccup', 'The check-in service had a hiccup.', { status: r.status });
    }
    if (r.status === 409 || r.status === 502 || r.status === 503) return new DeskError('refused', refusalWords(reason || 'refused'), { reason });
    return new DeskError('http', (r.body && (r.body.error || r.body.reason)) || `The check-in service answered HTTP ${r.status}.`, { status: r.status });
  }
  /** @param {string} path */
  async function get(path) {
    const r = await request('GET', path, undefined, { timeoutMs: READ_TIMEOUT_MS });
    if (r.status === 200) return r.body;
    throw httpError(r);
  }

  const roster = () => get('/v1/desk/roster');
  const families = () => get('/v1/desk/families');
  const printStatus = () => get('/v1/print/status');
  /** The Worker's own tonight count (routes.md `GET /v1/desk/tonight`, P5): null until that route exists. */
  async function tonight() {
    const r = await request('GET', '/v1/desk/tonight', undefined, { timeoutMs: READ_TIMEOUT_MS });
    return r.status === 200 ? r.body : null;
  }

  /** @param {any[]} list */
  const asStations = (list) => (Array.isArray(list) ? list : []).filter((s) => s && typeof s.pub === 'string')
    .map((s) => ({ stationId: s.stationId, name: s.name, kid: s.kid, publicKey: s.pub }));
  async function loadStations(force = false) {
    if (!stations || force) stations = asStations(await get('/v1/stations'));
    return stations;
  }

  // ── sealing ─────────────────────────────────────────────────────────────────

  /**
   * One post, sealed to what is registered right now. On 409 stations-changed
   * the list the Worker sends back is the new truth: reseal and send again.
   * @param {string} path
   * @param {(stationList: any[]) => Promise<Record<string, any>>} build the body, sealing as it goes
   * @param {{ needJob?: boolean, signal?: AbortSignal|null }} [opts]
   */
  async function sealedPost(path, build, opts = {}) {
    if (!history) throw new DeskError('no-history', 'The history key is not ready, so check-ins are off. Open /settings or ask the owner.');
    let current = await loadStations();
    if (opts.needJob && !current.length) throw new DeskError('no-station', 'No print station is registered, so there is nowhere to print a name tag.');
    for (let attempt = 0; attempt <= RESEAL_MAX; attempt++) {
      const body = await build(current);
      const r = await request('POST', path, body, { signal: opts.signal || null });
      if (r.status === 409 && r.body && r.body.reason === 'stations-changed') {
        stations = asStations(r.body.stations);
        if (!stations.length) stations = await loadStations(true);
        current = stations;
        continue;
      }
      if (r.status === 200 && r.body && r.body.ok !== false) return r.body;
      throw httpError(r);
    }
    throw new DeskError('refused', 'The label printers keep changing. Try again in a moment.', { reason: 'stations-changed' });
  }

  /** @param {string} night @param {string} kind @param {Record<string, any>} record */
  async function sealHistory(night, kind, record) {
    if (!history) throw new DeskError('no-history', 'The history key is not ready, so check-ins are off.');
    const id = cc.newRowId();
    // `ts` is epoch MILLISECONDS inside the sealed record (routes.md section 3).
    const sealed = await cc.sealRow(history.pub, { id, night, kind, record: { ts: now(), ...record } });
    if (!sealed) throw new DeskError('unsealed', refusalWords('unsealed'));
    return { id, night, kind, ...sealed };   // the Row wire shape (routes.md): the seal plus its id, night and kind
  }
  /** @param {any[]} list @param {string} night @param {Record<string, any>} record */
  async function sealJob(list, night, record) {
    if (!list.length) return null;
    const bundle = await cc.sealForStations(list, { id: cc.newRowId(), night, kind: 'print-job', record });
    if (!bundle) throw new DeskError('unsealed', refusalWords('unsealed'));
    return bundle;
  }

  /**
   * Who a call names. A child on TwoTimTwo is their clubber id; a visitor is
   * their name and club, which the Worker hashes (never stored).
   * @param {{ clubberId?: string|null, name: string, club?: string, visitor?: boolean }} child
   */
  function who(child) {
    if (child.clubberId && !child.visitor) return { clubberId: String(child.clubberId) };
    const parts = String(child.name || '').trim().split(/\s+/);
    return { visitor: { first: parts[0] || '', last: parts.slice(1).join(' '), club: child.club || '' } };
  }
  const night = () => cc.churchNight(now());

  /** @param {string} name @returns {{ first: string, last: string }} */
  function splitName(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return { first: parts[0] || '', last: parts.slice(1).join(' ') };
  }
  /**
   * The sealed history record (routes.md section 3): `{ts, first, last, club,
   * clubberId?, friend?, friendFirst?, source}`. `visitor` is the row's KIND,
   * not a field, for a child with no clubber id.
   * @param {{ clubberId?: string|null, name: string, club?: string, visitor?: boolean }} child
   * @param {{ friend?: boolean, friendName?: string }} [extra]
   */
  function historyRecord(child, extra = {}) {
    const { first, last } = splitName(child.name);
    return {
      first, last, club: child.club || '',
      ...(child.clubberId && !child.visitor ? { clubberId: String(child.clubberId) } : {}),
      ...(extra.friend ? { friend: true, ...(extra.friendName ? { friendFirst: extra.friendName } : {}) } : {}),
      source: 'desk',
    };
  }

  /**
   * Check one child in: seal the print job and the history row here, post
   * both with the check-in. Several children are several calls; the page
   * sends siblings together.
   *
   * The job record is exactly what the print role runs (routes.md section 5):
   * `{route: '/print', body: <the print server's /print body>, clubberId, source: 'desk'}`.
   * The page does not know the claim's gen: the lease carries it.
   * @param {{ clubberId?: string|null, name: string, club?: string, visitor?: boolean }} child
   * `welcomeOnly` (the youth page, owner 2026-10-15): the job is `/print-welcome`, the
   * TV's welcome with no label (a station below 9.4.8 refuses the route: nothing prints).
   * @param {{ bible?: boolean, friend?: boolean, friendName?: string, friendClub?: string, welcomeOnly?: boolean }} [choice]
   * `opts.signal` aborts the post (the page's minute with no answer). Sending a check-in
   * again is safe: the Worker's claim answers `already` and never prints a second label.
   * An `already` whose `state` is 'checking' means an earlier send is still with TwoTimTwo.
   * @param {{ signal?: AbortSignal|null }} [opts]
   * @returns {Promise<{ already: boolean, state?: string, jobId: string|null, gen?: number, history: string }>}
   */
  async function checkIn(child, choice = {}, opts = {}) {
    const n = night();
    const friendName = choice.friend ? String(choice.friendName || '').replace(/\s+/g, ' ').trim().slice(0, 24) : '';
    const items = { ...(choice.bible ? { Bible: true } : {}), ...(choice.friend ? { Friend: true } : {}) };
    const isVisitor = !!child.visitor || !child.clubberId;
    const clubberId = isVisitor ? null : String(child.clubberId);
    const printBody = {
      name: child.name, clubName: child.club || '',
      ...(clubberId ? { clubberId } : {}),
      ...(isVisitor ? { visitor: true } : {}),
      ...(choice.friend ? { friend: true, ...(friendName ? { friendName } : {}) } : {}),
    };
    const friendClub = friendName ? String(choice.friendClub || '').slice(0, 20) : '';
    const out = await sealedPost('/v1/desk/checkin', async (list) => ({
      night: n, ...who(child), items, ...(choice.friend && friendName ? { friendName, ...(friendClub ? { friendClub } : {}) } : {}),
      historyRow: await sealHistory(n, isVisitor ? 'visitor' : 'checkin', historyRecord(child, { friend: choice.friend, friendName })),
      job: await sealJob(list, n, { route: choice.welcomeOnly ? '/print-welcome' : '/print', body: printBody, clubberId, source: 'desk' }),
    }), { signal: opts.signal || null });
    return { already: !!out.already, ...(out.already && typeof out.state === 'string' ? { state: out.state } : {}), jobId: out.jobId ?? null, gen: out.gen, history: out.history || '' };
  }

  /**
   * Undo and check-out are NOT sent again by the page on a hiccup: each re-posts to
   * TwoTimTwo and adds another history row (a second `undone`/`checkedOut` in the
   * night summary), so a lost answer is the volunteer's to check.
   * @param {'undo'|'checkout'} what @param {{ clubberId?: string|null, name: string, club?: string, visitor?: boolean }} child
   * @param {{ signal?: AbortSignal|null }} [opts]
   */
  async function undoOrCheckout(what, child, opts = {}) {
    const n = night();
    // `club` rides the post so the Worker can count the night_summary line.
    return sealedPost(`/v1/desk/${what}`, async () => ({
      night: n, ...who(child), club: child.club || '',
      historyRow: await sealHistory(n, what, historyRecord(child)),
    }), { signal: opts.signal || null });
  }
  const undo = (/** @type {any} */ child, /** @type {any} */ opts) => undoOrCheckout('undo', child, opts);
  const checkout = (/** @type {any} */ child, /** @type {any} */ opts) => undoOrCheckout('checkout', child, opts);

  /**
   * A label that is not a check-in: a `reprint:` job sealed to every station
   * (never counted, nothing sent to TwoTimTwo). The record is exactly what the
   * print role runs: one of the print server's own routes and its own body.
   * @param {string} route @param {Record<string, any>} body
   */
  async function reprintJob(route, body) {
    const n = night();
    const jobId = `reprint:${crypto.randomUUID()}`;
    await sealedPost('/v1/print/reprint', async (list) => ({
      jobId, bundle: await sealJob(list, n, { route, body, source: 'desk', at: new Date(now()).toISOString() }),
    }), { needJob: true });
    return { jobId };
  }
  const oneLine = (/** @type {unknown} */ v, /** @type {number} */ max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);

  /**
   * A one-off name tag: a typed first name and a club, no roster lookup (the
   * print server's POST /print-oneoff). The screens welcome the child; the count never moves.
   * @param {{ name: string, club: string }} tag
   */
  async function oneOffTag(tag) {
    const first = oneLine(tag.name, 40);
    if (!first) throw new DeskError('refused', 'Type the child’s first name.', { reason: 'no-name' });
    const club = String(tag.club || '').trim();
    if (!club) throw new DeskError('refused', 'Pick the child’s club.', { reason: 'no-club' });
    return reprintJob('/print-oneoff', { firstName: first, clubName: club });
  }

  /**
   * A leader tag (the print server's POST /print-leader, filed under isLeader there, never a check-in).
   * @param {{ name: string, club?: string }} tag
   */
  async function leaderTag(tag) {
    const name = oneLine(tag.name, 80);
    if (!name) throw new DeskError('refused', 'Type the leader’s name.', { reason: 'no-name' });
    return reprintJob('/print-leader', { name, clubName: String(tag.club || '').trim() });
  }

  /**
   * A custom label: one line of free text on a blank label (POST /print-custom), which records nothing.
   * @param {{ text: string }} label
   */
  async function customLabel(label) {
    const text = oneLine(label.text, 60);
    if (!text) throw new DeskError('refused', 'Type the label text.', { reason: 'no-text' });
    return reprintJob('/print-custom', { text });
  }

  // ── a late BARF friend (routes.md 5.1) ──────────────────────────────────────

  /**
   * Is tonight a BARF night, who already brought a friend, and which route the
   * BARF tag is sealed to. Null when the Worker cannot say (the page hides the button).
   * `recheck`: children whose late BARF redo never took and who wait to be checked in
   * again (the red line, after a reload too); null from a Worker that does not say.
   * @returns {Promise<{ barfNight: boolean|null, friends: string[], tagRoute: string, recheck: { clubberId: string, items: { Bible: boolean, Friend: true } }[]|null }|null>}
   */
  async function barfInfo() {
    try {
      const r = await request('GET', '/v1/desk/barf');
      if (r.status !== 200 || !r.body || typeof r.body !== 'object') return null;
      return {
        barfNight: typeof r.body.barfNight === 'boolean' ? r.body.barfNight : null,
        friends: Array.isArray(r.body.friends) ? r.body.friends.map(String) : [],
        tagRoute: r.body.tagRoute === '/print-barf-tag' ? '/print-barf-tag' : '/print-custom',
        recheck: Array.isArray(r.body.recheck)
          ? r.body.recheck.filter((/** @type {any} */ x) => x && /^\d{1,12}$/.test(String(x.clubberId)))
            .map((/** @type {any} */ x) => ({ clubberId: String(x.clubberId), items: { Bible: !!(x.items && x.items.Bible === true), Friend: /** @type {const} */ (true) } }))
          : null,
      };
    } catch (e) {
      if (e instanceof DeskError && e.code === 'signed-out') throw e;
      return null;
    }
  }

  /** The friend's first name as every path keeps it (cleanFriendName: one line, 24). @param {unknown} v */
  const friendFirst = (v) => Array.from(String(v || '')).filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127 && c !== '<' && c !== '>')
    .join('').replace(/\s+/g, ' ').trim().slice(0, 24);

  /**
   * A child already checked in tonight brought a friend: ONE Worker operation redoes
   * their TwoTimTwo check-in with Brought a friend, prints only the BARF tag (sealed
   * here to every station: the tag's own route, or a "BARFED! <first>" custom label
   * for a station older than 9.3.1), and records the friend. `checkedIn: false` in
   * the answer = TwoTimTwo did not take the redo: offer barfRecheck(child, items).
   * @param {{ clubberId: string, name: string, club?: string }} child @param {string} friendName @param {string} [tagRoute] @param {string} [friendClub]
   * @returns {Promise<{ checkedIn: boolean, items: { Bible: boolean, Friend: boolean }, jobId: string|null, reason?: string }>}
   */
  async function barfLate(child, friendName, tagRoute, friendClub) {
    const friend = friendFirst(friendName);
    if (!friend) throw new DeskError('refused', 'Type the friend’s first name.', { reason: 'no-friend-name' });
    if (!child || !child.clubberId) throw new DeskError('refused', 'Pick the child who brought the friend.', { reason: 'no-child' });
    const n = night();
    const { first } = splitName(child.name);
    const route = tagRoute === '/print-barf-tag' ? '/print-barf-tag' : '/print-custom';
    const body = route === '/print-barf-tag' ? { firstName: first, clubName: child.club || '' } : { text: `BARFED! ${first}` };
    const out = await sealedPost('/v1/desk/barf-late', async (list) => ({
      night: n, clubberId: String(child.clubberId), friendName: friend, ...(friendClub ? { friendClub: String(friendClub).slice(0, 20) } : {}),
      historyRow: await sealHistory(n, 'barf-friend', historyRecord(child, { friend: true, friendName: friend })),
      tagJob: list.length ? { jobId: `reprint:${crypto.randomUUID()}`, bundle: await sealJob(list, n, { route, body, source: 'desk', at: new Date(now()).toISOString() }) } : null,
    }));
    return { checkedIn: out.checkedIn === true, items: { Bible: !!(out.items && out.items.Bible), Friend: true }, jobId: out.jobId ?? null, ...(out.reason ? { reason: String(out.reason) } : {}) };
  }

  /**
   * The one-tap re-check-in after a late BARF friend's redo never took: TwoTimTwo's
   * check-in alone, the same items plus Brought a friend. No label, no list.
   * @param {{ clubberId: string }} child @param {{ Bible?: boolean }} [items]
   */
  async function barfRecheck(child, items = {}) {
    const r = await request('POST', '/v1/desk/barf-late', { night: night(), clubberId: String(child.clubberId), recheck: true, items: { Bible: !!items.Bible, Friend: true } });
    if (r.status === 200 && r.body && r.body.ok !== false) return { checkedIn: r.body.checkedIn === true, ...(r.body.reason ? { reason: String(r.body.reason) } : {}) };
    throw httpError(r);
  }

  // ── who was here lately (the history, opened in the browser) ───────────────

  /**
   * Who was here on the last `count` club nights before tonight, from the sealed
   * history rows (routes.md section 3), opened HERE with the history key this
   * sign-in unwrapped. Worker (D1) reads only, never TwoTimTwo: one nights list,
   * then each night's rows a page at a time. A child counts as here on a night
   * when the LAST of their check-in and undo rows (by `ts`) is not an undo; the
   * laptop's imported attendance ledger counts too. Fails SILENT: no key (a
   * restored session), fewer than `count` earlier nights, history storage off,
   * no connection or anything else answers null, and the page shows nobody as away.
   * @param {number} [count]
   * @returns {Promise<{ nights: string[], names: string[], ids: string[] }|null>}
   */
  async function recentAttendance(count = 2) {
    if (!ring) return null;
    const key = ring;
    try {
      const r = await request('GET', '/v1/history/nights');
      if (r.status !== 200 || !Array.isArray(r.body)) return null;
      const tonight = night();
      const nights = [...new Set(r.body.map((/** @type {any} */ n) => n && n.night)
        .filter((/** @type {any} */ n) => typeof n === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(n) && n < tonight))].sort().reverse().slice(0, count);
      if (nights.length < count) return null;
      /** @type {Set<string>} */ const names = new Set();
      /** @type {Set<string>} */ const ids = new Set();
      for (const n of nights) {
        /** @type {Map<string, { ts: number, here: boolean, name: string, id: string }>} */
        const last = new Map();
        let after = '';
        for (let page = 0; page < 20; page++) {
          const q = await request('GET', `/v1/history/rows?night=${n}&limit=500${after ? `&after=${encodeURIComponent(after)}` : ''}`);
          if (q.status !== 200 || !q.body) return null;
          for (const row of q.body.rows || []) {
            /** @type {any} */
            const rec = await cc.openRow(key, row).catch(() => null);
            if (!rec || typeof rec !== 'object') continue;
            if (row.kind === 'import-attendance') {
              if (Array.isArray(rec.dates) && rec.dates.includes(n) && rec.name) names.add(String(rec.name));
              continue;
            }
            const arrive = row.kind === 'checkin' || row.kind === 'visitor' || (row.kind === 'import-checkin' && !rec.undone);
            if (!arrive && row.kind !== 'undo') continue;
            const name = `${rec.first || ''} ${rec.last || ''}`.replace(/\s+/g, ' ').trim();
            const id = rec.clubberId ? String(rec.clubberId) : '';
            const who = id ? `id:${id}` : `n:${cc.normalizeName(name)}`;
            const ts = Number(rec.ts) || 0;
            const was = last.get(who);
            if (!was || ts >= was.ts) last.set(who, { ts, here: arrive, name: name || (was ? was.name : ''), id });
          }
          if (!q.body.next) break;
          after = String(q.body.next);
        }
        for (const v of last.values()) {
          if (!v.here) continue;
          if (v.name) names.add(v.name);
          if (v.id) ids.add(v.id);
        }
      }
      return { nights, names: [...names], ids: [...ids] };
    } catch { return null; }
  }

  // ── remembered leaders (the church settings, routes.md 10.3) ───────────────
  // `leaders` in shared/churchSettings.js: at most LEADERS_MAX unique
  // {firstName, lastName, clubName, lastPrintedAt, printCount}. The page writes
  // only the names and the club of a NEW leader; lastPrintedAt and printCount are
  // the station's / Worker's (the sanitizer fills their defaults), and a leader
  // already on the list is sent back exactly as it was read.

  /** @param {any} l */
  const leaderKey = (l) => `${l.firstName} ${l.lastName}`.toLowerCase().replace(/\s+/g, ' ').trim();
  /** @param {unknown} list @returns {{ firstName: string, lastName: string, clubName: string, lastPrintedAt?: number, printCount?: number }[]} */
  function readLeaders(list) {
    if (!Array.isArray(list)) return [];
    /** @type {any[]} */
    const out = [];
    const seen = new Set();
    for (const l of list) {
      if (!l || typeof l !== 'object' || typeof l.firstName !== 'string') continue;
      const row = { ...l, firstName: oneLine(l.firstName, 80), lastName: typeof l.lastName === 'string' ? oneLine(l.lastName, 80) : '', clubName: typeof l.clubName === 'string' ? oneLine(l.clubName, 40) : '' };
      const k = leaderKey(row);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(row);
      if (out.length >= LEADERS_MAX) break;
    }
    return out;
  }
  /** A typed name as the list keeps it: the first word, then the rest. @param {string} name */
  function splitLeader(name) {
    const parts = oneLine(name, 160).split(' ').filter(Boolean);
    return { firstName: oneLine(parts[0] || '', 80), lastName: oneLine(parts.slice(1).join(' '), 80) };
  }

  /**
   * The church's remembered leaders (`GET /v1/church/settings`, `settings.leaders`).
   * Null when the route is not there yet (404), paused, or unreachable: the page
   * then shows no chips.
   */
  async function churchLeaders() {
    try {
      const r = await request('GET', '/v1/church/settings');
      if (r.status !== 200 || !r.body || typeof r.body !== 'object') return null;
      return { rev: Number(r.body.rev) || 0, leaders: readLeaders(r.body.settings && r.body.settings.leaders) };
    } catch { return null; }
  }

  /**
   * Change the list through the church-settings edit (`PUT /v1/church/settings
   * {baseRev, settings: {leaders}}`, only that key), once more on a stale rev.
   * Never throws: null when it could not be written (route missing, not seeded,
   * paused, offline).
   * @param {(list: any[]) => any[]|null} change null = nothing to write
   */
  async function editLeaders(change) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const cur = await churchLeaders();
      if (!cur) return null;
      const next = change(cur.leaders);
      if (!next) return cur;
      try {
        const put = await request('PUT', '/v1/church/settings', { baseRev: cur.rev, settings: { leaders: next } });
        if (put.status === 200 && put.body) {
          const saved = put.body.settings && Array.isArray(put.body.settings.leaders) ? readLeaders(put.body.settings.leaders) : next;
          return { rev: Number(put.body.rev) || cur.rev + 1, leaders: saved };
        }
        if (!(put.status === 409 && put.body && put.body.reason === 'stale')) return null;
      } catch { return null; }
    }
    return null;
  }
  /** Remember a leader whose tag just printed (nothing when already on the list). @param {{ name: string, club?: string }} leader */
  const rememberLeader = (leader) => {
    const row = { ...splitLeader(leader.name), clubName: oneLine(leader.club, 40) };
    if (!row.firstName) return Promise.resolve(null);
    return editLeaders((list) => (list.some((l) => leaderKey(l) === leaderKey(row)) ? null
      : (list.length >= LEADERS_MAX ? null : [...list, row])));
  };
  /** @param {{ firstName: string, lastName: string }} leader */
  const forgetLeader = (leader) => editLeaders((list) => {
    const next = list.filter((l) => leaderKey(l) !== leaderKey(leader));
    return next.length === list.length ? null : next;
  });

  return {
    signIn, restore, signOut, roster, families, printStatus, tonight, loadStations, checkIn, undo, checkout, oneOffTag, leaderTag, customLabel,
    barfInfo, barfLate, barfRecheck,
    recentAttendance, churchLeaders, rememberLeader, forgetLeader,
    get signedIn() { return !!session; },
    get hasHistory() { return !!history; },
    get canReadHistory() { return !!ring; },
    get night() { return night(); },
  };
}

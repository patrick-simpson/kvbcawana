// The desk page's transport: everything that talks to the sync Worker, and
// everything that seals, in ONE small module (ROADMAP.md#online-check-in P3).
// No DOM and no globals: the page hands it `fetch`, a storage object and the
// cloud-crypto module (lobby/shared/cloud-crypto.js, the canonical copy), so
// Node tests run it as it is. The routes are lobby/worker/src/routes.md; when
// the Worker's contract moves (the print role's is being reconciled), this is
// the only file that follows.
//
// THE RULES it keeps (routes.md "Rules every route keeps"):
//   - Free-CPU. Every key derivation and every seal is HERE, in the browser:
//     the passphrase becomes an authKey (passphrase v2) and is never sent once
//     the Worker is on v2, never stored; the print job is sealed to the
//     registered stations (sealForStations) and the history row to the history
//     key (sealRow) before anything is posted. The Worker validates and stores.
//   - Names go to the Worker in clear only inside the check-in the Worker must
//     post to TwoTimTwo (the clubber id; a visitor's name, which it hashes).
//     The sealed job and the sealed row carry the rest.
//   - Fail closed. No history key, or a seal that cannot be made, posts NOTHING.
//   - The 5 s read budget. A 429 is a DeskError 'busy' with `retryAfterMs`; the
//     page shows "busy, try again in Ns" and does not hammer.
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
/** A station not heard from for this long means "check the printer". */
export const STATION_QUIET_MS = 2 * 60 * 1000;

const SESSION_RE = /^v1\.\d+\.\d+\.[A-Za-z0-9_-]{20,}$/;

/**
 * Every failure the page words, as one error with a fixed `code`:
 * 'wrong' 'locked' 'unreachable' 'signed-out' 'busy' 'no-history' 'history-mismatch'
 * 'unsealed' 'no-station' 'wrong-night' 'unsure' 'refused' 'http'.
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
   * @param {string} method @param {string} path @param {unknown} [body] @param {{ auth?: boolean }} [opts]
   * @returns {Promise<{ status: number, body: any }>}
   */
  async function request(method, path, body, opts = {}) {
    /** @type {Record<string, string>} */
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.auth !== false && session) headers.Authorization = `Bearer ${session}`;
    let res;
    try {
      res = await fetchFn(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    } catch {
      throw new DeskError('unreachable', 'No internet connection to the check-in service.');
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
      const retryAfterMs = Number(data && data.retryAfterMs) || (Number.isFinite(header) && header > 0 ? header * 1000 : 5000);
      throw new DeskError('busy', `TwoTimTwo was just read. Try again in ${Math.max(1, Math.ceil(retryAfterMs / 1000))}s.`, { retryAfterMs });
    }
    return { status: res.status, body: data };
  }

  // ── sign-in (passphrase v2, routes.md section 1) ────────────────────────────

  /**
   * Sign in with the church passphrase. Derives authKey in the browser (the
   * passphrase is sent only for the one-time v2 upgrade routes.md allows, and
   * for a Worker that has no v2 yet), unwraps the history key to prove it is
   * ours, pins it, and keeps the session in the screens' own slot. The
   * passphrase itself is never stored.
   * @param {string} passphrase
   */
  async function signIn(passphrase) {
    const typed = cc.normalizePassphrase(passphrase);
    if (!typed) throw new DeskError('wrong', 'Type the passphrase.');
    const params = await request('GET', '/v1/auth/params', undefined, { auth: false });
    /** @type {{ status: number, body: any }} */
    let login;
    if (params.status === 200 && params.body && params.body.v === 2) {
      const { authKey } = await cc.deriveKeys(passphrase, params.body.salt, params.body.iter);
      const key = cc.bytesToBase64(authKey);
      // While the Worker stores no v2 verifier (`upgrade`), the first client sends the passphrase once, with its authKey.
      login = await request('POST', '/v1/login', params.body.upgrade ? { passphrase: typed, authKey: key } : { authKey: key }, { auth: false });
      if (login.status === 401 && login.body && login.body.reason === 'upgrade-needed') login = await request('POST', '/v1/login', { passphrase: typed, authKey: key }, { auth: false });
    } else {
      // A Worker without v2 yet (or a failed params call): today's login.
      login = await request('POST', '/v1/login', { passphrase: typed }, { auth: false });
    }
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

  function signOut() { saveSession(''); history = null; stations = null; }

  // ── reads ───────────────────────────────────────────────────────────────────

  /** @param {{ status: number, body: any }} r */
  function httpError(r) {
    const reason = r.body && typeof r.body.reason === 'string' ? r.body.reason : '';
    if (r.status === 504 || reason === 'unsure') return new DeskError('unsure', 'TwoTimTwo did not answer in time. Check TwoTimTwo before trying again.');
    if (reason === 'wrong-night') return new DeskError('wrong-night', 'The service says it is a different club night than this computer thinks.', { night: r.body.night });
    if (reason === 'unsealed') return new DeskError('unsealed', refusalWords('unsealed'), { what: r.body.what });
    if (r.status === 409 || r.status === 502 || r.status === 503) return new DeskError('refused', refusalWords(reason || 'refused'), { reason });
    return new DeskError('http', (r.body && (r.body.error || r.body.reason)) || `The check-in service answered HTTP ${r.status}.`, { status: r.status });
  }
  /** @param {string} path */
  async function get(path) {
    const r = await request('GET', path);
    if (r.status === 200) return r.body;
    throw httpError(r);
  }

  const roster = () => get('/v1/desk/roster');
  const families = () => get('/v1/desk/families');
  const printStatus = () => get('/v1/print/status');
  /** The Worker's own tonight count (routes.md `GET /v1/desk/tonight`, P5): null until that route exists. */
  async function tonight() {
    const r = await request('GET', '/v1/desk/tonight');
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
   * @param {{ needJob?: boolean }} [opts]
   */
  async function sealedPost(path, build, opts = {}) {
    if (!history) throw new DeskError('no-history', 'The history key is not ready, so check-ins are off. Open /settings or ask the owner.');
    let current = await loadStations();
    if (opts.needJob && !current.length) throw new DeskError('no-station', 'No print station is registered, so there is nowhere to print a name tag.');
    for (let attempt = 0; attempt <= RESEAL_MAX; attempt++) {
      const body = await build(current);
      const r = await request('POST', path, body);
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
   * @param {{ bible?: boolean, friend?: boolean, friendName?: string }} [choice]
   * @returns {Promise<{ already: boolean, jobId: string|null, gen?: number, history: string }>}
   */
  async function checkIn(child, choice = {}) {
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
    const out = await sealedPost('/v1/desk/checkin', async (list) => ({
      night: n, ...who(child), items,
      historyRow: await sealHistory(n, isVisitor ? 'visitor' : 'checkin', historyRecord(child, { friend: choice.friend, friendName })),
      job: await sealJob(list, n, { route: '/print', body: printBody, clubberId, source: 'desk' }),
    }));
    return { already: !!out.already, jobId: out.jobId ?? null, gen: out.gen, history: out.history || '' };
  }

  /** @param {'undo'|'checkout'} what @param {{ clubberId?: string|null, name: string, club?: string, visitor?: boolean }} child */
  async function undoOrCheckout(what, child) {
    const n = night();
    // `club` rides the post so the Worker can count the night_summary line.
    return sealedPost(`/v1/desk/${what}`, async () => ({
      night: n, ...who(child), club: child.club || '',
      historyRow: await sealHistory(n, what, historyRecord(child)),
    }));
  }
  const undo = (/** @type {any} */ child) => undoOrCheckout('undo', child);
  const checkout = (/** @type {any} */ child) => undoOrCheckout('checkout', child);

  /**
   * A one-off name tag: a label and no check-in (never counted, nothing sent
   * to TwoTimTwo), a `reprint:` job sealed to every station.
   * @param {{ name: string, club: string }} tag
   */
  async function oneOffTag(tag) {
    const n = night();
    const first = String(tag.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!first) throw new DeskError('refused', 'Type the child’s first name.', { reason: 'no-name' });
    const club = String(tag.club || '').trim();
    if (!club) throw new DeskError('refused', 'Pick the child’s club.', { reason: 'no-club' });
    const jobId = `reprint:${crypto.randomUUID()}`;
    // The record the print role runs: the print server's own POST /print-oneoff and its body.
    await sealedPost('/v1/print/reprint', async (list) => ({
      jobId, bundle: await sealJob(list, n, { route: '/print-oneoff', body: { firstName: first, clubName: club }, source: 'desk', at: new Date(now()).toISOString() }),
    }), { needJob: true });
    return { jobId };
  }

  return {
    signIn, restore, signOut, roster, families, printStatus, tonight, loadStations, checkIn, undo, checkout, oneOffTag,
    get signedIn() { return !!session; },
    get hasHistory() { return !!history; },
    get night() { return night(); },
  };
}

// @ts-check
// Online check-in P6 (ROADMAP.md#online-check-in, routes.md section 2 and 3):
// the history key's two routes and the sealed history rows in Cloudflare D1.
//
// THE WORKER NEVER DECRYPTS, AND DOES NO CRYPTO HERE BEYOND ONE SHA-256 PER
// BATCH (free plan: 10 ms of CPU). It accepts only rows a client already
// sealed ({v, kid, epk, iv, ct} plus the plaintext id, night, kind), checks
// their shapes and sizes with regular expressions, and stores them untouched.
// Nothing that is not on the allowlist below is ever copied to storage, so a
// stray plaintext field cannot ride along.
//
// A D1 OUTAGE (OR NO D1 YET) NEVER BLOCKS ANYTHING. Accepted batches go to an
// outbox in the Durable Object's own storage first (`hout:<batchId>`), and
// are then copied to D1 in one atomic db.batch. If D1 is down, slow, or the
// HISTORY_DB binding does not exist, the batch just stays in the outbox and
// `flush()` tries again on the next history request, and on the cron / alarm
// when the integrator calls it (see routes.md, "Registering history.js").
//
// Every route here assumes the caller has ALREADY checked the session.

import { TrendsImport } from './trendsimport.js';

/** @typedef {{ get(k: string): Promise<any>, put(k: any, v?: any): Promise<void>, delete(k: any): Promise<any>, list?(o?: any): Promise<Map<string, any>> }} Storage */

export const ROWS_BODY_MAX = 256 * 1024;
export const IMPORT_BODY_MAX = 1024 * 1024;
export const ROWS_PER_POST = 100;
export const ROWS_PER_IMPORT = 500;
/** Rows per outbox entry (keeps every stored value small). */
export const CHUNK_ROWS = 40;
/** Outbox entries held before the Worker says "backlog" instead of taking more. */
export const OUTBOX_MAX = 400;
export const PREV_WRAP_DAYS = 7;
const FLUSH_TIMEOUT_MS = 4000;
const NIGHTS_MAX = 400;
const SUMMARY_MAX = 5000;

const ROUTES = new Set([
  'GET /v1/history/key', 'PUT /v1/history/key', 'GET /v1/history/status',
  'POST /v1/history/rows', 'POST /v1/history/import',
  'GET /v1/history/rows', 'GET /v1/history/nights', 'GET /v1/history/summary',
]);

const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const NIGHT_RE = /^\d{4}-\d{2}-\d{2}$/;
const KIND_RE = /^[a-z][a-z0-9-]{0,31}$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const CLUB_RE = /^[A-Za-z0-9][A-Za-z0-9 &'.-]{0,23}$/;
/** base64 length of the padded, sealed row: (1024 + 16 tag) bytes. */
const CT_B64_LEN = 1388;

/** @param {unknown} body @param {number} [status] */
const out = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
/** @param {string} error @param {number} status @param {Record<string, unknown>} [extra] */
const fail = (error, status, extra = {}) => out({ error, ...extra }, status);

/** @param {unknown} b64 @returns {number} decoded byte length, -1 when not base64 */
function b64Bytes(b64) {
  if (typeof b64 !== 'string' || b64.length % 4 !== 0 || !B64_RE.test(b64)) return -1;
  return (b64.length / 4) * 3 - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
}

/** @param {unknown} night a real calendar date */
export function validNight(night) {
  if (typeof night !== 'string' || !NIGHT_RE.test(night)) return false;
  const d = new Date(`${night}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === night;
}

/** @param {Uint8Array} bytes */
function hex(bytes) { return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''); }
/** @param {Uint8Array} bytes */
function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** @param {string} b64 */
function fromB64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
/** @param {Uint8Array|string} data */
async function sha256(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', /** @type {Uint8Array<ArrayBuffer>} */ (bytes)));
}

/**
 * One sealed row, rebuilt from the allowlisted fields only. null when any
 * field is the wrong shape or size (the whole batch is then refused).
 * @param {any} r @param {string} kid the current history kid
 */
export function cleanRow(r, kid) {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) return null;
  if (!validNight(r.night)) return null;
  if (typeof r.kind !== 'string' || !KIND_RE.test(r.kind)) return null;
  if (r.v !== 1) return null;
  if (r.kid !== kid) return null;
  if (b64Bytes(r.epk) !== 65 || b64Bytes(r.iv) !== 12) return null;
  if (typeof r.ct !== 'string' || r.ct.length !== CT_B64_LEN || b64Bytes(r.ct) < 0) return null;
  return { id: r.id, night: r.night, kind: r.kind, v: 1, kid: r.kid, epk: r.epk, iv: r.iv, ct: r.ct };
}

/** @param {any} s the plaintext numbers for one night and club */
function cleanSummaryLine(s) {
  if (!s || typeof s !== 'object' || !validNight(s.night) || typeof s.club !== 'string' || !CLUB_RE.test(s.club)) return null;
  /** @param {unknown} v */
  const num = (v) => (Number.isInteger(v) && /** @type {number} */ (v) >= 0 && /** @type {number} */ (v) <= 10000 ? /** @type {number} */ (v) : null);
  const nums = [num(s.checkedIn), num(s.checkedOut), num(s.undone), num(s.prints)];
  if (nums.includes(null)) return null;
  return { night: s.night, club: s.club, checkedIn: nums[0], checkedOut: nums[1], undone: nums[2], prints: nums[3] };
}

/** The wrapped history key's shape (it is ciphertext; the Worker cannot open it). @param {any} w */
export function validWrapped(w) {
  return Boolean(w && typeof w === 'object' && w.v === 1
    && b64Bytes(w.salt) === 16 && Number.isInteger(w.iter) && w.iter >= 600000 && w.iter <= 2000000
    && b64Bytes(w.iv) === 12 && typeof w.ct === 'string' && w.ct.length >= 24 && w.ct.length <= 2048 && b64Bytes(w.ct) > 16);
}

/** kid = first 8 bytes of SHA-256(raw pub), hex. @param {unknown} pub */
async function kidOfPub(pub) {
  if (b64Bytes(pub) !== 65) return null;
  const raw = fromB64(/** @type {string} */ (pub));
  if (raw[0] !== 4) return null;
  return hex((await sha256(raw)).slice(0, 8));
}

/**
 * D1 can be slow or down: never wait on it for long.
 * @template T @param {Promise<T>} p @returns {Promise<T>}
 */
function withTimeout(p, ms = FLUSH_TIMEOUT_MS) {
  /** @type {any} */ let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('d1 timeout')), ms); })]).finally(() => clearTimeout(t));
}

class BadBody extends Error {
  /** @param {string} message @param {number} status @param {string} reason */
  constructor(message, status, reason) { super(message); this.status = status; this.reason = reason; }
}

export class History {
  /**
   * @param {{ storage: Storage, env: Record<string, any>, now?: () => number }} deps
   */
  constructor({ storage, env, now = Date.now }) {
    this.storage = storage;
    this.env = env;
    this.now = now;
    /** @type {Promise<any>|null} */
    this.flushing = null;
  }

  /** Is this request one of ours? @param {string} method @param {string} pathname */
  static handles(method, pathname) { return ROUTES.has(`${method} ${pathname}`); }

  get db() { return this.env.HISTORY_DB || null; }

  /**
   * The one entry point sync.js registers (after its session check):
   * `if (History.handles(request.method, url.pathname)) return this.history.handle(request, url);`
   * @param {Request} request @param {URL} url
   */
  async handle(request, url) {
    const route = `${request.method} ${url.pathname}`;
    try {
      switch (route) {
        case 'GET /v1/history/key': return await this.getKey();
        case 'PUT /v1/history/key': return await this.putKey(await this.readJson(request, 16 * 1024));
        case 'GET /v1/history/status': return out(await this.status());
        case 'POST /v1/history/rows': return await this.postRows(await this.readJson(request, ROWS_BODY_MAX), ROWS_PER_POST);
        case 'POST /v1/history/import': return await this.postRows(await this.readJson(request, IMPORT_BODY_MAX), ROWS_PER_IMPORT);
        case 'GET /v1/history/rows': return await this.getRows(url);
        case 'GET /v1/history/nights': return await this.getNights(url);
        case 'GET /v1/history/summary': return await this.getSummary(url);
        default: return fail('Not found.', 404);
      }
    } catch (err) {
      if (err instanceof BadBody) return fail(err.message, err.status, { reason: err.reason });
      console.error('[history]', route, err);
      return fail('History could not do that just now.', 500);
    }
  }

  /**
   * The desk's row check (desk.checkRow): the shape, tonight's date and the
   * CURRENT history kid. A Worker with no history key refuses every row (a
   * client creates the key at sign-in, `PUT /v1/history/key`, first writer wins).
   * @param {any} row @param {string} night
   */
  async checkRow(row, night) {
    const key = await this.storage.get('history:pub');
    return Boolean(key && row && row.night === night && cleanRow(row, key.kid));
  }

  /**
   * One plaintext summary line (night_summary counts), or null when the club
   * is not a name the table takes (a visitor with no club): the row is then
   * stored without a line rather than refused.
   * @param {string} night @param {unknown} club @param {Partial<Record<'checkedIn'|'checkedOut'|'undone'|'prints', number>>} counts
   */
  static summaryLine(night, club, counts) {
    const line = { night, club: String(club ?? '').trim(), checkedIn: 0, checkedOut: 0, undone: 0, prints: 0, ...counts };
    return cleanSummaryLine(line);
  }

  /**
   * The desk's hook: keep a row the CLIENT already sealed (the Worker only
   * checks its shape, never opens it). Never throws: a check-in is not undone
   * because history had a bad moment; the answer says what happened.
   * @param {any} row @param {ReturnType<typeof cleanSummaryLine>} [summary]
   * @returns {Promise<{ ok: boolean, status: number }>}
   */
  async storeSealed(row, summary) {
    try {
      const res = await this.postRows({ rows: [row], summary: summary ? [summary] : [] }, 1);
      return { ok: res.status < 300, status: res.status };
    } catch (err) {
      console.error('[history] could not keep a desk row', err);
      return { ok: false, status: 500 };
    }
  }

  /** @param {Request} request @param {number} max */
  async readJson(request, max) {
    const text = await request.text();
    if (text.length > max) throw new BadBody('That is too big.', 413, 'too-big');
    try {
      const v = JSON.parse(text);
      if (v && typeof v === 'object') return v;
    } catch { /* falls through */ }
    throw new BadBody('Send JSON.', 400, 'bad-json');
  }

  // ── the history key ─────────────────────────────────────────────────────

  async getKey() {
    const key = await this.storage.get('history:pub');
    const wrapped = await this.storage.get('history:wrapped');
    if (!key || !wrapped) return fail('There is no history key yet.', 404, { reason: 'no-key' });
    const prev = await this.storage.get('history:wrapped:prev');
    return out({ pub: key.pub, kid: key.kid, wrapped, prev: prev && prev.until > this.now() ? prev : null });
  }

  /** What a v2 login hands back (routes.md section 1): the stored key, or null when none yet. */
  async keyForLogin() {
    const key = await this.storage.get('history:pub');
    const wrapped = await this.storage.get('history:wrapped');
    return key && wrapped ? { pub: key.pub, kid: key.kid, wrapped } : null;
  }

  /** First writer wins. @param {any} body */
  async putKey(body) {
    const kid = await kidOfPub(body.pub);
    if (!kid || body.kid !== kid) return fail('That history key does not match its id.', 400, { reason: 'bad-key' });
    if (!validWrapped(body.wrapped)) return fail('That wrapped key is not the right shape.', 400, { reason: 'bad-wrap' });
    const have = await this.storage.get('history:pub');
    if (have) {
      return have.pub === body.pub
        ? out({ pub: have.pub, kid: have.kid }, 200)
        : fail('A different history key is already stored.', 409, { pub: have.pub, kid: have.kid, reason: 'key-exists' });
    }
    await this.storage.put({ 'history:pub': { pub: body.pub, kid }, 'history:wrapped': body.wrapped });
    return out({ pub: body.pub, kid }, 201);
  }

  /**
   * For the passphrase change (sync.js, routes.md "Registering history.js"):
   * what to add to the SAME atomic `storage.put({...})` that stores the new
   * auth, so the history key's wrap changes in the same instant as the
   * passphrase and the old wrap stays 7 days. `error` is a ready Response
   * (fail closed: a wrap that is missing or malformed changes NOTHING).
   * @param {any} wrapped the body's `wrapped` (rewrapPrivateKey's answer)
   * @returns {Promise<{ writes: Record<string, any>, error?: undefined } | { error: Response, writes?: undefined }>}
   */
  async rewrapWrites(wrapped) {
    const have = await this.storage.get('history:wrapped');
    if (!have) return wrapped == null ? { writes: {} } : { error: fail('There is no history key to wrap.', 400, { reason: 'no-key' }) };
    if (!validWrapped(wrapped)) {
      return { error: fail('The passphrase was not changed: this page did not send the history key re-wrapped under the new passphrase. Reload the page and try again.', 400, { reason: 'wrap-missing' }) };
    }
    return { writes: {
      'history:wrapped': wrapped,
      'history:wrapped:prev': { wrapped: have, until: this.now() + PREV_WRAP_DAYS * 24 * 3600 * 1000 },
    } };
  }

  // ── writing rows ────────────────────────────────────────────────────────

  /** @param {any} body @param {number} max */
  async postRows(body, max) {
    const key = await this.storage.get('history:pub');
    if (!key) return fail('There is no history key yet.', 409, { reason: 'no-key' });
    const rowsIn = body.rows === undefined ? [] : body.rows;
    const sumIn = body.summary === undefined ? [] : body.summary;
    if (!Array.isArray(rowsIn) || rowsIn.length > max) return fail(`Send at most ${max} rows.`, 400, { reason: 'too-many' });
    if (!Array.isArray(sumIn) || sumIn.length > 50) return fail('Send at most 50 summary lines.', 400, { reason: 'bad-summary' });
    /** @type {NonNullable<ReturnType<typeof cleanRow>>[]} */
    const rows = [];
    const seen = new Set();
    for (const r of rowsIn) {
      const c = cleanRow(r, key.kid);
      if (!c) return fail('A row was not a sealed history row. Nothing was stored.', 400, { reason: 'unsealed' });
      if (!seen.has(c.id)) { seen.add(c.id); rows.push(c); }
    }
    const summary = [];
    for (const s of sumIn) {
      const c = cleanSummaryLine(s);
      if (!c) return fail('A summary line was not right. Nothing was stored.', 400, { reason: 'bad-summary' });
      summary.push(c);
    }
    if (!rows.length && !summary.length) return out({ stored: 0, duplicates: 0, pending: await this.pending() });

    // The outbox first, so nothing depends on D1.
    const pendingNow = await this.pending();
    const chunks = Math.max(1, Math.ceil(rows.length / CHUNK_ROWS));
    if (pendingNow + chunks > OUTBOX_MAX) return fail('History is backed up. Try again in a few minutes.', 503, { reason: 'history-backlog', retryAfterMs: 60000 });
    /** @type {Record<string, any>} */
    const entries = {};
    for (let i = 0; i < chunks; i++) {
      const part = rows.slice(i * CHUNK_ROWS, (i + 1) * CHUNK_ROWS);
      const sum = i === 0 ? summary : [];
      const id = b64url((await sha256(JSON.stringify([part.map((r) => r.id), sum]))).slice(0, 16));
      entries[`hout:${id}`] = { id, rows: part, summary: sum };
    }
    await this.storage.put(entries);

    if (!this.db) {
      return out({ stored: rows.length, duplicates: 0, queued: rows.length, pending: await this.pending(), reason: 'history-off', message: 'History storage is not set up yet. These rows are held and will be saved when it is.' }, 202);
    }
    const res = await this.flush();
    return out({ stored: rows.length - res.duplicates, duplicates: res.duplicates, pending: res.pending }, res.pending ? 202 : 200);
  }

  async pending() {
    if (!this.storage.list) return 0;
    return (await this.storage.list({ prefix: 'hout:', limit: OUTBOX_MAX + 1 })).size;
  }

  async status() {
    return { db: Boolean(this.db), pending: await this.pending() };
  }

  /**
   * Copy the outbox to D1, oldest key first, each entry in ONE atomic batch.
   * Never throws; one flush at a time. Call it from the cron / alarm too.
   * @returns {Promise<{ written: number, duplicates: number, pending: number, error?: string }>}
   */
  async flush() {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushNow().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  async flushNow() {
    const db = this.db;
    if (!db || !this.storage.list) return { written: 0, duplicates: 0, pending: await this.pending() };
    let written = 0;
    let duplicates = 0;
    /** @type {string|undefined} */
    let error;
    try {
      const entries = await this.storage.list({ prefix: 'hout:', limit: 20 });
      for (const [key, entry] of entries) {
        const res = await withTimeout(this.writeEntry(db, entry));
        written += res.written;
        duplicates += res.duplicates;
        await this.storage.delete(key);
      }
    } catch (err) {
      error = String(err && /** @type {any} */ (err).message || err);
    }
    return { written, duplicates, pending: await this.pending(), ...(error ? { error } : {}) };
  }

  /**
   * @param {any} db @param {{ id: string, rows: any[], summary: any[] }} entry
   * @returns {Promise<{ written: number, duplicates: number }>}
   */
  async writeEntry(db, entry) {
    const at = new Date(this.now()).toISOString();
    const stmts = [db.prepare('INSERT INTO applied_batches (id, at) VALUES (?1, ?2)').bind(entry.id, at)];
    for (const r of entry.rows) {
      stmts.push(db.prepare('INSERT OR IGNORE INTO history_rows (id, night, kind, v, kid, epk, iv, ct) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
        .bind(r.id, r.night, r.kind, r.v, r.kid, r.epk, r.iv, r.ct));
    }
    for (const s of entry.summary) {
      stmts.push(db.prepare('INSERT INTO night_summary (night, club, checked_in, checked_out, undone, prints) VALUES (?1, ?2, ?3, ?4, ?5, ?6) '
        + 'ON CONFLICT (night, club) DO UPDATE SET checked_in = checked_in + excluded.checked_in, checked_out = checked_out + excluded.checked_out, '
        + 'undone = undone + excluded.undone, prints = prints + excluded.prints')
        .bind(s.night, s.club, s.checkedIn, s.checkedOut, s.undone, s.prints));
    }
    try {
      const results = await db.batch(stmts);
      const changed = results.slice(1, 1 + entry.rows.length).reduce((/** @type {number} */ n, /** @type {any} */ r) => n + (r?.meta?.changes || 0), 0);
      return { written: changed, duplicates: entry.rows.length - changed };
    } catch (err) {
      // The batch is atomic: a primary-key clash on applied_batches means this
      // exact batch already landed once (a retry after the delete was lost).
      if (/UNIQUE|PRIMARY KEY|constraint/i.test(String(err && /** @type {any} */ (err).message || err))) {
        const seen = await db.prepare('SELECT 1 AS x FROM applied_batches WHERE id = ?1').bind(entry.id).first();
        if (seen) return { written: 0, duplicates: entry.rows.length };
      }
      throw err;
    }
  }

  // ── reading ─────────────────────────────────────────────────────────────

  /** One flush attempt before a read, so a recovered D1 catches up. */
  async readyDb() {
    const db = this.db;
    if (!db) return null;
    if (await this.pending()) await this.flush();
    return db;
  }

  /** @param {URL} url */
  range(url) {
    const from = url.searchParams.get('from') || '0000-01-01';
    const to = url.searchParams.get('to') || '9999-12-31';
    return NIGHT_RE.test(from) && NIGHT_RE.test(to) ? { from, to } : null;
  }

  /** @param {URL} url */
  async getRows(url) {
    const nightsParam = url.searchParams.get('nights');
    const nightsArr = [];
    if (nightsParam) {
      try {
        const parsed = JSON.parse(nightsParam);
        if (!Array.isArray(parsed) || !parsed.every(validNight)) return fail('nights must be a JSON array of YYYY-MM-DD.', 400, { reason: 'bad-nights' });
        nightsArr.push(...parsed);
      } catch { return fail('nights must be a JSON array.', 400, { reason: 'bad-nights' }); }
    } else {
      const night = url.searchParams.get('night') || '';
      if (!validNight(night)) return fail('Say which night: ?night=YYYY-MM-DD.', 400, { reason: 'bad-night' });
      nightsArr.push(night);
    }
    const after = url.searchParams.get('after') || '';
    if (after && !ID_RE.test(after)) return fail('That "after" is not a row id.', 400, { reason: 'bad-after' });
    const limit = Math.min(500, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '200', 10) || 200));
    const db = await this.readyDb();
    if (!db) return this.off();

    let res;
    if (nightsArr.length === 1) {
      res = await db.prepare('SELECT id, night, kind, v, kid, epk, iv, ct FROM history_rows WHERE night = ?1 AND id > ?2 ORDER BY id LIMIT ?3')
        .bind(nightsArr[0], after, limit + 1).all();
    } else {
      res = await db.prepare('SELECT id, night, kind, v, kid, epk, iv, ct FROM history_rows WHERE night IN (SELECT value FROM json_each(?1)) AND id > ?2 ORDER BY id LIMIT ?3')
        .bind(JSON.stringify(nightsArr), after, limit + 1).all();
    }
    const rows = res.results || [];
    const more = rows.length > limit;
    const page = more ? rows.slice(0, limit) : rows;
    return out({ rows: page, next: more ? page[page.length - 1].id : null });
  }

  /** @param {URL} url */
  async getNights(url) {
    const r = this.range(url);
    if (!r) return fail('from and to are YYYY-MM-DD.', 400, { reason: 'bad-range' });
    const db = await this.readyDb();
    if (!db) return this.off();
    const res = await db.prepare('SELECT night, kind, COUNT(*) AS n FROM history_rows WHERE night BETWEEN ?1 AND ?2 GROUP BY night, kind ORDER BY night DESC LIMIT ?3')
      .bind(r.from, r.to, NIGHTS_MAX * 12).all();
    /** @type {Map<string, { night: string, rows: number, kinds: Record<string, number> }>} */
    const byNight = new Map();
    for (const line of res.results || []) {
      const n = byNight.get(line.night) || { night: line.night, rows: 0, kinds: {} };
      n.rows += line.n;
      n.kinds[line.kind] = line.n;
      byNight.set(line.night, n);
    }
    return out([...byNight.values()].slice(0, NIGHTS_MAX));
  }

  /** @param {URL} url */
  async getSummary(url) {
    const r = this.range(url);
    if (!r) return fail('from and to are YYYY-MM-DD.', 400, { reason: 'bad-range' });
    const db = await this.readyDb();
    if (!db) return this.off();
    // The desk's live lines, plus the trends back-fill's imported counts
    // (trendsimport.js, migration 0003) for every night and club that has NO
    // live line: a night is never counted twice, and the live count wins. An
    // imported line is `checkedIn` only, marked `imported: true`. Past
    // SUMMARY_MAX the OLDEST lines are left out, never the newest.
    const live = 'SELECT night, club, checked_in AS checkedIn, checked_out AS checkedOut, undone, prints, 0 AS imported FROM night_summary WHERE night BETWEEN ?1 AND ?2';
    let res;
    try {
      res = await db.prepare(`SELECT night, club, checkedIn, checkedOut, undone, prints, imported FROM (${live} `
        + 'UNION ALL SELECT i.night, i.club, i.attended, 0, 0, 0, 1 FROM night_summary_import i WHERE i.night BETWEEN ?1 AND ?2 '
        + 'AND NOT EXISTS (SELECT 1 FROM night_summary s WHERE s.night = i.night AND s.club = i.club) '
        + 'ORDER BY night DESC, club DESC LIMIT ?3) ORDER BY night, club')
        .bind(r.from, r.to, SUMMARY_MAX).all();
    } catch (err) {
      // Migration 0003 not applied yet: the live lines alone, as before it.
      if (!/no such table/i.test(String(err && /** @type {any} */ (err).message || err))) throw err;
      res = await db.prepare(`SELECT * FROM (${live} ORDER BY night DESC, club DESC LIMIT ?3) ORDER BY night, club`).bind(r.from, r.to, SUMMARY_MAX).all();
    }
    const lines = res.results || [];
    for (const l of lines) {
      if (l.imported) l.imported = true;
      else delete l.imported;
    }
    return out(lines);
  }

  off() {
    return fail('History storage is not set up yet.', 503, { reason: 'history-off' });
  }
}

/**
 * The registry mount (ONE line in SyncCore's constructor, like mountCheckin):
 * every history route behind a session, and the desk's two hooks: a check-in,
 * undo or check-out stores the row the desk page sealed, and the desk refuses
 * a row sealed to anything but the current history key. The Worker never
 * seals a row itself (the free plan's CPU): a row only comes from a client.
 * @param {import('./registry.js').Registry} registry @param {any} core the SyncCore (core.history, core.desk)
 */
export function mountHistory(registry, core) {
  for (const route of ROUTES) {
    const [method, pattern] = route.split(' ');
    registry.add(method, pattern, 'session', ({ request, url }) => core.history.handle(request, url));
  }
  // The trends back-fill (trendsimport.js, routes.md section 3): it runs from the
  // watcher's alarm by itself; this is its status (with its desk self-check,
  // `crosscheck`, computed after each import, never here), and asking nudges the
  // alarm when a season read is due (so a first deploy does not wait for the cron).
  if (core.watcher) {
    core.trends = new TrendsImport({ storage: core.storage, env: core.env, now: core.now, watcher: core.watcher });
    core.watcher.trends = core.trends;
    registry.add('GET', '/v1/history/import-status', 'session', async () => {
      try { await core.trends.kick(); } catch (err) { console.error('[trends] could not set the alarm', err); }
      return out(await core.trends.statusView());
    });
  }
  const desk = core.desk;
  if (!desk) return;
  desk.checkRow = (/** @type {any} */ row, /** @type {string} */ night) => core.history.checkRow(row, night);
  desk.hooks.afterCheckin.push((/** @type {any} */ e) => core.history.storeSealed(e.historyRow, History.summaryLine(e.night, e.club, { checkedIn: 1 })));
  desk.hooks.afterUndo.push((/** @type {any} */ e) => core.history.storeSealed(e.historyRow, History.summaryLine(e.night, e.club, { undone: 1 })));
  desk.hooks.afterCheckout.push((/** @type {any} */ e) => core.history.storeSealed(e.historyRow, History.summaryLine(e.night, e.club, { checkedOut: 1 })));
}

// The registered print stations (ROADMAP.md#online-check-in, routes.md §4).
//
// A station is a KVBC Awana app running the print role. NO pairing step
// (owner): any computer signed in with the passphrase registers itself with
// its own P-256 public key (the private half stays in Electron safeStorage).
// The Worker never proves the station holds the key; it does not need to,
// because a job is sealed TO the key: a non-station that leases one cannot
// open it, and a lease only delays it.
//
// What a client seals to is this list (`list()`): a print job's bundle must
// have one entry for EVERY registered station and none for anyone else
// (`checkBundle`), so a job is never unreadable to a station that is about to
// lease it, and never sealed to a key the church revoked.
//
// Stored as ONE document, `stations`, with public keys and a few fixed-word
// fields only: no name of a child, nothing secret. A restart reloads it.

import { STATION_PAD_LADDER, base64ToBytes, kidOf } from '../../shared/cloud-crypto.js';
import { Doc } from './doc.js';

export const STATIONS_MAX = 10;
/** Throttle for lastSeenAt writes: a heartbeat every 30 s must not be a storage write each. */
export const SEEN_WRITE_MS = 60 * 1000;
const STATION_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;
const KID_RE = /^[0-9a-f]{16}$/;
const PRINTER_STATES = ['ok', 'busy', 'offline', 'error', 'paper', 'unknown'];

/**
 * @typedef {{ stationId: string, name: string, pub: string, kid: string, registeredAt: string,
 *   lastSeenAt: string|null, printer: { state: string, detail?: string }|null,
 *   version?: string, churchRev?: number }} Station
 */

/** An AES-GCM ciphertext's size on the pad ladder: the rung plus the 16-byte tag. */
const LADDER_CT = new Set(STATION_PAD_LADDER.map((r) => r + 16));

/** Decoded size of a standard base64 string, from its length (no decoding). @param {string} b64 */
function b64Bytes(b64) {
  if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return -1;
  return (b64.length / 4) * 3 - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
}

/** A printer state the station reported, cut down to fixed words and a short detail. @param {any} p */
export function cleanPrinter(p) {
  if (!p || typeof p !== 'object') return null;
  const state = PRINTER_STATES.includes(p.state) ? p.state : 'unknown';
  const detail = typeof p.detail === 'string' ? p.detail.replace(/[^\x20-\x7e]/g, ' ').trim().slice(0, 80) : '';
  return detail ? { state, detail } : { state };
}

/** An app version a heartbeat reports, 'X.Y.Z', or null. @param {unknown} v */
export function cleanVersion(v) {
  return typeof v === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,5}$/.test(v) ? v : null;
}

/** The church-settings rev a station applied, or null. @param {unknown} v */
export function cleanRev(v) {
  return Number.isInteger(v) && /** @type {number} */ (v) >= 0 && /** @type {number} */ (v) <= 1e9 ? /** @type {number} */ (v) : null;
}

export class Stations {
  /**
   * @param {{ storage: { get(k: string): Promise<any>, put(k: string, v: any): Promise<void>, delete(k: string): Promise<any> },
   *   now: () => number }} deps
   */
  constructor({ storage, now }) {
    this.now = now;
    this.doc = new Doc(storage, 'stations', () => ({ rev: 0, list: [] }));
  }

  load() {
    return this.doc.load();
  }

  /** @returns {Station[]} (after load) */
  all() {
    return this.doc.data.list;
  }

  /** @param {string} id (after load) */
  get(id) {
    return this.all().find((s) => s.stationId === id) || null;
  }

  /**
   * Register, or replace this station's own key. {ok, station} or {ok: false, error, status}.
   * @param {any} body {stationId, name, pub, kid}
   */
  async register(body) {
    await this.load();
    const stationId = String(body?.stationId ?? '');
    if (!STATION_ID_RE.test(stationId)) return { ok: false, status: 400, error: 'That station id is not valid.' };
    const name = String(body?.name ?? '').replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Print station';
    const raw = typeof body?.pub === 'string' ? base64ToBytes(body.pub) : null;
    if (!raw || raw.length !== 65 || raw[0] !== 4) return { ok: false, status: 400, error: 'That public key is not a P-256 key.' };
    const kid = await kidOf(raw);
    if (!KID_RE.test(kid) || body.kid !== kid) return { ok: false, status: 400, error: 'That key id does not match the key.' };
    // From here on, no await: the check and the write are one step.
    const list = this.all();
    const mine = list.find((s) => s.stationId === stationId);
    const other = list.find((s) => s.kid === kid && s.stationId !== stationId);
    if (other) return { ok: false, status: 409, error: 'Another station already uses that key.' };
    if (!mine && list.length >= STATIONS_MAX) return { ok: false, status: 409, error: `At most ${STATIONS_MAX} stations. Remove one that is gone first.` };
    const t = new Date(this.now()).toISOString();
    /** @type {Station} */
    const station = { stationId, name, pub: body.pub, kid, registeredAt: mine ? mine.registeredAt : t, lastSeenAt: mine ? mine.lastSeenAt : null, printer: mine ? mine.printer : null };
    if (mine && mine.version) station.version = mine.version;
    if (mine && mine.churchRev !== undefined) station.churchRev = mine.churchRev;
    if (mine) list[list.indexOf(mine)] = station; else list.push(station);
    this.doc.data.rev += 1;
    await this.doc.save();
    return { ok: true, station, stations: list.length };
  }

  /** Every station, as /settings and a sealing client read them. */
  async list() {
    await this.load();
    return this.all().map((s) => ({ ...s }));
  }

  /** Remove a dead computer's key. @param {string} id */
  async revoke(id) {
    await this.load();
    const list = this.all();
    const at = list.findIndex((s) => s.stationId === id);
    if (at < 0) return { ok: false };
    list.splice(at, 1);
    this.doc.data.rev += 1;
    await this.doc.save();
    return { ok: true, stations: list.length };
  }

  /**
   * A station's call came in: note when, and its printer (heartbeat), its app
   * version and the church-settings rev it applied (routes.md 10.3). Written
   * through at most every SEEN_WRITE_MS unless one of those changed.
   * @param {string} id @param {any} [printer] @param {{ version?: unknown, churchRev?: unknown }} [report]
   */
  async touch(id, printer, report = {}) {
    await this.load();
    const s = this.get(id);
    if (!s) return false;
    const t = this.now();
    const clean = printer === undefined ? undefined : cleanPrinter(printer);
    let changed = clean !== undefined && JSON.stringify(clean) !== JSON.stringify(s.printer);
    const version = cleanVersion(report.version);
    if (version !== null && version !== s.version) { s.version = version; changed = true; }
    const churchRev = cleanRev(report.churchRev);
    if (churchRev !== null && churchRev !== s.churchRev) { s.churchRev = churchRev; changed = true; }
    const stale = !s.lastSeenAt || t - Date.parse(s.lastSeenAt) >= SEEN_WRITE_MS;
    s.lastSeenAt = new Date(t).toISOString();
    if (clean !== undefined) s.printer = clean;
    if (changed || stale) await this.doc.save();
    return true;
  }

  /** What sealForStations takes: every registered station's public key. @returns {{ publicKey: string }[]} */
  sealTargets() {
    return this.all().map((s) => ({ publicKey: s.pub }));
  }

  /**
   * Is this a bundle sealed to EVERY registered station and nobody else?
   * @param {any} bundle @param {{ night: string, kind: string, id?: string }} expect
   * @returns {{ ok: true } | { ok: false, reason: 'unsealed'|'no-stations'|'stations-changed', status: number }}
   */
  checkBundle(bundle, expect) {
    const stations = this.all();
    if (!stations.length) return { ok: false, reason: 'no-stations', status: 409 };
    const to = bundle && bundle.v === 1 && Array.isArray(bundle.to) ? bundle.to : null;
    if (!to || !to.length || to.length > STATIONS_MAX
      || bundle.night !== expect.night || bundle.kind !== expect.kind
      || (expect.id !== undefined && bundle.id !== expect.id)
      || typeof bundle.id !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(bundle.id)) {
      return { ok: false, reason: 'unsealed', status: 400 };
    }
    for (const w of to) {
      if (!w || typeof w.kid !== 'string' || typeof w.epk !== 'string' || typeof w.iv !== 'string'
        || typeof w.ct !== 'string' || !LADDER_CT.has(b64Bytes(w.ct))) return { ok: false, reason: 'unsealed', status: 400 };
    }
    const have = new Set(to.map((/** @type {any} */ w) => w.kid));
    const want = new Set(stations.map((s) => s.kid));
    if (have.size !== to.length) return { ok: false, reason: 'unsealed', status: 400 };
    for (const k of have) if (!want.has(k)) return { ok: false, reason: 'stations-changed', status: 409 };
    for (const k of want) if (!have.has(k)) return { ok: false, reason: 'stations-changed', status: 409 };
    return { ok: true };
  }
}

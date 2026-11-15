// @ts-check
// The keys this service runs on, and whether each still works (owner 2026-11-15: "One
// place that shows what's about to break", after the print token expired with nobody
// told). The service holds a handful of secrets other companies can end at any time: a
// GitHub token, a Microsoft app's secret, the TwoTimTwo sign-in. Each is used in one
// place; that place calls `note()` with what the other side just answered. This module
// only remembers the latest answer per key (storage `keys:state`, written when the
// answer CHANGES), says it in the overview (routes.md 10.6 `keys`), and mails the Awana
// mailbox ONCE when a key that worked stops working.
//
// Never a secret's value: names, states and times only.

/** How long a "failing" mail is not repeated for the same key. */
export const KEY_TOLD_MS = 7 * 24 * 60 * 60 * 1000;

const STATE_KEY = 'keys:state';

/**
 * The keys, in the order the settings page lists them. `secrets` are the Worker secrets
 * a key is made of (all must be set); `optional` = nothing breaks without it.
 */
export const KEYS = Object.freeze([
  { id: 'twotimtwo', name: 'TwoTimTwo sign-in', secrets: ['TWOTIMTWO_USERNAME', 'TWOTIMTWO_PASSWORD'], optional: false, fix: 'Check the TwoTimTwo user and password saved in GitHub (TWOTIMTWO_USERNAME, TWOTIMTWO_PASSWORD).' },
  { id: 'print', name: 'Printing from the web (GitHub token)', secrets: ['PRINT_DISPATCH_TOKEN'], optional: false, fix: 'Make a new GitHub token and save it as PRINT_DISPATCH_TOKEN (worker/README.md).' },
  { id: 'mail', name: 'Club email (Microsoft app)', secrets: ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET'], optional: false, fix: 'Make a new client secret for the Microsoft app and save it as MS_CLIENT_SECRET (worker/README.md, "Club email").' },
  { id: 'machine', name: 'Print jobs\' own key', secrets: ['HANDBOOK_TOKEN'], optional: false, fix: 'Save HANDBOOK_TOKEN in GitHub again (worker/README.md).' },
  { id: 'youtube', name: 'YouTube search (Cast)', secrets: ['YOUTUBE_API_KEY'], optional: true, fix: '' },
  { id: 'relay', name: 'Screen-share relay (Cast)', secrets: ['CF_TURN_KEY_ID', 'CF_TURN_API_TOKEN'], optional: true, fix: '' },
]);

export class KeyHealth {
  /**
   * @param {{ storage: any, now: () => number, env: () => Record<string, any>,
   *   tell?: (subject: string, text: string) => Promise<any>, log?: (line: string) => void }} deps
   *   `tell` mails the Awana mailbox (the club email's own sender); absent = nobody is mailed
   */
  constructor({ storage, now, env, tell, log }) {
    this.storage = storage;
    this.now = now;
    this.env = env;
    this.tell = tell || null;
    this.log = log || (() => {});
    /** @type {Record<string, { ok: boolean, at: number, since: number, status: number, told: number }>|null} */
    this.state = null;
  }

  async load() {
    if (!this.state) {
      const s = await this.storage.get(STATE_KEY);
      this.state = s && typeof s === 'object' ? s : {};
    }
    return this.state;
  }

  /**
   * What the other side just answered for a key. `ok` true = it took the key; false =
   * it REFUSED the key (expired, revoked, wrong). An answer that says nothing about
   * the key (no network, their server down) must not be noted at all.
   * Never throws; writes storage only when the answer changes.
   * @param {string} id @param {boolean} ok @param {number} [status]
   */
  async note(id, ok, status = 0) {
    try {
      const state = await this.load();
      const was = state[id];
      const t = this.now();
      if (was && was.ok === ok) { was.at = t; return; }   // the same again: memory only
      const row = { ok, at: t, since: t, status: Number(status) || 0, told: was?.told || 0 };
      state[id] = row;
      // Once per failure, and not again for a week if it flaps: the Awana mailbox is told.
      const key = KEYS.find((k) => k.id === id);
      if (!ok && key && this.tell && id !== 'mail' && t - row.told > KEY_TOLD_MS) {
        row.told = t;
        await this.storage.put(STATE_KEY, state);
        await this.tell(`${key.name} has stopped working`,
          `The Awana sync service was just refused when it used: ${key.name}.\n\nUntil it is fixed, what depends on it will not work.\n\nTo fix it: ${key.fix}\n\nThe settings page (awana.kvbchurch.org/settings, Tonight) shows every key and whether it works.\n`).catch(() => {});
        return;
      }
      await this.storage.put(STATE_KEY, state);
    } catch (err) {
      this.log(`[keys] could not note ${id}: ${String(/** @type {any} */ (err)?.message || err)}`);
    }
  }

  /**
   * Every key as the settings page shows it.
   * @param {{ read?: any, secretDaysLeft?: number|null }} [extra] the TwoTimTwo reader's status (it keeps its own), and the Microsoft secret's days left
   * @returns {Promise<{ id: string, name: string, optional: boolean, state: 'ok'|'failing'|'ending'|'not-set'|'unknown', since: string|null, words: string, fix: string }[]>}
   */
  async list(extra = {}) {
    const state = await this.load();
    const env = this.env() || {};
    const iso = (/** @type {number|undefined} */ t) => (t ? new Date(t).toISOString() : null);
    return KEYS.map((k) => {
      const base = { id: k.id, name: k.name, optional: k.optional, fix: k.fix };
      if (!k.secrets.every((s) => String(env[s] || '').length > 0)) {
        return { ...base, state: /** @type {const} */ ('not-set'), since: null, words: k.optional ? 'Not set up (optional).' : 'Not set up.' };
      }
      if (k.id === 'twotimtwo') {
        // The reader keeps its own account of its sign-in.
        const r = extra.read;
        if (r && r.loginBlockedForSec > 0) return { ...base, state: /** @type {const} */ ('failing'), since: null, words: 'TwoTimTwo refused the sign-in.' };
        if (r && r.lastOkAt) return { ...base, state: /** @type {const} */ ('ok'), since: null, words: 'Working.' };
        return { ...base, state: /** @type {const} */ ('unknown'), since: null, words: 'Not used yet since the last restart.' };
      }
      const row = state[k.id];
      if (row && !row.ok) return { ...base, state: /** @type {const} */ ('failing'), since: iso(row.since), words: 'Refused the last time it was used.' };
      if (k.id === 'mail' && typeof extra.secretDaysLeft === 'number' && extra.secretDaysLeft <= 30) {
        const d = extra.secretDaysLeft;
        return { ...base, state: /** @type {const} */ (d < 0 ? 'failing' : 'ending'), since: null, words: d < 0 ? 'Its secret has ended.' : `Its secret ends ${d === 0 ? 'today' : `in ${d} ${d === 1 ? 'day' : 'days'}`}.` };
      }
      if (row && row.ok) return { ...base, state: /** @type {const} */ ('ok'), since: iso(row.since), words: 'Working.' };
      return { ...base, state: /** @type {const} */ ('unknown'), since: null, words: k.id === 'machine' || k.optional ? 'Set.' : 'Set; not used yet since it was saved.' };
    });
  }
}

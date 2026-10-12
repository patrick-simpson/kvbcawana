// @ts-check
// The change log (routes.md 10.5): who changed what, when, from what to what,
// for the last 200 changes, with Undo where it is cheap.
//
// STORAGE (no list() needed; the Store interface has none):
//   log:meta        {v: 1, seq}: the newest entry's number (0 = none yet)
//   log:b0..log:b9  a ring of 10 buckets of 20 entries: entry n lives in bucket
//                   floor(n / 20) % 10, as {base, entries}; a bucket whose base
//                   is not floor(n / 20) * 20 is an older lap and is reset
//   logv:0..logv:19 a `before` too big for its entry, {seq, before}, slot n % 20
// One entry = one bucket read (memoized) + one multi-key put (bucket + meta [+ logv]).
//
// WHAT AN ENTRY MAY HOLD: values from allowlists only (SHARED_SPEC, CHURCH_SPEC,
// SCREEN_SPECS, the switches, a notice's level and message); the device that
// made the change (device.js); never a child's name or id. An entry is at most
// ENTRY_MAX_BYTES: a larger `before` goes to logv (`bigBefore: true`), a larger
// `after` is stored as null with `afterSig` (a short non-cryptographic hash of
// it, so Undo can still tell "changed since"), keys last.
//
// Appends and undo marks run one at a time (a promise chain), so two changes in
// one moment never take the same number or lose each other's bucket write.
// Logging never fails the write it describes: log() catches and answers null.

import { Doc } from './doc.js';
import { fail, json } from './http.js';

export const LOG_BUCKETS = 10;
export const LOG_PER_BUCKET = 20;
export const LOG_MAX = LOG_BUCKETS * LOG_PER_BUCKET;
export const ENTRY_MAX_BYTES = 2048;
export const KEYS_MAX = 40;
export const LIST_MAX = 50;
export const LIST_DEFAULT = 20;
export const WHATS = Object.freeze([
  'shared', 'church', 'switch', 'notice', 'screen', 'screen-name', 'screen-forget',
  'slides', 'template', 'journey', 'passphrase', 'station',
]);
/** The kinds Undo can reverse (a given entry may still say undoable: false, e.g. the church seed). */
export const UNDOABLE = Object.freeze(['shared', 'church', 'switch', 'notice', 'screen', 'screen-name']);

/** @param {unknown} v */
const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

/** JSON with every object's keys sorted, so two equal values always compare equal. @param {unknown} v @returns {string} */
export function canonical(v) {
  if (v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = /** @type {Record<string, unknown>} */ (v);
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Do two values hold the same thing? `undefined` and `null` are the same (absent). @param {unknown} a @param {unknown} b */
export function same(a, b) {
  return canonical(a ?? null) === canonical(b ?? null);
}

/** FNV-1a of the canonical form, 8 hex digits: a fingerprint, not a secret. @param {unknown} v */
export function signature(v) {
  const s = canonical(v);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The keys whose values differ between two flat objects, sorted, with what
 * each held before and after (null = absent).
 * @param {Record<string, unknown>|null|undefined} prev @param {Record<string, unknown>|null|undefined} next
 */
export function diffKeys(prev, next) {
  const a = prev || {};
  const b = next || {};
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !same(a[k], b[k])).sort();
  /** @type {Record<string, unknown>} */
  const before = {};
  /** @type {Record<string, unknown>} */
  const after = {};
  for (const k of keys) { before[k] = a[k] ?? null; after[k] = b[k] ?? null; }
  return { keys, before, after };
}

const bucketKey = (/** @type {number} */ seq) => `log:b${Math.floor(seq / LOG_PER_BUCKET) % LOG_BUCKETS}`;
const baseOf = (/** @type {number} */ seq) => Math.floor(seq / LOG_PER_BUCKET) * LOG_PER_BUCKET;
const bigKey = (/** @type {number} */ seq) => `logv:${seq % LOG_PER_BUCKET}`;

export class Changes {
  /**
   * @param {{ storage: import('./sync.js').Store, now: () => number, enabled: () => boolean }} deps
   */
  constructor({ storage, now, enabled }) {
    this.storage = storage;
    this.now = now;
    this.enabled = enabled;
    this.meta = new Doc(storage, 'log:meta', () => ({ v: 1, seq: 0 }));
    /** @type {Map<string, Promise<{ base: number, entries: any[] }|null>>} */
    this.buckets = new Map();
    /** @type {Promise<unknown>} */
    this.chain = Promise.resolve();
    /** Undos in flight (one synchronous claim per entry). */
    this.undoing = new Set();
  }

  /** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  serial(fn) {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => {});
    return p;
  }

  /** A bucket as stored (memoized: memory is the truth after the first read). @param {string} key */
  bucket(key) {
    if (!this.buckets.has(key)) this.buckets.set(key, this.storage.get(key).then((b) => b || null));
    return /** @type {Promise<{ base: number, entries: any[] }|null>} */ (this.buckets.get(key));
  }

  async head() {
    await this.meta.load();
    return this.meta.data.seq;
  }

  /** The oldest entry still kept, for a log whose newest is `head`. @param {number} head */
  static oldest(head) {
    return Math.max(1, (Math.floor(head / LOG_PER_BUCKET) - (LOG_BUCKETS - 1)) * LOG_PER_BUCKET);
  }

  /**
   * Write one entry. Never throws: a failure is logged and answered null.
   * @param {{ device: import('./device.js').Device, what: string, target?: string, keys?: string[],
   *   before?: Record<string, unknown>, after?: Record<string, unknown>|null, undoable?: boolean, undoOf?: number }} e
   * @returns {Promise<number|null>} the entry's seq
   */
  log(e) {
    if (!this.enabled()) return Promise.resolve(null);
    return this.serial(async () => {
      await this.meta.load();
      const seq = this.meta.data.seq + 1;
      const key = bucketKey(seq);
      const stored = await this.bucket(key);
      /** @type {Record<string, any>} */
      const entry = {
        seq,
        at: new Date(this.now()).toISOString(),
        device: e.device,
        what: WHATS.includes(e.what) ? e.what : 'shared',
        ...(e.target ? { target: String(e.target).slice(0, 64) } : {}),
        keys: (e.keys || []).slice(0, KEYS_MAX).map((k) => String(k).slice(0, 40)),
        ...(e.before !== undefined ? { before: e.before } : {}),
        ...(e.after !== undefined ? { after: e.after } : {}),
        undoable: e.undoable !== undefined ? !!e.undoable : UNDOABLE.includes(e.what),
        ...(e.undoOf ? { undoOf: e.undoOf } : {}),
      };
      /** @type {Record<string, unknown>} */
      const writes = {};
      if (bytes(entry) > ENTRY_MAX_BYTES && entry.before !== undefined) {
        writes[bigKey(seq)] = { seq, before: entry.before };
        delete entry.before;
        entry.bigBefore = true;
      }
      if (bytes(entry) > ENTRY_MAX_BYTES && entry.after) {
        entry.afterSig = signature(entry.after);
        entry.after = null;
      }
      while (bytes(entry) > ENTRY_MAX_BYTES && entry.keys.length) entry.keys.pop();
      // From here on, no await until the put: the number and the bucket are one step.
      const b = stored && stored.base === baseOf(seq) ? stored : { base: baseOf(seq), entries: [] };
      b.entries.push(entry);
      this.buckets.set(key, Promise.resolve(b));
      this.meta.data.seq = seq;
      await this.storage.put({ ...writes, [key]: b, 'log:meta': this.meta.data });
      return seq;
    }).catch((err) => {
      console.error('[changes] could not log a change', err);
      return null;
    });
  }

  /**
   * One entry by number. {entry} or {status: 404 (never written) | 410 (rotated out)}.
   * @param {number} seq
   */
  async find(seq) {
    const head = await this.head();
    if (!Number.isInteger(seq) || seq < 1 || seq > head) return { status: 404 };
    if (seq < Changes.oldest(head)) return { status: 410 };
    const b = await this.bucket(bucketKey(seq));
    const entry = b && b.base === baseOf(seq) ? b.entries.find((x) => x.seq === seq) : null;
    return entry ? { entry } : { status: 410 };
  }

  /** The `before` kept beside a big entry, or null when its slot has moved on. @param {number} seq */
  async bigBefore(seq) {
    const v = await this.storage.get(bigKey(seq));
    return v && v.seq === seq ? v.before : null;
  }

  /**
   * Newest first, older than `before` (the newest when absent), at most `limit`.
   * @param {number|null} before @param {number} limit
   */
  async list(before, limit) {
    const head = await this.head();
    const oldest = Changes.oldest(head);
    let seq = before == null ? head : Math.min(before - 1, head);
    const entries = [];
    while (seq >= oldest && entries.length < limit) {
      const b = await this.bucket(bucketKey(seq));
      const entry = b && b.base === baseOf(seq) ? b.entries.find((x) => x.seq === seq) : null;
      if (entry) entries.push(entry);
      seq -= 1;
    }
    const last = entries.length ? entries[entries.length - 1].seq : null;
    return { entries, next: entries.length === limit && last !== null && last - 1 >= oldest ? last : null, head };
  }

  /** The newest entry, or null. */
  async last() {
    const r = await this.list(null, 1);
    return r.entries[0] || null;
  }

  /** Mark an entry undone by `by` (the undo's own entry, or 0 when the log is off). @param {number} seq @param {number} by */
  markUndone(seq, by) {
    if (!this.enabled()) return Promise.resolve();
    return this.serial(async () => {
      const key = bucketKey(seq);
      const b = await this.bucket(key);
      const entry = b && b.base === baseOf(seq) ? b.entries.find((x) => x.seq === seq) : null;
      if (!entry) return;
      entry.undoneBy = by;
      await this.storage.put(key, b);
    }).catch((err) => console.error('[changes] could not mark an undo', err));
  }
}

/**
 * The routes (routes.md 10.5). Each module that owns an undoable kind adds its
 * undoer to `core.undoers[what]`: ({entry, before, device, undoOf}) =>
 * {ok: true, seq} | {ok: false, status, reason, error, keys?}.
 * @param {import('./registry.js').Registry} registry @param {any} core the SyncCore
 */
export function mountChanges(registry, core) {
  registry.add('GET', '/v1/changes', 'session', async ({ url }) => {
    const rawBefore = url.searchParams.get('before');
    const before = rawBefore === null || rawBefore === '' ? null : Number(rawBefore);
    if (before !== null && (!Number.isInteger(before) || before < 1)) return fail('before is an entry number.', 400);
    const rawLimit = url.searchParams.get('limit');
    const limit = rawLimit === null ? LIST_DEFAULT : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > LIST_MAX) return fail(`limit is 1 to ${LIST_MAX}.`, 400);
    const r = await core.changes.list(before, limit);
    return json({ ...r, off: !core.changes.enabled() });
  });

  registry.add('POST', '/v1/changes/:seq/undo', 'session', async ({ params, request }) => {
    const seq = Number(params.seq);
    if (!/^\d{1,12}$/.test(params.seq)) return fail('That is not an entry number.', 404, { reason: 'not-found' });
    const found = await core.changes.find(seq);
    if (!found.entry) {
      return found.status === 410
        ? fail('That change is too old to undo now.', 410, { reason: 'gone' })
        : fail('There is no such change.', 404, { reason: 'not-found' });
    }
    const entry = found.entry;
    const undoer = core.undoers[entry.what];
    if (!entry.undoable || !undoer) return fail('That change cannot be undone here.', 409, { reason: 'not-undoable' });
    if (entry.undoneBy !== undefined) return fail('That change was already undone.', 409, { reason: 'already-undone', undoneBy: entry.undoneBy });
    // One synchronous claim: two presses of Undo run once.
    if (core.changes.undoing.has(seq)) return fail('That change is being undone now.', 409, { reason: 'already-undone', undoneBy: null });
    core.changes.undoing.add(seq);
    try {
      const before = entry.bigBefore ? await core.changes.bigBefore(seq) : entry.before;
      if (before === null || before === undefined) return fail('That change is too old to undo now.', 410, { reason: 'gone' });
      const device = await core.deviceOf(request);
      const r = await undoer({ entry, before, device, undoOf: seq });
      if (!r.ok) return fail(r.error || 'That could not be undone.', r.status || 409, { reason: r.reason, ...(r.keys ? { keys: r.keys } : {}) });
      await core.changes.markUndone(seq, r.seq || 0);
      return json({ ok: true, seq: r.seq || null });
    } finally {
      core.changes.undoing.delete(seq);
    }
  });
}

/**
 * The shared "has it changed since?" check every undoer makes: the keys whose
 * current value is not the entry's `after` (by value, or by `afterSig` when the
 * entry kept none).
 * @param {any} entry @param {Record<string, unknown>} current the values now, for the entry's keys
 * @returns {string[]}
 */
export function changedSince(entry, current) {
  if (entry.after === null && entry.afterSig) {
    /** @type {Record<string, unknown>} */
    const now = {};
    for (const k of Object.keys(current)) now[k] = current[k] ?? null;
    return signature(now) === entry.afterSig ? [] : Object.keys(current);
  }
  const after = entry.after || {};
  return Object.keys(current).filter((k) => !same(current[k], after[k]));
}

/** The refusal an undoer returns when something moved on. @param {string[]} keys */
export function changedSinceRefusal(keys) {
  return { ok: false, status: 409, reason: 'changed-since', keys, error: 'Changed again since; nothing undone.' };
}

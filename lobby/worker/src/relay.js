// The phone check-in relay (printer 7.9.0): awana.kvbchurch.org/checkin works
// from any phone on any network, not only the church Wi-Fi. The page cannot
// reach the check-in laptop, so it hands this service a request ("check in Ava
// Stone", "who is still to come"), the laptop's print app collects it, runs it
// against its own phone API exactly as a phone on the Wi-Fi would, and hands
// the answer back here for the page to collect.
//
// WHAT IS KEPT, AND FOR HOW LONG (owner, 2026-10-03: "only while the laptop is
// on"): nothing about the roster is stored. A request waits at most
// REQUEST_TTL_MS for the laptop; an answer (which may hold children's names)
// waits at most ANSWER_TTL_MS for its page and is deleted the moment the page
// reads it. Signed in with the sync passphrase (owner's choice), like every
// other screen.
//
// Only the phone page's own calls can be relayed (RELAY_ROUTES): the laptop
// runs nothing else, and checks the same list again on its side.

export const RELAY_ROUTES = Object.freeze([
  ['POST', /^\/phone\/roster$/],
  ['POST', /^\/phone\/tonight$/],
  ['POST', /^\/phone\/checkin$/],
  ['GET', /^\/phone\/status\/[0-9a-f-]{8,64}$/],
  ['POST', /^\/phone\/undo$/],
  ['POST', /^\/phone\/restore$/],
  ['POST', /^\/phone\/visitor$/],
  ['POST', /^\/print-leader$/],
  ['POST', /^\/print-custom$/],
  ['POST', /^\/print-oneoff$/],
  ['POST', /^\/leaders$/],
  ['POST', /^\/leaders\/forget$/],
  ['POST', /^\/clubs$/],
  ['POST', /^\/reconcile$/],
]);

/** @param {unknown} method @param {unknown} path */
export function relayAllowed(method, path) {
  return typeof method === 'string' && typeof path === 'string'
    && RELAY_ROUTES.some(([m, re]) => m === method && re.test(path));
}

export const REQUEST_TTL_MS = 45 * 1000;   // the laptop takes it within this, or the page hears "not answering"
export const ANSWER_TTL_MS = 2 * 60 * 1000;
export const LAPTOP_ONLINE_MS = 60 * 1000;  // the laptop asked within this: it is on
export const LAPTOP_STAMP_MS = 15 * 1000;   // how stale the "laptop asked" stamp may get before a poll rewrites it
export const TAKEN_TTL_MS = 75 * 1000;      // a request the laptop took lives this long past the taking: its own timeout is 60 s
export const BUSY_MS = 5 * 60 * 1000;       // a phone asked within this: the laptop asks every second
export const QUEUE_MAX = 50;
export const REQUEST_BODY_MAX = 8 * 1024;
export const ANSWER_BODY_MAX = 120 * 1024;   // under the service's own 128 KB request cap

const NOT_ANSWERING = 'The check-in laptop is not answering. Is it on, with the TwoTimTwo check-in page open?';

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

export class Relay {
  /** @param {{ get(k: string): Promise<any>, put(k: string, v: any): Promise<void>, delete(k: string): Promise<any> }} storage @param {() => number} now */
  constructor(storage, now) {
    this.storage = storage;
    this.now = now;
  }

  async queue() { return (await this.storage.get('relay:queue')) || []; }

  // A request waits REQUEST_TTL_MS to be taken; once taken it lives
  // TAKEN_TTL_MS more. It used to be dropped at 45 s whether taken or not,
  // while the laptop allows itself 60 s to answer (a label waiting on the print queue): the answer
  // landed on a 404 and the phone had already been told to try again.
  alive(r, t) {
    return r.taken ? t - r.taken < TAKEN_TTL_MS : t - r.at < REQUEST_TTL_MS;
  }

  async laptopOnline() {
    const seen = await this.storage.get('relay:laptop');
    return typeof seen === 'number' && this.now() - seen < LAPTOP_ONLINE_MS;
  }

  /**
   * A page's request. @param {unknown} body {method, path, body}
   * @returns {Promise<{ok: true, id: string, laptopOnline: boolean} | {ok: false, status: number, error: string}>}
   */
  async enqueue(body) {
    const b = /** @type {any} */ (body) || {};
    if (!relayAllowed(b.method, b.path)) return { ok: false, status: 400, error: 'That is not something the phone page asks the laptop.' };
    const payload = b.method === 'GET' ? null : (b.body && typeof b.body === 'object' && !Array.isArray(b.body) ? b.body : {});
    if (payload && new TextEncoder().encode(JSON.stringify(payload)).length > REQUEST_BODY_MAX) {
      return { ok: false, status: 413, error: 'That request is too big.' };
    }
    const t = this.now();
    const q = (await this.queue()).filter((r) => t - r.at < REQUEST_TTL_MS);
    if (q.length >= QUEUE_MAX) return { ok: false, status: 429, error: 'Too many requests are waiting for the laptop. Try again in a moment.' };
    const id = randomId();
    q.push({ id, method: b.method, path: b.path, body: payload, at: t, taken: 0 });
    await this.storage.put('relay:queue', q);
    await this.storage.put('relay:busy', t + BUSY_MS);
    return { ok: true, id, laptopOnline: await this.laptopOnline() };
  }

  /** Delete every answer nobody collected in time (names never sit here). */
  async purge() {
    const t = this.now();
    const held = (await this.storage.get('relay:held')) || [];
    const keep = [];
    for (const h of held) {
      if (t - h.at > ANSWER_TTL_MS) await this.storage.delete(`relay:ans:${h.id}`);
      else keep.push(h);
    }
    if (keep.length !== held.length) await this.storage.put('relay:held', keep);
    // ...and every request the laptop never took (it holds a child's name).
    const q = await this.queue();
    const live = q.filter((r) => this.alive(r, t));
    if (live.length !== q.length) await this.storage.put('relay:queue', live);
    return held.length - keep.length + q.length - live.length;
  }

  /** The laptop's poll: every request not yet taken, and how often to ask again. */
  async take() {
    const t = this.now();
    await this.purge();
    // The stamp is for laptopOnline()'s minute-wide question, so a poll that
    // comes every second (busy) or every 20 s (idle) does not need to write
    // it every time: about 4,300 writes a day from one idle laptop, against
    // the free tier's daily cap, said the same thing 15 s apart.
    const seen = await this.storage.get('relay:laptop');
    if (typeof seen !== 'number' || t - seen >= LAPTOP_STAMP_MS) await this.storage.put('relay:laptop', t);
    const all = await this.queue();
    const live = all.filter((r) => this.alive(r, t));
    const fresh = live.filter((r) => !r.taken);
    for (const r of fresh) r.taken = t;
    if (fresh.length || live.length !== all.length) await this.storage.put('relay:queue', live);
    const busyUntil = (await this.storage.get('relay:busy')) || 0;
    return {
      requests: fresh.map(({ id, method, path, body }) => ({ id, method, path, body })),
      busy: busyUntil > t,
    };
  }

  /** The laptop's answer. @param {unknown} body {id, status, body} */
  async answer(body) {
    const b = /** @type {any} */ (body) || {};
    if (typeof b.id !== 'string' || !/^[0-9a-f]{24}$/.test(b.id)) return { ok: false, status: 400, error: 'Unknown request.' };
    const q = await this.queue();
    const req = q.find((r) => r.id === b.id);
    if (!req) return { ok: false, status: 404, error: 'That request is gone.' };
    const status = Number.isInteger(b.status) && b.status >= 100 && b.status < 600 ? b.status : 502;
    if (new TextEncoder().encode(JSON.stringify(b.body ?? null)).length > ANSWER_BODY_MAX) {
      return { ok: false, status: 413, error: 'That answer is too big.' };
    }
    await this.storage.put(`relay:ans:${b.id}`, { status, body: b.body ?? null, at: this.now() });
    await this.storage.put('relay:queue', q.filter((r) => r.id !== b.id));
    const held = (await this.storage.get('relay:held')) || [];
    held.push({ id: b.id, at: this.now() });
    await this.storage.put('relay:held', held);
    return { ok: true };
  }

  /**
   * A page collecting its answer: deleted as it is read. Until then {done:false}.
   * A request the laptop never took, or an answer never collected, expires.
   * @param {unknown} id
   */
  async result(id) {
    if (typeof id !== 'string' || !/^[0-9a-f]{24}$/.test(id)) return { done: true, status: 400, body: { error: 'Unknown request.' } };
    const t = this.now();
    const ans = await this.storage.get(`relay:ans:${id}`);
    await this.purge();
    if (ans) {
      await this.storage.delete(`relay:ans:${id}`);
      if (t - ans.at > ANSWER_TTL_MS) return { done: true, status: 504, body: { error: NOT_ANSWERING } };
      return { done: true, status: ans.status, body: ans.body };
    }
    const req = (await this.queue()).find((r) => r.id === id);
    if (req && t - req.at < REQUEST_TTL_MS) return { done: false, laptopOnline: await this.laptopOnline() };
    return { done: true, status: 504, body: { error: NOT_ANSWERING } };
  }
}

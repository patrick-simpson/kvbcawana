// @ts-check
// Hand out shares (owner 2026-11-23: "build me a private web page that lists
// each child who checked in that night broken out by club. Give me easy
// options to hand out shares"; picked: only the owner, any club night, tick
// several children, pick an amount, Give once). The page is
// awana.kvbchurch.org/tools/shares/; routes.md 10.23.
//
// WHO: only the owner: the church session AND the owner's code (the club
// email page's, Worker secret MAIL_OWNER_CODE, header X-Mail-Owner), or the
// owner's kept email sign-in on that device (X-Mail-Token of the office). The
// church passphrase alone opens nothing here.
//
// HOW: TwoTimTwo's own Special Share Awards form, the store top-up's
// (topup.js), one child per request so the page shows each one as it goes.
// NEVER TWICE: each (batch key, child) is marked `posting` (sealed, written
// through) BEFORE the post; the same pair asked again answers what happened
// and posts nothing. Only a page showing the new balance is `given`; a 4xx or
// the form's own error is `refused`; anything else is `unknown` and is never
// posted again (the page says to look in TwoTimTwo).
//
// KEPT: tonight's marks only, sealed under the state key (`give:night`,
// clubber ids and numbers, never a name).

import { fail, json } from './http.js';
import { localTime, openState, sealState } from './watcher.js';
import { INTERACTIVE_WAIT_MS, READ_INTERVAL_MS } from './readbudget.js';
import { parseSpecialSharePage } from './topup.js';

export const GIVE_KEY = 'give:night';
export const GIVE_MAX = 20;
export const WHY_MAX = 75;

/** @param {unknown} s */
const oneLine = (s) => [...String(s ?? '')].map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c)).join('').replace(/\s+/g, ' ').trim();

export class GiveShares {
  /** @param {{ storage: any, now: () => number, secret: () => string|null|undefined, client: () => any }} deps */
  constructor({ storage, now, secret, client }) {
    this.storage = storage;
    this.now = now;
    this.secret = secret;
    this.client = client;
    /** @type {{ date: string, done: Record<string, { s: string, n: number, id: string }> }|null} */
    this.night = null;
  }

  async load() {
    const date = localTime(this.now()).date;
    if (this.night && this.night.date === date) return this.night;
    let opened;
    const secret = this.secret();
    try {
      const sealed = await this.storage.get(GIVE_KEY);
      opened = secret && sealed ? await openState(secret, sealed) : null;
    } catch { opened = null; }
    this.night = opened && opened.date === date && opened.done && typeof opened.done === 'object' ? { date, done: opened.done } : { date, done: {} };
    // A post a restart cut short: never posted again.
    for (const v of Object.values(this.night.done)) if (v.s === 'posting') v.s = 'unknown';
    return this.night;
  }

  /** @param {string} k @param {{ s: string, n: number, id: string }} mark */
  async mark(k, mark) {
    const secret = this.secret();
    if (!secret || !this.night) throw new Error('no-secret');
    this.night.done[k] = mark;
    await this.storage.put(GIVE_KEY, await sealState(secret, this.night));
  }

  /**
   * The children one Give actually gave to (`given`), with how many each: for the banner.
   * @param {string} key @returns {Promise<{ ids: string[], shares: number }>}
   */
  async givenIn(key) {
    const night = await this.load();
    const ids = [];
    let shares = 0;
    for (const [k, v] of Object.entries(night.done)) {
      if (!k.startsWith(`${key}:`) || v.s !== 'given') continue;
      ids.push(v.id);
      shares = Math.max(shares, v.n);
    }
    return { ids, shares };
  }

  /** Shares given tonight per child (given only), for the page. */
  async givenTonight() {
    const night = await this.load();
    /** @type {Record<string, number>} */
    const out = {};
    for (const v of Object.values(night.done)) if (v.s === 'given') out[v.id] = (out[v.id] || 0) + v.n;
    return out;
  }

  /**
   * One child: POST /v1/shares/give {id, shares, why, key}.
   * @param {any} b
   */
  async give(b) {
    const id = String(b && b.id || '');
    const n = Number(b && b.shares);
    const why = oneLine(b && b.why).slice(0, WHY_MAX);
    const key = String(b && b.key || '');
    if (!/^\d{1,20}$/.test(id)) return fail('Which child?', 400, { reason: 'bad-id' });
    if (!Number.isInteger(n) || n < 1 || n > GIVE_MAX) return fail(`Give 1 to ${GIVE_MAX} shares.`, 400, { reason: 'bad-shares' });
    if (!why) return fail('Say why (TwoTimTwo asks).', 400, { reason: 'bad-why' });
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(key)) return fail('Reload the page.', 400, { reason: 'bad-key' });
    const night = await this.load();
    const k = `${key}:${id}`;
    const had = night.done[k];
    if (had) return json({ ok: had.s === 'given', outcome: had.s, shares: had.n, repeat: true });

    const client = this.client();
    if (!client) return json({ ok: false, reason: 'not-configured' }, 503);
    const page = await client.page(`/clubber/special_shekel/${id}`, { waitMs: INTERACTIVE_WAIT_MS, kind: 'give' });
    if (!page.ok) {
      if (page.error === 'read-busy') return json({ ok: false, reason: 'read-busy', retryAfterMs: page.retryAfterMs ?? READ_INTERVAL_MS }, 429);
      if (/^http-40[13]$/.test(page.error)) return json({ ok: false, reason: 'no-permission' }, 502);
      return json({ ok: false, reason: page.error || 'twotimtwo' }, 502);
    }
    const f = parseSpecialSharePage(page.html);
    const date = night.date;
    const meeting = f ? f.meetings.find((m) => m.date === date) : null;
    if (!f || f.balance === null || f.clubberId !== id || !f.token || !f.profileId) return json({ ok: false, reason: 'form-unreadable' }, 502);
    if (!meeting) return json({ ok: false, reason: 'no-meeting-tonight' }, 409);

    // Marked BEFORE the post: a crash, a timeout or an odd answer never posts again.
    await this.mark(k, { s: 'posting', n, id });
    const r = await client.giveSpecialShares({
      clubberId: id, calendarId: meeting.id, profileId: f.profileId, token: f.token, shares: n, why, expect: f.balance + n,
    });
    await this.mark(k, { s: r.outcome, n, id });
    return json({ ok: r.outcome === 'given', outcome: r.outcome, shares: n, ...(r.outcome === 'given' ? { balance: f.balance + n } : {}), ...(r.error ? { error: r.error } : {}) });
  }
}

/**
 * The owner only: the church session + the owner's code, or the owner's kept email sign-in.
 * @param {any} core @param {Request} request @param {string} ip
 */
async function ownerOnly(core, request, ip) {
  const who = await core.clubMail.who(request, () => core.authorized(request), ip);
  return !!(who && who.office);
}

/** @param {import('./registry.js').Registry} registry @param {any} core the SyncCore */
export function mountGiveShares(registry, core) {
  const owner = (/** @type {(ctx: any) => Promise<Response>} */ fn) => async (/** @type {any} */ ctx) => {
    if (!(await ownerOnly(core, ctx.request, ctx.ip))) return fail('Only the owner can hand out shares here.', 403, { reason: 'owner-only' });
    return fn(ctx);
  };
  registry.add('GET', '/v1/shares/tonight', 'public', owner(async () => {
    const res = await core.desk.roster();
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) return json(body || { ok: false }, res.status || 502);
    if (body.noClub) return json({ ok: true, noClub: true, next: body.next || null, kids: [] });
    const given = await core.giveShares.givenTonight();
    const kids = (Array.isArray(body.kids) ? body.kids : [])
      .filter((/** @type {any} */ k) => k.checkedIn && !k.checkedOut)
      .map((/** @type {any} */ k) => ({ id: String(k.clubberId), first: k.first, last: k.last, club: k.club, ...(given[String(k.clubberId)] ? { given: given[String(k.clubberId)] } : {}) }));
    return json({ ok: true, backwards: body.backwards === true, kids, ...(body.stale ? { stale: true } : {}) });
  }));
  registry.add('POST', '/v1/shares/give', 'public', owner(async ({ body }) => core.giveShares.give(await body())));
  // The banner on every screen (owner 2026-11-23: "a cool animation on every screen ... on the
  // bottom third"): once a Give has run, ONE sealed `shares` frame (CONTRACT.md) naming the
  // children it gave to, first names and clubs only. Never replayed; once per Give.
  const announced = new Set();
  registry.add('POST', '/v1/shares/announce', 'public', owner(async ({ body }) => {
    const b = await body();
    const key = String(b && b.key || '');
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(key)) return fail('Reload the page.', 400, { reason: 'bad-key' });
    if (announced.has(key)) return json({ ok: true, repeat: true });
    const { ids, shares } = await core.giveShares.givenIn(key);
    if (!ids.length || shares < 1) return json({ ok: false, reason: 'none-given' });
    const res = await core.desk.roster();
    const roster = await res.json().catch(() => null);
    const byId = new Map((roster && Array.isArray(roster.kids) ? roster.kids : []).map((/** @type {any} */ k) => [String(k.clubberId), k]));
    const kids = ids.map((id) => byId.get(id)).filter(Boolean).slice(0, 20)
      .map((/** @type {any} */ k) => ({ firstName: String(k.first || '').split(/\s+/)[0], club: String(k.club || '') }))
      .filter((k) => k.firstName);
    if (!kids.length) return json({ ok: false, reason: 'no-names' });
    announced.add(key);
    const sent = await core.publishSealed('shares', { kids, shares: Math.min(20, shares), at: new Date(core.now()).toISOString() });
    return json({ ok: sent.ok, kids: kids.length });
  }));
}

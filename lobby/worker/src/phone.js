// Cloud check-in for the phone page (awana.kvbchurch.org/checkin), owner's
// choice 2026-10-11: the Worker checks a child in on TwoTimTwo itself, laptop
// on or off, and then tells the laptop (when it is on) to print the tag at
// once. The page is unchanged: it still sends every call through the relay,
// and these are the calls the Worker answers itself (sync.js, POST /v1/relay):
//
//   POST /phone/checkin         always: TwoTimTwo's own check-in post
//   GET  /phone/status/<id>     for a check-in made here
//   POST /phone/roster          only while the laptop is off (it has families,
//   POST /phone/tonight         recent attendance and tonight's own history)
//
// Everything else (undo, check-out, visitors, custom labels) still goes to the
// laptop. Names pass through in memory and in the page's one-read answer, as
// the laptop's answers do; storage keeps a check-in's outcome only, by id.

import { localTime } from './watcher.js';
import { BIBLE_RE, FRIEND_RE } from './twotimtwo.js';

/** TwoTimTwo's club ids (docs/TWOTIMTWO.md §2.1). */
export const CLUB_BY_ID = Object.freeze({ 1: 'Cubbies', 2: 'Sparks', 3: 'T&T', 4: 'Puggles', 6: 'Trek', 7: 'Journey' });
const ACTION_TTL_MS = 10 * 60 * 1000;   // the laptop's PENDING_TTL_MS: a status is asked for well within it
const FAMILIES_TTL_MS = 30 * 60 * 1000;  // the extension re-reads the household export every 30 minutes too
// A failed read is kept this long, so phones opening the roster never sign
// in to TwoTimTwo once each while the export is refused.
const FAMILIES_RETRY_MS = 5 * 60 * 1000;

/** Which clubs offer Bible / Brought a friend: the phone card's toggles. @param {{clubs: string[], label?: string, automatic: boolean}[]} events */
export function itemClubs(events) {
  const clubsOf = (re) => [...new Set(events.filter((e) => !e.automatic && re.test(e.label || ''))
    .flatMap((e) => (e.clubs.length ? e.clubs : Object.keys(CLUB_BY_ID)).map((id) => CLUB_BY_ID[/** @type {keyof typeof CLUB_BY_ID} */ (Number(id))]).filter(Boolean)))];
  return { bible: clubsOf(BIBLE_RE), friend: clubsOf(FRIEND_RE) };
}

const splitName = (name) => {
  const parts = String(name || '').trim().split(/\s+/);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
};

export class CloudPhone {
  /**
   * @param {{ watcher: import('./watcher.js').Watcher, relay: import('./relay.js').Relay,
   *   storage: { get(k: string): Promise<any>, put(k: string, v: any): Promise<void>, delete(k: string): Promise<any> },
   *   now: () => number, friends?: import('./friends.js').Friends }} deps
   */
  constructor({ watcher, relay, storage, now, friends }) {
    this.watcher = watcher;
    this.relay = relay;
    this.storage = storage;
    this.now = now;
    this.friends = friends || null;
  }

  /**
   * The families (TwoTimTwo's households, names only) and which clubs offer
   * Bible / Brought a friend, for grouping the page's roster by family (owner,
   * 2026-10-11) with the laptop off, or on before it has shared its own.
   * Held in this object's memory for FAMILIES_TTL_MS (a failure for
   * FAMILIES_RETRY_MS), never in storage. A failed read is an empty list: the
   * page then shows children one by one.
   * @param {{events: {clubs: string[], automatic: boolean, label?: string}[]}} [page] a check-in page already read
   */
  async families(page) {
    const t = this.now();
    const c = this.familiesCache;
    if (c && t - c.at < (c.familiesError ? FAMILIES_RETRY_MS : FAMILIES_TTL_MS)) return c;
    const client = this.watcher.clientFor();
    if (!client) return { households: [], items: { bible: [], friend: [] }, at: t };
    const hh = await client.households();
    let events = page ? page.events : null;
    if (!events) {
      const p = await client.checkinPage();
      events = p.ok ? p.page.events : [];
    }
    // Why there are no families, as a fixed code (never page text), so a roster
    // without them can be told apart from a household export that failed.
    const out = { households: hh.ok ? hh.households : [], items: itemClubs(events), at: t, ...(hh.ok ? {} : { familiesError: hh.error }) };
    // A good read is kept half an hour, a failure five minutes.
    this.familiesCache = out;
    return out;
  }

  /**
   * The laptop's roster answer, with families and the Bible / friend clubs
   * filled in from TwoTimTwo when it has none (its touch screen shares them
   * only once opened). Anything the laptop did send is kept as it is.
   * @param {any} body
   */
  async fillRoster(body) {
    if (!this.on || !body || typeof body !== 'object' || !Array.isArray(body.kids)) return body;
    const noFamilies = !Array.isArray(body.households) || !body.households.length;
    const noItems = !body.items || (!(body.items.bible || []).length && !(body.items.friend || []).length);
    if (!noFamilies && !noItems) return body;
    const f = await this.families();
    return {
      ...body,
      ...(noFamilies ? { households: f.households, ...(f.familiesError ? { familiesError: f.familiesError } : {}) } : {}),
      ...(noItems ? { items: f.items } : {}),
    };
  }

  /** Is cloud check-in on (shadow mode or later) with a TwoTimTwo user? */
  get on() { return this.watcher.mode !== 'off' && !!this.watcher.creds(); }

  /**
   * The phone page's call, if it is one the Worker answers: {status, body},
   * else null (it goes to the laptop as before).
   * @param {any} req {method, path, body} @param {boolean} laptopOnline
   */
  async answer(req, laptopOnline) {
    if (!this.on || !req || typeof req.path !== 'string') return null;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (req.method === 'POST' && req.path === '/phone/checkin') return this.checkIn(body, laptopOnline);
    const status = req.method === 'GET' && /^\/phone\/status\/([0-9a-f]{24})$/.exec(req.path);
    if (status) {
      const act = await this.storage.get(`cloud:act:${status[1]}`);
      return act ? { status: 200, body: { status: act.status, detail: act.detail } } : null;
    }
    if (laptopOnline) return null;
    if (req.method === 'POST' && req.path === '/phone/roster') return this.roster();
    if (req.method === 'POST' && req.path === '/phone/tonight') return this.tonight();
    return null;
  }

  /** @param {any} body {name, options: {Bible, Friend}} @param {boolean} laptopOnline */
  async checkIn(body, laptopOnline) {
    const name = String(body.name || '').trim().slice(0, 80);
    if (!name) return { status: 400, body: { error: 'name is required' } };
    const o = body.options && typeof body.options === 'object' ? body.options : {};
    const options = { Bible: o.Bible === true, Friend: o.Friend === true };
    const friendName = options.Friend && typeof o.FriendName === 'string' ? o.FriendName.replace(/\s+/g, ' ').trim().slice(0, 24) : '';
    const r = await this.watcher.checkIn({ name, options, confirm: true });
    const id = await this.saveAction(r.ok ? 'done' : 'failed', r.ok ? '' : this.why(r));
    // Who brought a friend, for BARF Night's email (friends.js).
    if (r.ok && options.Friend && this.friends) {
      await this.friends.record({ name: r.child.name, club: r.child.club, clubberId: r.child.clubberId, friendName });
    }
    if (r.ok && laptopOnline) {
      // The tag, at once: the laptop prints it and greets the child on the TVs
      // (printer 8.0.0's job route; an older laptop refuses the job, and its
      // report check still prints the tag within five minutes).
      // With Brought a friend, the laptop also prints the BARFED tag on BARF Night (8.1.0).
      await this.relay.enqueueJob('/print', {
        name: r.child.name, clubName: r.child.club, clubberId: r.child.clubberId, cloud: true,
        ...(options.Friend ? { friend: true, friendName } : {}),
      });
    }
    return { status: 200, body: { id, queued: true } };
  }

  /** The words the page shows after "Couldn't check in <name>:". @param {any} r */
  why(r) {
    switch (r.error) {
      case 'not-found': return 'not on TwoTimTwo’s check-in list (already checked in, or not registered this year)';
      case 'ambiguous': return 'two children have that name on TwoTimTwo; check in at the desk';
      case 'already-checked-in': return 'already checked in';
      case 'checkin-refused': return 'TwoTimTwo did not record the check-in. Check in at the desk.';
      case 'no-attendance-item': return 'TwoTimTwo has no Attendance item for that club tonight';
      case 'login-refused': case 'login-backoff': return 'the cloud could not sign in to TwoTimTwo. Check in at the desk.';
      default: return 'TwoTimTwo did not answer. Check in at the desk.';
    }
  }

  /** @param {'done'|'failed'} status @param {string} detail */
  async saveAction(status, detail) {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
    const t = this.now();
    const all = (await this.storage.get('cloud:acts')) || [];
    for (const old of all.filter((a) => t - a.at >= ACTION_TTL_MS)) await this.storage.delete(`cloud:act:${old.id}`);
    await this.storage.put(`cloud:act:${id}`, { status, detail, at: t });
    await this.storage.put('cloud:acts', [...all.filter((a) => t - a.at < ACTION_TTL_MS), { id, at: t }]);
    return id;
  }

  /**
   * The roster with the laptop off: everyone on TwoTimTwo's check-in page,
   * everyone on today's report as checked in, families from TwoTimTwo's
   * households, and Bible / friend clubs from its own check-in items. No
   * recent attendance (that is the laptop's ledger).
   */
  async roster() {
    const client = this.watcher.clientFor();
    if (!client) return { status: 503, body: { error: 'Cloud check-in is not set up.' } };
    const page = await client.checkinPage();
    if (!page.ok) return { status: 502, body: { error: 'TwoTimTwo did not answer. Try again in a moment.' } };
    const report = await client.report(localTime(this.now()).date);
    const kids = page.page.roster.map((r) => ({
      name: r.name, club: r.club || CLUB_BY_ID[/** @type {keyof typeof CLUB_BY_ID} */ (Number(r.clubId))] || '',
      checkedIn: r.checkedIn, removedHere: false, inactive: false,
    }));
    if (report.ok) {
      const have = new Set(kids.map((k) => k.name.toLowerCase()));
      for (const e of report.report.entries) {
        if (e.name && !have.has(e.name.toLowerCase())) kids.push({ name: e.name, club: e.club, checkedIn: true, removedHere: false, inactive: false });
      }
    }
    const f = await this.families(page.page);
    return { status: 200, body: { kids, households: f.households, ...(f.familiesError ? { familiesError: f.familiesError } : {}), items: itemClubs(page.page.events), recent: { ready: false, names: [] }, source: 'cloud' } };
  }

  /** Tonight with the laptop off: today's report, as the laptop's /phone/tonight shapes it. */
  async tonight() {
    const client = this.watcher.clientFor();
    if (!client) return { status: 503, body: { error: 'Cloud check-in is not set up.' } };
    const date = localTime(this.now()).date;
    const report = await client.report(date);
    if (!report.ok) return { status: 502, body: { error: 'TwoTimTwo did not answer. Try again in a moment.' } };
    const seen = new Set();
    const entries = [];
    /** @type {Record<string, number>} */
    const byClub = {};
    for (const e of report.report.entries) {
      if (seen.has(e.clubberId)) continue;
      seen.add(e.clubberId);
      byClub[e.club || 'No club'] = (byClub[e.club || 'No club'] || 0) + 1;
      entries.push({ key: `id:${e.clubberId}`, ...splitName(e.name), clubName: e.club, clubberId: e.clubberId, checkedOut: false, visitor: false, at: null });
    }
    return { status: 200, body: { date, checkedIn: entries.length, checkedOut: 0, visitors: 0, byClub, countSource: 'twotimtwo', features: [], entries, source: 'cloud' } };
  }
}

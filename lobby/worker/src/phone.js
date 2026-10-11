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
   *   now: () => number }} deps
   */
  constructor({ watcher, relay, storage, now }) {
    this.watcher = watcher;
    this.relay = relay;
    this.storage = storage;
    this.now = now;
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
    const r = await this.watcher.checkIn({ name, options, confirm: true });
    const id = await this.saveAction(r.ok ? 'done' : 'failed', r.ok ? '' : this.why(r));
    if (r.ok && laptopOnline) {
      // The tag, at once: the laptop prints it and greets the child on the TVs
      // (printer 8.0.0's job route; an older laptop refuses the job, and its
      // report check still prints the tag within five minutes).
      await this.relay.enqueueJob('/print', { name: r.child.name, clubName: r.child.club, clubberId: r.child.clubberId, cloud: true });
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
   * The roster with the laptop off: everyone on TwoTimTwo's check-in page, and
   * everyone on today's report as checked in. No families or recent
   * attendance (those are the laptop's); Bible / friend clubs from TwoTimTwo's
   * own check-in items.
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
    return { status: 200, body: { kids, households: [], items: itemClubs(page.page.events), recent: { ready: false, names: [] }, source: 'cloud' } };
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

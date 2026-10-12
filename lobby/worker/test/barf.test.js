// A late BARF friend (barf.js, routes.md 5.1): ONE desk operation undoes the
// child's check-in on TwoTimTwo and redoes it with the same items plus Brought a
// friend, holding the child on the report across the gap, queues only the BARF
// tag, and records the friend for the 6:30 email and the BARF bags.
import { describe, expect, it } from 'vitest';
import { openAsStation } from '../../shared/cloud-crypto.js';
import { BARF_TAG_FALLBACK, BARF_TAG_ROUTE, REDO_TRIES, barfTagRoute, versionAtLeast } from '../src/barf.js';
import { SPILL_MS, WATCH_INTERVAL_MS } from '../src/watcher.js';
import { CHECKIN_PAGE } from './fixtures.js';
import { everything, plainWords, sealJob } from './helpers.js';
import { NIGHT, kid, rig, row } from './rig.js';

// Kit Tester (662, Sparks) is checked in; tonight offers Bible (707), Attendance (40) and Brought a friend (808).
const PAGE = CHECKIN_PAGE.replace('checkin-box boy"', 'checkin-box boy checked-in"')
  .replace('<label>Attendance</label>', '<label>Attendance</label><input class="event" name="events[]" value="808" clubs="2,3,6"><label>Brought a friend</label>');
const PAGE_OUT = PAGE.replace('checkin-box boy checked-in"', 'checkin-box boy"');
const KIT = { id: '662', name: 'Kit Tester', club: 'Sparks', bible: true, friend: false };

const step = async (t, ms) => { t.clock.tick(ms); await t.core.watcher.tick(); };
const readReport = (t) => step(t, WATCH_INTERVAL_MS);
const leased = async (st) => (await st.call('GET', '/v1/print/next?max=10')).body.jobs;
const uuid = () => crypto.randomUUID();

/** A BARF night with Kit checked in on TwoTimTwo's page, adopted and printed (claim printed, gen 1). */
async function barfNight({ barf = true, env = {} } = {}) {
  /** @type {any} */ let ref = null;
  // The check-in page marks Kit checked in exactly while the report lists Kit.
  const t = await rig({ kids: [kid(1)], checkinPage: () => (ref && !ref.night.kids.some((k) => k.id === '662') ? PAGE_OUT : PAGE), env: { SINGLE_PUBLISHER: 'on', ...env } });
  ref = t;
  await t.core.church.load();
  t.core.church.doc.data.settings = barf === null ? null : { barfNights: barf ? [NIGHT] : ['2026-10-21'] };
  const st = await t.station();
  await t.core.watcher.tick();                     // the baseline
  t.night.kids.push({ ...KIT });
  await readReport(t);
  await step(t, SPILL_MS);
  const jobs = await leased(st);
  expect(jobs).toHaveLength(1);
  await st.call('POST', '/v1/print/done', { jobId: jobs[0].jobId });
  t.clock.tick(6000);
  return { t, st };
}

/** What the page posts: the sealed row and the BARF tag's job, sealed to the stations. */
async function body(st, extra = {}) {
  const { bundle } = await sealJob([st], { route: BARF_TAG_ROUTE, body: { firstName: 'Kit', clubName: 'Sparks' }, source: 'desk' }, { night: NIGHT });
  return { night: NIGHT, clubberId: '662', friendName: '  Sam  ', historyRow: row('barf-friend'), tagJob: { jobId: `reprint:${uuid()}`, bundle }, ...extra };
}

/** TwoTimTwo's report follows its posts: the undo takes Kit off, the check-in puts Kit back marked. */
function followPosts(t, { refuse = 0, readDuringGap = true } = {}) {
  let refused = 0;
  t.on.undo = async () => { t.night.kids = t.night.kids.filter((k) => k.id !== '662'); };
  t.on.checkin = async () => {
    if (readDuringGap) {
      // The watcher's 15 s read lands in the gap: TwoTimTwo does not list Kit right now.
      t.clock.tick(WATCH_INTERVAL_MS);
      await t.core.watcher.tick();
      t.gapRead = t.reads.at(-1)?.path;
    }
    if (refused < refuse) { refused += 1; return 'refuse'; }
    t.night.kids.push({ ...KIT, friend: true });
    return 'ok';
  };
}

describe('GET /v1/desk/barf', () => {
  it('says whether tonight is a BARF night (null when nobody can say), who has a friend, and which tag route every station runs', async () => {
    const { t, st } = await barfNight();
    let info = (await t.call('GET', '/v1/desk/barf')).body;
    expect(info).toMatchObject({ night: NIGHT, barfNight: true, friends: [], tagRoute: BARF_TAG_FALLBACK, stations: 1 });
    // A 9.3.1 station runs the tag's own route.
    await st.call('POST', '/v1/print/heartbeat', { version: '9.3.1' });
    expect((await t.call('GET', '/v1/desk/barf')).body.tagRoute).toBe(BARF_TAG_ROUTE);
    await t.core.friends.record({ name: 'Ada Tester', club: 'Sparks', clubberId: '1', friendName: 'Lu' });
    info = (await t.call('GET', '/v1/desk/barf')).body;
    expect(info.friends).toEqual(['1']);
    t.core.church.doc.data.settings = { barfNights: ['2026-10-21'] };
    expect((await t.call('GET', '/v1/desk/barf')).body).toMatchObject({ barfNight: false, friends: [] });
    t.core.church.doc.data.settings = null;
    expect((await t.call('GET', '/v1/desk/barf')).body.barfNight).toBeNull();
  });

  it('versions: the tag route only when EVERY station is on 9.3.1 or later', () => {
    expect(versionAtLeast('9.3.1', '9.3.1')).toBe(true);
    expect(versionAtLeast('9.10.0', '9.3.1')).toBe(true);
    expect(versionAtLeast('9.3.0', '9.3.1')).toBe(false);
    expect(versionAtLeast(undefined, '9.3.1')).toBe(false);
    expect(barfTagRoute([{ version: '9.3.1' }, { version: '9.3.0' }])).toBe(BARF_TAG_FALLBACK);
    expect(barfTagRoute([{ version: '9.4.0' }, { version: '9.3.1' }])).toBe(BARF_TAG_ROUTE);
    expect(barfTagRoute([])).toBe(BARF_TAG_FALLBACK);
  });
});

describe('POST /v1/desk/barf-late', () => {
  it('undoes and redoes the check-in with the same items plus Brought a friend; a read in the gap changes nothing; only the BARF tag prints', async () => {
    const { t, st } = await barfNight();
    const tag = await t.core.tags.identity(NIGHT, '662');
    const claimBefore = { ...t.core.ledger.peek(NIGHT, tag) };
    expect(claimBefore).toMatchObject({ state: 'printed', gen: 1 });
    const countBefore = (await t.call('GET', '/v1/desk/tonight')).body.checkedIn;
    expect(countBefore).toBe(2);
    const status = await t.core.watcher.loadStatus();
    const undoneBefore = status.tonight.undoneOnTwoTimTwo;
    const sentBefore = t.sent.length;
    followPosts(t);
    const b = await body(st);
    const res = await t.call('POST', '/v1/desk/barf-late', b);
    expect(res.body).toMatchObject({ ok: true, checkedIn: true, items: { Bible: true, Friend: true }, jobId: b.tagJob.jobId, history: 'kept' });
    // TwoTimTwo: one undo, then one check-in with Attendance, Bible and Brought a friend.
    expect(t.posts.undo).toHaveLength(1);
    expect(t.posts.undo[0].get('clubber_id')).toBe('662');
    const redo = t.tt.checkins.at(-1);
    expect(redo.get('clubber_id')).toBe('662');
    expect(redo.getAll('events[]').sort()).toEqual(['40', '707', '808']);
    expect(t.gapRead).toBe('/clubber/checkin_report');   // the watcher really read the report in the gap
    // The watcher read in the gap saw nothing leave: no undo noted, the claim untouched.
    expect((await t.core.watcher.loadStatus()).tonight.undoneOnTwoTimTwo).toBe(undoneBefore);
    expect(t.core.ledger.peek(NIGHT, tag)).toMatchObject({ state: 'printed', gen: claimBefore.gen });
    // Later reads (Kit back, marked): still nothing adopted, the count never moved.
    await readReport(t);
    await step(t, SPILL_MS);
    expect(t.core.adopt.pending()).toBe(0);
    expect((await t.call('GET', '/v1/desk/tonight')).body.checkedIn).toBe(countBefore);
    expect(t.core.ledger.peek(NIGHT, tag)).toMatchObject({ state: 'printed', gen: claimBefore.gen });
    // The ONLY job is the BARF tag: a reprint job, never a check-in (so no name tag, no greeting).
    const jobs = await leased(st);
    expect(jobs.map((j) => [j.jobId, j.kind])).toEqual([[b.tagJob.jobId, 'reprint']]);
    expect(await openAsStation(st.ring, jobs[0].bundle)).toMatchObject({ route: BARF_TAG_ROUTE, body: { firstName: 'Kit', clubName: 'Sparks' } });
    // No greeting frame went out for Kit (the Worker greets nobody; a reprint job greets nobody).
    expect(t.sent.slice(sentBefore).filter((f) => f.e === 'checkin')).toEqual([]);
    // The friend: on the 6:30 list and the BARF bags, the name cleaned.
    const report = await t.core.friends.report(NIGHT);
    expect(report.clubs).toEqual([{ club: 'Sparks', kids: [{ name: 'Kit Tester', friend: 'Sam' }] }]);
    expect((await t.core.friends.bagNames(NIGHT)).names).toEqual(['Kit Tester', 'Sam']);
    expect((await t.call('GET', '/v1/desk/barf')).body.friends).toContain('662');
    // Nothing named rests in storage outside the sealed lists.
    expect(everything(t.storage)).not.toMatch(plainWords(['Kit', 'Tester', 'Sam']));
  });

  it('a second friend for the same child is refused (the list, or YES on the report), and nothing is posted', async () => {
    const { t, st } = await barfNight();
    await t.core.friends.record({ name: 'Kit Tester', club: 'Sparks', clubberId: '662', friendName: 'Lu' });
    const res = await t.call('POST', '/v1/desk/barf-late', await body(st));
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('already-friend');
    expect(t.posts.undo).toHaveLength(0);
    // ...and from the report alone.
    const { t: t2, st: st2 } = await barfNight();
    t2.night.kids.find((k) => k.id === '662').friend = true;
    const again = await t2.call('POST', '/v1/desk/barf-late', await body(st2));
    expect(again.body.reason).toBe('already-friend');
    expect(t2.posts.undo).toHaveLength(0);
  });

  it('not a BARF night, or nobody can say: refused before anything', async () => {
    for (const barf of [false, null]) {
      const { t, st } = await barfNight({ barf });
      const res = await t.call('POST', '/v1/desk/barf-late', await body(st));
      expect(res.status).toBe(409);
      expect(res.body.reason).toBe('not-barf-night');
      expect(t.posts.undo).toHaveLength(0);
    }
  });

  it('fails closed: a friend\'s name, a sealed barf-friend row and a sealed tag job are required', async () => {
    const { t, st } = await barfNight();
    expect((await t.call('POST', '/v1/desk/barf-late', await body(st, { friendName: ' <> ' }))).body.reason).toBe('no-friend-name');
    expect((await t.call('POST', '/v1/desk/barf-late', await body(st, { historyRow: row('checkin') }))).body).toMatchObject({ reason: 'unsealed', what: 'historyRow' });
    expect((await t.call('POST', '/v1/desk/barf-late', await body(st, { tagJob: null }))).body).toMatchObject({ reason: 'unsealed', what: 'tagJob' });
    expect(t.posts.undo).toHaveLength(0);
  });

  it('the redo fails every try: the tag still prints, the lists are kept, the page gets a re-check-in path that prints nothing and is never adopted', async () => {
    const { t, st } = await barfNight();
    const tag = await t.core.tags.identity(NIGHT, '662');
    followPosts(t, { refuse: REDO_TRIES, readDuringGap: false });
    const b = await body(st);
    const res = await t.call('POST', '/v1/desk/barf-late', b);
    expect(res.body).toMatchObject({ ok: true, checkedIn: false, items: { Bible: true, Friend: true }, jobId: b.tagJob.jobId, tries: REDO_TRIES });
    expect(t.tt.checkins.length).toBe(0);              // every try refused before TwoTimTwo kept it
    expect((await t.core.friends.bagNames(NIGHT)).names).toEqual(['Kit Tester', 'Sam']);
    // The hold is gone: the next read sees the truth (Kit is not checked in), and the claim follows it.
    await readReport(t);
    expect(t.core.ledger.peek(NIGHT, tag)).toMatchObject({ state: 'undone' });
    expect((await t.call('GET', '/v1/desk/tonight')).body.checkedIn).toBe(1);
    // The one-tap re-check-in: the same items plus Brought a friend, no label, no second list entry.
    followPosts(t, { readDuringGap: true });
    const again = await t.call('POST', '/v1/desk/barf-late', { night: NIGHT, clubberId: '662', recheck: true, items: res.body.items });
    expect(again.body).toMatchObject({ ok: true, checkedIn: true });
    expect(t.tt.checkins.at(-1).getAll('events[]').sort()).toEqual(['40', '707', '808']);
    await readReport(t);
    await step(t, SPILL_MS);
    expect(t.core.adopt.pending()).toBe(0);
    expect(t.core.ledger.peek(NIGHT, tag).state).toBe('queued');
    const jobs = await leased(st);
    expect(jobs.map((j) => j.kind)).toEqual(['reprint']);   // only the BARF tag, ever
    expect((await t.call('GET', '/v1/desk/tonight')).body.checkedIn).toBe(2);
    expect((await t.core.friends.bagNames(NIGHT)).names).toEqual(['Kit Tester', 'Sam']);
  });

  it('a TwoTimTwo that refuses the undo changes nothing', async () => {
    const { t, st } = await barfNight();
    t.faults.undo = 'refuse';
    const res = await t.call('POST', '/v1/desk/barf-late', await body(st));
    expect(res.status).toBe(409);
    expect(t.tt.checkins).toHaveLength(0);
    expect(t.core.watcher.held('662')).toBe(false);
    expect((await t.core.friends.bagNames(NIGHT)).names).toEqual([]);
  });
});

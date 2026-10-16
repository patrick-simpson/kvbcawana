// A late BARF friend (barf.js, routes.md 5.1): ONE desk operation undoes the
// child's check-in on TwoTimTwo and redoes it with the same items plus Brought a
// friend, holding the child on the report across the gap, queues only the BARF
// tag, and records the friend for the 6:30 email and the BARF bags.
import { describe, expect, it } from 'vitest';
import { openAsStation } from '../../lobby/shared/cloud-crypto.js';
import { BARF_TAG_FALLBACK, BARF_TAG_ROUTE, HOLD_AFTER_MS, REDO_TRIES, barfTagRoute, versionAtLeast } from '../src/barf.js';
import { READ_INTERVAL_MS } from '../src/readbudget.js';
import { SPILL_MS, WATCH_INTERVAL_MS } from '../src/watcher.js';
import { CHECKIN_PAGE } from './fixtures.js';
import { everything, plainWords, sealJob } from './helpers.js';
import { NIGHT, kid, rig, row } from './rig.js';

// Kit Tester (662, Sparks) is checked in; tonight offers Bible (707), Attendance (40) and Brought a friend (808).
const PAGE = CHECKIN_PAGE.replace('checkin-box boy"', 'checkin-box boy checked-in"')
  .replace('<label>Attendance</label>', '<label>Attendance</label><input class="event" name="events[]" value="808" clubs="2,3,6"><label>Brought a friend</label>');
const PAGE_OUT = PAGE.replace('checkin-box boy checked-in"', 'checkin-box boy"');
// TwoTimTwo's real page (printer/docs/TWOTIMTWO.md 2.1): a checked-in child's row is REMOVED, not marked.
const PAGE_ROW_GONE = PAGE.replace(/<div class="clubber checkin-box boy checked-in" recid="662"[\s\S]*?<\/div><\/div>/, '');
const KIT = { id: '662', name: 'Kit Tester', club: 'Sparks', bible: true, friend: false };

const step = async (t, ms) => { t.clock.tick(ms); await t.core.watcher.tick(); };
const readReport = (t) => step(t, WATCH_INTERVAL_MS);
const leased = async (st) => (await st.call('GET', '/v1/print/next?max=10')).body.jobs;
const uuid = () => crypto.randomUUID();

/** A BARF night with Kit checked in on TwoTimTwo's page, adopted and printed (claim printed, gen 1). */
async function barfNight({ barf = true, env = {}, rowGoes = false } = {}) {
  /** @type {any} */ let ref = null;
  // The check-in page marks Kit checked in exactly while the report lists Kit.
  const t = await rig({ kids: [kid(1)], checkinPage: () => (ref && !ref.night.kids.some((k) => k.id === '662') ? PAGE_OUT : rowGoes ? PAGE_ROW_GONE : PAGE), env: { SINGLE_PUBLISHER: 'on', ...env } });
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
      // The watcher's read lands in the gap: TwoTimTwo does not list Kit right now.
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

  it('reads as a desk action on the 5 s clock: one urgent report read, the night\'s check-in page held, the hold outlasting a pushed-back report', async () => {
    const { t, st } = await barfNight();
    // A page asked for the roster: the check-in page is held for the night.
    expect((await t.call('GET', '/v1/desk/roster')).status).toBe(200);
    expect(t.core.desk.hasNightPage()).toBe(true);
    t.clock.tick(READ_INTERVAL_MS);
    const before = t.reads.length;
    const urgentBefore = t.core.watcher.budget.taken['desk-barf'] || 0;
    followPosts(t, { readDuringGap: false });
    const res = await t.call('POST', '/v1/desk/barf-late', await body(st));
    expect(res.body).toMatchObject({ ok: true, checkedIn: true });
    // ONE read: the report. The check-in page came from what the desk held.
    expect(t.reads.slice(before).map((r) => r.path)).toEqual(['/clubber/checkin_report']);
    expect(t.core.watcher.budget.taken['desk-barf']).toBe(urgentBefore + 1);
    // Every read of the night kept the clock's spacing.
    for (let i = 1; i < t.reads.length; i++) expect(t.reads[i].at - t.reads[i - 1].at).toBeGreaterThanOrEqual(READ_INTERVAL_MS);
    // The hold lasts one report cadence plus one slot past the redo (a report pushed back once).
    expect(HOLD_AFTER_MS).toBe(WATCH_INTERVAL_MS + READ_INTERVAL_MS);
    t.clock.tick(HOLD_AFTER_MS - 1000);
    expect(t.core.watcher.held('662')).toBe(true);
    t.clock.tick(2000);
    expect(t.core.watcher.held('662')).toBe(false);
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
    // The hold is gone: the next read sees the truth (Kit is not checked in, the count down),
    // but the claim stays live, waiting for the re-check-in (Kit's name tag printed).
    await readReport(t);
    await step(t, SPILL_MS);
    expect(t.core.ledger.peek(NIGHT, tag)).toMatchObject({ state: 'printed', gen: 1, recheck: { bible: true } });
    expect((await t.call('GET', '/v1/desk/tonight')).body.checkedIn).toBe(1);
    expect((await t.call('GET', '/v1/desk/barf')).body.recheck).toEqual([{ clubberId: '662', items: { Bible: true, Friend: true } }]);
    // The one-tap re-check-in: the same items plus Brought a friend, no label, no second list entry.
    followPosts(t, { readDuringGap: true });
    const again = await t.call('POST', '/v1/desk/barf-late', { night: NIGHT, clubberId: '662', recheck: true, items: res.body.items });
    expect(again.body).toMatchObject({ ok: true, checkedIn: true });
    expect(t.tt.checkins.at(-1).getAll('events[]').sort()).toEqual(['40', '707', '808']);
    await readReport(t);
    await step(t, SPILL_MS);
    expect(t.core.adopt.pending()).toBe(0);
    expect(t.core.ledger.peek(NIGHT, tag)).toMatchObject({ state: 'printed', gen: 1 });
    expect(t.core.ledger.peek(NIGHT, tag).recheck).toBeUndefined();
    expect((await t.call('GET', '/v1/desk/barf')).body.recheck).toEqual([]);
    const jobs = await leased(st);
    expect(jobs.map((j) => j.kind)).toEqual(['reprint']);   // only the BARF tag, ever
    expect((await t.call('GET', '/v1/desk/tonight')).body.checkedIn).toBe(2);
    expect((await t.core.friends.bagNames(NIGHT)).names).toEqual(['Kit Tester', 'Sam']);
  });

  it('the redo fails every try, then a NORMAL desk tap on the child: the re-check-in alone, never a second name tag; a reload still shows the red state until it takes', async () => {
    const { t, st } = await barfNight();
    const tag = await t.core.tags.identity(NIGHT, '662');
    followPosts(t, { refuse: REDO_TRIES, readDuringGap: false });
    const b = await body(st);
    expect((await t.call('POST', '/v1/desk/barf-late', b)).body).toMatchObject({ ok: true, checkedIn: false });
    expect((await leased(st)).map((j) => j.jobId)).toEqual([b.tagJob.jobId]);   // the BARF tag, out of the way
    await st.call('POST', '/v1/print/done', { jobId: b.tagJob.jobId });
    // Reads after the failed redo (Kit gone from the report, then the spill): the claim is never undone.
    await readReport(t);
    await step(t, SPILL_MS);
    await readReport(t);
    expect(t.core.ledger.peek(NIGHT, tag)).toMatchObject({ state: 'printed', recheck: { bible: true } });
    // A reloaded page (or a DO restart) learns Kit waits to be checked in again: the red line.
    t.restart();
    expect((await t.call('GET', '/v1/desk/barf')).body.recheck).toEqual([{ clubberId: '662', items: { Bible: true, Friend: true } }]);
    // A normal tap that TwoTimTwo refuses again: refused, nothing queued, still waiting.
    t.on.checkin = async () => 'refuse';
    const failed = await t.call('POST', '/v1/desk/checkin', await t.deskBody([st]));
    expect(failed.status).toBe(409);
    expect(failed.body).toMatchObject({ ok: false, reason: 'not-checked-in-again' });
    expect(await leased(st)).toEqual([]);
    expect((await t.call('GET', '/v1/desk/barf')).body.recheck).toHaveLength(1);
    // The next normal tap: TwoTimTwo's check-in with Kit's items plus Brought a friend, and NO job.
    const sentBefore = t.sent.length;
    followPosts(t, { readDuringGap: true });
    const tap = await t.call('POST', '/v1/desk/checkin', await t.deskBody([st]));
    expect(tap.status).toBe(200);
    expect(tap.body).toMatchObject({ ok: true, already: false, recheck: true, jobId: null, items: { Bible: true, Friend: true } });
    expect(t.tt.checkins.at(-1).getAll('events[]').sort()).toEqual(['40', '707', '808']);
    await readReport(t);
    await step(t, SPILL_MS);
    await readReport(t);
    await step(t, SPILL_MS);
    expect(t.core.adopt.pending()).toBe(0);
    expect(await leased(st)).toEqual([]);                     // no second name tag, ever
    expect(t.sent.slice(sentBefore).filter((f) => f.e === 'checkin')).toEqual([]);   // no greeting
    expect(t.core.ledger.peek(NIGHT, tag)).toMatchObject({ state: 'printed', gen: 1 });
    expect((await t.call('GET', '/v1/desk/barf')).body.recheck).toEqual([]);   // the red state clears
    // And now an ordinary tap is "already", as for any child checked in.
    expect((await t.call('POST', '/v1/desk/checkin', await t.deskBody([st]))).body).toMatchObject({ ok: true, already: true });
  });

  it('a redo TwoTimTwo took but answered badly: the re-check-in reads the page afresh, sees the child checked in, and posts nothing', async () => {
    const { t, st } = await barfNight();
    const tag = await t.core.tags.identity(NIGHT, '662');
    t.on.undo = async () => { t.night.kids = t.night.kids.filter((k) => k.id !== '662'); };
    let posted = 0;
    t.on.checkin = async () => {
      posted += 1;
      // TwoTimTwo keeps the check-in, but its answer never says so.
      if (!t.night.kids.some((k) => k.id === '662')) t.night.kids.push({ ...KIT, friend: true });
      return 'refuse';
    };
    const res = await t.call('POST', '/v1/desk/barf-late', await body(st));
    expect(res.body).toMatchObject({ ok: true, checkedIn: false, tries: REDO_TRIES });
    expect(posted).toBe(REDO_TRIES);
    // At once (the page the desk holds is young, and says Kit is not checked in): a fresh read decides.
    const before = t.reads.length;
    const again = await t.call('POST', '/v1/desk/barf-late', { night: NIGHT, clubberId: '662', recheck: true, items: res.body.items });
    expect(again.body).toMatchObject({ ok: true, checkedIn: true });
    expect(posted).toBe(REDO_TRIES);                                   // no post: TwoTimTwo has Kit
    expect(t.reads.slice(before).map((r) => r.path)).toContain('/clubber/checkin');
    expect(t.core.ledger.peek(NIGHT, tag).recheck).toBeUndefined();
    expect((await t.call('GET', '/v1/desk/barf')).body.recheck).toEqual([]);
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

describe('TwoTimTwo drops a checked-in child\'s row from its check-in page (owner 2026-10-14: the BARF list showed nobody)', () => {
  it('the fixture really drops the row', () => {
    expect(PAGE_ROW_GONE).not.toContain('recid="662"');
    expect(PAGE_ROW_GONE).toContain('recid="663"');
  });

  it('the roster lists the child from the report, checked in, with the club\'s id', async () => {
    const { t } = await barfNight({ rowGoes: true });
    t.clock.tick(READ_INTERVAL_MS * 3);
    const kids = (await t.call('GET', '/v1/desk/roster')).body.kids;
    expect(kids.find((k) => k.clubberId === '662')).toMatchObject({ first: 'Kit', last: 'Tester', club: 'Sparks', clubId: '2', checkedIn: true });
  });

  it('a late friend still undoes and redoes the check-in, on the page\'s meeting and items', async () => {
    const { t, st } = await barfNight({ rowGoes: true });
    followPosts(t);
    const b = await body(st);
    const res = await t.call('POST', '/v1/desk/barf-late', b);
    expect(res.body).toMatchObject({ ok: true, checkedIn: true, items: { Bible: true, Friend: true } });
    expect(t.posts.undo).toHaveLength(1);
    const redo = t.tt.checkins.at(-1);
    expect(redo.get('clubber_id')).toBe('662');
    expect(redo.get('calendar_id')).toBe('368');
    expect(redo.getAll('events[]').sort()).toEqual(['40', '707', '808']);
  });
});

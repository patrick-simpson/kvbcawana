// Early labels (owner 2026-10-15): while the last three posts to TwoTimTwo went
// fine, a desk check-in's label may print before TwoTimTwo answers. desk.js,
// ledger.js (keepForRecheck), printq.js (early jobs), end to end over the rig.
import { describe, expect, it } from 'vitest';
import { EARLY_AFTER, EARLY_FAST_MS } from '../src/desk.js';
import { CHECKIN_PAGE } from './fixtures.js';
import { NIGHT, rig } from './rig.js';

/** A check-in page with nine children, all not yet checked in. */
const CHILDREN = Array.from({ length: 9 }, (_, i) => i + 1);
const PAGE = CHECKIN_PAGE.replace(
  /<div class="clubber checkin-box boy" recid="662"[\s\S]*?<div class="clubber checkin-box girl checked-in" recid="663"[^>]*>.*?<\/div><\/div>/,
  CHILDREN.map((id) => `<div class="clubber checkin-box boy" recid="${id}" club_id="2"><div class="name">Kit Tester</div>` +
    '<div class="club"><img class="club-icon-16" alt="Sparks "></div></div>').join(''),
);

async function setup() {
  const t = await rig({ checkinPage: () => PAGE });
  const st = await t.station();
  const heard = [];
  t.core.desk.hooks.afterCheckin.push((e) => { heard.push({ gen: e.gen, jobId: e.jobId }); });
  const post = async (id, extra = {}) => t.call('POST', '/v1/desk/checkin', await t.deskBody([st], { clubberId: String(id), ...extra }));
  const lease = async () => (await st.call('GET', '/v1/print/next?max=10')).body.jobs;
  const status = async () => (await t.call('GET', '/v1/print/status')).body;
  const claimOf = async (id) => t.core.ledger.peek(NIGHT, await t.core.tags.identity(NIGHT, String(id)));
  /** Hold the next post to TwoTimTwo: `reached` says it is out, `release(verdict)` lets it answer ('refuse', 'timeout', or nothing = TwoTimTwo takes it). */
  const hold = () => {
    let release;
    let reached;
    const gate = new Promise((r) => { release = r; });
    const out = new Promise((r) => { reached = r; });
    t.on.checkin = async () => {
      t.on.checkin = null;
      reached();
      const verdict = await gate;
      if (verdict === 'timeout') throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      return verdict;
    };
    return { reached: out, release };
  };
  /** Start a check-in whose post is held; resolves with the pending response once the post is out. */
  const heldPost = async (id) => {
    const h = hold();
    const pending = post(id);
    await h.reached;
    return { pending, release: h.release };
  };
  /**
   * Three fine check-ins (kids 1..3), their labels printed. Kid 9 goes first: the first
   * post of a fresh Worker signs in and reads the page on the read clock (45 s of fake
   * time), so it is not a fine one and falls out of the last three.
   */
  const warm = async () => {
    await post(9);
    expect(t.core.desk.healthy()).toBe(false);
    for (const j of await lease()) await st.call('POST', '/v1/print/done', { jobId: j.jobId });
    for (let i = 1; i <= EARLY_AFTER; i++) {
      expect((await post(i)).body).toMatchObject({ ok: true });
      for (const j of await lease()) await st.call('POST', '/v1/print/done', { jobId: j.jobId });
    }
    expect(t.core.desk.healthy()).toBe(true);
  };
  return { t, st, heard, post, lease, status, claimOf, hold, heldPost, warm };
}

describe('early labels (owner 2026-10-15)', () => {
  it('start unhealthy: the first job is not leasable before the post settles', async () => {
    const { t, lease, heldPost } = await setup();
    expect(t.core.desk.healthy()).toBe(false);
    const { pending, release } = await heldPost(4);
    expect(await lease()).toEqual([]);
    release();
    expect((await pending).body).toMatchObject({ ok: true });
    expect(await lease()).toHaveLength(1);
  });

  it('after three fine posts the fourth label can be leased while the post is still out', async () => {
    const { t, lease, heldPost, warm, claimOf } = await setup();
    await warm();
    const { pending, release } = await heldPost(4);
    expect((await claimOf(4)).state).toBe('checking');
    const jobs = await lease();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'checkin' });
    release();
    const res = await pending;
    expect(res.body).toMatchObject({ ok: true, already: false, jobId: jobs[0].jobId });
    expect(res.body.printed).toBeUndefined();
    expect(t.tt.checkins).toHaveLength(5);  // kid 9 (warm-up) and kids 1 to 4
    expect((await claimOf(4)).state).toBe('queued');
  });

  it('only three in a row count: two fine posts after a slow one are not enough', async () => {
    const { t, post, heldPost, lease } = await setup();
    await post(9); await post(1); await post(2);   // the first is slow (sign-in and page read)
    expect(t.core.desk.healthy()).toBe(false);
    const { pending, release } = await heldPost(3);
    expect(await lease()).toHaveLength(3);   // the three settled ones; the held one is not among them
    release();
    await pending;
  });

  it('a slow post (10 s or more) resets health: the next check-in is not early', async () => {
    const { t, post, heldPost, lease, warm } = await setup();
    await warm();
    t.on.checkin = async () => { t.on.checkin = null; t.clock.tick(EARLY_FAST_MS); };
    expect((await post(4)).body).toMatchObject({ ok: true });
    expect(t.core.desk.healthy()).toBe(false);
    for (const j of await lease()) await t.call('POST', '/v1/print/done', { jobId: j.jobId }, { 'X-Station': 'station-aaaaaaaa' });
    const { pending, release } = await heldPost(5);
    expect(await lease()).toEqual([]);
    release();
    await pending;
  });

  it('a post just under 10 s keeps health', async () => {
    const { t, post, warm } = await setup();
    await warm();
    t.on.checkin = async () => { t.on.checkin = null; t.clock.tick(EARLY_FAST_MS - 1); };
    await post(4);
    expect(t.core.desk.healthy()).toBe(true);
  });

  it('a failed post resets health, and three fine ones bring it back', async () => {
    const { t, post, warm } = await setup();
    await warm();
    t.faults.checkin = 'refuse';
    expect((await post(4)).status).toBe(409);
    expect(t.core.desk.healthy()).toBe(false);
    t.faults.checkin = null;
    await post(4); await post(5);
    expect(t.core.desk.healthy()).toBe(false);
    await post(6);
    expect(t.core.desk.healthy()).toBe(true);
  });

  it('a timeout also resets health', async () => {
    const { t, post, warm } = await setup();
    await warm();
    t.faults.checkin = 'timeout';
    expect((await post(4)).status).toBe(504);
    expect(t.core.desk.healthy()).toBe(false);
  });

  it('a restart forgets the posts: health starts over', async () => {
    const { t, warm } = await setup();
    await warm();
    t.restart();
    expect(t.core.desk.healthy()).toBe(false);
  });

  it('a visitor with no clubber id is never early', async () => {
    const { t, st, lease, warm } = await setup();
    await warm();
    const body = await t.deskBody([st], { clubberId: undefined, visitor: { first: 'Zed', last: 'Visitor', club: 'Sparks' } });
    const res = await t.call('POST', '/v1/desk/checkin', body);
    expect(res.body).toMatchObject({ ok: true });
    expect(await lease()).toHaveLength(1);
  });

  describe('the post fails after the early label was leased', () => {
    it('answers the refusal with printed: true, keeps the job and the claim (recheck early), and adopt never undoes it', async () => {
      const { t, st, lease, status, claimOf, heldPost, warm } = await setup();
      await warm();
      t.faults.checkin = 'refuse';
      const { pending, release } = await heldPost(4);
      const jobs = await lease();
      expect(jobs).toHaveLength(1);
      release();
      const res = await pending;
      expect(res).toMatchObject({ status: 409, body: { ok: false, reason: 'checkin-refused', printed: true } });
      const claim = await claimOf(4);
      expect(claim).toMatchObject({ state: 'queued', jobId: jobs[0].jobId, recheck: { bible: false, friend: false, early: true } });
      expect(await status()).toMatchObject({ leased: 1, claims: { queued: 1, undone: 0 } });
      // the watcher's report says the child is gone: still not undone
      await t.core.adopt.onReport({ night: NIGHT, added: [], gone: ['4'] });
      expect((await claimOf(4)).state).toBe('queued');
      expect(await status()).toMatchObject({ leased: 1, claims: { undone: 0 } });
      // the station finishes the label: the claim is printed, still marked
      await st.call('POST', '/v1/print/done', { jobId: jobs[0].jobId });
      expect(await claimOf(4)).toMatchObject({ state: 'printed', recheck: { early: true } });
      await t.core.adopt.onReport({ night: NIGHT, added: [], gone: ['4'] });
      expect((await claimOf(4)).state).toBe('printed');
    });

    it('a timeout (unsure) is kept the same way, printed: true on the 504', async () => {
      const { lease, claimOf, heldPost, warm } = await setup();
      await warm();
      const { pending, release } = await heldPost(4);
      await lease();
      release('timeout');
      const res = await pending;
      expect(res).toMatchObject({ status: 504, body: { ok: false, reason: 'unsure', retry: true, printed: true } });
      expect((await claimOf(4)).recheck).toMatchObject({ early: true });
    });

    it('keeps what was ticked (Bible, Brought a friend) for the re-check-in', async () => {
      const { t, post, lease, claimOf, warm, hold } = await setup();
      await warm();
      t.faults.checkin = 'refuse';
      const h = hold();
      const pending = post(4, { items: { Bible: true, Friend: true } });
      await h.reached;
      await lease();
      h.release();
      await pending;
      expect((await claimOf(4)).recheck).toEqual({ bible: true, friend: true, early: true });
    });

    it('the second check-in posts again, makes no new job, answers recheck, and fires afterCheckin once', async () => {
      const { t, heard, post, lease, status, claimOf, heldPost, warm } = await setup();
      await warm();
      heard.length = 0;
      t.faults.checkin = 'refuse';
      const { pending, release } = await heldPost(4);
      const [job] = await lease();
      release();
      await pending;
      expect(heard).toEqual([]);
      const before = t.tt.checkins.length;
      // still failing: the refusal again, printed: true, the mark stays, nothing fired
      const again = await post(4);
      expect(again).toMatchObject({ status: 409, body: { ok: false, printed: true } });
      expect((await claimOf(4)).recheck).toMatchObject({ early: true });
      expect(heard).toEqual([]);
      // TwoTimTwo takes it now
      t.faults.checkin = null;
      const res = await post(4);
      expect(res).toMatchObject({ status: 200, body: { ok: true, recheck: true, jobId: job.jobId, gen: 1 } });
      expect(t.tt.checkins.length).toBe(before + 1);
      expect(t.tt.checkins.at(-1).get('clubber_id')).toBe('4');
      expect(heard).toEqual([{ gen: 1, jobId: job.jobId }]);
      expect((await claimOf(4)).recheck).toBeUndefined();
      // no second label, at any point
      expect(await lease()).toEqual([]);
      expect(await status()).toMatchObject({ queued: 0, leased: 1 });
      // and now an ordinary claim: a further tap is "already"
      expect((await post(4)).body).toMatchObject({ ok: true, already: true });
      expect(heard).toHaveLength(1);
    });

    it('the re-check-in works when the label already printed, and the claim stays printed', async () => {
      const { t, st, heard, post, lease, claimOf, heldPost, warm } = await setup();
      await warm();
      heard.length = 0;
      t.faults.checkin = 'refuse';
      const { pending, release } = await heldPost(4);
      const [job] = await lease();
      release();
      await pending;
      await st.call('POST', '/v1/print/done', { jobId: job.jobId });
      t.faults.checkin = null;
      expect((await post(4)).body).toMatchObject({ ok: true, recheck: true, jobId: job.jobId });
      expect(await claimOf(4)).toMatchObject({ state: 'printed' });
      expect((await claimOf(4)).recheck).toBeUndefined();
      expect(heard).toHaveLength(1);
      expect(await lease()).toEqual([]);
    });
  });

  describe('the post fails before any station took the early label', () => {
    it('drops the job and releases the claim, with no printed flag (as before)', async () => {
      const { t, lease, status, claimOf, post, warm } = await setup();
      await warm();
      t.faults.checkin = 'refuse';
      const res = await post(4);
      expect(res).toMatchObject({ status: 409, body: { ok: false, reason: 'checkin-refused' } });
      expect(res.body.printed).toBeUndefined();
      expect(await lease()).toEqual([]);
      expect(await status()).toMatchObject({ queued: 0, leased: 0, claims: { undone: 1 } });
      expect((await claimOf(4)).recheck).toBeUndefined();
      // a retry is a fresh check-in (gen 2) with a new job
      t.faults.checkin = null;
      expect((await post(4)).body).toMatchObject({ ok: true, gen: 2 });
      expect(await lease()).toHaveLength(1);
    });
  });

  describe('the early label prints before the post settles', () => {
    it('and the post then succeeds: the claim ends printed', async () => {
      const { t, st, lease, claimOf, heldPost, warm } = await setup();
      await warm();
      const { pending, release } = await heldPost(4);
      const [job] = await lease();
      expect((await st.call('POST', '/v1/print/done', { jobId: job.jobId })).body).toMatchObject({ ok: true, already: false });
      expect(await claimOf(4)).toMatchObject({ state: 'checking', printedEarly: true });
      release();
      expect((await pending).body).toMatchObject({ ok: true, jobId: job.jobId });
      const claim = await claimOf(4);
      expect(claim.state).toBe('printed');
      expect(claim.printedEarly).toBeUndefined();
      expect(t.tt.checkins).toHaveLength(5);  // kid 9 (warm-up) and kids 1 to 4
      expect(await lease()).toEqual([]);
    });

    it('and the post then fails: the claim is kept printed with recheck early', async () => {
      const { t, st, lease, claimOf, heldPost, warm } = await setup();
      await warm();
      t.faults.checkin = 'refuse';
      const { pending, release } = await heldPost(4);
      const [job] = await lease();
      await st.call('POST', '/v1/print/done', { jobId: job.jobId });
      release();
      expect(await pending).toMatchObject({ status: 409, body: { printed: true } });
      expect(await claimOf(4)).toMatchObject({ state: 'printed', jobId: job.jobId, recheck: { early: true } });
      expect((await claimOf(4)).printedEarly).toBeUndefined();
    });
  });
});

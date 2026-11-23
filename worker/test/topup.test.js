import { describe, expect, it } from 'vitest';
import { TOPUP_KEY, TOPUP_WHY, TopUp, parseSpecialSharePage } from '../src/topup.js';
import { TwoTimTwoClient } from '../src/twotimtwo.js';

// Store night, Wednesday 2026-11-25 at 6:30 pm Eastern (inside the watch window).
const AT = Date.parse('2026-11-25T23:30:00Z');

const PAGE = (id, balance, { meetings = ['2026-12-02', '2026-11-25', '2026-11-18'], errors = '' } = {}) => `<html><body>
<h1>Special Share Awards</h1>${errors}
<form id="clubber-special-shekel-form" action="/clubber/special_shekel/${id}" method="post">
<input type="hidden" value="tok123" name="YII_CSRF_TOKEN" />
<input name="ClubberSpecialShekel[clubber_id]" type="hidden" value="${id}" />
<select name="ClubberSpecialShekel[calendar_id]">${meetings.map((d, i) => `<option value="${390 - i}">${d}</option>`).join('')}</select>
<input name="ClubberSpecialShekel[profile_id]" type="hidden" value="77" />
<input name="ClubberSpecialShekel[shekels]" type="text" /><input name="ClubberSpecialShekel[why]" type="text" />
<button type="submit" name="yt0" value="1">Create</button></form>
Share Balance: ${balance}</body></html>`;

function memory() {
  const m = new Map();
  return { m, get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); }, delete: async (k) => m.delete(k) };
}

/** A stand-in TwoTimTwo: balances per child, every post recorded. */
function fakeClient(balances, { answer = 'given' } = {}) {
  const posts = [];
  return {
    posts,
    page: async (path) => {
      const id = /special_shekel\/(\d+)/.exec(path)[1];
      return { ok: true, html: PAGE(id, balances[id]), path };
    },
    giveSpecialShares: async (g) => {
      posts.push(g);
      if (answer === 'given') balances[g.clubberId] += g.shares;
      return { outcome: answer };
    },
  };
}

function make({ balances, before, answer, active = true, storage = memory() }) {
  const client = fakeClient(balances, { answer });
  const watcher = { clientFor: () => client, budget: { peek: () => 0 } };
  const shares = { active: () => active, tonight: () => before };
  const t = new TopUp({ storage, watcher, shares, now: () => AT, secret: () => 'state-secret' });
  return { t, client, storage };
}

async function run(t, n = 20) {
  for (let i = 0; i < n; i++) if (!(await t.step())) break;
}

describe('the Special Share Awards page', () => {
  it('reads the form parts, tonight\'s meeting and the live balance', () => {
    const f = parseSpecialSharePage(PAGE('665', 9));
    expect(f).toMatchObject({ token: 'tok123', clubberId: '665', profileId: '77', balance: 9 });
    expect(f.meetings).toContainEqual({ id: '389', date: '2026-11-25' });
  });
});

describe('store night top-up', () => {
  it('gives each checked-in child under 10 the difference, once, under tonight\'s meeting', async () => {
    const balances = { 1: 6, 2: 9, 3: 15, 4: 0 };
    const { t, client } = make({ balances, before: { 1: 5, 2: 8, 3: 14 } });
    t.onReport({ date: '2026-11-25', kids: { 1: 'Sparks', 2: 'T&T', 3: 'Sparks', 4: 'Cubbies' } });
    await t.load();
    await run(t);
    expect(client.posts.map((p) => [p.clubberId, p.shares, p.calendarId])).toEqual([['1', 4, '389'], ['2', 1, '389'], ['4', 10, '389']]);
    expect(client.posts[0]).toMatchObject({ why: TOPUP_WHY, profileId: '77', token: 'tok123', expect: 10 });
    expect(balances).toEqual({ 1: 10, 2: 10, 3: 15, 4: 10 });
    // Child 3 (14 + 1 >= 10) was never even read. Nothing left: a second pass posts nothing.
    expect(await t.step()).toBe(false);
    expect(t.view()).toMatchObject({ given: 3, shares: 15, unknown: 0, waiting: 0 });
  });

  it('a child already at 10 on the live page is left alone', async () => {
    const { t, client } = make({ balances: { 1: 10 }, before: { 1: 5 } });
    t.onReport({ date: '2026-11-25', kids: { 1: 'Sparks' } });
    await t.load();
    await run(t);
    expect(client.posts).toHaveLength(0);
    expect(t.view().full).toBe(1);
  });

  it('an unclear answer is looked at once and NEVER posted again, even after a restart', async () => {
    const storage = memory();
    const balances = { 1: 5 };
    const a = make({ balances, before: { 1: 4 }, answer: 'unknown', storage });
    a.t.onReport({ date: '2026-11-25', kids: { 1: 'Sparks' } });
    await a.t.load();
    await run(a.t);
    expect(a.client.posts).toHaveLength(1);
    expect(a.t.view().unknown).toBe(1);
    expect(JSON.stringify(storage.m.get(TOPUP_KEY))).not.toContain('"1"');   // sealed

    const b = make({ balances, before: { 1: 4 }, storage });
    b.t.onReport({ date: '2026-11-25', kids: { 1: 'Sparks' } });
    await b.t.load();
    await run(b.t);
    expect(b.client.posts).toHaveLength(0);
  });

  it('a look after an unclear answer that finds 10 counts it as given', async () => {
    const balances = { 1: 5 };
    const { t, client } = make({ balances, before: { 1: 4 }, answer: 'unknown' });
    t.onReport({ date: '2026-11-25', kids: { 1: 'Sparks' } });
    await t.load();
    await t.step();               // posts; the answer was unclear
    balances[1] = 10;             // ... but it went in
    await t.step();               // the one look
    expect(client.posts).toHaveLength(1);
    expect(t.view()).toMatchObject({ given: 1, unknown: 0 });
  });

  it('a post left half done by a restart is unknown, never posted again', async () => {
    const storage = memory();
    const balances = { 1: 5 };
    const a = make({ balances, before: { 1: 4 }, storage });
    await a.t.load();
    await a.t.mark('1', { s: 'posting', n: 5 });
    const b = make({ balances, before: { 1: 4 }, storage });
    b.t.onReport({ date: '2026-11-25', kids: { 1: 'Sparks' } });
    await b.t.load();
    await run(b.t);
    expect(b.client.posts).toHaveLength(0);
  });

  it('nothing on a night that is not store night, or with no balances read tonight', async () => {
    for (const opts of [{ active: false, before: { 1: 2 } }, { active: true, before: null }]) {
      const { t, client } = make({ balances: { 1: 2 }, ...opts });
      t.onReport({ date: '2026-11-25', kids: { 1: 'Sparks' } });
      await t.load();
      expect(await t.step()).toBe(false);
      expect(client.posts).toHaveLength(0);
    }
  });

  it('a meeting the form does not list: nothing posted', async () => {
    const balances = { 1: 3 };
    const client = fakeClient(balances);
    client.page = async () => ({ ok: true, html: PAGE('1', 3, { meetings: ['2026-12-02'] }) });
    const t = new TopUp({ storage: memory(), watcher: { clientFor: () => client, budget: { peek: () => 0 } }, shares: { active: () => true, tonight: () => ({}) }, now: () => AT, secret: () => 's' });
    t.onReport({ date: '2026-11-25', kids: { 1: 'Sparks' } });
    await t.load();
    await run(t);
    expect(client.posts).toHaveLength(0);
    expect(t.view().error).toBe('no-meeting-tonight');
  });
});

describe('the post', () => {
  const CREDS = { host: 'kvb.example', username: 'u', password: 'p' };
  const GIFT = { clubberId: '665', calendarId: '389', profileId: '77', token: 'tok', shares: 3, why: TOPUP_WHY, expect: 10 };
  function client(reply) {
    const seen = [];
    const c = new TwoTimTwoClient(CREDS, {
      fetchFn: async (url, init) => { seen.push({ url, init }); return reply(url, init); },
    });
    c.cookies.set('PHPSESSID', 'x');
    return { c, seen };
  }

  it('posts the form as the page does and is `given` only when the page shows the new balance', async () => {
    const { c, seen } = client((url) => (/special_shekel\/665$/.test(url) && seen.length === 1
      ? new Response('', { status: 302, headers: { location: '/clubber/special_shekel/665' } })
      : new Response(PAGE('665', 10), { status: 200 })));
    expect(await c.giveSpecialShares(GIFT)).toEqual({ outcome: 'given' });
    const body = new URLSearchParams(seen[0].init.body);
    expect(Object.fromEntries(body)).toMatchObject({
      'ClubberSpecialShekel[clubber_id]': '665', 'ClubberSpecialShekel[calendar_id]': '389',
      'ClubberSpecialShekel[shekels]': '3', 'ClubberSpecialShekel[why]': TOPUP_WHY, YII_CSRF_TOKEN: 'tok',
    });
  });

  it('an odd page, a 500 or no answer is unknown; a 403 or the form\'s own error is refused', async () => {
    expect((await client(() => new Response('<html><body>ok</body></html>', { status: 200 })).c.giveSpecialShares(GIFT)).outcome).toBe('unknown');
    expect((await client(() => new Response('', { status: 500 })).c.giveSpecialShares(GIFT)).outcome).toBe('unknown');
    expect((await client(() => { throw new TypeError('network'); }).c.giveSpecialShares(GIFT)).outcome).toBe('unknown');
    expect((await client(() => new Response('', { status: 403 })).c.giveSpecialShares(GIFT)).outcome).toBe('refused');
    const err = '<div class="errorSummary">Shares cannot be blank</div>';
    expect((await client(() => new Response(PAGE('665', 7, { errors: err }), { status: 200 })).c.giveSpecialShares(GIFT)).outcome).toBe('refused');
  });
});

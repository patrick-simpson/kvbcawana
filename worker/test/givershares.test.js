import { describe, expect, it } from 'vitest';
import { GIVE_KEY, GiveShares } from '../src/givershares.js';

const AT = Date.parse('2027-01-13T23:30:00Z');   // Backwards Night, 6:30 pm Eastern
const PAGE = (id, balance, meetings = ['2027-01-20', '2027-01-13']) => `<html><body>
<form id="clubber-special-shekel-form" action="/clubber/special_shekel/${id}" method="post">
<input type="hidden" value="tok" name="YII_CSRF_TOKEN" />
<input name="ClubberSpecialShekel[clubber_id]" type="hidden" value="${id}" />
<select name="ClubberSpecialShekel[calendar_id]">${meetings.map((d, i) => `<option value="${500 - i}">${d}</option>`).join('')}</select>
<input name="ClubberSpecialShekel[profile_id]" type="hidden" value="9" />
</form>Share Balance: ${balance}</body></html>`;

function memory() {
  const m = new Map();
  return { m, get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); } };
}
function make({ balances = { 7: 4 }, answer = 'given', storage = memory(), meetings } = {}) {
  const posts = [];
  const client = {
    page: async (path) => { const id = /(\d+)$/.exec(path)[1]; return { ok: true, html: PAGE(id, balances[id], meetings) }; },
    giveSpecialShares: async (g) => { posts.push(g); if (answer === 'given') balances[g.clubberId] += g.shares; return { outcome: answer }; },
  };
  const g = new GiveShares({ storage, now: () => AT, secret: () => 'state-secret', client: () => client });
  return { g, posts, storage };
}
const body = async (res) => ({ status: res.status, ...(await res.json()) });

describe('hand out shares (owner 2026-11-23)', () => {
  it('gives under tonight\'s meeting with the owner\'s reason, and never twice for one batch', async () => {
    const { g, posts, storage } = make();
    const first = await body(await g.give({ id: '7', shares: 3, why: 'Backwards Night', key: 'batch-0001' }));
    expect(first).toMatchObject({ ok: true, outcome: 'given', balance: 7 });
    expect(posts[0]).toMatchObject({ clubberId: '7', calendarId: '499', shares: 3, why: 'Backwards Night', expect: 7 });
    const again = await body(await g.give({ id: '7', shares: 3, why: 'Backwards Night', key: 'batch-0001' }));
    expect(again).toMatchObject({ outcome: 'given', repeat: true });
    expect(posts).toHaveLength(1);
    expect(await g.givenTonight()).toEqual({ 7: 3 });
    expect(JSON.stringify(storage.m.get(GIVE_KEY))).not.toContain('"7"');   // sealed
  });

  it('an unclear answer is never posted again, even after a restart', async () => {
    const storage = memory();
    const a = make({ answer: 'unknown', storage });
    expect((await body(await a.g.give({ id: '7', shares: 2, why: 'x', key: 'batch-0002' }))).outcome).toBe('unknown');
    const b = make({ storage });
    expect((await body(await b.g.give({ id: '7', shares: 2, why: 'x', key: 'batch-0002' }))).repeat).toBe(true);
    expect(b.posts).toHaveLength(0);
  });

  it('refuses what it cannot do: bad input, no meeting tonight', async () => {
    const { g, posts } = make({ meetings: ['2027-01-20'] });
    expect((await g.give({ id: 'x', shares: 1, why: 'a', key: 'batch-0003' })).status).toBe(400);
    expect((await g.give({ id: '7', shares: 21, why: 'a', key: 'batch-0003' })).status).toBe(400);
    expect((await g.give({ id: '7', shares: 1, why: ' ', key: 'batch-0003' })).status).toBe(400);
    expect((await body(await g.give({ id: '7', shares: 1, why: 'a', key: 'batch-0003' }))).reason).toBe('no-meeting-tonight');
    expect(posts).toHaveLength(0);
  });
});

describe('two requests at once (IP-20261125-06)', () => {
  it('the same key and child posts once; the other answers posting/repeat', async () => {
    const storage = memory();
    const posts = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    const balances = { 7: 4 };
    const client = {
      page: async (path) => { await gate; const id = /(\d+)$/.exec(path)[1]; return { ok: true, html: PAGE(id, balances[id]) }; },
      giveSpecialShares: async (g) => { posts.push(g); return { outcome: 'given' }; },
    };
    const g = new GiveShares({ storage, now: () => AT, secret: () => 'state-secret', client: () => client });
    const one = g.give({ id: '7', shares: 2, why: 'x', key: 'batch-0009' });
    const two = g.give({ id: '7', shares: 2, why: 'x', key: 'batch-0009' });
    release();
    const [a, b] = await Promise.all([one, two]);
    expect(posts).toHaveLength(1);
    const outs = [await body(a), await body(b)];
    expect(outs.filter((o) => o.repeat)).toHaveLength(1);
  });
});

describe('the banner\'s list (owner 2026-11-23)', () => {
  it('names only the children a Give actually gave to', async () => {
    const { g } = make({ balances: { 7: 4, 8: 2 } });
    await g.give({ id: '7', shares: 2, why: 'x', key: 'batch-0009' });
    expect((await g.givenIn('batch-0009')).ids).toEqual(['7']);
    expect((await g.givenIn('other-000')).ids).toEqual([]);
  });
});

// The night's claims (ledger.js).
import { describe, expect, it } from 'vitest';
import { CHECKING_TTL_MS, Ledger, Tags } from '../src/ledger.js';
import { churchNight } from '../../shared/cloud-crypto.js';
import { everything, fakeClock, memoryStore } from './helpers.js';

const NIGHT = '2026-10-14';

function setup() {
  const clock = fakeClock();
  const storage = memoryStore();
  const ledger = new Ledger({ storage, now: clock.now });
  const tags = new Tags(() => 'right-pass');
  return { clock, storage, ledger, tags };
}

describe('tags', () => {
  it('are HMACs of the night and the id: stable, per night, never the id', async () => {
    const { tags } = setup();
    const a = await tags.identity(NIGHT, '662');
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await tags.identity(NIGHT, '662')).toBe(a);
    expect(await tags.identity('2026-10-21', '662')).not.toBe(a);
    expect(await tags.identity(NIGHT, '663')).not.toBe(a);
    expect(await tags.visitor(NIGHT, 'Zed  Visitor', 'Sparks')).toBe(await tags.visitor(NIGHT, 'zed visitor', 'sparks'));
  });

  it('need the secret: none, no tag', async () => {
    expect(await new Tags(() => null).identity(NIGHT, '662')).toBeNull();
  });

  it('use the church\'s local night, not UTC', () => {
    // 9 pm EDT on a Wednesday is already Thursday in UTC
    expect(churchNight(Date.parse('2026-10-15T01:00:00Z'))).toBe('2026-10-14');
  });
});

describe('the claim lifecycle', () => {
  it('checking, then queued, then printed', async () => {
    const { ledger, tags } = setup();
    const tag = await tags.identity(NIGHT, '662');
    const c = await ledger.claim(NIGHT, tag, { source: 'desk' });
    expect(c).toEqual({ ok: true, gen: 1, regen: false });
    expect(await ledger.settle(NIGHT, tag, 1, 'job-1')).toEqual({ ok: true });
    expect(ledger.peek(NIGHT, tag)).toMatchObject({ state: 'queued', gen: 1, jobId: 'job-1' });
    expect(await ledger.markPrinted(NIGHT, tag, 1)).toBe(true);
    expect(ledger.peek(NIGHT, tag).state).toBe('printed');
  });

  it('a second claim answers already, with the job to point at', async () => {
    const { ledger, tags } = setup();
    const tag = await tags.identity(NIGHT, '662');
    await ledger.claim(NIGHT, tag);
    expect(await ledger.claim(NIGHT, tag)).toMatchObject({ ok: false, already: true, state: 'checking' });
    await ledger.settle(NIGHT, tag, 1, 'job-1');
    expect(await ledger.claim(NIGHT, tag)).toMatchObject({ ok: false, already: true, state: 'queued', jobId: 'job-1' });
  });

  it('checking lasts 60 s; then the next claim takes over and the old attempt cannot settle', async () => {
    const { ledger, tags, clock } = setup();
    const tag = await tags.identity(NIGHT, '662');
    await ledger.claim(NIGHT, tag);
    clock.tick(CHECKING_TTL_MS - 1);
    expect((await ledger.claim(NIGHT, tag)).ok).toBe(false);
    clock.tick(1);
    expect(await ledger.claim(NIGHT, tag)).toEqual({ ok: true, gen: 2, regen: true });
    expect((await ledger.settle(NIGHT, tag, 1, 'late')).ok).toBe(false);
    expect((await ledger.settle(NIGHT, tag, 2, 'job-2')).ok).toBe(true);
  });

  it('promotes a checking claim when the child is on the report', async () => {
    const { ledger, tags } = setup();
    const tag = await tags.identity(NIGHT, '662');
    await ledger.claim(NIGHT, tag);
    expect(await ledger.promote(NIGHT, tag)).toBe(true);
    expect(ledger.peek(NIGHT, tag).state).toBe('queued');
    expect(await ledger.promote(NIGHT, tag)).toBe(false);
  });

  it('release keeps the gen (never repeats it); the next attempt is gen + 1', async () => {
    const { ledger, tags } = setup();
    const tag = await tags.identity(NIGHT, '662');
    await ledger.claim(NIGHT, tag);
    expect((await ledger.release(NIGHT, tag, 1)).ok).toBe(true);
    expect(ledger.peek(NIGHT, tag)).toMatchObject({ state: 'undone', gen: 1 });
    expect(await ledger.claim(NIGHT, tag)).toEqual({ ok: true, gen: 2, regen: true });
  });

  it('undo bumps the gen; undone then re-check-in bumps it again; a printed claim is undone too', async () => {
    const { ledger, tags } = setup();
    const tag = await tags.identity(NIGHT, '662');
    await ledger.claim(NIGHT, tag);
    await ledger.settle(NIGHT, tag, 1, 'j1');
    await ledger.markPrinted(NIGHT, tag, 1);
    expect(await ledger.undo(NIGHT, tag)).toEqual({ ok: true, was: 'printed', gen: 2 });
    expect(await ledger.undo(NIGHT, tag)).toMatchObject({ ok: false, was: 'undone' });
    expect(ledger.peek(NIGHT, tag).gen).toBe(2);
    expect(await ledger.claim(NIGHT, tag, { source: 'ttt', initial: 'queued' })).toEqual({ ok: true, gen: 3, regen: true });
    expect(ledger.peek(NIGHT, tag)).toMatchObject({ state: 'queued', source: 'ttt' });
  });

  it('a stale gen never marks printed', async () => {
    const { ledger, tags } = setup();
    const tag = await tags.identity(NIGHT, '662');
    await ledger.claim(NIGHT, tag);
    await ledger.settle(NIGHT, tag, 1, 'j1');
    await ledger.undo(NIGHT, tag);
    await ledger.claim(NIGHT, tag, { initial: 'queued' });
    expect(await ledger.markPrinted(NIGHT, tag, 1)).toBe(false);
    expect(await ledger.markPrinted(NIGHT, tag, 3)).toBe(true);
  });
});

describe('interleaving', () => {
  it('two claims at once for one child: exactly one wins', async () => {
    const { ledger, tags } = setup();
    const tag = await tags.identity(NIGHT, '662');
    const results = await Promise.all([ledger.claim(NIGHT, tag), ledger.claim(NIGHT, tag), ledger.claim(NIGHT, tag)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.already)).toHaveLength(2);
  });

  it('a slow post between claim and settle cannot let a second desk in', async () => {
    const { ledger, tags } = setup();
    const tag = await tags.identity(NIGHT, '662');
    const deskA = (async () => {
      const c = await ledger.claim(NIGHT, tag);
      await new Promise((r) => setTimeout(r, 5)); // the TwoTimTwo post
      return c.ok ? ledger.settle(NIGHT, tag, c.gen, 'a') : { ok: false };
    })();
    const deskB = (async () => {
      await new Promise((r) => setTimeout(r, 1));
      return ledger.claim(NIGHT, tag);
    })();
    const [a, b] = await Promise.all([deskA, deskB]);
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, already: true });
  });

  it('an undo racing a settle: whichever the gen allows, never both', async () => {
    const { ledger, tags } = setup();
    const tag = await tags.identity(NIGHT, '662');
    await ledger.claim(NIGHT, tag);
    const [s, u] = await Promise.all([ledger.settle(NIGHT, tag, 1, 'j'), ledger.undo(NIGHT, tag)]);
    expect(s.ok).toBe(true);          // settle ran first (queued)...
    expect(u).toMatchObject({ ok: true, was: 'queued' });   // ...and the undo killed it
    expect(ledger.peek(NIGHT, tag)).toMatchObject({ state: 'undone', gen: 2 });
  });
});

describe('storage', () => {
  it('holds no clubber id, no name, no secret, only tags', async () => {
    const { ledger, tags, storage } = setup();
    const tag = await tags.identity(NIGHT, '662');
    const v = await tags.visitor(NIGHT, 'Zed Visitor', 'Sparks');
    await ledger.claim(NIGHT, tag);
    await ledger.claim(NIGHT, v, { source: 'desk' });
    const all = everything(storage);
    expect(all).not.toContain('662');
    expect(all).not.toMatch(/zed|visitor|right-pass/i);
    expect(all).toContain(tag);
  });

  it('a restarted object (new instance over the same storage) carries on', async () => {
    const { ledger, tags, storage, clock } = setup();
    const tag = await tags.identity(NIGHT, '662');
    await ledger.claim(NIGHT, tag);
    await ledger.settle(NIGHT, tag, 1, 'j1');
    await ledger.undo(NIGHT, tag);
    const again = new Ledger({ storage, now: clock.now });
    expect(await again.claim(NIGHT, tag)).toEqual({ ok: true, gen: 3, regen: true });
    expect(await again.counts(NIGHT)).toEqual({ checking: 1, queued: 0, printed: 0, undone: 0 });
  });

  it('is purged at the end of the night, and another night starts clean', async () => {
    const { ledger, tags, storage } = setup();
    const tag = await tags.identity(NIGHT, '662');
    await ledger.claim(NIGHT, tag);
    expect(await ledger.purge(null)).toBe(1);
    expect(ledger.peek(NIGHT, tag)).toBeUndefined();
    expect(JSON.stringify([...storage.map.values()])).not.toContain(tag);
    await ledger.claim(NIGHT, tag);
    expect((await ledger.claim('2026-10-21', tag)).ok).toBe(true); // a new night: gen 1 again
  });
});

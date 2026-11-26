import { describe, expect, it } from 'vitest';
import { Theme } from '../src/theme.js';

const JAN13_5PM = Date.parse('2027-01-13T22:00:00Z');
function memory(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { m, get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); }, delete: async (k) => m.delete(k) };
}

describe('Backwards Night switch', () => {
  it('Automatic follows the church calendar; On and Off override it', async () => {
    const storage = memory({ calendar: { events: [{ date: '2027-01-13', title: 'Backwards Night' }] } });
    const t = new Theme({ storage, now: () => JAN13_5PM });
    await t.prepare();
    expect(t.view()).toMatchObject({ backwards: true, mode: 'auto', calendarSaysBackwards: true });
    expect((await t.setMode('off', { name: 'Phone' })).backwards).toBe(false);
    const quiet = new Theme({ storage: memory(), now: () => JAN13_5PM });
    await quiet.prepare();
    expect(quiet.backwards()).toBe(false);
    expect((await quiet.setMode('on', null)).backwards).toBe(true);
    expect(await quiet.setMode('sideways', null)).toBe(null);
  });
});

describe('Backwards On lasts for tonight only (IP-20261125-05)', () => {
  it('On from one day is Automatic the next; an old On with no date too; Off stays', async () => {
    const clock = { t: JAN13_5PM };
    const storage = memory();
    const t = new Theme({ storage, now: () => clock.t });
    await t.prepare();
    await t.setMode('on', null);
    expect(t.backwards()).toBe(true);
    clock.t = JAN13_5PM + 24 * 3600 * 1000;
    expect(t.mode).toBe('auto');
    expect(t.backwards()).toBe(false);
    await t.setMode('off', null);
    clock.t += 7 * 24 * 3600 * 1000;
    expect(t.mode).toBe('off');
    const old = new Theme({ storage: memory({ 'theme:backwards': { mode: 'on', at: null, by: null } }), now: () => JAN13_5PM });
    await old.prepare();
    expect(old.mode).toBe('auto');
  });
});


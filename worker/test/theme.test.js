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

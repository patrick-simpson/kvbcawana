import { describe, expect, it } from 'vitest';
import { KEY_TOLD_MS, KEYS, KeyHealth } from '../src/keys.js';
import { memoryStore } from './helpers.js';

// The keys the service runs on (owner 2026-11-15: "One place that shows what's about to
// break", after the print token expired with nobody told): src/keys.js, routes.md 10.6.

function setup(env = {}) {
  const storage = memoryStore();
  let t = Date.parse('2026-11-15T15:00:00Z');
  const told = [];
  const keys = new KeyHealth({ storage, now: () => t, env: () => env, tell: async (subject, text) => { told.push({ subject, text }); } });
  return { keys, storage, told, tick: (ms) => { t += ms; } };
}
const byId = (list, id) => list.find((k) => k.id === id);
const SET = { TWOTIMTWO_USERNAME: 'u', TWOTIMTWO_PASSWORD: 'p', PRINT_DISPATCH_TOKEN: 'gh', MS_TENANT_ID: 't', MS_CLIENT_ID: 'c', MS_CLIENT_SECRET: 's', HANDBOOK_TOKEN: 'h' };

describe('the keys the service runs on', () => {
  it('says which keys are not set up, and never a value', async () => {
    const { keys } = setup({ PRINT_DISPATCH_TOKEN: 'secret-value-123' });
    const list = await keys.list();
    expect(list.map((k) => k.id)).toEqual(KEYS.map((k) => k.id));
    expect(byId(list, 'mail')).toMatchObject({ state: 'not-set', words: 'Not set up.' });
    expect(byId(list, 'youtube')).toMatchObject({ state: 'not-set', optional: true, words: 'Not set up (optional).' });
    expect(byId(list, 'print')).toMatchObject({ state: 'unknown' });
    expect(JSON.stringify(list)).not.toContain('secret-value-123');
  });

  it('a key that worked and is then refused shows failing and mails the Awana mailbox once', async () => {
    const { keys, told, tick, storage } = setup(SET);
    await keys.note('print', true, 204);
    expect(byId(await keys.list(), 'print')).toMatchObject({ state: 'ok', words: 'Working.' });
    await keys.note('print', false, 401);
    const row = byId(await keys.list(), 'print');
    expect(row).toMatchObject({ state: 'failing', since: '2026-11-15T15:00:00.000Z' });
    expect(row.fix).toMatch(/PRINT_DISPATCH_TOKEN/);
    expect(told).toHaveLength(1);
    expect(told[0].subject).toBe('Printing from the web (GitHub token) has stopped working');
    // Refused again: no second mail; working again: back to ok; failing again within the week: still no mail.
    await keys.note('print', false, 401);
    await keys.note('print', true, 204);
    tick(60 * 60 * 1000);
    await keys.note('print', false, 403);
    expect(told).toHaveLength(1);
    tick(KEY_TOLD_MS);
    await keys.note('print', true, 204);
    await keys.note('print', false, 401);
    expect(told).toHaveLength(2);
    // Kept across a restart.
    const again = new KeyHealth({ storage, now: () => Date.now(), env: () => SET });
    expect(byId(await again.list(), 'print').state).toBe('failing');
  });

  it('the same answer again writes nothing; the mail key never mails about itself', async () => {
    const { keys, told, storage } = setup(SET);
    await keys.note('mail', true);
    const writes = storage.map.size;
    await keys.note('mail', true);
    expect(storage.map.size).toBe(writes);
    await keys.note('mail', false, 401);
    expect(byId(await keys.list(), 'mail').state).toBe('failing');
    expect(told).toHaveLength(0);   // it cannot send mail when its own key fails
  });

  it('the Microsoft secret ending shows on the mail key; TwoTimTwo comes from the reader', async () => {
    const { keys } = setup(SET);
    await keys.note('mail', true);
    expect(byId(await keys.list({ secretDaysLeft: 12 }), 'mail')).toMatchObject({ state: 'ending', words: 'Its secret ends in 12 days.' });
    expect(byId(await keys.list({ secretDaysLeft: -1 }), 'mail')).toMatchObject({ state: 'failing' });
    expect(byId(await keys.list({ secretDaysLeft: 300 }), 'mail').state).toBe('ok');
    expect(byId(await keys.list({ read: { loginBlockedForSec: 600 } }), 'twotimtwo').state).toBe('failing');
    expect(byId(await keys.list({ read: { lastOkAt: '2026-11-15T14:59:00Z' } }), 'twotimtwo').state).toBe('ok');
    expect(byId(await keys.list({}), 'twotimtwo').state).toBe('unknown');
  });
});

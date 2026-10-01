import { describe, expect, it, vi } from 'vitest';
import defaults from '../config.js';
import { PRINT_SERVER_SETTINGS_URL, publishSettings } from './publishSettings.js';

const reply = (status, body) => vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));

describe('publishSettings', () => {
  it('POSTs only the shared keys, with the token, to the print server on this computer', async () => {
    const fetchFn = reply(200, { ok: true, rev: 3, publishedAt: '2026-10-01T23:35:00.000Z', keyCount: 36 });
    const out = await publishSettings({ ...defaults, backgroundSource: 'video', milestoneEvery: 30 }, ' tok ', { fetchFn });
    expect(out).toEqual({ ok: true, rev: 3, publishedAt: '2026-10-01T23:35:00.000Z', keyCount: 36 });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(PRINT_SERVER_SETTINGS_URL);
    expect(init.headers.Authorization).toBe('Bearer tok');
    const sent = JSON.parse(init.body).settings;
    expect(sent.milestoneEvery).toBe(30);
    expect('backgroundSource' in sent).toBe(false);
    expect('pusherAppKey' in sent).toBe(false);
  });

  it('without a token it does not even try', async () => {
    const fetchFn = vi.fn();
    expect((await publishSettings(defaults, '', { fetchFn })).reason).toBe('no-token');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('says plainly when this screen cannot reach the print server', async () => {
    const out = await publishSettings(defaults, 'tok', { fetchFn: vi.fn(async () => { throw new TypeError('blocked'); }) });
    expect(out).toMatchObject({ ok: false, reason: 'unreachable' });
    expect(out.message).toMatch(/check-in computer/);
  });

  it('passes on the server’s own words, and names an old server', async () => {
    expect(await publishSettings(defaults, 'tok', { fetchFn: reply(403, { error: 'Wrong publish token.' }) }))
      .toEqual({ ok: false, reason: 'auth', message: 'Wrong publish token.' });
    expect((await publishSettings(defaults, 'tok', { fetchFn: reply(404, null) })).message).toMatch(/too old/);
  });
});

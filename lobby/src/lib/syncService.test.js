import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SYNC_SESSION_STORAGE,
  describeBarfBags,
  describeCloudTest,
  SYNC_URL_STORAGE,
  isValidSyncUrl,
  loadSyncSession,
  resolveSyncUrl,
  saveSyncSession,
  syncLogin,
  syncPublish,
  templatePatch,
  wirePayloads,
} from './syncService.js';
import { DISPLAY_KEY_STORAGE, loadDisplayKey } from './displayKey.js';
import { sanitizeOverrides } from '../hooks/useConfig.js';
import { parseUrlFlags } from './urlFlags.js';
import { sanitizeSettings, sanitizeSlidesChunk } from './eventSanitizers.js';

const BASE = 'https://awana-sync.example.workers.dev';
const SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';
const KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';

/** @param {number} status @param {unknown} body */
const answer = (status, body) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the session is a secret, stored apart from every setting', () => {
  it('lives in its own slot, never awanaConfig.v1', () => {
    expect(SYNC_SESSION_STORAGE).not.toBe('awanaConfig.v1');
    saveSyncSession(SESSION);
    expect(loadSyncSession()).toBe(SESSION);
    expect(localStorage.getItem('awanaConfig.v1')).toBeNull();
    saveSyncSession('');
    expect(localStorage.getItem(SYNC_SESSION_STORAGE)).toBeNull();
  });

  it('cannot be set by a ?config= file, an import or the URL', () => {
    expect(sanitizeOverrides({ syncSession: SESSION, awanaSyncSession: SESSION })).toEqual({});
    const flags = parseUrlFlags(`?session=${SESSION}&syncSession=${SESSION}`);
    expect(JSON.stringify(flags)).not.toContain(SESSION);
  });

  it('ignores junk in its slot', () => {
    localStorage.setItem(SYNC_SESSION_STORAGE, 'not-a-session');
    expect(loadSyncSession()).toBe('');
  });

  it('survives blocked storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(saveSyncSession(SESSION)).toBe(false);
  });
});

describe('finding the service', () => {
  it('reads shared/sync.json and remembers it for an offline boot', async () => {
    const url = await resolveSyncUrl({ base: '/', fetchFn: answer(200, { url: `${BASE}/` }) });
    expect(url).toBe(BASE);
    expect(localStorage.getItem(SYNC_URL_STORAGE)).toBe(BASE);
    const offline = await resolveSyncUrl({ base: '/', fetchFn: vi.fn(async () => { throw new Error('offline'); }) });
    expect(offline).toBe(BASE);
  });

  it('an empty url means "no service yet"', async () => {
    expect(await resolveSyncUrl({ base: '/', fetchFn: answer(200, { url: '' }) })).toBe('');
  });

  it('only https, with no query, fragment or credentials', () => {
    expect(isValidSyncUrl(BASE)).toBe(true);
    expect(isValidSyncUrl('http://awana-sync.example.workers.dev')).toBe(false);
    expect(isValidSyncUrl(`${BASE}?x=1`)).toBe(false);
    expect(isValidSyncUrl('https://u:p@example.org')).toBe(false);
    expect(isValidSyncUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('signing in', () => {
  it('saves the session and the display key, and returns the rest for the caller', async () => {
    const fetchFn = answer(200, {
      session: SESSION, displayKey: KEY,
      state: { template: { savedAt: 'x', config: { audioMuted: true, pusherAppKey: 'no' } } },
    });
    const res = await syncLogin(BASE, 'kennebec', { fetchFn });
    expect(res).toMatchObject({ ok: true, template: { audioMuted: true } });
    expect(res).not.toHaveProperty('pusher');
    expect(loadSyncSession()).toBe(SESSION);
    expect(loadDisplayKey()).toBe(KEY);
    expect(localStorage.getItem(DISPLAY_KEY_STORAGE)).toBe(KEY);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`${BASE}/v1/login`);
    expect(JSON.parse(init.body)).toEqual({ passphrase: 'kennebec' });
  });

  it('words each refusal by what to do', async () => {
    expect(await syncLogin(BASE, 'x', { fetchFn: answer(401, { triesLeft: 3 }) })).toMatchObject({ ok: false, reason: 'wrong', triesLeft: 3 });
    expect(await syncLogin(BASE, 'x', { fetchFn: answer(429, { retryAfterSec: 600 }) })).toMatchObject({ reason: 'locked', retryAfterSec: 600 });
    expect(await syncLogin(BASE, 'x', { fetchFn: answer(503, {}) })).toMatchObject({ reason: 'not-set-up' });
    expect(await syncLogin(BASE, 'x', { fetchFn: vi.fn(async () => { throw new Error('down'); }) })).toMatchObject({ reason: 'unreachable' });
    expect(loadSyncSession()).toBe('');
  });

  it('refuses an answer without a usable key or session, and saves nothing', async () => {
    const res = await syncLogin(BASE, 'kennebec', { fetchFn: answer(200, { session: SESSION, displayKey: 'short' }) });
    expect(res).toMatchObject({ ok: false, reason: 'rejected' });
    expect(loadSyncSession()).toBe('');
    expect(loadDisplayKey()).toBe('');
  });
});

describe('the template', () => {
  it('fills only what this screen has not set itself, through the allowlist', () => {
    expect(templatePatch(
      { audioMuted: true, confettiLevel: 'off', reduceMotion: true, panicMode: true },
      { confettiLevel: 'full' },
    )).toEqual({ audioMuted: true, reduceMotion: true });
  });
});

describe('the state enters through the wire sanitizers', () => {
  it('maps to a settings payload and a one-chunk deck the sanitizers accept', () => {
    const { settings, slides } = wirePayloads({
      settings: { rev: 3, publishedAt: '2026-10-01T18:00:00.000Z', settings: { showClock: false } },
      slides: { deckRev: 2, publishedAt: '2026-10-01T18:00:00.000Z', slides: [{ text: 'Hi', eyebrow: '', theme: 'auto', textSize: 'auto', durationSec: 0 }] },
    });
    expect(sanitizeSettings(settings)).toMatchObject({ rev: 3, settings: { showClock: false } });
    expect(sanitizeSlidesChunk(slides)).toMatchObject({ seq: 0, total: 1, slides: [expect.objectContaining({ text: 'Hi' })] });
  });

  it('nothing yet is nothing', () => {
    expect(wirePayloads({ settings: null, slides: null })).toEqual({ settings: null, slides: null });
    expect(wirePayloads(null)).toEqual({ settings: null, slides: null });
  });
});

describe('publishing', () => {
  it('returns publishSettings / publishDeck shapes', async () => {
    const s = await syncPublish(BASE, SESSION, 'settings', { a: 1 }, { fetchFn: answer(200, { rev: 4, publishedAt: 'p', keyCount: 1 }) });
    expect(s).toEqual({ ok: true, rev: 4, publishedAt: 'p', keyCount: 1 });
    const fetchFn = answer(200, { deckRev: 2, publishedAt: 'p', slideCount: 3, droppedCount: 1 });
    const d = await syncPublish(BASE, SESSION, 'slides', [], { fetchFn });
    expect(d).toEqual({ ok: true, deckRev: 2, publishedAt: 'p', slideCount: 3, droppedCount: 1 });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`${BASE}/v1/slides`);
    expect(init.method).toBe('PUT');
    expect(init.headers.Authorization).toBe(`Bearer ${SESSION}`);
  });

  it('a signed-out or unreachable service says so', async () => {
    expect(await syncPublish(BASE, SESSION, 'settings', {}, { fetchFn: answer(401, {}) })).toMatchObject({ ok: false, reason: 'auth' });
    expect(await syncPublish(BASE, SESSION, 'settings', {}, { fetchFn: vi.fn(async () => { throw new Error('x'); }) })).toMatchObject({ ok: false, reason: 'unreachable' });
    expect(await syncPublish(BASE, SESSION, 'slides', [], { fetchFn: answer(413, { error: 'too big' }) })).toMatchObject({ ok: false, reason: 'rejected', message: 'too big' });
  });
});

describe('a feed link that carries the passphrase (OBS, ProPresenter)', () => {
  it('reads ?passphrase= or ?p=, normalized like a typed word', async () => {
    const { passphraseFromUrl } = await import('../hooks/useSync.js');
    expect(passphraseFromUrl('?passphrase=%20Kennebec%20&key=x')).toBe('kennebec');
    expect(passphraseFromUrl('?p=KENNEBEC')).toBe('kennebec');
    expect(passphraseFromUrl('?key=x')).toBe('');
  });
});

describe('the cloud check-in test button\'s words', () => {
  const ok = (body) => describeCloudTest({ ok: true, status: 200, body });
  const page = { ok: true, calendarId: '368', events: 3 };

  it('a working sign-in says so, with today\'s count and the check-in page', () => {
    const r = ok({ ok: true, verdict: 'baseline', status: { checkedIn: 0, checkinPage: page } });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('Signed in to TwoTimTwo and read today’s report: 0 children checked in today. The check-in page read too (meeting 368, 3 check-in items).');
    expect(ok({ ok: true, status: { checkedIn: 1, checkinPage: page } }).text).toContain('1 child checked in');
  });

  it('a report that only partly parsed, or an unreadable check-in page, is not a pass', () => {
    expect(ok({ ok: true, status: { checkedIn: null, checkinPage: page } }).text).toContain('only partly readable');
    const r = ok({ ok: true, status: { checkedIn: 4, checkinPage: { ok: false, error: 'checkin-page-unreadable' } } });
    expect(r).toMatchObject({ ok: false });
    expect(r.text).toContain('Record Checkin');
  });

  it('names each failure in words, never a bare code', () => {
    expect(describeCloudTest({ ok: false, status: 0, body: null }).text).toContain('Could not reach the sync service');
    expect(describeCloudTest({ ok: false, status: 401, body: {} }).text).toContain('signed out');
    expect(describeCloudTest({ ok: false, status: 404, body: {} }).text).toContain('next deploy');
    expect(ok({ ok: false, error: 'not-configured', status: {} }).text).toContain('TWOTIMTWO_USERNAME');
    expect(ok({ ok: false, error: 'off', status: {} }).text).toContain('switched off');
    expect(ok({ ok: false, error: 'login-refused', status: {} }).text).toContain('refused the user name or password');
    expect(ok({ ok: false, error: 'login-backoff', status: { loginBlockedForSec: 290 } }).text).toContain('waiting 5 minutes');
    expect(ok({ ok: false, error: 'login-backoff', status: { loginBlockedForSec: 20 } }).text).toContain('waiting 1 minute ');
    for (const code of ['twotimtwo-down', 'timeout', 'network', 'signed-out', 'report-unreadable', 'off-site-redirect']) {
      const r = ok({ ok: false, error: code, status: {} });
      expect(r.ok).toBe(false);
      expect(r.text).not.toContain(code);
    }
    expect(ok({ ok: false, error: 'something-new', status: {} }).text).toContain('(something-new)');
  });

  it('a press inside TwoTimTwo\'s 15 seconds reports the read just made', () => {
    expect(ok({ ok: true, throttled: true, status: { checkedIn: 2, checkinPage: page } }).text).toMatch(/^Read 15 seconds ago .*2 children checked in/);
    expect(ok({ ok: true, throttled: true, status: { lastError: 'login-refused' } })).toMatchObject({ ok: false });
  });
});

describe('the club-night test\'s words (the button\'s own read)', () => {
  const ok = (test, extra = {}) => describeCloudTest({ ok: true, status: 200, body: { ok: test.ok, test, status: {}, ...extra } });
  const page = { ok: true, calendarId: '368', events: 3 };

  it('a pass names the night and its count, to hold against the laptop', () => {
    const r = ok({ ok: true, date: '2026-10-07', checkedIn: 11, partial: false, checkinPage: page });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('Signed in to TwoTimTwo and read the report for Wednesday, Oct 7: 11 children checked in. ' +
      'The check-in page read too (meeting 368, 3 check-in items). It should match the laptop’s count for that night.');
  });

  it('a short read is not a pass', () => {
    const r = ok({ ok: true, date: '2026-10-07', checkedIn: 9, partial: true, checkinPage: page });
    expect(r.ok).toBe(false);
    expect(r.text).toContain('so this is short');
  });

  it('an unreadable report says what the page looked like', () => {
    const r = ok({ ok: false, date: '2026-10-07', error: 'report-unreadable', shape: { title: 'KVBC - Checkin Report', tables: 1, clubTables: 0 } });
    expect(r.ok).toBe(false);
    expect(r.text).toContain('the report for Wednesday, Oct 7 did not look like the report (page “KVBC - Checkin Report”, 1 tables, 0 with a club)');
  });

  it('other failures keep their words, and a quick second press reports the last test', () => {
    expect(ok({ ok: false, date: '2026-10-07', error: 'login-refused' }).text).toContain('refused the user name or password');
    const again = ok({ ok: true, date: '2026-10-07', checkedIn: 2, checkinPage: page }, { throttled: true });
    expect(again.text).toMatch(/^Read a moment ago .*2 children checked in/);
  });
});

describe('the BARF Bag button\'s words', () => {
  const ans = (body) => describeBarfBags({ ok: true, status: 200, body });
  it('names what went, and what could not', () => {
    expect(ans({ ok: true, labels: 1, kids: 1, friends: 0, unnamed: 1 }).text).toBe('Sent 1 BARF Bag label to the label printer as one job: 1 child and 0 friends. 1 friend was checked in at TwoTimTwo’s desk box with no name, so no label for them.');
    expect(ans({ ok: false, reason: 'none' }).text).toContain('Nobody has been checked in with Brought a friend');
    expect(ans({ ok: false, reason: 'laptop-off' })).toMatchObject({ ok: false, text: expect.stringContaining('laptop is not on') });
    expect(describeBarfBags({ ok: false, status: 404, body: {} }).text).toContain('next deploy');
  });
});

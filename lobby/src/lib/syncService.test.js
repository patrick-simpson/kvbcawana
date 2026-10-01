import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SYNC_SESSION_STORAGE,
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
      session: SESSION, displayKey: KEY, pusher: { key: 'pk', cluster: 'us2' },
      state: { template: { savedAt: 'x', config: { audioMuted: true, pusherAppKey: 'no' } } },
    });
    const res = await syncLogin(BASE, 'kennebec', { fetchFn });
    expect(res).toMatchObject({ ok: true, pusher: { key: 'pk', cluster: 'us2' }, template: { audioMuted: true } });
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

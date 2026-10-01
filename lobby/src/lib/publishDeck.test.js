import { describe, it, expect } from 'vitest';
import { publishDeck } from './publishDeck.js';

// A pure fetch wrapper: the assertions are about the request it builds and
// the honest, operator-facing shape of each failure.

const TOKEN = 'tok_AbCdEfGhIjKlMnOpQrStUvWx';

const okResponse = (body) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(body),
});

const errResponse = (status, body) => ({
  ok: false,
  status,
  json: () => Promise.resolve(body),
});

describe('publishDeck', () => {
  it('refuses to fire without a token, with setup guidance', async () => {
    const result = await publishDeck([{ text: 'x' }], '', { fetchFn: () => { throw new Error('must not fetch'); } });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-token');
    expect(result.message).toMatch(/Lobby Slides/);
  });

  it('POSTs the sanitized text-only deck with the bearer token', async () => {
    let seen;
    const fetchFn = (url, init) => {
      seen = { url, init };
      return Promise.resolve(okResponse({ deckRev: 4, publishedAt: '2026-09-16T22:12:00.000Z', slideCount: 1, droppedCount: 0 }));
    };
    const result = await publishDeck(
      [
        { text: 'Keep me' },
        { type: 'video', videoId: 'v_1', videoName: 'a.mp4' },
      ],
      ` ${TOKEN} `,
      { fetchFn },
    );
    expect(result).toMatchObject({ ok: true, deckRev: 4, slideCount: 1 });
    expect(seen.url).toBe('http://localhost:3456/api/lobby-slides');
    expect(seen.init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(seen.init.body);
    expect(body.slides).toHaveLength(1);
    expect(body.slides[0].text).toBe('Keep me');
    expect(JSON.stringify(body)).not.toContain('v_1');
  });

  it('maps a dead socket to "unreachable" with the paste-flow fallback', async () => {
    const result = await publishDeck([{ text: 'x' }], TOKEN, {
      fetchFn: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unreachable');
    expect(result.message).toMatch(/Export/);
  });

  it('maps 403 to "auth" and relays the server\'s own words', async () => {
    const result = await publishDeck([{ text: 'x' }], TOKEN, {
      fetchFn: () => Promise.resolve(errResponse(403, { error: 'Wrong publish token. Compare it with the print server dashboard → Lobby slides.' })),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('auth');
    expect(result.message).toMatch(/Wrong publish token/);
  });

  it('maps other failures to "rejected" and survives a non-JSON error page', async () => {
    const result = await publishDeck([{ text: 'x' }], TOKEN, {
      fetchFn: () => Promise.resolve({ ok: false, status: 500, json: () => Promise.reject(new Error('html')) }),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('rejected');
    expect(result.message).toBe('HTTP 500');
  });
});

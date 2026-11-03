import { beforeAll, describe, expect, it } from 'vitest';
import { SyncCore } from '../src/sync.js';
import { PRES_PART_CHARS, cleanDeckHeader } from '../src/presentation.js';
import { memoryStore, signInV2 } from './helpers.js';
import { createHistoryKey, keyRing, openDocument, unwrapPrivateKey, sealDocument, sealRow, openRow, DOC_PAD_STEP } from '../../shared/cloud-crypto.js';
import { publishDeck } from '../../scripts/presentation/publish-deck.mjs';

// The presentation (src/routes.md 10.14): the weekly job seals the deck to
// history:pub and uploads it in parts with the machine token; a session reads
// the sealed deck back and moves the one shared slide. The Worker never holds
// the deck in the clear.

const PASS = 'kennebec';
const TOKEN = 'presentation-token-for-tests-0123456789';
let key;
beforeAll(async () => { key = await createHistoryKey(PASS); }, 60000);

async function setup({ token = TOKEN, withKey = true } = {}) {
  let t = Date.parse('2026-11-04T23:10:00Z');
  const storage = memoryStore();
  const frames = [];
  const core = new SyncCore({
    storage,
    env: { INITIAL_PASSPHRASE: PASS, ...(token ? { PRESENTATION_TOKEN: token } : {}) },
    now: () => t,
    broadcast: (text) => { frames.push(JSON.parse(text)); return 1; },
    liveScreens: () => new Set(),
  });
  const session = (await signInV2(core)).body.session;
  const raw = (method, path, body, auth = session, type = 'application/json') => core.handle(new Request(`https://sync.test${path}`, {
    method,
    headers: { 'Content-Type': type, ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  }), '10.0.0.1');
  const call = async (...a) => { const res = await raw(...a); return { status: res.status, body: await res.json() }; };
  if (withKey) expect((await call('PUT', '/v1/history/key', { pub: key.pub, kid: key.kid, wrapped: key.wrapped })).status).toBe(201);
  /** fetch for the job's script, routed into the core */
  const fetchFn = async (url, init) => core.handle(new Request(url, init), '10.0.0.2');
  return { core, storage, frames, session, raw, call, fetchFn, tick: (ms) => { t += ms; } };
}

const DECK = `<!doctype html><html><head><title>Eleven Seasons</title></head><body>${'<section class="slide">Growth</section>'.repeat(9000)}</body></html>`;

async function ringFor() {
  const priv = await unwrapPrivateKey(key.wrapped, PASS, key.pub);
  return keyRing(priv, key.pub);
}

describe('the document seal', () => {
  it('opens with the passphrase only, pads to 64 KiB steps, and is not a history row', async () => {
    const doc = { id: 'AAAAAAAAAAAAAAAAAAAAAA', night: '2026-11-04', kind: 'deck', record: { html: '<html>x</html>' } };
    const wire = await sealDocument(key.pub, doc);
    expect(wire).toBeTruthy();
    const ring = await ringFor();
    expect(await openDocument(ring, { ...doc, ...wire })).toEqual(doc.record);
    expect(Math.round((wire.ct.length / 4) * 3)).toBeGreaterThanOrEqual(DOC_PAD_STEP);
    // a document never opens as a row, and a row never as a document
    expect(await openRow(ring, { ...doc, ...wire })).toBeNull();
    const row = { id: doc.id, night: doc.night, kind: 'checkin', record: { ts: 1 } };
    expect(await openDocument(ring, { ...row, ...(await sealRow(key.pub, row)) })).toBeNull();
    // a changed field does not open
    expect(await openDocument(ring, { ...doc, ...wire, night: '2026-11-05' })).toBeNull();
    expect(await unwrapPrivateKey(key.wrapped, 'not-it', key.pub)).toBeNull();
  }, 60000);
});

describe('the deck routes', () => {
  it('the job seals, uploads in parts, and a session reads back what opens to the deck', async () => {
    const s = await setup();
    const out = await publishDeck({ html: DECK, base: 'https://sync.test', token: TOKEN, fetchFn: s.fetchFn, now: new Date('2026-11-05T08:30:00Z') });
    expect(out.parts).toBeGreaterThan(1);
    expect(out.chars).toBe(PRES_PART_CHARS * (out.parts - 1) + (out.chars - PRES_PART_CHARS * (out.parts - 1)));
    // nothing in storage is the deck in the clear
    for (const v of s.storage.map.values()) expect(JSON.stringify(v)).not.toContain('Eleven Seasons');
    const res = await s.raw('GET', '/v1/presentation/deck');
    expect(res.status).toBe(200);
    const wire = await res.json();
    expect(wire.rev).toBe(out.rev);
    const opened = await openDocument(await ringFor(), wire);
    expect(opened.html).toBe(DECK);
    expect(opened.builtAt).toBe('2026-11-05T08:30:00.000Z');
    const state = await s.call('GET', '/v1/presentation/state');
    expect(state.body.deck).toEqual({ rev: out.rev, builtAt: '2026-11-05T08:30:00.000Z' });
  }, 60000);

  it('a second deck replaces the first and leaves no old parts behind', async () => {
    const s = await setup();
    const a = await publishDeck({ html: DECK, base: 'https://sync.test', token: TOKEN, fetchFn: s.fetchFn });
    const b = await publishDeck({ html: DECK.replace('Eleven', 'Twelve'), base: 'https://sync.test', token: TOKEN, fetchFn: s.fetchFn });
    expect(b.rev).toBe(a.rev + 1);
    const parts = [...s.storage.map.keys()].filter((k) => k.startsWith('pres:part:'));
    expect(parts.every((k) => k.startsWith(`pres:part:${b.rev}:`))).toBe(true);
    const opened = await openDocument(await ringFor(), await (await s.raw('GET', '/v1/presentation/deck')).json());
    expect(opened.html).toContain('Twelve');
  }, 60000);

  it('uploads take the machine token only; a session cannot upload, the token cannot read', async () => {
    const s = await setup();
    const head = { v: 1, id: 'AAAAAAAAAAAAAAAAAAAAAA', night: '2026-11-04', kind: 'deck', kid: key.kid, epk: 'A'.repeat(86) + '==', iv: 'A'.repeat(16), chars: 8 };
    expect((await s.call('POST', '/v1/presentation/deck', head)).status).toBe(401);
    expect((await s.call('POST', '/v1/presentation/deck', head, 'wrong')).status).toBe(401);
    expect((await s.call('POST', '/v1/presentation/deck', head, TOKEN)).status).toBe(200);
    expect((await s.call('GET', '/v1/presentation/deck', undefined, TOKEN)).status).toBe(401);
    expect((await s.call('GET', '/v1/presentation/state', undefined, null)).status).toBe(401);
    expect((await s.call('GET', '/v1/presentation/key', undefined, TOKEN)).body.kid).toBe(key.kid);
    expect((await s.call('GET', '/v1/presentation/key', undefined, null)).status).toBe(401);
  });

  it('refuses a deck sealed to another key, a bad header, and parts out of order', async () => {
    const s = await setup();
    const head = { v: 1, id: 'AAAAAAAAAAAAAAAAAAAAAA', night: '2026-11-04', kind: 'deck', kid: key.kid, epk: 'A'.repeat(86) + '==', iv: 'A'.repeat(16), chars: PRES_PART_CHARS + 8 };
    expect((await s.call('POST', '/v1/presentation/deck', { ...head, kid: '0123456789abcdef' }, TOKEN)).body.reason).toBe('wrong-key');
    expect((await s.call('POST', '/v1/presentation/deck', { ...head, kind: 'checkin' }, TOKEN)).body.reason).toBe('bad-deck');
    expect(cleanDeckHeader({ ...head, chars: 7 })).toBeNull();
    const start = await s.call('POST', '/v1/presentation/deck', head, TOKEN);
    expect((await s.call('PUT', `/v1/presentation/deck/${start.body.rev}/1`, 'AAAAAAAA', TOKEN, 'text/plain')).body.reason).toBe('order');
    expect((await s.call('PUT', `/v1/presentation/deck/${start.body.rev}/0`, 'AAAA', TOKEN, 'text/plain')).body.reason).toBe('size');
    expect((await s.call('POST', `/v1/presentation/deck/${start.body.rev}/done`, {}, TOKEN)).body.reason).toBe('parts');
    expect((await s.call('GET', '/v1/presentation/deck')).status).toBe(404);
  });

  it('says so plainly with no token secret on the Worker', async () => {
    const s = await setup({ token: '' });
    expect((await s.call('POST', '/v1/presentation/deck', {}, 'x')).status).toBe(503);
    await expect(publishDeck({ html: DECK, base: 'https://sync.test', token: 'x', fetchFn: s.fetchFn })).rejects.toThrow(/PRESENTATION_TOKEN/);
  });
});

describe('the shared slide', () => {
  it('every screen sees the last press; a repeat changes nothing', async () => {
    const s = await setup({ withKey: false });
    expect((await s.call('GET', '/v1/presentation/state')).body.slide).toEqual({ index: 0, rev: 0, at: null });
    const a = await s.call('POST', '/v1/presentation/go', { index: 3 });
    expect(a.body.slide.index).toBe(3);
    expect(a.body.slide.rev).toBe(1);
    expect((await s.call('POST', '/v1/presentation/go', { index: 3 })).body.slide.rev).toBe(1);
    expect((await s.call('POST', '/v1/presentation/go', { index: 2 })).body.slide.rev).toBe(2);
    expect((await s.call('POST', '/v1/presentation/go', { index: -1 })).status).toBe(400);
    expect((await s.call('POST', '/v1/presentation/go', { index: 1.5 })).status).toBe(400);
    expect((await s.call('GET', '/v1/presentation/state')).body.deck).toBeNull();
  });

  it('a slide change rings the doorbell once; a repeat press does not', async () => {
    const s = await setup({ withKey: false });
    const rings = () => s.frames.filter((f) => f.e === 'changed' && f.d.what === 'presentation');
    await s.call('POST', '/v1/presentation/go', { index: 3 });
    await s.call('POST', '/v1/presentation/go', { index: 3 });
    expect(rings()).toEqual([{ e: 'changed', d: { what: 'presentation', slide: 1 } }]);
    await s.call('POST', '/v1/presentation/go', { index: 4 });
    expect(rings().length).toBe(2);
    // the state read alone never rings
    await s.call('GET', '/v1/presentation/state');
    expect(rings().length).toBe(2);
  });

  it('a new deck rings the doorbell with its rev', async () => {
    const s = await setup();
    const out = await publishDeck({ html: DECK, base: 'https://sync.test', token: TOKEN, fetchFn: s.fetchFn });
    expect(s.frames.filter((f) => f.e === 'changed' && f.d.what === 'presentation')).toEqual([{ e: 'changed', d: { what: 'presentation', deck: out.rev } }]);
  }, 60000);
});

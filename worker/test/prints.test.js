import { describe, expect, it } from 'vitest';
import { SyncCore } from '../src/sync.js';
import { DISPATCH_WORKFLOWS, PRINT_PART_CHARS, HANDBOOK_GAP_MS, Prints, cleanName } from '../src/prints.js';
import { CONVERT_WORKFLOW } from '../src/cast.js';
import { memoryStore, signInV2 } from './helpers.js';

// Print from the letterhead page (src/routes.md 10.16): a scrambled PDF uploaded in
// pieces, the print job started on GitHub, the job reads it with the machine token.

const KEY = 'A'.repeat(43);

async function setup(env = { PRINT_DISPATCH_TOKEN: 'gh-token', HANDBOOK_TOKEN: 'machine' }) {
  const storage = memoryStore();
  let t = Date.parse('2026-11-04T22:00:00Z');
  const dispatched = [];
  let answer = 204;
  const fetchFn = async (url, init) => {
    if (String(url).startsWith('https://api.github.com/')) {
      dispatched.push({ url: String(url), auth: init.headers.Authorization, body: JSON.parse(init.body) });
      return new Response(null, { status: answer });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const core = new SyncCore({
    storage, fetchFn,
    env: { INITIAL_PASSPHRASE: 'kennebec', ...env },
    now: () => t,
    broadcast: () => 1,
    liveScreens: () => new Set(),
  });
  const session = (await signInV2(core)).body.session;
  const call = async (method, path, body, auth = session, raw = false) => {
    const res = await core.handle(new Request(`https://sync.test${path}`, {
      method,
      headers: { ...(typeof body === 'string' ? { 'Content-Type': 'text/plain' } : { 'Content-Type': 'application/json' }), ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    }), '10.0.0.1');
    return { status: res.status, body: raw ? await res.text() : await res.json() };
  };
  return { core, storage, call, dispatched, setAnswer: (s) => { answer = s; }, tick: (ms) => { t += ms; } };
}

/** Upload `b64` and answer the id. */
async function upload(s, b64, copies = 3) {
  const st = await s.call('POST', '/v1/prints/pdf', { chars: b64.length, name: 'Ballots.pdf', copies });
  expect(st.status).toBe(200);
  for (let n = 0; n < st.body.parts; n += 1) {
    const r = await s.call('PUT', `/v1/prints/pdf/${st.body.id}/${n}`, b64.slice(n * PRINT_PART_CHARS, (n + 1) * PRINT_PART_CHARS));
    expect(r.status).toBe(200);
  }
  return st.body.id;
}

describe('printing from the letterhead page', () => {
  it('says not set up without the GitHub token', async () => {
    const s = await setup({ HANDBOOK_TOKEN: 'machine' });
    expect((await s.call('GET', '/v1/prints')).body.ready).toBe(false);
    expect((await s.call('POST', '/v1/prints/handbook', {})).status).toBe(503);
    expect((await s.call('POST', '/v1/prints/pdf', { chars: 400, copies: 1 })).status).toBe(503);
  });

  it('needs a session', async () => {
    const s = await setup();
    expect((await s.call('POST', '/v1/prints/handbook', {}, null)).status).toBe(401);
    expect((await s.call('POST', '/v1/prints/pdf', { chars: 400, copies: 1 }, null)).status).toBe(401);
  });

  it('uploads, starts the job once with id.key and the copies, hands the job the ciphertext, then forgets it', async () => {
    const s = await setup();
    const b64 = 'QUJD'.repeat(60000);   // 240000 chars: three parts
    const id = await upload(s, b64, 25);
    const sent = await s.call('POST', `/v1/prints/pdf/${id}/send`, { key: KEY });
    expect(sent.status).toBe(200);
    expect(s.dispatched).toHaveLength(1);
    expect(s.dispatched[0].url).toContain('/actions/workflows/letterhead-print.yml/dispatches');
    expect(s.dispatched[0].auth).toBe('Bearer gh-token');
    expect(s.dispatched[0].body).toEqual({ ref: 'main', inputs: { pdf_job: `${id}.${KEY}`, copies: '25' } });
    // The key is never stored.
    expect(JSON.stringify([...s.storage.map?.entries?.() || []])).not.toContain(KEY);
    // A second tap does not print twice.
    expect((await s.call('POST', `/v1/prints/pdf/${id}/send`, { key: KEY })).status).toBe(409);
    expect(s.dispatched).toHaveLength(1);
    // The job: the machine token only.
    expect((await s.call('GET', `/v1/prints/pdf/${id}`, undefined, 'wrong')).status).toBe(401);
    const got = await s.call('GET', `/v1/prints/pdf/${id}`, undefined, 'machine', true);
    expect(got.status).toBe(200);
    expect(JSON.parse(got.body)).toEqual({ name: 'Ballots', ct: b64 });
    expect((await s.call('DELETE', `/v1/prints/pdf/${id}`, undefined, 'machine')).status).toBe(200);
    expect((await s.call('GET', `/v1/prints/pdf/${id}`, undefined, 'machine', true)).status).toBe(404);
  });

  it('refuses a send before every piece arrived, a bad key, and copies out of range', async () => {
    const s = await setup();
    const st = await s.call('POST', '/v1/prints/pdf', { chars: 400, copies: 1 });
    expect((await s.call('POST', `/v1/prints/pdf/${st.body.id}/send`, { key: KEY })).status).toBe(400);
    expect((await s.call('PUT', `/v1/prints/pdf/${st.body.id}/0`, 'QUJD'.repeat(99))).status).toBe(400);   // wrong size
    await s.call('PUT', `/v1/prints/pdf/${st.body.id}/0`, 'QUJD'.repeat(100));
    expect((await s.call('POST', `/v1/prints/pdf/${st.body.id}/send`, { key: 'short' })).status).toBe(400);
    expect((await s.call('POST', '/v1/prints/pdf', { chars: 400, copies: 101 })).status).toBe(400);
    expect((await s.call('POST', '/v1/prints/pdf', { chars: 400, copies: 0 })).status).toBe(400);
    expect((await s.call('POST', '/v1/prints/pdf', { chars: 30_000_000, copies: 1 })).status).toBe(400);
    expect(s.dispatched).toHaveLength(0);
  });

  it('a failed dispatch can be tried again; an old upload expires', async () => {
    const s = await setup();
    const id = await upload(s, 'QUJD'.repeat(100), 1);
    s.setAnswer(403);
    const bad = await s.call('POST', `/v1/prints/pdf/${id}/send`, { key: KEY });
    expect(bad.status).toBe(502);
    s.setAnswer(204);
    expect((await s.call('POST', `/v1/prints/pdf/${id}/send`, { key: KEY })).status).toBe(200);
    s.tick(2 * 60 * 60 * 1000);
    expect((await s.call('GET', `/v1/prints/pdf/${id}`, undefined, 'machine', true)).status).toBe(404);
  });

  it('prints the handbook sheets, once per couple of minutes', async () => {
    const s = await setup();
    expect((await s.call('POST', '/v1/prints/handbook', {})).status).toBe(200);
    expect(s.dispatched[0].url).toContain('/actions/workflows/handbook-print.yml/dispatches');
    expect(s.dispatched[0].body).toEqual({ ref: 'main', inputs: {} });
    expect((await s.call('POST', '/v1/prints/handbook', {})).status).toBe(429);
    s.tick(HANDBOOK_GAP_MS + 1);
    expect((await s.call('POST', '/v1/prints/handbook', {})).status).toBe(200);
  });

  it('cleans a file name', () => {
    expect(cleanName('Parents Night <b>.pdf')).toBe('Parents Night b');
    expect(cleanName('')).toBe('document');
  });
});

describe('the GitHub dispatch only starts its own workflows', () => {
  it('refuses any workflow file but the print, handbook and PowerPoint jobs, before asking GitHub', async () => {
    const asked = [];
    const prints = new Prints({
      storage: new Map(),
      now: () => 0,
      env: () => ({ PRINT_DISPATCH_TOKEN: 'gh' }),
      fetchFn: async (url) => { asked.push(String(url)); return new Response(null, { status: 204 }); },
    });
    for (const wf of ['printer-release.yml', 'delete-release.yml', '../letterhead-print.yml', 'LETTERHEAD-PRINT.yml', 'letterhead-print.yml/../x', '']) {
      expect(await prints.dispatch(wf, {})).toMatchObject({ ok: false, refused: true });
    }
    expect(asked).toEqual([]);
    for (const wf of DISPATCH_WORKFLOWS) expect((await prints.dispatch(wf, {})).ok).toBe(true);
    expect(DISPATCH_WORKFLOWS).toEqual(['letterhead-print.yml', 'handbook-print.yml', CONVERT_WORKFLOW]);
    expect(asked).toHaveLength(3);
  });
});

describe('separate machine tokens for the print and PowerPoint jobs (optional secrets)', () => {
  const req = (token) => new Request('https://sync.test/x', { headers: { Authorization: `Bearer ${token}` } });
  const make = (env) => new Prints({ storage: new Map(), now: () => 0, env: () => env, fetchFn: async () => new Response(null, { status: 204 }) });

  it('without them, HANDBOOK_TOKEN works on both, as before', () => {
    const p = make({ HANDBOOK_TOKEN: 'hb' });
    expect(p.machineOk(req('hb'))).toBe(true);
    expect(p.machineOk(req('hb'), 'cast')).toBe(true);
    expect(p.machineOk(req('nope'))).toBe(false);
  });

  it('once set, only that token works on its routes', () => {
    const p = make({ HANDBOOK_TOKEN: 'hb', PRINT_FETCH_TOKEN: 'pf', CAST_CONVERT_TOKEN: 'cc' });
    expect(p.machineOk(req('pf'))).toBe(true);
    expect(p.machineOk(req('hb'))).toBe(false);
    expect(p.machineOk(req('cc'))).toBe(false);
    expect(p.machineOk(req('cc'), 'cast')).toBe(true);
    expect(p.machineOk(req('hb'), 'cast')).toBe(false);
    expect(p.machineOk(req('pf'), 'cast')).toBe(false);
  });

  it('the PowerPoint job is set up with its own token alone', async () => {
    const core = new SyncCore({
      storage: memoryStore(),
      env: { INITIAL_PASSPHRASE: 'kennebec', PRINT_DISPATCH_TOKEN: 'gh', CAST_CONVERT_TOKEN: 'cc', HANDBOOK_TOKEN: 'hb' },
      now: () => Date.parse('2026-11-08T21:00:00Z'),
      broadcast: () => 1,
      liveScreens: () => new Set(),
    });
    expect(core.cast.convertReady()).toBe(true);
    const job = (token) => core.handle(new Request('https://sync.test/v1/cast/convert/cabcdefghijklmnop/job', { headers: { Authorization: `Bearer ${token}` } }), '10.0.0.9');
    expect((await job('cc')).status).toBe(404);   // let in; there is no such upload
    expect((await job('hb')).status).toBe(401);
  });
});

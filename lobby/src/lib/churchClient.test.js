import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = [];
let answer = () => ({ ok: true, status: 200, body: {} });
vi.mock('../hooks/useSync.js', () => ({
  syncAuthed: async (path, opts) => { calls.push({ path, ...opts }); return answer(path, opts); },
}));

const {
  CHURCH_DEFAULTS, STALE_WORDS, churchState, churchValue, docFrom, fetchChurch, mergeLocal, reapplyEdits, saveChurch, startFromDefaults,
} = await import('./churchClient.js');

beforeEach(() => { calls.length = 0; answer = () => ({ ok: true, status: 200, body: {} }); });

const doc = (over = {}) => docFrom({ rev: 4, savedAt: 'x', settings: { labelFooter: 'Hi', lateGraceMin: 15 }, switches: {}, ...over });

describe('the church document', () => {
  it('reads the GET answer', async () => {
    answer = () => ({ ok: true, status: 200, body: { rev: 2, savedAt: 't', paused: false, settings: { trophyBand: false }, switches: { CHURCH_SETTINGS: 'on' }, switchesRev: 7 } });
    const r = await fetchChurch();
    expect(r.ok && r.doc).toMatchObject({ rev: 2, settings: { trophyBand: false }, switchesRev: 7 });
    expect(calls[0].path).toBe('/v1/church/settings');
  });

  it('is unseeded before the laptop sends its settings, paused when the switch is off', () => {
    expect(churchState(null)).toBe('loading');
    expect(churchState(docFrom({ rev: 0, settings: null }))).toBe('unseeded');
    expect(churchState(doc({ paused: true }))).toBe('paused');
    expect(churchState(doc())).toBe('ready');
  });

  it('shows the laptop default for a key the document lacks', () => {
    expect(churchValue(doc(), 'labelFooter')).toBe('Hi');
    expect(churchValue(doc(), 'trophyBand')).toBe(CHURCH_DEFAULTS.trophyBand);
    expect(churchValue(null, 'lateGraceMin')).toBe(10);
  });

  it('merges like the Worker (shared mergeChurch): null deletes, a key outside the table is ignored', () => {
    expect(mergeLocal({ labelFooter: 'a', trophyBand: true }, { trophyBand: null, lateGraceMin: 3, stranger: 1 }))
      .toEqual({ labelFooter: 'a', lateGraceMin: 3 });
  });
});

describe('saving with baseRev', () => {
  it('sends only the changed keys against the revision shown', async () => {
    answer = () => ({ ok: true, status: 200, body: { ok: true, rev: 5, savedAt: 'n', settings: { labelFooter: 'Hello', lateGraceMin: 15 } } });
    const r = await saveChurch(doc(), { labelFooter: 'Hello' });
    expect(calls[0]).toMatchObject({ path: '/v1/church/settings', method: 'PUT', body: { baseRev: 4, settings: { labelFooter: 'Hello' } } });
    expect(r.ok && r.doc.rev).toBe(5);
    expect(r.ok && r.doc.settings.labelFooter).toBe('Hello');
  });

  it('a stale 409 hands back the newer document, and the unsaved edit survives re-applied', async () => {
    answer = () => ({ ok: false, status: 409, body: { reason: 'stale', rev: 6, settings: { labelFooter: 'Someone', lateGraceMin: 20 } } });
    const r = await saveChurch(doc(), { labelFooter: 'Mine' });
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('stale');
    expect(r.message).toBe(STALE_WORDS);
    expect(r.doc.rev).toBe(6);
    expect(r.doc.settings).toEqual({ labelFooter: 'Someone', lateGraceMin: 20 });
    // the card re-applies its own unsaved typing over the new document
    expect(reapplyEdits(r.doc.settings, { labelFooter: 'Mine' })).toEqual({ labelFooter: 'Mine', lateGraceMin: 20 });
    // and saving again names the NEW revision
    answer = () => ({ ok: true, status: 200, body: { ok: true, rev: 7, settings: { labelFooter: 'Mine', lateGraceMin: 20 } } });
    await saveChurch(r.doc, { labelFooter: 'Mine' });
    expect(calls[1].body.baseRev).toBe(6);
  });

  it('names every refusal in words', async () => {
    answer = () => ({ ok: false, status: 409, body: { reason: 'not-seeded' } });
    expect((await saveChurch(doc(), {})).kind).toBe('not-seeded');
    answer = () => ({ ok: false, status: 503, body: { reason: 'church-off' } });
    expect((await saveChurch(doc(), {})).kind).toBe('paused');
    answer = () => ({ ok: false, status: 413, body: {} });
    expect((await saveChurch(doc(), {})).kind).toBe('too-big');
    answer = () => ({ ok: false, status: 400, body: { reason: 'bad-settings', dropped: ['x'] } });
    expect((await saveChurch(doc(), {})).kind).toBe('refused');
    answer = () => ({ ok: false, status: 0, body: null });
    expect((await saveChurch(doc(), {})).message).toMatch(/Could not reach/);
  });

  it('"Start from defaults instead" sends fromDefaults on revision 0', async () => {
    answer = () => ({ ok: true, status: 201, body: { ok: true, rev: 1, settings: { lateGraceMin: 10 } } });
    const r = await startFromDefaults();
    expect(calls[0].body).toMatchObject({ baseRev: 0, fromDefaults: true, settings: {} });
    expect(r.ok && r.doc.rev).toBe(1);
  });
});

describe('one definition for the page, the Worker and the station', () => {
  it('uses the shared allowlist, and has a default for every key and no other', async () => {
    const shared = await import('../../shared/churchSettings.js');
    const { CHURCH_KEYS } = await import('./churchClient.js');
    expect(CHURCH_KEYS).toBe(shared.CHURCH_KEYS);
    expect(Object.keys(CHURCH_DEFAULTS).sort()).toEqual([...shared.CHURCH_KEYS].sort());
  });

  it('never sends a value the Worker would drop', async () => {
    const r = await saveChurch(doc(), { lateGraceMin: 'soon' });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.kind).toBe('refused');
    expect(r.ok === false && r.message).toMatch(/lateGraceMin/);
    expect(calls).toHaveLength(0);
  });

  it('sends the value the shared sanitizer cleaned', async () => {
    answer = () => ({ ok: true, status: 200, body: { ok: true, rev: 5 } });
    await saveChurch(doc(), { labelFooter: '  Two\nlines  ', lateGraceMin: 500, barfNights: null });
    expect(calls[0].body.settings).toEqual({ labelFooter: 'Two lines', lateGraceMin: 120, barfNights: null });
  });
});

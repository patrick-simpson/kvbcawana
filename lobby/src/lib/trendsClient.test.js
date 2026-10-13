import { describe, expect, it, vi } from 'vitest';

const call = vi.hoisted(() => vi.fn());
vi.mock('./workerClient.js', () => ({ call }));

const { WAITING_WORDS, fetchImportStatus, importStatusFrom, importStatusWords } = await import('./trendsClient.js');

const NOW = Date.parse('2026-10-13T16:00:00Z');
const H = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();

// The Worker's answer (worker/src/trendsimport.js statusView), eleven seasons in.
function done(over = {}) {
  const seasons = [];
  for (let y = 2026; y >= 2016; y--) seasons.push({ season: `${y}-${String((y + 1) % 100).padStart(2, '0')}`, nights: 30, importedAt: iso(NOW - (2026 - y + 3) * H) });
  return {
    state: 'done', seasons, oldestSeason: '2016-17', lastRunAt: iso(NOW - 3 * H), nextDueAt: null, lastError: null,
    unreadableWhy: null, skipped: [], ended: 'empty', currentSeasonLastAt: iso(NOW - 3 * H),
    crosscheck: { compared: 4, matching: 4, differing: 0, deskHigher: 0, examples: [], at: iso(NOW - 3 * H) },
    ...over,
  };
}

describe('importStatusFrom: only the shape the card reads', () => {
  it('keeps the fields and drops anything else', () => {
    const s = importStatusFrom({ ...done(), extra: 'x', crosscheck: { compared: 2, matching: 1, differing: 1, deskHigher: 0, examples: [{ night: '2026-10-07', club: 'Sparks', desk: 18, twotimtwo: 20, name: 'Zebedee' }], at: iso(NOW) } });
    expect(s.state).toBe('done');
    expect(s.seasons).toHaveLength(11);
    expect(s).not.toHaveProperty('extra');
    expect(s.crosscheck.examples).toEqual([{ night: '2026-10-07', club: 'Sparks', desk: 18, twotimtwo: 20 }]);
  });

  it('refuses something that is not a status', () => {
    expect(importStatusFrom(null)).toBeNull();
    expect(importStatusFrom({ state: 'exploded' })).toBeNull();
    expect(importStatusFrom({ state: 'idle' })).toMatchObject({ seasons: [], oldestSeason: null, crosscheck: null });
  });

  it('fetchImportStatus: a Worker without the route is "missing", never an error line', async () => {
    call.mockResolvedValueOnce({ ok: true, status: 200, body: done(), message: '' });
    expect(await fetchImportStatus()).toMatchObject({ ok: true, status: { state: 'done', oldestSeason: '2016-17' } });
    call.mockResolvedValueOnce({ ok: false, status: 404, body: null, message: 'not yet' });
    expect(await fetchImportStatus()).toMatchObject({ ok: false, missing: true });
    call.mockResolvedValueOnce({ ok: false, status: 0, body: null, message: 'Could not reach the sync service.' });
    expect(await fetchImportStatus()).toMatchObject({ ok: false, missing: false });
    expect(call).toHaveBeenLastCalledWith('/v1/history/import-status');
  });
});

describe('importStatusWords: plain words for the Trends card', () => {
  const words = (raw) => importStatusWords(importStatusFrom(raw), NOW);

  it('done: how far back, how many seasons, when last updated', () => {
    expect(words(done()).line).toBe('Earlier seasons from TwoTimTwo: back to 2016-17 (11 seasons), last updated 3 h ago.');
    expect(words(done()).tone).toBe('ok');
  });

  it('done with nothing in TwoTimTwo', () => {
    expect(words(done({ seasons: [{ season: '2026-27', nights: 0, importedAt: iso(NOW) }], oldestSeason: null })).line).toBe('TwoTimTwo has no earlier seasons to bring in.');
  });

  it('running, idle', () => {
    expect(words({ state: 'running', seasons: [] }).line).toBe('Bringing in earlier seasons from TwoTimTwo…');
    expect(words({ state: 'running', seasons: done().seasons.slice(0, 3) }).line).toBe('Bringing in earlier seasons from TwoTimTwo… 3 seasons in so far.');
    expect(words({ state: 'idle', seasons: [] }).line).toBe('Earlier seasons will come in by themselves after the next sync.');
  });

  it('unreadable: nothing imported, when it tries again, and what is still shown', () => {
    expect(words({ state: 'unreadable', seasons: [], nextDueAt: iso(NOW + 24 * H) })).toMatchObject({
      tone: 'warn', line: 'TwoTimTwo’s attendance report did not read as expected, so nothing was imported. It will try again tomorrow.',
    });
    expect(words({ state: 'unreadable', seasons: [], nextDueAt: null }).line).toMatch(/after the next club night\.$/);
    expect(words(done({ state: 'unreadable', nextDueAt: iso(NOW + 24 * H) })).line).toMatch(/The seasons already in \(back to 2016-17 \(11 seasons\)\) are still shown\.$/);
  });

  it('not configured: each reason in plain words', () => {
    for (const [reason, text] of Object.entries(WAITING_WORDS)) {
      const tone = reason === 'sign-in-refused' || reason === 'no-permission' ? 'warn' : 'ok';
      expect(words({ state: 'not-configured', reason, seasons: [] })).toMatchObject({ line: text, tone });
    }
    expect(WAITING_WORDS['no-secrets']).toBe('Waiting for TwoTimTwo to be connected in Settings.');
    expect(words({ state: 'not-configured', reason: 'something-new', seasons: [] }).line).toBe('Waiting for TwoTimTwo to be connected.');
  });

  it('the self-check: agree, differ kindly, nothing yet, none before the first import', () => {
    expect(words(done()).check).toBe('Checked against the check-in desk on 4 nights: all 4 agree.');
    expect(words(done({ crosscheck: { compared: 1, matching: 1, differing: 0, deskHigher: 0, examples: [], at: null } })).check).toBe('Checked against the check-in desk on 1 night: it agrees.');
    const differ = words(done({ crosscheck: { compared: 5, matching: 4, differing: 1, deskHigher: 0, examples: [{ night: '2026-09-30', club: 'Sparks', desk: 18, twotimtwo: 20 }], at: null } }));
    expect(differ.check).toBe('Checked against the check-in desk on 5 nights: 4 agree, 1 differs (the desk may have counted only some children). For example Wed, Sep 30, Sparks: 18 at the desk, 20 in TwoTimTwo.');
    expect(differ.checkTone).toBe('ok');
    const higher = words(done({ crosscheck: { compared: 3, matching: 1, differing: 2, deskHigher: 1, examples: [{ night: '2026-09-23', club: 'Trek', desk: 11, twotimtwo: 10 }], at: null } }));
    expect(higher.check).toMatch(/^Checked against the check-in desk on 3 nights: 1 agrees, 2 differ\. On 1 night the desk counted more than TwoTimTwo, which is worth a look\./);
    expect(higher.checkTone).toBe('warn');
    expect(words(done({ crosscheck: { compared: 0, matching: 0, differing: 0, deskHigher: 0, examples: [], at: null } })).check).toBe('Nothing to compare with the desk yet.');
    expect(words(done({ crosscheck: null })).check).toBeNull();
    expect(importStatusWords(null)).toBeNull();
  });
});
